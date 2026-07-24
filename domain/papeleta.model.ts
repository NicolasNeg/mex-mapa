// ═══════════════════════════════════════════════════════════
//  domain/papeleta.model.ts — pure business logic (no Firebase)
//  Cache-bust: 2026-07-22-core7-v3
// ═══════════════════════════════════════════════════════════

export type PapeletaStatus =
  | 'borrador'
  | 'lista'
  | 'entregada'
  | 'en_retorno'
  | 'cerrada_historial'
  | 'cancelada';

export type ChecklistValue = 'ok' | 'faltante' | 'na' | '';
export type ZonaEstadoValue = 'ok' | 'dano';
export type DamageType = 'scratch' | 'deep' | 'dent' | 'glass' | 'missing' | 'hit' | 'other';
export type DamageSeverity = 'small' | 'medium' | 'large';
export type DiagramView = 'top' | 'left_side' | 'right_side' | 'front' | 'rear';

export interface ZonaDef {
  orden: number;
  id: string;
  label: string;
  vista: string;
}

export interface ZonaRecord {
  estado: ZonaEstadoValue;
  nota: string;
  fotoPath: string;
  capturedAt: number | null;
}

export type ZonasMap = Record<string, ZonaRecord | undefined>;

export interface MarcasLlantas {
  delanteraIzq: string;
  delanteraDer: string;
  traseraIzq: string;
  traseraDer: string;
  marcarTodas: boolean;
}

export interface Tapetes {
  usoRudo: number | null;
  alfombra: number | null;
}

export interface DamageMark {
  id: string;
  displayNumber: number;
  view: DiagramView | string;
  x: number;
  y: number;
  damageType: DamageType;
  severity: DamageSeverity;
  note: string;
  photoIds: string[];
  source: 'salida' | 'entrada';
  sourceDamageId?: string | null;
  comparisonStatus?: 'new' | 'preexisting';
}

export interface FirmaMeta {
  imagePath?: string;
  firmaPath?: string;
  rejected?: boolean;
  singlePoint?: boolean;
  signerName?: string;
  signerRole?: string;
}

export interface PapeletaSalida {
  km?: number | string | null;
  gas?: string | null;
  kmAnomalia?: boolean;
  kmJustificacion?: string;
  firma?: FirmaMeta | null;
  marcasLlantas?: MarcasLlantas;
  marcaLlantas?: string;
  tapetesUsoRudo?: number | null;
  tapetesAlfombra?: number | null;
  danosMarcados?: DamageMark[];
  fotoTableroPath?: string;
  [key: string]: unknown;
}

export interface Papeleta {
  id?: string;
  status?: PapeletaStatus;
  mva?: string;
  modelo?: string;
  placas?: string;
  color?: string;
  vin?: string;
  clienteNombre?: string;
  contrato?: string;
  contratoId?: string;
  plazaId?: string;
  plazaOrigenId?: string;
  ultimaPlazaId?: string;
  zonas?: ZonasMap;
  checklist?: Record<string, ChecklistValue | undefined>;
  marcasLlantas?: MarcasLlantas;
  marcaLlantas?: string;
  tapetesUsoRudo?: number | null;
  tapetesAlfombra?: number | null;
  danosMarcados?: DamageMark[];
  danosLastDisplayNumber?: number;
  diagramaStrokes?: unknown[];
  casoVentasId?: string;
  correccionesSoloPapeleta?: boolean;
  salida?: PapeletaSalida;
  fotoTableroPath?: string;
  revision?: number;
  actualizadoAt?: { toMillis?: () => number };
  actualizadoAtMs?: number;
  kmAnomalia?: boolean;
  [key: string]: unknown;
}

export interface DeliveryGateResult {
  ok: boolean;
  hard: string[];
  soft: string[];
}

export interface EventStampUser {
  uid?: string;
  id?: string;
  nombre?: string;
  nombreCompleto?: string;
  displayName?: string;
  name?: string;
}

export interface EventStampOpts {
  user?: EventStampUser;
  plazaId?: string;
  now?: Date | number;
  timeZone?: string;
  action?: string;
}

export interface EventStamp {
  uid: string;
  nombre: string;
  plazaId: string;
  atMs: number;
  atLocal: string;
  action?: string;
}

export const STATUS = Object.freeze({
  BORRADOR: 'borrador',
  LISTA: 'lista',
  ENTREGADA: 'entregada',
  EN_RETORNO: 'en_retorno',
  CERRADA_HISTORIAL: 'cerrada_historial',
  CANCELADA: 'cancelada',
});

const TERMINAL_STATUSES: Set<string> = new Set([
  STATUS.ENTREGADA,
  STATUS.EN_RETORNO,
  STATUS.CERRADA_HISTORIAL,
  STATUS.CANCELADA,
]);

/**
 * Alcance de visibilidad / operación.
 * Las papeletas son **globales por empresa**, no por plaza.
 * Ejemplo: crear en BJX, que el auto llegue a GDL y allá completar / entregar.
 * `plazaId` en el doc es sello de procedencia (origen), no filtro de bandeja.
 */
export const PAPELETA_SCOPE = Object.freeze({
  kind: 'empresa',
  plazaFieldMeaning: 'provenance', // plazaId = dónde se creó / último sello, NO scope de query
});

/** Statuses donde la salida (KM, checklist, diagramas, fotos salida, firma) ya no se edita. */
const SALIDA_LOCKED_STATUSES: Set<string> = new Set([
  STATUS.ENTREGADA,
  STATUS.EN_RETORNO,
  STATUS.CERRADA_HISTORIAL,
  STATUS.CANCELADA,
]);

/**
 * Formatea fecha/hora local del dispositivo (lugar) para auditoría legible.
 * @param {Date|number|string} [when]
 * @param {string} [timeZone] IANA opcional (si se conoce zona de la plaza)
 */
export function formatLocalStamp(when: Date | number | string = new Date(), timeZone: string = ''): string {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const opts: Intl.DateTimeFormatOptions = {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    };
    if (timeZone) opts.timeZone = timeZone;
    return new Intl.DateTimeFormat('sv-SE', opts).format(d).replace(' ', 'T');
  } catch {
    return d.toISOString();
  }
}

/**
 * Sello de evento (crear / editar / entregar / regreso).
 * Captura: uid, nombre de usuario, plaza del lugar, fecha local del dispositivo.
 * Pure — no toca Firebase.
 *
 * @param {{ user?: object, plazaId?: string, now?: Date|number, timeZone?: string, action?: string }} opts
 */
export function buildEventStamp(opts: EventStampOpts = {}): EventStamp {
  const user = opts.user || {};
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
  const uid = String(
    user.uid
    || user.id
    || ''
  ).trim();
  const nombre = String(
    user.nombre
    || user.nombreCompleto
    || user.displayName
    || user.name
    || ''
  ).trim();
  const plazaId = String(opts.plazaId || '').trim().toUpperCase();
  return {
    uid,
    nombre,
    plazaId,
    atMs: now.getTime(),
    atLocal: formatLocalStamp(now, opts.timeZone || ''),
    action: String(opts.action || '').trim() || undefined,
  };
}

/**
 * Campos de procedencia al crear (pure merge helper).
 * plazaId = plaza origen; ultimaPlazaId arranca igual.
 */
export function buildCreateProvenance({ user, plazaId, now, timeZone }: EventStampOpts = {}): {
  plazaId: string; plazaOrigenId: string; ultimaPlazaId: string;
  creadoPor: string; creadoPorNombre: string; creadoAtLocal: string;
} {
  const stamp = buildEventStamp({ user, plazaId, now, timeZone, action: 'crear' });
  return {
    plazaId: stamp.plazaId,
    plazaOrigenId: stamp.plazaId,
    ultimaPlazaId: stamp.plazaId,
    creadoPor: stamp.uid,
    creadoPorNombre: stamp.nombre,
    creadoAtLocal: stamp.atLocal,
  };
}

/**
 * Patch de sello en cada autosave / entrega / regreso (pure).
 */
export function buildTouchProvenance({ user, plazaId, now, timeZone, action }: EventStampOpts = {}): Record<string, string> {
  const stamp = buildEventStamp({ user, plazaId, now, timeZone, action });
  const out: Record<string, string | undefined> = {
    ultimaPlazaId: stamp.plazaId || undefined,
    actualizadoPor: stamp.uid,
    actualizadoPorNombre: stamp.nombre,
    actualizadoAtLocal: stamp.atLocal,
  };
  if (action === 'entregar') {
    out.entregadaPlazaId = stamp.plazaId;
    out.entregadaPor = stamp.uid;
    out.entregadaPorNombre = stamp.nombre;
    out.entregadaAtLocal = stamp.atLocal;
  }
  if (action === 'regreso' || action === 'entrada') {
    out.entradaPlazaId = stamp.plazaId;
    out.entradaPor = stamp.uid;
    out.entradaPorNombre = stamp.nombre;
    out.entradaAtLocal = stamp.atLocal;
  }
  // Drop undefined so callers can Object.assign cleanly
  for (const k of Object.keys(out)) {
    if (out[k] === undefined || out[k] === '') delete out[k];
  }
  return out as Record<string, string>;
}

/**
 * Bandeja operativa: **todas** las papeletas de la empresa (no filtrar por plaza del usuario).
 * `preferPlazaId` solo sirve para ordenar “cerca de mí” en UI — nunca para ocultar.
 * @param {object[]} rows
 * @param {{ preferPlazaId?: string }} [opts]
 */
export function orderInboxGlobal(rows: Papeleta[] = [], opts: { preferPlazaId?: string } = {}): Papeleta[] {
  const prefer = String(opts.preferPlazaId || '').trim().toUpperCase();
  const list = Array.isArray(rows) ? rows.slice() : [];
  list.sort((a, b) => {
    if (prefer) {
      const ap = String(a.ultimaPlazaId || a.plazaId || '').toUpperCase() === prefer ? 0 : 1;
      const bp = String(b.ultimaPlazaId || b.plazaId || '').toUpperCase() === prefer ? 0 : 1;
      if (ap !== bp) return ap - bp;
    }
    const at = Number(a.actualizadoAt?.toMillis?.() ?? a.actualizadoAtMs ?? 0);
    const bt = Number(b.actualizadoAt?.toMillis?.() ?? b.actualizadoAtMs ?? 0);
    return bt - at;
  });
  return list;
}

/** Cliente o contrato presentes (cualquiera basta para UI “asignado”). */
export function hasClienteOrContrato(papeleta: Papeleta = {}): boolean {
  const cliente = String(papeleta.clienteNombre || '').trim();
  const contrato = String(papeleta.contrato || papeleta.contratoId || '').trim();
  return !!(cliente || contrato);
}

/**
 * Asignar / corregir cliente: permitido mientras no esté cancelada ni cerrada en historial.
 * También **después de entregada** (Ventas puede completar ficha sin reabrir salida).
 */
export function canAssignCliente(status: PapeletaStatus | string): boolean {
  return status === STATUS.BORRADOR
    || status === STATUS.LISTA
    || status === STATUS.ENTREGADA
    || status === STATUS.EN_RETORNO;
}

/** Igual que cliente: contrato opcional al crear; asignable después. */
export function canAssignContrato(status: PapeletaStatus | string): boolean {
  return canAssignCliente(status);
}

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

/** Additive zones — tablero backs KM; interior/herramienta are core photos (v3). */
export const ZONAS_EXTRA = Object.freeze([
  { orden: 13, id: 'tablero_kilometraje', label: 'Tablero / kilometraje', vista: 'interior' },
  { orden: 14, id: 'interior',            label: 'Interior',              vista: 'interior' },
  { orden: 15, id: 'herramienta',         label: 'Herramienta',           vista: 'interior' },
  { orden: 16, id: 'refaccion',           label: 'Refacción',             vista: 'interior' },
]);

/** All zone defs for createEmptyZonas. */
export const ZONAS_ALL = Object.freeze([...ZONAS_V1, ...ZONAS_EXTRA]);

/**
 * Canonical core walkaround (7). Delivery hard-gate for `core_photos`.
 * Tablero is hard separately (`tablero_photo`) — captured in KM step, not counted in 7/7.
 * Order matches product: frontal, parabrisas, lat izq/der, trasera, interior, herramienta.
 */
export const ZONAS_CORE = Object.freeze([
  'frente_defensa',
  'parabrisas',
  'lateral_izq',
  'lateral_der',
  'trasera_cajuela',
  'interior',
  'herramienta',
]);

export const ZONA_CORE_LABELS = Object.freeze({
  frente_defensa: 'Frontal',
  parabrisas: 'Parabrisas',
  lateral_izq: 'Lateral izquierdo',
  lateral_der: 'Lateral derecho',
  trasera_cajuela: 'Defensa trasera',
  interior: 'Interior',
  herramienta: 'Herramienta',
});

/** Hard photo that is NOT part of the 7-core counter. */
export const ZONA_TABLERO_ID = 'tablero_kilometraje';

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

export function createEmptyMarcasLlantas(): MarcasLlantas {
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
export function normalizeMarcasLlantas(p: Papeleta = {}): MarcasLlantas {
  const base = createEmptyMarcasLlantas();
  const src: Record<string, any> =
    (p && typeof p.marcasLlantas === 'object' && p.marcasLlantas)
    || (p?.salida && typeof p.salida.marcasLlantas === 'object' && p.salida.marcasLlantas)
    || {};
  for (const k of LLANTA_KEYS) {
    (base as unknown as Record<string, string>)[k] = String(src[k] ?? '').trim();
  }
  base.marcarTodas = src.marcarTodas === true;
  const legacy = String(p?.marcaLlantas || p?.checklist?.marca_llantas || p?.salida?.marcaLlantas || '').trim();
  if (legacy && LLANTA_KEYS.every((k) => !(base as unknown as Record<string, string>)[k])) {
    for (const k of LLANTA_KEYS) (base as unknown as Record<string, string>)[k] = legacy;
    base.marcarTodas = true;
  }
  return base;
}

export function createEmptyTapetes(): Tapetes {
  return { usoRudo: null, alfombra: null };
}

/**
 * Tapetes: un solo dígito 0–9. 0 = no tiene.
 * @param {unknown} v
 */
export function isValidTapeteDigit(v: unknown): boolean {
  if (v == null || v === '') return false;
  const s = String(v).trim();
  if (!/^[0-9]$/.test(s)) return false;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 9;
}

/** @param {object} p */
export function normalizeTapetes(p: Papeleta = {}): Tapetes {
  const nested: Record<string, any> = (p && typeof p.tapetes === 'object' && p.tapetes) || {};
  const uso = nested.usoRudo ?? p?.tapetesUsoRudo ?? p?.salida?.tapetesUsoRudo;
  const alf = nested.alfombra ?? p?.tapetesAlfombra ?? p?.salida?.tapetesAlfombra;
  const toDigit = (v: unknown) => {
    if (v == null || v === '') return null;
    const s = String(v).replace(/\D+/g, '');
    if (!s) return null;
    // Solo primer dígito (máx 1 carácter numérico 0–9)
    const d = s.slice(0, 1);
    const n = Number(d);
    return Number.isFinite(n) && n >= 0 && n <= 9 ? n : null;
  };
  return { usoRudo: toDigit(uso), alfombra: toDigit(alf) };
}

export function createEmptyChecklist(): Record<string, ChecklistValue> {
  const o: Record<string, ChecklistValue> = {};
  for (const k of CHECKLIST_KEYS) o[k] = '';
  return o;
}

export function createEmptyZonas(): ZonasMap {
  const o: ZonasMap = {};
  for (const z of ZONAS_ALL) {
    o[z.id] = { estado: 'ok', nota: '', fotoPath: '', capturedAt: null };
  }
  return o;
}

/** Optional progress: all original 12 ZONAS_V1 have a photo (extras not required). */
export function allZonasHaveFoto(zonas: ZonasMap = {}): boolean {
  return ZONAS_V1.every((z) => String(zonas[z.id]?.fotoPath || '').trim().length > 0);
}

/**
 * Dual-read zone photo path. Legacy `fotoTableroPath` maps to tablero_kilometraje.
 * @param {object} zonas
 * @param {string} zonaId
 * @param {object|null} [papeleta]
 */
export function resolveZonaFotoPath(zonas: ZonasMap = {}, zonaId: string, papeleta: Papeleta | null = null): string {
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
export function coreZonasHaveFoto(zonas: ZonasMap = {}, opts: { papeleta?: Papeleta } = {}): boolean {
  void opts;
  return ZONAS_CORE.every((id) => String(zonas?.[id]?.fotoPath || '').trim().length > 0);
}

/**
 * Tablero es hard aparte del contador 7/7 core (captura en paso KM).
 * @param {object|null} papeleta
 * @param {object} [zonas]
 */
export function tableroHaveFoto(papeleta: Papeleta | null = null, zonas: ZonasMap | null = null): boolean {
  const z = zonas || papeleta?.zonas || {};
  return resolveZonaFotoPath(z, ZONA_TABLERO_ID, papeleta).length > 0;
}

/** Keys-only checklist helper (llantas/tapetes not included). */
export function checklistCompleto(checklist: Record<string, ChecklistValue | undefined> = {}): boolean {
  return CHECKLIST_KEYS.every((k) => ['ok', 'faltante', 'na'].includes(String(checklist[k] || '')));
}

/**
 * Full checklist gate: keys + 4 llantas + tapetes 0–9 (0 = no tiene).
 * @param {object} papeleta
 */
export function isChecklistComplete(papeleta: Papeleta = {}): boolean {
  const cl = papeleta.checklist || {};
  const keysOk = CHECKLIST_KEYS.every((k) =>
    ['ok', 'faltante', 'na'].includes(String(cl[k] || ''))
  );
  const llantas = normalizeMarcasLlantas(papeleta);
  const llantasOk = LLANTA_KEYS.every((k) => String((llantas as unknown as Record<string, string>)[k] || '').trim().length > 0);
  const tapetes = normalizeTapetes(papeleta);
  const tapetesOk = isValidTapeteDigit(tapetes.usoRudo) && isValidTapeteDigit(tapetes.alfombra);
  return keysOk && llantasOk && tapetesOk;
}

export function hasFaltantes(checklist: Record<string, ChecklistValue | undefined> = {}): boolean {
  return CHECKLIST_KEYS.some((k) => String(checklist[k] || '') === 'faltante');
}

export function isValidKm(km: unknown): boolean {
  if (km == null || km === '') return false;
  const n = Number(km);
  return Number.isFinite(n) && n >= 0;
}

export function isGasSet(gas: unknown): boolean {
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
export function isValidFirma(firma: FirmaMeta | null | undefined): boolean {
  if (!firma || typeof firma !== 'object') return false;
  if (firma.rejected === true || firma.singlePoint === true) return false;
  const path = String(firma.imagePath || firma.firmaPath || '').trim();
  return path.length > 0;
}

/**
 * Edición de **salida** (KM, gas, checklist, zonas, diagrama, fotos salida).
 * true solo en borrador|lista. Una vez ENTREGADA → false (regla dura).
 */
export function puedeEditar(status: PapeletaStatus | string): boolean {
  return status === STATUS.BORRADOR || status === STATUS.LISTA;
}

/** Alias explícito: salida mutable ↔ puedeEditar. */
export function isSalidaMutable(status: PapeletaStatus | string): boolean {
  return puedeEditar(status);
}

export function isSalidaLocked(status: PapeletaStatus | string): boolean {
  return SALIDA_LOCKED_STATUSES.has(status as string);
}

export function assertSalidaMutable(status: PapeletaStatus | string): void {
  if (!isSalidaMutable(status)) {
    const err: any = new Error('Salida inmutable (papeleta ya entregada o cerrada)');
    err.code = 'SALIDA_IMMUTABLE';
    throw err;
  }
}

/**
 * Qué mutaciones admite un status (pure policy matrix).
 * @returns {{ salida: boolean, cliente: boolean, contrato: boolean, regreso: boolean, cancelar: boolean }}
 */
export function mutationPolicy(status: PapeletaStatus | string): {
  salida: boolean; cliente: boolean; contrato: boolean; regreso: boolean; cancelar: boolean;
} {
  return {
    salida: isSalidaMutable(status),
    cliente: canAssignCliente(status),
    contrato: canAssignContrato(status),
    regreso: status === STATUS.ENTREGADA || status === STATUS.EN_RETORNO,
    cancelar: status === STATUS.BORRADOR || status === STATUS.LISTA,
  };
}

export function clampNorm(n: unknown): number {
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
export function nextDisplayNumber(danosMarcados: DamageMark[] = [], lastAssigned: number = 0): number {
  let max = Number(lastAssigned) || 0;
  for (const d of danosMarcados || []) {
    const n = Number(d?.displayNumber ?? (d as any)?.number);
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
}: {
  id?: string; view?: string; x: number; y: number; damageType?: DamageType; severity?: DamageSeverity;
  note?: string; photoIds?: string[]; source?: 'salida' | 'entrada'; nextDisplayNumber?: number;
}): DamageMark {
  const displayNumber = Number(num) > 0 ? Number(num) : 1;
  const type = DAMAGE_TYPES.includes(damageType) ? damageType : 'other';
  const sev = DAMAGE_SEVERITIES.includes(severity) ? severity : 'medium';
  return {
    id: String(id || `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`),
    displayNumber,
    view: DIAGRAM_VIEWS.includes(view as string) ? (view as string) : String(view || 'top'),
    x: clampNorm(x),
    y: clampNorm(y),
    damageType: type,
    severity: sev,
    note: String(note || '').slice(0, 500),
    photoIds: Array.isArray(photoIds) ? photoIds.slice() : [],
    source: source === 'entrada' ? 'entrada' : 'salida',
  };
}

export function requiresKmJustification(papeleta: Papeleta = {}): boolean {
  return papeleta.salida?.kmAnomalia === true || papeleta.kmAnomalia === true;
}

/**
 * Soft: KM edited after tablero photo exists → recommend retake.
 */
export function kmTableroRetakeNeeded(papeleta: Papeleta | undefined, newKm: unknown): boolean {
  const path = resolveZonaFotoPath(papeleta?.zonas, 'tablero_kilometraje', papeleta);
  if (!path) return false;
  const prev = papeleta?.salida?.km;
  if (prev == null || prev === '') return false;
  return Number(prev) !== Number(newKm);
}

export function damagesMissingPhoto(danos: DamageMark[] = []): boolean {
  return (danos || []).some((d) => {
    const policy: string = DAMAGE_PHOTO_POLICY[d.damageType] || 'recommended';
    if (policy === 'omit') return false;
    return !(Array.isArray(d.photoIds) && d.photoIds.length > 0);
  });
}

export function optionalPhotosPending(zonas: ZonasMap = {}): boolean {
  const core = new Set(ZONAS_CORE);
  return ZONAS_V1.some((z) => {
    if (core.has(z.id)) return false;
    return !String(zonas[z.id]?.fotoPath || '').trim();
  });
}

export function largeDamagesWithoutVentasReport(papeleta: Papeleta = {}): boolean {
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
export function puedeEntregar(
  papeletaOrStatus: Papeleta | PapeletaStatus | string,
  optsOrZonas: { firma?: FirmaMeta | null; pendingWrites?: boolean; kmJustification?: string } | ZonasMap = {},
  checklistMaybe?: Record<string, ChecklistValue | undefined>
): DeliveryGateResult | boolean {
  // Legacy 3-arg: (status, zonas, checklist) → boolean (compat with pre-redesign callers)
  if (typeof papeletaOrStatus === 'string') {
    const status = papeletaOrStatus;
    const zonas = (optsOrZonas || {}) as ZonasMap;
    const checklist = checklistMaybe || {};
    if (status !== STATUS.LISTA) return false;
    return allZonasHaveFoto(zonas) && checklistCompleto(checklist);
  }

  const papeleta = papeletaOrStatus;
  const opts = (optsOrZonas && typeof optsOrZonas === 'object' ? optsOrZonas : {}) as {
    firma?: FirmaMeta | null; pendingWrites?: boolean; kmJustification?: string;
  };

  if (!papeleta || typeof papeleta !== 'object') {
    return { ok: false, hard: ['status'], soft: [] };
  }
  if (TERMINAL_STATUSES.has(papeleta.status as string)) {
    return { ok: false, hard: ['status'], soft: [] };
  }

  const firma = opts.firma || papeleta.salida?.firma || null;
  const hard = [];
  if (!isValidKm(papeleta.salida?.km)) hard.push('km');
  if (!isGasSet(papeleta.salida?.gas)) hard.push('gas');
  if (!isChecklistComplete(papeleta)) hard.push('checklist');
  if (!coreZonasHaveFoto(papeleta.zonas, { papeleta })) hard.push('core_photos');
  if (!tableroHaveFoto(papeleta)) hard.push('tablero_photo');
  if (!isValidFirma(firma)) hard.push('firma');
  if (opts.pendingWrites) hard.push('pending_writes');
  const just = opts.kmJustification ?? papeleta.salida?.kmJustificacion ?? '';
  if (requiresKmJustification(papeleta) && !String(just).trim()) {
    hard.push('km_justification');
  }
  if (hard.length) return { ok: false, hard, soft: [] };

  const soft = [];
  // Cliente/contrato NO bloquean entrega: se pueden asignar después (incluso post-entregada).
  const hasSigner = !!String(firma?.signerName || '').trim();
  if (!hasClienteOrContrato(papeleta) && !hasSigner) {
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
export function computeStatusAfterSave({ status, zonas, checklist, papeleta }: {
  status?: PapeletaStatus; zonas?: ZonasMap; checklist?: Record<string, ChecklistValue | undefined>; papeleta?: Papeleta;
} = {}): PapeletaStatus {
  if (TERMINAL_STATUSES.has(status as string)) return status as PapeletaStatus;

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
    && tableroHaveFoto(merged)
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
export function buildEntradaDamageComparison(salidaMarks: DamageMark[] = [], entradaMarks: DamageMark[] = []): DamageMark[] {
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

export function danoYaDocumentadoEnSalida(zonaId: string, zonasSalida: ZonasMap = {}): boolean {
  return String(zonasSalida[zonaId]?.estado || '') === 'dano';
}

export function rolPuedeCerrarCaso(rol: string): boolean {
  const r = String(rol || '').toUpperCase();
  if (FULL_ACCESS.has(r)) return true;
  return ((ROLE_LEVEL as Record<string, number>)[r] || 0) > ROLE_LEVEL.VENTAS;
}

export function rolPuedeGestionarVentas(rol: string): boolean {
  const r = String(rol || '').toUpperCase();
  if (FULL_ACCESS.has(r)) return true;
  return ((ROLE_LEVEL as Record<string, number>)[r] || 0) >= ROLE_LEVEL.VENTAS;
}

export function truncNota(nota: unknown, max: number = 40): string {
  return String(nota || '').slice(0, max);
}
