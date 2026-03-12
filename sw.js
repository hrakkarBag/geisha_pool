/* ─────────────────────────────────────────────
   Geisha Bar — Service Worker v10
   Network First para app (index, style, settings)
   Cache First para assets estaticos (icons, fonts)
   ───────────────────────────────────────────── */

const CACHE_NAME   = 'geisha-bar-v10';
const APP_FILES    = ['./index.html', './style.css', './settings.js', './manifest.json'];
const STATIC_FILES = ['./icon-192.png', './icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll([...APP_FILES, ...STATIC_FILES]).catch(() =>
        cache.addAll(STATIC_FILES)
      )
    ).then(() => self.skipWaiting())  // forzar activacion inmediata
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  if(!event.request.url.startsWith('http')) return;
  if(event.request.url.includes('.supabase.co')) return;
  if(event.request.url.includes('ntfy.sh')) return;

  const url = event.request.url;
  const isAppFile = APP_FILES.some(f => url.endsWith(f.replace('./', '/'))) ||
                    url.endsWith('/') || url.endsWith('index.html') ||
                    url.endsWith('style.css') || url.endsWith('settings.js');

  if(isAppFile){
    /* Network First: siempre intenta la red primero para obtener la version mas reciente */
    event.respondWith(
      fetch(event.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        return res;
      }).catch(() => caches.match(event.request))
    );
  } else {
    /* Cache First: icons, fonts, librerias */
    event.respondWith(
      caches.match(event.request).then(cached => {
        if(cached) return cached;
        return fetch(event.request).then(res => {
          if(res && res.status === 200 && res.type !== 'opaque'){
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return res;
        }).catch(() => {
          if(event.request.destination === 'document')
            return caches.match('./index.html');
        });
      })
    );
  }
});

self.addEventListener('message', event => {
  if(event.data === 'SKIP_WAITING') self.skipWaiting();
});
