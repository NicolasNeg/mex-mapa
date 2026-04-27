import { getState } from '/js/app/app-state.js';
import { subscribeAdminUsers } from '/js/app/features/admin/admin-users-data.js';

let _ctx = null;
let _state = null;
let _unsubUsers = null;

export function mount(ctx) {
  _ctx = ctx;
  _state = {
    tab: _tabFromUrl(),
    query: '',
    roleFilter: '',
    plazaFilter: '',
    users: [],
    filtered: [],
    selectedId: null
  };
  const gs = getState();
  ctx.container.innerHTML = _html(gs.profile);
  _bind();
  _subscribeUsers();
}

export function unmount() {
  if (typeof _unsubUsers === 'function') { try { _unsubUsers(); } catch (_) {} }
  _unsubUsers = null;
  _ctx = null;
  _state = null;
}

function _tabFromUrl() {
  const tab = String(new URLSearchParams(window.location.search).get('tab') || 'usuarios').toLowerCase().trim();
  return ['usuarios', 'roles', 'plazas', 'catalogos', 'solicitudes'].includes(tab) ? tab : 'usuarios';
}

function _bind() {
  const c = _ctx?.container;
  if (!c) return;
  c.querySelectorAll('[data-admin-tab]').forEach(btn => btn.addEventListener('click', () => {
    const nextTab = btn.dataset.adminTab || 'usuarios';
    _state.tab = nextTab;
    history.replaceState({}, '', `/app/admin?tab=${encodeURIComponent(nextTab)}`);
    _renderTab();
  }));
  c.querySelector('#appAdminSearch')?.addEventListener('input', e => { _state.query = String(e.target.value || ''); _applyFilters(); });
  c.querySelector('#appAdminRoleFilter')?.addEventListener('change', e => { _state.roleFilter = String(e.target.value || ''); _applyFilters(); });
  c.querySelector('#appAdminPlazaFilter')?.addEventListener('change', e => { _state.plazaFilter = String(e.target.value || ''); _applyFilters(); });
}

function _subscribeUsers() {
  _setTableBody(`<tr><td colspan="5" style="padding:20px;color:#64748b;">Cargando usuarios...</td></tr>`);
  _unsubUsers = subscribeAdminUsers({
    onData: rows => {
      if (!_ctx || !_state) return;
      _state.users = Array.isArray(rows) ? rows : [];
      _hydrateFilters();
      _applyFilters();
    },
    onError: err => _setTableBody(`<tr><td colspan="5" style="padding:20px;color:#b91c1c;">${esc(err?.message || 'Error cargando usuarios')}</td></tr>`)
  });
}

function _hydrateFilters() {
  const c = _ctx?.container;
  if (!c) return;
  const roleSel = c.querySelector('#appAdminRoleFilter');
  const plazaSel = c.querySelector('#appAdminPlazaFilter');
  const roles = [...new Set(_state.users.map(u => u.rol).filter(Boolean))].sort();
  const plazas = [...new Set(_state.users.map(u => u.plaza).filter(Boolean))].sort();
  roleSel.innerHTML = `<option value="">Todos los roles</option>${roles.map(r => `<option value="${escAttr(r)}">${esc(r)}</option>`).join('')}`;
  plazaSel.innerHTML = `<option value="">Todas las plazas</option>${plazas.map(p => `<option value="${escAttr(p)}">${esc(p)}</option>`).join('')}`;
  if (_state.roleFilter) roleSel.value = _state.roleFilter;
  if (_state.plazaFilter) plazaSel.value = _state.plazaFilter;
}

function _applyFilters() {
  const q = _state.query.toLowerCase().trim();
  _state.filtered = _state.users.filter(u => {
    if (_state.roleFilter && u.rol !== _state.roleFilter) return false;
    if (_state.plazaFilter && u.plaza !== _state.plazaFilter) return false;
    if (!q) return true;
    return u.nombre.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.rol.toLowerCase().includes(q) || u.plaza.toLowerCase().includes(q);
  });
  _renderUsersTable();
  _syncDetail();
}

function _renderTab() {
  const c = _ctx?.container;
  if (!c) return;
  c.querySelectorAll('[data-admin-tab]').forEach(btn => btn.style.background = btn.dataset.adminTab === _state.tab ? '#0f172a' : '#fff');
  c.querySelectorAll('[data-admin-tab]').forEach(btn => btn.style.color = btn.dataset.adminTab === _state.tab ? '#fff' : '#475569');
  c.querySelector('#adminUsuariosPane').style.display = _state.tab === 'usuarios' ? 'grid' : 'none';
  c.querySelector('#adminPlaceholderPane').style.display = _state.tab === 'usuarios' ? 'none' : 'block';
  c.querySelector('#adminPlaceholderPane').textContent = `Tab "${_state.tab}" queda como placeholder en esta fase.`;
}

function _renderUsersTable() {
  if (_state.tab !== 'usuarios') return _renderTab();
  _renderTab();
  if (!_state.filtered.length) return _setTableBody(`<tr><td colspan="5" style="padding:20px;color:#64748b;">Sin usuarios para el filtro actual.</td></tr>`);
  _setTableBody(_state.filtered.map(u => `
    <tr data-admin-user="${escAttr(u.id)}" style="cursor:pointer;">
      <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(u.nombre || '—')}</td>
      <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(u.email || '—')}</td>
      <td style="padding:8px;border-bottom:1px solid #eef2f7;"><span style="padding:2px 8px;background:#e2e8f0;border-radius:999px;font-size:11px;">${esc(u.rol || '—')}</span></td>
      <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(u.plaza || '—')}</td>
      <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(u.status || 'ACTIVO')}</td>
    </tr>`).join(''));
  _ctx.container.querySelectorAll('[data-admin-user]').forEach(row => row.addEventListener('click', () => {
    _state.selectedId = row.dataset.adminUser;
    _syncDetail();
  }));
}

function _syncDetail() {
  const box = _ctx?.container?.querySelector('#appAdminDetail');
  if (!box) return;
  const user = _state.filtered.find(u => u.id === _state.selectedId) || _state.users[0];
  if (!user) return box.innerHTML = `<div style="padding:12px;color:#94a3b8;">Selecciona un usuario para ver detalle.</div>`;
  box.innerHTML = `
    <div style="padding:12px;">
      <h3 style="margin:0 0 8px;font-size:18px;color:#0f172a;">${esc(user.nombre || '—')}</h3>
      ${_detail('Email', user.email || '—')}
      ${_detail('Rol', user.rol || '—')}
      ${_detail('Plaza', user.plaza || '—')}
      ${_detail('Teléfono', user.telefono || '—')}
      ${_detail('Estado', user.status || 'ACTIVO')}
      ${_detail('Admin', user.isAdmin ? 'Sí' : 'No')}
      ${_detail('Global', user.isGlobal ? 'Sí' : 'No')}
      <a href="/gestion?tab=usuarios" style="display:inline-block;margin-top:10px;font-size:12px;color:#0f172a;">Abrir panel admin completo</a>
    </div>`;
}

function _setTableBody(html) {
  const el = _ctx?.container?.querySelector('#appAdminUsersBody');
  if (el) el.innerHTML = html;
}

function _html(profile = {}) {
  return `
<div style="padding:22px;max-width:1150px;margin:0 auto;font-family:Inter,sans-serif;">
  <h1 style="margin:0 0 10px;color:#0f172a;font-size:26px;">Panel admin</h1>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
    ${['usuarios','roles','plazas','catalogos','solicitudes'].map(t => `<button data-admin-tab="${t}" style="border:1px solid #dbe3ef;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:700;background:${t==='usuarios'?'#0f172a':'#fff'};color:${t==='usuarios'?'#fff':'#475569'};cursor:pointer;text-transform:capitalize;">${t}</button>`).join('')}
    <a href="/gestion" style="margin-left:auto;font-size:12px;color:#0f172a;">Abrir panel admin completo</a>
  </div>
  <div id="adminUsuariosPane" style="display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:12px;">
    <div style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:10px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <input id="appAdminSearch" placeholder="Buscar por nombre, email, rol o plaza" style="flex:1;min-width:240px;border:1px solid #dbe3ef;border-radius:8px;padding:8px;">
        <select id="appAdminRoleFilter" style="border:1px solid #dbe3ef;border-radius:8px;padding:8px;"></select>
        <select id="appAdminPlazaFilter" style="border:1px solid #dbe3ef;border-radius:8px;padding:8px;"></select>
      </div>
      <div style="overflow:auto;max-height:64vh;border:1px solid #eef2f7;border-radius:8px;">
        <table style="width:100%;border-collapse:collapse;min-width:760px;">
          <thead><tr><th style="padding:8px;text-align:left;background:#f8fafc;">Nombre</th><th style="padding:8px;text-align:left;background:#f8fafc;">Email</th><th style="padding:8px;text-align:left;background:#f8fafc;">Rol</th><th style="padding:8px;text-align:left;background:#f8fafc;">Plaza</th><th style="padding:8px;text-align:left;background:#f8fafc;">Estado</th></tr></thead>
          <tbody id="appAdminUsersBody"></tbody>
        </table>
      </div>
    </div>
    <aside id="appAdminDetail" style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;"></aside>
  </div>
  <div id="adminPlaceholderPane" style="display:none;border:1px solid #e2e8f0;border-radius:10px;background:#fff;padding:16px;color:#64748b;"></div>
  <div style="margin-top:10px;font-size:12px;color:#64748b;">Sesión actual: ${esc(profile?.nombreCompleto || profile?.nombre || profile?.email || 'Usuario')}</div>
</div>`;
}

function _detail(k, v) { return `<div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:6px;font-size:12px;"><strong style="color:#64748b;">${esc(k)}</strong><span style="color:#0f172a;">${esc(v)}</span></div>`; }
function esc(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escAttr(v) { return esc(v).replace(/'/g, '&#39;'); }
