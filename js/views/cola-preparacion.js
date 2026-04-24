import { auth, db, ACCESS_ROLE_META, COL } from '/js/core/database.js';
import { normalizarUnidad } from '/domain/unidad.model.js';

const CHECKLIST_META = [
  { key: 'lavado', label: 'Lavado', hint: 'Interior y exterior listos para entrega', icon: 'cleaning_services' },
  { key: 'gasolina', label: 'Gasolina', hint: 'Nivel operativo validado antes de salida', icon: 'local_gas_station' },
  { key: 'docs', label: 'Documentacion', hint: 'Papeles y expediente disponibles', icon: 'description' },
  { key: 'revision', label: 'Revision mecanica', hint: 'Check visual o mecanico completado', icon: 'build_circle' }
];

const state = {
  user: null,
  profile: null,
  role: '',
  plaza: '',
  plazaOptions: [],
  canSwitchPlaza: false,
  items: [],
  unitsByMva: new Map(),
  plazaUnits: new Map(),
  plazaUsers: [],
  selectedId: '',
  filter: 'all',
  search: '',
  loading: true,
  deleteArmedId: '',
  dragId: '',
  unsubscribeQueue: null
};

function safe(value) {
  return String(value ?? '').trim();
}

function upper(value) {
  return safe(value).toUpperCase();
}

function lower(value) {
  return safe(value).toLowerCase();
}

function escapeHtml(value) {
  return safe(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function unique(values = []) {
  return Array.from(new Set((values || []).map(upper).filter(Boolean)));
}

function roleMeta(role = '') {
  return ACCESS_ROLE_META[upper(role)] || {};
}

function inferRole(data = {}) {
  // Campo explícito en el documento (probamos variantes de nombre)
  const explicit = upper(data.rol || data.role || data.perfil || data.cargo || data.tipo);
  if (explicit) return explicit;
  // Flags específicos de rol (algunos docs los tienen sin campo "rol")
  if (data.isProgramador === true) return 'PROGRAMADOR';
  if (data.isJefeOperacion === true) return 'JEFE_OPERACION';
  if (data.isJefeRegional === true) return 'JEFE_REGIONAL';
  if (data.isGerentePlaza === true) return 'GERENTE_PLAZA';
  if (data.isJefePatio === true) return 'JEFE_PATIO';
  if (data.isSupervisor === true) return 'SUPERVISOR';
  if (data.isGlobal === true) return 'CORPORATIVO_USER';
  if (data.isAdmin === true) return 'VENTAS';
  return 'AUXILIAR';
}

function getConfigPlazas() {
  const empresa = window.MEX_CONFIG?.empresa || {};
  const direct = Array.isArray(empresa.plazas) ? empresa.plazas : [];
  const detailed = Array.isArray(empresa.plazasDetalle) ? empresa.plazasDetalle.map(item => item?.id) : [];
  return unique([...direct, ...detailed]);
}

function readQueryPlaza() {
  const params = new URLSearchParams(window.location.search);
  return upper(params.get('plaza'));
}

function writeQueryPlaza(plaza = '') {
  const params = new URLSearchParams(window.location.search);
  if (plaza) params.set('plaza', plaza);
  else params.delete('plaza');
  const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
  window.history.replaceState({}, '', next);
}

function readGlobalPlaza() {
  return upper(window.getMexCurrentPlaza?.() || window.__mexCurrentPlazaId || '');
}

function writeGlobalPlaza(plaza = '') {
  const normalized = upper(plaza);
  if (typeof window.setMexCurrentPlaza === 'function') {
    return upper(window.setMexCurrentPlaza(normalized, { source: 'cola-preparacion' }));
  }
  window.__mexCurrentPlazaId = normalized;
  return normalized;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') {
    const parsed = value.toDate();
    return Number.isNaN(parsed?.getTime?.()) ? null : parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function nowMs() {
  return Date.now();
}

function checklistDefaults(raw = {}) {
  return {
    lavado: raw.lavado === true,
    gasolina: raw.gasolina === true,
    docs: raw.docs === true,
    revision: raw.revision === true
  };
}

function normalizeItem(doc) {
  const raw = doc?.data ? doc.data() : doc || {};
  const checklist = checklistDefaults(raw.checklist || raw);
  const fechaSalida = toDate(raw.fechaSalida);
  const orden = Number(raw.orden);
  return {
    id: safe(doc?.id || raw.mva || raw.id),
    mva: upper(raw.mva || doc?.id || raw.id),
    fechaSalida,
    checklist,
    asignado: safe(raw.asignado),
    notas: safe(raw.notas),
    creadoAt: toDate(raw.creadoAt),
    actualizadoAt: toDate(raw.actualizadoAt),
    orden: Number.isFinite(orden) ? orden : null
  };
}

function normalizeProfile(user, data = {}) {
  const email = lower(data.email || user?.email);
  const role = inferRole(data || {});
  return {
    email,
    nombre: safe(data.nombre || data.usuario || user?.displayName || email || 'USUARIO'),
    rol: role,
    plazaAsignada: upper(data.plazaAsignada || data.plaza || ''),
    plazasPermitidas: unique(data.plazasPermitidas || []),
    isAdmin: data.isAdmin === true || roleMeta(role).isAdmin === true,
    isGlobal: data.isGlobal === true || roleMeta(role).isGlobal === true
  };
}

function normalizeQueueUnit(raw = {}, source = '') {
  const unit = normalizarUnidad({
    id: raw.id || raw.mva,
    ...raw
  });
  return {
    ...unit,
    origen: source === COL.EXTERNOS ? 'EXTERNO' : 'PATIO'
  };
}

function countdownLabel(date) {
  if (!date) return 'Sin fecha';
  const deltaMs = date.getTime() - nowMs();
  const deltaHours = Math.round(deltaMs / 3600000);
  if (deltaMs < 0) return 'Salida vencida';
  if (deltaHours <= 1) return 'Sale en menos de 1h';
  if (deltaHours < 24) return `Sale en ${deltaHours}h`;
  const days = Math.floor(deltaHours / 24);
  const hours = deltaHours % 24;
  if (!days) return `Sale en ${deltaHours}h`;
  return hours ? `Sale en ${days}d ${hours}h` : `Sale en ${days}d`;
}

function departureLabel(date) {
  if (!date) return 'Fecha sin programar';
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function checklistProgress(item) {
  const total = CHECKLIST_META.length;
  const done = CHECKLIST_META.reduce((acc, meta) => acc + (item?.checklist?.[meta.key] ? 1 : 0), 0);
  return {
    total,
    done,
    percent: total ? Math.round((done / total) * 100) : 0
  };
}

function isReady(item) {
  return checklistProgress(item).done === CHECKLIST_META.length;
}

function urgencyType(item) {
  const date = item?.fechaSalida;
  if (!date) return 'pending';
  const delta = date.getTime() - nowMs();
  if (delta <= 24 * 3600000) return 'urgent';
  if (isReady(item)) return 'ready';
  return 'pending';
}

function matchesFilter(item) {
  if (state.filter === 'all') return true;
  if (state.filter === 'urgent') return urgencyType(item) === 'urgent';
  if (state.filter === 'pending') return !isReady(item);
  if (state.filter === 'ready') return isReady(item);
  if (state.filter === 'mine') {
    const mine = lower(state.profile?.email || '');
    const assigned = lower(item.asignado);
    return assigned && (assigned.includes(mine) || assigned.includes(lower(state.profile?.nombre)));
  }
  return true;
}

function matchesSearch(item, unit) {
  const term = lower(state.search);
  if (!term) return true;
  const haystack = [
    item.mva,
    item.asignado,
    item.notas,
    unit?.estado,
    unit?.ubicacion,
    unit?.categoria,
    unit?.modelo,
    unit?.color
  ].map(lower).join(' ');
  return haystack.includes(term);
}

function compareItems(a, b) {
  if (Number.isFinite(a.orden) && Number.isFinite(b.orden) && a.orden !== b.orden) {
    return a.orden - b.orden;
  }
  if (Number.isFinite(a.orden) && !Number.isFinite(b.orden)) return -1;
  if (!Number.isFinite(a.orden) && Number.isFinite(b.orden)) return 1;
  const aTime = a.fechaSalida?.getTime?.() || Number.MAX_SAFE_INTEGER;
  const bTime = b.fechaSalida?.getTime?.() || Number.MAX_SAFE_INTEGER;
  if (aTime !== bTime) return aTime - bTime;
  return a.mva.localeCompare(b.mva, 'es', { sensitivity: 'base' });
}

function updateSummaryValue(id, value, fallback = 'Sin dato') {
  const node = document.getElementById(id);
  if (node) node.textContent = safe(value) || fallback;
}

function queueRef(plaza = state.plaza) {
  return db.collection('cola_preparacion').doc(upper(plaza)).collection('items');
}

function renderUser() {
  const avatar = document.getElementById('prepUserAvatar');
  const name = document.getElementById('prepUserName');
  const meta = document.getElementById('prepUserMeta');
  const roleBadge = document.getElementById('prepUserRole');
  const plazaInput = document.getElementById('prepCreatePlaza');
  if (avatar) avatar.textContent = (state.profile?.nombre || state.profile?.email || 'CP').split(/\s+/).slice(0, 2).map(chunk => chunk[0]).join('').toUpperCase().slice(0, 2);
  if (name) name.textContent = state.profile?.nombre || state.profile?.email || 'Usuario';
  if (meta) meta.textContent = state.plaza || 'Sin plaza asignada';
  if (roleBadge) roleBadge.textContent = state.role || state.profile?.rol || 'Sin rol';
  if (plazaInput) plazaInput.value = state.plaza || '';
}

function renderPlazaSelect() {
  const select = document.getElementById('prepPlazaSelect');
  if (!select) return;
  const options = state.plazaOptions.length ? state.plazaOptions : [''];
  select.innerHTML = options.map(plaza => `<option value="${escapeHtml(plaza)}">${escapeHtml(plaza || 'SIN PLAZA')}</option>`).join('');
  select.value = state.plaza || options[0] || '';
  select.disabled = !state.canSwitchPlaza;
}

function renderStats(filtered = state.items) {
  const total = filtered.length;
  const urgent = filtered.filter(item => urgencyType(item) === 'urgent').length;
  const ready = filtered.filter(isReady).length;
  const progress = total
    ? Math.round(filtered.reduce((acc, item) => acc + checklistProgress(item).percent, 0) / total)
    : 0;
  const boardMeta = document.getElementById('prepBoardMeta');
  const totalEl = document.getElementById('prepStatTotal');
  const urgentEl = document.getElementById('prepStatUrgent');
  const readyEl = document.getElementById('prepStatReady');
  const progressEl = document.getElementById('prepStatProgress');
  if (boardMeta) boardMeta.textContent = total ? `${total} unidad(es) visibles en ${state.plaza}` : `Sin resultados en ${state.plaza || 'sin plaza'}`;
  if (totalEl) totalEl.textContent = String(total);
  if (urgentEl) urgentEl.textContent = String(urgent);
  if (readyEl) readyEl.textContent = String(ready);
  if (progressEl) progressEl.textContent = `${progress}%`;
}

function visibleItems() {
  return state.items
    .slice()
    .sort(compareItems)
    .filter(item => {
      const unit = state.unitsByMva.get(item.mva);
      return matchesFilter(item) && matchesSearch(item, unit);
    });
}

function renderList() {
  const root = document.getElementById('prepList');
  if (!root) return;
  if (state.loading) {
    root.innerHTML = '<div class="prep-skeleton-card"></div><div class="prep-skeleton-card"></div><div class="prep-skeleton-card"></div>';
    return;
  }

  const items = visibleItems();
  renderStats(items);

  if (!items.length) {
    root.innerHTML = `
      <div class="prep-empty-state">
        <span class="material-symbols-outlined">playlist_remove</span>
        <h3>Sin unidades en cola</h3>
        <p>No encontramos salidas pendientes con el filtro actual. Puedes crear una manualmente desde el boton "Nueva salida".</p>
      </div>
    `;
    if (!state.selectedId) renderDetail();
    return;
  }

  if (!items.find(item => item.id === state.selectedId)) {
    state.selectedId = items[0].id;
  }

  root.innerHTML = items.map(item => {
    const unit = state.unitsByMva.get(item.mva) || {};
    const progress = checklistProgress(item);
    const urgency = urgencyType(item);
    const isSelected = item.id === state.selectedId;
    return `
      <article class="prep-list-card ${isSelected ? 'is-selected' : ''}" data-id="${escapeHtml(item.id)}" draggable="true">
        <div class="prep-list-card-head">
          <div class="prep-list-card-meta">
            <div class="prep-drag-handle"><span class="material-symbols-outlined">drag_indicator</span></div>
            <div>
              <div class="prep-mva">${escapeHtml(item.mva)}</div>
              <div class="prep-list-card-submeta">${escapeHtml(unit.modelo || unit.categoria || 'Sin expediente local')}</div>
            </div>
          </div>
          <div class="prep-status-chip ${urgency}">${escapeHtml(countdownLabel(item.fechaSalida))}</div>
        </div>
        <div class="prep-list-card-meta">
          <span class="prep-inline-badge">${escapeHtml(unit.estado || 'Sin estado')}</span>
          <span class="prep-inline-badge">${escapeHtml(unit.ubicacion || 'Sin ubicacion')}</span>
          <span class="prep-inline-badge">${progress.done}/${progress.total} checks</span>
        </div>
        <div class="prep-mini-progress"><span style="width:${progress.percent}%;"></span></div>
        <div class="prep-list-card-footer">
          <span class="prep-list-card-submeta">${escapeHtml(item.asignado || 'Sin responsable')}</span>
          <span class="prep-list-card-submeta">${escapeHtml(departureLabel(item.fechaSalida))}</span>
        </div>
      </article>
    `;
  }).join('');

  root.querySelectorAll('.prep-list-card').forEach(card => {
    card.addEventListener('click', () => {
      state.selectedId = card.dataset.id || '';
      state.deleteArmedId = '';
      renderDetail();
      renderList();
    });
    card.addEventListener('dragstart', event => {
      state.dragId = card.dataset.id || '';
      card.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      state.dragId = '';
      card.classList.remove('is-dragging');
    });
    card.addEventListener('dragover', event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });
    card.addEventListener('drop', async event => {
      event.preventDefault();
      const targetId = card.dataset.id || '';
      if (!state.dragId || !targetId || state.dragId === targetId) return;
      await persistReorder(state.dragId, targetId);
    });
  });
}

function renderChecklist(item) {
  const root = document.getElementById('prepChecklistGrid');
  if (!root) return;
  root.innerHTML = CHECKLIST_META.map(meta => `
    <label class="prep-check-item">
      <input type="checkbox" data-check-key="${escapeHtml(meta.key)}" ${item.checklist?.[meta.key] ? 'checked' : ''}>
      <div class="prep-check-copy">
        <strong>${escapeHtml(meta.label)}</strong>
        <span>${escapeHtml(meta.hint)}</span>
      </div>
    </label>
  `).join('');

  root.querySelectorAll('input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', async () => {
      const key = input.dataset.checkKey;
      if (!key || !state.selectedId) return;
      await patchItem(state.selectedId, {
        [`checklist.${key}`]: input.checked,
        actualizadoAt: firebase.firestore.FieldValue.serverTimestamp(),
        actualizadoPor: state.profile?.email || ''
      }, false);
    });
  });
}

function renderDetail() {
  const item = state.items.find(entry => entry.id === state.selectedId);
  const empty = document.getElementById('prepEmptyDetail');
  const form = document.getElementById('prepDetailForm');
  const deleteBtn = document.getElementById('prepDeleteBtn');
  const resetDeleteBtn = document.getElementById('prepResetDeleteBtn');
  const assignBtn = document.getElementById('prepAssignMeBtn');
  const completeBtn = document.getElementById('prepCompleteChecklistBtn');
  const copyBtn = document.getElementById('prepCopyMvaBtn');

  if (!item) {
    if (empty) empty.style.display = 'flex';
    if (form) form.style.display = 'none';
    if (deleteBtn) {
      deleteBtn.disabled = true;
      deleteBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">delete</span> Eliminar';
    }
    if (resetDeleteBtn) resetDeleteBtn.style.display = 'none';
    if (assignBtn) assignBtn.disabled = true;
    if (completeBtn) completeBtn.disabled = true;
    if (copyBtn) copyBtn.disabled = true;
    updateSummaryValue('prepSummaryModelo', '');
    updateSummaryValue('prepSummaryCategoria', '');
    updateSummaryValue('prepSummaryUbicacion', '');
    updateSummaryValue('prepSummaryOrigen', '');
    return;
  }

  const unit = state.unitsByMva.get(item.mva) || {};
  const progress = checklistProgress(item);
  const deleteArmed = state.deleteArmedId === item.id;

  if (empty) empty.style.display = 'none';
  if (form) form.style.display = 'flex';
  if (assignBtn) assignBtn.disabled = false;
  if (completeBtn) completeBtn.disabled = false;
  if (copyBtn) copyBtn.disabled = false;
  document.getElementById('prepDetailTitle').textContent = item.mva;
  document.getElementById('prepDetailMva').textContent = item.mva;
  document.getElementById('prepDetailUnitMeta').textContent = [
    unit.estado || 'Sin estado',
    unit.ubicacion || 'Sin ubicacion',
    unit.categoria || unit.modelo || 'Sin categoria'
  ].filter(Boolean).join(' · ');
  document.getElementById('prepDetailEta').textContent = countdownLabel(item.fechaSalida);
  document.getElementById('prepDetailProgressLabel').textContent = `${progress.percent}%`;
  document.getElementById('prepDetailProgressFill').style.width = `${progress.percent}%`;
  document.getElementById('prepDepartureInput').value = toDatetimeLocal(item.fechaSalida);
  document.getElementById('prepAssignedInput').value = item.asignado || '';
  document.getElementById('prepNotesInput').value = item.notas || '';
  updateSummaryValue('prepSummaryModelo', unit.modelo || '');
  updateSummaryValue('prepSummaryCategoria', unit.categoria || '');
  updateSummaryValue('prepSummaryUbicacion', unit.ubicacion || '');
  updateSummaryValue('prepSummaryOrigen', unit.origen || (unit.mva ? 'PATIO' : 'Sin expediente'));

  if (deleteBtn) {
    const allowed = canDelete();
    deleteBtn.disabled = !allowed;
    deleteBtn.style.display = allowed ? '' : 'none';
    if (allowed) {
      deleteBtn.innerHTML = deleteArmed
        ? '<span class="material-symbols-outlined" style="font-size:18px;">warning</span> Confirmar borrado'
        : '<span class="material-symbols-outlined" style="font-size:18px;">delete</span> Eliminar';
    }
  }
  if (resetDeleteBtn) resetDeleteBtn.style.display = deleteArmed ? 'inline-flex' : 'none';

  renderChecklist(item);
}

function renderFilters() {
  document.querySelectorAll('.prep-filter-chip').forEach(button => {
    button.classList.toggle('is-active', button.dataset.filter === state.filter);
  });
}

function renderUsersDatalist() {
  const datalist = document.getElementById('prepUsersDatalist');
  if (!datalist) return;
  datalist.innerHTML = state.plazaUsers.map(user => `<option value="${escapeHtml(user.value)}">${escapeHtml(user.label)}</option>`).join('');
}

function renderBulkButton() {
  const btn = document.getElementById('prepBulkCompleteBtn');
  if (!btn) return;
  // Solo visible para roles admin
  btn.style.display = canDelete() ? '' : 'none';
}

function renderAll() {
  renderUser();
  renderPlazaSelect();
  renderUsersDatalist();
  renderFilters();
  renderBulkButton();
  renderList();
  renderDetail();
}

function showToast(message, type = 'info') {
  const stack = document.getElementById('prepToastStack');
  if (!stack) return;
  const icon = type === 'success' ? 'check_circle' : type === 'warning' ? 'warning' : type === 'error' ? 'error' : 'info';
  const toast = document.createElement('div');
  toast.className = `prep-toast ${type}`;
  toast.innerHTML = `
    <div class="prep-toast-icon"><span class="material-symbols-outlined">${icon}</span></div>
    <div>
      <strong>${escapeHtml(message)}</strong>
    </div>
  `;
  stack.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function toDatetimeLocal(date) {
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function fromDatetimeLocal(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function fetchClaimsRole(user) {
  try {
    const token = await user.getIdTokenResult();
    return upper(token.claims?.rol || token.claims?.role || '');
  } catch (_) {
    return '';
  }
}

async function fetchUserProfile(user) {
  const email = lower(user?.email);
  const uid = safe(user?.uid);
  if (!email && !uid) return normalizeProfile(user, {});

  let docData = {};

  if (typeof window.__mexLoadCurrentUserRecord === 'function') {
    const cached = await window.__mexLoadCurrentUserRecord(user).catch(() => null);
    if (cached) docData = { ...cached };
  }

  if (!Object.keys(docData).length && email) {
    const direct = await db.collection('usuarios').doc(email).get();
    if (direct.exists) {
      docData = direct.data();
    } else {
      const query = await db.collection('usuarios').where('email', '==', email).limit(1).get();
      if (!query.empty) docData = query.docs[0].data();
    }
  }

  if (!Object.keys(docData).length && uid) {
    const byUid = await db.collection('usuarios').doc(uid).get();
    if (byUid.exists) docData = byUid.data();
  }

  // Si el documento no tiene rol explícito, intentamos Firebase Auth custom claims
  const hasExplicitRole = upper(docData.rol || docData.role || docData.perfil || docData.cargo || docData.tipo);
  if (!hasExplicitRole) {
    const claimsRole = await fetchClaimsRole(user);
    if (claimsRole) docData = { ...docData, rol: claimsRole };
  }

  return normalizeProfile(user, docData);
}

// ── Permisos por rol ──────────────────────────────────────────
function canDelete() {
  const meta = ACCESS_ROLE_META[state.role] || {};
  return meta.isAdmin === true;
}

function canManageAll() {
  const meta = ACCESS_ROLE_META[state.role] || {};
  return meta.isGlobal === true || state.profile?.isAdmin === true;
}

function isGlobalRole() {
  const meta = ACCESS_ROLE_META[state.role] || {};
  return meta.isGlobal === true;
}

// ── MVA autocomplete desde Firestore ─────────────────────────
async function loadPlazaUnits() {
  if (!state.plaza) {
    state.plazaUnits = new Map();
    renderMvaDatalist();
    return;
  }
  try {
    const [cuadreSnap, externosSnap] = await Promise.all([
      db.collection(COL.CUADRE).where('plaza', '==', state.plaza).limit(500).get(),
      db.collection(COL.EXTERNOS).where('plaza', '==', state.plaza).limit(200).get().catch(() => ({ docs: [] }))
    ]);
    const next = new Map();
    [...cuadreSnap.docs, ...(externosSnap.docs || [])].forEach(doc => {
      const data = doc.data() || {};
      const unit = normalizarUnidad({ id: doc.id, ...data });
      if (unit.mva) next.set(unit.mva, unit);
    });
    state.plazaUnits = next;
    renderMvaDatalist();
  } catch (e) {
    console.warn('[cola-preparacion] loadPlazaUnits', e);
    state.plazaUnits = new Map();
  }
}

function renderMvaDatalist() {
  const dl = document.getElementById('prepMvaDatalist');
  if (!dl) return;
  dl.innerHTML = Array.from(state.plazaUnits.values())
    .map(u => `<option value="${escapeHtml(u.mva)}">${escapeHtml([u.modelo, u.categoria, u.estado].filter(Boolean).join(' · '))}</option>`)
    .join('');
}

function showCreateUnitPreview(mva) {
  const preview = document.getElementById('prepCreateUnitPreview');
  if (!preview) return;
  const unit = state.plazaUnits.get(upper(mva));
  if (!unit || !mva) {
    preview.style.display = 'none';
    preview.innerHTML = '';
    return;
  }
  const chips = [
    unit.modelo    ? `<span class="prep-preview-chip">${escapeHtml(unit.modelo)}</span>` : '',
    unit.categoria ? `<span class="prep-preview-chip">${escapeHtml(unit.categoria)}</span>` : '',
    unit.estado    ? `<span class="prep-preview-chip prep-preview-chip--state">${escapeHtml(unit.estado)}</span>` : '',
    unit.ubicacion ? `<span class="prep-preview-chip prep-preview-chip--loc"><span class="material-symbols-outlined" style="font-size:13px;">place</span>${escapeHtml(unit.ubicacion)}</span>` : '',
  ].filter(Boolean).join('');
  preview.innerHTML = `<div class="prep-preview-found"><span class="material-symbols-outlined" style="font-size:15px;color:#047857;">check_circle</span> Unidad encontrada en expediente</div>${chips}`;
  preview.style.display = 'flex';
}

async function loadPlazaUsers() {
  if (!state.plaza) {
    state.plazaUsers = [];
    renderUsersDatalist();
    return;
  }
  try {
    const [byPlaza, byExtraPlaza] = await Promise.all([
      db.collection('usuarios').where('plazaAsignada', '==', state.plaza).limit(120).get(),
      db.collection('usuarios').where('plazasPermitidas', 'array-contains', state.plaza).limit(120).get().catch(() => ({ docs: [] }))
    ]);
    const merged = new Map();
    [...byPlaza.docs, ...(byExtraPlaza.docs || [])].forEach(doc => {
      const data = doc.data() || {};
      const email = lower(data.email || doc.id);
      const name = safe(data.nombre || data.usuario);
      const key = email || name || doc.id;
      if (!key) return;
      merged.set(key, {
        value: email || name,
        label: [name, email].filter(Boolean).join(' · ')
      });
    });
    state.plazaUsers = Array.from(merged.values()).filter(item => safe(item.value));
  } catch (error) {
    console.warn('[cola-preparacion] plaza users', error);
    state.plazaUsers = [];
  }
  renderUsersDatalist();
}

async function hydrateUnits(items = state.items) {
  const mvas = unique(items.map(item => item.mva));
  if (!mvas.length || !state.plaza) {
    state.unitsByMva = new Map();
    return;
  }

  const next = new Map();

  for (let index = 0; index < mvas.length; index += 10) {
    const chunk = mvas.slice(index, index + 10);
    try {
      const [cuadreSnap, externosSnap] = await Promise.all([
        db.collection(COL.CUADRE).where('plaza', '==', state.plaza).where('mva', 'in', chunk).get(),
        db.collection(COL.EXTERNOS).where('plaza', '==', state.plaza).where('mva', 'in', chunk).get()
      ]);

      cuadreSnap.forEach(doc => {
        const data = doc.data() || {};
        const unit = normalizeQueueUnit({ id: doc.id, ...data }, COL.CUADRE);
        if (unit.mva) next.set(unit.mva, unit);
      });

      externosSnap.forEach(doc => {
        const data = doc.data() || {};
        const unit = normalizeQueueUnit({ id: doc.id, ...data }, COL.EXTERNOS);
        if (!unit.mva || next.has(unit.mva)) return;
        next.set(unit.mva, unit);
      });
    } catch (error) {
      console.warn('[cola-preparacion] chunk query', error);
    }
  }

  state.unitsByMva = next;
}

function applySelectedPlaza(plaza = '') {
  const normalized = upper(plaza);
  if (!normalized || normalized === state.plaza) return;
  state.plaza = normalized;
  state.selectedId = '';
  state.deleteArmedId = '';
  writeGlobalPlaza(normalized);
  writeQueryPlaza(normalized);
  Promise.resolve(window.__mexEnsureConfigLoaded?.(normalized)).catch(() => null);
  renderAll();
  subscribeQueue();
  loadPlazaUsers();
  loadPlazaUnits();
}

async function subscribeQueue() {
  if (typeof state.unsubscribeQueue === 'function') {
    state.unsubscribeQueue();
    state.unsubscribeQueue = null;
  }

  state.loading = true;
  renderAll();

  if (!state.plaza) {
    state.items = [];
    state.loading = false;
    renderAll();
    return;
  }

  state.unsubscribeQueue = queueRef().onSnapshot(async snapshot => {
    state.items = snapshot.docs.map(normalizeItem).sort(compareItems);
    await hydrateUnits(state.items);
    state.loading = false;
    renderAll();
  }, error => {
    console.error('[cola-preparacion] queue snapshot', error);
    state.loading = false;
    showToast('No se pudo cargar la cola de preparacion.', 'error');
    renderAll();
  });
}

async function patchItem(id, patch, notify = true) {
  await queueRef().doc(id).set(patch, { merge: true });
  if (notify) showToast('Item actualizado.', 'success');
}

async function assignSelectedToMe() {
  if (!state.selectedId) return;
  const assignee = lower(state.profile?.email || '') || safe(state.profile?.nombre);
  if (!assignee) {
    showToast('No encontramos tu identidad operativa para asignarte la unidad.', 'warning');
    return;
  }
  await patchItem(state.selectedId, {
    asignado: assignee,
    actualizadoAt: firebase.firestore.FieldValue.serverTimestamp(),
    actualizadoPor: state.profile?.email || ''
  });
}

async function completeSelectedChecklist() {
  if (!state.selectedId) return;
  const checklist = CHECKLIST_META.reduce((acc, meta) => {
    acc[meta.key] = true;
    return acc;
  }, {});
  await patchItem(state.selectedId, {
    checklist,
    actualizadoAt: firebase.firestore.FieldValue.serverTimestamp(),
    actualizadoPor: state.profile?.email || ''
  });
}

async function copySelectedMva() {
  const item = state.items.find(entry => entry.id === state.selectedId);
  if (!item?.mva) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(item.mva);
      showToast(`MVA ${item.mva} copiado.`, 'success');
      return;
    }
  } catch (_) {}
  showToast(`Copia manualmente el MVA ${item.mva}.`, 'warning');
}

async function bulkCompleteChecklist() {
  const visible = visibleItems();
  if (!visible.length) return;
  const notReady = visible.filter(item => !isReady(item));
  if (!notReady.length) {
    showToast('Todas las unidades visibles ya tienen checklist completo.', 'info');
    return;
  }
  const checklist = CHECKLIST_META.reduce((acc, meta) => { acc[meta.key] = true; return acc; }, {});
  const batch = db.batch();
  notReady.forEach(item => {
    batch.set(queueRef().doc(item.id), {
      checklist,
      actualizadoAt: firebase.firestore.FieldValue.serverTimestamp(),
      actualizadoPor: state.profile?.email || ''
    }, { merge: true });
  });
  await batch.commit();
  showToast(`${notReady.length} unidad(es) marcadas como listas.`, 'success');
}

async function deleteItem(id) {
  await queueRef().doc(id).delete();
  state.deleteArmedId = '';
  if (state.selectedId === id) state.selectedId = '';
  showToast('Unidad eliminada de la cola.', 'success');
}

async function persistReorder(sourceId, targetId) {
  const ordered = state.items.slice().sort(compareItems).map(item => item.id);
  const sourceIndex = ordered.indexOf(sourceId);
  const targetIndex = ordered.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  ordered.splice(targetIndex, 0, ordered.splice(sourceIndex, 1)[0]);

  const batch = db.batch();
  ordered.forEach((id, index) => {
    batch.set(queueRef().doc(id), {
      orden: index + 1,
      actualizadoAt: firebase.firestore.FieldValue.serverTimestamp(),
      actualizadoPor: state.profile?.email || ''
    }, { merge: true });
  });
  await batch.commit();
  showToast('Orden actualizado.', 'success');
}

function bindEvents() {
  document.getElementById('prepSearchInput')?.addEventListener('input', event => {
    state.search = safe(event.target.value);
    renderAll();
  });

  document.getElementById('prepPlazaSelect')?.addEventListener('change', event => {
    if (!state.canSwitchPlaza) return;
    applySelectedPlaza(event.target.value);
  });

  document.getElementById('prepFilterRow')?.addEventListener('click', event => {
    const button = event.target.closest('.prep-filter-chip');
    if (!button) return;
    state.filter = safe(button.dataset.filter || 'all');
    renderAll();
  });

  document.getElementById('prepAddBtn')?.addEventListener('click', openCreateModal);
  document.getElementById('prepBulkCompleteBtn')?.addEventListener('click', bulkCompleteChecklist);
  document.getElementById('prepDetailForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const item = state.items.find(entry => entry.id === state.selectedId);
    if (!item) return;
    const departure = fromDatetimeLocal(document.getElementById('prepDepartureInput')?.value || '');
    const assigned = safe(document.getElementById('prepAssignedInput')?.value);
    const notes = safe(document.getElementById('prepNotesInput')?.value);
    await patchItem(item.id, {
      fechaSalida: departure ? firebase.firestore.Timestamp.fromDate(departure) : null,
      asignado: assigned,
      notas: notes,
      actualizadoAt: firebase.firestore.FieldValue.serverTimestamp(),
      actualizadoPor: state.profile?.email || ''
    });
  });

  document.getElementById('prepDeleteBtn')?.addEventListener('click', async () => {
    if (!state.selectedId) return;
    if (state.deleteArmedId !== state.selectedId) {
      state.deleteArmedId = state.selectedId;
      renderDetail();
      return;
    }
    await deleteItem(state.selectedId);
  });

  document.getElementById('prepAssignMeBtn')?.addEventListener('click', () => assignSelectedToMe());
  document.getElementById('prepCompleteChecklistBtn')?.addEventListener('click', () => completeSelectedChecklist());
  document.getElementById('prepCopyMvaBtn')?.addEventListener('click', () => copySelectedMva());

  document.getElementById('prepResetDeleteBtn')?.addEventListener('click', () => {
    state.deleteArmedId = '';
    renderDetail();
  });

  document.getElementById('prepCreateMva')?.addEventListener('input', event => {
    showCreateUnitPreview(event.target.value);
  });

  document.getElementById('prepCreateForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const mva = upper(document.getElementById('prepCreateMva')?.value);
    const departure = fromDatetimeLocal(document.getElementById('prepCreateDeparture')?.value || '');
    const assigned = safe(document.getElementById('prepCreateAssigned')?.value);
    const notes = safe(document.getElementById('prepCreateNotes')?.value);

    if (!state.plaza) {
      showToast('Primero selecciona una plaza operativa.', 'warning');
      return;
    }
    if (!mva) {
      showToast('Captura un MVA valido.', 'warning');
      return;
    }
    if (!departure) {
      showToast('Selecciona la salida programada.', 'warning');
      return;
    }

    const existing = state.items.find(item => item.id === mva || item.mva === mva);
    if (existing) {
      state.selectedId = existing.id;
      closeCreateModal();
      renderAll();
      showToast('Ese MVA ya estaba en la cola. Abri su detalle actual.', 'warning');
      return;
    }

    const maxOrder = state.items.reduce((acc, item) => Math.max(acc, Number(item.orden) || 0), 0);
    await queueRef().doc(mva).set({
      mva,
      fechaSalida: firebase.firestore.Timestamp.fromDate(departure),
      checklist: checklistDefaults({}),
      asignado: assigned,
      notas: notes,
      orden: maxOrder + 1,
      creadoAt: firebase.firestore.FieldValue.serverTimestamp(),
      creadoPor: state.profile?.email || '',
      actualizadoAt: firebase.firestore.FieldValue.serverTimestamp(),
      actualizadoPor: state.profile?.email || ''
    }, { merge: true });

    closeCreateModal();
    state.selectedId = mva;
    showToast('Unidad agregada a la cola.', 'success');
  });
}

function openCreateModal() {
  if (!state.plaza) {
    showToast('Selecciona una plaza antes de crear una salida.', 'warning');
    return;
  }
  const modal = document.getElementById('prepModal');
  if (!modal) return;
  document.getElementById('prepCreateForm')?.reset();
  const departure = new Date(nowMs() + 24 * 3600000);
  document.getElementById('prepCreateDeparture').value = toDatetimeLocal(departure);
  document.getElementById('prepCreatePlaza').value = state.plaza || '';
  modal.style.display = 'flex';
}

function closeCreateModal() {
  const modal = document.getElementById('prepModal');
  if (modal) modal.style.display = 'none';
}

window.__prepCloseCreateModal = closeCreateModal;

async function boot() {
  try {
    await Promise.resolve(window.__mexConfigReadyPromise).catch(() => null);
    bindEvents();

    auth.onAuthStateChanged(async user => {
      if (!user) {
        window.location.replace('/login');
        return;
      }

      state.user = user;
      state.profile = await fetchUserProfile(user);
      state.role = upper(state.profile?.rol);

      if (!state.role) {
        showToast('Tu perfil aun no tiene rol asignado para esta vista.', 'warning');
        return;
      }

      const options = unique([
        state.profile?.plazaAsignada,
        ...(state.profile?.plazasPermitidas || []),
        ...(state.profile?.isGlobal ? getConfigPlazas() : [])
      ]);
      state.plazaOptions = options;
      state.canSwitchPlaza = state.profile?.isGlobal === true || options.length > 1;
      const preferred = unique([
        readQueryPlaza(),
        readGlobalPlaza(),
        state.profile?.plazaAsignada,
        options[0]
      ]);
      state.plaza = preferred.find(plaza => !options.length || options.includes(plaza)) || '';
      if (state.plaza) {
        await Promise.resolve(window.__mexEnsureConfigLoaded?.(state.plaza)).catch(() => null);
        writeGlobalPlaza(state.plaza);
        writeQueryPlaza(state.plaza);
      }

      renderAll();
      await loadPlazaUsers();
      loadPlazaUnits(); // sin await — carga en paralelo, no bloquea
      await subscribeQueue();
    });
  } catch (error) {
    console.error('[cola-preparacion] boot', error);
    showToast('No se pudo iniciar la cola de preparacion.', 'error');
  }
}

boot();
