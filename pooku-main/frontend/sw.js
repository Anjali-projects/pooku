const CACHE_NAME = 'pooku-v7';
const urlsToCache = [
  '/',
  '/login.html',
  '/tracker.html',
  '/tracker.css',
  '/tracker.js',
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

// Fetch event
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API calls - network first, cache GET responses for offline
  if (url.pathname.startsWith('/api/')) {
    if (event.request.method === 'GET') {
      event.respondWith(
        fetch(event.request)
          .then(response => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => caches.match(event.request).then(r => r || new Response('{"error":"Offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } })))
      );
    } else {
      // POST/PUT/DELETE/PATCH - network only, fail gracefully offline
      event.respondWith(
        fetch(event.request).catch(() => {
          return new Response('{"error":"Offline - queued for sync"}', {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        })
      );
    }
  } else {
    // Static assets - cache first, then network
    event.respondWith(
      caches.match(event.request)
        .then(response => {
          if (response) return response;
          return fetch(event.request).then(fetchResponse => {
            if (fetchResponse.ok) {
              const clone = fetchResponse.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return fetchResponse;
          });
        })
        .catch(() => {
          if (event.request.destination === 'document') {
            return caches.match('/tracker.html');
          }
        })
    );
  }
});
