// ═══════════════════════════════════════════════════════════
//  /js/app/features/turnos/turnos-mutations.js
//  Check-in/out con bitácora (logs tipo TURNO), asistencia auto,
//  gate facial/geo y foto en Storage.
// ═══════════════════════════════════════════════════════════

import { db, auth, storage, COL } from '/js/core/database.js';
import {
  iniciarTurno as iniciarTurnoData,
  cerrarTurno as cerrarTurnoData,
} from '/js/app/features/turnos/turnos-data.js';
import { registrarAsistenciaDesdeCheckin, hoy } from '/js/app/features/turnos/horarios-data.js';
import { formatDuration, turnoInicioDate } from '/js/app/features/turnos/turnos-view-model.js';
import { runChecadoGate, showChecadoExito } from '/js/app/features/turnos/checado-gate.js';
import { dataUrlToBlob } from '/js/app/features/turnos/camera.js';
import { normalizarDescriptor } from '/js/app/features/turnos/face-verify.js';

async function registrarLogTurno(accion, autor, plaza, extra = {}) {
  try {
    if (typeof window.api?.registrarLogTurno === 'function') {
      await window.api.registrarLogTurno(accion, autor, plaza, extra);
      return;
    }
    if (typeof window._mex?._registrarLog === 'function') {
      await window._mex._registrarLog('TURNO', accion, autor, plaza, extra);
    }
  } catch (e) {
    console.warn('[turnos-mutations] log failed', e);
  }
}

function authUid(user) {
  return window._auth?.currentUser?.uid || auth?.currentUser?.uid || user?.uid || '';
}

function userDisplayName(user) {
  return String(user?.nombreCompleto || user?.nombre || user?.displayName || user?.email || 'Usuario').trim();
}

async function resolveUsuarioDocId(user) {
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

/** Sube selfie a Storage. Falla silenciosamente → null. */
async function uploadChecadaFoto(fotoDataURL, { uid, tipo }) {
  if (!fotoDataURL || !uid) return null;
  const blob = dataUrlToBlob(fotoDataURL);
  if (!blob) return null;
  const sc = storage || window._storage || (window.firebase?.storage ? window.firebase.storage() : null);
  if (!sc?.ref) return null;
  const path = `turnos_checadas/${uid}/${tipo}_${Date.now()}.jpg`;
  try {
    const ref = sc.ref(path);
    await ref.put(blob, { contentType: 'image/jpeg' });
    return await ref.getDownloadURL();
  } catch (e) {
    console.warn('[turnos-mutations] foto upload:', e?.code || e?.message);
    return null;
  }
}

/** Sube la firma digital (PNG) a Storage. Falla silenciosamente → null. */
async function uploadChecadaFirma(firmaDataURL, { uid, tipo }) {
  if (!firmaDataURL || !uid) return null;
  const blob = dataUrlToBlob(firmaDataURL);
  if (!blob) return null;
  const sc = storage || window._storage || (window.firebase?.storage ? window.firebase.storage() : null);
  if (!sc?.ref) return null;
  const path = `turnos_firmas/${uid}/${tipo}_${Date.now()}.png`;
  try {
    const ref = sc.ref(path);
    await ref.put(blob, { contentType: 'image/png' });
    return await ref.getDownloadURL();
  } catch (e) {
    console.warn('[turnos-mutations] firma upload:', e?.code || e?.message);
    return null;
  }
}

async function loadFreshFaceDescriptor(user) {
  const fromUser = normalizarDescriptor(user?.faceDescriptor);
  if (fromUser?.length) return fromUser;
  try {
    const fresh = await window.__mexLoadCurrentUserRecord?.(window._auth?.currentUser, { force: true });
    return normalizarDescriptor(fresh?.faceDescriptor);
  } catch (_) {
    return null;
  }
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
  let exitoFoto = null;
  if (!opts.skipGate) {
    const faceDescriptor = await loadFreshFaceDescriptor(user);
    const gate = await runChecadoGate({
      mode: 'inicio',
      user: { ...user, faceDescriptor },
      plazaId: plaza,
      requireFace: true,
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

    exitoFoto = gate.fotoDataURL;
    const [fotoUrl, firmaUrl] = await Promise.all([
      uploadChecadaFoto(gate.fotoDataURL, { uid: firebaseUid, tipo: 'inicio' }),
      uploadChecadaFirma(gate.firmaDataURL, { uid: firebaseUid, tipo: 'inicio' }),
    ]);
    meta = {
      lat: gate.lat,
      lon: gate.lon,
      direccion: gate.direccion,
      faceVerified: !!gate.faceVerified,
      faceSimilarity: gate.faceSimilarity,
      viveza: gate.viveza,
      antiSpoof: gate.antiSpoof,
      fotoUrl,
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
    fotoDataURL: exitoFoto,
  });

  const faceTag = meta.faceVerified ? ' · rostro OK' : (meta.faceVerified === false ? ' · sin rostro' : '');
  await registrarLogTurno(
    `🟢 TURNO INICIO: ${nombre} · ${plaza}${faceTag}`,
    nombre,
    plaza,
    { turnoId, usuarioId: firebaseUid, faceVerified: meta.faceVerified, geoWarn: meta.geoWarn }
  );

  try {
    const res = await registrarAsistenciaDesdeCheckin(firebaseUid, plaza, hoy(), {
      nombre,
      turnoId
    });
    if (!res?.skipped) {
      await registrarLogTurno(
        `⏳ ASISTENCIA PENDIENTE: ${nombre} · por confirmar`,
        nombre,
        plaza,
        { turnoId, usuarioId: firebaseUid }
      );
    }
  } catch (e) {
    console.warn('[turnos-mutations] auto-asistencia:', e);
  }

  return turnoId;
}

/**
 * Gate (cámara+geo, face opcional) + cierre.
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
  let exitoFoto = null;
  if (!opts.skipGate) {
    const faceDescriptor = await loadFreshFaceDescriptor(opts.user || {});
    const gate = await runChecadoGate({
      mode: 'cierre',
      user: { ...(opts.user || {}), faceDescriptor },
      plazaId: plaza,
      requireFace: false,
    });
    if (gate?.cancelled) {
      const err = new Error('Cancelado');
      err.code = 'GATE_CANCELLED';
      throw err;
    }
    exitoFoto = gate.fotoDataURL;
    const fotoUrl = await uploadChecadaFoto(gate.fotoDataURL, { uid, tipo: 'cierre' });
    meta = {
      lat: gate.lat,
      lon: gate.lon,
      direccion: gate.direccion,
      faceVerified: !!gate.faceVerified,
      faceSimilarity: gate.faceSimilarity,
      viveza: gate.viveza,
      antiSpoof: gate.antiSpoof,
      fotoUrl,
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
    fotoDataURL: exitoFoto,
    duracion: dur,
  });

  await registrarLogTurno(
    `🔴 TURNO FIN: ${nombre} · duración ${dur}`,
    nombre,
    plaza,
    { turnoId, usuarioId: uid, faceVerified: meta.faceVerified, geoWarn: meta.geoWarn }
  );
}
