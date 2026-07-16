# Editor mapa restyle (ciclo A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spec:** `docs/superpowers/specs/2026-07-15-editor-mapa-restyle-design.md`

**Goal:** Restyle the existing map editor (iframe → `/editmap` → `#modal-editor-mapa`) to ESTILO.md CAD-lite chrome and add dirty/undo/keyboard/inspector fields — without migrating to mapviz or removing the iframe.

**Architecture:** Keep editor logic in `js/views/mapa.js` (`_edCeldas`, drag/tools/save). Restructure modal markup into topbar + left rail + canvas + right inspector + status. Add a small helper module `js/app/features/mapa/editor-session.js` for dirty + undo stack so `mapa.js` does not grow more stateful spaghetti. Sync the same modal HTML in `editmap.html`, `mapa.html`, and `mapa/templates/mapa-core.html`.

**Tech Stack:** Vanilla ES modules, Firestore via `api.guardarEstructuraMapa`, Inter + `material-symbols-outlined`, CSS in new `css/app-editmap-chrome.css` (+ prune toy rules in `css/config.css` / `css/editmap.css`).

## Global Constraints

- Follow `ESTILO.md`: Inter 400–700; accent `#3b82f6`; radii 4/8/12/16/9999; spacing 4px; CSS variables; no purple toys; no `font-weight: 800/900`; icons = Material Symbols Outlined.
- Sentence case copy (“Guardar”, “Cajón”) — no ALL CAPS headers.
- Preserve Firestore payload fields already written by `guardarMapaEditor` (including `zone`, `isReserved`, `isBlocked`).
- Do not wire `mapa-visual-editor.js` to `/app/editmap` in this cycle.
- Desktop ≥1024px primary; below that show desktop-only message.
- After each shipping task batch: `npm run deploy` → `git add .` → commit → `git push` (repo standing rule).

---

## File map

| Path | Responsibility |
|---|---|
| `css/app-editmap-chrome.css` | **Create** — ESTILO chrome for `#modal-editor-mapa` |
| `editmap.html` | Modal markup restructure (canonical for standalone) |
| `mapa.html` | Same modal markup (keep in sync) |
| `mapa/templates/mapa-core.html` | Same modal markup (keep in sync) |
| `js/app/features/mapa/editor-session.js` | **Create** — dirty flag + undo/redo stack + snapshot helpers |
| `js/views/mapa.js` | Wire session helpers; inspector fields; keyboard; chrome hooks |
| `css/config.css` / `css/editmap.css` | Disable/override toy rules that fight the new chrome |
| `js/views/editmap.js` | Optional: inject chrome CSS link; desktop gate |
| `js/app/views/editmap.js` | Optional: desktop-only banner in SPA shell |

---

### Task 1: Chrome CSS foundation

**Files:**
- Create: `css/app-editmap-chrome.css`
- Modify: `editmap.html` (add `<link rel="stylesheet" href="/css/app-editmap-chrome.css">` in `<head>`)
- Modify: `js/views/editmap.js` — ensure link injected if missing when standalone boots

**Interfaces:**
- Produces: CSS classes `.ed-shell`, `.ed-topbar`, `.ed-rail`, `.ed-canvas`, `.ed-inspector`, `.ed-status`, `.ed-dirty`, `.ed-tool`, `.ed-btn-primary`
- Consumes: existing `#modal-editor-mapa` id (Task 2 will restructure children)

- [ ] **Step 1: Create `css/app-editmap-chrome.css`**

```css
/* Editor mapa — chrome ESTILO (ciclo A). Scope: #modal-editor-mapa */
#modal-editor-mapa {
  --ed-accent: #3b82f6;
  --ed-accent-hover: #2563eb;
  --ed-surface: var(--surface, #ffffff);
  --ed-bg: var(--bg, #f8fafc);
  --ed-border: var(--border, #e2e8f0);
  --ed-text: var(--text, #0f172a);
  --ed-muted: #64748b;
  font-family: Inter, sans-serif;
  padding: 0 !important;
}

#modal-editor-mapa .ed-shell,
#modal-editor-mapa .mapa-editor-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  border-radius: 0;
  background: var(--ed-bg);
  box-shadow: none;
  overflow: hidden;
}

#modal-editor-mapa .ed-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 56px;
  padding: 0 16px;
  border-bottom: 1px solid var(--ed-border);
  background: var(--ed-surface);
  flex-shrink: 0;
}

#modal-editor-mapa .ed-topbar h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--ed-text);
}

#modal-editor-mapa .ed-dirty {
  font-size: 12px;
  font-weight: 500;
  color: var(--ed-muted);
}
#modal-editor-mapa .ed-dirty.is-dirty { color: #b45309; }

#modal-editor-mapa .ed-main {
  display: grid;
  grid-template-columns: 72px 1fr 320px;
  flex: 1;
  min-height: 0;
}

#modal-editor-mapa .ed-rail {
  border-right: 1px solid var(--ed-border);
  background: var(--ed-surface);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}

#modal-editor-mapa .ed-tool {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--ed-muted);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}
#modal-editor-mapa .ed-tool:hover,
#modal-editor-mapa .ed-tool.is-active {
  background: rgba(59, 130, 246, 0.12);
  color: var(--ed-accent);
  border-color: rgba(59, 130, 246, 0.25);
}
#modal-editor-mapa .ed-tool .material-symbols-outlined { font-size: 22px; }

#modal-editor-mapa .ed-canvas {
  position: relative;
  min-width: 0;
  background: #f1f5f9;
  overflow: auto;
}

#modal-editor-mapa .ed-inspector {
  border-left: 1px solid var(--ed-border);
  background: var(--ed-surface);
  padding: 16px;
  overflow-y: auto;
}

#modal-editor-mapa .ed-status {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 36px;
  padding: 0 16px;
  border-top: 1px solid var(--ed-border);
  background: var(--ed-surface);
  font-size: 12px;
  color: var(--ed-muted);
  flex-shrink: 0;
}

#modal-editor-mapa .ed-btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 14px;
  border: none;
  border-radius: 8px;
  background: var(--ed-accent);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
#modal-editor-mapa .ed-btn-primary:hover { background: var(--ed-accent-hover); }
#modal-editor-mapa .ed-btn-primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Kill toy chrome leftovers when old classes remain */
#modal-editor-mapa .editor-help-strip,
#modal-editor-mapa .editor-live-pill,
#modal-editor-mapa .editor-floating-card {
  display: none !important;
}

#modal-editor-mapa .editor-grid-stage {
  border-radius: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
}

@media (max-width: 1023px) {
  #modal-editor-mapa .ed-desktop-only-msg { display: flex !important; }
  #modal-editor-mapa .ed-main { display: none !important; }
}
```

- [ ] **Step 2: Link stylesheet in `editmap.html` `<head>`**

```html
<link rel="stylesheet" href="/css/app-editmap-chrome.css">
```

- [ ] **Step 3: Manual check**

Open `/editmap` (or `/app/editmap`). Confirm CSS loads (Network) and `#modal-editor-mapa` no longer shows help strip / live pill (hidden by CSS even before markup move).

- [ ] **Step 4: Commit + deploy**

```bash
npm run deploy
git add css/app-editmap-chrome.css editmap.html js/views/editmap.js
git commit -m "$(cat <<'EOF'
Add ESTILO chrome stylesheet for map editor cycle A.

EOF
)"
git push
```

---

### Task 2: Restructure modal markup (all three copies)

**Files:**
- Modify: `editmap.html` (`#modal-editor-mapa` block, ~L56–end of modal)
- Modify: `mapa.html` (same modal block)
- Modify: `mapa/templates/mapa-core.html` (same modal block)

**Interfaces:**
- Produces DOM ids that must remain for `mapa.js`:
  - `#modal-editor-mapa`, `#btnGuardarMapa`, `#editor-loading`, `#editor-grid-wrapper`, `#editor-canvas-inner` (or whatever current canvas id is — keep existing canvas ids), `#editor-no-sel`, `#editor-sel-form`, `#ep-nombre`, `#ep-tipo`, `#ep-x`, `#ep-y`, `#ep-width`, `#ep-height`, `#ep-rotation`, tool buttons with same `onclick` handlers, `#ed-zoom-label`, `#editor-selection-summary`, `#editor-add-hint`
- Produces new ids: `#ed-dirty-label`, `#ed-status-pieces`, `#ep-zone`, `#ep-blocked`, `#ep-reserved`, `#btn-ed-undo`, `#btn-ed-redo`

- [ ] **Step 1: Replace shell structure in `editmap.html`**

Keep all existing `onclick` / `id` for tools and canvas. Move tools into `.ed-rail`, inspector into `.ed-inspector` (not floating card), remove help strip + live pill nodes entirely.

Skeleton (keep existing canvas inner HTML / selection actions / more menu as-is, only relocate):

```html
<div id="modal-editor-mapa" class="modal-overlay" style="z-index:75000;">
  <div class="mapa-editor-shell ed-shell">
    <header class="ed-topbar">
      <span class="material-symbols-outlined" style="color:#3b82f6;">map</span>
      <div style="flex:1;min-width:0;">
        <h2>Editor de mapa</h2>
        <p id="ed-dirty-label" class="ed-dirty">Guardado</p>
      </div>
      <button type="button" id="btn-ed-undo" class="ed-tool" onclick="editorUndo()" title="Deshacer" style="flex-direction:row;width:auto;padding:8px;">
        <span class="material-symbols-outlined">undo</span>
      </button>
      <button type="button" id="btn-ed-redo" class="ed-tool" onclick="editorRedo()" title="Rehacer" style="flex-direction:row;width:auto;padding:8px;">
        <span class="material-symbols-outlined">redo</span>
      </button>
      <button type="button" onclick="editorZoom(-0.1)" class="ed-tool" style="flex-direction:row;width:auto;padding:8px;"><span class="material-symbols-outlined">remove</span></button>
      <span id="ed-zoom-label">100%</span>
      <button type="button" onclick="editorZoom(0.1)" class="ed-tool" style="flex-direction:row;width:auto;padding:8px;"><span class="material-symbols-outlined">add</span></button>
      <button id="btnGuardarMapa" onclick="guardarMapaEditor(this)" class="ed-btn-primary" disabled>
        <span class="material-symbols-outlined" style="font-size:18px;">save</span> Guardar
      </button>
      <button type="button" onclick="cerrarEditmapStandalone()" class="ed-tool" style="flex-direction:row;width:auto;padding:8px;" title="Cerrar">
        <span class="material-symbols-outlined">close</span>
      </button>
    </header>

    <div class="ed-desktop-only-msg" style="display:none;flex:1;align-items:center;justify-content:center;padding:24px;text-align:center;color:#64748b;">
      Abre el editor en escritorio (mínimo 1024px).
    </div>

    <div class="ed-main">
      <aside class="ed-rail" aria-label="Herramientas">
        <!-- move existing tool buttons here; change material-icons → material-symbols-outlined; sentence case labels -->
        <button onclick="modoAgregarEditor('cajon')" class="ed-tool" id="btn-tool-cajon" type="button">
          <span class="material-symbols-outlined">crop_square</span><span>Cajón</span>
        </button>
        <!-- area, label, fila-3, rect-h, and any “Más” template triggers — same handlers -->
      </aside>

      <section class="ed-canvas mapa-editor-canvas">
        <!-- KEEP #editor-loading, #editor-grid-wrapper, canvas inner, selection actions, more menu -->
        <!-- DELETE .editor-help-strip and #editor-live-badge -->
      </section>

      <aside class="ed-inspector" aria-label="Inspector">
        <div id="editor-no-sel" class="mapa-no-sel">…</div>
        <div id="editor-sel-form" style="display:none;">
          <!-- existing ep-* fields -->
          <div class="mapa-field-group">
            <label class="mapa-field-label">Zona</label>
            <input id="ep-zone" type="text" class="mapa-input" placeholder="Ej: PATIO A" oninput="editorPropChange()">
          </div>
          <label class="mapa-field-group" style="display:flex;align-items:center;gap:8px;">
            <input id="ep-blocked" type="checkbox" onchange="editorPropChange()">
            <span>Bloqueado</span>
          </label>
          <label class="mapa-field-group" style="display:flex;align-items:center;gap:8px;">
            <input id="ep-reserved" type="checkbox" onchange="editorPropChange()">
            <span>Reservado</span>
          </label>
        </div>
      </aside>
    </div>

    <footer class="ed-status">
      <span id="ed-status-pieces">0 piezas</span>
      <span id="editor-selection-summary">Sin selección</span>
      <span>Esc deselecciona · Del borra · ⌘Z deshace</span>
    </footer>
  </div>
</div>
```

- [ ] **Step 2: Copy the same modal structure into `mapa.html` and `mapa/templates/mapa-core.html`**

Diff-check that tool `onclick` names and critical ids match `editmap.html`.

- [ ] **Step 3: Manual check**

Open `/app/editmap`: rail left, inspector right, no help cards, tools still place cajones.

- [ ] **Step 4: Commit + deploy**

```bash
npm run deploy
git add editmap.html mapa.html mapa/templates/mapa-core.html
git commit -m "$(cat <<'EOF'
Restructure map editor modal into CAD-lite chrome layout.

EOF
)"
git push
```

---

### Task 3: `editor-session.js` (dirty + undo)

**Files:**
- Create: `js/app/features/mapa/editor-session.js`
- Test: manual in browser console (no automated suite for this module yet)

**Interfaces:**
- Produces:
  - `createEditorSession()` → `{ markDirty, markClean, isDirty, pushUndo, undo, redo, canUndo, canRedo, reset, getBaselineFingerprint }`
  - Snapshots are deep-cloned arrays of cell objects
- Consumes: nothing from Firebase

- [ ] **Step 1: Write module**

```js
// js/app/features/mapa/editor-session.js
function deepClone(list) {
  try { return JSON.parse(JSON.stringify(list || [])); }
  catch (_) { return (list || []).map((c) => ({ ...c })); }
}

function fingerprint(list) {
  return JSON.stringify(list || []);
}

export function createEditorSession() {
  let dirty = false;
  let baseline = '[]';
  const undoStack = [];
  const redoStack = [];
  const MAX = 50;

  return {
    reset(cells) {
      baseline = fingerprint(cells);
      dirty = false;
      undoStack.length = 0;
      redoStack.length = 0;
    },
    markDirty() { dirty = true; },
    markClean(cells) {
      baseline = fingerprint(cells);
      dirty = false;
    },
    isDirty() { return dirty; },
    syncDirtyFrom(cells) {
      dirty = fingerprint(cells) !== baseline;
      return dirty;
    },
    pushUndo(beforeCells) {
      undoStack.push(deepClone(beforeCells));
      if (undoStack.length > MAX) undoStack.shift();
      redoStack.length = 0;
      dirty = true;
    },
    undo(currentCells) {
      if (!undoStack.length) return null;
      redoStack.push(deepClone(currentCells));
      const prev = undoStack.pop();
      dirty = fingerprint(prev) !== baseline;
      return prev;
    },
    redo(currentCells) {
      if (!redoStack.length) return null;
      undoStack.push(deepClone(currentCells));
      const next = redoStack.pop();
      dirty = fingerprint(next) !== baseline;
      return next;
    },
    canUndo() { return undoStack.length > 0; },
    canRedo() { return redoStack.length > 0; }
  };
}
```

- [ ] **Step 2: Console smoke (optional while mapa.js not wired)**

In a throwaway page or temporary import: `pushUndo` → mutate → `undo` restores.

- [ ] **Step 3: Commit**

```bash
git add js/app/features/mapa/editor-session.js
git commit -m "$(cat <<'EOF'
Add editor-session helper for dirty state and undo stacks.

EOF
)"
git push
```

---

### Task 4: Wire dirty + undo into `mapa.js`

**Files:**
- Modify: `js/views/mapa.js` (editor section ~L17470–18400)

**Interfaces:**
- Consumes: `createEditorSession` from `/js/app/features/mapa/editor-session.js`
- Produces: `editorUndo()`, `editorRedo()`, `_edMarkMutation(before)`, `_edRefreshDirtyUi()`
- Must call `_edMarkMutation` **before** mutating `_edCeldas` in: `editorPropChange`, `editorSpanChange`, `editorMoverCelda`, `editorEliminarCelda`, `editorCopiarCelda`, add/place handlers, align/distribute, drag-end commit, resize-end commit

- [ ] **Step 1: Import + session singleton near other editor globals**

Because `mapa.js` is a classic script/module mix, prefer dynamic import once in `abrirEditorMapa`:

```js
let _edSession = null;
async function _edEnsureSession() {
  if (_edSession) return _edSession;
  const mod = await import('/js/app/features/mapa/editor-session.js');
  _edSession = mod.createEditorSession();
  return _edSession;
}

function _edRefreshDirtyUi() {
  const dirty = !!_edSession?.isDirty();
  const lbl = document.getElementById('ed-dirty-label');
  if (lbl) {
    lbl.textContent = dirty ? 'Sin guardar' : 'Guardado';
    lbl.classList.toggle('is-dirty', dirty);
  }
  const btn = document.getElementById('btnGuardarMapa');
  if (btn) btn.disabled = !dirty || !_edCeldas.length;
  const u = document.getElementById('btn-ed-undo');
  const r = document.getElementById('btn-ed-redo');
  if (u) u.disabled = !_edSession?.canUndo();
  if (r) r.disabled = !_edSession?.canRedo();
}

function _edMarkMutation() {
  if (!_edSession) return;
  _edSession.pushUndo(_edCeldas);
  _edRefreshDirtyUi();
}

function editorUndo() {
  if (!_edSession?.canUndo()) return;
  const prev = _edSession.undo(_edCeldas);
  if (!prev) return;
  _edCeldas = prev;
  _resetEditorSelection?.() || _resetEditorPanel?.();
  _renderEditorCanvas();
  _edRefreshDirtyUi();
  _edSyncEditorHud();
}

function editorRedo() {
  if (!_edSession?.canRedo()) return;
  const next = _edSession.redo(_edCeldas);
  if (!next) return;
  _edCeldas = next;
  _resetEditorPanel?.();
  _renderEditorCanvas();
  _edRefreshDirtyUi();
  _edSyncEditorHud();
}
```

- [ ] **Step 2: In `abrirEditorMapa`, after cells load**

```js
await _edEnsureSession();
_edSession.reset(_edCeldas);
_edRefreshDirtyUi();
```

- [ ] **Step 3: Wrap mutations**

At the start of each mutating function (before changing `_edCeldas`), call `_edMarkMutation()` once per user gesture. For drag/resize, call once on pointer-up commit (not every mousemove).

- [ ] **Step 4: In `guardarMapaEditor` success path**

```js
_edSession?.markClean(_edCeldas);
_edRefreshDirtyUi();
```

Change save button label to sentence case: `Guardar` (not `GUARDAR CAMBIOS`).

- [ ] **Step 5: `beforeunload` + plaza change**

```js
window.addEventListener('beforeunload', (e) => {
  if (!_edSession?.isDirty()) return;
  e.preventDefault();
  e.returnValue = '';
});
```

If App Shell plaza change while modal open: listen `mex:plaza-change` / existing plaza hook; if dirty, `mexConfirm('Hay cambios sin guardar…')` and cancel plaza switch when possible.

- [ ] **Step 6: Manual test**

Move a cell → “Sin guardar”; Undo restores; Save → “Guardado”; reload confirms persistence.

- [ ] **Step 7: Commit + deploy**

```bash
npm run deploy
git add js/views/mapa.js
git commit -m "$(cat <<'EOF'
Wire dirty state and undo/redo into the map editor.

EOF
)"
git push
```

---

### Task 5: Inspector zone / blocked / reserved + keyboard

**Files:**
- Modify: `js/views/mapa.js` — `_edFillSelectionForm`, `editorPropChange`, keyboard listener
- Markup already added in Task 2 (`#ep-zone`, `#ep-blocked`, `#ep-reserved`)

**Interfaces:**
- Consumes: `_edSel`, `_edCeldas`, `_edMarkMutation`
- Produces: props persisted via existing `guardarMapaEditor` payload fields

- [ ] **Step 1: Extend `_edFillSelectionForm`**

```js
function _edFillSelectionForm(celda) {
  // ...existing fills...
  const zone = document.getElementById('ep-zone');
  const blocked = document.getElementById('ep-blocked');
  const reserved = document.getElementById('ep-reserved');
  if (zone) zone.value = celda?.zone || '';
  if (blocked) blocked.checked = celda?.isBlocked === true;
  if (reserved) reserved.checked = celda?.isReserved === true;
}
```

- [ ] **Step 2: Extend `editorPropChange`**

```js
_edMarkMutation(); // once at start of change batch — or debounce if needed
_edSel.zone = (document.getElementById('ep-zone')?.value || '').trim() || null;
_edSel.isBlocked = !!document.getElementById('ep-blocked')?.checked;
_edSel.isReserved = !!document.getElementById('ep-reserved')?.checked;
```

(If `_edMarkMutation` on every keystroke is too noisy, push undo only on focus-out for `#ep-zone`; checkboxes can mark immediately.)

- [ ] **Step 3: Keyboard handler when modal active**

```js
function _edOnKeydown(e) {
  const modal = document.getElementById('modal-editor-mapa');
  if (!modal?.classList.contains('active')) return;
  const tag = (e.target && e.target.tagName) || '';
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) {
    e.preventDefault();
    _edMarkMutation();
    editorEliminarCelda();
    return;
  }
  if (e.key === 'Escape') {
    _resetEditorPanel();
    _renderEditorCanvas();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) editorRedo(); else editorUndo();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    editorRedo();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd' && !typing) {
    e.preventDefault();
    _edMarkMutation();
    editorCopiarCelda();
    return;
  }
  if (!typing && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
    e.preventDefault();
    const step = e.shiftKey ? 0.1 : 1; // editorMoverCelda uses STEP* dCol; pass ±1 or use direct px
    const map = { ArrowUp:[0,-1], ArrowDown:[0,1], ArrowLeft:[-1,0], ArrowRight:[1,0] };
    const [dx, dy] = map[e.key];
    _edMarkMutation();
    editorMoverCelda(dx, dy);
    // If Shift should be 1px: temporarily patch editorMoverCelda to accept pixel mode — prefer adding editorMoverCeldaPx(dx,dy).
  }
}
document.addEventListener('keydown', _edOnKeydown);
```

Prefer adding `editorMoverCeldaByPx(dx, dy)` for Shift=1px to match the spec exactly.

- [ ] **Step 4: Update `_edSyncEditorHud` to set `#ed-status-pieces`**

```js
const pieces = document.getElementById('ed-status-pieces');
if (pieces) pieces.textContent = `${_edCeldas.length} piezas`;
```

- [ ] **Step 5: Manual test**

Set zone + blocked + reserved → Guardar → reload editor → values present. Keyboard Esc/Delete/⌘Z/arrows work when focus not in an input.

- [ ] **Step 6: Commit + deploy**

```bash
npm run deploy
git add js/views/mapa.js
git commit -m "$(cat <<'EOF'
Add editor inspector flags and keyboard shortcuts.

EOF
)"
git push
```

---

### Task 6: Polish pass + QA checklist

**Files:**
- Modify: `css/app-editmap-chrome.css` (snap guide color if still purple in `config.css` — override)
- Modify: `css/config.css` — neutralize `.mapa-btn-guardar` gradient / `.editor-live-pill` if still leaking
- Modify: `docs/superpowers/specs/2026-07-15-editor-mapa-restyle-design.md` status → `implemented` when done

- [ ] **Step 1: Override remaining toy styles**

Search `config.css` for `#a855f7`, `editor-live`, `mapa-btn-guardar`, `font-weight: 800` under editor selectors; override inside `#modal-editor-mapa` in `app-editmap-chrome.css`.

- [ ] **Step 2: Run manual QA from spec §10**

| Check | Pass? |
|---|---|
| No help cards / live pulse | |
| ESTILO chrome (rail/inspector/topbar) | |
| Tools parity smoke | |
| Dirty / unsaved / save | |
| Undo/redo | |
| Zone/blocked/reserved persist | |
| Keyboard | |
| &lt;1024 desktop message | |

- [ ] **Step 3: Final commit + deploy**

```bash
npm run deploy
git add -A
git commit -m "$(cat <<'EOF'
Polish map editor restyle and mark cycle A QA complete.

EOF
)"
git push
```

---

## Spec coverage self-review

| Spec requirement | Task |
|---|---|
| ESTILO chrome layout | 1, 2, 6 |
| Remove toy UI | 1, 2, 6 |
| Dirty + unsaved guards | 3, 4 |
| Undo/redo | 3, 4 |
| Keyboard | 5 |
| Inspector zone/blocked/reserved | 2, 5 |
| Keep tools + Firestore contracts | 2, 4, 5 (no API change) |
| Desktop-first | 1, 2 |
| No native mapviz | Global Constraints |

**Placeholder scan:** none intentional.  
**Type consistency:** `createEditorSession` API used uniformly in Task 4.

---

## Out of scope reminder

Native `/app/editmap` without iframe, mapviz absorption, multi-view, background image, JSON import/export — cycle B (`docs/superpowers/specs/2026-07-15-editor-mapa-profesional-design.md`).
