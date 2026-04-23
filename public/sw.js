/* Sequence Online — minimal offline shell for PWA install */
const CACHE = 'sequence-pwa-v1';
/* HTML/JS/CSS는 브라우저가 ?v= 포함 URL로 요청하므로 설치 시점엔 manifest·아이콘만 선캐시 */
const PRECACHE = ['/manifest.json', '/icons/pwa-icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/socket.io')) return;
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;
  const isAppShell =
    path === '/' ||
    path === '/index.html' ||
    path.endsWith('.css') ||
    path.endsWith('.js') ||
    path === '/manifest.json' ||
    path.startsWith('/icons/');

  if (!isAppShell) return;

  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        if (res.ok) {
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('/index.html'))),
  );
});
