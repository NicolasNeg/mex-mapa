// ═══════════════════════════════════════════════════════════
//  MEX MAPA — Service Worker
//  Estrategia: Cache-first para assets estáticos,
//              Network-first para Firestore/API calls.
// ═══════════════════════════════════════════════════════════

const CACHE_NAME = 'mapa-v583';

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
  // Nota: NO cachear '/' — hosting lo redirige (302 → /app) y cache.add seguiría
  // el redirect, guardando una Response 'redirected' que rompe la navegación
  // ("a redirected response was used…" → ERR_FAILED). La raíz se resuelve en runtime.
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
  '/api/traslados.js',
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
  '/js/core/feature-gates.js',
  '/js/core/notifications.js',
  '/js/core/observability.js',
  '/js/core/error-tracking.js',
  '/js/core/pwa-install.js',
  '/js/layouts/app-shell.js',
  '/js/features/cuadre/pdf-reservas.js',
  '/js/features/cuadre/prediccion.js',
  // Módulos extraídos Fase 4
  '/mapa/features/core/utils.js',
  '/mapa/features/extras/supervision.js',
  '/mapa/features/extras/ocr.js',
  // Mapa modular — especializado arrendadora
  '/mapa/mapa-loader.js',
  '/mapa/mapa-store.js',
  // Vistas legacy
  '/js/views/login.js',
  '/js/views/mapa.js',
  '/js/views/mapa-buscador.js',
  '/js/views/gestion.js',
  '/gestion.html',
  '/mensajes.html',
  '/js/views/mensajes.js',
  '/profile.html',
  '/editmap.html',
  '/css/profile.css',
  '/css/editmap.css',
  '/css/app-editmap-chrome.css',
  '/css/app-admin-chrome.css',
  '/js/views/profile.js',
  '/js/views/editmap.js',
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
  '/css/mapa-fluid.css',
  '/js/mapa-fluid.js',
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
  '/js/app/views/traslados.js',
  '/css/app-traslados.css',
  '/js/app/views/cuadrarflota.js',
  '/css/app-cuadrarflota.css',
  '/js/app/views/incidencias.js',
  '/js/app/features/incidencias/incidencias-data.js',
  '/js/app/features/cuadre/cuadre-data.js',
  '/js/app/features/admin/admin-users-data.js',
  '/js/app/features/admin/admin-catalogs-data.js',
  '/js/app/features/admin/admin-permissions.js',
  '/js/app/features/admin/admin-requests-data.js',
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
  '/js/core/estado-bridge.js',
  '/domain/unidad.model.js',
  '/domain/mapa.model.js',
  '/domain/permissions.model.js',
  '/domain/traslado.model.js',
  '/js/app/features/mapa/mapa-dnd.js',
  '/js/app/features/mapa/mapa-mutations.js',
  '/js/app/features/mapa/mapa-incidencias-summary.js',
  '/js/app/features/mapa/mapa-unit-actions.js',
  '/js/app/features/mapa/mapa-unit-history.js',
  '/js/app/features/mapa/mapa-unit-quick-incident.js',
  '/js/app/features/mapa/mapa-official-tools.js',
  '/js/app/features/mapa/mapa-visual-editor.js',
  '/js/app/features/mapa/editor-session.js',
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
  '/js/programador/views/logs.js',
  '/js/programador/views/errores.js',
  '/js/programador/views/deploy.js',
  '/js/app/views/historial-operativo.js',
  '/css/app-historial-operativo.css',
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

// ── Helpers de estrategia ────────────────────────────────────
function _cacheAndReturn(request, response) {
  if (response && response.status === 200 && response.type !== 'opaque') {
    const toCache = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(request, toCache));
  }
  return response;
}

// Una navegación (redirect mode "manual") no acepta una Response con
// redirected=true → reconstruimos una Response limpia con el mismo body.
async function _stripRedirect(response) {
  if (!response || !response.redirected) return response;
  const body = await response.blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

function _documentFallbackCandidates(pathname = "/") {
  let cleanPath = String(pathname || "/");
  while (cleanPath.length > 1 && cleanPath.endsWith("/")) cleanPath = cleanPath.slice(0, -1);
  if (!cleanPath) cleanPath = "/";
  const legacyDocs = {
    "/": "/index.html",
    "/login": "/login.html",
    "/mapa": "/mapa.html",
    "/programador": "/programador.html",
    "/home": "/home.html",
    "/gestion": "/gestion.html",
    "/mensajes": "/mensajes.html",
    "/profile": "/profile.html",
    "/cola-preparacion": "/cola-preparacion.html",
    "/editmap": "/editmap.html",
    "/incidencias": "/incidencias.html",
    "/cuadre": "/cuadre.html",
    "/contrato-publico": "/contrato-publico.html"
  };
  const first = cleanPath === "/app" || cleanPath.startsWith("/app/")
    ? "/app.html"
    : (legacyDocs[cleanPath] || (cleanPath.endsWith(".html") ? cleanPath : "/index.html"));
  return Array.from(new Set([first, "/app.html", "/index.html", "/404.html"]));
}

async function _documentFallbackResponse(request, url) {
  // _stripRedirect: una Response 'redirected' cacheada no puede devolverse a una
  // navegación (redirect mode "manual") sin romperla → la reconstruimos limpia.
  const cachedExact = await caches.match(request);
  if (cachedExact) return _stripRedirect(cachedExact);

  for (const candidate of _documentFallbackCandidates(url.pathname)) {
    const cached = await caches.match(candidate);
    if (cached) return _stripRedirect(cached);
  }

  return new Response(
    `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexion</title><body style="font-family:system-ui,sans-serif;padding:24px;background:#07111f;color:#f8fafc"><h1>No se pudo cargar la app</h1><p>Revisa tu conexion e intenta recargar.</p></body></html>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

// Nunca devolver Response.error(): Chrome lo reporta como
// "FetchEvent ... resolved with an error response object" y rompe la carga
// (iframes del shell, navegaciones flaky). Preferir 503 vacío o offline HTML.
function _offlineResponse(request) {
  const dest = request.destination;
  if (dest === 'script' || (request.url && request.url.endsWith('.js'))) {
    return new Response('/* offline */', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  if (dest === 'style' || (request.url && request.url.endsWith('.css'))) {
    return new Response('/* offline */', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  return new Response('', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Cache-Control': 'no-store' }
  });
}

function _isFirebaseOrGoogleRequest(url) {
  const host = url.hostname;
  // Passthrough total: un respondWith aquí rompe WebChannel/Listen de Firestore.
  return (
    host === 'firestore.googleapis.com' ||
    host.endsWith('.googleapis.com') ||
    host.endsWith('.google.com') ||
    host.endsWith('.gstatic.com') ||
    host.endsWith('.firebaseio.com') ||
    host.endsWith('.firebasestorage.app') ||
    host.endsWith('.firebaseapp.com') ||
    host.endsWith('.cloudfunctions.net') ||
    host.includes('fonts.google')
  );
}

function _isDocumentLikeRequest(request, url, dest) {
  if (request.mode === 'navigate') return true;
  // Chrome marca iframes del shell (legacy-stage) como destination "iframe".
  if (dest === 'document' || dest === 'iframe') return true;
  if (request.method !== 'GET') return false;
  if (url.origin !== self.location.origin) return false;
  const accept = request.headers.get('accept') || '';
  if (accept.includes('text/html')) return true;
  const path = url.pathname;
  if (path === '/app' || path.startsWith('/app/')) return true;
  if (/\.html?$/i.test(path)) return true;
  // Clean URLs sin extensión ( /mapa, /cuadre, … ) — no son assets estáticos.
  if (path.length > 1 && !/\.[a-z0-9]+$/i.test(path)) return true;
  return false;
}

// ── Fetch: estrategia por tipo de recurso ───────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const dest = event.request.destination;
  const isDocumentRequest = _isDocumentLikeRequest(event.request, url, dest);
  const isStaticAsset = sameOrigin && (dest === 'script' || dest === 'style');

  // Nunca interceptar scripts de Service Worker
  if (sameOrigin && (url.pathname === '/sw.js' || url.pathname === '/firebase-messaging-sw.js')) {
    return;
  }

  // Siempre ir a la red para Firebase (Firestore, Auth, FCM) y no-GET.
  // Importante: no llamar respondWith — el SW no debe tocar WebChannel.
  if (_isFirebaseOrGoogleRequest(url) || event.request.method !== 'GET') {
    return;
  }

  // Documentos HTML → network-first con fallback al shell cacheado
  if (isDocumentRequest) {
    event.respondWith(
      fetch(event.request)
        .then(async r => {
          // Navegación con redirect del servidor (p.ej. / → /app 302): fetch la
          // devuelve como 'opaqueredirect'. Hay que devolverla tal cual para que
          // el navegador siga el redirect (no es error).
          if (r && r.type === 'opaqueredirect') return r;
          return (r && r.ok)
            ? _cacheAndReturn(event.request, await _stripRedirect(r))
            : _documentFallbackResponse(event.request, url);
        })
        .catch(() => _documentFallbackResponse(event.request, url))
    );
    return;
  }

  // JS y CSS → stale-while-revalidate: respuesta inmediata desde cache,
  // actualización en background. Esto elimina el bloqueo de red en navegaciones repetidas.
  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const networkFetch = fetch(event.request)
          .then(r => _cacheAndReturn(event.request, r))
          .catch(() => null);

        // Si tenemos cache → responder inmediato y actualizar en fondo
        if (cached) {
          event.waitUntil(networkFetch);
          return cached;
        }
        // Sin cache → esperar la red; nunca Response.error() (ruido en consola + rotura)
        return networkFetch.then(r => r || _offlineResponse(event.request));
      })
    );
    return;
  }

  // Resto (imágenes, fuentes propias, manifests) → cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request)
        .then(r => _cacheAndReturn(event.request, r))
        .catch(() => _offlineResponse(event.request));
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
