// Self-check de domain/kilometraje.model.js — correr: node scripts/check-kilometraje.mjs
import assert from 'node:assert/strict';
import { parseKm, clasificarCaptura } from '../domain/kilometraje.model.js';

// parseKm
assert.equal(parseKm('12,345'), 12345);
assert.equal(parseKm(' 150000 '), 150000);
assert.equal(parseKm(45210), 45210);
assert.equal(parseKm('abc'), null);
assert.equal(parseKm(''), null);
assert.equal(parseKm(null), null);
assert.equal(parseKm('-5'), null);
assert.equal(parseKm('15.5'), null); // km entero, sin decimales

// clasificarCaptura
assert.deepEqual(clasificarCaptura({ kmNuevo: 100, kmAnterior: null }), { tipo: 'NORMAL', delta: 0 }); // primera captura fija la base
assert.deepEqual(clasificarCaptura({ kmNuevo: 103, kmAnterior: 100 }), { tipo: 'NORMAL', delta: 3 }); // drift de patio ≤ umbral
assert.deepEqual(clasificarCaptura({ kmNuevo: 120, kmAnterior: 100 }), { tipo: 'DISCREPANCIA', delta: 20 }); // > umbral sin salida legítima
assert.deepEqual(clasificarCaptura({ kmNuevo: 900, kmAnterior: 100, fuenteUltima: 'RETIRO_RENTA' }), { tipo: 'NORMAL', delta: 800 }); // regreso de renta
assert.deepEqual(clasificarCaptura({ kmNuevo: 900, kmAnterior: 100, fuenteUltima: 'TRASLADO_SALIDA' }), { tipo: 'NORMAL', delta: 800 });
assert.deepEqual(clasificarCaptura({ kmNuevo: 90, kmAnterior: 100 }), { tipo: 'RECHAZADO_MENOR', delta: -10 }); // km no puede bajar
assert.deepEqual(clasificarCaptura({ kmNuevo: 90, kmAnterior: 100, esCorreccion: true }), { tipo: 'CORRECCION', delta: -10 }); // corrección sí puede
assert.deepEqual(clasificarCaptura({ kmNuevo: 106, kmAnterior: 100, umbral: 10 }), { tipo: 'NORMAL', delta: 6 }); // umbral configurable
assert.deepEqual(clasificarCaptura({ kmNuevo: -1, kmAnterior: 100 }), { tipo: 'INVALIDO', delta: 0 });

console.log('kilometraje.model OK');
