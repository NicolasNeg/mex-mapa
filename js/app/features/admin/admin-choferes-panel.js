/**
 * LISTAS — Choferes: directorio + registro de licencia.
 */
import { getState } from '/js/app/app-state.js';
import { subscribeAdminUsers } from '/js/app/features/admin/admin-users-data.js';
import {
  isChoferRegistrado,
  saveChoferRegistro,
  disableChoferRegistro
} from '/js/app/features/admin/admin-choferes-data.js';
import { canEditChoferRecord } from '/js/app/features/admin/admin-permissions.js';
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
let _editing = false;
let _pendingFile = null;

function _actor() {
  const st = getState() || {};
  const profile = st.profile || window.__mexCurrentUserRecord || {};
  const role = String(st.role || profile.rol || profile.role || '').toUpperCase();
  const email = String(st.email || profile.email || window._auth?.currentUser?.email || '').toLowerCase();
  return { profile, role, email };
}

function _canEditUser(user) {
  if (!user) return false;
  const { profile, role } = _actor();
  return canEditChoferRecord(profile, role, user.rol);
}

function _normKey(v = '') {
  return String(v || '').trim().toLowerCase();
}

function _resolveSelectedId(raw = '') {
  const key = _normKey(raw);
  if (!key) return '';
  const hit = _users.find(u => _normKey(u.id) === key || _normKey(u.email) === key);
  return hit ? hit.id : String(raw || '').trim();
}

function _selected() {
  if (!_selectedId) return null;
  const key = _normKey(_selectedId);
  return _users.find(u => _normKey(u.id) === key || _normKey(u.email) === key) || null;
}

function _filtered() {
  const q = _query.trim().toLowerCase();
  let list = _users.slice().sort((a, b) => {
    const ar = isChoferRegistrado(a) ? 1 : 0;
    const br = isChoferRegistrado(b) ? 1 : 0;
    if (ar !== br) return br - ar;
    return a.nombre.localeCompare(b.nombre, 'es');
  });
  if (!q) return list;
  return list.filter(u =>
    u.nombre.toLowerCase().includes(q)
    || u.email.toLowerCase().includes(q)
    || u.rol.toLowerCase().includes(q)
    || u.plaza.toLowerCase().includes(q)
    || (isChoferRegistrado(u) ? 'chofer' : 'pendiente').includes(q)
  );
}

function _roValue(text, empty = '—') {
  const v = String(text || '').trim();
  if (!v) return `<div class="adm-field-value is-muted">${esc(empty)}</div>`;
  return `<div class="adm-field-value">${esc(v)}</div>`;
}

function _detailHtml(user, canEdit) {
  const registered = isChoferRegistrado(user);
  const editing = canEdit && _editing;
  const fileLabel = _pendingFile
    ? `Archivo seleccionado: ${_pendingFile.name}`
    : (user.licenciaArchivoNombre
      ? `Archivo actual: ${user.licenciaArchivoNombre}`
      : (registered ? 'Licencia cargada' : 'Sin archivo cargado'));

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
            <span class="adm-pill">${registered ? 'Chofer registrado' : 'Registro pendiente'}</span>
          </div>
        </div>
      </div>
      <form class="adm-form${editing ? '' : ' is-readonly'}" id="adm-chofer-form" onsubmit="return false;">
        <label>
          <span>Nombre</span>
          ${_roValue(user.nombre, 'Sin nombre')}
        </label>
        <label>
          <span>Correo</span>
          ${_roValue(user.email, 'Sin correo')}
        </label>
        <label>
          <span>Teléfono</span>
          ${_roValue(user.telefono, 'Sin teléfono')}
        </label>
        <label>
          <span>Plaza</span>
          ${_roValue(user.plaza, 'Sin plaza')}
        </label>
        <label>
          <span>Vencimiento de licencia</span>
          ${editing
            ? `<input name="licenciaVencimiento" type="date" value="${esc(user.licenciaVencimiento || '')}">`
            : _roValue(user.licenciaVencimiento, 'Sin fecha')}
        </label>
        <label>
          <span>Archivo de licencia</span>
          ${editing
            ? `<input name="licenciaFile" type="file" accept="image/*,application/pdf,.pdf" data-action="chofer-file">
               <small class="adm-hint" id="adm-chofer-file-label">${esc(fileLabel)}</small>`
            : `<div class="adm-field-value">${esc(fileLabel)}</div>
               ${user.licenciaArchivoUrl
                 ? `<a class="adm-link" href="${esc(user.licenciaArchivoUrl)}" target="_blank" rel="noopener">Ver licencia</a>`
                 : ''}`}
        </label>
        <div class="adm-form-actions">
          ${canEdit && !editing ? `
            <button type="button" class="adm-btn primary" data-action="edit-chofer">Editar</button>
          ` : ''}
          ${canEdit && editing ? `
            <button type="button" class="adm-btn ghost" data-action="cancel-edit-chofer">Cancelar</button>
            <button type="button" class="adm-btn primary" data-action="save-chofer">Guardar chofer</button>
          ` : ''}
          ${canEdit && registered && !editing ? `
            <button type="button" class="adm-btn danger" data-action="disable-chofer">Deshabilitar chofer</button>
          ` : ''}
        </div>
      </form>
    </div>
  `;
}

function _paint() {
  if (!_host) return;
  const list = _filtered();
  const user = _selected();
  const canEdit = _canEditUser(user);

  _host.innerHTML = `
    <div class="adm-listas">
      <div class="adm-listas-dir">
        <div class="adm-listas-head">
          <div>
            <span class="adm-kicker">Directorio</span>
            <h2>Choferes</h2>
          </div>
          <span class="adm-count">${list.length} visibles</span>
        </div>
        <div class="adm-listas-toolbar">
          <label class="adm-search">
            <span class="material-symbols-outlined">search</span>
            <input type="search" id="adm-chofer-search" placeholder="Buscar usuario, correo o plaza…" value="${esc(_query)}">
          </label>
        </div>
        <div class="adm-cards" id="adm-chofer-cards">
          ${list.length ? list.map(u => {
            const sel = _selected();
            const active = sel && sel.id === u.id ? ' is-active' : '';
            const registered = isChoferRegistrado(u);
            const photo = u.avatarUrl;
            const av = photo
              ? `<img src="${esc(photo)}" alt="" class="adm-avatar-img">`
              : esc(initials(u.nombre || u.email));
            return `
              <button type="button" class="adm-card${active}" data-user-id="${esc(u.id)}">
                <span class="adm-avatar" style="${photo ? '' : avatarStyle(u.nombre || u.email)}">${av}</span>
                <span class="adm-card-copy">
                  <strong>${esc(u.nombre || 'Sin nombre')}</strong>
                  <small>${esc(u.email || '(sin correo)')}</small>
                  <span>${esc(u.plaza || 'Sin plaza')} · ${registered ? 'Chofer' : 'Sin alta'}</span>
                </span>
              </button>`;
          }).join('') : `
            <div class="adm-empty">
              <span class="material-symbols-outlined">badge</span>
              <strong>Sin usuarios</strong>
              <small>Ajusta la búsqueda para registrar un chofer.</small>
            </div>`}
        </div>
      </div>
      <div class="adm-listas-detail">
        ${user ? _detailHtml(user, canEdit) : `
          <div class="adm-empty adm-empty--panel">
            <span class="material-symbols-outlined">badge</span>
            <strong>Selecciona un usuario</strong>
            <small>Al registrar la licencia aparecerá en traslados como chofer.</small>
          </div>`}
      </div>
    </div>
  `;

  _host.querySelector('#adm-chofer-search')?.addEventListener('input', (e) => {
    _query = e.target.value || '';
    _paint();
    const input = _host.querySelector('#adm-chofer-search');
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
      _pendingFile = null;
      if (typeof _navigate === 'function') {
        _navigate(adminSectionPath('choferes', _selectedId), { replace: true, soft: true });
      }
      _paint();
    });
  });

  _host.querySelector('[data-action="edit-chofer"]')?.addEventListener('click', () => {
    if (!_canEditUser(_selected())) return;
    _editing = true;
    _pendingFile = null;
    _paint();
  });
  _host.querySelector('[data-action="cancel-edit-chofer"]')?.addEventListener('click', () => {
    _editing = false;
    _pendingFile = null;
    _paint();
  });
  _host.querySelector('[data-action="chofer-file"]')?.addEventListener('change', (e) => {
    _pendingFile = e.target.files?.[0] || null;
    const label = _host.querySelector('#adm-chofer-file-label');
    if (label) {
      label.textContent = _pendingFile
        ? `Archivo seleccionado: ${_pendingFile.name}`
        : 'Sin archivo seleccionado';
    }
  });
  _host.querySelector('[data-action="save-chofer"]')?.addEventListener('click', () => _save());
  _host.querySelector('[data-action="disable-chofer"]')?.addEventListener('click', () => _disable());
}

async function _save() {
  const user = _selected();
  if (!user || !_canEditUser(user)) return;
  const form = _host?.querySelector('#adm-chofer-form');
  if (!form) return;
  const fd = new FormData(form);
  const licenciaVencimiento = String(fd.get('licenciaVencimiento') || '');
  const file = _pendingFile || form.querySelector('[name="licenciaFile"]')?.files?.[0] || null;
  try {
    await saveChoferRegistro(user, {
      licenciaVencimiento,
      file,
      actorEmail: _actor().email
    });
    _editing = false;
    _pendingFile = null;
    toast('Chofer registrado.', 'success');
  } catch (err) {
    console.error('[admin-choferes] save:', err);
    toast(err?.message || 'No se pudo guardar.', 'error');
  }
}

async function _disable() {
  const user = _selected();
  if (!user || !_canEditUser(user)) return;
  const ok = await _confirm(
    'Deshabilitar chofer',
    `¿Deshabilitar a ${user.nombre || user.email} como chofer de traslados?`,
    'warning'
  );
  if (!ok) return;
  try {
    await disableChoferRegistro(user, _actor().email);
    toast('Chofer deshabilitado.', 'success');
  } catch (err) {
    console.error('[admin-choferes] disable:', err);
    toast(err?.message || 'No se pudo deshabilitar.', 'error');
  }
}

export function mountChoferesPanel(host, opts = {}) {
  unmountChoferesPanel();
  _host = host;
  _navigate = opts.navigate || null;
  _selectedId = String(opts.entityId || '').trim();
  _query = '';
  _editing = false;
  _pendingFile = null;
  _host.innerHTML = `<div class="adm-loading"><span class="material-symbols-outlined">progress_activity</span> Cargando choferes…</div>`;

  _unsub = subscribeAdminUsers({
    onData: (rows) => {
      _users = Array.isArray(rows) ? rows : [];
      if (_selectedId) _selectedId = _resolveSelectedId(_selectedId);
      _paint();
    },
    onError: (err) => {
      console.error('[admin-choferes]', err);
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

export function syncChoferesSelection(entityId = '') {
  let raw = String(entityId || '').trim();
  try { raw = decodeURIComponent(raw); } catch (_) { /* keep */ }
  const next = _users.length ? _resolveSelectedId(raw) : raw;
  if (next !== _selectedId) {
    _editing = false;
    _pendingFile = null;
  }
  _selectedId = next;
  _paint();
}

export function unmountChoferesPanel() {
  if (typeof _unsub === 'function') {
    try { _unsub(); } catch (_) {}
  }
  _unsub = null;
  _users = [];
  _selectedId = '';
  _host = null;
  _navigate = null;
  _editing = false;
  _pendingFile = null;
}
