// Rules test: reproduce el flujo real de EMITIR y ELIMINAR alerta maestra.
// El cliente hace: (1) alertas.add / alertas.delete  →  (2) bitacora_gestion.set (auditoría).
// Si el paso 2 se DENIEGA, la alerta ya se envió pero nunca se retorna "EXITO"
// → no hay confirmación y el usuario ve "missing permissions".
//
// Ejecutar: npx firebase-tools@13 emulators:exec --only firestore "node scripts/test-alert-emit-delete-rules.js"
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, deleteDoc, addDoc, collection } = require('firebase/firestore');

const RULES = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const PROG_EMAIL = 'armentanegreteangelnicolas@gmail.com';   // bootstrap programmer
const GERENTE_EMAIL = 'gte@gmail.com';                        // rol con emit_master_alerts

// Payload de auditoría EXACTO que produce _sanearEventoGestionExtra (mex-api.js)
// para un EMIT (extra = { entidad:'ALERTAS', referencia:titulo }), sin ubicación.
function auditPayload(tipo, accion, autor, extra) {
  return {
    fecha: '13/07/2026 10:00',
    timestamp: Date.now(),
    tipo,
    accion,
    autor,
    entidad: '',
    referencia: '',
    detalles: '',
    objetivo: '',
    rolObjetivo: '',
    plazaObjetivo: '',
    resultado: '',
    deviceId: '',
    activeRoute: '',
    locationStatus: 'granted',
    exactLocation: null,
    ...extra,
  };
}

const CONFIG_CON_PERMISO = {
  security: { roles: { GERENTE_PLAZA: { permissions: { emit_master_alerts: true, view_admin_cuadre: true } } } }
};

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-alert-emit',
    firestore: { rules: RULES },
  });

  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'configuracion/empresa'), CONFIG_CON_PERMISO);
    await setDoc(doc(db, 'usuarios/' + PROG_EMAIL), { rol: 'PROGRAMADOR', email: PROG_EMAIL, activo: true });
    await setDoc(doc(db, 'usuarios/' + GERENTE_EMAIL), { rol: 'GERENTE_PLAZA', email: GERENTE_EMAIL, activo: true });
    await setDoc(doc(db, 'alertas/a_prog'),   { titulo: 'X', leidoPor: '', tipo: 'INFORMATIVO' });
    await setDoc(doc(db, 'alertas/a_gte'),     { titulo: 'Y', leidoPor: '', tipo: 'INFORMATIVO' });
  });

  const run = async (label, email, uid) => {
    const db = testEnv.authenticatedContext(uid, { email }).firestore();
    const out = [];
    const t = async (name, fn) => {
      try { await assertSucceeds(fn()); out.push(`  ${name.padEnd(34)} ALLOWED ✅`); }
      catch (e) { out.push(`  ${name.padEnd(34)} DENIED ❌  (${(e.code||e.message||'').toString().slice(0,50)})`); }
    };
    console.log(`\n── ${label} (${email}) ──`);
    // EMIT
    await t('1. alertas.add (emit)',        () => addDoc(collection(db, 'alertas'), { titulo: 'Nueva', leidoPor: '', tipo: 'INFORMATIVO', timestamp: Date.now() }));
    await t('2. bitacora_gestion.set (emit)', () => setDoc(doc(db, 'bitacora_gestion/g_emit_'+uid), auditPayload('ALERTA_EMITIDA', 'Emitió alerta', 'PROG', { entidad: 'ALERTAS', referencia: 'Nueva' })));
    // DELETE
    const alertId = email === PROG_EMAIL ? 'a_prog' : 'a_gte';
    await t('3. alertas.delete',            () => deleteDoc(doc(db, 'alertas/' + alertId)));
    await t('4. bitacora_gestion.set (del)', () => setDoc(doc(db, 'bitacora_gestion/g_del_'+uid), auditPayload('ALERTA_ELIMINADA', 'Eliminó alerta', 'PROG', { entidad: 'ALERTAS', referencia: alertId })));
    out.forEach(l => console.log(l));
  };

  await run('PROGRAMADOR bootstrap', PROG_EMAIL, 'prog-uid');
  await run('GERENTE con emit_master_alerts', GERENTE_EMAIL, 'gte-uid');

  await testEnv.cleanup();
})();
