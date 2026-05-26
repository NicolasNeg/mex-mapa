// ═══════════════════════════════════════════════════════════
//  MEX MAPA — Service Worker
//  Estrategia: Cache-first para assets estáticos,
//              Network-first para Firestore/API calls.
// ═══════════════════════════════════════════════════════════

const CACHE_NAME = 'mapa-v385';

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
  '/js/core/firebase-config.js',
  '/js/core/app-bootstrap.js',
  '/manifest.json',
  '/img/logo.png',
  '/img/no-model.svg',
  // Core JS
  '/js/core/firebase-init.js',
  '/js/core/database.js',
  '/js/core/dialogs.js',
  '/js/core/empresa-context.js',
  '/js/core/feature-gates.js',
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
  '/css/dialogs.css',
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
  '/js/views/legacy-shell-bridge.js',
  // Shell global (Fase 1)
  '/css/shell.css',
  '/js/shell/navigation.config.js',
  '/js/shell/sidebar.js',
  '/js/shell/header.js',
  '/js/shell/shell-layout.js',
  // App Shell core (Fase 2–3) — crítico: sin estos el shell no arranca
  '/app.html',
  '/js/app/main.js',
  '/js/app/app-cache.js',
  '/js/app/app-state.js',
  '/js/app/router.js',
  '/js/app/route-resolver.js',
  '/contrato-publico.html',
];

// ── Assets opcionales ────────────────────────────────────────
// Fallos se loggean pero NO bloquean la instalación.
// Aquí van los módulos de vistas del App Shell que pueden
// añadirse en cualquier fase sin riesgo de romper el install.
const OPTIONAL_ASSETS = [
  '/js/app/views/mapa.js',
  '/js/app/views/dashboard.js',
  '/css/app-dashboard.css',
  '/css/app-profile.css',
  '/css/app-mensajes.css',
  '/css/app-incidencias.css',
  '/css/app-alertas.css',
  '/css/alertas.css',
  '/css/cola-preparacion.css',
  '/js/app/views/profile.js',
  '/js/app/views/alertas.js',
  '/js/app/views/mensajes.js',
  '/js/app/features/mensajes/mensajes-data.js',
  '/js/app/features/mensajes/mensajes-attachments.js',
  '/js/app/features/mensajes/mensajes-renderer.js',
  '/js/app/views/cola-preparacion.js',
  '/js/app/views/incidencias.js',
  '/js/app/features/incidencias/incidencias-data.js',
  '/js/app/views/cuadre.js',
  '/js/app/features/cuadre/cuadre-data.js',
  '/js/app/features/admin/admin-users-data.js',
  '/js/app/features/admin/admin-catalogs-data.js',
  '/js/app/features/admin/admin-permissions.js',
  '/js/app/features/admin/admin-requests-data.js',
  '/css/app-cuadre.css',
  '/js/app/views/admin.js',
  '/css/app-admin.css',
  '/js/app/views/programador.js',
  '/js/app/views/legacy-stage.js',
  '/css/app-legacy-stage.css',
  '/js/app/features/notifications/notifications-summary.js',
  '/js/app/features/notifications/notification-center.js',
  '/css/app-notifications.css',
  '/js/app/features/mapa/mapa-data.js',
  '/js/app/features/mapa/mapa-lifecycle.js',
  '/js/app/features/mapa/mapa-renderer.js',
  '/js/app/features/mapa/mapa-view-model.js',
  '/domain/estado.model.js',
  '/domain/unidad.model.js',
  '/domain/mapa.model.js',
  '/domain/permissions.model.js',
  '/js/app/features/mapa/mapa-dnd.js',
  '/js/app/features/mapa/mapa-mutations.js',
  '/js/app/features/mapa/mapa-incidencias-summary.js',
  '/js/app/features/mapa/mapa-unit-actions.js',
  '/js/app/features/mapa/mapa-unit-history.js',
  '/js/app/features/mapa/mapa-unit-quick-incident.js',
  '/js/app/features/mapa/mapa-official-tools.js',
  '/js/app/features/mapa/mapa-visual-editor.js',
  '/js/app/features/mapa/mapEditorViewConfig.js',
  '/js/app/features/mapa/mapViewVisibility.js',
  '/css/app-mapa.css',
  '/js/app/features/turnos/turnos-data.js',
  '/js/app/features/turnos/horarios-data.js',
  '/js/app/views/turnos.js',
  '/css/app-turnos.css',
  '/js/app/views/onboarding.js',
  '/js/app/features/onboarding/onboarding-config.js',
  '/js/app/features/onboarding/onboarding-data.js',
  '/js/app/features/unidades/unidades-data.js',
  '/js/app/features/unidades/unidades-lookup.js',
  // Error logger + prog theme
  '/js/core/error-logger.js',
  '/css/prog-panel.css',
  // Panel Programador
  '/js/programador/main.js',
  '/js/programador/shell.js',
  '/js/programador/views/overview.js',
  '/js/programador/views/saas.js',
  '/js/programador/views/empresa-detail.js',
  '/js/programador/views/logs.js',
  '/js/programador/views/errores.js',
  '/js/programador/views/deploy.js',
  '/js/programador/views/contratos.js',
  '/js/programador/views/metricas.js',
  '/js/programador/views/facturacion-global.js',
  // Fuentes de Google — se cachean en runtime la primera vez
];

function warmOptionalAssetsInBackground() {
  caches.open(CACHE_NAME).then(cache => {
    let index = 0;
    const pump = () => {
      const url = OPTIONAL_ASSETS[index++];
      if (!url) return;
      cache.match(url)
        .then(hit => hit || cache.add(url))
        .catch(err => {
          console.warn('[sw] Asset opcional no cacheado:', url, err?.message || err);
        })
        .finally(() => {
          setTimeout(pump, 80);
        });
    };
    setTimeout(pump, 600);
  }).catch(() => { });
}

// ── Instalación ──────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Cachear solo assets críticos aquí; los opcionales se calientan en segundo plano.
      await cache.addAll(CRITICAL_ASSETS);
      warmOptionalAssetsInBackground();
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
      .then(() => warmOptionalAssetsInBackground())
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
