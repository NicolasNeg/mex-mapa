// ═══════════════════════════════════════════════════════════
//  /domain/unidad.model.js  —  Modelo de una unidad de flota
//  NO depende de Firebase. Lógica de negocio pura.
// ═══════════════════════════════════════════════════════════

import { normalizarEstado, estaEnPatio, estaEnExterno } from './estado.model.js';

/**
 * Normaliza un documento crudo de Firestore (cuadre/externos)
 * a una unidad canónica con campos garantizados.
 */
export function normalizarUnidad(raw = {}) {
  return {
    id:          String(raw.id          || raw.mva || ''),
    mva:         String(raw.mva         || '').trim().toUpperCase(),
    modelo:      String(raw.modelo      || 'S/M').toUpperCase(),
    categoria:   String(raw.categoria   || 'S/C').toUpperCase(),
    placas:      String(raw.placas      || 'S/P').toUpperCase(),
    estado:      normalizarEstado(raw.estado) || 'SUCIO',
    ubicacion:   String(raw.ubicacion   || '').toUpperCase(),
    gasolina:    String(raw.gasolina    || 'N/A'),
    notas:       String(raw.notas       || ''),
    pos:         String(raw.pos         || 'LIMBO').toUpperCase(),
    plaza:       String(raw.plaza       || '').toUpperCase(),
    tipo:        String(raw.tipo        || 'renta'),
    fechaIngreso:raw.fechaIngreso || null,
    _createdAt:  raw._createdAt  || null,
    _updatedAt:  raw._updatedAt  || null,
  };
}

/** Retorna true si la unidad debería aparecer en el mapa (en patio o taller). */
export function aparecerEnMapa(unidad) {
  return Boolean(unidad.mva) && estaEnPatio(unidad);
}

/** Retorna true si la unidad es externa. */
export function esExterno(unidad) {
  return estaEnExterno(unidad);
}

/** Genera los tokens de búsqueda para la unidad (MVP para Fase 2.1). */
export function generarSearchTokens(unidad) {
  const tokens = new Set();
  const add = v => { if (v) tokens.add(String(v).toUpperCase().trim()); };
  add(unidad.mva);
  add(unidad.modelo);
  add(unidad.placas);
  add(unidad.categoria);
  add(unidad.estado);
  // Modelo sin espacios para búsqueda rápida
  if (unidad.modelo) tokens.add(unidad.modelo.replace(/\s+/g, ''));
  return [...tokens];
}
