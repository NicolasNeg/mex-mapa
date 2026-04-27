import { getState } from '/js/app/app-state.js';
import { subscribeAdminUsers } from '/js/app/features/admin/admin-users-data.js';
import { getAdminMetaSnapshot } from '/js/app/features/admin/admin-catalogs-data.js';
import { subscribeAdminRequests } from '/js/app/features/admin/admin-requests-data.js';

let _ctx = null;
let _state = null;
let _unsubUsers = null;
let _unsubRequests = null;
let _offGlobalSearch = null;
let _metaLoaded = false;

export function mount(ctx) {
  _ctx = ctx;
  _state = {
    tab: _tabFromUrl(),
    query: '',
    roleFilter: '',
    plazaFilter: '',
    users: [],
    filtered: [],
    selectedId: null,
    roles: [],
    plazas: [],
    catalogs: [],
    roleQuery: '',
    catalogQuery: '',
    requests: [],
    requestsFiltered: [],
    requestsStatus: 'PENDIENTE',
    requestsPlazaFilter: '',
    requestsQuery: '',
    selectedRequestId: null
  };
  const gs = getState();
  ctx.container.innerHTML = _html(gs.profile);
  _bind();
  _bindGlobalSearch();
  _renderTab();
  _subscribeUsers();
  _loadMeta();
}

export function unmount() {
  if (typeof _unsubUsers === 'function') { try { _unsubUsers(); } catch (_) {} }
  if (typeof _unsubRequests === 'function') { try { _unsubRequests(); } catch (_) {} }
  if (typeof _offGlobalSearch === 'function') { try { _offGlobalSearch(); } catch (_) {} }
  _unsubUsers = null;
  _unsubRequests = null;
  _offGlobalSearch = null;
  _ctx = null;
  _state = null;
  _metaLoaded = false;
}

function _bindGlobalSearch() {
  const handler = event => {
    if (!_ctx || !_state) return;
    const detailRoute = String(event?.detail?.route || '');
    if (!(detailRoute.startsWith('/app/admin') || detailRoute === '/gestion')) return;
    const query = String(event?.detail?.query || '');
    if (_state.tab === 'usuarios') {
      _state.query = query;
      _applyFilters();
      return;
    }
    if (_state.tab === 'roles') {
      _state.roleQuery = query;
      _renderRoles();
      return;
    }
    if (_state.tab === 'catalogos') {
      _state.catalogQuery = query;
      _renderCatalogs();
      return;
    }
    if (_state.tab === 'solicitudes') {
      _state.requestsQuery = query;
      _applyRequestFilters();
    }
  };
  window.addEventListener('mex:global-search', handler);
  _offGlobalSearch = () => window.removeEventListener('mex:global-search', handler);
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
  c.querySelector('#appAdminRoleFilter')?.addEventListener('change', e => { _state.roleFilter = String(e.target.value || ''); _applyFilters(); });
  c.querySelector('#appAdminPlazaFilter')?.addEventListener('change', e => { _state.plazaFilter = String(e.target.value || ''); _applyFilters(); });
  c.querySelector('#appAdminReqStatus')?.addEventListener('change', e => {
    _state.requestsStatus = String(e.target.value || 'PENDIENTE');
    _subscribeRequestsForCurrentStatus();
  });
  c.querySelector('#appAdminReqPlazaFilter')?.addEventListener('change', e => {
    _state.requestsPlazaFilter = String(e.target.value || '');
    _applyRequestFilters();
  });
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

async function _loadMeta() {
  const c = _ctx?.container;
  if (!c || _metaLoaded) return;
  _metaLoaded = true;
  c.querySelector('#appAdminRolesBody').innerHTML = `<tr><td colspan="4" style="padding:20px;color:#64748b;">Cargando roles...</td></tr>`;
  c.querySelector('#appAdminPlazasBody').innerHTML = `<tr><td colspan="4" style="padding:20px;color:#64748b;">Cargando plazas...</td></tr>`;
  c.querySelector('#appAdminCatalogsBody').innerHTML = `<tr><td colspan="4" style="padding:20px;color:#64748b;">Cargando catálogos...</td></tr>`;
  try {
    const meta = await getAdminMetaSnapshot();
    if (!_ctx || !_state) return;
    _state.roles = Array.isArray(meta.roles) ? meta.roles : [];
    _state.plazas = Array.isArray(meta.plazas) ? meta.plazas : [];
    _state.catalogs = Array.isArray(meta.catalogs) ? meta.catalogs : [];
    _renderRoles();
    _renderPlazas();
    _renderCatalogs();
  } catch (err) {
    const msg = esc(err?.message || 'Error cargando metadatos admin.');
    c.querySelector('#appAdminRolesBody').innerHTML = `<tr><td colspan="4" style="padding:20px;color:#b91c1c;">${msg}</td></tr>`;
    c.querySelector('#appAdminPlazasBody').innerHTML = `<tr><td colspan="4" style="padding:20px;color:#b91c1c;">${msg}</td></tr>`;
    c.querySelector('#appAdminCatalogsBody').innerHTML = `<tr><td colspan="4" style="padding:20px;color:#b91c1c;">${msg}</td></tr>`;
  }
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
  c.querySelector('#adminRolesPane').style.display = _state.tab === 'roles' ? 'grid' : 'none';
  c.querySelector('#adminPlazasPane').style.display = _state.tab === 'plazas' ? 'grid' : 'none';
  c.querySelector('#adminCatalogosPane').style.display = _state.tab === 'catalogos' ? 'grid' : 'none';
  c.querySelector('#adminSolicitudesPane').style.display = _state.tab === 'solicitudes' ? 'grid' : 'none';
  c.querySelector('#adminPlaceholderPane').style.display = ['usuarios', 'roles', 'plazas', 'catalogos', 'solicitudes'].includes(_state.tab) ? 'none' : 'block';
  c.querySelector('#adminPlaceholderPane').textContent = `Tab "${_state.tab}" queda como placeholder en esta fase.`;
  if (_state.tab === 'solicitudes') {
    _subscribeRequestsForCurrentStatus();
  } else {
    _cleanupRequestsSub();
  }
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

function _renderRoles() {
  const tbody = _ctx?.container?.querySelector('#appAdminRolesBody');
  if (!tbody) return;
  const q = (_state.roleQuery || '').toLowerCase().trim();
  const rows = _state.roles.filter(r => !q || r.name.toLowerCase().includes(q) || r.key.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q));
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="padding:20px;color:#64748b;">Sin roles para el filtro actual.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `<tr data-admin-role="${escAttr(r.key)}" style="cursor:pointer;">
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(r.name)}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(String(r.level || '—'))}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(r.description || '—')}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(String(_state.users.filter(u => u.rol === r.key).length))}</td>
  </tr>`).join('');
  _ctx.container.querySelectorAll('[data-admin-role]').forEach(el => el.addEventListener('click', () => {
    const role = _state.roles.find(r => r.key === el.dataset.adminRole);
    const box = _ctx.container.querySelector('#appAdminRoleDetail');
    if (!box || !role) return;
    box.innerHTML = `<div style="padding:12px;">
      <h3 style="margin:0 0 8px;color:#0f172a;">${esc(role.name)}</h3>
      ${_detail('Clave', role.key)}
      ${_detail('Nivel', role.level || '—')}
      ${_detail('Usuarios', _state.users.filter(u => u.rol === role.key).length)}
      ${_detail('Permisos', role.permissions?.length || 0)}
      <div style="margin:8px 0;font-size:12px;color:#334155;">${esc(role.description || 'Sin descripción')}</div>
      <a href="/gestion?tab=roles" style="font-size:12px;color:#0f172a;">Abrir admin completo</a>
    </div>`;
  }));
}

function _renderPlazas() {
  const tbody = _ctx?.container?.querySelector('#appAdminPlazasBody');
  if (!tbody) return;
  if (!_state.plazas.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="padding:20px;color:#64748b;">No hay plazas configuradas.</td></tr>`;
    return;
  }
  tbody.innerHTML = _state.plazas.map(p => `<tr data-admin-plaza="${escAttr(p.id)}" style="cursor:pointer;">
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(p.id)}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(p.name || p.id)}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${_state.users.filter(u => u.plaza === p.id).length}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${p.active ? 'Activa' : 'Inactiva'}</td>
  </tr>`).join('');
  _ctx.container.querySelectorAll('[data-admin-plaza]').forEach(el => el.addEventListener('click', () => {
    const p = _state.plazas.find(x => x.id === el.dataset.adminPlaza);
    const box = _ctx.container.querySelector('#appAdminPlazaDetail');
    if (!box || !p) return;
    box.innerHTML = `<div style="padding:12px;">
      <h3 style="margin:0 0 8px;color:#0f172a;">${esc(p.name || p.id)}</h3>
      ${_detail('ID', p.id)}
      ${_detail('Estado', p.active ? 'Activa' : 'Inactiva')}
      ${_detail('Usuarios', _state.users.filter(u => u.plaza === p.id).length)}
      <div style="margin:8px 0;font-size:12px;color:#334155;">${esc(p.description || 'Sin descripción')}</div>
      <a href="/gestion?tab=plazas" style="font-size:12px;color:#0f172a;">Abrir admin completo</a>
    </div>`;
  }));
}

function _renderCatalogs() {
  const tbody = _ctx?.container?.querySelector('#appAdminCatalogsBody');
  if (!tbody) return;
  const q = (_state.catalogQuery || '').toLowerCase().trim();
  const rows = _state.catalogs
    .map(c => ({ ...c, count: Array.isArray(c.items) ? c.items.length : 0 }))
    .filter(c => !q || c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="padding:20px;color:#64748b;">Sin catálogos para el filtro actual.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(c => `<tr data-admin-catalog="${escAttr(c.id)}" style="cursor:pointer;">
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(c.label)}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(c.id)}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${c.count}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">Ver detalle</td>
  </tr>`).join('');
  _ctx.container.querySelectorAll('[data-admin-catalog]').forEach(el => el.addEventListener('click', () => {
    const c = _state.catalogs.find(x => x.id === el.dataset.adminCatalog);
    const box = _ctx.container.querySelector('#appAdminCatalogDetail');
    if (!box || !c) return;
    const preview = (c.items || []).slice(0, 15).map(i => `<li style="font-size:12px;color:#334155;margin-bottom:4px;">${esc(i.name)} ${i.extra ? `<span style="color:#94a3b8;">· ${esc(i.extra)}</span>` : ''}</li>`).join('');
    box.innerHTML = `<div style="padding:12px;">
      <h3 style="margin:0 0 8px;color:#0f172a;">${esc(c.label)}</h3>
      ${_detail('Clave', c.id)}
      ${_detail('Elementos', (c.items || []).length)}
      <ul style="margin:8px 0 0;padding-left:18px;max-height:280px;overflow:auto;">${preview || '<li style="font-size:12px;color:#94a3b8;">Sin elementos</li>'}</ul>
      <a href="/gestion?tab=catalogos" style="font-size:12px;color:#0f172a;">Abrir admin completo</a>
    </div>`;
  }));
}

function _setTableBody(html) {
  const el = _ctx?.container?.querySelector('#appAdminUsersBody');
  if (el) el.innerHTML = html;
}

function _cleanupRequestsSub() {
  if (typeof _unsubRequests === 'function') { try { _unsubRequests(); } catch (_) {} }
  _unsubRequests = null;
}

function _subscribeRequestsForCurrentStatus() {
  if (_state.tab !== 'solicitudes') return;
  _cleanupRequestsSub();
  const body = _ctx?.container?.querySelector('#appAdminRequestsBody');
  if (body) body.innerHTML = `<tr><td colspan="7" style="padding:20px;color:#64748b;">Cargando solicitudes...</td></tr>`;
  _unsubRequests = subscribeAdminRequests({
    status: _state.requestsStatus,
    onData: rows => {
      if (!_ctx || !_state) return;
      _state.requests = Array.isArray(rows) ? rows : [];
      _hydrateRequestPlazaFilter();
      _applyRequestFilters();
    },
    onError: err => {
      const msg = esc(err?.message || 'Error cargando solicitudes');
      const el = _ctx?.container?.querySelector('#appAdminRequestsBody');
      if (el) el.innerHTML = `<tr><td colspan="7" style="padding:20px;color:#b91c1c;">${msg}</td></tr>`;
    }
  });
}

function _hydrateRequestPlazaFilter() {
  const sel = _ctx?.container?.querySelector('#appAdminReqPlazaFilter');
  if (!sel) return;
  const plazas = [...new Set(_state.requests.map(r => r.plazaSolicitada).filter(Boolean))].sort();
  sel.innerHTML = `<option value="">Todas las plazas</option>${plazas.map(p => `<option value="${escAttr(p)}">${esc(p)}</option>`).join('')}`;
  if (_state.requestsPlazaFilter) sel.value = _state.requestsPlazaFilter;
}

function _applyRequestFilters() {
  const q = _state.requestsQuery.toUpperCase().trim();
  _state.requestsFiltered = _state.requests.filter(r => {
    if (_state.requestsPlazaFilter && r.plazaSolicitada !== _state.requestsPlazaFilter) return false;
    if (!q) return true;
    const text = `${r.nombre} ${r.email} ${r.puesto} ${r.rolSolicitado} ${r.plazaSolicitada} ${r.telefono}`.toUpperCase();
    return text.includes(q);
  });
  _renderRequestsTable();
  _syncRequestDetail();
}

function _renderRequestsTable() {
  const body = _ctx?.container?.querySelector('#appAdminRequestsBody');
  if (!body) return;
  if (!_state.requestsFiltered.length) {
    body.innerHTML = `<tr><td colspan="7" style="padding:20px;color:#64748b;">Sin solicitudes para el filtro actual.</td></tr>`;
    return;
  }
  body.innerHTML = _state.requestsFiltered.map(r => `<tr data-admin-req="${escAttr(r.id)}" style="cursor:pointer;">
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(r.nombre || '—')}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(r.email || '—')}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(r.puesto || '—')}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(r.plazaSolicitada || '—')}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(r.rolSolicitado || '—')}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(r.estado || '—')}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(r.fecha || '—')}</td>
  </tr>`).join('');
  _ctx.container.querySelectorAll('[data-admin-req]').forEach(row => row.addEventListener('click', () => {
    _state.selectedRequestId = row.dataset.adminReq;
    _syncRequestDetail();
  }));
}

function _syncRequestDetail() {
  const box = _ctx?.container?.querySelector('#appAdminRequestDetail');
  if (!box) return;
  const req = _state.requestsFiltered.find(r => r.id === _state.selectedRequestId) || _state.requestsFiltered[0] || _state.requests[0];
  if (!req) return box.innerHTML = `<div style="padding:12px;color:#94a3b8;">Selecciona una solicitud para ver detalle.</div>`;
  box.innerHTML = `<div style="padding:12px;">
    <h3 style="margin:0 0 8px;color:#0f172a;">${esc(req.nombre || 'Solicitante')}</h3>
    ${_detail('Email', req.email || '—')}
    ${_detail('Puesto', req.puesto || '—')}
    ${_detail('Plaza solicitada', req.plazaSolicitada || '—')}
    ${_detail('Rol solicitado', req.rolSolicitado || '—')}
    ${_detail('Teléfono', req.telefono || '—')}
    ${_detail('Estado', req.estado || '—')}
    ${_detail('Fecha', req.fecha || '—')}
    ${_detail('Colección', req.collectionName || 'solicitudes')}
    <div style="margin-top:8px;font-size:11px;color:#64748b;">Vista parcial en modo lectura (sin aprobar/rechazar en esta fase).</div>
    <a href="/gestion?tab=solicitudes" style="display:inline-block;margin-top:10px;font-size:12px;color:#0f172a;">Abrir admin completo</a>
  </div>`;
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
  <div id="adminRolesPane" style="display:none;grid-template-columns:minmax(0,1fr) 320px;gap:12px;">
    <div style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:10px;">
      <div style="overflow:auto;max-height:64vh;border:1px solid #eef2f7;border-radius:8px;">
        <table style="width:100%;border-collapse:collapse;min-width:760px;">
          <thead><tr><th style="padding:8px;text-align:left;background:#f8fafc;">Rol</th><th style="padding:8px;text-align:left;background:#f8fafc;">Nivel</th><th style="padding:8px;text-align:left;background:#f8fafc;">Descripción</th><th style="padding:8px;text-align:left;background:#f8fafc;">Usuarios</th></tr></thead>
          <tbody id="appAdminRolesBody"></tbody>
        </table>
      </div>
    </div>
    <aside id="appAdminRoleDetail" style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;"></aside>
  </div>
  <div id="adminPlazasPane" style="display:none;grid-template-columns:minmax(0,1fr) 320px;gap:12px;">
    <div style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:10px;">
      <div style="overflow:auto;max-height:64vh;border:1px solid #eef2f7;border-radius:8px;">
        <table style="width:100%;border-collapse:collapse;min-width:760px;">
          <thead><tr><th style="padding:8px;text-align:left;background:#f8fafc;">ID</th><th style="padding:8px;text-align:left;background:#f8fafc;">Nombre</th><th style="padding:8px;text-align:left;background:#f8fafc;">Usuarios</th><th style="padding:8px;text-align:left;background:#f8fafc;">Estado</th></tr></thead>
          <tbody id="appAdminPlazasBody"></tbody>
        </table>
      </div>
    </div>
    <aside id="appAdminPlazaDetail" style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;"></aside>
  </div>
  <div id="adminCatalogosPane" style="display:none;grid-template-columns:minmax(0,1fr) 320px;gap:12px;">
    <div style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:10px;">
      <div style="overflow:auto;max-height:64vh;border:1px solid #eef2f7;border-radius:8px;">
        <table style="width:100%;border-collapse:collapse;min-width:760px;">
          <thead><tr><th style="padding:8px;text-align:left;background:#f8fafc;">Catálogo</th><th style="padding:8px;text-align:left;background:#f8fafc;">Clave</th><th style="padding:8px;text-align:left;background:#f8fafc;">Elementos</th><th style="padding:8px;text-align:left;background:#f8fafc;">Acción</th></tr></thead>
          <tbody id="appAdminCatalogsBody"></tbody>
        </table>
      </div>
    </div>
    <aside id="appAdminCatalogDetail" style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;"></aside>
  </div>
  <div id="adminSolicitudesPane" style="display:none;grid-template-columns:minmax(0,1fr) 320px;gap:12px;">
    <div style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:10px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <select id="appAdminReqStatus" style="border:1px solid #dbe3ef;border-radius:8px;padding:8px;">
          <option value="PENDIENTE">Pendientes</option>
          <option value="APROBADA">Aprobadas</option>
          <option value="RECHAZADA">Rechazadas</option>
        </select>
        <select id="appAdminReqPlazaFilter" style="border:1px solid #dbe3ef;border-radius:8px;padding:8px;"></select>
      </div>
      <div style="overflow:auto;max-height:64vh;border:1px solid #eef2f7;border-radius:8px;">
        <table style="width:100%;border-collapse:collapse;min-width:980px;">
          <thead><tr><th style="padding:8px;text-align:left;background:#f8fafc;">Nombre</th><th style="padding:8px;text-align:left;background:#f8fafc;">Email</th><th style="padding:8px;text-align:left;background:#f8fafc;">Puesto</th><th style="padding:8px;text-align:left;background:#f8fafc;">Plaza</th><th style="padding:8px;text-align:left;background:#f8fafc;">Rol</th><th style="padding:8px;text-align:left;background:#f8fafc;">Estado</th><th style="padding:8px;text-align:left;background:#f8fafc;">Fecha</th></tr></thead>
          <tbody id="appAdminRequestsBody"></tbody>
        </table>
      </div>
    </div>
    <aside id="appAdminRequestDetail" style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;"></aside>
  </div>
  <div id="adminPlaceholderPane" style="display:none;border:1px solid #e2e8f0;border-radius:10px;background:#fff;padding:16px;color:#64748b;"></div>
  <div style="margin-top:10px;font-size:12px;color:#64748b;">Sesión actual: ${esc(profile?.nombreCompleto || profile?.nombre || profile?.email || 'Usuario')}</div>
</div>`;
}

function _detail(k, v) { return `<div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:6px;font-size:12px;"><strong style="color:#64748b;">${esc(k)}</strong><span style="color:#0f172a;">${esc(v)}</span></div>`; }
function esc(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escAttr(v) { return esc(v).replace(/'/g, '&#39;'); }
