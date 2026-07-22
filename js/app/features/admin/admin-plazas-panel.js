/**
 * Panel SPA — Plazas (catálogo de sucursales/branches).
 */
import { getState } from '/js/app/app-state.js';
import { adminSectionPath } from '/js/app/features/admin/admin-nav.js';
import { validarPlazaKey, normalizarPlazaKey } from '/domain/plaza.model.js';
import {
  canEditPlazas,
  getPlazasSnapshot,
  getPlazaDetalle,
  getCorreoOptions,
  crearPlaza,
  guardarPlaza,
  eliminarPlaza
} from '/js/app/features/admin/admin-plazas-data.js';

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
let _selectedId = '';
let _query = '';
let _editing = false;
let _creating = false;

function _actor() {
  const st = getState() || {};
  const profile = st.profile || window.__mexCurrentUserRecord || {};
  const role = String(st.role || profile.rol || profile.role || '').toUpperCase();
  return { profile, role };
}

function _canEdit() {
  const { profile, role } = _actor();
  return canEditPlazas(profile, role);
}

function _filtered() {
  const q = _query.trim().toLowerCase();
  const list = getPlazasSnapshot();
  if (!q) return list;
  return list.filter(p =>
    p.id.toLowerCase().includes(q)
    || String(p.nombre || '').toLowerCase().includes(q)
    || String(p.localidad || '').toLowerCase().includes(q)
  );
}

function _selected() {
  if (!_selectedId) return null;
  return getPlazaDetalle(_selectedId);
}

function _correoSelectHtml(id, name, options) {
  const opts = options.map(o => `<option value="${esc(o.value)}"${o.selected ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  return `<select id="${esc(id)}" name="${esc(name)}"><option value="">— Sin asignar —</option>${opts}</select>`;
}

function _contactsHtml(contactos, editing) {
  if (!contactos.length && !editing) {
    return '<div class="adm-field-value is-muted">Sin contactos registrados</div>';
  }
  const rows = contactos.map((c, i) => `
    <div class="adm-plaza-contact-row" data-contact-idx="${i}">
      <input type="text" data-field="nombre" value="${esc(c.nombre)}" placeholder="Nombre" ${editing ? '' : 'disabled'}>
      <input type="text" data-field="rol" value="${esc(c.rol)}" placeholder="Puesto/Rol" ${editing ? '' : 'disabled'}>
      <input type="tel" data-field="telefono" value="${esc(c.telefono)}" placeholder="Teléfono" ${editing ? '' : 'disabled'}>
      ${editing ? `<button type="button" class="adm-btn ghost" data-action="remove-contact" data-idx="${i}"><span class="material-symbols-outlined">delete_outline</span></button>` : '<span></span>'}
    </div>`).join('');
  return `<div class="adm-plaza-contacts" id="adm-plaza-contacts-list">${rows}</div>`;
}

function _detailHtml(plaza, canEdit) {
  const editing = canEdit && _editing;
  const mapsEmbedUrl = plaza.mapsUrl ? `https://maps.google.com/maps?q=${encodeURIComponent(plaza.mapsUrl)}&output=embed` : '';
  const correoOptions = getCorreoOptions(plaza.correo || '', plaza.id, 'correo', plaza);
  const correoGerenteOptions = getCorreoOptions(plaza.correoGerente || '', plaza.id, 'correoGerente', plaza);

  return `
    <div class="adm-detail">
      <div class="adm-detail-hero">
        <span class="adm-avatar adm-avatar--lg" style="background:${plaza.temporal ? '#f59e0b' : '#3b82f6'};color:#fff;">${esc(plaza.id.slice(0, 3))}</span>
        <div>
          <h3>${esc(plaza.nombre || plaza.id)}</h3>
          <p>${esc(plaza.descripcion || plaza.localidad || 'Sin descripción')}</p>
          <div class="adm-pills">
            <span class="adm-pill">${esc(plaza.id)}</span>
            ${plaza.temporal ? '<span class="adm-pill">Temporal</span>' : ''}
          </div>
        </div>
      </div>
      <form class="adm-form${editing ? '' : ' is-readonly'}" id="adm-plaza-form" onsubmit="return false;">
        <label class="adm-form-full" style="display:flex;align-items:center;gap:10px;">
          <button type="button" class="adm-plaza-toggle${plaza.temporal ? ' is-on' : ''}" data-action="toggle-temporal" ${editing ? '' : 'disabled'}></button>
          <span>Plaza temporal (resguardo externo / bodega)</span>
        </label>
        <label>
          <span>Nombre oficial</span>
          ${editing ? `<input name="nombre" type="text" value="${esc(plaza.nombre)}">` : `<div class="adm-field-value">${esc(plaza.nombre || '—')}</div>`}
        </label>
        <label>
          <span>Descripción</span>
          ${editing ? `<input name="descripcion" type="text" value="${esc(plaza.descripcion)}">` : `<div class="adm-field-value">${esc(plaza.descripcion || '—')}</div>`}
        </label>
        <label>
          <span>Localidad</span>
          ${editing ? `<input name="localidad" type="text" value="${esc(plaza.localidad)}">` : `<div class="adm-field-value">${esc(plaza.localidad || '—')}</div>`}
        </label>
        <label>
          <span>Dirección completa</span>
          ${editing ? `<input name="direccion" type="text" value="${esc(plaza.direccion)}">` : `<div class="adm-field-value">${esc(plaza.direccion || '—')}</div>`}
        </label>
        <label class="adm-form-full">
          <span>Dirección o coordenadas para Google Maps</span>
          ${editing ? `<input name="mapsUrl" type="text" id="adm-plaza-maps-url" value="${esc(plaza.mapsUrl)}" placeholder="Ej: 29.0924,-110.9600 o nombre del lugar">` : `<div class="adm-field-value">${esc(plaza.mapsUrl || '—')}</div>`}
        </label>
        ${mapsEmbedUrl ? `<div class="adm-plaza-maps-preview adm-form-full"><iframe src="${esc(mapsEmbedUrl)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>` : ''}
        <label>
          <span>Correo institucional</span>
          ${editing ? _correoSelectHtml('adm-plaza-correo', 'correo', correoOptions) : `<div class="adm-field-value">${esc(plaza.correo || '—')}</div>`}
        </label>
        <label>
          <span>Teléfono directo</span>
          ${editing ? `<input name="telefono" type="tel" value="${esc(plaza.telefono)}">` : `<div class="adm-field-value">${esc(plaza.telefono || '—')}</div>`}
        </label>
        <label>
          <span>Gerente de plaza</span>
          ${editing ? `<input name="gerente" type="text" value="${esc(plaza.gerente)}">` : `<div class="adm-field-value">${esc(plaza.gerente || '—')}</div>`}
        </label>
        <label>
          <span>Correo del gerente</span>
          ${editing ? _correoSelectHtml('adm-plaza-correo-gerente', 'correoGerente', correoGerenteOptions) : `<div class="adm-field-value">${esc(plaza.correoGerente || '—')}</div>`}
        </label>
        <div class="adm-form-full">
          <span class="adm-label-block">Contactos</span>
          ${_contactsHtml(plaza.contactos || [], editing)}
          ${editing ? '<button type="button" class="adm-btn ghost" data-action="add-contact" style="margin-top:8px;"><span class="material-symbols-outlined">person_add</span> Agregar contacto</button>' : ''}
        </div>
        <div class="adm-form-actions">
          ${canEdit && !editing ? '<button type="button" class="adm-btn primary" data-action="edit-plaza">Editar</button>' : ''}
          ${canEdit && editing ? `
            <button type="button" class="adm-btn ghost" data-action="cancel-edit-plaza">Cancelar</button>
            <button type="button" class="adm-btn primary" data-action="save-plaza">Guardar</button>
          ` : ''}
        </div>
      </form>
      ${canEdit && !editing ? `
        <section class="adm-subsection">
          <div class="adm-subsection-head"><h4>Zona de peligro</h4></div>
          <button type="button" class="adm-btn danger" data-action="delete-plaza">Eliminar plaza</button>
        </section>` : ''}
    </div>`;
}

function _creatingHtml() {
  return `
    <div class="adm-detail">
      <div class="adm-detail-hero">
        <span class="adm-avatar adm-avatar--lg" style="background:#3b82f6;color:#fff;">
          <span class="material-symbols-outlined">add_location_alt</span>
        </span>
        <div><h3>Nueva plaza</h3><p>Elige una clave corta (ej. GDL, BJX)</p></div>
      </div>
      <form class="adm-form" id="adm-plaza-new-form" onsubmit="return false;">
        <label>
          <span>Clave</span>
          <input name="key" type="text" id="adm-plaza-new-key" placeholder="Ej: GDL" maxlength="12" style="text-transform:uppercase;">
        </label>
        <label>
          <span>Nombre oficial</span>
          <input name="nombre" type="text" placeholder="Ej: Guadalajara Centro">
        </label>
        <label class="adm-form-full">
          <span>Descripción</span>
          <input name="descripcion" type="text" placeholder="Ej: Sucursal principal">
        </label>
        <div class="adm-form-actions">
          <button type="button" class="adm-btn ghost" data-action="cancel-new-plaza">Cancelar</button>
          <button type="button" class="adm-btn primary" data-action="confirm-new-plaza">Crear plaza</button>
        </div>
      </form>
    </div>`;
}

function _paint() {
  if (!_host) return;
  const list = _filtered();
  const plaza = _creating ? null : _selected();
  const canEdit = _canEdit();

  _host.innerHTML = `
    <div class="adm-listas">
      <div class="adm-listas-dir">
        <div class="adm-listas-head">
          <div><span class="adm-kicker">Estructura</span><h2>Plazas</h2></div>
          <span class="adm-count">${list.length} plazas</span>
        </div>
        <div class="adm-listas-toolbar">
          <label class="adm-search">
            <span class="material-symbols-outlined">search</span>
            <input type="search" id="adm-plaza-search" placeholder="Buscar clave, nombre o localidad…" value="${esc(_query)}">
          </label>
          ${canEdit ? '<button type="button" class="adm-btn primary" data-action="new-plaza"><span class="material-symbols-outlined">add</span> Nueva</button>' : ''}
        </div>
        <div class="adm-cards" id="adm-plaza-cards">
          ${list.length ? list.map(p => {
            const active = (!_creating && _selectedId && normalizarPlazaKey(_selectedId) === p.id) ? ' is-active' : '';
            return `
              <button type="button" class="adm-card${active}" data-plaza-id="${esc(p.id)}">
                <span class="adm-avatar" style="background:${p.temporal ? '#f59e0b' : '#3b82f6'};color:#fff;">${esc(p.id.slice(0, 3))}</span>
                <span class="adm-card-copy">
                  <strong>${esc(p.nombre || p.id)}</strong>
                  <small>${esc(p.id)}</small>
                  <span>${esc(p.localidad || 'Sin localidad')}${p.temporal ? ' · Temporal' : ''}</span>
                </span>
              </button>`;
          }).join('') : `
            <div class="adm-empty">
              <span class="material-symbols-outlined">location_off</span>
              <strong>Sin plazas</strong>
              <small>Ajusta la búsqueda o crea una nueva.</small>
            </div>`}
        </div>
      </div>
      <div class="adm-listas-detail" id="adm-plaza-detail">
        ${_creating ? _creatingHtml() : (plaza ? _detailHtml(plaza, canEdit) : `
          <div class="adm-empty adm-empty--panel">
            <span class="material-symbols-outlined">location_city</span>
            <strong>Selecciona una plaza</strong>
            <small>El detalle y la edición aparecen aquí.</small>
          </div>`)}
      </div>
    </div>`;

  _bind();
}

function _bind() {
  _host.querySelector('#adm-plaza-search')?.addEventListener('input', (e) => {
    _query = e.target.value || '';
    _paint();
    const input = _host.querySelector('#adm-plaza-search');
    if (input) { input.focus(); const len = input.value.length; input.setSelectionRange(len, len); }
  });

  _host.querySelectorAll('[data-plaza-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      _creating = false;
      _editing = false;
      _selectedId = btn.getAttribute('data-plaza-id') || '';
      if (typeof _navigate === 'function') _navigate(adminSectionPath('plazas', _selectedId), { replace: true, soft: true });
      _paint();
    });
  });

  _host.querySelector('[data-action="new-plaza"]')?.addEventListener('click', () => {
    if (!_canEdit()) return;
    _creating = true;
    _editing = false;
    _paint();
    _host.querySelector('#adm-plaza-new-key')?.focus();
  });
  _host.querySelector('#adm-plaza-new-key')?.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });
  _host.querySelector('[data-action="cancel-new-plaza"]')?.addEventListener('click', () => {
    _creating = false;
    _paint();
  });
  _host.querySelector('[data-action="confirm-new-plaza"]')?.addEventListener('click', () => _confirmNewPlaza());

  _host.querySelector('[data-action="edit-plaza"]')?.addEventListener('click', () => {
    if (!_canEdit()) return;
    _editing = true;
    _paint();
  });
  _host.querySelector('[data-action="cancel-edit-plaza"]')?.addEventListener('click', () => {
    _editing = false;
    _paint();
  });
  _host.querySelector('[data-action="save-plaza"]')?.addEventListener('click', () => _savePlaza());
  _host.querySelector('[data-action="delete-plaza"]')?.addEventListener('click', () => _deletePlaza());

  _host.querySelector('[data-action="toggle-temporal"]')?.addEventListener('click', (e) => {
    e.currentTarget.classList.toggle('is-on');
  });

  _host.querySelector('[data-action="add-contact"]')?.addEventListener('click', () => {
    const list = _host.querySelector('#adm-plaza-contacts-list');
    if (!list) return;
    const idx = list.querySelectorAll('.adm-plaza-contact-row').length;
    const row = document.createElement('div');
    row.className = 'adm-plaza-contact-row';
    row.dataset.contactIdx = String(idx);
    row.innerHTML = `
      <input type="text" data-field="nombre" placeholder="Nombre">
      <input type="text" data-field="rol" placeholder="Puesto/Rol">
      <input type="tel" data-field="telefono" placeholder="Teléfono">
      <button type="button" class="adm-btn ghost" data-action="remove-contact"><span class="material-symbols-outlined">delete_outline</span></button>`;
    list.appendChild(row);
    row.querySelector('[data-action="remove-contact"]').addEventListener('click', () => row.remove());
    row.querySelector('input')?.focus();
  });
  _host.querySelectorAll('[data-action="remove-contact"]').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.adm-plaza-contact-row')?.remove());
  });
}

async function _confirmNewPlaza() {
  const form = _host.querySelector('#adm-plaza-new-form');
  if (!form) return;
  const fd = new FormData(form);
  const key = String(fd.get('key') || '');
  const error = validarPlazaKey(key, getPlazasSnapshot().map(p => p.id));
  if (error) { toast(error, 'error'); return; }
  try {
    const id = await crearPlaza({ key, nombre: fd.get('nombre'), descripcion: fd.get('descripcion') });
    _creating = false;
    _selectedId = id;
    _editing = true;
    toast(`Plaza ${id} creada.`, 'success');
    if (typeof _navigate === 'function') _navigate(adminSectionPath('plazas', id), { replace: true, soft: true });
    _paint();
  } catch (err) {
    console.error('[admin-plazas] crear:', err);
    toast(err?.message || 'No se pudo crear la plaza.', 'error');
  }
}

function _readContactsFromDom() {
  return Array.from(_host.querySelectorAll('.adm-plaza-contact-row')).map(row => ({
    nombre: row.querySelector('[data-field="nombre"]')?.value || '',
    rol: row.querySelector('[data-field="rol"]')?.value || '',
    telefono: row.querySelector('[data-field="telefono"]')?.value || ''
  }));
}

async function _savePlaza() {
  const plaza = _selected();
  if (!plaza || !_canEdit()) return;
  const form = _host.querySelector('#adm-plaza-form');
  if (!form) return;
  const fd = new FormData(form);
  const datos = {
    nombre: String(fd.get('nombre') || ''),
    descripcion: String(fd.get('descripcion') || ''),
    localidad: String(fd.get('localidad') || ''),
    direccion: String(fd.get('direccion') || ''),
    mapsUrl: String(fd.get('mapsUrl') || ''),
    temporal: _host.querySelector('[data-action="toggle-temporal"]')?.classList.contains('is-on') || false,
    correo: String(fd.get('correo') || ''),
    telefono: String(fd.get('telefono') || ''),
    gerente: String(fd.get('gerente') || ''),
    correoGerente: String(fd.get('correoGerente') || ''),
    contactos: _readContactsFromDom()
  };
  try {
    await guardarPlaza(plaza.id, datos);
    _editing = false;
    toast('Plaza actualizada.', 'success');
    _paint();
  } catch (err) {
    console.error('[admin-plazas] guardar:', err);
    toast(err?.message || 'No se pudo guardar.', 'error');
  }
}

async function _deletePlaza() {
  const plaza = _selected();
  if (!plaza || !_canEdit()) return;
  const ok = await _confirm(`Eliminar plaza "${plaza.id}"`, 'Se eliminará del catálogo junto con sus datos configurados.', 'danger');
  if (!ok) return;
  try {
    await eliminarPlaza(plaza.id);
    _selectedId = '';
    toast(`Plaza "${plaza.id}" eliminada.`, 'success');
    if (typeof _navigate === 'function') _navigate(adminSectionPath('plazas'), { replace: true, soft: true });
    _paint();
  } catch (err) {
    console.error('[admin-plazas] eliminar:', err);
    toast(err?.message || 'No se pudo eliminar.', 'error');
  }
}

export function mountPlazasPanel(host, opts = {}) {
  unmountPlazasPanel();
  _host = host;
  _navigate = opts.navigate || null;
  _selectedId = String(opts.entityId || '').trim();
  _query = '';
  _editing = false;
  _creating = false;
  _paint();
}

export function syncPlazasSelection(entityId = '') {
  const next = String(entityId || '').trim();
  if (next !== _selectedId) { _editing = false; _creating = false; }
  _selectedId = next;
  _paint();
}

export function unmountPlazasPanel() {
  _host = null;
  _navigate = null;
  _selectedId = '';
  _query = '';
  _editing = false;
  _creating = false;
}
