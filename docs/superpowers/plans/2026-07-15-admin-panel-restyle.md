# Panel Admin restyle (Ciclo A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task.  
> **Spec:** `docs/superpowers/specs/2026-07-15-admin-panel-restyle-design.md`

**Goal:** Restyle Centro Admin to corporate “Registry Ledger” chrome (ESTILO + distinctive rail/counts/trays) without migrating JS or removing iframe.

**Architecture:** New `css/app-admin-chrome.css` scoped to `#modal-config-global`. Update markup in `gestion.html` (canonical) and mirror in `mapa.html` / `mapa/templates/mapa-core.html`. Override conflicting rules in `admin-luminous.css`; avoid bulk edits to `config.css`.

**Tech Stack:** Vanilla HTML/CSS, legacy `mapa.js` tab logic unchanged, Inter, `material-symbols-outlined`, deploy via `npm run deploy`.

## Global Constraints

- ESTILO.md: Inter 400–700; accent `#3b82f6`; radii 4/8/12/16/9999; CSS variables; no purple toys; no weight 800/900.
- Sentence case copy; icons = Material Symbols Outlined.
- Preserve all `id=` hooks used by `mapa.js` (`cfg-tab-*`, `cfg-insight-*`, `cfg-lista-items`, etc.).
- Do not change Firestore writes or permission checks.
- After each shipping batch: `npm run deploy` → commit → push (repo standing rule).

---

## File map

| Path | Responsibility |
|---|---|
| `css/app-admin-chrome.css` | **Create** — Corporate Registry chrome |
| `css/global.css` | Import new chrome |
| `gestion.html` | Canonical markup refresh |
| `mapa.html` | Sync admin modal block |
| `mapa/templates/mapa-core.html` | Sync admin modal block |
| `css/admin-luminous.css` | Disable/trim rules superseded by chrome |
| `js/app/router.js` | Optional cache-bust for legacy-stage CSS if needed |

---

### Task 1: Chrome foundation (A1)

**Files:** Create `css/app-admin-chrome.css`; modify `css/global.css`, `gestion.html` (minimal class hooks)

- [ ] **Step 1:** Create `css/app-admin-chrome.css` with tokens, sidebar shell, workspace header, metric ribbon shell, status bar, hide `.cfg-v2-hero`, layout grid `.cfg-v2-body`.
- [ ] **Step 2:** Add `@import url('app-admin-chrome.css');` to `css/global.css` after `admin-luminous.css`.
- [ ] **Step 3:** Add root class `admin-registry` on `#modal-config-global` in `gestion.html`.
- [ ] **Step 4:** Replace `material-icons` → `material-symbols-outlined` in gestion.html sidebar/header (batch).
- [ ] **Step 5:** Manual smoke: open `/gestion` standalone — sidebar + workspace render, tab click still works.

---

### Task 2: Registry rail + nav tabs (A1 cont.)

**Files:** `css/app-admin-chrome.css`, `gestion.html`

- [ ] **Step 1:** Style `.cfg-tab.active` with accent rail pseudo-element (`::before`, transform-only animation).
- [ ] **Step 2:** Style count pills `.cfg-tab-count` (empty by default; JS can populate later from existing insight spans).
- [ ] **Step 3:** Style nav groups `.cfg-nav-group` corporate collapse (chevron, spacing 4px grid).
- [ ] **Step 4:** Sidebar dark `#07111f`; ensure contrast WCAG on labels.

---

### Task 3: Workspace header + toolbar (A1 cont.)

**Files:** `css/app-admin-chrome.css`, `gestion.html`

- [ ] **Step 1:** Restyle `.cfg-v2-workspace-header`, kicker, title, badge.
- [ ] **Step 2:** Add markup wrapper `.admin-metric-ribbon` wired to existing `#cfg-insight-*` IDs (move or duplicate display from hidden spans).
- [ ] **Step 3:** Restyle `.cfg-v2-tools`, `.cfg-v2-search-box`, `.cfg-v2-btn-add` as island/secondary buttons.
- [ ] **Step 4:** Restyle `.cfg-v2-footer` status strip.

---

### Task 4: Accesos tabs styling (A2)

**Files:** `css/app-admin-chrome.css` (+ selectors targeting usuarios/choferes/roles/solicitudes list DOM)

- [ ] **Step 1:** Double-bezel tray for `.cfg-v2-list`, user tables, solicitudes cards.
- [ ] **Step 2:** Table row hover, chips, badges (solicitudes pulse → corporate warn dot).
- [ ] **Step 3:** Empty states for each tab (copy in CSS-only where possible; markup tweak if needed).
- [ ] **Step 4:** QA: `/app/admin?tab=usuarios`, `choferes`, `roles`, `solicitudes`.

---

### Task 5: Operación tabs styling (A3)

**Files:** `css/app-admin-chrome.css`

- [ ] **Step 1:** Catalog list items (estados, categorias, modelos, gasolinas, motivos_traslado).
- [ ] **Step 2:** Modal `abrirModalNuevaConfig` / edit forms — field stack, labels above inputs.
- [ ] **Step 3:** QA each tab via `?tab=estados` etc.

---

### Task 6: Estructura + org + programador (A4)

**Files:** `css/app-admin-chrome.css`

- [ ] **Step 1:** Plazas + ubicaciones layouts (cards, responsables).
- [ ] **Step 2:** Empresa form sections.
- [ ] **Step 3:** Programador tab + bloqueo patio action button styling.
- [ ] **Step 4:** QA tabs.

---

### Task 7: Sync mapa modal (A5)

**Files:** `mapa.html`, `mapa/templates/mapa-core.html`

- [ ] **Step 1:** Diff admin block gestion.html vs mapa.html; port class/icon/markup changes.
- [ ] **Step 2:** Repeat for `mapa-core.html`.
- [ ] **Step 3:** QA: open config from `/app/mapa` — visual parity with `/app/admin`.

---

### Task 8: Luminous cleanup + dark theme (A5)

**Files:** `css/admin-luminous.css`, `css/app-admin-chrome.css`

- [ ] **Step 1:** Comment or override conflicting `.luminous-admin` rules now superseded.
- [ ] **Step 2:** Add `body.dark-theme` overrides in chrome CSS.
- [ ] **Step 3:** Add `@media (prefers-reduced-motion: reduce)` block.

---

### Task 9: Deploy + docs

- [ ] **Step 1:** `npm run deploy` (SW bump).
- [ ] **Step 2:** Commit message: restyle admin panel cycle A corporate registry chrome.
- [ ] **Step 3:** Push to origin.
- [ ] **Step 4:** Update spec status to `implemented` when all phases done.

---

## Testing checklist

| Route | Check |
|---|---|
| `/app/admin?tab=usuarios` | Sidebar rail, table, search |
| `/app/admin?tab=solicitudes` | Pending badge, approve/reject buttons visible |
| `/app/admin?tab=estados` | Catalog list + add modal |
| `/app/mapa` → Centro Admin | Modal matches iframe view |
| Dark theme toggle | Readable sidebar + workspace |
| 768px width | Collapsed sidebar usable |

---

## Risk notes

- **Large `config.css`** — prefer chrome overrides with higher specificity over mass edits.
- **Duplicate HTML** — gestion vs mapa drift; Task 7 mandatory.
- **IDs** — never rename hooks consumed by `mapa.js`.
