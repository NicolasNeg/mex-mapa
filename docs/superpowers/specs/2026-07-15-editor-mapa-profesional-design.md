# Design: Editor de mapa profesional

**Date:** 2026-07-15  
**Status:** design note (implementation → `docs/superpowers/plans/2026-07-15-editor-mapa-profesional.md`)  
**Vault:** `MapGestion/NUEVO EDITOR DE MAPA. MAS PROFESIONAL Y MAS HERRAMIENTAS..md` (screenshot + “pasar a ser una herramienta más profesional”)

---

## Product intent

The map editor is an **ops layout tool** for plaza managers / programmers — not a consumer drawing toy and not a game board. It must feel like CAD-lite for parking yards: dense, calm, keyboard-friendly, with clear save state and zero surprise.

**Non-goals (this cycle):** full CAD polygons, GIS layers, multi-user live co-editing, mobile editing (desktop ≥1024px remains primary).

---

## Current reality (two stacks)

| Surface | What it is today |
|---|---|
| `/app/editmap` → iframe `/editmap/PLAZA` | Production UX. Modal chrome + logic inside `js/views/mapa.js` (~L17400–18370). Loads the mapa monolito just to edit layout. |
| `js/app/features/mapa/mapa-visual-editor.js` | Newer “mapviz” editor (undo/redo, multi-view, backgrounds, richer tools). Opened from mapa official tools — **not** the `/app/editmap` route. |
| `mapa/features/extras/editmap-inline.js` | Placeholder only (TODO extract). |

Target architecture: **one native SPA editor** at `/app/editmap`, built by hardening/extending mapviz + porting every legacy capability users already rely on. Keep `/editmap` as fallback until parity is signed off.

---

## Why it looks “juguete” (honest)

1. **Chrome noise:** help-strip cards, pulsing “vista previa en vivo”, floating glass inspector, pill tool buttons with bounce/shadow — reads as onboarding game, not ops console.
2. **ESTILO.md violations:** Material Icons (not Symbols), `font-weight: 800/900`, purple snap/selection (`#a855f7`), green gradient save, radii 6/7/9/10/14/20/24/34, spacing off the 4px grid.
3. **Canvas as “toy board”:** rounded floating stage with soft shadows and pastel wash instead of a flat technical workspace.
4. **Architecture smell:** iframe → full `mapa.js` boot for a modal — slow first paint, double chrome, feels bolted-on.
5. **Incomplete professionalism:** model fields (`zone`, `isReserved`, `isBlocked`, `allowedCategories`, …) load/save but have no inspector UI; no undo; no dirty warning; no keyboard shortcuts.

---

## Visual direction (ESTILO.md)

- Font Inter 400/500/600/700 only.
- Icons: `material-symbols-outlined` only.
- Accent `#3b82f6` / hover `#2563eb`; surfaces via `--bg` / `--surface` / `--border` (dark-theme vars).
- Spacing 4px grid; radii only 4 / 8 / 12 / 16 / 9999.
- Layout: **fixed top command bar + left tool rail + center canvas + right inspector + thin status footer** (Figma / Miro / CAD-lite pattern).
- Remove: help cards, live pulse, emoji-ish tips, green “success” primary save, purple guides → use accent blue dashed guides.
- Canvas: subtle 8–16px grid lines, flat slate background, crisp cell edges (no car-emoji playfulness beyond a muted status icon if needed).

Copy tone: sentence case (“Guardar”, “Cajón”, “Duplicar fila”) — no ALL CAPS headers.

---

## Interaction principles

1. **Tool → place → select → edit** is the only primary loop.
2. **Dirty state** always visible; unload/navigation warns if unsaved.
3. **Undo/redo** for structural edits (create/move/resize/delete/align).
4. **Keyboard:** Esc clear, Delete remove, Ctrl/Cmd+Z/Y undo/redo, arrows nudge 10px (Shift = 1px), Ctrl+D duplicate.
5. **Performance:** never rebuild the entire cell DOM on drag; mutate styles; full rebuild only on structure membership change.
6. **Parity first:** every legacy action remains reachable before shipping new tools.

---

## Feature priority (summary)

| Pri | Theme |
|---|---|
| **P0** | Native route + ESTILO chrome + incremental render + undo/redo + dirty warning + inspector for zone/blocked/reserved + keyboard |
| **P1** | Templates (fila×N, bloque CxR), renumber, duplicate plaza, background image, camino/entrada/buffer types for estacionamiento |
| **P2** | Multi-view tabs (global/mesas/albercas) where `tipoNegocio` needs them, layer filters, JSON import/export for PROGRAMADOR, measure/guides ruler |

---

## Success criteria

- Operator opens `/app/editmap` without iframe; time-to-interactive ≪ legacy (no monolito boot).
- Visual audit vs ESTILO.md: zero purple toys, zero pulse badges, Inter + Symbols.
- Parity checklist (plan §2) 100% checked.
- Patio with 150+ cajones: select/drag stays responsive (no full re-render per mousemove).
- Save still writes via `api.guardarEstructuraMapa` / same Firestore shape; mapa operativo reflects layout after save.
