// ═══════════════════════════════════════════════════════════
//  MEX MAPA — Service Worker
//  Estrategia: Cache-first para assets estáticos,
//              Network-first para Firestore/API calls.
// ═══════════════════════════════════════════════════════════

const CACHE_NAME = 'mapa-v207';

// Exponer versión a la página para que error-tracking.js la use como release
self.addEventListener('message', event => {
  if (event.data?.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: CACHE_NAME });
  }
});

// ── Assets críticos ──────────────────────────────────────────
// Si alguno falla → instalación falla (comportamiento esperado:
// el SW no se activa con assets rotos).
const CRITICAL_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/mapa.html',
  '/programador.html',
  '/mex-api.js',
  // Módulos API
  '/api/helpers.js',
  '/api/auth.js',
  '/api/mapa.js',
  '/api/cuadre.js',
  '/api/externos.js',
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
  // Core JS
  '/js/core/firebase-init.js',
  '/js/core/database.js',
  '/js/core/notifications.js',
  '/js/core/observability.js',
  '/js/core/error-tracking.js',
  '/js/core/pwa-install.js',
  '/js/layouts/app-shell.js',
  '/js/features/cuadre/pdf-reservas.js',
  '/js/features/cuadre/prediccion.js',
  // Vistas legacy
  '/js/views/login.js',
  '/js/views/mapa.js',
  '/js/views/programador.js',
  '/js/views/gestion.js',
  '/gestion.html',
  '/mensajes.html',
  '/js/views/mensajes.js',
  '/profile.html',
  '/editmap.html',
  '/css/profile.css',
  '/css/editmap.css',
  '/js/views/profile.js',
  '/js/views/editmap.js',
  '/solicitud.html',
  '/404.html',
  '/incidencias.html',
  '/js/views/incidencias.js',
  // CSS
  '/css/global.css',
  '/css/base.css',
  '/css/mapa.css',
  '/css/alertas.css',
  '/css/config.css',
  '/css/mensajes.css',
  '/css/notificaciones.css',
  '/css/programador.css',
  '/css/incidencias.css',
  '/css/cola-preparacion.css',
  '/cola-preparacion.html',
  '/js/views/cola-preparacion.js',
  '/cuadre.html',
  '/js/views/cuadre.js',
  // Shell global (Fase 1)
  '/css/shell.css',
  '/js/shell/navigation.config.js',
  '/js/shell/sidebar.js',
  '/js/shell/header.js',
  '/js/shell/shell-layout.js',
  // App Shell core (Fase 2–3) — crítico: sin estos el shell no arranca
  '/app.html',
  '/js/app/main.js',
  '/js/app/app-state.js',
  '/js/app/router.js',
];

// ── Assets opcionales ────────────────────────────────────────
// Fallos se loggean pero NO bloquean la instalación.
// Aquí van los módulos de vistas del App Shell que pueden
// añadirse en cualquier fase sin riesgo de romper el install.
const OPTIONAL_ASSETS = [
  '/js/app/views/dashboard.js',
  '/js/app/views/profile.js',
  '/js/app/views/mensajes.js',
  '/js/app/views/cola-preparacion.js',
  '/js/app/views/incidencias.js',
  '/js/app/views/cuadre.js',
  '/js/app/views/admin.js',
  '/js/app/views/programador.js',
  // Fuentes de Google — se cachean en runtime la primera vez
];

// ── Instalación ──────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // 1. Cachear assets críticos — fallo aquí aborta la instalación
      await cache.addAll(CRITICAL_ASSETS);

      // 2. Cachear assets opcionales — fallo se loggea, no aborta
      await Promise.allSettled(
        OPTIONAL_ASSETS.map(url =>
          cache.add(url).catch(err => {
            console.warn('[sw] Asset opcional no cacheado:', url, err?.message || err);
          })
        )
      );

      return self.skipWaiting();
    })
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

  // Nunca interceptar scripts de Service Worker
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
    return;
  }

  // Para el shell principal: network-first para no quedar atrapados con versión vieja
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
          if (!response || response.status !== 200 || response.type === 'opaque') {
            return response;
          }
          const toCache = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache));
          return response;
        })
        .catch(() => {
          if (event.request.destination === 'document') {
            return caches.match('/index.html').then(match => match || Response.error());
          }
          return Response.error();
        });
    })
  );
});

// ── Push Notifications ──────────────────────────────────────
self.addEventListener('push', () => { });

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
