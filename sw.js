// Service Worker: App offline verfügbar machen, große Bibliotheken dauerhaft cachen
const SHELL_CACHE = 'scan-shell-v1';
const LIB_CACHE = 'scan-libs-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
const LIB_HOSTS = /^https:\/\/(docs\.opencv\.org|cdn\.jsdelivr\.net)\//;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== LIB_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Versionierte Bibliotheken (OpenCV, Tesseract, jsPDF, Sprachdaten): einmal laden, dann aus dem Cache
  if (LIB_HOSTS.test(req.url)) {
    e.respondWith(caches.open(LIB_CACHE).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // Eigene Dateien: zuerst Netz (für Updates), offline aus dem Cache
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(SHELL_CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html')))
    );
  }
});
