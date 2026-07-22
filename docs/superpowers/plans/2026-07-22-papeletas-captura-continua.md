# Papeletas captura continua (hoja + lápiz) — Implementation Plan

> **For agentic workers:** Execute task-by-task. Spec: `docs/superpowers/specs/2026-07-22-papeletas-app-hoja-lapiz-design.md` §0A + fases A0–E.

**Goal:** Inbox tipo app (cards) + captura de salida en **un solo scroll** con chips sticky, autocomplete rápido y diagrama persistente; alcance empresa-global ya en domain/data.

**Architecture:** Pivot UX en `papeletas.js` + `app-papeletas.css` sin romper domain/data/`finalizeDelivery`. Wizard 6 pasos deja de ser la superficie primaria; chips hacen scroll-spy.

**Tech Stack:** Vanilla SPA, Firestore via `papeletas-data.js`, `domain/papeleta.model.js`, `mexUnidades`, `papeletas-diagram.js`.

## Global Constraints

- Scope **empresa-global** (no filtrar inbox por plaza).
- Salida inmutable post-`entregada`; cliente/contrato diferibles.
- No tabla densa como primaria.
- Bump SW + commit + push al cerrar.

---

## Task 1: Inbox cards-first + plaza en card

**Files:** `css/app-papeletas.css`, `js/app/views/papeletas.js`

- [ ] Cards visibles en desktop; tabla oculta por default
- [ ] Card muestra plaza origen/última + Sin cliente

## Task 2: Lookup unidad via mexUnidades

**Files:** `js/app/views/papeletas.js`

- [ ] `_runUnitAutocomplete` usa `mexUnidades.buscar` si ready; fallback `buscarUnidad` sin filtrar hits

## Task 3: Captura continua scroll-spy

**Files:** `js/app/views/papeletas.js`, `css/app-papeletas.css`

- [ ] Pre-entrega: stack Datos|KM|Check|Daños|Fotos|Entregar|Firma
- [ ] Chips sticky → `scrollIntoView`; sin footer Atrás/Continuar
- [ ] Sticky: Siguiente hueco + Entregar
- [ ] Restaurar scrollTop en re-render

## Task 4: Diagrama persist mount

**Files:** `js/app/views/papeletas.js`

- [ ] `_mountDiagramIfNeeded` reusa API si host vivo; `setDamages`/`setStrokes`

## Task 5: Closeout

- [ ] `node scripts/bump-sw.js` + commit + push
