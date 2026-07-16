// ═══════════════════════════════════════════════════════════
//  /domain/estado.model.js  —  Estados de flota (global) y patio (cuadre)
//  NO depende de Firebase. Lógica de negocio pura.
// ═══════════════════════════════════════════════════════════

/** Estados operativos en patio / cuadre (campo Firestore `estado` en cuadre). */
export const ESTADOS_PATIO = Object.freeze([
  'LISTO', 'SUCIO', 'MANTENIMIENTO', 'RESGUARDO',
  'TRASLADO', 'NO ARRENDABLE', 'RETENIDA', 'VENTA'
]);

/** Estados de disponibilidad de negocio (index_unidades.estadoFlota). */
export const ESTADOS_FLOTA = Object.freeze([
  'ARRENDABLE',
  'NO ARRENDABLE',
  'EN RENTA',
  'TRASLADO',
  'VENTA',
  'MANTENIMIENTO'
]);

/** Flota "cerrada": un cambio de lavado/patio no debe pisarla. */
export const ESTADOS_FLOTA_CERRADOS = Object.freeze([
  'EN RENTA',
  'TRASLADO',
  'VENTA'
]);

/** Patio que implica unidad rentable a nivel negocio (si flota no está cerrada). */
export const ESTADOS_PATIO_ARRENDABLES = Object.freeze([
  'LISTO',
  'SUCIO',
  'RESGUARDO'
]);

export const ESTADO_EXTERNO = 'EXTERNO';

export const ORDEN_ESTADOS = Object.freeze({
  LISTO: 1, SUCIO: 2, MANTENIMIENTO: 3, RESGUARDO: 4,
  TRASLADO: 5, 'NO ARRENDABLE': 6, RETENIDA: 92, VENTA: 93
});

/** Normaliza un estado de patio. Retorna null si no es válido. */
export function normalizarEstado(valor) {
  const upper = String(valor || '').trim().toUpperCase();
  if (ESTADOS_PATIO.includes(upper) || upper === ESTADO_EXTERNO) return upper;
  return null;
}

/** Alias explícito de patio. */
export function normalizarEstadoPatio(valor) {
  return normalizarEstado(valor);
}

/** Normaliza estado flota. Acepta alias legacy (RENTADO → EN RENTA, DISPONIBLE → ARRENDABLE). */
export function normalizarEstadoFlota(valor) {
  const upper = String(valor || '').trim().toUpperCase();
  if (!upper) return null;
  if (upper === 'RENTADO' || upper === 'RENTADA') return 'EN RENTA';
  if (upper === 'DISPONIBLE' || upper === 'LIMPIO') return 'ARRENDABLE';
  if (ESTADOS_FLOTA.includes(upper)) return upper;
  return null;
}

/** Lee flota desde un doc index (estadoFlota | estado | estatus). */
export function leerEstadoFlota(doc = {}) {
  return normalizarEstadoFlota(doc.estadoFlota || doc.estado || doc.estatus);
}

export function esFlotaCerrada(flota) {
  const f = normalizarEstadoFlota(flota);
  return Boolean(f && ESTADOS_FLOTA_CERRADOS.includes(f));
}

/**
 * Deriva el estado flota a partir de un cambio de patio.
 * No pisa EN RENTA / TRASLADO / VENTA.
 *
 * @param {string} estadoPatio
 * @param {string|null} flotaActual
 * @returns {string|null} nuevo estadoFlota, o flotaActual (normalizada) si no debe cambiar
 */
export function derivarFlotaDesdePatio(estadoPatio, flotaActual = null) {
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

/**
 * Hook para contratos futuros: ¿alerta operativa al rentar?
 * @returns {{ ok: boolean, nivel: 'ok'|'warn'|'block', motivo: string }}
 */
export function evaluarListoParaContrato({ estadoFlota, estadoPatio, plazaActual } = {}) {
  const flota = normalizarEstadoFlota(estadoFlota);
  const patio = normalizarEstadoPatio(estadoPatio);
  const enCuadre = Boolean(String(plazaActual || '').trim());

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
  if (patio === 'LISTO') {
    return { ok: true, nivel: 'ok', motivo: '' };
  }
  if (patio === 'RESGUARDO') {
    return { ok: true, nivel: 'warn', motivo: 'Unidad en resguardo' };
  }
  return { ok: true, nivel: 'warn', motivo: patio ? `Patio: ${patio}` : 'Sin estado de patio' };
}

/** Retorna true si la unidad está en el patio físico. */
export function estaEnPatio(unidad) {
  const ubi = String(unidad?.ubicacion || '').toUpperCase();
  return ubi === 'PATIO' || ubi === 'TALLER';
}

/** Retorna true si la unidad es externa. */
export function estaEnExterno(unidad) {
  return String(unidad?.tipo || '').toLowerCase() === 'externo' ||
         String(unidad?.ubicacion || '').toUpperCase() === 'EXTERNO';
}
