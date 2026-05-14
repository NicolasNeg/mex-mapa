// ═══════════════════════════════════════════════════════════
//  /js/app/views/legacy-stage.js
//  Monta vistas legacy reales dentro del App Shell.
//
//  Regla: el Shell conserva sidebar/header. La vista legacy vive
//  dentro del main stage en modo content-only (?shell=1).
// ═══════════════════════════════════════════════════════════

let _container = null;
let _shell = null;
let _iframe = null;

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
  '/app/programador': 'programador',
  '/app/mapa': 'mapa',
  '/app/editmap': 'editmap',
  '/app/mapa/editor': 'editmap',
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
  params.delete('legacy');
  params.set('shell', '1');
  params.set('appStage', '1');
  if (id === 'admin') params.set('admin', '1');
  if (id === 'mensajes') params.set('messages', '1');
  if (id === 'cuadre') params.set('fleet', '1');
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
      body.legacy-embedded-stage #modal-config-global{border-radius:0!important;}
      body.legacy-embedded-stage .chatv2-header{display:none!important;}
      body.legacy-embedded-stage #buzon-modal{height:100vh!important;min-height:100vh!important;}
      body.legacy-embedded-stage .chatv2-close,
      body.legacy-embedded-stage button[title="Volver al mapa"]{display:none!important;}
      body.legacy-embedded-stage .fleet-header-top button[onclick*="/mapa"]{display:none!important;}
      body.legacy-embedded-stage .fleet-header-top .badge-pro{display:none!important;}
    `;
    doc.head.appendChild(style);
    doc.body?.classList?.add('legacy-embedded-stage', `legacy-embedded-${id}`);
  } catch (_) {
    // Same-origin expected. If it is not available yet, bridge CSS still handles chrome removal.
  }
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

export function mount(ctx = {}) {
  _container = ctx.container;
  _shell = ctx.shell || null;
  const id = _idFromContext(ctx);
  const cfg = LEGACY_BY_ID[id] || LEGACY_BY_ID.dashboard;
  const src = _srcFor(id, ctx);

  _ensureCss();
  document.body.classList.add('app-legacy-stage-active');
  _shell?.setHeaderActions?.('');

  _container.innerHTML = `
    <section class="app-legacy-stage" data-legacy-stage="${esc(id)}">
      <iframe
        id="appLegacyStageFrame"
        class="app-legacy-stage__frame"
        title="${esc(cfg.title)}"
        src="${esc(src)}"
        data-app-legacy-stage="${esc(id)}"
        allow="clipboard-read; clipboard-write; microphone; camera; fullscreen"
      ></iframe>
    </section>
  `;

  _iframe = _container.querySelector('#appLegacyStageFrame');
  _iframe?.addEventListener('load', () => {
    _injectFrameOverrides(_iframe, id);
    _scheduleFrameSync(_iframe, id, ctx);
  });
}

export function unmount() {
  try { _shell?.setHeaderActions?.(''); } catch (_) {}
  document.body.classList.remove('app-legacy-stage-active');
  if (_container) _container.innerHTML = '';
  _iframe = null;
  _shell = null;
  _container = null;
}
