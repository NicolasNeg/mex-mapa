# Design: Editor de mapa — restyle profesional + funciones mínimas

**Date:** 2026-07-15  
**Status:** implemented (ciclo A)  
**Cycle:** A — look & feel del editor **original** + funciones mínimas de profesionalismo  
**Out of cycle:** migración nativa a mapviz / quitar iframe (ciclo B futuro)  
**Related:**  
- Vault: `MapGestion/NUEVO EDITOR DE MAPA. MAS PROFESIONAL Y MAS HERRAMIENTAS..md`  
- Prior note (más amplio / nativo): `docs/superpowers/specs/2026-07-15-editor-mapa-profesional-design.md` — **este doc manda para el ciclo A**  
- Plan de implementación: se escribirá con `writing-plans` tras aprobación de este spec  

---

## 1. Product intent

The map editor is an **ops layout tool** for plaza managers / programmers. Same tools operators already know; the chrome must stop looking like a toy/tutorial and feel like CAD-lite for parking yards: dense, calm, keyboard-friendly, clear save state.

**This cycle does:** restyle the existing editor surface + add a short list of “professional” behaviors.  
**This cycle does not:** rewrite the editor engine, switch to `mapa-visual-editor.js` as the `/app/editmap` host, or remove the iframe.

---

## 2. Decisions locked (brainstorming)

| Topic | Decision |
|---|---|
| Scope priority | Style + original tools + implement missing professional functions |
| Architecture | **A** — restyle current editor (iframe → `/editmap` → modal in `mapa.js`) |
| Approach | **2** — surgical ESTILO restyle + dirty / undo / keyboard / inspector fields |
| Layout | Fixed topbar + left tool rail + center canvas + right inspector + status footer |
| Mobile | Desktop-first (≥1024px); below that show “Abre el editor en escritorio” |

---

## 3. Current surface (do not replace)

| Piece | Role |
|---|---|
| `/app/editmap` | SPA view `js/app/views/editmap.js` — iframe to `/editmap/PLAZA?shell=1` |
| `/editmap` | `editmap.html` + `js/views/editmap.js` — boots mapa stack, opens editor modal |
| Editor logic | `js/views/mapa.js` (~L17400–18370) — tools, drag, save |
| Styles today | `css/editmap.css`, `css/mapa.css`, `css/config.css` (editor sections) — toy chrome |

Data contracts stay: `api.obtenerEstructuraMapa` / `api.guardarEstructuraMapa` (same Firestore shape).

---

## 4. Visual direction (ESTILO.md)

### Layout

```
┌─ Topbar: Plaza · Dirty/Guardado · Zoom · Guardar ─────────────────┐
├─ Left rail ──────┬─ Canvas ──────────────────┬─ Right inspector ──┤
│ Select           │ Flat slate + 8–16px grid  │ Name, type, x/y/w/h│
│ Add tools        │ Crisp cells, accent ring  │ Rotation           │
│ Templates        │ Blue dashed snap guides   │ Zone / Blocked /   │
│ Align / Z-order  │                           │ Reserved           │
│                  │                           │ Selection actions  │
└──────────────────┴───────────────────────────┴────────────────────┘
└─ Status: piece count · selection summary · short shortcut hints ──┘
```

### Tokens

- Font: Inter 400/500/600/700 only  
- Icons: `material-symbols-outlined` only  
- Accent: `#3b82f6` / hover `#2563eb`  
- Surfaces: `--bg`, `--surface`, `--border` (respect `body.dark-theme`)  
- Radii: only `4 / 8 / 12 / 16 / 9999`  
- Spacing: 4px grid  
- Copy: sentence case (“Guardar”, “Cajón”, “Duplicar fila”) — no ALL CAPS headers, no `font-weight: 800/900`

### Remove

- Help strip / tutorial cards  
- Pulsing “live preview” pills  
- Consumer gradients (green save, purple multi-select/snap)  
- Toy floating canvas (huge radius, pastel wash, glass inspector drift)  
- Material Icons (migrate to Symbols in editor chrome)

### Canvas

- Flat workspace background; subtle grid  
- Selection = accent ring; multi-select = pale accent fill  
- Snap guides = dashed `#3b82f6` (never purple)

---

## 5. Interaction principles

1. **Tool → place → select → edit → save** remains the only primary loop.  
2. **Dirty state** always visible in topbar; warn on unload / plaza change if unsaved.  
3. **Undo/redo** for structural edits in memory (create/move/resize/delete/align/duplicate).  
4. **Keyboard:** Esc clear; Delete/Backspace remove; arrows nudge 10px (Shift = 1px); Ctrl/Cmd+D duplicate; Ctrl/Cmd+Z / Shift+Z (or Y) undo/redo.  
5. **Parity:** every legacy tool stays reachable; restyle does not hide or rename workflows beyond sentence-case labels.  
6. **Performance (light touch):** prefer not to full-rebuild cell DOM on every mousemove during drag; mutate styles where the current code already allows without a rewrite.

---

## 6. Functions in scope (cycle A)

| ID | Feature | Behavior |
|---|---|---|
| F1 | Dirty indicator | Topbar “Guardado” / “Sin guardar”; enable Guardar only when dirty and structure non-empty |
| F2 | Unsaved guards | `beforeunload`; confirm when App Shell plaza changes with dirty editor |
| F3 | Undo / redo | In-memory stack for structural edits; clear or snapshot on successful save |
| F4 | Keyboard shortcuts | As in §5 |
| F5 | Inspector extras | Editable **Zona** (`zone`), **Bloqueado** (`isBlocked`), **Reservado** (`isReserved`) — fields already round-tripped in save payload |
| F6 | Chrome restyle | Full ESTILO layout of §4 on the existing modal/editor DOM |

**Explicitly out of scope (cycle B+):** native `/app/editmap` without iframe; absorb mapviz; multi-view tabs; background image upload; JSON import/export; renumber; duplicate plaza UI; measure tools.

---

## 7. Data / error handling

- **Load failure:** empty state + Reintentar; do not show fake empty map as success.  
- **Save failure:** toast error; dirty flag stays true.  
- **Empty structure:** Guardar disabled / rejected with clear message.  
- **Save success:** toast; dirty → saved; mapa operativo still refreshes via existing post-save hooks if present.

No Firestore schema change required for F1–F5 if `zone` / `isBlocked` / `isReserved` already persist (verify on implement; if a field is missing in write path, fix write path — do not invent a parallel collection).

---

## 8. File touch map (implementation hint)

| Path | Likely change |
|---|---|
| `css/editmap.css` and/or new `css/app-editmap-chrome.css` | Primary ESTILO chrome |
| `css/mapa.css` / `css/config.css` editor sections | Prune toy rules; defer to chrome stylesheet |
| `js/views/mapa.js` editor block | Wire F1–F5; keep tool handlers |
| `editmap.html` / modal markup in mapa templates | Restructure to rail + inspector + topbar if markup is flat today |
| `js/app/views/editmap.js` | Optional: desktop gate message only — no native engine |

---

## 9. Success criteria

1. Visual audit vs ESTILO.md: no purple toys, no pulse badges, Inter + Symbols, sentence case.  
2. Operator recognizes the same tools; no re-training required.  
3. Dirty + unsaved warning work; undo/redo cover the listed edit types.  
4. Zone / blocked / reserved editable and survive save → reload.  
5. Save still uses `guardarEstructuraMapa`; operational mapa reflects layout after save.  
6. Desktop ≥1024px is the supported editing surface.

---

## 10. Testing (manual)

- Open `/app/editmap` on desktop: chrome matches §4; no help cards.  
- Add / move / resize / delete / align / zoom — parity smoke.  
- Edit zone/blocked/reserved → save → reload → values persist.  
- Dirty → try leave / change plaza → warning.  
- Undo/redo after move and delete.  
- Keyboard Esc / Delete / arrows / Ctrl+D / Ctrl+Z.  
- Viewport &lt;1024: desktop message (or read-only), no broken touch editor claim.
