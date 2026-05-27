// ═══════════════════════════════════════════════════════════
//  App Shell — Vista Admin
//  Carga gestion.html en un iframe persistente dentro de
//  #mexShellMain, igual que el patrón mapa/cuadre.
// ═══════════════════════════════════════════════════════════

const FRAME_ID = 'mex-admin-frame';
let _frame = null;

function _getOrCreateFrame() {
  let f = document.getElementById(FRAME_ID);
  if (!f) {
    const main = document.getElementById('mexShellMain');
    if (!main) return null;
    f = document.createElement('iframe');
    f.id = FRAME_ID;
    f.src = '/gestion.html';
    f.setAttribute('data-admin-frame', '1');
    f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;z-index:20;display:none;background:#f1f5f9;';
    main.appendChild(f);
  }
  return (_frame = f);
}

export function mount(_ctx) {
  const frame = _getOrCreateFrame();
  if (!frame) return;
  frame.style.display = 'block';
  window.dispatchEvent(new Event('resize'));
}

export function unmount() {
  const frame = _frame || document.getElementById(FRAME_ID);
  if (frame) frame.style.display = 'none';
}
