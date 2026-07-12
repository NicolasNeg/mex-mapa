// Rules test: ¿un AUXILIAR puede marcar una alerta como leída (solo campo leidoPor)?
// Ejecutar con:  firebase emulators:exec --only firestore "node scripts/test-alert-rules.js"
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc } = require('firebase/firestore');

const RULES = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const AUX = 'aux@gmail.com';

// Distintos estados de configuracion/empresa para ver cuál dispara el error
const CONFIGS = {
  'config bien formada (AUXILIAR con permissions)': { security: { roles: { AUXILIAR: { permissions: { emit_master_alerts: false } } } } },
  'sin doc configuracion/empresa':                  null,
  'AUXILIAR sin permissions map':                   { security: { roles: { AUXILIAR: {} } } },
  'security.roles sin AUXILIAR':                    { security: { roles: { GERENTE_PLAZA: { permissions: {} } } } },
};

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-alert-rules',
    firestore: { rules: RULES },
  });

  const results = [];
  for (const [label, cfg] of Object.entries(CONFIGS)) {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      if (cfg) await setDoc(doc(db, 'configuracion/empresa'), cfg);
      await setDoc(doc(db, 'usuarios/' + AUX), { rol: 'AUXILIAR', email: AUX, activo: true });
      await setDoc(doc(db, 'alertas/alert1'), { titulo: 'Probando', leidoPor: '', tipo: 'INFORMATIVO' });
    });

    const db = testEnv.authenticatedContext('aux-uid', { email: AUX }).firestore();
    // Positivo: marcar leído (solo leidoPor) → debe permitir
    let res;
    try { await updateDoc(doc(db, 'alertas/alert1'), { leidoPor: 'AUX' }); res = 'ALLOWED ✅'; }
    catch (e) { res = 'DENIED ❌ (' + (e.code || e.message).toString().slice(0, 40) + ')'; }
    // Negativo: cambiar titulo (no es solo leidoPor) → NO debe permitir a un AUXILIAR
    let neg;
    try { await updateDoc(doc(db, 'alertas/alert1'), { titulo: 'HACK' }); neg = 'ALLOWED ⚠️  (hueco!)'; }
    catch (e) { neg = 'DENIED ✅'; }
    results.push([label, res, neg]);
  }

  console.log('\n── AUXILIAR: marcar leído (solo leidoPor)  |  cambiar titulo (debe negar) ──');
  for (const [l, r, n] of results) console.log(`  leído: ${r.padEnd(22)}  titulo: ${n.padEnd(20)}  ${l}`);
  await testEnv.cleanup();
})();
