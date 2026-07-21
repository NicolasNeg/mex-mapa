// ═══════════════════════════════════════════════════════════
//  /js/app/router.js
//  Router cliente para /app/* usando History API.
//
//  Rutas internas (renderizan una vista sin recargar):
//    /app           → redirect a /app/dashboard
//    /app/dashboard → views/dashboard.js
//
//  Todas las demás /app/* → placeholder de ruta no registrada.
//  Rutas fuera de /app/* → window.location.href (navegación real).
//
//  Patrón de vista: cada módulo exporta mount() y unmount().
//  El router llama unmount() en la vista anterior antes de montar.
// ═══════════════════════════════════════════════════════════

import { setState, getState } from '/js/app/app-state.js';

function legacyStage(legacyId, navRoute) {
  return {
    loader: () => import('/js/app/views/legacy-stage.js').then(mod => ({
      mount: ctx => mod.mount({ ...ctx, legacyId }),
      unmount: mod.unmount,
    })),
    navRoute,
  };
}

function _appMapToolRedirect(rawPath = '') {
  const pathOnly = String(rawPath || '').split('?')[0].replace(/\/$/, '') || _defaultHome();
  if (pathOnly !== '/app/mapa') return '';
  const query = String(rawPath || '').includes('?') ? String(rawPath).slice(String(rawPath).indexOf('?')) : '';
  const params = new URLSearchParams(query || '');
  const open = String(params.get('open') || params.get('tool') || '').trim().toLowerCase();
  const tab = String(params.get('tab') || '').trim().toLowerCase();
  if (open === 'alertas' || open === 'crear-alerta' || open === 'emitir-alerta') return '/app/alertas';
  if (open === 'historial-alertas' || open === 'alertas-historial') return '/app/alertas/historial';
  if (tab === 'cuadre' || params.get('openCuadre') || params.get('openCuadreV3')) {
    const next = new URLSearchParams();
    const missionId = String(params.get('missionId') || params.get('cuadreMissionId') || '').trim();
    const plaza = String(params.get('plaza') || params.get('plazaId') || '').trim();
    if (missionId) next.set('missionId', missionId);
    if (plaza) next.set('plaza', plaza);
    next.set('source', 'mapa-cuadre-legacy');
    return `/app/cuadrarflota?${next.toString()}`;
  }
  return '';
}

function _isAuxiliarCuadreRole() {
  const state = getState();
  const role = String(state?.role || state?.profile?.rol || state?.profile?.role || '').toUpperCase().trim();
  return role === 'AUXILIAR';
}

function _cuadreAuxiliarRedirect(rawPath = '') {
  const raw = String(rawPath || '');
  const pathOnly = raw.split('?')[0].replace(/\/$/, '') || _defaultHome();
  if (pathOnly !== '/app/cuadre' || !_isAuxiliarCuadreRole()) return '';
  const search = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
  const params = new URLSearchParams(search || '');
  if (!params.get('source')) params.set('source', 'cuadre-legacy');
  return `/app/cuadrarflota?${params.toString()}`;
}

// ── Tabla de rutas ───────────────────────────────────────────
// loader:    () => Promise<{ mount, unmount }>
// redirect:  string  — alias, redirige sin render
// navRoute:  string  — ruta que se activa en el sidebar (cuando difiere del path)
// feature:   string  — feature gate key; if disabled, shows "not available" screen

function _safeLS(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}

// Rutas válidas que el usuario puede establecer como vista de inicio
const _PREF_ROUTES = new Set([
  '/app/dashboard',
  '/app/mapa',
  '/app/cola-preparacion',
  '/app/incidencias',
  '/app/unidades',
  '/app/mensajes',
  '/app/cuadre',
  "/app/traslados",
  '/app/alertas',
]);

function _defaultHome() {
  // 1. Vista preferida del usuario (perfil Firestore > localStorage)
  const state = getState();
  const prefProfile = state?.profile?.profilePreferences?.vistaPreferida;
  const prefStorage = _safeLS('mex.app.preferredView');
  const pref = String(prefProfile || prefStorage || '').trim();

  if (pref && pref !== 'dashboard' && pref !== '/app/dashboard') {
    const route = pref.startsWith('/app/') ? pref : `/app/${pref}`;
    if (_PREF_ROUTES.has(route)) return route;
  }

  // 2. Feature gate: si dashboard está desactivado → mapa
  if (window.mexFeatures?.puedeUsar('dashboard') === false) return '/app/mapa';

  return '/app/dashboard';
}

const ROUTE_TABLE = {
  '/app':       { redirect: _defaultHome },
  '/app/home':  { redirect: _defaultHome },
  '/app/dashboard':  {
    loader:   () => import('/js/app/views/dashboard.js'),
    navRoute: '/home'
  },
  '/app/perfil':     { redirect: '/app/profile' },
  '/app/profile':    {
    loader:   () => import('/js/app/views/profile.js'),
    navRoute: '/profile'
  },
  '/app/mensajes':         { loader: () => import('/js/app/views/mensajes.js'),         navRoute: '/mensajes',         feature: 'mensajeria' },
  '/app/cola-preparacion': { loader: () => import('/js/app/views/cola-preparacion.js'), navRoute: '/cola-preparacion', feature: 'cola_preparacion' },
  '/app/cola':              { redirect: '/app/cola-preparacion' },
  '/app/incidencias':       {
    loader:   () => import('/js/app/views/incidencias.js'),
    navRoute: '/incidencias',
    feature:  'incidencias'
  },
  '/app/unidades': {
    loader:   () => import('/js/app/views/unidades.js'),
    navRoute: '/app/unidades',
  },
  '/app/cuadre':   legacyStage('cuadre', '/cuadre'),
  '/app/cuadre/u': {
    loader:   () => import('/js/app/views/unidad-expediente.js'),
    navRoute: '/app/unidades',
  },
  '/app/cuadrarflota': {
    loader: () => import('/js/app/views/cuadrarflota.js'),
    navRoute: '/app/cuadrarflota',
    feature: 'cuadre'
  },
  '/app/cuadrarflota/ventas': {
    loader: () => import('/js/app/views/cuadrarflota-ventas.js'),
    navRoute: '/app/cuadrarflota',
  },
  "/app/traslados": { loader: () => import("/js/app/views/traslados.js"), navRoute: "/app/traslados" },
  '/app/admin': {
    loader:   () => import('/js/app/views/admin-shell.js'),
    navRoute: '/app/admin',
  },
  '/app/gestion':           { redirect: '/app/admin/invitaciones' },
  '/app/usuarios':          { redirect: '/app/admin/usuarios' },
  '/app/gestion/usuarios':  { redirect: '/app/admin/usuarios' },
  '/app/gestion/choferes':  { redirect: '/app/admin/usuarios' },
  '/app/gestion/roles':     { redirect: '/app/admin/roles' },
  '/app/gestion/plazas':    { redirect: '/app/admin/plazas' },
  '/app/gestion/catalogos': { redirect: '/app/admin/catalogos' },
  '/app/alertas':          {
    loader:   () => import('/js/app/views/alertas.js'),
    navRoute: '/app/alertas',
    feature:  'alertas'
  },
  '/app/alertas/historial': {
    loader:   () => import('/js/app/views/alertas.js'),
    navRoute: '/app/alertas/historial',
    feature:  'alertas'
  },
  '/app/historial-alertas': { redirect: '/app/alertas/historial' },
  '/app/gestion/solicitudes': { redirect: '/app/admin/invitaciones' },
  '/app/admin/solicitudes': { redirect: '/app/admin/invitaciones' },
  '/app/gestion/estados':   { redirect: '/app/admin/estados' },
  '/app/gestion/categorias': { redirect: '/app/admin/categorias' },
  '/app/gestion/modelos':   { redirect: '/app/admin/modelos' },
  '/app/gestion/gasolinas': { redirect: '/app/admin/gasolinas' },
  '/app/gestion/ubicaciones': { redirect: '/app/admin/ubicaciones' },
  '/app/gestion/empresa':   { redirect: '/app/admin/empresa' },
  '/app/programador': { loader: () => import('/js/app/views/programador.js'), navRoute: '/programador' },
  '/app/mapa':        { loader: () => import('/js/app/views/mapa.js'),        navRoute: '/mapa' },
  '/app/editmap': {
    loader:   () => import('/js/app/views/editmap.js'),
    navRoute: '/editmap',
    feature:  'edicion_mapa'
  },
  '/app/mapa/editor': { redirect: '/app/editmap' },
  '/app/onboarding': {
    loader: () => import('/js/app/views/onboarding.js'),
    navRoute: '/home'
  },
  '/app/turnos': {
    loader:   () => import('/js/app/views/turnos.js'),
    navRoute: '/app/turnos',
    // Gate por permiso (mexPerms.view_turnos); feature-gates de empresa siempre on en single-tenant.
    permission: 'view_turnos',
  },
  '/app/historial-operativo': {
    loader:   () => import('/js/app/views/historial-operativo.js'),
    navRoute: '/app/historial-operativo',
    feature:  'historial_logs',
  },
  '/app/papeletas': {
    loader: () => import('/js/app/views/papeletas.js'),
    navRoute: '/app/papeletas',
    feature: 'papeletas',
    permission: 'view_papeletas',
  },
  '/app/papeletas/ventas': {
    loader: () => import('/js/app/views/papeletas.js'),
    navRoute: '/app/papeletas',
    feature: 'papeletas',
    permission: 'view_papeletas',
  },
  // Detail: /app/papeletas/p/:uid — resolved via _routeForPath prefix match
};

const ROUTE_STYLES = {
  "/app/dashboard": [{ href: "/css/app-dashboard.css", attr: "data-app-dashboard-css" }],
  "/app/profile": [
    { href: "/css/app-profile.css", attr: "data-app-profile-css" },
    { href: "/css/profile.css", attr: "data-profile-css" },
  ],
  "/app/mensajes": [{ href: "/css/app-mensajes.css", attr: "data-app-mensajes-css" }],
  "/app/cola-preparacion": [{ href: "/css/cola-preparacion.css", attr: "data-cola-css" }],
  "/app/incidencias": [{ href: "/css/app-incidencias.css", attr: "data-app-incidencias-css" }],
  "/app/unidades": [{ href: "/css/app-unidades.css?v=20260715f", attr: "data-app-unidades-css" }],
  "/app/cuadre/u": [
    { href: "/css/app-unidades.css?v=20260715f", attr: "data-app-unidades-css" },
    { href: "/css/app-unidad-expediente.css?v=20260718a", attr: "data-app-unidad-exp-css" }
  ],
  "/app/mapa": [
    { href: "/css/mapa.css", attr: "data-lmapa-css" },
    { href: "/css/alertas.css", attr: "data-lmapa-alertas-css" },
    { href: "/css/app-registros-movimientos.css", attr: "data-lmapa-rm-css" },
  ],
  "/app/cuadre": [
    { href: "/css/app-legacy-stage.css", attr: "data-app-legacy-stage-css" },
    { href: "/css/app-registros-movimientos.css", attr: "data-lmapa-rm-css" },
  ],
  "/app/cuadrarflota": [{ href: "/css/app-cuadrarflota.css?v=20260715cf", attr: "data-app-cuadrarflota-css" }],
  "/app/cuadrarflota/ventas": [{ href: "/css/app-cuadrarflota.css?v=20260715cf", attr: "data-app-cuadrarflota-css" }],
  "/app/traslados": [{ href: "/css/app-traslados.css", attr: "data-app-traslados-css" }],
  "/app/admin": [{ href: "/css/app-admin.css?v=20260720a", attr: "data-app-admin-spa-css" }],
  "/app/gestion": [{ href: "/css/app-gestion.css", id: "app-gestion-css" }],
  "/app/alertas": [
    { href: "/css/alertas.css", attr: "data-app-alertas-legacy-css" },
    { href: "/css/app-alertas.css", attr: "data-app-alertas-css" },
  ],
  "/app/alertas/historial": [
    { href: "/css/alertas.css", attr: "data-app-alertas-legacy-css" },
    { href: "/css/app-alertas.css", attr: "data-app-alertas-css" },
  ],
  "/app/programador": [{ href: "/css/app-legacy-stage.css", attr: "data-app-legacy-stage-css" }],
  "/app/editmap": [{ href: "/css/app-legacy-stage.css", attr: "data-app-legacy-stage-css" }],
  "/app/turnos": [{ href: "/css/app-turnos.css", attr: "data-app-turnos-css" }],
  "/app/historial-operativo": [{ href: "/css/app-historial-operativo.css?v=20260715a", attr: "data-app-historial-operativo-css" }],
  "/app/papeletas": [{ href: "/css/app-papeletas.css?v=20260720d", attr: "data-app-papeletas-css" }],
};

function _sameStylesheetHref(link, href) {
  try { return new URL(link.getAttribute("href") || "", window.location.origin).pathname === href; } catch (_) { return false; }
}

function _ensureStylesheet(meta = {}) {
  if (typeof document === "undefined") return Promise.resolve();
  const href = String(meta.href || "");
  if (!href) return Promise.resolve();
  const existingById = meta.id ? document.getElementById(meta.id) : null;
  const existingByAttr = meta.attr ? Array.from(document.querySelectorAll("link[" + meta.attr + "]")).find(link => _sameStylesheetHref(link, href)) : null;
  const existingByHref = Array.from(document.querySelectorAll("link[rel=\"stylesheet\"]")).find(link => _sameStylesheetHref(link, href));
  const link = existingById || existingByAttr || existingByHref || document.createElement("link");
  if (meta.id && !link.id) link.id = meta.id;
  if (meta.attr) link.setAttribute(meta.attr, "1");
  link.rel = "stylesheet";
  if (!link.href || !_sameStylesheetHref(link, href)) link.href = href;
  link.setAttribute("data-mex-route-css", "1");
  if (!link.parentNode) document.head.appendChild(link);
  if (link.sheet) return Promise.resolve();
  return new Promise(resolve => {
    let settled = false;
    const done = () => { if (settled) return; settled = true; window.clearTimeout(timer); resolve(); };
    const timer = window.setTimeout(done, 1800);
    link.addEventListener("load", done, { once: true });
    link.addEventListener("error", done, { once: true });
  });
}

function _stripRouteSlash(value) {
  const raw = String(value || '');
  return raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function _isAdminAppPath(path) {
  const key = _stripRouteSlash(String(path || '').split('?')[0]);
  return key === '/app/admin' || key.startsWith('/app/admin/');
}

function _routeForPath(path) {
  const key = _stripRouteSlash(String(path || '').split('?')[0]) || '/app/dashboard';
  if (_isAdminAppPath(key)) return ROUTE_TABLE['/app/admin'];
  if (key.startsWith('/app/mensajes/')) return ROUTE_TABLE['/app/mensajes'];
  if (key.startsWith('/app/traslados/') || key === '/app/cuadre/traslados' || key.startsWith('/app/cuadre/traslados/')) return ROUTE_TABLE['/app/traslados'];
  if (key.startsWith('/app/cuadre/u/')) return ROUTE_TABLE['/app/cuadre/u'];
  if (key.startsWith('/app/editmap/')) return ROUTE_TABLE['/app/editmap'];
  if (key.startsWith('/app/papeletas/')) return ROUTE_TABLE['/app/papeletas'];
  return ROUTE_TABLE[key];
}

function _styleKeyForPath(path) {
  const key = _stripRouteSlash(String(path || '').split('?')[0]) || '/app/dashboard';
  if (_isAdminAppPath(key)) return '/app/admin';
  if (key.startsWith('/app/mensajes/')) return '/app/mensajes';
  if (key.startsWith('/app/traslados/') || key === '/app/cuadre/traslados' || key.startsWith('/app/cuadre/traslados/')) return '/app/traslados';
  if (key.startsWith('/app/cuadre/u/')) return '/app/cuadre/u';
  if (key.startsWith('/app/editmap/')) return '/app/editmap';
  if (key.startsWith('/app/papeletas/')) return '/app/papeletas';
  return key;
}

function _ensureRouteStyles(path) {
  const key = _styleKeyForPath(path);
  const styles = ROUTE_STYLES[key] || [];
  return Promise.all(styles.map(_ensureStylesheet));
}
// ── Factory ──────────────────────────────────────────────────
/**
 * @param {{ shell: import('/js/shell/shell-layout.js').ShellLayout }} options
 * @returns {{ navigate: (path: string, opts?: {replace?: boolean}) => void,
 *             isInternalAppRoute: (path: string) => boolean }}
 */
export function createRouter({ shell }) {
  let _currentUnmount = null; // función unmount de la vista activa
  let _renderSeq = 0;

  // ── Predicado ─────────────────────────────────────────────
  function isInternalAppRoute(path) {
    return typeof path === 'string' && path.startsWith('/app');
  }

  /** Pathname sin query ni trailing slash (clave ROUTE_TABLE). */
  function _routePathOnly(rawPath) {
    const raw = String(rawPath || '');
    const cut = raw.indexOf('?');
    const pathname = cut === -1 ? raw : raw.slice(0, cut);
    return pathname.replace(/\/$/, '') || _defaultHome();
  }

  // ── Navegar ───────────────────────────────────────────────
  function navigate(path, { replace = false, soft = false } = {}) {
    const raw = String(path || '');
    const pathOnly = _routePathOnly(raw);
    if (!isInternalAppRoute(pathOnly)) {
      window.location.href = raw;
      return;
    }
    const searchIdx = raw.indexOf('?');
    const urlForBar = searchIdx === -1 ? pathOnly : `${pathOnly}${raw.slice(searchIdx)}`;
    if (replace) {
      history.replaceState({}, '', urlForBar);
    } else {
      history.pushState({}, '', urlForBar);
    }
    // soft: el iframe admin ya pide actualizar la URL; no rematar con remount.
    _renderRoute(raw, { soft });
  }

  // ── Renderizar ruta ───────────────────────────────────────
  async function _renderRoute(rawPath, { soft = false } = {}) {
    const renderSeq = ++_renderSeq;
    const path = _routePathOnly(rawPath);
    const prevPath = _routePathOnly(getState().currentRoute || window.location.pathname);
    const cuadreAuxRedirect = _cuadreAuxiliarRedirect(rawPath);
    if (cuadreAuxRedirect) {
      navigate(cuadreAuxRedirect, { replace: true });
      return;
    }
    const toolRedirect = _appMapToolRedirect(rawPath);
    if (toolRedirect) {
      navigate(toolRedirect, { replace: true });
      return;
    }
    const route = _routeForPath(path);

    // Redirect alias (ej. /app → /app/dashboard o /app/mapa)
    if (route?.redirect) {
      const target = typeof route.redirect === 'function' ? route.redirect() : String(route.redirect);
      const raw = String(rawPath || '');
      const tail = raw.includes('?') && !target.includes('?') ? raw.slice(raw.indexOf('?')) : '';
      navigate(target + tail, { replace: true });
      return;
    }

    const searchIdx = String(rawPath || '').indexOf('?');
    const currentRoute = searchIdx === -1 ? path : `${path}${String(rawPath).slice(searchIdx)}`;

    // Actualizar estado global
    setState({ currentRoute });

    // Sincronizar header y sidebar.
    // navRoute permite resaltar el item operativo cuando la URL vive en /app/*
    // (ej. /app/profile → resalta nav item "/profile")
    let navRoute = route?.navRoute || path || _defaultHome();
    if (navRoute === '/gestion') {
      const tab = new URLSearchParams(searchIdx === -1 ? '' : String(rawPath).slice(searchIdx)).get('tab');
      if (tab) navRoute = `/gestion?tab=${encodeURIComponent(tab)}`;
    }
    // Admin: pasar ruta completa para modo CONTROLES en sidebar global + item activo
    if (_isAdminAppPath(path)) navRoute = path;
    shell.setRoute(navRoute);

    // Cerrar drawer mobile si está abierto
    shell.sidebar?.closeMobileDrawer?.();

    // Admin ↔ admin: soft sync en shell SPA (sin remount).
    const softAdmin =
      _isAdminAppPath(path) &&
      _isAdminAppPath(prevPath) &&
      typeof _currentUnmount === 'function';
    if (softAdmin) {
      try {
        const mod = await import('/js/app/views/admin-shell.js');
        if (renderSeq !== _renderSeq) return;
        if (typeof mod.softSync === 'function' && mod.softSync({
          navigate,
          shell,
          state: { ...getState(), currentRoute: path },
        })) {
          return;
        }
      } catch (err) {
        console.warn('[router] admin softSync falló, remount completo:', err);
      }
    }

    // Unmount vista anterior
    if (typeof _currentUnmount === 'function') {
      try { _currentUnmount(); } catch (_) {}
      _currentUnmount = null;
    }

    const contentEl = shell.contentEl;
    if (!contentEl) return;

    // Onboarding gate — redirect if empresa setup is incomplete
    const empresa = window.MEX_CONFIG?.empresa;
    if (
      empresa &&
      empresa.onboarding_completado === false &&
      path !== '/app/onboarding'
    ) {
      navigate('/app/onboarding', { replace: true });
      return;
    }

    // Feature gate check — block access if empresa has the feature disabled
    if (route?.feature && window.mexFeatures && !window.mexFeatures.puedeUsar(route.feature)) {
      _renderFeatureDisabled(contentEl, route.feature);
      return;
    }

    // Permiso por rol (mexPerms) — p.ej. view_turnos
    if (route?.permission && window.mexPerms?.canDo && !window.mexPerms.canDo(route.permission)) {
      _renderFeatureDisabled(contentEl, route.permission);
      return;
    }

    // Vista registrada
    if (route?.loader) {
      _renderRouteSkeleton(contentEl, path);
      try {
        await _ensureRouteStyles(path);
        if (renderSeq !== _renderSeq) return;
        const mod = await route.loader();
        if (renderSeq !== _renderSeq) return;
        if (typeof mod.mount === "function") {
          const viewUnmount = mod.unmount ?? null;
          const mounted = mod.mount({ container: contentEl, navigate, shell, state: getState() });
          if (mounted && typeof mounted.then === "function") await mounted;
          if (renderSeq !== _renderSeq) {
            try { if (typeof viewUnmount === "function") viewUnmount(); } catch (_) {}
            return;
          }
          _currentUnmount = viewUnmount;
        }
      } catch (err) {
        if (renderSeq !== _renderSeq) return;
        console.error("[router] Error cargando vista:", currentRoute, err);
        _renderError(contentEl, currentRoute, err);
      }
      return;
    }
    // Ruta /app/* sin vista registrada → 404 en-app
    _renderPlaceholder(contentEl);
  }

  function _renderRouteSkeleton(contentEl, path = "") {
    const normalized = String(path || "").split("?")[0];
    const variant = normalized.includes("mensajes")
      ? "mensajes"
      : normalized.includes("mapa")
        ? "mapa"
        : normalized.includes("incidencias")
          ? "incidencias"
          : "generic";

    if (variant === "mensajes") {
      contentEl.innerHTML = [
        "<section class=\"mex-route-skeleton mex-route-skeleton--mensajes\" aria-busy=\"true\" aria-label=\"Cargando mensajes\">",
        "<div class=\"mex-route-skel-panel mex-route-skel-rail\">",
        "<span class=\"mex-skel mex-skel-title\"></span>",
        "<span class=\"mex-skel mex-skel-input\"></span>",
        "<div class=\"mex-route-skel-list\">",
        Array.from({ length: 6 }).map(() => "<div class=\"mex-skel-row\"><span class=\"mex-skel mex-skel-avatar\"></span><span class=\"mex-skel mex-skel-text\"></span></div>").join(""),
        "</div></div>",
        "<div class=\"mex-route-skel-panel mex-route-skel-chat\">",
        "<span class=\"mex-skel mex-skel-title w-40\"></span>",
        "<div class=\"mex-route-skel-bubbles\">",
        "<span class=\"mex-skel mex-skel-bubble w-60\"></span><span class=\"mex-skel mex-skel-bubble is-right w-40\"></span><span class=\"mex-skel mex-skel-bubble w-80\"></span>",
        "</div><span class=\"mex-skel mex-skel-input\"></span></div></section>"
      ].join("");
      return;
    }

    if (variant === "mapa") {
      contentEl.innerHTML = [
        "<section class=\"mex-route-skeleton mex-route-skeleton--mapa\" aria-busy=\"true\" aria-label=\"Cargando mapa\">",
        "<div class=\"mex-route-skel-map\">",
        Array.from({ length: 28 }).map(() => "<span class=\"mex-skel mex-skel-map-cell\"></span>").join(""),
        "</div></section>"
      ].join("");
      return;
    }

    contentEl.innerHTML = [
      "<section class=\"mex-route-skeleton mex-route-skeleton--" + variant + "\" aria-busy=\"true\" aria-label=\"Cargando vista\">",
      "<div class=\"mex-route-skel-head\"><span class=\"mex-skel mex-skel-title\"></span><span class=\"mex-skel mex-skel-text w-40\"></span></div>",
      "<div class=\"mex-route-skel-grid\">",
      Array.from({ length: 6 }).map(() => "<article class=\"mex-route-skel-card\"><span class=\"mex-skel mex-skel-chip\"></span><span class=\"mex-skel mex-skel-text\"></span><span class=\"mex-skel mex-skel-text w-60\"></span></article>").join(""),
      "</div></section>"
    ].join("");
  }
  // ── Feature deshabilitada por el plan ────────────────────
  function _renderFeatureDisabled(contentEl, featureKey) {
    contentEl.innerHTML = `
      <div style="padding:48px 24px;max-width:520px;margin:0 auto;font-family:'Inter',sans-serif;text-align:center;">
        <div style="width:64px;height:64px;border-radius:20px;background:#fefce8;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">
          <span class="material-symbols-outlined" style="font-size:32px;color:#eab308;">lock</span>
        </div>
        <h2 style="font-size:20px;font-weight:800;color:#0f172a;margin:0 0 8px;">Función no disponible</h2>
        <p style="font-size:14px;color:#64748b;margin:0 0 6px;line-height:1.6;">
          Este módulo no está habilitado en el plan actual de tu empresa.
        </p>
        <p style="font-size:12px;color:#94a3b8;margin:0 0 28px;">
          Contacta a tu administrador para activar <strong>${featureKey}</strong>.
        </p>
        <a data-app-route="/app/dashboard" href="/app/dashboard"
           style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:#0f172a;color:#fff;text-decoration:none;font-size:13px;font-weight:600;">
          <span class="material-symbols-outlined" style="font-size:16px;">home</span>
          Ir al Dashboard
        </a>
      </div>
    `;
  }

  // ── Página no encontrada (dentro del App Shell) ───────────
  function _renderPlaceholder(contentEl) {
    contentEl.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:70vh;padding:48px 24px;text-align:center;">
        <div style="width:88px;height:88px;border-radius:24px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.18);display:flex;align-items:center;justify-content:center;margin:0 auto 24px;">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.75;">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </div>
        <h2 style="font-size:20px;font-weight:900;color:#f1f5f9;margin:0 0 10px;letter-spacing:-0.2px;">No encontramos esta página</h2>
        <p style="font-size:14px;color:#64748b;margin:0 0 32px;line-height:1.75;max-width:320px;">
          Puede que el enlace haya caducado o la dirección tenga un error.<br>
          Si el problema persiste, avísale a tu administrador.
        </p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
          <a data-app-route="/app/dashboard" href="/app/dashboard"
             style="display:inline-flex;align-items:center;gap:8px;padding:12px 22px;border-radius:11px;background:linear-gradient(135deg,#1d4ed8,#2563eb);color:#fff;text-decoration:none;font-size:13px;font-weight:700;box-shadow:0 4px 18px rgba(37,99,235,0.38);">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            Ir al inicio
          </a>
          <button onclick="history.back()"
             style="display:inline-flex;align-items:center;gap:6px;padding:12px 18px;border-radius:11px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Volver
          </button>
        </div>
      </div>
    `;
  }

  // ── Error al cargar vista ─────────────────────────────────
  function _renderError(contentEl, path, err) {
    const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    contentEl.innerHTML = `
      <div style="padding:48px 24px;max-width:520px;margin:0 auto;font-family:'Inter',sans-serif;text-align:center;">
        <div style="width:64px;height:64px;border-radius:20px;background:#fef2f2;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">
          <span class="material-symbols-outlined" style="font-size:32px;color:#ef4444;">error</span>
        </div>
        <h2 style="font-size:20px;font-weight:800;color:#0f172a;margin:0 0 8px;">Error al cargar vista</h2>
        <p style="font-size:13px;color:#94a3b8;margin:0 0 28px;font-family:monospace;">${esc(String(err?.message || err))}</p>
        <button onclick="window.location.reload()"
                style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:#0f172a;color:#fff;border:none;font-size:13px;font-weight:600;cursor:pointer;">
          <span class="material-symbols-outlined" style="font-size:16px;">refresh</span>
          Recargar
        </button>
      </div>
    `;
  }

  // ── Interceptor global de clicks en [data-app-route] ──────
  document.addEventListener('click', event => {
    const anchor = event.target.closest('[data-app-route]');
    if (!anchor) return;
    const route = anchor.dataset.appRoute;
    if (!route) return;
    event.preventDefault();
    const href = anchor.getAttribute('href') || '';
    const raw =
      href.startsWith('/app') && (href.includes('?') || href.includes('#'))
        ? href.split('#')[0]
        : route;
    navigate(raw);
  }, { capture: false });

  // ── Popstate (back/forward del navegador) ─────────────────
  window.addEventListener('popstate', () => {
    const path = window.location.pathname;
    if (isInternalAppRoute(path)) {
      _renderRoute(window.location.pathname + window.location.search);
    }
  });

  // ── Renderizar la ruta inicial ────────────────────────────
  _renderRoute(window.location.pathname + window.location.search);

  return { navigate, isInternalAppRoute };
}
