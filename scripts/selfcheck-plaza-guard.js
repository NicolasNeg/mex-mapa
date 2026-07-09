// Self-check puro: decide si se bloquea la inserción por plazaActual.
// ponytail: lógica extraída para testear sin Firebase.
function bloqueaPorPlaza(plazaActualIndex, plazaDestino) {
  const actual = String(plazaActualIndex || '').toUpperCase().trim();
  const destino = String(plazaDestino || '').toUpperCase().trim();
  return actual !== '' && actual !== destino;
}

const assert = require('assert');
assert.equal(bloqueaPorPlaza('', 'BAJIO'), false, 'vacío => permite');
assert.equal(bloqueaPorPlaza('BAJIO', 'BAJIO'), false, 'misma plaza => permite');
assert.equal(bloqueaPorPlaza('LEON', 'BAJIO'), true, 'otra plaza => bloquea');
assert.equal(bloqueaPorPlaza('leon', 'BAJIO'), true, 'case-insensitive');
assert.equal(bloqueaPorPlaza('BAJIO', ''), true, 'destino vacío con actual => bloquea');
console.log('OK plaza-guard');

module.exports = { bloqueaPorPlaza };
