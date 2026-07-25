const CACHE_NAME = 'slr-permit-pwa-v4';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/assets/slr-app-icon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(client => client.postMessage({ type: 'NEW_VERSION_AVAILABLE' }));
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
    }),
  );
});

self.addEventListener('push', event => {
  const payload = event.data?.json() || { title: "SLR Permit", body: "You have a new notification." };
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/assets/slr-app-icon.svg',
      tag: payload.tag || 'default-tag',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', event => {
  const { notification } = event;
  notification.close();

  const permitIdMatch = notification.tag.match(/^permit-(\d+)$/);

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Check if a window for this app is already open.
      const appClient = windowClients.find(client => client.url.endsWith('/') || client.url.includes('/index.html'));

      if (appClient) {
        // If a window is open, focus it and send a message to navigate.
        appClient.focus();
        if (permitIdMatch) {
          appClient.postMessage({ type: 'navigate-to-permit', permitId: permitIdMatch[1] });
        }
      } else if (clients.openWindow) {
        // If no window is open, open a new one.
        clients.openWindow('/');
      }
    })
  );
});
