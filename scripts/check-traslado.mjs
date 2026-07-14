// Self-check de domain/traslado.model.js - correr: node scripts/check-traslado.mjs
import assert from "node:assert/strict";
import {
  choferElegible,
  estadoOperativoTraslado,
  licenciaVigente,
  normalizarTipoTraslado,
  validarCierreTraslado
} from "../domain/traslado.model.js";

const now = new Date("2026-07-14T18:00:00-06:00").getTime();

assert.equal(estadoOperativoTraslado({ estado: "ABIERTO", fechaSalida: now + 60000, now }), "PROGRAMADO");
assert.equal(estadoOperativoTraslado({ estado: "ABIERTO", fechaSalida: now - 60000, now }), "ABIERTO");
assert.equal(estadoOperativoTraslado({ estado: "CERRADO", fechaSalida: now + 60000, now }), "CERRADO");

assert.equal(licenciaVigente("2026-07-14", now), true);
assert.equal(licenciaVigente("2026-07-13", now), false);
assert.equal(choferElegible({ isChofer: true, licenciaVencimiento: "2026-07-15" }, now), true);
assert.equal(choferElegible({ isChofer: false, licenciaVencimiento: "2026-07-15" }, now), false);
assert.equal(choferElegible({ isChofer: true, licenciaVencimiento: "2026-07-01" }, now), false);

assert.deepEqual(validarCierreTraslado({ kmSalida: 100, kmLlegada: 101, fechaSalida: now - 60000, fechaCierre: now, now }), { ok: true, code: "OK", message: "OK" });
assert.equal(validarCierreTraslado({ kmSalida: 100, kmLlegada: 99, fechaCierre: now, now }).code, "KM_MENOR_SALIDA");
assert.equal(validarCierreTraslado({ kmSalida: 100, kmLlegada: 101, fechaCierre: now + 1000, now }).code, "CIERRE_FUTURO");
assert.equal(validarCierreTraslado({ kmSalida: 100, kmLlegada: 101, fechaCierre: now - 6 * 60 * 1000, now }).code, "CIERRE_ANTIGUO");
assert.equal(validarCierreTraslado({ kmSalida: 100, kmLlegada: 101, fechaSalida: now, fechaCierre: now - 1000, now }).code, "CIERRE_ANTES_SALIDA");
assert.equal(normalizarTipoTraslado("gas"), "GAS");

console.log("traslado.model OK");
