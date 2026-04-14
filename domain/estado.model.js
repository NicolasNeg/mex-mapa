// ═══════════════════════════════════════════════════════════
//  /domain/estado.model.js  —  Estados válidos de la flota
//  NO depende de Firebase. Lógica de negocio pura.
// ═══════════════════════════════════════════════════════════

export const ESTADOS_PATIO = Object.freeze([
  'LISTO', 'SUCIO', 'MANTENIMIENTO', 'RESGUARDO',
  'TRASLADO', 'NO ARRENDABLE', 'RETENIDA', 'VENTA'
]);

export const ESTADO_EXTERNO = 'EXTERNO';

export const ORDEN_ESTADOS = Object.freeze({
  LISTO: 1, SUCIO: 2, MANTENIMIENTO: 3, RESGUARDO: 4,
  TRASLADO: 5, 'NO ARRENDABLE': 6, RETENIDA: 92, VENTA: 93
});

/** Normaliza un estado a MAYÚSCULAS. Retorna null si no es válido. */
export function normalizarEstado(valor) {
  const upper = String(valor || '').trim().toUpperCase();
  if (ESTADOS_PATIO.includes(upper) || upper === ESTADO_EXTERNO) return upper;
  return null;
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
