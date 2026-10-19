// Mapfold service worker — offline cache. Author: direk james
const VERSION = 'mapfold-v1.4.0';
const CORE = [
  './', 'index.html', 'player.html', 'manifest.webmanifest', 'css/styles.css', 'css/player.css', 'css/fonts.css',
  'js/app.js', 'js/calendar.js', 'js/db.js', 'js/editor.js', 'js/entries.js', 'js/icons.js', 'js/library.js', 'js/nest.js', 'js/parchment.js', 'js/player.js',
  'js/render.js', 'js/store.js', 'js/table.js', 'js/tabletop.js', 'js/terrain.js', 'js/timeline.js', 'js/ui.js', 'js/wiki.js', 'js/zip.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'fonts/alegreya-italic-400-latin-ext.woff2',
  'fonts/alegreya-italic-400-latin.woff2',
  'fonts/alegreya-italic-500-latin-ext.woff2',
  'fonts/alegreya-italic-500-latin.woff2',
  'fonts/alegreya-normal-400-latin-ext.woff2',
  'fonts/alegreya-normal-400-latin.woff2',
  'fonts/alegreya-normal-500-latin-ext.woff2',
  'fonts/alegreya-normal-500-latin.woff2',
  'fonts/alegreya-sans-italic-400-latin-ext.woff2',
  'fonts/alegreya-sans-italic-400-latin.woff2',
  'fonts/alegreya-sans-normal-400-latin-ext.woff2',
  'fonts/alegreya-sans-normal-400-latin.woff2',
  'fonts/alegreya-sans-normal-500-latin-ext.woff2',
  'fonts/alegreya-sans-normal-500-latin.woff2',
  'fonts/alegreya-sans-normal-700-latin-ext.woff2',
  'fonts/alegreya-sans-normal-700-latin.woff2',
  'fonts/cinzel-normal-500-latin-ext.woff2',
  'fonts/cinzel-normal-500-latin.woff2',
  'fonts/cinzel-normal-600-latin-ext.woff2',
  'fonts/cinzel-normal-600-latin.woff2',
  'fonts/cinzel-normal-700-latin-ext.woff2',
  'fonts/cinzel-normal-700-latin.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // App files: network first so updates arrive, cache when offline.
  e.respondWith(fetch(req).then(res => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
    }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
