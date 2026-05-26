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
  if (open === 'alertas' || open === 'crear-alerta' || open === 'emitir-alerta') return '/app/alertas';
  if (open === 'historial-alertas' || open === 'alertas-historial') return '/app/alertas/historial';
  return '';
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
  '/app/mensajes',
  '/app/cuadre',
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
  '/app/cuadre':   { loader: () => import('/js/app/views/cuadre.js'), navRoute: '/cuadre', feature: 'cuadre' },
  '/app/admin':    { loader: () => import('/js/app/views/admin.js'), navRoute: '/gestion' },
  '/app/gestion':           { redirect: '/app/admin' },
  '/app/usuarios':          { redirect: '/app/admin?tab=usuarios' },
  '/app/admin/usuarios':    { redirect: '/app/admin?tab=usuarios' },
  '/app/gestion/usuarios':  { redirect: '/app/admin?tab=usuarios' },
  '/app/admin/roles':       { redirect: '/app/admin?tab=roles' },
  '/app/gestion/roles':     { redirect: '/app/admin?tab=roles' },
  '/app/admin/plazas':      { redirect: '/app/admin?tab=plazas' },
  '/app/gestion/plazas':    { redirect: '/app/admin?tab=plazas' },
  '/app/admin/catalogos':   { redirect: '/app/admin?tab=catalogos' },
  '/app/gestion/catalogos': { redirect: '/app/admin?tab=catalogos' },
  '/app/admin/solicitudes': { redirect: '/app/admin?tab=solicitudes' },
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
  '/app/gestion/solicitudes': { redirect: '/app/admin?tab=solicitudes' },
  '/app/admin/estados':     { redirect: '/app/admin?tab=estados' },
  '/app/gestion/estados':   { redirect: '/app/admin?tab=estados' },
  '/app/admin/categorias':  { redirect: '/app/admin?tab=categorias' },
  '/app/gestion/categorias': { redirect: '/app/admin?tab=categorias' },
  '/app/admin/modelos':     { redirect: '/app/admin?tab=modelos' },
  '/app/gestion/modelos':   { redirect: '/app/admin?tab=modelos' },
  '/app/admin/gasolinas':   { redirect: '/app/admin?tab=gasolinas' },
  '/app/gestion/gasolinas': { redirect: '/app/admin?tab=gasolinas' },
  '/app/admin/ubicaciones': { redirect: '/app/admin?tab=ubicaciones' },
  '/app/gestion/ubicaciones': { redirect: '/app/admin?tab=ubicaciones' },
  '/app/admin/empresa':     { redirect: '/app/admin?tab=empresa' },
  '/app/gestion/empresa':   { redirect: '/app/admin?tab=empresa' },
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
  },
};

// ── Factory ──────────────────────────────────────────────────
/**
 * @param {{ shell: import('/js/shell/shell-layout.js').ShellLayout }} options
 * @returns {{ navigate: (path: string, opts?: {replace?: boolean}) => void,
 *             isInternalAppRoute: (path: string) => boolean }}
 */
export function createRouter({ shell }) {
  let _currentUnmount = null; // función unmount de la vista activa

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
  function navigate(path, { replace = false } = {}) {
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
    _renderRoute(raw);
  }

  // ── Renderizar ruta ───────────────────────────────────────
  async function _renderRoute(rawPath) {
    const path = _routePathOnly(rawPath);
    const toolRedirect = _appMapToolRedirect(rawPath);
    if (toolRedirect) {
      navigate(toolRedirect, { replace: true });
      return;
    }
    const route = ROUTE_TABLE[path];

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
    shell.setRoute(navRoute);

    // Cerrar drawer mobile si está abierto
    shell.sidebar?.closeMobileDrawer?.();

    // Unmount vista anterior
    if (typeof _currentUnmount === 'function') {
      try { _currentUnmount(); } catch (_) {}
      _currentUnmount = null;
    }

    const contentEl = shell.contentEl;
    if (!contentEl) return;

    // Onboarding gate — redirect if empresa setup is incomplete
    const empresa = window._empresaActual;
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

    // Vista registrada
    if (route?.loader) {
      contentEl.innerHTML = '';
      try {
        const mod = await route.loader();
        if (typeof mod.mount === 'function') {
          mod.mount({ container: contentEl, navigate, shell, state: getState() });
          _currentUnmount = mod.unmount ?? null;
        }
      } catch (err) {
        console.error('[router] Error cargando vista:', currentRoute, err);
        _renderError(contentEl, currentRoute, err);
      }
      return;
    }

    // Ruta /app/* sin vista registrada → 404 en-app
    _renderPlaceholder(contentEl);
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

  // ── Re-render on empresa context change (programador switching tenants) ──
  window.addEventListener('mex:empresa-change', () => {
    const currentPath = window.location.pathname + window.location.search;
    if (isInternalAppRoute(window.location.pathname)) {
      _renderRoute(currentPath);
    }
  });

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
