const CACHE_NAME = 'slr-permit-pwa-v2';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/assets/slr-metaliks-logo.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(APP_SHELL);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Don't cache API calls or non-GET requests. Let the browser handle them.
  if (url.pathname.startsWith('/api/') || request.method !== 'GET') {
    return;
  }

  // Use a "stale-while-revalidate" strategy for all other assets.
  // This serves the cached version for speed, then updates the cache
  // from the network in the background for next time.
  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(request).then(cachedResponse => {
        const networkFetch = fetch(request).then(networkResponse => {
          cache.put(request, networkResponse.clone());
          return networkResponse;
        });
        return cachedResponse || networkFetch;
      });
    })
  );
});
