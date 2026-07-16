# Editor de mapa profesional — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Design note:** `docs/superpowers/specs/2026-07-15-editor-mapa-profesional-design.md`  
> **Vault:** `MapGestion/NUEVO EDITOR DE MAPA. MAS PROFESIONAL Y MAS HERRAMIENTAS..md` (screenshot + “MEJORAR ESTO / herramienta más profesional”)  
> **Related backlog:** F-5 in `docs/superpowers/plans/2026-07-15-complemento-tsd-operacion-flota.md`

**Goal:** Convert the map layout editor from a toy-like iframe modal into a professional ops tool at `/app/editmap` — same data contracts, all existing capabilities preserved, faster load/interaction, ESTILO.md visuals, then prioritized new tools.

**Architecture:** Keep Firestore contracts (`obtenerEstructuraMapa` / `guardarEstructuraMapa` + optional `mapEditorExtras`). Replace the SPA iframe wrapper with a **native** view that hardens `js/app/features/mapa/mapa-visual-editor.js` (mapviz) and ports every legacy editor action from `js/views/mapa.js` (~L17400–18370). Leave `/editmap` as fallback until parity sign-off. Do not grow the mapa monolito further for editor UI.

**Tech Stack:** Vanilla ES modules, Firestore, Inter + `material-symbols-outlined`, CSS in `css/app-editmap.css` (new) + pruned mapviz rules in `css/app-mapa.css`, feature gate `edicion_mapa`, no bundler.

## Global Constraints

- Follow `ESTILO.md`: Inter 400–700; accent `#3b82f6`; spacing 4px grid; radii 4/8/12/16/9999; CSS variables; no purple toys; no `font-weight: 800/900`; icons = Material Symbols Outlined only.
- Preserve payload fields already persisted by `api/mapa.js` `guardarEstructuraMapa` (including zone, reserved/blocked, metadata, etc.).
- Feature gate: route already has `feature: 'edicion_mapa'` in `js/app/router.js`.
- Do not deploy without `npm run deploy` (SW bump) when shipping UI.
- Desktop-first (≥1024px); mobile may show “abre en escritorio” (mapviz already does).
- No commit unless the user asks.

---

## 0. File map (create / modify)

| Path | Role |
|---|---|
| `js/app/views/editmap.js` | **Replace** iframe mount with native editor mount/unmount |
| `js/app/features/mapa/mapa-visual-editor.js` | Primary editor engine (extend to full parity) |
| `js/app/features/mapa/mapEditorViewConfig.js` | View tabs / storage fields (keep; gate by `tipoNegocio`) |
| `js/app/features/mapa/mapViewVisibility.js` | Visibility helpers (keep) |
| `css/app-editmap.css` | **Create** — ESTILO-compliant editor chrome (route stylesheet) |
| `css/app-mapa.css` (`.mapviz*`) | Align / share tokens with `app-editmap.css` or import shared partial |
| `js/app/router.js` | Point `/app/editmap` styles to `app-editmap.css`; keep feature gate |
| `js/app/route-resolver.js` | Keep mapping; later set notes if full native |
| `editmap.html` + `js/views/editmap.js` | Fallback only during migration; optional thin banner “versión clásica” |
| `js/views/mapa.js` editor block | Freeze behavior; eventually call into shared module or delete after parity |
| `mapa/features/extras/editmap-inline.js` | Either implement as re-export of shared module or delete placeholder when native ships |
| `css/editmap.css`, `css/mapa.css`, `css/config.css` editor sections | Stop extending; mark deprecated once native CSS owns the look |
| `domain/mapa.model.js` | Already has extended types — reuse |
| `api/mapa.js` | Already supports extras + `duplicarEstructuraMapa` — wire UI |

---

## 1. Honest assessment — why it looks “juguete”

1. **Onboarding chrome as permanent UI:** `.editor-help-strip` / `.editor-help-card`, pulsing `.editor-live-pill`, yellow add-hints — perpetual tutorial overlay.
2. **Consumer gradients & pills:** tool buttons `border-radius: 999px`, green gradient save, purple multi-select/snap (`#a855f7`), hover lift shadows — game HUD, not ops console.
3. **Toy canvas stage:** floating rounded board (`border-radius: 34px`), soft pastel washes, car icon playfulness, glass floating inspector overlapping the work area.
4. **Typography / icon system drift:** Material Icons + weight 800/900 + ALL CAPS “EDITOR DE MAPA” / “GUARDAR CAMBIOS” vs ESTILO (Symbols, ≤700, sentence case).
5. **Bolted-on architecture:** `/app/editmap` only iframes `/editmap`, which boots `mapa.js` (~25k lines) to open a modal — slow, double topbars, feels like a demo page.
6. **Incomplete tool depth:** advanced model fields exist in data but not in UI; no undo; full DOM rebuild on interactions → feels fragile.

---

## 2. Inventory — ALL existing functions (must keep)

### 2.1 Routing / shell

| Capability | Where |
|---|---|
| SPA route `/app/editmap` + redirect `/app/mapa/editor` | `js/app/router.js` |
| Feature gate `edicion_mapa` | router + feature-gates |
| Nav item “Editor de mapa” | `js/shell/navigation.config.js` |
| Plaza sync from App Shell | `js/app/views/editmap.js` `onPlazaChange` |
| Legacy standalone `/editmap` + `/editmap/PLAZA` | `editmap.html`, `js/views/editmap.js` |
| Auth / plaza resolve / bootstrap programmer path | `js/views/editmap.js` |
| Open editor modal from mapa tools | `abrirEditorMapa` in `js/views/mapa.js`; also `openEditor` → mapviz in `mapa-official-tools.js` |

### 2.2 Data I/O

| Capability | API |
|---|---|
| Load structure | `obtenerEstructuraMapa(plaza)` |
| Save structure | `guardarEstructuraMapa(elementos, plaza, options?)` |
| Normalize legacy grid → absolute | `_normalizarEstructuraMapa` / `resolveEstacionamientoStructure` / `domain/mapa.model.js` `normalizarElemento` |
| Persist extras (backgrounds, etc.) | `options.mapEditorExtras` → `mapa_config` |
| Duplicate plaza structure (API exists, weak/no UI in legacy) | `duplicarEstructuraMapa` |

### 2.3 Tools / editing (legacy modal — production)

| # | Capability | Entry points |
|---|---|---|
| 1 | Add mode: cajón / área / etiqueta (click empty canvas) | `modoAgregarEditor`, `_edClickLibre` |
| 2 | Templates: Fila×3, Rect H (toolbar) | `editorAgregarForma('fila-3'|'rect-h')` |
| 3 | Templates from “Más”: cuadrado, rect-v, rect-grande | `editorAgregarForma` |
| 4 | Select single | `_edSelectCelda` |
| 5 | Multi-select Shift/Ctrl/Cmd + toggle | `_edToggleSelection` |
| 6 | Marquee rect select | `_edRectSel` in `_bindEditorDragResize` |
| 7 | Drag move + snap guides | `_edDrag`, `_edComputeSnap`, `_edDrawGuides` |
| 8 | 8-handle resize | `_edResize` |
| 9 | Rotate handle | `_edRotate` |
| 10 | Inspector: nombre, tipo, x, y, width, height, rotation | `editorPropChange`, `_edFillSelectionForm` |
| 11 | Size steppers ±10 | `editorSpanChange` |
| 12 | Arrow-pad nudge (10px) | `editorMoverCelda` |
| 13 | Duplicate selection | `editorCopiarCelda` |
| 14 | Delete selection | `editorEliminarCelda` |
| 15 | Duplicate row (Y-tolerance) | `editorDuplicarFila` |
| 16 | Align group (L/C/R/T/M/B) | `editorAlinearGrupo` |
| 17 | Distribute H/V (≥3) | `editorDistribuirGrupo` |
| 18 | Center H/V on canvas | `editorCentrarH`, `editorCentrarV` |
| 19 | Z-order: bring front / send back | `editorTraerFrente`, `editorEnviarFondo` |
| 20 | Zoom − / + / 1:1 | `editorZoom` |
| 21 | Context / “…” menu | `_edOpenMoreMenuAt`, `editorToggleMoreMenu` |
| 22 | Save + toast + (mapa) redraw / (standalone) stay open | `guardarMapaEditor` |
| 23 | Empty-map guard | save rejects empty |
| 24 | Loading / error states | `abrirEditorMapa` |
| 25 | HUD: selection summary, add hint, piece count | `_edSyncEditorHud` |

### 2.4 Fields loaded today (must not drop on save)

Even if UI incomplete, round-trip must keep:  
`valor, tipo, esLabel, orden, x, y, width, height, rotation, zone, subzone, isReserved, isBlocked, isTemporaryHolding, allowedCategories, priority, googleMapsUrl, pathType` (+ mapviz extras: `metadata, nombrePublico, …` when present).

### 2.5 mapviz-only today (not on `/app/editmap` yet — absorb carefully)

Undo/redo, multi-view tabs, background image upload, richer tool palette (camino, entrada, buffer, bloque 2×5, fila×5), flip H, visibility-by-view, dirty status, export JSON (PROGRAMADOR), focus mode.

**Parity rule:** shipping native `/app/editmap` requires checklist §2.3 complete; mapviz extras may land in same or later phases but must not replace §2.3 items.

---

## 3. UX/UI redesign (ops tool, ESTILO.md)

### 3.1 Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Topbar: Plaza · status (Guardado|Sin guardar) · Undo Redo · Guardar · Cerrar │
├────────┬───────────────────────────────────────────┬─────────┤
│ Tools  │ Canvas (grid, pan/zoom)                   │ Inspect │
│ rail   │                                           │ or      │
│        │                                           │ empty   │
├────────┴───────────────────────────────────────────┴─────────┤
│ Footer: N piezas · selección · zoom % · tip (one line, static) │
└──────────────────────────────────────────────────────────────┘
```

- No floating help cards; one optional collapsed “Atajos” disclosure in footer.
- Inspector docked right (not floating glass card).
- Selection actions (copy/delete/align) as dense icon toolbar under inspector header or above canvas — not scattered floaters.

### 3.2 Visual tokens (implement in `css/app-editmap.css`)

- Background: `var(--bg)` / canvas `#0f172a` (slate-900).
- Surfaces: `var(--surface)`; borders `var(--border)`.
- Primary button: `--accent` (blue), not emerald gradient.
- Snap guides: `--accent` dashed 1px (replace purple).
- Selection outline: `--accent` 2px; multi: `--accent-light` dashed.
- Cells: flat fills by type (cajón accent-pale, área slate, label muted) — no toy pulse.
- Icons: `material-symbols-outlined` 18–20px.
- Controls height 36px dense; radius 8px buttons / 12px panels.

### 3.3 Copy

- Title: “Editor de mapa” (not ALL CAPS).
- Save: “Guardar”.
- Tools: “Cajón”, “Área”, “Etiqueta”, “Fila ×3”.

---

## 4. Performance plan

| Problem | Fix | Done-when |
|---|---|---|
| `/app/editmap` loads iframe + full `mapa.js` | Native view imports only `mapa-visual-editor.js` (+ api/domain) | Network: no `mapa.js` on editmap route |
| `_renderEditorCanvas` clears `innerHTML` every select/resize | Split `renderStructure()` vs `updateSelectionChrome()` vs drag style mutation | Dragging 100+ cells: no full rebuild on mousemove |
| Resize path calls full re-render | Update element dimensions in place until mouseup | Same as above |
| Snap O(n²) guides every move | Spatial hash or only compare nearby cells; throttle SVG guide redraw to rAF | 200 cells stay smooth |
| Save deletes+rewrites all docs | Keep existing API for now; optional later: diff write (P2) | No regression on save |
| Fonts: Inter + Icons already on app shell | Reuse shell fonts; don’t load Material Icons in native | No extra icon font on route |

**Target budgets (manual):** first interactive &lt; 1.5s on warm cache; drag frame work &lt; 8ms for 150 cells.

---

## 5. New tools / features (prioritized)

Grounded in vault (“más profesional y más herramientas”), gaps vs legacy+mapviz, and gaps vs professional layout editors.

### P0 — Must ship with native redesign

| ID | Feature | Rationale |
|---|---|---|
| P0-1 | Native `/app/editmap` (no iframe) | Speed + professional shell integration |
| P0-2 | ESTILO chrome (layout + CSS) | Fixes “juguete” look |
| P0-3 | Incremental canvas updates | Interaction latency |
| P0-4 | Undo / redo (stack ≥40) | Expected in any pro editor; mapviz has seed |
| P0-5 | Dirty flag + beforeunload / navigate confirm | Prevent silent loss |
| P0-6 | Keyboard shortcuts (Esc, Del, arrows, Ctrl+Z/Y/D, Ctrl+S) | Power-user ops |
| P0-7 | Inspector: zone, subzone, isReserved, isBlocked, isTemporaryHolding, allowedCategories (CSV or chips) | Fields already in model unused in UI |
| P0-8 | Full §2.3 parity vs legacy | Non-negotiable |

### P1 — High value after parity

| ID | Feature | Rationale |
|---|---|---|
| P1-1 | Plantillas: Fila ×N (prompt/input), Bloque C×R | Faster yard build |
| P1-2 | Auto-renumerar cajones (prefijo + start) | Ops naming |
| P1-3 | UI “Duplicar estructura a otra plaza” | API exists |
| P1-4 | Background image (Storage) + opacity/fit/lock | Trace over real patio photo — mapviz seed |
| P1-5 | Types for estacionamiento: `camino`, `entrada`, `buffer` | Circulation / blocked zones |
| P1-6 | Grid snap toggle + snap size (10/20) | Precision |
| P1-7 | Lock element (`locked`) | Prevent accidental moves |

### P2 — Later / tipoNegocio-dependent

| ID | Feature | Rationale |
|---|---|---|
| P2-1 | Multi-view tabs (global / mesas / albercas) gated by `tipoNegocio` | mapviz already sketches park use-cases |
| P2-2 | Layer visibility filters | Large maps |
| P2-3 | JSON import/export (PROGRAMADOR) | Support / migration |
| P2-4 | Measure ruler / distance readout | Layout QA |
| P2-5 | Diff-save to Firestore | Write cost / conflict safety |
| P2-6 | Extract shared engine; delete dead iframe path | Debt cleanup |

---

## 6. Phased delivery

### Fase 0 — Freeze & audit (0.5–1 day)

**Files:** this plan; optional spreadsheet in vault.

- [ ] **Step 0.1:** Walk production `/app/editmap` and tick §2.3 checklist with screenshots (before).
- [ ] **Step 0.2:** Confirm feature gate `edicion_mapa` and roles that see nav.
- [ ] **Step 0.3:** Note `tipoNegocio` of primary tenants (estacionamiento vs parque) — gates P2-1.

**Done-when:** Written “before” checklist attached to PR description / vault note. No code required.

**Risks:** Skipping audit → silent feature loss.

---

### Fase 1 — Visual professionalization on current stack (1–2 days) — optional quick win

> Ship only if native (Fase 2+) slips; otherwise fold CSS into Fase 2.

**Files:** `css/editmap.css`, `css/config.css` (editor sections), `editmap.html` (icon class names).

- [ ] Replace Material Icons → `material-symbols-outlined` in `editmap.html` editor chrome.
- [ ] Remove `.editor-help-strip` from DOM (or `display:none` permanently).
- [ ] Restyle header tools: no pills; dense 36px; accent blue save (not green).
- [ ] Snap/selection colors → accent blue; kill pulse animations.
- [ ] Reduce canvas stage radius to 12–16px; flatten background.

**Done-when:** Side-by-side screenshot vs ESTILO; no purple/pulse; save button blue.

**Risks:** Dual CSS (`mapa.css` + `config.css` + `editmap.css`) fights — prefer overriding in `editmap.css` with higher specificity under `body[data-editmap-standalone]`.

---

### Fase 2 — Native route + engine baseline (3–5 days)

**Files:**  
- Modify: `js/app/views/editmap.js`, `js/app/router.js` (`ROUTE_STYLES`), `js/app/features/mapa/mapa-visual-editor.js`, `js/app/features/mapa/mapa-official-tools.js`  
- Create: `css/app-editmap.css`  
- Keep: legacy `/editmap` fallback

- [ ] **Step 2.1:** Rewrite `js/app/views/editmap.js` `mount` to:
  - resolve plaza from `getCurrentPlaza()` / profile
  - call `openVisualMapEditor({ container, api: window.api, snapshot, ctx, resync })` **or** embed editor inline without modal overlay (preferred: fill shell main)
  - `unmount` closes editor and removes listeners
- [ ] **Step 2.2:** Adapt `openVisualMapEditor` to support `mode: 'page'` (no dialog overlay; fills container 100%).
- [ ] **Step 2.3:** Load structure via `api.obtenerEstructuraMapa(plaza)` on mount; show loading state in page chrome.
- [ ] **Step 2.4:** Add `css/app-editmap.css`; register in `ROUTE_STYLES['/app/editmap']`; remove dependency on `app-legacy-stage.css` for this route.
- [ ] **Step 2.5:** Ensure `mapa-official-tools.openEditor` uses the same page mode or navigates to `/app/editmap` (one engine).
- [ ] **Step 2.6:** Manual: open `/app/editmap` — **no** iframe, **no** `mapa.js` in Network.

**Done-when:** Native editor visible in App Shell; save round-trips; plaza change reloads structure; legacy `/editmap` still works.

**Risks:** mapviz assumes park multi-view — default `activeView = 'estacionamiento'` and hide tabs unless enabled.  
**Risks:** iframe pool in `legacy-stage.js` still lists editmap — SPA view path bypasses it (OK); don’t break deep links.

---

### Fase 3 — Parity port (§2.3) (3–5 days)

**Files:** `mapa-visual-editor.js` (primary), possibly extract `js/app/features/mapa/editmap-engine.js` if file &gt; ~1.2k lines.

Port any missing legacy behaviors into the engine:

- [ ] Click-to-place add modes (cajón/área/etiqueta) matching legacy
- [ ] Marquee multi-select
- [ ] Snap guides during drag
- [ ] 8-handle resize + rotate
- [ ] Align 6-way + distribute H/V
- [ ] Duplicate row (Y tolerance)
- [ ] Z-order front/back
- [ ] Center H/V on canvas
- [ ] Context menu parity
- [ ] Arrow nudge + size steppers
- [ ] Templates fila-3 / rect variants

**Done-when:** §2.3 checklist 100% on native route; QA script (manual) signed.

**Risks:** Subtle behavioral diffs on snap/tolerance — document constants (`SNAP_TOL=6`, `ROW_TOL=20`, `NUDGE=10`) matching legacy.

---

### Fase 4 — Performance + P0 polish (2–3 days)

**Files:** `mapa-visual-editor.js` / `editmap-engine.js`, `css/app-editmap.css`

- [ ] Incremental DOM: create cell nodes once; update `style.left/top/width/height/transform` on drag/resize
- [ ] Full rebuild only on add/delete/type-change/reorder
- [ ] rAF-throttle guides
- [ ] Undo/redo wired to all mutations; Ctrl+Z/Y
- [ ] Dirty + `mexConfirm` on navigate/close; `beforeunload` when dirty
- [ ] Keyboard: Esc, Delete, arrows, Ctrl+D, Ctrl+S
- [ ] Inspector P0-7 fields; persist on save
- [ ] ESTILO pass complete (Symbols, weights, radii, blue accent)

**Done-when:** 150-cell patio drag stays smooth; undo works; unsaved warning fires; inspector shows zone/blocked.

**Risks:** Undo stack memory — cap 40–45 deep clones (already in mapviz).

---

### Fase 5 — P1 tools (3–4 days)

**Files:** engine + inspector + `api/mapa.js` (already has duplicate)

- [ ] Fila ×N / Bloque C×R UI
- [ ] Renumber dialog
- [ ] Duplicate plaza modal (list plazas user can write)
- [ ] Background image upload (reuse mapviz Storage path)
- [ ] Types camino / entrada / buffer in estacionamiento palette
- [ ] Grid snap toggle + size
- [ ] Lock checkbox

**Done-when:** Each P1 item demoable on staging plaza without breaking cajón occupancy on mapa operativo.

**Risks:** New types must remain non-occupiable in mapa renderer (`esCajonOcupable`) — verify `domain/mapa.model.js` + SPA/legacy renderers ignore non-cajón for units.

---

### Fase 6 — P2 + deprecate iframe (2–4 days, can split)

- [ ] Gate multi-view tabs by `window._empresaActual.tipoNegocio` (or feature flag)
- [ ] Layer filters
- [ ] PROGRAMADOR JSON import/export
- [ ] Optional measure tool
- [ ] Remove iframe implementation from `js/app/views/editmap.js` permanently
- [ ] Implement or delete `mapa/features/extras/editmap-inline.js` placeholder
- [ ] Update `docs/app-real-view-migration-status.md` + vault note with “after” screenshots
- [ ] Soft-deprecate `/editmap` (keep technical fallback 1 release)

**Done-when:** Docs updated; placeholder gone; `/app/editmap` is sole recommended path.

---

## 7. Testing strategy (no automated suite yet)

Manual matrix (record in PR):

| Case | Expect |
|---|---|
| Load plaza with 0 cells | Empty canvas; cannot save empty (or allow empty only with confirm — keep legacy reject) |
| Load 80–150 cajones | All visible; zoom works |
| Add / move / resize / rotate / save / reload | Positions persist |
| Multi-align + distribute | Matches legacy |
| Occupied cajón rename | Units still resolve by `valor` — **warn** if renaming occupied codes |
| Feature gate off | Route blocked / nav hidden |
| Plaza switch in shell | Editor reloads other plaza; dirty warns first |
| Open from mapa “editor” tool | Same engine / navigates to `/app/editmap` |
| Legacy `/editmap` fallback | Still opens until Fase 6 |

Optional smoke: extend `scripts/test-mapa.js` with a gated `/app/editmap` visit (login + feature) — only after native mount is stable.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Feature regression vs legacy | Fase 0 checklist + Fase 3 gate before killing iframe |
| Renaming cajón breaks unit positions | Confirm dialog listing occupied MVAs; or forbid rename when occupied |
| Multi-view confuses estacionamiento tenants | Hide tabs; default estacionamiento |
| CSS conflict App Shell vs editor | Isolated `app-editmap.css` under `.app-editmap` root class |
| mapviz park types leak into fleet maps | Tool palette filtered by view + tipoNegocio |
| Save cost / race | Keep single-writer UX; disable Save while `saving`; later P2-5 diff |

---

## 9. Suggested execution order (summary)

| Phase | Focus | Est. |
|---|---|---|
| **0** | Audit / freeze | 0.5–1 d |
| **1** | Optional CSS quick win on legacy | 1–2 d |
| **2** | Native `/app/editmap` + mapviz page mode | 3–5 d |
| **3** | Full §2.3 parity | 3–5 d |
| **4** | Perf + undo + keyboard + inspector P0 | 2–3 d |
| **5** | P1 tools | 3–4 d |
| **6** | P2 + deprecate iframe | 2–4 d |

**Critical path:** 0 → 2 → 3 → 4 (shippable professional editor). 1 optional. 5–6 incremental.

---

## 10. Top 5 priorities (executive)

1. **Native SPA editor** — kill iframe/`mapa.js` boot on `/app/editmap`.
2. **ESTILO ops chrome** — docked panels, blue accent, no toys/pulse/purple.
3. **Parity** — every legacy tool in §2.3 still works.
4. **Performance** — incremental DOM; usable at 150+ cells.
5. **Undo + dirty + keyboard + inspector for zone/blocked** — minimum “pro” behaviors.

---

## Self-review

- Vault request (“más profesional + más herramientas”) → Fase 1–4 visuals/engine + Fase 5–6 tools.
- All §2.3 functions listed with keep-guarantee.
- ESTILO constraints explicit in Global Constraints + §3.
- Performance has concrete file-level tactics.
- Phases have file paths + done-when + risks.
- No editor code implemented in this task (plan only).
