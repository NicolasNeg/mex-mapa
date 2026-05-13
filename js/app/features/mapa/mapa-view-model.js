/**
 * View-model read-only compartido: `/app/mapa` y dashboard (mini mapa).
 * Alineado conceptualmente con legacy: celda = normalizarElemento.valor,
 * unidad en mapa ↔ normalizarUnidad.pos sanitizado igual que dataset.spot.
 *
 * No Firestore; solo transformación de datos ya cargados.
 */

import { normalizarUnidad } from '/domain/unidad.model.js';
import { normalizarElemento, esCajonOcupable } from '/domain/mapa.model.js';
import { isElementVisibleInView } from '/js/app/features/mapa/mapViewVisibility.js';

/** Igual que legacy `_sanitizeSpotToken` en js/views/mapa.js */
export function sanitizeSpotToken(value = '') {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
}

export function normalizeMapCell(raw = {}, index = 0) {
  return normalizarElemento(raw, index);
}

export function normalizeMapUnit(raw = {}) {
  return normalizarUnidad(raw);
}

/**
 * Resuelve en qué bucket cae la unidad respecto a la estructura indexada por spot.
 * @returns {{ bucket: 'cell'|'limbo'|'taller'|'orphan', spotKey: string, element: object|null }}
 */
export function resolveUnitCell(unitNorm, cellBySpotKey) {
  let spotKey = sanitizeSpotToken(String(unitNorm.pos || '').trim() || 'LIMBO');
  if (!spotKey) spotKey = 'LIMBO';
  const ubi = String(unitNorm.ubicacion || '').toUpperCase();

  if (spotKey === 'LIMBO') {
    if (ubi === 'TALLER') return { bucket: 'taller', spotKey: 'LIMBO', element: null };
    return { bucket: 'limbo', spotKey: 'LIMBO', element: null };
  }

  if (cellBySpotKey.has(spotKey)) {
    return { bucket: 'cell', spotKey, element: cellBySpotKey.get(spotKey) };
  }

  // Legacy empuja a limbo/taller si no existe el nodo DOM; aquí bucket explícito.
  if (ubi === 'TALLER') return { bucket: 'taller', spotKey, element: null };
  return { bucket: 'orphan', spotKey, element: null };
}

function _coalesce(...values) {
  for (const value of values) {
    const next = String(value || '').trim();
    if (next) return next;
  }
  return '';
}

const MAPA_RENDER_AIRE_X = 6;
const MAPA_RENDER_AIRE_Y = 8;
const MAPA_RENDER_BASE_X = 120;
const MAPA_RENDER_BASE_Y = 84;

function _hasAbsolutePosition(raw = {}) {
  return raw && (raw.x !== undefined || raw.y !== undefined);
}

function _hasLegacyGridPosition(raw = {}) {
  return raw && (raw.row !== undefined || raw.col !== undefined);
}

function _withLayoutPosition(raw = {}, index = 0) {
  const base = normalizeMapCell(raw, index);
  const hasAbsolute = _hasAbsolutePosition(raw);
  const hasLegacyGrid = _hasLegacyGridPosition(raw);
  let x = Number(base.x) || 0;
  let y = Number(base.y) || 0;
  let width = Number(base.width) || 120;
  let height = Number(base.height) || 80;
  let rotation = Number(base.rotation) || 0;

  if (!hasAbsolute && hasLegacyGrid) {
    const col = Math.max(1, Number(raw.col) || 1);
    const row = Math.max(1, Number(raw.row) || 1);
    const colspan = Math.max(1, Number(raw.colspan) || 1);
    const rowspan = Math.max(1, Number(raw.rowspan) || 1);
    const cellW = 120;
    const cellH = 80;
    const gap = 4;
    x = (col - 1) * (cellW + gap);
    y = (row - 1) * (cellH + gap);
    width = colspan * cellW + (colspan - 1) * gap;
    height = rowspan * cellH + (rowspan - 1) * gap;
    rotation = 0;
  }

  if (hasAbsolute || hasLegacyGrid) {
    x += Math.floor(Math.max(0, x) / MAPA_RENDER_BASE_X) * MAPA_RENDER_AIRE_X;
    y += Math.floor(Math.max(0, y) / MAPA_RENDER_BASE_Y) * MAPA_RENDER_AIRE_Y;
  }

  return {
    ...base,
    x,
    y,
    width,
    height,
    rotation,
    _hasLayoutPosition: hasAbsolute || hasLegacyGrid
  };
}

function _searchTokens(unitNorm, raw = {}) {
  return [
    unitNorm.id,
    unitNorm.mva,
    unitNorm.placas,
    unitNorm.modelo,
    unitNorm.estado,
    unitNorm.ubicacion,
    unitNorm.pos,
    raw.notas,
    unitNorm.categoria
  ]
    .map(v => String(v || '').toUpperCase())
    .join(' ');
}

function _buildUiUnit(unitNorm, raw, queryUpper, incidentSearchUpper = '') {
  const estado = String(unitNorm.estado || 'SIN ESTADO').toUpperCase();
  const inc = String(incidentSearchUpper || '').toUpperCase();
  const qu = String(queryUpper || '').trim().toUpperCase();
  const matchesQuery =
    !qu ||
    _searchTokens(unitNorm, raw).includes(qu) ||
    (inc && qu && inc.includes(qu));
  return {
    id: _coalesce(unitNorm.id, unitNorm.mva),
    mva: unitNorm.mva || '—',
    modelo: unitNorm.modelo || '—',
    placas: unitNorm.placas || '—',
    gasolina: String(unitNorm.gasolina || raw?.gasolina || '—'),
    estado,
    ubicacion: String(unitNorm.ubicacion || '').toUpperCase(),
    pos: String(unitNorm.pos || 'LIMBO').toUpperCase(),
    positionKey: sanitizeSpotToken(unitNorm.pos || 'LIMBO'),
    notas: String(unitNorm.notas || ''),
    tipo: String(unitNorm.tipo || ''),
    categoria: String(unitNorm.categoria || ''),
    plaza: String(unitNorm.plaza || ''),
    matchesQuery,
    _raw: raw,
    _search: _searchTokens(unitNorm, raw)
  };
}

/**
 * Agrupa unidades normalizadas por spot real (solo las que bucket==='cell').
 */
export function groupUnitsByRealCell(unitsClassified) {
  const map = new Map();
  for (const row of unitsClassified) {
    if (row.bucket !== 'cell') continue;
    const key = row.spotKey;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row.ui);
  }
  return map;
}

export function getUnplacedUnits(unitsClassified) {
  return unitsClassified.filter(r => r.bucket === 'orphan').map(r => r.ui);
}

/**
 * Clasifica todas las unidades contra la estructura.
 */
export function classifyUnitsForStructure(unitsRaw = [], cellBySpotKey) {
  const out = [];
  const list = Array.isArray(unitsRaw) ? unitsRaw : [];
  for (const raw of list) {
    const nu = normalizeMapUnit(raw);
    if (!nu.mva) continue;
    const res = resolveUnitCell(nu, cellBySpotKey);
    const ui = _buildUiUnit(nu, raw, '', '');
    out.push({
      bucket: res.bucket,
      spotKey: res.spotKey,
      nu,
      raw,
      ui
    });
  }
  return out;
}

function _reapplyQuery(classified, queryUpper, incidentSearchByMva = {}) {
  const qu = String(queryUpper || '').trim().toUpperCase();
  return classified.map(row => {
    const nu = row.nu;
    const mva = String(nu.mva || '')
      .toUpperCase()
      .trim();
    const inc = incidentSearchByMva[mva] || '';
    const ui = _buildUiUnit(nu, row.raw, qu, inc);
    return { ...row, ui };
  });
}

/**
 * VM principal para render read-only tipo mapa real.
 */
export function buildMapaReadOnlyViewModel({
  estructura = [],
  unidades = [],
  plaza = '',
  query = '',
  /** @type {Record<string, string>} texto de búsqueda de incidencias por MVA (mayúsculas) */
  incidentSearchByMva = {}
} = {}) {
  const queryUpper = String(query || '').trim().toUpperCase();
  /** Mapa operativo /app/mapa: solo filas visibles en vista estacionamiento (y no ocultas). */
  const OPERATIONAL_EDITOR_VIEW = 'estacionamiento';
  const structureSorted = Array.isArray(estructura)
    ? estructura
        .map((item, i) => _withLayoutPosition(item, i))
        .filter(el => el.hidden !== true && isElementVisibleInView(el, OPERATIONAL_EDITOR_VIEW))
        .sort((a, b) => a.orden - b.orden)
    : [];
  const layoutMode = structureSorted.some(el => el._hasLayoutPosition) ? 'absolute' : 'flow';

  const cellBySpotKey = new Map();
  for (const el of structureSorted) {
    if (el.esLabel === true || el.tipo === 'label') continue;
    if (el.tipo !== 'cajon') continue;
    const key = sanitizeSpotToken(el.valor);
    if (!key) continue;
    if (!cellBySpotKey.has(key)) cellBySpotKey.set(key, el);
  }

  let classified = classifyUnitsForStructure(unidades, cellBySpotKey);
  classified = _reapplyQuery(classified, queryUpper, incidentSearchByMva);

  const byCell = groupUnitsByRealCell(classified);
  const limboUnits = classified.filter(r => r.bucket === 'limbo').map(r => r.ui);
  const tallerUnits = classified.filter(r => r.bucket === 'taller').map(r => r.ui);
  const orphanUnits = classified.filter(r => r.bucket === 'orphan').map(r => r.ui);

  const rows = structureSorted.map(el => {
    const spotKey = sanitizeSpotToken(el.valor);
    const isLabelRow = el.esLabel === true || el.tipo === 'label';
    const isCajon = el.tipo === 'cajon';

    if (isLabelRow) {
      return {
        kind: 'label',
        label: String(el.valor || '').trim() || '—',
        zoneId: el.zone || '',
        subzoneId: el.subzone || '',
        orden: el.orden,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        rotation: el.rotation
      };
    }

    if (!isCajon) {
      return {
        kind: 'decor',
        label: String(el.valor || '').trim(),
        tipo: el.tipo,
        zoneId: el.zone || '',
        orden: el.orden,
        muted: true,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        rotation: el.rotation,
        fill: el.fill,
        stroke: el.stroke
      };
    }

    const occupants = spotKey ? byCell.get(spotKey) || [] : [];
    const displayUnits = queryUpper ? occupants.filter(u => u.matchesQuery) : occupants;
    const occupiedCount = occupants.length;
    const hasOccupant = occupiedCount > 0;
    const emptyByFilter = Boolean(queryUpper && hasOccupant && displayUnits.length === 0);

    const labelUp = String(el.valor || '')
      .trim()
      .toUpperCase();
    const matchesCellQuery = Boolean(
      queryUpper &&
        (spotKey === queryUpper ||
          (spotKey && queryUpper.includes(spotKey)) ||
          (spotKey && spotKey.includes(queryUpper)) ||
          labelUp.includes(queryUpper))
    );

    return {
      kind: 'slot',
      positionKey: spotKey,
      cellId: spotKey,
      zoneId: el.zone || '',
      zoneLabel: String(el.zone || '').trim(),
      subzoneId: el.subzone || '',
      label: String(el.valor || '').trim() || spotKey || '—',
      orden: el.orden,
      ocupable: esCajonOcupable(el),
      blocked: el.isBlocked === true,
      reserved: el.isReserved === true,
      temporaryHolding: el.isTemporaryHolding === true,
      unitsAll: occupants,
      units: displayUnits,
      occupiedCount,
      empty: !hasOccupant,
      emptyByFilter,
      mutedByFilter: emptyByFilter || (Boolean(queryUpper) && !hasOccupant),
      tipo: el.tipo,
      matchesCellQuery,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      rotation: el.rotation
    };
  });

  const filteredUnits = queryUpper ? classified.filter(r => r.ui.matchesQuery).map(r => r.ui) : classified.map(r => r.ui);

  const limboFiltered = queryUpper ? limboUnits.filter(u => u.matchesQuery) : limboUnits;
  const tallerFiltered = queryUpper ? tallerUnits.filter(u => u.matchesQuery) : tallerUnits;
  const orphanFiltered = queryUpper ? orphanUnits.filter(u => u.matchesQuery) : orphanUnits;

  const slotRows = rows.filter(r => r.kind === 'slot');
  const occupiedSlots = slotRows.filter(r => (r.occupiedCount || 0) > 0).length;
  let canvasW = 0;
  let canvasH = 0;
  if (layoutMode === 'absolute') {
    for (const row of rows) {
      canvasW = Math.max(canvasW, (Number(row.x) || 0) + (Number(row.width) || 0));
      canvasH = Math.max(canvasH, (Number(row.y) || 0) + (Number(row.height) || 0));
    }
    canvasW += 8;
    canvasH += 8;
  }

  return {
    plaza: String(plaza || '').toUpperCase(),
    query: queryUpper,
    structureCount: structureSorted.length,
    layoutMode,
    canvasW,
    canvasH,
    slotRows,
    occupiedSlots,
    rows,
    limboUnits,
    tallerUnits,
    orphanUnits,
    limboFiltered,
    tallerFiltered,
    orphanFiltered,
    totalUnits: classified.length,
    filteredCount: filteredUnits.length,
    cellBySpotKeySize: cellBySpotKey.size
  };
}

/**
 * Extracto liviano para dashboard (evita megabytes de HTML).
 */
export function buildMapaPreviewSummary(vm) {
  if (!vm || !vm.slotRows) {
    return {
      sampleCells: [],
      zoneTotals: [],
      orphanCount: 0,
      limboCount: 0,
      tallerCount: 0,
      slotsTotal: 0,
      occupiedSlots: 0
    };
  }

  const slots = vm.slotRows || [];
  const occupiedSlots = slots.filter(s => (s.occupiedCount || 0) > 0).length;

  const zoneTotalsMap = new Map();
  for (const s of slots) {
    const z = String(s.zoneLabel || s.zoneId || '').trim().toUpperCase() || 'SIN ZONA';
    zoneTotalsMap.set(z, (zoneTotalsMap.get(z) || 0) + (s.occupiedCount || 0));
  }

  const zoneTotals = Array.from(zoneTotalsMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, count]) => ({ label, count }));

  const sampleCells = slots
    .filter(s => (s.occupiedCount || 0) > 0)
    .slice(0, 14)
    .map(s => ({
      label: s.label || s.positionKey,
      count: s.occupiedCount || 0,
      zone: s.zoneLabel || ''
    }));

  return {
    sampleCells,
    zoneTotals,
    orphanCount: (vm.orphanUnits || []).length,
    limboCount: (vm.limboUnits || []).length,
    tallerCount: (vm.tallerUnits || []).length,
    slotsTotal: slots.length,
    occupiedSlots,
    filteredCount: vm.filteredCount,
    totalUnits: vm.totalUnits
  };
}
