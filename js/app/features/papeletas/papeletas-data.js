import { db, COL, ejecutarEliminacion } from '/js/core/database.js';
import { reportProgrammerError } from '/js/core/observability.js';
import {
  STATUS,
  createEmptyChecklist,
  createEmptyZonas,
  createEmptyMarcasLlantas,
  computeStatusAfterSave,
  puedeEditar,
  puedeEntregar,
  isSalidaMutable,
  canAssignCliente,
  canAssignContrato,
  buildCreateProvenance,
  buildTouchProvenance,
  orderInboxGlobal,
} from '/domain/papeleta.model.js';

function _fv() {
  return window.firebase?.firestore?.FieldValue?.serverTimestamp?.() || new Date();
}

function _col() {
  return db.collection(COL.PAPELETAS);
}

function _activasCol() {
  return db.collection(COL.PAPELETAS_ACTIVAS);
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

/**
 * Vocabulario de ubicación post-entrega según tipoNegocio.
 * arrendadora → ARRENDADA; resto (flotilla, default) → RENTADA.
 * estadoFlota canónico sigue siendo EN RENTA.
 */
export function ubicacionRentaLabel(tipoNegocio) {
  const tipo = String(
    tipoNegocio
    || window._empresaActual?.tipoNegocio
    || window.MEX_CONFIG?.empresa?.tipoNegocio
    || ''
  ).toLowerCase().trim();
  return tipo === 'arrendadora' ? 'ARRENDADA' : 'RENTADA';
}

async function _resolvePlazaActualMva(mva, fallbackPlaza = '') {
  const mvaStr = String(mva || '').toUpperCase().trim();
  if (!mvaStr) return String(fallbackPlaza || '').toUpperCase().trim();
  try {
    const snap = await db.collection(COL.INDEX).where('mva', '==', mvaStr).limit(1).get();
    if (!snap.empty) {
      const p = String(snap.docs[0].data()?.plazaActual || '').toUpperCase().trim();
      if (p) return p;
    }
  } catch (_) { /* best-effort */ }
  return String(fallbackPlaza || '').toUpperCase().trim();
}

/**
 * Marca index_unidades: estadoFlota EN RENTA + ubicacion RENTADA|ARRENDADA.
 * No toca master Unidades catalog — solo índice operativo.
 */
async function _marcarIndexRentada(mva, ubicacionLabel) {
  const mvaStr = String(mva || '').toUpperCase().trim();
  if (!mvaStr) return false;
  const snap = await db.collection(COL.INDEX).where('mva', '==', mvaStr).limit(1).get();
  if (snap.empty) return false;
  const label = String(ubicacionLabel || 'RENTADA').toUpperCase();
  await snap.docs[0].ref.set({
    estadoFlota: 'EN RENTA',
    estado: 'EN RENTA',
    ubicacion: label,
  }, { merge: true });
  return true;
}

async function _persistSideEffectsMeta(papeletaId, meta) {
  if (!papeletaId) return;
  try {
    await _col().doc(papeletaId).update({
      entregaSideEffects: {
        ...meta,
        updatedAtMs: Date.now(),
      },
      actualizadoAt: _fv(),
    });
  } catch (e) {
    console.warn('[papeletas] sideEffects meta:', e?.message);
  }
}

/**
 * Side-effects post-entrega (fuera del TX de status):
 * 1) sacar MVA del cuadre (ejecutarEliminacion + motivo RENTA)
 * 2) marcar index EN RENTA + ubicacion RENTADA|ARRENDADA
 *
 * Fallos NO deshacen entregada — quedan marcados para retry.
 * @returns {{ ok: boolean, cuadreRemoved: boolean, rentadaMarked: boolean, ubicacionLabel: string, error?: string }}
 */
export async function applyEntregaSideEffects(papeleta, { user, plazaId, km } = {}) {
  const meta = _userMeta(user);
  const mva = String(papeleta?.mva || '').toUpperCase().trim();
  const ubicacionLabel = ubicacionRentaLabel();
  const prev = (papeleta?.entregaSideEffects && typeof papeleta.entregaSideEffects === 'object')
    ? papeleta.entregaSideEffects
    : {};

  let cuadreRemoved = prev.cuadreRemoved === true;
  let rentadaMarked = prev.rentadaMarked === true;
  let lastError = '';

  if (!mva) {
    lastError = 'Sin MVA en papeleta';
    await _persistSideEffectsMeta(papeleta?.id, {
      status: 'pending',
      cuadreRemoved,
      rentadaMarked,
      ubicacionLabel,
      lastError,
      pendingRetry: true,
    });
    return { ok: false, cuadreRemoved, rentadaMarked, ubicacionLabel, error: lastError };
  }

  if (!cuadreRemoved) {
    try {
      const plaza = await _resolvePlazaActualMva(
        mva,
        plazaId || papeleta.ultimaPlazaId || papeleta.entregadaPlazaId || papeleta.plazaId || ''
      );
      const kmVal = km ?? papeleta?.salida?.km ?? null;
      const retiro = kmVal != null && kmVal !== ''
        ? { km: kmVal, motivo: 'RENTA' }
        : { motivo: 'RENTA' };
      await ejecutarEliminacion(
        [mva],
        meta.nombre || meta.uid || 'Sistema',
        plaza,
        retiro
      );
      cuadreRemoved = true;
    } catch (e) {
      lastError = e?.message || String(e);
      console.warn('[papeletas] cuadre remove:', lastError);
      reportProgrammerError({
        kind: 'papeletas.entrega.cuadre',
        scope: 'papeletas',
        message: `No se pudo sacar ${mva} del cuadre tras entrega`,
        code: e?.code || 'CUADRE_REMOVE_FAIL',
        stack: e?.stack || '',
        source: `papeleta:${papeleta?.id || ''}`,
      }).catch(() => {});
    }
  }

  if (!rentadaMarked) {
    try {
      rentadaMarked = await _marcarIndexRentada(mva, ubicacionLabel);
      if (!rentadaMarked && !lastError) {
        lastError = 'MVA no encontrado en index_unidades';
      }
    } catch (e) {
      lastError = e?.message || String(e);
      console.warn('[papeletas] marcar RENTADA:', lastError);
      reportProgrammerError({
        kind: 'papeletas.entrega.rentada',
        scope: 'papeletas',
        message: `No se pudo marcar ${mva} como ${ubicacionLabel}`,
        code: e?.code || 'RENTADA_MARK_FAIL',
        stack: e?.stack || '',
        source: `papeleta:${papeleta?.id || ''}`,
      }).catch(() => {});
    }
  }

  const ok = cuadreRemoved && rentadaMarked;
  await _persistSideEffectsMeta(papeleta?.id, {
    status: ok ? 'ok' : (cuadreRemoved || rentadaMarked ? 'partial' : 'pending'),
    cuadreRemoved,
    rentadaMarked,
    ubicacionLabel,
    lastError: ok ? '' : lastError,
    pendingRetry: !ok,
  });

  return { ok, cuadreRemoved, rentadaMarked, ubicacionLabel, error: ok ? undefined : lastError };
}

/** Reintenta side-effects si la entrega ya quedó locked pero cuadre/RENTADA falló. */
export async function retryEntregaSideEffects(id, { user, plazaId, km } = {}) {
  const papeleta = await getPapeleta(id);
  if (!papeleta) throw new Error('Papeleta no encontrada');
  if (papeleta.status !== STATUS.ENTREGADA && !papeleta.entregaFinalizedAt) {
    const err = new Error('Solo se reintentan side-effects de papeletas entregadas');
    err.code = 'NOT_ENTREGADA';
    throw err;
  }
  return applyEntregaSideEffects(papeleta, { user, plazaId, km });
}

/** Fields that must not change once salida is locked (post-entregada). */
const SALIDA_LOCKED_KEYS = new Set([
  'zonas',
  'checklist',
  'danosMarcados',
  'diagramaStrokes',
  'danosLastDisplayNumber',
  'marcasLlantas',
  'tapetesUsoRudo',
  'tapetesAlfombra',
  'tapetes',
  'marcaLlantas',
]);

/**
 * Inbox empresa-global. `plazaId` / `preferPlazaId` NO filtran filas —
 * solo reordenan “cerca de mí” vía `orderInboxGlobal`.
 * @param {{ plazaId?: string, preferPlazaId?: string, onData: Function, onError?: Function }} opts
 * @deprecated plazaId as filter — ignored for visibility; use preferPlazaId for sort boost
 */
export function subscribePapeletasPlaza({ plazaId, preferPlazaId, onData, onError } = {}) {
  return subscribePapeletasEmpresa({
    preferPlazaId: preferPlazaId || plazaId || '',
    onData,
    onError,
  });
}

/**
 * Suscripción canónica: todas las papeletas recientes de la empresa (colección ya tenant-scoped).
 */
export function subscribePapeletasEmpresa({ preferPlazaId = '', onData, onError } = {}) {
  const q = _col().orderBy('actualizadoAt', 'desc').limit(200);
  return q.onSnapshot(
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      onData(orderInboxGlobal(rows, { preferPlazaId }));
    },
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

export async function releasePapeletaActivaLock(unidadId) {
  const id = String(unidadId || '').trim();
  if (!id) return;
  try {
    await _activasCol().doc(id).delete();
  } catch (e) {
    console.warn('[papeletas] release lock:', e?.message);
  }
}

/**
 * Crear papeleta atómicamente con lock `papeletas_activas/{unidadId}`.
 * UI pre-check (`getPapeletaActivaByUnidad`) is UX only — this TX is the authority.
 * @returns {{ id: string }}
 */
export async function crearPapeleta({ unidad, plazaId, user }) {
  const unidadId = String(unidad?.id || unidad?.unidadId || '').trim();
  if (!unidadId) throw new Error('Unidad requerida');

  const meta = _userMeta(user);
  const lockRef = _activasCol().doc(unidadId);
  const papeletaRef = _col().doc();

  try {
    await db.runTransaction(async (tx) => {
      const lockSnap = await tx.get(lockRef);
      if (lockSnap.exists) {
        const existingId = String(lockSnap.data()?.papeletaId || '');
        const err = new Error('Ya existe una papeleta activa para esta unidad');
        err.code = 'ACTIVE_EXISTS';
        err.existingId = existingId;
        throw err;
      }

      const provenance = buildCreateProvenance({
        user: meta,
        plazaId: String(plazaId || unidad.plazaId || '').toUpperCase(),
      });

      const doc = {
        unidadId,
        mva: String(unidad.mva || '').toUpperCase(),
        modelo: String(unidad.modelo || ''),
        placas: String(unidad.placas || '').toUpperCase(),
        color: String(unidad.color || ''),
        vin: String(unidad.vin || '').toUpperCase(),
        ...provenance,
        status: STATUS.BORRADOR,
        clienteNombre: '',
        contrato: '',
        checklist: createEmptyChecklist(),
        zonas: createEmptyZonas(),
        marcasLlantas: createEmptyMarcasLlantas(),
        tapetesUsoRudo: null,
        tapetesAlfombra: null,
        danosMarcados: [],
        diagramaStrokes: [],
        danosLastDisplayNumber: 0,
        zonasTemplateVersion: 2,
        revision: 1,
        salida: {
          km: unidad.km ?? unidad.kilometraje ?? null,
          gas: unidad.gasolina ?? unidad.gas ?? null,
        },
        entrada: {},
        activoPorUnidad: true,
        casoVentasId: '',
        pdfUrl: '',
        actualizadoPor: meta.uid,
        creadoAt: _fv(),
        actualizadoAt: _fv(),
      };

      tx.set(papeletaRef, doc);
      tx.set(lockRef, {
        papeletaId: papeletaRef.id,
        unidadId,
        createdAt: _fv(),
        createdBy: meta.uid,
      });
    });
  } catch (e) {
    if (e?.code === 'ACTIVE_EXISTS') {
      if (e.existingId) {
        e.existing = await getPapeleta(e.existingId);
      }
      if (!e.existing) {
        e.existing = await getPapeletaActivaByUnidad(unidadId);
      }
      throw e;
    }
    throw e;
  }

  return { id: papeletaRef.id };
}

/**
 * Patch con merge de `salida`, guard de inmutabilidad y conflicto de `revision`.
 * @param {string} id
 * @param {object} patch
 * @param {{ user?: object, knownRevision?: number }} [opts]
 */
export async function actualizarPapeleta(id, patch, { user, knownRevision, plazaId } = {}) {
  const ref = _col().doc(id);
  const meta = _userMeta(user);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Papeleta no encontrada');
    const current = { id: snap.id, ...snap.data() };

    if (!isSalidaMutable(current.status)) {
      const keys = Object.keys(patch || {});
      const touchesLocked = keys.some((k) =>
        SALIDA_LOCKED_KEYS.has(k)
        || k === 'salida'
        || (k === 'status' && patch.status !== current.status && patch.status !== STATUS.EN_RETORNO && patch.status !== STATUS.CERRADA_HISTORIAL)
      );
      if (touchesLocked) {
        const err = new Error('Salida inmutable (papeleta ya entregada o cerrada)');
        err.code = 'SALIDA_IMMUTABLE';
        throw err;
      }
    } else if (!puedeEditar(current.status)) {
      throw new Error('Papeleta bloqueada (ya entregada)');
    }

    if (patch.clienteNombre != null && !canAssignCliente(current.status)) {
      const err = new Error('No se puede asignar cliente en este estado');
      err.code = 'CLIENTE_LOCKED';
      throw err;
    }
    if (patch.contrato != null && !canAssignContrato(current.status)) {
      const err = new Error('No se puede asignar contrato en este estado');
      err.code = 'CONTRATO_LOCKED';
      throw err;
    }

    const remoteRev = Number(current.revision) || 0;
    if (knownRevision != null && Number(knownRevision) !== remoteRev) {
      const err = new Error('Conflicto de revisión');
      err.code = 'REVISION_CONFLICT';
      err.remote = current;
      throw err;
    }

    const nextZonas = patch.zonas != null ? patch.zonas : current.zonas;
    const nextChecklist = patch.checklist != null ? patch.checklist : current.checklist;
    const data = { ...patch };

    if (patch.salida && typeof patch.salida === 'object') {
      data.salida = { ...(current.salida || {}), ...patch.salida };
    }

    const mergedForStatus = {
      ...current,
      ...data,
      zonas: nextZonas,
      checklist: nextChecklist,
      salida: data.salida || current.salida,
    };

    const status = computeStatusAfterSave({
      status: current.status,
      zonas: nextZonas,
      checklist: nextChecklist,
      papeleta: mergedForStatus,
    });

    const touch = buildTouchProvenance({
      user: meta,
      plazaId: plazaId || current.ultimaPlazaId || current.plazaId,
      action: 'actualizar',
    });

    Object.assign(data, touch);
    data.status = status;
    data.revision = remoteRev + 1;
    data.actualizadoAt = _fv();
    tx.update(ref, data);
  });

  return getPapeleta(id);
}

export async function asignarCliente(id, clienteNombre, { user, plazaId } = {}) {
  const meta = _userMeta(user);
  const current = await getPapeleta(id);
  if (!current) throw new Error('Papeleta no encontrada');
  if (!canAssignCliente(current.status)) {
    const err = new Error('No se puede asignar cliente en este estado');
    err.code = 'CLIENTE_LOCKED';
    throw err;
  }
  const touch = buildTouchProvenance({
    user: meta,
    plazaId: plazaId || current.ultimaPlazaId || current.plazaId,
    action: 'asignar_cliente',
  });
  await _col().doc(id).update({
    clienteNombre: String(clienteNombre || '').trim(),
    revision: (Number(current.revision) || 0) + 1,
    ...touch,
    actualizadoAt: _fv(),
  });
}

export async function asignarContrato(id, contrato, { user, plazaId } = {}) {
  const meta = _userMeta(user);
  const current = await getPapeleta(id);
  if (!current) throw new Error('Papeleta no encontrada');
  if (!canAssignContrato(current.status)) {
    const err = new Error('No se puede asignar contrato en este estado');
    err.code = 'CONTRATO_LOCKED';
    throw err;
  }
  const touch = buildTouchProvenance({
    user: meta,
    plazaId: plazaId || current.ultimaPlazaId || current.plazaId,
    action: 'asignar_contrato',
  });
  await _col().doc(id).update({
    contrato: String(contrato || '').trim(),
    revision: (Number(current.revision) || 0) + 1,
    ...touch,
    actualizadoAt: _fv(),
  });
}

/**
 * Atomic + idempotent delivery. Single entry point — do not split status/firma/pdf across modules.
 *
 * Side-effects (cuadre out + RENTADA/ARRENDADA) corren **después** del TX.
 * Si fallan: la salida permanece entregada/locked; quedan en `entregaSideEffects.pendingRetry`
 * y se reintentan en llamadas idempotentes o vía `retryEntregaSideEffects`.
 *
 * @returns {{ ok: true, alreadyFinalized: boolean, papeleta: object, sideEffects?: object }}
 */
export async function finalizeDelivery(id, {
  quienEntrega,
  km,
  gas,
  firma,
  confirmedWarnings = [],
  user,
  pdfUrl = '',
  plazaId = '',
} = {}) {
  const meta = _userMeta(user);
  const ref = _col().doc(id);
  let alreadyFinalized = false;
  let cached = null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Papeleta no encontrada');
    const current = { id: snap.id, ...snap.data() };

    if (current.status === STATUS.ENTREGADA || current.entregaFinalizedAt) {
      alreadyFinalized = true;
      cached = current;
      return;
    }

    const nextKm = km ?? current.salida?.km ?? null;
    const nextGas = gas ?? current.salida?.gas ?? null;
    const gateDoc = {
      ...current,
      salida: { ...(current.salida || {}), km: nextKm, gas: nextGas },
    };
    const gate = puedeEntregar(gateDoc, { firma, confirmedWarnings });
    if (!gate.ok) {
      const err = new Error('No se puede entregar: ' + (gate.hard || []).join(', '));
      err.code = 'NO_ENTREGAR';
      err.hard = gate.hard;
      err.soft = gate.soft;
      throw err;
    }

    const firmaMeta = {
      imagePath: String(firma?.imagePath || firma?.firmaPath || ''),
      signerName: String(firma?.signerName || ''),
      signerRole: String(firma?.signerRole || ''),
      signedAt: firma?.signedAt || _fv(),
      capturedBy: String(firma?.capturedBy || meta.uid),
      consentTextVersion: String(firma?.consentTextVersion || 'v1'),
    };

    const salida = {
      ...(current.salida || {}),
      quienEntrega: String(quienEntrega || firmaMeta.signerName || meta.nombre || ''),
      km: nextKm,
      gas: nextGas,
      firma: firmaMeta,
      // legacy dual-read for PDF / older UI
      firmaPath: firmaMeta.imagePath || String(current.salida?.firmaPath || ''),
      firmadoAt: _fv(),
      entregadoPorUid: meta.uid,
    };

    const touch = buildTouchProvenance({
      user: meta,
      plazaId: plazaId || current.ultimaPlazaId || current.plazaId,
      action: 'entregar',
    });

    tx.update(ref, {
      status: STATUS.ENTREGADA,
      salida,
      entregadaAt: _fv(),
      entregaFinalizedAt: _fv(),
      pdfUrl: pdfUrl || current.pdfUrl || '',
      confirmedWarnings: Array.isArray(confirmedWarnings) ? confirmedWarnings.slice() : [],
      revision: (Number(current.revision) || 0) + 1,
      ...touch,
      actualizadoAt: _fv(),
    });
  });

  // Post-TX side-effects: delivery already won — never unlock on failure.
  let papeleta = alreadyFinalized ? cached : await getPapeleta(id);
  if (!papeleta?.id) papeleta = await getPapeleta(id);

  const se = papeleta?.entregaSideEffects;
  const needsSideEffects = !se || se.pendingRetry === true || se.status !== 'ok';
  let sideEffects;
  if (needsSideEffects && papeleta) {
    try {
      sideEffects = await applyEntregaSideEffects(papeleta, {
        user,
        plazaId: plazaId || papeleta.ultimaPlazaId || papeleta.plazaId || '',
        km: km ?? papeleta.salida?.km,
      });
      papeleta = await getPapeleta(id) || papeleta;
    } catch (e) {
      console.warn('[papeletas] side-effects:', e?.message);
      reportProgrammerError({
        kind: 'papeletas.entrega.sideEffects',
        scope: 'papeletas',
        message: e?.message || 'Side-effects post-entrega fallaron',
        code: e?.code || 'SIDE_EFFECTS_FAIL',
        stack: e?.stack || '',
        source: `papeleta:${id}`,
      }).catch(() => {});
      sideEffects = { ok: false, error: e?.message || String(e) };
    }
  }

  return {
    ok: true,
    alreadyFinalized,
    papeleta,
    sideEffects,
  };
}

/**
 * @deprecated Prefer finalizeDelivery. Thin wrapper for legacy callers.
 */
export async function entregarPapeleta(id, {
  quienEntrega,
  km,
  gas,
  firmaPath,
  firma,
  user,
  confirmedWarnings,
} = {}) {
  const meta = _userMeta(user);
  const firmaObj = firma || {
    imagePath: firmaPath,
    signerName: quienEntrega || meta.nombre || '',
    signerRole: 'Cliente',
    capturedBy: meta.uid,
    consentTextVersion: 'v1',
  };
  const result = await finalizeDelivery(id, {
    quienEntrega,
    km,
    gas,
    firma: firmaObj,
    confirmedWarnings,
    user,
  });
  return result.papeleta;
}

export async function cancelarPapeleta(id, { user, motivo } = {}) {
  const current = await getPapeleta(id);
  if (!current) throw new Error('Papeleta no encontrada');
  if (current.status !== STATUS.BORRADOR && current.status !== STATUS.LISTA) {
    throw new Error('Solo se pueden cancelar papeletas en borrador o lista');
  }

  const meta = _userMeta(user);
  await _col().doc(id).update({
    status: STATUS.CANCELADA,
    activoPorUnidad: false,
    canceladaAt: _fv(),
    canceladaPor: meta.uid,
    cancelMotivo: String(motivo || '').slice(0, 500),
    revision: (Number(current.revision) || 0) + 1,
    actualizadoPor: meta.uid,
    actualizadoAt: _fv(),
  });
  await releasePapeletaActivaLock(current.unidadId);
  return getPapeleta(id);
}

export async function registrarEntrada(id, {
  quienRecibe,
  km,
  gas,
  notas,
  user,
  entradaExtra = {},
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
      ...(current.entrada || {}),
      ...entradaExtra,
      quienRecibe: String(quienRecibe || meta.nombre || ''),
      km: km ?? null,
      gas: gas ?? null,
      notas: String(notas || ''),
      registradoAt: _fv(),
      registradoPorUid: meta.uid,
    },
    revision: (Number(current.revision) || 0) + 1,
    actualizadoPor: meta.uid,
    actualizadoAt: _fv(),
  });
  await releasePapeletaActivaLock(current.unidadId);
  return getPapeleta(id);
}

export async function cerrarPapeletaHistorial(id, { user } = {}) {
  const meta = _userMeta(user);
  const current = await getPapeleta(id);
  if (!current) throw new Error('Papeleta no encontrada');
  await _col().doc(id).update({
    status: STATUS.CERRADA_HISTORIAL,
    activoPorUnidad: false,
    revision: (Number(current?.revision) || 0) + 1,
    actualizadoPor: meta.uid,
    actualizadoAt: _fv(),
  });
  if (current.unidadId) await releasePapeletaActivaLock(current.unidadId);
}
