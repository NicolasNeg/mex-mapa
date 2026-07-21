#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');

const RULES = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const PROJECT_ID = 'mex-mapa-messages-rules';

function message(overrides = {}) {
  return {
    timestamp: Date.now(),
    fecha: '21/07/2026 12:00',
    remitente: 'ALICE@EXAMPLE.COM',
    destinatario: 'BOB@EXAMPLE.COM',
    remitenteUid: 'alice-uid',
    remitenteEmail: 'alice@example.com',
    remitenteNombre: 'ALICE',
    destinatarioUid: 'bob-uid',
    destinatarioEmail: 'bob@example.com',
    destinatarioNombre: 'BOB',
    mensaje: 'Hola',
    leido: 'NO',
    ...overrides,
  };
}

(async () => {
  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES },
  });

  try {
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await db.doc('usuarios/alice-uid').set({
        authUid: 'alice-uid',
        email: 'alice@example.com',
        nombre: 'ALICE',
        rol: 'AUXILIAR',
        status: 'ACTIVO',
      });
      await db.doc('usuarios/bob-uid').set({
        authUid: 'bob-uid',
        email: 'bob@example.com',
        nombre: 'BOB',
        rol: 'AUXILIAR',
        status: 'ACTIVO',
      });
    });

    const alice = env.authenticatedContext('alice-uid', {
      email: 'alice@example.com',
    }).firestore();

    await assertSucceeds(alice.doc('mensajes/valid').set(message()));
    await assertFails(alice.doc('mensajes/spoofed-uid').set(message({
      remitenteUid: 'bob-uid',
    })));
    await assertFails(alice.doc('mensajes/spoofed-email').set(message({
      remitenteEmail: 'bob@example.com',
    })));
    await assertFails(alice.doc('mensajes/no-recipient-identity').set(message({
      destinatarioUid: '',
      destinatarioEmail: '',
    })));

    console.log('Mensajes rules: 4/4 checks passed.');
  } finally {
    await env.cleanup();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
