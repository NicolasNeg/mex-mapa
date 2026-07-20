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
  saveMapping,
  extractTextFromImageFile,
  extractTextFromPdfFile,
  matrixFromOcrText,
  loadXlsxLibrary
} from '/js/app/features/unidades/unidades-import.js';
import {
  buildExportFilename,
  exportFooterHtml,
  exportExcelMetaRows,
  getExportIdentity,
} from '/js/core/export-signing.js';

let _ctr = null;
let _navigate = null;
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
  'sucursal', 'plazaActual', 'estado', 'activo', 'color', 'capacidadTanque',
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
  capacidadTanque: 'Capacidad tanque (L)',
  km: 'Kilometraje',
  descripcion: 'Descripción'
};

export async function mount({ container, navigate }) {
  unmount();
  _ctr = container;
  _navigate = navigate;
  _ensureCss();

  const gs = getState();
  const plaza = _norm(getCurrentPlaza() || gs.profile?.plazaAsignada || '');
  _s = {
    role: _role(),
    plaza,
    loading: true,
    busy: false,
    error: '',
    units: [],
    // Scope table to active plaza so export cannot silently dump the full fleet.
    filters: { ..._emptyFilters(), plazaActual: plaza },
    page: 1,
    pageSize: 50,
    importRows: [],
    importRaw: null,
    importMapping: {},
    importFileName: '',
    importMessage: '',
    exportRows: null
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
  _applyDeepLinkFromQuery();

  _offs.push(onPlazaChange(next => {
    if (!_s) return;
    _s.plaza = _norm(next);
    // Keep table + export aligned with shell plaza (user can still clear to "Todas").
    _s.filters = { ..._s.filters, plazaActual: _s.plaza };
    _s.page = 1;
    _s.exportRows = null;
    _render();
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
  const href = '/css/app-unidades.css?v=20260715g';
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
  const keydown = e => _onKeydown(e);
  _ctr.addEventListener('click', click);
  _ctr.addEventListener('input', input);
  _ctr.addEventListener('change', change);
  _ctr.addEventListener('submit', submit);
  _ctr.addEventListener('keydown', keydown);
  _offs.push(() => _ctr?.removeEventListener('click', click));
  _offs.push(() => _ctr?.removeEventListener('input', input));
  _offs.push(() => _ctr?.removeEventListener('change', change));
  _offs.push(() => _ctr?.removeEventListener('submit', submit));
  _offs.push(() => _ctr?.removeEventListener('keydown', keydown));
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

function _applyDeepLinkFromQuery() {
  if (!_s) return;
  const params = new URLSearchParams(window.location.search);
  const mva = _norm(params.get('mva') || '');
  if (!mva) return;
  const row = _s.units.find(u => _norm(u.mva) === mva || _norm(u.id) === mva);
  if (!row) return;
  _goExpediente(mva, { edit: params.get('edit') === '1' });
}

function _goExpediente(mva, { edit = false } = {}) {
  const token = _norm(mva);
  if (!token) return;
  let path = `/app/cuadre/u/${encodeURIComponent(token)}`;
  if (edit) path += '?edit=1';
  if (typeof _navigate === 'function') _navigate(path);
  else if (typeof window.__mexGoToUnidad === 'function') window.__mexGoToUnidad(token, { edit });
  else window.location.assign(path);
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
      <main id="uni-table"></main>
      <div id="uni-modal-host"></div>
    </section>
  `;
  _paint();
}

function _paint() {
  if (!_ctr || !_s) return;
  _paintMessage();
  _paintTable();
}

function _paintMessage() {
  const host = _ctr.querySelector('#uni-message');
  if (!host) return;
  host.innerHTML = _s.error
    ? `<div class="uni-banner danger"><span class="material-icons">error</span>${esc(_s.error)}</div>`
    : '';
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
            <th>MVA</th><th>Clase</th><th>VIN</th><th>Año</th><th>Marca</th><th>Modelo</th>
            <th>Placas</th><th>Loc. propietaria</th>
            <th>Loc. actual</th><th>Estatus</th><th>Activo</th>
          </tr></thead>
          <tbody>
            ${pageRows.map(_rowHtml).join('') || `<tr><td colspan="11" class="uni-empty-row">Sin unidades para estos filtros.</td></tr>`}
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
  const mva = row.mva || id;
  return `
    <tr data-action="expediente" data-mva="${esc(mva)}" role="button" tabindex="0" title="Abrir expediente">
      <td><span class="uni-td-main uni-td-mono">${esc(mva || '—')}</span></td>
      <td>${esc(row.clase || row.categoria || '—')}</td>
      <td class="uni-td-mono">${esc(row.vin || '—')}</td>
      <td class="uni-td-mono">${esc(row.anio || row.año || '—')}</td>
      <td>${esc(row.marca || '—')}</td>
      <td><span class="uni-td-main">${esc(row.modelo || '—')}</span></td>
      <td class="uni-td-mono">${esc(row.placas || '—')}</td>
      <td>${esc(row.sucursal || row.plaza || '—')}</td>
      <td>${esc(row.plazaActual || row.ubicacionActual || row.plaza || '—')}</td>
      <td><span class="uni-status">${esc(row.estadoFlota || row.estado || row.estatus || '—')}</span></td>
      <td><span class="uni-active-text ${active ? 'yes' : 'no'}">${active ? 'Activo' : 'Inactivo'}</span></td>
    </tr>
  `;
}

function _onClick(event) {
  const el = event.target.closest('[data-action]');
  if (!el || !_ctr?.contains(el)) return;
  const action = el.dataset.action;
  if (action === 'reload') { void _load(); return; }
  if (action === 'clear') {
    _s.filters = _emptyFilters();
    _s.page = 1;
    _s.exportRows = null;
    _render();
    return;
  }
  if (action === 'export') { _openExportModal(); return; }
  if (action === 'export-csv') { _closeModal(); _exportCsv(); return; }
  if (action === 'export-xls') { void _exportXls(); return; }
  if (action === 'export-pdf') { _closeModal(); _exportPdf(); return; }
  if (action === 'new') { _openUnitModal(); return; }
  if (action === 'import') { _openImportModal(); return; }
  if (action === 'expediente') {
    const mva = el.dataset.mva || el.closest('tr')?.dataset?.mva;
    if (mva) _goExpediente(mva);
    return;
  }
  if (action === 'prev') { _s.page = Math.max(1, _s.page - 1); _paintTable(); return; }
  if (action === 'next') { _s.page += 1; _paintTable(); return; }
  if (action === 'close-modal') { _closeModal(); return; }
  if (action === 'apply-import') { void _applyImport(); return; }
}

function _onKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest('tr[data-action="expediente"]');
  if (!row || !_ctr?.contains(row)) return;
  event.preventDefault();
  const mva = row.dataset.mva;
  if (mva) _goExpediente(mva);
}

function _onInput(event) {
  const key = event.target?.dataset?.filter;
  if (!key) return;
  _s.filters[key] = event.target.value || '';
  _s.page = 1;
  _s.exportRows = null;
  _paintTable();
}

async function _onChange(event) {
  const key = event.target?.dataset?.filter;
  if (key) {
    _s.filters[key] = event.target.value || '';
    _s.page = 1;
    _s.exportRows = null;
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
              ${_fieldControl('capacidadTanque', draft, { editing: true })}
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
        <div class="uni-import-body">
          <div class="uni-import-grid">
            <label class="uni-drop">
              <input id="uni-import-file" type="file" accept=".csv,.txt,.tsv,.xls,.xlsx,.pdf,image/*,.png,.jpg,.jpeg,.webp">
              <span class="material-icons">upload_file</span>
              <strong>Seleccionar archivo</strong>
              <small>CSV, Excel, PDF o foto de tabla. Las imágenes se leen con OCR automáticamente.</small>
            </label>
            <label class="uni-import-text">
              <span>Filas pegadas</span>
              <textarea id="uni-import-paste" placeholder="MVA, Modelo, Placas, Clase, Locación propietaria, Locación actual, Estatus"></textarea>
              <button type="button" class="uni-btn ghost" data-action="parse-paste">Previsualizar texto</button>
            </label>
          </div>
          <div id="uni-import-preview">${_importPreviewHtml()}</div>
        </div>
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

function _openExportModal() {
  const rows = _rowsForExport();
  if (!rows) return;
  _s.exportRows = rows;
  const host = _ctr.querySelector('#uni-modal-host');
  host.innerHTML = `
    <div class="uni-modal-backdrop" role="dialog" aria-modal="true">
      <div class="uni-modal uni-modal--export">
        <div class="uni-modal-head">
          <div><p>Exportar</p><h2>${rows.length} unidades filtradas</h2></div>
          <button type="button" class="uni-icon-btn" data-action="close-modal"><span class="material-icons">close</span></button>
        </div>
        <p class="uni-export-hint">${esc(_filterSummary())}</p>
        <div class="uni-export-menu">
          <button type="button" data-action="export-pdf">
            <span class="material-symbols-outlined">picture_as_pdf</span>
            <span><strong>1 · PDF</strong><small>Documento imprimible de la tabla filtrada</small></span>
          </button>
          <button type="button" data-action="export-xls">
            <span class="material-symbols-outlined">table_view</span>
            <span><strong>2 · XLS</strong><small>Excel · solo filas visibles con estos filtros</small></span>
          </button>
          <button type="button" data-action="export-csv">
            <span class="material-symbols-outlined">csv</span>
            <span><strong>3 · CSV</strong><small>Solo filas filtradas · compatible con importación</small></span>
          </button>
        </div>
        <div class="uni-modal-actions">
          <button type="button" class="uni-btn ghost" data-action="close-modal">Cancelar</button>
        </div>
      </div>
    </div>
  `;
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

/** Rechazo duro: OCR/PDF sin ≥1 fila con MVA. */
function _rejectImportOcrNoRows(kind = 'imagen') {
  _s.importRaw = null;
  _s.importMapping = {};
  _s.importRows = [];
  _s.importFileName = '';
  const paste = _ctr?.querySelector('#uni-import-paste');
  if (paste) paste.value = '';
  const input = _ctr?.querySelector('#uni-import-file');
  if (input) input.value = '';
  const msg = kind === 'pdf'
    ? 'No se detectaron filas en el PDF. Prueba otro archivo o pega filas manualmente.'
    : 'No se detectaron filas en la imagen. Prueba otra captura.';
  _s.importMessage = msg;
  _toast(msg, 'error');
  _paintImportPreview();
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
    } else if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      _s.importMessage = `Leyendo PDF ${file.name}…`;
      _paintImportPreview();
      const text = await extractTextFromPdfFile(file, (pct) => {
        _s.importMessage = `Leyendo PDF… ${pct}%`;
        _paintImportPreview();
      });
      _setImportRaw(matrixFromOcrText(text), file.name);
      _rebuildImportRows();
      if (!_s.importRows.length) {
        _rejectImportOcrNoRows('pdf');
        return;
      }
      const paste = _ctr.querySelector('#uni-import-paste');
      if (paste) paste.value = text;
    } else if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name) || /^image\//i.test(file.type || '')) {
      _s.importMessage = `Leyendo imagen con OCR…`;
      _paintImportPreview();
      const text = await extractTextFromImageFile(file, (pct) => {
        _s.importMessage = `OCR en progreso… ${pct}%`;
        _paintImportPreview();
      });
      _setImportRaw(matrixFromOcrText(text), file.name);
      _rebuildImportRows();
      if (!_s.importRows.length) {
        _rejectImportOcrNoRows('imagen');
        return;
      }
      const paste = _ctr.querySelector('#uni-import-paste');
      if (paste) paste.value = text;
    } else {
      _s.importRaw = null;
      _s.importMapping = {};
      _s.importRows = [];
      _s.importMessage = `Formato no soportado (${file.name}). Usa CSV, Excel, PDF o imagen.`;
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
  _s.busy = true;
  try {
    const res = original
      ? await actualizarUnidadPlaza({ ...payload, id: original.id || original.fila || original.mva })
      : await registrarUnidadEnPlaza(payload);
    if (!_ok(res)) throw new Error(String(res || 'No se pudo guardar.'));
    _toast('Unidad guardada.', 'success');
    _closeModal();
    await _load();
  } catch (err) {
    _toast(err?.message || 'No se pudo guardar la unidad.', 'error');
  } finally {
    if (_s) _s.busy = false;
  }
}

function _unitPayload(row, original = null) {
  const plaza = _norm(row.sucursal || row.plaza || original?.sucursal || _s.plaza);
  const actual = _norm(row.plazaActual || row.ubicacionActual || original?.plazaActual || plaza);
  const payload = {
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
    capacidadTanque: _normalizeCapacidadTanque({ ...(original || {}), ...row }),
    km: _numberOrText(row.km),
    descripcion: String(row.descripcion || row.notas || '').trim(),
    _updatedAt: Date.now(),
    _updatedBy: _actor()
  };
  delete payload.gasolina;
  return payload;
}

function _exportCsv() {
  const rows = _rowsForExport();
  if (!rows) return;
  const header = FIELD_ORDER.map(k => FIELD_LABEL[k]);
  const body = rows.map(row => FIELD_ORDER.map(k => _csv(_field(row, k))));
  const csv = '\ufeff' + [header.map(_csv).join(','), ...body.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  _downloadBlob(blob, buildExportFilename('csv'));
  _s.exportRows = null;
  _toast(`Exportadas ${rows.length} unidades filtradas (CSV).`, 'success');
}

async function _exportXls() {
  const rows = _rowsForExport();
  if (!rows) return;
  try {
    const XLSX = await loadXlsxLibrary();
    // Re-check after await: never write a stale full-fleet snapshot.
    const live = _rowsForExport();
    if (!live) return;
    const header = FIELD_ORDER.map(k => FIELD_LABEL[k]);
    const aoa = [
      ...exportExcelMetaRows(),
      header,
      ...live.map(row => FIELD_ORDER.map(k => _field(row, k))),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Unidades');
    const out = XLSX.write(wb, { bookType: 'xls', type: 'array' });
    const blob = new Blob([out], { type: 'application/vnd.ms-excel' });
    _downloadBlob(blob, buildExportFilename('xls'));
    _s.exportRows = null;
    _closeModal();
    _toast(`Exportadas ${live.length} unidades filtradas (Excel).`, 'success');
  } catch (err) {
    _toast(err?.message || 'No se pudo generar el Excel.', 'error');
  }
}

function _exportPdf() {
  const rows = _rowsForExport();
  if (!rows) return;
  const cols = FIELD_ORDER.filter(k => k !== 'descripcion');
  const thead = cols.map(k => `<th>${esc(FIELD_LABEL[k])}</th>`).join('');
  const tbody = rows.map(row =>
    `<tr>${cols.map(k => `<td>${esc(_field(row, k) || '—')}</td>`).join('')}</tr>`
  ).join('');
  const summary = esc(_filterSummary());
  const id = getExportIdentity();
  const firma = exportFooterHtml({ escapeHtml: esc });
  const title = buildExportFilename('pdf').replace(/\.pdf$/i, '');
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
    <title>${esc(title)}</title>
    <style>
      body{font:12px/1.35 Inter,system-ui,sans-serif;color:#0f172a;margin:24px;background:#fff}
      h1{font-size:18px;margin:0 0 4px} p{margin:0 0 16px;color:#64748b}
      table{width:100%;border-collapse:collapse;font-size:10px}
      th,td{border:1px solid #cbd5e1;padding:5px 6px;text-align:left;vertical-align:top}
      th{background:#0f172a;color:#fff;font-weight:700}
      tr:nth-child(even) td{background:#f8fafc}
      @page{size:landscape;margin:12mm}
    </style></head><body>
    <h1>Inventario de unidades (filtrado)</h1>
    <p>${esc(id.companyName)} · ${summary} · ${rows.length} registros · ${esc(id.dateYmd)}</p>
    <table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
    ${firma}
    <script>window.onload=function(){window.print()}<\/script>
    </body></html>`;
  const win = window.open('', '_blank');
  if (!win) {
    _toast('Permite ventanas emergentes para exportar PDF.', 'error');
    return;
  }
  win.document.write(html);
  win.document.close();
  _s.exportRows = null;
}

function _exportDate() {
  return new Date().toISOString().slice(0, 10);
}

function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** True when the user has narrowed the table — required before any export. */
function _hasActiveFilters() {
  const f = _s?.filters;
  if (!f) return false;
  return Boolean(
    String(f.q || '').trim()
    || f.clase
    || f.sucursal
    || f.plazaActual
    || f.estado
    || f.activo
  );
}

/**
 * Single export gate: same dataset as the table (`_filtered`), never `_s.units`.
 * Returns a defensive copy, or null after toasting why export was blocked.
 */
function _rowsForExport() {
  if (!_s) return null;
  if (!_hasActiveFilters()) {
    _toast('Aplica al menos un filtro antes de exportar. No se permite descargar toda la flota.', 'error');
    return null;
  }
  const rows = _filtered();
  if (!rows.length) {
    _toast('No hay unidades para exportar con estos filtros.', 'error');
    return null;
  }
  // Never hand out the live collection reference.
  return rows.slice();
}

function _filterSummary() {
  const f = _s?.filters || _emptyFilters();
  const parts = [];
  if (String(f.q || '').trim()) parts.push(`Buscar: ${String(f.q).trim()}`);
  if (f.clase) parts.push(`Clase: ${f.clase}`);
  if (f.sucursal) parts.push(`Loc. propietaria: ${f.sucursal}`);
  if (f.plazaActual) parts.push(`Loc. actual: ${f.plazaActual}`);
  if (f.estado) parts.push(`Estatus: ${f.estado}`);
  if (f.activo) parts.push(`Activo: ${f.activo === 'ACTIVO' ? 'Activo' : 'Inactivo'}`);
  return parts.length ? parts.join(' · ') : 'Sin filtros';
}

function _exportSlug() {
  const f = _s?.filters || {};
  const token = _norm(f.plazaActual || f.sucursal || f.estado || f.clase || f.activo || 'filtrado')
    .replace(/[^A-Z0-9_-]+/g, '-')
    .slice(0, 24);
  return token || 'filtrado';
}

function _filtered() {
  const f = _s.filters;
  const q = _deaccent(f.q).toLowerCase();
  // Always derive from filters — never return `_s.units` as a shortcut.
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

function _findById(id) {
  const key = String(id || '').trim();
  if (!key) return null;
  return _s.units.find(row => [row.id, row.fila, row.mva].some(v => String(v || '').trim() === key)) || null;
}

function _field(row, key) {
  if (key === 'anio') return row.anio || row.año || '';
  if (key === 'activo') return _isActive(row) ? 'Activo' : 'Inactivo';
  if (key === 'descripcion') return row.descripcion || row.notas || '';
  if (key === 'capacidadTanque') return _capacidadTanqueDisplay(row);
  return row[key] ?? '';
}

function _fieldControl(key, row, { editing = false, required = false } = {}) {
  const val = _field(row, key);
  const req = required ? ' required' : '';
  const label = `${esc(FIELD_LABEL[key])}${required ? ' *' : ''}`;
  const locked = key === 'id';
  const catalog = _fieldCatalog(key, row);

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

  if (key === 'capacidadTanque') {
    const cap = _capacidadTanqueDisplay(row);
    if (editing) {
      return `<label><span>${label}</span><input name="capacidadTanque" type="number" min="0" step="1" inputmode="numeric" placeholder="Ej. 54" value="${esc(cap)}"${req}></label>`;
    }
    return `<label><span>${label}</span><input value="${esc(cap ? `${cap} L` : '—')}" readonly tabindex="-1"></label>`;
  }

  if (editing && catalog?.length) {
    const options = _catalogWithValue(catalog, val);
    return `<label><span>${label}</span><select name="${esc(key)}"${req}>
      ${required ? '' : _option('', 'Seleccionar', val)}
      ${options.map(item => _option(item, item, val)).join('')}
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

function _fieldCatalog(key, row = null) {
  if (key === 'clase') return _catalogWithValue(_catalogNames('categorias'), _field(row || {}, key));
  if (key === 'sucursal' || key === 'plazaActual') {
    return _catalogWithValue(_plazasCatalog(), _field(row || {}, key));
  }
  if (key === 'estado') return _estadosCatalog(_field(row || {}, key));
  if (key === 'modelo') return _catalogWithValue(_catalogNames('modelos'), _field(row || {}, key));
  return null;
}

function _catalogWithValue(catalog, currentVal) {
  const cur = _norm(currentVal);
  const base = Array.isArray(catalog) ? catalog : [];
  if (!cur) return base;
  return [...new Set([...base, cur].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
}

function _estadosCatalog(currentVal = '') {
  const base = _catalogNames('estados');
  const fromUnits = [...new Set((_s?.units || []).map(u => _norm(u.estado || u.estatus)).filter(Boolean))];
  const fallback = ['ARRENDABLE', 'DISPONIBLE', 'RENTADO', 'MANTENIMIENTO', 'TRASLADO', 'SUCIO', 'LIMPIO'];
  return _catalogWithValue([...base, ...fromUnits, ...fallback], currentVal);
}

function _looksLikeFuelLevel(value) {
  const s = String(value || '').trim().toUpperCase();
  if (!s) return false;
  if (/^\d+$/.test(s)) return false;
  if (/^\d+(\.\d+)?\s*(L|LT|LTS|LITROS?)?$/i.test(s)) return false;
  return /^(F|E|N\/A|\d+\/\d+|\d+\s*\/\s*\d+|H)$/.test(s) || s.includes('/');
}

function _capacidadTanqueDisplay(row = {}) {
  const direct = row.capacidadTanque ?? row.tanqueLitros ?? '';
  if (direct !== '' && direct != null) {
    const n = Number(direct);
    return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : String(direct).trim();
  }
  const legacy = row.gasolina;
  if (legacy != null && legacy !== '' && !_looksLikeFuelLevel(legacy)) {
    const n = Number(String(legacy).replace(/[^\d.]/g, ''));
    if (Number.isFinite(n) && n > 0) return String(Math.round(n));
  }
  return '';
}

function _normalizeCapacidadTanque(row = {}) {
  const raw = row?.capacidadTanque ?? row?.tanqueLitros ?? '';
  const n = Number(String(raw).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : '';
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
