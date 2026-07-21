// ═══════════════════════════════════════════════════════════
//  webauthn-check.js — biometria nativa del dispositivo (Face ID /
//  Touch ID / Windows Hello) via el "platform authenticator" del
//  navegador. Sin backend: el checado ya confia en verificaciones
//  100% cliente (igual que face-verify.js con Human.js) — aqui el
//  navegador/SO son quienes realmente exigen la biometria, nosotros
//  solo confirmamos que la aserción se completó para ESTE origen.
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

export async function biometriaNativaDisponible() {
  try {
    if (!window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) return false;
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (_) {
    return false;
  }
}

/** Registra el autenticador nativo del dispositivo para este usuario. */
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
  await db.collection(COL.USERS).doc(docId).update({
    webauthnCredentialId: credentialId,
    webauthnEnrolledAt: Date.now(),
  });
  return credentialId;
}

/**
 * Pide Face ID/Touch ID/Windows Hello nativo. Si el SO completa la
 * verificación, la aserción existe → identidad confirmada para este
 * dispositivo. Devuelve false si el usuario cancela o falla.
 */
export async function verificarBiometriaNativa(credentialId) {
  if (!credentialId) return false;
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: _b64urlToBytes(credentialId), type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return Boolean(assertion);
  } catch (_) {
    return false;
  }
}
