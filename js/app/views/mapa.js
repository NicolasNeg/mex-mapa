// ═══════════════════════════════════════════════════════════
//  App Shell — Vista Mapa
//
//  Stage persistente compartido con /app/cuadre.
//  mapa.js es un singleton — se importa una sola vez.
//  La inicialización se rastrea en stage.dataset.mexInit
//  para que ambas vistas (mapa y cuadre) la compartan.
// ═══════════════════════════════════════════════════════════

const STAGE_ID = 'mex-legacy-mapa-stage';
const PORTAL_IDS = ['sidebar', 'overlay'];
const PORTAL_GUARD_ID = 'mex-lmapa-portal-guard';

let _stage     = null;
let _htmlCache = null;
let _shell     = null;
let _portalResizeBound = false;

// ── CSS legacy ───────────────────────────────────────────────
function _ensureCss() {
  // mapa.css + alertas.css (el estilo de alertas y del feed vive en alertas.css;
  // el SPA no carga global.css, así que hay que inyectarla aquí o salen sin estilo).
  // Cada hoja se verifica por separado: si solo existe mapa.css no debemos
  // early-return y saltarnos alertas.css (carrera al montar desde cuadre).
  ['/css/mapa.css', '/css/alertas.css'].forEach(href => {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-lmapa-css', '1');
    document.head.appendChild(link);
  });
}

function _ensurePortalGuardCss() {
  if (document.getElementById(PORTAL_GUARD_ID)) return;
  const style = document.createElement('style');
  style.id = PORTAL_GUARD_ID;
  style.textContent = `
    body:not(.app-mapa-stage-visible) > #sidebar.units-sidebar,
    body:not(.app-mapa-stage-visible) > #overlay.overlay,
    body:not(.app-mapa-stage-visible) > #_sidebarBackdrop.sidebar-backdrop {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(style);
}

function _isMobileViewport() {
  try { return window.matchMedia?.('(max-width: 768px)')?.matches === true; } catch (_) {}
  return window.innerWidth <= 768;
}

function _findPortalEl(stage, id) {
  return stage?.querySelector?.(`#${id}`) || document.getElementById(id);
}

function _restoreMapPortals(stage = _stage || document.getElementById(STAGE_ID)) {
  if (!stage) return;
  PORTAL_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.parentElement === stage) return;
    if (el.dataset.mexMapaPortal === '1' || el.classList.contains('units-sidebar') || el.classList.contains('overlay')) {
      stage.appendChild(el);
      delete el.dataset.mexMapaPortal;
    }
  });
}

function _portalMapOverlaysToBody(stage) {
  if (!stage) return;
  PORTAL_IDS.forEach(id => {
    const el = _findPortalEl(stage, id);
    if (!el || el.parentElement === document.body) return;
    el.dataset.mexMapaPortal = '1';
    document.body.appendChild(el);
  });
}

function _syncMapPortalState(stage = _stage || document.getElementById(STAGE_ID)) {
  if (!stage) return;
  if (_isMobileViewport()) _portalMapOverlaysToBody(stage);
  else _restoreMapPortals(stage);
}

function _cleanupMapBodyChrome(stage = _stage || document.getElementById(STAGE_ID)) {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');
  sidebar?.classList?.remove('open', 'is-pinned');
  overlay?.classList?.remove('active');
  document.getElementById('_sidebarBackdrop')?.remove();
  document.body.classList.remove('sidebar-open', 'admin-sidebar-open');
  _restoreMapPortals(stage);
}

function _bindPortalResize() {
  if (_portalResizeBound) return;
  window.addEventListener('resize', _onPortalResize);
  _portalResizeBound = true;
}

function _unbindPortalResize() {
  if (!_portalResizeBound) return;
  window.removeEventListener('resize', _onPortalResize);
  _portalResizeBound = false;
}

function _onPortalResize() {
  const stage = _stage || document.getElementById(STAGE_ID);
  if (!stage || stage.style.display === 'none') return;
  _syncMapPortalState(stage);
}

// ── Stage persistente ────────────────────────────────────────
function _getOrCreateStage() {
  if (_stage && document.contains(_stage)) return _stage;
  const main = document.getElementById('mexShellMain');
  if (!main) { console.warn('[mapa-view] #mexShellMain no encontrado'); return null; }
  const existing = document.getElementById(STAGE_ID);
  if (existing) { _stage = existing; return _stage; }

  _stage = document.createElement('div');
  _stage.id = STAGE_ID;
  Object.assign(_stage.style, {
    position:   'absolute',
    inset:      '0',
    zIndex:     '20',
    overflow:   'hidden',
    display:    'none',
    background: '#141f2e',
  });
  main.style.position = 'relative';
  main.appendChild(_stage);
  return _stage;
}

// ── HTML de mapa.html ────────────────────────────────────────
async function _fetchBodyHtml() {
  if (_htmlCache) return _htmlCache;
  const res = await fetch('/mapa.html');
  if (!res.ok) throw new Error(`mapa.html HTTP ${res.status}`);
  const text = await res.text();
  const doc  = new DOMParser().parseFromString(text, 'text/html');
  doc.body.querySelectorAll('script').forEach(s => s.remove());
  doc.body.querySelector('#mapaLeftSidebarContainer')?.remove();
  const mainEl = doc.body.querySelector('#mapaMainStage');
  if (mainEl) {
    mainEl.classList.remove('shell-main-stage', 'shell-main-offset', 'shell-main-offset--expanded');
    mainEl.style.cssText = 'width:100%;height:100%;margin:0;padding:0;';
  }
  doc.body.querySelector('.map-shell-topbar')?.remove();
  doc.body.querySelector('#routeTopbarHost')?.remove();
  // Elementos GLOBALES que pertenecen al shell, no al mapa. Si se inyectan aquí
  // duplican su ID y roban el getElementById → diálogos de otras secciones
  // (mexConfirm/mexAlert/etc.) se renderizan dentro del stage oculto del mapa.
  // El shell (dialogs.js) crea su propio #mex-dialog-overlay en <body>.
  doc.body.querySelector('#mex-dialog-overlay')?.remove();
  // Mismo caso: #toastContainer es un singleton global (window.showToast lo
  // reusa por ID). Si se inyecta aquí, los toasts de TODAS las secciones se
  // apilan dentro del stage oculto del mapa. showToast lo recrea en <body>.
  doc.body.querySelector('#toastContainer')?.remove();
  _htmlCache = doc.body.innerHTML;
  return _htmlCache;
}

// ── CSS overrides dentro del stage ──────────────────────────
function _ensureStageOverrides(stage) {
  if (stage.querySelector('#mex-lmapa-overrides')) return;
  const style = document.createElement('style');
  style.id = 'mex-lmapa-overrides';
  style.textContent = `
    #${STAGE_ID} .mapa-shell { width:100%; height:100%; overflow:hidden; }
    #${STAGE_ID} #mapaMainStage {
      margin:0!important; padding-top:0!important;
      width:100%!important; height:100%!important;
    }
    #${STAGE_ID} #routeSidebarHost,
    #${STAGE_ID} #routeTopbarHost,
    #${STAGE_ID} #homeSidebar,
    #${STAGE_ID} .shell-topbar-surface,
    #${STAGE_ID} .map-shell-topbar,
    #${STAGE_ID} #legacyAppShellBanner { display:none!important; }
    #${STAGE_ID} .map-stage,
    #${STAGE_ID} #map-stage { margin-top:0!important; }
    #${STAGE_ID} body,
    #${STAGE_ID} .mapa-shell { background:#141f2e; }
  `;
  stage.appendChild(style);
}

// ── Helper compartido: inicializar stage una sola vez ────────
// Devuelve { stage, fresh: true } si acaba de inicializar,
// { stage, fresh: false } si ya estaba inicializado.
// Usado por mapa.js y cuadre.js views.
export async function ensureStageReady() {
  _ensureCss();
  _ensurePortalGuardCss();
  const stage = _getOrCreateStage();
  if (!stage) return { stage: null, fresh: false };
  if (stage.dataset.mexInit === '1') return { stage, fresh: false };

  const html = await _fetchBodyHtml();
  stage.innerHTML = html;
  _ensureStageOverrides(stage);
  stage.dataset.mexInit = '1';
  await import('/js/views/mapa.js');
  return { stage, fresh: true };
}

// Los accesos a "panel de unidades" (botón flotante #btnAbrirUnidades) y
// "mapa de calor" (switch en controles) viven en el propio mapa, por eso el
// header del shell ya no duplica esos íconos.

// ══════════════════════════════════════════════════════════════
//  mount / unmount — API del App Shell router
// ══════════════════════════════════════════════════════════════

export async function mount(ctx) {
  _ensureCss();
  _ensurePortalGuardCss();
  _shell = ctx?.shell ?? null;

  const { stage, fresh } = await ensureStageReady();
  if (!stage) return;

  if (!fresh) {
    // Re-montaje desde cuadre u otra vista — cerrar fleet modal y refrescar
    _ensureStageOverrides(stage);
    window.dispatchEvent(new CustomEvent('mex:navigate-mapa'));
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new CustomEvent('mex:mapa-stage-visible'));
  }

  document.body.classList.add('app-mapa-stage-visible');
  stage.style.display = 'block';
  _syncMapPortalState(stage);
  _bindPortalResize();

  // Al mostrar: el stage pudo dimensionarse en 0 mientras estaba oculto → re-fit
  // y re-dibujar SOLO si el grid quedó vacío (no redibuja si ya está pintado).
  _kickMapaRender();

  // Deep link /app/mapa?mva=D5129&plaza=BJX (cola, compartidos, etc.)
  try {
    const qs = new URLSearchParams(window.location.search || '');
    const mvaQs = String(qs.get('mva') || '').trim().toUpperCase();
    const plazaQs = String(qs.get('plaza') || '').trim().toUpperCase();
    if (mvaQs) {
      window.__mexPendingMapFocus = { mva: mvaQs, plaza: plazaQs || '', at: Date.now() };
      if (plazaQs && window.__mexCanViewPlaza?.(plazaQs)) {
        // Preferir el helper del shell (cambia plaza + deja focus pendiente).
        if (typeof window.__mexGoToMapUnit === 'function') {
          window.__mexGoToMapUnit(mvaQs, plazaQs);
        }
      }
    }
  } catch (_) {}

  // "Ver en mapa" / ?mva= deja window.__mexPendingMapFocus.
  _applyPendingFocus();

  if (_shell) _shell.setHeaderActions(null);
}

// Re-ajusta el viewport y re-dibuja si el grid está vacío. Barato e idempotente;
// no redibuja un mapa ya pintado (solo re-fit). Se dispara varias veces porque el
// layout tarda un tick en estabilizarse al pasar de oculto a visible.
function _kickMapaRender() {
  const kick = () => {
    try { window.dispatchEvent(new Event('resize')); } catch (_) {}
    try { if (typeof window.__mexEnsureMapaRendered === 'function') window.__mexEnsureMapaRendered(); } catch (_) {}
  };
  kick();
  try { requestAnimationFrame(kick); } catch (_) { setTimeout(kick, 60); }
  setTimeout(kick, 350);
}

function _pendingFocusMva() {
  const pend = window.__mexPendingMapFocus;
  if (!pend) return '';
  if (typeof pend === 'string') return String(pend).trim().toUpperCase();
  return String(pend.mva || '').trim().toUpperCase();
}

// Aplica el resaltado de unidad pendiente ("Ver en mapa"). Reintenta hasta ~18s
// porque las unidades (.car) pueden tardar en renderizar tras cambiar de plaza.
function _applyPendingFocus() {
  if (typeof window.__mexApplyPendingMapFocus === 'function') {
    window.__mexApplyPendingMapFocus({ delayMs: 150 });
    return;
  }
  const mva = _pendingFocusMva();
  if (!mva) return;
  let tries = 0;
  const tick = () => {
    tries++;
    let ok = false;
    try { if (typeof window.__mexEnsureMapaRendered === 'function') window.__mexEnsureMapaRendered(); } catch (_) {}
    try { ok = window.__mexFocusUnidad?.(mva) === true; } catch (_) {}
    if (ok) { window.__mexPendingMapFocus = null; return; }
    if (tries > 90) {
      window.__mexPendingMapFocus = null;
      try { window.showToast?.(`No se encontró ${mva} en el mapa`, 'warning'); } catch (_) {}
      return;
    }
    setTimeout(tick, 200);
  };
  setTimeout(tick, 150);
}

export function unmount() {
  const stage = _stage || document.getElementById(STAGE_ID);
  document.body.classList.remove('app-mapa-stage-visible');
  _unbindPortalResize();
  _cleanupMapBodyChrome(stage);
  if (stage) {
    stage.style.display = 'none';
    window.dispatchEvent(new CustomEvent('mex:mapa-stage-hidden'));
  }
  _shell?.setHeaderActions('');
  _shell = null;
}
