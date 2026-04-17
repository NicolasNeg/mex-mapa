// ═══════════════════════════════════════════════════════════
//  MEX MAPA — Service Worker
//  Estrategia: Cache-first para assets estáticos,
//              Network-first para Firestore/API calls.
// ═══════════════════════════════════════════════════════════

const CACHE_NAME = 'mapa-v106';

// Recursos que se cachean en la instalación (shell de la app)
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/mapa.html',
  '/programador.html',
  '/mex-api.js',
  // Módulos API (Fase 1.1)
  '/api/auth.js',
  '/api/mapa.js',
  '/api/cuadre.js',
  '/api/flota.js',
  '/api/alertas.js',
  '/api/notas.js',
  '/api/historial.js',
  '/api/settings.js',
  '/api/users.js',
  '/api/_assemble.js',
  '/config.js',
  '/js/core/app-bootstrap.js',
  '/manifest.json',
  '/img/logo.png',
  '/img/no-model.svg',
  // Módulos JS (nueva arquitectura)
  '/js/core/firebase-init.js',
  '/js/core/database.js',
  '/js/core/notifications.js',
  '/js/core/observability.js',
  '/js/views/login.js',
  '/js/views/mapa.js',
  '/js/views/programador.js',
  '/js/views/gestion.js',
  '/js/views/cuadre.js',
  '/gestion.html',
  '/cuadre.html',
  '/mensajes.html',
  '/js/views/mensajes.js',
  // CSS global
  '/css/global.css',
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

  // Nunca interceptar scripts de Service Worker: evita que quede un SW viejo
  // de FCM en cache y rompa el registro en movil.
  if (sameOrigin && (url.pathname === '/sw.js' || url.pathname === '/firebase-messaging-sw.js')) {
    return;
  }

  // Siempre ir a la red para Firebase (Firestore, Auth, FCM)
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('google.com') ||
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
          if (isDocumentRequest) {
            return (await caches.match('/index.html')) || Response.error();
          }
          return Response.error();
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
            return caches.match('/index.html').then(match => match || Response.error());
          }
          return Response.error();
        });
    })
  );
});

// ── Push Notifications (preparado para FCM) ─────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: 'Nueva notificacion', body: event.data.text() }; }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Nueva notificacion', {
      body: payload.body || '',
      icon: payload.icon || '/img/logo.png',
      badge: '/img/logo.png',
      tag: payload.tag || 'mex-notif',
      data: payload.data || {},
      vibrate: [200, 100, 200]
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = (() => {
    try {
      return new URL(event.notification?.data?.url || '/', self.location.origin).toString();
    } catch {
      return new URL('/', self.location.origin).toString();
    }
  })();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) {
        const first = list[0];
        if (typeof first.navigate === 'function') {
          return first.navigate(targetUrl).then(() => first.focus()).catch(() => first.focus());
        }
        return first.focus();
      }
      return clients.openWindow(targetUrl);
    })
  );
});
