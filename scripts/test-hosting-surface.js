#!/usr/bin/env node

const assert = require('node:assert/strict');

const forbiddenPaths = [
  '/request.json',
  '/serviceAccountKey.json'
];

async function resolveBaseUrl() {
  const explicitHost = String(process.env.FIREBASE_HOSTING_EMULATOR_HOST || '').trim();
  if (explicitHost) return `http://${explicitHost.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;

  const hubHost = String(process.env.FIREBASE_EMULATOR_HUB || '').trim();
  if (hubHost) {
    const response = await fetch(`http://${hubHost}/emulators`);
    const emulators = await response.json();
    if (emulators?.hosting?.host && emulators?.hosting?.port) {
      return `http://${emulators.hosting.host}:${emulators.hosting.port}`;
    }
  }

  return 'http://127.0.0.1:5000';
}

async function status(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'GET',
    redirect: 'manual'
  });
  await response.body?.cancel();
  return response.status;
}

(async () => {
  const baseUrl = await resolveBaseUrl();
  const appStatus = await status(baseUrl, '/app.html');
  assert.ok([200, 301, 302, 307, 308].includes(appStatus), `El runtime esperado /app.html respondio ${appStatus}`);

  for (const pathname of forbiddenPaths) {
    const code = await status(baseUrl, pathname);
    assert.equal(code, 404, `${pathname} debe responder 404, respondio ${code}`);
  }

  console.log(`OK hosting surface: ${forbiddenPaths.length} rutas de secretos ausentes`);
})().catch(error => {
  console.error(`FAIL hosting surface: ${error.message}`);
  process.exitCode = 1;
});
