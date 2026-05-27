// ═══════════════════════════════════════════════════════════
//  App Shell — Vista Mapa
//
//  Estrategia: inyecta el HTML de mapa.html en un stage
//  persistente dentro de #mexShellMain (ya offseteado por
//  sidebar+header). Importa js/views/mapa.js una vez — se
//  auto-inicializa contra el DOM inyectado. En navegaciones
//  posteriores solo muestra/oculta el stage sin re-init.
// ═══════════════════════════════════════════════════════════

const STAGE_ID = 'mex-legacy-mapa-stage';

let _stage     = null;   // el div persistente
let _initialized = false; // mapa.js ya fue importado
let _htmlCache = null;   // body HTML de mapa.html (sin scripts)

// ── CSS legacy ───────────────────────────────────────────────
function _ensureCss() {
  if (document.querySelector('link[data-lmapa-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/mapa.css';
  link.setAttribute('data-lmapa-css', '1');
  document.head.appendChild(link);
}

// ── Obtener/crear el div persistente ────────────────────────
function _getOrCreateStage() {
  if (_stage && document.contains(_stage)) return _stage;
  // Buscar el main ya existente (offseteado por sidebar+header)
  const main = document.getElementById('mexShellMain');
  if (!main) {
    console.warn('[mapa-view] #mexShellMain no encontrado');
    return null;
  }
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
  main.style.position = 'relative'; // garantía
  main.appendChild(_stage);
  return _stage;
}

// ── Extraer body de mapa.html ────────────────────────────────
async function _fetchBodyHtml() {
  if (_htmlCache) return _htmlCache;
  const res = await fetch('/mapa.html');
  if (!res.ok) throw new Error(`mapa.html HTTP ${res.status}`);
  const text = await res.text();
  const doc  = new DOMParser().parseFromString(text, 'text/html');

  // Quitar <script> del body (ya cargados o se importan vía module)
  doc.body.querySelectorAll('script').forEach(s => s.remove());

  // Quitar contenedor del sidebar legacy (shell ya lo tiene)
  doc.body.querySelector('#mapaLeftSidebarContainer')?.remove();

  // Quitar offsets del main stage — el stage ya está posicionado
  const mainEl = doc.body.querySelector('#mapaMainStage');
  if (mainEl) {
    mainEl.classList.remove('shell-main-stage', 'shell-main-offset',
      'shell-main-offset--expanded');
    mainEl.style.cssText = 'width:100%;height:100%;margin:0;padding:0;';
  }

  // Quitar topbar legacy si está en el HTML estático
  doc.body.querySelector('.map-shell-topbar')?.remove();
  doc.body.querySelector('#routeTopbarHost')?.remove();

  _htmlCache = doc.body.innerHTML;
  return _htmlCache;
}

// ── Overrides CSS dentro del stage ──────────────────────────
function _ensureStageOverrides(stage) {
  if (stage.querySelector('#mex-lmapa-overrides')) return;
  const style = document.createElement('style');
  style.id = 'mex-lmapa-overrides';
  style.textContent = `
    /* Mapa legacy dentro del App Shell — quitar chrome propio */
    #${STAGE_ID} .mapa-shell { width:100%; height:100%; overflow:hidden; }
    #${STAGE_ID} #mapaMainStage {
      margin:0!important; padding-top:0!important;
      width:100%!important; height:100%!important;
    }
    /* Ocultar shell legacy interno (sidebar, topbar, banner) */
    #${STAGE_ID} #routeSidebarHost,
    #${STAGE_ID} #routeTopbarHost,
    #${STAGE_ID} #homeSidebar,
    #${STAGE_ID} .shell-topbar-surface,
    #${STAGE_ID} .map-shell-topbar,
    #${STAGE_ID} #legacyAppShellBanner { display:none!important; }
    /* Map stage ocupa todo el espacio */
    #${STAGE_ID} .map-stage,
    #${STAGE_ID} #map-stage { margin-top:0!important; }
    /* Fondo */
    #${STAGE_ID} body,
    #${STAGE_ID} .mapa-shell { background:#141f2e; }
  `;
  stage.appendChild(style);
}

// ══════════════════════════════════════════════════════════════
//  mount / unmount — API del App Shell router
// ══════════════════════════════════════════════════════════════

export async function mount(ctx) {
  _ensureCss();

  const stage = _getOrCreateStage();
  if (!stage) return;

  if (!_initialized) {
    // Primera carga: inyectar HTML e importar mapa.js
    const html = await _fetchBodyHtml();
    stage.innerHTML = html;
    _ensureStageOverrides(stage);
    _initialized = true;

    // mapa.js se auto-inicia: auth.onAuthStateChanged → suscripciones → render
    // Los document.getElementById() del legacy encuentran los elementos inyectados
    await import('/js/views/mapa.js');
  } else {
    // Re-montaje: el DOM y las suscripciones ya existen
    _ensureStageOverrides(stage);
    // Cerrar fleet modal si venimos de /app/cuadre
    window.dispatchEvent(new CustomEvent('mex:navigate-mapa'));
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new CustomEvent('mex:mapa-stage-visible'));
  }

  stage.style.display = 'block';
}

export function unmount() {
  if (_stage) {
    _stage.style.display = 'none';
    window.dispatchEvent(new CustomEvent('mex:mapa-stage-hidden'));
  }
}
