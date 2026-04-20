import { auth } from '/js/core/database.js';

const FLEET_FRAME_TIMEOUT_MS = 15000;
let _frameReady = false;
let _resolveFrameReady = null;
const _frameReadyPromise = new Promise(resolve => {
  _resolveFrameReady = resolve;
});

function currentTab() {
  const params = new URLSearchParams(window.location.search);
  const raw = String(params.get('tab') || 'normal').trim().toLowerCase();
  return raw === 'admins' ? 'admins' : 'normal';
}

function buildFleetFrameUrl() {
  const params = new URLSearchParams();
  params.set('fleet', '1');
  params.set('tab', currentTab());
  return `/mapa?${params.toString()}`;
}

function routeIsWarm() {
  try {
    return sessionStorage.getItem('mex.bootstrap.warm.v1') === '1';
  } catch (_) {
    return false;
  }
}

function markFrameReady() {
  const loader = document.getElementById('cuadreRouteLoader');
  if (loader) loader.classList.add('ready');
  _frameReady = true;
  _toggleRouteActions(true);
  _setRouteHint('La consola ya está lista. Puedes abrir Resumen, Reporte diario o Predicción directo desde esta ruta.');
  const frame = document.getElementById('cuadreRouteFrame');
  if (_resolveFrameReady) {
    _resolveFrameReady(frame?.contentWindow || null);
    _resolveFrameReady = null;
  }
}

function _setRouteHint(message) {
  const hint = document.getElementById('cuadreRouteHint');
  if (hint) hint.textContent = String(message || '').trim();
}

function _toggleRouteActions(enabled) {
  [
    'cuadreActionResumen',
    'cuadreActionActividad',
    'cuadreActionPrediccion'
  ].forEach(id => {
    const button = document.getElementById(id);
    if (button) button.disabled = !enabled;
  });
}

async function _awaitFleetWindow() {
  const frame = document.getElementById('cuadreRouteFrame');
  if (frame?.contentWindow && _frameReady) return frame.contentWindow;

  const timeout = new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error('La consola de flota tardó demasiado en responder.')), FLEET_FRAME_TIMEOUT_MS);
  });

  const fleetWindow = await Promise.race([_frameReadyPromise, timeout]);
  if (!fleetWindow) throw new Error('No se pudo obtener la ventana interna de flota.');
  return fleetWindow;
}

function _openInnerModal(win, id) {
  const modal = win?.document?.getElementById(id);
  if (!modal) return false;
  modal.classList.add('active');
  return true;
}

async function _runFleetAction(action) {
  try {
    _setRouteHint('Sincronizando con la consola interna…');
    const win = await _awaitFleetWindow();

    if (action === 'resumen') {
      if (typeof win.abrirResumenFlota === 'function') {
        win.abrirResumenFlota();
        _setRouteHint('Resumen de flota abierto desde la ruta dedicada.');
        return;
      }
      throw new Error('No encontré abrirResumenFlota() dentro de la consola.');
    }

    if (action === 'actividad') {
      if (_openInnerModal(win, 'modal-lector-reservas')) {
        win.validarTextareasActividad?.();
        _setRouteHint('Reporte diario listo para pegar Reservas, Regresos y Vencidos.');
        return;
      }
      throw new Error('No encontré el modal de reporte diario dentro de la consola.');
    }

    if (action === 'prediccion') {
      win.reiniciarPrediccion?.();
      if (_openInnerModal(win, 'modal-prediccion')) {
        const dateInput = win.document.getElementById('fecha-prediccion');
        if (dateInput && !dateInput.value) dateInput.valueAsDate = new Date();
        _setRouteHint('Predicción abierta. Pega Reservas y Regresos para calcular la disponibilidad.');
        return;
      }
      throw new Error('No encontré el modal de predicción dentro de la consola.');
    }

    if (action === 'mapa') {
      window.location.href = '/mapa';
    }
  } catch (error) {
    console.warn('[cuadre] action:', action, error);
    _setRouteHint(error?.message || 'No se pudo ejecutar la acción rápida de la consola.');
  }
}

function _bindRouteActions() {
  document.getElementById('cuadreActionResumen')?.addEventListener('click', () => _runFleetAction('resumen'));
  document.getElementById('cuadreActionActividad')?.addEventListener('click', () => _runFleetAction('actividad'));
  document.getElementById('cuadreActionPrediccion')?.addEventListener('click', () => _runFleetAction('prediccion'));
  document.getElementById('cuadreActionMapa')?.addEventListener('click', () => _runFleetAction('mapa'));
}

_bindRouteActions();
_toggleRouteActions(false);

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.replace('/login');
    return;
  }

  if (typeof window.__mexRequireLocationAccess === 'function') {
    await window.__mexRequireLocationAccess({
      title: 'Ubicacion obligatoria para gestion de flota',
      copy: 'Activa tu ubicación exacta para entrar al panel de gestión de flota y dejar trazabilidad operativa.',
      allowLogout: true,
      force: false
    });
  }

  const frame = document.getElementById('cuadreRouteFrame');
  if (!frame) return;
  if (routeIsWarm()) {
    const loader = document.getElementById('cuadreRouteLoader');
    if (loader) loader.classList.add('ready');
    _setRouteHint('Carga caliente detectada. Terminando de enlazar la consola interna…');
  }
  frame.addEventListener('load', markFrameReady, { once: true });
  _setRouteHint('Autenticación lista. Cargando la consola interna de flota…');
  frame.src = buildFleetFrameUrl();
});
