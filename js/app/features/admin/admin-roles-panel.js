/**
 * LISTAS — Roles: directorio + detalle de permisos (lectura / edición acotada).
 */
import { getState } from '/js/app/app-state.js';
import {
  listAdminRoles,
  permissionCatalog,
  canEditRoles,
  saveAdminRolePatch
} from '/js/app/features/admin/admin-roles-data.js';
import { adminSectionPath } from '/js/app/features/admin/admin-nav.js';

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

let _host = null;
let _navigate = null;
let _roles = [];
let _selectedKey = '';
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
  return canEditRoles(profile, role);
}

function _reload() {
  _roles = listAdminRoles();
}

function _selected() {
  if (!_selectedKey) return null;
  return _roles.find(r => r.key === _selectedKey) || null;
}

function _filtered() {
  const q = _query.trim().toLowerCase();
  if (!q) return _roles.slice();
  return _roles.filter(r =>
    r.key.toLowerCase().includes(q)
    || r.name.toLowerCase().includes(q)
    || r.description.toLowerCase().includes(q)
  );
}

function _roValue(text, empty = '—') {
  const v = String(text || '').trim();
  if (!v) return `<div class="adm-field-value is-muted">${esc(empty)}</div>`;
  return `<div class="adm-field-value">${esc(v)}</div>`;
}

function _detailHtml(role, canEdit) {
  const editing = canEdit && _editing;
  const catalog = permissionCatalog();
  const enabled = new Set(role.enabledPermissions || []);

  return `
    <div class="adm-detail">
      <div class="adm-detail-hero">
        <span class="adm-avatar adm-avatar--lg" style="background:#1e293b;color:#fff;">
          <span class="material-symbols-outlined" style="font-size:28px;">verified_user</span>
        </span>
        <div>
          <h3>${esc(role.name)}</h3>
          <p>${esc(role.key)}</p>
          <div class="adm-pills">
            <span class="adm-pill">Nivel ${esc(String(role.level))}</span>
            <span class="adm-pill">${role.fullAccess ? 'Acceso total' : 'Operativo'}</span>
            <span class="adm-pill">${esc(String(enabled.size))} permisos</span>
          </div>
        </div>
      </div>
      <form class="adm-form${editing ? '' : ' is-readonly'}" id="adm-role-form" onsubmit="return false;">
        <label>
          <span>Nombre visible</span>
          ${editing
            ? `<input name="name" type="text" value="${esc(role.name)}">`
            : _roValue(role.name)}
        </label>
        <label>
          <span>Nivel</span>
          ${editing
            ? `<input name="level" type="number" min="1" max="99" value="${esc(String(role.level))}">`
            : _roValue(String(role.level))}
        </label>
        <label class="adm-form-full">
          <span>Descripción</span>
          ${editing
            ? `<textarea name="description" rows="2">${esc(role.description)}</textarea>`
            : _roValue(role.description, 'Sin descripción')}
        </label>
        <div class="adm-form-full">
          <span class="adm-matrix-title">Permisos</span>
          <div class="adm-perm-matrix">
            ${catalog.map(p => {
              const on = role.fullAccess || enabled.has(p.key) || role.permissions?.[p.key] === true;
              if (editing && !role.fullAccess) {
                return `
                  <label class="adm-perm-item">
                    <input type="checkbox" name="perm" value="${esc(p.key)}" ${on ? 'checked' : ''}>
                    <span>${esc(p.label)}</span>
                  </label>`;
              }
              return `
                <div class="adm-perm-item${on ? ' is-on' : ''}">
                  <span class="material-symbols-outlined">${on ? 'check_circle' : 'cancel'}</span>
                  <span>${esc(p.label)}</span>
                </div>`;
            }).join('')}
          </div>
          ${role.fullAccess ? `<p class="adm-hint">Este rol tiene acceso total; la matriz es informativa.</p>` : ''}
        </div>
        <div class="adm-form-actions">
          ${canEdit && !editing ? `<button type="button" class="adm-btn primary" data-action="edit-role">Editar</button>` : ''}
          ${canEdit && editing ? `
            <button type="button" class="adm-btn ghost" data-action="cancel-edit-role">Cancelar</button>
            <button type="button" class="adm-btn primary" data-action="save-role">Guardar cambios</button>
          ` : ''}
        </div>
      </form>
    </div>
  `;
}

function _paint() {
  if (!_host) return;
  _reload();
  const list = _filtered();
  const role = _selected();
  const canEdit = _canEdit();

  _host.innerHTML = `
    <div class="adm-listas">
      <div class="adm-listas-dir">
        <div class="adm-listas-head">
          <div>
            <span class="adm-kicker">Seguridad</span>
            <h2>Roles del sistema</h2>
          </div>
          <span class="adm-count">${list.length} visibles</span>
        </div>
        <div class="adm-listas-toolbar">
          <label class="adm-search">
            <span class="material-symbols-outlined">search</span>
            <input type="search" id="adm-role-search" placeholder="Buscar rol…" value="${esc(_query)}">
          </label>
        </div>
        <div class="adm-cards">
          ${list.length ? list.map(r => {
            const active = r.key === _selectedKey ? ' is-active' : '';
            return `
              <button type="button" class="adm-card${active}" data-role-key="${esc(r.key)}">
                <span class="adm-avatar" style="background:#0f172a;color:#fff;font-size:11px;">${esc(String(r.level))}</span>
                <span class="adm-card-copy">
                  <strong>${esc(r.name)}</strong>
                  <small>${esc(r.key)}</small>
                  <span>${r.fullAccess ? 'Acceso total' : `${r.enabledPermissions.length} permisos`}</span>
                </span>
              </button>`;
          }).join('') : `
            <div class="adm-empty">
              <span class="material-symbols-outlined">verified_user</span>
              <strong>Sin roles</strong>
            </div>`}
        </div>
      </div>
      <div class="adm-listas-detail">
        ${role ? _detailHtml(role, canEdit) : `
          <div class="adm-empty adm-empty--panel">
            <span class="material-symbols-outlined">verified_user</span>
            <strong>Selecciona un rol</strong>
            <small>Revisa alcance y permisos aquí.</small>
          </div>`}
      </div>
    </div>
  `;

  _host.querySelector('#adm-role-search')?.addEventListener('input', (e) => {
    _query = e.target.value || '';
    _paint();
    const input = _host.querySelector('#adm-role-search');
    if (input) {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  });

  _host.querySelectorAll('[data-role-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      _selectedKey = btn.getAttribute('data-role-key') || '';
      _editing = false;
      if (typeof _navigate === 'function') {
        _navigate(adminSectionPath('roles', _selectedKey), { replace: true, soft: true });
      }
      _paint();
    });
  });

  _host.querySelector('[data-action="edit-role"]')?.addEventListener('click', () => {
    if (!_canEdit()) return;
    _editing = true;
    _paint();
  });
  _host.querySelector('[data-action="cancel-edit-role"]')?.addEventListener('click', () => {
    _editing = false;
    _paint();
  });
  _host.querySelector('[data-action="save-role"]')?.addEventListener('click', () => _save());
}

async function _save() {
  const role = _selected();
  if (!role || !_canEdit()) return;
  const form = _host?.querySelector('#adm-role-form');
  if (!form) return;
  const fd = new FormData(form);
  const permissions = {};
  permissionCatalog().forEach(p => { permissions[p.key] = false; });
  form.querySelectorAll('input[name="perm"]:checked').forEach(el => {
    permissions[el.value] = true;
  });
  try {
    await saveAdminRolePatch(role.key, {
      name: String(fd.get('name') || role.name),
      level: Number(fd.get('level') || role.level),
      description: String(fd.get('description') || ''),
      permissions
    }, _actor().email);
    _editing = false;
    toast('Rol actualizado.', 'success');
    _paint();
  } catch (err) {
    console.error('[admin-roles] save:', err);
    toast(err?.message || 'No se pudo guardar el rol.', 'error');
  }
}

export function mountRolesPanel(host, opts = {}) {
  unmountRolesPanel();
  _host = host;
  _navigate = opts.navigate || null;
  _selectedKey = String(opts.entityId || '').trim().toUpperCase();
  _query = '';
  _editing = false;
  _reload();
  if (_selectedKey && !_roles.some(r => r.key === _selectedKey)) _selectedKey = '';
  _paint();
}

export function syncRolesSelection(entityId = '') {
  let raw = String(entityId || '').trim();
  try { raw = decodeURIComponent(raw); } catch (_) { /* keep */ }
  _selectedKey = String(raw || '').trim().toUpperCase();
  _editing = false;
  _paint();
}

export function unmountRolesPanel() {
  _host = null;
  _navigate = null;
  _roles = [];
  _selectedKey = '';
  _query = '';
  _editing = false;
}
