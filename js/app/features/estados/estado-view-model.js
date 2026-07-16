// ═══════════════════════════════════════════════════════════
//  /js/app/features/estados/estado-view-model.js
//  Helpers de estados flota/patio para SPA.
//
//  NO hace import estático de /domain/estado.model.js: el SW
//  cache-first a veces sirve una versión vieja sin exports
//  nuevos y rompe toda la vista (SyntaxError al cargar).
//  Preferimos window.mexEstados (estado-bridge.js) + espejo local.
// ═══════════════════════════════════════════════════════════

const _bridge = (typeof window !== 'undefined' && window.mexEstados) ? window.mexEstados : null;

export const ESTADOS_FLOTA = Object.freeze(_bridge?.ESTADOS_FLOTA || [
  'ARRENDABLE',
  'NO ARRENDABLE',
  'EN RENTA',
  'TRASLADO',
  'VENTA',
  'MANTENIMIENTO'
]);

export const ESTADOS_FLOTA_CERRADOS = Object.freeze(_bridge?.ESTADOS_FLOTA_CERRADOS || [
  'EN RENTA', 'TRASLADO', 'VENTA'
]);

export const ESTADOS_PATIO = Object.freeze(_bridge?.ESTADOS_PATIO || [
  'LISTO', 'SUCIO', 'MANTENIMIENTO', 'RESGUARDO',
  'TRASLADO', 'NO ARRENDABLE', 'RETENIDA', 'VENTA'
]);

export const ESTADOS_PATIO_ARRENDABLES = Object.freeze([
  'LISTO', 'SUCIO', 'RESGUARDO'
]);

export const ESTADO_EXTERNO = 'EXTERNO';

export const ORDEN_ESTADOS = Object.freeze({
  LISTO: 1, SUCIO: 2, MANTENIMIENTO: 3, RESGUARDO: 4,
  TRASLADO: 5, 'NO ARRENDABLE': 6, RETENIDA: 92, VENTA: 93
});

export function normalizarEstado(valor) {
  if (_bridge?.normalizarEstadoPatio) {
    const patio = _bridge.normalizarEstadoPatio(valor);
    if (patio) return patio;
  }
  const upper = String(valor || '').trim().toUpperCase();
  if (ESTADOS_PATIO.includes(upper) || upper === ESTADO_EXTERNO) return upper;
  return null;
}

export function normalizarEstadoPatio(valor) {
  if (_bridge?.normalizarEstadoPatio) return _bridge.normalizarEstadoPatio(valor);
  return normalizarEstado(valor);
}

export function normalizarEstadoFlota(valor) {
  if (_bridge?.normalizarEstadoFlota) return _bridge.normalizarEstadoFlota(valor);
  const upper = String(valor || '').trim().toUpperCase();
  if (!upper) return null;
  if (upper === 'RENTADO' || upper === 'RENTADA') return 'EN RENTA';
  if (upper === 'DISPONIBLE' || upper === 'LIMPIO') return 'ARRENDABLE';
  if (ESTADOS_FLOTA.includes(upper)) return upper;
  return null;
}

export function leerEstadoFlota(doc = {}) {
  if (_bridge?.leerEstadoFlota) return _bridge.leerEstadoFlota(doc);
  return normalizarEstadoFlota(doc.estadoFlota || doc.estado || doc.estatus);
}

export function esFlotaCerrada(flota) {
  if (_bridge?.esFlotaCerrada) return _bridge.esFlotaCerrada(flota);
  const f = normalizarEstadoFlota(flota);
  return Boolean(f && ESTADOS_FLOTA_CERRADOS.includes(f));
}

export function derivarFlotaDesdePatio(estadoPatio, flotaActual = null) {
  if (_bridge?.derivarFlotaDesdePatio) return _bridge.derivarFlotaDesdePatio(estadoPatio, flotaActual);
  const patio = normalizarEstadoPatio(estadoPatio);
  const actual = normalizarEstadoFlota(flotaActual);
  if (esFlotaCerrada(actual)) return actual;
  if (!patio || patio === ESTADO_EXTERNO) return actual;
  if (ESTADOS_PATIO_ARRENDABLES.includes(patio)) return 'ARRENDABLE';
  if (patio === 'MANTENIMIENTO') return 'MANTENIMIENTO';
  if (patio === 'NO ARRENDABLE' || patio === 'RETENIDA') return 'NO ARRENDABLE';
  if (patio === 'TRASLADO') return 'TRASLADO';
  if (patio === 'VENTA') return 'VENTA';
  return actual;
}

export function evaluarListoParaContrato(opts = {}) {
  if (_bridge?.evaluarListoParaContrato) return _bridge.evaluarListoParaContrato(opts);
  const flota = normalizarEstadoFlota(opts.estadoFlota);
  const patio = normalizarEstadoPatio(opts.estadoPatio);
  const enCuadre = Boolean(String(opts.plazaActual || '').trim());
  if (flota && flota !== 'ARRENDABLE') {
    return { ok: false, nivel: 'block', motivo: `Estado flota: ${flota}` };
  }
  if (!enCuadre) {
    return { ok: true, nivel: 'warn', motivo: 'Unidad no está en cuadre de plaza' };
  }
  if (patio === 'MANTENIMIENTO') {
    return { ok: false, nivel: 'block', motivo: 'Unidad en mantenimiento de patio' };
  }
  if (patio === 'SUCIO') {
    return { ok: true, nivel: 'warn', motivo: 'Unidad sucia — confirmar preparación' };
  }
  if (patio === 'LISTO') return { ok: true, nivel: 'ok', motivo: '' };
  return { ok: true, nivel: 'warn', motivo: patio ? `Patio: ${patio}` : 'Sin estado de patio' };
}

export function estaEnPatio(estado) {
  const p = normalizarEstadoPatio(estado);
  return Boolean(p && p !== ESTADO_EXTERNO);
}

export function estaEnExterno(estado) {
  return normalizarEstadoPatio(estado) === ESTADO_EXTERNO
    || String(estado || '').trim().toUpperCase() === ESTADO_EXTERNO;
}

/** Catálogo canónico para formularios de Unidades / expediente. */
export function estadosFlotaCatalog(currentVal = '') {
  const cur = normalizarEstadoFlota(currentVal) || String(currentVal || '').trim().toUpperCase();
  const set = new Set(ESTADOS_FLOTA);
  if (cur) set.add(cur);
  return [...set];
}

export function resolverEstadoFlota(doc = {}) {
  if (_bridge?.resolverEstadoFlota) return _bridge.resolverEstadoFlota(doc);
  const flota = leerEstadoFlota(doc);
  const patio = normalizarEstadoPatio(doc.estadoPatio || doc.estadoCuadre || '');
  if (esFlotaCerrada(flota)) return flota;
  if (patio) return derivarFlotaDesdePatio(patio, flota) || flota;
  const raw = normalizarEstadoFlota(doc.estado) || null;
  if (raw) return raw;
  const asPatio = normalizarEstadoPatio(doc.estado);
  if (asPatio) return derivarFlotaDesdePatio(asPatio, null);
  return flota;
}

export function leerEstadoPatioDoc(doc = {}) {
  if (_bridge?.leerEstadoPatio) {
    const fromBridge = _bridge.leerEstadoPatio(doc);
    if (fromBridge) return fromBridge;
  }
  return normalizarEstadoPatio(doc.estadoPatio || doc.estadoCuadre || '')
    || (normalizarEstadoFlota(doc.estado) ? null : normalizarEstadoPatio(doc.estado));
}

/** Pre-chequeo contratos (API estable para features futuras). */
export function precheckContratoUnidad(unidad = {}) {
  return evaluarListoParaContrato({
    estadoFlota: resolverEstadoFlota(unidad),
    estadoPatio: leerEstadoPatioDoc(unidad),
    plazaActual: unidad.plazaActual || unidad.plaza || ''
  });
}
