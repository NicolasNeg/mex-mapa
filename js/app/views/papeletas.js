// ═══════════════════════════════════════════════════════════
//  /js/app/views/papeletas.js — SPA Papeletas digitales (beta)
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza } from '/js/app/app-state.js';
import {
  ZONAS_V1,
  CHECKLIST_KEYS,
  CHECKLIST_LABELS,
  puedeEditar,
  puedeEntregar,
  allZonasHaveFoto,
  checklistCompleto,
  truncNota,
  rolPuedeGestionarVentas,
  rolPuedeCerrarCaso,
} from '/domain/papeleta.model.js';
import { STATUS_LABELS, STATUS_LABELS_SHORT } from '/js/app/features/papeletas/papeletas-constants.js';
import {
  subscribePapeletasPlaza,
  subscribePapeleta,
  crearPapeleta,
  actualizarPapeleta,
  entregarPapeleta,
  registrarEntrada,
  asignarCliente,
} from '/js/app/features/papeletas/papeletas-data.js';
import {
  uploadZonaFoto,
  uploadZonaDetalle,
  uploadFirma,
  uploadReporteFoto,
  getDownloadUrl,
} from '/js/app/features/papeletas/papeletas-storage.js';
import {
  openPapeletaPdf,
  exportPapeletaXls,
  exportPapeletaCsv,
} from '/js/app/features/papeletas/papeletas-pdf.js';
import { openExportChooser } from '/js/core/export-menu.js';
import {
  subscribeReportesAbiertos,
  crearReporte,
  newReporteId,
  promoverReporte,
  cerrarCaso,
  countReportesAbiertosUnidad,
} from '/js/app/features/papeletas/papeletas-reportes-data.js';
import { buscarUnidad } from '/js/app/features/unidades/unidades-data.js';

let _container = null;
let _navigate = null;
let _unsubs = [];
let _items = [];
let _reportes = [];
let _detail = null;
let _detailUnsub = null;
let _mode = 'list'; // list | detail | ventas
let _filter = 'activas';
let _query = '';
let _wizardStep = 'datos'; // datos | zonas | checklist | resumen | firma | entrada | reporte
let _zonaIdx = 0;
let _showNueva = false;
let _unitHits = [];
let _unitQ = '';
let _unitSearchBusy = false;
let _unitSearchTimer = null;
let _unitSearchSeq = 0;
let _casoWarning = '';
let _busy = false;
let _sigDrawing = false;
let _sigHasInk = false;
let _pendingSalida = { km: null, gas: null };
let _fotoCache = new Map();

const LIST_ROUTE = '/app/papeletas';
const VENTAS_ROUTE = '/app/papeletas/ventas';
const DETAIL_PREFIX = '/app/papeletas/p/';

const FILTER_LABELS = Object.freeze({
  activas: 'En curso',
  entregadas: 'Entregadas',
  historial: 'Historial',
  ventas: 'Con reporte',
});

const FIELD_LABELS = Object.freeze({
  mva: 'Económico (MVA)',
  modelo: 'Modelo',
  placas: 'Placas',
  color: 'Color',
  vin: 'VIN / Serie',
});

const STEP_LABELS = Object.freeze({
  datos: '1 · Unidad',
  zonas: '2 · Fotos',
  checklist: '3 · Accesorios',
  resumen: '4 · Entregar',
  firma: 'Firma',
  entrada: 'Regreso',
  reporte: 'Reportar',
});

const _mexConfirm = (t, x, tipo = 'warning') =>
  (typeof window.mexConfirm === 'function' ? window.mexConfirm(t, x, tipo) : Promise.resolve(confirm(x)));
const _mexAlert = (t, x) =>
  (typeof window.mexAlert === 'function' ? window.mexAlert(t, x) : Promise.resolve(alert(x)));

function _role() {
  return String(getState()?.role || getState()?.profile?.rol || 'AUXILIAR').toUpperCase();
}

function _canVentas() {
  return window.mexPerms?.canDo?.('manage_papeletas_ventas') === true || rolPuedeGestionarVentas(_role());
}

function _user() {
  const p = getState()?.profile || {};
  return {
    uid: window._auth?.currentUser?.uid || p.uid || '',
    nombre: p.nombreCompleto || p.nombre || p.displayName || '',
  };
}

function _normPath() {
  return String(location.pathname || '').replace(/\/+$/, '') || '/';
}

function _pathId() {
  const path = _normPath();
  const modern = path.match(/\/app\/papeletas\/p\/([^/]+)$/);
  if (modern) return decodeURIComponent(modern[1] || '');
  // Legacy deep-link: /app/papeletas/:uid (not ventas / p)
  const legacy = path.match(/\/app\/papeletas\/([^/]+)$/);
  if (!legacy) return '';
  const seg = legacy[1];
  if (seg === 'ventas' || seg === 'p') return '';
  return decodeURIComponent(seg);
}

function _isVentasPath() {
  return _normPath() === VENTAS_ROUTE;
}

function _isLegacyDetailPath() {
  const path = _normPath();
  if (path.startsWith(DETAIL_PREFIX)) return false;
  if (path === VENTAS_ROUTE || path === LIST_ROUTE) return false;
  return /^\/app\/papeletas\/[^/]+$/.test(path);
}

function _detailRoute(id) {
  return `${DETAIL_PREFIX}${encodeURIComponent(String(id || ''))}`;
}

function _toMs(value) {
  if (value == null || value === '') return 0;
  if (typeof value?.toDate === 'function') {
    try { return value.toDate().getTime() || 0; } catch (_) { return 0; }
  }
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function _fmtDate(value) {
  const ms = _toMs(value);
  if (!ms) return '';
  return new Date(ms).toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function _hasReporte(it) {
  if (!it) return false;
  if (String(it.casoVentasId || '').trim()) return true;
  return _reportes.some((r) => r.papeletaId === it.id && r.status === 'abierto');
}

function _cleanup() {
  _unsubs.forEach((u) => { try { u(); } catch (_) { /* ignore */ } });
  _unsubs = [];
  if (_detailUnsub) { try { _detailUnsub(); } catch (_) { /* ignore */ } }
  _detailUnsub = null;
}

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function _fotoUrl(path) {
  if (!path) return '';
  if (_fotoCache.has(path)) return _fotoCache.get(path);
  const url = await getDownloadUrl(path);
  _fotoCache.set(path, url);
  return url;
}

function _filteredItems() {
  const q = _query.trim().toLowerCase();
  return _items.filter((it) => {
    if (_filter === 'activas' && !it.activoPorUnidad) return false;
    if (_filter === 'entregadas' && it.status !== 'entregada') return false;
    if (_filter === 'historial' && it.status !== 'cerrada_historial' && it.status !== 'en_retorno') return false;
    if (_filter === 'ventas' && !it.casoVentasId && !_reportes.some((r) => r.papeletaId === it.id && r.status === 'abierto')) return false;
    if (!q) return true;
    const hay = [it.mva, it.placas, it.modelo, it.vin, it.clienteNombre].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function _fotosCount(p) {
  return ZONAS_V1.filter((z) => String(p?.zonas?.[z.id]?.fotoPath || '').trim()).length;
}

export async function mount(ctx) {
  _cleanup();
  _container = ctx.container;
  _navigate = ctx.navigate;
  _items = [];
  _reportes = [];
  _detail = null;
  _query = '';
  _filter = 'activas';
  _wizardStep = 'datos';
  _zonaIdx = 0;
  _showNueva = false;
  _casoWarning = '';

  // Canonical detail: /app/papeletas/p/:uid — rewrite legacy /app/papeletas/:uid
  const legacyId = _isLegacyDetailPath() ? _pathId() : '';
  if (legacyId) {
    _navigate?.(_detailRoute(legacyId), { replace: true });
  }

  if (_isVentasPath()) _mode = 'ventas';
  else if (_pathId()) _mode = 'detail';
  else _mode = 'list';

  _render();

  const plaza = String(getCurrentPlaza() || ctx?.state?.currentPlaza || '').toUpperCase();
  _unsubs.push(subscribePapeletasPlaza({
    plazaId: plaza,
    onData: (rows) => {
      _items = rows || [];
      if (_mode === 'list') _paintList();
      else if (_mode === 'ventas') _render();
    },
  }));

  if (_canVentas()) {
    _unsubs.push(subscribeReportesAbiertos({
      onData: (rows) => {
        _reportes = rows || [];
        if (_mode === 'list') _paintList();
        else if (_mode === 'ventas') _render();
      },
    }));
  }

  const id = _pathId();
  if (id) _watchDetail(id);
}

export function unmount() {
  _cleanup();
  _container = null;
  _navigate = null;
  _fotoCache.clear();
}

function _watchDetail(id) {
  if (_detailUnsub) { try { _detailUnsub(); } catch (_) { /* ignore */ } }
  _detailUnsub = subscribePapeleta(id, {
    onData: (doc) => {
      _detail = doc;
      _mode = 'detail';
      _render();
    },
  });
}

function _gotoList() {
  _mode = 'list';
  _detail = null;
  if (_detailUnsub) { try { _detailUnsub(); } catch (_) { /* ignore */ } }
  _detailUnsub = null;
  _navigate?.(LIST_ROUTE, { replace: false });
  _render();
}

function _gotoVentas() {
  _mode = 'ventas';
  _navigate?.(VENTAS_ROUTE);
  _render();
}

function _openDetail(id) {
  const token = String(id || '').trim();
  if (!token) return;
  _mode = 'detail';
  _wizardStep = 'datos';
  _navigate?.(_detailRoute(token));
  _watchDetail(token);
}

function _render() {
  if (!_container) return;
  const canV = _canVentas();
  const editor = _mode === 'detail';
  _container.innerHTML = `
    <section class="pap${editor ? ' pap--editor' : ''}" aria-busy="false">
      ${_casoWarning ? `<div class="pap-banner"><span class="material-symbols-outlined">warning</span><div>${_esc(_casoWarning)}</div></div>` : ''}
      ${_mode === 'ventas' ? `
        <main class="pap-main pap-main--full">
          <header class="pap-page-header">
            <div class="pap-page-title">
              <h1>Papeletas · Ventas</h1>
              <p>Bandeja de reportes abiertos</p>
            </div>
            <div class="pap-actions-bar">
              <button type="button" class="pap-btn pap-btn--ghost" data-act="tab-list">Volver al listado</button>
            </div>
          </header>
          <div class="pap-ventas-host">${_renderVentas()}</div>
        </main>
      ` : editor ? _renderDetail() : _renderList()}
      ${_showNueva ? _renderNuevaModal() : ''}
    </section>
  `;
  _bind();
  if (_wizardStep === 'firma') _bindSignature();
  _hydrateFotos();
  void canV;
}

function _renderList() {
  const rows = _filteredItems();
  const canV = _canVentas();
  return `
    <main class="pap-main pap-main--full">
      <header class="pap-page-header">
        <div class="pap-page-title">
          <h1>Papeletas</h1>
          <p>Papeletas digitales · activas, entregadas e historial</p>
        </div>
        <div class="pap-actions-bar">
          ${canV ? `<button type="button" class="pap-btn pap-btn--ghost" data-act="tab-ventas">Ventas</button>` : ''}
          <button type="button" class="pap-btn pap-btn--primary" data-act="nueva">
            <span class="material-symbols-outlined">add</span> Nueva
          </button>
        </div>
      </header>

      <div class="pap-controls">
        <div class="pap-controls-row">
          <label class="pap-search">
            <span class="material-symbols-outlined">search</span>
            <input id="papSearch" value="${_esc(_query)}" placeholder="Buscar MVA, placas, modelo o cliente" autocomplete="off" enterkeyhint="search"/>
          </label>
          <div class="pap-quick-status" role="tablist" aria-label="Filtro">
            ${['activas', 'entregadas', 'historial', 'ventas'].map((f) => `
              <button type="button" class="${_filter === f ? 'active' : ''}" data-act="filter" data-f="${f}">
                ${FILTER_LABELS[f] || f}
              </button>
            `).join('')}
          </div>
        </div>
      </div>

      <p id="pap-count" class="pap-meta">${rows.length ? `${rows.length} registro${rows.length === 1 ? '' : 's'}` : '0 registros'}</p>
      <div id="pap-table-host" class="pap-table-host">${_tableHtml(rows)}</div>
    </main>
  `;
}

function _tableHtml(rows) {
  if (!rows.length) {
    return `
      <div class="pap-empty">
        <strong>Sin papeletas</strong>
        <small>No hay registros con este filtro. Usa <b>Nueva</b> y busca la unidad por económico o placas.</small>
      </div>`;
  }
  return `
    <div class="pap-table-wrap">
      <table class="pap-table">
        <thead>
          <tr>
            <th>Económico</th>
            <th>Unidad</th>
            <th>Plaza</th>
            <th>Cliente</th>
            <th>Fotos</th>
            <th>Actualizado</th>
            <th>Reporte</th>
            <th>Estatus</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(_rowHtml).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function _rowHtml(it) {
  const fotos = _fotosCount(it);
  const short = STATUS_LABELS_SHORT[it.status] || STATUS_LABELS[it.status] || it.status;
  const updated = _fmtDate(it.actualizadoAt || it.creadoAt);
  const reporte = _hasReporte(it);
  return `
    <tr class="pap-row-clickable" data-act="open" data-id="${_esc(it.id)}" role="button" tabindex="0" title="Abrir papeleta">
      <td><span class="pap-td-main pap-td-mono">${_esc(it.mva || '—')}</span></td>
      <td>
        <span class="pap-td-main">${_esc(it.modelo || '—')}</span>
        <span class="pap-td-sub">${_esc(it.placas || 'Sin placas')}${it.color ? ` · ${_esc(it.color)}` : ''}</span>
      </td>
      <td>${_esc(it.plazaId || '—')}</td>
      <td>${_esc(it.clienteNombre || '—')}</td>
      <td class="pap-td-mono">${fotos}/12</td>
      <td class="pap-td-date">${updated ? _esc(updated) : '<span class="pap-muted">—</span>'}</td>
      <td>${reporte ? '<span class="pap-flag pap-flag--warn">Sí</span>' : '<span class="pap-muted">—</span>'}</td>
      <td><span class="pap-status-text pap-status-text--${_esc(it.status)}">${_esc(short)}</span></td>
    </tr>
  `;
}

function _paintList() {
  if (!_container || _mode !== 'list') return;
  const rows = _filteredItems();
  const count = _container.querySelector('#pap-count');
  const host = _container.querySelector('#pap-table-host');
  if (count) count.textContent = rows.length ? `${rows.length} registro${rows.length === 1 ? '' : 's'}` : '0 registros';
  if (host) {
    host.innerHTML = _tableHtml(rows);
    _bindTableRows(host);
  }
  // Keep filter chip active state in sync without full re-render
  _container.querySelectorAll('[data-act="filter"]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.f === _filter);
  });
}

function _bindTableRows(host) {
  const root = host || _container;
  if (!root) return;
  root.querySelectorAll('tr[data-act="open"]').forEach((row) => {
    row.addEventListener('click', () => _openDetail(row.dataset.id));
    row.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      _openDetail(row.dataset.id);
    });
  });
}

function _renderDetail() {
  if (!_detail) {
    return `
      <main class="pap-editor-shell">
        <header class="pap-editor-top">
          <div>
            <nav class="pap-breadcrumb" aria-label="Ruta">
              <button type="button" data-act="back">Papeletas</button>
              <span>/</span>
              <strong>Detalle</strong>
            </nav>
            <h1>Cargando papeleta…</h1>
          </div>
          <div class="pap-actions-bar">
            <button type="button" class="pap-btn pap-btn--ghost" data-act="back">Volver</button>
          </div>
        </header>
        <div class="pap-empty">Cargando…</div>
      </main>`;
  }
  const p = _detail;
  const editable = puedeEditar(p.status);
  const steps = [
    ['datos', STEP_LABELS.datos],
    ['zonas', STEP_LABELS.zonas],
    ['checklist', STEP_LABELS.checklist],
    ['resumen', STEP_LABELS.resumen],
  ];
  if (p.status === 'entregada' || p.status === 'en_retorno') {
    steps.push(['entrada', STEP_LABELS.entrada]);
    steps.push(['reporte', STEP_LABELS.reporte]);
  }
  const statusLabel = STATUS_LABELS_SHORT[p.status] || STATUS_LABELS[p.status] || p.status;

  return `
    <main class="pap-editor-shell">
      <header class="pap-editor-top">
        <div>
          <nav class="pap-breadcrumb" aria-label="Ruta">
            <button type="button" data-act="back">Papeletas</button>
            <span>/</span>
            <strong>Detalle</strong>
          </nav>
          <h1>${_esc(p.mva || 'Papeleta')} <span class="pap-status-text pap-status-text--${_esc(p.status)}">${_esc(statusLabel)}</span></h1>
          <p class="pap-editor-sub">${_esc(p.modelo || 'Sin modelo')} · ${_esc(p.placas || 'Sin placas')}${p.plazaId ? ` · ${_esc(p.plazaId)}` : ''}${!editable ? ' · Solo lectura' : ''}</p>
        </div>
        <div class="pap-actions-bar">
          <button type="button" class="pap-btn pap-btn--ghost" data-act="back">Volver</button>
        </div>
      </header>
      <div class="pap-detail">
        <div class="pap-steps" role="tablist">
          ${steps.map(([id, label]) => `
            <button type="button" class="pap-step ${_wizardStep === id ? 'is-active' : ''}" data-act="step" data-step="${id}">${label}</button>
          `).join('')}
        </div>
        ${_wizardStep === 'datos' ? _panelDatos(p, editable) : ''}
        ${_wizardStep === 'zonas' ? _panelZonas(p, editable) : ''}
        ${_wizardStep === 'checklist' ? _panelChecklist(p, editable) : ''}
        ${_wizardStep === 'resumen' ? _panelResumen(p, editable) : ''}
        ${_wizardStep === 'firma' ? _panelFirma(p) : ''}
        ${_wizardStep === 'entrada' ? _panelEntrada(p) : ''}
        ${_wizardStep === 'reporte' ? _panelReporte(p) : ''}
      </div>
    </main>
  `;
}

function _panelDatos(p, editable) {
  return `
    <div class="pap-panel">
      <h2>Datos de la unidad</h2>
      <p class="pap-hint">Revisa que coincidan con el auto. Si algo está mal, corrígelo aquí.</p>
      <div class="pap-fields-2">
        ${['mva', 'placas', 'modelo', 'color', 'vin'].map((k) => `
          <div class="pap-field${k === 'vin' || k === 'modelo' ? ' pap-field--full' : ''}">
            <label>${FIELD_LABELS[k] || k}</label>
            <input data-field="${k}" value="${_esc(p[k] || '')}" ${editable ? '' : 'disabled'} autocomplete="off"/>
          </div>
        `).join('')}
      </div>
      ${_canVentas() ? `
        <div class="pap-field">
          <label>Entregar a (nombre del cliente)</label>
          <input data-field="clienteNombre" value="${_esc(p.clienteNombre || '')}" placeholder="Ej: Juan Pérez" autocomplete="off"/>
        </div>
      ` : `
        <div class="pap-field">
          <label>Cliente</label>
          <input value="${_esc(p.clienteNombre || 'Sin asignar')}" disabled/>
        </div>
      `}
      ${editable || _canVentas() ? `
        <div class="pap-actions pap-actions--sticky">
          <button type="button" class="pap-btn pap-btn--primary pap-btn--block" data-act="save-datos" ${_busy ? 'disabled' : ''}>Guardar y seguir</button>
        </div>
      ` : ''}
    </div>
  `;
}

function _panelZonas(p, editable) {
  const z = ZONAS_V1[_zonaIdx] || ZONAS_V1[0];
  const data = p.zonas?.[z.id] || { estado: 'ok', nota: '', fotoPath: '' };
  const n = _fotosCount(p);
  return `
    <div class="pap-panel pap-panel--zona">
      <div class="pap-zona-nav">
        <button type="button" class="pap-icon-btn" data-act="zona-prev" ${_zonaIdx <= 0 ? 'disabled' : ''} aria-label="Anterior">
          <span class="material-symbols-outlined">chevron_left</span>
        </button>
        <div class="pap-progress">
          <strong>${_esc(z.label)}</strong>
          <span>Paso ${_zonaIdx + 1} de 12 · ${n}/12 fotos</span>
        </div>
        <button type="button" class="pap-icon-btn" data-act="zona-next" ${_zonaIdx >= 11 ? 'disabled' : ''} aria-label="Siguiente">
          <span class="material-symbols-outlined">chevron_right</span>
        </button>
      </div>
      <div class="pap-seg">
        <button type="button" class="pap-seg__btn ${data.estado !== 'dano' ? 'is-on' : ''}" data-act="zona-ok" ${editable ? '' : 'disabled'}>Sin daño</button>
        <button type="button" class="pap-seg__btn ${data.estado === 'dano' ? 'is-on is-bad' : ''}" data-act="zona-dano" ${editable ? '' : 'disabled'}>Hay daño</button>
      </div>
      <input type="hidden" data-zona-estado value="${data.estado === 'dano' ? 'dano' : 'ok'}"/>
      ${data.estado === 'dano' ? `
        <div class="pap-field">
          <label>Nota corta (opcional)</label>
          <input data-zona-nota maxlength="40" value="${_esc(data.nota || '')}" placeholder="Ej: rayón puerta" ${editable ? '' : 'disabled'}/>
        </div>
      ` : `<input type="hidden" data-zona-nota value="${_esc(data.nota || '')}"/>`}
      <div class="pap-cam">
        <img data-zona-preview alt="" class="pap-cam__preview"${data.fotoPath ? '' : ' hidden'}/>
        <div class="pap-cam__status" data-foto-status>${data.fotoPath ? 'Foto lista ✓' : 'Falta foto de esta parte'}</div>
        ${editable ? `
          <label class="pap-cam__btn">
            <input type="file" accept="image/*" capture="environment" data-zona-foto data-autosave="1" hidden/>
            <span class="material-symbols-outlined">photo_camera</span>
            ${data.fotoPath ? 'Repetir foto' : 'Tomar foto'}
          </label>
          ${data.estado === 'dano' ? `
            <label class="pap-cam__btn pap-cam__btn--ghost">
              <input type="file" accept="image/*" capture="environment" data-zona-detalle hidden/>
              <span class="material-symbols-outlined">add_a_photo</span>
              Foto detalle
            </label>
          ` : ''}
        ` : ''}
      </div>
      ${editable ? `
        <div class="pap-actions pap-actions--sticky">
          <button type="button" class="pap-btn pap-btn--primary pap-btn--block" data-act="save-zona" ${_busy ? 'disabled' : ''}>
            ${data.fotoPath ? 'Guardar y siguiente' : 'Guardar foto'}
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

function _panelChecklist(p, editable) {
  return `
    <div class="pap-panel">
      <h2>Accesorios</h2>
      <p class="pap-hint">Marca si cada cosa está, falta o no aplica.</p>
      <div class="pap-check-grid">
        ${CHECKLIST_KEYS.map((k) => `
          <div class="pap-check-item">
            <div class="pap-check-item__name">${_esc(CHECKLIST_LABELS[k] || k)}</div>
            <select data-check="${k}" ${editable ? '' : 'disabled'}>
              <option value="">Elegir…</option>
              <option value="ok" ${p.checklist?.[k] === 'ok' ? 'selected' : ''}>Sí está</option>
              <option value="faltante" ${p.checklist?.[k] === 'faltante' ? 'selected' : ''}>Falta</option>
              <option value="na" ${p.checklist?.[k] === 'na' ? 'selected' : ''}>No aplica</option>
            </select>
          </div>
        `).join('')}
      </div>
      ${editable ? `
        <div class="pap-actions pap-actions--sticky">
          <button type="button" class="pap-btn pap-btn--primary pap-btn--block" data-act="save-check" ${_busy ? 'disabled' : ''}>Guardar accesorios</button>
        </div>
      ` : ''}
    </div>
  `;
}

function _panelResumen(p) {
  const ready = puedeEntregar(p.status, p.zonas, p.checklist);
  const fotosOk = allZonasHaveFoto(p.zonas);
  const checkOk = checklistCompleto(p.checklist);
  const canEntregarUi = p.status === 'lista' || (fotosOk && checkOk && puedeEditar(p.status));
  const kmGasEditable = canEntregarUi && puedeEditar(p.status);
  return `
    <div class="pap-panel">
      <h2>Listo para entregar</h2>
      <ul class="pap-checklist-status">
        <li class="${fotosOk ? 'is-ok' : ''}">Fotos del auto: ${fotosOk ? '12/12' : `${_fotosCount(p)}/12`}</li>
        <li class="${checkOk ? 'is-ok' : ''}">Accesorios: ${checkOk ? 'completos' : 'faltan por marcar'}</li>
        <li>Estado: ${_esc(STATUS_LABELS[p.status] || p.status)}</li>
      </ul>
      ${p.status === 'lista' ? '<p class="pap-ready">Ya puedes entregar</p>' : ''}
      ${!fotosOk || !checkOk ? '<p class="pap-hint">Termina las fotos y los accesorios para poder entregar.</p>' : ''}
      <p class="pap-entregar-a">Entregar a: <b>${_esc(p.clienteNombre || 'Sin cliente')}</b></p>
      <div class="pap-fields-2">
        <div class="pap-field">
          <label>Kilometraje al salir</label>
          <input id="papKmSalida" type="number" inputmode="numeric" value="${_esc(p.salida?.km ?? _pendingSalida.km ?? '')}" ${kmGasEditable ? '' : 'disabled'}/>
        </div>
        <div class="pap-field">
          <label>Gasolina al salir</label>
          <input id="papGasSalida" value="${_esc(p.salida?.gas ?? _pendingSalida.gas ?? '')}" placeholder="Ej: 3/4" ${kmGasEditable ? '' : 'disabled'}/>
        </div>
      </div>
      <div class="pap-actions pap-actions--sticky">
        ${canEntregarUi ? `
          <button type="button" class="pap-btn pap-btn--primary pap-btn--block" data-act="start-entregar" ${(!_busy && (ready || (fotosOk && checkOk))) ? '' : 'disabled'}>
            Pedir firma y entregar
          </button>
        ` : ''}
        ${p.status === 'entregada' || p.status === 'en_retorno' || p.status === 'cerrada_historial' ? `
          <button type="button" class="pap-btn pap-btn--ghost pap-btn--block" data-act="pdf" title="Exportar PDF / XLS / CSV">Exportar</button>
        ` : ''}
        ${p.status === 'entregada' ? `
          <button type="button" class="pap-btn pap-btn--primary pap-btn--block" data-act="goto-entrada">Registrar regreso</button>
        ` : ''}
      </div>
    </div>
  `;
}

function _panelFirma(p) {
  return `
    <div class="pap-panel">
      <h2>${_esc(p.clienteNombre || 'Cliente')} — Firma</h2>
      <canvas class="pap-sig" id="papSig" width="480" height="180"></canvas>
      <div class="pap-actions">
        <button type="button" class="pap-btn pap-btn--ghost" data-act="sig-clear">Limpiar</button>
        <button type="button" class="pap-btn pap-btn--primary" data-act="sig-confirm" ${_busy ? 'disabled' : ''}>Confirmar entrega</button>
      </div>
    </div>
  `;
}

function _panelEntrada(p) {
  const locked = p.status === 'en_retorno' || p.status === 'cerrada_historial';
  return `
    <div class="pap-panel">
      <h2>Registrar entrada</h2>
      <div class="pap-photos" id="papCompare"></div>
      <div class="pap-field"><label>Quién recibe</label><input id="papQuienRecibe" value="${_esc(p.entrada?.quienRecibe || _user().nombre)}" ${locked ? 'disabled' : ''}/></div>
      <div class="pap-field"><label>KM entrada</label><input id="papKmIn" type="number" value="${_esc(p.entrada?.km ?? '')}" ${locked ? 'disabled' : ''}/></div>
      <div class="pap-field"><label>Gas entrada</label><input id="papGasIn" value="${_esc(p.entrada?.gas ?? '')}" ${locked ? 'disabled' : ''}/></div>
      <div class="pap-field"><label>Notas</label><textarea id="papNotasIn" rows="3" ${locked ? 'disabled' : ''}>${_esc(p.entrada?.notas || '')}</textarea></div>
      ${!locked ? `
        <div class="pap-actions">
          <button type="button" class="pap-btn pap-btn--primary" data-act="save-entrada" ${_busy ? 'disabled' : ''}>Registrar entrada</button>
        </div>
      ` : `<p class="pap-card__meta">Entrada registrada · unidad liberada para nueva papeleta</p>`}
    </div>
  `;
}

function _panelReporte(p) {
  return `
    <div class="pap-panel">
      <h2>Reportar daño / faltante</h2>
      <div class="pap-field">
        <label>Tipo</label>
        <select id="papRepTipo"><option value="dano">Daño</option><option value="faltante">Faltante</option></select>
      </div>
      <div class="pap-field">
        <label>Zonas (daño)</label>
        <select id="papRepZonas" multiple size="6">
          ${ZONAS_V1.map((z) => `<option value="${z.id}">${_esc(z.label)}</option>`).join('')}
        </select>
      </div>
      <div class="pap-field">
        <label>Ítems faltantes</label>
        <select id="papRepItems" multiple size="6">
          ${CHECKLIST_KEYS.map((k) => `<option value="${k}">${_esc(CHECKLIST_LABELS[k])}</option>`).join('')}
        </select>
      </div>
      <div class="pap-field"><label>Foto placas *</label><input type="file" accept="image/*" id="papRepPlacas"/></div>
      <div class="pap-field"><label>Foto VIN *</label><input type="file" accept="image/*" id="papRepVin"/></div>
      <div class="pap-field"><label>Fotos daño</label><input type="file" accept="image/*" id="papRepDanos" multiple/></div>
      <div class="pap-actions">
        <button type="button" class="pap-btn pap-btn--danger" data-act="send-reporte" ${_busy ? 'disabled' : ''}>Enviar a Ventas</button>
      </div>
    </div>
  `;
}

function _renderVentas() {
  if (!_canVentas()) return `<div class="pap-empty">Sin permiso de Ventas.</div>`;
  if (!_reportes.length) return `<div class="pap-empty">No hay reportes abiertos.</div>`;
  return `
    <div class="pap-grid">
      ${_reportes.map((r) => `
        <div class="pap-card" style="cursor:default">
          <div class="pap-card__top">
            <span class="pap-card__mva">${_esc(r.mva || r.unidadId)}</span>
            <span class="pap-status">${_esc(r.tipo)} · ${_esc(r.status)}</span>
          </div>
          <div class="pap-card__meta">Papeleta ${_esc(r.papeletaId)}</div>
          <div class="pap-actions">
            <button type="button" class="pap-btn pap-btn--ghost" data-act="open" data-id="${_esc(r.papeletaId)}">Ver</button>
            <button type="button" class="pap-btn pap-btn--primary" data-act="promover" data-id="${_esc(r.id)}">Promover</button>
            ${rolPuedeCerrarCaso(_role()) ? `<button type="button" class="pap-btn pap-btn--ghost" data-act="cerrar-caso" data-id="${_esc(r.id)}">Cerrar caso</button>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function _unitHitHtml(u) {
  return `
    <button type="button" class="pap-ac-item" data-act="pick-unit" data-id="${_esc(u.id)}">
      <span class="pap-ac-item__mva">${_esc(u.mva || '—')}</span>
      <span class="pap-ac-item__meta">
        <span>${_esc(u.placas || 'Sin placas')}</span>
        <span>${_esc(u.modelo || 'Sin modelo')}${u.color ? ` · ${_esc(u.color)}` : ''}</span>
      </span>
      <span class="material-symbols-outlined">chevron_right</span>
    </button>`;
}

function _renderUnitHitsHtml() {
  if (_unitSearchBusy) {
    return `<div class="pap-ac-empty">Buscando…</div>`;
  }
  if (!_unitHits.length) {
    return `<div class="pap-ac-empty">${_unitQ.trim() ? 'Sin coincidencias. Prueba económico o placas.' : 'Escribe económico, placas o modelo.'}</div>`;
  }
  return _unitHits.map(_unitHitHtml).join('');
}

function _paintUnitHits() {
  const host = _container?.querySelector('#papUnitHits');
  if (!host) return;
  host.innerHTML = _renderUnitHitsHtml();
  host.querySelectorAll('[data-act="pick-unit"]').forEach((btn) => {
    btn.addEventListener('click', () => _crearDesdeUnidad(btn.dataset.id));
  });
}

async function _runUnitAutocomplete(raw) {
  const seq = ++_unitSearchSeq;
  _unitQ = raw;
  _unitSearchBusy = true;
  _paintUnitHits();
  try {
    const plaza = String(getCurrentPlaza() || '').toUpperCase();
    const hits = await buscarUnidad(_unitQ, { limit: 12, plazaId: plaza });
    if (seq !== _unitSearchSeq) return;
    _unitHits = hits;
  } catch (_) {
    if (seq !== _unitSearchSeq) return;
    _unitHits = [];
  } finally {
    if (seq === _unitSearchSeq) {
      _unitSearchBusy = false;
      _paintUnitHits();
    }
  }
}

function _scheduleUnitAutocomplete(raw) {
  if (_unitSearchTimer) clearTimeout(_unitSearchTimer);
  _unitSearchTimer = setTimeout(() => _runUnitAutocomplete(raw), 160);
}

function _renderNuevaModal() {
  return `
    <div class="pap-modal-backdrop" data-act="close-modal">
      <div class="pap-modal pap-modal--ac" data-stop role="dialog" aria-label="Nueva papeleta">
        <div class="pap-modal__head">
          <h2>Nueva papeleta</h2>
          <button type="button" class="pap-icon-btn" data-act="close-nueva" aria-label="Cerrar">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <p class="pap-hint">Busca la unidad y tócala para abrir la papeleta.</p>
        <label class="pap-ac">
          <span class="material-symbols-outlined">directions_car</span>
          <input id="papUnitQ" type="search" inputmode="search" enterkeyhint="search"
            placeholder="Económico, placas o modelo…"
            value="${_esc(_unitQ)}" autocomplete="off" autocorrect="off" spellcheck="false"/>
        </label>
        <div class="pap-ac-list" id="papUnitHits" role="listbox">
          ${_renderUnitHitsHtml()}
        </div>
      </div>
    </div>
  `;
}

function _bind() {
  const root = _container;
  if (!root) return;

  root.querySelector('[data-act="tab-list"]')?.addEventListener('click', () => _gotoList());
  root.querySelector('[data-act="tab-ventas"]')?.addEventListener('click', () => _gotoVentas());
  root.querySelector('[data-act="nueva"]')?.addEventListener('click', async () => {
    _showNueva = true;
    _unitHits = [];
    _unitQ = '';
    _render();
    // Prefetch sugerencias de plaza
    _runUnitAutocomplete('');
    queueMicrotask(() => _container?.querySelector('#papUnitQ')?.focus());
  });
  root.querySelector('#papSearch')?.addEventListener('input', (e) => {
    _query = e.target.value;
    _paintList();
  });
  root.querySelectorAll('[data-act="filter"]').forEach((btn) => {
    btn.addEventListener('click', () => { _filter = btn.dataset.f; _paintList(); });
  });
  // Buttons (Ventas bandeja); table rows use _bindTableRows (keyboard + click)
  root.querySelectorAll('button[data-act="open"]').forEach((el) => {
    el.addEventListener('click', () => _openDetail(el.dataset.id));
  });
  root.querySelectorAll('[data-act="back"]').forEach((btn) => {
    btn.addEventListener('click', () => _gotoList());
  });
  root.querySelectorAll('[data-act="step"]').forEach((btn) => {
    btn.addEventListener('click', () => { _wizardStep = btn.dataset.step; _render(); });
  });
  root.querySelector('[data-act="zona-prev"]')?.addEventListener('click', () => {
    _zonaIdx = Math.max(0, _zonaIdx - 1); _render();
  });
  root.querySelector('[data-act="zona-next"]')?.addEventListener('click', () => {
    _zonaIdx = Math.min(11, _zonaIdx + 1); _render();
  });
  root.querySelector('[data-act="zona-ok"]')?.addEventListener('click', () => {
    const hid = _container.querySelector('[data-zona-estado]');
    if (hid) hid.value = 'ok';
    _renderZonaEstadoUi('ok');
  });
  root.querySelector('[data-act="zona-dano"]')?.addEventListener('click', () => {
    const hid = _container.querySelector('[data-zona-estado]');
    if (hid) hid.value = 'dano';
    // Re-render panel to show nota + detalle (estado local until save)
    if (_detail) {
      const z = ZONAS_V1[_zonaIdx];
      if (!_detail.zonas) _detail.zonas = {};
      _detail.zonas[z.id] = { ...(_detail.zonas[z.id] || {}), estado: 'dano' };
      _render();
    }
  });
  root.querySelector('[data-act="save-datos"]')?.addEventListener('click', () => _saveDatos());
  root.querySelector('[data-act="save-zona"]')?.addEventListener('click', () => _saveZona());
  root.querySelector('[data-act="save-check"]')?.addEventListener('click', () => _saveCheck());
  root.querySelector('[data-act="start-entregar"]')?.addEventListener('click', () => _startEntregar());
  root.querySelector('[data-act="sig-clear"]')?.addEventListener('click', () => _clearSig());
  root.querySelector('[data-act="sig-confirm"]')?.addEventListener('click', () => _confirmFirma());
  root.querySelector('[data-act="pdf"]')?.addEventListener('click', () => _doPdf());
  root.querySelector('[data-act="goto-entrada"]')?.addEventListener('click', () => {
    _wizardStep = 'entrada'; _render();
  });
  root.querySelector('[data-act="save-entrada"]')?.addEventListener('click', () => _saveEntrada());
  root.querySelector('[data-act="send-reporte"]')?.addEventListener('click', () => _sendReporte());
  root.querySelectorAll('[data-act="promover"]').forEach((btn) => {
    btn.addEventListener('click', () => _promover(btn.dataset.id));
  });
  root.querySelectorAll('[data-act="cerrar-caso"]').forEach((btn) => {
    btn.addEventListener('click', () => _cerrar(btn.dataset.id));
  });
  root.querySelector('[data-act="close-modal"]')?.addEventListener('click', (e) => {
    if (e.target.dataset.act === 'close-modal') { _showNueva = false; _render(); }
  });
  root.querySelector('[data-act="close-nueva"]')?.addEventListener('click', () => {
    _showNueva = false; _render();
  });
  root.querySelector('#papUnitQ')?.addEventListener('input', (e) => {
    _scheduleUnitAutocomplete(e.target.value || '');
  });
  root.querySelectorAll('[data-act="pick-unit"]').forEach((btn) => {
    btn.addEventListener('click', () => _crearDesdeUnidad(btn.dataset.id));
  });
  // Auto-guardar al elegir foto (flujo rápido en patio)
  root.querySelector('[data-zona-foto][data-autosave]')?.addEventListener('change', () => {
    if (_container.querySelector('[data-zona-foto]')?.files?.[0]) _saveZona();
  });
  if (_mode === 'list') _bindTableRows(_container.querySelector('#pap-table-host'));
}

function _renderZonaEstadoUi(estado) {
  if (_detail) {
    const z = ZONAS_V1[_zonaIdx];
    if (!_detail.zonas) _detail.zonas = {};
    _detail.zonas[z.id] = { ...(_detail.zonas[z.id] || {}), estado };
  }
  _render();
}

async function _hydrateFotos() {
  if (!_detail || !_container) return;
  const z = ZONAS_V1[_zonaIdx];
  const path = _detail.zonas?.[z?.id]?.fotoPath;
  const img = _container.querySelector('[data-zona-preview]');
  if (img && path) {
    const url = await _fotoUrl(path);
    if (url) { img.src = url; img.style.display = 'block'; }
  }
  const compare = _container.querySelector('#papCompare');
  if (compare && (_wizardStep === 'entrada')) {
    const parts = [];
    for (const zona of ZONAS_V1) {
      const zp = _detail.zonas?.[zona.id];
      if (!zp?.fotoPath) continue;
      const url = await _fotoUrl(zp.fotoPath);
      if (!url) continue;
      parts.push(`<figure><img src="${_esc(url)}" alt=""/><figcaption>${_esc(zona.label)}${zp.estado === 'dano' ? ' · daño' : ''}</figcaption></figure>`);
    }
    compare.innerHTML = parts.join('') || '<div class="pap-card__meta">Sin fotos de salida</div>';
  }
}

async function _saveDatos() {
  if (!_detail) return;
  const patch = {};
  _container.querySelectorAll('[data-field]').forEach((el) => {
    patch[el.dataset.field] = el.value.trim();
  });
  _busy = true; _render();
  try {
    if (patch.clienteNombre != null && _canVentas()) {
      await asignarCliente(_detail.id, patch.clienteNombre, { user: _user() });
      delete patch.clienteNombre;
    }
    if (puedeEditar(_detail.status) && Object.keys(patch).length) {
      await actualizarPapeleta(_detail.id, patch, { user: _user() });
    }
    if (puedeEditar(_detail.status)) _wizardStep = 'zonas';
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false; _render();
  }
}

async function _saveZona() {
  if (!_detail) return;
  const z = ZONAS_V1[_zonaIdx];
  const estado = _container.querySelector('[data-zona-estado]')?.value || 'ok';
  const nota = truncNota(_container.querySelector('[data-zona-nota]')?.value || '');
  const file = _container.querySelector('[data-zona-foto]')?.files?.[0];
  const det = _container.querySelector('[data-zona-detalle]')?.files?.[0];
  _busy = true; _render();
  try {
    const zonas = { ...(_detail.zonas || {}) };
    const cur = { ...(zonas[z.id] || { estado: 'ok', nota: '', fotoPath: '' }) };
    cur.estado = estado;
    cur.nota = nota;
    if (file) cur.fotoPath = await uploadZonaFoto(_detail.id, z.id, file);
    if (det) cur.fotoDetallePath = await uploadZonaDetalle(_detail.id, z.id, det);
    if (!cur.fotoPath) throw new Error('La foto de la zona es obligatoria');
    zonas[z.id] = cur;
    await actualizarPapeleta(_detail.id, { zonas }, { user: _user() });
    if (_zonaIdx < 11) _zonaIdx += 1;
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false; _render();
  }
}

async function _saveCheck() {
  if (!_detail) return;
  const checklist = { ...(_detail.checklist || {}) };
  _container.querySelectorAll('[data-check]').forEach((el) => {
    checklist[el.dataset.check] = el.value;
  });
  _busy = true; _render();
  try {
    await actualizarPapeleta(_detail.id, { checklist }, { user: _user() });
    _wizardStep = 'resumen';
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false; _render();
  }
}

async function _ensureListaAntesDeEntregar() {
  if (!_detail) return false;
  if (_detail.status === 'lista') return true;
  if (!allZonasHaveFoto(_detail.zonas) || !checklistCompleto(_detail.checklist)) {
    await _mexAlert('Falta completar', 'Necesitas 12 fotos y checklist completo para entregar.');
    return false;
  }
  // Fuerza recálculo de status → lista
  await actualizarPapeleta(_detail.id, {}, { user: _user() });
  return true;
}

async function _startEntregar() {
  if (!_detail) return;
  _pendingSalida = {
    km: _container.querySelector('#papKmSalida')?.value ?? '',
    gas: _container.querySelector('#papGasSalida')?.value ?? '',
  };
  if (!_detail.clienteNombre) {
    const ok = await _mexConfirm('Sin cliente asignado', 'Sin cliente asignado — ¿continuar?', 'warning');
    if (!ok) return;
  }
  try {
    const okLista = await _ensureListaAntesDeEntregar();
    if (!okLista) return;
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
    return;
  }
  _sigHasInk = false;
  _wizardStep = 'firma';
  _render();
}

function _bindSignature() {
  const canvas = _container?.querySelector('#papSig');
  if (!canvas || canvas.dataset.bound === '1') return;
  canvas.dataset.bound = '1';
  const ctx = canvas.getContext('2d');
  // Pad tipo papel: tinta oscura sobre blanco (PDF legible en claro/oscuro)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left) * (canvas.width / r.width), y: (src.clientY - r.top) * (canvas.height / r.height) };
  };

  const start = (e) => { e.preventDefault(); _sigDrawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e) => {
    if (!_sigDrawing) return;
    e.preventDefault();
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    _sigHasInk = true;
  };
  const end = () => { _sigDrawing = false; };

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);
}

function _clearSig() {
  const canvas = _container?.querySelector('#papSig');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  _sigHasInk = false;
}

async function _confirmFirma() {
  if (!_detail) return;
  const canvas = _container?.querySelector('#papSig');
  if (!canvas) return;
  if (!_sigHasInk) {
    await _mexAlert('Firma', 'Firma el pad antes de confirmar la entrega.');
    return;
  }
  // Capturar ANTES de _render (el re-render destruye el canvas)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    await _mexAlert('Firma', 'No se pudo capturar la firma.');
    return;
  }
  const kmRaw = _pendingSalida.km;
  const gasRaw = _pendingSalida.gas;
  const papeletaId = _detail.id;
  _busy = true; _render();
  try {
    const okLista = await _ensureListaAntesDeEntregar();
    if (!okLista) return;
    const firmaPath = await uploadFirma(papeletaId, blob);
    await entregarPapeleta(papeletaId, {
      quienEntrega: _user().nombre,
      km: kmRaw === '' || kmRaw == null ? null : Number(kmRaw),
      gas: gasRaw || null,
      firmaPath,
      user: _user(),
    });
    const firmaUrl = await getDownloadUrl(firmaPath);
    const updated = {
      ..._detail,
      status: 'entregada',
      salida: { ...(_detail.salida || {}), firmaPath, km: kmRaw, gas: gasRaw },
    };
    openPapeletaPdf(updated, { firmaUrl });
    _pendingSalida = { km: null, gas: null };
    _wizardStep = 'resumen';
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false; _render();
  }
}

async function _doPdf() {
  if (!_detail) return;
  const p = _detail;
  await openExportChooser({
    title: 'Exportar papeleta',
    subtitle: `${p.mva || 'Papeleta'} · PDF / XLS / CSV`,
    onPdf: async () => {
      const firmaUrl = await getDownloadUrl(p.salida?.firmaPath);
      openPapeletaPdf(p, { firmaUrl });
    },
    onXls: () => exportPapeletaXls(p),
    onCsv: () => exportPapeletaCsv(p),
  });
}

async function _saveEntrada() {
  if (!_detail) return;
  _busy = true; _render();
  try {
    await registrarEntrada(_detail.id, {
      quienRecibe: _container.querySelector('#papQuienRecibe')?.value || _user().nombre,
      km: Number(_container.querySelector('#papKmIn')?.value || 0) || null,
      gas: _container.querySelector('#papGasIn')?.value || null,
      notas: _container.querySelector('#papNotasIn')?.value || '',
      user: _user(),
    });
    await _mexAlert('Entrada', 'Entrada registrada. La unidad queda libre para una nueva papeleta.');
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false; _render();
  }
}

async function _sendReporte() {
  if (!_detail) return;
  const tipo = _container.querySelector('#papRepTipo')?.value || 'dano';
  const zonasSel = [...(_container.querySelector('#papRepZonas')?.selectedOptions || [])].map((o) => o.value);
  const itemsSel = [...(_container.querySelector('#papRepItems')?.selectedOptions || [])].map((o) => o.value);
  const fPlacas = _container.querySelector('#papRepPlacas')?.files?.[0];
  const fVin = _container.querySelector('#papRepVin')?.files?.[0];
  const fDanos = [...(_container.querySelector('#papRepDanos')?.files || [])];
  _busy = true; _render();
  try {
    const reporteId = newReporteId();
    const fotos = {};
    if (fPlacas) fotos.placas = await uploadReporteFoto(reporteId, 'placas', fPlacas);
    if (fVin) fotos.vin = await uploadReporteFoto(reporteId, 'vin', fVin);
    fotos.danos = [];
    for (let i = 0; i < fDanos.length; i++) {
      fotos.danos.push(await uploadReporteFoto(reporteId, `dano_${i + 1}`, fDanos[i]));
    }
    const res = await crearReporte({
      id: reporteId,
      papeleta: _detail,
      tipo,
      zonasNuevas: zonasSel,
      itemsFaltantes: itemsSel,
      fotos,
      user: _user(),
    });
    if (res.discarded) {
      await _mexAlert('Reporte', 'Ya documentado en salida');
    } else {
      await _mexAlert('Reporte', 'Enviado a bandeja de Ventas');
    }
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false; _render();
  }
}

async function _promover(id) {
  _busy = true; _render();
  try {
    await promoverReporte(id);
    await _mexAlert('Ventas', 'Evidencias promovidas');
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false; _render();
  }
}

async function _cerrar(id) {
  const ok = await _mexConfirm('Cerrar caso', '¿Cerrar caso global de Ventas?', 'warning');
  if (!ok) return;
  try {
    await cerrarCaso(id, { rol: _role(), user: _user() });
    await _mexAlert('Ventas', 'Caso cerrado');
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  }
}

async function _crearDesdeUnidad(unitId) {
  const unit = _unitHits.find((u) => u.id === unitId);
  if (!unit) return;
  _busy = true;
  try {
    const openCount = await countReportesAbiertosUnidad(unit.id);
    if (openCount > 0) {
      _casoWarning = 'Hay caso Ventas abierto para esta unidad. Puedes crear la papeleta; el aviso permanece visible.';
    } else {
      _casoWarning = '';
    }
    const plaza = String(getCurrentPlaza() || '').toUpperCase();
    const { id } = await crearPapeleta({ unidad: unit, plazaId: plaza, user: _user() });
    _showNueva = false;
    _openDetail(id);
  } catch (e) {
    if (e.code === 'ACTIVE_EXISTS' && e.existing?.id) {
      await _mexAlert('Papeleta activa', 'Ya existe una papeleta activa. Se abrirá la existente.');
      _showNueva = false;
      _openDetail(e.existing.id);
    } else {
      await _mexAlert('Error', e.message || String(e));
    }
  } finally {
    _busy = false;
  }
}
