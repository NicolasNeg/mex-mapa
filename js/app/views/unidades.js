// ============================================================================
//  /js/app/views/unidades.js - Inventario global de unidades
// ============================================================================

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import {
  obtenerUnidadesPlazas,
  registrarUnidadEnPlaza,
  actualizarUnidadPlaza
} from '/js/core/database.js';

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

const HEADER_ALIASES = {
  id: ['id', 'fila', 'unidad id'],
  clase: ['clase', 'categoria', 'categoría', 'tipo', 'class'],
  vin: ['vin', 'serie', 'numero serie', 'número serie'],
  anio: ['año', 'anio', 'ano', 'year'],
  marca: ['marca', 'brand'],
  modelo: ['modelo', 'model'],
  mva: ['mva', 'numero economico', 'número económico', 'num economico', 'no economico', 'unidad', 'economico', 'económico'],
  placas: ['placas', 'placa', 'plates'],
  sucursal: ['sucursal', 'plaza', 'locacion propietaria', 'locación propietaria', 'ubicacion propietaria'],
  plazaActual: ['plaza actual', 'locacion actual', 'locación actual', 'ubicacion actual', 'ubicación actual'],
  estado: ['estatus', 'estado', 'status'],
  activo: ['activo', 'active'],
  color: ['color'],
  gasolina: ['gasolina', 'tanque gasolina', 'gas', 'combustible'],
  km: ['km', 'kilometraje', 'kilómetros', 'kilometros'],
  descripcion: ['descripcion', 'descripción', 'notas', 'nota', 'observaciones']
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
    filters: _emptyFilters(),
    page: 1,
    pageSize: 50,
    importRows: [],
    importFileName: '',
    importMessage: ''
  };
  if (!_canView()) {
    _renderNoAccess();
    return;
  }

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
  if (document.querySelector('link[data-app-unidades-css="1"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = '/css/app-unidades.css';
  l.dataset.appUnidadesCss = '1';
  document.head.appendChild(l);
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
      <header class="uni-head">
        <div>
          <p>Inventario global</p>
          <h1>Unidades</h1>
          <span>Consulta, filtra, exporta y registra unidades en el índice maestro.</span>
        </div>
        <div class="uni-actions">
          <button type="button" class="uni-btn ghost" data-action="reload"><span class="material-icons">sync</span>Actualizar</button>
          <button type="button" class="uni-btn ghost" data-action="export"><span class="material-icons">download</span>Exportar</button>
          <button type="button" class="uni-btn primary" data-action="new" ${_canManage() ? '' : 'disabled'}><span class="material-icons">add</span>Nueva unidad</button>
          <button type="button" class="uni-btn primary" data-action="import" ${_canManage() ? '' : 'disabled'}><span class="material-icons">upload_file</span>Importar</button>
        </div>
      </header>

      <section class="uni-filters" aria-label="Filtros de unidades">
        <label class="wide"><span>Buscar</span><input data-filter="q" value="${esc(_s.filters.q)}" placeholder="MVA, placas, VIN, modelo"></label>
        <label><span>Clase</span><input data-filter="clase" value="${esc(_s.filters.clase)}" placeholder="CCAR"></label>
        <label><span>Locación propietaria</span><input data-filter="sucursal" value="${esc(_s.filters.sucursal)}" placeholder="BJX"></label>
        <label><span>Locación actual</span><input data-filter="plazaActual" value="${esc(_s.filters.plazaActual)}" placeholder="BJX"></label>
        <label><span>Estatus</span><input data-filter="estado" value="${esc(_s.filters.estado)}" placeholder="En renta"></label>
        <label><span>Activo</span><select data-filter="activo">
          ${_option('', 'Todos', _s.filters.activo)}
          ${_option('ACTIVO', 'Activo', _s.filters.activo)}
          ${_option('INACTIVO', 'Inactivo', _s.filters.activo)}
        </select></label>
        <div class="uni-filter-actions">
          <button type="button" class="uni-btn ghost" data-action="clear"><span class="material-icons">filter_alt_off</span>Limpiar</button>
          <span id="uni-count"></span>
        </div>
      </section>

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
  host.innerHTML = `
    <section class="uni-detail">
      <div class="uni-detail-top">
        <div>
          <p>Detalle de unidad</p>
          <h2>${esc(row.mva || row.id || 'Unidad')}</h2>
          <span>${esc([row.modelo, row.placas, row.vin].filter(Boolean).join(' · ') || 'Sin datos adicionales')}</span>
        </div>
        <div class="uni-actions">
          <button type="button" class="uni-btn ghost" data-action="close-detail"><span class="material-icons">close</span>Cerrar</button>
          <button type="button" class="uni-btn primary" data-action="edit" data-id="${esc(row.id || row.mva)}" ${_canManage() ? '' : 'disabled'}><span class="material-icons">edit</span>Editar</button>
        </div>
      </div>
      <div class="uni-detail-grid">
        ${FIELD_ORDER.filter(k => k !== 'descripcion').map(k => `<div><span>${esc(FIELD_LABEL[k])}</span><strong>${esc(_field(row, k) || '-')}</strong></div>`).join('')}
      </div>
      <div class="uni-detail-note">
        <span>Descripción / notas</span>
        <p>${esc(row.descripcion || row.notas || 'Sin notas registradas.')}</p>
      </div>
    </section>
  `;
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
  if (count) count.textContent = `${rows.length} de ${_s.units.length} registros`;
  host.innerHTML = `
    <section class="uni-table-card">
      <div class="uni-table-toolbar">
        <div>
          <strong>Lista de registros</strong>
          <span>Pagina ${_s.page} de ${totalPages}</span>
        </div>
        <label><span>Mostrar</span><select data-action="page-size">
          ${[25, 50, 100, 200].map(n => _option(String(n), `${n}`, String(_s.pageSize))).join('')}
        </select></label>
      </div>
      <div class="uni-table-wrap">
        <table class="uni-table">
          <thead><tr>
            <th>Id</th><th>Clase</th><th>VIN</th><th>Año</th><th>Marca</th><th>Modelo</th>
            <th>Número económico</th><th>Placas</th><th>Locación propietaria</th>
            <th>Locación actual</th><th>Estatus</th><th>Activo</th><th></th>
          </tr></thead>
          <tbody>
            ${pageRows.map(_rowHtml).join('') || `<tr><td colspan="13" class="uni-empty-row">Sin unidades para estos filtros.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="uni-pager">
        <span>Mostrando ${rows.length ? start + 1 : 0}-${Math.min(start + pageRows.length, rows.length)} de ${rows.length}</span>
        <div>
          <button type="button" class="uni-icon-btn" data-action="prev" ${_s.page <= 1 ? 'disabled' : ''}><span class="material-icons">chevron_left</span></button>
          <button type="button" class="uni-icon-btn" data-action="next" ${_s.page >= totalPages ? 'disabled' : ''}><span class="material-icons">chevron_right</span></button>
        </div>
      </div>
    </section>
  `;
}

function _rowHtml(row) {
  const id = row.id || row.mva || '';
  return `
    <tr data-action="select" data-id="${esc(id)}">
      <td><strong>${esc(row.fila || row.id || '-')}</strong></td>
      <td>${esc(row.clase || row.categoria || '-')}</td>
      <td><span class="mono">${esc(row.vin || '-')}</span></td>
      <td>${esc(row.anio || row.año || '-')}</td>
      <td>${esc(row.marca || '-')}</td>
      <td><strong>${esc(row.modelo || '-')}</strong></td>
      <td><strong>${esc(row.mva || '-')}</strong></td>
      <td>${esc(row.placas || '-')}</td>
      <td>${esc(row.sucursal || row.plaza || '-')}</td>
      <td>${esc(row.plazaActual || row.ubicacionActual || row.plaza || '-')}</td>
      <td><span class="uni-status">${esc(row.estado || row.estatus || '-')}</span></td>
      <td><span class="uni-active ${_isActive(row) ? 'yes' : 'no'}">${_isActive(row) ? 'Activo' : 'Inactivo'}</span></td>
      <td><button type="button" class="uni-icon-btn" data-action="select" data-id="${esc(id)}" title="Ver unidad"><span class="material-icons">visibility</span></button></td>
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
  if (action === 'edit') { _openUnitModal(_findById(el.dataset.id)); return; }
  if (action === 'close-detail') { _s.selectedId = ''; _paintDetail(); return; }
  if (action === 'select') { _s.selectedId = el.dataset.id || el.closest('tr')?.dataset.id || ''; _paintDetail(); return; }
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
  }
}

async function _onSubmit(event) {
  const form = event.target.closest('form[data-unit-form]');
  if (!form) return;
  event.preventDefault();
  await _saveUnit(form);
}

function _openUnitModal(row = null) {
  if (!_canManage()) return _toast('No tienes permiso para gestionar unidades globales.', 'error');
  const isEdit = Boolean(row);
  const host = _ctr.querySelector('#uni-modal-host');
  host.innerHTML = `
    <div class="uni-modal-backdrop" role="dialog" aria-modal="true">
      <form class="uni-modal" data-unit-form="${isEdit ? 'edit' : 'new'}" data-id="${esc(row?.id || '')}">
        <div class="uni-modal-head">
          <div><p>${isEdit ? 'Editar' : 'Alta global'}</p><h2>${isEdit ? esc(row.mva || 'Unidad') : 'Nueva unidad global'}</h2></div>
          <button type="button" class="uni-icon-btn" data-action="close-modal"><span class="material-icons">close</span></button>
        </div>
        <div class="uni-form-grid">
          ${_fieldInput('mva', row, true)}
          ${_fieldInput('vin', row)}
          ${_fieldInput('clase', row)}
          ${_fieldInput('anio', row)}
          ${_fieldInput('marca', row)}
          ${_fieldInput('modelo', row)}
          ${_fieldInput('placas', row)}
          ${_fieldInput('color', row)}
          ${_fieldInput('sucursal', row)}
          ${_fieldInput('plazaActual', row)}
          ${_fieldInput('estado', row)}
          ${_fieldInput('activo', row)}
          ${_fieldInput('gasolina', row)}
          ${_fieldInput('km', row)}
          <label class="wide"><span>Descripción</span><textarea name="descripcion">${esc(row?.descripcion || row?.notas || '')}</textarea></label>
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
            <small>CSV/TSV se procesa directo. Excel, PDF o foto quedan como referencia; pega filas para confirmar.</small>
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
    _s.importRows = _parseRows(text);
    _s.importMessage = _s.importRows.length ? `${_s.importRows.length} unidades listas para revisar.` : 'No se detectaron filas válidas.';
    _paintImportPreview();
  });
}

async function _readImportFile(file) {
  if (!file) return;
  _s.importFileName = file.name;
  if (/\.(csv|txt|tsv)$/i.test(file.name) || /^text\//i.test(file.type || '')) {
    const text = await file.text();
    _s.importRows = _parseRows(text);
    _s.importMessage = _s.importRows.length ? `${_s.importRows.length} unidades leídas desde ${file.name}.` : 'No se detectaron filas válidas.';
  } else {
    _s.importRows = [];
    _s.importMessage = `${file.name} cargado como referencia. Pega el contenido tabular para confirmar la importación.`;
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
  return `
    <section class="uni-import-preview">
      <p>${esc(_s?.importMessage || 'Carga un archivo o pega filas para previsualizar.')}</p>
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
  let ok = 0;
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
      if (_ok(res)) ok += 1;
      else errors.push(`${mva}: ${res}`);
    } catch (err) {
      errors.push(`${row.mva || 'SIN MVA'}: ${err?.message || err}`);
    }
  }
  _s.busy = false;
  _toast(`Importación aplicada: ${ok}/${rows.length}${errors.length ? `. Errores: ${errors.slice(0, 3).join(' | ')}` : ''}`, errors.length ? 'error' : 'success');
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

function _parseRows(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const rows = lines.map(_splitCsvLine).filter(r => r.some(Boolean));
  if (!rows.length) return [];
  const header = rows[0].map(_headerKey);
  const hasHeader = header.some(Boolean) && rows[0].some(c => /mva|modelo|placa|vin|econom/i.test(c));
  const body = hasHeader ? rows.slice(1) : rows;
  return body.map(cols => {
    const out = {};
    if (hasHeader) {
      header.forEach((key, i) => { if (key) out[key] = cols[i] || ''; });
    } else {
      const order = ['mva', 'modelo', 'placas', 'clase', 'sucursal', 'plazaActual', 'estado', 'vin', 'anio', 'marca'];
      order.forEach((key, i) => { out[key] = cols[i] || ''; });
    }
    return _unitPayload(out);
  }).filter(r => r.mva);
}

function _splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (!quoted && (ch === ',' || ch === '\t' || ch === ';')) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function _headerKey(value) {
  const raw = _deaccent(String(value || '').toLowerCase().trim());
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.map(a => _deaccent(a.toLowerCase())).includes(raw)) return key;
  }
  return '';
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
  a.download = `unidades-${new Date().toISOString().slice(0, 10)}.csv`;
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
    if (f.clase && !_includes(row.clase || row.categoria, f.clase)) return false;
    if (f.sucursal && !_includes(row.sucursal || row.plaza, f.sucursal)) return false;
    if (f.plazaActual && !_includes(row.plazaActual || row.ubicacionActual, f.plazaActual)) return false;
    if (f.estado && !_includes(row.estado || row.estatus, f.estado)) return false;
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

function _fieldInput(key, row, required = false) {
  return `<label><span>${esc(FIELD_LABEL[key])}${required ? ' *' : ''}</span><input name="${esc(key)}" value="${esc(_field(row || {}, key))}" ${required ? 'required' : ''}></label>`;
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
      <div class="uni-denied uni-detail">
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
