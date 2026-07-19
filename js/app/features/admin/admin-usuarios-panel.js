/**
 * LISTAS — Usuarios: directorio cards + panel detalle.
 */
import { getState } from '/js/app/app-state.js';
import {
  subscribeAdminUsers,
  mergeAdminUserBasics
} from '/js/app/features/admin/admin-users-data.js';
import { canEditUsersBasics, canAssignPlazaAsGlobal, canEditChoferRecord } from '/js/app/features/admin/admin-permissions.js';
import {
  isChoferRegistrado,
  saveChoferRegistro,
  disableChoferRegistro
} from '/js/app/features/admin/admin-choferes-data.js';
import { adminSectionPath } from '/js/app/features/admin/admin-nav.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0] || '')
    .join('')
    .toUpperCase() || '?';
}

function avatarStyle(name) {
  const hue = ((String(name || 'A').charCodeAt(0) || 65) * 37) % 360;
  return `background:hsl(${hue},55%,48%);color:#fff;`;
}

function toast(msg, type = 'info') {
  if (typeof window.showToast === 'function') window.showToast(msg, type);
  else console.log(msg);
}

function _confirm(title, text, tipo = 'warning') {
  if (typeof window.mexConfirm === 'function') return window.mexConfirm(title, text, tipo);
  return Promise.resolve(window.confirm(`${title}\n\n${text}`));
}

let _unsub = null;
let _users = [];
let _selectedId = '';
let _query = '';
let _host = null;
let _navigate = null;
/** Modo edición datos básicos. */
let _editing = false;
/** Modo edición licencia / chofer. */
let _editingChofer = false;
let _pendingLicenciaFile = null;

function _actor() {
  const st = getState() || {};
  const profile = st.profile || window.__mexCurrentUserRecord || {};
  const role = String(st.role || profile.rol || profile.role || '').toUpperCase();
  const email = String(st.email || profile.email || window._auth?.currentUser?.email || '').toLowerCase();
  return { profile, role, email };
}

function _canEdit() {
  const { profile, role } = _actor();
  return canEditUsersBasics(profile, role);
}

function _canEditChofer(user) {
  if (!user) return false;
  const { profile, role } = _actor();
  return canEditChoferRecord(profile, role, user.rol);
}

function _filtered() {
  const q = _query.trim().toLowerCase();
  let list = _users.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  if (!q) return list;
  return list.filter(u =>
    u.nombre.toLowerCase().includes(q)
    || u.email.toLowerCase().includes(q)
    || u.rol.toLowerCase().includes(q)
    || u.plaza.toLowerCase().includes(q)
  );
}

function _normKey(v = '') {
  return String(v || '').trim().toLowerCase();
}

/** Resuelve selección por id o email (URL puede traer email encodado). */
function _resolveSelectedId(raw = '') {
  const key = _normKey(raw);
  if (!key) return '';
  const hit = _users.find(u =>
    _normKey(u.id) === key
    || _normKey(u.email) === key
  );
  return hit ? hit.id : String(raw || '').trim();
}

function _selected() {
  if (!_selectedId) return null;
  const key = _normKey(_selectedId);
  return _users.find(u =>
    _normKey(u.id) === key
    || _normKey(u.email) === key
  ) || null;
}

function _paint() {
  if (!_host) return;
  const list = _filtered();
  const user = _selected();
  const editable = _canEdit();

  _host.innerHTML = `
    <div class="adm-listas">
      <div class="adm-listas-dir">
        <div class="adm-listas-head">
          <div>
            <span class="adm-kicker">Directorio</span>
            <h2>Usuarios del sistema</h2>
          </div>
          <span class="adm-count">${list.length} visibles</span>
        </div>
        <div class="adm-listas-toolbar">
          <label class="adm-search">
            <span class="material-symbols-outlined">search</span>
            <input type="search" id="adm-user-search" placeholder="Buscar nombre, correo o rol…" value="${esc(_query)}">
          </label>
        </div>
        <div class="adm-cards" id="adm-user-cards">
          ${list.length ? list.map(u => {
            const sel = _selected();
            const active = sel && sel.id === u.id ? ' is-active' : '';
            const photo = u.avatarUrl;
            const av = photo
              ? `<img src="${esc(photo)}" alt="" class="adm-avatar-img">`
              : esc(initials(u.nombre || u.email));
            const registered = isChoferRegistrado(u);
            return `
              <button type="button" class="adm-card${active}" data-user-id="${esc(u.id)}">
                <span class="adm-avatar" style="${photo ? '' : avatarStyle(u.nombre || u.email)}">${av}</span>
                <span class="adm-card-copy">
                  <strong>${esc(u.nombre || 'Sin nombre')}</strong>
                  <small>${esc(u.email || '(sin correo)')}</small>
                  <span>${esc(u.plaza || 'Sin plaza')} · ${esc(u.rol)}${registered ? ' · Chofer' : ''}</span>
                </span>
              </button>`;
          }).join('') : `
            <div class="adm-empty">
              <span class="material-symbols-outlined">person_search</span>
              <strong>Sin usuarios</strong>
              <small>Ajusta la búsqueda o verifica permisos.</small>
            </div>`}
        </div>
      </div>
      <div class="adm-listas-detail" id="adm-user-detail">
        ${user ? _detailHtml(user, editable) : `
          <div class="adm-empty adm-empty--panel">
            <span class="material-symbols-outlined">manage_accounts</span>
            <strong>Selecciona un usuario</strong>
            <small>El detalle y la edición aparecen aquí.</small>
          </div>`}
      </div>
    </div>
  `;

  _host.querySelector('#adm-user-search')?.addEventListener('input', (e) => {
    _query = e.target.value || '';
    _paint();
    const input = _host.querySelector('#adm-user-search');
    if (input) {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  });

  _host.querySelectorAll('[data-user-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      _selectedId = btn.getAttribute('data-user-id') || '';
      _editing = false;
      _editingChofer = false;
      _pendingLicenciaFile = null;
      if (typeof _navigate === 'function') {
        _navigate(adminSectionPath('usuarios', _selectedId), { replace: true, soft: true });
      }
      _paint();
    });
  });

  _host.querySelector('[data-action="edit-user"]')?.addEventListener('click', () => {
    if (!_canEdit()) return;
    _editing = true;
    _paint();
  });
  _host.querySelector('[data-action="cancel-edit-user"]')?.addEventListener('click', () => {
    _editing = false;
    _paint();
  });
  _host.querySelector('[data-action="save-user"]')?.addEventListener('click', () => _saveSelected());
  _host.querySelector('[data-action="edit-chofer"]')?.addEventListener('click', () => {
    if (!_canEditChofer(_selected())) return;
    _editingChofer = true;
    _pendingLicenciaFile = null;
    _paint();
  });
  _host.querySelector('[data-action="cancel-edit-chofer"]')?.addEventListener('click', () => {
    _editingChofer = false;
    _pendingLicenciaFile = null;
    _paint();
  });
  _host.querySelector('[data-action="licencia-file"]')?.addEventListener('change', (e) => {
    _pendingLicenciaFile = e.target.files?.[0] || null;
    const label = _host.querySelector('#adm-licencia-file-label');
    if (label) {
      label.textContent = _pendingLicenciaFile
        ? `Archivo seleccionado: ${_pendingLicenciaFile.name}`
        : 'Sin archivo seleccionado';
    }
  });
  _host.querySelector('[data-action="save-chofer"]')?.addEventListener('click', () => _saveChofer());
  _host.querySelector('[data-action="disable-chofer"]')?.addEventListener('click', () => _disableChofer());
}

function _roValue(text, empty = '—') {
  const v = String(text || '').trim();
  if (!v) return `<div class="adm-field-value is-muted">${esc(empty)}</div>`;
  return `<div class="adm-field-value">${esc(v)}</div>`;
}

function _detailHtml(user, canEdit) {
  const plazas = (window.MEX_CONFIG?.empresa?.plazas || []).map(p => String(p || '').toUpperCase());
  const canPlaza = canAssignPlazaAsGlobal(_actor().profile, _actor().role);
  const editing = canEdit && _editing;
  const canChofer = _canEditChofer(user);
  const choferRegistered = isChoferRegistrado(user);
  const editingChofer = canChofer && _editingChofer;
  const fileLabel = _pendingLicenciaFile
    ? `Archivo seleccionado: ${_pendingLicenciaFile.name}`
    : (user.licenciaArchivoNombre
      ? `Archivo actual: ${user.licenciaArchivoNombre}`
      : (choferRegistered ? 'Licencia cargada' : 'Sin archivo cargado'));

  return `
    <div class="adm-detail">
      <div class="adm-detail-hero">
        <span class="adm-avatar adm-avatar--lg" style="${user.avatarUrl ? '' : avatarStyle(user.nombre)}">
          ${user.avatarUrl ? `<img src="${esc(user.avatarUrl)}" alt="" class="adm-avatar-img">` : esc(initials(user.nombre))}
        </span>
        <div>
          <h3>${esc(user.nombre || 'Sin nombre')}</h3>
          <p>${esc(user.email || 'Sin correo')}</p>
          <div class="adm-pills">
            <span class="adm-pill">${esc(user.rol)}</span>
            <span class="adm-pill">${esc(user.plaza || 'Sin plaza')}</span>
            <span class="adm-pill">${esc(user.status || 'ACTIVO')}</span>
            ${choferRegistered ? '<span class="adm-pill">Chofer</span>' : ''}
          </div>
        </div>
      </div>
      <form class="adm-form${editing ? '' : ' is-readonly'}" id="adm-user-form" onsubmit="return false;">
        <label>
          <span>Nombre completo</span>
          ${editing
            ? `<input name="nombre" type="text" value="${esc(user.nombre)}">`
            : _roValue(user.nombre, 'Sin nombre')}
        </label>
        <label>
          <span>Correo</span>
          ${_roValue(user.email, 'Sin correo')}
        </label>
        <label>
          <span>Teléfono</span>
          ${editing
            ? `<input name="telefono" type="tel" value="${esc(user.telefono)}">`
            : _roValue(user.telefono, 'Sin teléfono')}
        </label>
        <label>
          <span>Plaza base</span>
          ${editing
            ? `<select name="plazaAsignada" ${canPlaza ? '' : 'disabled'}>
                <option value="">Sin plaza</option>
                ${plazas.map(p => `<option value="${esc(p)}" ${user.plaza === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}
              </select>`
            : _roValue(user.plaza, 'Sin plaza')}
        </label>
        <label>
          <span>Estado</span>
          ${editing
            ? `<select name="status">
                ${['ACTIVO', 'INACTIVO', 'SUSPENDIDO'].map(s =>
                  `<option value="${s}" ${user.status === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>`
            : _roValue(user.status, 'ACTIVO')}
        </label>
        <label class="adm-form-full">
          <span>Notas internas</span>
          ${editing
            ? `<textarea name="notasInternas" rows="3">${esc(user.notasInternas)}</textarea>`
            : _roValue(user.notasInternas, 'Sin notas')}
        </label>
        <div class="adm-form-actions">
          ${canEdit && !editing ? `
            <button type="button" class="adm-btn primary" data-action="edit-user">Editar</button>
          ` : ''}
          ${canEdit && editing ? `
            <button type="button" class="adm-btn ghost" data-action="cancel-edit-user">Cancelar</button>
            <button type="button" class="adm-btn primary" data-action="save-user">Guardar cambios</button>
          ` : ''}
        </div>
      </form>
      <section class="adm-subsection">
        <div class="adm-subsection-head">
          <h4>Licencia / chofer</h4>
          <span class="adm-pill">${choferRegistered ? 'Registrado' : 'Sin alta'}</span>
        </div>
        <form class="adm-form${editingChofer ? '' : ' is-readonly'}" id="adm-chofer-form" onsubmit="return false;">
          <label>
            <span>Vencimiento de licencia</span>
            ${editingChofer
              ? `<input name="licenciaVencimiento" type="date" value="${esc(user.licenciaVencimiento || '')}">`
              : _roValue(user.licenciaVencimiento, 'Sin fecha')}
          </label>
          <label>
            <span>Archivo de licencia</span>
            ${editingChofer
              ? `<input name="licenciaFile" type="file" accept="image/*,application/pdf,.pdf" data-action="licencia-file">
                 <small class="adm-hint" id="adm-licencia-file-label">${esc(fileLabel)}</small>`
              : `<div class="adm-field-value">${esc(fileLabel)}</div>
                 ${user.licenciaArchivoUrl
                   ? `<a class="adm-link" href="${esc(user.licenciaArchivoUrl)}" target="_blank" rel="noopener">Ver licencia</a>`
                   : ''}`}
          </label>
          <div class="adm-form-actions">
            ${canChofer && !editingChofer ? `
              <button type="button" class="adm-btn ghost" data-action="edit-chofer">Editar licencia</button>
            ` : ''}
            ${canChofer && editingChofer ? `
              <button type="button" class="adm-btn ghost" data-action="cancel-edit-chofer">Cancelar</button>
              <button type="button" class="adm-btn primary" data-action="save-chofer">Guardar chofer</button>
            ` : ''}
            ${canChofer && choferRegistered && !editingChofer ? `
              <button type="button" class="adm-btn danger" data-action="disable-chofer">Deshabilitar chofer</button>
            ` : ''}
          </div>
        </form>
      </section>
    </div>
  `;
}

async function _saveChofer() {
  const user = _selected();
  if (!user || !_canEditChofer(user)) return;
  const form = _host?.querySelector('#adm-chofer-form');
  if (!form) return;
  const fd = new FormData(form);
  const licenciaVencimiento = String(fd.get('licenciaVencimiento') || '');
  const file = _pendingLicenciaFile || form.querySelector('[name="licenciaFile"]')?.files?.[0] || null;
  try {
    await saveChoferRegistro(user, {
      licenciaVencimiento,
      file,
      actorEmail: _actor().email
    });
    _editingChofer = false;
    _pendingLicenciaFile = null;
    toast('Chofer registrado.', 'success');
    _paint();
  } catch (err) {
    console.error('[admin-usuarios] chofer:', err);
    toast(err?.message || 'No se pudo guardar.', 'error');
  }
}

async function _disableChofer() {
  const user = _selected();
  if (!user || !_canEditChofer(user)) return;
  const ok = await _confirm(
    'Deshabilitar chofer',
    `¿Deshabilitar a ${user.nombre || user.email} como chofer de traslados?`,
    'warning'
  );
  if (!ok) return;
  try {
    await disableChoferRegistro(user, _actor().email);
    toast('Chofer deshabilitado.', 'success');
    _paint();
  } catch (err) {
    console.error('[admin-usuarios] disable chofer:', err);
    toast(err?.message || 'No se pudo deshabilitar.', 'error');
  }
}

async function _saveSelected() {
  const user = _selected();
  if (!user || !_canEdit()) return;
  const form = _host?.querySelector('#adm-user-form');
  if (!form) return;
  const fd = new FormData(form);
  const patch = {
    nombre: String(fd.get('nombre') || ''),
    telefono: String(fd.get('telefono') || ''),
    status: String(fd.get('status') || 'ACTIVO'),
    notasInternas: String(fd.get('notasInternas') || ''),
    plazaAsignada: String(fd.get('plazaAsignada') || '')
  };
  const allowPlaza = canAssignPlazaAsGlobal(_actor().profile, _actor().role);
  try {
    await mergeAdminUserBasics(user.id, patch, _actor().email, { allowPlaza });
    _editing = false;
    toast('Usuario actualizado.', 'success');
    _paint();
  } catch (err) {
    console.error('[admin-usuarios] save:', err);
    toast(err?.message || 'No se pudo guardar.', 'error');
  }
}

/**
 * @param {HTMLElement} host
 * @param {{ navigate?: Function, entityId?: string }} opts
 */
export function mountUsuariosPanel(host, opts = {}) {
  unmountUsuariosPanel();
  _host = host;
  _navigate = opts.navigate || null;
  _selectedId = String(opts.entityId || '').trim();
  _query = '';
  _editing = false;
  _editingChofer = false;
  _pendingLicenciaFile = null;
  _host.innerHTML = `<div class="adm-loading"><span class="material-symbols-outlined">progress_activity</span> Cargando usuarios…</div>`;

  _unsub = subscribeAdminUsers({
    onData: (rows) => {
      _users = Array.isArray(rows) ? rows : [];
      if (_selectedId) _selectedId = _resolveSelectedId(_selectedId);
      _paint();
    },
    onError: (err) => {
      console.error('[admin-usuarios]', err);
      if (_host) {
        _host.innerHTML = `
          <div class="adm-empty">
            <span class="material-symbols-outlined">error</span>
            <strong>No se pudieron cargar usuarios</strong>
            <small>${esc(err?.message || 'Error de red o permisos')}</small>
          </div>`;
      }
    }
  });
}

export function syncUsuariosSelection(entityId = '') {
  let raw = String(entityId || '').trim();
  try { raw = decodeURIComponent(raw); } catch (_) { /* keep raw */ }
  const next = _users.length ? _resolveSelectedId(raw) : raw;
  if (next !== _selectedId) {
    _editing = false;
    _editingChofer = false;
    _pendingLicenciaFile = null;
  }
  _selectedId = next;
  _paint();
}

export function unmountUsuariosPanel() {
  if (typeof _unsub === 'function') {
    try { _unsub(); } catch (_) {}
  }
  _unsub = null;
  _users = [];
  _selectedId = '';
  _host = null;
  _navigate = null;
  _editingChofer = false;
  _pendingLicenciaFile = null;
}
