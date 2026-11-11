// Service worker (PROJECT.md Phase 6): makes the app shell open fast and offline.
// Rules:
//   * Static files only, stale-while-revalidate.
//   * NEVER touches /api/* — D1 stays the source of truth; offline data comes
//     from IndexedDB in app.js, not from this cache.
//   * Non-GET requests pass straight through.
// Bump VERSION whenever app.js / style.css / HTML change shape.
const VERSION = 'v2';
const CACHE = `cbse-tutor-${VERSION}`;
const SHELL = ['/', '/parent', '/child', '/chapter', '/app.js', '/style.css', '/books.json'];
const CDN_HOSTS = ['cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'unpkg.com'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('cbse-tutor-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && url.pathname.startsWith('/api/')) return;
  if (!sameOrigin && !CDN_HOSTS.includes(url.hostname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Pages like /chapter?id=… share one cached shell.
    const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    const network = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
      return res;
    });
    if (cached) {
      event.waitUntil(network.catch(() => {}));
      return cached;
    }
    try {
      return await network;
    } catch (e) {
      if (req.mode === 'navigate') {
        const shell = await cache.match(url.pathname, { ignoreSearch: true }) || await cache.match('/');
        if (shell) return shell;
      }
      throw e;
    }
  })());
});
