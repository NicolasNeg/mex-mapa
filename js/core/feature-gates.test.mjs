import assert from 'node:assert';
import { test } from 'node:test';

// El IIFE corre una sola vez (import cacheado), así que usamos un window
// compartido poblado antes del import.
globalThis.window = {};
await import('./feature-gates.js');
const { window } = globalThis;

test('puedeUsar siempre true, sin catálogo de planes', () => {
  assert.equal(window.mexFeatures.puedeUsar('cuadre'), true);
  assert.equal(window.mexFeatures.puedeUsar('lo_que_sea'), true);
  assert.equal(window.mexFeatures.PLANES, undefined, 'no debe existir catálogo de planes');
});

test('mexPerms: defaults por rol + override desde MEX_CONFIG.empresa.rolePermissions', () => {
  const { mexPerms } = window;

  // Rol fullAccess → todo true.
  mexPerms.init('PROGRAMADOR');
  assert.equal(mexPerms.canDo('manage_settings'), true);

  // AUXILIAR: default niega manage_users, permite view_mapa.
  mexPerms.init('AUXILIAR');
  delete window.MEX_CONFIG;
  assert.equal(mexPerms.canDo('view_mapa'), true);
  assert.equal(mexPerms.canDo('manage_users'), false);

  // Override desde la config en la nube (configuracion/empresa).
  window.MEX_CONFIG = { empresa: { rolePermissions: { AUXILIAR: { manage_users: true } } } };
  assert.equal(mexPerms.canDo('manage_users'), true, 'el override debe ganar al default');
  assert.equal(mexPerms.canDo('view_mapa'), true, 'lo no-overrideado mantiene el default');
});
