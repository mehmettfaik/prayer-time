// Vercel Serverless Function — Namaz Vakitleri API
// Node.js 18+ runtime (built-in fetch, no dependencies needed)

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const { lat, lng } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({
      error: 'Koordinat bilgisi eksik. lat ve lng parametreleri gerekli.'
    });
  }

  try {
    // Current timestamp for AlAdhan
    const now = new Date();
    const timestamp = Math.floor(now.getTime() / 1000);

    // 1. AlAdhan API — Prayer times + Hijri date
    const aladhanUrl = `https://api.aladhan.com/v1/timings/${timestamp}?latitude=${lat}&longitude=${lng}&method=13`;
    const aladhanRes = await fetch(aladhanUrl);
    if (!aladhanRes.ok) throw new Error('AlAdhan API hatası');
    const aladhanData = await aladhanRes.json();

    // 2. Nominatim Reverse Geocoding — coordinates to city name
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=tr`;
    const nominatimRes = await fetch(nominatimUrl, {
      headers: { 'User-Agent': 'NamazVakitleri/1.0 (namaz-vakitleri.vercel.app)' }
    });
    let locationName = { city: 'Bilinmeyen', district: '', country: '' };
    if (nominatimRes.ok) {
      const geoData = await nominatimRes.json();
      const addr = geoData.address || {};
      locationName = {
        district: addr.suburb || addr.town || addr.county || addr.district || '',
        city: addr.city || addr.province || addr.state || 'Bilinmeyen',
        country: addr.country || ''
      };
    }

    // Extract timing data
    const timings = aladhanData.data.timings;
    const dateInfo = aladhanData.data.date;
    const hijri = dateInfo.hijri;
    const gregorian = dateInfo.gregorian;



    // 3. Calculate Makruh (Kerahat) times
    const makruh = calculateMakruhTimes(timings);

    // 4. Calculate prayer statuses and next prayer countdown
    const prayerList = [
      { key: 'Imsak', name: 'İmsak', time: timings.Imsak },
      { key: 'Sunrise', name: 'Güneş', time: timings.Sunrise },
      { key: 'Dhuhr', name: 'Öğle', time: timings.Dhuhr },
      { key: 'Asr', name: 'İkindi', time: timings.Asr },
      { key: 'Maghrib', name: 'Akşam', time: timings.Maghrib },
      { key: 'Isha', name: 'Yatsı', time: timings.Isha }
    ];

    const timezone = aladhanData.data.meta?.timezone || 'Europe/Istanbul';

    const trParts = new Intl.DateTimeFormat('tr-TR', {
      timeZone: timezone,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23'
    }).formatToParts(now);

    let hours = 0, minutes = 0, seconds = 0;
    let localYear = 0, localDate = 0, trDayName = '', trMonthName = '';

    for (const part of trParts) {
      if (part.type === 'hour') hours = parseInt(part.value);
      if (part.type === 'minute') minutes = parseInt(part.value);
      if (part.type === 'second') seconds = parseInt(part.value);
      if (part.type === 'year') localYear = parseInt(part.value);
      if (part.type === 'day') localDate = parseInt(part.value);
      if (part.type === 'weekday') trDayName = part.value;
      if (part.type === 'month') trMonthName = part.value;
    }

    const nowMinutes = hours * 60 + minutes;
    const nowSeconds = hours * 3600 + minutes * 60 + seconds;

    let nextPrayer = null;
    let nextPrayerSeconds = null;
    let activePrayerIndex = -1;

    // Find active and next prayer
    for (let i = 0; i < prayerList.length; i++) {
      const [h, m] = prayerList[i].time.split(':').map(Number);
      const prayerMinutes = h * 60 + m;
      const prayerSeconds = h * 3600 + m * 60;

      if (prayerMinutes > nowMinutes) {
        nextPrayer = prayerList[i];
        nextPrayerSeconds = prayerSeconds - nowSeconds;
        activePrayerIndex = i - 1;
        break;
      }
    }

    // If no next prayer today, next is tomorrow's Imsak
    if (!nextPrayer) {
      nextPrayer = prayerList[0]; // İmsak
      const [h, m] = prayerList[0].time.split(':').map(Number);
      const imsakSeconds = h * 3600 + m * 60;
      nextPrayerSeconds = (86400 - nowSeconds) + imsakSeconds;
      activePrayerIndex = prayerList.length - 1;
    }

    // Determine status for each prayer
    const prayers = prayerList.map((p, i) => {
      let status = 'waiting'; // bekliyor
      if (i < activePrayerIndex + 1) {
        status = 'passed'; // geçti
      } else if (i === activePrayerIndex + 1 && i === (nextPrayer === prayerList[0] ? prayerList.length : activePrayerIndex + 1)) {
        // Edge case handling
      }
      if (i === activePrayerIndex) {
        status = 'active'; // aktif
      } else if (i < activePrayerIndex) {
        status = 'passed';
      }

      // Check if current time is in makruh period for this prayer
      if (isInMakruhPeriod(nowMinutes, makruh)) {
        // Mark sunrise-related kerahat
      }

      return {
        key: p.key,
        name: p.name,
        time: p.time,
        status: status
      };
    });

    // Better status calculation
    for (let i = 0; i < prayers.length; i++) {
      const [h, m] = prayers[i].time.split(':').map(Number);
      const prayerMinutes = h * 60 + m;

      if (prayerMinutes <= nowMinutes) {
        // Check if next prayer has also passed
        if (i < prayers.length - 1) {
          const [nh, nm] = prayers[i + 1].time.split(':').map(Number);
          const nextMinutes = nh * 60 + nm;
          if (nowMinutes < nextMinutes) {
            prayers[i].status = 'active';
          } else {
            prayers[i].status = 'passed';
          }
        } else {
          // Last prayer of the day
          prayers[i].status = 'active';
        }
      } else {
        prayers[i].status = 'waiting';
      }
    }

    // Check kerahat status for Güneş
    const sunriseIdx = prayers.findIndex(p => p.key === 'Sunrise');
    if (sunriseIdx !== -1) {
      const [sh, sm] = timings.Sunrise.split(':').map(Number);
      const sunriseMin = sh * 60 + sm;
      if (nowMinutes >= sunriseMin - 30 && nowMinutes <= sunriseMin + 30) {
        prayers[sunriseIdx].status = 'kerahat';
      }
    }

    // Current makruh status
    const currentMakruh = getCurrentMakruhStatus(nowMinutes, makruh);

    // 5. Determine which prayer is currently prayable
    const currentPrayable = getCurrentPrayable(timings, nowMinutes, makruh);

    // Hijri month names in Turkish
    const hijriMonthsTr = {
      1: 'Muharrem', 2: 'Safer', 3: 'Rebiülevvel', 4: 'Rebiülahir',
      5: 'Cemaziyelevvel', 6: 'Cemaziyelahir', 7: 'Recep', 8: 'Şaban',
      9: 'Ramazan', 10: 'Şevval', 11: 'Zilkade', 12: 'Zilhicce'
    };

    const response = {
      prayers,
      nextPrayer: {
        name: nextPrayer.name,
        time: nextPrayer.time,
        remainingSeconds: nextPrayerSeconds
      },
      currentPrayable,
      location: locationName,
      date: {
        gregorian: {
          day: localDate,
          month: trMonthName,
          year: localYear,
          dayName: trDayName,
          formatted: `${trDayName}, ${localDate} ${trMonthName} ${localYear}`
        },
        hijri: {
          day: hijri.day,
          month: hijriMonthsTr[hijri.month.number] || hijri.month.en,
          year: hijri.year,
          formatted: `${hijri.day} ${hijriMonthsTr[hijri.month.number] || hijri.month.en} ${hijri.year}`
        }
      },
      makruh,
      currentMakruh,
      serverTime: now.toISOString()
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({
      error: 'Namaz vakitleri alınamadı. Lütfen tekrar deneyin.',
      details: error.message
    });
  }
}

/**
 * Calculate Makruh (Kerahat) prayer times
 * These are times when it's makruh (disliked) to pray non-obligatory prayers
 */
function calculateMakruhTimes(timings) {
  const sunrise = parseTime(timings.Sunrise);
  const dhuhr = parseTime(timings.Dhuhr);
  const sunset = parseTime(timings.Sunset);

  return [
    {
      name: 'Güneş Doğumu Kerahati',
      description: 'Güneş doğarken namaz kılmak mekruhtur',
      start: formatMinutes(sunrise - 30),
      end: formatMinutes(sunrise + 30),
      startMin: sunrise - 30,
      endMin: sunrise + 30
    },
    {
      name: 'İstiva (Zeval) Kerahati',
      description: 'Güneş tam tepedeyken namaz kılmak mekruhtur',
      start: formatMinutes(dhuhr - 15),
      end: formatMinutes(dhuhr + 5),
      startMin: dhuhr - 15,
      endMin: dhuhr + 5
    },
    {
      name: 'Güneş Batımı Kerahati',
      description: 'Güneş batarken namaz kılmak mekruhtur',
      start: formatMinutes(sunset - 15),
      end: formatMinutes(sunset + 15),
      startMin: sunset - 15,
      endMin: sunset + 15
    }
  ];
}

/** Parse "HH:MM" to total minutes */
function parseTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/** Format total minutes back to "HH:MM" */
function formatMinutes(totalMinutes) {
  let mins = totalMinutes;
  if (mins < 0) mins += 1440;
  if (mins >= 1440) mins -= 1440;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Check if currently in any makruh period */
function isInMakruhPeriod(nowMinutes, makruh) {
  return makruh.some(m => nowMinutes >= m.startMin && nowMinutes <= m.endMin);
}

/** Get current makruh status */
function getCurrentMakruhStatus(nowMinutes, makruh) {
  for (const m of makruh) {
    if (nowMinutes >= m.startMin && nowMinutes <= m.endMin) {
      return {
        active: true,
        name: m.name,
        description: m.description,
        end: m.end,
        remainingMinutes: m.endMin - nowMinutes
      };
    }
  }
  return { active: false };
}

/**
 * Determine which farz prayer is currently prayable
 * Maps time windows to the 5 daily farz prayers
 */
function getCurrentPrayable(timings, nowMinutes, makruh) {
  const imsak = parseTime(timings.Imsak);
  const sunrise = parseTime(timings.Sunrise);
  const dhuhr = parseTime(timings.Dhuhr);
  const asr = parseTime(timings.Asr);
  const maghrib = parseTime(timings.Maghrib);
  const isha = parseTime(timings.Isha);

  const isKerahat = isInMakruhPeriod(nowMinutes, makruh);
  let prayerName = null;

  if (nowMinutes >= imsak && nowMinutes < sunrise) {
    prayerName = 'Sabah';
  } else if (nowMinutes >= sunrise && nowMinutes < dhuhr) {
    // Between sunrise and dhuhr — no farz prayer time active
    // But Kuşluk (Duha) namazı can be prayed after sunrise kerahat ends
    prayerName = null;
  } else if (nowMinutes >= dhuhr && nowMinutes < asr) {
    prayerName = 'Öğle';
  } else if (nowMinutes >= asr && nowMinutes < maghrib) {
    prayerName = 'İkindi';
  } else if (nowMinutes >= maghrib && nowMinutes < isha) {
    prayerName = 'Akşam';
  } else {
    // After Isha or before Imsak
    prayerName = 'Yatsı';
  }

  if (!prayerName) {
    return {
      prayable: false,
      name: null,
      message: 'Şu an farz namaz vakti değildir',
      isKerahat: isKerahat
    };
  }

  if (isKerahat) {
    return {
      prayable: false,
      name: prayerName,
      message: `${prayerName} namazı kılınamaz`,
      isKerahat: true
    };
  }

  return {
    prayable: true,
    name: prayerName,
    message: `${prayerName} namazı kılınabilir`,
    isKerahat: false
  };
}
