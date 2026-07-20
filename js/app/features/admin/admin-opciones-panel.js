/**
 * OPCIONES — catálogos con acordeón (un panel abierto a la vez).
 */
import { getState } from '/js/app/app-state.js';
import {
  OPCIONES_SECTIONS,
  canEditOpciones,
  getCatalogList,
  findCatalogItem,
  saveCatalogItem,
  deleteCatalogItem,
  editorFieldsFromItem,
  categoryOptions,
  plazaOptionsForUbicaciones,
  uploadModelImage
} from '/js/app/features/admin/admin-opciones-data.js';
import { adminSectionLabel } from '/js/app/features/admin/admin-nav.js';
import { _gasToPercent, _gasBarFillColor } from '/mapa/features/core/utils.js';
import { admRibbonSelectHtml, admBindRibbonRoot, admCloseAllRibbons } from '/js/app/features/admin/admin-ribbon-ui.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(msg, type = 'info') {
  if (typeof window.showToast === 'function') window.showToast(msg, type);
  else console.log(msg);
}

function _confirm(title, text, tipo = 'danger') {
  if (typeof window.mexConfirm === 'function') return window.mexConfirm(title, text, tipo);
  return Promise.resolve(window.confirm(`${title}\n\n${text}`));
}

const NEW_KEY = '__nuevo__';

let _host = null;
let _section = 'estados';
let _query = '';
/** Clave del acordeón abierto (NEW_KEY = alta). */
let _openKey = '';
/** Modo edición dentro del acordeón abierto. */
let _editing = false;
/** Vista previa local de imagen de modelo. */
let _modelPreviewUrl = '';
let _modelPendingFile = null;

function _actor() {
  const st = getState() || {};
  const profile = st.profile || window.__mexCurrentUserRecord || {};
  const role = String(st.role || profile.rol || profile.role || '').toUpperCase();
  const email = String(st.email || profile.email || window._auth?.currentUser?.email || '').toLowerCase();
  return { profile, role, email };
}

function _canEdit() {
  const { profile, role } = _actor();
  return canEditOpciones(profile, role);
}

function _isOpen(key) {
  return _openKey === key;
}

function _gasLevelLabel(raw) {
  if (raw == null) return '';
  if (typeof raw === 'object') {
    return String(raw.nombre || raw.valor || raw.id || '').trim();
  }
  return String(raw).trim();
}

function _gasProgressHtml(label, { compact = false } = {}) {
  const name = String(label || '').trim();
  const pct = _gasToPercent(name);
  const color = _gasBarFillColor(pct);
  const widthClass = compact ? ' adm-gas-bar--compact' : '';
  const na = !name || /^N\/A$|^NA$|^-$/i.test(name);
  return `
    <span class="adm-gas-bar${widthClass}" title="${esc(name || 'Sin nivel')} · ${pct}%">
      <span class="adm-gas-bar-track">
        <span class="adm-gas-bar-fill" style="width:${na ? 0 : pct}%;background:${na ? '#94a3b8' : color}"></span>
      </span>
      <span class="adm-gas-bar-pct">${na ? 'N/A' : `${pct}%`}</span>
    </span>`;
}

function _metaChip(row) {
  const raw = row.raw;
  if (_section === 'estados' && raw && typeof raw === 'object') {
    return `<span class="adm-swatch" style="background:${esc(raw.color || '#64748b')}"></span>${esc(raw.color || '')}`;
  }
  if (_section === 'modelos' && raw && typeof raw === 'object') {
    return esc(raw.categoria || 'Sin categoría');
  }
  if (_section === 'ubicaciones' && raw && typeof raw === 'object') {
    return esc(`${raw.plazaId || 'ALL'} · ${raw.isPlazaFija ? 'Plaza fija' : 'Móvil'}`);
  }
  if (_section === 'motivos_traslado' && raw && typeof raw === 'object') {
    return esc(raw.activo === false ? 'Inactivo' : 'Activo');
  }
  if (_section === 'categorias' && raw && typeof raw === 'object') {
    const d = String(raw.descripcion || '').trim();
    return esc(d ? d.slice(0, 48) : `Orden ${row.orden}`);
  }
  if (_section === 'gasolinas') {
    return _gasProgressHtml(_gasLevelLabel(raw), { compact: true });
  }
  return esc(`Orden ${row.orden}`);
}

function _modelPreviewSrc(fields) {
  if (_modelPreviewUrl) return _modelPreviewUrl;
  return String(fields.imagenURL || '').trim();
}

function _editorFormFields(fields, editing, rowKey) {
  const ro = !editing;
  const cats = categoryOptions();
  const plazas = plazaOptionsForUbicaciones();

  if (_section === 'estados') {
    return `
      <label>
        <span>Clave del estado</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.nombre || '—')}</div>`
          : `<input name="nombre" type="text" value="${esc(fields.nombre || '')}" placeholder="Ej: LISTO">`}
      </label>
      <label>
        <span>Color</span>
        ${ro
          ? `<div class="adm-field-value"><span class="adm-swatch" style="background:${esc(fields.color || '#64748b')}"></span> ${esc(fields.color || '')}</div>`
          : `<div class="adm-color-row">
               <input name="color" type="color" value="${esc(fields.color || '#64748b')}">
               <input name="colorText" type="text" value="${esc(fields.color || '#64748b')}" placeholder="#64748B">
             </div>`}
      </label>
      <label>
        <span>Orden</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.orden || 1)}</div>`
          : `<input name="orden" type="number" min="1" max="999" value="${esc(fields.orden || 1)}">`}
      </label>`;
  }

  if (_section === 'categorias') {
    return `
      <label>
        <span>Categoría</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.nombre || '—')}</div>`
          : `<input name="nombre" type="text" value="${esc(fields.nombre || '')}" placeholder="Ej: ICAR">`}
      </label>
      <label>
        <span>Orden</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.orden || 1)}</div>`
          : `<input name="orden" type="number" min="1" max="999" value="${esc(fields.orden || 1)}">`}
      </label>
      <label class="adm-form-full">
        <span>Descripción</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.descripcion || 'Sin descripción')}</div>`
          : `<textarea name="descripcion" rows="3">${esc(fields.descripcion || '')}</textarea>`}
      </label>`;
  }

  if (_section === 'modelos') {
    const preview = _modelPreviewSrc(fields);
    return `
      <label>
        <span>Modelo</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.nombre || '—')}</div>`
          : `<input name="nombre" type="text" value="${esc(fields.nombre || '')}" placeholder="Ej: VERSA">`}
      </label>
      <label>
        <span>Categoría</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.categoria || 'Sin categoría')}</div>`
          : admRibbonSelectHtml({
            id: `adm-op-cat-${rowKey}`,
            name: 'categoria',
            value: String(fields.categoria || ''),
            placeholder: 'Sin categoría',
            options: [{ value: '', label: 'Sin categoría' }, ...cats.map(c => ({ value: c, label: c }))]
          })}
      </label>
      <label>
        <span>Orden</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.orden || 1)}</div>`
          : `<input name="orden" type="number" min="1" max="999" value="${esc(fields.orden || 1)}">`}
      </label>
      <div class="adm-form-full adm-model-media">
        <span class="adm-label-block">Imagen del modelo</span>
        <div class="adm-model-preview${preview ? '' : ' is-empty'}" data-preview-key="${esc(rowKey)}">
          ${preview
            ? `<img src="${esc(preview)}" alt="" class="adm-model-preview-img">`
            : `<span class="material-symbols-outlined">image</span><small>Sin imagen</small>`}
        </div>
        ${editing ? `
          <label class="adm-file-minimal">
            <input name="modeloFile" type="file" accept="image/*" data-action="model-file">
            <span>Seleccionar imagen desde tu PC</span>
          </label>
          <small class="adm-hint">No se aceptan enlaces; solo archivos de imagen.</small>
        ` : (preview ? '' : `<div class="adm-field-value is-muted">Sin imagen cargada</div>`)}
      </div>`;
  }

  if (_section === 'gasolinas') {
    const previewLabel = String(fields.nombre || '').trim() || 'Ej: 3/4';
    const preview = _gasProgressHtml(previewLabel);
    return `
      <label>
        <span>Nivel visible</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.nombre || '—')}</div>`
          : `<input name="nombre" type="text" value="${esc(fields.nombre || '')}" placeholder="Ej: 3/4, F, 7/8" data-gas-preview-input>`}
      </label>
      <div class="adm-form-full adm-gas-preview-wrap">
        <span class="adm-label-block">Vista en mapa y cuadre</span>
        <div class="adm-gas-preview-host" data-gas-preview-host>${preview}</div>
        <small class="adm-hint">F = lleno, H = medio, E = vacío; fracciones como 7/8 o 15/16.</small>
      </div>`;
  }

  if (_section === 'motivos_traslado') {
    return `
      <label>
        <span>Motivo</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.nombre || '—')}</div>`
          : `<input name="nombre" type="text" value="${esc(fields.nombre || '')}" placeholder="Ej: SERVICIO">`}
      </label>
      <label>
        <span>Código</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.codigo || '—')}</div>`
          : `<input name="codigo" type="text" value="${esc(fields.codigo || '')}" placeholder="Opcional">`}
      </label>
      <label>
        <span>Orden</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.orden || 1)}</div>`
          : `<input name="orden" type="number" min="1" max="999" value="${esc(fields.orden || 1)}">`}
      </label>
      <label>
        <span>Estado</span>
        ${ro
          ? `<div class="adm-field-value">${fields.activo === false ? 'Inactivo' : 'Activo'}</div>`
          : admRibbonSelectHtml({
            id: `adm-op-activo-${rowKey}`,
            name: 'activo',
            value: fields.activo !== false ? 'true' : 'false',
            placeholder: 'Estado',
            options: [
              { value: 'true', label: 'Activo' },
              { value: 'false', label: 'Inactivo' }
            ]
          })}
      </label>
      <label class="adm-form-full">
        <span>Descripción</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.descripcion || 'Sin descripción')}</div>`
          : `<textarea name="descripcion" rows="3">${esc(fields.descripcion || '')}</textarea>`}
      </label>`;
  }

  if (_section === 'ubicaciones') {
    return `
      <label>
        <span>Nombre visible</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.nombre || '—')}</div>`
          : `<input name="nombre" type="text" value="${esc(fields.nombre || '')}" placeholder="Ej: PATIO">`}
      </label>
      <label>
        <span>Plaza visible</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.plazaId || 'ALL')}</div>`
          : admRibbonSelectHtml({
            id: `adm-op-plaza-${rowKey}`,
            name: 'plazaId',
            value: String(fields.plazaId || 'ALL').toUpperCase(),
            placeholder: 'Plaza',
            options: plazas.map(p => ({
              value: p,
              label: p === 'ALL' ? 'Todas las plazas' : p
            }))
          })}
      </label>
      <label>
        <span>Orden</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.orden || 1)}</div>`
          : `<input name="orden" type="number" min="1" max="999" value="${esc(fields.orden || 1)}">`}
      </label>
      <label>
        <span>Plaza fija</span>
        ${ro
          ? `<div class="adm-field-value">${fields.isPlazaFija ? 'Sí' : 'No'}</div>`
          : `<label class="adm-check"><input name="isPlazaFija" type="checkbox" ${fields.isPlazaFija ? 'checked' : ''}> Es plaza fija</label>`}
      </label>`;
  }

  return '';
}

function _fieldsForKey(key) {
  if (key === NEW_KEY) {
    return {
      nombre: '',
      orden: getCatalogList(_section).length + 1,
      color: '#64748b',
      activo: true,
      categoria: '',
      descripcion: '',
      codigo: '',
      imagenURL: '',
      plazaId: 'ALL',
      isPlazaFija: false
    };
  }
  const row = findCatalogItem(_section, key);
  if (!row) return null;
  return editorFieldsFromItem(_section, row.raw);
}

function _accordionBodyHtml(key) {
  const fields = _fieldsForKey(key);
  if (!fields) {
    return `<div class="adm-empty adm-empty--compact"><small>Elemento no encontrado.</small></div>`;
  }
  const canEdit = _canEdit();
  const isNew = key === NEW_KEY;
  const editing = canEdit && (_editing || isNew);
  const title = isNew ? 'Nuevo elemento' : (fields.nombre || key);

  return `
    <form class="adm-form adm-op-acc-form${editing ? '' : ' is-readonly'}" data-form-key="${esc(key)}" onsubmit="return false;">
      ${_editorFormFields(fields, editing, key)}
      <div class="adm-form-actions">
        ${canEdit && !editing ? `
          <button type="button" class="adm-btn primary" data-action="edit-item" data-item-key="${esc(key)}">Editar</button>
          ${!isNew ? `<button type="button" class="adm-btn ghost" data-action="delete-item" data-item-key="${esc(key)}">Eliminar</button>` : ''}
        ` : ''}
        ${canEdit && editing ? `
          ${!isNew ? `<button type="button" class="adm-btn ghost" data-action="cancel-edit" data-item-key="${esc(key)}">Cancelar</button>` : `
            <button type="button" class="adm-btn ghost" data-action="close-acc">Descartar</button>`}
          <button type="button" class="adm-btn primary" data-action="save-item" data-item-key="${esc(key)}">Guardar</button>
        ` : ''}
      </div>
    </form>`;
}

function _paintHtml() {
  const label = adminSectionLabel(_section) || _section;
  const canEdit = _canEdit();
  const list = getCatalogList(_section).filter(row => {
    const q = _query.trim().toLowerCase();
    if (!q) return true;
    return row.name.toLowerCase().includes(q) || String(row.key).toLowerCase().includes(q);
  });

  const rowsHtml = list.map(row => {
    const open = _isOpen(row.key);
    return `
      <div class="adm-op-acc${open ? ' is-open' : ''}" data-acc-key="${esc(row.key)}">
        <button type="button" class="adm-op-acc-head" data-toggle-key="${esc(row.key)}" aria-expanded="${open ? 'true' : 'false'}">
          <span class="adm-op-row-main">
            <strong>${esc(row.name || 'Sin nombre')}</strong>
            <small>${_metaChip(row)}</small>
          </span>
          <span class="material-symbols-outlined adm-op-acc-chevron">${open ? 'expand_less' : 'expand_more'}</span>
        </button>
        <div class="adm-op-acc-body"${open ? '' : ' hidden'}>
          ${open ? _accordionBodyHtml(row.key) : ''}
        </div>
      </div>`;
  }).join('');

  const newOpen = _isOpen(NEW_KEY);
  const newBlock = newOpen ? `
    <div class="adm-op-acc is-open is-new" data-acc-key="${NEW_KEY}">
      <button type="button" class="adm-op-acc-head" data-toggle-key="${NEW_KEY}" aria-expanded="true">
        <span class="adm-op-row-main"><strong>Nuevo elemento</strong></span>
        <span class="material-symbols-outlined adm-op-acc-chevron">expand_less</span>
      </button>
      <div class="adm-op-acc-body">
        ${_accordionBodyHtml(NEW_KEY)}
      </div>
    </div>` : '';

  return `
    <div class="adm-opciones">
      <div class="adm-opciones-head">
        <div>
          <span class="adm-kicker">Catálogo</span>
          <h2>${esc(label)}</h2>
        </div>
        <div class="adm-opciones-head-actions">
          <span class="adm-count">${list.length} elementos</span>
          ${canEdit ? `
            <button type="button" class="adm-btn-add-minimal" data-action="new-item" title="Agregar">
              <span class="material-symbols-outlined">add</span>
            </button>` : ''}
        </div>
      </div>
      <div class="adm-listas-toolbar">
        <label class="adm-search">
          <span class="material-symbols-outlined">search</span>
          <input type="search" id="adm-op-search" placeholder="Buscar en ${esc(label.toLowerCase())}…" value="${esc(_query)}">
        </label>
      </div>
      <div class="adm-op-acc-list">
        ${newBlock}
        ${rowsHtml || (!newOpen ? `
          <div class="adm-empty">
            <span class="material-symbols-outlined">list_alt</span>
            <strong>Sin elementos</strong>
            <small>${canEdit ? 'Usa + para agregar el primero.' : 'No hay elementos en este módulo.'}</small>
          </div>` : '')}
      </div>
    </div>
  `;
}

function _paint() {
  if (!_host) return;
  _host.innerHTML = _paintHtml();
  _bind();
}

function _toggleKey(key) {
  if (_openKey === key) {
    _openKey = '';
    _editing = false;
    _clearModelPreview();
    return;
  }
  _openKey = key;
  _editing = key === NEW_KEY;
  _clearModelPreview();
}

function _clearModelPreview() {
  if (_modelPreviewUrl && _modelPreviewUrl.startsWith('blob:')) {
    try { URL.revokeObjectURL(_modelPreviewUrl); } catch (_) { /* ignore */ }
  }
  _modelPreviewUrl = '';
  _modelPendingFile = null;
}

function _bind() {
  _host.querySelector('#adm-op-search')?.addEventListener('input', (e) => {
    _query = e.target.value || '';
    _paint();
    const input = _host.querySelector('#adm-op-search');
    if (input) {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  });

  _host.querySelectorAll('[data-toggle-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      admCloseAllRibbons(_host);
      _toggleKey(btn.getAttribute('data-toggle-key') || '');
      _paint();
    });
  });

  _host.querySelector('[data-action="new-item"]')?.addEventListener('click', () => {
    if (!_canEdit()) return;
    _openKey = NEW_KEY;
    _editing = true;
    _clearModelPreview();
    _paint();
  });

  _host.querySelector('[data-action="close-acc"]')?.addEventListener('click', () => {
    _openKey = '';
    _editing = false;
    _clearModelPreview();
    _paint();
  });

  _host.querySelectorAll('[data-action="edit-item"]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_canEdit()) return;
      _openKey = btn.getAttribute('data-item-key') || _openKey;
      _editing = true;
      _paint();
    });
  });

  _host.querySelectorAll('[data-action="cancel-edit"]').forEach(btn => {
    btn.addEventListener('click', () => {
      _editing = false;
      _clearModelPreview();
      _paint();
    });
  });

  const color = _host.querySelector('input[name="color"]');
  const colorText = _host.querySelector('input[name="colorText"]');
  if (color && colorText) {
    color.addEventListener('input', () => { colorText.value = color.value; });
    colorText.addEventListener('input', () => {
      if (/^#[0-9a-fA-F]{6}$/.test(colorText.value)) color.value = colorText.value;
    });
  }

  _host.querySelector('[data-gas-preview-input]')?.addEventListener('input', (e) => {
    const host = _host.querySelector('[data-gas-preview-host]');
    if (!host) return;
    host.innerHTML = _gasProgressHtml(e.target.value || '');
  });

  _host.querySelector('[data-action="model-file"]')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0] || null;
    _modelPendingFile = file;
    if (_modelPreviewUrl && _modelPreviewUrl.startsWith('blob:')) {
      try { URL.revokeObjectURL(_modelPreviewUrl); } catch (_) { /* ignore */ }
    }
    if (file && file.type.startsWith('image/')) {
      _modelPreviewUrl = URL.createObjectURL(file);
      const box = _host.querySelector('.adm-model-preview');
      if (box) {
        box.classList.remove('is-empty');
        box.innerHTML = `<img src="${esc(_modelPreviewUrl)}" alt="" class="adm-model-preview-img">`;
      }
    }
  });

  _host.querySelectorAll('[data-action="save-item"]').forEach(btn => {
    btn.addEventListener('click', () => _save(btn.getAttribute('data-item-key') || ''));
  });
  _host.querySelectorAll('[data-action="delete-item"]').forEach(btn => {
    btn.addEventListener('click', () => _delete(btn.getAttribute('data-item-key') || ''));
  });
}

function _readFields(form, itemKey = '') {
  if (!form) return {};
  const fd = new FormData(form);
  const color = String(fd.get('colorText') || fd.get('color') || '#64748b');
  const fields = {
    nombre: String(fd.get('nombre') || ''),
    orden: String(fd.get('orden') || '1'),
    color,
    descripcion: String(fd.get('descripcion') || ''),
    categoria: String(fd.get('categoria') || ''),
    codigo: String(fd.get('codigo') || ''),
    etiqueta: String(fd.get('nombre') || ''),
    activo: String(fd.get('activo') || 'true') !== 'false',,
    plazaId: String(fd.get('plazaId') || 'ALL'),
    isPlazaFija: form.querySelector('[name="isPlazaFija"]')?.checked === true,
    imagenURL: ''
  };
  if (_section === 'gasolinas' && itemKey && itemKey !== NEW_KEY) {
    const row = findCatalogItem(_section, itemKey);
    if (row) fields.orden = String(row.orden);
  }
  return fields;
}

async function _save(itemKey) {
  if (!_canEdit()) return;
  const acc = _host?.querySelector(`.adm-op-acc[data-acc-key="${itemKey}"]`);
  const form = acc?.querySelector('form');
  if (!form) return;
  const fields = _readFields(form, itemKey);
  const entityId = itemKey === NEW_KEY ? 'nuevo' : itemKey;

  try {
    if (_section === 'modelos') {
      if (_modelPendingFile) {
        fields.imagenURL = await uploadModelImage(_modelPendingFile);
      } else if (itemKey !== NEW_KEY) {
        const prev = editorFieldsFromItem(_section, findCatalogItem(_section, itemKey)?.raw);
        fields.imagenURL = String(prev?.imagenURL || '');
      }
    }
    const key = await saveCatalogItem(_section, entityId, fields, _actor().email);
    _editing = false;
    _openKey = key;
    _clearModelPreview();
    toast('Catálogo actualizado.', 'success');
    _paint();
  } catch (err) {
    console.error('[admin-opciones] save:', err);
    toast(err?.message || 'No se pudo guardar.', 'error');
  }
}

async function _delete(itemKey) {
  if (!_canEdit() || !itemKey || itemKey === NEW_KEY) return;
  const row = findCatalogItem(_section, itemKey);
  const name = row?.name || itemKey;
  const ok = await _confirm(`Eliminar "${name}"`, '¿Estás seguro? Esta acción no se puede deshacer.', 'danger');
  if (!ok) return;
  try {
    await deleteCatalogItem(_section, itemKey, _actor().email);
    toast('Elemento eliminado.', 'success');
    _openKey = '';
    _editing = false;
    _clearModelPreview();
    _paint();
  } catch (err) {
    console.error('[admin-opciones] delete:', err);
    toast(err?.message || 'No se pudo eliminar.', 'error');
  }
}

/**
 * @param {HTMLElement} host
 * @param {{ section?: string }} opts
 */
export function mountOpcionesPanel(host, opts = {}) {
  unmountOpcionesPanel();
  _host = host;
  _section = String(opts.section || 'estados').toLowerCase();
  if (!OPCIONES_SECTIONS.has(_section)) _section = 'estados';
  _query = '';
  _openKey = '';
  _editing = false;
  _clearModelPreview();
  admBindRibbonRoot(_host);
  _paint();
}

export function syncOpcionesSelection(_entityId = '', section = '') {
  if (section && OPCIONES_SECTIONS.has(String(section).toLowerCase())) {
    const nextSec = String(section).toLowerCase();
    if (nextSec !== _section) {
      _section = nextSec;
      _query = '';
      _openKey = '';
      _editing = false;
      _clearModelPreview();
    }
  }
  _paint();
}

export function unmountOpcionesPanel() {
  _clearModelPreview();
  if (_host) delete _host.dataset.admRibbonBound;
  _host = null;
  _section = 'estados';
  _query = '';
  _openKey = '';
  _editing = false;
}
