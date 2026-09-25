const CACHE_NAME = 'hsk-flashcards-v56';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './sun.svg',
  './cloud.svg',
  './js/icons.js',
  './js/speech.js',
  './js/sync.js',
  './js/deck-manager.js',
  './js/flashcard.js',
  './js/app.js',
  './data/polyphones.json',
  './data/hsk_level_index.json',
  './data/hsk2_1.json',
  './data/hsk2_2.json',
  './data/hsk2_3.json',
  './data/hsk2_4.json',
  './data/hsk2_5.json',
  './data/hsk2_6.json',
  './data/hsk3_1.json',
  './data/hsk3_2.json',
  './data/hsk3_3.json',
  './data/hsk3_4.json',
  './data/hsk3_5.json',
  './data/hsk3_6.json',
  './data/hsk1.json',
  './data/hsk2.json',
  './data/hsk3.json',
  './data/hsk4.json',
  './data/hsk5.json',
  './data/hsk6.json',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isNavigate = event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/');
  const isDataRequest = url.pathname.includes('/data/') || url.pathname.endsWith('.json');

  // 1. Navigation requests (App Shell HTML): Network-first, fallback to cached index.html
  if (isNavigate) {
    event.respondWith(
      fetch(event.request, { cache: 'reload' })
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', clone));
          }
          return networkResponse;
        })
        .catch(() => caches.match('./index.html', { ignoreSearch: true }))
    );
    return;
  }

  // 2. Vocabulary & Data requests: Network-first, fallback to cache
  if (isDataRequest) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
    return;
  }

  // 3. Static assets (JS, CSS, Icons):
  // If version query string present (?v=...), always Network-first to guarantee fresh code
  if (url.searchParams.has('v')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
    return;
  }

  // Fallback for unversioned assets (including Google Fonts): Cache-first with background revalidation
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        // Background revalidation
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || (networkResponse.status !== 200 && networkResponse.type !== 'opaque')) {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      });
    })
  );
});
