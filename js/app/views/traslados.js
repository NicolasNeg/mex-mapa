// ============================================================================
//  /js/app/views/traslados.js - Fase B: traslados SPA
// ============================================================================

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import {
  obtenerTrasladosBootstrap,
  crearTraslado,
  actualizarTraslado,
  cerrarTraslado
} from '/js/core/database.js';

let _ctr = null;
let _navigate = null;
let _offs = [];
let _s = null;

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

  _offs.push(onPlazaChange(next => {
    if (!_s) return;
    _s.plaza = _normPlaza(next);
    _s.selectedId = '';
    _s.detailMode = 'list';
    _s.draft = _newDraft(_s.plaza);
    if (window.location.pathname !== LIST_ROUTE && typeof _navigate === 'function') _navigate(LIST_ROUTE, { replace: true });
    void _load();
  }));
}

export function unmount() {
  _offs.forEach(fn => { try { fn(); } catch (_) {} });
  _offs = [];
  _ctr = null;
  _navigate = null;
  _s = null;
}

function _ensureCss() {
  if (document.querySelector('link[data-app-traslados-css="1"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = '/css/app-traslados.css';
  l.dataset.appTrasladosCss = '1';
  document.head.appendChild(l);
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
  } catch (err) {
    console.error('[traslados]', err);
    _s.loading = false;
    _s.error = err?.message || 'No se pudo cargar traslados.';
    _paintAll();
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
  return {
    mva: '',
    choferUid: '',
    tipo: '',
    plazaOrigen: _normPlaza(plaza),
    plazaDestino: _normPlaza(plaza),
    fechaSalida: _toDateTimeLocal(Date.now()),
    fechaRegresoEstimada: '',
    kmSalida: '',
    nota: ''
  };
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
                <strong>${_s.detailMode === 'new' ? 'Nuevo traslado' : 'Detalle'}</strong>
              </nav>
              <h1>${_s.detailMode === 'new' ? 'Agregar traslado no comercial' : 'Traslado no comercial'}</h1>
            </div>
            <div class="tras-actions">
              <button type="button" class="tras-btn ghost" data-action="back-list">
                <span class="material-icons">arrow_back</span>
                Volver a tabla
              </button>
              <button type="button" class="tras-btn ghost" data-action="reload">
                <span class="material-icons">sync</span>
                Actualizar
              </button>
            </div>
          </header>
          <div id="tras-editor-host"></div>
        </main>
      ` : `
        <main class="tras-main tras-main--full">
          <div class="tras-commandbar">
            <div class="tras-title-block">
              <p>Traslado no comercial</p>
              <h1>Control de traslados</h1>
              <span>Activos e historial en una sola tabla operativa.</span>
            </div>
            <div class="tras-actions">
              <button type="button" class="tras-btn ghost" data-action="reload">
                <span class="material-icons">sync</span>
                Actualizar
              </button>
              <button type="button" class="tras-btn primary" data-action="new" ${_s.boot.canManage ? '' : 'disabled'}>
                <span class="material-icons">add</span>
                Nuevo traslado
              </button>
            </div>
          </div>

          <section class="tras-card" aria-label="Traslados">
            <div class="tras-toolbar">
              <label class="tras-search">
                <span class="material-icons">search</span>
                <input data-filter="unidad" value="${esc(_s.filters.unidad)}" placeholder="Buscar por MVA, placas o modelo">
              </label>
              <div class="tras-quick-status" role="tablist" aria-label="Estatus">
                ${['', 'ABIERTO', 'CERRADO'].map(v => `
                  <button type="button" class="${_s.filters.estatus === v ? 'active' : ''}" data-action="quick-status" data-value="${v}">
                    ${v === '' ? 'Todos' : v === 'ABIERTO' ? 'Abiertos' : 'Cerrados'}
                  </button>
                `).join('')}
              </div>
              <button type="button" class="tras-btn ghost${_advancedFilterCount() ? ' has-filters' : ''}" data-action="toggle-filters" aria-expanded="${_s.filtersOpen ? 'true' : 'false'}">
                <span class="material-icons">tune</span>
                Filtros${_advancedFilterCount() ? ` <b class="tras-filter-count">${_advancedFilterCount()}</b>` : ''}
                <span class="material-icons tras-caret">${_s.filtersOpen ? 'expand_less' : 'expand_more'}</span>
              </button>
            </div>

            <div class="tras-filter-panel" ${_s.filtersOpen ? '' : 'hidden'}>
              <div class="tras-filter-grid">
                <label><span>Folio</span><input data-filter="folio" value="${esc(_s.filters.folio)}" placeholder="TR-00012"></label>
                <label><span>Chofer</span><input data-filter="chofer" list="tras-chofer-list" value="${esc(_s.filters.chofer)}" placeholder="Buscar chofer"></label>
                <label><span>Creador</span><select data-filter="creador">${_option('', 'Todos', _s.filters.creador)}${creadores.map(v => _option(v, v, _s.filters.creador)).join('')}</select></label>
                <label><span>Razon</span><select data-filter="tipo">${_option('', 'Todas', _s.filters.tipo)}${tipos.map(t => _option(t.codigo, `${t.codigo} · ${t.etiqueta}`, _s.filters.tipo)).join('')}</select></label>
                <label><span>Plaza salida</span><select data-filter="plazaOrigen">${_option('', 'Todas', _s.filters.plazaOrigen)}${plazas.map(p => _option(p, p, _s.filters.plazaOrigen)).join('')}</select></label>
                <label><span>Plaza regreso</span><select data-filter="plazaDestino">${_option('', 'Todas', _s.filters.plazaDestino)}${plazas.map(p => _option(p, p, _s.filters.plazaDestino)).join('')}</select></label>
                <label><span>Salida desde</span><input type="date" data-filter="salidaDesde" value="${esc(_s.filters.salidaDesde)}"></label>
                <label><span>Salida hasta</span><input type="date" data-filter="salidaHasta" value="${esc(_s.filters.salidaHasta)}"></label>
                <label><span>Regreso desde</span><input type="date" data-filter="regresoDesde" value="${esc(_s.filters.regresoDesde)}"></label>
                <label><span>Regreso hasta</span><input type="date" data-filter="regresoHasta" value="${esc(_s.filters.regresoHasta)}"></label>
              </div>
              <div class="tras-filter-actions">
                <button type="button" class="tras-btn ghost small" data-action="clear-filters"><span class="material-icons">filter_alt_off</span>Limpiar filtros</button>
              </div>
            </div>

            <div class="tras-card-head">
              <div>
                <h2>Traslados</h2>
                <span id="tras-count" class="tras-count"></span>
              </div>
            </div>

            <div id="tras-table-host" class="tras-table-host"></div>
          </section>
        </main>
      `}

      <datalist id="tras-chofer-list">
        ${choferes.map(c => `<option value="${esc(c.nombre)}"></option>`).join('')}
      </datalist>
      <datalist id="tras-unidad-list">
        ${_availableUnits().map(u => `<option value="${esc(u.mva)}">${esc([u.mva, u.modelo, u.placas].filter(Boolean).join(' · '))}</option>`).join('')}
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
  if (count) count.textContent = `${rows.length} de ${totalForTab} registros`;
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
            <th>Ruta</th>
            <th>Salida</th>
            <th>Regreso</th>
            <th>Razon</th>
            <th>Estatus</th>
            <th class="tras-th-actions">Accion</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => _rowHtml(row)).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function _initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function _rowHtml(row) {
  const st = _estado(row);
  const routeId = _routeToken(row);
  const selected = _isSelected(row) ? ' selected' : '';
  return `
    <tr class="${selected}" data-action="select" data-id="${esc(routeId)}">
      <td><span class="tras-folio">${esc(_shortId(row))}</span></td>
      <td>
        <div class="tras-cell-stack">
          <strong>${esc(row.mva || '-')}</strong>
          <small>${esc([row.modelo, row.placas].filter(Boolean).join(' · ') || 'Sin modelo')}</small>
        </div>
      </td>
      <td>
        <div class="tras-person">
          <span class="tras-avatar">${esc(_initials(row.choferNombre))}</span>
          <div class="tras-cell-stack">
            <strong>${esc(row.choferNombre || '-')}</strong>
            <small>Creo: ${esc(row.creadoPor || 'Sistema')}</small>
          </div>
        </div>
      </td>
      <td>
        <span class="tras-route">
          ${esc(row.plazaOrigen || '-')}
          <span class="material-icons">arrow_forward</span>
          ${esc(row.plazaDestino || '-')}
        </span>
      </td>
      <td>${_dateCell(row.fechaSalida)}</td>
      <td>${_dateCell(row.fechaCierre || row.fechaRegresoEstimada)}</td>
      <td>${row.tipo ? `<span class="tras-type">${esc(row.tipo)}</span>` : '<span class="tras-muted">-</span>'}</td>
      <td><span class="tras-status ${st.toLowerCase()}"><i></i>${esc(st)}</span></td>
      <td class="tras-row-actions">
        ${st !== 'CERRADO' ? `<button type="button" class="tras-icon-btn" data-action="select" data-id="${esc(routeId)}" title="Editar traslado"><span class="material-icons">edit</span></button>` : ''}
        <button type="button" class="tras-icon-btn primary" data-action="select" data-id="${esc(routeId)}" title="Ver traslado"><span class="material-icons">visibility</span></button>
      </td>
    </tr>
  `;
}

function _dateCell(value) {
  const label = _fmtDate(value);
  return label ? `<span class="tras-date">${esc(label)}</span>` : '<span class="tras-muted">Sin fecha</span>';
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
    _syncUnitPreview();
    return;
  }
  const row = _selected();
  if (row) {
    host.innerHTML = _formHtml(row);
    return;
  }
  host.innerHTML = `
    <div class="tras-detail-empty">
      <span class="material-icons">search_off</span>
      <h2>Traslado no encontrado</h2>
      <p>El registro solicitado no existe o no pertenece a la plaza actual.</p>
      <button type="button" class="tras-btn primary" data-action="back-list">
        <span class="material-icons">table_rows</span>
        Volver a la tabla
      </button>
    </div>
  `;
}

function _formHtml(row) {
  const isNew = !row;
  const isClosed = row && _estado(row) === 'CERRADO';
  const canEdit = _s.boot.canManage && !isClosed;
  const draft = isNew ? _s.draft : _rowToDraft(row);
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
        <span class="tras-status ${String(status).toLowerCase()}">${esc(status)}</span>
      </div>

      <form class="tras-form tras-form--wide" data-action="${isNew ? 'create-transfer' : 'update-transfer'}" data-id="${esc(row?.id || '')}">
        <section class="tras-form-panel">
          <div class="tras-form-grid tras-form-grid--meta">
            <label>
              <span>Chofer</span>
              <select id="tras-form-chofer" name="choferUid" ${canEdit || isNew ? '' : 'disabled'}>
                ${_option('', 'Seleccionar chofer', draft.choferUid)}
                ${_choferes().map(c => _option(c.uid || c.id, c.nombre, draft.choferUid)).join('')}
              </select>
            </label>
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
          <div class="tras-form-grid tras-form-grid--unit">
            <label class="span-all">
              <span>Seleccionar unidad</span>
              <input id="tras-form-mva" name="mva" list="tras-unidad-list" value="${esc(isNew ? draft.mva : unitSummary)}" ${isNew ? '' : 'readonly'} placeholder="Seleccionar unidad">
            </label>
            <label>
              <span>Kilometros de salida</span>
              <input type="number" min="0" id="tras-form-km" name="kmSalida" value="${esc(String(draft.kmSalida ?? ''))}" ${isNew ? '' : 'readonly'} placeholder="Kilometros de salida">
            </label>
            <label>
              <span>Combustible de salida</span>
              <input id="tras-form-gas-salida" value="${esc(gasSalida)}" readonly>
            </label>
          </div>
        </section>

        <div class="tras-form-actions tras-form-actions--footer">
          <button type="button" class="tras-btn ghost" data-action="back-list">
            <span class="material-icons">close</span>
            Cancelar
          </button>
          ${!isNew && !isClosed ? `<button type="button" class="tras-btn ghost" data-action="show-close" data-id="${esc(row.id)}"><span class="material-icons">flag</span>Cerrar traslado</button>` : ''}
          <button type="submit" class="tras-btn primary" ${_s.busy || (!canEdit && !isNew) ? 'disabled' : ''}>
            <span class="material-icons">${isNew ? 'save' : 'save'}</span>
            ${isNew ? 'Guardar' : 'Guardar cambios'}
          </button>
        </div>
      </form>

      ${!isNew && !isClosed ? _closeFormHtml(row) : ''}
      ${!isNew ? _timelineHtml(row) : ''}
    </div>
  `;
}

function _closeFormHtml(row) {
  return `
    <form class="tras-close-form" id="tras-close-form" data-id="${esc(row.id)}" hidden>
      <div class="tras-close-head">
        <span class="material-icons">flag</span>
        <div><strong>Cierre de traslado</strong><small>Registra km de llegada y gas actual.</small></div>
      </div>
      <div class="tras-form-pair">
        <label><span>Km llegada</span><input type="number" min="${esc(String(row.kmSalida || 0))}" id="tras-close-km" value="${esc(String(row.kmLlegada || ''))}" required></label>
        <label><span>Gas llegada</span><select id="tras-close-gas">${_gasSelectOptions(row.gasLlegada || row.gasSalida || 'N/A')}</select></label>
      </div>
      <label><span>Fecha cierre</span><input type="datetime-local" id="tras-close-fecha" value="${esc(_toDateTimeLocal(Date.now()))}"></label>
      <label><span>Nota de cierre</span><textarea id="tras-close-nota" placeholder="Observaciones de llegada"></textarea></label>
      <div class="tras-form-actions">
        <button type="button" class="tras-btn primary" data-action="close-transfer" data-id="${esc(row.id)}" ${_s.busy ? 'disabled' : ''}><span class="material-icons">task_alt</span>Confirmar cierre</button>
      </div>
    </form>
  `;
}

function _timelineHtml(row) {
  const edits = Array.isArray(row.ediciones) ? row.ediciones : [];
  const notes = Array.isArray(row.notas) ? row.notas : [];
  const items = [
    ...edits.map(e => ({ kind: 'Edicion', icon: 'edit_note', title: e.campo || 'Cambio', body: `${e.antes || '-'} -> ${e.despues || '-'}`, user: e.usuario, date: e.fecha || e.timestamp })),
    ...notes.map(n => ({ kind: n.tipo === 'CIERRE' ? 'Cierre' : 'Nota', icon: n.tipo === 'CIERRE' ? 'flag' : 'notes', title: n.tipo === 'CIERRE' ? 'Nota de cierre' : 'Nota', body: n.texto, user: n.usuario, date: n.fecha || n.timestamp }))
  ].sort((a, b) => _toMs(b.date) - _toMs(a.date));
  if (!items.length) return `<div class="tras-timeline empty"><span class="material-icons">history</span>Sin notas ni ediciones todavia.</div>`;
  return `
    <div class="tras-timeline">
      <h3>Historial del traslado</h3>
      ${items.map(item => `
        <article>
          <span class="material-icons">${item.icon}</span>
          <div>
            <strong>${esc(item.kind)} · ${esc(item.title)}</strong>
            <p>${esc(item.body || 'Sin detalle')}</p>
            <small>${esc(item.user || 'Sistema')} · ${esc(_fmtDate(item.date) || '')}</small>
          </div>
        </article>
      `).join('')}
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
    _s.draft = _newDraft(_s.plaza);
    _go(NEW_ROUTE);
    return;
  }
  if (action === 'select') {
    const id = actionEl.dataset.id || actionEl.closest('tr')?.dataset.id || '';
    if (!id) return;
    _s.selectedId = id;
    _s.detailMode = 'detail';
    _go(_viewRoute(id));
    return;
  }
  if (action === 'back-list') {
    _s.selectedId = '';
    _s.detailMode = 'list';
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
    const form = _ctr.querySelector('#tras-close-form');
    if (form) form.hidden = !form.hidden;
    return;
  }
  if (action === 'close-transfer') {
    await _submitClose(actionEl.dataset.id);
    return;
  }
}

function _onInput(event) {
  const filterKey = event.target?.dataset?.filter;
  if (filterKey) {
    _s.filters[filterKey] = event.target.value || '';
    _paintTable();
    return;
  }
  if (event.target?.id === 'tras-form-mva' && _s.detailMode === 'new') {
    _s.draft.mva = event.target.value || '';
    _syncUnitPreview();
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
    if (event.target.id === 'tras-form-mva') _syncUnitPreview();
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
    mva: _val('tras-form-mva').toUpperCase(),
    choferUid: _val('tras-form-chofer'),
    tipo: _val('tras-form-tipo'),
    plazaOrigen: _normPlaza(_val('tras-form-plaza-origen') || _s.plaza),
    plazaDestino: _normPlaza(_val('tras-form-plaza-destino') || _s.plaza),
    fechaSalida: _val('tras-form-salida'),
    fechaRegresoEstimada: _val('tras-form-regreso'),
    kmSalida: _val('tras-form-km'),
    nota: _val('tras-form-nota')
  };
}

function _syncUnitPreview() {
  const mva = _val('tras-form-mva').toUpperCase();
  const unit = _unitByMva(mva);
  const km = _ctr.querySelector('#tras-form-km');
  const gas = _ctr.querySelector('#tras-form-gas-salida');
  if (unit) {
    if (km && (!km.value || _s.draft.mva !== mva)) km.value = unit.km ?? '';
    if (gas) gas.value = unit.gasolina || 'N/A';
  } else {
    if (gas) gas.value = 'N/A';
  }
  _s.draft.mva = mva;
}

async function _submitCreate() {
  if (!_s.boot.canManage) return _toast('No tienes permiso para gestionar traslados.', 'error');
  _readDraftFromForm();
  const payload = { ..._s.draft, usuario: _actor(), actorRole: _currentRole() };
  if (!payload.mva) return _toast('Selecciona una unidad.', 'error');
  if (!payload.choferUid) return _toast('Selecciona chofer.', 'error');
  if (!payload.tipo) return _toast('Selecciona razon de traslado.', 'error');
  if (!payload.kmSalida) return _toast('Captura km de salida.', 'error');
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
  const payload = {
    kmLlegada: _val('tras-close-km'),
    gasLlegada: _val('tras-close-gas'),
    fechaCierre: _val('tras-close-fecha'),
    nota: _val('tras-close-nota'),
    usuario: _actor(),
    actorRole: _currentRole()
  };
  if (!payload.kmLlegada) return _toast('Captura km de llegada.', 'error');
  await _runAction(async () => {
    const res = await cerrarTraslado(id, payload);
    if (!res?.ok) throw new Error(res?.error || 'No se pudo cerrar el traslado.');
    _toast('Traslado cerrado.', 'success');
    _s.selectedId = id;
    _s.detailMode = 'detail';
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
  if (f.folio) rows = rows.filter(r => String(r.folio || r.id || '').toLowerCase().includes(f.folio.toLowerCase()));
  if (f.unidad) rows = rows.filter(r => [r.mva, r.modelo, r.placas].some(v => String(v || '').toLowerCase().includes(f.unidad.toLowerCase())));
  if (f.chofer) rows = rows.filter(r => String(r.choferNombre || '').toLowerCase().includes(f.chofer.toLowerCase()));
  if (f.creador) rows = rows.filter(r => String(r.creadoPor || '') === f.creador);
  if (f.tipo) rows = rows.filter(r => String(r.tipo || '') === f.tipo);
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
    tipo: row.tipo || '',
    plazaOrigen: row.plazaOrigen || _s.plaza,
    plazaDestino: row.plazaDestino || _s.plaza,
    fechaSalida: _toDateTimeLocal(row.fechaSalida),
    fechaRegresoEstimada: _toDateTimeLocal(row.fechaRegresoEstimada),
    kmSalida: row.kmSalida ?? '',
    nota: ''
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
