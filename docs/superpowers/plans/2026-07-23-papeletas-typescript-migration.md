# Papeletas → TypeScript Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the 11 files that make up the Papeletas feature module from `.js` to `.ts` (strict), with `tsc` compiling each `.ts` to a `.js` file at the exact same path the browser already loads today, so no other file in the SPA needs to change.

**Architecture:** No bundler. `tsc -p tsconfig.papeletas.json` reads `.ts` sources and emits `.js` next to them (no `outDir` — default adjacent emit). Files outside the 11 in scope stay plain `.js` and are consumed via `allowJs` (untyped/`any` at the boundary) plus a small `types/globals.d.ts` for the handful of `window.*` globals this module touches. Compiled `.js` is committed to git (same convention as `sw.js`'s generated `CACHE_NAME`), and `npm run build:papeletas` is inserted into every deploy script so it's always regenerated fresh before `firebase deploy`.

**Tech Stack:** TypeScript 5.x (`tsc` only, no Vite/webpack/esbuild), existing Firebase compat SDKs, existing `domain/papeleta.model.js` business logic.

## Global Constraints

- Scope is **exactly** these 11 files — no other file in the repo is renamed or has its import paths changed: `domain/papeleta.model`, `js/app/features/papeletas/{papeletas-constants,papeletas-data,papeletas-storage,papeletas-reportes-data,papeletas-camera,papeletas-diagram,papeletas-photo-annotate,papeletas-pdf}`, `js/app/features/unidades/unidades-data`, `js/app/views/papeletas`.
- `strict: true` from the start (per approved spec `docs/superpowers/specs/2026-07-23-papeletas-typescript-migration-design.md`).
- Every `.ts` file's compiled `.js` output must land at the identical path currently served (e.g. `js/app/views/papeletas.ts` → `js/app/views/papeletas.js`) — verified after every task by confirming no other file's import path changed.
- Every task ends with: `npm run build:papeletas` (zero errors) → manual smoke of the affected Papeletas flow → `node scripts/bump-sw.js` → commit (`.ts` + regenerated `.js` + any tsconfig/package.json changes) → push. This matches this repo's existing task-closeout rule (`CLAUDE.md` / `agente.md`).
- No behavior changes. Every task only adds type annotations; if a step doesn't say to change logic, the logic is byte-for-byte identical to the current `.js`.
- The three runtime bugs from production (Storage 404 on stale `fotoPath`, Firestore transaction `failed-precondition`, PDF Cloud Function 500) are **out of scope** for every task below.

---

## File map

| File (converted) | New interfaces it introduces |
|---|---|
| `domain/papeleta.model.ts` | `Papeleta`, `ZonaRecord`, `ZonasMap`, `MarcasLlantas`, `Tapetes`, `DamageMark`, `FirmaMeta`, `DeliveryGateResult`, `PapeletaStatus`, `ChecklistValue` |
| `js/app/features/papeletas/papeletas-constants.ts` | (re-exports domain types) |
| `js/app/features/unidades/unidades-data.ts` | `Unidad` |
| `js/app/features/papeletas/papeletas-storage.ts` | (uses built-in `File`/`Blob`) |
| `js/app/features/papeletas/papeletas-data.ts` | `SideEffectsOpts`, `EntregaResult` |
| `js/app/features/papeletas/papeletas-reportes-data.ts` | `ReporteDano` |
| `js/app/features/papeletas/papeletas-camera.ts` | `GuidedCameraOpts` |
| `js/app/features/papeletas/papeletas-diagram.ts` | `DiagramOpts`, `DiagramApi` |
| `js/app/features/papeletas/papeletas-photo-annotate.ts` | `PhotoAnnotatorOpts` |
| `js/app/features/papeletas/papeletas-pdf.ts` | `ExportMatrix` |
| `js/app/views/papeletas.ts` | (consumes all of the above; no new exported types — it's a leaf view) |

---

### Task 1: Bootstrap TypeScript tooling

**Files:**
- Create: `tsconfig.papeletas.json`
- Create: `types/globals.d.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: the `tsc` config every later task compiles against, and the ambient `Window` typings (`window.mexAlert`, `window.mexConfirm`, `window.mexPrompt`, `window.mexPerms`, `window._auth`, `window._db`, `window._empresaActual`, `window.MEX_CONFIG`, `window.__mexCurrentUserRecord`, `window.mexUnidades`, `window.firebase`) that every later task's `.ts` file relies on to compile under `strict: true` without redeclaring these globals itself.

- [ ] **Step 1: Install TypeScript**

```bash
npm install --save-dev typescript
```

- [ ] **Step 2: Create `tsconfig.papeletas.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "allowJs": true,
    "checkJs": false,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmitOnError": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": {
      "/*": ["./*"]
    }
  },
  "include": [
    "types/globals.d.ts",
    "domain/papeleta.model.ts",
    "js/app/features/papeletas/papeletas-constants.ts",
    "js/app/features/papeletas/papeletas-data.ts",
    "js/app/features/papeletas/papeletas-storage.ts",
    "js/app/features/papeletas/papeletas-reportes-data.ts",
    "js/app/features/papeletas/papeletas-camera.ts",
    "js/app/features/papeletas/papeletas-diagram.ts",
    "js/app/features/papeletas/papeletas-photo-annotate.ts",
    "js/app/features/papeletas/papeletas-pdf.ts",
    "js/app/features/unidades/unidades-data.ts",
    "js/app/views/papeletas.ts"
  ]
}
```

> Note: `include` uses glob-style matching, not an exact-file list like `files` — it is **not** an error for an entry to match zero files. Right after this task, only `types/globals.d.ts` exists; the other ten paths are picked up automatically as each later task creates them. No further edits to this file are needed for the rest of the migration.

- [ ] **Step 3: Create `types/globals.d.ts`**

```ts
export {};

interface MexConfigListaModelo {
  nombre?: string;
  imagenURL?: string;
  imagen?: string;
  image?: string;
  foto?: string;
}

interface MexConfigListas {
  modelos?: MexConfigListaModelo[];
  gasolinas?: Array<string | { nombre?: string; valor?: string; id?: string }>;
}

interface MexConfigGlobal {
  empresa?: { tipoNegocio?: string; [key: string]: unknown };
  listas?: MexConfigListas;
  profile?: Record<string, unknown>;
  [key: string]: unknown;
}

interface FirebaseAuthUserLike {
  uid?: string;
  email?: string;
  displayName?: string;
}

interface FirebaseAuthGlobal {
  currentUser: FirebaseAuthUserLike | null;
}

interface MexPermsGlobal {
  canDo(permissionKey: string): boolean;
}

interface MexUnidadesGlobal {
  isReady?(): boolean;
  buscar?(query: string, limit: number): unknown[];
}

declare global {
  interface Window {
    firebase: any;
    _auth: FirebaseAuthGlobal;
    _db: any;
    _empresaActual: { tipoNegocio?: string; [key: string]: unknown } | null;
    MEX_CONFIG: MexConfigGlobal;
    __mexCurrentUserRecord: { nombre?: string; [key: string]: unknown } | null;
    mexPerms: MexPermsGlobal;
    mexUnidades?: MexUnidadesGlobal;
    mexAlert(titulo: string, texto: string, tipo?: string): Promise<unknown>;
    mexConfirm(titulo: string, texto: string, tipo?: string): Promise<boolean>;
    mexPrompt(
      titulo: string,
      texto: string,
      placeholder?: string,
      inputTipo?: string,
      valor?: string
    ): Promise<string | null>;
  }
}
```

- [ ] **Step 4: Add scripts to `package.json`**

In the `"scripts"` block, add:

```json
"build:papeletas": "tsc -p tsconfig.papeletas.json",
"watch:papeletas": "tsc -p tsconfig.papeletas.json --watch",
```

Then update these four existing script values (prepend `npm run build:papeletas && ` before the existing `node scripts/bump-sw.js`):

```json
"deploy": "npm run build:papeletas && node scripts/bump-sw.js && firebase deploy --only hosting --project production",
"deploy:full": "npm run build:papeletas && node scripts/bump-sw.js && firebase deploy --project production",
"deploy:staging": "npm run build:papeletas && node scripts/bump-sw.js && firebase deploy --only hosting --project staging",
"deploy:staging:full": "npm run build:papeletas && node scripts/bump-sw.js && firebase deploy --project staging",
```

- [ ] **Step 5: Verify the (still-empty) project compiles**

```bash
npm run build:papeletas
```

Expected: exits 0, no errors (only `types/globals.d.ts` matches `include` so far).

- [ ] **Step 6: Commit**

```bash
git add tsconfig.papeletas.json types/globals.d.ts package.json package-lock.json
git commit -m "chore(papeletas): bootstrap TypeScript tooling for Papeletas module"
git push
```

(No SW bump needed — no runtime `.js` changed yet.)

---

### Task 2: Convert `papeletas-constants.js` (tooling spike)

**Files:**
- Create: `js/app/features/papeletas/papeletas-constants.ts`
- Delete: `js/app/features/papeletas/papeletas-constants.js` (becomes generated output)

**Interfaces:**
- Consumes: nothing new (re-exports from `domain/papeleta.model.js`, still plain `.js` at this point — this task deliberately proves that `allowJs` + the `paths` mapping correctly resolves an absolute `/domain/...` specifier into an *untouched* `.js` file before Task 3 converts it).
- Produces: `STATUS_LABELS: Readonly<Record<string, string>>`, `STATUS_LABELS_SHORT: Readonly<Record<string, string>>`, `REPORTE_STATUS: Readonly<{ ABIERTO: string; DESCARTADO: string; PROMOVIDO: string; CERRADO: string; EXPIRADO: string }>` — same shape as today, consumed unchanged by `papeletas.js`/`papeletas-reportes-data.js`.

This is the pipeline spike: smallest possible file, proves resolution + emit + deploy-script wiring before anything bigger is risked.

- [ ] **Step 1: Write `papeletas-constants.ts`**

```ts
// Re-exports + UI labels for papeletas feature
export {
  STATUS,
  ZONAS_V1,
  CHECKLIST_KEYS,
  CHECKLIST_LABELS,
} from '/domain/papeleta.model.js';

export const STATUS_LABELS = Object.freeze({
  borrador: 'En preparación',
  lista: 'Lista para entregar',
  entregada: 'Entregada',
  en_retorno: 'Ya regresó',
  cerrada_historial: 'Cerrada',
  cancelada: 'Cancelada',
});

/** Etiquetas cortas para chips / mobile */
export const STATUS_LABELS_SHORT = Object.freeze({
  borrador: 'Preparando',
  lista: 'Lista',
  entregada: 'Entregada',
  en_retorno: 'Regresó',
  cerrada_historial: 'Cerrada',
  cancelada: 'Cancelada',
});

export const REPORTE_STATUS = Object.freeze({
  ABIERTO: 'abierto',
  DESCARTADO: 'descartado',
  PROMOVIDO: 'promovido',
  CERRADO: 'cerrado',
  EXPIRADO: 'expirado',
});
```

- [ ] **Step 2: Delete the old `.js` and compile**

```bash
rm js/app/features/papeletas/papeletas-constants.js
npm run build:papeletas
```

Expected: exits 0, and `js/app/features/papeletas/papeletas-constants.js` exists again (regenerated by `tsc`) with the same exports.

**If this fails** with a module-resolution error on the `/domain/papeleta.model.js` specifier (e.g. "Cannot find module"): the `moduleResolution: "Bundler"` + `paths` combination in `tsconfig.papeletas.json` (Task 1) isn't resolving root-relative specifiers the way this hybrid no-bundler setup needs. Fallback: change `"moduleResolution": "Bundler"` to `"moduleResolution": "NodeNext"` and `"module": "ESNext"` to `"module": "NodeNext"` in `tsconfig.papeletas.json`, re-run `npm run build:papeletas`, and if it now compiles, keep `NodeNext` for the rest of the migration (update the "Architecture" note at the top of this plan and the tsconfig comment in Task 1 to match, so later tasks aren't confused by the discrepancy). Do not proceed to Task 3 until one of these two configs compiles cleanly.

- [ ] **Step 3: Confirm the emitted file loads the same as before**

```bash
node --input-type=module --check < js/app/features/papeletas/papeletas-constants.js
```

Expected: no output (valid syntax). Then diff it against `git show HEAD:js/app/features/papeletas/papeletas-constants.js` — the emitted JS should be behaviorally identical (same exports, same values); minor formatting differences from `tsc`'s emitter are fine.

- [ ] **Step 4: Manual smoke test**

Start the local Firebase Hosting emulator (`firebase emulators:start --only hosting`), open `/app/papeletas`, and confirm: the status chip labels on existing papeleta rows still render their Spanish text (not `undefined` or blank), and the browser console shows no new errors on that page.

- [ ] **Step 5: Bump SW, commit, push**

```bash
node scripts/bump-sw.js
git add js/app/features/papeletas/papeletas-constants.ts js/app/features/papeletas/papeletas-constants.js sw.js
git commit -m "refactor(papeletas): convert papeletas-constants to TypeScript (tooling spike)"
git push
```

---

### Task 3: Convert `domain/papeleta.model.js`

**Files:**
- Create: `domain/papeleta.model.ts`
- Delete: `domain/papeleta.model.js`

**Interfaces:**
- Produces (used by every later task): `PapeletaStatus`, `ChecklistValue`, `ZonaEstadoValue`, `DamageType`, `DamageSeverity`, `DiagramView`, `ZonaDef`, `ZonaRecord`, `ZonasMap`, `MarcasLlantas`, `Tapetes`, `DamageMark`, `FirmaMeta`, `PapeletaSalida`, `Papeleta`, `DeliveryGateResult`, `EventStampOpts`, `EventStamp` — plus every existing exported function, now with the signatures below.

- [ ] **Step 1: Add the new type declarations to the top of the file** (right after the file-header comment, before `export const STATUS`)

```ts
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
```

- [ ] **Step 2: Apply these signatures to the existing functions** (bodies unchanged from the current `.js` — only the signature line changes on each):

```ts
export function formatLocalStamp(when: Date | number | string = new Date(), timeZone: string = ''): string
export function buildEventStamp(opts: EventStampOpts = {}): EventStamp
export function buildCreateProvenance({ user, plazaId, now, timeZone }: EventStampOpts = {}): {
  plazaId: string; plazaOrigenId: string; ultimaPlazaId: string;
  creadoPor: string; creadoPorNombre: string; creadoAtLocal: string;
}
export function buildTouchProvenance({ user, plazaId, now, timeZone, action }: EventStampOpts = {}): Record<string, string>
export function orderInboxGlobal(rows: Papeleta[] = [], opts: { preferPlazaId?: string } = {}): Papeleta[]
export function hasClienteOrContrato(papeleta: Papeleta = {}): boolean
export function canAssignCliente(status: PapeletaStatus | string): boolean
export function canAssignContrato(status: PapeletaStatus | string): boolean
export function createEmptyMarcasLlantas(): MarcasLlantas
export function normalizeMarcasLlantas(p: Papeleta = {}): MarcasLlantas
export function createEmptyTapetes(): Tapetes
export function isValidTapeteDigit(v: unknown): boolean
export function normalizeTapetes(p: Papeleta = {}): Tapetes
export function createEmptyChecklist(): Record<string, ChecklistValue>
export function createEmptyZonas(): ZonasMap
export function allZonasHaveFoto(zonas: ZonasMap = {}): boolean
export function resolveZonaFotoPath(zonas: ZonasMap = {}, zonaId: string, papeleta: Papeleta | null = null): string
export function coreZonasHaveFoto(zonas: ZonasMap = {}, opts: { papeleta?: Papeleta } = {}): boolean
export function tableroHaveFoto(papeleta: Papeleta | null = null, zonas: ZonasMap | null = null): boolean
export function checklistCompleto(checklist: Record<string, ChecklistValue | undefined> = {}): boolean
export function isChecklistComplete(papeleta: Papeleta = {}): boolean
export function hasFaltantes(checklist: Record<string, ChecklistValue | undefined> = {}): boolean
export function isValidKm(km: unknown): boolean
export function isGasSet(gas: unknown): boolean
export function isValidFirma(firma: FirmaMeta | null | undefined): boolean
export function puedeEditar(status: PapeletaStatus | string): boolean
export function isSalidaMutable(status: PapeletaStatus | string): boolean
export function isSalidaLocked(status: PapeletaStatus | string): boolean
export function assertSalidaMutable(status: PapeletaStatus | string): void
export function mutationPolicy(status: PapeletaStatus | string): {
  salida: boolean; cliente: boolean; contrato: boolean; regreso: boolean; cancelar: boolean;
}
export function clampNorm(n: unknown): number
export function nextDisplayNumber(danosMarcados: DamageMark[] = [], lastAssigned: number = 0): number
export function createDamageMark(opts: {
  id?: string; view?: string; x: number; y: number; damageType?: DamageType; severity?: DamageSeverity;
  note?: string; photoIds?: string[]; source?: 'salida' | 'entrada'; nextDisplayNumber?: number;
}): DamageMark
export function requiresKmJustification(papeleta: Papeleta = {}): boolean
export function kmTableroRetakeNeeded(papeleta: Papeleta | undefined, newKm: unknown): boolean
export function damagesMissingPhoto(danos: DamageMark[] = []): boolean
export function optionalPhotosPending(zonas: ZonasMap = {}): boolean
export function largeDamagesWithoutVentasReport(papeleta: Papeleta = {}): boolean
export function puedeEntregar(
  papeletaOrStatus: Papeleta | PapeletaStatus | string,
  optsOrZonas: { firma?: FirmaMeta | null; pendingWrites?: boolean; kmJustification?: string } | ZonasMap = {},
  checklistMaybe?: Record<string, ChecklistValue | undefined>
): DeliveryGateResult | boolean
export function computeStatusAfterSave(args: {
  status?: PapeletaStatus; zonas?: ZonasMap; checklist?: Record<string, ChecklistValue | undefined>; papeleta?: Papeleta;
} = {}): PapeletaStatus
export function buildEntradaDamageComparison(salidaMarks: DamageMark[] = [], entradaMarks: DamageMark[] = []): DamageMark[]
export function danoYaDocumentadoEnSalida(zonaId: string, zonasSalida: ZonasMap = {}): boolean
export function rolPuedeCerrarCaso(rol: string): boolean
export function rolPuedeGestionarVentas(rol: string): boolean
export function truncNota(nota: unknown, max?: number): string
```

The `Object.freeze` consts (`STATUS`, `PAPELETA_SCOPE`, `ZONAS_V1`, `ZONAS_EXTRA`, `ZONAS_ALL`, `ZONAS_CORE`, `ZONA_CORE_LABELS`, `ZONA_TABLERO_ID`, `CHECKLIST_KEYS`, `CHECKLIST_LABELS`, `LLANTA_KEYS`, `LLANTA_LABELS`, `DAMAGE_TYPES`, `DAMAGE_SEVERITIES`, `DAMAGE_TYPE_LABELS`, `DAMAGE_SEVERITY_LABELS`, `DAMAGE_PHOTO_POLICY`, `DIAGRAM_VIEWS`) need no signature changes — TS infers their literal shapes automatically from the object literals, unchanged from today.

- [ ] **Step 3: Delete the old `.js` and compile**

```bash
rm domain/papeleta.model.js
npm run build:papeletas
```

Expected: `tsc` reports errors in `papeletas-constants.ts` (Task 2's file) if its re-export shape mismatches, and no other errors yet (nothing else in scope imports this file until later tasks). Fix any mismatch by adjusting the new interfaces above — do not change `papeletas-constants.ts`.

- [ ] **Step 4: Verify output identity**

```bash
node --input-type=module --check < domain/papeleta.model.js
```

Expected: no output. Then re-run Task 2's manual smoke (status chips on `/app/papeletas`) — this file backs `STATUS`/`ZONAS_V1`/`CHECKLIST_KEYS`/`CHECKLIST_LABELS` re-exported by `papeletas-constants.js`, so nothing there should visibly change.

- [ ] **Step 5: Bump SW, commit, push**

```bash
node scripts/bump-sw.js
git add domain/papeleta.model.ts domain/papeleta.model.js sw.js
git commit -m "refactor(papeletas): convert domain/papeleta.model to TypeScript"
git push
```

---

### Task 4: Convert `js/app/features/unidades/unidades-data.js`

**Files:**
- Create: `js/app/features/unidades/unidades-data.ts`
- Delete: `js/app/features/unidades/unidades-data.js`

**Interfaces:**
- Consumes: nothing from this module's other files (independent leaf).
- Produces: `Unidad` interface, and the functions below — consumed by `papeletas.js` (Task 12) via `buscarUnidad`.

- [ ] **Step 1: Add near the top of the file (after the imports)**

```ts
export interface Unidad {
  id: string;
  mva?: string;
  numeroEconomico?: string;
  economico?: string;
  placas?: string;
  vin?: string;
  modelo?: string;
  color?: string;
  estado?: string;
  plazaId?: string;
  plazaActual?: string;
  sucursal?: string;
  plaza?: string;
  ubicacionActual?: string;
  [key: string]: unknown;
}

export interface ImportarResultado {
  total: number;
  importados: number;
  errores: Array<{ fila: number; errores: unknown }>;
}

export interface ImportarArchivoResultado {
  ok: boolean;
  errorTipo?: string;
  mensaje?: string;
  total: number;
  importados: number;
  errores: unknown[];
}
```

- [ ] **Step 2: Apply these signatures** (bodies unchanged):

```ts
export function onUnidades(callback: (unidades: Unidad[]) => void): () => void
export async function getUnidades(): Promise<Unidad[]>
export async function crearUnidad(unitData: Partial<Unidad>): Promise<string>
export async function actualizarUnidad(unitId: string, fields: Partial<Unidad>): Promise<void>
export async function eliminarUnidad(unitId: string): Promise<void>
export async function getUnidadesCached(force: boolean = false): Promise<Unidad[]>
export async function getIndexUnidadesCached(force: boolean = false): Promise<Unidad[]>
export function invalidateUnidadesCache(): void
export async function buscarUnidad(query: string, opts: { limit?: number; plazaId?: string } = {}): Promise<Unidad[]>
export function generarTemplateCsv(tipoNegocio: string): string
export async function importarCsv(csvText: string, tipoNegocio: string): Promise<ImportarResultado>
export async function importarDesdeArchivo(file: File, tipoNegocio: string): Promise<ImportarArchivoResultado>
```

Internal (non-exported) helpers — `_fv`, `_unidadesRef`, `_normKey`, `_unitPlazaKeys`, `_unitMatchesPlaza`, `_stripBom`, `_parseCsvLine`, `_normalizeColName` — keep as-is; annotate parameter/return types only if `tsc --strict` actually flags them (most will infer cleanly from usage).

- [ ] **Step 3: Delete the old `.js` and compile**

```bash
rm js/app/features/unidades/unidades-data.js
npm run build:papeletas
```

Expected: exits 0.

- [ ] **Step 4: Manual smoke test**

Open `/app/papeletas/nueva`, type an económico/placas that exists in the catalog, confirm results still appear in the search grid and clicking one still opens the "Confirmar unidad" hero screen (this exercises `buscarUnidad` end-to-end).

- [ ] **Step 5: Bump SW, commit, push**

```bash
node scripts/bump-sw.js
git add js/app/features/unidades/unidades-data.ts js/app/features/unidades/unidades-data.js sw.js
git commit -m "refactor(papeletas): convert unidades-data to TypeScript"
git push
```

---

### Task 5: Convert `papeletas-storage.js`

**Files:**
- Create: `js/app/features/papeletas/papeletas-storage.ts`
- Delete: `js/app/features/papeletas/papeletas-storage.js`

**Interfaces:**
- Consumes: `storage` from `/js/core/database.js` (untouched `.js`, typed `any`), `uploadMedia`/`resolveMediaUrl`/`destroyMedia`/`normalizeMediaRef` from `/js/core/media-upload.js` (untouched `.js`, typed `any`).
- Produces (consumed by `papeletas-data.ts` Task 6 and `papeletas.ts` Task 12):

```ts
export async function compressImageFile(file: File | Blob, maxBytes: number = 800_000): Promise<Blob | File>
export async function uploadBytesAtPath(path: string, blob: Blob, contentType: string = 'image/jpeg'): Promise<string>
export async function uploadZonaFoto(papeletaId: string, zonaId: string, file: File | Blob): Promise<string>
export async function uploadZonaDetalle(papeletaId: string, zonaId: string, file: File | Blob): Promise<string>
export async function uploadZonaOverlay(papeletaId: string, zonaId: string, blob: Blob): Promise<string>
export async function uploadDamageFoto(papeletaId: string, damageId: string, file: File | Blob): Promise<string>
export async function uploadFirma(papeletaId: string, blob: Blob): Promise<string>
export async function uploadReporteFoto(reporteId: string, name: string, file: File | Blob): Promise<string>
export async function copyStoragePath(fromPath: string, toPath: string): Promise<string>
export async function deleteStoragePath(path: string): Promise<void>
export async function getDownloadUrl(path: string): Promise<string>
```

- [ ] **Step 1:** Apply the signatures above to the existing functions (bodies unchanged). The internal `_uploadToCloudinary(folder, blob, publicId, resourceType = 'image')` helper already has a JSDoc `@returns` tag — give it the matching TS return type `Promise<{ url: string; publicId: string; provider: string }>` and keep `folder: string, blob: Blob, publicId: string, resourceType: string = 'image'` as its parameter types. `_storageRef(path: string): any` (untyped `storage.ref()` return from the compat SDK — fine as `any` at this boundary).

- [ ] **Step 2: Delete the old `.js` and compile**

```bash
rm js/app/features/papeletas/papeletas-storage.js
npm run build:papeletas
```

Expected: exits 0.

- [ ] **Step 3: Manual smoke test**

Open an existing papeleta with at least one zone photo already uploaded, confirm the thumbnail still loads (exercises `getDownloadUrl`). Then, if capturing is available in your test environment, take one new zone photo and confirm it uploads and previews (exercises `uploadZonaFoto` + `compressImageFile`).

- [ ] **Step 4: Bump SW, commit, push**

```bash
node scripts/bump-sw.js
git add js/app/features/papeletas/papeletas-storage.ts js/app/features/papeletas/papeletas-storage.js sw.js
git commit -m "refactor(papeletas): convert papeletas-storage to TypeScript"
git push
```

---

### Task 6: Convert `papeletas-data.js`

**Files:**
- Create: `js/app/features/papeletas/papeletas-data.ts`
- Delete: `js/app/features/papeletas/papeletas-data.js`

**Interfaces:**
- Consumes: `Papeleta`, `PapeletaStatus`, `STATUS`, `createEmptyChecklist`, `createEmptyZonas`, `createEmptyMarcasLlantas`, `computeStatusAfterSave`, `puedeEditar`, `puedeEntregar`, `isSalidaMutable`, `canAssignCliente`, `canAssignContrato`, `buildCreateProvenance`, `buildTouchProvenance`, `orderInboxGlobal` from `domain/papeleta.model.ts` (Task 3); `Unidad` from `js/app/features/unidades/unidades-data.ts` (Task 4 — already converted by the time this task runs); `db`, `COL`, `ejecutarEliminacion` from `/js/core/database.js` (untouched, `any`); `reportProgrammerError` from `/js/core/observability.js` (untouched, `any`).
- Produces:

```ts
export interface UserMeta {
  uid: string;
  nombre: string;
}

export interface SideEffectsOpts {
  user?: UserMeta;
  plazaId?: string;
  km?: number | string;
}

export function ubicacionRentaLabel(tipoNegocio?: string): string
export async function applyEntregaSideEffects(papeleta: Papeleta, opts?: SideEffectsOpts): Promise<void>
export async function retryEntregaSideEffects(id: string, opts?: SideEffectsOpts): Promise<void>
export function subscribePapeletasPlaza(opts: {
  plazaId?: string; preferPlazaId?: string;
  onData?: (rows: Papeleta[]) => void; onError?: (err: unknown) => void;
}): () => void
export function subscribePapeletasEmpresa(opts: {
  preferPlazaId?: string; onData?: (rows: Papeleta[]) => void; onError?: (err: unknown) => void;
}): () => void
export function subscribePapeleta(id: string, opts: {
  onData: (doc: Papeleta | null) => void; onError?: (err: unknown) => void;
}): () => void
export async function getPapeleta(id: string): Promise<Papeleta | null>
export async function getPapeletaActivaByUnidad(unidadId: string): Promise<Papeleta | null>
export async function releasePapeletaActivaLock(unidadId: string): Promise<void>
export async function crearPapeleta(args: {
  unidad: Partial<Unidad>; plazaId?: string; user?: UserMeta;
}): Promise<{ id: string }>
export async function actualizarPapeleta(
  id: string,
  patch: Partial<Papeleta>,
  opts?: { user?: UserMeta; knownRevision?: number; plazaId?: string }
): Promise<void>
export async function asignarCliente(id: string, clienteNombre: string, opts?: { user?: UserMeta; plazaId?: string }): Promise<void>
export async function asignarContrato(id: string, contrato: string, opts?: { user?: UserMeta; plazaId?: string }): Promise<void>
export async function finalizeDelivery(id: string, opts: Record<string, unknown>): Promise<void>
export async function entregarPapeleta(id: string, opts: Record<string, unknown>): Promise<void>
export async function cancelarPapeleta(id: string, opts?: { user?: UserMeta; motivo?: string }): Promise<void>
export async function registrarEntrada(id: string, opts: Record<string, unknown>): Promise<void>
export async function cerrarPapeletaHistorial(id: string, opts?: { user?: UserMeta }): Promise<void>
```

> `finalizeDelivery`, `entregarPapeleta`, and `registrarEntrada` take a destructured options object with many fields (visible in the current `.js` source at lines 529, 650, 700) — read the current signatures directly from the file before typing these three; don't guess the field list from this plan alone. Use `Record<string, unknown>` only as the outer parameter type if the destructured fields vary in type; prefer a named inline interface listing every destructured key with its real type once you have the file open, matching the precision used for the other functions above.

- [ ] **Step 1:** Add the types above, apply signatures to every exported function, keep bodies unchanged.

- [ ] **Step 2: Delete the old `.js` and compile**

```bash
rm js/app/features/papeletas/papeletas-data.js
npm run build:papeletas
```

Expected: exits 0. This is the first file that imports both `domain/papeleta.model.ts` (Task 3) and touches Firestore directly — if `strict` flags null-safety issues on `papeleta.salida?.km` style chains, add the missing `?.` rather than loosening the `Papeleta` interface.

- [ ] **Step 3: Manual smoke test**

Full create → autosave → deliver cycle on a test unit in a non-production plaza if available: create a papeleta from `/app/papeletas/nueva`, confirm the list subscription (`subscribePapeletasPlaza`) still shows it, edit KM/gas (exercises `actualizarPapeleta`), and cancel it at the end (exercises `cancelarPapeleta`) so no test data lingers.

- [ ] **Step 4: Bump SW, commit, push**

```bash
node scripts/bump-sw.js
git add js/app/features/papeletas/papeletas-data.ts js/app/features/papeletas/papeletas-data.js sw.js
git commit -m "refactor(papeletas): convert papeletas-data to TypeScript"
git push
```

---

### Task 7: Convert `papeletas-reportes-data.js`

**Files:**
- Create: `js/app/features/papeletas/papeletas-reportes-data.ts`
- Delete: `js/app/features/papeletas/papeletas-reportes-data.js`

**Interfaces:**
- Consumes: `db`, `COL` from `/js/core/database.js` (untouched, `any`); `window.mexPerms`, `window._auth` (from `types/globals.d.ts`, Task 1).
- Produces (consumed by `papeletas.js` Task 12 and `js/app/views/reportes-danos.js`, which stays plain `.js` and keeps working unchanged since the compiled output path doesn't move):

```ts
export interface ReporteDano {
  id: string;
  papeletaId: string;
  unidadId?: string;
  mva?: string;
  tipo: string;
  status: 'abierto' | 'descartado' | 'promovido' | 'cerrado' | 'expirado';
  [key: string]: unknown;
}

export function subscribeReportesAbiertos(opts: {
  onData: (rows: ReporteDano[]) => void; onError?: (err: unknown) => void;
}): () => void
export function subscribeReportes(opts: {
  status?: string | null; plazaId?: string;
  onData: (rows: ReporteDano[]) => void; onError?: (err: unknown) => void;
}): () => void
export async function getReporte(id: string): Promise<ReporteDano | null>
export async function countReportesAbiertosUnidad(unidadId: string): Promise<number>
export function newReporteId(): string
export async function crearReporte(args: Record<string, unknown>): Promise<{ id: string }>
export async function promoverReporte(reporteId: string): Promise<void>
export async function cerrarCaso(reporteId: string, opts?: { rol?: string; user?: { uid?: string; nombre?: string } }): Promise<void>
```

> As with Task 6, read `crearReporte`'s current destructured-args signature (line 98) directly from the file and give it a precise named interface instead of `Record<string, unknown>` once you have it open — the `Record<string, unknown>` above is a floor, not the final type.

- [ ] **Step 1:** Add the `ReporteDano` interface, apply the signatures, keep bodies unchanged.

- [ ] **Step 2: Delete the old `.js` and compile**

```bash
rm js/app/features/papeletas/papeletas-reportes-data.js
npm run build:papeletas
```

Expected: exits 0.

- [ ] **Step 3: Manual smoke test**

Open `/app/reportes-danos` (stays plain `.js`, imports this module) and confirm the open-reports list still loads with no console errors — this is the cross-module check that compiling to the same output path really didn't require touching the consumer.

- [ ] **Step 4: Bump SW, commit, push**

```bash
node scripts/bump-sw.js
git add js/app/features/papeletas/papeletas-reportes-data.ts js/app/features/papeletas/papeletas-reportes-data.js sw.js
git commit -m "refactor(papeletas): convert papeletas-reportes-data to TypeScript"
git push
```

---

### Task 8: Convert `papeletas-camera.js`

**Files:**
- Create: `js/app/features/papeletas/papeletas-camera.ts`
- Delete: `js/app/features/papeletas/papeletas-camera.js`

**Interfaces:**
- Produces:

```ts
export interface GuidedCameraZone {
  id: string;
  label: string;
}

export interface GuidedCameraOpts {
  zones: GuidedCameraZone[];
  onComplete?: (results: unknown) => void;
  onDamageExtra?: () => void;
  [key: string]: unknown;
}

export function openGuidedCamera(opts: GuidedCameraOpts): unknown
```

This file is DOM/`<video>`/`MediaStream`-heavy UI code. Read it in full before converting — the signature above is the module's only export; the bulk of the work is annotating the internal helper functions and DOM element references (`HTMLVideoElement`, `HTMLCanvasElement`, etc.) as `tsc` flags them. Prefer the real DOM types (`HTMLVideoElement`, `MediaStream`, `File`) over `any` wherever the current code already implies them (e.g. anything assigned from `document.createElement('video')` or `navigator.mediaDevices.getUserMedia(...)`); fall back to explicit `any` only for values whose shape genuinely isn't knowable from this file alone (e.g. opaque callback payloads defined by the caller in `papeletas.js`).

- [ ] **Step 1:** Read the current file fully, add the types above, annotate function signatures.
- [ ] **Step 2:** `rm js/app/features/papeletas/papeletas-camera.js && npm run build:papeletas` — expected exit 0.
- [ ] **Step 3:** Manual smoke: open a papeleta in edit mode, open the guided camera flow for at least one zone, confirm the landscape UI and shutter still work and a captured photo still uploads.
- [ ] **Step 4:**

```bash
node scripts/bump-sw.js
git add js/app/features/papeletas/papeletas-camera.ts js/app/features/papeletas/papeletas-camera.js sw.js
git commit -m "refactor(papeletas): convert papeletas-camera to TypeScript"
git push
```

---

### Task 9: Convert `papeletas-diagram.js`

**Files:**
- Create: `js/app/features/papeletas/papeletas-diagram.ts`
- Delete: `js/app/features/papeletas/papeletas-diagram.js`

**Interfaces:**
- Consumes: `DamageMark`, `DiagramView` from `domain/papeleta.model.ts` (Task 3).
- Produces:

```ts
export const DIAGRAM_IMAGE_URL: string
export const DIAGRAM_IMAGE_SOURCE: string
export const DIAGRAM_IMAGE_LEGACY_HOJA_URL: string
export const DIAGRAM_IMAGE_WIDE_URL: string
export const DIAGRAM_LEGEND: readonly unknown[]

export function diagramSvgMarkup(): string

export interface DiagramApi {
  destroy(): void;
  getStrokes(): unknown[];
  setStrokes?(strokes: unknown[]): void;
  getDamages?(): DamageMark[];
  setDamages?(damages: DamageMark[]): void;
  resize?(): void;
}

export interface DiagramOpts {
  strokes?: unknown[];
  danosMarcados?: DamageMark[];
  editable?: boolean;
  view?: DiagramView | string;
  fullscreen?: boolean;
  title?: string;
  showLegend?: boolean;
  showMarksList?: boolean;
  onChange?: (strokes: unknown[]) => void;
  onTap?: (payload: { x: number; y: number; view: string }) => void;
  zonePreview?: (zonaId: string) => { label: string; url: string };
  onZoneHover?: (zonaId: string | null) => void;
}

export function mountDiagram(host: HTMLElement, opts?: DiagramOpts): DiagramApi | null
export function strokesToDataUrl(strokes?: unknown[], opts?: Record<string, unknown>): string
export function strokesToDataUrlAsync(strokes?: unknown[], opts?: Record<string, unknown>): Promise<string>
```

The `mountDiagram` call sites in `papeletas.js` (`_mountDiagramIfNeeded`, `_mountReadonlyDiagrams`) already show most of `DiagramOpts`' real shape — cross-check against those call sites (visible in `js/app/views/papeletas.js` around the `_diagramApi`/`_readonlyDiagramApis` state) while typing this file, since `papeletas.js` isn't converted until Task 12 and its usage must satisfy whatever `DiagramOpts`/`DiagramApi` you land on here.

- [ ] **Step 1:** Read the current file fully, add the types above, annotate function signatures (canvas/SVG DOM code — prefer `HTMLCanvasElement`, `CanvasRenderingContext2D`, `SVGElement`, `PointerEvent` over `any` where the code already implies them).
- [ ] **Step 2:** `rm js/app/features/papeletas/papeletas-diagram.js && npm run build:papeletas` — expected exit 0.
- [ ] **Step 3:** Manual smoke: open a papeleta's Daños step, confirm pan/zoom, pencil marks, and the readonly resumen/salida preview diagrams still render correctly.
- [ ] **Step 4:**

```bash
node scripts/bump-sw.js
git add js/app/features/papeletas/papeletas-diagram.ts js/app/features/papeletas/papeletas-diagram.js sw.js
git commit -m "refactor(papeletas): convert papeletas-diagram to TypeScript"
git push
```

---

### Task 10: Convert `papeletas-photo-annotate.js`

**Files:**
- Create: `js/app/features/papeletas/papeletas-photo-annotate.ts`
- Delete: `js/app/features/papeletas/papeletas-photo-annotate.js`

**Interfaces:**
- Produces:

```ts
export interface PhotoAnnotatorOpts {
  photoUrl: string;
  photoPath?: string;
  onSave?: (result: { overlayPath?: string; strokes?: unknown[]; marks?: unknown[] }) => void;
  [key: string]: unknown;
}

export function openPhotoAnnotator(opts?: PhotoAnnotatorOpts): unknown
```

- [ ] **Step 1:** Read the current file fully, add the type above, annotate internal function signatures (canvas overlay editor over a bitmap — same DOM-type preference as Task 9).
- [ ] **Step 2:** `rm js/app/features/papeletas/papeletas-photo-annotate.js && npm run build:papeletas` — expected exit 0.
- [ ] **Step 3:** Manual smoke: open a zone photo preview, tap "Editar", confirm the fullscreen annotator opens, a pencil stroke can be drawn, and Save persists it.
- [ ] **Step 4:**

```bash
node scripts/bump-sw.js
git add js/app/features/papeletas/papeletas-photo-annotate.ts js/app/features/papeletas/papeletas-photo-annotate.js sw.js
git commit -m "refactor(papeletas): convert papeletas-photo-annotate to TypeScript"
git push
```

---

### Task 11: Convert `papeletas-pdf.js`

**Files:**
- Create: `js/app/features/papeletas/papeletas-pdf.ts`
- Delete: `js/app/features/papeletas/papeletas-pdf.js`

**Interfaces:**
- Consumes: `Papeleta` from `domain/papeleta.model.ts` (Task 3).
- Produces:

```ts
export interface ExportMatrix {
  headers: string[];
  body: unknown[][];
  title: string;
  count: number;
}

export function papeletaExportMatrix(papeleta: Papeleta): ExportMatrix
export function exportPapeletaXls(papeleta: Papeleta): void
export function exportPapeletaCsv(papeleta: Papeleta): void
export async function openPapeletaPdf(
  papeleta: Papeleta,
  opts?: { firmaUrl?: string; fotoUrls?: Record<string, string> | null; docId?: string }
): Promise<void>
```

- [ ] **Step 1:** Read the current file fully, add the types above, annotate internal helpers (this is the file that calls `generarYAbrirPdf` against the Cloud Function — keep that call's existing error handling untouched, do not attempt to fix the 500 seen in production as part of this task).
- [ ] **Step 2:** `rm js/app/features/papeletas/papeletas-pdf.js && npm run build:papeletas` — expected exit 0.
- [ ] **Step 3:** Manual smoke: trigger PDF export on a papeleta with at least one photo, confirm the export chooser still opens and CSV/XLS export (which don't depend on the Cloud Function) still download correctly. PDF export itself may still fail with the pre-existing 500 — that's expected and out of scope here.
- [ ] **Step 4:**

```bash
node scripts/bump-sw.js
git add js/app/features/papeletas/papeletas-pdf.ts js/app/features/papeletas/papeletas-pdf.js sw.js
git commit -m "refactor(papeletas): convert papeletas-pdf to TypeScript"
git push
```

---

### Task 12: Convert `js/app/views/papeletas.js`

**Files:**
- Create: `js/app/views/papeletas.ts`
- Delete: `js/app/views/papeletas.js`

**Interfaces:**
- Consumes: every interface produced by Tasks 3–11 (`Papeleta`, `PapeletaStatus`, `DamageMark`, `Unidad`, `ReporteDano`, `DiagramApi`, etc.) plus `getState`/`getCurrentPlaza` from `/js/app/app-state.js` (untouched, `any`), `hasAppPermission` from `/js/app/features/admin/admin-permissions.js` (untouched, `any`), `buildExportFilename` from `/js/core/export-signing.js` (untouched, `any`), `openExportChooser`/`exportMatrixCsv`/`exportMatrixXls`/`exportMatrixPdf` from `/js/core/export-menu.js` (untouched, `any`), `bindHistMovePopover`/`unbindHistMovePopover` from `/js/core/hist-move-popover.js` (untouched, `any`).
- Produces: `mount(ctx: { container: HTMLElement; navigate?: (path: string, opts?: { replace?: boolean }) => void; state?: Record<string, unknown> }): Promise<void>`, `unmount(): void` — the router-facing contract, unchanged from today.

This is the largest file in scope (3600+ lines) and the last one converted, so every function it calls into is already typed. Convert it incrementally rather than in one pass:

- [ ] **Step 1: Add module-level state type annotations first**

At the top of the file, type every module-level `let`, e.g.:

```ts
let _container: HTMLElement | null = null;
let _navigate: ((path: string, opts?: { replace?: boolean }) => void) | null = null;
let _items: Papeleta[] = [];
let _reportes: ReporteDano[] = [];
let _detail: Papeleta | null = null;
let _pendingUnit: Unidad | null = null;
let _unitHits: Unidad[] = [];
// ...and so on for every remaining `let` in the current file (_mode, _filter, _query, _wizardStep, etc.) — each gets the type implied by its usage (string literal unions where the code already checks against a fixed set of values, e.g. _mode: 'list' | 'detail' | 'ventas' | 'nueva').
```

- [ ] **Step 2: Run `tsc` in watch mode and fix errors function-by-function**

```bash
npm run watch:papeletas
```

Leave this running in a terminal. In a second terminal (or editor), go through the file top to bottom adding parameter/return types to each function so the errors reported by the watcher clear, in this order (matches the file's own section order): helpers (`_modelImageUrl`, `_screenForSec`, `_gotoMobileScreen`, `_gasCatalog`, etc.) → render functions (`_render`, `_renderList`, `_renderDetail`, `_renderNuevaScreen`, etc.) → data-loading/mutation functions (`_watchDetail`, `_saveStepDatos`, `_confirmHeroUnit`, etc.) → `_bind()` and event handlers → `mount`/`unmount`. Do not change any logic — if a type error reveals what looks like an actual bug (e.g. a genuinely possible `null` not being checked), stop and flag it rather than silently "fixing" behavior as part of this task; log it as a candidate for the separate runtime-bugs follow-up instead.

- [ ] **Step 3: If the file becomes unwieldy to review as a single diff, split it**

The original feature plan (`docs/superpowers/plans/2026-07-22-papeletas-v3-hibrido.md`) already flagged this file as a candidate to "split later if >4k [lines]". If typing this file pushes it over that size or the diff is too large to review as one task, split along the file's existing natural sections (e.g. extract the wizard/capture-flow rendering into `js/app/views/papeletas-capture.ts` imported by `papeletas.ts`) — this is allowed within this task, not a scope violation, since the router only ever imports `js/app/views/papeletas.js` and internal file structure underneath that entry point is free to change.

- [ ] **Step 4: Full compile**

```bash
npm run build:papeletas
```

Expected: exits 0 with zero errors across all 11 files.

- [ ] **Step 5: Full manual smoke test**

Walk the entire Papeletas flow once: list view (search/filter), `/app/papeletas/nueva` (search a unit, confirm hero, create), the 6-step capture wizard (datos → km/gas → checklist → daños → fotos/firma), delivery + signature, then open an already-`entregada` papeleta and confirm the read-only detail view still renders. Confirm no new console errors anywhere in this walkthrough compared to before this migration.

- [ ] **Step 6: Bump SW, commit, push**

```bash
node scripts/bump-sw.js
git add js/app/views/papeletas.ts js/app/views/papeletas.js sw.js
git commit -m "refactor(papeletas): convert papeletas.js view to TypeScript"
git push
```

---

## Self-check

- [x] Every file from the spec's scope table has a task (Tasks 2–12; Task 1 is tooling-only).
- [x] Every task ends with build → smoke → SW bump → commit → push, matching this repo's task-closeout rule.
- [x] Interfaces defined in Task 3 (`Papeleta`, `DamageMark`, etc.) are the exact types referenced by name in Tasks 4–12 — no renamed fields between tasks.
- [x] The three open runtime bugs are explicitly called out as out-of-scope in the Global Constraints and again in Task 11 where PDF export is touched.
- [x] No task changes any file outside the 11 in scope.
