// Domain tests for papeleta.model.js (no Firebase).
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const mod = await import(
    pathToFileURL(path.join(__dirname, '..', 'domain', 'papeleta.model.js')).href
  );

  // ZONAS_V1 intact (12); extras additive (tablero, interior, herramienta, refaccion)
  assert.strictEqual(mod.ZONAS_V1.length, 12);
  assert.strictEqual(mod.ZONAS_V1[0].id, 'trasera_cajuela');
  assert.strictEqual(mod.ZONAS_V1[11].id, 'cofre');
  assert.ok(mod.ZONAS_ALL.some((z) => z.id === 'tablero_kilometraje'));
  assert.ok(mod.ZONAS_ALL.some((z) => z.id === 'interior'));
  assert.ok(mod.ZONAS_ALL.some((z) => z.id === 'herramienta'));
  assert.ok(mod.ZONAS_ALL.some((z) => z.id === 'refaccion'));
  assert.strictEqual(mod.ZONAS_ALL.length, 16);
  assert.deepStrictEqual([...mod.ZONAS_CORE], [
    'frente_defensa',
    'parabrisas',
    'lateral_izq',
    'lateral_der',
    'trasera_cajuela',
    'interior',
    'herramienta',
  ]);
  assert.strictEqual(mod.ZONAS_CORE.length, 7);
  assert.strictEqual(mod.ZONA_TABLERO_ID, 'tablero_kilometraje');
  assert.strictEqual(mod.ZONA_CORE_LABELS.herramienta, 'Herramienta');
  assert.deepStrictEqual(mod.CHECKLIST_KEYS.slice(0, 3), ['placas', 'catalizador', 'tapon_gas']);

  const zonas = mod.createEmptyZonas();
  assert.ok(zonas.tablero_kilometraje);
  assert.ok(zonas.interior);
  assert.ok(zonas.herramienta);
  assert.strictEqual(mod.coreZonasHaveFoto(zonas), false);
  assert.strictEqual(mod.allZonasHaveFoto(zonas), false);
  assert.strictEqual(mod.tableroHaveFoto({ zonas }), false);

  for (const id of mod.ZONAS_CORE) {
    zonas[id] = { estado: 'ok', nota: '', fotoPath: `p/${id}`, capturedAt: null };
  }
  assert.strictEqual(mod.coreZonasHaveFoto(zonas), true);
  // Tablero is hard but NOT part of the 7/7 core counter
  assert.strictEqual(mod.tableroHaveFoto({ zonas }), false);

  for (const z of mod.ZONAS_V1) {
    zonas[z.id] = { estado: 'ok', nota: '', fotoPath: `p/${z.id}`, capturedAt: null };
  }
  assert.strictEqual(mod.allZonasHaveFoto(zonas), true);

  // Legacy fotoTableroPath fallback (tablero slot, not core)
  const zonasNoTablero = {
    ...zonas,
    tablero_kilometraje: { estado: 'ok', nota: '', fotoPath: '', capturedAt: null },
  };
  assert.strictEqual(mod.coreZonasHaveFoto(zonasNoTablero), true);
  assert.strictEqual(mod.tableroHaveFoto({ zonas: zonasNoTablero }), false);
  assert.strictEqual(
    mod.tableroHaveFoto({ zonas: zonasNoTablero, fotoTableroPath: 'legacy/tablero.jpg' }),
    true
  );
  assert.strictEqual(
    mod.resolveZonaFotoPath(zonasNoTablero, 'tablero_kilometraje', {
      fotoTableroPath: 'legacy/tablero.jpg',
    }),
    'legacy/tablero.jpg'
  );
  zonas.tablero_kilometraje = { estado: 'ok', nota: '', fotoPath: 'p/tablero', capturedAt: null };
  assert.strictEqual(mod.tableroHaveFoto({ zonas }), true);

  // Tapetes 0–9: 0 válido (= no tiene); multi-dígito / vacío no
  assert.strictEqual(mod.isValidTapeteDigit(0), true);
  assert.strictEqual(mod.isValidTapeteDigit('0'), true);
  assert.strictEqual(mod.isValidTapeteDigit(9), true);
  assert.strictEqual(mod.isValidTapeteDigit(''), false);
  assert.strictEqual(mod.isValidTapeteDigit(null), false);
  assert.strictEqual(mod.isValidTapeteDigit(10), false);
  assert.strictEqual(mod.isValidTapeteDigit('12'), false);

  // Checklist keys alone incomplete without llantas/tapetes
  const cl = mod.createEmptyChecklist();
  assert.strictEqual(mod.checklistCompleto(cl), false);
  for (const k of mod.CHECKLIST_KEYS) cl[k] = 'ok';
  assert.strictEqual(mod.checklistCompleto(cl), true);

  let p = {
    status: 'borrador',
    checklist: cl,
    zonas,
    marcasLlantas: mod.createEmptyMarcasLlantas(),
    tapetes: { usoRudo: null, alfombra: null },
    salida: { km: 1000, gas: 4 },
    clienteNombre: 'Ana',
  };
  assert.strictEqual(mod.isChecklistComplete(p), false);

  p = {
    ...p,
    marcasLlantas: {
      delanteraIzq: 'M',
      delanteraDer: 'M',
      traseraIzq: 'M',
      traseraDer: 'M',
      marcarTodas: true,
    },
    tapetes: { usoRudo: 0, alfombra: 4 }, // 0 = no tiene — válido
  };
  assert.strictEqual(mod.isChecklistComplete(p), true);

  const firmaOk = {
    imagePath: 'f/1.png',
    signerName: 'Ana',
    signerRole: 'Cliente',
    signedAt: Date.now(),
    capturedBy: 'u1',
    consentTextVersion: 'v1',
  };

  // faltante is soft, not hard
  p = { ...p, checklist: { ...cl, placas: 'faltante' }, status: 'borrador' };
  let gate = mod.puedeEntregar(p, { firma: firmaOk });
  assert.strictEqual(gate.ok, true);
  assert.ok(gate.soft.includes('faltantes'));
  assert.ok(!gate.hard.includes('checklist'));

  // missing core photo → hard
  const zonasMissing = {
    ...zonas,
    herramienta: { estado: 'ok', nota: '', fotoPath: '', capturedAt: null },
  };
  gate = mod.puedeEntregar({ ...p, zonas: zonasMissing }, { firma: firmaOk });
  assert.strictEqual(gate.ok, false);
  assert.ok(gate.hard.includes('core_photos'));

  // missing tablero → hard (separate from core_photos)
  const zonasSinTablero = {
    ...zonas,
    tablero_kilometraje: { estado: 'ok', nota: '', fotoPath: '', capturedAt: null },
  };
  gate = mod.puedeEntregar(
    { ...p, zonas: zonasSinTablero, fotoTableroPath: '' },
    { firma: firmaOk }
  );
  assert.strictEqual(gate.ok, false);
  assert.ok(gate.hard.includes('tablero_photo'));
  assert.ok(!gate.hard.includes('core_photos'));

  // terminal / cancelada
  gate = mod.puedeEntregar({ ...p, status: 'entregada' }, { firma: firmaOk });
  assert.strictEqual(gate.ok, false);
  assert.ok(gate.hard.includes('status'));

  gate = mod.puedeEntregar({ ...p, status: 'cancelada' }, { firma: firmaOk });
  assert.strictEqual(gate.ok, false);

  // missing firma → hard
  gate = mod.puedeEntregar(p, { firma: null });
  assert.strictEqual(gate.ok, false);
  assert.ok(gate.hard.includes('firma'));

  // invalid km → hard
  gate = mod.puedeEntregar(
    { ...p, salida: { ...p.salida, km: null } },
    { firma: firmaOk }
  );
  assert.strictEqual(gate.ok, false);
  assert.ok(gate.hard.includes('km'));

  // Legacy boolean shim still works
  assert.strictEqual(mod.puedeEntregar('lista', zonas, cl), true);
  assert.strictEqual(mod.puedeEntregar('borrador', zonas, cl), false);

  // displayNumber never reused when lastAssigned is tracked
  const marks = [];
  const n1 = mod.nextDisplayNumber(marks, 0);
  const m1 = mod.createDamageMark({
    view: 'left_side',
    x: 0.5,
    y: 0.5,
    damageType: 'scratch',
    severity: 'small',
    nextDisplayNumber: n1,
  });
  marks.push(m1);
  assert.strictEqual(m1.displayNumber, 1);
  marks.pop();
  const n2 = mod.nextDisplayNumber(marks, 1); // lastAssigned survives delete
  const m2 = mod.createDamageMark({
    view: 'left_side',
    x: 0.2,
    y: 0.2,
    damageType: 'dent',
    severity: 'medium',
    nextDisplayNumber: n2,
  });
  assert.strictEqual(m2.displayNumber, 2);
  assert.notStrictEqual(m1.id, m2.id);

  assert.strictEqual(mod.clampNorm(1.2), 1);
  assert.strictEqual(mod.clampNorm(-0.1), 0);
  assert.strictEqual(mod.clampNorm(0.42), 0.42);

  assert.strictEqual(mod.isSalidaMutable('borrador'), true);
  assert.strictEqual(mod.isSalidaMutable('entregada'), false);
  assert.throws(() => mod.assertSalidaMutable('entregada'));

  assert.strictEqual(mod.puedeEditar('entregada'), false);
  assert.strictEqual(mod.puedeEditar('lista'), true);

  assert.strictEqual(
    mod.computeStatusAfterSave({ status: 'borrador', zonas, checklist: cl, papeleta: p }),
    'lista'
  );
  assert.strictEqual(
    mod.computeStatusAfterSave({ status: 'cancelada', zonas, checklist: cl }),
    'cancelada'
  );
  assert.strictEqual(
    mod.computeStatusAfterSave({ status: 'entregada', zonas, checklist: cl }),
    'entregada'
  );

  // Incomplete → borrador
  assert.strictEqual(
    mod.computeStatusAfterSave({
      status: 'borrador',
      zonas: mod.createEmptyZonas(),
      checklist: cl,
      papeleta: { ...p, zonas: mod.createEmptyZonas() },
    }),
    'borrador'
  );

  assert.strictEqual(mod.DAMAGE_PHOTO_POLICY.glass, 'strongly_recommended');
  assert.strictEqual(mod.STATUS.CANCELADA, 'cancelada');

  assert.strictEqual(mod.kmTableroRetakeNeeded(
    { zonas: { tablero_kilometraje: { fotoPath: 'x', capturedAt: 1 } }, salida: { km: 100 } },
    200
  ), true);
  assert.strictEqual(mod.kmTableroRetakeNeeded(
    { zonas: { tablero_kilometraje: { fotoPath: 'x' } }, salida: { km: 100 } },
    100
  ), false);

  assert.strictEqual(mod.danoYaDocumentadoEnSalida('cofre', { cofre: { estado: 'dano' } }), true);
  assert.strictEqual(mod.danoYaDocumentadoEnSalida('cofre', { cofre: { estado: 'ok' } }), false);

  assert.strictEqual(mod.rolPuedeCerrarCaso('VENTAS'), false);
  assert.strictEqual(mod.rolPuedeCerrarCaso('SUPERVISOR'), true);
  assert.strictEqual(mod.rolPuedeGestionarVentas('VENTAS'), true);
  assert.strictEqual(mod.rolPuedeGestionarVentas('AUXILIAR'), false);

  const compared = mod.buildEntradaDamageComparison(
    [{ id: 'd1', displayNumber: 1 }],
    [{ id: 'e1', sourceDamageId: 'd1', damageType: 'scratch' }]
  );
  assert.strictEqual(compared[0].comparisonStatus, 'preexisting');

  console.log('OK papeleta.model redesign', mod.ZONAS_CORE.length, 'core');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
