/**
 * LISTAS — Solicitudes de acceso: buzón + detalle / aprobar-rechazar.
 */
import { getState } from '/js/app/app-state.js';
import {
  subscribeAdminRequests,
  approveAccessRequest,
  rejectAccessRequest
} from '/js/app/features/admin/admin-requests-data.js';
import {
  canApproveAccessRequest,
  canRejectAccessRequest
} from '/js/app/features/admin/admin-permissions.js';
import { adminSectionPath } from '/js/app/features/admin/admin-nav.js';

const STATUS_TABS = [
  { id: 'PENDIENTE', label: 'Pendientes' },
  { id: 'APROBADA', label: 'Aprobadas' },
  { id: 'RECHAZADA', label: 'Rechazadas' }
];

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

function _prompt(title, text, def = '') {
  if (typeof window.mexPrompt === 'function') return window.mexPrompt(title, text, def);
  const v = window.prompt(`${title}\n${text}`, def);
  return v === null ? null : v;
}

function _confirm(title, text, tipo = 'warning') {
  if (typeof window.mexConfirm === 'function') return window.mexConfirm(title, text, tipo);
  return Promise.resolve(window.confirm(`${title}\n\n${text}`));
}

let _unsub = null;
let _rows = [];
let _selectedId = '';
let _query = '';
let _status = 'PENDIENTE';
let _host = null;
let _navigate = null;

function _actor() {
  const st = getState() || {};
  const profile = st.profile || window.__mexCurrentUserRecord || {};
  const role = String(st.role || profile.rol || profile.role || '').toUpperCase();
  const email = String(st.email || profile.email || window._auth?.currentUser?.email || '').toLowerCase();
  return { profile, role, email };
}

function _canApprove() {
  const { profile, role } = _actor();
  return canApproveAccessRequest(profile, role);
}

function _canReject() {
  const { profile, role } = _actor();
  return canRejectAccessRequest(profile, role);
}

function _normKey(v = '') {
  return String(v || '').trim().toLowerCase();
}

function _resolveSelectedId(raw = '') {
  const key = _normKey(raw);
  if (!key) return '';
  const hit = _rows.find(r => _normKey(r.id) === key || _normKey(r.email) === key);
  return hit ? hit.id : String(raw || '').trim();
}

function _selected() {
  if (!_selectedId) return null;
  const key = _normKey(_selectedId);
  return _rows.find(r => _normKey(r.id) === key || _normKey(r.email) === key) || null;
}

function _filtered() {
  const q = _query.trim().toLowerCase();
  if (!q) return _rows.slice();
  return _rows.filter(r =>
    r.nombre.toLowerCase().includes(q)
    || r.email.toLowerCase().includes(q)
    || r.puesto.toLowerCase().includes(q)
    || r.rolSolicitado.toLowerCase().includes(q)
    || r.plazaSolicitada.toLowerCase().includes(q)
  );
}

function _roValue(text, empty = '—') {
  const v = String(text || '').trim();
  if (!v) return `<div class="adm-field-value is-muted">${esc(empty)}</div>`;
  return `<div class="adm-field-value">${esc(v)}</div>`;
}

function _resubscribe() {
  if (typeof _unsub === 'function') {
    try { _unsub(); } catch (_) {}
  }
  _unsub = subscribeAdminRequests({
    status: _status,
    onData: (rows) => {
      _rows = Array.isArray(rows) ? rows : [];
      if (_selectedId) {
        const next = _resolveSelectedId(_selectedId);
        if (!_rows.some(r => _normKey(r.id) === _normKey(next))) _selectedId = '';
        else _selectedId = next;
      }
      _paint();
    },
    onError: (err) => {
      console.error('[admin-solicitudes]', err);
      if (_host) {
        _host.innerHTML = `
          <div class="adm-empty">
            <span class="material-symbols-outlined">error</span>
            <strong>No se pudieron cargar solicitudes</strong>
            <small>${esc(err?.message || 'Error de red o permisos')}</small>
          </div>`;
      }
    }
  });
}

function _detailHtml(row) {
  const pending = row.estado === 'PENDIENTE';
  const canAp = _canApprove();
  const canRe = _canReject();
  return `
    <div class="adm-detail">
      <div class="adm-detail-hero">
        <span class="adm-avatar adm-avatar--lg" style="${avatarStyle(row.nombre)}">${esc(initials(row.nombre))}</span>
        <div>
          <h3>${esc(row.nombre || 'Sin nombre')}</h3>
          <p>${esc(row.email || 'Sin correo')}</p>
          <div class="adm-pills">
            <span class="adm-pill">${esc(row.estado)}</span>
            <span class="adm-pill">${esc(row.rolSolicitado || 'Sin rol')}</span>
            <span class="adm-pill">${esc(row.plazaSolicitada || 'Sin plaza')}</span>
          </div>
        </div>
      </div>
      <form class="adm-form is-readonly" onsubmit="return false;">
        <label><span>Nombre</span>${_roValue(row.nombre)}</label>
        <label><span>Correo</span>${_roValue(row.email)}</label>
        <label><span>Puesto</span>${_roValue(row.puesto, 'Sin puesto')}</label>
        <label><span>Teléfono</span>${_roValue(row.telefono, 'Sin teléfono')}</label>
        <label><span>Rol solicitado</span>${_roValue(row.rolSolicitado, 'Sin rol')}</label>
        <label><span>Plaza solicitada</span>${_roValue(row.plazaSolicitada, 'Sin plaza')}</label>
        <label class="adm-form-full"><span>Fecha</span>${_roValue(row.fecha, 'Sin fecha')}</label>
        <div class="adm-form-actions">
          ${pending && canRe ? `<button type="button" class="adm-btn danger" data-action="reject-req">Rechazar</button>` : ''}
          ${pending && canAp ? `<button type="button" class="adm-btn primary" data-action="approve-req">Aprobar</button>` : ''}
          ${!pending || (!canAp && !canRe) ? `<span class="adm-pill">Solo lectura</span>` : ''}
        </div>
      </form>
    </div>
  `;
}

function _paint() {
  if (!_host) return;
  const list = _filtered();
  const row = _selected();
  const canProcess = _canApprove() || _canReject();

  _host.innerHTML = `
    <div class="adm-listas">
      <div class="adm-listas-dir">
        <div class="adm-listas-head">
          <div>
            <span class="adm-kicker">Buzón</span>
            <h2>Solicitudes de acceso</h2>
          </div>
          <span class="adm-count">${list.length} visibles</span>
        </div>
        <div class="adm-status-tabs">
          ${STATUS_TABS.map(t => `
            <button type="button" class="adm-status-tab${_status === t.id ? ' is-active' : ''}" data-status="${t.id}">${esc(t.label)}</button>
          `).join('')}
        </div>
        ${!canProcess ? `
          <div class="adm-banner">Vista en solo lectura. Sin permiso para aprobar o rechazar.</div>
        ` : ''}
        <div class="adm-listas-toolbar">
          <label class="adm-search">
            <span class="material-symbols-outlined">search</span>
            <input type="search" id="adm-sol-search" placeholder="Buscar nombre, correo, rol…" value="${esc(_query)}">
          </label>
        </div>
        <div class="adm-cards">
          ${list.length ? list.map(r => {
            const sel = _selected();
            const active = sel && sel.id === r.id ? ' is-active' : '';
            return `
              <button type="button" class="adm-card${active}" data-req-id="${esc(r.id)}">
                <span class="adm-avatar" style="${avatarStyle(r.nombre)}">${esc(initials(r.nombre))}</span>
                <span class="adm-card-copy">
                  <strong>${esc(r.nombre || 'Sin nombre')}</strong>
                  <small>${esc(r.email || '(sin correo)')}</small>
                  <span>${esc(r.puesto || 'Sin puesto')} · ${esc(r.rolSolicitado || 'Sin rol')}</span>
                </span>
              </button>`;
          }).join('') : `
            <div class="adm-empty">
              <span class="material-symbols-outlined">inbox</span>
              <strong>Sin solicitudes</strong>
              <small>No hay elementos en este buzón.</small>
            </div>`}
        </div>
      </div>
      <div class="adm-listas-detail">
        ${row ? _detailHtml(row) : `
          <div class="adm-empty adm-empty--panel">
            <span class="material-symbols-outlined">how_to_reg</span>
            <strong>Selecciona una solicitud</strong>
            <small>El detalle y las acciones aparecen aquí.</small>
          </div>`}
      </div>
    </div>
  `;

  _host.querySelectorAll('[data-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('data-status') || 'PENDIENTE';
      if (next === _status) return;
      _status = next;
      _selectedId = '';
      _query = '';
      _host.innerHTML = `<div class="adm-loading"><span class="material-symbols-outlined">progress_activity</span> Cargando…</div>`;
      _resubscribe();
    });
  });

  _host.querySelector('#adm-sol-search')?.addEventListener('input', (e) => {
    _query = e.target.value || '';
    _paint();
    const input = _host.querySelector('#adm-sol-search');
    if (input) {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  });

  _host.querySelectorAll('[data-req-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      _selectedId = btn.getAttribute('data-req-id') || '';
      if (typeof _navigate === 'function') {
        _navigate(adminSectionPath('solicitudes', _selectedId), { replace: true, soft: true });
      }
      _paint();
    });
  });

  _host.querySelector('[data-action="approve-req"]')?.addEventListener('click', () => _approve());
  _host.querySelector('[data-action="reject-req"]')?.addEventListener('click', () => _reject());
}

async function _approve() {
  const row = _selected();
  if (!row || !_canApprove()) return;
  const ok = await _confirm(
    'Aprobar solicitud',
    `¿Aprobar a ${row.nombre || row.email} como ${row.rolSolicitado || 'AUXILIAR'}${row.plazaSolicitada ? ` en ${row.plazaSolicitada}` : ''}?`,
    'info'
  );
  if (!ok) return;
  try {
    toast('Procesando…', 'info');
    const result = await approveAccessRequest({
      email: row.email || row.id,
      collectionHint: row.collectionName,
      nombre: row.nombre,
      puesto: row.puesto,
      telefono: row.telefono,
      role: row.rolSolicitado || 'AUXILIAR',
      plaza: row.plazaSolicitada
    });
    const setupMessage = result?.passwordSetupRequired
      ? (result.passwordSetupEmailSent
          ? 'Solicitud aprobada. Enviamos el enlace para configurar la contrasena.'
          : 'Solicitud aprobada. El usuario debe usar Recuperar contrasena en Login.')
      : 'Solicitud aprobada.';
    toast(setupMessage, 'success');
    _selectedId = '';
  } catch (err) {
    console.error('[admin-solicitudes] approve:', err);
    toast(err?.message || 'No se pudo aprobar.', 'error');
  }
}

async function _reject() {
  const row = _selected();
  if (!row || !_canReject()) return;
  const motivo = await _prompt(
    `Rechazar solicitud de ${row.nombre || row.email}`,
    'Escribe el motivo del rechazo:',
    'No cumples con los criterios de acceso requeridos.'
  );
  if (motivo === null) return;
  try {
    toast('Procesando…', 'info');
    await rejectAccessRequest({
      email: row.email || row.id,
      collectionHint: row.collectionName,
      motivo: String(motivo || '').trim()
    });
    toast('Solicitud rechazada.', 'success');
    _selectedId = '';
  } catch (err) {
    console.error('[admin-solicitudes] reject:', err);
    toast(err?.message || 'No se pudo rechazar.', 'error');
  }
}

export function mountSolicitudesPanel(host, opts = {}) {
  unmountSolicitudesPanel();
  _host = host;
  _navigate = opts.navigate || null;
  _selectedId = String(opts.entityId || '').trim();
  _query = '';
  _status = 'PENDIENTE';
  _host.innerHTML = `<div class="adm-loading"><span class="material-symbols-outlined">progress_activity</span> Cargando solicitudes…</div>`;
  _resubscribe();
}

export function syncSolicitudesSelection(entityId = '') {
  let raw = String(entityId || '').trim();
  try { raw = decodeURIComponent(raw); } catch (_) { /* keep */ }
  _selectedId = _rows.length ? _resolveSelectedId(raw) : raw;
  _paint();
}

export function unmountSolicitudesPanel() {
  if (typeof _unsub === 'function') {
    try { _unsub(); } catch (_) {}
  }
  _unsub = null;
  _rows = [];
  _selectedId = '';
  _host = null;
  _navigate = null;
}
