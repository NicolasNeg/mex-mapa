// ═══════════════════════════════════════════════════════════
//  mapa/features/estacionamiento/reservas.js
//  Gestión de reservas de cajones en modo parking.
//  Lee/escribe el campo `reserved` en la estructura del mapa
//  (mapa_config/{empresaId}__{PLAZA}/estructura) y aplica
//  decoración visual vía data-reserved en los .spot del DOM.
// ═══════════════════════════════════════════════════════════

import { esMapaEstacionamiento, applyEstacionamientoFilter } from '/mapa/features/estacionamiento/grid.js';

const MODAL_RESERVA_ID  = 'parking-reserva-modal';
const RESERVAS_KEY      = 'parking:reservas:v1';

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

function _showToast(msg) {
  if (typeof window.showToast === 'function') { window.showToast(msg); return; }
  const t = document.getElementById('toastEl') || document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ── Persistencia local ───────────────────────────────────────
// Respaldo localStorage mientras la estructura de Firestore no tiene
// campo `reserved` actualizable de forma directa por el módulo.

function _loadReservas() {
  try { return JSON.parse(localStorage.getItem(RESERVAS_KEY) || '{}'); } catch { return {}; }
}

function _saveReservas(map) {
  try { localStorage.setItem(RESERVAS_KEY, JSON.stringify(map)); } catch {}
}

/**
 * Reservar cajón en Firestore (campo reserved del elemento de estructura).
 * Fallback silencioso a localStorage si la API no está disponible.
 */
async function _persistReserva(cajonId, reserva) {
  const api = window.api;
  const plazaId = _up(window.__mexCurrentPlazaId || window.getMexCurrentPlaza?.() || '');
  if (api?.actualizarElementoEstructura && plazaId) {
    try {
      await api.actualizarElementoEstructura(cajonId, { isReserved: true, reservaMeta: reserva }, plazaId);
      return;
    } catch {}
  }
  const map = _loadReservas();
  map[`${plazaId}__${cajonId}`] = reserva;
  _saveReservas(map);
}

async function _borrarReserva(cajonId) {
  const api = window.api;
  const plazaId = _up(window.__mexCurrentPlazaId || window.getMexCurrentPlaza?.() || '');
  if (api?.actualizarElementoEstructura && plazaId) {
    try {
      await api.actualizarElementoEstructura(cajonId, { isReserved: false, reservaMeta: null }, plazaId);
      return;
    } catch {}
  }
  const map = _loadReservas();
  delete map[`${plazaId}__${cajonId}`];
  _saveReservas(map);
}

// ── Decorar DOM ──────────────────────────────────────────────

function _applyReservasToDOM() {
  if (!esMapaEstacionamiento()) return;
  const plazaId = _up(window.__mexCurrentPlazaId || window.getMexCurrentPlaza?.() || '');
  const stored = _loadReservas();

  document.querySelectorAll('.spot[data-label]').forEach(spot => {
    const cajonId = _up(spot.dataset.label || '');
    const key = `${plazaId}__${cajonId}`;
    const reserva = stored[key];
    const hasReserva = Boolean(reserva);

    spot.dataset.reserved = hasReserva ? 'true' : 'false';
    spot.classList.toggle('parking-reserved', hasReserva);

    // Mostrar badge de reserva si no hay unidad
    if (hasReserva && !spot.querySelector('.car')) {
      let badge = spot.querySelector('.parking-reserva-badge');
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'parking-reserva-badge';
        spot.appendChild(badge);
      }
      badge.textContent = reserva.nombre ? `Reservado: ${reserva.nombre}` : 'Reservado';
      badge.title = reserva.notas || '';
    } else {
      spot.querySelector('.parking-reserva-badge')?.remove();
    }
  });

  applyEstacionamientoFilter();
}

// ── Modal ─────────────────────────────────────────────────────

function _buildReservaModal() {
  const el = document.createElement('div');
  el.id = MODAL_RESERVA_ID;
  el.className = 'parking-modal-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Reservar cajón');
  el.innerHTML = `
    <div class="parking-modal-box">
      <div class="parking-modal-head">
        <span class="material-icons">event_available</span>
        <strong>Reservar cajón</strong>
        <button type="button" class="parking-modal-close" aria-label="Cerrar">
          <span class="material-icons">close</span>
        </button>
      </div>
      <div class="parking-modal-body">
        <div class="parking-form-grid">
          <label class="parking-field">
            <span>Cajón</span>
            <input id="rv-cajon" type="text" autocomplete="off" readonly />
          </label>
          <label class="parking-field">
            <span>Nombre / Cliente</span>
            <input id="rv-nombre" type="text" autocomplete="off" placeholder="Juan Pérez" />
          </label>
          <label class="parking-field">
            <span>Placas esperadas</span>
            <input id="rv-placas" type="text" autocomplete="off" placeholder="ABC-123-A" />
          </label>
          <label class="parking-field">
            <span>Hora de llegada</span>
            <input id="rv-hora" type="time" />
          </label>
          <label class="parking-field parking-field--full">
            <span>Notas</span>
            <textarea id="rv-notas" rows="2" placeholder="Observaciones opcionales"></textarea>
          </label>
        </div>
      </div>
      <div class="parking-modal-foot">
        <button type="button" class="parking-btn parking-btn--secondary" id="rv-cancel">Cancelar</button>
        <button type="button" class="parking-btn parking-btn--primary" id="rv-confirm">
          <span class="material-icons">bookmark_added</span> Reservar
        </button>
      </div>
    </div>
  `;

  el.querySelector('.parking-modal-close').addEventListener('click', cerrarReserva);
  el.querySelector('#rv-cancel').addEventListener('click', cerrarReserva);
  el.addEventListener('click', e => { if (e.target === el) cerrarReserva(); });
  el.querySelector('#rv-confirm').addEventListener('click', _confirmarReserva);
  return el;
}

function _getOrCreateModal(id, buildFn) {
  let el = document.getElementById(id);
  if (!el) { el = buildFn(); document.body.appendChild(el); }
  return el;
}

let _reservaContext = null;

async function _confirmarReserva() {
  const cajonId = _reservaContext?.cajonId;
  if (!cajonId) { _showToast('No se detectó el cajón'); return; }

  const nombre = _txt(document.getElementById('rv-nombre')?.value || '');
  const placas  = _up(document.getElementById('rv-placas')?.value || '');
  const hora    = _txt(document.getElementById('rv-hora')?.value || '');
  const notas   = _txt(document.getElementById('rv-notas')?.value || '');

  if (!nombre) { _showToast('Ingresa el nombre del cliente'); return; }

  const reserva = { cajonId, nombre, placas, hora, notas, creadaAt: _nowLabel() };
  await _persistReserva(cajonId, reserva);
  _applyReservasToDOM();
  _showToast(`✓ Cajón ${cajonId} reservado para ${nombre}`);
  cerrarReserva();
}

// ── API pública ──────────────────────────────────────────────

/**
 * Abre el modal de reserva para un cajón vacío y libre.
 * @param {string} cajonId
 */
export function abrirReserva(cajonId) {
  if (!esMapaEstacionamiento()) return;
  _reservaContext = { cajonId: _up(cajonId) };

  const modal = _getOrCreateModal(MODAL_RESERVA_ID, _buildReservaModal);
  modal.querySelector('#rv-cajon').value = _reservaContext.cajonId;
  modal.querySelector('#rv-nombre').value = '';
  modal.querySelector('#rv-placas').value = '';
  modal.querySelector('#rv-hora').value   = '';
  modal.querySelector('#rv-notas').value  = '';

  modal.classList.add('is-open');
  modal.querySelector('#rv-nombre')?.focus();
}

export function cerrarReserva() {
  document.getElementById(MODAL_RESERVA_ID)?.classList.remove('is-open');
  _reservaContext = null;
}

/**
 * Cancela la reserva de un cajón.
 * @param {string} cajonId
 */
export async function cancelarReserva(cajonId) {
  if (!cajonId) return;
  await _borrarReserva(_up(cajonId));
  _applyReservasToDOM();
  _showToast(`Reserva cancelada: ${_up(cajonId)}`);
}

/**
 * Devuelve las reservas activas (desde localStorage fallback).
 */
export function getReservasActivas() {
  const plazaId = _up(window.__mexCurrentPlazaId || window.getMexCurrentPlaza?.() || '');
  const stored = _loadReservas();
  return Object.entries(stored)
    .filter(([k]) => !plazaId || k.startsWith(`${plazaId}__`))
    .map(([k, v]) => ({ key: k, cajonId: k.split('__').pop(), ...v }));
}

// ── Integración DOM ──────────────────────────────────────────
// Right-click en spot vacío libre → menú contextual con opción de reservar

function _handleContextMenu(event) {
  if (!esMapaEstacionamiento()) return;
  const spot = event.target.closest('.spot');
  if (!spot || spot.querySelector('.car')) return;

  const cajonId = _up(spot.dataset.label || '');
  if (!cajonId) return;

  event.preventDefault();
  _showContextMenu(event.clientX, event.clientY, cajonId, spot);
}

function _showContextMenu(x, y, cajonId, spot) {
  document.getElementById('parking-ctx-menu')?.remove();

  const isReserved = spot.dataset.reserved === 'true';
  const menu = document.createElement('div');
  menu.id = 'parking-ctx-menu';
  menu.className = 'parking-ctx-menu';
  menu.style.cssText = `left:${x}px;top:${y}px`;

  const opts = isReserved
    ? [{ label: 'Cancelar reserva', icon: 'bookmark_remove', action: () => cancelarReserva(cajonId) }]
    : [
        { label: 'Reservar cajón',  icon: 'bookmark_add',    action: () => abrirReserva(cajonId) },
        { label: 'Registrar entrada', icon: 'login',          action: () => window._parkingAbrirEntrada?.(cajonId) },
      ];

  menu.innerHTML = opts.map(o => `
    <button type="button" data-ctx="${_esc(o.label)}">
      <span class="material-icons">${_esc(o.icon)}</span>${_esc(o.label)}
    </button>
  `).join('');

  document.body.appendChild(menu);

  opts.forEach((o, i) => {
    menu.querySelectorAll('button')[i]?.addEventListener('click', () => {
      menu.remove();
      o.action();
    });
  });

  const dismiss = e => {
    if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', dismiss); }
  };
  setTimeout(() => document.addEventListener('click', dismiss), 10);
}

/**
 * Inicializa el módulo de reservas.
 * Llamado por grid.js → syncEstacionamientoMode().
 */
export function initReservas() {
  if (!esMapaEstacionamiento()) return;

  const stage = document.getElementById('map-stage') || document.getElementById('yardStage');
  if (!stage || stage.dataset.reservasBound === '1') return;
  stage.dataset.reservasBound = '1';
  stage.addEventListener('contextmenu', _handleContextMenu);

  _applyReservasToDOM();
}

/** Refrescar decoración cuando el mapa se redibuja. */
export function refreshReservasDecoration() { _applyReservasToDOM(); }

/** Exponer al panel de mapa.js para acceso global */
window._parkingAbrirEntrada = (cajonId) => {
  import('/mapa/features/estacionamiento/entrada-salida.js')
    .then(m => m.abrirEntrada(cajonId)).catch(() => {});
};
