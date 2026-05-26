const CACHE_NAME = 'pooku-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/login.html',
  '/tracker.html',
  '/manifest.json',
  '/pooku.png'
];

// Install event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

// Activate event
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - Network first, then cache
self.addEventListener('fetch', event => {
  // API calls - try network first
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            return response;
          }
          return caches.match(event.request);
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // Static assets - cache first, then network
    event.respondWith(
      caches.match(event.request)
        .then(response => response || fetch(event.request))
        .catch(() => {
          if (event.request.destination === 'document') {
            return caches.match('/tracker.html');
          }
        })
    );
  }
});
