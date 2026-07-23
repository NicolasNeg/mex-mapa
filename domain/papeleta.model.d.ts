// Type declarations for papeleta.model.js
export const STATUS: Readonly<{
  BORRADOR: 'borrador';
  LISTA: 'lista';
  ENTREGADA: 'entregada';
  EN_RETORNO: 'en_retorno';
  CERRADA_HISTORIAL: 'cerrada_historial';
  CANCELADA: 'cancelada';
}>;

export const ZONAS_V1: readonly {
  orden: number;
  id: string;
  label: string;
  vista: string;
}[];

export const CHECKLIST_KEYS: readonly string[];

export const CHECKLIST_LABELS: Readonly<Record<string, string>>;

export const PAPELETA_SCOPE: Readonly<{
  kind: string;
  plazaFieldMeaning: string;
}>;

export const ZONAS_EXTRA: readonly {
  orden: number;
  id: string;
  label: string;
  vista: string;
}[];

export const ZONAS_ALL: readonly {
  orden: number;
  id: string;
  label: string;
  vista: string;
}[];

export const ZONAS_CORE: readonly string[];

export const ZONA_CORE_LABELS: Readonly<Record<string, string>>;

export const ZONA_TABLERO_ID: string;

export const LLANTA_KEYS: readonly string[];

export const LLANTA_LABELS: Readonly<Record<string, string>>;

export const DAMAGE_TYPES: readonly string[];

export const DAMAGE_SEVERITIES: readonly string[];

export const DAMAGE_TYPE_LABELS: Readonly<Record<string, string>>;

export const DAMAGE_SEVERITY_LABELS: Readonly<Record<string, string>>;

export const DAMAGE_PHOTO_POLICY: Readonly<Record<string, string>>;

export const DIAGRAM_VIEWS: readonly string[];

export function formatLocalStamp(when?: Date | number | string, timeZone?: string): string;

export function buildEventStamp(opts?: {
  user?: any;
  plazaId?: string;
  now?: Date | number;
  timeZone?: string;
  action?: string;
}): {
  uid: string;
  nombre: string;
  plazaId: string;
  atMs: number;
  atLocal: string;
  action?: string;
};

export function buildCreateProvenance(opts?: {
  user?: any;
  plazaId?: string;
  now?: Date | number;
  timeZone?: string;
}): {
  plazaId: string;
  plazaOrigenId: string;
  ultimaPlazaId: string;
  creadoPor: string;
  creadoPorNombre: string;
  creadoAtLocal: string;
};

export function buildTouchProvenance(opts?: {
  user?: any;
  plazaId?: string;
  now?: Date | number;
  timeZone?: string;
  action?: string;
}): Record<string, any>;

export function orderInboxGlobal(rows?: any[], opts?: { preferPlazaId?: string }): any[];

export function hasClienteOrContrato(papeleta?: any): boolean;

export function canAssignCliente(status: string): boolean;

export function canAssignContrato(status: string): boolean;

export function createEmptyMarcasLlantas(): {
  delanteraIzq: string;
  delanteraDer: string;
  traseraIzq: string;
  traseraDer: string;
  marcarTodas: boolean;
};

export function normalizeMarcasLlantas(p?: any): {
  delanteraIzq: string;
  delanteraDer: string;
  traseraIzq: string;
  traseraDer: string;
  marcarTodas: boolean;
};

export function createEmptyTapetes(): { usoRudo: null; alfombra: null };

export function isValidTapeteDigit(v: unknown): boolean;

export function normalizeTapetes(p?: any): { usoRudo: number | null; alfombra: number | null };

export function createEmptyChecklist(): Record<string, string>;

export function createEmptyZonas(): Record<string, any>;

export function allZonasHaveFoto(zonas?: Record<string, any>): boolean;

export function resolveZonaFotoPath(zonas?: Record<string, any>, zonaId?: string, papeleta?: any): string;

export function coreZonasHaveFoto(zonas?: Record<string, any>, opts?: any): boolean;

export function tableroHaveFoto(papeleta?: any, zonas?: any): boolean;

export function checklistCompleto(checklist?: Record<string, any>): boolean;

export function isChecklistComplete(papeleta?: any): boolean;

export function hasFaltantes(checklist?: Record<string, any>): boolean;

export function isValidKm(km: any): boolean;

export function isGasSet(gas: any): boolean;

export function isValidFirma(firma: any): boolean;

export function puedeEditar(status: string): boolean;

export function isSalidaMutable(status: string): boolean;

export function isSalidaLocked(status: string): boolean;

export function assertSalidaMutable(status: string): void;

export function mutationPolicy(status: string): {
  salida: boolean;
  cliente: boolean;
  contrato: boolean;
  regreso: boolean;
  cancelar: boolean;
};

export function clampNorm(n: any): number;

export function nextDisplayNumber(danosMarcados?: any[], lastAssigned?: number): number;

export function createDamageMark(opts?: {
  id?: string;
  view?: string;
  x?: number;
  y?: number;
  damageType?: string;
  severity?: string;
  note?: string;
  photoIds?: string[];
  source?: string;
  nextDisplayNumber?: number;
}): Record<string, any>;

export function requiresKmJustification(papeleta?: any): boolean;

export function kmTableroRetakeNeeded(papeleta?: any, newKm?: any): boolean;

export function damagesMissingPhoto(danos?: any[]): boolean;

export function optionalPhotosPending(zonas?: Record<string, any>): boolean;

export function largeDamagesWithoutVentasReport(papeleta?: any): boolean;

export function puedeEntregar(papeletaOrStatus: any, optsOrZonas?: any, checklistMaybe?: any): any;

export function computeStatusAfterSave(opts?: {
  status?: string;
  zonas?: Record<string, any>;
  checklist?: Record<string, any>;
  papeleta?: any;
}): string;

export function buildEntradaDamageComparison(salidaMarks?: any[], entradaMarks?: any[]): any[];

export function danoYaDocumentadoEnSalida(zonaId: string, zonasSalida?: Record<string, any>): boolean;

export function rolPuedeCerrarCaso(rol: string): boolean;

export function rolPuedeGestionarVentas(rol: string): boolean;

export function truncNota(nota: any, max?: number): string;
