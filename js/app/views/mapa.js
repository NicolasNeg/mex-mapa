// ═══════════════════════════════════════════════════════════
//  App Shell — Vista Mapa
//
//  Stage persistente compartido con /app/cuadre.
//  mapa.js es un singleton — se importa una sola vez.
//  La inicialización se rastrea en stage.dataset.mexInit
//  para que ambas vistas (mapa y cuadre) la compartan.
// ═══════════════════════════════════════════════════════════

const STAGE_ID = 'mex-legacy-mapa-stage';

let _stage     = null;
let _htmlCache = null;

// ── CSS legacy ───────────────────────────────────────────────
function _ensureCss() {
  if (document.querySelector('link[data-lmapa-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/mapa.css';
  link.setAttribute('data-lmapa-css', '1');
  document.head.appendChild(link);
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

// ══════════════════════════════════════════════════════════════
//  mount / unmount — API del App Shell router
// ══════════════════════════════════════════════════════════════

export async function mount(ctx) {
  _ensureCss();

  const { stage, fresh } = await ensureStageReady();
  if (!stage) return;

  if (!fresh) {
    // Re-montaje desde cuadre u otra vista — cerrar fleet modal y refrescar
    _ensureStageOverrides(stage);
    window.dispatchEvent(new CustomEvent('mex:navigate-mapa'));
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new CustomEvent('mex:mapa-stage-visible'));
  }

  stage.style.display = 'block';
}

export function unmount() {
  const stage = _stage || document.getElementById(STAGE_ID);
  if (stage) {
    stage.style.display = 'none';
    window.dispatchEvent(new CustomEvent('mex:mapa-stage-hidden'));
  }
}
