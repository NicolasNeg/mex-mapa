# Nueva sección de Unidades — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development. Steps use checkbox syntax.
>
> **Obsidian source:** `MapGestion/NUEVA SECCION DE UNIDADES.md`

**Goal:** Centralizar inventario global (`index_unidades`) en `/app/unidades` con consulta, filtros, export, alta/import batch y edición inline; retirar duplicados en Cuadre y arreglar UX del menú Acciones en Mapa.

**Architecture:** SPA view `js/app/views/unidades.js` + `css/app-unidades.css`; datos vía `api/flota.js` / `COL.INDEX`; UI alineada a Traslados (tabla con bordes, formulario en cajas). Fases posteriores modularizan a `js/app/features/unidades/` y añaden SheetJS/OCR para import.

**Tech Stack:** Vanilla ES modules, Firestore, Firebase Hosting, Inter + material-symbols-outlined, sin bundler.

## Global Constraints

- Seguir `ESTILO.md`: Inter, variables CSS, sin Tailwind en legacy.
- Deploy siempre con `npm run deploy` (bump SW).
- Permisos: `mexPerms.canDo('manage_global_fleet')` o roles GERENTE_PLAZA+.
- Upsert por MVA en `index_unidades`.

---

## Estado 2026-07-15

**Done:** ruta nav, tabla estilo traslados, filtros, paginación, detalle en cajas, edit inline, modal nueva/import, CSV export/import+paste, deploy v539+.

**Pending:** Excel/PDF/OCR import, quitar gestión admin cuadre, más controles responsive, fix dropdown acciones mapa, quitar swap/recordatorio, refactor modular, smoke test.

Ver checklist completo en Obsidian vault file (espejo de tareas Fase 1–6).

---

## Fase 1 — Consolidar (alta)

**Files:** `js/app/views/unidades.js`, `css/app-unidades.css`

- [ ] Verificar edit inline prod (Ver → Editar → Guardar/Cancelar)
- [ ] Export CSV respeta filtros
- [ ] QA roles ventas vs gerente

## Fase 2 — Import robusto (alta)

**Files:** `js/app/views/unidades.js`, new `js/app/features/unidades/unidades-import.js`, SheetJS CDN

- [ ] Parse xlsx/xls client-side
- [ ] UI mapeo columnas + localStorage
- [ ] OCR PDF/foto (reuse `mapa/features/extras/ocr.js`)
- [ ] Resumen creadas/actualizadas/errores

## Fase 3 — Quitar duplicados Cuadre (media)

**Files:** `cuadre.html`, `js/views/mapa.js`, `js/app/views/legacy-stage.js`

- [ ] Auditar botones gestión admin / alta global
- [ ] Redirigir a `/app/unidades`
- [ ] Cuadre solo insert local patio

## Fase 4 — Más controles Cuadre responsive (media)

**Files:** `cuadre.html`, `css/alertas.css`, shell footer

- [ ] Mobile: controles en footer “Más”
- [ ] Desktop: toolbar fija
- [ ] Fix shell-embedded CSS hiding controls

## Fase 5 — Mapa Acciones (media)

**Files:** `js/views/mapa.js`, `css/mapa.css`, `css/app-mapa.css`

- [ ] Fix dropdown cortado (fixed/portal)
- [ ] Remove CAMBIAR POSICIÓN + AGREGAR RECORDATORIO
- [ ] material-symbols-outlined + copy sentence case
- [ ] Paridad app-mapa renderer

## Fase 6 — Cierre (baja)

- [ ] Refactor features/unidades/*
- [ ] `scripts/test-unidades.js`
- [ ] Update `docs/app-real-view-migration-status.md`

---

**Execution order:** 1 → 2 → 5 → 4 → 3 → 6
