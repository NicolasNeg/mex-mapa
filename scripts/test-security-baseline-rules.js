#!/usr/bin/env node
// Baseline de perfiles activos. Ejecutar con:
// firebase emulators:exec --only firestore "node scripts/test-security-baseline-rules.js"

const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');

const RULES = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const PROJECT_ID = 'mex-mapa-security-baseline';
const BOOTSTRAP_EMAIL = 'angelarmentta@icloud.com';

const operationalReads = [
  'turnos/turno-base',
  'horarios/horario-base',
  'asistencia/asistencia-base',
  'horarios_plantillas/plantilla-base',
  'notas_asistencia/nota-asistencia-base',
  'notas_semana/nota-semana-base',
  'turnos_roles_operativos/rol-base',
];

const blockedProfiles = [
  ['status INACTIVO', { status: 'INACTIVO' }],
  ['status RECHAZADO', { status: 'RECHAZADO' }],
  ['status BLOQUEADO', { status: 'BLOQUEADO' }],
  ['status SUSPENDIDO', { status: 'SUSPENDIDO' }],
  ['activo false', { activo: false }],
  ['autorizado false', { autorizado: false }],
  ['accesoSistema false', { accesoSistema: false }],
  ['status con tipo invalido', { status: 1 }],
  ['activo con tipo invalido', { activo: 'true' }],
  ['autorizado con tipo invalido', { autorizado: 'true' }],
  ['accesoSistema con tipo invalido', { accesoSistema: 'true' }],
  ['authUid de otra cuenta', { authUid: 'otro-uid' }],
];

let passed = 0;
let failed = 0;

async function check(label, assertion) {
  try {
    await assertion;
    console.log(`  OK   ${label}`);
    passed += 1;
  } catch (error) {
    console.error(`  FAIL ${label}: ${String(error.message || error).slice(0, 240)}`);
    failed += 1;
  }
}

function authDb(testEnv, uid) {
  return testEnv.authenticatedContext(uid, { email: `${uid}@test.local` }).firestore();
}

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES },
  });

  try {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc('usuarios/legacy-uid').set({ rol: 'AUXILIAR', plazaAsignada: 'CDMX' });

      for (const [index, [, profile]] of blockedProfiles.entries()) {
        await db.doc(`usuarios/blocked-${index}`).set({
          rol: 'AUXILIAR',
          plazaAsignada: 'CDMX',
          ...profile,
        });
      }

      for (const docPath of operationalReads) {
        await db.doc(docPath).set({ seeded: true });
      }
    });

    const legacyDb = authDb(testEnv, 'legacy-uid');
    for (const docPath of operationalReads) {
      await check(
        `perfil legacy puede leer ${docPath}`,
        assertSucceeds(legacyDb.doc(docPath).get())
      );
    }
    await check(
      'perfil legacy puede crear error_logs',
      assertSucceeds(legacyDb.doc('error_logs/legacy-log').set({ message: 'baseline' }))
    );

    for (const [index, [label]] of blockedProfiles.entries()) {
      const uid = `blocked-${index}`;
      const db = authDb(testEnv, uid);

      await check(
        `${label}: conserva lectura de su propio /usuarios`,
        assertSucceeds(db.doc(`usuarios/${uid}`).get())
      );

      for (const docPath of operationalReads) {
        await check(
          `${label}: no puede leer ${docPath}`,
          assertFails(db.doc(docPath).get())
        );
      }

      await check(
        `${label}: no puede crear error_logs`,
        assertFails(db.doc(`error_logs/blocked-${index}`).set({ message: 'blocked' }))
      );
      await check(
        `${label}: no puede abrir turno propio`,
        assertFails(db.doc(`turnos/blocked-${index}`).set({
          usuarioId: uid,
          usuarioNombre: uid,
          plazaId: 'CDMX',
          estado: 'ACTIVO',
        }))
      );
    }

    const bootstrapDb = testEnv.authenticatedContext('bootstrap-uid', {
      email: BOOTSTRAP_EMAIL,
    }).firestore();
    await check(
      'bootstrap sin perfil conserva lectura operativa',
      assertSucceeds(bootstrapDb.doc('turnos/turno-base').get())
    );
    await check(
      'bootstrap sin perfil conserva escritura de error_logs',
      assertSucceeds(bootstrapDb.doc('error_logs/bootstrap-log').set({ message: 'bootstrap' }))
    );
  } finally {
    await testEnv.cleanup();
  }

  console.log(`\nResultado: ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
