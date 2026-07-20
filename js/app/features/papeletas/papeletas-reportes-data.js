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

export async function countReportesAbiertosUnidad(unidadId) {
  const snap = await _col()
    .where('unidadId', '==', String(unidadId))
    .where('status', '==', REPORTE_STATUS.ABIERTO)
    .limit(5)
    .get();
  return snap.size;
}

/**
 * @param {object} opts
 * @param {object} opts.papeleta
 * @param {'dano'|'faltante'} opts.tipo
 * @param {string[]} opts.zonasNuevas
 * @param {string[]} opts.itemsFaltantes
 * @param {{ placas?: string, vin?: string, danos?: string[] }} opts.fotos paths
 */
/** Allocates a new reporte document id (for Storage paths before write). */
export function newReporteId() {
  return _col().doc().id;
}

export async function crearReporte({
  papeleta,
  tipo,
  zonasNuevas = [],
  itemsFaltantes = [],
  fotos = {},
  user,
  id,
}) {
  if (!papeleta?.id) throw new Error('Papeleta requerida');

  const zonasSalida = papeleta.zonas || {};
  const nuevas = (zonasNuevas || []).filter((z) => !danoYaDocumentadoEnSalida(z, zonasSalida));
  const allDiscarded = tipo === 'dano'
    && (zonasNuevas || []).length > 0
    && nuevas.length === 0;

  const docId = id || _col().doc().id;

  if (allDiscarded) {
    await _col().doc(docId).set({
      papeletaId: papeleta.id,
      unidadId: papeleta.unidadId,
      mva: papeleta.mva || '',
      tipo,
      zonasNuevas: zonasNuevas || [],
      itemsFaltantes: itemsFaltantes || [],
      fotos: fotos || {},
      status: REPORTE_STATUS.DESCARTADO,
      creadoAt: _fv(),
      expiresAt: null,
      creadoPor: user?.uid || window._auth?.currentUser?.uid || '',
      motivoDescarte: 'Ya documentado en salida',
    });
    return { id: docId, status: REPORTE_STATUS.DESCARTADO, discarded: true };
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
    papeletaId: papeleta.id,
    unidadId: papeleta.unidadId,
    mva: papeleta.mva || '',
    plazaId: papeleta.plazaId || '',
    tipo,
    zonasNuevas: nuevas.length ? nuevas : (zonasNuevas || []),
    itemsFaltantes: itemsFaltantes || [],
    fotos: { placas: fotos.placas, vin: fotos.vin, danos },
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

  const open = await _col()
    .where('papeletaId', '==', data.papeletaId)
    .where('status', '==', REPORTE_STATUS.ABIERTO)
    .limit(1)
    .get();

  if (open.empty) {
    const pap = await getPapeleta(data.papeletaId);
    if (pap && (pap.status === 'en_retorno' || pap.status === 'entregada')) {
      await cerrarPapeletaHistorial(data.papeletaId, { user });
    }
  }
}
