# Papeletas digitales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship beta digital delivery/return tickets (papeletas) in the SPA at `/app/papeletas`: wizard salida → firma + PDF → entrada → reportes Ventas.

**Architecture:** Pure domain model (`domain/papeleta.model.js`) + Firestore/Storage feature modules under `js/app/features/papeletas/` + single SPA view `js/app/views/papeletas.js` (list / detail wizard / ventas). PDF via print-window (same pattern as turnos) with `export-signing.js`. Uniqueness enforced client-side query + rules-friendly fields (`activoPorUnidad`).

**Tech Stack:** Vanilla ES modules, Firebase compat (`database.js`), Firestore + Storage, Cloud Functions v1 scheduled cleanup, Inter + Material Symbols per ESTILO.md.

**Spec:** `docs/superpowers/specs/2026-07-20-papeletas-digitales-design.md`

**Worktree:** `.worktrees/papeletas-digitales` · **Branch:** `feature/papeletas-digitales`

## Global Constraints

- Routes: `/app/papeletas`, `/app/papeletas/:id`, `/app/papeletas/ventas` (shell-integrated SPA only).
- ESTILO.md: Inter only; Material Symbols icons; accent `#3b82f6`; spacing multiples of 4px; radii `4/8/12/16/9999`; prefer CSS variables (`var(--bg)`, `var(--surface)`, `var(--text)`, `var(--border)`, accent tokens).
- PDF: signature **inside** document (“Exportado por …”) via `exportFooterHtml` / `getExportIdentity`; download name via `buildExportFilename('pdf')` → `USUARIO_FECHA_EMPRESA.pdf`.
- Feature gate key: `papeletas`. Permissions: `view_papeletas`, `manage_papeletas_ventas`. Close caso: role **> VENTAS** (SUPERVISOR+). Full-access roles bypass.
- No bundler; ES module imports from `/js/...` and `/domain/...`.
- Uniqueness: ≤1 doc with `activoPorUnidad === true` per `unidadId`.
- Zones template `zonasTemplateVersion: 1` — exactly 12 zones from spec §6; checklist keys from §7.
- Status enum: `borrador` | `lista` | `entregada` | `en_retorno` | `cerrada_historial`.
- Editable only when status ∈ `{borrador, lista}`; post-`entregada` salida/zonas/checklist immutable.
- Photos: JPEG compressed, target ≤ ~800KB; all zones require `fotoPath` before `lista`/`entregada`.
- Reportes Storage TTL: `expiresAt = creadoAt + 24h` until promovido; CF job deletes expired.
- Commits on `feature/papeletas-digitales` in the worktree. Bump SW once at Task 12. Do **not** push unless user chooses finishing option.
- Dialogs: `mexAlert` / `mexConfirm` / `mexPrompt` — never native `alert`/`confirm`.

## File map

| Path | Responsibility |
|------|----------------|
| `domain/papeleta.model.js` | Pure: zones, checklist, status helpers, discard logic |
| `js/app/features/papeletas/papeletas-constants.js` | Re-exports / UI labels |
| `js/app/features/papeletas/papeletas-data.js` | Firestore CRUD, listeners, uniqueness |
| `js/app/features/papeletas/papeletas-storage.js` | Compress + upload zona/firma/reporte fotos |
| `js/app/features/papeletas/papeletas-pdf.js` | Print-window client PDF |
| `js/app/features/papeletas/papeletas-reportes-data.js` | Reportes CRUD + promote + close |
| `js/app/views/papeletas.js` | mount/unmount SPA UI |
| `css/app-papeletas.css` | View styles |
| `scripts/test-papeleta-model.js` | Node assert suite for domain |
| `js/core/database.js` | `COL.PAPELETAS`, `COL.PAPELETAS_REPORTES` |
| `domain/permissions.model.js` + `js/core/feature-gates.js` | New perm keys defaults |
| `js/app/router.js` + `route-resolver.js` + `navigation.config.js` | Wiring |
| `firestore.rules` + `storage.rules` + `firestore.indexes.json` | Security + indexes |
| `functions/index.js` | `limpiarFotosReportesPapeletas` |

---

### Task 1: Domain model + node tests

**Files:**
- Create: `domain/papeleta.model.js`
- Create: `scripts/test-papeleta-model.js`

**Interfaces:**
- Produces: `ZONAS_V1`, `CHECKLIST_KEYS`, `STATUS`, `createEmptyChecklist()`, `createEmptyZonas()`, `allZonasHaveFoto(zonas)`, `checklistCompleto(checklist)`, `puedeEditar(status)`, `puedeEntregar(status, zonas, checklist)`, `computeStatusAfterSave(papeleta)`, `danoYaDocumentadoEnSalida(zonaId, zonasSalida)`, `rolPuedeCerrarCaso(rol)`, `rolPuedeGestionarVentas(rol)`

- [ ] **Step 1: Write failing test**

```js
// scripts/test-papeleta-model.js
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'domain', 'papeleta.model.js')).href);
  assert.strictEqual(mod.ZONAS_V1.length, 12);
  assert.strictEqual(mod.ZONAS_V1[0].id, 'trasera_cajuela');
  assert.strictEqual(mod.ZONAS_V1[11].id, 'cofre');
  assert.deepStrictEqual(mod.CHECKLIST_KEYS.slice(0, 3), ['tapetes', 'placas', 'catalizador']);
  const zonas = mod.createEmptyZonas();
  assert.strictEqual(mod.allZonasHaveFoto(zonas), false);
  zonas.frente_defensa = { estado: 'ok', nota: '', fotoPath: 'x' };
  // still incomplete
  assert.strictEqual(mod.allZonasHaveFoto(zonas), false);
  for (const z of mod.ZONAS_V1) zonas[z.id] = { estado: 'ok', nota: '', fotoPath: `p/${z.id}` };
  assert.strictEqual(mod.allZonasHaveFoto(zonas), true);
  const cl = mod.createEmptyChecklist();
  assert.strictEqual(mod.checklistCompleto(cl), false);
  for (const k of mod.CHECKLIST_KEYS) cl[k] = 'ok';
  assert.strictEqual(mod.checklistCompleto(cl), true);
  assert.strictEqual(mod.puedeEditar('entregada'), false);
  assert.strictEqual(mod.puedeEditar('lista'), true);
  assert.strictEqual(mod.puedeEntregar('lista', zonas, cl), true);
  assert.strictEqual(mod.puedeEntregar('borrador', zonas, cl), false);
  assert.strictEqual(mod.danoYaDocumentadoEnSalida('cofre', { cofre: { estado: 'dano' } }), true);
  assert.strictEqual(mod.danoYaDocumentadoEnSalida('cofre', { cofre: { estado: 'ok' } }), false);
  assert.strictEqual(mod.rolPuedeCerrarCaso('VENTAS'), false);
  assert.strictEqual(mod.rolPuedeCerrarCaso('SUPERVISOR'), true);
  assert.strictEqual(mod.rolPuedeGestionarVentas('VENTAS'), true);
  assert.strictEqual(mod.rolPuedeGestionarVentas('AUXILIAR'), false);
  console.log('OK papeleta.model', mod.ZONAS_V1.length, 'zonas');
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test — expect FAIL** (module missing)

Run: `node scripts/test-papeleta-model.js`  
Expected: ERR_MODULE_NOT_FOUND

- [ ] **Step 3: Implement `domain/papeleta.model.js`**

```js
/** @typedef {'borrador'|'lista'|'entregada'|'en_retorno'|'cerrada_historial'} PapeletaStatus */
/** @typedef {'ok'|'faltante'|'na'} ChecklistValue */
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
  'tapetes', 'placas', 'catalizador', 'tapon_gas', 'gato', 'herramienta',
  'dado_seguridad', 'refaccion', 'mofle', 'antena', 'limpiaparabrisas', 'aire_acondicionado',
]);

export const CHECKLIST_LABELS = Object.freeze({
  tapetes: 'Tapetes', placas: 'Placas', catalizador: 'Catalizador', tapon_gas: 'Tapón de gas',
  gato: 'Gato', herramienta: 'Herramienta', dado_seguridad: 'Dado de seguridad',
  refaccion: 'Refacción', mofle: 'Mofle', antena: 'Antena',
  limpiaparabrisas: 'Limpiaparabrisas', aire_acondicionado: 'Aire acondicionado',
});

const ROLE_LEVEL = Object.freeze({
  AUXILIAR: 1, VENTAS: 2, SUPERVISOR: 3, JEFE_PATIO: 4, GERENTE_PLAZA: 5,
  JEFE_REGIONAL: 6, CORPORATIVO_USER: 7, JEFE_OPERACION: 8, PROGRAMADOR: 9,
});

const FULL = new Set(['PROGRAMADOR', 'JEFE_OPERACION', 'CORPORATIVO_USER']);

export function createEmptyChecklist() {
  const o = {};
  for (const k of CHECKLIST_KEYS) o[k] = '';
  return o;
}

export function createEmptyZonas() {
  const o = {};
  for (const z of ZONAS_V1) o[z.id] = { estado: 'ok', nota: '', fotoPath: '' };
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
  if (status === STATUS.ENTREGADA || status === STATUS.EN_RETORNO || status === STATUS.CERRADA_HISTORIAL) {
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
  if (FULL.has(r)) return true;
  return (ROLE_LEVEL[r] || 0) > ROLE_LEVEL.VENTAS;
}

export function rolPuedeGestionarVentas(rol) {
  const r = String(rol || '').toUpperCase();
  if (FULL.has(r)) return true;
  return (ROLE_LEVEL[r] || 0) >= ROLE_LEVEL.VENTAS;
}

export function truncNota(nota, max = 40) {
  return String(nota || '').slice(0, max);
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `node scripts/test-papeleta-model.js`  
Expected: `OK papeleta.model 12 zonas`

- [ ] **Step 5: Commit**

```bash
git add domain/papeleta.model.js scripts/test-papeleta-model.js
git commit -m "feat(papeletas): domain model and node tests for zones/checklist/status"
```

---

### Task 2: Permissions, COL, router, nav, empty view

**Files:**
- Modify: `domain/permissions.model.js` — add `view_papeletas`, `manage_papeletas_ventas` to `PERMISSION_KEYS` and every role in `DEFAULT_ROLE_PERMISSIONS` (AUXILIAR+: view true; VENTAS+: manage true; AUXILIAR manage false)
- Modify: `js/core/feature-gates.js` — same keys in `_PERM_DEFAULTS`
- Modify: `js/core/database.js` — `PAPELETAS: 'papeletas'`, `PAPELETAS_REPORTES: 'papeletas_reportes'`
- Modify: `js/app/router.js` — routes + ROUTE_STYLES + prefix resolve for `/app/papeletas/`
- Modify: `js/app/route-resolver.js` — ROUTE_MAP entry
- Modify: `js/shell/navigation.config.js` — item under Operación
- Create: `js/app/views/papeletas.js` — mount shell “Papeletas” placeholder gated by `view_papeletas`
- Create: `css/app-papeletas.css` — minimal `.pap-module` tokens using ESTILO accent

**Interfaces:**
- Consumes: Task 1 model (optional in view later)
- Produces: navigable `/app/papeletas` when `mexPerms.canDo('view_papeletas')`

- [ ] **Step 1: Wire permissions** — AUXILIAR `view_papeletas:true`, `manage_papeletas_ventas:false`; VENTAS and above both true; mirror in feature-gates `_PERM_DEFAULTS`.

- [ ] **Step 2: Router**

```js
'/app/papeletas': {
  loader: () => import('/js/app/views/papeletas.js'),
  navRoute: '/app/papeletas',
  feature: 'papeletas',
  permission: 'view_papeletas',
},
'/app/papeletas/ventas': {
  loader: () => import('/js/app/views/papeletas.js'),
  navRoute: '/app/papeletas',
  feature: 'papeletas',
  permission: 'view_papeletas',
},
```

In `_resolveRouteKey` / lookup helpers, map `/app/papeletas/:id` → `/app/papeletas` (same pattern as mensajes).

ROUTE_STYLES: `"/app/papeletas": [{ href: "/css/app-papeletas.css", attr: "data-app-papeletas-css" }]`

- [ ] **Step 3: route-resolver**

```js
papeletas: {
  id: 'papeletas', label: 'Papeletas',
  legacyRoute: '/app/papeletas',
  appRoute: '/app/papeletas',
  navRoute: '/app/papeletas',
  fallbackRoute: '/app/papeletas',
  shellIntegrated: true,
  fullModuleMigrated: true,
  feature: 'papeletas',
},
```

- [ ] **Step 4: Nav item** in `operacion` group:

```js
{
  id: 'papeletas',
  label: 'Papeletas',
  icon: 'description',
  route: '/app/papeletas',
  roles: '*',
  feature: 'papeletas',
  permission: 'view_papeletas',
}
```

(Ensure `getFilteredNav` already respects `permission` like turnos.)

- [ ] **Step 5: Empty view** exporting `mount({ container, navigate, state })` / `unmount()` that injects CSS link if needed, renders header “Papeletas” + tabs Listado | Ventas (Ventas tab hidden unless `manage_papeletas_ventas` or `rolPuedeGestionarVentas`).

- [ ] **Step 6: Commit**

```bash
git add domain/permissions.model.js js/core/feature-gates.js js/core/database.js \
  js/app/router.js js/app/route-resolver.js js/shell/navigation.config.js \
  js/app/views/papeletas.js css/app-papeletas.css
git commit -m "feat(papeletas): wire route, nav, permissions and empty SPA view"
```

---

### Task 3: Firestore + Storage rules + indexes

**Files:**
- Modify: `firestore.rules`
- Modify: `storage.rules`
- Modify: `firestore.indexes.json`

**Rules intent:**
- `papeletas/{id}`: authenticated with profile; read if plaza authorized; create if `view_papeletas` (or authenticated patio — use `tienePermiso(..., "view_papeletas")` if helper exists, else `estaAutenticado() && tienePerfilActual()` matching incidencias style); update blocked for salida/zonas/checklist fields when `resource.data.status` in `['entregada','en_retorno','cerrada_historial']` except allowing `entrada`, `status`→`en_retorno`/`cerrada_historial`, `activoPorUnidad`, `clienteNombre` (ventas), `casoVentasId`, `pdfUrl`.
- `papeletas_reportes/{id}`: create/read authenticated; update promote/close restricted — close only SUPERVISOR+ (mirror role checks in rules); auxiliar cannot write `papeletas_ventas/` storage path.
- Storage: `papeletas/{id}/**` read/write auth; `papeletas_reportes/{id}/**` auth; `papeletas_ventas/{id}/**` write only Ventas+ / SUPERVISOR+.

- [ ] **Step 1: Add indexes** composite: `unidadId + activoPorUnidad`, `plazaId + status`, `status` on reportes (`abierto`).

- [ ] **Step 2: Add rules blocks** following existing `tienePerfilActual` / `plazaAutorizada` / `rolActual` helpers.

- [ ] **Step 3: Commit**

```bash
git add firestore.rules storage.rules firestore.indexes.json
git commit -m "feat(papeletas): Firestore/Storage rules and indexes"
```

---

### Task 4: Data + storage layers

**Files:**
- Create: `js/app/features/papeletas/papeletas-constants.js`
- Create: `js/app/features/papeletas/papeletas-data.js`
- Create: `js/app/features/papeletas/papeletas-storage.js`

**Interfaces:**
- Produces:
  - `subscribePapeletasPlaza({ plazaId, onData, onError })`
  - `getPapeletaActivaByUnidad(unidadId)` → doc|null
  - `crearPapeleta({ unidad, plazaId, user })` — throws if active exists; sets `activoPorUnidad:true`, `status:'borrador'`, empty zonas/checklist, `zonasTemplateVersion:1`
  - `actualizarPapeleta(id, patch, { user })` — refuses if `!puedeEditar`
  - `marcarLista(id)` / uses `computeStatusAfterSave`
  - `entregarPapeleta(id, { quienEntrega, km, gas, firmaPath, user })`
  - `registrarEntrada(id, { quienRecibe, km, gas, notas, user })` → `en_retorno`, `activoPorUnidad:false`
  - `asignarCliente(id, clienteNombre)`
  - `uploadZonaFoto(papeletaId, zonaId, blob)` → path
  - `uploadFirma(papeletaId, blob)` → path
  - `compressImageFile(file, maxBytes=800_000)` → Blob

- [ ] **Step 1: Implement storage compress** with canvas `toBlob('image/jpeg', quality)` loop until ≤ maxBytes or quality floor 0.45.

- [ ] **Step 2: Implement data module** using `db.collection(COL.PAPELETAS)` from `/js/core/database.js`. Uniqueness:

```js
export async function getPapeletaActivaByUnidad(unidadId) {
  const snap = await db.collection(COL.PAPELETAS)
    .where('unidadId', '==', unidadId)
    .where('activoPorUnidad', '==', true)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}
```

- [ ] **Step 3: Unit search helper** — wrap `buscarUnidad` from unidades-data; enrich km/gas from `cuadre` doc if present (`db.collection(COL.CUADRE).doc(plazaId)` or unit map — inspect existing cuadre shape and document chosen field path in code comment).

- [ ] **Step 4: Commit**

```bash
git add js/app/features/papeletas/
git commit -m "feat(papeletas): Firestore data layer and photo/firma storage helpers"
```

---

### Task 5: List UI

**Files:**
- Modify: `js/app/views/papeletas.js`
- Modify: `css/app-papeletas.css`

**UI:**
- Search input (MVA, placas, modelo, VIN, cliente)
- Filters chips: activas (`activoPorUnidad`) / entregadas / historial / con caso Ventas
- Cards: MVA, modelo, status chip, cliente, plaza
- “Nueva” → unit search modal → `crearPapeleta` or open existing on conflict (`mexAlert` + navigate)
- Banner if open reporte `abierto` for same unidad when creating (Task 11 may complete banner; stub query ok)

- [ ] **Step 1: Implement list render + subscribe**
- [ ] **Step 2: Commit** `feat(papeletas): list view with search and status filters`

---

### Task 6: Wizard salida (unidad, zonas, checklist)

**Files:**
- Modify: `js/app/views/papeletas.js`
- Modify: `css/app-papeletas.css`
- Optionally split: `js/app/features/papeletas/papeletas-wizard-ui.js` if view exceeds ~800 lines — prefer split if growing.

**UI flow on `/app/papeletas/:id`:**
1. Datos unidad (editable overrides)
2. Zonas stepper `n/12` — camera/file input fullscreen-friendly; mark `ok`/`dano`; nota ≤40; optional circle overlay (`x,y,r` 0..1) OR detalle foto
3. Checklist toggles ok/faltante/na
4. Resumen — auto `computeStatusAfterSave` on each save

Disable zone/checklist edits when `!puedeEditar(status)`.

- [ ] **Step 1: Implement wizard steps + persist**
- [ ] **Step 2: Manual verify mentally against AC §13.3**
- [ ] **Step 3: Commit** `feat(papeletas): salida wizard with zones photos and checklist`

---

### Task 7: Entregar + firma + PDF

**Files:**
- Create: `js/app/features/papeletas/papeletas-pdf.js`
- Modify: `js/app/views/papeletas.js`, `papeletas-data.js`

**Flow:**
1. Button Entregar only if `puedeEntregar(...)`
2. If no `clienteNombre` → `mexConfirm('Sin cliente asignado — ¿continuar?')`
3. Signature canvas screen label `{clienteNombre || 'Cliente'} — Firma`
4. Upload firma → `entregarPapeleta` → generate PDF → offer download/print
5. PDF HTML includes datos, checklist, zonas con daño, firma img, `exportFooterHtml()`

```js
import { buildExportFilename, exportFooterHtml, getExportIdentity } from '/js/core/export-signing.js';

export function openPapeletaPdf(papeleta, { firmaUrl } = {}) {
  const title = buildExportFilename('pdf').replace(/\.pdf$/i, '');
  const id = getExportIdentity();
  const w = window.open('', '_blank');
  // write HTML letter/A4; footer exportFooterHtml(); auto print like turnos
}
```

- [ ] **Step 1: Implement PDF helper**
- [ ] **Step 2: Wire deliver flow; do not set entregada until firmaPath persisted**
- [ ] **Step 3: Commit** `feat(papeletas): deliver with client signature and signed PDF`

---

### Task 8: Entrada + liberar unidad + photo compare

**Files:**
- Modify: `js/app/views/papeletas.js`, `papeletas-data.js`, CSS

**Flow:**
- From list, find `entregada` by search
- Detail shows salida damages + mini photo viewer (“esta foto = zona X”)
- Form: quien recibe, km/gas, notas → `registrarEntrada`
- After: `activoPorUnidad:false` so nueva papeleta allowed

- [ ] **Step 1: Implement entrada UI + mutation**
- [ ] **Step 2: Commit** `feat(papeletas): register return and free unit for new ticket`

---

### Task 9: Reportes daño/faltante

**Files:**
- Create: `js/app/features/papeletas/papeletas-reportes-data.js`
- Modify: view + storage + rules if needed

**Logic:**
- `crearReporte({ papeletaId, tipo:'dano'|'faltante', zonasNuevas, itemsFaltantes, fotos })`
- If all daño zones already `dano` on salida → save `status:'descartado'` + toast “Ya documentado en salida” (no Ventas case)
- Else require fotos placas + VIN + ≥1 daño/faltante photo; `status:'abierto'`, `expiresAt` = now+24h
- Storage under `papeletas_reportes/{reporteId}/...`

- [ ] **Step 1: Implement + wire UI buttons on entrada/entregada**
- [ ] **Step 2: Extend domain test for discard helper if needed**
- [ ] **Step 3: Commit** `feat(papeletas): damage/missing reports with salida discard rule`

---

### Task 10: Ventas bandeja + cliente + promote + TTL job

**Files:**
- Modify: `js/app/views/papeletas.js` (ventas mode when path ends `/ventas` or tab)
- Modify: `papeletas-reportes-data.js`
- Modify: `functions/index.js`

**UI (permission `manage_papeletas_ventas`):**
- List reportes `abierto`
- Detail photos; button Promover → copy Storage to `papeletas_ventas/{casoId}/` then update `status:'promovido'`, clear/extend expiresAt, set `promovidoAPath`
- Assign `clienteNombre` on papeleta from list/detail

**CF:**

```js
exports.limpiarFotosReportesPapeletas = functions.pubsub
  .schedule('every 60 minutes')
  .timeZone('America/Mexico_City')
  .onRun(async () => { /* query expiresAt < now && status==abierto; delete storage; mark expirado */ });
```

(If scheduled functions require `firebase-functions` pubsub already used — check package; if no schedule API in project yet, use `functions.pubsub.schedule` as in Firebase v1 docs.)

- [ ] **Step 1: Ventas UI + promote**
- [ ] **Step 2: CF cleanup**
- [ ] **Step 3: Commit** `feat(papeletas): ventas inbox, promote evidence, TTL cleanup job`

---

### Task 11: Cerrar caso Supervisor+ + aviso caso abierto

**Files:**
- Modify: reportes-data + view

**Rules:**
- `cerrarCaso(reporteId)` only if `rolPuedeCerrarCaso(rol)`; set reporte `cerrado`; if no other open reportes for papeleta → papeleta `cerrada_historial`
- On `crearPapeleta`, query open reportes for `unidadId`; if any, show persistent banner aviso **C** / “Hay caso Ventas abierto para esta unidad”

- [ ] **Step 1: Implement close + banner**
- [ ] **Step 2: Re-run** `node scripts/test-papeleta-model.js`
- [ ] **Step 3: Commit** `feat(papeletas): supervisor close and open-case warning banner`

---

### Task 12: Smoke checklist + bump SW + final commit

**Files:**
- Create: `docs/superpowers/plans/2026-07-20-papeletas-digitales-smoke.md` (manual checklist from spec §15)
- Run: `node scripts/bump-sw.js` in worktree
- Commit all remaining

Manual checklist items (copy into smoke md):
1. No 2 activas misma unidad
2. Post-entregar immutable
3. lista/entregada requires 12 fotos
4. PDF downloads with firma + Exportado por
5. Entrada libera nueva
6. Daño existente → descartado
7. Nuevo exige placas+VIN+fotos → bandeja
8. Banner caso abierto
9. Solo >VENTAS cierra

- [ ] **Step 1: Write smoke md**
- [ ] **Step 2: `node scripts/bump-sw.js`**
- [ ] **Step 3: `node scripts/test-papeleta-model.js`**
- [ ] **Step 4: Commit** `chore(papeletas): bump SW and add beta smoke checklist`
- [ ] **Step 5: Do not push** — leave for finishing-a-development-branch options

---

## Spec coverage (§13 → tasks)

| AC | Task |
|----|------|
| 1 Unicidad | 4, 5 |
| 2 Immutable post-entregar | 3, 7 |
| 3 Fotos obligatorias | 1, 6, 7 |
| 4 PDF | 7 |
| 5 Entrada libera | 8 |
| 6 Discard daño salida | 1, 9 |
| 7 Nuevo reporte → Ventas | 9, 10 |
| 8 Aviso caso abierto | 11 |
| 9 Cierre Supervisor+ | 1, 11 |

## Out of beta (defer)

WhatsApp/correo, lápiz libre, CRM contrato, side-by-side comparator v2, plantillas por tipo unidad.

## Self-review notes

- No TBD placeholders in task steps.
- PDF uses existing print-window pattern (no new CDN dependency).
- `mexFeatures.puedeUsar` currently always true — still pass `feature:'papeletas'` for future gates; real gate is `permission:'view_papeletas'`.
