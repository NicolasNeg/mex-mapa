/**
 * Cola de preparación — view model (filtros, urgencia, estadoCola derivado).
 * Pure helpers; no Firestore I/O.
 */

export const CHECKLIST_KEYS = ['lavado', 'gasolina', 'docs', 'revision'];

export const CHECKLIST_META = Object.freeze([
  { key: 'lavado', label: 'Lavado', hint: 'Interior y exterior listos para entrega', icon: 'cleaning_services' },
  { key: 'gasolina', label: 'Gasolina', hint: 'Nivel operativo validado antes de salida', icon: 'local_gas_station' },
  { key: 'docs', label: 'Documentación', hint: 'Papeles y expediente disponibles', icon: 'description' },
  { key: 'revision', label: 'Revisión mecánica', hint: 'Check visual o mecánico completado', icon: 'build_circle' }
]);

export function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') {
    const d = v.toDate();
    return d && !isNaN(d.getTime()) ? d : null;
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function clFromDoc(d) {
  const c = d && typeof d.checklist === 'object' ? d.checklist : d;
  return {
    lavado: c.lavado === true,
    gasolina: c.gasolina === true,
    docs: c.docs === true,
    revision: c.revision === true
  };
}

export function normalizeQueueItem(id, d) {
  const raw = d || {};
  const orden = Number(raw.orden);
  const entregadoAt = toDate(raw.entregadoAt);
  const checklist = clFromDoc(raw);
  const item = {
    id: String(id),
    mva: String(raw.mva || id || '').toUpperCase().trim(),
    plaza: String(raw.plaza || '').toUpperCase().trim(),
    checklist,
    fechaSalida: toDate(raw.fechaSalida),
    asignado: String(raw.asignado || '').trim(),
    notas: String(raw.notas || '').trim(),
    orden: Number.isFinite(orden) ? orden : null,
    origen: String(raw.origen || '').trim(),
    syncCuadre: raw.syncCuadre !== false,
    cuadreSnapshot: raw.cuadreSnapshot && typeof raw.cuadreSnapshot === 'object' ? raw.cuadreSnapshot : null,
    entregadoAt,
    creadoEn: toDate(raw.creadoEn || raw.creadoAt || raw.createdAt),
    creadoAt: raw.creadoAt,
    actualizadoAt: raw.actualizadoAt,
    estadoCola: String(raw.estadoCola || '').trim()
  };
  item.estadoCola = deriveEstadoCola(item);
  return item;
}

export function cpProgress(item) {
  const done = CHECKLIST_KEYS.reduce((a, k) => a + (item?.checklist?.[k] ? 1 : 0), 0);
  return { done, total: 4, percent: Math.round((done / 4) * 100) };
}

export function isItemReady(item) {
  return cpProgress(item).done === 4;
}

/** @returns {'PENDIENTE'|'EN_PROGRESO'|'LISTO'|'ENTREGADO'|'CANCELADO'} */
export function deriveEstadoCola(item) {
  if (!item) return 'PENDIENTE';
  const stored = String(item.estadoCola || '').toUpperCase().trim();
  if (stored === 'CANCELADO') return 'CANCELADO';
  if (item.entregadoAt) return 'ENTREGADO';
  const { done } = cpProgress(item);
  if (done === 0) return 'PENDIENTE';
  if (done === 4) return 'LISTO';
  return 'EN_PROGRESO';
}

export function urgencyType(item) {
  const date = item?.fechaSalida;
  if (!date) return 'pending';
  const delta = date.getTime() - Date.now();
  if (delta <= 24 * 3600000) return 'urgent';
  if (isItemReady(item)) return 'ready';
  return 'pending';
}

export function countdownLabel(date) {
  if (!date) return 'Sin fecha';
  const deltaMs = date.getTime() - Date.now();
  const deltaHours = Math.round(deltaMs / 3600000);
  if (deltaMs < 0) return 'Salida vencida';
  if (deltaHours <= 1) return 'Sale en <1h';
  if (deltaHours < 24) return `Sale en ${deltaHours}h`;
  const days = Math.floor(deltaHours / 24);
  const hours = deltaHours % 24;
  if (!days) return `Sale en ${deltaHours}h`;
  return hours ? `Sale en ${days}d ${hours}h` : `Sale en ${days}d`;
}

export function departureLabel(date) {
  if (!date) return 'Fecha sin programar';
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

export function fromDatetimeLocal(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toDatetimeLocal(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function comparePrepItems(a, b) {
  if (Number.isFinite(a.orden) && Number.isFinite(b.orden) && a.orden !== b.orden) {
    return a.orden - b.orden;
  }
  if (Number.isFinite(a.orden) && !Number.isFinite(b.orden)) return -1;
  if (!Number.isFinite(a.orden) && Number.isFinite(b.orden)) return 1;
  const aTime = a.fechaSalida?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
  const bTime = b.fechaSalida?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
  if (aTime !== bTime) return aTime - bTime;
  return String(a.mva || '').localeCompare(String(b.mva || ''), 'es', { sensitivity: 'base' });
}

function lower(v) {
  return String(v ?? '').trim().toLowerCase();
}

function sortVal(item, field) {
  if (field === 'orden') {
    return Number.isFinite(item.orden) ? item.orden : 999999;
  }
  if (field === 'fechaSalida') {
    const t = item.fechaSalida?.getTime?.();
    return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
  }
  if (field === 'mva') {
    return String(item.mva || '').toLowerCase();
  }
  if (field === 'creadoEn') {
    const v = item.creadoEn;
    if (v instanceof Date) return v.getTime();
    if (v && typeof v.toDate === 'function') return v.toDate().getTime();
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }
  return '';
}

export function matchesPrepFilter(item, filterStatus, profileCtx = {}) {
  const f = filterStatus || 'all';
  if (f === 'all') return true;
  if (f === 'urgent') return urgencyType(item) === 'urgent';
  if (f === 'pending') return !isItemReady(item);
  if (f === 'ready') return isItemReady(item);
  if (f === 'mine') {
    const mine = lower(profileCtx.profileEmail);
    const nick = lower(profileCtx.profileName);
    const assigned = lower(item.asignado);
    return Boolean(
      assigned &&
      ((mine && assigned.includes(mine)) || (nick && assigned.includes(nick)))
    );
  }
  if (f === 'with-date') return Boolean(item?.fechaSalida);
  return true;
}

export function matchesPrepSearch(item, searchQuery, unitsByMva = new Map()) {
  const term = lower(searchQuery);
  if (!term) return true;
  const unit = unitsByMva.get(String(item.mva || '').toUpperCase()) || {};
  const hay = [
    item.mva,
    item.asignado,
    item.notas,
    unit.estado,
    unit.ubicacion,
    unit.categoria,
    unit.modelo,
    unit.color
  ].map(lower).join(' ');
  return hay.includes(term);
}

export function filterAndSortItems(items, {
  filterStatus = 'all',
  searchQuery = '',
  sortField = '__operational',
  sortDir = 'asc',
  profileEmail = '',
  profileName = ''
} = {}, unitsByMva = new Map()) {
  const profileCtx = { profileEmail, profileName };
  let filtered = [...items].filter(
    it => matchesPrepFilter(it, filterStatus, profileCtx) &&
      matchesPrepSearch(it, searchQuery, unitsByMva)
  );

  const dir = sortDir === 'asc' ? 1 : -1;
  if (sortField === '__operational') {
    filtered.sort((a, b) => comparePrepItems(a, b));
  } else {
    filtered.sort((a, b) => {
      const av = sortVal(a, sortField);
      const bv = sortVal(b, sortField);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }
  return filtered;
}

export function canPrepManage(profile = {}, role = '') {
  const r = String(role || profile.rol || profile.role || '').toUpperCase();
  return profile.isAdmin === true || [
    'PROGRAMADOR',
    'JEFE_OPERACION',
    'GERENTE_PLAZA',
    'SUPERVISOR',
    'JEFE_PATIO',
    'COORDINADOR',
    'ADMINISTRADOR',
    'ADMIN'
  ].includes(r);
}

export function canPrepDelete(profile = {}, role = '') {
  return canPrepManage(profile, role);
}

export function computeStats(items) {
  const total = items.length;
  const urgentes = items.filter(it => urgencyType(it) === 'urgent').length;
  const listos = items.filter(it => isItemReady(it)).length;
  const progreso = total > 0
    ? Math.round(items.reduce((acc, it) => acc + cpProgress(it).percent, 0) / total)
    : 0;
  return { total, urgentes, listos, progreso };
}

export function findItemByMva(items, mvaRaw) {
  const mva = String(mvaRaw || '').toUpperCase().trim();
  if (!mva) return null;
  return items.find(it => it.id === mva || String(it.mva || '').toUpperCase() === mva) || null;
}
