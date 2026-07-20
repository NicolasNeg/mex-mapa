import { db, COL } from '/js/core/database.js';
import {
  STATUS,
  createEmptyChecklist,
  createEmptyZonas,
  computeStatusAfterSave,
  puedeEditar,
} from '/domain/papeleta.model.js';

function _fv() {
  return window.firebase?.firestore?.FieldValue?.serverTimestamp?.() || new Date();
}

function _col() {
  return db.collection(COL.PAPELETAS);
}

function _userMeta(user = {}) {
  return {
    uid: user.uid || window._auth?.currentUser?.uid || '',
    nombre: user.nombre
      || user.nombreCompleto
      || user.displayName
      || window.__mexCurrentUserRecord?.nombre
      || window._auth?.currentUser?.displayName
      || '',
  };
}

export function subscribePapeletasPlaza({ plazaId, onData, onError }) {
  let q = _col().orderBy('actualizadoAt', 'desc').limit(200);
  if (plazaId) q = _col().where('plazaId', '==', String(plazaId)).orderBy('actualizadoAt', 'desc').limit(200);
  return q.onSnapshot(
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.warn('[papeletas] subscribe:', err?.message);
      if (onError) onError(err);
      else onData([]);
    }
  );
}

export function subscribePapeleta(id, { onData, onError }) {
  if (!id) return () => {};
  return _col().doc(id).onSnapshot(
    (doc) => {
      if (!doc.exists) onData(null);
      else onData({ id: doc.id, ...doc.data() });
    },
    (err) => {
      console.warn('[papeletas] doc:', err?.message);
      if (onError) onError(err);
    }
  );
}

export async function getPapeleta(id) {
  const doc = await _col().doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export async function getPapeletaActivaByUnidad(unidadId) {
  const snap = await _col()
    .where('unidadId', '==', String(unidadId))
    .where('activoPorUnidad', '==', true)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

/**
 * Crear papeleta. Rechaza si ya hay activa para la unidad.
 * @returns {{ id: string, existing?: object }}
 */
export async function crearPapeleta({ unidad, plazaId, user }) {
  const unidadId = String(unidad?.id || unidad?.unidadId || '').trim();
  if (!unidadId) throw new Error('Unidad requerida');

  const existing = await getPapeletaActivaByUnidad(unidadId);
  if (existing) {
    const err = new Error('Ya existe una papeleta activa para esta unidad');
    err.code = 'ACTIVE_EXISTS';
    err.existing = existing;
    throw err;
  }

  const meta = _userMeta(user);
  const doc = {
    unidadId,
    mva: String(unidad.mva || '').toUpperCase(),
    modelo: String(unidad.modelo || ''),
    placas: String(unidad.placas || '').toUpperCase(),
    color: String(unidad.color || ''),
    vin: String(unidad.vin || '').toUpperCase(),
    plazaId: String(plazaId || unidad.plazaId || '').toUpperCase(),
    status: STATUS.BORRADOR,
    clienteNombre: '',
    checklist: createEmptyChecklist(),
    zonas: createEmptyZonas(),
    zonasTemplateVersion: 1,
    salida: {},
    entrada: {},
    activoPorUnidad: true,
    casoVentasId: '',
    pdfUrl: '',
    creadoPor: meta.uid,
    creadoPorNombre: meta.nombre,
    actualizadoPor: meta.uid,
    creadoAt: _fv(),
    actualizadoAt: _fv(),
  };

  const ref = await _col().add(doc);
  return { id: ref.id };
}

export async function actualizarPapeleta(id, patch, { user } = {}) {
  const current = await getPapeleta(id);
  if (!current) throw new Error('Papeleta no encontrada');
  if (!puedeEditar(current.status)) {
    throw new Error('Papeleta bloqueada (ya entregada)');
  }

  const meta = _userMeta(user);
  const nextZonas = patch.zonas != null ? patch.zonas : current.zonas;
  const nextChecklist = patch.checklist != null ? patch.checklist : current.checklist;
  const status = computeStatusAfterSave({
    status: current.status,
    zonas: nextZonas,
    checklist: nextChecklist,
  });

  const data = {
    ...patch,
    status,
    actualizadoPor: meta.uid,
    actualizadoAt: _fv(),
  };
  await _col().doc(id).update(data);
  return getPapeleta(id);
}

export async function asignarCliente(id, clienteNombre, { user } = {}) {
  const meta = _userMeta(user);
  await _col().doc(id).update({
    clienteNombre: String(clienteNombre || '').trim(),
    actualizadoPor: meta.uid,
    actualizadoAt: _fv(),
  });
}

export async function entregarPapeleta(id, {
  quienEntrega,
  km,
  gas,
  firmaPath,
  user,
} = {}) {
  const current = await getPapeleta(id);
  if (!current) throw new Error('Papeleta no encontrada');
  if (current.status !== STATUS.LISTA) {
    throw new Error('Solo se puede entregar una papeleta en estado lista');
  }
  if (!firmaPath) throw new Error('Firma requerida');

  const meta = _userMeta(user);
  await _col().doc(id).update({
    status: STATUS.ENTREGADA,
    salida: {
      quienEntrega: String(quienEntrega || meta.nombre || ''),
      km: km ?? current.salida?.km ?? null,
      gas: gas ?? current.salida?.gas ?? null,
      firmadoAt: _fv(),
      firmaPath,
      entregadoPorUid: meta.uid,
    },
    actualizadoPor: meta.uid,
    actualizadoAt: _fv(),
  });
  return getPapeleta(id);
}

export async function registrarEntrada(id, {
  quienRecibe,
  km,
  gas,
  notas,
  user,
} = {}) {
  const current = await getPapeleta(id);
  if (!current) throw new Error('Papeleta no encontrada');
  if (current.status !== STATUS.ENTREGADA && current.status !== STATUS.EN_RETORNO) {
    throw new Error('La papeleta debe estar entregada para registrar entrada');
  }

  const meta = _userMeta(user);
  await _col().doc(id).update({
    status: STATUS.EN_RETORNO,
    activoPorUnidad: false,
    entrada: {
      quienRecibe: String(quienRecibe || meta.nombre || ''),
      km: km ?? null,
      gas: gas ?? null,
      notas: String(notas || ''),
      registradoAt: _fv(),
      registradoPorUid: meta.uid,
    },
    actualizadoPor: meta.uid,
    actualizadoAt: _fv(),
  });
  return getPapeleta(id);
}

export async function cerrarPapeletaHistorial(id, { user } = {}) {
  const meta = _userMeta(user);
  await _col().doc(id).update({
    status: STATUS.CERRADA_HISTORIAL,
    activoPorUnidad: false,
    actualizadoPor: meta.uid,
    actualizadoAt: _fv(),
  });
}
