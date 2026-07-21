# Notas slim + Reportes de daños Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slim the incidencias SPA into a Notas bitácora (list+detail, seguidores only) and ship a standalone Reportes de daños SPA that owns create/promote/close for `papeletas_reportes`.

**Architecture:** Approach 1 from the approved spec — surgery on existing `notas_admin` consumers (no collection rename) plus an additive Reportes SPA. Fix `_buildIncidentPayload` / `_normalizeIncidentRecord` so `seguidores` survive normalize+subscribe. Generalize `crearReporte` to accept unidad snapshot + optional `papeletaId` and persist `danosMarcados` from `papeletas-diagram`. Redirects preserve old bookmarks.

**Tech Stack:** Vanilla ES modules SPA (`js/app/views/*`), Firestore via `api/notas.js` + `mex-api.js` helpers, `js/app/features/papeletas/*`, Firebase Hosting, `ESTILO.md` (Inter, `#3b82f6`, Material Symbols).

## Global Constraints

- Do **not** rename Firestore collection `notas_admin` (`COL.NOTAS`).
- Do **not** break mapa / expediente consumers of `notas_admin`.
- Unit gestor notes (`notas` / `notaAutor` / `notaFecha` on flota) stay separate — Notas SPA must not read/write them.
- No zone vectorization — diagram marks via `papeletas-diagram` only.
- Visual: `ESTILO.md` only (Inter, accent `#3b82f6`, Material Symbols); no Obsidian skin.
- Build order: Notas slim → Reportes SPA → redirects/polish.
- Closeout: bump SW (`node scripts/bump-sw.js`), commit, push, deploy hosting when user-visible.
- Spec source of truth: `docs/superpowers/specs/2026-07-21-notas-y-reportes-danos-design.md`.

---

## File structure (create / modify)

| File | Responsibility |
|------|----------------|
| `mex-api.js` | Preserve `seguidores` in `_buildIncidentPayload` / normalize |
| `api/notas.js` | Pass `seguidores` through on create when provided |
| `js/app/features/incidencias/incidencias-data.js` | Keep `toggleSeguidor`; ensure create fallback writes `seguidores` |
| `js/app/views/incidencias.js` | Slim UI (list+detail); drop board/assign/comments/SLA |
| `css/app-incidencias.css` | Remove unused board/SLA chrome if dead; keep list+detail |
| `js/shell/navigation.config.js` | Label **Notas**; add **Reportes de daños** below; titles |
| `js/app/router.js` | `/app/notas`, redirects, Reportes routes + CSS |
| `js/app/route-resolver.js` | ROUTE_MAP entries for notas + reportes-danos |
| `js/shell/shell-layout.js` / `header.js` | Badge id / search placeholder for Notas |
| `js/app/features/papeletas/papeletas-reportes-data.js` | Optional `papeletaId`; `danosMarcados`; subscribe list helpers |
| `js/app/views/reportes-danos.js` | **Create** — inbox + create + detail SPA |
| `css/app-reportes-danos.css` | **Create** — ESTILO styles |
| `js/app/views/papeletas.js` | Remove Reportar create / Ventas inbox primary; link out |
| Mapa / expediente deep links | Point bitácora links to `/app/notas?mva=` |

---

### Task 1: Fix `seguidores` in incident payload normalize

**Files:**
- Modify: `mex-api.js` (`_buildIncidentPayload`, `_normalizeIncidentRecord`)
- Modify: `api/notas.js` (`guardarNuevaNotaDirecto` — ensure seguidores on set)
- Modify: `js/app/features/incidencias/incidencias-data.js` (`createIncidencia` fallback)

**Interfaces:**
- Consumes: existing `data.seguidores` arrays from Firestore / create payload
- Produces: `_buildIncidentPayload` includes `seguidores: [{ uid, email, nombre, rol? }, ...]`; normalize returns them on every subscribe snapshot

- [ ] **Step 1: Patch `_buildIncidentPayload` in `mex-api.js`**

After building the return object, include normalized seguidores:

```js
function _normalizeSeguidores(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      uid: _sanitizeText(s.uid || ''),
      email: _sanitizeText(s.email || ''),
      nombre: _sanitizeText(s.nombre || s.displayName || ''),
      ...(s.rol ? { rol: _sanitizeText(s.rol) } : {}),
    }))
    .filter((s) => s.uid || s.email);
}

// Inside _buildIncidentPayload return object, add:
seguidores: _normalizeSeguidores(data.seguidores),
```

Do **not** add `asignadoA` / `comentarios` to the write whitelist (slim UI ignores them; `toggleSeguidor` updates Firestore directly).

- [ ] **Step 2: Ensure create path stores initial seguidores**

In `api/notas.js` `guardarNuevaNotaDirecto`, after `_buildIncidentPayload(...)`, if payload already has `seguidores` from builder, leave it; otherwise ensure empty array:

```js
if (!Array.isArray(payload.seguidores)) payload.seguidores = [];
```

In `incidencias-data.js` `createIncidencia` Firestore fallback `set`, add:

```js
seguidores: Array.isArray(basePayload.seguidores) ? basePayload.seguidores : [],
```

- [ ] **Step 3: Manual verify path (no automated suite for this)**

In browser console after deploy/local: create note → follow → confirm Firestore doc has `seguidores` and UI still shows after refresh. Fallback check: call `window.api.suscribirNotasAdmin(n => console.log(n[0]?.seguidores), 'PLAZA')`.

- [ ] **Step 4: Commit**

```bash
git add mex-api.js api/notas.js js/app/features/incidencias/incidencias-data.js
git commit -m "fix(notas): preserve seguidores in incident payload normalize"
```

---

### Task 2: Routes + nav rename to Notas + `/app/incidencias` redirect

**Files:**
- Modify: `js/shell/navigation.config.js`
- Modify: `js/app/router.js`
- Modify: `js/app/route-resolver.js`
- Modify: `js/shell/header.js` (search placeholder)
- Modify: `js/shell/shell-layout.js` (keep badge nav id `incidencias` OR rename consistently — prefer keep id `incidencias` for badge continuity, change label + route only)

**Interfaces:**
- Produces: canonical route `/app/notas` loads same view module; `/app/incidencias` redirects preserving query

- [ ] **Step 1: Navigation config**

```js
{
  id: 'incidencias',
  label: 'Notas',
  icon: 'sticky_note_2',
  route: '/app/notas',
  roles: '*',
  feature: 'incidencias'
},
```

Update `PAGE_TITLES` / title maps:

```js
'/incidencias': 'Notas',
'/app/incidencias': 'Notas',
'/app/notas': 'Notas',
```

- [ ] **Step 2: Router**

Add `/app/notas` entry mirroring `/app/incidencias` (same loader `incidencias.js`, feature, CSS). Keep `/app/incidencias` as a redirect:

In router `navigate` / `render` path resolution (follow existing redirect patterns if any; else add early in `_routeForPath` or mount):

```js
// Early in route resolution:
if (path === '/app/incidencias' || path.startsWith('/app/incidencias?')) {
  const qs = window.location.search || '';
  history.replaceState(null, '', '/app/notas' + qs);
  path = '/app/notas';
}
```

Register CSS for `/app/notas` same as incidencias CSS.

- [ ] **Step 3: route-resolver**

```js
notas: {
  id: 'notas', label: 'Notas',
  legacyRoute: '/incidencias',
  appRoute: '/app/notas',
  navRoute: '/app/notas',
  fallbackRoute: '/app/notas',
  shellIntegrated: true,
  fullModuleMigrated: true,
  feature: 'incidencias',
},
```

Keep `incidencias` entry pointing `appRoute` to `/app/notas` or redirect helper so `toAppRoute('/incidencias')` → `/app/notas`.

- [ ] **Step 4: Header placeholder**

```js
if (route === '/app/notas' || route === '/app/incidencias' || route === '/incidencias')
  return 'Buscar nota, MVA, autor...';
```

- [ ] **Step 5: Commit**

```bash
git add js/shell/navigation.config.js js/app/router.js js/app/route-resolver.js js/shell/header.js
git commit -m "feat(notas): rename nav and register /app/notas with redirect"
```

---

### Task 3: Slim Notas SPA UI

**Files:**
- Modify: `js/app/views/incidencias.js`
- Modify: `css/app-incidencias.css` (as needed)

**Interfaces:**
- Consumes: `subscribeIncidencias`, `createIncidencia`, `resolveIncidencia`, `deleteIncidencia`, `toggleSeguidor`, `mexPerms.canDo('create_incidencia'|'edit_incidencia'|'delete_incidencia'|'view_incidencias')`
- Produces: list+detail bitácora; follow/unfollow; no board/assign/comments/SLA

- [ ] **Step 1: Force list mode; remove view toggle**

Set `_state.viewMode = 'list'` always. Delete board/table toggle buttons and `renderBoard` / board branch in list render. Keep table optional only if still useful — **spec says list default and board removed**; remove board fully; table may stay as optional compact list or also drop — **drop board only; keep list as primary** (table optional remove for simplicity).

- [ ] **Step 2: Remove SLA KPI strip**

Delete KPI cards that include “SLA en riesgo” / “SLA crítico” rails (around the KPI strip and `rail-saved` SLA button). Keep light header: search, filters, tabs Mis/Todas/Sigo.

- [ ] **Step 3: Remove asignadoA UI**

Strip assignee picker from create form, detail meta, filters/tabs “sin asignar”, and any `updateIncidenciaField(..., { asignadoA })` calls. Do not write `asignadoA` on create.

- [ ] **Step 4: Remove comentarios UI**

Remove comment composer, timeline comment entries from detail, and `addComentario` import/usage. Keep resolve flow (`solucion`).

- [ ] **Step 5: Keep seguidores + permissions**

Keep seguidores avatars + follow/unfollow via `toggleSeguidor`. Gate create/edit/delete/resolve with `window.mexPerms?.canDo(...)`. Prefill `?mva=` from query on `/app/notas`.

- [ ] **Step 6: Copy polish**

Page title / empty states say **Notas** / bitácora (not “incidencias” where user-facing).

- [ ] **Step 7: Commit**

```bash
git add js/app/views/incidencias.js css/app-incidencias.css
git commit -m "feat(notas): slim bitácora UI — list+detail, seguidores only"
```

---

### Task 4: Deep-link sweep for Notas

**Files:**
- Modify: mapa / expediente / home links that point to `/app/incidencias`

- [ ] **Step 1: Grep and replace**

```bash
rg -n "/app/incidencias|incidencias\?mva|Ver bitácora" js/ --glob '!**/.worktrees/**'
```

Update SPA navigations to `/app/notas` (preserve `?mva=`). Leave legacy `incidencias.html` unlinked from sidebar.

- [ ] **Step 2: Commit**

```bash
git add -u
git commit -m "chore(notas): point bitácora deep links to /app/notas"
```

---

### Task 5: Generalize `crearReporte` + list subscriptions

**Files:**
- Modify: `js/app/features/papeletas/papeletas-reportes-data.js`

**Interfaces:**
- Consumes: unidad snapshot `{ id|unidadId, mva, plazaId }`, optional `papeleta` / `papeletaId`, `danosMarcados`, `fotos`, `tipo`, `itemsFaltantes`, `descripcion`/`nota`, `user`
- Produces: `crearReporte` without requiring full papeleta; `cerrarCaso` only historial-closes when `papeletaId` non-empty; `subscribeReportes` for inbox filters

- [ ] **Step 1: Rewrite `crearReporte` signature**

```js
export async function crearReporte({
  papeleta = null,
  papeletaId = '',
  unidad = null,
  tipo,
  zonasNuevas = [],
  itemsFaltantes = [],
  fotos = {},
  danosMarcados = [],
  descripcion = '',
  nota = '',
  user,
  id,
}) {
  const unidadId = String(unidad?.id || unidad?.unidadId || papeleta?.unidadId || '').trim();
  const mva = String(unidad?.mva || papeleta?.mva || '').trim();
  const plazaId = String(unidad?.plazaId || unidad?.plaza || papeleta?.plazaId || '').trim();
  const papId = String(papeletaId || papeleta?.id || '').trim();

  if (!unidadId && !mva) throw new Error('Unidad requerida');
  if (!tipo || !['dano', 'faltante'].includes(tipo)) throw new Error('Tipo inválido');

  // Preexisting-damage auto-discard ONLY when papeleta + zonasSalida available
  let nuevas = zonasNuevas || [];
  let status = REPORTE_STATUS.ABIERTO;
  let motivoDescarte = '';
  if (papeleta?.id && tipo === 'dano' && (zonasNuevas || []).length) {
    const zonasSalida = papeleta.zonas || {};
    nuevas = (zonasNuevas || []).filter((z) => !danoYaDocumentadoEnSalida(z, zonasSalida));
    if ((zonasNuevas || []).length > 0 && nuevas.length === 0) {
      status = REPORTE_STATUS.DESCARTADO;
      motivoDescarte = 'Ya documentado en salida';
    }
  }

  // foto rules: for abierto dano require placas+vin+≥1 daño; faltante requires items
  // ... same validation as today when status === ABIERTO ...

  await _col().doc(docId).set({
    ...(papId ? { papeletaId: papId } : { papeletaId: '' }),
    unidadId,
    mva,
    plazaId,
    tipo,
    zonasNuevas: nuevas,
    itemsFaltantes: itemsFaltantes || [],
    fotos: { placas: fotos.placas || '', vin: fotos.vin || '', danos: Array.isArray(fotos.danos) ? fotos.danos.filter(Boolean) : [] },
    danosMarcados: Array.isArray(danosMarcados) ? danosMarcados : [],
    descripcion: String(descripcion || nota || '').trim(),
    status,
    ...(motivoDescarte ? { motivoDescarte } : {}),
    creadoAt: _fv(),
    expiresAt: status === REPORTE_STATUS.ABIERTO ? _plus24h() : null,
    creadoPor: user?.uid || window._auth?.currentUser?.uid || '',
    promovidoAPath: '',
  });
  return { id: docId, status, discarded: status === REPORTE_STATUS.DESCARTADO };
}
```

- [ ] **Step 2: Guard `cerrarCaso`**

```js
const papId = String(data.papeletaId || '').trim();
if (papId) {
  const open = await _col()
    .where('papeletaId', '==', papId)
    .where('status', '==', REPORTE_STATUS.ABIERTO)
    .limit(1)
    .get();
  if (open.empty) {
    const pap = await getPapeleta(papId);
    if (pap && (pap.status === 'en_retorno' || pap.status === 'entregada')) {
      await cerrarPapeletaHistorial(papId, { user });
    }
  }
}
```

- [ ] **Step 3: Add inbox subscription**

```js
export function subscribeReportes({ status = null, plazaId = '', onData, onError }) {
  let query = _col().orderBy('creadoAt', 'desc').limit(150);
  // Prefer status filter when provided; client-filter plazaId/mva/tipo if composite indexes missing
  if (status) query = _col().where('status', '==', status).orderBy('creadoAt', 'desc').limit(150);
  return query.onSnapshot(
    (snap) => {
      let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const p = String(plazaId || '').toUpperCase().trim();
      if (p) rows = rows.filter((r) => String(r.plazaId || '').toUpperCase().trim() === p);
      onData(rows);
    },
    (err) => { console.warn('[papeletas_reportes]', err?.message); onError ? onError(err) : onData([]); }
  );
}

export async function getReporte(id) {
  const snap = await _col().doc(String(id)).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}
```

- [ ] **Step 4: Commit**

```bash
git add js/app/features/papeletas/papeletas-reportes-data.js
git commit -m "feat(reportes): optional papeletaId, danosMarcados, inbox subscribe"
```

---

### Task 6: Reportes de daños SPA (list + create + detail)

**Files:**
- Create: `js/app/views/reportes-danos.js`
- Create: `css/app-reportes-danos.css`
- Modify: `js/app/router.js`, `js/app/route-resolver.js`, `js/shell/navigation.config.js`

**Interfaces:**
- Consumes: `crearReporte`, `promoverReporte`, `cerrarCaso`, `subscribeReportes`, `getReporte`, `newReporteId`, `mountDiagram` from `papeletas-diagram.js`, camera/upload helpers from `papeletas-camera` / `papeletas-storage`, unit search from existing flota helpers if present
- Produces: routes `/app/reportes-danos`, `/app/reportes-danos/nuevo`, `/app/reportes-danos/:id`

- [ ] **Step 1: Register nav + routes**

Nav item **directly below Notas**:

```js
{
  id: 'reportes-danos',
  label: 'Reportes de daños',
  icon: 'car_crash',
  route: '/app/reportes-danos',
  roles: '*',
  feature: 'papeletas',
  permission: 'view_papeletas',
},
```

Router:

```js
'/app/reportes-danos': {
  loader: () => import('/js/app/views/reportes-danos.js'),
  navRoute: '/app/reportes-danos',
  feature: 'papeletas',
  permission: 'view_papeletas',
},
```

Prefix match: `/app/reportes-danos/` → same loader. CSS: `/css/app-reportes-danos.css`.

Redirect early:

```js
if (path === '/app/papeletas/ventas' || path.startsWith('/app/papeletas/ventas?')) {
  history.replaceState(null, '', '/app/reportes-danos' + (window.location.search || ''));
  path = '/app/reportes-danos';
}
```

- [ ] **Step 2: Implement view modes in `reportes-danos.js`**

Export `mount({ container, navigate, shell, state })` / `unmount()`.

Modes from path:
- list: `/app/reportes-danos`
- create: `/app/reportes-danos/nuevo`
- detail: `/app/reportes-danos/:id` or `?id=`

List: filters status / tipo / MVA / plaza; cards with promote/close for Ventas+ / Supervisor+.

Create form fields:
1. Unit picker (MVA / placas / modelo) + plaza
2. tipo `dano` | `faltante`
3. description / items faltantes
4. photos: placas + VIN required for daño; ≥1 daño photo; faltantes items
5. `mountDiagram(host, { editable: true, onDamagesChange })` → store `danosMarcados`
6. optional `papeletaId` text field
7. Save → `crearReporte({ unidad, tipo, fotos, danosMarcados, itemsFaltantes, papeletaId, descripcion, user })` with Storage paths under `papeletas_reportes/{id}/…` via existing upload helpers

Detail: show photos, diagram read-only (`mountDiagram(..., { editable: false, danosMarcados })`), promote/close buttons gated by `manage_papeletas_ventas` / `rolPuedeCerrarCaso`.

- [ ] **Step 3: CSS per ESTILO.md**

Inter, spacing 4px grid, accent `#3b82f6`, CSS vars `--bg` `--surface` `--text` `--border`, Material Symbols only. No purple/Obsidian chrome.

- [ ] **Step 4: Commit**

```bash
git add js/app/views/reportes-danos.js css/app-reportes-danos.css js/app/router.js js/app/route-resolver.js js/shell/navigation.config.js
git commit -m "feat(reportes): SPA inbox, create with diagram, detail promote/close"
```

---

### Task 7: Remove Papeletas Reportar create + Ventas inbox as primary

**Files:**
- Modify: `js/app/views/papeletas.js`

- [ ] **Step 1: Remove create Reportar UI**

Remove tab/mode that renders “Reportar daño / faltante” create form and `crearReporte` call sites from this view. Keep read-only chips/links for open reportes → `/app/reportes-danos/:id` or `?id=`.

Replace Ventas tab button with link:

```js
navigate('/app/reportes-danos');
```

Or remove `_mode === 'ventas'` UI entirely and rely on redirect.

- [ ] **Step 2: Commit**

```bash
git add js/app/views/papeletas.js
git commit -m "refactor(papeletas): remove Reportar create; link to Reportes SPA"
```

---

### Task 8: Polish, badges, mobile, bump SW, deploy

**Files:**
- Modify: `js/shell/shell-layout.js` (optional Reportes badge for Ventas+)
- Modify: CSS for mobile list/detail stacking
- `sw.js` via bump script

- [ ] **Step 1: Optional badge** — count `status == abierto` for users with `manage_papeletas_ventas`; setBadge(`reportes-danos`, n).

- [ ] **Step 2: Mobile** — list full width; detail as drawer/full screen under ~768px; create form single column.

- [ ] **Step 3: Acceptance smoke**

Notas: nav label, no board/assign/comments/SLA, follow persists, `?mva=` works, `/app/incidencias` redirects.  
Reportes: create without papeleta, diagram marks saved, promote/close, Papeletas has no Reportar create, `/app/papeletas/ventas` redirects.

- [ ] **Step 4: Closeout**

```bash
node scripts/bump-sw.js
git add -A
git commit -m "chore: bump SW after Notas slim + Reportes de daños"
git push
npm run deploy
```

---

## Self-review vs spec

| Spec requirement | Task |
|------------------|------|
| Notas rename + `/app/notas` | Task 2 |
| Slim UI; keep seguidores | Task 3 |
| Fix seguidores strip bug | Task 1 |
| mexPerms create/edit/delete | Task 3 |
| Reportes SPA routes + nav below Notas | Task 6 |
| Create only in Reportes; diagram marks | Task 6 |
| Optional `papeletaId`; `danosMarcados` | Task 5 |
| Lifecycle A promote/close | Tasks 5–6 |
| Remove Papeletas Reportar create | Task 7 |
| Redirects incidencias + ventas | Tasks 2, 6 |
| No collection rename / no zone vectors / unit notes separate | Global constraints |
| Deep links mapa/expediente | Task 4 |
| Bump SW + deploy | Task 8 |

**Placeholder scan:** none intentional.  
**Type consistency:** `danosMarcados` / `papeletaId` / `seguidores` names match spec + diagram module.
