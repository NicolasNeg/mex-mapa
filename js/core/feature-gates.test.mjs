import assert from 'node:assert';
import { test } from 'node:test';

// Cargamos el IIFE en un global simulado.
test('puedeUsar siempre true, sin catálogo de planes', async () => {
  const window = {};
  globalThis.window = window;
  await import('./feature-gates.js');
  assert.equal(window.mexFeatures.puedeUsar('cuadre'), true);
  assert.equal(window.mexFeatures.puedeUsar('lo_que_sea'), true);
  assert.equal(window.mexFeatures.PLANES, undefined, 'no debe existir catálogo de planes');
});
