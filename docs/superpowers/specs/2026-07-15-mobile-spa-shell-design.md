# Design: Mobile SPA shell & view patterns

**Date:** 2026-07-15  
**Status:** draft for review (design/spec only — no implementation in this cycle)  
**Scope:** Reusable mobile rules for MapGestion SPA views (Traslados, Unidades, Cuadre, Turnos, and peers)  
**Authority:** `ESTILO.md` wins over taste-skill aesthetics. This is an **ops dashboard** (density ~7–8), not a landing page.

---

## Product intent

On phone/tablet, operators must see **list content first**, not a wall of empty search fields and stacked selects. Chrome must be predictable:

- **Footer** = primary navigation + “Más”
- **Header** = context only (title, plaza, bell, search icon, rare overflow)
- **Search** = icon-first; expand on demand (never a tall empty box owning the first viewport)
- **Filters** = chips in a single horizontal scroll row; advanced filters in a sheet
- **Primary actions** = one FAB or a compact icon/label toolbar — not four fat wrapping buttons

**Non-goals (this cycle):** redesign desktop (≥1025px) layouts; rebuild sidebar; change route map; implement per-view migrations (those follow an implementation plan after approval).

---

## Current reality (what hurts)

| Surface | Today | Pain |
|---|---|---|
| Shell header (`js/shell/header.js`) | Already has `#mexHdrSearchToggle` → expands `.mex-header-search.is-mobile-open` (≤1024px). Modes: `inpage` / `global`. | Views **ignore** it and ship their own full-width search. |
| Bottom nav (`js/shell/bottom-nav.js`) | Fixed: Inicio · Mapa · Cuadre · Más (≤1024px). Mapa→Config; Cuadre→Controles. | Header/`#mexHdrCustomActions` often duplicates tools that belong in Más / Controles / view toolbar. |
| Traslados (`css/app-traslados.css`) | `.tras-search` → `max-width: none` under 980px | Giant “Buscar MVA, placas o modelo” eats first viewport. |
| Unidades (`css/app-unidades.css`) | `.uni-controls-row` column + `.uni-search` full width | Huge BUSCAR + stacked filter selects. |
| Cuadre chips | Being fixed elsewhere | Rule must be encoded: **chips always `overflow-x: auto`, never wrap-stack**. |
| Density | ESTILO dense input = 36px | Mobile media queries stretch controls to full width without compacting chrome. |

**Breakpoint definition (locked):** “Mobile shell” = viewports where bottom nav is shown: **`max-width: 1024px`**. Desktop sidebar remains the nav above that.

---

## Approaches considered

### A — Shell-owned chrome only

Views render **zero** search/filter chrome on mobile. All search binds to header `inpage` events; filters open a shell-level sheet; CTAs only via FAB API on shell.

| Pros | Cons |
|---|---|
| Maximum consistency; one place to fix search | Large coupling; every view must register filter schemas with shell; slower migration |
| Matches “header already has search” | Hard for view-specific quirks (e.g. Traslados unit picker search) |

### B — View-local compact toolbars only

Each view keeps a sticky sub-bar under the header (icon row). Shell search unused on list pages. Document patterns in CSS comments.

| Pros | Cons |
|---|---|
| Fast per-view patches; low shell risk | Drift (Traslados vs Unidades diverge again); duplicates header search icon |
| No shared contract | Header still looks “busy” with unused search |

### C — Hybrid: shell search + shared view patterns (**recommended**)

1. **Shell owns search** on mobile for list/filter views: icon → expand existing overlay; views hide local search fields and listen to `onSearchInput` / shell events (already wired in `js/app/main.js`).
2. **Views own a shared mobile content chrome** via documented CSS/JS patterns (`mex-m-*`): chip scroller, filter trigger → bottom sheet, primary FAB or compact action row.
3. **Ownership matrix** (below) decides header vs footer vs view vs Más sheet.

| Pros | Cons |
|---|---|
| Reuses existing header search + bottom nav | Needs a short shared pattern module/CSS (still small) |
| Incremental: migrate Traslados/Unidades first | Views must opt into “mobile chrome mode” |
| Clear rules file for all future SPA views | Dual search modes (`inpage`/`global`) need one default on mobile |

**Recommendation: Approach C.** It fixes the screenshot pain immediately, matches infrastructure already in `header.js` / `bottom-nav.js`, and scales without waiting for a full shell rewrite.

---

## Design (Approach C)

### 1. Ownership matrix

| Concern | Header | Footer (bottom nav) | View content | Más / Controles sheet |
|---|---|---|---|---|
| App nav (Inicio, Mapa, Cuadre) | — | **Yes** | — | Full nav tree |
| Title / plaza / bell | **Yes** | — | — | — |
| In-page search | Icon only → expand | — | Hidden on mobile | — |
| Global search (unidad/usuario) | Same icon; mode toggle if kept | — | — | — |
| Status / quick filter chips | — | — | **Scroll-x row** | — |
| Advanced filters (selects, date, plaza subset) | Optional one `tune` icon in custom slot | — | Trigger only | Or view bottom sheet |
| Primary create/edit CTA | — | — | FAB or single compact button | Secondary actions |
| View tools (import, export, admin, denser controls) | **No** duplicate fat buttons | Controles only when Cuadre | — | **Yes** |
| Map config | — | Config slot on Mapa | — | — |

**Hard rule:** On mobile, `#mexHdrCustomActions` may hold **at most one** icon button (e.g. filter `tune` or overflow `more_vert`). Never a row of labeled tool buttons that also appear in Más/Controles.

---

### 2. Footer (bottom nav)

Keep current structure; document behavior as law:

```
[ Inicio ] [ Mapa ] [ Cuadre ] [ Más | Config | Controles ]
```

- **Más** → existing “more” sheet / sidebar-equivalent destinations (Traslados, Unidades, Turnos, Admin, Profile, …).
- **Config** only on `/mapa` (gear).
- **Controles** only on Cuadre (`mex:cuadre:more`) — view-owned control sheet, not header clones.
- Section extras (nav `children`) may append with horizontal scroll (already implemented); do not move those into the header.
- Content area must always reserve `var(--sh-bottomnav-h) + safe-area` (already in shell). FABs sit **above** this reserve (see §5).

---

### 3. Header (mobile)

Minimal left → right:

1. Menu (drawer)
2. Title (truncate; one line; ESTILO Heading 2 / 16px on narrow phones if needed)
3. *(desktop-only full search — hidden ≤1024)*  
4. Custom slot ≤1 icon  
5. Plaza control (compact)  
6. Search toggle (icon)  
7. Bell  

**Remove / forbid on mobile header:**

- Duplicate “Nuevo / Importar / Exportar / Filtros” text buttons
- Second search field
- Chip rows in the header

Plaza switcher stays; it is contextual, not nav duplication.

---

### 4. Search pattern

**Default on mobile list views:** shell search, `inpage` mode.

**Collapsed (default):** only the header search icon is visible. No in-content search input.

**Expanded:** existing absolute overlay `.mex-header-search.is-mobile-open` (full width under/over title row). Height stays **dense 36px** (ESTILO). Placeholder comes from view via existing `setSearchPlaceholder` / route title helpers — e.g. “MVA, placas o modelo”.

**Behavior:**

| Event | Effect |
|---|---|
| Tap search icon | Open overlay; focus input |
| Type (debounced ~250ms) | View filters list (`onSearchInput`) |
| Esc / tap outside / clear+blur | Close overlay; keep query in state (or clear — prefer **keep query**, show small “filtrando: …” chip in view chip row) |
| Empty query | No chip |

**Views MUST:**

- Hide `.tras-search`, `.uni-search`, and equivalents under `max-width: 1024px` when opted into shell search.
- Not render a second search input in the first viewport.

**Exception (nested pickers):** modal/sheet search (e.g. pick unit inside Traslado form) may keep a compact 36px field **inside the sheet** — not on the page chrome.

**Global mode:** keep existing Página/Global toggle inside the expanded search only; do not add a second icon. Default remains `inpage` for list routes.

---

### 5. Filters & chips

**Chip row (mandatory pattern):**

```
.mex-m-chips {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  flex-wrap: nowrap;      /* NEVER wrap */
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  padding: 8px 16px;      /* 4px grid */
}
```

- Chips: height 24px (ESTILO md badge), `--radius-full`, caption/label typography.
- Active chip: `--accent-pale` bg + `--accent` text/border.
- **Cuadre and all peers:** same rule — horizontal scroll only; no stacked chip grids on mobile.

**Advanced filters:**

- One `tune` (or “Filtros”) control → **bottom sheet** (`mexDialog`-class sheet or dedicated panel): stacked selects/fields at 36px dense.
- Active advanced filters summarized as chips in the scroll row (“Plaza · X”, “Estado · LISTO”) with clear-on-chip.
- Do **not** stack 3–5 `<select>`s in the first viewport on mobile (Unidades anti-pattern).

---

### 6. Primary CTAs

Pick **one** primary pattern per view (not both competing):

| Pattern | When | Spec |
|---|---|---|
| **FAB** | Single dominant create action (Nuevo traslado, Nueva unidad) | 48×48 or 56×56; `--accent`; icon `add`; `bottom: calc(var(--sh-bottomnav-h) + 16px + safe-area)`; `right: 16px`; `--radius-full`; `--shadow-md` |
| **Compact action row** | 2 related actions max | Single horizontal row, 36px buttons, icons + short label; no wrap — overflow menu for the rest |

**Forbid:** four full-width primary buttons wrapping under the title on mobile.

Secondary actions (import, export, bulk) → Más sheet, Controles, or overflow menu — not the first viewport.

---

### 7. Tables & lists

| Rule | Detail |
|---|---|
| Horizontal scroll | Table host `overflow-x: auto`; do not squash columns below readable width |
| Sticky first column | Optional for ID/MVA/placas; `position: sticky; left: 0; z-index: 1; background: var(--surface)` |
| Page size | Control in table toolbar: **25 / 50 / 100** (default 25 on mobile) |
| Row density | Prefer 44px min touch row height; text Caption/Body per ESTILO |
| Card fallback | Allowed only when table is unusable (&lt;360px width **and** ≤3 key fields); otherwise keep table + scroll |

Meta line (“N resultados”) stays Caption 12px under chips, not a large banner.

---

### 8. Density & tokens (ESTILO)

| Token | Mobile shell value |
|---|---|
| Font | Inter 400/500/600/700 only |
| Icons | `material-symbols-outlined` 20–24px chrome; 18px in chips |
| Accent | `#3b82f6` / hover `#2563eb` |
| Spacing | 4px grid only: page pad **12–16px**; chip gap **8px**; section gap **12–16px** |
| Radii | 4 / 8 / 12 / 16 / 9999 only |
| Control height | **36px dense** for search/filters/buttons in chrome |
| Surfaces | `var(--bg)`, `var(--surface)`, `var(--text)`, `var(--border)` — no new hex in view CSS |
| Motion | 140–200ms opacity/transform only; respect `prefers-reduced-motion` |
| Bottom nav height | `var(--sh-bottomnav-h)` = 60px (+ safe area) |

**Taste skills applied (polish only):** clear hierarchy, anti-clutter, one job per chrome band, no purple glows, no oversized empty inputs, no decorative hero whitespace. **Not applied:** Inter ban, Phosphor requirement, Awwwards landing density, floating island nav.

---

### 9. Shared implementation shape (for the future plan — not this task)

Suggested artifacts (plan phase):

| Artifact | Role |
|---|---|
| This spec | Rules source of truth |
| `css/app-mobile-patterns.css` (or section in `shell.css`) | `.mex-m-chips`, `.mex-m-fab`, `.mex-m-filter-sheet`, table scroll helpers |
| View opt-in | e.g. root class `mex-m-chrome` on Traslados/Unidades/Cuadre/Turnos |
| Shell bridge | Views subscribe to header search; call `header.setSearchPlaceholder(...)` on mount |
| Docs | Short “Mobile view checklist” bullet list in this file (§11) |

No new design-system framework; reuse `mexDialog` / existing sheets where possible.

---

### 10. Per-view expectations (first wave)

| View | Hide on mobile | Use instead |
|---|---|---|
| **Traslados** | Page search field; fat action cluster | Shell search; chips for status; FAB “Nuevo”; extras → overflow |
| **Unidades** | Full-width BUSCAR + stacked selects | Shell search; chip summaries; `tune` → sheet; FAB/compact add |
| **Cuadre** | Stacked chips | `.mex-m-chips` scroll-x; Controles in footer only |
| **Turnos** | Oversized search/filters if present | Same chrome contract |
| **Mapa** | N/A (special transparent footer) | Keep Config slot; no list-search rules |

Desktop layouts remain as today until explicitly redesigned.

---

### 11. Mobile view checklist (definition of done per view)

A view is mobile-compliant when, at ≤1024px:

- [ ] No persistent full-width empty search in the first viewport
- [ ] Search works via header icon → expand (or documented exception inside a sheet)
- [ ] Filter chips (if any) are a single non-wrapping horizontal scroller
- [ ] Advanced filters live in a sheet, not a stacked select stack
- [ ] ≤1 custom header icon; no duplicate footer tools in the header
- [ ] Primary CTA is FAB or one compact row; secondaries in overflow/Más
- [ ] Tables scroll-x; page size includes 25/50/100
- [ ] Content clears bottom nav + FAB does not cover nav items
- [ ] ESTILO tokens only (Inter, Symbols, accent, 4px grid, allowed radii)

---

### 12. Success criteria

- Screenshots of Traslados/Unidades on a ~390px viewport show **list/table within the first screenful**, not a search+filters wall.
- Header search icon opens overlay and filters the active view in `inpage` mode.
- Cuadre chips never wrap to multiple rows on mobile.
- New SPA list views can copy the checklist without inventing chrome.
- No ESTILO regressions (no new fonts, purple accents, arbitrary radii).

---

### 13. Open questions (for product owner)

1. **Active-filter chip after closing search:** keep query as a dismissible chip (recommended) or clear query when overlay closes?
2. **FAB vs compact row for Unidades:** does “Nueva unidad” deserve a FAB, or is import/export parity more important (then compact row + overflow)?
3. **Tablet 768–1024:** treat identical to phone (this spec) or allow a slightly wider chip row + visible compact search field at ≥768?

---

## Spec self-review

| Check | Result |
|---|---|
| Placeholders / TBD | None left as requirements; open questions isolated in §13 |
| Consistency | Approach C throughout; ownership matrix matches search/footer/CTA sections |
| Scope | Design + rules only; implementation deferred to writing-plans |
| Ambiguity | Breakpoint locked at 1024px; chip wrap forbidden; header custom actions capped at 1 |

---

*End of design. Awaiting user review before implementation plan.*
