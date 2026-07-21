// ═══════════════════════════════════════════════════════════
//  domain/papeleta.model.js — pure business logic (no Firebase)
//  Cache-bust: 2026-07-20-llantas-v2
// ═══════════════════════════════════════════════════════════

/** @typedef {'borrador'|'lista'|'entregada'|'en_retorno'|'cerrada_historial'} PapeletaStatus */
/** @typedef {'ok'|'faltante'|'na'|''} ChecklistValue */
/** @typedef {'ok'|'dano'} ZonaEstado */

export const STATUS = Object.freeze({
  BORRADOR: 'borrador',
  LISTA: 'lista',
  ENTREGADA: 'entregada',
  EN_RETORNO: 'en_retorno',
  CERRADA_HISTORIAL: 'cerrada_historial',
});

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

export function createEmptyChecklist() {
  const o = {};
  for (const k of CHECKLIST_KEYS) o[k] = '';
  return o;
}

export function createEmptyZonas() {
  const o = {};
  for (const z of ZONAS_V1) {
    o[z.id] = { estado: 'ok', nota: '', fotoPath: '' };
  }
  return o;
}

export function allZonasHaveFoto(zonas = {}) {
  return ZONAS_V1.every((z) => String(zonas[z.id]?.fotoPath || '').trim().length > 0);
}

export function checklistCompleto(checklist = {}) {
  return CHECKLIST_KEYS.every((k) => ['ok', 'faltante', 'na'].includes(String(checklist[k] || '')));
}

export function puedeEditar(status) {
  return status === STATUS.BORRADOR || status === STATUS.LISTA;
}

export function puedeEntregar(status, zonas, checklist) {
  return status === STATUS.LISTA && allZonasHaveFoto(zonas) && checklistCompleto(checklist);
}

export function computeStatusAfterSave({ status, zonas, checklist }) {
  if (
    status === STATUS.ENTREGADA
    || status === STATUS.EN_RETORNO
    || status === STATUS.CERRADA_HISTORIAL
  ) {
    return status;
  }
  if (allZonasHaveFoto(zonas) && checklistCompleto(checklist)) return STATUS.LISTA;
  return STATUS.BORRADOR;
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
