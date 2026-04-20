import { auth, db, ACCESS_ROLE_META } from '/js/core/database.js';

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
  const role = upper(data.rol || data.role || '');
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

function queueRef(plaza = state.plaza) {
  return db.collection('cola_preparacion').doc(upper(plaza)).collection('items');
}

function unitsRef(plaza = state.plaza) {
  return db.collection('plazas').doc(upper(plaza)).collection('unidades');
}

function renderUser() {
  const avatar = document.getElementById('prepUserAvatar');
  const name = document.getElementById('prepUserName');
  const meta = document.getElementById('prepUserMeta');
  const plazaInput = document.getElementById('prepCreatePlaza');
  if (avatar) avatar.textContent = (state.profile?.nombre || state.profile?.email || 'CP').split(/\s+/).slice(0, 2).map(chunk => chunk[0]).join('').toUpperCase().slice(0, 2);
  if (name) name.textContent = state.profile?.nombre || state.profile?.email || 'Usuario';
  if (meta) meta.textContent = [state.profile?.rol || 'Sin rol', state.plaza || 'Sin plaza'].filter(Boolean).join(' · ');
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
        <span class="material-icons">playlist_remove</span>
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
            <div class="prep-drag-handle"><span class="material-icons">drag_indicator</span></div>
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

  if (!item) {
    if (empty) empty.style.display = 'flex';
    if (form) form.style.display = 'none';
    if (deleteBtn) {
      deleteBtn.disabled = true;
      deleteBtn.innerHTML = '<span class="material-icons" style="font-size:18px;">delete</span> Eliminar';
    }
    if (resetDeleteBtn) resetDeleteBtn.style.display = 'none';
    return;
  }

  const unit = state.unitsByMva.get(item.mva) || {};
  const progress = checklistProgress(item);
  const deleteArmed = state.deleteArmedId === item.id;

  if (empty) empty.style.display = 'none';
  if (form) form.style.display = 'flex';
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

  if (deleteBtn) {
    deleteBtn.disabled = false;
    deleteBtn.innerHTML = deleteArmed
      ? '<span class="material-icons" style="font-size:18px;">warning</span> Confirmar borrado'
      : '<span class="material-icons" style="font-size:18px;">delete</span> Eliminar';
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

function renderAll() {
  renderUser();
  renderPlazaSelect();
  renderUsersDatalist();
  renderFilters();
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
    <div class="prep-toast-icon"><span class="material-icons">${icon}</span></div>
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

async function fetchUserProfile(user) {
  const email = lower(user?.email);
  if (!email) return normalizeProfile(user, {});

  const direct = await db.collection('usuarios').doc(email).get();
  if (direct.exists) return normalizeProfile(user, direct.data());

  const query = await db.collection('usuarios').where('email', '==', email).limit(1).get();
  if (!query.empty) return normalizeProfile(user, query.docs[0].data());

  return normalizeProfile(user, {});
}

async function loadPlazaUsers() {
  if (!state.plaza) {
    state.plazaUsers = [];
    renderUsersDatalist();
    return;
  }
  try {
    const snap = await db.collection('usuarios').where('plazaAsignada', '==', state.plaza).limit(100).get();
    state.plazaUsers = snap.docs.map(doc => {
      const data = doc.data() || {};
      const email = lower(data.email || doc.id);
      const name = safe(data.nombre || data.usuario);
      return {
        value: email || name,
        label: [name, email].filter(Boolean).join(' · ')
      };
    }).filter(item => safe(item.value));
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

  const ref = unitsRef();
  const next = new Map();

  for (let index = 0; index < mvas.length; index += 10) {
    const chunk = mvas.slice(index, index + 10);
    try {
      const snap = await ref.where('mva', 'in', chunk).get();
      snap.forEach(doc => {
        const data = doc.data() || {};
        const key = upper(data.mva || doc.id);
        next.set(key, { id: doc.id, ...data });
      });
    } catch (error) {
      console.warn('[cola-preparacion] chunk query', error);
    }
  }

  const unresolved = mvas.filter(mva => !next.has(mva));
  await Promise.all(unresolved.map(async mva => {
    try {
      const doc = await ref.doc(mva).get();
      if (doc.exists) next.set(mva, { id: doc.id, ...doc.data() });
    } catch (_) {}
  }));

  state.unitsByMva = next;
}

function applySelectedPlaza(plaza = '') {
  const normalized = upper(plaza);
  if (!normalized || normalized === state.plaza) return;
  state.plaza = normalized;
  state.selectedId = '';
  state.deleteArmedId = '';
  writeQueryPlaza(normalized);
  renderAll();
  subscribeQueue();
  loadPlazaUsers();
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

  document.getElementById('prepResetDeleteBtn')?.addEventListener('click', () => {
    state.deleteArmedId = '';
    renderDetail();
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
      state.plaza = unique([readQueryPlaza(), state.profile?.plazaAsignada, options[0]])[0] || '';

      renderAll();
      await loadPlazaUsers();
      await subscribeQueue();
    });
  } catch (error) {
    console.error('[cola-preparacion] boot', error);
    showToast('No se pudo iniciar la cola de preparacion.', 'error');
  }
}

boot();
