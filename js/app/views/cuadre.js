// ═══════════════════════════════════════════════════════════
//  App Shell — Vista Cuadre
//
//  Cuadre ES el fleet-modal del mapa, abierto en el mismo stage
//  persistente que usa /app/mapa. No hay iframe ni reescritura;
//  reutilizamos el legacy mapa.js directamente.
// ═══════════════════════════════════════════════════════════

import { mount as _mountMapaStage, unmount as _unmountMapaStage } from '/js/app/views/mapa.js';

const FLEET_MODAL_ID = 'fleet-modal';
const TAB_PARAM      = new URLSearchParams(window.location.search).get('tab') || 'NORMAL';

// Espera a que el fleet-modal exista en el DOM (mapa.js lo inyecta vía mapa.html)
function _waitForFleetModal(ms = 8000) {
  return new Promise((resolve) => {
    const modal = document.getElementById(FLEET_MODAL_ID);
    if (modal) { resolve(modal); return; }
    const start = Date.now();
    const poll = () => {
      const m = document.getElementById(FLEET_MODAL_ID);
      if (m) { resolve(m); return; }
      if (Date.now() - start >= ms) { resolve(null); return; }
      setTimeout(poll, 80);
    };
    poll();
  });
}

export async function mount(ctx) {
  // Montar (o mostrar) el stage del mapa — inicializa mapa.js si es la primera vez
  await _mountMapaStage(ctx);

  // Una vez que el DOM del stage está listo, abrir el fleet modal
  const modal = await _waitForFleetModal();
  if (!modal) {
    console.warn('[cuadre-view] fleet-modal no encontrado tras espera');
    return;
  }

  // Dejar que el legacy maneje la apertura correcta (carga datos, tabs, permisos)
  window.dispatchEvent(new CustomEvent('mex:navigate-cuadre', {
    detail: { tab: String(TAB_PARAM).toUpperCase() === 'ADMINS' ? 'ADMINS' : 'NORMAL' }
  }));
}

export function unmount() {
  _unmountMapaStage();
}
