# Papeletas v3 híbrido — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar captura híbrida (móvil pantallas / desktop scroll), core 7+tablero, cámara guiada usable, diagrama fullscreen, PDF nuevo, firma con consentimiento y side-effects RENTADA+cuadre al entregar.

**Architecture:** Ampliar `domain/papeleta.model.js` y `finalizeDelivery` primero; luego UI por capas sin un solo mega-PR. Spec: `docs/superpowers/specs/2026-07-22-papeletas-v3-hibrido-design.md`.

**Tech Stack:** SPA vanilla (`papeletas.js`), Firestore (`papeletas-data.js`), `papeletas-camera.js`, `papeletas-diagram.js`, `papeletas-pdf.js`, CSS `app-papeletas.css`, bridge cuadre/unidades vía `window.api` / `js/core/database.js`.

## Global Constraints

- Scope **empresa-global** (no filtrar inbox por plaza).
- Autosave por sección; salida **inmutable** post-`entregada`.
- Cliente/contrato opcionales (soft); correcciones unidad **solo papeleta**.
- Hard: **7 core + tablero** + km + gas + checklist + firma.
- Tapetes: dígito **0–9**; **0 = no tiene**.
- Entrega: PDF + lock + **fuera de cuadre** + **RENTADA/ARRENDADA**.
- Export-signing PDF/nombre archivo.
- Cada tarea terminada: `node scripts/bump-sw.js` + commit + push.
- No inventar CRM SIPP; no escribir master Unidades en correcciones.

---

## File map

| File | Responsibility |
|------|----------------|
| `domain/papeleta.model.js` | ZONAS_CORE v3, gates, tapetes validation, progress helpers |
| `js/app/features/papeletas/papeletas-data.js` | create/update/finalize + side-effects |
| `js/app/views/papeletas.js` | Router UI híbrida (split later if >4k) |
| `js/app/features/papeletas/papeletas-camera.js` | Guided camera UX fixes |
| `js/app/features/papeletas/papeletas-diagram.js` | Fullscreen zoom/pan/pencil gate |
| `js/app/features/papeletas/papeletas-pdf.js` | New PDF layout |
| `js/app/features/papeletas/papeletas-photo-annotate.js` | **Create** — overlay editor |
| `css/app-papeletas.css` | Mobile stack + desktop scroll + camera landscape |
| Cuadre/unidad APIs | Remove from cuadre + set RENTADA on finalize |

---

### Task 1: Domain — core 7 + tablero hard + tapetes 0–9

**Files:**
- Modify: `domain/papeleta.model.js`
- Test: manual node asserts or small `node --check` + REPL smoke; if project has domain tests, add there

**Interfaces:**
- Produces: `ZONAS_CORE` (7 ids), `ZONA_CORE_LABELS`, `coreZonasHaveFoto`, `tableroHaveFoto`, `puedeEntregar` hard includes `tablero_photo`, `isValidTapeteDigit(n)`, `isChecklistComplete` updated

- [ ] **Step 1:** Redefine `ZONAS_CORE` to: `frente_defensa`, `parabrisas`, `lateral_izq`, `lateral_der`, `trasera_cajuela`, `interior`, `herramienta` (map labels; keep legacy ids where they exist; add `herramienta` zone photo slot in `ZONAS_ALL` / zonas create if missing).
- [ ] **Step 2:** Add `tableroHaveFoto(papeleta)` helper; `puedeEntregar` hard pushes `tablero_photo` if missing; `core_photos` checks 7 only.
- [ ] **Step 3:** Tapetes: accept 0–9 single digit; `0` valid (“no tiene”); reject multi-digit / empty for complete gate.
- [ ] **Step 4:** Update `ZONA_CORE_LABELS` + any UI maps that hardcode old 6-list.
- [ ] **Step 5:** `node --check domain/papeleta.model.js`
- [ ] **Step 6:** Bump SW + commit: `feat(papeletas): domain core7 + tablero hard + tapetes 0-9`

---

### Task 2: finalizeDelivery — cuadre out + RENTADA

**Files:**
- Modify: `js/app/features/papeletas/papeletas-data.js`
- Modify/consult: `api/cuadre.js` or SPA equivalente para quitar unidad de cuadre; bridge estado unidad

**Interfaces:**
- Consumes: `puedeEntregar`, `buildTouchProvenance`
- Produces: `finalizeDelivery` after status entregada also: remove unidad from active cuadre; set unidad estado/ubicación RENTADA|ARRENDADA

- [ ] **Step 1:** Locate existing APIs to remove unit from cuadre and set commercial/ops state (grep `RENTADA`, `quitar.*cuadre`, `change_unit_state`).
- [ ] **Step 2:** After successful delivery TX (or same TX if safe), call side-effects; failures: log + soft retry / reportProgrammerError but do not unlock salida if already entregada (document behavior: delivery wins; side-effect retryable).
- [ ] **Step 3:** Prefer `tipoNegocio` → label RENTADA vs ARRENDADA.
- [ ] **Step 4:** Manual smoke notes in commit body.
- [ ] **Step 5:** Bump SW + commit: `feat(papeletas): finalize saca de cuadre y marca RENTADA`

---

### Task 3: UI híbrida — shell móvil pantallas + desktop scroll

**Files:**
- Modify: `js/app/views/papeletas.js`
- Modify: `css/app-papeletas.css`

**Interfaces:**
- Consumes: existing subscribe/create/update
- Produces: `_isMobileCapture()`, screen stack ids: `buscar|hero|datos|diagrama|fotos|resumen|firma`

- [ ] **Step 1:** Detect mobile vs desktop breakpoint (~900px); mobile render one screen; desktop keep continuous scroll sections.
- [ ] **Step 2:** Screen **buscar** — large search; hits with mva/modelo/placas.
- [ ] **Step 3:** Screen **hero** — model image as background/hero plane; overlay económico + fields; Edit toggle; confirm creates papeleta.
- [ ] **Step 4:** Screen **datos** — cliente/contrato optional, KM, gas chips, tablero preview, checklist 2-col, tapetes 0–9, llantas redesign; autosave on change.
- [ ] **Step 5:** Nav to diagrama/fotos independent order; chips show hard progress.
- [ ] **Step 6:** Desktop: preserve scroll-spy; add hover hooks stub for Task 5.
- [ ] **Step 7:** Smoke mobile stack + desktop scroll.
- [ ] **Step 8:** Bump SW + commit: `feat(papeletas): UI hibrida movil pantallas / desktop scroll`

---

### Task 4: Cámara guiada — landscape, jump chips, post-7 sheet, velocidad

**Files:**
- Modify: `js/app/features/papeletas/papeletas-camera.js`
- Modify: `css/app-papeletas.css` (camera landscape rules)

**Interfaces:**
- Consumes: zone list (7 core + optional damage)
- Produces: `openGuidedCamera({ zones, onComplete, onDamageExtra })`

- [ ] **Step 1:** Fix landscape CSS (safe areas, flex, video object-fit) — no broken chrome.
- [ ] **Step 2:** After file/camera capture resolve, advance UI **synchronously** (optimistic next zone; upload in background with spinner on thumb only).
- [ ] **Step 3:** Zone chip grid — tap any zone to jump; remove forced skip chain.
- [ ] **Step 4:** When 7 hard (+ tablero if in session) complete → sheet **Daño específico** | **Continuar** (Continuar closes camera).
- [ ] **Step 5:** Herramienta flow: optional refacción second shot prompt.
- [ ] **Step 6:** Bump SW + commit: `fix(papeletas): camara guiada landscape + jump + post-7`

---

### Task 5: Diagrama fullscreen — zoom/pan + lápiz gated + hover desktop

**Files:**
- Modify: `js/app/features/papeletas/papeletas-diagram.js`
- Modify: `css/app-papeletas.css`
- Modify: `js/app/views/papeletas.js` (fullscreen mount; hover map)

**Interfaces:**
- Produces: `mountDiagram` with `mode: 'pan'|'pen'|'mark'`, pinch/wheel zoom, pan when not pen; desktop `onZoneHover(zoneId)`

- [ ] **Step 1:** Fullscreen stage container (100% of capture pane / overlay).
- [ ] **Step 2:** Default interaction = pan/zoom; pen only when tool=pen (already partially done — harden).
- [ ] **Step 3:** Map hover regions → zone ids → show photo preview square (desktop only).
- [ ] **Step 4:** Bump SW + commit: `feat(papeletas): diagrama fullscreen zoom/pan + hover preview`

---

### Task 6: PDF nuevo + resumen espejo + firma consentimiento

**Files:**
- Modify: `js/app/features/papeletas/papeletas-pdf.js`
- Modify: `js/app/views/papeletas.js` (resumen + firma UI)

**Interfaces:**
- Consumes: papeleta + diagram raster + photos
- Produces: PDF layout top→diagram→2-col checklist+tapetes→full photos→big firma+fecha

- [ ] **Step 1:** Rebuild printable HTML/CSS to match §3.1 spec.
- [ ] **Step 2:** Resumen screen mirrors PDF structure.
- [ ] **Step 3:** Firma fullscreen: rules chips + consentimiento copy + confirm → `finalizeDelivery`.
- [ ] **Step 4:** Verify export-signing filename + internal signature.
- [ ] **Step 5:** Bump SW + commit: `feat(papeletas): PDF v3 + resumen + firma consentimiento`

---

### Task 7: Anotación fullscreen de fotos

**Files:**
- Create: `js/app/features/papeletas/papeletas-photo-annotate.js`
- Modify: `papeletas-data.js` (persist overlay paths / strokes per foto)
- Modify: view to open annotator from photo preview

**Interfaces:**
- Produces: `openPhotoAnnotator({ photoUrl, photoPath, onSave({ overlayPath, strokes, marks }) })`

- [ ] **Step 1:** Fullscreen editor reuse diagram tools (pen + typed marks) over photo bitmap.
- [ ] **Step 2:** Persist overlay (Storage path + metadata on zona/damage photo).
- [ ] **Step 3:** Wire “Editar” from photo preview; retake still available.
- [ ] **Step 4:** Bump SW + commit: `feat(papeletas): anotacion fullscreen de fotos`

---

### Task 8: Smoke + docs closeout

**Files:**
- Modify: `docs/superpowers/specs/2026-07-22-papeletas-v3-hibrido-design.md` status if needed
- Optional: note in `agente.md` pointer to v3 spec

- [x] **Step 1:** Manual smoke matrix documented below (patio QA still recommended).
- [x] **Step 2:** Commit any doc tweaks; push.

#### Smoke matrix (manual patio)

| # | Caso | Esperado |
|---|------|----------|
| 1 | Crear papeleta en plaza BJX, abrir/editar desde GDL | Inbox empresa-global; captura editable |
| 2 | Completar 7 core + tablero + KM/gas/checklist/tapetes 0–9 + firma con consentimiento | `finalizeDelivery` → status entregada |
| 3 | Post-entrega | Unidad fuera de cuadre; índice `RENTADA` o `ARRENDADA` |
| 4 | Cámara landscape + jump chips + sheet post-7 | Sin chrome roto; Continuar cierra |
| 5 | Diagrama fullscreen pan/zoom; desktop hover zona→foto | Lápiz solo con tool=pen |
| 6 | PDF v3 | Top → diagrama → checklist+tapetes → fotos full → firma grande; nombre firmado |
| 7 | Anotar foto (Editar) | Overlay persistido en zona (`fotoOverlayPath` + strokes/marks) |

---

## Dependency order

```
Task1 → Task2 → Task3 → Task4 → Task5 → Task6 → Task7 → Task8
         ↘ (Task3 can start UI shell in parallel after Task1 if finalize stubbed)
```

Prefer **serial** after Task1 to avoid UI on old gates.

---

## Self-check

- [x] Spec path referenced  
- [x] Bite-sized tasks with files + commits  
- [x] Side-effects and hard gates explicit  
- [x] No CRM / master-unit writes  
