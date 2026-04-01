importScripts('/precache-manifest.js');

const STATIC_CACHE_NAME = 'github-note-sync-static-v2';
const PRECACHE_URLS = Array.isArray(self.__PRECACHE_MANIFEST)
  ? self.__PRECACHE_MANIFEST
  : ['/', '/index.html', '/manifest.webmanifest'];
const PRECACHE_URL_SET = new Set(PRECACHE_URLS);

async function openStaticCache() {
  return caches.open(STATIC_CACHE_NAME);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    openStaticCache()
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== STATIC_CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      );

      const staticCache = await openStaticCache();
      const cachedRequests = await staticCache.keys();

      await Promise.all(
        cachedRequests
          .map((request) => new URL(request.url))
          .filter((requestUrl) => requestUrl.origin === self.location.origin)
          .filter((requestUrl) => !PRECACHE_URL_SET.has(requestUrl.pathname))
          .map((requestUrl) => staticCache.delete(requestUrl.pathname)),
      );

      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(request.url);

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const staticCache = await openStaticCache();
        const cachedIndex = await staticCache.match('/index.html');
        const networkResponsePromise = fetch(request)
          .then(async (networkResponse) => {
            if (networkResponse.ok) {
              await staticCache.put('/index.html', networkResponse.clone());
            }

            return networkResponse;
          })
          .catch(() => null);

        if (cachedIndex) {
          event.waitUntil(networkResponsePromise);
          return cachedIndex;
        }

        return (await networkResponsePromise) ?? Response.error();
      })(),
    );
    return;
  }

  if (PRECACHE_URL_SET.has(requestUrl.pathname)) {
    event.respondWith(
      openStaticCache().then(async (staticCache) => {
        const cachedResponse = await staticCache.match(requestUrl.pathname);

        if (cachedResponse) {
          return cachedResponse;
        }

        const networkResponse = await fetch(request);

        if (networkResponse.ok) {
          staticCache.put(requestUrl.pathname, networkResponse.clone()).catch(() => {});
        }

        return networkResponse;
      }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request).then((networkResponse) => {
        if (networkResponse.ok) {
          const responseClone = networkResponse.clone();
          openStaticCache().then((staticCache) => {
            staticCache.put(request, responseClone).catch(() => {});
          });
        }

        return networkResponse;
      });
    }),
  );
});
