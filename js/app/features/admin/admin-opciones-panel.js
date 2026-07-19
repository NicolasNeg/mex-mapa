/**
 * OPCIONES — índice de catálogo + editor full por ruta.
 * /app/admin/{sección} | /app/admin/{sección}/{id}|nuevo
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
  categoryOptions
} from '/js/app/features/admin/admin-opciones-data.js';
import { adminSectionPath, adminSectionLabel } from '/js/app/features/admin/admin-nav.js';

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

let _host = null;
let _navigate = null;
let _section = 'estados';
let _entityId = '';
let _query = '';
let _editing = false;

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

function _isNew() {
  return String(_entityId || '').toUpperCase() === 'NUEVO';
}

function _metaChip(row) {
  const raw = row.raw;
  if (_section === 'estados' && raw && typeof raw === 'object') {
    return `<span class="adm-swatch" style="background:${esc(raw.color || '#64748b')}"></span>${esc(raw.color || '')}`;
  }
  if (_section === 'modelos' && raw && typeof raw === 'object') {
    return esc(raw.categoria || 'Sin categoría');
  }
  if (_section === 'motivos_traslado' && raw && typeof raw === 'object') {
    return esc(raw.activo === false ? 'Inactivo' : 'Activo');
  }
  if (_section === 'categorias' && raw && typeof raw === 'object') {
    const d = String(raw.descripcion || '').trim();
    return esc(d ? d.slice(0, 48) : `Orden ${row.orden}`);
  }
  return esc(`Orden ${row.orden}`);
}

function _indexHtml() {
  const label = adminSectionLabel(_section) || _section;
  const canEdit = _canEdit();
  const list = getCatalogList(_section).filter(row => {
    const q = _query.trim().toLowerCase();
    if (!q) return true;
    return row.name.toLowerCase().includes(q) || String(row.key).toLowerCase().includes(q);
  });

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
            <button type="button" class="adm-btn primary" data-action="new-item">
              <span class="material-symbols-outlined" style="font-size:18px;">add</span>
              Agregar
            </button>` : ''}
        </div>
      </div>
      <div class="adm-listas-toolbar">
        <label class="adm-search">
          <span class="material-symbols-outlined">search</span>
          <input type="search" id="adm-op-search" placeholder="Buscar en ${esc(label.toLowerCase())}…" value="${esc(_query)}">
        </label>
      </div>
      <div class="adm-opciones-list">
        ${list.length ? list.map(row => `
          <button type="button" class="adm-op-row" data-entity-id="${esc(row.key)}">
            <span class="adm-op-row-main">
              <strong>${esc(row.name || 'Sin nombre')}</strong>
              <small>${_metaChip(row)}</small>
            </span>
            <span class="material-symbols-outlined adm-op-row-chevron">chevron_right</span>
          </button>
        `).join('') : `
          <div class="adm-empty">
            <span class="material-symbols-outlined">list_alt</span>
            <strong>Sin elementos</strong>
            <small>${canEdit ? 'Agrega el primero con el botón Agregar.' : 'No hay elementos en este módulo.'}</small>
          </div>`}
      </div>
    </div>
  `;
}

function _editorFormFields(fields, editing) {
  const ro = !editing;
  const cats = categoryOptions();

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
          : `<textarea name="descripcion" rows="4">${esc(fields.descripcion || '')}</textarea>`}
      </label>`;
  }

  if (_section === 'modelos') {
    return `
      <label>
        <span>Modelo</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.nombre || '—')}</div>`
          : `<input name="nombre" type="text" value="${esc(fields.nombre || '')}" placeholder="Ej: VERSA">`}
      </label>
      <label>
        <span>Categoría</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.categoria || 'Sin categoría')}</div>`
          : `<select name="categoria">
               <option value="">Sin categoría</option>
               ${cats.map(c => `<option value="${esc(c)}" ${String(fields.categoria || '').toUpperCase() === c.toUpperCase() ? 'selected' : ''}>${esc(c)}</option>`).join('')}
             </select>`}
      </label>
      <label>
        <span>Orden</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.orden || 1)}</div>`
          : `<input name="orden" type="number" min="1" max="999" value="${esc(fields.orden || 1)}">`}
      </label>
      <label class="adm-form-full">
        <span>URL de imagen</span>
        ${ro
          ? (fields.imagenURL
            ? `<div class="adm-field-value"><a class="adm-link" href="${esc(fields.imagenURL)}" target="_blank" rel="noopener">${esc(fields.imagenURL)}</a></div>`
            : `<div class="adm-field-value is-muted">Sin imagen</div>`)
          : `<input name="imagenURL" type="url" value="${esc(fields.imagenURL || '')}" placeholder="https://…">`}
      </label>`;
  }

  if (_section === 'gasolinas') {
    return `
      <label>
        <span>Nivel / nombre</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.nombre || '—')}</div>`
          : `<input name="nombre" type="text" value="${esc(fields.nombre || '')}" placeholder="Ej: 1/2">`}
      </label>
      <label>
        <span>Orden</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.orden || 1)}</div>`
          : `<input name="orden" type="number" min="1" max="999" value="${esc(fields.orden || 1)}">`}
      </label>`;
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
          : `<label class="adm-check"><input name="activo" type="checkbox" ${fields.activo === false ? '' : 'checked'}> Motivo activo</label>`}
      </label>
      <label class="adm-form-full">
        <span>Descripción</span>
        ${ro ? `<div class="adm-field-value">${esc(fields.descripcion || 'Sin descripción')}</div>`
          : `<textarea name="descripcion" rows="4">${esc(fields.descripcion || '')}</textarea>`}
      </label>`;
  }

  return '';
}

function _editorHtml() {
  const label = adminSectionLabel(_section) || _section;
  const canEdit = _canEdit();
  const isNew = _isNew();
  const row = isNew ? null : findCatalogItem(_section, _entityId);
  if (!isNew && !row) {
    return `
      <div class="adm-opciones">
        <button type="button" class="adm-btn ghost" data-action="back-list">
          <span class="material-symbols-outlined" style="font-size:18px;">arrow_back</span>
          Volver
        </button>
        <div class="adm-empty adm-empty--panel">
          <span class="material-symbols-outlined">search_off</span>
          <strong>Elemento no encontrado</strong>
          <small>Regresa al listado e inténtalo de nuevo.</small>
        </div>
      </div>`;
  }

  const fields = isNew
    ? { nombre: '', orden: getCatalogList(_section).length + 1, color: '#64748b', activo: true, categoria: '', descripcion: '', codigo: '', imagenURL: '' }
    : editorFieldsFromItem(_section, row.raw);
  const editing = canEdit && (_editing || isNew);
  const title = isNew ? `Nuevo · ${label}` : (fields.nombre || label);

  return `
    <div class="adm-opciones adm-opciones--editor">
      <div class="adm-opciones-head">
        <div class="adm-opciones-title-row">
          <button type="button" class="adm-btn ghost" data-action="back-list" title="Volver al listado">
            <span class="material-symbols-outlined" style="font-size:18px;">arrow_back</span>
          </button>
          <div>
            <span class="adm-kicker">${esc(label)}</span>
            <h2>${esc(title)}</h2>
          </div>
        </div>
      </div>
      <form class="adm-form adm-opciones-form${editing ? '' : ' is-readonly'}" id="adm-op-form" onsubmit="return false;">
        ${_editorFormFields(fields, editing)}
        <div class="adm-form-actions">
          ${canEdit && !editing ? `
            <button type="button" class="adm-btn primary" data-action="edit-item">Editar</button>
            <button type="button" class="adm-btn danger" data-action="delete-item">Eliminar</button>
          ` : ''}
          ${canEdit && editing ? `
            ${!isNew ? `<button type="button" class="adm-btn ghost" data-action="cancel-edit">Cancelar</button>` : `
              <button type="button" class="adm-btn ghost" data-action="back-list">Cancelar</button>`}
            <button type="button" class="adm-btn primary" data-action="save-item">Guardar</button>
          ` : ''}
        </div>
      </form>
    </div>
  `;
}

function _paint() {
  if (!_host) return;
  const showEditor = Boolean(_entityId);
  _host.innerHTML = showEditor ? _editorHtml() : _indexHtml();
  _bind();
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

  _host.querySelectorAll('[data-entity-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-entity-id') || '';
      _entityId = id;
      _editing = false;
      _navigate?.(adminSectionPath(_section, id), { soft: true });
      _paint();
    });
  });

  _host.querySelector('[data-action="new-item"]')?.addEventListener('click', () => {
    if (!_canEdit()) return;
    _entityId = 'nuevo';
    _editing = true;
    _navigate?.(adminSectionPath(_section, 'nuevo'), { soft: true });
    _paint();
  });

  _host.querySelector('[data-action="back-list"]')?.addEventListener('click', () => {
    _entityId = '';
    _editing = false;
    _navigate?.(adminSectionPath(_section), { soft: true });
    _paint();
  });

  _host.querySelector('[data-action="edit-item"]')?.addEventListener('click', () => {
    if (!_canEdit()) return;
    _editing = true;
    _paint();
  });

  _host.querySelector('[data-action="cancel-edit"]')?.addEventListener('click', () => {
    _editing = false;
    _paint();
  });

  const color = _host.querySelector('input[name="color"]');
  const colorText = _host.querySelector('input[name="colorText"]');
  if (color && colorText) {
    color.addEventListener('input', () => { colorText.value = color.value; });
    colorText.addEventListener('input', () => {
      if (/^#[0-9a-fA-F]{6}$/.test(colorText.value)) color.value = colorText.value;
    });
  }

  _host.querySelector('[data-action="save-item"]')?.addEventListener('click', () => _save());
  _host.querySelector('[data-action="delete-item"]')?.addEventListener('click', () => _delete());
}

function _readFields() {
  const form = _host?.querySelector('#adm-op-form');
  if (!form) return {};
  const fd = new FormData(form);
  const color = String(fd.get('colorText') || fd.get('color') || '#64748b');
  return {
    nombre: String(fd.get('nombre') || ''),
    orden: String(fd.get('orden') || '1'),
    color,
    descripcion: String(fd.get('descripcion') || ''),
    categoria: String(fd.get('categoria') || ''),
    imagenURL: String(fd.get('imagenURL') || ''),
    codigo: String(fd.get('codigo') || ''),
    etiqueta: String(fd.get('nombre') || ''),
    activo: form.querySelector('[name="activo"]')?.checked !== false
  };
}

async function _save() {
  if (!_canEdit()) return;
  try {
    const key = await saveCatalogItem(
      _section,
      _entityId,
      _readFields(),
      _actor().email
    );
    _editing = false;
    _entityId = key;
    toast('Catálogo actualizado.', 'success');
    _navigate?.(adminSectionPath(_section, key), { replace: true, soft: true });
    _paint();
  } catch (err) {
    console.error('[admin-opciones] save:', err);
    toast(err?.message || 'No se pudo guardar.', 'error');
  }
}

async function _delete() {
  if (!_canEdit() || _isNew()) return;
  const row = findCatalogItem(_section, _entityId);
  const name = row?.name || _entityId;
  const ok = await _confirm(`Eliminar "${name}"`, '¿Estás seguro? Esta acción no se puede deshacer.', 'danger');
  if (!ok) return;
  try {
    await deleteCatalogItem(_section, _entityId, _actor().email);
    toast('Elemento eliminado.', 'success');
    _entityId = '';
    _editing = false;
    _navigate?.(adminSectionPath(_section), { soft: true });
    _paint();
  } catch (err) {
    console.error('[admin-opciones] delete:', err);
    toast(err?.message || 'No se pudo eliminar.', 'error');
  }
}

/**
 * @param {HTMLElement} host
 * @param {{ navigate?: Function, entityId?: string, section?: string }} opts
 */
export function mountOpcionesPanel(host, opts = {}) {
  unmountOpcionesPanel();
  _host = host;
  _navigate = opts.navigate || null;
  _section = String(opts.section || 'estados').toLowerCase();
  if (!OPCIONES_SECTIONS.has(_section)) _section = 'estados';
  _entityId = String(opts.entityId || '').trim();
  try { _entityId = _entityId ? decodeURIComponent(_entityId) : ''; } catch (_) { /* keep */ }
  _query = '';
  _editing = _isNew();
  _paint();
}

export function syncOpcionesSelection(entityId = '', section = '') {
  if (section && OPCIONES_SECTIONS.has(String(section).toLowerCase())) {
    const nextSec = String(section).toLowerCase();
    if (nextSec !== _section) {
      _section = nextSec;
      _query = '';
    }
  }
  let raw = String(entityId || '').trim();
  try { raw = raw ? decodeURIComponent(raw) : ''; } catch (_) { /* keep */ }
  if (raw !== _entityId) _editing = String(raw).toUpperCase() === 'NUEVO';
  _entityId = raw;
  _paint();
}

export function unmountOpcionesPanel() {
  _host = null;
  _navigate = null;
  _section = 'estados';
  _entityId = '';
  _query = '';
  _editing = false;
}