#!/usr/bin/env node
// scripts/test-turnos-rules.js
// Rules-only smoke test (no browser) for the manage_turnos permission gate.
// Verifies VENTAS is denied writes to horarios/asistencia/notas_asistencia,
// and SUPERVISOR is allowed — the exact gap closed by puedeGestionarTurnos()
// replacing the borrowed esAdminOperativo() (view/edit_admin_cuadre) check.
//
// Usage:
//   firebase emulators:exec --only firestore "node scripts/test-turnos-rules.js"

const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');

const G = s => `\x1b[32m${s}\x1b[0m`;
const R = s => `\x1b[31m${s}\x1b[0m`;
const Y = s => `\x1b[33m${s}\x1b[0m`;

let passed = 0, failed = 0;
async function check(label, promise) {
  try {
    await promise;
    console.log(G('  OK  ') + label);
    passed++;
  } catch (err) {
    console.log(R('  FAIL ') + label + ' — ' + err.message.slice(0, 200));
    failed++;
  }
}

(async () => {
  console.log(Y('\n-- turnos rules test (manage_turnos gate) --\n'));

  const testEnv = await initializeTestEnvironment({
    projectId: 'mex-mapa-rules-test',
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
    },
  });

  // Seed usuarios docs bypassing rules.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('usuarios/ventas-uid').set({ rol: 'VENTAS', plazaAsignada: 'CDMX' });
    await db.doc('usuarios/supervisor-uid').set({ rol: 'SUPERVISOR', plazaAsignada: 'CDMX' });
  });

  // request.auth.token.email must be present (even if unused) — rules read it
  // directly (tienePerfilEmail), and a missing key throws rather than reading null.
  const ventasDb = testEnv.authenticatedContext('ventas-uid', { email: 'ventas@test.local' }).firestore();
  const supervisorDb = testEnv.authenticatedContext('supervisor-uid', { email: 'supervisor@test.local' }).firestore();

  // ── horarios ──────────────────────────────────────────────────
  await check(
    'VENTAS denegado al crear horarios',
    assertFails(ventasDb.doc('horarios/h1').set({
      usuarioId: 'ventas-uid', plaza: 'CDMX', semanaInicio: '2026-07-13', dias: {},
    }))
  );
  await check(
    'SUPERVISOR puede crear horarios',
    assertSucceeds(supervisorDb.doc('horarios/h2').set({
      usuarioId: 'ventas-uid', plaza: 'CDMX', semanaInicio: '2026-07-13', dias: {},
    }))
  );

  // ── asistencia (admin branch — no es el propio check-in PENDIENTE) ──
  await check(
    'VENTAS denegado al crear asistencia de otro usuario',
    assertFails(ventasDb.doc('asistencia/a1').set({
      usuarioId: 'supervisor-uid', plaza: 'CDMX', fecha: '2026-07-18', estado: 'PRESENTE',
    }))
  );
  await check(
    'SUPERVISOR puede crear asistencia de otro usuario',
    assertSucceeds(supervisorDb.doc('asistencia/a2').set({
      usuarioId: 'ventas-uid', plaza: 'CDMX', fecha: '2026-07-18', estado: 'PRESENTE',
    }))
  );

  // ── notas_asistencia ─────────────────────────────────────────
  await check(
    'VENTAS denegado al crear notas_asistencia',
    assertFails(ventasDb.doc('notas_asistencia/n1').set({
      plaza: 'CDMX', usuarioId: 'ventas-uid', fecha: '2026-07-18', tipo: 'RETARDO',
    }))
  );
  await check(
    'SUPERVISOR puede crear notas_asistencia',
    assertSucceeds(supervisorDb.doc('notas_asistencia/n2').set({
      plaza: 'CDMX', usuarioId: 'ventas-uid', fecha: '2026-07-18', tipo: 'RETARDO',
    }))
  );

  await testEnv.cleanup();

  console.log('');
  console.log(Y('-- Resultado --'));
  console.log(`  ${G(`${passed} passed`)}  ${failed > 0 ? R(`${failed} failed`) : '0 failed'}\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
