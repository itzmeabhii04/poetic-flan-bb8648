/* PG CA Manager — service worker (stale-while-revalidate) */
const VERSION = 'pgca-v2.0.0';
const CACHE = VERSION;
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png',
  '/icons/shortcut-room.png',
  '/icons/shortcut-ca.png',
  '/icons/shortcut-meter.png',
  'https://cdn.tailwindcss.com/3.4.16',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/webfonts/fa-brands-400.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/webfonts/fa-regular-400.woff2',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
];

// Cache each asset individually so one flaky CDN never breaks installation.
async function precache() {
  const cache = await caches.open(CACHE);
  await Promise.all(PRECACHE.map(async (url) => {
    try {
      const cross = !url.startsWith('/');
      let res;
      if (!cross) res = await fetch(new Request(url, { cache: 'reload' }));
      else {
        // Some CDNs (e.g. Tailwind Play) send no CORS headers — fall back to an opaque copy,
        // which <script>/<link> tags without crossorigin can still use offline.
        try { res = await fetch(new Request(url, { mode: 'cors', credentials: 'omit' })); }
        catch (_) { res = await fetch(new Request(url, { mode: 'no-cors' })); }
      }
      if (res.ok || res.type === 'opaque') await cache.put(url, res);
    } catch (_) { /* offline during install — runtime caching fills it later */ }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function cacheable(req) {
  if (req.method !== 'GET') return false;
  const u = new URL(req.url);
  return u.protocol.startsWith('http');
}

async function staleWhileRevalidate(event, cacheKey) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(cacheKey, { ignoreSearch: event.request.mode === 'navigate' });
  const network = (async () => {
    const preload = event.request.mode === 'navigate' ? await event.preloadResponse : null;
    const res = preload || await fetch(event.request);
    if (res && (res.ok || res.type === 'opaque')) await cache.put(cacheKey, res.clone());
    return res;
  })();
  event.waitUntil(network.catch(() => {}));
  if (cached) return cached;
  try { return await network; }
  catch (_) {
    if (event.request.mode === 'navigate') return (await cache.match('/')) || Response.error();
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!cacheable(req)) return;
  // All in-scope navigations (/, /?tab=ca, /?action=add_room …) share the app shell.
  const key = req.mode === 'navigate' ? '/' : req;
  event.respondWith(staleWhileRevalidate(event, key));
});

// Background sync: refresh the app shell & CDN assets once connectivity returns.
self.addEventListener('sync', (event) => {
  if (event.tag === 'pgca-sync' || event.tag === 'pgca-refresh') event.waitUntil(precache());
});
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'pgca-refresh') event.waitUntil(precache());
});
