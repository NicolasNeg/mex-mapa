// ═══════════════════════════════════════════════════════════
//  domain/papeleta.model.js — pure business logic (no Firebase)
//  Cache-bust: 2026-07-20-mobile-redesign-v1
// ═══════════════════════════════════════════════════════════

/** @typedef {'borrador'|'lista'|'entregada'|'en_retorno'|'cerrada_historial'|'cancelada'} PapeletaStatus */
/** @typedef {'ok'|'faltante'|'na'|''} ChecklistValue */
/** @typedef {'ok'|'dano'} ZonaEstado */

export const STATUS = Object.freeze({
  BORRADOR: 'borrador',
  LISTA: 'lista',
  ENTREGADA: 'entregada',
  EN_RETORNO: 'en_retorno',
  CERRADA_HISTORIAL: 'cerrada_historial',
  CANCELADA: 'cancelada',
});

const TERMINAL_STATUSES = new Set([
  STATUS.ENTREGADA,
  STATUS.EN_RETORNO,
  STATUS.CERRADA_HISTORIAL,
  STATUS.CANCELADA,
]);

/** Original 12 inspection zones — never remove ids. */
export const ZONAS_V1 = Object.freeze([
  { orden: 1,  id: 'trasera_cajuela',  label: 'Trasera / cajuela',           vista: 'rear' },
  { orden: 2,  id: 'lateral_der',      label: 'Lateral derecho',             vista: 'right' },
  { orden: 3,  id: 'cristal_der',      label: 'Cristal derecho',             vista: 'right' },
  { orden: 4,  id: 'llanta_del_der',   label: 'Llanta delantera derecha',    vista: 'right' },
  { orden: 5,  id: 'llanta_tras_der',  label: 'Llanta trasera derecha',      vista: 'right' },
  { orden: 6,  id: 'lateral_izq',      label: 'Lateral izquierdo',           vista: 'left' },
  { orden: 7,  id: 'cristal_izq',      label: 'Cristal izquierdo',           vista: 'left' },
  { orden: 8,  id: 'llanta_del_izq',   label: 'Llanta delantera izquierda',  vista: 'left' },
  { orden: 9,  id: 'llanta_tras_izq',  label: 'Llanta trasera izquierda',    vista: 'left' },
  { orden: 10, id: 'frente_defensa',   label: 'Frente / defensa',            vista: 'front' },
  { orden: 11, id: 'parabrisas',       label: 'Parabrisas',                  vista: 'front' },
  { orden: 12, id: 'cofre',            label: 'Cofre',                       vista: 'front' },
]);

/** Additive zones (template v2) — tablero backs KM claim; interior is core. */
export const ZONAS_EXTRA = Object.freeze([
  { orden: 13, id: 'tablero_kilometraje', label: 'Tablero / kilometraje', vista: 'interior' },
  { orden: 14, id: 'interior',            label: 'Interior',              vista: 'interior' },
]);

/** All zone defs for createEmptyZonas (14). */
export const ZONAS_ALL = Object.freeze([...ZONAS_V1, ...ZONAS_EXTRA]);

/**
 * Canonical core walkaround order (6). Delivery hard-gate uses these ids only.
 * Product labels: frente, trasera, lateral_izquierdo, lateral_derecho, tablero_kilometraje, interior.
 */
export const ZONAS_CORE = Object.freeze([
  'frente_defensa',
  'trasera_cajuela',
  'lateral_izq',
  'lateral_der',
  'tablero_kilometraje',
  'interior',
]);

export const ZONA_CORE_LABELS = Object.freeze({
  frente_defensa: 'Frente',
  trasera_cajuela: 'Trasera',
  lateral_izq: 'Lateral izquierdo',
  lateral_der: 'Lateral derecho',
  tablero_kilometraje: 'Tablero / kilometraje',
  interior: 'Interior',
});

export const CHECKLIST_KEYS = Object.freeze([
  'placas', 'catalizador', 'tapon_gas', 'gato', 'herramienta',
  'dado_seguridad', 'refaccion', 'mofle', 'antena', 'limpiaparabrisas', 'aire_acondicionado',
]);

export const CHECKLIST_LABELS = Object.freeze({
  placas: 'Placas',
  catalizador: 'Catalizador',
  tapon_gas: 'Tapón de gas',
  gato: 'Gato',
  herramienta: 'Herramienta',
  dado_seguridad: 'Dado de seguridad',
  refaccion: 'Refacción',
  mofle: 'Mofle',
  antena: 'Antena',
  limpiaparabrisas: 'Limpiaparabrisas',
  aire_acondicionado: 'Aire acondicionado',
});

/** Tire brand slots — visual order: front L/R then rear L/R */
export const LLANTA_KEYS = Object.freeze([
  'delanteraIzq', 'delanteraDer', 'traseraIzq', 'traseraDer',
]);

export const LLANTA_LABELS = Object.freeze({
  delanteraIzq: 'Delantera izquierda',
  delanteraDer: 'Delantera derecha',
  traseraIzq: 'Trasera izquierda',
  traseraDer: 'Trasera derecha',
});

export const DAMAGE_TYPES = Object.freeze([
  'scratch', 'deep', 'dent', 'glass', 'missing', 'hit', 'other',
]);

export const DAMAGE_SEVERITIES = Object.freeze(['small', 'medium', 'large']);

export const DAMAGE_TYPE_LABELS = Object.freeze({
  scratch: 'Rayón',
  deep: 'Rayón profundo',
  dent: 'Abolladura',
  glass: 'Cristal',
  missing: 'Faltante',
  hit: 'Golpe',
  other: 'Otro',
});

export const DAMAGE_SEVERITY_LABELS = Object.freeze({
  small: 'Chico',
  medium: 'Medio',
  large: 'Grande',
});

export const DAMAGE_PHOTO_POLICY = Object.freeze({
  scratch: 'recommended',
  deep: 'strongly_recommended',
  dent: 'strongly_recommended',
  glass: 'strongly_recommended',
  missing: 'strongly_recommended',
  hit: 'strongly_recommended',
  other: 'recommended',
});

export const DIAGRAM_VIEWS = Object.freeze([
  'top', 'left_side', 'right_side', 'front', 'rear',
]);

const ROLE_LEVEL = Object.freeze({
  AUXILIAR: 1,
  VENTAS: 2,
  SUPERVISOR: 3,
  JEFE_PATIO: 4,
  GERENTE_PLAZA: 5,
  JEFE_REGIONAL: 6,
  CORPORATIVO_USER: 7,
  JEFE_OPERACION: 8,
  PROGRAMADOR: 9,
});

const FULL_ACCESS = new Set(['PROGRAMADOR', 'JEFE_OPERACION', 'CORPORATIVO_USER']);

export function createEmptyMarcasLlantas() {
  return {
    delanteraIzq: '',
    delanteraDer: '',
    traseraIzq: '',
    traseraDer: '',
    marcarTodas: false,
  };
}

/**
 * Normalize tire brands from doc. Migrates legacy single `marcaLlantas` string → all 4.
 * @param {object} p
 */
export function normalizeMarcasLlantas(p = {}) {
  const base = createEmptyMarcasLlantas();
  const src =
    (p && typeof p.marcasLlantas === 'object' && p.marcasLlantas)
    || (p?.salida && typeof p.salida.marcasLlantas === 'object' && p.salida.marcasLlantas)
    || {};
  for (const k of LLANTA_KEYS) {
    base[k] = String(src[k] ?? '').trim();
  }
  base.marcarTodas = src.marcarTodas === true;
  const legacy = String(p?.marcaLlantas || p?.checklist?.marca_llantas || p?.salida?.marcaLlantas || '').trim();
  if (legacy && LLANTA_KEYS.every((k) => !base[k])) {
    for (const k of LLANTA_KEYS) base[k] = legacy;
    base.marcarTodas = true;
  }
  return base;
}

export function createEmptyTapetes() {
  return { usoRudo: null, alfombra: null };
}

/** @param {object} p */
export function normalizeTapetes(p = {}) {
  const nested = (p && typeof p.tapetes === 'object' && p.tapetes) || {};
  const uso = nested.usoRudo ?? p?.tapetesUsoRudo ?? p?.salida?.tapetesUsoRudo;
  const alf = nested.alfombra ?? p?.tapetesAlfombra ?? p?.salida?.tapetesAlfombra;
  const toNum = (v) => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/\D+/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  return { usoRudo: toNum(uso), alfombra: toNum(alf) };
}

export function createEmptyChecklist() {
  const o = {};
  for (const k of CHECKLIST_KEYS) o[k] = '';
  return o;
}

export function createEmptyZonas() {
  const o = {};
  for (const z of ZONAS_ALL) {
    o[z.id] = { estado: 'ok', nota: '', fotoPath: '', capturedAt: null };
  }
  return o;
}

/** Optional progress: all original 12 ZONAS_V1 have a photo (extras not required). */
export function allZonasHaveFoto(zonas = {}) {
  return ZONAS_V1.every((z) => String(zonas[z.id]?.fotoPath || '').trim().length > 0);
}

/**
 * Dual-read zone photo path. Legacy `fotoTableroPath` maps to tablero_kilometraje.
 * @param {object} zonas
 * @param {string} zonaId
 * @param {object|null} [papeleta]
 */
export function resolveZonaFotoPath(zonas = {}, zonaId, papeleta = null) {
  const direct = String(zonas?.[zonaId]?.fotoPath || '').trim();
  if (direct) return direct;
  if (zonaId === 'tablero_kilometraje') {
    return String(
      papeleta?.fotoTableroPath
      || papeleta?.salida?.fotoTableroPath
      || ''
    ).trim();
  }
  return '';
}

/**
 * @param {object} zonas
 * @param {{ papeleta?: object, fotoTableroPath?: string }} [opts]
 */
export function coreZonasHaveFoto(zonas = {}, opts = {}) {
  const papeleta = opts.papeleta || null;
  const fallbackTablero = String(opts.fotoTableroPath || '').trim();
  return ZONAS_CORE.every((id) => {
    if (id === 'tablero_kilometraje') {
      const p = resolveZonaFotoPath(zonas, id, papeleta) || fallbackTablero;
      return p.length > 0;
    }
    return String(zonas?.[id]?.fotoPath || '').trim().length > 0;
  });
}

/** Keys-only checklist helper (llantas/tapetes not included). */
export function checklistCompleto(checklist = {}) {
  return CHECKLIST_KEYS.every((k) => ['ok', 'faltante', 'na'].includes(String(checklist[k] || '')));
}

/**
 * Full checklist gate: keys + 4 llantas + tapetes counts defined.
 * @param {object} papeleta
 */
export function isChecklistComplete(papeleta = {}) {
  const cl = papeleta.checklist || {};
  const keysOk = CHECKLIST_KEYS.every((k) =>
    ['ok', 'faltante', 'na'].includes(String(cl[k] || ''))
  );
  const llantas = normalizeMarcasLlantas(papeleta);
  const llantasOk = LLANTA_KEYS.every((k) => String(llantas[k] || '').trim().length > 0);
  const tapetes = normalizeTapetes(papeleta);
  const tapetesOk = tapetes.usoRudo != null && tapetes.alfombra != null;
  return keysOk && llantasOk && tapetesOk;
}

export function hasFaltantes(checklist = {}) {
  return CHECKLIST_KEYS.some((k) => String(checklist[k] || '') === 'faltante');
}

export function isValidKm(km) {
  if (km == null || km === '') return false;
  const n = Number(km);
  return Number.isFinite(n) && n >= 0;
}

export function isGasSet(gas) {
  if (gas == null || gas === '') return false;
  const s = String(gas).trim();
  if (!s) return false;
  const n = Number(s);
  if (Number.isFinite(n) && n >= 0 && n <= 8) return true;
  // Letter / fraction chips used in patio UI (E … F, N/A)
  return true;
}

/**
 * Firma válida: path + not rejected/single-point.
 * Accepts legacy `{ firmaPath }` or new metadata shape.
 */
export function isValidFirma(firma) {
  if (!firma || typeof firma !== 'object') return false;
  if (firma.rejected === true || firma.singlePoint === true) return false;
  const path = String(firma.imagePath || firma.firmaPath || '').trim();
  return path.length > 0;
}

export function puedeEditar(status) {
  return status === STATUS.BORRADOR || status === STATUS.LISTA;
}

export function isSalidaMutable(status) {
  return status === STATUS.BORRADOR || status === STATUS.LISTA;
}

export function assertSalidaMutable(status) {
  if (!isSalidaMutable(status)) {
    const err = new Error('Salida inmutable (papeleta ya entregada o cerrada)');
    err.code = 'SALIDA_IMMUTABLE';
    throw err;
  }
}

export function clampNorm(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/**
 * Next display number for a damage mark. Never reuse within session:
 * pass `lastAssigned` (doc field `danosLastDisplayNumber`) so deletes don't renumber.
 * @param {object[]} danosMarcados
 * @param {number} [lastAssigned]
 */
export function nextDisplayNumber(danosMarcados = [], lastAssigned = 0) {
  let max = Number(lastAssigned) || 0;
  for (const d of danosMarcados || []) {
    const n = Number(d?.displayNumber ?? d?.number);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/**
 * @param {object} opts
 */
export function createDamageMark({
  id,
  view,
  x,
  y,
  damageType = 'scratch',
  severity = 'medium',
  note = '',
  photoIds = [],
  source = 'salida',
  nextDisplayNumber: num,
} = {}) {
  const displayNumber = Number(num) > 0 ? Number(num) : 1;
  const type = DAMAGE_TYPES.includes(damageType) ? damageType : 'other';
  const sev = DAMAGE_SEVERITIES.includes(severity) ? severity : 'medium';
  return {
    id: String(id || `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`),
    displayNumber,
    view: DIAGRAM_VIEWS.includes(view) ? view : String(view || 'top'),
    x: clampNorm(x),
    y: clampNorm(y),
    damageType: type,
    severity: sev,
    note: String(note || '').slice(0, 500),
    photoIds: Array.isArray(photoIds) ? photoIds.slice() : [],
    source: source === 'entrada' ? 'entrada' : 'salida',
  };
}

export function requiresKmJustification(papeleta = {}) {
  return papeleta.salida?.kmAnomalia === true || papeleta.kmAnomalia === true;
}

/**
 * Soft: KM edited after tablero photo exists → recommend retake.
 */
export function kmTableroRetakeNeeded(papeleta, newKm) {
  const path = resolveZonaFotoPath(papeleta?.zonas, 'tablero_kilometraje', papeleta);
  if (!path) return false;
  const prev = papeleta?.salida?.km;
  if (prev == null || prev === '') return false;
  return Number(prev) !== Number(newKm);
}

export function damagesMissingPhoto(danos = []) {
  return (danos || []).some((d) => {
    const policy = DAMAGE_PHOTO_POLICY[d.damageType] || 'recommended';
    if (policy === 'omit') return false;
    return !(Array.isArray(d.photoIds) && d.photoIds.length > 0);
  });
}

export function optionalPhotosPending(zonas = {}) {
  const core = new Set(ZONAS_CORE);
  return ZONAS_V1.some((z) => {
    if (core.has(z.id)) return false;
    return !String(zonas[z.id]?.fotoPath || '').trim();
  });
}

export function largeDamagesWithoutVentasReport(papeleta = {}) {
  const marks = papeleta.danosMarcados || papeleta.salida?.danosMarcados || [];
  const hasLarge = (marks || []).some((d) => d.severity === 'large');
  if (!hasLarge) return false;
  return !String(papeleta.casoVentasId || '').trim();
}

/**
 * Delivery gate. Prefer object form:
 *   puedeEntregar(papeleta, { firma, pendingWrites, kmJustification })
 * Legacy shim (boolean): puedeEntregar(status, zonas, checklist)
 *
 * @returns {{ ok: boolean, hard: string[], soft: string[] } | boolean}
 */
export function puedeEntregar(papeletaOrStatus, optsOrZonas = {}, checklistMaybe) {
  // Legacy 3-arg: (status, zonas, checklist) → boolean (compat with pre-redesign callers)
  if (typeof papeletaOrStatus === 'string') {
    const status = papeletaOrStatus;
    const zonas = optsOrZonas || {};
    const checklist = checklistMaybe || {};
    if (status !== STATUS.LISTA) return false;
    return allZonasHaveFoto(zonas) && checklistCompleto(checklist);
  }

  const papeleta = papeletaOrStatus;
  const opts = optsOrZonas && typeof optsOrZonas === 'object' ? optsOrZonas : {};

  if (!papeleta || typeof papeleta !== 'object') {
    return { ok: false, hard: ['status'], soft: [] };
  }
  if (TERMINAL_STATUSES.has(papeleta.status)) {
    return { ok: false, hard: ['status'], soft: [] };
  }

  const firma = opts.firma || papeleta.salida?.firma || null;
  const hard = [];
  if (!isValidKm(papeleta.salida?.km)) hard.push('km');
  if (!isGasSet(papeleta.salida?.gas)) hard.push('gas');
  if (!isChecklistComplete(papeleta)) hard.push('checklist');
  if (!coreZonasHaveFoto(papeleta.zonas, { papeleta })) hard.push('core_photos');
  if (!isValidFirma(firma)) hard.push('firma');
  if (opts.pendingWrites) hard.push('pending_writes');
  const just = opts.kmJustification ?? papeleta.salida?.kmJustificacion ?? '';
  if (requiresKmJustification(papeleta) && !String(just).trim()) {
    hard.push('km_justification');
  }
  if (hard.length) return { ok: false, hard, soft: [] };

  const soft = [];
  if (!String(papeleta.clienteNombre || '').trim() && !String(firma?.signerName || '').trim()) {
    soft.push('cliente');
  }
  if (hasFaltantes(papeleta.checklist)) soft.push('faltantes');
  if (damagesMissingPhoto(papeleta.danosMarcados || papeleta.salida?.danosMarcados || [])) {
    soft.push('damage_photos');
  }
  if (optionalPhotosPending(papeleta.zonas)) soft.push('optional_photos');
  if (papeleta.correccionesSoloPapeleta) soft.push('master_corrected_local');
  if (largeDamagesWithoutVentasReport(papeleta)) soft.push('large_damage_report');
  return { ok: true, hard: [], soft };
}

/**
 * Status projection after autosave.
 * Terminal/cancelada kept. Else lista when core+checklist+km/gas ok.
 */
export function computeStatusAfterSave({ status, zonas, checklist, papeleta } = {}) {
  if (TERMINAL_STATUSES.has(status)) return status;

  const merged = {
    ...(papeleta || {}),
    status,
    zonas: zonas ?? papeleta?.zonas,
    checklist: checklist ?? papeleta?.checklist,
  };

  const kmOk = isValidKm(merged.salida?.km);
  const gasOk = isGasSet(merged.salida?.gas);
  if (
    coreZonasHaveFoto(merged.zonas, { papeleta: merged })
    && isChecklistComplete(merged)
    && kmOk
    && gasOk
  ) {
    return STATUS.LISTA;
  }
  return STATUS.BORRADOR;
}

/**
 * Regreso comparison helper — does NOT mutate salida marks.
 * @param {object[]} salidaMarks
 * @param {object[]} entradaMarks
 */
export function buildEntradaDamageComparison(salidaMarks = [], entradaMarks = []) {
  const byId = new Map((salidaMarks || []).map((d) => [d.id, d]));
  return (entradaMarks || []).map((d) => {
    const srcId = d.sourceDamageId || null;
    let comparisonStatus = d.comparisonStatus || 'new';
    if (srcId && byId.has(srcId)) {
      comparisonStatus = d.comparisonStatus || 'preexisting';
    }
    return {
      ...d,
      source: d.source || 'entrada',
      comparisonStatus,
      sourceDamageId: srcId,
    };
  });
}

export function danoYaDocumentadoEnSalida(zonaId, zonasSalida = {}) {
  return String(zonasSalida[zonaId]?.estado || '') === 'dano';
}

export function rolPuedeCerrarCaso(rol) {
  const r = String(rol || '').toUpperCase();
  if (FULL_ACCESS.has(r)) return true;
  return (ROLE_LEVEL[r] || 0) > ROLE_LEVEL.VENTAS;
}

export function rolPuedeGestionarVentas(rol) {
  const r = String(rol || '').toUpperCase();
  if (FULL_ACCESS.has(r)) return true;
  return (ROLE_LEVEL[r] || 0) >= ROLE_LEVEL.VENTAS;
}

export function truncNota(nota, max = 40) {
  return String(nota || '').slice(0, max);
}
