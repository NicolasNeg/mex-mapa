// ============================================================================
// /js/app/views/cuadrarflota.js
// Vista dedicada para ejecutar misiones de cuadre de flota desde Patio.
// ============================================================================

import { getState, getCurrentPlaza, setCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import {
  db,
  auth,
  COL,
  obtenerMisionAuditoria,
  obtenerDatosFlotaConsola,
  enviarAuditoriaAVentas
} from '/js/core/database.js';

let _ctr = null;
let _navigate = null;
let _offs = [];
let _s = null;
let _sig = { canvas: null, ctx: null, drawing: false, hasInk: false, dataUrl: '' };
let _swipe = null;

const GAS_OPTIONS = ['F', '15/16', '7/8', '13/16', '3/4', '11/16', '5/8', '9/16', 'H', '7/16', '3/8', '5/16', '1/4', '3/16', '1/8', '1/16', 'E', 'N/A'];

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

  _offs.push(onPlazaChange(() => {
    if (!_s || _s.completed) return;
    const params = new URLSearchParams(window.location.search || '');
    if (params.get('missionId') || params.get('plaza')) return;
    void _load();
  }));
}

export function unmount() {
  _offs.forEach(fn => { try { fn(); } catch (_) {} });
  _offs = [];
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
  _offs.push(() => _ctr?.removeEventListener('click', click));
  _offs.push(() => _ctr?.removeEventListener('input', input));
  _offs.push(() => _ctr?.removeEventListener('change', change));
  _offs.push(() => _ctr?.removeEventListener('pointerdown', pointerDown));
  _offs.push(() => _ctr?.removeEventListener('pointermove', pointerMove));
  _offs.push(() => _ctr?.removeEventListener('pointerup', pointerUp));
  _offs.push(() => _ctr?.removeEventListener('pointercancel', pointerUp));
}

async function _load() {
  if (!_s) return;
  _s.loading = true;
  _s.error = '';
  _s.completed = false;
  _renderLoading();

  try {
    const found = await _resolveAssignedMission();
    if (!found) {
      _s.loading = false;
      _s.error = 'No encontre una mision de patio asignada a tu usuario.';
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

    if (found.plaza && found.plaza !== getCurrentPlaza()) {
      try { setCurrentPlaza(found.plaza, { source: 'cuadrar-flota-mission' }); } catch (_) {}
    }

    _paint();
  } catch (err) {
    console.error('[cuadrarflota]', err);
    _s.loading = false;
    _s.error = err?.message || 'No se pudo cargar la mision de cuadre.';
    _paint();
  }
}

async function _resolveAssignedMission() {
  const params = new URLSearchParams(window.location.search || '');
  const requestedMissionId = _normId(params.get('missionId') || params.get('cuadreMissionId'));
  const requestedPlaza = _normPlaza(params.get('plaza'));
  const identities = _identityTokens();
  const inbox = await _loadInboxMissions(identities.docIds, requestedMissionId);
  const missionIds = _uniq([
    requestedMissionId,
    ...inbox.map(item => _normId(item.missionId || item.payload?.missionId || item.notificationId || item.id))
  ]);
  const plazas = _uniq([
    requestedPlaza,
    ...inbox.map(item => _normPlaza(item.plaza || item.payload?.plaza)),
    _normPlaza(getCurrentPlaza()),
    ..._profilePlazas()
  ]);

  for (const plaza of plazas) {
    if (!plaza) continue;
    const mission = await obtenerMisionAuditoria(plaza).catch(() => []);
    const { units, meta } = _missionUnitsAndMeta(mission);
    if (!units.length) continue;
    const metaMissionId = _normId(meta.missionId || meta.cuadreMissionId);
    const idMatch = missionIds.length > 0 && metaMissionId && missionIds.includes(metaMissionId);
    const assigned = _missionAssignedToMe(meta, identities);
    if (idMatch || assigned) return { plaza, units, meta: { ...meta, plaza, missionId: metaMissionId || requestedMissionId } };
  }

  return null;
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

async function _loadInboxMissions(docIds = [], requestedMissionId = '') {
  const rows = [];
  for (const docId of docIds) {
    if (!docId) continue;
    const inboxRef = db.collection(COL.USERS).doc(docId).collection('inbox');
    if (requestedMissionId) {
      const direct = await inboxRef.doc(requestedMissionId).get().catch(() => null);
      if (direct?.exists) rows.push({ id: direct.id, ...(direct.data() || {}) });
    }
    const snap = await inboxRef.orderBy('createdAt', 'desc').limit(40).get()
      .catch(() => inboxRef.limit(40).get().catch(() => null));
    if (snap?.docs) {
      snap.docs.forEach(doc => {
        const data = doc.data() || {};
        const type = String(data.type || '').toLowerCase();
        if (type.includes('cuadre')) rows.push({ id: doc.id, ...data });
      });
    }
  }
  const seen = new Set();
  return rows.filter(item => {
    const key = String(item.notificationId || item.id || item.missionId || Math.random());
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function _missionAssignedToMe(meta = {}, identities = _identityTokens()) {
  const targets = [
    meta.destinatarioDocId,
    meta.auxiliarDocId,
    meta.recipientDocId,
    meta.docId,
    meta.destinatarioEmail,
    meta.auxiliarEmail,
    meta.destinatarioNombre,
    meta.auxiliarNombre,
    meta.recipientName
  ].map(_token).filter(Boolean);
  if (!targets.length) return false;
  return targets.some(target => identities.tokens.has(target));
}

function _buildAuditUnits(units = [], localByMva = new Map()) {
  return (Array.isArray(units) ? units : []).map(unit => {
    const mva = _normMva(unit.mva);
    const local = localByMva.get(mva) || {};
    const gas = String(local.gasolina ?? unit.gasolina ?? unit.gas ?? 'N/A').toUpperCase().trim() || 'N/A';
    return {
      ...unit,
      mva,
      modelo: String(unit.modelo || local.modelo || 'S/M').trim() || 'S/M',
      placas: String(unit.placas || local.placas || 'S/P').trim() || 'S/P',
      estado: local.estado || unit.estado || '',
      ubicacion: local.ubicacion || unit.ubicacion || '',
      gasolinaSistema: gas,
      gasolinaCorregida: gas,
      gasolina: gas,
      km: local.km ?? unit.km ?? '',
      status: 'PENDIENTE',
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

  _ctr.innerHTML = `
    <section class="cf" aria-busy="${_s.busy ? 'true' : 'false'}">
      <header class="cf-head">
        <div>
          <p class="cf-eyebrow">Mision a Patio</p>
          <h1>Cuadre de flota</h1>
          <span>${esc(_s.plaza || 'SIN PLAZA')} · ${esc(_s.mission?.missionId || 'MISION ACTIVA')}</span>
        </div>
        <button type="button" class="cf-icon-btn" data-action="reload" title="Recargar">
          <span class="material-icons">sync</span>
        </button>
      </header>

      ${_stepsHtml(summary)}

      ${_s.step === 'sign' ? _signStepHtml(summary) : _reviewStepHtml(summary)}

      ${_s.showExtra ? _extraModalHtml() : ''}
    </section>
  `;
  if (_s.step === 'sign') _setupSignatureCanvas();
}

function _stepsHtml(summary) {
  const reviewDone = summary.total > 0 && summary.pendientes === 0;
  const steps = [
    { id: 'review', icon: 'checklist', label: 'Revisar unidades', hint: `${summary.revisadas}/${summary.total}` },
    { id: 'sign', icon: 'draw', label: 'Firmar', hint: _actorName() },
    { id: 'sent', icon: 'send', label: 'Enviado a Ventas', hint: '' }
  ];
  return `
    <ol class="cf-steps" aria-label="Flujo del cuadre">
      ${steps.map((step, i) => {
        const isCurrent = _s.step === step.id;
        const isDone = (step.id === 'review' && (reviewDone || _s.step === 'sign')) || false;
        const clickable = step.id !== 'sent';
        return `
          <li class="cf-step ${isCurrent ? 'is-current' : ''} ${isDone && !isCurrent ? 'is-done' : ''}">
            ${clickable ? `<button type="button" data-action="go-step" data-step="${step.id}">` : '<div>'}
              <span class="cf-step-dot"><span class="material-icons">${isDone && !isCurrent ? 'check' : step.icon}</span></span>
              <span class="cf-step-txt">
                <strong>${i + 1}. ${step.label}</strong>
                ${step.hint ? `<small>${esc(step.hint)}</small>` : ''}
              </span>
            ${clickable ? '</button>' : '</div>'}
            ${i < steps.length - 1 ? '<span class="cf-step-arrow material-icons">arrow_forward</span>' : ''}
          </li>
        `;
      }).join('')}
    </ol>
  `;
}

function _reviewStepHtml(summary) {
  return `
    <section class="cf-progress" aria-label="Avance de auditoria">
      <div class="cf-progress-top">
        <strong>${summary.revisadas} / ${summary.total}</strong>
        <span>${summary.percent}% revisado</span>
      </div>
      <div class="cf-bar"><span style="width:${summary.percent}%"></span></div>
    </section>

    <div class="cf-toolbar">
      <label class="cf-search">
        <span class="material-icons">search</span>
        <input data-search value="${esc(_s.search)}" placeholder="Buscar MVA, placas o modelo">
      </label>
      <div class="cf-view-toggle" role="tablist">
        <button type="button" class="${_s.view === 'card' ? 'active' : ''}" data-action="view-card">
          <span class="material-icons">style</span>
          Tarjeta
        </button>
        <button type="button" class="${_s.view === 'list' ? 'active' : ''}" data-action="view-list">
          <span class="material-icons">view_list</span>
          Lista
        </button>
      </div>
      <button type="button" class="cf-btn secondary" data-action="open-extra">
        <span class="material-icons">add</span>
        Sobrante
      </button>
    </div>

    <main class="cf-main">${_mainHtml()}</main>

    <div class="cf-flow-next">
      <button type="button" class="cf-btn primary wide" data-action="go-step" data-step="sign">
        <span class="material-icons">draw</span>
        ${summary.pendientes > 0 ? `Continuar a firma (${summary.pendientes} pendientes)` : 'Continuar a firma'}
      </button>
    </div>
  `;
}

function _signStepHtml(summary) {
  return `
    <section class="cf-sign">
      <div>
        <p class="cf-eyebrow">Paso final · Firma del auxiliar</p>
        <h2>Enviar reporte preliminar a Ventas</h2>
        <p class="cf-sign-note">Revisaste ${summary.revisadas} de ${summary.total} unidades. Firma para enviar el reporte.</p>
      </div>
      <label class="cf-field">
        <span>Nombre del auxiliar</span>
        <div class="cf-locked-name">
          <span class="material-icons">lock</span>
          <input value="${esc(_actorName())}" readonly aria-readonly="true" tabindex="-1">
        </div>
      </label>
      <div class="cf-sign-pad">
        <canvas id="cfSignatureCanvas" width="680" height="180" aria-label="Firma digital"></canvas>
        <button type="button" class="cf-clear-sign" data-action="clear-signature">Limpiar firma</button>
      </div>
      <div class="cf-sign-actions">
        <button type="button" class="cf-btn secondary" data-action="go-step" data-step="review">
          <span class="material-icons">arrow_back</span>
          Volver a revisar
        </button>
        <button type="button" class="cf-btn primary" data-action="submit" ${_s.busy ? 'disabled' : ''}>
          <span class="material-icons">${_s.busy ? 'sync' : 'send'}</span>
          ${_s.busy ? 'Enviando...' : 'Enviar a Ventas'}
        </button>
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
        <span class="material-icons">assignment_late</span>
        <h1>Sin mision disponible</h1>
        <p>${esc(message)}</p>
        <div class="cf-state-actions">
          <button type="button" class="cf-btn primary" data-action="reload"><span class="material-icons">sync</span>Recargar</button>
          <button type="button" class="cf-btn secondary" data-action="go-map"><span class="material-icons">map</span>Ir al mapa</button>
        </div>
      </div>
    </section>
  `;
}

function _completedHtml() {
  return `
    <section class="cf cf-state">
      <div class="cf-state-card success">
        <span class="material-icons">task_alt</span>
        <h1>Reporte enviado</h1>
        <p>Ventas ya puede revisar la auditoria cruzada y cerrar el cuadre. La mision seguira visible hasta que el cierre quede completado.</p>
        <div class="cf-state-actions">
          <button type="button" class="cf-btn secondary" data-action="reload"><span class="material-icons">sync</span>Ver estado</button>
          <button type="button" class="cf-btn primary" data-action="go-map"><span class="material-icons">map</span>Volver al mapa</button>
        </div>
      </div>
    </section>
  `;
}

function _cardHtml(unit, visibleCount) {
  if (!unit) {
    return `<div class="cf-empty"><span class="material-icons">search_off</span><strong>Sin unidades visibles</strong><p>Ajusta la busqueda para continuar.</p></div>`;
  }
  const idx = _s.units.findIndex(item => item === unit);
  const imgUrl = _modelImageUrl(unit.modelo);
  return `
    <section class="cf-card-wrap">
      <div class="cf-card-count">${visibleCount} coincidencia(s) · ${idx + 1} de ${_s.units.length}</div>
      <article class="cf-card-main ${_statusClass(unit.status)}" data-card-mva="${esc(unit.mva)}">
        <div class="cf-card-status">${_statusLabel(unit.status)}</div>
        ${imgUrl
          ? `<div class="cf-card-img"><img src="${esc(imgUrl)}" alt="${esc(unit.modelo)}" loading="lazy" draggable="false" onerror="this.parentElement.remove()"></div>`
          : ''}
        <h2>${esc(unit.mva)}</h2>
        <p>${esc(unit.modelo)} · ${esc(unit.placas)}</p>
        <div class="cf-card-meta">
          <span>${esc(unit.estado || 'SIN ESTADO')}</span>
          <span>${esc(unit.ubicacion || 'SIN UBICACION')}</span>
        </div>
        <div class="cf-fields">
          ${_unitFields(unit)}
        </div>
      </article>
      <div class="cf-card-actions">
        <button type="button" class="cf-swipe-btn bad" data-action="mark-missing" data-mva="${esc(unit.mva)}">
          <span class="material-icons">close</span>
          Faltante
        </button>
        <button type="button" class="cf-swipe-btn ghost" data-action="skip">
          <span class="material-icons">redo</span>
          Omitir
        </button>
        <button type="button" class="cf-swipe-btn ok" data-action="mark-ok" data-mva="${esc(unit.mva)}">
          <span class="material-icons">check</span>
          Presente
        </button>
      </div>
    </section>
  `;
}

function _listHtml(units) {
  if (!units.length) {
    return `<div class="cf-empty"><span class="material-icons">search_off</span><strong>Sin coincidencias</strong><p>Busca por MVA, placas o modelo.</p></div>`;
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
            <button type="button" class="cf-icon-btn bad" data-action="mark-missing" data-mva="${esc(unit.mva)}" title="Faltante"><span class="material-icons">close</span></button>
            <button type="button" class="cf-icon-btn ok" data-action="mark-ok" data-mva="${esc(unit.mva)}" title="Presente"><span class="material-icons">check</span></button>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function _unitFields(unit) {
  const gas = String(unit.gasolinaCorregida || unit.gasolina || 'N/A').toUpperCase();
  return `
    <label class="cf-field compact">
      <span>Gasolina</span>
      <select class="cf-gas" data-gas="${esc(unit.mva)}">${_gasOptions(gas)}</select>
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
      <section class="cf-modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
        <header>
          <h2>Anadir sobrante</h2>
          <button type="button" class="cf-icon-btn" data-action="close-extra"><span class="material-icons">close</span></button>
        </header>
        <label class="cf-field"><span>MVA</span><input data-extra="mva" value="${esc(_s.extra.mva)}" placeholder="C1234"></label>
        <label class="cf-field"><span>Modelo</span><input data-extra="modelo" value="${esc(_s.extra.modelo)}" placeholder="Modelo"></label>
        <label class="cf-field"><span>Placas</span><input data-extra="placas" value="${esc(_s.extra.placas)}" placeholder="S/P"></label>
        <div class="cf-modal-grid">
          <label class="cf-field"><span>Gasolina</span><select data-extra="gasolina">${_gasOptions(_s.extra.gasolina)}</select></label>
          <label class="cf-field"><span>Kilometraje</span><input data-extra="km" inputmode="numeric" value="${esc(_s.extra.km)}" placeholder="KM"></label>
        </div>
        <button type="button" class="cf-btn primary wide" data-action="save-extra"><span class="material-icons">add</span>Agregar sobrante</button>
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
    }
  }
  if (target.matches('[data-extra]')) {
    _s.extra[target.dataset.extra] = target.value;
  }
}

async function _onClick(event) {
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl || !_s) return;
  const action = actionEl.dataset.action;
  const mva = actionEl.dataset.mva || '';

  if (action === 'reload') { await _load(); return; }
  if (action === 'go-map') { _navigate?.('/app/mapa'); return; }
  if (action === 'go-step') {
    const step = actionEl.dataset.step;
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
  // Al revisar la ultima unidad el flujo avanza solo al paso de firma.
  if (_s.units.length && !_s.units.some(item => item.status === 'PENDIENTE')) {
    _s.step = 'sign';
    _toast('Revision completa. Firma para enviar a Ventas.', 'success');
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
    notas: 'Sobrante registrado por patio'
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
    const ok = await _confirm('Unidades pendientes', `Quedan ${pending.length} unidades sin revisar. Se marcaran como faltantes para enviar el reporte.`, 'warning');
    if (!ok) return;
    pending.forEach(unit => { unit.status = 'FALTANTE'; });
  }
  // El nombre siempre sale del perfil del auxiliar logueado (no editable).
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
      missionId: _normId(mission.missionId || mission.cuadreMissionId),
      auxiliarDocId: mission.destinatarioDocId || _identityTokens().primaryDocId,
      auxiliarNombre: signedName,
      firmaNombre: signedName,
      firmaDataUrl: _sig.dataUrl,
      firmaAuxiliarNombre: signedName,
      firmaAuxiliarUrl: _sig.dataUrl,
      stats,
      plaza: _s.plaza
    };
    const payload = _s.units.map(unit => ({ ...unit }));
    const res = await enviarAuditoriaAVentas(payload, _actorName(), _s.plaza, meta);
    if (!res || res.exito !== true) throw new Error('Respuesta invalida al enviar auditoria.');
    _s.busy = false;
    _s.completed = true;
    _s.step = 'sent';
    _paint();
    _toast('Reporte enviado a Ventas.', 'success');
  } catch (err) {
    console.error('[cuadrarflota] enviar', err);
    _s.busy = false;
    _paint();
    _toast(err?.message || 'No se pudo enviar a Ventas.', 'error');
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

// Imagen del modelo desde el catalogo de modelos (Panel Admin → Modelos).
function _modelImageUrl(modelo) {
  const name = String(modelo || '').trim().toUpperCase();
  if (!name || name === 'S/M') return '';
  const catalog = window.MEX_CONFIG?.listas?.modelos || [];
  let best = null;
  for (const item of catalog) {
    if (!item || typeof item !== 'object') continue;
    const itemName = String(item.nombre || '').trim().toUpperCase();
    if (!itemName) continue;
    if (itemName === name) { best = item; break; }
    if (!best && (name.includes(itemName) || itemName.includes(name.split(' ')[0]))) best = item;
  }
  if (!best) return '';
  return String(best.imagenURL || best.imagen || best.image || best.foto || '').trim();
}

function _gasOptions(selected = 'N/A') {
  const safe = String(selected || 'N/A').toUpperCase();
  const options = _uniq([safe, ...GAS_OPTIONS]);
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

function _identityTokens() {
  const st = getState();
  const profile = st.profile || {};
  const user = st.user || auth.currentUser || {};
  const rawDocIds = [
    profile.id,
    profile.docId,
    profile.documentId,
    profile.uid,
    profile.email,
    profile.correo,
    user.email,
    user.uid
  ];
  const docIds = _uniq(rawDocIds.flatMap(value => {
    const v = String(value || '').trim();
    return v ? [v, v.toLowerCase(), v.toUpperCase()] : [];
  }));
  const rawTokens = [
    ...docIds,
    profile.email,
    profile.correo,
    profile.uid,
    user.email,
    user.uid,
    profile.nombre,
    profile.nombreCompleto,
    profile.usuario,
    user.displayName
  ];
  return {
    primaryDocId: docIds[0] || '',
    docIds,
    tokens: new Set(rawTokens.map(_token).filter(Boolean))
  };
}

function _profilePlazas() {
  const st = getState();
  const profile = st.profile || {};
  return _uniq([
    st.currentPlaza,
    profile.plazaAsignada,
    profile.plaza,
    ...(Array.isArray(profile.plazasPermitidas) ? profile.plazasPermitidas : []),
    ...(Array.isArray(st.availablePlazas) ? st.availablePlazas : [])
  ].map(_normPlaza));
}

function _actorName() {
  const st = getState();
  const p = st.profile || {};
  return String(p.nombre || p.nombreCompleto || p.usuario || st.user?.displayName || st.user?.email || 'Auxiliar').trim();
}

function _docId(value) {
  return String(value || '').trim().toLowerCase();
}

function _token(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
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

function _confirm(title, text, type = 'warning') {
  if (typeof window.mexConfirm === 'function') return window.mexConfirm(title, text, type);
  return Promise.resolve(window.confirm(`${title}\n\n${text}`));
}
