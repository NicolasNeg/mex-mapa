// ═══════════════════════════════════════════════════════════
//  MEX MAPA — Service Worker
//  Estrategia: Cache-first para assets estáticos,
//              Network-first para Firestore/API calls.
// ═══════════════════════════════════════════════════════════

const CACHE_NAME = 'mapa-v12';

// Recursos que se cachean en la instalación (shell de la app)
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/mex-api.js',
  '/config.js',
  '/manifest.json',
  '/img/logo.png',
  '/img/no-model.svg',
  // Fuentes de Google — se cachean en runtime la primera vez que se descargan
];

// ── Instalación: precachear el shell ────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activación: limpiar caches viejos ───────────────────────
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

// ── Fetch: estrategia por tipo de recurso ───────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isDocumentRequest =
    event.request.mode === 'navigate' ||
    event.request.destination === 'document';
  const isAppShellRequest =
    sameOrigin && (
      isDocumentRequest ||
      event.request.destination === 'script' ||
      event.request.destination === 'style' ||
      event.request.destination === 'manifest'
    );

  // Siempre ir a la red para Firebase (Firestore, Auth, FCM)
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('fonts.google') ||
    event.request.method !== 'GET'
  ) {
    return; // deja que el browser lo maneje normalmente
  }

  // Para el shell principal de la app, priorizar la red para no quedar
  // atrapados con una version vieja tras un deploy.
  if (isAppShellRequest) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200 && response.type !== 'opaque') {
            const toCache = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          if (isDocumentRequest) return caches.match('/index.html');
        })
    );
    return;
  }

  // Para assets del propio dominio: Cache-first → si no hay cache, red → cachear
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request)
        .then(response => {
          // Solo cachear respuestas válidas
          if (!response || response.status !== 200 || response.type === 'opaque') {
            return response;
          }
          const toCache = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache));
          return response;
        })
        .catch(() => {
          // Sin red y sin cache — devolver el shell (index.html) para rutas HTML
          if (event.request.destination === 'document') {
            return caches.match('/index.html');
          }
        });
    })
  );
});

// ── Push Notifications (preparado para FCM) ─────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: 'MEX Mapa', body: event.data.text() }; }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'MEX Mapa', {
      body:    payload.body  || '',
      icon:    payload.icon  || '/img/logo.png',
      badge:   '/img/logo.png',
      tag:     payload.tag   || 'mex-notif',
      data:    payload.data  || {},
      vibrate: [200, 100, 200]
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) return list[0].focus();
      return clients.openWindow('/');
    })
  );
});
