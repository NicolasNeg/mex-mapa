// js/app/features/gestion/invitaciones-data.js
import { db } from '/js/core/database.js';
const COL_INV = 'invitaciones';

export function subscribeInvitaciones(cb) {
  return db.collection(COL_INV).orderBy('creadoEnMs', 'desc')
    .onSnapshot(snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function crearInvitacion({ plaza, rol, expiraEnDias }) {
  const fn = firebase.functions().httpsCallable('generarInvitacion');
  const res = await fn({ plaza, rol, expiraEnDias });
  return res.data;
}

export async function revocarInvitacion(codigo) {
  const fn = firebase.functions().httpsCallable('revocarInvitacion');
  await fn({ codigo });
}
