import { db, COL } from '/js/core/database.js';
import { danoYaDocumentadoEnSalida, rolPuedeCerrarCaso } from '/domain/papeleta.model.js';
import { REPORTE_STATUS } from '/js/app/features/papeletas/papeletas-constants.js';
import { copyStoragePath, deleteStoragePath } from '/js/app/features/papeletas/papeletas-storage.js';
import { cerrarPapeletaHistorial, getPapeleta } from '/js/app/features/papeletas/papeletas-data.js';

function _fv() {
  return window.firebase?.firestore?.FieldValue?.serverTimestamp?.() || new Date();
}

function _col() {
  return db.collection(COL.PAPELETAS_REPORTES);
}

function _plus24h() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

export function subscribeReportesAbiertos({ onData, onError }) {
  return _col()
    .where('status', '==', REPORTE_STATUS.ABIERTO)
    .orderBy('creadoAt', 'desc')
    .limit(100)
    .onSnapshot(
      (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => {
        console.warn('[papeletas_reportes]', err?.message);
        if (onError) onError(err);
        else onData([]);
      }
    );
}

/**
 * Inbox subscription. Filters plaza client-side to avoid composite-index requirements.
 * @param {{ status?: string|null, plazaId?: string, onData: Function, onError?: Function }} opts
 */
export function subscribeReportes({ status = null, plazaId = '', onData, onError }) {
  const handleData = typeof onData === 'function' ? onData : () => {};
  const handleError = typeof onError === 'function' ? onError : null;
  let query = status
    ? _col().where('status', '==', status).orderBy('creadoAt', 'desc').limit(150)
    : _col().orderBy('creadoAt', 'desc').limit(150);

  return query.onSnapshot(
    (snap) => {
      let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const p = String(plazaId || '').toUpperCase().trim();
      if (p) {
        rows = rows.filter((r) => String(r.plazaId || r.plaza || '').toUpperCase().trim() === p);
      }
      handleData(rows);
    },
    (err) => {
      console.warn('[papeletas_reportes]', err?.message);
      if (handleError) handleError(err);
      else handleData([]);
    }
  );
}

export async function getReporte(id) {
  const snap = await _col().doc(String(id)).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

export async function countReportesAbiertosUnidad(unidadId) {
  const snap = await _col()
    .where('unidadId', '==', String(unidadId))
    .where('status', '==', REPORTE_STATUS.ABIERTO)
    .limit(5)
    .get();
  return snap.size;
}

/** Allocates a new reporte document id (for Storage paths before write). */
export function newReporteId() {
  return _col().doc().id;
}

/**
 * Create a damage/missing report. Papeleta is optional (standalone SPA create).
 * @param {object} opts
 * @param {object|null} [opts.papeleta]
 * @param {string} [opts.papeletaId]
 * @param {object|null} [opts.unidad] — { id|unidadId, mva, plazaId|plaza }
 * @param {'dano'|'faltante'} opts.tipo
 * @param {string[]} [opts.zonasNuevas]
 * @param {string[]} [opts.itemsFaltantes]
 * @param {{ placas?: string, vin?: string, danos?: string[] }} [opts.fotos]
 * @param {object[]} [opts.danosMarcados]
 * @param {string} [opts.descripcion]
 * @param {string} [opts.nota]
 * @param {object} [opts.user]
 * @param {string} [opts.id]
 */
export async function crearReporte({
  papeleta = null,
  papeletaId = '',
  unidad = null,
  tipo,
  zonasNuevas = [],
  itemsFaltantes = [],
  fotos = {},
  danosMarcados = [],
  descripcion = '',
  nota = '',
  user,
  id,
}) {
  if (window.mexPerms?.canDo && window.mexPerms.canDo('create_reporte_dano') !== true) {
    throw new Error('No tienes permiso para crear reportes de daños');
  }
  const unidadId = String(unidad?.id || unidad?.unidadId || papeleta?.unidadId || '').trim();
  const mva = String(unidad?.mva || papeleta?.mva || '').trim();
  const plazaId = String(unidad?.plazaId || unidad?.plaza || papeleta?.plazaId || '').trim();
  const papId = String(papeletaId || papeleta?.id || '').trim();

  if (!unidadId && !mva) throw new Error('Unidad requerida');
  if (!tipo || !['dano', 'faltante'].includes(tipo)) throw new Error('Tipo inválido');

  let nuevas = Array.isArray(zonasNuevas) ? [...zonasNuevas] : [];
  let status = REPORTE_STATUS.ABIERTO;
  let motivoDescarte = '';

  // Preexisting-damage auto-discard ONLY when a full papeleta + salida zonas are available
  if (papeleta?.id && tipo === 'dano' && (zonasNuevas || []).length) {
    const zonasSalida = papeleta.zonas || {};
    nuevas = (zonasNuevas || []).filter((z) => !danoYaDocumentadoEnSalida(z, zonasSalida));
    if ((zonasNuevas || []).length > 0 && nuevas.length === 0) {
      status = REPORTE_STATUS.DESCARTADO;
      motivoDescarte = 'Ya documentado en salida';
    }
  }

  const docId = id || _col().doc().id;

  if (status === REPORTE_STATUS.DESCARTADO) {
    await _col().doc(docId).set({
      papeletaId: papId,
      unidadId,
      mva,
      plazaId,
      tipo,
      zonasNuevas: zonasNuevas || [],
      itemsFaltantes: itemsFaltantes || [],
      fotos: fotos || {},
      danosMarcados: Array.isArray(danosMarcados) ? danosMarcados : [],
      descripcion: String(descripcion || nota || '').trim(),
      status,
      creadoAt: _fv(),
      expiresAt: null,
      creadoPor: user?.uid || window._auth?.currentUser?.uid || '',
      motivoDescarte,
    });
    return { id: docId, status, discarded: true };
  }

  if (!fotos?.placas || !fotos?.vin) {
    throw new Error('Foto de placas y VIN son obligatorias para reportes nuevos');
  }
  const danos = Array.isArray(fotos.danos) ? fotos.danos.filter(Boolean) : [];
  if (!danos.length && tipo === 'dano') {
    throw new Error('Se requiere al menos una foto del daño');
  }
  if (tipo === 'faltante' && !(itemsFaltantes || []).length) {
    throw new Error('Indica los ítems faltantes');
  }

  await _col().doc(docId).set({
    papeletaId: papId,
    unidadId,
    mva,
    plazaId,
    tipo,
    zonasNuevas: nuevas,
    itemsFaltantes: itemsFaltantes || [],
    fotos: { placas: fotos.placas, vin: fotos.vin, danos },
    danosMarcados: Array.isArray(danosMarcados) ? danosMarcados : [],
    descripcion: String(descripcion || nota || '').trim(),
    status: REPORTE_STATUS.ABIERTO,
    creadoAt: _fv(),
    expiresAt: _plus24h(),
    creadoPor: user?.uid || window._auth?.currentUser?.uid || '',
    promovidoAPath: '',
  });
  return { id: docId, status: REPORTE_STATUS.ABIERTO, discarded: false };
}

export async function promoverReporte(reporteId) {
  const doc = await _col().doc(reporteId).get();
  if (!doc.exists) throw new Error('Reporte no encontrado');
  const data = doc.data();
  if (data.status !== REPORTE_STATUS.ABIERTO) {
    throw new Error('Solo se pueden promover reportes abiertos');
  }

  const casoId = reporteId;
  const destBase = `papeletas_ventas/${casoId}`;
  const moved = { placas: '', vin: '', danos: [] };

  if (data.fotos?.placas) {
    moved.placas = await copyStoragePath(data.fotos.placas, `${destBase}/placas.jpg`);
  }
  if (data.fotos?.vin) {
    moved.vin = await copyStoragePath(data.fotos.vin, `${destBase}/vin.jpg`);
  }
  const danos = data.fotos?.danos || [];
  for (let i = 0; i < danos.length; i++) {
    const p = await copyStoragePath(danos[i], `${destBase}/dano_${i + 1}.jpg`);
    moved.danos.push(p);
    try { await deleteStoragePath(danos[i]); } catch (_) { /* ignore */ }
  }
  if (data.fotos?.placas) try { await deleteStoragePath(data.fotos.placas); } catch (_) { /* ignore */ }
  if (data.fotos?.vin) try { await deleteStoragePath(data.fotos.vin); } catch (_) { /* ignore */ }

  await _col().doc(reporteId).update({
    status: REPORTE_STATUS.PROMOVIDO,
    fotos: moved,
    promovidoAPath: destBase,
    expiresAt: null,
    promovidoAt: _fv(),
  });
}

export async function cerrarCaso(reporteId, { rol, user } = {}) {
  if (!rolPuedeCerrarCaso(rol)) {
    throw new Error('Solo Supervisor o superior puede cerrar el caso');
  }
  const doc = await _col().doc(reporteId).get();
  if (!doc.exists) throw new Error('Reporte no encontrado');
  const data = doc.data();

  await _col().doc(reporteId).update({
    status: REPORTE_STATUS.CERRADO,
    cerradoAt: _fv(),
    cerradoPor: user?.uid || window._auth?.currentUser?.uid || '',
  });

  const papId = String(data.papeletaId || '').trim();
  if (!papId) return;

  const open = await _col()
    .where('papeletaId', '==', papId)
    .where('status', '==', REPORTE_STATUS.ABIERTO)
    .limit(1)
    .get();

  if (open.empty) {
    const pap = await getPapeleta(papId);
    if (pap && (pap.status === 'en_retorno' || pap.status === 'entregada')) {
      await cerrarPapeletaHistorial(papId, { user });
    }
  }
}
