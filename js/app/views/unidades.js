// ============================================================================
//  /js/app/views/unidades.js - Inventario global de unidades
// ============================================================================

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import {
  obtenerUnidadesPlazas,
  registrarUnidadEnPlaza,
  actualizarUnidadPlaza
} from '/js/core/database.js';
import {
  IMPORT_FIELD_OPTIONS,
  analyzeMatrix,
  applyMapping,
  parseDelimitedText,
  readSpreadsheetFile,
  saveMapping
} from '/js/app/features/unidades/unidades-import.js';

let _ctr = null;
let _offs = [];
let _s = null;

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

const FIELD_ORDER = [
  'id', 'clase', 'vin', 'anio', 'marca', 'modelo', 'mva', 'placas',
  'sucursal', 'plazaActual', 'estado', 'activo', 'color', 'gasolina',
  'km', 'descripcion'
];

const FIELD_LABEL = {
  id: 'Id',
  clase: 'Clase',
  vin: 'VIN',
  anio: 'Año',
  marca: 'Marca',
  modelo: 'Modelo',
  mva: 'Número económico',
  placas: 'Placas',
  sucursal: 'Locación propietaria',
  plazaActual: 'Locación actual',
  estado: 'Estatus',
  activo: 'Activo',
  color: 'Color',
  gasolina: 'Tanque gasolina',
  km: 'Kilometraje',
  descripcion: 'Descripción'
};

export async function mount({ container }) {
  unmount();
  _ctr = container;
  _ensureCss();

  const gs = getState();
  _s = {
    role: _role(),
    plaza: _norm(getCurrentPlaza() || gs.profile?.plazaAsignada || ''),
    loading: true,
    busy: false,
    error: '',
    units: [],
    selectedId: '',
    detailEditing: false,
    filters: _emptyFilters(),
    page: 1,
    pageSize: 50,
    importRows: [],
    importRaw: null,
    importMapping: {},
    importFileName: '',
    importMessage: ''
  };
  if (!_canView()) {
    _renderNoAccess();
    return;
  }

  try {
    await window.__mexConfigReadyPromise;
  } catch (_) {}

  _render();
  _bind();
  await _load();

  _offs.push(onPlazaChange(next => {
    if (!_s) return;
    _s.plaza = _norm(next);
    _s.page = 1;
    _render();
  }));
}

export function unmount() {
  _offs.forEach(fn => { try { fn(); } catch (_) {} });
  _offs = [];
  _ctr = null;
  _s = null;
}

function _ensureCss() {
  const href = '/css/app-unidades.css?v=20260715b';
  let link = document.querySelector('link[data-app-unidades-css="1"]');
  if (link) {
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
    return;
  }
  link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.appUnidadesCss = '1';
  document.head.appendChild(link);
}

function _bind() {
  const click = e => _onClick(e);
  const input = e => _onInput(e);
  const change = e => _onChange(e);
  const submit = e => _onSubmit(e);
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
  _paint();
  try {
    const rows = await obtenerUnidadesPlazas();
    _s.units = Array.isArray(rows) ? rows.map(_normalizeUnit) : [];
    _s.loading = false;
    _paint();
  } catch (err) {
    console.error('[unidades]', err);
    _s.loading = false;
    _s.error = err?.message || 'No se pudo cargar el inventario global.';
    _paint();
  }
}

function _render() {
  if (!_ctr || !_s) return;
  _ctr.innerHTML = `
    <section class="uni" aria-busy="${_s.loading ? 'true' : 'false'}">
      <header class="uni-page-header">
        <div class="uni-page-title">
          <h1>Unidades</h1>
          <p>Inventario global · consulta, exporta e importa unidades</p>
        </div>
        <div class="uni-actions">
          <button type="button" class="uni-btn ghost" data-action="reload">Actualizar</button>
          <button type="button" class="uni-btn ghost" data-action="export">Exportar</button>
          <button type="button" class="uni-btn primary" data-action="new" ${_canManage() ? '' : 'disabled'}>Nueva unidad</button>
          <button type="button" class="uni-btn primary" data-action="import" ${_canManage() ? '' : 'disabled'}>Importar</button>
        </div>
      </header>

      <div class="uni-controls">
        <div class="uni-controls-row">
          <label class="uni-search"><span>Buscar</span><input data-filter="q" value="${esc(_s.filters.q)}" placeholder="MVA, placas, VIN, modelo"></label>
          ${_filterSelect('clase', _catalogNames('categorias'), _s.filters.clase, 'Todas')}
          ${_filterSelect('sucursal', _plazasCatalog(), _s.filters.sucursal, 'Todas')}
          ${_filterSelect('plazaActual', _plazasCatalog(), _s.filters.plazaActual, 'Todas')}
          ${_filterSelect('estado', _catalogNames('estados'), _s.filters.estado, 'Todos')}
          ${_filterSelect('activo', ['ACTIVO', 'INACTIVO'], _s.filters.activo, 'Todos', { ACTIVO: 'Activo', INACTIVO: 'Inactivo' })}
          <button type="button" class="uni-btn ghost small" data-action="clear">Limpiar</button>
        </div>
      </div>

      <p id="uni-count" class="uni-meta"></p>
      <div id="uni-message"></div>
      <div id="uni-detail"></div>
      <main id="uni-table"></main>
      <div id="uni-modal-host"></div>
    </section>
  `;
  _paint();
}

function _paint() {
  if (!_ctr || !_s) return;
  _paintMessage();
  _paintDetail();
  _paintTable();
}

function _paintMessage() {
  const host = _ctr.querySelector('#uni-message');
  if (!host) return;
  host.innerHTML = _s.error
    ? `<div class="uni-banner danger"><span class="material-icons">error</span>${esc(_s.error)}</div>`
    : '';
}

function _paintDetail() {
  const host = _ctr.querySelector('#uni-detail');
  if (!host) return;
  const row = _selected();
  if (!row) {
    host.innerHTML = '';
    return;
  }
  const unitId = esc(row.id || row.mva);
  host.innerHTML = `
    <section class="uni-detail-card uni-detail-card--wide">
      <div class="uni-detail-head">
        <div>
          <p>Detalle de unidad</p>
          <h2>${esc(row.mva || row.id || 'Unidad')}</h2>
          <span>${esc([row.modelo, row.placas, row.vin].filter(Boolean).join(' · ') || 'Sin datos adicionales')}</span>
        </div>
        <div class="uni-actions"></div>
      </div>
      <form class="uni-form uni-form--wide" data-unit-form="edit" data-id="${unitId}" data-context="detail">
        <section class="uni-form-panel">
          <div class="uni-form-grid uni-form-grid--meta">
            ${FIELD_ORDER.filter(k => k !== 'descripcion').map(k => _fieldControl(k, row, { editing: true, required: k === 'mva' })).join('')}
          </div>
        </section>
        <section class="uni-form-panel">
          ${_fieldControl('descripcion', row, { editing: true })}
        </section>
        <div class="uni-form-actions uni-form-actions--footer" hidden>
          <button type="button" class="uni-btn ghost" data-action="cancel-edit">Cancelar</button>
          <button type="submit" class="uni-btn primary" data-action="save-detail">Guardar cambios</button>
        </div>
      </form>
    </section>
  `;
  _syncDetailEditingUi();
}

function _syncDetailEditingUi() {
  const editing = Boolean(_s?.detailEditing && _canManage());
  const card = _ctr?.querySelector('#uni-detail .uni-detail-card');
  const form = _ctr?.querySelector('#uni-detail form[data-unit-form]');
  if (!card || !form) return;

  card.classList.toggle('is-editing', editing);

  form.querySelectorAll('input, textarea, select').forEach(el => {
    const locked = el.name === 'id';
    if (editing && !locked) {
      el.removeAttribute('readonly');
      el.readOnly = false;
      el.disabled = false;
    } else if (el.tagName === 'SELECT') {
      el.disabled = true;
    } else {
      el.readOnly = true;
      el.setAttribute('readonly', 'readonly');
    }
  });

  const footer = form.querySelector('.uni-form-actions--footer');
  if (footer) footer.hidden = !editing;

  const headActions = card.querySelector('.uni-detail-head .uni-actions');
  if (headActions) {
    headActions.innerHTML = editing ? '' : `
      <button type="button" class="uni-btn ghost" data-action="close-detail">Cerrar</button>
      <button type="button" class="uni-btn primary" data-action="edit"${_canManage() ? '' : ' disabled'}>Editar</button>
    `;
  }

  const saveBtn = form.querySelector('[data-action="save-detail"]');
  if (saveBtn) saveBtn.disabled = Boolean(_s?.busy);
}

function _resetDetailForm() {
  const row = _selected();
  const form = _ctr?.querySelector('#uni-detail form[data-unit-form]');
  if (!row || !form) return;
  FIELD_ORDER.forEach(key => {
    const el = form.elements[key];
    if (!el) return;
    el.value = _field(row, key) || '';
  });
}

function _paintTable() {
  const host = _ctr.querySelector('#uni-table');
  const count = _ctr.querySelector('#uni-count');
  if (!host) return;
  if (_s.loading) {
    host.innerHTML = _skeleton();
    if (count) count.textContent = 'Cargando unidades';
    return;
  }
  const rows = _filtered();
  const totalPages = Math.max(1, Math.ceil(rows.length / _s.pageSize));
  if (_s.page > totalPages) _s.page = totalPages;
  const start = (_s.page - 1) * _s.pageSize;
  const pageRows = rows.slice(start, start + _s.pageSize);
  if (count) count.textContent = rows.length ? `${rows.length} de ${_s.units.length} registros · página ${_s.page} de ${totalPages}` : '0 registros';
  host.innerHTML = `
    <div class="uni-table-section">
      <div class="uni-table-toolbar">
        <label><span>Mostrar</span><select data-action="page-size">
          ${[25, 50, 100, 200].map(n => _option(String(n), `${n}`, String(_s.pageSize))).join('')}
        </select></label>
        <span class="uni-pager-label">${rows.length ? `${start + 1}–${Math.min(start + pageRows.length, rows.length)} de ${rows.length}` : 'Sin registros'}</span>
      </div>
      <div class="uni-table-wrap">
        <table class="uni-table">
          <thead><tr>
            <th>Id</th><th>Clase</th><th>VIN</th><th>Año</th><th>Marca</th><th>Modelo</th>
            <th>Núm. económico</th><th>Placas</th><th>Loc. propietaria</th>
            <th>Loc. actual</th><th>Estatus</th><th>Activo</th><th class="uni-th-actions">Acción</th>
          </tr></thead>
          <tbody>
            ${pageRows.map(_rowHtml).join('') || `<tr><td colspan="13" class="uni-empty-row">Sin unidades para estos filtros.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="uni-pager">
        <button type="button" class="uni-btn ghost small" data-action="prev" ${_s.page <= 1 ? 'disabled' : ''}>Anterior</button>
        <button type="button" class="uni-btn ghost small" data-action="next" ${_s.page >= totalPages ? 'disabled' : ''}>Siguiente</button>
      </div>
    </div>
  `;
}

function _rowHtml(row) {
  const id = row.id || row.mva || '';
  const active = _isActive(row);
  return `
    <tr data-action="select" data-id="${esc(id)}">
      <td class="uni-td-mono">${esc(row.fila || row.id || '—')}</td>
      <td>${esc(row.clase || row.categoria || '—')}</td>
      <td class="uni-td-mono">${esc(row.vin || '—')}</td>
      <td class="uni-td-mono">${esc(row.anio || row.año || '—')}</td>
      <td>${esc(row.marca || '—')}</td>
      <td><span class="uni-td-main">${esc(row.modelo || '—')}</span></td>
      <td><span class="uni-td-main">${esc(row.mva || '—')}</span></td>
      <td>${esc(row.placas || '—')}</td>
      <td>${esc(row.sucursal || row.plaza || '—')}</td>
      <td>${esc(row.plazaActual || row.ubicacionActual || row.plaza || '—')}</td>
      <td>${esc(row.estado || row.estatus || '—')}</td>
      <td><span class="uni-active-text ${active ? 'yes' : 'no'}">${active ? 'Activo' : 'Inactivo'}</span></td>
      <td class="uni-row-actions">
        <button type="button" class="uni-link-btn" data-action="select" data-id="${esc(id)}">Ver</button>
      </td>
    </tr>
  `;
}

function _onClick(event) {
  const el = event.target.closest('[data-action]');
  if (!el || !_ctr?.contains(el)) return;
  const action = el.dataset.action;
  if (action === 'reload') { void _load(); return; }
  if (action === 'clear') { _s.filters = _emptyFilters(); _s.page = 1; _render(); return; }
  if (action === 'export') { _exportCsv(); return; }
  if (action === 'new') { _openUnitModal(); return; }
  if (action === 'import') { _openImportModal(); return; }
  if (action === 'edit') {
    if (!_canManage()) return;
    _s.detailEditing = true;
    _syncDetailEditingUi();
    return;
  }
  if (action === 'cancel-edit') {
    _resetDetailForm();
    _s.detailEditing = false;
    _syncDetailEditingUi();
    return;
  }
  if (action === 'close-detail') { _s.detailEditing = false; _s.selectedId = ''; _paintDetail(); return; }
  if (action === 'select') { _s.detailEditing = false; _s.selectedId = el.dataset.id || el.closest('tr')?.dataset.id || ''; _paintDetail(); return; }
  if (action === 'prev') { _s.page = Math.max(1, _s.page - 1); _paintTable(); return; }
  if (action === 'next') { _s.page += 1; _paintTable(); return; }
  if (action === 'close-modal') { _closeModal(); return; }
  if (action === 'apply-import') { void _applyImport(); return; }
}

function _onInput(event) {
  const key = event.target?.dataset?.filter;
  if (!key) return;
  _s.filters[key] = event.target.value || '';
  _s.page = 1;
  _paintTable();
}

async function _onChange(event) {
  const key = event.target?.dataset?.filter;
  if (key) {
    _s.filters[key] = event.target.value || '';
    _s.page = 1;
    _paintTable();
    return;
  }
  if (event.target?.dataset?.action === 'page-size') {
    _s.pageSize = Number(event.target.value) || 50;
    _s.page = 1;
    _paintTable();
    return;
  }
  if (event.target?.id === 'uni-import-file') {
    await _readImportFile(event.target.files?.[0]);
    return;
  }
  if (event.target?.dataset?.action === 'import-map') {
    const idx = event.target.dataset.col;
    _s.importMapping[idx] = event.target.value || '';
    saveMapping(_s.importMapping);
    _rebuildImportRows();
    _paintImportPreview();
  }
}

async function _onSubmit(event) {
  const form = event.target.closest('form[data-unit-form]');
  if (!form) return;
  const mode = form.dataset.unitForm;
  if (mode !== 'edit' && mode !== 'new') return;
  event.preventDefault();
  await _saveUnit(form);
}

function _openUnitModal(row = null) {
  if (!_canManage()) return _toast('No tienes permiso para gestionar unidades globales.', 'error');
  const isEdit = Boolean(row);
  const draft = row || {
    sucursal: _s.plaza,
    plazaActual: _s.plaza,
    activo: 'Activo'
  };
  const host = _ctr.querySelector('#uni-modal-host');
  host.innerHTML = `
    <div class="uni-modal-backdrop" role="dialog" aria-modal="true">
      <form class="uni-modal" data-unit-form="${isEdit ? 'edit' : 'new'}" data-id="${esc(draft?.id || '')}">
        <div class="uni-modal-head">
          <div><p>${isEdit ? 'Editar' : 'Alta global'}</p><h2>${isEdit ? esc(draft.mva || 'Unidad') : 'Nueva unidad global'}</h2></div>
          <button type="button" class="uni-icon-btn" data-action="close-modal"><span class="material-icons">close</span></button>
        </div>
        <div class="uni-form uni-form--wide">
          <section class="uni-form-panel">
            <div class="uni-form-grid uni-form-grid--meta">
              ${_fieldControl('mva', draft, { editing: true, required: true })}
              ${_fieldControl('vin', draft, { editing: true })}
              ${_fieldControl('clase', draft, { editing: true })}
              ${_fieldControl('anio', draft, { editing: true })}
              ${_fieldControl('marca', draft, { editing: true })}
              ${_fieldControl('modelo', draft, { editing: true })}
              ${_fieldControl('placas', draft, { editing: true })}
              ${_fieldControl('color', draft, { editing: true })}
              ${_fieldControl('sucursal', draft, { editing: true })}
              ${_fieldControl('plazaActual', draft, { editing: true })}
              ${_fieldControl('estado', draft, { editing: true })}
              ${_fieldControl('activo', draft, { editing: true })}
              ${_fieldControl('gasolina', draft, { editing: true })}
              ${_fieldControl('km', draft, { editing: true })}
            </div>
          </section>
          <section class="uni-form-panel">
            ${_fieldControl('descripcion', draft, { editing: true })}
          </section>
        </div>
        <div class="uni-modal-actions">
          <button type="button" class="uni-btn ghost" data-action="close-modal">Cancelar</button>
          <button type="submit" class="uni-btn primary" ${_s.busy ? 'disabled' : ''}>Guardar unidad</button>
        </div>
      </form>
    </div>
  `;
}

function _openImportModal() {
  if (!_canManage()) return _toast('No tienes permiso para importar unidades.', 'error');
  _s.importRows = [];
  _s.importRaw = null;
  _s.importMapping = {};
  _s.importFileName = '';
  _s.importMessage = '';
  const host = _ctr.querySelector('#uni-modal-host');
  host.innerHTML = `
    <div class="uni-modal-backdrop" role="dialog" aria-modal="true">
      <div class="uni-modal uni-modal--import">
        <div class="uni-modal-head">
          <div><p>Importación global</p><h2>Cargar unidades al índice maestro</h2></div>
          <button type="button" class="uni-icon-btn" data-action="close-modal"><span class="material-icons">close</span></button>
        </div>
        <div class="uni-import-grid">
          <label class="uni-drop">
            <input id="uni-import-file" type="file" accept=".csv,.txt,.tsv,.xls,.xlsx,.pdf,image/*">
            <span class="material-icons">upload_file</span>
            <strong>Seleccionar archivo</strong>
            <small>CSV, TSV o Excel (.xls/.xlsx). PDF o foto: pega filas en el cuadro de texto.</small>
          </label>
          <label class="uni-import-text">
            <span>Filas pegadas</span>
            <textarea id="uni-import-paste" placeholder="MVA, Modelo, Placas, Clase, Locación propietaria, Locación actual, Estatus"></textarea>
            <button type="button" class="uni-btn ghost" data-action="parse-paste">Previsualizar texto</button>
          </label>
        </div>
        <div id="uni-import-preview">${_importPreviewHtml()}</div>
        <div class="uni-modal-actions">
          <button type="button" class="uni-btn ghost" data-action="close-modal">Cancelar</button>
          <button type="button" class="uni-btn primary" data-action="apply-import" disabled>Aplicar importación</button>
        </div>
      </div>
    </div>
  `;
  host.querySelector('[data-action="parse-paste"]')?.addEventListener('click', () => {
    const text = host.querySelector('#uni-import-paste')?.value || '';
    _setImportRaw(parseDelimitedText(text), fileNameFromPaste());
    _rebuildImportRows();
    _s.importMessage = _s.importRows.length ? `${_s.importRows.length} unidades listas para revisar.` : 'No se detectaron filas válidas.';
    _paintImportPreview();
  });
}

function fileNameFromPaste() {
  return _s?.importFileName || 'texto-pegado';
}

function _setImportRaw(parsed, fileName = '') {
  if (fileName) _s.importFileName = fileName;
  _s.importRaw = parsed;
  _s.importMapping = { ...(parsed?.mapping || {}) };
}

function _rebuildImportRows() {
  if (!_s?.importRaw?.body?.length) {
    _s.importRows = [];
    return;
  }
  const plain = applyMapping(_s.importRaw.body, _s.importMapping);
  _s.importRows = plain.map(row => _unitPayload(row)).filter(r => r.mva);
}

async function _readImportFile(file) {
  if (!file) return;
  _s.importFileName = file.name;
  try {
    if (/\.(csv|txt|tsv)$/i.test(file.name) || /^text\//i.test(file.type || '')) {
      const text = await file.text();
      _setImportRaw(parseDelimitedText(text), file.name);
    } else if (/\.(xlsx|xls)$/i.test(file.name)) {
      const { matrix, sheetName } = await readSpreadsheetFile(file);
      _setImportRaw(analyzeMatrix(matrix), `${file.name} · ${sheetName}`);
    } else if (/\.(pdf|png|jpe?g|webp|gif)$/i.test(file.name) || /^image\//i.test(file.type || '')) {
      _s.importRaw = null;
      _s.importMapping = {};
      _s.importRows = [];
      _s.importMessage = `${file.name}: copia las filas del documento en el cuadro de texto y pulsa Previsualizar.`;
      _paintImportPreview();
      return;
    } else {
      _s.importRaw = null;
      _s.importMapping = {};
      _s.importRows = [];
      _s.importMessage = `Formato no soportado (${file.name}). Usa CSV, Excel o pega filas manualmente.`;
      _paintImportPreview();
      return;
    }
    _rebuildImportRows();
    _s.importMessage = _s.importRows.length
      ? `${_s.importRows.length} unidades leídas desde ${file.name}.`
      : 'No se detectaron filas válidas. Revisa el mapeo de columnas.';
  } catch (err) {
    _s.importRaw = null;
    _s.importRows = [];
    _s.importMessage = err?.message || 'No se pudo leer el archivo.';
  }
  _paintImportPreview();
}

function _paintImportPreview() {
  const host = _ctr.querySelector('#uni-import-preview');
  if (host) host.innerHTML = _importPreviewHtml();
  const btn = _ctr.querySelector('[data-action="apply-import"]');
  if (btn) btn.disabled = !_s.importRows.length || _s.busy;
}

function _importPreviewHtml() {
  const rows = _s?.importRows || [];
  const raw = _s?.importRaw;
  const mappingBlock = raw?.headers?.length ? `
    <div class="uni-import-map">
      <p class="uni-import-map-title">Mapeo de columnas</p>
      <div class="uni-import-map-grid">
        ${raw.headers.map((label, i) => `
          <label>
            <span>${esc(label || `Col ${i + 1}`)}</span>
            <select data-action="import-map" data-col="${i}">
              ${IMPORT_FIELD_OPTIONS.map(opt => _option(opt.key, opt.label, _s.importMapping[i] || '')).join('')}
            </select>
          </label>
        `).join('')}
      </div>
    </div>
  ` : '';
  return `
    <section class="uni-import-preview">
      <p>${esc(_s?.importMessage || 'Carga un archivo o pega filas para previsualizar.')}</p>
      ${mappingBlock}
      ${rows.length ? `
        <div class="uni-table-wrap small">
          <table class="uni-table">
            <thead><tr><th>MVA</th><th>Modelo</th><th>Placas</th><th>Clase</th><th>Propietaria</th><th>Actual</th><th>Estatus</th></tr></thead>
            <tbody>${rows.slice(0, 20).map(r => `<tr><td>${esc(r.mva)}</td><td>${esc(r.modelo)}</td><td>${esc(r.placas)}</td><td>${esc(r.clase)}</td><td>${esc(r.sucursal)}</td><td>${esc(r.plazaActual)}</td><td>${esc(r.estado)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
        <small>${rows.length > 20 ? `Mostrando 20 de ${rows.length}.` : 'Revisa los datos antes de aplicar.'}</small>
      ` : ''}
    </section>
  `;
}

async function _applyImport() {
  const rows = _s.importRows || [];
  if (!rows.length) return;
  _s.busy = true;
  _paintImportPreview();
  const byMva = new Map(_s.units.map(u => [String(u.mva || '').toUpperCase(), u]));
  let created = 0;
  let updated = 0;
  const errors = [];
  for (const row of rows) {
    try {
      const mva = _norm(row.mva);
      if (!mva) continue;
      const existing = byMva.get(mva);
      const payload = _unitPayload({ ...(existing || {}), ...row, mva }, existing);
      const res = existing
        ? await actualizarUnidadPlaza({ ...payload, id: existing.id || existing.fila || existing.mva })
        : await registrarUnidadEnPlaza(payload);
      if (_ok(res)) {
        if (existing) updated += 1;
        else created += 1;
      } else errors.push(`${mva}: ${res}`);
    } catch (err) {
      errors.push(`${row.mva || 'SIN MVA'}: ${err?.message || err}`);
    }
  }
  _s.busy = false;
  _s.importMessage = `${created} creadas · ${updated} actualizadas${errors.length ? ` · ${errors.length} errores` : ''}`;
  _toast(`Importación: ${created} creadas, ${updated} actualizadas${errors.length ? `. Errores: ${errors.slice(0, 3).join(' | ')}` : ''}`, errors.length ? 'error' : 'success');
  _closeModal();
  await _load();
}

async function _saveUnit(form) {
  if (_s.busy) return;
  const row = Object.fromEntries(new FormData(form).entries());
  const original = form.dataset.unitForm === 'edit' ? _findById(form.dataset.id) : null;
  const payload = _unitPayload(row, original);
  if (!payload.mva) return _toast('Captura el número económico.', 'error');
  const fromDetail = form.dataset.context === 'detail';
  const keepId = _s.selectedId;
  _s.busy = true;
  if (fromDetail) _syncDetailEditingUi();
  try {
    const res = original
      ? await actualizarUnidadPlaza({ ...payload, id: original.id || original.fila || original.mva })
      : await registrarUnidadEnPlaza(payload);
    if (!_ok(res)) throw new Error(String(res || 'No se pudo guardar.'));
    _toast('Unidad guardada.', 'success');
    if (fromDetail) {
      _s.detailEditing = false;
      await _load();
      const saved = _findById(original?.id || original?.fila || keepId) || _findById(payload.mva);
      _s.selectedId = saved?.id || saved?.mva || payload.mva || keepId;
      _paint();
    } else {
      _closeModal();
      await _load();
    }
  } catch (err) {
    _toast(err?.message || 'No se pudo guardar la unidad.', 'error');
  } finally {
    if (_s) {
      _s.busy = false;
      if (fromDetail) _syncDetailEditingUi();
    }
  }
}

function _unitPayload(row, original = null) {
  const plaza = _norm(row.sucursal || row.plaza || original?.sucursal || _s.plaza);
  const actual = _norm(row.plazaActual || row.ubicacionActual || original?.plazaActual || plaza);
  return {
    ...(original || {}),
    mva: _norm(row.mva),
    vin: _norm(row.vin),
    clase: _norm(row.clase || row.categoria),
    categoria: _norm(row.clase || row.categoria),
    anio: String(row.anio || row.año || '').trim(),
    marca: _norm(row.marca),
    modelo: _norm(row.modelo),
    placas: _norm(row.placas),
    color: _norm(row.color),
    sucursal: plaza,
    plaza,
    plazaActual: actual,
    estado: _norm(row.estado || row.estatus),
    activo: _normalizeActivo(row.activo),
    gasolina: String(row.gasolina || '').trim(),
    km: _numberOrText(row.km),
    descripcion: String(row.descripcion || row.notas || '').trim(),
    _updatedAt: Date.now(),
    _updatedBy: _actor()
  };
}

function _exportCsv() {
  const rows = _filtered();
  const header = FIELD_ORDER.map(k => FIELD_LABEL[k]);
  const body = rows.map(row => FIELD_ORDER.map(k => _csv(_field(row, k))));
  const csv = '\ufeff' + [header.map(_csv).join(','), ...body.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `unidades-${_s.plaza || 'ALL'}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function _filtered() {
  const f = _s.filters;
  const q = _deaccent(f.q).toLowerCase();
  return _s.units.filter(row => {
    const hay = _deaccent([row.mva, row.placas, row.vin, row.modelo, row.marca, row.sucursal, row.plazaActual, row.estado].join(' ')).toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (f.clase && _norm(row.clase || row.categoria) !== _norm(f.clase)) return false;
    if (f.sucursal && _norm(row.sucursal || row.plaza) !== _norm(f.sucursal)) return false;
    if (f.plazaActual && _norm(row.plazaActual || row.ubicacionActual) !== _norm(f.plazaActual)) return false;
    if (f.estado && _norm(row.estado || row.estatus) !== _norm(f.estado)) return false;
    if (f.activo && (_isActive(row) ? 'ACTIVO' : 'INACTIVO') !== f.activo) return false;
    return true;
  }).sort((a, b) => String(a.mva || '').localeCompare(String(b.mva || '')));
}

function _normalizeUnit(row = {}) {
  return {
    ...row,
    id: row.id || row.fila || row.mva || '',
    mva: _norm(row.mva || row.numeroEconomico || row.economico),
    clase: _norm(row.clase || row.categoria || row.tipo),
    anio: row.anio || row.año || row.year || '',
    sucursal: _norm(row.sucursal || row.plaza || row.locacionPropietaria),
    plazaActual: _norm(row.plazaActual || row.locacionActual || row.ubicacionActual || row.plaza || ''),
    estado: _norm(row.estado || row.estatus || ''),
    activo: _normalizeActivo(row.activo ?? row.active ?? true)
  };
}

function _emptyFilters() {
  return { q: '', clase: '', sucursal: '', plazaActual: '', estado: '', activo: '' };
}

function _selected() {
  return _findById(_s.selectedId);
}

function _findById(id) {
  const key = String(id || '').trim();
  if (!key) return null;
  return _s.units.find(row => [row.id, row.fila, row.mva].some(v => String(v || '').trim() === key)) || null;
}

function _field(row, key) {
  if (key === 'anio') return row.anio || row.año || '';
  if (key === 'activo') return _isActive(row) ? 'Activo' : 'Inactivo';
  if (key === 'descripcion') return row.descripcion || row.notas || '';
  return row[key] ?? '';
}

function _fieldControl(key, row, { editing = false, required = false } = {}) {
  const val = _field(row, key);
  const req = required ? ' required' : '';
  const label = `${esc(FIELD_LABEL[key])}${required ? ' *' : ''}`;
  const locked = key === 'id';
  const catalog = _fieldCatalog(key);

  if (key === 'descripcion') {
    if (editing) {
      return `<label class="span-all"><span>${label}</span><textarea name="descripcion" placeholder="Notas u observaciones">${esc(row?.descripcion || row?.notas || '')}</textarea></label>`;
    }
    return `<label class="span-all"><span>${label}</span><textarea readonly tabindex="-1">${esc(val || 'Sin notas registradas.')}</textarea></label>`;
  }

  if (key === 'activo') {
    if (editing) {
      const active = _isActive(row || {});
      return `<label><span>${label}</span><select name="activo"${req}>
        ${_option('Activo', 'Activo', active ? 'Activo' : 'Inactivo')}
        ${_option('Inactivo', 'Inactivo', active ? 'Activo' : 'Inactivo')}
      </select></label>`;
    }
    return `<label><span>${label}</span><input value="${esc(val || '—')}" readonly tabindex="-1"></label>`;
  }

  if (editing && catalog?.length) {
    return `<label><span>${label}</span><select name="${esc(key)}"${req}>
      ${required ? '' : _option('', 'Seleccionar', val)}
      ${catalog.map(item => _option(item, item, val)).join('')}
    </select></label>`;
  }

  if (editing && !locked) {
    return `<label><span>${label}</span><input name="${esc(key)}" value="${esc(val)}"${req}></label>`;
  }

  return `<label><span>${label}</span><input value="${esc(val || '—')}" readonly tabindex="-1"></label>`;
}

const FILTER_LABEL = {
  clase: 'Clase',
  sucursal: 'Loc. propietaria',
  plazaActual: 'Loc. actual',
  estado: 'Estatus',
  activo: 'Activo'
};

function _filterSelect(key, options, selected, allLabel = 'Todos', labels = {}) {
  const label = FILTER_LABEL[key] || key;
  return `<label><span>${esc(label)}</span><select data-filter="${esc(key)}">
    ${_option('', allLabel, selected)}
    ${options.map(v => _option(v, labels[v] || v, selected)).join('')}
  </select></label>`;
}

function _listas() {
  return window.MEX_CONFIG?.listas || {};
}

function _catalogNames(listKey) {
  const raw = _listas()[listKey];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(item => {
    if (typeof item === 'string') return _norm(item);
    return _norm(item?.nombre || item?.codigo || item?.etiqueta || item?.valor || '');
  }).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
}

function _plazasCatalog() {
  const empresa = window.MEX_CONFIG?.empresa || {};
  const direct = Array.isArray(empresa.plazas) ? empresa.plazas : [];
  const fromDetail = Array.isArray(empresa.plazasDetalle)
    ? empresa.plazasDetalle.map(p => p?.id)
    : [];
  return [...new Set([...direct, ...fromDetail, _s?.plaza].map(p => _norm(p)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));
}

function _fieldCatalog(key) {
  if (key === 'clase') return _catalogNames('categorias');
  if (key === 'sucursal' || key === 'plazaActual') return _plazasCatalog();
  if (key === 'estado') return _catalogNames('estados');
  if (key === 'gasolina') return _catalogNames('gasolinas');
  if (key === 'modelo') return _catalogNames('modelos');
  return null;
}

function _isActive(row) {
  const raw = String(row?.activo ?? row?.active ?? '').toUpperCase().trim();
  if (!raw) return true;
  return !['NO', 'FALSE', 'INACTIVO', '0', 'BAJA'].includes(raw);
}

function _normalizeActivo(value) {
  return _isActive({ activo: value }) ? 'Activo' : 'Inactivo';
}

function _canView() {
  return (ROLE_LEVEL[_role()] || 0) >= ROLE_LEVEL.VENTAS;
}

function _canManage() {
  if (window.mexPerms?.canDo?.('manage_global_fleet')) return true;
  if (window.mexPerms?.canDo?.('manage_fleet')) return true;
  return ['GERENTE_PLAZA', 'JEFE_REGIONAL', 'CORPORATIVO_USER', 'JEFE_OPERACION', 'PROGRAMADOR'].includes(_role());
}

function _role() {
  const gs = getState();
  return String(gs.role || gs.profile?.rol || gs.profile?.role || '').toUpperCase().trim();
}

function _actor() {
  const gs = getState();
  return String(gs.profile?.nombre || gs.profile?.usuario || gs.profile?.email || window._auth?.currentUser?.email || 'Sistema').trim();
}

function _closeModal() {
  const host = _ctr?.querySelector('#uni-modal-host');
  if (host) host.innerHTML = '';
}

function _skeleton() {
  return `<div class="uni-skeleton">${Array.from({ length: 10 }).map(() => '<span></span>').join('')}</div>`;
}

function _includes(a, b) {
  return _deaccent(a).toLowerCase().includes(_deaccent(b).toLowerCase());
}

function _deaccent(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function _norm(value) {
  return String(value || '').trim().toUpperCase();
}

function _numberOrText(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const n = Number(raw.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : raw;
}

function _csv(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function _option(value, label, selected) {
  const v = String(value ?? '');
  return `<option value="${esc(v)}" ${String(selected ?? '') === v ? 'selected' : ''}>${esc(label)}</option>`;
}

function _ok(res) {
  if (res === true || res === 'OK' || res === 'EXITO') return true;
  if (typeof res === 'string') return !/^ERROR\b/i.test(res);
  return Boolean(res?.ok || res?.success);
}

function _toast(message, type = 'info') {
  if (typeof window.showToast === 'function') window.showToast(message, type);
  else console[type === 'error' ? 'error' : 'log'](message);
}

function _renderNoAccess() {
  if (!_ctr) return;
  _ctr.innerHTML = `
    <section class="uni">
      <div class="uni-denied">
        <span class="material-icons">lock</span>
        <h2>Sin acceso a unidades</h2>
        <p>Esta sección está disponible desde ventas en adelante.</p>
      </div>
    </section>
  `;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
