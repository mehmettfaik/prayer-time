/**
 * 🕌 Namaz Vakitleri — Frontend Application
 * Handles geolocation, API calls, countdown timer, and UI rendering
 */

// ── Constants ──
const DEFAULT_COORDS = { lat: 41.0082, lng: 28.9784 }; // Istanbul
const STORAGE_KEY = 'namaz_vakitleri_coords';
const API_ENDPOINT = '/api/prayer-times';

// Prayer icons
const PRAYER_ICONS = {
  Imsak: '🌙',
  Sunrise: '🌅',
  Dhuhr: '☀️',
  Asr: '🌤️',
  Maghrib: '🌇',
  Isha: '🌃'
};

// ── State ──
let countdownInterval = null;
let remainingSeconds = 0;
let currentData = null;

// ── DOM Elements ──
const $ = (id) => document.getElementById(id);

const els = {
  loadingScreen: $('loading-screen'),
  app: $('app'),
  errorScreen: $('error-screen'),
  errorMessage: $('error-message'),
  locationName: $('location-name'),
  gregorianDate: $('gregorian-date'),
  hijriDate: $('hijri-date'),
  nextPrayerLabel: $('next-prayer-label'),
  nextPrayerName: $('next-prayer-name'),
  nextPrayerTime: $('next-prayer-time'),
  countdownHours: $('countdown-hours'),
  countdownMinutes: $('countdown-minutes'),
  countdownSeconds: $('countdown-seconds'),
  prayersList: $('prayers-list'),
  kerahatList: $('kerahat-list'),
  makruhAlert: $('makruh-alert'),
  makruhAlertTitle: $('makruh-alert-title'),
  makruhAlertDesc: $('makruh-alert-desc'),
  qiblaDegree: $('qibla-degree'),
  compassNeedle: $('compass-needle'),
  refreshBtn: $('refresh-location-btn'),
  updateLocationBtn: $('update-location-btn'),
  prayableStatus: $('prayable-status'),
  prayableIcon: $('prayable-icon'),
  prayableText: $('prayable-text')
};

// ── Initialization ──
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Register Service Worker for PWA / Add to Home Screen
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/public/sw.js');
    } catch (e) {
      console.warn('SW registration failed:', e);
    }
  }

  // Bind events
  els.refreshBtn.addEventListener('click', handleRefreshLocation);
  els.updateLocationBtn.addEventListener('click', handleRefreshLocation);

  try {
    const coords = await getCoordinates();
    await loadPrayerTimes(coords.lat, coords.lng);
  } catch (error) {
    console.error('Init error:', error);
    showError('Uygulama başlatılırken bir hata oluştu: ' + error.message);
  }
}

// ── Geolocation ──
function getSavedCoords() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.lat && parsed.lng) return parsed;
    }
  } catch (e) {
    // Ignore parse errors
  }
  return null;
}

function saveCoords(lat, lng) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ lat, lng, timestamp: Date.now() }));
  } catch (e) {
    // localStorage might be full or blocked
  }
}

function clearSavedCoords() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // Ignore
  }
}

async function getCoordinates() {
  // 1. Check localStorage first
  const saved = getSavedCoords();
  if (saved) {
    updateLoadingText('Vakitler yükleniyor...');
    return saved;
  }

  // 2. Try browser geolocation
  updateLoadingText('Konum tespit ediliyor...');

  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      console.warn('Geolocation not supported, using default');
      showLocationFallbackInfo();
      resolve(DEFAULT_COORDS);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        saveCoords(coords.lat, coords.lng);
        updateLoadingText('Vakitler yükleniyor...');
        resolve(coords);
      },
      (error) => {
        console.warn('Geolocation error:', error.message);
        showLocationFallbackInfo();
        resolve(DEFAULT_COORDS);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 60000 // 1 minute cache
      }
    );
  });
}

function updateLoadingText(text) {
  const subtitle = document.querySelector('.loading-subtitle');
  if (subtitle) subtitle.textContent = text;
}

function showLocationFallbackInfo() {
  updateLoadingText('Varsayılan konum kullanılıyor (İstanbul)...');
}

// ── API Call ──
async function loadPrayerTimes(lat, lng) {
  try {
    updateLoadingText('Namaz vakitleri hesaplanıyor...');

    const url = `${API_ENDPOINT}?lat=${lat}&lng=${lng}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API hatası: ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    currentData = data;
    renderUI(data);
    startCountdown(data.nextPrayer.remainingSeconds);
    showApp();

  } catch (error) {
    console.error('API Error:', error);
    showError(error.message);
  }
}

// ── UI Rendering ──
function renderUI(data) {
  renderHeader(data);
  renderHero(data.nextPrayer);
  renderPrayable(data.currentPrayable);
  renderPrayers(data.prayers);
  renderKerahat(data.makruh, data.currentMakruh);
  renderQibla(data.qibla);
  renderMakruhAlert(data.currentMakruh);
}

function renderHeader(data) {
  // Location
  const { district, city } = data.location;
  const locationText = district ? `${district}, ${city}` : city;
  els.locationName.textContent = locationText;

  // Dates
  els.gregorianDate.textContent = data.date.gregorian.formatted;
  els.hijriDate.textContent = data.date.hijri.formatted;
}

function renderHero(nextPrayer) {
  els.nextPrayerLabel.textContent = 'Bir sonraki';
  els.nextPrayerName.textContent = `${nextPrayer.name} Namazı`;
  els.nextPrayerTime.textContent = `Vakit: ${nextPrayer.time}`;
}

function renderPrayable(currentPrayable) {
  if (!currentPrayable || !els.prayableStatus) return;

  const statusEl = els.prayableStatus;
  const iconEl = els.prayableIcon;
  const textEl = els.prayableText;

  // Remove previous state classes
  statusEl.classList.remove('prayable-yes', 'prayable-no', 'prayable-kerahat');

  if (currentPrayable.prayable) {
    statusEl.classList.add('prayable-yes');
    iconEl.textContent = '✅';
    textEl.textContent = currentPrayable.message;
  } else if (currentPrayable.isKerahat) {
    statusEl.classList.add('prayable-kerahat');
    iconEl.textContent = '⚠️';
    textEl.textContent = currentPrayable.message;
  } else {
    statusEl.classList.add('prayable-no');
    iconEl.textContent = '⏳';
    textEl.textContent = currentPrayable.message;
  }
}

function renderPrayers(prayers) {
  els.prayersList.innerHTML = '';

  prayers.forEach((prayer, index) => {
    const card = document.createElement('div');
    card.className = `prayer-card ${prayer.status}`;
    card.style.animationDelay = `${index * 0.06}s`;

    const icon = PRAYER_ICONS[prayer.key] || '🕐';
    const badge = getBadgeHTML(prayer.status);

    card.innerHTML = `
      <div class="prayer-left">
        <div class="prayer-icon-wrap">${icon}</div>
        <span class="prayer-name">${prayer.name}</span>
      </div>
      <div class="prayer-right">
        <span class="prayer-time-value">${prayer.time}</span>
        ${badge}
      </div>
    `;

    els.prayersList.appendChild(card);
  });
}

function getBadgeHTML(status) {
  const badges = {
    passed: '<span class="prayer-badge badge-passed">Geçti</span>',
    active: '<span class="prayer-badge badge-active">Aktif</span>',
    waiting: '<span class="prayer-badge badge-waiting">Bekliyor</span>',
    kerahat: '<span class="prayer-badge badge-kerahat">Kerahat</span>'
  };
  return badges[status] || '';
}

function renderKerahat(makruh, currentMakruh) {
  els.kerahatList.innerHTML = '';

  makruh.forEach((period, index) => {
    const isActive = currentMakruh.active && currentMakruh.name === period.name;
    const card = document.createElement('div');
    card.className = `kerahat-card${isActive ? ' active-kerahat' : ''}`;
    card.style.animationDelay = `${index * 0.06}s`;

    // Calculate progress for the time period
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const totalDuration = period.endMin - period.startMin;
    let progress = 0;

    if (nowMinutes >= period.endMin) {
      progress = 100;
    } else if (nowMinutes >= period.startMin) {
      progress = Math.round(((nowMinutes - period.startMin) / totalDuration) * 100);
    }

    card.innerHTML = `
      <div class="kerahat-header">
        <span class="kerahat-name">${period.name}</span>
        <span class="kerahat-times">${period.start} — ${period.end}</span>
      </div>
      <p class="kerahat-desc">${period.description}</p>
      <div class="kerahat-progress">
        <div class="kerahat-progress-bar" style="width: ${progress}%"></div>
      </div>
    `;

    els.kerahatList.appendChild(card);
  });
}

function renderQibla(qibla) {
  if (!qibla) {
    document.getElementById('qibla-section').style.display = 'none';
    return;
  }

  const degree = parseFloat(qibla);
  els.qiblaDegree.textContent = `${degree}°`;

  // Rotate compass needle to point toward Qibla
  els.compassNeedle.style.transform = `translate(-50%, -50%) rotate(${degree}deg)`;
}

function renderMakruhAlert(currentMakruh) {
  if (currentMakruh && currentMakruh.active) {
    els.makruhAlert.classList.remove('hidden');
    els.makruhAlertTitle.textContent = `⚠️ ${currentMakruh.name}`;
    els.makruhAlertDesc.textContent = `${currentMakruh.description}. Bitiş: ${currentMakruh.end} (${currentMakruh.remainingMinutes} dk kaldı)`;
  } else {
    els.makruhAlert.classList.add('hidden');
  }
}

// ── Countdown Timer ──
function startCountdown(seconds) {
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }

  remainingSeconds = seconds;
  updateCountdownDisplay();

  countdownInterval = setInterval(() => {
    remainingSeconds--;

    if (remainingSeconds <= 0) {
      // Reload data when countdown finishes
      clearInterval(countdownInterval);
      const coords = getSavedCoords() || DEFAULT_COORDS;
      loadPrayerTimes(coords.lat, coords.lng);
      return;
    }

    updateCountdownDisplay();
  }, 1000);
}

function updateCountdownDisplay() {
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;

  const newHours = String(hours).padStart(2, '0');
  const newMinutes = String(minutes).padStart(2, '0');
  const newSeconds = String(seconds).padStart(2, '0');

  // Pulse animation on change
  if (els.countdownSeconds.textContent !== newSeconds) {
    els.countdownSeconds.classList.remove('pulse');
    // Force reflow to restart animation
    void els.countdownSeconds.offsetWidth;
    els.countdownSeconds.classList.add('pulse');
  }

  if (els.countdownMinutes.textContent !== newMinutes) {
    els.countdownMinutes.classList.remove('pulse');
    void els.countdownMinutes.offsetWidth;
    els.countdownMinutes.classList.add('pulse');
  }

  if (els.countdownHours.textContent !== newHours) {
    els.countdownHours.classList.remove('pulse');
    void els.countdownHours.offsetWidth;
    els.countdownHours.classList.add('pulse');
  }

  els.countdownHours.textContent = newHours;
  els.countdownMinutes.textContent = newMinutes;
  els.countdownSeconds.textContent = newSeconds;
}

// ── Screen Management ──
function showApp() {
  els.loadingScreen.classList.add('fade-out');
  setTimeout(() => {
    els.loadingScreen.style.display = 'none';
    els.app.classList.remove('hidden');
    els.errorScreen.classList.add('hidden');
  }, 600);
}

function showError(message) {
  els.loadingScreen.style.display = 'none';
  els.app.classList.add('hidden');
  els.errorScreen.classList.remove('hidden');
  els.errorMessage.textContent = message || 'Namaz vakitleri yüklenemedi.';
}

// ── Location Refresh ──
async function handleRefreshLocation() {
  clearSavedCoords();

  // Show loading
  els.app.classList.add('hidden');
  els.loadingScreen.style.display = 'flex';
  els.loadingScreen.classList.remove('fade-out');
  updateLoadingText('Konum güncelleniyor...');

  if (countdownInterval) {
    clearInterval(countdownInterval);
  }

  try {
    // Force fresh geolocation
    const coords = await new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(DEFAULT_COORDS);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const newCoords = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          saveCoords(newCoords.lat, newCoords.lng);
          resolve(newCoords);
        },
        () => {
          resolve(DEFAULT_COORDS);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });

    await loadPrayerTimes(coords.lat, coords.lng);
  } catch (error) {
    showError(error.message);
  }
}
