# Cuadre flota nuevos errores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Excluir externos del cuadre, listener en vivo para Ventas, grid 4×4 editable en Ventas, timers post-éxito y PDF imprimible (cierre + historial).

**Architecture:** Parches locales sobre API flota/cuadre y vistas SPA existentes; print vía `window.open` autocontenido; `onSnapshot` en `settings/{plaza}`.

**Tech Stack:** Vanilla JS SPA, Firestore client SDK, CSS design-system tokens (`.cf*`).

**Spec:** `docs/superpowers/specs/2026-07-22-cuadre-flota-nuevos-errores-design.md`

## Global Constraints

- No unificar auxiliar/ventas; no FCM nuevo; no Cloud Functions.
- Externos: filtro en `obtenerDatosFlotaConsola` + guard en `iniciarProtocoloDesdeAdmin` + filtro al pintar.
- Listener: actualiza tarjeta in-place; sin auto-navigate.
- Ventas: solo grid 4×4 editable (Presente/Faltante/gas/km/sobrante).
- Timers: auxiliar 2s → `/app/dashboard`; ventas 3s → `/app/cuadre/flota` tab historial.
- PDF: al cerrar Ventas + Historial Ver PDF; print-safe sin `body * { visibility:hidden }` en shell.

## File map

| File | Responsibility |
|---|---|
| `api/flota.js` | Flota consola sin EXTERNOS |
| `api/cuadre.js` | `_esUnidadExterna` + filtro en misión |
| `js/app/views/cuadre-flota.js` | Listener settings + historial `jsonCompleto` |
| `js/app/views/cuadrarflota.js` | Filtro externos + timer 2s dashboard |
| `js/app/views/cuadrarflota-ventas.js` | Grid 4×4 + PDF al cerrar + timer 3s |
| `css/app-cuadrarflota.css` | Estilos grid Ventas |
| `js/core/cuadre-pdf.js` | `abrirReporteImpresion` print-safe |

---

### Task 1: Excluir externos en flota + misión

**Files:**
- Modify: `api/flota.js` (`obtenerDatosFlotaConsola`)
- Modify: `api/cuadre.js` (`iniciarProtocoloDesdeAdmin` + helper)

- [ ] **Step 1:** En `obtenerDatosFlotaConsola`, eliminar la query y el map de `COL.EXTERNOS`; devolver solo docs de `COL.CUADRE`.

- [ ] **Step 2:** En `api/cuadre.js`, añadir:

```js
function _esUnidadExterna(u = {}) {
  if (String(u.tipo || '').toLowerCase() === 'externo') return true;
  const blob = [u.estado, u.ubicacion, u.categoria, u.categ]
    .map(v => String(v || '').toUpperCase())
    .join(' ');
  return blob.includes('EXTERNO');
}
```

- [ ] **Step 3:** En `iniciarProtocoloDesdeAdmin`, tras parsear `unidades`, hacer `unidades = unidades.filter(u => !_esUnidadExterna(u))`. Si `!unidades.length` return `{ exito: false, error: 'No hay unidades de patio para el cuadre' }` sin `_setSettings` PROCESO.

- [ ] **Step 4:** En `cuadre-flota.js` `_enviarMision`, si `!res.exito` mostrar `res.error` en toast.

- [ ] **Step 5:** Commit `fix(cuadre): excluir unidades externas de flota y mision`

---

### Task 2: Listener realtime en cuadre-flota

**Files:**
- Modify: `js/app/views/cuadre-flota.js`

- [ ] **Step 1:** Guardar `_unsubSettings = null`. En mount (y al cambiar plaza), suscribir:

```js
_unsubSettings = db.collection(COL.SETTINGS).doc(_s.plaza).onSnapshot(snap => {
  if (!_s || _s.busy) return;
  const data = snap.data() || {};
  const estado = String(data.estadoCuadreV3 || 'LIBRE').toUpperCase();
  // map PROCESO / REVISION / LIBRE → _s.mission; solo _paint si state cambió
}, err => console.warn('[cuadre-flota] settings listener', err));
```

Usar el mismo `_unitsFrom` / `_metaFrom` parseando `misionAuditoria` / `datosAuditoria` JSON.

- [ ] **Step 2:** Cleanup en `unmount` y antes de re-suscribir.

- [ ] **Step 3:** Commit `feat(cuadre): listener settings para revision de ventas`

---

### Task 3: Grid 4×4 Ventas + filtro externos en vistas

**Files:**
- Modify: `js/app/views/cuadrarflota-ventas.js`
- Modify: `js/app/views/cuadrarflota.js` (`_buildAuditUnits` filter)
- Modify: `css/app-cuadrarflota.css`
- Modify: `js/app/router.js` (bump query `?v=` del CSS ventas)

- [ ] **Step 1:** Helper local `_esExterna(u)` en ambas vistas; filtrar en `_buildAuditUnits`.

- [ ] **Step 2:** En ventas: quitar toggle Tarjeta/Lista; `_mainHtml` siempre grid; celda con img + badge + fields + acciones.

- [ ] **Step 3:** CSS `.cfv-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }` + breakpoints 2 / 1.

- [ ] **Step 4:** Commit `feat(cuadre): grid 4x4 editable en revision ventas`

---

### Task 4: PDF print-safe + historial jsonCompleto + abrir al cerrar

**Files:**
- Modify: `js/core/cuadre-pdf.js` (`abrirReporteImpresion`)
- Modify: `js/app/views/cuadre-flota.js` (`_historialCuadrePayload`)
- Modify: `js/app/views/cuadrarflota-ventas.js` (`_submit` success)

- [ ] **Step 1:** Reescribir `abrirReporteImpresion` para abrir `window.open`, escribir HTML documento completo (doctype + head + body con el contenido), `document.title = signedTitle`, `print()`, cerrar/cleanup en `afterprint`. Fallback toast via `onError` si popup bloqueado.

- [ ] **Step 2:** `_historialCuadrePayload`: parsear `item.jsonCompleto` primero.

- [ ] **Step 3:** Tras cierre exitoso en ventas, importar y llamar `generarHtmlAuditoriaCuadrePdf` + `abrirReporteImpresion` con payload del cierre.

- [ ] **Step 4:** Commit `fix(cuadre): PDF print-safe y payload historial`

---

### Task 5: Timers post-éxito

**Files:**
- Modify: `js/app/views/cuadrarflota.js`
- Modify: `js/app/views/cuadrarflota-ventas.js`
- Modify: `js/app/views/cuadre-flota.js` (aceptar tab historial vía query o state al navegar)

- [ ] **Step 1:** Auxiliar: tras `_s.completed = true`, `_redirectTimer = setTimeout(() => _navigate?.('/app/dashboard'), 2000)`; clear en unmount.

- [ ] **Step 2:** Ventas: tras completed, `setTimeout(() => _navigate?.('/app/cuadre/flota?tab=historial'), 3000)`.

- [ ] **Step 3:** En `cuadre-flota.js` mount/`_paint`, leer `?tab=historial` y set `_s.tab = 'historial'`.

- [ ] **Step 4:** Commit `feat(cuadre): timers redirect auxiliar y ventas`

- [ ] **Step 5:** Bump SW + push según política del repo al cerrar la tarea.
