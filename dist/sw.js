const VERSION = 'wahfat-pos-v1-20261020';
const SHELL = `${VERSION}-shell`;
const IMAGES = `${VERSION}-images`;
const FILES = ['./', './index.html', './app.js', './pos-core.js', './styles.css',
  './pwa.js', './manifest.webmanifest', './data/catalog.json',
  './icons/icon-192.png', './icons/icon-512.png'];
const ownUrl = path => new URL(path, self.registration.scope).href;
const paths = new Set(FILES.map(path => new URL(ownUrl(path)).pathname));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('wahfat-pos-') && key !== SHELL && key !== IMAGES) {
        await caches.delete(key);
      }
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && paths.has(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      try {
        const response = await fetch(req);
        // Never save an authentication redirect over a known application file.
        if (response.ok && !response.redirected) {
          try { await cache.put(req, response.clone()); } catch { /* Online content still works when storage is full. */ }
        }
        return response;
      } catch {
        const cached = await cache.match(req, {ignoreSearch: true});
        return cached || new Response('暫時無法載入，請連線後重試。', {status:503});
      }
    })());
  } else if (req.destination === 'image' &&
    ['whafat-hk.com', 'cdn.shopify.com'].includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(IMAGES);
      const cached = await cache.match(req);
      if (cached) return cached;
      const response = await fetch(req);
      if (response.ok || response.type === 'opaque') {
        try {
          const keys = await cache.keys();
          for (const key of keys.slice(0, Math.max(0, keys.length - 79))) {
            await cache.delete(key);
          }
          await cache.put(req, response.clone());
        } catch { /* Failed caching must not hide an available image. */ }
      }
      return response;
    })());
  }
});
