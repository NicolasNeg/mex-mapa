# Invitaciones UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar la UI responsive de `/app/gestion` (Invitaciones) con layout industrial-minimal: form arriba + tabla desktop / lista settings + sheet en mobile, sin cambiar callables ni el modelo de dominio.

**Architecture:** Solo vista + CSS. `gestion.js` sigue montando form + subscribe; en `<768px` la tabla se oculta y se pinta una lista de filas con menú `···` (sheet nativo-light en DOM). Datos vía `invitaciones-data.js` sin tocar.

**Tech Stack:** Vanilla JS ES modules, CSS en `app-gestion.css`, `mexConfirm`/`mexAlert`, Material Symbols, tokens `ESTILO.md`.

## Global Constraints

- No tocar `domain/invitacion.model.js`, Functions, ni flujo de login/registro.
- Reutilizar chips/estados existentes (`ESTADO_CHIP`).
- Modales nativos prohibidos: solo `window.mexConfirm` / `window.mexAlert`.
- Radios/spacing/`#3b82f6` según `ESTILO.md`.
- Al cerrar tarea con código: `node scripts/bump-sw.js` + commit + push (política del repo).

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `js/app/views/gestion.js` | Markup dual (tabla + lista mobile), sheet acciones, handlers existentes |
| `css/app-gestion.css` | Desktop form/tabla + mobile stacked form, list rows, sheet, empty |

---

### Task 1: CSS responsive industrial (form + tabla + lista)

**Files:**
- Modify: `css/app-gestion.css`

**Interfaces:**
- Consumes: clases actuales `.gestion-view`, `.gestion-form`, `.gestion-table`, `.chip-*`
- Produces: `.gestion-list` (mobile), `.gestion-row`, `.gestion-sheet` (+ overlay), media query `@media (max-width: 767px)`

- [ ] **Step 1: Ampliar `app-gestion.css` con mobile list + sheet**

Añadir al final del archivo (conservar reglas existentes; ajustar form/table solo donde haga falta):

```css
/* —— Responsive Invitaciones —— */
@media (max-width: 767px) {
  .gestion-view { padding: 16px; }
  .gestion-form { flex-direction: column; align-items: stretch; }
  .gestion-form .field { width: 100%; }
  .gestion-form select,
  .gestion-form input { min-width: 0; width: 100%; }
  .gestion-form .btn-primary { width: 100%; justify-content: center; }
  .gestion-table-wrap { display: none; }
  .gestion-list { display: flex; flex-direction: column; }
}

@media (min-width: 768px) {
  .gestion-list { display: none; }
  .gestion-table-wrap { display: block; }
}

.gestion-list { display: none; gap: 0; }
.gestion-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
  align-items: center;
}
.gestion-row-main { min-width: 0; }
.gestion-row-code {
  display: flex; align-items: center; gap: 8px;
  font-family: ui-monospace, monospace;
  font-weight: 600; letter-spacing: 1px; font-size: 15px;
}
.gestion-row-meta {
  font-size: 12px; color: var(--text-muted, #64748b);
  margin-top: 4px;
}
.gestion-row-side {
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
}
.btn-more {
  background: none; border: 0; padding: 8px; border-radius: 8px;
  color: var(--text-muted, #64748b); cursor: pointer;
}
.btn-more:hover { background: var(--bg); color: var(--text); }

.gestion-sheet-overlay {
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45);
  z-index: 80; display: none;
}
.gestion-sheet-overlay.open { display: block; }
.gestion-sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 81;
  background: var(--surface); border-radius: 16px 16px 0 0;
  border: 1px solid var(--border); padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
  transform: translateY(100%); transition: transform 180ms ease;
}
.gestion-sheet-overlay.open .gestion-sheet { transform: translateY(0); }
.gestion-sheet-title {
  font-size: 13px; font-weight: 600; color: var(--text-muted, #64748b);
  margin: 0 0 12px; letter-spacing: 1px;
}
.gestion-sheet-action {
  width: 100%; text-align: left; padding: 14px 12px;
  border: 0; border-radius: 8px; background: transparent;
  color: var(--text); font: inherit; font-weight: 500; cursor: pointer;
  display: flex; align-items: center; gap: 12px;
}
.gestion-sheet-action:hover { background: var(--bg); }
.gestion-sheet-action.danger { color: #dc2626; }
.gestion-sheet-cancel {
  width: 100%; margin-top: 8px; padding: 14px;
  border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg); color: var(--text); font-weight: 600; cursor: pointer;
}
```

- [ ] **Step 2: Verificación rápida**

Abrir `/app/gestion` en DevTools (no hace falta deploy). Confirmar que el CSS carga sin errores de sintaxis (panel Styles).

- [ ] **Step 3: Commit** (si el usuario pidió commits en esta sesión)

```bash
git add css/app-gestion.css
git commit -m "$(cat <<'EOF'
style(gestion): add responsive invitaciones list and sheet styles

EOF
)"
```

---

### Task 2: Markup dual + sheet en `gestion.js`

**Files:**
- Modify: `js/app/views/gestion.js`

**Interfaces:**
- Consumes: `subscribeInvitaciones`, `crearInvitacion`, `revocarInvitacion`, `estadoInvitacion`, `ESTADO_CHIP`
- Produces: `#inv-tbody` (desktop), `#inv-list` (mobile), `#inv-sheet` overlay con acciones

- [ ] **Step 1: Actualizar HTML del `mount()`**

En el template de `container.innerHTML`, envolver la tabla y añadir lista + sheet:

```js
      <div class="gestion-card gestion-table-wrap">
        <table class="gestion-table" id="inv-table">
          <thead>
            <tr>
              <th aria-sort="descending">Código</th><th>Plaza</th><th>Rol</th>
              <th>Estado</th><th>Expira</th><th></th>
            </tr>
          </thead>
          <tbody id="inv-tbody">
            <tr><td colspan="6" class="t-empty">Cargando…</td></tr>
          </tbody>
        </table>
      </div>

      <div class="gestion-card gestion-list" id="inv-list" aria-live="polite">
        <div class="t-empty">Cargando…</div>
      </div>
    </section>

    <div class="gestion-sheet-overlay" id="inv-sheet" hidden>
      <div class="gestion-sheet" role="dialog" aria-modal="true" aria-labelledby="inv-sheet-title">
        <p class="gestion-sheet-title" id="inv-sheet-title"></p>
        <button type="button" class="gestion-sheet-action" data-sheet="copy">
          <span class="material-symbols-outlined">content_copy</span> Copiar código
        </button>
        <button type="button" class="gestion-sheet-action danger" data-sheet="revoke" hidden>
          <span class="material-symbols-outlined">block</span> Revocar
        </button>
        <button type="button" class="gestion-sheet-cancel" data-sheet="close">Cancelar</button>
      </div>
    </div>`;
```

Nota: el overlay puede vivir **fuera** de `.gestion-view` pero dentro de `container` (el shell main). Quitar `hidden` al abrir y togglear clase `.open`.

- [ ] **Step 2: Extender `render(items)` para poblar `#inv-list`**

Tras pintar `#inv-tbody`, poblar la lista mobile:

```js
  const listEl = container.querySelector('#inv-list');

  function render(items) {
    // ... existing tbody empty / rows ...

    if (!items.length) {
      listEl.innerHTML = `<div class="t-empty">
        <span class="material-symbols-outlined">mail</span>
        Aún no hay invitaciones. Genera la primera arriba.</div>`;
      return;
    }
    const ahora = Date.now();
    listEl.innerHTML = items.map(it => {
      const est = estadoInvitacion(it, ahora);
      const chip = ESTADO_CHIP[est];
      return `<div class="gestion-row" data-codigo="${it.codigo}" data-estado="${est}">
        <div class="gestion-row-main">
          <div class="gestion-row-code"><code>${it.codigo}</code></div>
          <div class="gestion-row-meta">${it.plaza} · ${it.rol} · ${fmtFecha(it.expiraEnMs)}</div>
        </div>
        <div class="gestion-row-side">
          <span class="chip ${chip.cls}">
            <span class="material-symbols-outlined">${chip.icon}</span>${est}</span>
          <button type="button" class="btn-more" data-more="${it.codigo}" aria-label="Acciones">
            <span class="material-symbols-outlined">more_vert</span>
          </button>
        </div>
      </div>`;
    }).join('');
  }
```

Asegurar que el empty de `tbody` y el early-return también limpien/actualicen `listEl` (evitar duplicar early-return inconsistente: un solo path que actualice ambos).

- [ ] **Step 3: Sheet open/close + handlers**

```js
  const sheet = container.querySelector('#inv-sheet');
  let _sheetCodigo = null;
  let _sheetPuedeRevocar = false;

  function openSheet(codigo, puedeRevocar) {
    _sheetCodigo = codigo;
    _sheetPuedeRevocar = puedeRevocar;
    sheet.querySelector('#inv-sheet-title').textContent = codigo;
    sheet.querySelector('[data-sheet="revoke"]').hidden = !puedeRevocar;
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('open'));
  }
  function closeSheet() {
    sheet.classList.remove('open');
    setTimeout(() => { sheet.hidden = true; _sheetCodigo = null; }, 200);
  }

  listEl.addEventListener('click', (e) => {
    const more = e.target.closest('[data-more]');
    if (!more) return;
    const row = more.closest('.gestion-row');
    openSheet(more.dataset.more, row?.dataset.estado === 'VIGENTE');
  });

  sheet.addEventListener('click', async (e) => {
    if (e.target === sheet) { closeSheet(); return; }
    const act = e.target.closest('[data-sheet]');
    if (!act) return;
    const kind = act.dataset.sheet;
    if (kind === 'close') { closeSheet(); return; }
    if (kind === 'copy' && _sheetCodigo) {
      await navigator.clipboard.writeText(_sheetCodigo).catch(() => {});
      closeSheet();
      return;
    }
    if (kind === 'revoke' && _sheetCodigo && _sheetPuedeRevocar) {
      const ok = await mexConfirm('¿Revocar este código? No podrá usarse para registrarse.', 'Revocar invitación');
      if (!ok) return;
      try {
        await revocarInvitacion(_sheetCodigo);
        closeSheet();
      } catch (err) {
        await mexAlert(err?.message || 'No se pudo revocar.', 'Error');
      }
    }
  });
```

Conservar el listener de `tbody` para copy/revoke en desktop sin cambios de comportamiento.

- [ ] **Step 4: Syntax check**

Run: `node --check js/app/views/gestion.js`  
Expected: exit 0, sin output.

- [ ] **Step 5: Commit** (si aplica)

```bash
git add js/app/views/gestion.js css/app-gestion.css
git commit -m "$(cat <<'EOF'
feat(gestion): responsive invitaciones list with mobile action sheet

EOF
)"
```

---

### Task 3: QA manual + bump SW

**Files:**
- Touch: `sw.js` vía `node scripts/bump-sw.js`

- [ ] **Step 1: Checklist manual**

| Check | Esperado |
|---|---|
| Desktop ≥768 | Form fila + tabla visible; lista oculta |
| Mobile &lt;768 | Form columna; lista visible; tabla oculta |
| Copiar desktop | Icono copy en fila tabla |
| Copiar mobile | Sheet → Copiar |
| Revocar VIGENTE | Confirm + desaparece/cambia estado |
| No VIGENTE | Sin Revocar en tabla ni en sheet |
| Empty | Mensaje + icono mail en ambos layouts |
| Dark theme | Chips/sheet legibles |

- [ ] **Step 2: Bump SW + push** (cierre de tarea con código)

```bash
node scripts/bump-sw.js
git add -A
git commit -m "$(cat <<'EOF'
chore: bump SW after invitaciones UI redesign

EOF
)"
git push
```

---

## Spec coverage

| Spec § | Task |
|---|---|
| Desktop form arriba + tabla | Task 1–2 |
| Mobile lista settings + sheet | Task 1–2 |
| Chips/estados sin cambio | Task 2 (reusa `ESTADO_CHIP`) |
| Sin tocar domain/Functions | (ninguna task los modifica) |
| Empty state | Task 2 |
| Verificación | Task 3 |
