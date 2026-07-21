// ═══════════════════════════════════════════════════════════
//  /js/app/features/turnos/turnos-mutations.js
//  Check-in/out con bitácora (logs tipo TURNO), asistencia auto,
//  verificación de identidad sin foto (WebAuthn/rostro/PIN) + geo.
// ═══════════════════════════════════════════════════════════

import { db, auth, COL } from '/js/core/database.js';
import {
  iniciarTurno as iniciarTurnoData,
  cerrarTurno as cerrarTurnoData,
} from '/js/app/features/turnos/turnos-data.js';
import { registrarAsistenciaDesdeCheckin, hoy } from '/js/app/features/turnos/horarios-data.js';
import { formatDuration, turnoInicioDate } from '/js/app/features/turnos/turnos-view-model.js';
import { runChecadoGate, showChecadoExito } from '/js/app/features/turnos/checado-gate.js';
import { dataUrlToBlob } from '/js/app/features/turnos/camera.js';
import { normalizarDescriptor } from '/js/app/features/turnos/face-verify.js';
import { registrarHechoTurno } from '/js/app/features/turnos/turnos-audit.js';

const METODO_LABEL = { webauthn: 'biometría del dispositivo', face: 'rostro', pin: 'PIN' };

function authUid(user) {
  return window._auth?.currentUser?.uid || auth?.currentUser?.uid || user?.uid || '';
}

function userDisplayName(user) {
  return String(user?.nombreCompleto || user?.nombre || user?.displayName || user?.email || 'Usuario').trim();
}

export async function resolveUsuarioDocId(user) {
  const email = String(user?.email || window._auth?.currentUser?.email || '').toLowerCase().trim();
  const uid = authUid(user);
  if (user?.id && (user.id === email || user.id === uid)) return user.id;
  if (email) {
    try {
      const byEmail = await db.collection(COL.USERS).doc(email).get();
      if (byEmail.exists) return byEmail.id;
    } catch (_) {}
  }
  if (uid) {
    try {
      const byUid = await db.collection(COL.USERS).doc(uid).get();
      if (byUid.exists) return byUid.id;
    } catch (_) {}
  }
  return user?.id || email || uid || '';
}

/** Persiste faceDescriptor en el perfil del usuario (self-service). */
export async function guardarFaceDescriptor(user, embedding) {
  const desc = normalizarDescriptor(embedding);
  if (!desc?.length) return false;
  const docId = await resolveUsuarioDocId(user);
  if (!docId) return false;
  const fv = window.firebase?.firestore?.FieldValue;
  await db.collection(COL.USERS).doc(docId).update({
    faceDescriptor: desc,
    faceDescriptorEnrolledAt: fv ? fv.serverTimestamp() : Date.now(),
    updatedAt: Date.now(),
    updatedFrom: 'turnos-checado',
  });
  // Refrescar cache de perfil en sesión
  try {
    window.__mexInvalidateCurrentUserRecordCache?.(user?.email || docId);
    if (typeof window.__mexSeedCurrentUserRecordCache === 'function') {
      window.__mexSeedCurrentUserRecordCache(
        { ...user, id: docId, faceDescriptor: desc },
        window._auth?.currentUser
      );
    }
  } catch (_) {}
  return true;
}

/** Sube la firma digital (PNG) a Cloudinary. Falla silenciosamente → null. */
async function uploadChecadaFirma(firmaDataURL, { uid, tipo }) {
  if (!firmaDataURL || !uid) return null;
  const blob = dataUrlToBlob(firmaDataURL);
  if (!blob) return null;
  try {
    const { uploadMedia } = await import('/js/core/media-upload.js');
    const result = await uploadMedia({
      folder: `turnos/firmas/${uid}`,
      file: blob,
      publicId: `${tipo}_${Date.now()}`,
      resourceType: 'image',
    });
    return result.url;
  } catch (e) {
    console.warn('[turnos-mutations] firma upload:', e?.code || e?.message);
    return null;
  }
}

/** Carga el perfil fresco (faceDescriptor, checadoPinHash, webauthnCredentialId). */
async function loadFreshUserRecord(user) {
  try {
    const fresh = await window.__mexLoadCurrentUserRecord?.(window._auth?.currentUser, { force: true });
    if (fresh) return fresh;
  } catch (_) {}
  return user || {};
}

/**
 * Gate + persistencia para iniciar turno.
 * @param {object} user
 * @param {string} plazaId
 * @param {{ skipGate?: boolean }} [opts]
 */
export async function iniciarTurno(user, plazaId, opts = {}) {
  const firebaseUid = authUid(user);
  const plaza = String(plazaId || '').toUpperCase().trim();
  const nombre = userDisplayName(user);

  let meta = {};
  let metodo = null;
  if (!opts.skipGate) {
    const docId = await resolveUsuarioDocId(user);
    const freshUser = await loadFreshUserRecord(user);
    const gate = await runChecadoGate({
      mode: 'inicio',
      user: { ...user, ...freshUser },
      docId,
      plazaId: plaza,
      signature: true,
    });
    if (gate?.cancelled) {
      const err = new Error('Cancelado');
      err.code = 'GATE_CANCELLED';
      throw err;
    }

    if (gate.enrolled && gate.faceDescriptor) {
      try {
        await guardarFaceDescriptor(user, gate.faceDescriptor);
      } catch (e) {
        console.warn('[turnos-mutations] enroll face:', e);
      }
    }

    metodo = gate.metodo;
    const firmaUrl = await uploadChecadaFirma(gate.firmaDataURL, { uid: firebaseUid, tipo: 'inicio' });
    meta = {
      lat: gate.lat,
      lon: gate.lon,
      direccion: gate.direccion,
      metodo: gate.metodo,
      faceVerified: !!gate.faceVerified,
      faceSimilarity: gate.faceSimilarity,
      viveza: gate.viveza,
      antiSpoof: gate.antiSpoof,
      firmaUrl,
      geoWarn: !!gate.geoWarn,
      distanciaPlazaM: gate.distanciaPlazaM,
    };
  }

  const turnoId = await iniciarTurnoData(user, plazaId, meta);

  const ahora = new Date();
  showChecadoExito({
    mode: 'inicio',
    hora: ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
    fecha: ahora.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }),
    plaza,
    direccion: meta.direccion || '',
    metodo,
  });

  await registrarHechoTurno({
    hecho: 'TURNO_INICIO',
    plaza,
    empleado: nombre,
    empleadoUid: firebaseUid,
    nota: metodo ? `verificado por ${METODO_LABEL[metodo] || metodo}` : '',
    detalle: { turnoId, metodo, faceVerified: meta.faceVerified, geoWarn: meta.geoWarn },
  });

  try {
    await registrarAsistenciaDesdeCheckin(firebaseUid, plaza, hoy(), {
      nombre,
      turnoId
    });
  } catch (e) {
    console.warn('[turnos-mutations] auto-asistencia:', e);
  }

  return turnoId;
}

/**
 * Gate (identidad + geo) + cierre.
 * @param {string} turnoId
 * @param {{ user?, plaza?, nombre?, usuarioId?, skipGate?: boolean }} [opts]
 */
export async function cerrarTurno(turnoId, opts = {}) {
  if (!turnoId) return;

  let data = {};
  try {
    const snap = await db.collection(COL.TURNOS).doc(turnoId).get();
    if (snap.exists) data = snap.data() || {};
  } catch (e) {
    console.warn('[turnos-mutations] fetch turno:', e);
  }

  const nombre = String(data.usuarioNombre || opts.nombre || userDisplayName(opts.user || {})).trim();
  const plaza = String(data.plazaId || opts.plaza || '').toUpperCase().trim();
  const uid = data.usuarioId || opts.usuarioId || authUid(opts.user || {});

  let meta = {};
  let metodo = null;
  if (!opts.skipGate) {
    const docId = await resolveUsuarioDocId(opts.user || {});
    const freshUser = await loadFreshUserRecord(opts.user || {});
    const gate = await runChecadoGate({
      mode: 'cierre',
      user: { ...(opts.user || {}), ...freshUser },
      docId,
      plazaId: plaza,
    });
    if (gate?.cancelled) {
      const err = new Error('Cancelado');
      err.code = 'GATE_CANCELLED';
      throw err;
    }
    metodo = gate.metodo;
    meta = {
      lat: gate.lat,
      lon: gate.lon,
      direccion: gate.direccion,
      metodo: gate.metodo,
      faceVerified: !!gate.faceVerified,
      faceSimilarity: gate.faceSimilarity,
      viveza: gate.viveza,
      antiSpoof: gate.antiSpoof,
      geoWarn: !!gate.geoWarn,
      distanciaPlazaM: gate.distanciaPlazaM,
    };
  }

  await cerrarTurnoData(turnoId, meta);

  const inicio = turnoInicioDate(data);
  const dur = formatDuration(Date.now() - inicio.getTime());

  const ahora = new Date();
  showChecadoExito({
    mode: 'cierre',
    hora: ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
    fecha: ahora.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }),
    plaza,
    direccion: meta.direccion || '',
    metodo,
    duracion: dur,
  });

  await registrarHechoTurno({
    hecho: 'TURNO_FIN',
    plaza,
    empleado: nombre,
    empleadoUid: uid,
    nota: `duración ${dur}`,
    detalle: { turnoId, metodo, faceVerified: meta.faceVerified, geoWarn: meta.geoWarn },
  });
}
