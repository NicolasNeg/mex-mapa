// ═══════════════════════════════════════════════════════════
//  /js/app/features/turnos/turnos-mutations.js
//  Check-in/out con bitácora (logs tipo TURNO) y asistencia auto.
// ═══════════════════════════════════════════════════════════

import { db, auth, COL } from '/js/core/database.js';
import {
  iniciarTurno as iniciarTurnoData,
  cerrarTurno as cerrarTurnoData,
} from '/js/app/features/turnos/turnos-data.js';
import { registrarAsistencia, hoy } from '/js/app/features/turnos/horarios-data.js';
import { formatDuration, turnoInicioDate } from '/js/app/features/turnos/turnos-view-model.js';

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

export async function iniciarTurno(user, plazaId) {
  const firebaseUid = authUid(user);
  const plaza = String(plazaId || '').toUpperCase().trim();
  const nombre = userDisplayName(user);

  const turnoId = await iniciarTurnoData(user, plazaId);

  await registrarLogTurno(
    `🟢 TURNO INICIO: ${nombre} · ${plaza}`,
    nombre,
    plaza,
    { turnoId, usuarioId: firebaseUid }
  );

  try {
    await registrarAsistencia(firebaseUid, plaza, hoy(), 'PRESENTE', {
      nombre,
      turnoId,
    });
  } catch (e) {
    console.warn('[turnos-mutations] auto-asistencia:', e);
  }

  return turnoId;
}

export async function cerrarTurno(turnoId, opts = {}) {
  if (!turnoId) return;

  let data = {};
  try {
    const snap = await db.collection(COL.TURNOS).doc(turnoId).get();
    if (snap.exists) data = snap.data() || {};
  } catch (e) {
    console.warn('[turnos-mutations] fetch turno:', e);
  }

  await cerrarTurnoData(turnoId);

  const nombre = String(data.usuarioNombre || opts.nombre || userDisplayName(opts.user || {})).trim();
  const plaza = String(data.plazaId || opts.plaza || '').toUpperCase().trim();
  const inicio = turnoInicioDate(data);
  const dur = formatDuration(Date.now() - inicio.getTime());

  await registrarLogTurno(
    `🔴 TURNO FIN: ${nombre} · duración ${dur}`,
    nombre,
    plaza,
    { turnoId, usuarioId: data.usuarioId || opts.usuarioId || '' }
  );
}
