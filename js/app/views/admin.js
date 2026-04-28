import { getState } from '/js/app/app-state.js';
import { db, COL } from '/js/core/database.js';
import { subscribeAdminUsers, mergeAdminUserBasics } from '/js/app/features/admin/admin-users-data.js';
import { getAdminMetaSnapshot } from '/js/app/features/admin/admin-catalogs-data.js';
import { subscribeAdminRequests, fetchAccessRequestDocDeep } from '/js/app/features/admin/admin-requests-data.js';
import {
  canApproveAccessRequest,
  canRejectAccessRequest,
  canEditUsersBasics,
  canAssignPlazaAsGlobal,
  roleNeedsAssignedPlaza,
  canAssignTargetRole
} from '/js/app/features/admin/admin-permissions.js';

let _ctx = null;
let _state = null;
let _unsubUsers = null;
let _unsubRequests = null;
let _offGlobalSearch = null;
let _metaLoaded = false;
let _plazaUnitsCache = new Map();

function _toast(message, type = 'info') {
  let el = document.getElementById('app-admin-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-admin-toast';
    el.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:100002;max-width:92vw;padding:12px 18px;border-radius:12px;font-size:13px;font-weight:700;box-shadow:0 12px 32px rgba(15,23,42,.25);transition:opacity .2s;color:#fff';
    document.body.appendChild(el);
  }
  const bg = type === 'success' ? '#059669' : type === 'error' ? '#b91c1c' : '#0f172a';
  el.style.background = bg;
  el.textContent = message;
  el.style.opacity = '1';
  clearTimeout(_toast._t);
  _toast._t = setTimeout(() => { el.style.opacity = '0'; }, 4200);
}

function _closeOverlay(id) {
  document.getElementById(id)?.remove();
}

function _openConfirmOverlay({ id = 'app-admin-overlay', title, bodyHtml, confirmLabel = 'Confirmar', danger = false, onConfirm }) {
  const wrap = document.createElement('div');
  wrap.id = id;
  wrap.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px;';
  wrap.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:520px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 24px 48px rgba(15,23,42,.2);padding:18px;">
      <h2 style="margin:0 0 10px;font-size:18px;color:#0f172a;">${esc(title)}</h2>
      <div style="font-size:13px;color:#334155;line-height:1.45;">${bodyHtml}</div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap;">
        <button type="button" data-act="cancel" style="border:1px solid #cbd5e1;border-radius:10px;padding:8px 14px;background:#fff;color:#475569;font-weight:700;cursor:pointer;">Cancelar</button>
        <button type="button" data-act="ok" style="border:none;border-radius:10px;padding:8px 14px;font-weight:700;cursor:pointer;color:#fff;background:${danger ? '#b91c1c' : '#0f172a'};">${esc(confirmLabel)}</button>
      </div>
    </div>`;
  wrap.querySelector('[data-act="cancel"]').addEventListener('click', () => _closeOverlay(id));
  wrap.addEventListener('click', e => { if (e.target === wrap) _closeOverlay(id); });
  wrap.querySelector('[data-act="ok"]').addEventListener('click', async () => {
    try {
      await onConfirm();
    } catch (e) {
      if (String(e?.message || e) !== 'abort') console.error(e);
      return;
    }
    _closeOverlay(id);
  });
  document.body.appendChild(wrap);
  return wrap;
}

function _sanitizeRolePick(r) {
  const x = String(r || '').trim().toUpperCase();
  return x || 'AUXILIAR';
}

function _permissionGroups(role = {}) {
  const list = Array.isArray(role.permissions) ? role.permissions : [];
  const groups = {
    usuarios: list.filter(p => /user|usuario|role|assign/i.test(p)),
    solicitudes: list.filter(p => /access|request|solicitud/i.test(p)),
    operacion: list.filter(p => /cuadre|map|flota|alert|incid|message|nota/i.test(p)),
    sistema: list.filter(p => /system|config|programmer|api|lock/i.test(p))
  };
  return groups;
}

function _permissionGroupChips(role = {}) {
  const g = _permissionGroups(role);
  const parts = [
    ['Usuarios', g.usuarios.length],
    ['Solicitudes', g.solicitudes.length],
    ['Operación', g.operacion.length],
    ['Sistema', g.sistema.length]
  ].filter(([, n]) => n > 0);
  if (!parts.length) return '<span style="font-size:11px;color:#94a3b8;">Sin permisos explícitos</span>';
  return parts.map(([label, n]) => `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;background:#f1f5f9;color:#334155;font-size:11px;font-weight:700;">${esc(label)} · ${n}</span>`).join('');
}

async function _fetchPlazaUnitsApprox(plazaId = '') {
  const key = String(plazaId || '').toUpperCase().trim();
  if (!key) return { cuadre: 0, externos: 0, total: 0 };
  if (_plazaUnitsCache.has(key)) return _plazaUnitsCache.get(key);
  try {
    const [cuadre, externos] = await Promise.all([
      db.collection(COL.CUADRE).where('plaza', '==', key).limit(350).get(),
      db.collection(COL.EXTERNOS).where('plaza', '==', key).limit(350).get()
    ]);
    const data = {
      cuadre: cuadre.size || 0,
      externos: externos.size || 0,
      total: (cuadre.size || 0) + (externos.size || 0)
    };
    _plazaUnitsCache.set(key, data);
    return data;
  } catch (_) {
    return { cuadre: 0, externos: 0, total: 0 };
  }
}

function _roleOptionsForActor(actorRole, selectedRole, roleKeys = []) {
  const sel = _sanitizeRolePick(selectedRole);
  return roleKeys.map(role => {
    const ok = canAssignTargetRole(actorRole, role);
    const dis = ok ? '' : ' disabled';
    const lab = role.replace(/_/g, ' ');
    return `<option value="${escAttr(role)}"${role === sel ? ' selected' : ''}${dis}>${esc(lab)}</option>`;
  }).join('');
}

function _openEditUserModal(user, { actorEmail, allowPlaza }) {
  const plazaOpts = (Array.isArray(_state.plazas) ? _state.plazas : []).map(p => `<option value="${escAttr(p.id)}">${esc(p.name || p.id)}</option>`).join('');
  const statusVal = String(user.status || 'ACTIVO').toUpperCase();
  const bodyHtml = `
    <label style="display:block;margin-bottom:6px;font-size:12px;font-weight:700;color:#334155;">Nombre</label>
    <input id="adm-u-nombre" type="text" value="${escAttr(user.nombre || '')}" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:12px;box-sizing:border-box;font:inherit;" />
    <label style="display:block;margin-bottom:6px;font-size:12px;font-weight:700;color:#334155;">Teléfono</label>
    <input id="adm-u-tel" type="text" value="${escAttr(user.telefono || '')}" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:12px;box-sizing:border-box;font:inherit;" />
    ${allowPlaza ? `<label style="display:block;margin-bottom:6px;font-size:12px;font-weight:700;color:#334155;">Plaza asignada</label>
    <select id="adm-u-plaza" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:12px;font:inherit;"><option value="">—</option>${plazaOpts}</select>` : '<p style="font-size:11px;color:#64748b;margin:0 0 10px;">Plaza: solo usuarios admin global pueden reasignarla aquí. Otros cambios en <a href="/gestion?tab=usuarios">legacy</a>.</p>'}
    <label style="display:block;margin-bottom:6px;font-size:12px;font-weight:700;color:#334155;">Estado cuenta</label>
    <select id="adm-u-status" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:12px;font:inherit;">
      <option value="ACTIVO"${statusVal === 'ACTIVO' ? ' selected' : ''}>ACTIVO</option>
      <option value="INACTIVO"${statusVal === 'INACTIVO' ? ' selected' : ''}>INACTIVO</option>
    </select>
    <label style="display:block;margin-bottom:6px;font-size:12px;font-weight:700;color:#334155;">Notas internas</label>
    <textarea id="adm-u-notas" rows="3" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;box-sizing:border-box;font:inherit;">${esc(user.notasInternas || '')}</textarea>
    <p style="font-size:11px;color:#64748b;margin-top:8px;">Correo, UID, rol, permisos y contraseña no se modifican desde App Shell.</p>`;

  const wrap = _openConfirmOverlay({
    title: 'Editar datos básicos',
    bodyHtml,
    confirmLabel: 'Guardar cambios',
    onConfirm: async () => {
      const nombre = String(document.getElementById('adm-u-nombre')?.value || '').trim();
      const telefono = String(document.getElementById('adm-u-tel')?.value || '').trim();
      const status = String(document.getElementById('adm-u-status')?.value || 'ACTIVO').trim().toUpperCase();
      const notasInternas = String(document.getElementById('adm-u-notas')?.value || '');
      if (!nombre) {
        _toast('El nombre es obligatorio.', 'error');
        throw new Error('abort');
      }
      const patch = { nombre, telefono, status, notasInternas };
      if (allowPlaza) patch.plazaAsignada = String(document.getElementById('adm-u-plaza')?.value || '').trim().toUpperCase();
      try {
        await mergeAdminUserBasics(user.id, patch, actorEmail, { allowPlaza });
        _toast('Usuario actualizado.', 'success');
      } catch (e) {
        _toast(e?.message || 'No se pudo guardar.', 'error');
        throw new Error('abort');
      }
    }
  });
  requestAnimationFrame(() => {
    const sel = wrap?.querySelector('#adm-u-plaza');
    if (sel && user.plaza) sel.value = user.plaza;
  });
}

function _openRejectRequestModal(req) {
  const bodyHtml = `
    <p style="margin:0 0 10px;"><strong>${esc(req.nombre || '—')}</strong> · ${esc(req.email || '')}</p>
    <p style="font-size:12px;color:#64748b;margin:0 0 10px;">Plaza solicitada: ${esc(req.plazaSolicitada || '—')} · Rol solicitado: ${esc(req.rolSolicitado || '—')}</p>
    <label style="display:block;margin-bottom:6px;font-size:12px;font-weight:700;color:#334155;">Motivo de rechazo</label>
    <textarea id="adm-sol-motivo" rows="4" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;box-sizing:border-box;font:inherit;">No cumples con los criterios de acceso requeridos en este momento.</textarea>
    <p style="font-size:11px;color:#64748b;margin-top:8px;">Se guarda como en legacy (motivo_rechazo, rechazadoPor…). La bitácora la escribe Cloud Functions.</p>`;
  _openConfirmOverlay({
    title: 'Rechazar solicitud',
    bodyHtml,
    confirmLabel: 'Rechazar',
    danger: true,
    onConfirm: async () => {
      const motivo = String(document.getElementById('adm-sol-motivo')?.value || '').trim();
      if (!motivo) {
        _toast('Escribe un motivo.', 'error');
        throw new Error('abort');
      }
      const api = window.api;
      if (typeof api?.procesarSolicitudAcceso !== 'function') {
        _toast('No hay función de servidor disponible.', 'error');
        throw new Error('abort');
      }
      try {
        await api.procesarSolicitudAcceso({
          action: 'reject',
          docId: req.id,
          collectionName: req.collectionName,
          email: req.email,
          nombre: req.nombre,
          puesto: req.puesto,
          telefono: req.telefono,
          motivo
        });
        _toast('Solicitud rechazada.', 'success');
      } catch (e) {
        const msg = e?.message || String(e);
        _toast(msg, 'error');
        throw new Error('abort');
      }
    }
  });
}

function _openApproveRequestModal(req, { actorRole }) {
  const rm = window._mex?.ACCESS_ROLE_META || {};
  const roleKeys = (Array.isArray(_state.roles) && _state.roles.length)
    ? _state.roles.map(r => r.key)
    : Object.keys(rm).length ? Object.keys(rm) : ['AUXILIAR', 'VENTAS', 'SUPERVISOR'];
  const plazaOpts = (Array.isArray(_state.plazas) ? _state.plazas : []).map(p => `<option value="${escAttr(p.id)}">${esc(p.name || p.id)}</option>`).join('');

  const loadAndShow = async () => {
    const deep = await fetchAccessRequestDocDeep(req.id, req.collectionName);
    if (!deep?.data) {
      _toast('No se encontró la solicitud o sin permiso de lectura.', 'error');
      return;
    }
    const d = deep.data;
    const nombre0 = String(d.nombre || req.nombre || '').trim();
    const telefono0 = String(d.telefono || req.telefono || '').trim();
    const puesto0 = String(d.puesto || req.puesto || '').trim();
    const rol0 = _sanitizeRolePick(d.rolSolicitado || d.requestedRole || req.rolSolicitado);
    const plaza0 = String(d.plazaSolicitada || d.requestedPlaza || req.plazaSolicitada || '').trim().toUpperCase();
    const pwd = String(d.password || '').trim();
    const passOk = pwd.length >= 6;
    const warn = passOk ? '' : '<p style="color:#b45309;font-size:12px;font-weight:700;margin:8px 0;">La contraseña temporal de la solicitud ya no es válida o falta: la aprobación con alta de cuenta debe hacerse en <a href="/gestion?tab=solicitudes">admin legacy</a>.</p>';

    const bodyHtml = `
      ${warn}
      <div style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:12px;font-size:12px;color:#334155;">
        <div><strong>Resumen</strong></div>
        <div>Nombre: ${esc(nombre0 || '—')}</div>
        <div>Email: ${esc(String(d.email || req.email || '').toLowerCase())}</div>
        <div>Plaza solicitada: ${esc(plaza0 || '—')}</div>
        <div>Rol solicitado: ${esc(rol0)}</div>
        <div>Acción: <strong>aprobar acceso</strong> (Cloud Function + bitácora)</div>
      </div>
      <label style="display:block;margin-bottom:6px;font-size:12px;font-weight:700;color:#334155;">Nombre final</label>
      <input id="adm-apr-nombre" type="text" value="${escAttr(nombre0)}" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:10px;box-sizing:border-box;font:inherit;" />
      <label style="display:block;margin-bottom:6px;font-size:12px;font-weight:700;color:#334155;">Teléfono</label>
      <input id="adm-apr-tel" type="text" value="${escAttr(telefono0)}" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:10px;box-sizing:border-box;font:inherit;" />
      <label style="display:block;margin-bottom:6px;font-size:12px;font-weight:700;color:#334155;">Rol asignado</label>
      <select id="adm-apr-role" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:10px;font:inherit;">
        ${_roleOptionsForActor(actorRole, rol0, roleKeys)}
      </select>
      <div id="adm-apr-plaza-wrap">
        <label style="display:block;margin-bottom:6px;font-size:12px;font-weight:700;color:#334155;">Plaza asignada</label>
        <select id="adm-apr-plaza" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:10px;font:inherit;"><option value="">—</option>${plazaOpts}</select>
      </div>
      <p style="font-size:11px;color:#64748b;">Correo no se cambia. La contraseña temporal no se muestra ni se regenera aquí.</p>`;

    const wrap = _openConfirmOverlay({
      title: 'Aprobar solicitud',
      bodyHtml,
      confirmLabel: 'Aprobar',
      onConfirm: async () => {
        if (!passOk) {
          _toast('Completa la aprobación en admin legacy (contraseña inválida).', 'error');
          throw new Error('abort');
        }
        const nombre = String(document.getElementById('adm-apr-nombre')?.value || '').trim().toUpperCase();
        const telefono = String(document.getElementById('adm-apr-tel')?.value || '').trim();
        const role = _sanitizeRolePick(document.getElementById('adm-apr-role')?.value);
        const plaza = String(document.getElementById('adm-apr-plaza')?.value || '').trim().toUpperCase();
        if (!nombre) {
          _toast('El nombre es obligatorio.', 'error');
          throw new Error('abort');
        }
        if (roleNeedsAssignedPlaza(role) && !plaza) {
          _toast('Selecciona plaza para ese rol.', 'error');
          throw new Error('abort');
        }
        const api = window.api;
        if (typeof api?.procesarSolicitudAcceso !== 'function') {
          _toast('No hay función de servidor disponible.', 'error');
          throw new Error('abort');
        }
        try {
          await api.procesarSolicitudAcceso({
            action: 'approve',
            docId: req.id,
            collectionName: deep.collectionName,
            email: String(d.email || req.email || '').toLowerCase(),
            nombre,
            puesto: puesto0,
            telefono,
            role,
            plaza: roleNeedsAssignedPlaza(role) ? plaza : '',
            password: pwd
          });
          _toast('Solicitud aprobada.', 'success');
        } catch (e) {
          let msg = e?.message || String(e);
          if (/contraseña|password|válida/i.test(msg)) {
            msg += ' Usa admin legacy.';
          }
          _toast(msg, 'error');
          throw new Error('abort');
        }
      }
    });
    const syncPlazaRow = () => {
      const roleEl = wrap?.querySelector('#adm-apr-role');
      const plazaWrap = wrap?.querySelector('#adm-apr-plaza-wrap');
      const plazaSel = wrap?.querySelector('#adm-apr-plaza');
      const rk = _sanitizeRolePick(roleEl?.value);
      const need = roleNeedsAssignedPlaza(rk);
      if (plazaWrap) plazaWrap.style.display = need ? '' : 'none';
      if (!need && plazaSel) plazaSel.value = '';
    };
    wrap?.querySelector('#adm-apr-role')?.addEventListener('change', syncPlazaRow);
    requestAnimationFrame(() => {
      const plazaSel = wrap?.querySelector('#adm-apr-plaza');
      if (plazaSel && plaza0) plazaSel.value = plaza0;
      syncPlazaRow();
    });
  };

  loadAndShow();
}

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
  _plazaUnitsCache = new Map();
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
  c.querySelector('#appAdminRolesBody').innerHTML = `<tr><td colspan="5" style="padding:20px;color:#64748b;">Cargando roles...</td></tr>`;
  c.querySelector('#appAdminPlazasBody').innerHTML = `<tr><td colspan="5" style="padding:20px;color:#64748b;">Cargando plazas...</td></tr>`;
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
    c.querySelector('#appAdminRolesBody').innerHTML = `<tr><td colspan="5" style="padding:20px;color:#b91c1c;">${msg}</td></tr>`;
    c.querySelector('#appAdminPlazasBody').innerHTML = `<tr><td colspan="5" style="padding:20px;color:#b91c1c;">${msg}</td></tr>`;
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
  c.querySelector('#adminPlaceholderPane').textContent = '';
  if (_state.tab === 'solicitudes') {
    _subscribeRequestsForCurrentStatus();
  } else {
    _cleanupRequestsSub();
  }
}

function _renderUsersTable() {
  if (_state.tab !== 'usuarios') return _renderTab();
  _renderTab();
  if (!_state.filtered.length) return _setTableBody(`<tr><td colspan="8" style="padding:20px;color:#64748b;">Sin usuarios para el filtro actual.</td></tr>`);
  _setTableBody(_state.filtered.map(u => `
    <tr data-admin-user="${escAttr(u.id)}" style="cursor:pointer;">
      <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(u.nombre || '—')}</td>
      <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(u.email || '—')}</td>
      <td style="padding:8px;border-bottom:1px solid #eef2f7;"><span style="padding:2px 8px;background:#e2e8f0;border-radius:999px;font-size:11px;">${esc(u.rol || '—')}</span></td>
      <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(u.plaza || '—')}</td>
      <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(u.telefono || '—')}</td>
      <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(u.status || 'ACTIVO')}</td>
      <td style="padding:8px;border-bottom:1px solid #eef2f7;">${u.isAdmin ? 'Sí' : 'No'}</td>
      <td style="padding:8px;border-bottom:1px solid #eef2f7;">${u.isGlobal ? 'Sí' : 'No'}</td>
    </tr>`).join(''));
  _ctx.container.querySelectorAll('[data-admin-user]').forEach(row => row.addEventListener('click', () => {
    _state.selectedId = row.dataset.adminUser;
    _syncDetail();
  }));
}

function _syncDetail() {
  const box = _ctx?.container?.querySelector('#appAdminDetail');
  if (!box) return;
  const gs = getState();
  const profile = gs.profile || {};
  const actorRole = String(gs.role || profile.rol || '').toUpperCase();
  const actorEmail = String(profile.email || gs.user?.email || '').trim().toLowerCase();
  const canEdit = canEditUsersBasics(profile, actorRole);
  const allowPlaza = canAssignPlazaAsGlobal(profile, actorRole) && Array.isArray(_state.plazas) && _state.plazas.length > 0;

  const user = _state.filtered.find(u => u.id === _state.selectedId) || _state.filtered[0];
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
      ${user.notasInternas ? _detail('Notas internas', user.notasInternas) : ''}
      ${canEdit ? `<button type="button" id="appAdminEditUserBtn" style="margin-top:12px;width:100%;border:none;border-radius:10px;padding:10px 12px;background:#0f172a;color:#fff;font-weight:800;font-size:12px;cursor:pointer;">Editar datos básicos</button>` : ''}
      <a href="/gestion?tab=usuarios" style="display:inline-block;margin-top:10px;font-size:12px;color:#0f172a;">Abrir admin legacy (completo)</a>
    </div>`;
  const btn = box.querySelector('#appAdminEditUserBtn');
  if (btn) btn.addEventListener('click', () => _openEditUserModal(user, { actorEmail, allowPlaza }));
}

function _renderRoles() {
  const tbody = _ctx?.container?.querySelector('#appAdminRolesBody');
  if (!tbody) return;
  const q = (_state.roleQuery || '').toLowerCase().trim();
  const rows = _state.roles.filter(r => !q || r.name.toLowerCase().includes(q) || r.key.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q));
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:20px;color:#64748b;">Sin roles para el filtro actual.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `<tr data-admin-role="${escAttr(r.key)}" style="cursor:pointer;">
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(r.name)}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(String(r.level || '—'))}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(r.description || '—')}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(String(_state.users.filter(u => u.rol === r.key).length))}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${_permissionGroupChips(r)}</td>
  </tr>`).join('');
  _ctx.container.querySelectorAll('[data-admin-role]').forEach(el => el.addEventListener('click', () => {
    const role = _state.roles.find(r => r.key === el.dataset.adminRole);
    const box = _ctx.container.querySelector('#appAdminRoleDetail');
    if (!box || !role) return;
    const groups = _permissionGroups(role);
    box.innerHTML = `<div style="padding:12px;">
      <h3 style="margin:0 0 8px;color:#0f172a;">${esc(role.name)}</h3>
      ${_detail('Clave', role.key)}
      ${_detail('Nivel', role.level || '—')}
      ${_detail('Usuarios', _state.users.filter(u => u.rol === role.key).length)}
      ${_detail('Permisos', role.permissions?.length || 0)}
      <div style="margin:8px 0;font-size:12px;color:#334155;">${esc(role.description || 'Sin descripción')}</div>
      <div style="margin:10px 0 0;display:grid;gap:6px;">
        ${Object.entries(groups).map(([k, arr]) => `<div style="padding:8px;border:1px solid #e2e8f0;border-radius:8px;background:#fafafa;">
          <div style="font-size:11px;font-weight:800;color:#334155;text-transform:capitalize;">${esc(k)} · ${arr.length}</div>
          <div style="margin-top:4px;font-size:11px;color:#64748b;line-height:1.35;">${arr.length ? esc(arr.join(', ')) : 'Sin permisos del grupo'}</div>
        </div>`).join('')}
      </div>
      <a href="/gestion?tab=roles" style="display:inline-block;margin-top:10px;font-size:12px;color:#0f172a;">Editar matriz/jerarquía en legacy</a>
    </div>`;
  }));
}

function _renderPlazas() {
  const tbody = _ctx?.container?.querySelector('#appAdminPlazasBody');
  if (!tbody) return;
  if (!_state.plazas.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:20px;color:#64748b;">No hay plazas configuradas.</td></tr>`;
    return;
  }
  tbody.innerHTML = _state.plazas.map(p => `<tr data-admin-plaza="${escAttr(p.id)}" style="cursor:pointer;">
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(p.id)}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${esc(p.name || p.id)}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${_state.users.filter(u => u.plaza === p.id).length}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">${p.active ? 'Activa' : 'Inactiva'}</td>
    <td style="padding:8px;border-bottom:1px solid #eef2f7;color:#64748b;font-size:11px;">${esc(p.description || '—')}</td>
  </tr>`).join('');
  _ctx.container.querySelectorAll('[data-admin-plaza]').forEach(el => el.addEventListener('click', async () => {
    const p = _state.plazas.find(x => x.id === el.dataset.adminPlaza);
    const box = _ctx.container.querySelector('#appAdminPlazaDetail');
    if (!box || !p) return;
    box.innerHTML = `<div style="padding:12px;color:#64748b;">Calculando métricas de plaza...</div>`;
    const units = await _fetchPlazaUnitsApprox(p.id);
    box.innerHTML = `<div style="padding:12px;">
      <h3 style="margin:0 0 8px;color:#0f172a;">${esc(p.name || p.id)}</h3>
      ${_detail('ID', p.id)}
      ${_detail('Estado', p.active ? 'Activa' : 'Inactiva')}
      ${_detail('Usuarios', _state.users.filter(u => u.plaza === p.id).length)}
      ${_detail('Unidades patio (aprox.)', units.cuadre)}
      ${_detail('Unidades externas (aprox.)', units.externos)}
      ${_detail('Total unidades (aprox.)', units.total)}
      <div style="margin:8px 0;font-size:12px;color:#334155;">${esc(p.description || 'Sin descripción')}</div>
      <a href="/gestion?tab=plazas" style="font-size:12px;color:#0f172a;">Editar plazas en legacy</a>
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
    <td style="padding:8px;border-bottom:1px solid #eef2f7;">Preview</td>
  </tr>`).join('');
  _ctx.container.querySelectorAll('[data-admin-catalog]').forEach(el => el.addEventListener('click', () => {
    const c = _state.catalogs.find(x => x.id === el.dataset.adminCatalog);
    const box = _ctx.container.querySelector('#appAdminCatalogDetail');
    if (!box || !c) return;
    const preview = (c.items || []).slice(0, 20).map(i => `<li style="font-size:12px;color:#334155;margin-bottom:4px;">${esc(i.name)} ${i.extra ? `<span style="color:#94a3b8;">· ${esc(i.extra)}</span>` : ''}</li>`).join('');
    box.innerHTML = `<div style="padding:12px;">
      <h3 style="margin:0 0 8px;color:#0f172a;">${esc(c.label)}</h3>
      ${_detail('Clave', c.id)}
      ${_detail('Elementos', (c.items || []).length)}
      ${_detail('Sección', c.section || 'general')}
      <ul style="margin:8px 0 0;padding-left:18px;max-height:280px;overflow:auto;">${preview || '<li style="font-size:12px;color:#94a3b8;">Sin elementos</li>'}</ul>
      <a href="/gestion?tab=catalogos" style="font-size:12px;color:#0f172a;">Editar catálogos en legacy</a>
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
  const gs = getState();
  const profile = gs.profile || {};
  const actorRole = String(gs.role || profile.rol || '').toUpperCase();

  const req = _state.requestsFiltered.find(r => r.id === _state.selectedRequestId) || _state.requestsFiltered[0] || _state.requests[0];
  if (!req) return box.innerHTML = `<div style="padding:12px;color:#94a3b8;">Selecciona una solicitud para ver detalle.</div>`;

  const pend = String(req.estado || '').toUpperCase() === 'PENDIENTE';
  const canApr = pend && canApproveAccessRequest(profile, actorRole);
  const canRej = pend && canRejectAccessRequest(profile, actorRole);

  const actions = pend
    ? `<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px;">
        ${canApr ? `<button type="button" id="appAdminReqApprove" style="border:none;border-radius:10px;padding:10px 12px;background:#059669;color:#fff;font-weight:800;font-size:12px;cursor:pointer;">Aprobar</button>` : ''}
        ${canRej ? `<button type="button" id="appAdminReqReject" style="border:none;border-radius:10px;padding:10px 12px;background:#b91c1c;color:#fff;font-weight:800;font-size:12px;cursor:pointer;">Rechazar</button>` : ''}
        ${(!canApr && !canRej) ? '<p style="font-size:11px;color:#64748b;margin:0;">Sin permiso para procesar solicitudes. Usa legacy si aplica.</p>' : ''}
      </div>`
    : `<p style="font-size:11px;color:#64748b;margin-top:8px;">Esta solicitud ya fue resuelta en Firestore.</p>`;

  box.innerHTML = `<div style="padding:12px;">
    <h3 style="margin:0 0 8px;color:#0f172a;">${esc(req.nombre || 'Solicitante')}</h3>
    ${_detail('Email', req.email || '—')}
    ${_detail('Puesto', req.puesto || '—')}
    ${_detail('Plaza solicitada', req.plazaSolicitada || '—')}
    ${_detail('Rol solicitado', req.rolSolicitado || '—')}
    ${_detail('Teléfono', req.telefono || '—')}
    ${_detail('Estado', req.estado || '—')}
    ${_detail('Fecha', req.fecha || '—')}
    ${req.revisadoPor ? _detail('Revisado por', req.revisadoPor) : ''}
    ${req.revisadoEn ? _detail('Revisado en', req.revisadoEn) : ''}
    ${req.comentarioRevision ? _detail('Comentario', req.comentarioRevision) : ''}
    ${_detail('Colección', req.collectionName || 'solicitudes')}
    ${actions}
    <a href="/gestion?tab=solicitudes" style="display:inline-block;margin-top:12px;font-size:12px;color:#0f172a;font-weight:700;">Abrir admin legacy (completo)</a>
  </div>`;

  box.querySelector('#appAdminReqApprove')?.addEventListener('click', () => _openApproveRequestModal(req, { actorRole }));
  box.querySelector('#appAdminReqReject')?.addEventListener('click', () => _openRejectRequestModal(req));
}

function _html(profile = {}) {
  return `
<div style="padding:22px;max-width:1150px;margin:0 auto;font-family:Inter,sans-serif;">
  <h1 style="margin:0 0 10px;color:#0f172a;font-size:26px;">Panel admin</h1>
  <p style="margin:0 0 14px;padding:11px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;font-size:12px;color:#475569;line-height:1.45;">
    Solicitudes y usuarios tienen flujo operativo seguro con confirmación por permisos. Roles, plazas y catálogos muestran datos reales y mantienen edición en legacy para evitar cambios sensibles en esta fase.
  </p>
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
        <table style="width:100%;border-collapse:collapse;min-width:980px;">
          <thead><tr><th style="padding:8px;text-align:left;background:#f8fafc;">Nombre</th><th style="padding:8px;text-align:left;background:#f8fafc;">Email</th><th style="padding:8px;text-align:left;background:#f8fafc;">Rol</th><th style="padding:8px;text-align:left;background:#f8fafc;">Plaza</th><th style="padding:8px;text-align:left;background:#f8fafc;">Teléfono</th><th style="padding:8px;text-align:left;background:#f8fafc;">Estado</th><th style="padding:8px;text-align:left;background:#f8fafc;">Admin</th><th style="padding:8px;text-align:left;background:#f8fafc;">Global</th></tr></thead>
          <tbody id="appAdminUsersBody"></tbody>
        </table>
      </div>
    </div>
    <aside id="appAdminDetail" style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;"></aside>
  </div>
  <div id="adminRolesPane" style="display:none;grid-template-columns:minmax(0,1fr) 320px;gap:12px;">
    <div style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:10px;">
      <p style="margin:0 0 10px;font-size:11px;color:#64748b;">Vista de roles y permisos agrupados para auditoría operativa. Edición de matriz, jerarquía y asignaciones permanece en <a href="/gestion?tab=roles" style="color:#0f172a;font-weight:700;">legacy</a>.</p>
      <div style="overflow:auto;max-height:64vh;border:1px solid #eef2f7;border-radius:8px;">
        <table style="width:100%;border-collapse:collapse;min-width:980px;">
          <thead><tr><th style="padding:8px;text-align:left;background:#f8fafc;">Rol</th><th style="padding:8px;text-align:left;background:#f8fafc;">Nivel</th><th style="padding:8px;text-align:left;background:#f8fafc;">Descripción</th><th style="padding:8px;text-align:left;background:#f8fafc;">Usuarios</th><th style="padding:8px;text-align:left;background:#f8fafc;">Permisos principales</th></tr></thead>
          <tbody id="appAdminRolesBody"></tbody>
        </table>
      </div>
    </div>
    <aside id="appAdminRoleDetail" style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;"></aside>
  </div>
  <div id="adminPlazasPane" style="display:none;grid-template-columns:minmax(0,1fr) 320px;gap:12px;">
    <div style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:10px;">
      <p style="margin:0 0 10px;font-size:11px;color:#64748b;">Resumen real de plazas (estado, usuarios y conteos de unidades aproximados para contexto). Altas y cambios estructurales siguen en <a href="/gestion?tab=plazas" style="color:#0f172a;font-weight:700;">legacy</a>.</p>
      <div style="overflow:auto;max-height:64vh;border:1px solid #eef2f7;border-radius:8px;">
        <table style="width:100%;border-collapse:collapse;min-width:940px;">
          <thead><tr><th style="padding:8px;text-align:left;background:#f8fafc;">ID</th><th style="padding:8px;text-align:left;background:#f8fafc;">Nombre</th><th style="padding:8px;text-align:left;background:#f8fafc;">Usuarios</th><th style="padding:8px;text-align:left;background:#f8fafc;">Estado</th><th style="padding:8px;text-align:left;background:#f8fafc;">Referencia</th></tr></thead>
          <tbody id="appAdminPlazasBody"></tbody>
        </table>
      </div>
    </div>
    <aside id="appAdminPlazaDetail" style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;"></aside>
  </div>
  <div id="adminCatalogosPane" style="display:none;grid-template-columns:minmax(0,1fr) 320px;gap:12px;">
    <div style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:10px;">
      <p style="margin:0 0 10px;font-size:11px;color:#64748b;">Catálogos reales cargados desde configuración activa (estados, ubicaciones, categorías, modelos, gasolinas y extras). Cambios globales se mantienen en <a href="/gestion?tab=catalogos" style="color:#0f172a;font-weight:700;">legacy</a>.</p>
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
      <p style="margin:0 0 10px;font-size:11px;color:#64748b;">Aprobar/rechazar usa la misma Cloud Function que legacy. Si falta contraseña válida en la solicitud, completa el flujo en legacy.</p>
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
