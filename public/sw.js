// Service Worker — Namaz Vakitleri PWA
const CACHE_NAME = 'namaz-vakitleri-v1';
const STATIC_ASSETS = [
  '/',
  '/public/index.html',
  '/public/style.css',
  '/public/app.js',
  '/public/icon-512.png'
];

// Install — cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch — network first for API, cache first for static
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls — always network first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          return new Response(JSON.stringify({ error: 'Çevrimdışı — internet bağlantısı gerekli' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  // Static assets — cache first, then network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((response) => {
        // Update cache with fresh version
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
