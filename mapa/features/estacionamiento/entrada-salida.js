// ═══════════════════════════════════════════════════════════
//  mapa/features/estacionamiento/entrada-salida.js
//  Registro de entradas y salidas de vehículos en parking.
//  Integra con el DOM de mapa.js via eventos delegados en
//  #map-stage. No modifica mapa.js directamente.
// ═══════════════════════════════════════════════════════════

import { esMapaEstacionamiento } from '/mapa/features/estacionamiento/grid.js';

const MODAL_ENTRADA_ID  = 'parking-entrada-modal';
const MODAL_SALIDA_ID   = 'parking-salida-modal';
const LOG_KEY           = 'parking:movimientos:v1';

// ── Helpers ──────────────────────────────────────────────────

function _txt(v) { return String(v || '').trim(); }
function _up(v)  { return _txt(v).toUpperCase(); }
function _esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _nowLabel() {
  return new Date().toLocaleString('es-MX', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function _api() { return window.api; }

function _showToast(msg) {
  if (typeof window.showToast === 'function') { window.showToast(msg); return; }
  const t = document.getElementById('toastEl') || document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ── Log de movimientos (localStorage) ───────────────────────

function _loadLog() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { return []; }
}

function _saveLog(entries) {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(entries.slice(0, 200))); } catch {}
}

function _appendLog(entry) {
  const log = _loadLog();
  log.unshift({ ...entry, at: _nowLabel() });
  _saveLog(log);
  _renderActivitySidebar(log);
}

function _renderActivitySidebar(log) {
  const list = document.getElementById('parking-activity-list');
  if (!list) return;
  list.innerHTML = (log || []).slice(0, 30).map(e => `
    <div class="parking-activity-item">
      <strong>${_esc(e.action)}</strong>
      <span>${_esc(e.detail || '')} &mdash; ${_esc(e.at)}</span>
    </div>
  `).join('');
}

// ── Modal de ENTRADA ─────────────────────────────────────────

function _getOrCreateModal(id, buildFn) {
  let el = document.getElementById(id);
  if (!el) { el = buildFn(); document.body.appendChild(el); }
  return el;
}

function _buildEntradaModal() {
  const el = document.createElement('div');
  el.id = MODAL_ENTRADA_ID;
  el.className = 'parking-modal-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Registrar entrada de vehículo');
  el.innerHTML = `
    <div class="parking-modal-box">
      <div class="parking-modal-head">
        <span class="material-icons">login</span>
        <strong>Registrar entrada</strong>
        <button type="button" class="parking-modal-close" aria-label="Cerrar">
          <span class="material-icons">close</span>
        </button>
      </div>
      <div class="parking-modal-body">
        <div class="parking-form-grid">
          <label class="parking-field">
            <span>Cajón</span>
            <input id="es-entrada-cajon" type="text" autocomplete="off" readonly />
          </label>
          <label class="parking-field">
            <span>Ticket / ID</span>
            <input id="es-entrada-ticket" type="text" autocomplete="off" placeholder="T-0001" />
          </label>
          <label class="parking-field">
            <span>Placas</span>
            <input id="es-entrada-placas" type="text" autocomplete="off" placeholder="ABC-123-A" />
          </label>
          <label class="parking-field">
            <span>Tipo</span>
            <select id="es-entrada-tipo">
              <option value="CLIENTE">Cliente</option>
              <option value="PENSION">Pensión</option>
              <option value="VIP">VIP</option>
              <option value="VISITA">Visita</option>
              <option value="STAFF">Staff</option>
            </select>
          </label>
          <label class="parking-field parking-field--full">
            <span>Auto / Descripción</span>
            <input id="es-entrada-modelo" type="text" autocomplete="off" placeholder="Toyota Corolla gris" />
          </label>
          <label class="parking-field parking-field--full">
            <span>Notas</span>
            <textarea id="es-entrada-notas" rows="2" placeholder="Observaciones opcionales"></textarea>
          </label>
        </div>
      </div>
      <div class="parking-modal-foot">
        <button type="button" class="parking-btn parking-btn--secondary" id="es-entrada-cancel">Cancelar</button>
        <button type="button" class="parking-btn parking-btn--primary" id="es-entrada-confirm">
          <span class="material-icons">check</span> Registrar entrada
        </button>
      </div>
    </div>
  `;

  el.querySelector('.parking-modal-close').addEventListener('click', () => cerrarEntrada());
  el.querySelector('#es-entrada-cancel').addEventListener('click', () => cerrarEntrada());
  el.addEventListener('click', e => { if (e.target === el) cerrarEntrada(); });
  el.querySelector('#es-entrada-confirm').addEventListener('click', _confirmarEntrada);
  return el;
}

function _buildSalidaModal() {
  const el = document.createElement('div');
  el.id = MODAL_SALIDA_ID;
  el.className = 'parking-modal-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Registrar salida de vehículo');
  el.innerHTML = `
    <div class="parking-modal-box">
      <div class="parking-modal-head">
        <span class="material-icons">logout</span>
        <strong>Registrar salida</strong>
        <button type="button" class="parking-modal-close" aria-label="Cerrar">
          <span class="material-icons">close</span>
        </button>
      </div>
      <div class="parking-modal-body">
        <div class="parking-form-grid">
          <label class="parking-field">
            <span>Unidad</span>
            <input id="es-salida-unidad" type="text" autocomplete="off" readonly />
          </label>
          <label class="parking-field">
            <span>Cajón</span>
            <input id="es-salida-cajon" type="text" autocomplete="off" readonly />
          </label>
          <label class="parking-field">
            <span>Placas</span>
            <input id="es-salida-placas" type="text" autocomplete="off" readonly />
          </label>
          <label class="parking-field">
            <span>Hora entrada</span>
            <input id="es-salida-entrada-at" type="text" autocomplete="off" readonly />
          </label>
          <label class="parking-field parking-field--full">
            <span>Notas de salida</span>
            <textarea id="es-salida-notas" rows="2" placeholder="Observaciones opcionales"></textarea>
          </label>
        </div>
        <div class="parking-salida-confirm-row">
          <span class="material-icons">warning</span>
          El vehículo será removido del cajón y quedará libre.
        </div>
      </div>
      <div class="parking-modal-foot">
        <button type="button" class="parking-btn parking-btn--secondary" id="es-salida-cancel">Cancelar</button>
        <button type="button" class="parking-btn parking-btn--danger" id="es-salida-confirm">
          <span class="material-icons">directions_car</span> Confirmar salida
        </button>
      </div>
    </div>
  `;

  el.querySelector('.parking-modal-close').addEventListener('click', () => cerrarSalida());
  el.querySelector('#es-salida-cancel').addEventListener('click', () => cerrarSalida());
  el.addEventListener('click', e => { if (e.target === el) cerrarSalida(); });
  el.querySelector('#es-salida-confirm').addEventListener('click', _confirmarSalida);
  return el;
}

// ── Estado del modal ─────────────────────────────────────────

let _entradaContext = null;
let _salidaContext  = null;

function _confirmarEntrada() {
  const ticket  = _up(document.getElementById('es-entrada-ticket')?.value || '');
  const placas  = _up(document.getElementById('es-entrada-placas')?.value || '');
  const tipo    = document.getElementById('es-entrada-tipo')?.value || 'CLIENTE';
  const modelo  = _txt(document.getElementById('es-entrada-modelo')?.value || '');
  const notas   = _txt(document.getElementById('es-entrada-notas')?.value || '');
  const cajon   = _entradaContext?.cajon || '';

  if (!ticket) { _showToast('Ingresa el ticket / ID del vehículo'); return; }
  if (!cajon)  { _showToast('No se detectó el cajón destino'); return; }

  const api = _api();
  const plazaId = window.__mexCurrentPlazaId || window.getMexCurrentPlaza?.() || '';

  const unitData = {
    mva: ticket,
    placas: placas || ticket,
    tipo,
    modelo,
    notas,
    ubicacion: cajon,
    estado: 'LISTO',
    extras: { parkingEntradaAt: _nowLabel(), parkingTipo: tipo },
  };

  const savePromise = (api && plazaId)
    ? api.insertarUnidadDesdeHTML?.(unitData, plazaId).catch(() => null)
    : Promise.resolve(null);

  savePromise.then(() => {
    _appendLog({ action: `Entrada: ${ticket}`, detail: `Cajón ${cajon} · ${modelo || placas || ''}` });
    _showToast(`✓ Entrada registrada: ${ticket} → ${cajon}`);
    cerrarEntrada();
    if (typeof window.refrescarDatos === 'function') window.refrescarDatos(true);
  });
}

function _confirmarSalida() {
  const notas = _txt(document.getElementById('es-salida-notas')?.value || '');
  const ctx   = _salidaContext;
  if (!ctx?.unitId) { _showToast('No se detectó la unidad a retirar'); return; }

  const api = _api();
  const plazaId = window.__mexCurrentPlazaId || window.getMexCurrentPlaza?.() || '';

  const savePromise = (api && plazaId && ctx.unitId)
    ? api.eliminarUnidad?.(ctx.unitId, plazaId, { motivo: 'salida-parking', notas }).catch(() => null)
    : Promise.resolve(null);

  savePromise.then(() => {
    _appendLog({ action: `Salida: ${ctx.unitId}`, detail: `Cajón ${ctx.cajon || ''} · ${ctx.placas || ''}` });
    _showToast(`✓ Salida registrada: ${ctx.unitId}`);
    cerrarSalida();
    if (typeof window.refrescarDatos === 'function') window.refrescarDatos(true);
  });
}

// ── API pública ──────────────────────────────────────────────

/**
 * Abre el modal de entrada para un cajón vacío.
 * @param {string} cajonId  — data-label del slot
 */
export function abrirEntrada(cajonId) {
  if (!esMapaEstacionamiento()) return;
  _entradaContext = { cajon: _up(cajonId) };

  const modal = _getOrCreateModal(MODAL_ENTRADA_ID, _buildEntradaModal);
  const cajonInput = modal.querySelector('#es-entrada-cajon');
  const ticketInput = modal.querySelector('#es-entrada-ticket');

  if (cajonInput) cajonInput.value = _entradaContext.cajon;
  if (ticketInput) { ticketInput.value = ''; ticketInput.focus(); }
  modal.querySelector('#es-entrada-placas').value = '';
  modal.querySelector('#es-entrada-modelo').value = '';
  modal.querySelector('#es-entrada-notas').value  = '';

  modal.classList.add('is-open');
}

/**
 * Abre el modal de salida para una unidad ya registrada.
 * @param {{ unitId, cajon, placas, modelo, entradaAt }} unit
 */
export function abrirSalida(unit = {}) {
  if (!esMapaEstacionamiento()) return;
  _salidaContext = { ...unit };

  const modal = _getOrCreateModal(MODAL_SALIDA_ID, _buildSalidaModal);
  modal.querySelector('#es-salida-unidad').value    = unit.unitId || '';
  modal.querySelector('#es-salida-cajon').value     = unit.cajon  || '';
  modal.querySelector('#es-salida-placas').value    = unit.placas || '';
  modal.querySelector('#es-salida-entrada-at').value = unit.entradaAt || '—';
  modal.querySelector('#es-salida-notas').value     = '';

  modal.classList.add('is-open');
}

export function cerrarEntrada() {
  document.getElementById(MODAL_ENTRADA_ID)?.classList.remove('is-open');
  _entradaContext = null;
}

export function cerrarSalida() {
  document.getElementById(MODAL_SALIDA_ID)?.classList.remove('is-open');
  _salidaContext = null;
}

/** Historial de movimientos almacenados localmente. */
export function getMovimientosLog() { return _loadLog(); }

// ── Delegación de clicks en el mapa ──────────────────────────
// Escucha double-click en .spot vacíos (entrada) y en .car (salida)
// cuando el modo estacionamiento está activo.

function _handleMapClick(event) {
  if (!esMapaEstacionamiento()) return;

  const car = event.target.closest('.car');
  if (car) {
    // Click en unidad → abrir salida (solo si el usuario pulsa el botón de salida)
    // La salida se abre explícitamente desde los botones del panel de unidad;
    // el double-click sobre el car abre el panel existente de mapa.js.
    return;
  }

  const spot = event.target.closest('.spot');
  if (!spot) return;

  // Solo actuar en spots vacíos con double-click para no interferir con drag-drop
  if (event.type === 'dblclick' && !spot.querySelector('.car')) {
    const cajonId = spot.dataset.label || spot.dataset.spot || '';
    if (cajonId) abrirEntrada(cajonId);
  }
}

/**
 * Inicializa el módulo en el stage del mapa.
 * Llamado por grid.js → syncEstacionamientoMode().
 */
export function initEntradaSalida() {
  if (!esMapaEstacionamiento()) return;

  const stage = document.getElementById('map-stage') || document.getElementById('yardStage');
  if (!stage || stage.dataset.esBound === '1') return;
  stage.dataset.esBound = '1';
  stage.addEventListener('dblclick', _handleMapClick);

  _renderActivitySidebar(_loadLog());
}

/** Exponer abrirSalida para el panel de unidad de mapa.js */
window._parkingAbrirSalida = abrirSalida;
