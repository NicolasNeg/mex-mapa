import { db, COL } from '/js/core/database.js';

function normalizePlaza(plaza) {
  return String(plaza || '').toUpperCase().trim();
}

function normalizePriority(value = '') {
  const normalized = String(value || '').toUpperCase().trim();
  if (['CRITICA', 'CRÍTICA', 'URGENTE', 'CRITICO', 'CRÍTICO'].includes(normalized)) return 'alta';
  if (normalized === 'ALTA') return 'alta';
  if (normalized === 'BAJA') return 'baja';
  return 'media';
}

function normalizeState(value = '') {
  const normalized = String(value || '').toUpperCase().trim();
  if (normalized === 'RESUELTA' || normalized === 'RESUELTO' || normalized === 'CERRADA' || normalized === 'CERRADO') {
    return 'resuelta';
  }
  if (normalized === 'EN_PROCESO' || normalized === 'EN PROCESO') return 'en_proceso';
  return 'abierta';
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
  const merged = [...fromAdjuntos, ...fromEvidencias, ...fromUrls];
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
  return {
    id: String(id || data.id || ''),
    legacyNotaId: String(id || data.id || ''),
    plazaID: plaza,
    plaza,
    mva: String(data.mva || data.unidad || '').toUpperCase().trim(),
    titulo: String(data.titulo || '').trim() || 'Incidencia',
    descripcion: String(data.descripcion || data.nota || '').trim(),
    tipo: String(data.tipo || 'OTRO').toUpperCase().trim() || 'OTRO',
    prioridad: normalizePriority(data.prioridad),
    estado: normalizeState(data.estado),
    autor: String(data.autor || data.creadoPor || '').trim(),
    creadoPor: String(data.creadoPor || data.autor || '').trim(),
    creadoEn: normalizeDateField(data.creadoEn || data.fecha || data.timestamp || timestamp),
    actualizadoPor: String(data.actualizadoPor || '').trim(),
    actualizadoEn: normalizeDateField(data.actualizadoEn),
    resueltoPor: String(data.quienResolvio || data.resueltoPor || '').trim(),
    resueltoEn: normalizeDateField(data.resueltaEn || data.resueltoEn),
    solucion: String(data.solucion || '').trim(),
    evidencias: normalizeAttachments(data),
    source: String(data.source || 'notas_admin').trim(),
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

  try {
    if (window.api?.suscribirNotasAdmin && typeof window.api.suscribirNotasAdmin === 'function') {
      return window.api.suscribirNotasAdmin(notas => {
        const rows = Array.isArray(notas) ? notas : [];
        const normalized = rows.map(item => normalizeIncidencia(item?.id, item));
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
        handleData(normalized);
      },
      error => handleError(error)
    );
  } catch (error) {
    handleError(error);
    return () => {};
  }
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
    titulo: String(basePayload.titulo || 'Incidencia'),
    prioridad: String(basePayload.prioridad || 'MEDIA').toUpperCase(),
    nota: String(basePayload.descripcion || basePayload.nota || ''),
    descripcion: String(basePayload.descripcion || basePayload.nota || ''),
    estado: 'PENDIENTE',
    quienResolvio: '',
    solucion: '',
    resueltaEn: '',
    codigo: String(basePayload.codigo || `INC-${id.slice(-6)}`),
    adjuntos: Array.isArray(basePayload.evidencias) ? basePayload.evidencias : [],
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
