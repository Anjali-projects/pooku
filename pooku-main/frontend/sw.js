const CACHE_NAME = 'pooku-v16';
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

  // API calls - network only, never cache authenticated responses
  if (url.pathname.startsWith('/api/') || url.href.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => new Response('{"error":"Offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } }))
    );
    return;
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

// Push notification handler (F3)
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Pooku';
  const options = {
    body: data.body || 'Check your habits!',
    icon: '/pooku.png',
    badge: '/pooku.png',
    data: { url: data.url || '/tracker.html' },
    vibrate: [100, 50, 100]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click — open/focus the app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/tracker.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('tracker.html') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
