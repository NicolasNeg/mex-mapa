// ═══════════════════════════════════════════════════════════
//  /mapa/mapa-view-model.js  —  View-Model del mapa operativo
//
//  Transforma datos crudos de Firestore + estado UI local
//  en un estado visual completo listo para renderizar.
//
//  NO accede a Firebase directamente.
//  Importa modelos de /domain/ para validaciones y tipos.
// ═══════════════════════════════════════════════════════════

import { estaEnPatio, estaEnExterno }      from '../domain/estado.model.js';
import { normalizarUnidad, generarSearchTokens } from '../domain/unidad.model.js';
import { normalizarElemento, esCajonOcupable, categoriaPermitida } from '../domain/mapa.model.js';

// ── Estado visual de una UNIDAD ──────────────────────────────

/**
 * Construye el estado visual completo de una unidad para el render del mapa.
 * @param {object} unidad   Doc normalizado de cuadre/externos
 * @param {object} uiState  Estado local de la UI { selectedMva, highlightedMva, movingMva }
 * @param {object} options  { cuadreAdmins: [], notasAbiertas: [] }
 * @returns {object} unitViewModel
 */
export function buildUnitViewModel(unidad, uiState = {}, options = {}) {
  const base = normalizarUnidad(unidad);
  const mva = String(base.mva || '').toUpperCase();

  // ── Flags de estado de interacción ──
  const isSelected    = uiState.selectedMva    === mva;
  const isHighlighted = uiState.highlightedMva === mva;
  const isMoving      = uiState.movingMva      === mva;

  // ── Flags de estado operativo ──
  const estado     = String(base.estado    || '').toUpperCase();
  const ubicacion  = String(base.ubicacion || '').toUpperCase();

  const isInTransit    = estado === 'TRASLADO';
  const isBlocked      = estado === 'NO ARRENDABLE' || estado === 'RETENIDA';
  const isTemporary    = ubicacion === 'RESGUARDO' || estado === 'RESGUARDO';
  const isReserved     = estado === 'VENTA';
  const isConflicted   = Boolean(uiState.conflicts?.has(mva));

  // ── Evidencias y notas ──
  const cuadreAdmins = Array.isArray(options.cuadreAdmins) ? options.cuadreAdmins : [];
  const hasEvidence  = cuadreAdmins.some(ca =>
    String(ca.mva || '').toUpperCase() === mva &&
    Array.isArray(ca.evidencias) && ca.evidencias.length > 0
  );
  const notasAbiertas = Array.isArray(options.notasAbiertas) ? options.notasAbiertas : [];
  const hasQuickNotes = notasAbiertas.some(n =>
    String(n.mva || '').toUpperCase() === mva && n.estado === 'PENDIENTE'
  );

  // ── Estado de movimiento derivado ──
  let movementState = 'idle';
  if (isMoving)      movementState = 'dragging';
  else if (isInTransit) movementState = 'transit';

  // ── Search tokens ──
  const searchTokens = generarSearchTokens(base);

  return {
    mva,
    isSelected,
    isHighlighted,
    isConflicted,
    isReserved,
    isBlocked,
    isTemporary,
    isInTransit,
    isMoving,
    hasEvidence,
    hasQuickNotes,
    movementState,
    searchTokens,
    version: base.version,
    lastTouchedAt: base.lastTouchedAt,
    lastTouchedBy: base.lastTouchedBy,
    traslado_destino: base.traslado_destino,
    raw: unidad,
    // Datos de la unidad para el render
    estado,
    ubicacion,
    gasolina: String(base.gasolina || 'N/A'),
    plaza: String(base.plaza || ''),
    fechaIngreso: base.fechaIngreso || null,
    id: String(base.id || mva),
    modelo:   String(base.modelo   || ''),
    categoria:String(base.categoria|| ''),
    placas:   String(base.placas   || ''),
    notas:    String(base.notas    || ''),
    pos:      String(base.pos      || 'LIMBO').toUpperCase(),
    tipo:     String(base.tipo     || 'renta'),
  };
}

// ── Estado visual de un CAJÓN ────────────────────────────────

/**
 * Construye el estado visual de un cajón del mapa.
 * @param {object} elementoEstructura  Doc normalizado de estructura (normalizarElemento)
 * @param {object[]} unidades           Lista de unidades con su viewModel
 * @returns {object} cajonViewModel
 */
export function buildCajonViewModel(elementoEstructura, unidades = []) {
  const el = normalizarElemento(elementoEstructura);
  const pos = String(el.valor || '').toUpperCase();

  // Buscar la unidad que ocupa este cajón
  const unidadEnCajon = unidades.find(u =>
    String(u.pos || '').toUpperCase() === pos && pos !== 'LIMBO'
  );

  const occupied  = Boolean(unidadEnCajon);
  const reserved  = el.isReserved;
  const blocked   = el.isBlocked;
  const allowedCategories = el.allowedCategories;
  const zone      = el.zone;
  const googleMapsUrl = el.googleMapsUrl;
  const isOcupable = esCajonOcupable(el);

  // ¿La categoría de la unidad actual está permitida en este cajón?
  const categoriaConflict = occupied && allowedCategories.length > 0
    ? !categoriaPermitida(el, unidadEnCajon?.categoria)
    : false;

  return {
    pos,
    tipo:    el.tipo,
    esLabel: el.esLabel,
    x: el.x, y: el.y, width: el.width, height: el.height, rotation: el.rotation,
    orden: el.orden,
    occupied,
    reserved,
    blocked,
    isOcupable,
    allowedCategories,
    zone,
    googleMapsUrl,
    categoriaConflict,
    unidad: unidadEnCajon || null,
    // Campos de expansión (Fase 1.5)
    isTemporaryHolding: el.isTemporaryHolding,
    priority: el.priority,
    pathType: el.pathType,
    subzone: el.subzone,
  };
}

// ── View-Model completo del mapa ─────────────────────────────

/**
 * Construye el view-model completo del mapa combinando estructura + unidades.
 * @param {object[]} estructura  Elementos de la estructura del mapa
 * @param {object[]} unidades    Unidades de cuadre + externos
 * @param {object}   uiState     Estado local de la UI
 * @param {object}   options     { cuadreAdmins, notasAbiertas }
 * @returns {{ cajones: object[], unitMap: Map<string, object>, stats: object }}
 */
export function buildMapaViewModel(estructura = [], unidades = [], uiState = {}, options = {}) {
  // 1. Construir unit view-models indexados por mva
  const unitMap = new Map();
  for (const u of unidades) {
    if (!u?.mva) continue;
    const vm = buildUnitViewModel(u, uiState, options);
    unitMap.set(vm.mva, vm);
  }

  // 2. Construir cajón view-models
  const unitList = [...unitMap.values()];
  const cajones = estructura.map(el => buildCajonViewModel(el, unitList));

  // 3. Stats rápidas
  const stats = {
    total:       unidades.length,
    enPatio:     unidades.filter(estaEnPatio).length,
    externos:    unidades.filter(estaEnExterno).length,
    enLimbo:     unitList.filter(u => u.pos === 'LIMBO').length,
    conflictos:  cajones.filter(c => c.categoriaConflict).length,
  };

  return { cajones, unitMap, stats };
}
