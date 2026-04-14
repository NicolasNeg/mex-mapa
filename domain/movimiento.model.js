// ═══════════════════════════════════════════════════════════
//  /domain/movimiento.model.js  —  Modelo de movimiento/posición
//  NO depende de Firebase. Lógica de negocio pura.
// ═══════════════════════════════════════════════════════════

/** Tipos de movimiento en historial_patio. */
export const TIPOS_MOVIMIENTO = Object.freeze(['MOVE', 'SWAP', 'DEL']);

/**
 * Clasifica un movimiento dado origen y destino.
 * @param {string} posAnterior
 * @param {string} posNueva
 * @param {Map<string,number>} pairKeys  mapa de "POS_A->POS_B" con conteo
 * @returns {'DEL'|'SWAP'|'MOVE'}
 */
export function clasificarMovimiento(posAnterior, posNueva, pairKeys = new Map()) {
  const origen  = String(posAnterior || '').toUpperCase();
  const destino = String(posNueva    || '').toUpperCase();
  if (destino === 'LIMBO') return 'DEL';
  if (pairKeys.has(`${destino}->${origen}`)) return 'SWAP';
  return 'MOVE';
}

/**
 * Construye el payload canónico de un registro de historial_patio.
 */
export function buildMovimientoPayload({ mva, hoja, posAnterior, posNueva, tipo, autor, plaza, auditExtra = {} }) {
  const payload = {
    timestamp:   Date.now(),
    tipo,
    mva:         String(mva        || '').toUpperCase(),
    hoja:        String(hoja       || 'CUADRE'),
    posAnterior: String(posAnterior|| '').toUpperCase(),
    posNueva:    String(posNueva   || '').toUpperCase(),
    autor:       String(autor      || 'Sistema'),
    plaza:       String(plaza      || '').toUpperCase(),
  };
  if (auditExtra.locationStatus) payload.locationStatus = auditExtra.locationStatus;
  if (auditExtra.exactLocation)  payload.exactLocation  = auditExtra.exactLocation;
  if (auditExtra.ipAddress)      payload.ipAddress      = auditExtra.ipAddress;
  if (auditExtra.forwardedFor)   payload.forwardedFor   = auditExtra.forwardedFor;
  return payload;
}
