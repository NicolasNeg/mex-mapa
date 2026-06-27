// ═══════════════════════════════════════════════════════════
//  /js/app/views/legacy-stage.js
//  Monta vistas legacy reales dentro del App Shell.
//
//  Regla: el Shell conserva sidebar/header. La vista legacy vive
//  dentro del main stage en modo content-only (?shell=1).
// ═══════════════════════════════════════════════════════════

import { getState, onPlazaChange } from '/js/app/app-state.js';

let _container = null;
let _shell = null;
let _iframe = null;
let _currentId = null;
let _offGlobalSearch = null;
let _offPlazaChange = null;
let _unitsHeaderTimer = null;
let _unitsHeaderSig = '';

// Views kept alive between navigations (iframe preserved in memory, not destroyed).
// Excludes alertas/alertasHist (tool overlays on mapa, share its iframe src).
const _keepAliveIds = new Set([
  'dashboard', 'mapa', 'cuadre', 'admin', 'mensajes',
  'cola', 'incidencias', 'programador', 'editmap', 'profile'
]);
// id → { sectionEl, iframe }
const _iframePool = new Map();

const LEGACY_BY_ID = {
  dashboard:   { src: '/home',              title: 'Dashboard' },
  profile:     { src: '/profile',           title: 'Mi perfil' },
  mensajes:    { src: '/mensajes',          title: 'Mensajes' },
  cola:        { src: '/cola-preparacion',  title: 'Cola de preparación' },
  incidencias: { src: '/incidencias',       title: 'Incidencias' },
  cuadre:      { src: '/cuadre',            title: 'Cuadre' },
  admin:       { src: '/gestion',           title: 'Panel administrativo' },
  programador: { src: '/programador',       title: 'Consola técnica' },
  mapa:        { src: '/mapa',              title: 'Mapa operativo' },
  alertas:     { src: '/mapa',              title: 'Emitir alertas', open: 'alertas' },
  alertasHist: { src: '/mapa',              title: 'Historial de alertas', open: 'historial-alertas' },
  editmap:     { src: '/editmap',           title: 'Editor de patio' },
};

const LEGACY_BY_APP_PATH = {
  '/app/dashboard': 'dashboard',
  '/app/home': 'dashboard',
  '/app/profile': 'profile',
  '/app/perfil': 'profile',
  '/app/mensajes': 'mensajes',
  '/app/cola-preparacion': 'cola',
  '/app/cola': 'cola',
  '/app/incidencias': 'incidencias',
  '/app/cuadre': 'cuadre',
  '/app/admin': 'admin',
  '/app/gestion': 'admin',
  '/app/alertas': 'alertas',
  '/app/alertas/historial': 'alertasHist',
  '/app/historial-alertas': 'alertasHist',
  '/app/programador': 'programador',
  '/app/mapa': 'mapa',
  '/app/editmap': 'editmap',
  '/app/mapa/editor': 'editmap',
};

const LEGACY_ROUTE_TO_APP = {
  '/home': '/app/dashboard',
  '/profile': '/app/profile',
  '/mensajes': '/app/mensajes',
  '/cola-preparacion': '/app/cola-preparacion',
  '/incidencias': '/app/incidencias',
  '/cuadre': '/app/cuadre',
  '/gestion': '/app/admin',
  '/programador': '/app/programador',
  '/mapa': '/app/mapa',
  '/editmap': '/app/editmap'
};

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _ensureCss() {
  if (document.querySelector('link[data-app-legacy-stage-css="1"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/app-legacy-stage.css';
  link.dataset.appLegacyStageCss = '1';
  document.head.appendChild(link);
}

function _routePath(raw = '') {
  const path = String(raw || '').split('?')[0].replace(/\/+$/, '');
  return path || '/app/dashboard';
}

function _idFromContext(ctx = {}) {
  if (ctx.legacyId && LEGACY_BY_ID[ctx.legacyId]) return ctx.legacyId;
  const stateRoute = String(ctx.state?.currentRoute || '');
  const path = _routePath(stateRoute || window.location.pathname);
  if (LEGACY_BY_APP_PATH[path]) return LEGACY_BY_APP_PATH[path];
  if (path.startsWith('/app/admin/') || path.startsWith('/app/gestion/')) return 'admin';
  return 'dashboard';
}

function _tabFromPath(path = '') {
  const clean = _routePath(path);
  const last = clean.split('/').filter(Boolean).pop() || '';
  if (['usuarios', 'roles', 'plazas', 'catalogos', 'solicitudes', 'estados', 'categorias', 'modelos', 'gasolinas', 'ubicaciones', 'empresa'].includes(last)) {
    return last;
  }
  return '';
}

function _srcFor(id, ctx = {}) {
  const cfg = LEGACY_BY_ID[id] || LEGACY_BY_ID.dashboard;
  const params = new URLSearchParams(window.location.search || '');
  const appState = getState();
  const plaza = String(appState.currentPlaza || '').toUpperCase().trim();
  params.delete('legacy');
  params.set('shell', '1');
  params.set('appStage', '1');
  if (id === 'admin') params.set('admin', '1');
  if (id === 'mensajes') params.set('messages', '1');
  if (cfg.open) params.set('open', cfg.open);
  if ((id === 'alertas' || id === 'alertasHist') && plaza) params.set('plaza', plaza);
  if (id === 'cuadre') {
    if (!params.get('tab')) params.set('tab', 'normal');
  }
  if (id === 'cola' && plaza) params.set('plaza', plaza);
  if (id === 'editmap') {
    const base = plaza ? `/editmap/${encodeURIComponent(plaza)}` : '/editmap';
    return `${base}?${params.toString()}${window.location.hash || ''}`;
  }
  if (id === 'admin' && !params.get('tab')) {
    const tab = _tabFromPath(ctx.state?.currentRoute || window.location.pathname);
    if (tab) params.set('tab', tab);
  }
  return `${cfg.src}?${params.toString()}${window.location.hash || ''}`;
}

function _injectFrameOverrides(frame, id) {
  try {
    const doc = frame?.contentDocument;
    if (!doc || doc.getElementById('appLegacyStageFrameOverrides')) return;
    const style = doc.createElement('style');
    style.id = 'appLegacyStageFrameOverrides';
    style.textContent = `
      #legacyAppShellBanner{display:none!important;}
      body{margin:0!important;}
      body.legacy-embedded-stage .badge-pro{display:none!important;}
      body.legacy-embedded-stage #routeSidebarHost,
      body.legacy-embedded-stage #routeTopbarHost,
      body.legacy-embedded-stage #homeSidebar,
      body.legacy-embedded-stage .shell-topbar-surface{display:none!important;}
      body.legacy-embedded-stage #routeMainStage,
      body.legacy-embedded-stage .shell-main-stage,
      body.legacy-embedded-stage .shell-main-offset{margin-left:0!important;width:100%!important;max-width:none!important;padding-top:0!important;min-height:100vh!important;}
      body.legacy-embedded-stage #homeApp,
      body.legacy-embedded-stage #cuadreApp,
      body.legacy-embedded-stage #colaApp,
      body.legacy-embedded-stage #programmerApp,
      body.legacy-embedded-stage #incidenciasApp{min-height:100vh!important;}
      body.legacy-embedded-stage .gestion-back-btn,
      body.legacy-embedded-stage #cfg-sidebar-pin{display:none!important;}
      body.legacy-embedded-stage .cfg-v2-sidebar{display:none!important;}
      body.legacy-embedded-stage .cfg-v2-body{grid-template-columns:minmax(0,1fr)!important;}
      body.legacy-embedded-stage .cfg-v2-hero{display:none!important;}
      body.legacy-embedded-stage .cfg-v2-search-box{display:none!important;}
      body.legacy-embedded-stage #modal-config-global{border-radius:0!important;}
      body.legacy-embedded-stage .chatv2-header{display:none!important;}
      body.legacy-embedded-stage #buzon-modal{height:100vh!important;min-height:100vh!important;}
      body.legacy-embedded-stage .chatv2-close,
      body.legacy-embedded-stage button[title="Volver al mapa"]{display:none!important;}
      body.legacy-embedded-stage .fleet-header-top button[onclick*="/mapa"]{display:none!important;}
      body.legacy-embedded-stage .fleet-header-top .badge-pro{display:none!important;}
      body.legacy-embedded-profile{height:auto!important;min-height:100vh!important;overflow-y:auto!important;}
      body.legacy-embedded-profile #profileApp,
      body.legacy-embedded-profile #profileMainStage,
      body.legacy-embedded-profile .shell-main-stage,
      body.legacy-embedded-profile .shell-main-offset{height:auto!important;min-height:100vh!important;overflow:visible!important;}
      body.legacy-embedded-profile #profileApp{padding-bottom:112px!important;}
      body.legacy-embedded-mapa{background:#141f2e!important;overflow:hidden!important;}
      body.legacy-embedded-mapa .map-shell-topbar,
      body.legacy-embedded-mapa .shell-topbar-surface,
      body.legacy-embedded-mapa .map-shell-topbar-left,
      body.legacy-embedded-mapa .map-shell-topbar-right{display:none!important;height:0!important;min-height:0!important;visibility:hidden!important;}
      body.legacy-embedded-mapa #mapaMainStage{padding-top:0!important;margin-top:0!important;}
      body.legacy-embedded-mapa #map-stage{margin-top:0!important;}
      body.legacy-embedded-mapa .mapa-shell{background:#141f2e!important;}
    `;
    doc.head.appendChild(style);
    doc.body?.classList?.add('legacy-embedded-stage', `legacy-embedded-${id}`);
  } catch (_) {
    // Same-origin expected. If it is not available yet, bridge CSS still handles chrome removal.
  }
}

function _appRouteFromLegacyValue(value = '') {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('#') || raw.startsWith('javascript:') || raw.startsWith('mailto:') || raw.startsWith('tel:')) return '';
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return '';
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const appPath = LEGACY_ROUTE_TO_APP[path];
    if (!appPath) return '';
    ['shell', 'appStage', 'legacy'].forEach(key => url.searchParams.delete(key));
    const qs = url.searchParams.toString();
    return `${appPath}${qs ? `?${qs}` : ''}${url.hash || ''}`;
  } catch (_) {
    return '';
  }
}

function _bindFrameRouteBridge(frame, id, ctx = {}) {
  try {
    const doc = frame?.contentDocument;
    const win = frame?.contentWindow;
    if (!doc || !win || doc.documentElement?.dataset?.appRouteBridge === '1') return;
    doc.documentElement.dataset.appRouteBridge = '1';
    doc.addEventListener('click', event => {
      const target = event.target?.closest?.('[data-app-route],[data-route],a[href],button[onclick]');
      if (!target) return;
      const onclick = String(target.getAttribute?.('onclick') || '');
      const routeValue =
        target.getAttribute?.('data-app-route') ||
        target.getAttribute?.('data-route') ||
        target.getAttribute?.('href') ||
        (onclick.match(/['"]((?:\/home|\/profile|\/mensajes|\/cola-preparacion|\/incidencias|\/cuadre|\/gestion|\/programador|\/mapa|\/editmap)(?:[?#][^'"]*)?)['"]/) || [])[1] ||
        '';
      const appRoute = _appRouteFromLegacyValue(routeValue);
      if (!appRoute) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      if (typeof ctx.navigate === 'function') ctx.navigate(appRoute);
      else window.location.href = appRoute;
    }, true);
    _maybeNavigateFromFrameLocation(frame, id, ctx);
  } catch (_) {}
}

function _maybeNavigateFromFrameLocation(frame, id, ctx = {}) {
  try {
    const href = frame?.contentWindow?.location?.href || '';
    const framePath = new URL(href, window.location.origin).pathname.replace(/\/+$/, '') || '/';
    if (['cuadre', 'alertas', 'alertasHist'].includes(id) && framePath === '/mapa') return;
    const appRoute = _appRouteFromLegacyValue(href);
    if (!appRoute) return;
    const appPath = appRoute.split('?')[0].replace(/\/+$/, '') || '/app/dashboard';
    const desiredId = LEGACY_BY_APP_PATH[appPath] || '';
    if (!desiredId || desiredId === id) return;
    if (typeof ctx.navigate === 'function') ctx.navigate(appRoute, { replace: true });
  } catch (_) {}
}

function _requestedAdminTab(ctx = {}) {
  const params = new URLSearchParams(window.location.search || '');
  const queryTab = params.get('tab');
  if (queryTab) return String(queryTab).trim().toLowerCase();
  return _tabFromPath(ctx.state?.currentRoute || window.location.pathname);
}

function _activateAdminTab(frame, tab) {
  const targetTab = String(tab || '').trim().toLowerCase();
  if (!targetTab) return;
  try {
    const win = frame?.contentWindow;
    const doc = frame?.contentDocument;
    if (!win || !doc) return;
    const btn = doc.getElementById(`cfg-tab-${targetTab}`)
      || doc.querySelector(`.cfg-tab[onclick*="'${targetTab}'"]`);
    if (!btn) return;

    if (typeof win.abrirPanelConfiguracion === 'function') {
      win.abrirPanelConfiguracion(targetTab);
    }
    if (typeof win.abrirTabConfig === 'function') {
      win.abrirTabConfig(targetTab, btn);
    } else {
      btn.click();
    }
  } catch (_) {
    // The frame is same-origin in hosting/dev. If it is not ready yet, later attempts retry.
  }
}

function _scheduleFrameSync(frame, id, ctx = {}) {
  if (id !== 'admin') return;
  const tab = _requestedAdminTab(ctx);
  if (!tab) return;
  [0, 250, 750, 1500, 3000].forEach(delay => {
    window.setTimeout(() => _activateAdminTab(frame, tab), delay);
  });
}

function _scheduleToolFrameSync(frame, id) {
  const actionName = id === 'alertas'
    ? 'abrirCreadorAlertas'
    : (id === 'alertasHist' ? 'abrirGestorAlertas' : '');
  if (!actionName) return;
  [300, 800, 1600, 3000].forEach(delay => {
    window.setTimeout(() => {
      try {
        const win = frame?.contentWindow;
        if (typeof win?.[actionName] === 'function') win[actionName]();
      } catch (_) {}
    }, delay);
  });
}

const SEARCH_SELECTORS = {
  dashboard: ['#homeSearchInput', '#shellRouteSearchInput'],
  profile: ['#profileRouteSearchInput', '#shellRouteSearchInput'],
  mensajes: ['#buscadorContactos', '.chatv2-search-input'],
  cola: ['#prepSearchInput'],
  cuadre: ['#searchFlota', '#searchInput', '#searchInputMobile', '#audit-search'],
  admin: ['#cfg-search-input', '#um-search', '#busqueda-solicitudes', '#cfg-plaza-search', '#cfg-correo-interno-search'],
  programador: ['#programmerRouteSearchInput', '#programmerSearchInput'],
  mapa: ['#searchInput', '#searchInputMobile', '#searchFlota', '#audit-search'],
  editmap: ['#searchInput', '#searchInputMobile', '#dropdownSearchInput']
};

const SEARCH_FUNCTIONS = [
  'buscarMasivo',
  'filtrarFlota',
  'renderContactos',
  'buscarEnListaConfig',
  'umFiltrar',
  'filtrarSolicitudesActuales',
  '_filtrarPlazasCfg'
];

function _dispatchFieldEvents(input) {
  ['input', 'keyup', 'change'].forEach(type => {
    try { input.dispatchEvent(new Event(type, { bubbles: true })); } catch (_) {}
  });
}

function _applySearchToWindow(win, id, query) {
  try {
    const doc = win?.document;
    if (!doc) return;
    const selectors = SEARCH_SELECTORS[id] || [];
    selectors.forEach(selector => {
      doc.querySelectorAll(selector).forEach(input => {
        if (!('value' in input)) return;
        input.value = query;
        _dispatchFieldEvents(input);
      });
    });
    SEARCH_FUNCTIONS.forEach(name => {
      try {
        if (typeof win[name] === 'function') win[name]();
      } catch (_) {}
    });
    Array.from(doc.querySelectorAll('iframe')).forEach(child => {
      if (child.contentWindow) _applySearchToWindow(child.contentWindow, id, query);
    });
  } catch (_) {}
}

function _syncSearch(query = '', id = '') {
  if (!_iframe) return;
  _applySearchToWindow(_iframe.contentWindow, id, String(query || ''));
}

function _setPlazaFields(win, plaza) {
  try {
    const doc = win?.document;
    if (!doc) return;
    ['#prepPlazaSelect', '#homePlazaSelect', '#shellRoutePlazaSelect', '#programmerRoutePlazaSelect', '#profileRoutePlazaSelect'].forEach(selector => {
      doc.querySelectorAll(selector).forEach(select => {
        if (!('value' in select)) return;
        select.value = plaza;
        _dispatchFieldEvents(select);
      });
    });
  } catch (_) {}
}

function _applyPlazaToWindow(win, id, plaza) {
  try {
    if (!win) return;
    if (typeof win.setMexCurrentPlaza === 'function') {
      win.setMexCurrentPlaza(plaza, { persistLocal: true, source: 'app-shell-stage' });
    } else {
      win.__mexCurrentPlazaId = plaza;
    }
    if (typeof win.cambiarPlazaMapa === 'function' && ['mapa', 'cuadre', 'editmap'].includes(id)) {
      win.cambiarPlazaMapa(plaza);
    }
    _setPlazaFields(win, plaza);
    Array.from(win.document?.querySelectorAll('iframe') || []).forEach(child => {
      if (child.contentWindow) _applyPlazaToWindow(child.contentWindow, id, plaza);
    });
  } catch (_) {}
}

function _syncPlaza(plaza, id, ctx) {
  const normalized = String(plaza || '').toUpperCase().trim();
  if (!normalized || !_iframe) return;
  _applyPlazaToWindow(_iframe.contentWindow, id, normalized);

  if (['cola', 'dashboard', 'profile', 'programador', 'alertas', 'alertasHist', 'editmap'].includes(id)) {
    const nextSrc = _srcFor(id, ctx);
    if (_iframe.getAttribute('src') !== nextSrc) _iframe.setAttribute('src', nextSrc);
  }
}

function _bindShellSignals(id, ctx = {}) {
  if (typeof _offGlobalSearch === 'function') _offGlobalSearch();
  if (typeof _offPlazaChange === 'function') _offPlazaChange();

  const searchHandler = event => {
    _syncSearch(event?.detail?.query || '', id);
  };
  window.addEventListener('mex:global-search', searchHandler);
  _offGlobalSearch = () => window.removeEventListener('mex:global-search', searchHandler);

  _offPlazaChange = onPlazaChange(nextPlaza => _syncPlaza(nextPlaza, id, ctx));
}

function _clearUnitsHeader() {
  if (_unitsHeaderTimer) {
    window.clearInterval(_unitsHeaderTimer);
    _unitsHeaderTimer = null;
  }
  _unitsHeaderSig = '';
}

function _legacyMapUnitsCounts() {
  const doc = _iframe?.contentDocument;
  if (!doc) return { limbo: 0, taller: 0, total: 0 };
  const limboEl = doc.getElementById('unidades-limbo');
  const tallerEl = doc.getElementById('unidades-taller');
  const limboLabel = Number(doc.getElementById('count-limbo')?.textContent || NaN);
  const tallerLabel = Number(doc.getElementById('count-taller')?.textContent || NaN);
  const limbo = Number.isFinite(limboLabel) ? limboLabel : (limboEl?.children?.length || 0);
  const taller = Number.isFinite(tallerLabel) ? tallerLabel : (tallerEl?.children?.length || 0);
  return { limbo, taller, total: limbo + taller };
}

function _toggleLegacyUnitsSidebar() {
  try {
    const win = _iframe?.contentWindow;
    const doc = _iframe?.contentDocument;
    if (typeof win?.toggleSidebar === 'function') {
      win.toggleSidebar();
      return;
    }
    const sidebar = doc?.getElementById('sidebar');
    sidebar?.classList?.toggle('open');
  } catch (_) {}
}

function _syncLegacyMapUnitsHeader(id) {
  // Solo mapa: cuadre no tiene limbo/taller ni sidebar de unidades (clic se trababa).
  if (id !== 'mapa' || !_shell || !_iframe) return;
  const counts = _legacyMapUnitsCounts();
  const sig = `${id}:${counts.limbo}:${counts.taller}:${counts.total}`;
  const existing = document.getElementById('mexHdrLegacyUnitsBtn');
  if (sig === _unitsHeaderSig && existing) return;
  _unitsHeaderSig = sig;
  _shell.setHeaderActions?.(`
    <button type="button" class="mex-hdr-limbo-btn mex-hdr-limbo-btn--legacy" id="mexHdrLegacyUnitsBtn" title="Unidades en limbo y taller">
      <span class="material-icons">directions_car</span>
      <span>UNIDADES</span>
      <strong class="mex-hdr-limbo-count">${counts.total}</strong>
    </button>
  `);
  document.getElementById('mexHdrLegacyUnitsBtn')?.addEventListener('click', _toggleLegacyUnitsSidebar);
}

function _startLegacyMapUnitsHeader(id) {
  _clearUnitsHeader();
  if (id !== 'mapa') return;
  _syncLegacyMapUnitsHeader(id);
  _unitsHeaderTimer = window.setInterval(() => _syncLegacyMapUnitsHeader(id), 1000);
}

export function mount(ctx = {}) {
  _container = ctx.container;
  _shell = ctx.shell || null;
  const id = _idFromContext(ctx);
  _currentId = id;
  const cfg = LEGACY_BY_ID[id] || LEGACY_BY_ID.dashboard;

  // Remove any loading placeholder the router injected before this module loaded
  if (_container) _container.innerHTML = '';

  _ensureCss();
  document.body.classList.add('app-legacy-stage-active');
  _shell?.setHeaderActions?.('');

  // ── Keep-alive: reutilizar iframe ya cargado ──────────────
  if (_keepAliveIds.has(id) && _iframePool.has(id)) {
    const cached = _iframePool.get(id);
    _iframe = cached.iframe;
    _container.appendChild(cached.sectionEl);
    _bindShellSignals(id, ctx);
    // Re-inyectar overrides por si el iframe recargó mientras estaba fuera del DOM
    _injectFrameOverrides(_iframe, id);
    // Sincronizar plaza actual (pudo cambiar mientras la vista estaba oculta)
    _syncPlaza(getState().currentPlaza, id, ctx);
    _startLegacyMapUnitsHeader(id);
    // Para admin: sincronizar tab activo con la URL actual
    _scheduleFrameSync(_iframe, id, ctx);
    return;
  }

  // ── Primera carga: crear iframe nuevo ─────────────────────
  const src = _srcFor(id, ctx);

  const sectionEl = document.createElement('section');
  sectionEl.className = 'app-legacy-stage';
  sectionEl.dataset.legacyStage = id;

  const loaderEl = document.createElement('div');
  loaderEl.className = 'app-legacy-stage__loader';
  loaderEl.id = 'appLegacyStageLoader';
  loaderEl.setAttribute('aria-live', 'polite');
  loaderEl.innerHTML = `<span class="app-legacy-stage__loader-mark"></span><strong>${esc(cfg.title)}</strong><small>Sincronizando vista...</small>`;

  const iframeEl = document.createElement('iframe');
  iframeEl.id = 'appLegacyStageFrame';
  iframeEl.className = 'app-legacy-stage__frame';
  iframeEl.title = cfg.title;
  iframeEl.src = src;
  iframeEl.dataset.appLegacyStage = id;
  iframeEl.loading = 'eager';
  iframeEl.allow = 'clipboard-read; clipboard-write; microphone; camera; fullscreen';

  sectionEl.appendChild(loaderEl);
  sectionEl.appendChild(iframeEl);
  _container.appendChild(sectionEl);
  _iframe = iframeEl;

  if (_keepAliveIds.has(id)) {
    _iframePool.set(id, { sectionEl, iframe: iframeEl });
  }

  _bindShellSignals(id, ctx);
  iframeEl.addEventListener('load', () => {
    loaderEl.classList.add('is-ready');
    _injectFrameOverrides(iframeEl, id);
    _bindFrameRouteBridge(iframeEl, id, ctx);
    _scheduleFrameSync(iframeEl, id, ctx);
    _scheduleToolFrameSync(iframeEl, id);
    _syncPlaza(getState().currentPlaza, id, ctx);
    _startLegacyMapUnitsHeader(id);
  });
}

export function unmount() {
  try { _shell?.setHeaderActions?.(''); } catch (_) {}
  _clearUnitsHeader();
  if (typeof _offGlobalSearch === 'function') { try { _offGlobalSearch(); } catch (_) {} }
  if (typeof _offPlazaChange === 'function') { try { _offPlazaChange(); } catch (_) {} }
  _offGlobalSearch = null;
  _offPlazaChange = null;

  // ── Keep-alive: solo desacoplar del DOM, no destruir ─────
  if (_currentId && _keepAliveIds.has(_currentId) && _iframePool.has(_currentId)) {
    try { _iframePool.get(_currentId).sectionEl.remove(); } catch (_) {}
  } else {
    if (_container) _container.innerHTML = '';
  }

  document.body.classList.remove('app-legacy-stage-active');
  _iframe = null;
  _shell = null;
  _container = null;
  _currentId = null;
}
