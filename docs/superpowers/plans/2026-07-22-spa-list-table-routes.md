# SPA listados tabla+rutas — Implementation Plan

> **For agentic workers:** implement task-by-task; commit after each working slice if practical.

**Goal:** Document golden rule; redesign Notas and Reportes de daños to Traslados-style table + routes.

**Architecture:** Same SPA module switches `list | new | detail` from `pathname`. List paints `<table>`; row click navigates; create/detail are full-page shells with Volver.

**Tech stack:** Vanilla JS SPA views, existing data modules, CSS namespaced (`inc-*` / `rd-*` aligned to `tras-*` patterns).

---

### Task 1: Golden rule docs

**Files:**
- Modify: `agente.md`
- Create: `.cursor/rules/spa-list-table-routes.mdc`

Add “Regla de oro — Listados SPA (tabla + rutas)” mirroring export/closeout style.

---

### Task 2: Router prefixes for Notas

**Files:**
- Modify: `js/app/router.js`

Mirror Traslados: `/app/notas/*` → same loader/CSS as `/app/notas`. Keep `/app/incidencias` → `/app/notas`.

---

### Task 3: Reportes de daños → table + `/v/:id`

**Files:**
- Modify: `js/app/views/reportes-danos.js`
- Modify: `css/app-reportes-danos.css`
- Modify: `js/shell/navigation.config.js` (title for `/v/`)

Parse `v/:id`; redirect bare `:id` to `/v/:id`. Replace `_renderList` cards with table. Row click → detail.

---

### Task 4: Notas → table + routes

**Files:**
- Modify: `js/app/views/incidencias.js`
- Modify: `css/app-incidencias.css`

Add LIST/NEW/VIEW routes, `_applyRouteMode`, `_navigate`. List uses table; remove permanent detail rail / metrics as primary chrome. Create = `/nuevo` page; detail = `/v/:id` page reusing existing detail/create markup + actions.

---

### Task 5: Closeout

`node scripts/bump-sw.js` → commit → push.
