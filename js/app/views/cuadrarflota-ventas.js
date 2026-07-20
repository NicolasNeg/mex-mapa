// ============================================================================
// /js/app/views/cuadrarflota-ventas.js
// Vista dedicada para que Ventas revise, corrija y firme el cierre del cuadre
// que el auxiliar envio desde /app/cuadrarflota. No toca cuadrarflota.js.
// ============================================================================

import { getState, getCurrentPlaza } from '/js/app/app-state.js';
import {
  obtenerRevisionAuditoria,
  obtenerDatosFlotaConsola,
  procesarAuditoriaDesdeAdmin
} from '/js/core/database.js';

let _ctr = null;
let _navigate = null;
let _s = null;
let _sig = { canvas: null, ctx: null, drawing: false, hasInk: false, dataUrl: '' };
let _swipe = null;

// Niveles de gasolina desde las listas globales (Panel Admin → Gasolinas).
function _gasCatalog() {
  const configured = Array.isArray(window.MEX_CONFIG?.listas?.gasolinas)
    ? window.MEX_CONFIG.listas.gasolinas
    : [];
  const values = configured
    .map(item => String((item && typeof item === 'object' ? (item.nombre ?? item.valor ?? '') : item) || '').trim().toUpperCase())
    .filter(Boolean);
  const base = values.length ? values : ['F', '3/4', '1/2', '1/4', 'E'];
  if (!base.includes('N/A')) base.push('N/A');
  return base;
}

export async function mount({ container, navigate }) {
  unmount();
  _ctr = container;
  _navigate = navigate;
  _s = {
    loading: true,
    busy: false,
    completed: false,
    error: '',
    plaza: '',
    mission: null,
    units: [],
    localByMva: new Map(),
    view: 'card',
    search: '',
    currentIndex: 0,
    showExtra: false,
    extra: { mva: '', modelo: '', placas: '', km: '', gasolina: 'N/A' },
    step: 'review'
  };

  _renderLoading();
  _bind();
  await _load();
}

export function unmount() {
  _ctr = null;
  _navigate = null;
  _s = null;
  _sig = { canvas: null, ctx: null, drawing: false, hasInk: false, dataUrl: '' };
  _swipe = null;
}

function _bind() {
  const click = event => _onClick(event);
  const input = event => _onInput(event);
  const change = event => _onChange(event);
  const pointerDown = event => _onCardPointerDown(event);
  const pointerMove = event => _onCardPointerMove(event);
  const pointerUp = event => _onCardPointerUp(event);
  _ctr.addEventListener('click', click);
  _ctr.addEventListener('input', input);
  _ctr.addEventListener('change', change);
  _ctr.addEventListener('pointerdown', pointerDown);
  _ctr.addEventListener('pointermove', pointerMove);
  _ctr.addEventListener('pointerup', pointerUp);
  _ctr.addEventListener('pointercancel', pointerUp);
}

async function _resolveVentasMission() {
  const params = new URLSearchParams(window.location.search || '');
  const requestedMissionId = _normId(params.get('missionId'));
  const requestedPlaza = _normPlaza(params.get('plaza')) || _normPlaza(getCurrentPlaza());
  if (!requestedPlaza) return null;
  const raw = await obtenerRevisionAuditoria(requestedPlaza).catch(() => []);
  const { units, meta } = _missionUnitsAndMeta(raw);
  if (!units.length) return null;
  const metaMissionId = _normId(meta.missionId);
  if (requestedMissionId && metaMissionId && requestedMissionId !== metaMissionId) return null;
  return { plaza: requestedPlaza, units, meta: { ...meta, plaza: requestedPlaza, missionId: metaMissionId || requestedMissionId } };
}

function _missionUnitsAndMeta(raw) {
  if (Array.isArray(raw)) {
    return { units: raw, meta: raw.meta || {} };
  }
  if (raw && typeof raw === 'object') {
    const units = Array.isArray(raw.unidades)
      ? raw.unidades
      : (Array.isArray(raw.items) ? raw.items : []);
    return { units, meta: raw.meta || raw };
  }
  return { units: [], meta: {} };
}

async function _load() {
  if (!_s) return;
  _s.loading = true;
  _s.error = '';
  _s.completed = false;
  _renderLoading();

  try {
    const found = await _resolveVentasMission();
    if (!found) {
      _s.loading = false;
      _s.error = 'No hay ninguna revisión de Ventas pendiente en esta plaza.';
      _paint();
      return;
    }

    const fleet = await obtenerDatosFlotaConsola(found.plaza).catch(() => []);
    const localByMva = new Map((Array.isArray(fleet) ? fleet : []).map(unit => [_normMva(unit.mva), unit]));
    _s.plaza = found.plaza;
    _s.mission = found.meta;
    _s.localByMva = localByMva;
    _s.units = _buildAuditUnits(found.units, localByMva);
    _s.currentIndex = _firstPendingIndex(_s.units);
    _s.loading = false;
    _s.error = '';
    _paint();
  } catch (err) {
    console.error('[cuadrarflota-ventas]', err);
    _s.loading = false;
    _s.error = err?.message || 'No se pudo cargar la revisión de cuadre.';
    _paint();
  }
}

function _buildAuditUnits(units = [], localByMva = new Map()) {
  return (Array.isArray(units) ? units : []).map(unit => {
    const mva = _normMva(unit.mva);
    const local = localByMva.get(mva) || {};
    const modelo = String(unit.modelo || local.modelo || 'S/M').trim() || 'S/M';
    const gas = String(local.gasolina ?? unit.gasolina ?? unit.gas ?? 'N/A').toUpperCase().trim() || 'N/A';
    const categoria = _modelCategoria(modelo, local.categoria || unit.categoria);
    return {
      ...unit,
      mva,
      modelo,
      placas: String(unit.placas || local.placas || 'S/P').trim() || 'S/P',
      categoria,
      estado: local.estado || unit.estado || '',
      ubicacion: local.ubicacion || unit.ubicacion || local.pos || unit.pos || '',
      gasolinaSistema: gas,
      gasolinaCorregida: gas,
      gasolina: gas,
      km: local.km ?? unit.km ?? '',
      status: unit.status === 'EXTRA' ? 'EXTRA' : 'PENDIENTE',
      notas: unit.notas || ''
    };
  });
}

function _paint() {
  if (!_ctr || !_s) return;
  if (_s.loading) {
    _renderLoading();
    return;
  }
  if (_s.completed) {
    _ctr.innerHTML = _completedHtml();
    return;
  }
  if (_s.error) {
    _ctr.innerHTML = _errorHtml(_s.error);
    return;
  }

  const summary = _summary();

  const isSign = _s.step === 'sign';

  _ctr.innerHTML = `
    <section class="cf cfv ${isSign ? 'is-fullscreen-sign' : ''}" aria-busy="${_s.busy ? 'true' : 'false'}">
      <div class="cf-shell">
        ${isSign ? '' : `
        <header class="cf-head">
          <div class="cf-head-copy">
            <p class="cf-eyebrow">Revisión de Ventas</p>
            <h1>Cuadre de flota</h1>
            <p class="cf-head-meta">${esc(_s.plaza || 'SIN PLAZA')} · Recibido de ${esc(_s.mission?.auxiliarNombre || _s.mission?.destinatarioNombre || 'auxiliar')}</p>
          </div>
          <button type="button" class="cf-icon-btn" data-action="reload" title="Recargar" aria-label="Recargar">
            <span class="material-symbols-outlined">sync</span>
          </button>
        </header>
        `}

        ${isSign ? _signStepHtml(summary) : _reviewStepHtml(summary)}
      </div>

      ${_s.showExtra ? _extraModalHtml() : ''}
    </section>
  `;
  if (isSign) _setupSignatureCanvas();
}

function _reviewStepHtml(summary) {
  return `
    <div class="cf-toolbar">
      <label class="cf-search">
        <span class="material-symbols-outlined">search</span>
        <input data-search value="${esc(_s.search)}" placeholder="Buscar MVA, placas o modelo" aria-label="Buscar unidades">
      </label>
      <div class="cf-view-toggle" role="tablist" aria-label="Vista">
        <button type="button" role="tab" aria-selected="${_s.view === 'card'}" class="${_s.view === 'card' ? 'active' : ''}" data-action="view-card">
          <span class="material-symbols-outlined">style</span>
          Tarjeta
        </button>
        <button type="button" role="tab" aria-selected="${_s.view === 'list'}" class="${_s.view === 'list' ? 'active' : ''}" data-action="view-list">
          <span class="material-symbols-outlined">view_list</span>
          Lista
        </button>
      </div>
      <button type="button" class="cf-btn secondary" data-action="open-extra">
        <span class="material-symbols-outlined">add</span>
        Sobrante
      </button>
    </div>

    <main class="cf-main">${_mainHtml()}</main>

    <div class="cf-flow-next">
      <button type="button" class="cf-btn primary wide cf-btn-island" data-action="go-step" data-step="sign"
        ${summary.pendientes > 0 ? 'disabled aria-disabled="true"' : ''}>
        <span>${summary.pendientes > 0 ? `Faltan ${summary.pendientes} por revisar` : 'Continuar a firma'}</span>
        <span class="cf-btn-icon"><span class="material-symbols-outlined">${summary.pendientes > 0 ? 'lock' : 'draw'}</span></span>
      </button>
    </div>
  `;
}

function _signStepHtml(summary) {
  return `
    <section class="cf-sign-shell">
      <div class="cf-sign">
        <div class="cf-sign-copy">
          <p class="cf-eyebrow">Paso final · Firma de Ventas</p>
          <h2>Cerrar cuadre</h2>
          <p class="cf-sign-note">Revisaste ${summary.revisadas} de ${summary.total} unidades. Firma para cerrar el cuadre.</p>
        </div>
        <label class="cf-field">
          <span>Firmado por</span>
          <div class="cf-locked-name">
            <span class="material-symbols-outlined">lock</span>
            <input value="${esc(_actorName())}" readonly aria-readonly="true" tabindex="-1">
          </div>
        </label>
        <div class="cf-sign-pad">
          <canvas id="cfSignatureCanvas" width="680" height="180" aria-label="Firma digital"></canvas>
          <button type="button" class="cf-clear-sign" data-action="clear-signature">Limpiar firma</button>
        </div>
        <div class="cf-sign-actions">
          <button type="button" class="cf-btn secondary" data-action="go-step" data-step="review">
            <span class="material-symbols-outlined">arrow_back</span>
            Volver a revisar
          </button>
          <button type="button" class="cf-btn primary cf-btn-island" data-action="submit" ${_s.busy ? 'disabled' : ''}>
            <span>${_s.busy ? 'Cerrando...' : 'Firmar y cerrar cuadre'}</span>
            <span class="cf-btn-icon"><span class="material-symbols-outlined">${_s.busy ? 'sync' : 'verified_user'}</span></span>
          </button>
        </div>
      </div>
    </section>
  `;
}

function _mainHtml() {
  const visible = _visibleUnits();
  if (_s.view === 'list') return _listHtml(visible);
  return _cardHtml(_currentUnit(visible), visible.length);
}

// Repinta solo la zona de unidades (busqueda): conserva el foco del input.
function _paintMain() {
  const main = _ctr?.querySelector('.cf-main');
  if (main) main.innerHTML = _mainHtml();
}

function _renderLoading() {
  if (!_ctr) return;
  _ctr.innerHTML = `
    <section class="cf cf-loading" aria-busy="true">
      <div class="cf-skel-head"><span></span><strong></strong><em></em></div>
      <div class="cf-skel-grid">
        ${Array.from({ length: 4 }).map(() => '<i></i>').join('')}
      </div>
      <div class="cf-skel-card"></div>
    </section>
  `;
}

function _errorHtml(message) {
  return `
    <section class="cf cf-state">
      <div class="cf-state-card">
        <span class="material-symbols-outlined">assignment_late</span>
        <h1>Sin revisión disponible</h1>
        <p>${esc(message)}</p>
        <div class="cf-state-actions">
          <button type="button" class="cf-btn primary" data-action="reload"><span class="material-symbols-outlined">sync</span>Recargar</button>
          <button type="button" class="cf-btn secondary" data-action="go-map"><span class="material-symbols-outlined">map</span>Ir al mapa</button>
        </div>
      </div>
    </section>
  `;
}

function _completedHtml() {
  return `
    <section class="cf cf-state">
      <div class="cf-state-card success">
        <span class="material-symbols-outlined">task_alt</span>
        <h1>Cuadre cerrado</h1>
        <p>El cuadre quedó cerrado. La plaza ya está lista para una nueva misión de patio.</p>
        <div class="cf-state-actions">
          <button type="button" class="cf-btn primary" data-action="go-map"><span class="material-symbols-outlined">map</span>Volver al mapa</button>
        </div>
      </div>
    </section>
  `;
}

function _cardHtml(unit, visibleCount) {
  if (!unit) {
    return `<div class="cf-empty"><span class="material-symbols-outlined">search_off</span><strong>Sin unidades visibles</strong><p>Ajusta la busqueda para continuar.</p></div>`;
  }
  const idx = _s.units.findIndex(item => item === unit);
  const imgUrl = _modelImageUrl(unit.modelo);
  const categoria = unit.categoria || _modelCategoria(unit.modelo);
  return `
    <section class="cf-card-wrap">
      <div class="cf-card-count">${visibleCount} coincidencia(s) · ${idx + 1} de ${_s.units.length}</div>
      <div class="cf-card-shell">
        <article class="cf-card-main ${_statusClass(unit.status)}" data-card-mva="${esc(unit.mva)}">
          <div class="cf-card-status">${_statusLabel(unit.status)}</div>
          <div class="cf-card-img"><img src="${esc(imgUrl || '/img/default_car.png')}" alt="${esc(unit.modelo)}" loading="lazy" draggable="false" onerror="this.src='/img/default_car.png'"></div>
          <h2>${esc(unit.mva)}</h2>
          <p>${esc(unit.modelo)} · ${esc(unit.placas)}</p>
          <div class="cf-card-meta">
            ${categoria ? `<span class="cf-chip">${esc(categoria)}</span>` : ''}
            <span>${esc(unit.estado || 'SIN ESTADO')}</span>
            <span>${esc(unit.ubicacion || 'SIN UBICACION')}</span>
          </div>
          <div class="cf-fields">
            ${_unitFields(unit)}
          </div>
        </article>
      </div>
      <div class="cf-card-actions">
        <button type="button" class="cf-swipe-btn bad" data-action="mark-missing" data-mva="${esc(unit.mva)}">
          <span class="material-symbols-outlined">close</span>
          Faltante
        </button>
        <button type="button" class="cf-swipe-btn ghost" data-action="skip">
          <span class="material-symbols-outlined">redo</span>
          Omitir
        </button>
        <button type="button" class="cf-swipe-btn ok" data-action="mark-ok" data-mva="${esc(unit.mva)}">
          <span class="material-symbols-outlined">check</span>
          Presente
        </button>
      </div>
    </section>
  `;
}

function _listHtml(units) {
  if (!units.length) {
    return `<div class="cf-empty"><span class="material-symbols-outlined">search_off</span><strong>Sin coincidencias</strong><p>Busca por MVA, placas o modelo.</p></div>`;
  }
  return `
    <div class="cf-list">
      ${units.map(unit => `
        <article class="cf-row ${_statusClass(unit.status)}">
          <div class="cf-row-id">
            <strong>${esc(unit.mva)}</strong>
            <span>${esc(unit.modelo)} · ${esc(unit.placas)}</span>
          </div>
          <div class="cf-row-fields">${_unitFields(unit)}</div>
          <div class="cf-row-actions">
            <button type="button" class="cf-icon-btn bad" data-action="mark-missing" data-mva="${esc(unit.mva)}" title="Faltante"><span class="material-symbols-outlined">close</span></button>
            <button type="button" class="cf-icon-btn ok" data-action="mark-ok" data-mva="${esc(unit.mva)}" title="Presente"><span class="material-symbols-outlined">check</span></button>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function _fuelToPct(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase();
  if (!s || s === 'N/A' || s === 'NA' || s === '-') return null;
  if (/^(F|FULL|LLENO|LLENA)$/.test(s)) return 100;
  if (/^(H|HALF|MEDIO|MEDIA|1\/2)$/.test(s)) return 50;
  if (/^(E|EMPTY|VAC[IÍ]O|VAC[IÍ]A)$/.test(s)) return 0;
  const frac = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (frac) {
    const den = parseFloat(frac[2]);
    if (den > 0) return Math.max(0, Math.min(100, Math.round(parseFloat(frac[1]) / den * 100)));
  }
  const n = parseFloat(s.replace('%', '').replace(',', '.'));
  if (!Number.isNaN(n)) return Math.max(0, Math.min(100, Math.round(n)));
  return null;
}

function _fuelColor(pct) {
  const t = Math.max(0, Math.min(1, pct / 80));
  const r = Math.round(220 + (37 - 220) * t);
  const g = Math.round(38 + (99 - 38) * t);
  const b = Math.round(38 + (235 - 38) * t);
  return `rgb(${r},${g},${b})`;
}

function _gasBarHtml(gas) {
  const pct = _fuelToPct(gas);
  if (pct == null) {
    return `<div class="cf-gas-bar is-empty" data-gas-bar aria-hidden="true"><span style="width:0%"></span></div>`;
  }
  return `<div class="cf-gas-bar" data-gas-bar aria-label="Gasolina ${pct}%"><span style="width:${pct}%;background:${_fuelColor(pct)}"></span></div>`;
}

function _unitFields(unit) {
  const gas = String(unit.gasolinaCorregida || unit.gasolina || 'N/A').toUpperCase();
  return `
    <label class="cf-field compact cf-field-gas">
      <span>Gasolina</span>
      <select class="cf-gas" data-gas="${esc(unit.mva)}">${_gasOptions(gas)}</select>
      ${_gasBarHtml(gas)}
    </label>
    <label class="cf-field compact">
      <span>Kilometraje</span>
      <input class="cf-km" data-km="${esc(unit.mva)}" inputmode="numeric" value="${esc(unit.km ?? '')}" placeholder="KM">
    </label>
  `;
}

function _extraModalHtml() {
  return `
    <div class="cf-modal-backdrop" data-action="close-extra">
      <section class="cf-modal" role="dialog" aria-modal="true" data-cf-modal-card>
        <header>
          <h2>Anadir sobrante</h2>
          <button type="button" class="cf-icon-btn" data-action="close-extra"><span class="material-symbols-outlined">close</span></button>
        </header>
        <label class="cf-field"><span>MVA</span><input data-extra="mva" value="${esc(_s.extra.mva)}" placeholder="C1234"></label>
        <label class="cf-field"><span>Modelo</span><input data-extra="modelo" value="${esc(_s.extra.modelo)}" placeholder="Modelo"></label>
        <label class="cf-field"><span>Placas</span><input data-extra="placas" value="${esc(_s.extra.placas)}" placeholder="S/P"></label>
        <div class="cf-modal-grid">
          <label class="cf-field"><span>Gasolina</span><select data-extra="gasolina">${_gasOptions(_s.extra.gasolina)}</select></label>
          <label class="cf-field"><span>Kilometraje</span><input data-extra="km" inputmode="numeric" value="${esc(_s.extra.km)}" placeholder="KM"></label>
        </div>
        <button type="button" class="cf-btn primary wide" data-action="save-extra"><span class="material-symbols-outlined">add</span>Agregar sobrante</button>
      </section>
    </div>
  `;
}

function _onInput(event) {
  if (!_s) return;
  const target = event.target;
  if (target.matches('[data-search]')) {
    _s.search = target.value;
    _paintMain();
    return;
  }
  if (target.matches('[data-km]')) {
    const unit = _unitByMva(target.dataset.km);
    if (unit) unit.km = target.value.replace(/[^\d]/g, '');
    return;
  }
  if (target.matches('[data-extra]')) {
    _s.extra[target.dataset.extra] = target.value;
  }
}

function _onChange(event) {
  if (!_s) return;
  const target = event.target;
  if (target.matches('[data-gas]')) {
    const unit = _unitByMva(target.dataset.gas);
    if (unit) {
      const value = String(target.value || 'N/A').toUpperCase();
      unit.gasolinaCorregida = value;
      unit.gasolina = value;
      const bar = target.closest('.cf-field-gas')?.querySelector('[data-gas-bar]');
      const fill = bar?.querySelector('span');
      const pct = _fuelToPct(value);
      if (bar && fill) {
        if (pct == null) {
          bar.classList.add('is-empty');
          fill.style.width = '0%';
          fill.style.background = '';
        } else {
          bar.classList.remove('is-empty');
          fill.style.width = `${pct}%`;
          fill.style.background = _fuelColor(pct);
        }
      }
    }
  }
  if (target.matches('[data-extra]')) {
    _s.extra[target.dataset.extra] = target.value;
  }
}

async function _onClick(event) {
  if (!_s) return;
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) return;

  // Clic en el cuerpo del modal (sin botón) no debe cerrar por el backdrop.
  const action = actionEl.dataset.action;
  if (
    action === 'close-extra'
    && actionEl.classList.contains('cf-modal-backdrop')
    && event.target.closest('[data-cf-modal-card]')
  ) {
    return;
  }

  const mva = actionEl.dataset.mva || '';

  if (action === 'reload') { await _load(); return; }
  if (action === 'go-map') { _navigate?.('/app/mapa'); return; }
  if (action === 'go-step') {
    const step = actionEl.dataset.step;
    if (step === 'sign') {
      const pending = _s.units.filter(u => u.status === 'PENDIENTE').length;
      if (pending > 0) {
        _toast(`Completa las ${pending} unidades pendientes antes de firmar.`, 'warning');
        return;
      }
    }
    if (step === 'sign' || step === 'review') {
      _captureVisibleInputs();
      _s.step = step;
      _paint();
    }
    return;
  }
  if (action === 'view-card') { _captureVisibleInputs(); _s.view = 'card'; _paint(); return; }
  if (action === 'view-list') { _captureVisibleInputs(); _s.view = 'list'; _paint(); return; }
  if (action === 'open-extra') { _s.showExtra = true; _paint(); return; }
  if (action === 'close-extra') { _s.showExtra = false; _paint(); return; }
  if (action === 'save-extra') { _saveExtra(); return; }
  if (action === 'clear-signature') { _clearSignature(); return; }
  if (action === 'skip') { _skipCurrent(); return; }
  if (action === 'mark-ok') { _markUnit(mva, 'OK'); return; }
  if (action === 'mark-missing') { _markUnit(mva, 'FALTANTE'); return; }
  if (action === 'submit') { await _submit(); }
}

function _markUnit(mva, status) {
  const unit = _unitByMva(mva);
  if (!unit) return;
  _captureVisibleInputs();
  unit.status = unit.status === status ? 'PENDIENTE' : status;
  _s.currentIndex = _nextPendingIndexAfter(_s.units.findIndex(item => item === unit));
  if (_s.units.length && !_s.units.some(item => item.status === 'PENDIENTE')) {
    _s.step = 'sign';
    _toast('Revisión completa. Firma para cerrar el cuadre.', 'success');
  }
  _paint();
}

function _skipCurrent() {
  const unit = _currentUnit(_visibleUnits());
  if (!unit) return;
  _s.currentIndex = _nextPendingIndexAfter(_s.units.findIndex(item => item === unit), false);
  _paint();
}

function _saveExtra() {
  const mva = _normMva(_s.extra.mva);
  const modelo = String(_s.extra.modelo || '').trim().toUpperCase();
  const placas = String(_s.extra.placas || 'S/P').trim().toUpperCase() || 'S/P';
  if (!mva || !modelo) {
    _toast('Captura MVA y modelo del sobrante.', 'error');
    return;
  }
  if (_s.units.some(unit => unit.mva === mva)) {
    _s.search = mva;
    _s.showExtra = false;
    _toast('Esa unidad ya esta en la lista.', 'warning');
    _paint();
    return;
  }
  _s.units.push({
    mva,
    modelo,
    placas,
    status: 'EXTRA',
    gasolinaSistema: 'N/A',
    gasolinaCorregida: String(_s.extra.gasolina || 'N/A').toUpperCase(),
    gasolina: String(_s.extra.gasolina || 'N/A').toUpperCase(),
    km: String(_s.extra.km || '').replace(/[^\d]/g, ''),
    ubicacion: 'SOBRANTE',
    estado: 'SOBRANTE',
    notas: 'Sobrante registrado por ventas'
  });
  _s.extra = { mva: '', modelo: '', placas: '', km: '', gasolina: 'N/A' };
  _s.showExtra = false;
  _s.search = mva;
  _toast('Sobrante agregado.', 'success');
  _paint();
}

async function _submit() {
  if (!_s || _s.busy) return;
  _captureVisibleInputs();
  const pending = _s.units.filter(unit => unit.status === 'PENDIENTE');
  if (pending.length) {
    _toast(`Completa las ${pending.length} unidades pendientes (Presente o Faltante) antes de cerrar.`, 'warning');
    _s.step = 'review';
    _paint();
    return;
  }
  // El nombre siempre sale del perfil de quien tiene la sesion abierta (no editable).
  const signedName = _actorName();
  if (!_sig.hasInk) {
    _toast('La firma digital esta vacia.', 'error');
    return;
  }

  _s.busy = true;
  _sig.dataUrl = _sig.canvas?.toDataURL('image/png') || _sig.dataUrl || '';
  _paint();
  try {
    const stats = _summary();
    const mission = _s.mission || {};
    const meta = {
      missionId: _normId(mission.missionId),
      auxiliarDocId: mission.auxiliarDocId || mission.destinatarioDocId || '',
      auxiliarNombre: mission.auxiliarNombre || mission.destinatarioNombre || '',
      firmaAuxiliar: mission.firmaAuxiliarNombre || mission.auxiliarNombre || '',
      firmaAuxiliarUrl: mission.firmaAuxiliarUrl || '',
      firmaVentas: signedName,
      firmaNombre: signedName,
      firmaDataUrl: _sig.dataUrl,
      stats
    };
    const payload = _s.units.map(unit => ({ ...unit }));
    const res = await procesarAuditoriaDesdeAdmin(payload, signedName, stats, _s.plaza, meta);
    if (!(res === 'EXITO' || (res && res.exito))) throw new Error('Respuesta invalida al cerrar el cuadre.');
    _s.busy = false;
    _s.completed = true;
    _paint();
    _toast('Cuadre firmado y cerrado.', 'success');
  } catch (err) {
    console.error('[cuadrarflota-ventas] cerrar', err);
    _s.busy = false;
    _paint();
    const code = String(err?.code || err?.message || '');
    const denied = /permission|insufficient|PERMISSION_DENIED/i.test(code);
    _toast(
      denied
        ? 'No se pudo cerrar: permisos de Firestore. Recarga e intenta de nuevo; si persiste, avisa a Programador.'
        : (err?.message || 'No se pudo cerrar el cuadre.'),
      'error'
    );
  }
}

function _onCardPointerDown(event) {
  const card = event.target.closest('.cf-card-main');
  if (!card || !_s || _s.view !== 'card') return;
  _swipe = { card, id: event.pointerId, x: event.clientX, dx: 0 };
  card.setPointerCapture?.(event.pointerId);
}

function _onCardPointerMove(event) {
  if (!_swipe || event.pointerId !== _swipe.id) return;
  _swipe.dx = event.clientX - _swipe.x;
  const rot = Math.max(-8, Math.min(8, _swipe.dx / 20));
  _swipe.card.style.transform = `translateX(${_swipe.dx}px) rotate(${rot}deg)`;
  _swipe.card.dataset.swipe = _swipe.dx > 0 ? 'ok' : 'missing';
}

function _onCardPointerUp(event) {
  if (!_swipe || event.pointerId !== _swipe.id) return;
  const { card, dx } = _swipe;
  _swipe = null;
  const mva = card.dataset.cardMva || '';
  if (Math.abs(dx) > 90) {
    _markUnit(mva, dx > 0 ? 'OK' : 'FALTANTE');
    return;
  }
  card.style.transform = '';
  card.removeAttribute('data-swipe');
}

function _setupSignatureCanvas() {
  const canvas = document.getElementById('cfSignatureCanvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const dataUrl = _sig.dataUrl;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#101828';
  _sig.canvas = canvas;
  _sig.ctx = ctx;
  if (dataUrl) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
    img.src = dataUrl;
  }
  canvas.onpointerdown = event => {
    const p = _canvasPoint(event);
    _sig.drawing = true;
    _sig.hasInk = true;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    canvas.setPointerCapture?.(event.pointerId);
  };
  canvas.onpointermove = event => {
    if (!_sig.drawing) return;
    const p = _canvasPoint(event);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  canvas.onpointerup = canvas.onpointercancel = () => {
    if (!_sig.drawing) return;
    _sig.drawing = false;
    _sig.dataUrl = canvas.toDataURL('image/png');
  };
}

function _clearSignature() {
  if (!_sig.ctx || !_sig.canvas) return;
  _sig.ctx.clearRect(0, 0, _sig.canvas.width, _sig.canvas.height);
  _sig.hasInk = false;
  _sig.dataUrl = '';
}

function _canvasPoint(event) {
  const rect = _sig.canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function _captureVisibleInputs() {
  _ctr?.querySelectorAll('[data-km]').forEach(input => {
    const unit = _unitByMva(input.dataset.km);
    if (unit) unit.km = String(input.value || '').replace(/[^\d]/g, '');
  });
  _ctr?.querySelectorAll('[data-gas]').forEach(select => {
    const unit = _unitByMva(select.dataset.gas);
    if (unit) {
      const value = String(select.value || 'N/A').toUpperCase();
      unit.gasolinaCorregida = value;
      unit.gasolina = value;
    }
  });
}

function _visibleUnits() {
  const term = _normSearch(_s.search);
  if (!term) return _s.units;
  return _s.units.filter(unit => _normSearch(`${unit.mva} ${unit.placas} ${unit.modelo}`).includes(term));
}

function _currentUnit(visible = _visibleUnits()) {
  if (!visible.length) return null;
  const byIndex = _s.units[_s.currentIndex];
  if (byIndex && visible.includes(byIndex)) return byIndex;
  const pending = visible.find(unit => unit.status === 'PENDIENTE');
  return pending || visible[0];
}

function _unitByMva(mva) {
  const key = _normMva(mva);
  return _s?.units.find(unit => unit.mva === key) || null;
}

function _summary() {
  const units = _s?.units || [];
  const total = units.length;
  const pendientes = units.filter(unit => unit.status === 'PENDIENTE').length;
  const revisadas = total - pendientes;
  return {
    total,
    pendientes,
    revisadas,
    ok: units.filter(unit => unit.status === 'OK').length,
    faltantes: units.filter(unit => unit.status === 'FALTANTE').length,
    sobrantes: units.filter(unit => unit.status === 'EXTRA').length,
    extras: units.filter(unit => unit.status === 'EXTRA').length,
    percent: total ? Math.round((revisadas / total) * 100) : 0
  };
}

function _firstPendingIndex(units = []) {
  const idx = units.findIndex(unit => unit.status === 'PENDIENTE');
  return idx >= 0 ? idx : 0;
}

function _nextPendingIndexAfter(index, skipReviewed = true) {
  const units = _s?.units || [];
  if (!units.length) return 0;
  for (let offset = 1; offset <= units.length; offset += 1) {
    const next = (index + offset) % units.length;
    if (!skipReviewed || units[next].status === 'PENDIENTE') return next;
  }
  return Math.max(0, index);
}

function _modelCatalogEntry(modelo) {
  const name = String(modelo || '').trim().toUpperCase();
  if (!name || name === 'S/M') return null;
  const catalog = window.MEX_CONFIG?.listas?.modelos || [];
  let best = null;
  for (const item of catalog) {
    if (!item || typeof item !== 'object') continue;
    const itemName = String(item.nombre || '').trim().toUpperCase();
    if (!itemName) continue;
    if (itemName === name) { best = item; break; }
    if (!best && (name.includes(itemName) || itemName.includes(name.split(' ')[0]))) best = item;
  }
  return best;
}

// Imagen del modelo desde el catalogo de modelos (Panel Admin → Modelos).
function _modelImageUrl(modelo) {
  const best = _modelCatalogEntry(modelo);
  if (!best) return '';
  return String(best.imagenURL || best.imagen || best.image || best.foto || '').trim();
}

function _modelCategoria(modelo, fallback = '') {
  const fromUnit = String(fallback || '').trim();
  if (fromUnit) return fromUnit;
  const best = _modelCatalogEntry(modelo);
  return String(best?.categoria || best?.categoriaNombre || '').trim();
}

function _gasOptions(selected = 'N/A') {
  const safe = String(selected || 'N/A').toUpperCase();
  const options = _uniq([safe, ..._gasCatalog()]);
  return options.map(value => `<option value="${esc(value)}"${value === safe ? ' selected' : ''}>${esc(value)}</option>`).join('');
}

function _statusClass(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'OK') return 'is-ok';
  if (s === 'FALTANTE') return 'is-missing';
  if (s === 'EXTRA') return 'is-extra';
  return '';
}

function _statusLabel(status) {
  const s = String(status || 'PENDIENTE').toUpperCase();
  if (s === 'OK') return 'Presente';
  if (s === 'FALTANTE') return 'Faltante';
  if (s === 'EXTRA') return 'Sobrante';
  return 'Pendiente';
}

function _actorName() {
  const st = getState();
  const p = st.profile || {};
  return String(p.nombre || p.nombreCompleto || p.usuario || st.user?.displayName || st.user?.email || 'Ventas').trim();
}

function _normMva(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '').trim();
}

function _normId(value) {
  return String(value || '').toUpperCase().trim();
}

function _normPlaza(value) {
  return String(value || '').toUpperCase().trim();
}

function _normSearch(value) {
  return String(value || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function _uniq(values = []) {
  const seen = new Set();
  const out = [];
  values.forEach(value => {
    const v = String(value || '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  });
  return out;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _toast(message, type = 'info') {
  const root = document.getElementById('appRoot') || document.body;
  let host = document.getElementById('mexAppToastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'mexAppToastHost';
    host.style.cssText = 'position:fixed;bottom:20px;right:16px;z-index:260;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    root.appendChild(host);
  }
  const el = document.createElement('div');
  const tone = type === 'error'
    ? 'background:#fee2e2;border:1px solid #fecaca;'
    : type === 'warning'
      ? 'background:#fef9c3;border:1px solid #fde047;'
      : 'background:#ecfccb;border:1px solid #bef264;';
  el.style.cssText = `pointer-events:auto;padding:11px 14px;border-radius:10px;font-size:13px;font-weight:700;max-width:min(360px,calc(100vw - 32px));box-shadow:0 10px 30px rgba(2,6,23,.18);color:#0f172a;${tone}`;
  el.textContent = String(message || '');
  host.appendChild(el);
  setTimeout(() => { try { el.remove(); } catch (_) {} }, 4200);
}
