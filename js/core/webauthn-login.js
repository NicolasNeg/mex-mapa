// ═══════════════════════════════════════════════════════════
//  webauthn-login.js — Face ID / Touch ID / Windows Hello para INICIAR
//  SESIÓN (no confundir con webauthn-check.js, que es solo el checado de
//  turnos con confianza 100% cliente). Aquí sí hay verificación
//  criptográfica en servidor (Cloud Functions webauthnRegister*/webauthnLogin*)
//  porque el resultado es una sesión real de Firebase Auth.
// ═══════════════════════════════════════════════════════════

import { auth, functions } from '/js/core/database.js';

function _b64urlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function _bytesToB64url(bytes) {
  let bin = '';
  new Uint8Array(bytes).forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function _localFlagKey(email) {
  return `mex.login.passkey.${String(email || '').trim().toLowerCase()}`;
}

/** ¿Este correo tiene una passkey de login enrolada en ESTE dispositivo? */
export function tieneLoginPasskeyEnEsteDispositivo(email) {
  try {
    return localStorage.getItem(_localFlagKey(email)) === '1';
  } catch (_) {
    return false;
  }
}

function _marcarLoginPasskeyEnEsteDispositivo(email) {
  try {
    localStorage.setItem(_localFlagKey(email), '1');
  } catch (_) {}
}

export async function passkeyLoginDisponible() {
  try {
    if (!window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) return false;
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (_) {
    return false;
  }
}

function _creationOptionsFromJSON(json) {
  return {
    ...json,
    challenge: _b64urlToBytes(json.challenge),
    user: { ...json.user, id: _b64urlToBytes(json.user.id) },
    excludeCredentials: (json.excludeCredentials || []).map(c => ({ ...c, id: _b64urlToBytes(c.id) })),
  };
}

function _requestOptionsFromJSON(json) {
  return {
    ...json,
    challenge: _b64urlToBytes(json.challenge),
    allowCredentials: (json.allowCredentials || []).map(c => ({ ...c, id: _b64urlToBytes(c.id) })),
  };
}

function _registrationCredentialToJSON(cred) {
  return {
    id: cred.id,
    rawId: _bytesToB64url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    response: {
      clientDataJSON: _bytesToB64url(cred.response.clientDataJSON),
      attestationObject: _bytesToB64url(cred.response.attestationObject),
      transports: cred.response.getTransports ? cred.response.getTransports() : undefined,
    },
  };
}

function _authenticationCredentialToJSON(cred) {
  return {
    id: cred.id,
    rawId: _bytesToB64url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    response: {
      clientDataJSON: _bytesToB64url(cred.response.clientDataJSON),
      authenticatorData: _bytesToB64url(cred.response.authenticatorData),
      signature: _bytesToB64url(cred.response.signature),
      userHandle: cred.response.userHandle ? _bytesToB64url(cred.response.userHandle) : undefined,
    },
  };
}

/**
 * Enrola una passkey de login para el usuario YA autenticado (llamar desde
 * el perfil, con sesión activa — el correo se toma del usuario en sesión).
 */
export async function enrolarLoginPasskey(deviceLabel) {
  const email = auth.currentUser?.email;
  if (!email) throw new Error('Debes iniciar sesión primero.');

  const options = await functions.httpsCallable('webauthnRegisterOptions')({ email }).then(r => r.data);
  const cred = await navigator.credentials.create({ publicKey: _creationOptionsFromJSON(options) });
  if (!cred) throw new Error('No se pudo crear la passkey.');

  await functions.httpsCallable('webauthnRegisterVerify')({
    response: _registrationCredentialToJSON(cred),
    deviceLabel: deviceLabel || 'Este dispositivo',
  });
  _marcarLoginPasskeyEnEsteDispositivo(email);
}

/**
 * Inicia sesión con la passkey de ESTE dispositivo para el correo dado.
 * Devuelve el UserCredential de Firebase Auth (mismo shape que signInWith...).
 */
export async function loginConPasskey(email) {
  const { options, sessionId } = await functions.httpsCallable('webauthnLoginOptions')({ email })
    .then(r => r.data);
  const cred = await navigator.credentials.get({ publicKey: _requestOptionsFromJSON(options) });
  if (!cred) throw new Error('No se pudo verificar la passkey.');

  const { token } = await functions.httpsCallable('webauthnLoginVerify')({
    sessionId,
    response: _authenticationCredentialToJSON(cred),
  }).then(r => r.data);

  return auth.signInWithCustomToken(token);
}
