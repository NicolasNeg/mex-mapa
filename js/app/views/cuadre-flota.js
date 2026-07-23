// ============================================================================
// /js/app/views/cuadre-flota.js
// Subseccion "Cuadre de flota" dentro de Cuadre: historial (tabla) + envio
// de mision de cuadre al auxiliar (Ventas + roles admin).
// ============================================================================

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import {
  db,
  COL,
  obtenerHistorialCuadres,
  obtenerMisionAuditoria,
  obtenerRevisionAuditoria,
  obtenerDatosFlotaConsola,
  iniciarProtocoloDesdeAdmin
} from '/js/core/database.js';
import { generarHtmlAuditoriaCuadrePdf, abrirReporteImpresion } from '/js/core/cuadre-pdf.js';
import { descargarPdf } from '/js/core/pdf-export.js';

let _ctr = null;
let _navigate = null;
let _s = null;
let _offPlazaChange = null;
let _unsubSettings = null;

export async function mount({ container, navigate }) {
  unmount();
  _ctr = container;
  _navigate = navigate;
  const state = getState();
  const role = String(state.role || '').toUpperCase();
  const params = new URLSearchParams(window.location.search || '');
  const tabParam = String(params.get('tab') || '').toLowerCase();
  _s = {
    loading: true,
    tab: (tabParam === 'enviar' || tabParam === 'cuadrar') ? 'enviar' : 'historial',
    plaza: _normPlaza(getCurrentPlaza()),
    canSendMission: role === 'VENTAS' || Boolean(window.mexPerms?.canDo?.('edit_cuadre_admin')),
    historial: [],
    historialSearch: '',
    mission: null,
    fleetUnits: [],
    auxiliares: [],
    busy: false,
    missionStateKey: ''
  };
  _bind();
  _paint();
  await _load();
  _subscribeSettings();

  // Multi-tenancy: si cambia la plaza activa, este contexto debe cambiar
  // con ella (recargar historial/mision/flota de la nueva plaza).
  _offPlazaChange = onPlazaChange(nextPlaza => {
    if (!_s) return;
    const plaza = _normPlaza(nextPlaza);
    if (!plaza || plaza === _s.plaza) return;
    _s.plaza = plaza;
    _s.historialSearch = '';
    _s.mission = null;
    _s.fleetUnits = [];
    _s.auxiliares = [];
    _s.missionStateKey = '';
    void _load().then(() => _subscribeSettings());
  });
}

export function unmount() {
  if (_unsubSettings) { try { _unsubSettings(); } catch (_) {} _unsubSettings = null; }
  if (_offPlazaChange) { try { _offPlazaChange(); } catch (_) {} _offPlazaChange = null; }
  _ctr = null;
  _navigate = null;
  _s = null;
}

function _bind() {
  _ctr.addEventListener('click', _onClick);
  _ctr.addEventListener('input', _onInput);
}

async function _load() {
  if (!_s) return;
  _s.loading = true;
  _paint();
  try {
    const [historial, mission] = await Promise.all([
      obtenerHistorialCuadres(_s.plaza).catch(() => []),
      _s.canSendMission ? _checkActiveMission() : Promise.resolve(null)
    ]);
    _s.historial = Array.isArray(historial) ? historial : [];
    _s.mission = mission;
    if (_s.canSendMission && !mission) {
      await _loadFleetAndAuxiliares();
    }
  } catch (err) {
    console.error('[cuadre-flota]', err);
  } finally {
    if (_s) {
      _s.loading = false;
      _s.missionStateKey = `${_s.mission?.state || 'LIBRE'}|${_s.mission?.meta?.missionId || ''}`;
      _paint();
    }
  }
}

async function _checkActiveMission() {
  const [revRaw, procRaw] = await Promise.all([
    obtenerRevisionAuditoria(_s.plaza).catch(() => null),
    obtenerMisionAuditoria(_s.plaza).catch(() => null)
  ]);
  const revUnits = _unitsFrom(revRaw);
  if (revUnits.length) return { state: 'REVISION', meta: _metaFrom(revRaw) };
  const procUnits = _unitsFrom(procRaw);
  if (procUnits.length) return { state: 'PROCESO', meta: _metaFrom(procRaw) };
  return null;
}

function _subscribeSettings() {
  if (_unsubSettings) { try { _unsubSettings(); } catch (_) {} _unsubSettings = null; }
  if (!_s?.canSendMission || !_s.plaza) return;
  const plaza = _s.plaza;
  try {
    _unsubSettings = db.collection(COL.SETTINGS).doc(plaza).onSnapshot(snap => {
      if (!_s || _s.busy || _s.plaza !== plaza) return;
      const data = snap.exists ? (snap.data() || {}) : {};
      const next = _missionFromSettings(data);
      const key = `${next?.state || 'LIBRE'}|${next?.meta?.missionId || ''}`;
      if (key === _s.missionStateKey) return;
      const prevState = _s.mission?.state || null;
      _s.missionStateKey = key;
      _s.mission = next;
      if (!next && prevState) {
        void _loadFleetAndAuxiliares().then(() => { if (_s) _paint(); });
        return;
      }
      _paint();
    }, err => console.warn('[cuadre-flota] settings listener', err));
  } catch (err) {
    console.warn('[cuadre-flota] settings subscribe', err);
  }
}

function _missionFromSettings(data = {}) {
  const estado = String(data.estadoCuadreV3 || 'LIBRE').toUpperCase();
  if (estado === 'REVISION') {
    const rev = _parseSettingsJson(data.datosAuditoria);
    const units = _unitsFrom(rev);
    if (!units.length && !data.cuadreMissionId) return null;
    return {
      state: 'REVISION',
      meta: {
        ..._metaFrom(rev),
        missionId: data.cuadreMissionId || _metaFrom(rev).missionId || '',
        auxiliarNombre: data.cuadreDestinoNombre || _metaFrom(rev).auxiliarNombre || ''
      }
    };
  }
  if (estado === 'PROCESO') {
    const mis = _parseSettingsJson(data.misionAuditoria);
    const units = _unitsFrom(mis);
    if (!units.length && !data.cuadreMissionId) return null;
    return {
      state: 'PROCESO',
      meta: {
        ..._metaFrom(mis),
        missionId: data.cuadreMissionId || _metaFrom(mis).missionId || '',
        auxiliarNombre: data.cuadreDestinoNombre || _metaFrom(mis).destinatarioNombre || _metaFrom(mis).auxiliarNombre || ''
      }
    };
  }
  return null;
}

function _parseSettingsJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw || '[]');
  } catch (_) {
    return [];
  }
}

function _unitsFrom(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.unidades)) return raw.unidades;
    if (Array.isArray(raw.items)) return raw.items;
  }
  return [];
}

function _metaFrom(raw) {
  if (Array.isArray(raw)) return raw.meta || {};
  if (raw && typeof raw === 'object') return raw.meta || raw;
  return {};
}

async function _loadFleetAndAuxiliares() {
  const [fleet, auxSnap] = await Promise.all([
    obtenerDatosFlotaConsola(_s.plaza).catch(() => []),
    db.collection(COL.USERS).where('plazaAsignada', '==', _s.plaza).get().catch(() => ({ docs: [] }))
  ]);
  _s.fleetUnits = Array.isArray(fleet) ? fleet : [];
  const rows = (auxSnap.docs || []).map(doc => ({ docId: doc.id, ...doc.data() }));
  _s.auxiliares = rows.filter(u => {
    const active = String(u.status || 'ACTIVO').toUpperCase() !== 'INACTIVO';
    if (!active) return false;
    const role = String(u.roleLabel || u.rol || '').toUpperCase();
    if (role.includes('ADMIN') || role.includes('VENTA') || role.includes('GERENT') || role.includes('DIRECT')) return false;
    return role.includes('AUX') || role.includes('PATIO') || role.includes('OPER') || role.includes('ASIST') || role.includes('LOG') || role.includes('CONDUCT') || !role;
  }).map(u => ({ docId: u.docId, nombre: String(u.nombre || u.usuario || u.docId).trim() }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function _paint() {
  if (!_ctr || !_s) return;
  _ctr.innerHTML = `
    <section class="cfl">
      <div class="cfl-shell">
        <header class="cfl-head">
          <p class="cfl-eyebrow">Cuadre</p>
          <h1>Cuadre de flota</h1>
          <p class="cfl-head-meta">${esc(_s.plaza || 'SIN PLAZA')}</p>
        </header>

        <div class="cfl-tabs" role="tablist">
          <button type="button" role="tab" aria-selected="${_s.tab === 'historial'}" class="${_s.tab === 'historial' ? 'active' : ''}" data-action="tab" data-tab="historial">
            <span class="material-symbols-outlined">history</span>
            Historial
          </button>
          <button type="button" role="tab" aria-selected="${_s.tab === 'enviar'}" class="${_s.tab === 'enviar' ? 'active' : ''}" data-action="tab" data-tab="enviar">
            <span class="material-symbols-outlined">send</span>
            Cuadrar flota
          </button>
        </div>

        ${_s.loading ? _loadingHtml() : (_s.tab === 'enviar' ? _enviarHtml() : _historialHtml())}
      </div>
    </section>
  `;
}

function _loadingHtml() {
  return `<div class="cfl-loading"><span class="material-symbols-outlined spin">sync</span> Cargando…</div>`;
}

function _historialHtml() {
  return `
    <div class="cfl-toolbar">
      <label class="cfl-search">
        <span class="material-symbols-outlined">search</span>
        <input data-search value="${esc(_s.historialSearch)}" placeholder="Buscar auxiliar, ventas o fecha" aria-label="Buscar en historial">
      </label>
    </div>
    ${_historialTableOnlyHtml()}
  `;
}

function _historialRowHtml(item) {
  return `
    <tr>
      <td>${esc(item.fecha || '—')}</td>
      <td>${esc(item.auxiliar || item.firmaAuxiliar || '—')}</td>
      <td>${esc(item.admin || item.firmaVentas || '—')}</td>
      <td class="cfl-num">${esc(item.ok ?? 0)}</td>
      <td class="cfl-num">${esc(item.faltantes ?? 0)}</td>
      <td class="cfl-num">${esc(item.sobrantes ?? 0)}</td>
      <td><button type="button" class="cfl-link-btn" data-action="ver-pdf" data-id="${esc(item.id)}">Ver PDF</button></td>
    </tr>
  `;
}

// Preferir jsonCompleto (payload real del cierre); pdfUrl suele ir vacío.
function _historialCuadrePayload(item = {}) {
  const tryParse = (raw) => {
    if (!raw || typeof raw !== 'string' || !raw.trim()) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  };
  const fromCompleto = tryParse(item.jsonCompleto);
  if (fromCompleto) return fromCompleto;
  const fromPdf = tryParse(item.pdfUrl);
  if (fromPdf) return fromPdf;
  return {
    unidades: Array.isArray(item.unidades) ? item.unidades : [],
    stats: {
      total: Number(item.ok || 0) + Number(item.faltantes || 0) + Number(item.sobrantes || 0),
      ok: Number(item.ok || 0),
      faltantes: Number(item.faltantes || 0),
      sobrantes: Number(item.sobrantes || 0),
      extras: Number(item.sobrantes || 0),
      auxiliar: item.auxiliar || ''
    },
    meta: {
      ...(item.meta && typeof item.meta === 'object' ? item.meta : {}),
      auxiliarNombre: item.auxiliar || item.meta?.auxiliarNombre || '',
      firmaAuxiliar: item.firmaAuxiliar || '',
      firmaVentas: item.firmaVentas || item.admin || '',
      cerradoPor: item.admin || '',
      cerradoEn: item.fecha || '',
      plaza: item.plaza || _s.plaza
    }
  };
}

function _filteredHistorial() {
  const term = _normSearch(_s.historialSearch);
  if (!term) return _s.historial;
  return _s.historial.filter(item => _normSearch(
    `${item.fecha || ''} ${item.auxiliar || ''} ${item.admin || ''} ${item.firmaAuxiliar || ''} ${item.firmaVentas || ''}`
  ).includes(term));
}

function _enviarHtml() {
  if (!_s.canSendMission) {
    return `
      <div class="cfl-state-card">
        <span class="material-symbols-outlined">lock</span>
        <h2>Sin permiso</h2>
        <p>No tienes permiso para enviar misiones de cuadre. Contacta a un administrador.</p>
      </div>
    `;
  }
  if (_s.mission?.state === 'PROCESO') {
    return `
      <div class="cfl-state-card">
        <span class="material-symbols-outlined">directions_run</span>
        <h2>Misión en patio</h2>
        <p>${esc(_s.mission.meta?.auxiliarNombre || _s.mission.meta?.destinatarioNombre || 'El auxiliar')} está revisando la flota. Esperando su envío a Ventas.</p>
      </div>
    `;
  }
  if (_s.mission?.state === 'REVISION') {
    return `
      <div class="cfl-state-card is-warn">
        <span class="material-symbols-outlined">fact_check</span>
        <h2>Lista para revisión de Ventas</h2>
        <p>El auxiliar ya envió el cuadre. Revísalo y fírmalo para cerrarlo.</p>
        <button type="button" class="cfl-btn-send" data-action="go-revision">Revisar y firmar</button>
      </div>
    `;
  }
  const fleetCount = _s.fleetUnits.length;
  return `
    <div class="cfl-send-card">
      <div class="cfl-fleet-preview">
        <span class="material-symbols-outlined">directions_car</span>
        <div>
          <strong>${fleetCount} unidades del cuadre</strong>
          <small>Plaza ${esc(_s.plaza || 'SIN PLAZA')}</small>
        </div>
        <button type="button" class="cfl-refresh-btn" data-action="reload-fleet" title="Actualizar flota" aria-label="Actualizar flota">
          <span class="material-symbols-outlined">sync</span>
        </button>
      </div>

      <label class="cfl-field">
        <span>Auxiliar de patio</span>
        <select data-select-aux>
          <option value="">Selecciona un auxiliar</option>
          ${_s.auxiliares.map(a => `<option value="${esc(a.docId)}" data-nombre="${esc(a.nombre)}">${esc(a.nombre)}</option>`).join('')}
        </select>
        <small class="cfl-field-note">La alerta y el pase de lista solo se enviarán a esa persona.</small>
      </label>

      <button type="button" class="cfl-btn-send" data-action="enviar-mision" ${_s.busy ? 'disabled' : ''}>
        ${_s.busy ? 'Enviando…' : 'Enviar misión al auxiliar'}
      </button>
    </div>
  `;
}

async function _onClick(event) {
  const el = event.target.closest('[data-action]');
  if (!el || !_s) return;
  const action = el.dataset.action;

  if (action === 'tab') {
    _s.tab = el.dataset.tab;
    _paint();
    return;
  }
  if (action === 'ver-pdf') {
    const item = _s.historial.find(h => String(h.id) === String(el.dataset.id));
    if (!item) {
      _toast('No encontré ese registro de cuadre.', 'error');
      return;
    }
    if (item.pdfUrl && /^https?:\/\//i.test(item.pdfUrl)) {
      descargarPdf(item.pdfUrl, `CUADRE_${String(item.fecha || item.id || '').replace(/[^\w]+/g, '_')}.pdf`)
        .catch(() => _toast('No se pudo descargar el PDF.', 'error'));
      return;
    }
    _toast('Generando PDF…', 'info');
    const payload = _historialCuadrePayload(item);
    const url = await abrirReporteImpresion(
      generarHtmlAuditoriaCuadrePdf(payload.unidades, payload.stats, payload.meta, { plaza: _s.plaza, actorName: _actorName() }),
      { kind: 'cuadre', docId: item.id, onError: () => _toast('No se pudo generar el PDF.', 'error') }
    );
    if (url) item.pdfUrl = url; // cachea en memoria: el próximo clic ya no regenera
    return;
  }
  if (action === 'go-revision') {
    const meta = _s.mission?.meta || {};
    const params = new URLSearchParams();
    if (meta.missionId) params.set('missionId', meta.missionId);
    params.set('plaza', _s.plaza);
    _navigate?.(`/app/cuadrarflota/ventas?${params.toString()}`);
    return;
  }
  if (action === 'reload-fleet') {
    await _loadFleetAndAuxiliares();
    _paint();
    return;
  }
  if (action === 'enviar-mision') {
    await _enviarMision();
  }
}

function _onInput(event) {
  if (!_s) return;
  const target = event.target;
  if (target.matches('[data-search]')) {
    _s.historialSearch = target.value;
    const table = _ctr.querySelector('.cfl-table-container');
    if (table) table.outerHTML = _historialTableOnlyHtml();
  }
}

function _historialTableOnlyHtml() {
  const rows = _filteredHistorial();
  return `
    <div class="cfl-table-container">
      <table class="cfl-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Auxiliar</th>
            <th>Autorizó</th>
            <th>Cuadrados</th>
            <th>Faltantes</th>
            <th>Sobrantes</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length ? rows.map(_historialRowHtml).join('') : `<tr><td colspan="7" class="cfl-empty-cell">Sin cuadres registrados.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

async function _enviarMision() {
  if (!_s || _s.busy) return;
  const select = _ctr.querySelector('[data-select-aux]');
  const auxDocId = String(select?.value || '').trim();
  const option = select?.options?.[select.selectedIndex] || null;
  const auxNombre = String(option?.dataset?.nombre || option?.textContent || '').split('·')[0].trim();

  if (!auxDocId) {
    _toast('Selecciona un auxiliar para enviar la misión.', 'error');
    return;
  }
  if (!_s.fleetUnits.length) {
    _toast('No hay unidades en el cuadre de esta plaza.', 'error');
    return;
  }

  _s.busy = true;
  _paint();
  try {
    const st = getState();
    const userName = _actorName();
    const meta = {
      missionId: `cuadre_${Date.now()}`,
      destinatarioDocId: auxDocId,
      destinatarioNombre: auxNombre,
      auxiliarDocId: auxDocId,
      auxiliarNombre: auxNombre,
      creadorDocId: st.user?.uid || '',
      creadorEmail: st.user?.email || '',
      adminDocId: st.user?.uid || '',
      adminEmail: st.user?.email || ''
    };
    const res = await iniciarProtocoloDesdeAdmin(userName, JSON.stringify(_s.fleetUnits), _s.plaza, meta);
    if (res && res.exito) {
      _toast('Misión enviada al auxiliar.', 'success');
      _s.mission = { state: 'PROCESO', meta };
      _s.missionStateKey = `PROCESO|${meta.missionId || ''}`;
    } else {
      _toast(res?.error || 'No se pudo enviar la misión.', 'error');
    }
  } catch (err) {
    console.error('[cuadre-flota] enviar mision', err);
    _toast('Error al enviar la misión.', 'error');
  } finally {
    _s.busy = false;
    _paint();
  }
}

function _actorName() {
  const st = getState();
  const p = st.profile || {};
  return String(p.nombre || p.nombreCompleto || p.usuario || st.user?.displayName || st.user?.email || 'Ventas').trim();
}

function _normPlaza(value) {
  return String(value || '').toUpperCase().trim();
}

function _normSearch(value) {
  return String(value || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
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
