// ═══════════════════════════════════════════════════════════
//  webauthn-check.js — biometria nativa del dispositivo (Face ID /
//  Touch ID / Windows Hello) via el "platform authenticator" del
//  navegador. Sin backend: el checado ya confia en verificaciones
//  100% cliente (igual que face-verify.js con Human.js) — aqui el
//  navegador/SO son quienes realmente exigen la biometria, nosotros
//  solo confirmamos que la aserción se completó para ESTE origen.
//
//  Un credential de plataforma vive SOLO en el dispositivo donde se
//  creo (Windows Hello en la PC no existe para Safari en el celular).
//  Por eso guardamos un ARRAY de credenciales por usuario (una por
//  cada dispositivo que enrola), y restringimos transports:['internal']
//  para que el navegador NUNCA ofrezca "usar otro dispositivo"
//  (QR/llave de seguridad) — si este dispositivo no tiene ninguna de
//  las credenciales guardadas, debe fallar limpio, no mostrar ese modal.
// ═══════════════════════════════════════════════════════════

import { db, COL } from '/js/core/database.js';

function _b64urlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function _bytesToB64url(bytes) {
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function _fv() {
  return window.firebase?.firestore?.FieldValue;
}

export async function biometriaNativaDisponible() {
  try {
    if (!window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) return false;
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (_) {
    return false;
  }
}

/** Normaliza el/los credential id(s) guardados (array nuevo o string legacy). */
export function credencialesDe(user = {}) {
  if (Array.isArray(user.webauthnCredentialIds)) return user.webauthnCredentialIds.filter(Boolean);
  if (user.webauthnCredentialId) return [user.webauthnCredentialId];
  return [];
}

/** Registra el autenticador nativo de ESTE dispositivo para el usuario (se suma, no reemplaza). */
export async function enrolarBiometriaNativa(docId, userLabel) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'MapGestion' },
      user: { id: userId, name: userLabel || docId, displayName: userLabel || docId },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000,
    },
  });
  if (!cred) throw new Error('No se pudo registrar la biometría del dispositivo.');
  const credentialId = _bytesToB64url(new Uint8Array(cred.rawId));
  const fv = _fv();
  await db.collection(COL.USERS).doc(docId).update({
    webauthnCredentialIds: fv ? fv.arrayUnion(credentialId) : [credentialId],
    webauthnEnrolledAt: Date.now(),
  });
  return credentialId;
}

/**
 * Pide Face ID/Touch ID/Windows Hello nativo. Si el SO completa la
 * verificación con alguna de las credenciales conocidas, identidad
 * confirmada para este dispositivo. transports:['internal'] evita que
 * el navegador ofrezca QR/llave de seguridad cuando este dispositivo
 * no tiene ninguna localmente — falla limpio (false) en su lugar.
 */
export async function verificarBiometriaNativa(credentialIds) {
  const ids = (Array.isArray(credentialIds) ? credentialIds : [credentialIds]).filter(Boolean);
  if (!ids.length) return false;
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: ids.map(id => ({ id: _b64urlToBytes(id), type: 'public-key', transports: ['internal'] })),
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return Boolean(assertion);
  } catch (_) {
    return false;
  }
}
