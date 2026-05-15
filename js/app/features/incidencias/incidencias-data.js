import { db, COL } from '/js/core/database.js';

const INCIDENCIAS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function normalizePlaza(plaza) {
  return String(plaza || '').toUpperCase().trim();
}

function normalizePriority(value = '') {
  const normalized = String(value || '').toUpperCase().trim();
  if (['CRITICA', 'CRÍTICA', 'URGENTE', 'CRITICO', 'CRÍTICO'].includes(normalized)) return 'CRITICA';
  if (normalized === 'ALTA') return 'ALTA';
  if (normalized === 'BAJA') return 'BAJA';
  return 'MEDIA';
}

function normalizeState(value = '') {
  const normalized = String(value || '').toUpperCase().trim();
  if (normalized === 'RESUELTA' || normalized === 'RESUELTO' || normalized === 'CERRADA' || normalized === 'CERRADO') {
    return 'RESUELTA';
  }
  if (normalized === 'EN_PROCESO' || normalized === 'EN PROCESO') return 'EN_PROCESO';
  return 'PENDIENTE';
}

function normalizeDateField(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function' || typeof value.toMillis === 'function') return value;
  if (typeof value.seconds === 'number') return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeAttachments(data = {}) {
  const fromAdjuntos = Array.isArray(data.adjuntos) ? data.adjuntos : [];
  const fromEvidencias = Array.isArray(data.evidencias) ? data.evidencias : [];
  const fromUrls = Array.isArray(data.evidenciaUrls) ? data.evidenciaUrls.map(url => ({ url })) : [];
  const fromLinks = Array.isArray(data.links) ? data.links : [];
  const fromEnlaces = Array.isArray(data.enlaces) ? data.enlaces : [];
  const merged = [...fromAdjuntos, ...fromEvidencias, ...fromUrls, ...fromLinks, ...fromEnlaces];
  const seen = new Set();
  return merged
    .map(item => {
      if (typeof item === 'string') return { url: item };
      return item && typeof item === 'object' ? item : null;
    })
    .filter(Boolean)
    .filter(item => {
      const key = String(item.path || item.url || item.fileName || '').trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function mapNotaAdminToIncidencia(id, data = {}) {
  const plaza = normalizePlaza(data.plaza || data.plazaID || data.plazaId || '');
  const timestamp = Number(data.timestamp || 0);
  const descripcion = String(data.descripcion || data.nota || '').trim();
  const descripcionHtml = String(data.descripcionHtml || data.notaHtml || data.html || '').trim();
  return {
    id: String(id || data.id || ''),
    legacyNotaId: String(id || data.id || ''),
    plazaID: plaza,
    plaza,
    mva: String(data.mva || data.unidad || '').toUpperCase().trim(),
    titulo: String(data.titulo || '').trim() || 'Nota',
    descripcion,
    descripcionHtml,
    nota: descripcion,
    codigo: String(data.codigo || data.folio || '').trim(),
    tipo: String(data.tipo || 'OTRO').toUpperCase().trim() || 'OTRO',
    prioridad: normalizePriority(data.prioridad),
    estado: normalizeState(data.estado),
    autor: String(data.autor || data.creadoPor || '').trim(),
    creadoPor: String(data.creadoPor || data.autor || '').trim(),
    creadoEn: normalizeDateField(data.creadoEn || data.fecha || data.timestamp || timestamp),
    fecha: data.fecha || '',
    timestamp,
    actualizadoPor: String(data.actualizadoPor || '').trim(),
    actualizadoEn: normalizeDateField(data.actualizadoEn),
    resueltoPor: String(data.quienResolvio || data.resueltoPor || '').trim(),
    resueltoEn: normalizeDateField(data.resueltaEn || data.resueltoEn),
    resueltaEn: data.resueltaEn || data.resueltoEn || '',
    quienResolvio: String(data.quienResolvio || data.resueltoPor || '').trim(),
    solucion: String(data.solucion || '').trim(),
    adjuntos: normalizeAttachments(data),
    evidencias: normalizeAttachments(data),
    source: String(data.source || 'notas_admin').trim() || 'notas_admin',
    version: Number(data.version || 1) || 1,
  };
}

export function normalizeIncidencia(id, data = {}) {
  return mapNotaAdminToIncidencia(id, data);
}

export function subscribeIncidencias({ plaza, onData, onError }) {
  const plazaId = normalizePlaza(plaza);
  const handleData = typeof onData === 'function' ? onData : () => {};
  const handleError = typeof onError === 'function' ? onError : () => {};

  if (!plazaId) {
    handleData([]);
    return () => {};
  }

  const cached = readIncidenciasCache(plazaId);
  if (cached.length) {
    queueMicrotask(() => handleData(cached));
  }

  try {
    if (window.api?.suscribirNotasAdmin && typeof window.api.suscribirNotasAdmin === 'function') {
      return window.api.suscribirNotasAdmin(notas => {
        const rows = Array.isArray(notas) ? notas : [];
        const normalized = rows.map(item => normalizeIncidencia(item?.id, item));
        writeIncidenciasCache(plazaId, normalized);
        handleData(normalized);
      }, plazaId);
    }
  } catch (error) {
    handleError(error);
  }

  try {
    const query = db
      .collection(COL.NOTAS)
      .where('plaza', '==', plazaId)
      .orderBy('timestamp', 'desc');

    return query.onSnapshot(
      snap => {
        const normalized = snap.docs.map(doc => normalizeIncidencia(doc.id, doc.data()));
        writeIncidenciasCache(plazaId, normalized);
        handleData(normalized);
      },
      error => handleError(error)
    );
  } catch (error) {
    handleError(error);
    return () => {};
  }
}

function cacheKey(plaza) {
  return `mex.app.notas-incidencias.${normalizePlaza(plaza)}`;
}

export function readIncidenciasCache(plaza) {
  try {
    const raw = sessionStorage.getItem(cacheKey(plaza)) || localStorage.getItem(cacheKey(plaza));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Date.now() - Number(parsed?.savedAt || 0) > INCIDENCIAS_CACHE_TTL_MS) return [];
    const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
    return rows.map(item => normalizeIncidencia(item?.id, item));
  } catch (_) {
    return [];
  }
}

export function writeIncidenciasCache(plaza, rows = []) {
  try {
    const payload = JSON.stringify({
      savedAt: Date.now(),
      rows: Array.isArray(rows) ? rows.slice(0, 300) : []
    });
    sessionStorage.setItem(cacheKey(plaza), payload);
    localStorage.setItem(cacheKey(plaza), payload);
  } catch (_) {}
}

export async function createIncidencia(payload = {}) {
  const plazaID = normalizePlaza(payload.plazaID || payload.plaza || '');
  const basePayload = {
    ...payload,
    plazaID,
    plaza: plazaID,
    source: payload.source || 'app_shell',
    legacyNotaId: payload.legacyNotaId || '',
    version: Number(payload.version || 1) || 1,
  };

  if (window.api?.guardarNuevaNotaDirecto && typeof window.api.guardarNuevaNotaDirecto === 'function') {
    return window.api.guardarNuevaNotaDirecto(basePayload, payload.autor || payload.creadoPor || 'Sistema');
  }

  const id = String(Date.now());
  await db.collection(COL.NOTAS).doc(id).set({
    timestamp: Date.now(),
    fecha: new Date().toISOString(),
    autor: String(basePayload.autor || basePayload.creadoPor || 'Sistema'),
    titulo: String(basePayload.titulo || 'Nota'),
    prioridad: String(basePayload.prioridad || 'MEDIA').toUpperCase(),
    nota: String(basePayload.descripcion || basePayload.nota || ''),
    descripcion: String(basePayload.descripcion || basePayload.nota || ''),
    descripcionHtml: String(basePayload.descripcionHtml || basePayload.notaHtml || ''),
    notaHtml: String(basePayload.descripcionHtml || basePayload.notaHtml || ''),
    estado: 'PENDIENTE',
    quienResolvio: '',
    solucion: '',
    resueltaEn: '',
    codigo: String(basePayload.codigo || `INC-${id.slice(-6)}`),
    adjuntos: [
      ...(Array.isArray(basePayload.evidencias) ? basePayload.evidencias : []),
      ...(Array.isArray(basePayload.adjuntos) ? basePayload.adjuntos : []),
      ...(Array.isArray(basePayload.links) ? basePayload.links : []),
      ...(Array.isArray(basePayload.enlaces) ? basePayload.enlaces : []),
    ],
    links: Array.isArray(basePayload.links) ? basePayload.links : [],
    enlaces: Array.isArray(basePayload.enlaces) ? basePayload.enlaces : [],
    evidenciaUrls: Array.isArray(basePayload.evidenciaUrls) ? basePayload.evidenciaUrls : [],
    plaza: plazaID,
    plazaID,
    source: basePayload.source,
    legacyNotaId: basePayload.legacyNotaId,
    version: Number(basePayload.version || 1) || 1,
  });
  return 'OK';
}

export async function resolveIncidencia(id, solucion, autor) {
  if (window.api?.resolverNotaDirecto && typeof window.api.resolverNotaDirecto === 'function') {
    return window.api.resolverNotaDirecto(id, solucion, autor);
  }

  await db.collection(COL.NOTAS).doc(String(id)).update({
    estado: 'RESUELTA',
    solucion: String(solucion || ''),
    quienResolvio: String(autor || 'Sistema'),
    resueltaEn: new Date().toISOString(),
  });
  return 'OK';
}

export async function deleteIncidencia(id) {
  if (window.api?.eliminarNotaDirecto && typeof window.api.eliminarNotaDirecto === 'function') {
    return window.api.eliminarNotaDirecto(id);
  }
  await db.collection(COL.NOTAS).doc(String(id)).delete();
  return 'OK';
}
