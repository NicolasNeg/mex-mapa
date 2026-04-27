// ═══════════════════════════════════════════════════════════
//  /js/app/views/cola-preparacion.js — Vista real App Shell
//  Fase 8A: Cola de preparación funcional dentro del shell.
//
//  Datos: cola_preparacion/{plaza}/items (Firestore onSnapshot)
//  Lifecycle: mount({ container, navigate, shell }) / unmount()
//  Sin auth listeners — perfil viene de App Shell state.
//  DOM scoped via q(id) → container.querySelector('#'+id)
// ═══════════════════════════════════════════════════════════

import { getState, onPlazaChange } from '/js/app/app-state.js';
import { db }         from '/js/core/database.js';

// ── Módulo-level refs (una instancia a la vez) ───────────────
let _unsub     = null;   // listener Firestore activo
let _container = null;   // nodo DOM activo
let _state     = null;   // estado local de esta vista
let _unsubPlaza = null;  // listener de plaza global
let _offGlobalSearch = null;
let _cssInjected = false;
let _queueSubSeq = 0;

// ── Helpers privados ─────────────────────────────────────────
const q   = id  => _container?.querySelector('#' + id) ?? null;
const qs  = sel => _container?.querySelector(sel) ?? null;
const qsa = sel => Array.from(_container?.querySelectorAll(sel) ?? []);

function esc(v) {
  return String(v ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _makeState(plaza) {
  return {
    plaza,
    items:       [],     // todos los docs de Firestore
    filteredItems: [],
    searchQuery: '',
    filterStatus: 'all', // 'all' | 'urgente' | 'listo' | 'en_proceso'
    sortField:   'creadoEn',
    sortDir:     'desc',
    selectedId:  null,
  };
}

// ── Ciclo de vida ────────────────────────────────────────────

export async function mount({ container, navigate, shell }) {
  _doCleanup();
  _container = container;

  _ensureCss();

  const { profile, role, company, currentPlaza } = getState();
  const plaza = String(currentPlaza || '').toUpperCase().trim();

  _state = _makeState(plaza);
  _state._navigate = navigate;

  container.innerHTML = _skeleton({ profile, role, company, plaza });

  _bindTopBar();
  _bindFilters();
  _bindSort();
  _bindGlobalSearch();

  if (!plaza) {
    _renderEmpty('Selecciona una plaza para ver la cola de preparación.');
  } else {
    _subscribeQueue(plaza);
  }

  _unsubPlaza = onPlazaChange((nextPlaza) => {
    _reloadForPlaza(nextPlaza);
  });
}

export function unmount() {
  _doCleanup();
}

// ── Cleanup ──────────────────────────────────────────────────

function _doCleanup() {
  if (typeof _unsub === 'function') { try { _unsub(); } catch (_) {} }
  if (typeof _unsubPlaza === 'function') { try { _unsubPlaza(); } catch (_) {} }
  if (typeof _offGlobalSearch === 'function') { try { _offGlobalSearch(); } catch (_) {} }
  _unsub     = null;
  _unsubPlaza = null;
  _offGlobalSearch = null;
  _container = null;
  _state     = null;
}

function _closeQueueListener() {
  if (typeof _unsub === 'function') { try { _unsub(); } catch (_) {} }
  _unsub = null;
}

function _reloadForPlaza(nextPlaza) {
  if (!_container || !_state) return;
  const normalized = String(nextPlaza || '').toUpperCase().trim();
  if (normalized === _state.plaza) return;

  _closeQueueListener();
  _state.plaza = normalized;
  _state.items = [];
  _state.filteredItems = [];
  _state.selectedId = null;
  _setTopbarPlaza(normalized);
  _renderLoading();
  _renderStats();

  if (!normalized) {
    _renderEmpty('Selecciona una plaza para ver la cola de preparación.');
    return;
  }
  _subscribeQueue(normalized);
}

// ── CSS injection ────────────────────────────────────────────

function _ensureCss() {
  if (_cssInjected) return;
  if (document.querySelector('link[data-cola-css]')) { _cssInjected = true; return; }
  const link = document.createElement('link');
  link.rel  = 'stylesheet';
  link.href = '/css/cola-preparacion.css';
  link.setAttribute('data-cola-css', '1');
  document.head.appendChild(link);
  _cssInjected = true;
}

// ── Firestore subscription ───────────────────────────────────

function _subscribeQueue(plaza) {
  _renderLoading();
  _closeQueueListener();
  const subscriptionId = ++_queueSubSeq;
  const expectedPlaza = String(plaza || '').toUpperCase().trim();

  try {
    _unsub = db.collection('cola_preparacion').doc(plaza).collection('items')
      .onSnapshot(
        snap => {
          if (!_container || !_state) return;          // desmontado mientras cargaba
          if (subscriptionId !== _queueSubSeq) return; // listener viejo (race condition)
          if (String(_state.plaza || '').toUpperCase().trim() !== expectedPlaza) return;
          _state.items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          _applyFilters();
          _renderList();
          _renderStats();
        },
        err => {
          console.error('[cola-prep] Firestore error:', err);
          if (!_container || !_state) return;
          if (subscriptionId !== _queueSubSeq) return; // listener viejo (race condition)
          if (String(_state.plaza || '').toUpperCase().trim() !== expectedPlaza) return;
          if (String(err?.code || '').toLowerCase() === 'permission-denied') {
            _renderError('No tienes permisos para ver la cola de esta plaza.');
            return;
          }
          _renderError(err.message || 'No se pudo cargar la cola de preparación.');
        }
      );
  } catch (err) {
    console.error('[cola-prep] No se pudo suscribir:', err);
    _renderError(err.message);
  }
}

// ── Filtrado / ordenamiento ──────────────────────────────────

function _applyFilters() {
  if (!_state) return;
  let items = [..._state.items];

  // Búsqueda por texto (MVA o nombre de unidad)
  const q = _state.searchQuery.trim().toLowerCase();
  if (q) {
    items = items.filter(it =>
      String(it.mva || '').toLowerCase().includes(q) ||
      String(it.unidad || '').toLowerCase().includes(q) ||
      String(it.modelo || '').toLowerCase().includes(q)
    );
  }

  // Filtro por estatus
  if (_state.filterStatus !== 'all') {
    items = items.filter(it =>
      String(it.estatus || it.status || '').toLowerCase() === _state.filterStatus
    );
  }

  // Ordenamiento
  const field = _state.sortField;
  const dir   = _state.sortDir === 'asc' ? 1 : -1;
  items.sort((a, b) => {
    const av = _sortVal(a, field);
    const bv = _sortVal(b, field);
    if (av < bv) return -1 * dir;
    if (av > bv) return  1 * dir;
    return 0;
  });

  _state.filteredItems = items;
}

function _sortVal(item, field) {
  const v = item[field];
  if (!v) return '';
  if (v && typeof v.toDate === 'function') return v.toDate().getTime();
  return String(v).toLowerCase();
}

// ── Bind eventos ─────────────────────────────────────────────

function _bindTopBar() {
  // Delegación en la barra superior (data-app-route y data-legacy-route)
  const bar = qs('[data-prep-topbar]');
  if (!bar) return;
  bar.addEventListener('click', e => {
    const ar = e.target.closest('[data-app-route]');
    if (ar && _state?._navigate) {
      e.preventDefault();
      _state._navigate(ar.dataset.appRoute);
    }
  });
}

function _bindGlobalSearch() {
  const handler = event => {
    if (!_state || !_container) return;
    const detailRoute = String(event?.detail?.route || '');
    if (!(detailRoute.startsWith('/app/cola-preparacion') || detailRoute === '/cola-preparacion')) return;
    const query = String(event?.detail?.query || '');
    _state.searchQuery = query;
    _applyFilters();
    _renderList();
    _renderStats();
  };
  window.addEventListener('mex:global-search', handler);
  _offGlobalSearch = () => window.removeEventListener('mex:global-search', handler);
}

function _bindFilters() {
  qsa('[data-prep-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_state) return;
      _state.filterStatus = btn.dataset.prepFilter;
      qsa('[data-prep-filter]').forEach(b => b.classList.toggle('active', b === btn));
      _applyFilters();
      _renderList();
      _renderStats();
    });
  });
}

function _bindSort() {
  const sel = q('prepSortSelect');
  if (!sel) return;
  sel.addEventListener('change', () => {
    if (!_state) return;
    const [field, dir] = sel.value.split(':');
    _state.sortField = field;
    _state.sortDir   = dir;
    _applyFilters();
    _renderList();
  });
}

// ── Renders parciales ────────────────────────────────────────

function _renderLoading() {
  const listEl = q('prepList');
  if (!listEl) return;
  listEl.innerHTML = `
    <div style="padding:40px;text-align:center;color:#94a3b8;">
      <span class="material-symbols-outlined" style="font-size:32px;animation:spin 1s linear infinite;">sync</span>
      <div style="margin-top:10px;font-size:13px;">Cargando unidades…</div>
    </div>`;
}

function _renderError(msg) {
  const listEl = q('prepList');
  if (!listEl) return;
  listEl.innerHTML = `
    <div style="padding:32px;text-align:center;color:#ef4444;">
      <span class="material-symbols-outlined" style="font-size:28px;">error_outline</span>
      <div style="margin-top:8px;font-size:13px;">${esc(msg)}</div>
      <a href="/cola-preparacion" style="display:inline-block;margin-top:16px;font-size:12px;
         color:#2b6954;text-decoration:underline;">Abrir módulo completo</a>
    </div>`;
}

function _renderEmpty(msg = 'Sin unidades para mostrar.') {
  const listEl = q('prepList');
  if (!listEl) return;
  listEl.innerHTML = `
    <div style="padding:40px;text-align:center;color:#94a3b8;">
      <span class="material-symbols-outlined" style="font-size:36px;">fact_check</span>
      <div style="margin-top:10px;font-size:13px;">${esc(msg)}</div>
    </div>`;
}

function _setTopbarPlaza(plaza = '') {
  const badge = q('prepTopbarPlaza');
  if (!badge) return;
  if (!plaza) {
    badge.textContent = '';
    badge.style.display = 'none';
    return;
  }
  badge.textContent = plaza;
  badge.style.display = 'inline-flex';
}

function _renderStats() {
  if (!_state) return;
  const items = _state.items;          // stats sobre todos, no filtrados

  const total    = items.length;
  const urgentes = items.filter(it => _isUrgente(it)).length;
  const listos   = items.filter(it => _isListo(it)).length;
  const progreso = total > 0 ? Math.round((listos / total) * 100) : 0;

  _setText('prepStatTotal',    String(total));
  _setText('prepStatUrgent',   String(urgentes));
  _setText('prepStatReady',    String(listos));
  _setText('prepStatProgress', `${progreso}%`);

  const bar = q('prepProgressBar');
  if (bar) bar.style.width = `${progreso}%`;
}

function _renderList() {
  if (!_container || !_state) return;
  const listEl = q('prepList');
  if (!listEl) return;

  const items = _state.filteredItems;
  if (!items.length) {
    _renderEmpty('Sin resultados para los filtros aplicados.');
    return;
  }

  listEl.innerHTML = items.map(it => _itemCard(it)).join('');

  // Bind clicks en tarjetas
  listEl.querySelectorAll('[data-item-id]').forEach(card => {
    card.addEventListener('click', () => {
      _state.selectedId = card.dataset.itemId;
      _showDetail(_state.items.find(i => i.id === _state.selectedId));
    });
  });
}

// ── Tarjeta de item ──────────────────────────────────────────

function _itemCard(it) {
  const estatus  = String(it.estatus || it.status || 'en_proceso');
  const badge    = _statusBadge(estatus);
  const mva      = it.mva   || '—';
  const modelo   = it.modelo || it.unidad || '—';
  const hora     = _formatTs(it.creadoEn || it.createdAt);
  const asignado = it.asignadoA || it.assigned || '';
  const urgente  = _isUrgente(it);

  return `
<div data-item-id="${esc(it.id)}"
     class="prep-card${urgente ? ' prep-card--urgent' : ''}"
     style="background:#fff;border:1px solid ${urgente ? '#fed7aa' : '#f1f5f9'};
            border-radius:12px;padding:14px 16px;cursor:pointer;
            transition:box-shadow .1s,border-color .1s;margin-bottom:8px;"
     onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.06)';this.style.borderColor='#e2e8f0';"
     onmouseout="this.style.boxShadow='none';this.style.borderColor='${urgente ? '#fed7aa' : '#f1f5f9'}';">
  <div style="display:flex;align-items:center;gap:12px;">
    <div style="width:36px;height:36px;border-radius:10px;background:${urgente ? '#fff7ed' : '#f0fdf4'};
                display:flex;align-items:center;justify-content:center;flex-shrink:0;">
      <span class="material-symbols-outlined" style="font-size:18px;color:${urgente ? '#f97316' : '#2b6954'};">
        ${urgente ? 'priority_high' : 'directions_bus'}
      </span>
    </div>
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">
        <span style="font-size:13px;font-weight:700;color:#0f172a;">${esc(mva)}</span>
        ${badge}
      </div>
      <div style="font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${esc(modelo)}${asignado ? ' · ' + esc(asignado) : ''}${hora ? ' · ' + esc(hora) : ''}
      </div>
    </div>
    <span class="material-symbols-outlined" style="font-size:16px;color:#cbd5e1;flex-shrink:0;">chevron_right</span>
  </div>
</div>`;
}

function _statusBadge(estatus) {
  const map = {
    urgente:    ['#fff7ed','#f97316','Urgente'],
    listo:      ['#f0fdf4','#16a34a','Listo'],
    en_proceso: ['#eff6ff','#2563eb','En proceso'],
    completado: ['#f8fafc','#94a3b8','Completado'],
  };
  const [bg, color, label] = map[estatus] || map['en_proceso'];
  return `<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:100px;
                       background:${bg};color:${color};font-size:10px;font-weight:700;">${esc(label)}</span>`;
}

function _isUrgente(it) {
  return String(it.estatus || it.status || '').toLowerCase() === 'urgente' ||
         it.urgente === true || it.urgent === true;
}

function _isListo(it) {
  const s = String(it.estatus || it.status || '').toLowerCase();
  return s === 'listo' || s === 'completado' || it.listo === true;
}

// ── Panel de detalle ─────────────────────────────────────────

function _showDetail(it) {
  const panel = q('prepDetailPanel');
  if (!panel || !it) return;

  panel.innerHTML = `
<div style="padding:20px;">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
    <h3 style="font-size:16px;font-weight:800;color:#0f172a;margin:0;">
      ${esc(it.mva || '—')}
    </h3>
    <button id="prepCloseDetail"
            style="border:none;background:none;cursor:pointer;color:#94a3b8;padding:4px;">
      <span class="material-symbols-outlined" style="font-size:20px;">close</span>
    </button>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;">
    ${_detailRow('Modelo',    it.modelo || it.unidad || '—')}
    ${_detailRow('Estatus',   it.estatus || it.status || '—')}
    ${_detailRow('Plaza',     it.plaza || _state?.plaza || '—')}
    ${_detailRow('Asignado',  it.asignadoA || it.assigned || '—')}
    ${_detailRow('Salida est.',_formatTs(it.horaSalida || it.eta))}
    ${_detailRow('Creado',    _formatTs(it.creadoEn || it.createdAt))}
    ${it.origen    ? _detailRow('Origen',  it.origen) : ''}
    ${it.ubicacion ? _detailRow('Ubic.',   it.ubicacion) : ''}
  </div>

  ${it.notas ? `
  <div style="background:#f8fafc;border-radius:10px;padding:12px;margin-bottom:16px;">
    <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;
                letter-spacing:0.06em;margin-bottom:6px;">Notas</div>
    <div style="font-size:12px;color:#334155;line-height:1.55;">${esc(it.notas)}</div>
  </div>` : ''}

  ${_checklistSection(it)}

  <div style="margin-top:20px;padding-top:16px;border-top:1px solid #f1f5f9;">
    <a href="/cola-preparacion?mva=${esc(it.mva || it.id)}"
       style="display:flex;align-items:center;gap:6px;font-size:12px;color:#2b6954;
              text-decoration:none;font-weight:600;">
      <span class="material-symbols-outlined" style="font-size:16px;">open_in_new</span>
      Ver en módulo completo
    </a>
  </div>
</div>`;

  panel.style.display = 'block';

  const closeBtn = panel.querySelector('#prepCloseDetail');
  if (closeBtn) closeBtn.addEventListener('click', () => {
    panel.style.display = 'none';
    _state.selectedId = null;
  });
}

function _detailRow(label, value) {
  return `
<div style="background:#f8fafc;border-radius:8px;padding:10px 12px;">
  <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;
              letter-spacing:0.05em;margin-bottom:3px;">${esc(label)}</div>
  <div style="font-size:12px;font-weight:600;color:#1e293b;">${esc(String(value ?? '—'))}</div>
</div>`;
}

function _checklistSection(it) {
  const list = it.checklist;
  if (!Array.isArray(list) || !list.length) return '';

  const done  = list.filter(c => c.done || c.completado).length;
  const total = list.length;
  const pct   = Math.round((done / total) * 100);

  return `
<div style="background:#f8fafc;border-radius:10px;padding:12px;">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
    <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;
                letter-spacing:0.06em;">Checklist</div>
    <span style="font-size:11px;font-weight:700;color:#2b6954;">${done}/${total} (${pct}%)</span>
  </div>
  <div style="height:4px;background:#e2e8f0;border-radius:2px;margin-bottom:10px;overflow:hidden;">
    <div style="height:100%;width:${pct}%;background:#22c55e;border-radius:2px;
                transition:width .3s;"></div>
  </div>
  ${list.map(c => `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 0;
                border-bottom:1px solid #f1f5f9;">
      <span class="material-symbols-outlined" style="font-size:16px;
            color:${(c.done||c.completado) ? '#22c55e' : '#cbd5e1'};">
        ${(c.done||c.completado) ? 'check_circle' : 'radio_button_unchecked'}
      </span>
      <span style="font-size:12px;color:${(c.done||c.completado) ? '#64748b' : '#334155'};
                   ${(c.done||c.completado) ? 'text-decoration:line-through;' : ''}">
        ${esc(c.label || c.nombre || c.item || '')}
      </span>
    </div>
  `).join('')}
</div>`;
}

// ── Utilidades ───────────────────────────────────────────────

function _formatTs(ts) {
  if (!ts) return '';
  try {
    const d = (ts && typeof ts.toDate === 'function') ? ts.toDate() : new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function _setText(id, value) {
  const el = q(id);
  if (el) el.textContent = value;
}

// ── Skeleton HTML ────────────────────────────────────────────

function _skeleton({ profile, role, company, plaza }) {
  const name = profile?.nombreCompleto || profile?.nombre || profile?.email || '';

  return `
<div style="display:flex;flex-direction:column;height:100%;font-family:'Inter',sans-serif;">

  <!-- Barra superior de contexto -->
  <div data-prep-topbar style="display:flex;align-items:center;gap:10px;padding:12px 20px;
       border-bottom:1px solid #f1f5f9;background:#fff;flex-shrink:0;">
    <a data-app-route="/app/dashboard" href="/app/dashboard"
       style="display:flex;align-items:center;gap:4px;font-size:12px;color:#64748b;
              text-decoration:none;font-weight:500;cursor:pointer;">
      <span class="material-symbols-outlined" style="font-size:14px;">arrow_back</span>
      Dashboard
    </a>
    <span style="color:#cbd5e1;font-size:12px;">·</span>
    <span style="font-size:12px;font-weight:700;color:#0f172a;">Cola de preparación</span>
    <span id="prepTopbarPlaza" style="margin-left:auto;font-size:11px;font-weight:700;color:#2b6954;
                            padding:3px 10px;background:#dcfce7;border-radius:100px;display:${plaza ? 'inline-flex' : 'none'};">${esc(plaza)}</span>
    <a href="/cola-preparacion"
       style="display:flex;align-items:center;gap:4px;font-size:11px;color:#64748b;
              text-decoration:none;padding:4px 10px;border:1px solid #e2e8f0;border-radius:8px;
              ${plaza ? '' : 'margin-left:auto;'}">
      <span class="material-symbols-outlined" style="font-size:13px;">open_in_new</span>
      Módulo completo
    </a>
  </div>

  <!-- Stats -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#f1f5f9;
              flex-shrink:0;">
    ${_statCell('prepStatTotal',    '—', 'Total',    'list_alt',    '#2563eb','#eff6ff')}
    ${_statCell('prepStatUrgent',   '—', 'Urgentes', 'priority_high','#f97316','#fff7ed')}
    ${_statCell('prepStatReady',    '—', 'Listos',   'check_circle', '#16a34a','#f0fdf4')}
    ${_statCell('prepStatProgress', '—', 'Progreso', 'speed',        '#8b5cf6','#ede9fe')}
  </div>
  <!-- Barra de progreso delgada -->
  <div style="height:3px;background:#f1f5f9;flex-shrink:0;overflow:hidden;">
    <div id="prepProgressBar" style="height:100%;width:0%;background:#22c55e;transition:width .5s;"></div>
  </div>

  <!-- Controles: filtros + sort -->
  <div style="padding:12px 16px;border-bottom:1px solid #f1f5f9;background:#fafafa;
              flex-shrink:0;display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
    <!-- Filtros -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;flex:1;min-width:180px;">
      ${_filterBtn('all',        'Todos',      true)}
      ${_filterBtn('urgente',    'Urgentes',   false)}
      ${_filterBtn('en_proceso', 'En proceso', false)}
      ${_filterBtn('listo',      'Listos',     false)}
    </div>

    <!-- Sort -->
    <select id="prepSortSelect"
            style="border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;
                   font-size:12px;font-family:inherit;color:#334155;background:#fff;outline:none;">
      <option value="creadoEn:desc">Más recientes</option>
      <option value="creadoEn:asc">Más antiguos</option>
      <option value="mva:asc">MVA A→Z</option>
      <option value="estatus:asc">Estatus</option>
    </select>
  </div>

  <!-- Layout: lista + detalle -->
  <div style="display:flex;flex:1;overflow:hidden;">

    <!-- Lista -->
    <div style="flex:1;overflow-y:auto;padding:12px 16px;">
      <div id="prepList"></div>
    </div>

    <!-- Panel de detalle (oculto por defecto) -->
    <div id="prepDetailPanel"
         style="display:none;width:320px;border-left:1px solid #f1f5f9;
                overflow-y:auto;background:#fff;flex-shrink:0;">
    </div>
  </div>

</div>

<style>
@keyframes spin { to { transform: rotate(360deg); } }
[data-prep-filter].active {
  background: #2b6954 !important;
  color: #fff !important;
  border-color: #2b6954 !important;
}
</style>
`;
}

function _statCell(id, value, label, icon, color, bg) {
  return `
<div style="background:#fff;padding:14px 16px;display:flex;align-items:center;gap:12px;">
  <div style="width:36px;height:36px;border-radius:10px;background:${bg};flex-shrink:0;
              display:flex;align-items:center;justify-content:center;">
    <span class="material-symbols-outlined" style="font-size:18px;color:${color};">${icon}</span>
  </div>
  <div>
    <div id="${id}" style="font-size:20px;font-weight:900;color:#0f172a;line-height:1;">${value}</div>
    <div style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;
                letter-spacing:0.06em;margin-top:2px;">${esc(label)}</div>
  </div>
</div>`;
}

function _filterBtn(value, label, active) {
  return `
<button data-prep-filter="${value}"
        class="${active ? 'active' : ''}"
        style="padding:5px 12px;border-radius:8px;border:1px solid #e2e8f0;
               background:${active ? '#2b6954' : '#fff'};
               color:${active ? '#fff' : '#64748b'};
               font-size:11px;font-weight:700;cursor:pointer;
               font-family:inherit;transition:all .1s;">
  ${esc(label)}
</button>`;
}
