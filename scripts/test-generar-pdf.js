#!/usr/bin/env node

const assert = require('node:assert/strict');

async function emulatorHost(name) {
  const hubHost = String(process.env.FIREBASE_EMULATOR_HUB || '127.0.0.1:4400').trim();
  const response = await fetch(`http://${hubHost}/emulators`);
  const emulators = await response.json();
  const entry = emulators?.[name];
  if (!entry?.host || !entry?.port) throw new Error(`Emulador '${name}' no está corriendo.`);
  return `${entry.host}:${entry.port}`;
}

async function signInAnonymously(authHost) {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) }
  );
  const body = await response.json();
  assert.ok(body.idToken, 'signUp anónimo del emulador de Auth debe devolver idToken');
  return body.idToken;
}

async function seedEmptyUserProfile(firestoreHost, uid) {
  // findUserProfileFromAuth solo exige que exista el doc en usuarios/{uid};
  // un doc vacío ya pasa isActiveUserProfile() (sin status bloqueado, sin
  // flags en false). No hace falta perfil real para este smoke test.
  const url = `http://${firestoreHost}/v1/projects/mex-mapa-bjx/databases/(default)/documents/usuarios/${uid}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {} }),
  });
  assert.ok(response.ok, `no se pudo sembrar usuarios/${uid} en el emulador de Firestore`);
}

(async () => {
  const authHost = await emulatorHost('auth');
  const firestoreHost = await emulatorHost('firestore');
  const functionsHost = await emulatorHost('functions');
  const idToken = await signInAnonymously(authHost);
  const uid = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8')).user_id;
  await seedEmptyUserProfile(firestoreHost, uid);

  const html = '<!DOCTYPE html><html><body><h1>Smoke test PDF</h1></body></html>';
  const response = await fetch(
    `http://${functionsHost}/mex-mapa-bjx/us-central1/generarYSubirPdf`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ data: { kind: 'cuadre', docId: '', html, filename: 'SMOKE_TEST_2026_07_22_MAPGESTION' } }),
    }
  );
  const body = await response.json();
  assert.ok(response.ok, `la Function respondió ${response.status}: ${JSON.stringify(body)}`);
  assert.ok(body.result && typeof body.result.url === 'string', 'debe devolver { result: { url } }');
  assert.match(body.result.url, /^https:\/\/res\.cloudinary\.com\//, 'la URL debe ser de Cloudinary');
  console.log('OK — PDF generado:', body.result.url);
})().catch((err) => { console.error('FAIL', err); process.exit(1); });
