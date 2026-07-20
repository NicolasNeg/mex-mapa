// Domain tests for papeleta.model.js (no Firebase).
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const mod = await import(
    pathToFileURL(path.join(__dirname, '..', 'domain', 'papeleta.model.js')).href
  );

  assert.strictEqual(mod.ZONAS_V1.length, 12);
  assert.strictEqual(mod.ZONAS_V1[0].id, 'trasera_cajuela');
  assert.strictEqual(mod.ZONAS_V1[11].id, 'cofre');
  assert.deepStrictEqual(mod.CHECKLIST_KEYS.slice(0, 3), ['tapetes', 'placas', 'catalizador']);

  const zonas = mod.createEmptyZonas();
  assert.strictEqual(mod.allZonasHaveFoto(zonas), false);
  zonas.frente_defensa = { estado: 'ok', nota: '', fotoPath: 'x' };
  assert.strictEqual(mod.allZonasHaveFoto(zonas), false);

  for (const z of mod.ZONAS_V1) {
    zonas[z.id] = { estado: 'ok', nota: '', fotoPath: `p/${z.id}` };
  }
  assert.strictEqual(mod.allZonasHaveFoto(zonas), true);

  const cl = mod.createEmptyChecklist();
  assert.strictEqual(mod.checklistCompleto(cl), false);
  for (const k of mod.CHECKLIST_KEYS) cl[k] = 'ok';
  assert.strictEqual(mod.checklistCompleto(cl), true);

  assert.strictEqual(mod.puedeEditar('entregada'), false);
  assert.strictEqual(mod.puedeEditar('lista'), true);
  assert.strictEqual(mod.puedeEntregar('lista', zonas, cl), true);
  assert.strictEqual(mod.puedeEntregar('borrador', zonas, cl), false);

  assert.strictEqual(mod.danoYaDocumentadoEnSalida('cofre', { cofre: { estado: 'dano' } }), true);
  assert.strictEqual(mod.danoYaDocumentadoEnSalida('cofre', { cofre: { estado: 'ok' } }), false);

  assert.strictEqual(mod.rolPuedeCerrarCaso('VENTAS'), false);
  assert.strictEqual(mod.rolPuedeCerrarCaso('SUPERVISOR'), true);
  assert.strictEqual(mod.rolPuedeGestionarVentas('VENTAS'), true);
  assert.strictEqual(mod.rolPuedeGestionarVentas('AUXILIAR'), false);

  assert.strictEqual(
    mod.computeStatusAfterSave({ status: 'borrador', zonas, checklist: cl }),
    'lista'
  );

  console.log('OK papeleta.model', mod.ZONAS_V1.length, 'zonas');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
