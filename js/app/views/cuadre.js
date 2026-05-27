// ═══════════════════════════════════════════════════════════
//  App Shell — Vista Cuadre
//
//  Comparte el stage persistente de /app/mapa.
//  mapa.js (singleton) detecta /app/cuadre → abre fleet modal.
//  En re-montaje: despacha mex:navigate-cuadre para abrirlo.
// ═══════════════════════════════════════════════════════════

import { ensureStageReady } from '/js/app/views/mapa.js';

const STAGE_ID = 'mex-legacy-mapa-stage';

function _ensureCss() {
  if (document.querySelector('link[data-lmapa-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/mapa.css';
  link.setAttribute('data-lmapa-css', '1');
  document.head.appendChild(link);
}

export async function mount(ctx) {
  _ensureCss();

  const { stage, fresh } = await ensureStageReady();
  if (!stage) return;

  if (!fresh) {
    // Stage ya existe — solo abrir el fleet modal
    window.dispatchEvent(new CustomEvent('mex:navigate-cuadre'));
    window.dispatchEvent(new Event('resize'));
  }
  // Si fresh=true: mapa.js acaba de importarse, _isCuadreFleetMode() detecta
  // /app/cuadre y abre el fleet modal automáticamente vía _bootCuadreFleetRoute()

  stage.style.display = 'block';
}

export function unmount() {
  const stage = document.getElementById(STAGE_ID);
  if (stage) {
    stage.style.display = 'none';
    window.dispatchEvent(new CustomEvent('mex:mapa-stage-hidden'));
  }
}
