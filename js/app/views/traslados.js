// ============================================================================
//  /js/app/views/traslados.js - Fase B: traslados SPA
// ============================================================================

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import {
  obtenerTrasladosBootstrap,
  crearTraslado,
  actualizarTraslado,
  cerrarTraslado,
  db,
  COL
} from '/js/core/database.js';

let _ctr = null;
let _navigate = null;
let _offs = [];
let _s = null;
let _unsubTraslados = null;
let _unsubUnidades = null;

const DEFAULT_TYPES = [
  { codigo: 'CORT', etiqueta: 'Cortesia' },
  { codigo: 'GAS', etiqueta: 'Carga de gasolina' },
  { codigo: 'TRANS', etiqueta: 'Transporte de personal' },
  { codigo: 'DROP', etiqueta: 'Retorno por drop off' },
  { codigo: 'INTER', etiqueta: 'Intercambio' },
  { codigo: 'NOCOM', etiqueta: 'No comercial' }
];

// Niveles de gasolina desde las listas globales (Panel Admin → Gasolinas).
// Fallback minimo solo si la config aun no cargo.
function _gasCatalog() {
  const configured = Array.isArray(window.MEX_CONFIG?.listas?.gasolinas)
    ? window.MEX_CONFIG.listas.gasolinas
    : [];
  const values = configured
    .map(item => String((item && typeof item === 'object' ? (item.nombre ?? item.valor ?? '') : item) || '').trim().toUpperCase())
    .filter(Boolean);
  const base = values.length ? values : ['F', '3/4', '1/2', '1/4', 'E'];
  if (!base.includes('N/A')) base.push('N/A');
  return Array.from(new Set(base));
}

const LIST_ROUTE = '/app/traslados';
const NEW_ROUTE = '/app/cuadre/traslados/nuevo';
const VIEW_ROUTE_PREFIX = '/app/cuadre/traslados/v/';
const NEW_ROUTE_ALIASES = new Set([NEW_ROUTE, '/app/traslados/nuevo']);
const VIEW_ROUTE_PREFIXES = [VIEW_ROUTE_PREFIX, '/app/traslados/v/'];
const ROLE_LEVEL = {
  AUXILIAR: 1,
  VENTAS: 2,
  SUPERVISOR: 3,
  JEFE_PATIO: 4,
  GERENTE_PLAZA: 5,
  JEFE_REGIONAL: 6,
  CORPORATIVO_USER: 7,
  JEFE_OPERACION: 8,
  PROGRAMADOR: 9
};

export async function mount({ container, navigate }) {
  unmount();
  _ctr = container;
  _navigate = navigate;

  _ensureCss();
  if (!_canViewTraslados()) {
    _renderNoAccess();
    return;
  }

  const gs = getState();
  const plaza = _normPlaza(getCurrentPlaza() || gs.profile?.plazaAsignada || '');
  _s = {
    plaza,
    loading: true,
    busy: false,
    error: '',
    selectedId: '',
    filtersOpen: false,
    closing: false,
    detailMode: 'list',
    boot: {
      plaza,
      plazas: [],
      traslados: [],
      unidades: [],
      choferes: [],
      tipos: DEFAULT_TYPES,
      canManage: false
    },
    filters: _emptyFilters(),
    draft: _newDraft(plaza)
  };
  _applyRouteMode();

  _renderShell();
  _bind();
  await _load();

  // Plaza activa solo afecta defaults del formulario / picker de unidades al crear.
  // La lista de traslados es global y no se recarga ni se filtra al cambiar de plaza.
  _offs.push(onPlazaChange(next => {
    if (!_s) return;
    _s.plaza = _normPlaza(next);
    if (_s.detailMode === 'new') {
      _s.draft = { ..._s.draft, plazaOrigen: _s.plaza, plazaDestino: _s.draft.plazaDestino || _s.plaza };
    }
    void _reloadUnidadesForPlaza();
  }));
}

export function unmount() {
  _stopLive();
  _offs.forEach(fn => { try { fn(); } catch (_) {} });
  _offs = [];
  _ctr = null;
  _navigate = null;
  _s = null;
}

function _ensureCss() {
  const href = '/css/app-traslados.css?v=20260718a';
  let link = document.querySelector('link[data-app-traslados-css="1"]');
  if (link) {
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
    return;
  }
  link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.appTrasladosCss = '1';
  document.head.appendChild(link);
}

function _bind() {
  const click = event => _onClick(event);
  const input = event => _onInput(event);
  const change = event => _onChange(event);
  const submit = event => _onSubmit(event);
  _ctr.addEventListener('click', click);
  _ctr.addEventListener('input', input);
  _ctr.addEventListener('change', change);
  _ctr.addEventListener('submit', submit);
  _offs.push(() => _ctr?.removeEventListener('click', click));
  _offs.push(() => _ctr?.removeEventListener('input', input));
  _offs.push(() => _ctr?.removeEventListener('change', change));
  _offs.push(() => _ctr?.removeEventListener('submit', submit));
}

async function _load() {
  if (!_s) return;
  _s.loading = true;
  _s.error = '';
  _paintAll();
  try {
    const data = await obtenerTrasladosBootstrap({ plaza: _s.plaza, actorRole: _currentRole() });
    const fallbackPlazas = getState().availablePlazas || [];
    _s.boot = {
      plaza: _normPlaza(data?.plaza || _s.plaza),
      plazas: _uniq([...(data?.plazas || []), ...fallbackPlazas, _s.plaza]),
      traslados: Array.isArray(data?.traslados) ? data.traslados : [],
      unidades: Array.isArray(data?.unidades) ? data.unidades : [],
      choferes: Array.isArray(data?.choferes) ? data.choferes : [],
      tipos: Array.isArray(data?.tipos) && data.tipos.length ? data.tipos : DEFAULT_TYPES,
      canManage: data?.canManage === true || _canManageTraslados()
    };
    _s.loading = false;
    _applyRouteMode();
    _renderShell();
    _paintAll();
    _startLive();
  } catch (err) {
    console.error('[traslados]', err);
    _s.loading = false;
    _s.error = err?.message || 'No se pudo cargar traslados.';
    _paintAll();
  }
}

function _stopLive() {
  if (typeof _unsubTraslados === 'function') {
    try { _unsubTraslados(); } catch (_) {}
  }
  if (typeof _unsubUnidades === 'function') {
    try { _unsubUnidades(); } catch (_) {}
  }
  _unsubTraslados = null;
  _unsubUnidades = null;
}

function _estadoDerivado(row) {
  const raw = String(row?.estado || 'ABIERTO').toUpperCase();
  return raw === 'CERRADO' ? 'CERRADO' : 'ABIERTO';
}

function _mergeTrasladoDocs(docs) {
  const map = new Map();
  docs.forEach(doc => {
    const data = doc.data() || {};
    map.set(doc.id, { id: doc.id, ...data, estadoOperativo: _estadoDerivado(data) });
  });
  const rows = Array.from(map.values());
  rows.sort((a, b) => (_toMs(b.fechaCreacion) || _toMs(b.fechaSalida)) - (_toMs(a.fechaCreacion) || _toMs(a.fechaSalida)));
  return rows;
}

function _startLive() {
  _stopLive();
  if (!_s || !db) return;
  const applyTraslados = snapOrDocs => {
    if (!_s) return;
    const docs = snapOrDocs?.docs || snapOrDocs || [];
    _s.boot.traslados = _mergeTrasladoDocs(docs);
    _paintAll();
  };

  try {
    // Suscripción global: cualquier plaza ve origen/destino de todas las plazas.
    _unsubTraslados = db.collection('traslados').limit(500).onSnapshot(
      snap => applyTraslados(snap),
      err => console.warn('[traslados] live:', err)
    );
    _subscribeUnidadesLive(_normPlaza(_s.plaza));
  } catch (err) {
    console.warn('[traslados] live setup:', err);
  }
}

/** Unidades del picker de alta: por plaza de origen (activa o la elegida en el form). */
function _subscribeUnidadesLive(plazaUp) {
  if (typeof _unsubUnidades === 'function') {
    try { _unsubUnidades(); } catch (_) {}
  }
  _unsubUnidades = null;
  if (!_s || !db || !plazaUp) return;
  _unsubUnidades = db.collection(COL.CUADRE || 'cuadre').where('plaza', '==', plazaUp)
    .onSnapshot(snap => {
      if (!_s) return;
      const rows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(u => u.mva);
      rows.sort((a, b) => String(a.mva || '').localeCompare(String(b.mva || '')));
      _s.boot.unidades = rows;
      if (_isEditorMode()) {
        _paintUnitPickerMenu();
        _syncUnitPickerVisibility();
      }
    }, err => console.warn('[traslados] live unidades:', err));
}

async function _reloadUnidadesForPlaza(plazaOverride = '') {
  if (!_s) return;
  const plazaUp = _normPlaza(plazaOverride || _s.draft?.plazaOrigen || _s.plaza);
  _subscribeUnidadesLive(plazaUp);
  if (!plazaUp || !db) return;
  try {
    const snap = await db.collection(COL.CUADRE || 'cuadre').where('plaza', '==', plazaUp).get();
    const rows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(u => u.mva);
    rows.sort((a, b) => String(a.mva || '').localeCompare(String(b.mva || '')));
    _s.boot.unidades = rows;
    if (_isEditorMode()) {
      _paintUnitPickerMenu();
      _syncUnitPickerVisibility();
    }
  } catch (err) {
    console.warn('[traslados] reload unidades:', err);
  }
}

// Filtros "avanzados" activos (los que viven dentro del panel colapsable).
function _advancedFilterCount() {
  if (!_s) return 0;
  const keys = ['folio', 'chofer', 'creador', 'tipo', 'plazaOrigen', 'plazaDestino', 'salidaDesde', 'salidaHasta', 'regresoDesde', 'regresoHasta'];
  return keys.filter(key => String(_s.filters[key] || '').trim()).length;
}

function _emptyFilters() {
  return {
    folio: '',
    unidad: '',
    chofer: '',
    creador: '',
    tipo: '',
    plazaOrigen: '',
    plazaDestino: '',
    estatus: '',
    salidaDesde: '',
    salidaHasta: '',
    regresoDesde: '',
    regresoHasta: ''
  };
}

function _newDraft(plaza) {
  const now = Date.now();
  return {
    mva: '',
    choferUid: '',
    choferNombre: '',
    tipo: '',
    plazaOrigen: _normPlaza(plaza),
    plazaDestino: _normPlaza(plaza),
    fechaSalida: _toDateTimeLocal(now),
    fechaRegresoEstimada: _toDateTimeLocal(now + 2 * 60 * 60 * 1000),
    regresoTouched: false,
    kmSalida: '',
    nota: '',
    unitFilters: _emptyUnitFilters()
  };
}

function _emptyUnitFilters() {
  return { mva: '', placas: '', marca: '', modelo: '', anio: '', color: '', clase: '' };
}

function _defaultRegresoFromSalida(salidaValue) {
  const base = _toMs(salidaValue) || Date.now();
  return _toDateTimeLocal(base + 2 * 60 * 60 * 1000);
}

function _applyRouteMode() {
  if (!_s) return;
  const path = String(window.location.pathname || '').replace(/\/+$/, '');
  if (NEW_ROUTE_ALIASES.has(path)) {
    _s.detailMode = 'new';
    _s.selectedId = '';
    return;
  }
  const viewPrefix = VIEW_ROUTE_PREFIXES.find(prefix => path.startsWith(prefix));
  if (viewPrefix) {
    _s.detailMode = 'detail';
    _s.selectedId = decodeURIComponent(path.slice(viewPrefix.length) || '');
    return;
  }
  _s.detailMode = 'list';
  _s.selectedId = '';
}

function _viewRoute(id) {
  return `${VIEW_ROUTE_PREFIX}${encodeURIComponent(String(id || ''))}`;
}

function _go(path, opts = {}) {
  if (typeof _navigate === 'function') {
    _navigate(path, opts);
    return;
  }
  if (opts.replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  _applyRouteMode();
  _renderShell();
  _paintAll();
}

function _isEditorMode() {
  return _s?.detailMode === 'new' || _s?.detailMode === 'detail';
}

function _renderShell() {
  if (!_ctr || !_s) return;
  const plazas = _plazas();
  const tipos = _tipos();
  const choferes = _choferes();
  const creadores = _creadores();
  const editor = _isEditorMode();
  _ctr.innerHTML = `
    <section class="tras${editor ? ' tras--editor' : ''}" aria-busy="${_s.loading ? 'true' : 'false'}">
      <div id="tras-banner"></div>

      ${editor ? `
        <main class="tras-editor-shell">
          <header class="tras-editor-top">
            <div>
              <nav class="tras-breadcrumb" aria-label="Ruta">
                <button type="button" data-action="back-list">Traslados</button>
                <span>/</span>
                <strong>${_s.detailMode === 'new' ? 'Nuevo' : 'Detalle'}</strong>
              </nav>
              <h1>${_s.detailMode === 'new' ? 'Nuevo traslado' : 'Detalle del traslado'}</h1>
            </div>
            <div class="tras-actions">
              <button type="button" class="tras-btn ghost" data-action="back-list">Volver</button>
              <button type="button" class="tras-btn ghost" data-action="reload">Actualizar</button>
            </div>
          </header>
          <div id="tras-editor-host"></div>
        </main>
      ` : `
        <main class="tras-main tras-main--full">
          <header class="tras-page-header">
            <div class="tras-page-title">
              <h1>Traslados</h1>
              <p>Traslados no comerciales · activos e historial</p>
            </div>
            <div class="tras-actions">
              <button type="button" class="tras-btn ghost" data-action="reload">Actualizar</button>
              <button type="button" class="tras-btn primary" data-action="new" ${_s.boot.canManage ? '' : 'disabled'}>Nuevo traslado</button>
            </div>
          </header>

          <div class="tras-controls">
            <div class="tras-controls-row">
              <label class="tras-search">
                <input data-filter="unidad" value="${esc(_s.filters.unidad)}" placeholder="Buscar MVA, placas o modelo">
              </label>
              <div class="tras-quick-status" role="tablist" aria-label="Estatus">
                ${['', 'ABIERTO', 'CERRADO'].map(v => `
                  <button type="button" class="${_s.filters.estatus === v ? 'active' : ''}" data-action="quick-status" data-value="${v}">
                    ${v === '' ? 'Todos' : v === 'ABIERTO' ? 'Abiertos' : 'Cerrados'}
                  </button>
                `).join('')}
              </div>
              <button type="button" class="tras-btn ghost small${_advancedFilterCount() ? ' has-filters' : ''}" data-action="toggle-filters" aria-expanded="${_s.filtersOpen ? 'true' : 'false'}">
                Filtros${_advancedFilterCount() ? ` (${_advancedFilterCount()})` : ''}
              </button>
            </div>

            <div class="tras-filter-panel" ${_s.filtersOpen ? '' : 'hidden'}>
              <div class="tras-filter-grid">
                <label><span>Folio</span><input data-filter="folio" value="${esc(_s.filters.folio)}" placeholder="TR-00012"></label>
                <label><span>Chofer</span><input data-filter="chofer" list="tras-chofer-list" value="${esc(_s.filters.chofer)}" placeholder="Buscar chofer"></label>
                <label><span>Autor</span><select data-filter="creador">${_option('', 'Todos', _s.filters.creador)}${creadores.map(v => _option(v, v, _s.filters.creador)).join('')}</select></label>
                <label><span>Razon</span><select data-filter="tipo">${_option('', 'Todas', _s.filters.tipo)}${tipos.map(t => _option(t.codigo, `${t.codigo} · ${t.etiqueta}`, _s.filters.tipo)).join('')}</select></label>
                <label><span>Plaza salida</span><select data-filter="plazaOrigen">${_option('', 'Todas', _s.filters.plazaOrigen)}${plazas.map(p => _option(p, p, _s.filters.plazaOrigen)).join('')}</select></label>
                <label><span>Plaza regreso</span><select data-filter="plazaDestino">${_option('', 'Todas', _s.filters.plazaDestino)}${plazas.map(p => _option(p, p, _s.filters.plazaDestino)).join('')}</select></label>
                <label><span>Salida desde</span><input type="date" data-filter="salidaDesde" value="${esc(_s.filters.salidaDesde)}"></label>
                <label><span>Salida hasta</span><input type="date" data-filter="salidaHasta" value="${esc(_s.filters.salidaHasta)}"></label>
                <label><span>Regreso desde</span><input type="date" data-filter="regresoDesde" value="${esc(_s.filters.regresoDesde)}"></label>
                <label><span>Regreso hasta</span><input type="date" data-filter="regresoHasta" value="${esc(_s.filters.regresoHasta)}"></label>
              </div>
              <div class="tras-filter-actions">
                <button type="button" class="tras-btn ghost small" data-action="clear-filters">Limpiar filtros</button>
              </div>
            </div>
          </div>

          <p id="tras-count" class="tras-meta"></p>

          <div id="tras-table-host" class="tras-table-host"></div>
        </main>
      `}

      <datalist id="tras-chofer-list">
        ${choferes.map(c => `<option value="${esc(c.nombre)}"></option>`).join('')}
      </datalist>
    </section>
  `;
}

function _paintAll() {
  if (!_ctr || !_s) return;
  _paintBanner();
  if (_isEditorMode()) _paintDetail();
  else _paintTable();
}

function _paintBanner() {
  const host = _ctr.querySelector('#tras-banner');
  if (!host) return;
  if (_s.error) {
    host.innerHTML = `<div class="tras-banner danger"><span class="material-icons">error</span><strong>${esc(_s.error)}</strong><button type="button" data-action="reload">Reintentar</button></div>`;
    return;
  }
  host.innerHTML = '';
}

function _paintTable() {
  const host = _ctr.querySelector('#tras-table-host');
  const count = _ctr.querySelector('#tras-count');
  if (!host) return;

  if (_s.loading) {
    host.innerHTML = _tableSkeleton();
    if (count) count.textContent = 'Cargando registros';
    return;
  }

  const rows = _filteredRows();
  const totalForTab = _rowsForTab().length;
  if (count) count.textContent = rows.length ? `${rows.length} de ${totalForTab} registros` : '0 registros';
  if (!rows.length) {
    host.innerHTML = _emptyState('Sin traslados', 'No hay registros que coincidan con los filtros actuales.', 'route');
    return;
  }

  host.innerHTML = `
    <div class="tras-table-wrap">
      <table class="tras-table">
        <thead>
          <tr>
            <th>Folio</th>
            <th>Unidad</th>
            <th>Conductor</th>
            <th>Autor</th>
            <th>Ruta</th>
            <th>Salida</th>
            <th>Regreso</th>
            <th>Razon</th>
            <th>Estatus</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => _rowHtml(row)).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function _rowHtml(row) {
  const st = _estado(row);
  const routeId = _routeToken(row);
  const selected = _isSelected(row) ? ' selected' : '';
  return `
    <tr class="tras-row-clickable${selected}" data-action="select" data-id="${esc(routeId)}" role="button" tabindex="0" title="${st === 'CERRADO' ? 'Ver traslado' : (_s.boot.canManage ? 'Abrir traslado' : 'Ver traslado')}">
      <td class="tras-td-mono">${esc(_shortId(row))}</td>
      <td>
        <span class="tras-td-main">${esc(row.mva || '-')}</span>
        ${row.modelo || row.placas ? `<span class="tras-td-sub">${esc([row.modelo, row.placas].filter(Boolean).join(' · '))}</span>` : ''}
      </td>
      <td>${esc(row.choferNombre || '-')}</td>
      <td>${esc(row.creadoPor || 'Sistema')}</td>
      <td>${esc(row.plazaOrigen || '-')} → ${esc(row.plazaDestino || '-')}</td>
      <td class="tras-td-date">${_dateCell(row.fechaSalida)}</td>
      <td class="tras-td-date">${_dateCell(row.fechaCierre || row.fechaRegresoEstimada)}</td>
      <td>${esc(row.tipoEtiqueta || row.tipo || '-')}</td>
      <td><span class="tras-status-text ${st.toLowerCase()}">${esc(st)}</span></td>
    </tr>
  `;
}

function _dateCell(value) {
  const label = _fmtDate(value);
  return label ? esc(label) : '<span class="tras-muted">—</span>';
}

function _paintDetail() {
  const host = _ctr.querySelector('#tras-editor-host');
  if (!host) return;
  if (_s.loading) {
    host.innerHTML = _detailSkeleton();
    return;
  }
  if (_s.detailMode === 'new') {
    host.innerHTML = _formHtml(null);
    _initFormPickers();
    return;
  }
  const row = _selected();
  if (row) {
    host.innerHTML = _formHtml(row);
    _initFormPickers();
    return;
  }
  host.innerHTML = `
    <div class="tras-detail-empty">
      <span class="material-icons">search_off</span>
      <h2>Traslado no encontrado</h2>
      <p>El registro solicitado no existe o ya no está disponible.</p>
      <button type="button" class="tras-btn primary" data-action="back-list">Volver a la tabla</button>
    </div>
  `;
}

function _formHtml(row) {
  const isNew = !row;
  const isClosed = row && _estado(row) === 'CERRADO';
  const canEdit = _s.boot.canManage && !isClosed;
  const draft = isNew ? _s.draft : _rowToDraft(row);
  const choferLabel = isNew
    ? (draft.choferNombre || _choferLabel(draft.choferUid))
    : (row.choferNombre || _choferLabel(draft.choferUid));
  const unit = isNew ? _unitByMva(draft.mva) : null;
  const gasSalida = isNew ? (unit?.gasolina || 'N/A') : (row.gasSalida || 'N/A');
  const status = isNew ? 'NUEVO' : _estado(row);
  const title = isNew ? 'Agregar traslado no comercial' : `Detalle / Estatus del traslado: ${status === 'ABIERTO' ? 'Abierto' : 'Cerrado'}`;
  const unitSummary = !isNew
    ? [row.mva, row.modelo, row.categoria, row.placas].filter(Boolean).join(', ')
    : '';
  const currentLocation = isNew
    ? (unit?.ubicacion || unit?.plaza || draft.plazaOrigen || _s.plaza)
    : (row.ubicacionActual || row.plazaOrigen || '-');

  return `
    <div class="tras-detail-card tras-detail-card--wide">
      <div class="tras-detail-head">
        <div>
          <p>${isNew ? 'Alta' : 'Detalle'}</p>
          <h2>${esc(title)}</h2>
          <span>${esc(isNew ? 'Completa la salida, destino y unidad para crear el traslado.' : `${row.folio || _shortId(row)} · ${row.plazaOrigen || '-'} a ${row.plazaDestino || '-'}`)}</span>
        </div>
        <span class="tras-status-text ${String(status).toLowerCase()}">${esc(status)}</span>
      </div>

      <form class="tras-form tras-form--wide" data-action="${isNew ? 'create-transfer' : 'update-transfer'}" data-id="${esc(row?.id || '')}">
        <section class="tras-form-panel">
          <div class="tras-form-grid tras-form-grid--meta">
            ${_choferPickerHtml({ uid: draft.choferUid, label: choferLabel, disabled: !(canEdit || isNew) })}
            <label>
              <span>Fecha de salida</span>
              <input type="datetime-local" id="tras-form-salida" name="fechaSalida" value="${esc(draft.fechaSalida)}" ${canEdit || isNew ? '' : 'disabled'}>
            </label>
            <label>
              <span>Fecha de regreso</span>
              <input type="datetime-local" id="tras-form-regreso" name="fechaRegresoEstimada" value="${esc(draft.fechaRegresoEstimada)}" ${canEdit || isNew ? '' : 'disabled'}>
            </label>
            <label>
              <span>Oficina de salida</span>
              <select id="tras-form-plaza-origen" name="plazaOrigen" ${isNew ? '' : 'disabled'}>
                ${_plazas().map(p => _option(p, p, draft.plazaOrigen || _s.plaza)).join('')}
              </select>
            </label>
            <label>
              <span>Oficina de regreso</span>
              <select id="tras-form-plaza-destino" name="plazaDestino" ${canEdit || isNew ? '' : 'disabled'}>
                ${_plazas().map(p => _option(p, p, draft.plazaDestino || _s.plaza)).join('')}
              </select>
            </label>
            <label>
              <span>Razon</span>
              <select id="tras-form-tipo" name="tipo" ${canEdit || isNew ? '' : 'disabled'}>
                ${_option('', 'Seleccionar razon', draft.tipo)}
                ${_tipos().map(t => _option(t.codigo, `${t.codigo} · ${t.etiqueta}`, draft.tipo)).join('')}
              </select>
            </label>
            ${!isNew ? `
              <label>
                <span>Autor</span>
                <input value="${esc(row.creadoPor || 'Sistema')}" readonly>
              </label>
            ` : ''}
            <label class="span-all">
              <span>Comentarios</span>
              <textarea id="tras-form-nota" name="nota" placeholder="Comentarios" ${canEdit || isNew ? '' : 'disabled'}>${esc(isNew ? draft.nota : row.notaCierre || '')}</textarea>
            </label>
          </div>
        </section>

        <section class="tras-form-panel">
          <div class="tras-section-line">
            <h3>Unidades</h3>
            ${!isNew ? `<span>Ubicacion actual: <strong>${esc(currentLocation)}</strong></span>` : ''}
          </div>
          ${isNew ? _unitPickerSectionHtml(draft, unit, gasSalida) : _unitDetailSectionHtml(row, draft, unitSummary, gasSalida, isClosed)}
        </section>

        <div class="tras-form-actions tras-form-actions--footer">
          ${isClosed
            ? `<button type="button" class="tras-btn ghost" data-action="back-list">Volver</button>`
            : `
              <button type="button" class="tras-btn ghost" data-action="back-list">Cancelar</button>
              ${!isNew ? `<button type="button" class="tras-btn ghost" data-action="show-close" data-id="${esc(row.id)}">${_s.closing ? 'Cancelar cierre' : 'Cerrar traslado'}</button>` : ''}
              ${(canEdit || isNew) && !_s.closing ? `<button type="submit" class="tras-btn primary" ${_s.busy ? 'disabled' : ''}>
                ${isNew ? 'Guardar' : 'Guardar cambios'}
              </button>` : ''}
            `}
        </div>
      </form>

      ${!isNew && !isClosed && _s.closing ? _closeFormHtml(row) : ''}
      ${!isNew ? _timelineHtml(row) : ''}
    </div>
  `;
}

function _unitDetailSectionHtml(row, draft, unitSummary, gasSalida, isClosed) {
  const kmSalida = draft.kmSalida ?? row.kmSalida ?? '';
  const showEntrada = isClosed || _s.closing;
  const kmEntrada = row.kmLlegada ?? '';
  const gasEntrada = row.gasLlegada || row.gasSalida || gasSalida || 'N/A';
  const entradaEditable = !isClosed && _s.closing;
  return `
    <div class="tras-form-grid tras-form-grid--unit">
      <label class="span-all">
        <span>Unidad</span>
        <input value="${esc(unitSummary)}" readonly>
      </label>
      <div class="tras-form-pair tras-odo-pair" data-odo-group="salida">
        <label>
          <span>SALIDA · KM</span>
          <input value="${esc(String(kmSalida))}" readonly>
        </label>
        <label>
          <span>SALIDA · GAS</span>
          <input value="${esc(gasSalida)}" readonly>
        </label>
      </div>
      ${showEntrada ? `
        <div class="tras-form-pair tras-odo-pair" data-odo-group="entrada">
          <label>
            <span>ENTRADA · KM</span>
            ${entradaEditable
              ? `<input type="number" min="${esc(String(kmSalida || 0))}" id="tras-close-km" value="${esc(String(kmEntrada))}" required>`
              : `<input value="${esc(String(kmEntrada || '—'))}" readonly>`}
          </label>
          <label>
            <span>ENTRADA · GAS</span>
            ${entradaEditable
              ? `<select id="tras-close-gas">${_gasSelectOptions(gasEntrada)}</select>`
              : `<input value="${esc(String(gasEntrada || '—'))}" readonly>`}
          </label>
        </div>
      ` : ''}
    </div>
  `;
}

function _closeFormHtml(row) {
  return `
    <form class="tras-close-form" id="tras-close-form" data-id="${esc(row.id)}">
      <div class="tras-close-head">
        <span class="material-icons">flag</span>
        <div><strong>Cierre de traslado</strong><small>Completa ENTRADA · KM · GAS arriba, luego confirma.</small></div>
      </div>
      <label><span>Fecha cierre</span><input type="datetime-local" id="tras-close-fecha" value="${esc(_toDateTimeLocal(Date.now()))}"></label>
      <label><span>Nota de cierre</span><textarea id="tras-close-nota" placeholder="Observaciones de llegada"></textarea></label>
      <div class="tras-form-actions">
        <button type="button" class="tras-btn primary" data-action="close-transfer" data-id="${esc(row.id)}" ${_s.busy ? 'disabled' : ''}>Confirmar cierre</button>
      </div>
    </form>
  `;
}

function _timelineHtml(row) {
  const edits = Array.isArray(row.ediciones) ? row.ediciones : [];
  const notes = Array.isArray(row.notas) ? row.notas : [];
  const items = [
    ...edits.map(e => ({ kind: 'Edicion', icon: 'edit_note', title: e.campo || 'Cambio', body: `${e.antes || '-'} → ${e.despues || '-'}`, user: e.usuario, date: e.timestamp || e.fecha })),
    ...notes.map(n => ({ kind: n.tipo === 'CIERRE' ? 'Cierre' : 'Nota', icon: n.tipo === 'CIERRE' ? 'flag' : 'notes', title: n.tipo === 'CIERRE' ? 'Nota de cierre' : 'Nota', body: n.texto, user: n.usuario, date: n.timestamp || n.fecha }))
  ].sort((a, b) => _toMs(b.date) - _toMs(a.date));
  if (!items.length) return `<div class="tras-timeline empty"><span class="material-icons">history</span>Sin notas ni ediciones todavia.</div>`;
  return `
    <div class="tras-timeline">
      <h3>Historial del traslado</h3>
      <table class="tras-history-table">
        <thead>
          <tr>
            <th>Evento</th>
            <th>Detalle</th>
            <th>Usuario</th>
            <th>Fecha</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(item => `
            <tr>
              <td class="tras-history-kind">${esc(item.kind)} · ${esc(item.title)}</td>
              <td>${esc(item.body || 'Sin detalle')}</td>
              <td>${esc(item.user || 'Sistema')}</td>
              <td class="tras-history-date">${_dateCell(item.date)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function _tableSkeleton() {
  return `
    <div class="tras-skeleton-table">
      ${Array.from({ length: 8 }).map(() => `
        <div class="tras-skeleton-row">
          <span></span><span></span><span></span><span></span><span></span>
        </div>
      `).join('')}
    </div>
  `;
}

function _detailSkeleton() {
  return `
    <div class="tras-detail-card">
      <div class="tras-skeleton-detail">
        <span></span><span></span><span></span><span></span><span></span>
      </div>
    </div>
  `;
}

function _emptyState(title, text, icon) {
  return `
    <div class="tras-empty">
      <span class="material-icons">${icon}</span>
      <strong>${esc(title)}</strong>
      <p>${esc(text)}</p>
    </div>
  `;
}

async function _onClick(event) {
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl || !_ctr?.contains(actionEl)) return;
  const action = actionEl.dataset.action;
  if (action === 'reload') {
    _applyRouteMode();
    void _load();
    return;
  }
  if (action === 'new') {
    _s.detailMode = 'new';
    _s.selectedId = '';
    _s.closing = false;
    _s.draft = _newDraft(_s.plaza);
    _go(NEW_ROUTE);
    return;
  }
  if (action === 'select') {
    const id = actionEl.dataset.id || actionEl.closest('tr')?.dataset.id || '';
    if (!id) return;
    _s.selectedId = id;
    _s.detailMode = 'detail';
    _s.closing = false;
    _go(_viewRoute(id));
    return;
  }
  if (action === 'back-list') {
    _s.selectedId = '';
    _s.detailMode = 'list';
    _s.closing = false;
    _go(LIST_ROUTE);
    return;
  }
  if (action === 'clear-filters') {
    _s.filters = _emptyFilters();
    _renderShell();
    _paintAll();
    return;
  }
  if (action === 'toggle-filters') {
    _s.filtersOpen = !_s.filtersOpen;
    _renderShell();
    _paintAll();
    return;
  }
  if (action === 'quick-status') {
    _s.filters.estatus = actionEl.dataset.value || '';
    _renderShell();
    _paintAll();
    return;
  }
  if (action === 'show-close') {
    _s.closing = !_s.closing;
    _paintDetail();
    return;
  }
  if (action === 'close-transfer') {
    await _submitClose(actionEl.dataset.id);
    return;
  }
  if (action === 'picker-select') {
    _handlePickerSelect(actionEl);
    return;
  }
  if (action === 'clear-unit') {
    _clearUnitSelection();
    return;
  }
  if (action === 'picker-toggle') {
    const field = actionEl.closest('.tras-search-field');
    if (field) _togglePicker(field, true);
    return;
  }
  if (!actionEl.closest('.tras-search-field')) {
    _closeAllPickers();
  }
}

function _onInput(event) {
  const filterKey = event.target?.dataset?.filter;
  if (filterKey) {
    _s.filters[filterKey] = event.target.value || '';
    _paintTable();
    return;
  }
  if (event.target?.dataset?.unitFilter != null && _s.detailMode === 'new') {
    const key = event.target.dataset.unitFilter;
    if (!_s.draft.unitFilters) _s.draft.unitFilters = _emptyUnitFilters();
    _s.draft.unitFilters[key] = event.target.value || '';
    // Si el usuario edita filtros tras una selección, limpia MVA hasta re-elegir.
    if (_s.draft.mva) {
      const unit = _unitByMva(_s.draft.mva);
      const stillMatches = unit && _unitMatchesFilters(unit, _s.draft.unitFilters);
      if (!stillMatches) {
        _s.draft.mva = '';
        const hidden = _ctr?.querySelector('#tras-form-mva');
        if (hidden) hidden.value = '';
        _paintUnitSummary(null);
        _syncUnitPickerVisibility();
      }
    }
    _paintUnitPickerMenu();
    _tryAutoSelectUnit();
    const wrap = _ctr?.querySelector('#tras-unit-picker-wrap');
    if (wrap && !_s.draft.mva) {
      wrap.hidden = false;
      _togglePicker(wrap, true);
    }
    return;
  }
  if (event.target?.id === 'tras-form-chofer-search') {
    _s.draft.choferSearch = event.target.value || '';
    const hidden = _ctr?.querySelector('#tras-form-chofer');
    const selectedLabel = _choferLabel(hidden?.value);
    if (event.target.value !== selectedLabel) {
      if (hidden) hidden.value = '';
      _s.draft.choferUid = '';
    }
    _paintChoferPickerMenu();
    const field = event.target.closest('.tras-search-field');
    if (field) _togglePicker(field, true);
    return;
  }
  if (event.target?.id === 'tras-form-unit-search') {
    _paintUnitPickerMenu();
    const field = event.target.closest('.tras-search-field');
    if (field) _togglePicker(field, true);
  }
}

function _onChange(event) {
  const filterKey = event.target?.dataset?.filter;
  if (filterKey) {
    _s.filters[filterKey] = event.target.value || '';
    _paintTable();
    return;
  }
  if (_s.detailMode === 'new' && event.target?.id?.startsWith('tras-form-')) {
    _readDraftFromForm();
    if (event.target.id === 'tras-form-regreso') {
      _s.draft.regresoTouched = true;
    }
    if (event.target.id === 'tras-form-salida' && !_s.draft.regresoTouched) {
      const regreso = _ctr.querySelector('#tras-form-regreso');
      if (regreso) {
        regreso.value = _defaultRegresoFromSalida(event.target.value);
        _s.draft.fechaRegresoEstimada = regreso.value;
      }
    }
    // Al cambiar oficina de salida, el picker carga unidades de esa plaza.
    if (event.target.id === 'tras-form-plaza-origen') {
      const nextPlaza = _normPlaza(event.target.value || _s.plaza);
      _clearUnitSelection();
      void _reloadUnidadesForPlaza(nextPlaza);
    }
  }
}

async function _onSubmit(event) {
  const form = event.target.closest('form[data-action]');
  if (!form) return;
  event.preventDefault();
  const action = form.dataset.action;
  if (action === 'create-transfer') await _submitCreate();
  if (action === 'update-transfer') await _submitUpdate(form.dataset.id);
}

function _readDraftFromForm() {
  if (!_s) return;
  _s.draft = {
    ...(_s.draft || {}),
    mva: _val('tras-form-mva').toUpperCase(),
    choferUid: _val('tras-form-chofer'),
    choferNombre: _val('tras-form-chofer-search') || _s.draft?.choferNombre || '',
    tipo: _val('tras-form-tipo'),
    plazaOrigen: _normPlaza(_val('tras-form-plaza-origen') || _s.plaza),
    plazaDestino: _normPlaza(_val('tras-form-plaza-destino') || _s.plaza),
    fechaSalida: _val('tras-form-salida'),
    fechaRegresoEstimada: _val('tras-form-regreso'),
    kmSalida: _val('tras-form-km'),
    nota: _val('tras-form-nota'),
    unitFilters: _readUnitFiltersFromDom()
  };
}

function _readUnitFiltersFromDom() {
  const out = _emptyUnitFilters();
  Object.keys(out).forEach(key => {
    const el = _ctr?.querySelector(`[data-unit-filter="${key}"]`);
    if (el) out[key] = el.value || '';
  });
  return out;
}

function _applyUnitSelection(unit) {
  if (!_s || !unit) return;
  _s.draft.mva = String(unit.mva || '').toUpperCase();
  _s.draft.unitFilters = {
    mva: unit.mva || '',
    placas: unit.placas || '',
    marca: _unitField(unit, 'marca'),
    modelo: unit.modelo || '',
    anio: _unitField(unit, 'anio'),
    color: _unitField(unit, 'color'),
    clase: _unitField(unit, 'clase')
  };
  const hidden = _ctr?.querySelector('#tras-form-mva');
  if (hidden) hidden.value = _s.draft.mva;
  Object.entries(_s.draft.unitFilters).forEach(([key, value]) => {
    const el = _ctr?.querySelector(`[data-unit-filter="${key}"]`);
    if (el) el.value = value;
  });
  const km = _ctr?.querySelector('#tras-form-km');
  const gas = _ctr?.querySelector('#tras-form-gas-salida');
  if (km) km.value = unit.km ?? '';
  if (gas) gas.value = unit.gasolina || 'N/A';
  _s.draft.kmSalida = km?.value || '';
  _syncUnitPickerVisibility();
  _closeAllPickers();
}

function _paintUnitSummary() {
  // Resumen duplicado eliminado: los filtros rellenados son la fuente de verdad.
  _syncUnitPickerVisibility();
}

function _syncUnitPickerVisibility() {
  const wrap = _ctr?.querySelector('#tras-unit-picker-wrap');
  const hasUnit = Boolean(_s?.draft?.mva);
  if (wrap) wrap.hidden = hasUnit;
  let bar = _ctr?.querySelector('.tras-unit-selected-bar');
  if (hasUnit) {
    if (!bar) {
      const filters = _ctr?.querySelector('#tras-unit-filters');
      if (filters) {
        filters.insertAdjacentHTML('afterend', `
          <div class="tras-unit-selected-bar">
            <span class="material-icons">check_circle</span>
            <strong>${esc(_s.draft.mva)}</strong>
            <span>seleccionada — puedes ajustar los filtros arriba para cambiar</span>
            <button type="button" class="tras-link-btn" data-action="clear-unit">Cambiar</button>
          </div>
        `);
      }
    } else {
      const strong = bar.querySelector('strong');
      if (strong) strong.textContent = _s.draft.mva;
    }
  } else if (bar) {
    bar.remove();
  }
}

function _clearUnitSelection() {
  if (!_s) return;
  _s.draft.mva = '';
  _s.draft.unitFilters = _emptyUnitFilters();
  _s.draft.kmSalida = '';
  const hidden = _ctr?.querySelector('#tras-form-mva');
  if (hidden) hidden.value = '';
  Object.keys(_emptyUnitFilters()).forEach(key => {
    const el = _ctr?.querySelector(`[data-unit-filter="${key}"]`);
    if (el) el.value = '';
  });
  const km = _ctr?.querySelector('#tras-form-km');
  const gas = _ctr?.querySelector('#tras-form-gas-salida');
  if (km) km.value = '';
  if (gas) gas.value = 'N/A';
  _syncUnitPickerVisibility();
  _paintUnitPickerMenu();
  const firstFilter = _ctr?.querySelector('[data-unit-filter="mva"]');
  if (firstFilter) firstFilter.focus();
}

function _syncUnitPreview() {
  const mva = _val('tras-form-mva').toUpperCase();
  const unit = _unitByMva(mva);
  if (unit) _applyUnitSelection(unit);
  else {
    const gas = _ctr?.querySelector('#tras-form-gas-salida');
    if (gas) gas.value = 'N/A';
    _paintUnitSummary(null);
  }
  if (_s?.draft) _s.draft.mva = mva;
}

async function _submitCreate() {
  if (!_s.boot.canManage) return _toast('No tienes permiso para gestionar traslados.', 'error');
  _readDraftFromForm();
  const payload = { ..._s.draft, usuario: _actor(), actorRole: _currentRole() };
  if (!payload.mva) return _toast('Selecciona una unidad.', 'error');
  if (!payload.choferUid) return _toast('Selecciona chofer.', 'error');
  if (!payload.tipo) return _toast('Selecciona razon de traslado.', 'error');
  if (!payload.kmSalida) return _toast('Captura km de salida.', 'error');
  const salidaMs = _toMs(payload.fechaSalida);
  const regresoMs = _toMs(payload.fechaRegresoEstimada);
  if (regresoMs && salidaMs && regresoMs < salidaMs) {
    return _toast('La fecha de regreso no puede ser anterior a la salida.', 'error');
  }
  await _runAction(async () => {
    const res = await crearTraslado(payload);
    if (!res?.ok) throw new Error(res?.error || 'No se pudo crear el traslado.');
    _toast(`Traslado ${res.folio || ''} creado.`, 'success');
    _s.selectedId = res.id || '';
    _s.detailMode = 'detail';
    if (res.id || res.folio) _go(_viewRoute(res.folio || res.id), { replace: true });
    else await _load();
  });
}

async function _submitUpdate(id) {
  if (!id) return;
  if (!_s.boot.canManage) return _toast('No tienes permiso para gestionar traslados.', 'error');
  const payload = {
    choferUid: _val('tras-form-chofer'),
    tipo: _val('tras-form-tipo'),
    plazaDestino: _normPlaza(_val('tras-form-plaza-destino')),
    fechaSalida: _val('tras-form-salida'),
    fechaRegresoEstimada: _val('tras-form-regreso'),
    nota: _val('tras-form-nota'),
    usuario: _actor(),
    actorRole: _currentRole()
  };
  if (!payload.choferUid) return _toast('Selecciona chofer.', 'error');
  const salidaMs = _toMs(payload.fechaSalida);
  const regresoMs = _toMs(payload.fechaRegresoEstimada);
  if (regresoMs && salidaMs && regresoMs < salidaMs) {
    return _toast('La fecha de regreso no puede ser anterior a la salida.', 'error');
  }
  await _runAction(async () => {
    const res = await actualizarTraslado(id, payload);
    if (!res?.ok) throw new Error(res?.error || 'No se pudo actualizar el traslado.');
    _toast('Traslado actualizado.', 'success');
    _s.selectedId = id;
    _s.detailMode = 'detail';
    await _load();
  });
}

async function _submitClose(id) {
  if (!id) return;
  const row = (_s.boot.traslados || []).find(t => t.id === id) || {};
  const kmSalida = Number(row.kmSalida);
  const kmLlegadaRaw = _val('tras-close-km');
  const kmLlegada = Number(kmLlegadaRaw);
  if (!kmLlegadaRaw && kmLlegadaRaw !== 0) return _toast('Captura ENTRADA · KM.', 'error');
  if (!Number.isFinite(kmLlegada) || kmLlegada < 0) return _toast('ENTRADA · KM invalido.', 'error');
  if (Number.isFinite(kmSalida) && kmLlegada < kmSalida) {
    return _toast('ENTRADA · KM no puede ser menor al KM de salida.', 'error');
  }
  const payload = {
    kmLlegada,
    gasLlegada: _val('tras-close-gas'),
    fechaCierre: _val('tras-close-fecha'),
    nota: _val('tras-close-nota'),
    usuario: _actor(),
    actorRole: _currentRole()
  };
  await _runAction(async () => {
    const res = await cerrarTraslado(id, payload);
    if (!res?.ok) throw new Error(res?.error || 'No se pudo cerrar el traslado.');
    _toast('Traslado cerrado.', 'success');
    _s.selectedId = id;
    _s.detailMode = 'detail';
    _s.closing = false;
    await _load();
  });
}

async function _runAction(fn) {
  if (_s.busy) return;
  _s.busy = true;
  _paintDetail();
  try {
    await fn();
  } catch (err) {
    console.error('[traslados/action]', err);
    _toast(err?.message || 'No se pudo completar la accion.', 'error');
  } finally {
    if (_s) {
      _s.busy = false;
      _paintAll();
    }
  }
}

function _rowsForTab() {
  return _s.boot.traslados || [];
}

function _filteredRows() {
  const f = _s.filters;
  let rows = _rowsForTab();
  if (f.folio) rows = rows.filter(r => String(r.folio || r.id || '').toLowerCase().includes(f.folio.toLowerCase().trim()));
  if (f.unidad) {
    const q = f.unidad.toLowerCase().trim();
    rows = rows.filter(r => [r.mva, r.modelo, r.placas, r.categoria].some(v => String(v || '').toLowerCase().includes(q)));
  }
  if (f.chofer) {
    const q = f.chofer.toLowerCase().trim();
    rows = rows.filter(r => String(r.choferNombre || '').toLowerCase().includes(q));
  }
  if (f.creador) rows = rows.filter(r => String(r.creadoPor || '') === f.creador);
  if (f.tipo) {
    const tipo = String(f.tipo).toUpperCase();
    rows = rows.filter(r => String(r.tipo || '').toUpperCase() === tipo);
  }
  if (f.plazaOrigen) rows = rows.filter(r => _normPlaza(r.plazaOrigen) === f.plazaOrigen);
  if (f.plazaDestino) rows = rows.filter(r => _normPlaza(r.plazaDestino) === f.plazaDestino);
  if (f.estatus) rows = rows.filter(r => _estado(r) === f.estatus);
  rows = _dateRange(rows, 'fechaSalida', f.salidaDesde, f.salidaHasta);
  rows = _dateRange(rows, row => row.fechaCierre || row.fechaRegresoEstimada, f.regresoDesde, f.regresoHasta);
  return rows.sort((a, b) => (_toMs(b.fechaSalida) || _toMs(b.fechaCreacion)) - (_toMs(a.fechaSalida) || _toMs(a.fechaCreacion)));
}

function _dateRange(rows, field, from, to) {
  if (!from && !to) return rows;
  const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : 0;
  const toMs = to ? new Date(`${to}T23:59:59`).getTime() : Infinity;
  return rows.filter(row => {
    const value = typeof field === 'function' ? field(row) : row[field];
    const ms = _toMs(value);
    return ms >= fromMs && ms <= toMs;
  });
}

function _selected() {
  return (_s.boot.traslados || []).find(row => _isSelected(row)) || null;
}

function _isSelected(row) {
  const key = String(_s?.selectedId || '').trim();
  if (!key || !row) return false;
  return [row.id, row.folio, _shortId(row)].some(value => String(value || '').trim() === key);
}

function _routeToken(row) {
  return String(row?.folio || row?.id || '').trim();
}

function _rowToDraft(row) {
  return {
    mva: row.mva || '',
    choferUid: row.choferUid || '',
    choferNombre: row.choferNombre || '',
    tipo: row.tipo || '',
    plazaOrigen: row.plazaOrigen || _s.plaza,
    plazaDestino: row.plazaDestino || _s.plaza,
    fechaSalida: _toDateTimeLocal(row.fechaSalida),
    fechaRegresoEstimada: _toDateTimeLocal(row.fechaRegresoEstimada),
    kmSalida: row.kmSalida ?? '',
    nota: '',
    regresoTouched: true,
    unitFilters: _emptyUnitFilters()
  };
}

function _availableUnits() {
  const open = new Set((_s.boot.traslados || []).filter(t => _estado(t) !== 'CERRADO').map(t => String(t.mva || '').toUpperCase()));
  return (_s.boot.unidades || [])
    .filter(u => u?.mva && !open.has(String(u.mva).toUpperCase()) && !String(u.estado || '').toUpperCase().includes('TRASLADO'))
    .sort((a, b) => String(a.mva || '').localeCompare(String(b.mva || '')));
}

function _unitByMva(mva) {
  const key = String(mva || '').trim().toUpperCase();
  return (_s.boot.unidades || []).find(u => String(u.mva || '').trim().toUpperCase() === key) || null;
}

function _unitField(unit, key) {
  if (!unit) return '';
  if (key === 'clase') return unit.categoria || unit.clase || '';
  if (key === 'anio') return unit.anio || unit.año || unit.year || '';
  return unit[key] || '';
}

function _choferLabel(uid) {
  const key = String(uid || '').trim();
  if (!key) return '';
  const found = _choferes().find(c => String(c.uid || c.id) === key);
  return found?.nombre || '';
}

function _deaccent(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function _includesText(haystack, needle) {
  if (!needle) return true;
  return _deaccent(haystack).toLowerCase().includes(_deaccent(needle).toLowerCase());
}

function _filteredChoferes(query = '') {
  const q = String(query || '').trim();
  return _choferes().filter(c => _includesText(c.nombre, q));
}

function _unitMatchesFilters(unit, filters = {}) {
  const f = filters || {};
  if (f.mva && !_includesText(unit.mva, f.mva)) return false;
  if (f.placas && !_includesText(unit.placas, f.placas)) return false;
  if (f.marca && !_includesText(_unitField(unit, 'marca'), f.marca)) return false;
  if (f.modelo && !_includesText(unit.modelo, f.modelo)) return false;
  if (f.anio && !_includesText(_unitField(unit, 'anio'), f.anio)) return false;
  if (f.color && !_includesText(_unitField(unit, 'color'), f.color)) return false;
  if (f.clase && !_includesText(_unitField(unit, 'clase'), f.clase)) return false;
  return true;
}

function _filteredUnitsForPicker() {
  const f = _s?.draft?.unitFilters || _emptyUnitFilters();
  return _availableUnits().filter(unit => _unitMatchesFilters(unit, f));
}

function _tryAutoSelectUnit() {
  if (!_s || _s.detailMode !== 'new') return;
  const rows = _filteredUnitsForPicker();
  if (rows.length === 1) {
    _applyUnitSelection(rows[0]);
  }
}

function _unitPickerLabel(unit) {
  return [unit?.mva, _unitField(unit, 'clase'), unit?.modelo, unit?.placas, _unitField(unit, 'marca')]
    .filter(Boolean)
    .join(' · ');
}

function _choferPickerHtml({ uid = '', label = '', disabled = false } = {}) {
  return `
    <div class="tras-search-field" data-picker="chofer">
      <span>Chofer</span>
      <input type="hidden" id="tras-form-chofer" name="choferUid" value="${esc(uid)}">
      <div class="tras-search-input-wrap">
        <input type="text" id="tras-form-chofer-search" class="tras-search-input" value="${esc(label)}" placeholder="Buscar chofer..." autocomplete="off"${disabled ? ' disabled' : ''}>
        <span class="material-icons" aria-hidden="true">search</span>
      </div>
      <ul class="tras-search-menu" id="tras-chofer-menu" hidden></ul>
    </div>
  `;
}

function _unitPickerSectionHtml(draft, unit, gasSalida) {
  const filters = draft.unitFilters || _emptyUnitFilters();
  const hasUnit = Boolean(unit || draft.mva);
  return `
    <div class="tras-unit-filters" id="tras-unit-filters">
      <label><span>Buscar económico</span><input data-unit-filter="mva" value="${esc(filters.mva)}" placeholder="Buscar económico…" autocomplete="off"></label>
      <label><span>Placas</span><input data-unit-filter="placas" value="${esc(filters.placas)}" placeholder="Buscar placas…" autocomplete="off"></label>
      <label><span>Marca</span><input data-unit-filter="marca" value="${esc(filters.marca)}" placeholder="Buscar marca…" autocomplete="off"></label>
      <label><span>Modelo</span><input data-unit-filter="modelo" value="${esc(filters.modelo)}" placeholder="Buscar modelo…" autocomplete="off"></label>
      <label><span>Año</span><input data-unit-filter="anio" value="${esc(filters.anio)}" placeholder="Buscar año…" autocomplete="off"></label>
      <label><span>Color</span><input data-unit-filter="color" value="${esc(filters.color)}" placeholder="Buscar color…" autocomplete="off"></label>
      <label><span>Clase</span><input data-unit-filter="clase" value="${esc(filters.clase)}" placeholder="Buscar clase…" autocomplete="off"></label>
    </div>
    <div class="tras-search-field span-all" data-picker="unidad" id="tras-unit-picker-wrap"${hasUnit ? ' hidden' : ''}>
      <span>Seleccionar unidad</span>
      <input type="hidden" id="tras-form-mva" name="mva" value="${esc(draft.mva || '')}">
      <div class="tras-search-input-wrap">
        <input type="text" id="tras-form-unit-search" class="tras-search-input" value="" placeholder="Elige una unidad de la lista…" autocomplete="off" readonly tabindex="-1">
        <span class="material-icons" aria-hidden="true">directions_car</span>
      </div>
      <ul class="tras-search-menu" id="tras-unit-menu" hidden></ul>
    </div>
    ${hasUnit ? `
      <div class="tras-unit-selected-bar">
        <span class="material-icons">check_circle</span>
        <strong>${esc(draft.mva || unit?.mva || '')}</strong>
        <span>seleccionada — puedes ajustar los filtros arriba para cambiar</span>
        <button type="button" class="tras-link-btn" data-action="clear-unit">Cambiar</button>
      </div>
    ` : ''}
    <div class="tras-form-grid tras-form-grid--unit">
      <div class="tras-form-pair tras-odo-pair" data-odo-group="salida">
        <label>
          <span>Kilometros de salida</span>
          <input type="number" min="0" id="tras-form-km" name="kmSalida" value="${esc(String(draft.kmSalida ?? unit?.km ?? ''))}" placeholder="Kilometros de salida">
        </label>
        <label>
          <span>Combustible de salida</span>
          <input id="tras-form-gas-salida" value="${esc(gasSalida)}" readonly>
        </label>
      </div>
    </div>
  `;
}

function _initFormPickers() {
  _paintChoferPickerMenu();
  _paintUnitPickerMenu();
  _syncUnitPickerVisibility();
  const choferSearch = _ctr?.querySelector('#tras-form-chofer-search');
  if (choferSearch && !_s.draft?.choferSearch) {
    _s.draft.choferSearch = choferSearch.value || '';
  }
  const onFocus = event => {
    const field = event.target.closest('.tras-search-field');
    if (field && !field.hidden) _togglePicker(field, true);
  };
  _ctr?.querySelectorAll('.tras-search-input').forEach(el => {
    el.removeEventListener('focus', onFocus);
    el.addEventListener('focus', onFocus);
  });
  // Al enfocar filtros de unidad, abre la lista de coincidencias.
  _ctr?.querySelectorAll('[data-unit-filter]').forEach(el => {
    el.addEventListener('focus', () => {
      const wrap = _ctr?.querySelector('#tras-unit-picker-wrap');
      if (wrap && !wrap.hidden) _togglePicker(wrap, true);
      else if (!_s?.draft?.mva) {
        if (wrap) wrap.hidden = false;
        _togglePicker(wrap, true);
      }
    });
  });
}

function _togglePicker(field, open) {
  const menu = field?.querySelector('.tras-search-menu');
  if (!menu) return;
  _ctr?.querySelectorAll('.tras-search-menu').forEach(el => {
    if (el !== menu) el.hidden = true;
  });
  menu.hidden = !open;
}

function _closeAllPickers() {
  _ctr?.querySelectorAll('.tras-search-menu').forEach(el => { el.hidden = true; });
}

function _paintChoferPickerMenu() {
  const menu = _ctr?.querySelector('#tras-chofer-menu');
  if (!menu) return;
  const query = _val('tras-form-chofer-search') || _s?.draft?.choferSearch || '';
  const rows = _filteredChoferes(query).slice(0, 40);
  if (!rows.length) {
    menu.innerHTML = `<li class="tras-picker-empty">Sin choferes para esta búsqueda</li>`;
    return;
  }
  menu.innerHTML = rows.map(c => `
    <li>
      <button type="button" class="tras-picker-option" data-action="picker-select" data-picker="chofer" data-value="${esc(c.uid || c.id)}" data-label="${esc(c.nombre)}">
        <strong>${esc(c.nombre)}</strong>
        ${c.licenciaVencimiento ? `<small>Licencia · ${esc(c.licenciaVencimiento)}</small>` : ''}
      </button>
    </li>
  `).join('');
}

function _paintUnitPickerMenu() {
  const menu = _ctr?.querySelector('#tras-unit-menu');
  if (!menu) return;
  const rows = _filteredUnitsForPicker().slice(0, 50);
  if (!rows.length) {
    menu.innerHTML = `<li class="tras-picker-empty">Sin unidades disponibles con estos filtros</li>`;
    return;
  }
  menu.innerHTML = rows.map(u => `
    <li>
      <button type="button" class="tras-picker-option" data-action="picker-select" data-picker="unidad" data-value="${esc(u.mva)}" data-label="${esc(_unitPickerLabel(u))}">
        <strong>${esc(u.mva || '—')}</strong>
        <small>${esc([_unitField(u, 'clase'), u.modelo, u.placas, _unitField(u, 'marca')].filter(Boolean).join(' · ') || 'Sin datos')}</small>
      </button>
    </li>
  `).join('');
}

function _handlePickerSelect(el) {
  const picker = el.dataset.picker;
  const value = el.dataset.value || '';
  const label = el.dataset.label || '';
  if (picker === 'chofer') {
    const hidden = _ctr?.querySelector('#tras-form-chofer');
    const search = _ctr?.querySelector('#tras-form-chofer-search');
    if (hidden) hidden.value = value;
    if (search) search.value = label;
    if (_s?.draft) {
      _s.draft.choferUid = value;
      _s.draft.choferNombre = label;
      _s.draft.choferSearch = label;
    }
    _closeAllPickers();
    return;
  }
  if (picker === 'unidad') {
    const unit = _unitByMva(value);
    if (unit) _applyUnitSelection(unit);
  }
}

function _plazas() {
  return _uniq([...(Array.isArray(_s.boot.plazas) ? _s.boot.plazas : []), _s.plaza]).filter(Boolean);
}

function _tipos() {
  return (Array.isArray(_s.boot.tipos) && _s.boot.tipos.length ? _s.boot.tipos : DEFAULT_TYPES)
    .map(t => ({ codigo: String(t.codigo || t.id || t.valor || t).toUpperCase(), etiqueta: String(t.etiqueta || t.label || t.nombre || t.codigo || t) }))
    .filter(t => t.codigo);
}

function _choferes() {
  return Array.isArray(_s.boot.choferes) ? _s.boot.choferes : [];
}

function _creadores() {
  return _uniq((_s.boot.traslados || []).map(row => String(row.creadoPor || '').trim()).filter(Boolean));
}

function _estado(row) {
  const raw = String(row?.estadoOperativo || row?.estado || 'ABIERTO').toUpperCase();
  if (raw === 'CERRADO') return 'CERRADO';
  return 'ABIERTO';
}

function _shortId(row) {
  const folio = String(row?.folio || '').trim();
  if (folio) return folio;
  const raw = String(row?.id || '').trim();
  const digits = (raw.match(/\d+/g) || []).join('');
  if (digits) return digits.slice(-6);
  return raw.slice(0, 8) || '-';
}

function _val(id) {
  return String(_ctr.querySelector(`#${id}`)?.value || '').trim();
}

function _actor() {
  const gs = getState();
  return String(gs.profile?.nombre || gs.profile?.usuario || gs.profile?.email || window._auth?.currentUser?.email || 'Sistema').trim();
}

function _toast(message, type = 'info') {
  if (typeof window.showToast === 'function') window.showToast(message, type);
  else console[type === 'error' ? 'error' : 'log'](message);
}

function _canViewTraslados() {
  if (window.mexPerms?.canDo?.('traslados_gestionar')) return true;
  return (ROLE_LEVEL[_currentRole()] || 0) >= ROLE_LEVEL.VENTAS;
}

function _canManageTraslados() {
  if (window.mexPerms?.canDo?.('traslados_gestionar')) return true;
  return (ROLE_LEVEL[_currentRole()] || 0) >= ROLE_LEVEL.VENTAS;
}

function _currentRole() {
  const gs = getState();
  return String(
    gs.profile?.rol ||
    gs.profile?.role ||
    window.CURRENT_USER_PROFILE?.rol ||
    window.MEX_CONFIG?.profile?.rol ||
    ''
  ).toUpperCase().trim();
}

function _renderNoAccess() {
  if (!_ctr) return;
  _ctr.innerHTML = `
    <section class="tras tras-denied">
      <div class="tras-empty tras-denied-card">
        <span class="material-icons">lock</span>
        <strong>Sin acceso a traslados</strong>
        <p>Esta seccion esta disponible desde ventas en adelante.</p>
      </div>
    </section>
  `;
}

function _normPlaza(value) {
  return String(value || '').trim().toUpperCase();
}

function _uniq(values) {
  return Array.from(new Set(values.map(_normPlaza).filter(Boolean))).sort();
}

function _toMs(value) {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && typeof value.seconds === 'number') return value.seconds * 1000;
  if (typeof value === 'object' && typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  if (typeof value === 'string') {
    // ISO / datetime-local
    const iso = new Date(value).getTime();
    if (Number.isFinite(iso) && iso > 0) return iso;
    // Locale es-MX: "18/7/2026, 12:32:04 a.m." (guardado histórico vía _now())
    const m = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?)?/i);
    if (m) {
      let year = Number(m[3]);
      if (year < 100) year += 2000;
      let hour = Number(m[4] || 0);
      const minute = Number(m[5] || 0);
      const second = Number(m[6] || 0);
      const ampm = String(m[7] || '').toLowerCase().replace(/\s+/g, '');
      if (ampm.startsWith('p') && hour < 12) hour += 12;
      if (ampm.startsWith('a') && hour === 12) hour = 0;
      const parsed = new Date(year, Number(m[2]) - 1, Number(m[1]), hour, minute, second).getTime();
      if (Number.isFinite(parsed)) return parsed;
    }
  }
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
    minute: '2-digit'
  });
}

function _toDateTimeLocal(value) {
  const ms = _toMs(value);
  if (!ms) return '';
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Opciones de gasolina garantizando que el valor guardado siga visible
// aunque ya no exista en el catalogo global.
function _gasSelectOptions(selected = 'N/A') {
  const safe = String(selected || 'N/A').trim().toUpperCase() || 'N/A';
  const values = _gasCatalog();
  if (!values.includes(safe)) values.unshift(safe);
  return values.map(v => _option(v, v, safe)).join('');
}

function _option(value, label, selected) {
  const v = String(value || '');
  return `<option value="${esc(v)}" ${String(selected || '') === v ? 'selected' : ''}>${esc(label)}</option>`;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
