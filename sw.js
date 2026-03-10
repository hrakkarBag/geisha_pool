/* ─────────────────────────────────────────────
   Billar Club — Service Worker
   Estrategia: Cache First para assets estáticos
   ───────────────────────────────────────────── */

const CACHE_NAME  = 'billar-club-v1';
const CACHE_URLS  = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap'
];

/* ── Install: precachear recursos ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Las Google Fonts pueden fallar en modo offline en la instalación;
      // usamos addAll solo con recursos locales y capturamos el resto.
      return cache.addAll([
        './index.html',
        './manifest.json',
        './icon-192.png',
        './icon-512.png'
      ]).then(() => {
        // Intentar cachear fuentes (no crítico si falla)
        return cache.add('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap')
          .catch(() => {/* sin conexión en instalación, no bloqueamos */});
      });
    }).then(() => self.skipWaiting())
  );
});

/* ── Activate: limpiar cachés viejos ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: Cache First → Network fallback ── */
self.addEventListener('fetch', event => {
  // Solo interceptar GET
  if (event.request.method !== 'GET') return;

  // Ignorar chrome-extension u otros esquemas
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request)
        .then(networkResponse => {
          // Solo cachear respuestas válidas
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type !== 'opaque'  // evitar cachear respuestas CORS opacas
          ) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline y no en caché: devolver index.html como fallback
          if (event.request.destination === 'document') {
            return caches.match('./index.html');
          }
        });
    })
  );
});

/* ── Mensaje: forzar actualización desde cliente ── */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
