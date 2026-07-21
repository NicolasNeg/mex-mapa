// ═══════════════════════════════════════════════════════════
//  pin-check.js — PIN de 6 digitos como respaldo universal del
//  checado (funciona sin camara, sin WebAuthn, en cualquier equipo).
//  El PIN nunca se guarda en texto plano: solo su hash SHA-256.
// ═══════════════════════════════════════════════════════════

import { db, COL } from '/js/core/database.js';

export const PIN_LENGTH = 6;

async function _sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function pinFormatValido(pin) {
  return /^\d{6}$/.test(String(pin || ''));
}

export function tienePinConfigurado(user = {}) {
  return Boolean(user?.checadoPinHash);
}

/** Guarda el hash del PIN nuevo en el perfil del usuario. */
export async function configurarPin(docId, pin) {
  if (!docId || !pinFormatValido(pin)) throw new Error('El PIN debe tener 6 dígitos.');
  const hash = await _sha256Hex(pin);
  await db.collection(COL.USERS).doc(docId).update({
    checadoPinHash: hash,
    checadoPinConfiguradoEn: Date.now(),
  });
}

/** Compara el PIN capturado contra el hash guardado. */
export async function verificarPin(user, pin) {
  if (!pinFormatValido(pin)) return false;
  const stored = String(user?.checadoPinHash || '');
  if (!stored) return false;
  const hash = await _sha256Hex(pin);
  return hash === stored;
}
