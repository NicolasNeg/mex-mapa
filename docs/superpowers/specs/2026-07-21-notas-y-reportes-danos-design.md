# Design: Notas slim + Reportes de daños SPA

**Date:** 2026-07-21  
**Status:** Approved  
**Approach:** 1 — UI surgery on `notas_admin` + new Reportes SPA (additive)  
**Related:** `ESTILO.md`, `docs/superpowers/specs/2026-07-20-papeletas-digitales-design.md`, `js/app/views/incidencias.js`, `js/app/features/papeletas/*`

---

## 1. Context

MapGestion today mixes two different jobs under “incidencias / ventas”:

| Job | Current home | Data |
|-----|--------------|------|
| Operational bitácora (notes, follow-ups) | `/app/incidencias` SPA + legacy `/incidencias` kanban | Collection `notas_admin` |
| Damage / missing-item cases for Ventas | Tab **Reportar** + route `/app/papeletas/ventas` inside Papeletas | Collection `papeletas_reportes` |

The incidencias SPA grew into a heavy board (kanban, assignee, thread comments, SLA KPI placeholders) while the only collaboration piece operators actually need is **seguidores (watchers)**. Meanwhile damage reporting is buried inside Papeletas and requires a papeleta context, so patio cannot open a standalone damage case without going through the delivery/return wizard.

This redesign keeps one collection for notes (`notas_admin`), slims that UI into a simple bitácora, and extracts damage reporting into its own SPA. Unit-level gestor notes on the fleet document (`notas` + `notaAutor` / `notaFecha`) stay untouched and separate.

**Inspiration only:** Obsidian-style calm list + detail density. Visual system remains MapGestion / `ESTILO.md` (Inter, accent `#3b82f6`, Material Symbols Outlined). Do not port Obsidian chrome, purple themes, or foreign fonts.

---

## 2. Non-goals

- Renaming Firestore collection `notas_admin` or migrating docs to a new `incidencias` collection.
- Vectorized / polygon zone picker on the car diagram (stay with form fields + diagram marks from `papeletas-diagram`).
- Heavy offline-first sync for Notas or Reportes.
- Migrating the legacy kanban page (`incidencias.html` / `plazas/{plaza}/incidencias`) into the App Shell as a board.
- Merging unit gestor notes (`notaAutor` / `notaFecha` on flota) into `notas_admin`.
- Auto WhatsApp / email for damage cases.
- Replacing Papeletas salida/entrada diagram capture (Papeletas keeps its own marks; Reportes reuses the diagram module for **report** capture only).

---

## 3. Locked decisions

| Tema | Decisión |
|------|----------|
| Approach | **1** — surgery on existing Notas/`notas_admin` + **additive** Reportes SPA |
| Sidebar | **Notas** (rename) + **Reportes de daños** immediately below it (new SPA) |
| Notas product | Simpler bitácora; **KEEP** seguidores/watchers; **DROP** kanban UI, `asignadoA` UI, comentarios UI, SLA KPIs |
| Notas API bug | Fix so `seguidores` are not stripped on save/normalize |
| Unit notes | Stay separate; `notaAutor` / `notaFecha` already shipping |
| Reportes create | **Only** from the new SPA; remove **Reportar** tab from Papeletas |
| Capture | Form + diagram marks via `papeletas-diagram`; no vectorized zone picker yet |
| Lifecycle | **A** — `abierto` → promote / close (same semantics as current Ventas bandeja) |
| Persistence | Keep `papeletas_reportes`; `papeletaId` **optional**; extend docs with `danosMarcados` |
| Redirects | `/app/incidencias` → `/app/notas`; `/app/papeletas/ventas` → `/app/reportes-danos` |
| Visual | `ESTILO.md` only; Obsidian = UX density inspiration, not a skin |
| Build order | Notas slim → Reportes SPA → redirects / polish |

---

## 4. Notas — UX

### 4.1 Product shape

**Notas** is a plaza-scoped bitácora: create notes, filter/search, open detail, resolve/close, attach evidence, follow/unfollow.

**Primary layout:** list (or compact table) + detail panel/drawer. Default view mode is **list**. Board/kanban toggle is removed.

### 4.2 Keep

- Create note: título, descripción (plain + optional HTML already supported), prioridad, tipo, MVA (optional), plaza, adjuntos/links.
- Prefill MVA from query: `/app/notas?mva=XXXX` (same behavior as today’s `/app/incidencias?mva=`).
- Estados operativos already in data: `PENDIENTE`, `EN_PROCESO`, `RESUELTA` / closed aliases, `ADJUNTO`.
- Resolve flow (`solucion`, `quienResolvio`, `resueltaEn`).
- Delete for roles that already can (`delete_incidencia`).
- **Seguidores / watchers:** list avatars, follow/unfollow self, persist on the note document.
- Sidebar badge = open/pending notes in current plaza (same listener idea as today on `notas_admin`).
- Deep links from mapa / expediente unit summary (“Ver bitácora”) updated to `/app/notas?mva=…`.

### 4.3 Drop from UI (this phase)

| Surface | Action |
|---------|--------|
| Kanban / board view | Remove view toggle and board renderer |
| `asignadoA` picker / pills / “sin asignar” tab | Remove from create + detail + filters |
| Comentarios thread UI | Remove composer and timeline of `comentarios` |
| SLA KPI cards / “SLA crítico” rails | Remove placeholder metrics |

Existing Firestore fields `asignadoA` and `comentarios` may remain on old documents for read compatibility; the slim UI neither displays nor writes them. No migration job to delete those fields.

### 4.4 Information hierarchy

1. Title + priority chip + estado  
2. MVA / tipo / autor / fecha  
3. Body + attachments  
4. Seguir / Dejar de seguir  
5. Resolve actions (permission-gated)

Header stays light: search, priority/estado/tipo filters, “Mis notas” / “Todas” / “Sigo” tabs are allowed; no fake SLA strip.

---

## 5. Notas — data

### 5.1 Collection

- **Canonical:** `notas_admin` (`COL.NOTAS`).
- **No rename** in this project.

### 5.2 Document fields (write path for slim UI)

| Field | Role |
|-------|------|
| `titulo`, `descripcion` / `nota`, optional `descripcionHtml` | Content |
| `prioridad`, `tipo`, `estado`, `chipLabel` | Classification |
| `mva`, `plaza` | Scope |
| `autor` / `creadoPor`, `timestamp`, `fecha`, `codigo` | Provenance |
| `adjuntos` (+ legacy evidence aliases on read) | Files/links |
| `seguidores[]` | `{ uid, email, nombre, rol? }` — **must persist** |
| `solucion`, `quienResolvio`, `resueltaEn`, `version` | Resolution |

### 5.3 Seguidos bug (must fix)

Today `_buildIncidentPayload` / `_normalizeIncidentRecord` in `mex-api.js` rebuild a whitelist that **omits** `seguidores` (and also drops `asignadoA` / `comentarios` on normalize). Live subscription via `suscribirNotasAdmin` therefore returns notes **without** watchers even if Firestore has them. Create via `guardarNuevaNotaDirecto` also never stores initial `seguidores`.

**Fix requirements:**

1. Preserve `seguidores` (and pass-through unknown safe fields as needed) in `_normalizeIncidentRecord` so subscribers see watchers.
2. Allow create/update paths to write `seguidores` when provided.
3. Keep `toggleSeguidor` in `incidencias-data.js` (or renamed notas module) as the mutation for follow/unfollow; do not rely on full-document replace that strips the array.
4. Self-check: create note → follow → reload / new snapshot → watcher still present.

### 5.4 Unit gestor notes (out of this module)

Fleet unit fields `notas`, `notaAutor`, `notaFecha` (cuadre / mapa gestor) remain the short operational note on the unit document. Notas SPA does not read or write those fields. Cross-link UX may say “nota de unidad” vs “bitácora” where helpful, without merging models.

---

## 6. Reportes de daños — UX

### 6.1 Product shape

New SPA **Reportes de daños** (`/app/reportes-danos`):

- **Inbox** for Ventas+: list open / promovido / cerrado cases, filters by plaza, MVA, tipo (`dano` | `faltante`), status.
- **Create** for patio (and anyone with create access): standalone form — no papeleta wizard required.
- **Detail:** photos, diagram marks, notes, optional link to papeleta if `papeletaId` set, promote + close actions.

### 6.2 Create flow (only here)

1. User opens Reportes → **Nuevo reporte**.
2. Selects unidad (MVA / placas / modelo) and plaza.
3. Chooses tipo: daño or faltante.
4. Fills short description / items faltantes as applicable.
5. Captures evidence: fotos (placas + VIN required for new damage cases, matching current Ventas rules) + damage photos.
6. Marks diagram using shared `papeletas-diagram` (strokes + typed `danosMarcados`); **not** a vectorized zone map.
7. Optional: attach existing `papeletaId` if known; otherwise leave empty.
8. Save → `papeletas_reportes` with `status: abierto`.

**Remove** from Papeletas UI: the **Reportar** tab / create-reporte entry points that open the damage form inside the papeleta detail. Papeletas may still **show** linked open cases (read-only chip / link to `/app/reportes-danos?id=…`) but must not create new reportes.

### 6.3 Lifecycle A (unchanged semantics)

```
abierto ──► promovido ──► cerrado
   │                         ▲
   └─────────────────────────┘  (close without promote still allowed for Supervisor+)
```

| Status | Meaning | Who |
|--------|---------|-----|
| `abierto` | New case; temp Storage under `papeletas_reportes/{id}/…`; `expiresAt` ~24h until promoted | Create: patio with module access |
| `promovido` | Evidence copied to `papeletas_ventas/{id}/…`; TTL cleared | Ventas+ (`manage_papeletas_ventas` or equivalent) |
| `cerrado` | Case done | Supervisor+ (`rolPuedeCerrarCaso`) |
| `descartado` | Only if explicitly kept for “already on salida” edge cases when a linked papeleta proves preexisting damage | System / create path |

Promote and close reuse existing helpers in `papeletas-reportes-data.js` (`promoverReporte`, `cerrarCaso`), extended as needed for optional `papeletaId` and `danosMarcados`.

When `papeletaId` is present and no other open reportes remain for that papeleta, closing may still flip papeleta to `cerrada_historial` (current behavior). When `papeletaId` is absent, close only updates the reporte document.

### 6.4 Capture details

- Reuse `js/app/features/papeletas/papeletas-diagram.js` for mark UI and serialization.
- Persist `danosMarcados` on the reporte document (array of mark objects as produced by the diagram module).
- Persist photo paths on `fotos: { placas, vin, danos[] }` as today.
- Do not implement polygon/zone vector picking in this phase.

---

## 7. Reportes — data

### 7.1 Collection

Keep **`papeletas_reportes`** (`COL.PAPELETAS_REPORTES`). Name stays for Storage/rules continuity even though create moves out of Papeletas UI.

### 7.2 Document shape (extended)

| Field | Required | Notes |
|-------|----------|-------|
| `unidadId`, `mva`, `plazaId` | Yes (mva/plaza for list filters) | From unit picker |
| `tipo` | Yes | `dano` \| `faltante` |
| `status` | Yes | `abierto` \| `promovido` \| `cerrado` \| `descartado` |
| `fotos` | Yes for new `dano` | placas + vin + ≥1 daño photo |
| `danosMarcados` | Recommended | Diagram marks; default `[]` |
| `itemsFaltantes` | When tipo faltante | string[] |
| `zonasNuevas` | Optional | Legacy zone ids if still useful; not the primary capture UX |
| `papeletaId` | **Optional** | Empty string / omit when standalone |
| `descripcion` / `nota` | Optional | Short free text |
| `creadoAt`, `creadoPor`, `expiresAt` | Yes on create | Same TTL pattern |
| `promovidoAPath`, `promovidoAt` | On promote | |
| `cerradoAt`, `cerradoPor` | On close | |

`crearReporte` must be generalized: today it requires `papeleta` object; new path accepts unidad snapshot + optional `papeletaId` without loading a full papeleta when absent. Preexisting-damage auto-discard only runs when a papeleta (and its salida zonas/marks) is available.

### 7.3 Storage

Unchanged roots:

- Temp: `papeletas_reportes/{reporteId}/…`
- Permanent after promote: `papeletas_ventas/{reporteId}/…`

---

## 8. Navigation, routes, permissions

### 8.1 Sidebar

Under the operational block, in this order:

1. **Notas** — icon e.g. `sticky_note_2` or keep `warning` only if product prefers continuity; label **Notas** (not “Notas e incidencias”).
2. **Reportes de daños** — icon e.g. `car_crash` / `report`; new item **directly below** Notas.

Papeletas entry remains separate and no longer hosts the Ventas damage inbox as primary navigation.

### 8.2 Routes

| Route | Role |
|-------|------|
| `/app/notas` | Canonical Notas SPA (evolved from `js/app/views/incidencias.js`) |
| `/app/incidencias` | Client redirect → `/app/notas` (preserve query string) |
| `/incidencias` | Legacy URL: prefer redirect into `/app/notas` when App Shell is the entry; legacy HTML may remain until explicitly retired |
| `/app/reportes-danos` | Canonical Reportes SPA |
| `/app/papeletas/ventas` | Redirect → `/app/reportes-danos` (preserve query) |
| `/app/papeletas` | Papeletas only (salida/entrada); no Reportar create tab |

Update `ROUTE_MAP` / `ROUTE_TABLE` / `navigation.config.js` / title maps accordingly. `navRoute` for Notas highlights the Notas sidebar id; Reportes highlights its own id.

### 8.3 Feature gates & permissions

| Concern | Gate / permission |
|---------|-------------------|
| Notas module visibility | Existing feature `incidencias` (no rename required) + `view_incidencias` |
| Create / edit / delete notes | Existing `create_incidencia`, `edit_incidencia`, `delete_incidencia` |
| Reportes module visibility | Feature `papeletas` **or** same empresa flag used for papeletas ventas; show if user can view papeletas **or** manage ventas |
| Create reporte | Authenticated users with `view_papeletas` (patio create), same bar as today’s report-from-papeleta |
| Inbox / promote | `manage_papeletas_ventas` / `rolPuedeGestionarVentas` |
| Close case | `rolPuedeCerrarCaso` (Supervisor+) |

Programador / full-access roles bypass as elsewhere. Do not invent a second parallel permission matrix unless implementation discovers a hard conflict; prefer reuse.

### 8.4 Badges

- Notas badge: pending/open notes on `notas_admin` for current plaza.
- Reportes badge (optional polish): count of `status == abierto` visible to Ventas+; can ship in polish phase.

---

## 9. Migration & compatibility

### 9.1 Additive, not big-bang

1. Slim Notas UI + fix `seguidores` persistence while route may still be `/app/incidencias` briefly **or** mount the same view on `/app/notas` first.
2. Ship Reportes SPA reading/writing `papeletas_reportes`; migrate create UX out of Papeletas.
3. Add redirects + sidebar rename/order + link sweep (mapa, expediente, home cards, papeletas Ventas buttons).

### 9.2 Backward compatibility

- Old bookmarks to `/app/incidencias` and `/app/papeletas/ventas` keep working via redirects.
- Existing `papeletas_reportes` docs with required `papeletaId` remain valid; new docs may omit it.
- Old notes with `asignadoA` / `comentarios` remain in Firestore; slim UI ignores them.
- Legacy kanban (`incidencias.html`) is not the App Shell source of truth; no requirement to delete it in this phase, but it must not be linked from the new sidebar.

### 9.3 Code touch map (implementation guide)

| Area | Expected work |
|------|----------------|
| `js/app/views/incidencias.js` + `css/app-incidencias.css` | Slim UI; optionally rename files to `notas` in polish |
| `mex-api.js` `_buildIncidentPayload` / `_normalizeIncidentRecord` | Preserve `seguidores` |
| `js/app/features/incidencias/*` | Keep data layer; drop comment/assign call sites from UI |
| `js/app/views/reportes-danos.js` (new) + CSS | Inbox + create + detail |
| `papeletas-reportes-data.js` | Optional `papeletaId`; `danosMarcados`; create without full papeleta |
| `js/app/views/papeletas.js` | Remove Reportar create tab; link out to Reportes |
| Router / route-resolver / navigation / shell badges | Routes + labels + redirects |
| Mapa / expediente links | Point to `/app/notas` |

---

## 10. Acceptance criteria

### Notas

- [ ] Sidebar label is **Notas**; route `/app/notas` loads the slim bitácora.
- [ ] No kanban/board, no assignee UI, no comentarios UI, no SLA KPI strip.
- [ ] User can follow/unfollow; after refresh and onSnapshot, `seguidores` still present in UI and in Firestore.
- [ ] Create / resolve / attach / filter / `?mva=` prefill work as before for remaining fields.
- [ ] Unit gestor `notaAutor` / `notaFecha` behavior unchanged elsewhere.
- [ ] `/app/incidencias` redirects to `/app/notas` with query preserved.

### Reportes

- [ ] Sidebar shows **Reportes de daños** directly under Notas.
- [ ] User can create a reporte **without** a papeleta; document lands in `papeletas_reportes` with optional empty `papeletaId` and `danosMarcados` from diagram.
- [ ] Papeletas no longer offers a **Reportar** create tab; existing cases link to Reportes when needed.
- [ ] Ventas can promote and Supervisor+ can close with Lifecycle A semantics.
- [ ] `/app/papeletas/ventas` redirects to `/app/reportes-danos`.
- [ ] Visuals follow `ESTILO.md` (Inter, `#3b82f6`, Material Symbols); no Obsidian skin.

### Process

- [ ] Build order respected: Notas slim → Reportes SPA → redirects/polish.
- [ ] No collection rename; no zone vectorization; no heavy offline scope creep.

---

## 11. Build priority

1. **Notas slim + seguidores API fix**  
   Strip board/assign/comments/SLA UI; preserve watchers end-to-end; optionally register `/app/notas` early.
2. **Reportes SPA**  
   Inbox + create (form + `papeletas-diagram`) + detail promote/close; generalize `crearReporte`; remove Papeletas Reportar create.
3. **Redirects & polish**  
   `/app/incidencias` → `/app/notas`; `/app/papeletas/ventas` → `/app/reportes-danos`; sidebar order/labels; deep-link sweep; badges; CSS cleanup / optional file renames.

---

## 12. Open risks

| Risk | Mitigation |
|------|------------|
| `_normalizeIncidentRecord` stripping fields again on future payload refactors | Explicit regression test or assert in smoke notes: follow → subscribe → array length ≥ 1 |
| Optional `papeletaId` breaks `cerrarCaso` when it assumes papeleta always exists | Guard: only call `cerrarPapeletaHistorial` when `papeletaId` is non-empty and doc exists |
| TTL job deletes unpromoted standalone reportes | Keep 24h `expiresAt` behavior; educate Ventas to promote promptly; optional polish: longer TTL for standalone later |
| Duplicate create paths if Papeletas Reportar is only half-removed | Acceptance requires zero create entry points outside Reportes SPA |
| Users still open legacy `/incidencias` kanban | Sidebar and App redirects point to Notas; legacy page not advertised |
| Permission confusion between `view_incidencias` and `view_papeletas` | Document in UI empty-states; reuse existing gates; Programador bypass |
| Diagram module coupling to papeleta document shape | Pass plain `{ danosMarcados, strokes }` options; do not require a papeleta id inside the diagram helper |
| Name `papeletas_reportes` confusing after UI split | Accepted debt; rename out of scope |

---

## 13. Self-review checklist

- Approach 1 recorded; additive Reportes SPA.  
- Sidebar: Notas + Reportes de daños below.  
- Notas keep seguidores; drop kanban, asignadoA UI, comentarios UI, SLA KPIs.  
- API fix for seguidores called out against `_buildIncidentPayload` / normalize.  
- Unit `notaAutor` / `notaFecha` explicitly separate.  
- Reportes create only in new SPA; Papeletas Reportar create removed.  
- Capture = form + `papeletas-diagram` marks; no vector zones.  
- Lifecycle A; collection `papeletas_reportes`; optional `papeletaId`; `danosMarcados`.  
- Redirects and `ESTILO.md` visual rule included.  
- Build order and non-goals match approval.  
- No TBD placeholders left in this document.
