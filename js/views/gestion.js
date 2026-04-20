import { auth } from '/js/core/database.js';

function _todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function _toggleModalActive(id, active) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.toggle('active', Boolean(active));
}

function _resetActividadModal() {
  const reservas = document.getElementById('textoBrutoReservas');
  const regresos = document.getElementById('textoBrutoRegresos');
  const vencidos = document.getElementById('textoBrutoVencidos');
  if (reservas) reservas.value = '';
  if (regresos) regresos.value = '';
  if (vencidos) vencidos.value = '';
  if (typeof window.validarTextareasActividad === 'function') {
    window.validarTextareasActividad();
  }
}

function _syncPredictionDate() {
  const input = document.getElementById('fecha-prediccion');
  if (input && !input.value) input.value = _todayIso();
}

function _resetPrediccionModal() {
  _syncPredictionDate();
  const reservas = document.getElementById('txt-pred-reservas');
  const regresos = document.getElementById('txt-pred-regresos');
  if (reservas) reservas.value = '';
  if (regresos) regresos.value = '';
  if (typeof window.reiniciarPrediccion === 'function') {
    window.reiniciarPrediccion();
    _syncPredictionDate();
  } else {
    const step1 = document.getElementById('prediccion-paso-1');
    const step2 = document.getElementById('prediccion-paso-2');
    const tabla = document.getElementById('tabla-prediccion-container');
    if (step1) step1.style.display = 'block';
    if (step2) step2.style.display = 'none';
    if (tabla) tabla.innerHTML = '';
  }
}

window.abrirReporteActividadGestion = function () {
  _resetActividadModal();
  _toggleModalActive('modal-lector-reservas', true);
};

window.abrirPrediccionGestion = function () {
  _resetPrediccionModal();
  _toggleModalActive('modal-prediccion', true);
};

window.abrirAnalisisReservasGestion = function () {
  if (typeof window.abrirModalPDFReservas === 'function') {
    window.abrirModalPDFReservas();
    return;
  }
  const modal = document.getElementById('modal-pdf-reservas');
  if (modal) modal.style.display = 'flex';
};

window.addEventListener('mex-app-ready', () => {
  _syncPredictionDate();
  if (typeof window.validarTextareasActividad === 'function') {
    window.validarTextareasActividad();
  }
});

auth.onAuthStateChanged((user) => {
  if (!user) {
    window.location.replace('/login');
  }
});
