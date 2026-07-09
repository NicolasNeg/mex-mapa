# MapGestión Fase 1 — Bugs operativos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arreglar los 7 bugs que rompen la operación de MapGestión (spec `docs/superpowers/specs/2026-06-30-mapgestion-roadmap-fase1-design.md`).

**Architecture:** App híbrida: SPA (`/app/*`, ES modules) + páginas legacy (`mapa.html`, `cuadre.html`, `gestion.html`) embebidas como iframes con `?shell=1`. Sin build step ni harness de unit tests (solo un smoke test Playwright). Por eso la verificación de cada bug es **reproducción en navegador** contra el emulador o producción; la lógica pura (dedup, fecha) lleva un self-check `node` mínimo.

**Tech Stack:** Firebase compat SDK, Firestore, vanilla JS. Deploy: `npm run deploy` (auto-bump SW) + `git push`.

## Global Constraints

- **Nunca desplegar sin bumpear SW** — `npm run deploy` corre `scripts/bump-sw.js` (incrementa `CACHE_NAME='mapa-vXXX'` en `sw.js`). Un solo deploy al final de la Fase 1.
- **Tras cada deploy:** `git add . && git commit && git push`.
- **Commits atómicos por bug**, mensaje en español, terminar con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Diseño:** Inter, acento `#3b82f6`, iconos `material-symbols-outlined`, tokens de spacing/radius de `ESTILO.md`. Sin Tailwind en páginas legacy.
- **Sin `alert()/confirm()`** — usar `mexAlert/mexConfirm` de `js/core/dialogs.js` (o `showToast` en legacy mapa).

---

### Task 1: Bug 1.1 — Guard de `plazaActual` al insertar unidad

**Files:**
- Modify: `api/cuadre.js:133-188` (`insertarUnidadDesdeHTML`), `api/cuadre.js:190-231` (`insertarUnidadExterna`)
- Test: `scripts/selfcheck-plaza-guard.js` (Create)

**Interfaces:**
- Consumes: `db`, `COL.INDEX`, `COL.CUADRE`, `COL.EXTERNOS` (ya importados en el módulo).
- Produces: ambos inserts rechazan si `index_unidades[mva].plazaActual` es una plaza distinta y no vacía; devuelven string de error (mismo contrato que la validación de duplicado existente).

- [ ] **Step 1: Self-check de la lógica pura del guard**

Crear `scripts/selfcheck-plaza-guard.js`:

```js
// Self-check puro: decide si se bloquea la inserción por plazaActual.
// ponytail: lógica extraída para testear sin Firebase.
function bloqueaPorPlaza(plazaActualIndex, plazaDestino) {
  const actual = String(plazaActualIndex || '').toUpperCase().trim();
  const destino = String(plazaDestino || '').toUpperCase().trim();
  return actual !== '' && actual !== destino;
}

const assert = require('assert');
assert.equal(bloqueaPorPlaza('', 'BAJIO'), false, 'vacío => permite');
assert.equal(bloqueaPorPlaza('BAJIO', 'BAJIO'), false, 'misma plaza => permite');
assert.equal(bloqueaPorPlaza('LEON', 'BAJIO'), true, 'otra plaza => bloquea');
assert.equal(bloqueaPorPlaza('leon', 'BAJIO'), true, 'case-insensitive');
assert.equal(bloqueaPorPlaza('BAJIO', ''), true, 'destino vacío con actual => bloquea');
console.log('OK plaza-guard');

module.exports = { bloqueaPorPlaza };
```

- [ ] **Step 2: Correr el self-check (falla: archivo no ejercita el código real aún, pero valida la lógica)**

Run: `node scripts/selfcheck-plaza-guard.js`
Expected: `OK plaza-guard`

- [ ] **Step 3: Añadir el guard en `insertarUnidadDesdeHTML`**

En `api/cuadre.js`, dentro de `insertarUnidadDesdeHTML`, DESPUÉS de leer `indexData` (línea ~147, tras `const indexData = ...`) y ANTES de construir `unitData`:

```js
      // Guard: la unidad no puede estar activa en otra plaza (índice global).
      const plazaActualIdx = String(indexData.plazaActual || '').toUpperCase().trim();
      if (plazaActualIdx && plazaActualIdx !== plazaUp) {
        return `La unidad ${mvaStr} está registrada en la plaza ${plazaActualIdx}. Retírala de ahí antes de insertarla aquí.`;
      }
```

- [ ] **Step 4: Añadir el guard en `insertarUnidadExterna`**

En `insertarUnidadExterna`, tras la validación de duplicado en EXTERNOS (línea ~199, tras `if (!existeLeg.empty) return ...`), añadir la lectura del índice + guard:

```js
      const idxSnapExt = await db.collection(COL.INDEX).where("mva", "==", mvaStr).limit(1).get();
      const plazaActualExt = idxSnapExt.empty ? '' : String(idxSnapExt.docs[0].data().plazaActual || '').toUpperCase().trim();
      if (plazaActualExt && plazaActualExt !== plazaUp) {
        return `La unidad ${mvaStr} está registrada en la plaza ${plazaActualExt}.`;
      }
```

- [ ] **Step 5: Verificar en navegador**

Reproducir: en cuadre de Plaza A insertar un MVA; cambiar a Plaza B; intentar insertar el mismo MVA.
Expected: mensaje "está registrada en la plaza A…"; no se crea el doc en el cuadre de B.

- [ ] **Step 6: Commit**

```bash
git add api/cuadre.js scripts/selfcheck-plaza-guard.js
git commit -m "fix(cuadre): bloquear inserción de unidad activa en otra plaza (plazaActual)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Bug 1.2 — Turnos no cargan (índice asistencia + fila propia)

**Files:**
- Modify: `firestore.indexes.json` (añadir índice `asistencia`)
- Modify: `js/app/views/turnos.js:374-380` (fallback fila propia)

**Interfaces:**
- Consumes: `_s.profile`, `_s.uid`, `_s.plaza` (ya en el estado de la vista, ver `turnos.js:45-52`).
- Produces: no-admin siempre ve su fila propia aunque `getUsuariosPlaza` no lo devuelva; tab Asistencia deja de fallar por índice.

- [ ] **Step 1: Añadir el índice compuesto de `asistencia`**

En `firestore.indexes.json`, dentro del array `"indexes"`, añadir un objeto más (junto a los existentes):

```json
    {
      "collectionGroup": "asistencia",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "plaza", "order": "ASCENDING" },
        { "fieldPath": "fecha", "order": "ASCENDING" }
      ]
    }
```

- [ ] **Step 2: Desplegar solo los índices**

Run: `firebase deploy --only firestore:indexes --project production`
Expected: build del índice iniciado; en consola Firestore aparece `asistencia (plaza, fecha)` como *Building* → *Enabled*.

- [ ] **Step 3: Fallback de fila propia para no-admin**

En `js/app/views/turnos.js`, reemplazar el bloque de `lista` (líneas ~375-379):

```js
    const lista = isAdmin ? usuarios : usuarios.filter(u => (u.uid || u.id) === uid);
    if (!lista.length) {
      filas = `<tr><td colspan="8" class="tu-grid-empty">
        ${isAdmin ? 'No hay usuarios registrados en esta plaza.' : 'No se encontró tu perfil en esta plaza.'}
      </td></tr>`;
```

por:

```js
    let lista = isAdmin ? usuarios : usuarios.filter(u => (u.uid || u.id) === uid);
    // Fallback: un no-admin siempre debe verse a sí mismo aunque getUsuariosPlaza
    // no lo devuelva (plazaAsignada desincronizada). Ver spec Fase 1.2.
    if (!isAdmin && !lista.length && uid) {
      lista = [{ uid, id: uid, ...profile }];
    }
    if (!lista.length) {
      filas = `<tr><td colspan="8" class="tu-grid-empty">
        No hay usuarios registrados en esta plaza.
      </td></tr>`;
```

- [ ] **Step 4: Verificar en navegador**

Con un usuario no-admin de la plaza: abrir Turnos → Horarios.
Expected: aparece su fila propia (no el mensaje "No se encontró tu perfil"). Tab Asistencia carga sin error de índice en consola (una vez el índice esté *Enabled*).

- [ ] **Step 5: Commit**

```bash
git add firestore.indexes.json js/app/views/turnos.js
git commit -m "fix(turnos): índice asistencia(plaza,fecha) + fila propia siempre visible para no-admin

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Bug 1.3 — Panel admin redirige todo a Usuarios

**Files:**
- Modify: `js/views/mapa.js` (`_cfgCanAccessTab` / contexto de permisos en gestion.html) — línea exacta tras reproducción.

**Interfaces:**
- Consumes: `window.mexPerms`, `window.mexFeatures`, `canUseProgrammerConfig()`.
- Produces: `_cfgVisibleAdminTabs()` devuelve todas las pestañas permitidas al usuario real.

- [ ] **Step 1: Reproducir y capturar las pestañas visibles**

Abrir `/app/admin` (iframe gestion.html). En la consola del iframe ejecutar:

```js
console.log('visibles:', _cfgVisibleAdminTabs());
console.log('prog:', typeof canUseProgrammerConfig === 'function' && canUseProgrammerConfig());
console.log('mexPerms:', !!window.mexPerms, 'mexFeatures:', !!window.mexFeatures);
```

Anotar cuáles salen. Hipótesis: `mexPerms`/`mexFeatures` no inicializados en el iframe → todo salvo `usuarios` cae fuera.

- [ ] **Step 2: Aplicar el fix según lo observado**

- Si `mexPerms`/`mexFeatures` son `undefined` en el iframe → asegurar que `gestion.html` los inicialice (mismo bootstrap que `app.html`), o que `canUseProgrammerConfig()` no dependa de ellos para el programador bootstrap (email en la lista bootstrap ⇒ `true` directo).
- Si el usuario NO es programador y simplemente le faltan permisos → es comportamiento correcto (no es bug); documentarlo y cerrar.

Editar la función culpable identificada en Step 1 (probablemente `canUseProgrammerConfig` o la carga de contexto en gestion.html). Mostrar el diff exacto al ejecutar.

- [ ] **Step 3: Verificar**

Recargar `/app/admin`, hacer clic en Roles, Estados, Plazas, Empresa, Programador.
Expected: cada pestaña muestra su propia vista, no Usuarios.

- [ ] **Step 4: Commit**

```bash
git add js/views/mapa.js gestion.html
git commit -m "fix(admin): pestañas del panel ya no redirigen todas a Usuarios

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Bug 1.4 — Cuadre: restaurar "MÁS CONTROLES" y "CONTROLES ADMIN"

**Files:**
- Modify: `cuadre.html` y/o `js/views/mapa.js` — según reproducción.

**Interfaces:**
- Consumes: infra existente de controles del mapa (`#btnControles`, menú "MÁS CONTROLES").
- Produces: acceso a las herramientas de controles/admin desde la sección Cuadre.

- [ ] **Step 1: Reproducir qué falta exactamente**

Abrir `/app/cuadre`. Confirmar contra la nota Obsidian (`POR ARREGLAR.md`) qué botones/menús "MÁS CONTROLES" y "CONTROLES ADMIN" faltan. Nota: hoy esos controles viven en el **mapa** (`mapa.html #btnControles`), no en cuadre.

- [ ] **Step 2: Decidir alcance (lazy)**

Si eran controles que se ocultaron por el blindaje CSS `html.shell-embedded .fleet-header-top{display:none}` (cuadre.html:105) → mover esos botones fuera de `.fleet-header-top` o darles excepción CSS.
Si la petición es **llevar** las herramientas del mapa a cuadre → exponer los botones de admin/controles que cuadre ya tiene (batch actions / gestión admin) y enlazarlos; NO duplicar el menú del mapa. Ponytail: reusar los handlers existentes de cuadre, no reimplementar.

- [ ] **Step 3: Implementar el fix mínimo identificado**

Editar `cuadre.html` (o el JS que renderiza los controles de cuadre) para re-exponer los botones. Mostrar diff al ejecutar.

- [ ] **Step 4: Verificar**

Abrir `/app/cuadre`: los botones "MÁS CONTROLES" y "CONTROLES ADMIN" aparecen y abren sus acciones.

- [ ] **Step 5: Commit**

```bash
git add cuadre.html js/views/mapa.js
git commit -m "fix(cuadre): restaurar acceso a MÁS CONTROLES y CONTROLES ADMIN

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Bug 1.5 — Buscador global "Ir al mapa" no resalta la unidad

**Files:**
- Modify: `js/app/views/legacy-stage.js` (`_applyPendingMapFocus`), `js/app/main.js` (`__mexGoToMapUnit`)

**Interfaces:**
- Consumes: `window.__mexPendingMapFocus = { mva, plaza }`, `iframe.contentWindow.__mexFocusUnidad(mva)`.
- Produces: el focus pendiente se re-aplica cuando el iframe del mapa termina de cargar y ya está en la plaza correcta.

- [ ] **Step 1: Reproducir**

Buscar (lupa header) una unidad de OTRA plaza → "Ver en mapa". Observar: cambia de plaza pero el input del buscador del mapa no se rellena ni se resalta el marcador.

- [ ] **Step 2: Re-aplicar el focus en el `load` del iframe**

En `js/app/views/legacy-stage.js`, donde se crea/reusa el iframe del mapa, asegurar que `_applyPendingMapFocus(iframe)` se llame también en el evento `load` del iframe (no solo una vez). Añadir, al construir el iframe del mapa:

```js
    iframe.addEventListener('load', () => { _applyPendingMapFocus(iframe); });
```

Y en `_applyPendingMapFocus`, reintentar si `__mexFocusUnidad` aún no existe:

```js
function _applyPendingMapFocus(iframe) {
  const pend = window.__mexPendingMapFocus;
  if (!pend) return;
  const win = iframe?.contentWindow;
  if (win && typeof win.__mexFocusUnidad === 'function') {
    win.__mexFocusUnidad(pend.mva);
    window.__mexPendingMapFocus = null;
  } else {
    // ponytail: el iframe/mapa aún no expone la fn; reintento corto.
    setTimeout(() => _applyPendingMapFocus(iframe), 300);
  }
}
```

(Si `_applyPendingMapFocus` ya tiene esta forma, solo añadir el listener `load`. Confirmar el cuerpo actual antes de editar.)

- [ ] **Step 3: Confirmar que `__mexGoToMapUnit` setea el pending antes de navegar**

En `js/app/main.js`, verificar que `__mexGoToMapUnit(mva, plaza)` haga `window.__mexPendingMapFocus = { mva, plaza }` ANTES de `setCurrentPlaza`/navegar. Si no, añadirlo.

- [ ] **Step 4: Verificar**

Buscar unidad de otra plaza → "Ver en mapa".
Expected: cambia de plaza, el buscador del mapa muestra el MVA y el marcador queda resaltado.

- [ ] **Step 5: Commit**

```bash
git add js/app/views/legacy-stage.js js/app/main.js
git commit -m "fix(buscador): re-aplicar focus de unidad en el load del iframe del mapa

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Bug 1.6 — Alertas sin estilo y reaparecen aunque leídas

**Files:**
- Modify: `js/app/views/alertas.js` y/o el renderer de alertas legacy; `css/app-alertas.css` (inyección).

**Interfaces:**
- Consumes: `alerta.leidoPor`/`leidaPor` (CSV de uids), uid actual.
- Produces: alertas con estilo correcto; una alerta marcada leída no reaparece tras recargar.

- [ ] **Step 1: Reproducir y aislar las dos fallas**

Abrir donde salen las alertas. Confirmar: (a) ¿el `<link>`/inyección de `css/app-alertas.css` está presente en ese contexto? (b) al marcar leída, ¿se persiste en Firestore (`leidoPor`) o solo en UI?

- [ ] **Step 2: Fix CSS (inyección)**

Si `css/app-alertas.css` no está cargado en el contexto donde salen las alertas, inyectarlo en el `mount()` de la vista (patrón de las demás vistas SPA):

```js
if (!document.getElementById('css-app-alertas')) {
  const l = document.createElement('link');
  l.id = 'css-app-alertas'; l.rel = 'stylesheet'; l.href = '/css/app-alertas.css';
  document.head.appendChild(l);
}
```

- [ ] **Step 3: Fix persistencia "leída"**

Asegurar que "marcar leída" escriba el uid en `leidoPor` (Firestore) y que el render/listener EXCLUYA las que ya contienen el uid actual. Usar el helper existente `notifications-summary.js:49` (`leidoPor || leidaPor || readBy`) como referencia del campo canónico. Mostrar diff al ejecutar.

- [ ] **Step 4: Verificar**

Alerta aparece con estilo correcto; marcar leída → recargar → no reaparece.

- [ ] **Step 5: Commit**

```bash
git add js/app/views/alertas.js css/app-alertas.css
git commit -m "fix(alertas): cargar estilos + persistir leído para que no reaparezcan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Bug 1.7 — Historial: filtro por fecha no funciona

**Files:**
- Modify: `js/app/views/historial-operativo.js:169-172` (u otro historial, según reproducción)
- Test: `scripts/selfcheck-fecha-dia.js` (Create)

**Interfaces:**
- Consumes: `r.timestamp` (tipo real a confirmar: número en segundos, ms, o Firestore Timestamp).
- Produces: el filtro compara por día local sin importar la hora.

- [ ] **Step 1: Confirmar el tipo real de `r.timestamp`**

Abrir el historial, en consola: `console.log(typeof rows[0].timestamp, rows[0].timestamp)` (o inspeccionar el objeto). El filtro actual (`historial-operativo.js:171`) hace `new Date(r.timestamp * 1000)` — correcto SOLO si `timestamp` está en **segundos**. Si es ms o `{seconds}`, ahí está el bug.

- [ ] **Step 2: Self-check de normalización a día local**

Crear `scripts/selfcheck-fecha-dia.js`:

```js
// ponytail: normaliza cualquier ts (s | ms | {seconds}) a 'YYYY-MM-DD' local.
function tsADia(ts) {
  let ms;
  if (ts && typeof ts === 'object' && 'seconds' in ts) ms = ts.seconds * 1000;
  else if (typeof ts === 'number') ms = ts < 1e12 ? ts * 1000 : ts; // <1e12 => segundos
  else ms = new Date(ts).getTime();
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
const assert = require('assert');
const base = new Date(2026, 6, 9, 15, 30); // 2026-07-09 15:30 local
const secs = Math.floor(base.getTime()/1000);
assert.equal(tsADia(secs), '2026-07-09', 'segundos');
assert.equal(tsADia(base.getTime()), '2026-07-09', 'ms');
assert.equal(tsADia({ seconds: secs }), '2026-07-09', 'firestore ts');
console.log('OK fecha-dia');
module.exports = { tsADia };
```

- [ ] **Step 3: Correr el self-check**

Run: `node scripts/selfcheck-fecha-dia.js`
Expected: `OK fecha-dia`

- [ ] **Step 4: Aplicar `tsADia` en el filtro real**

En `js/app/views/historial-operativo.js`, reemplazar el cuerpo del filtro (líneas ~169-172) para usar la normalización robusta:

```js
  if (_state.fechaMov) rows = rows.filter(r => _tsADia(r.timestamp) === _state.fechaMov);
```

y añadir el helper `_tsADia` (copiar la función `tsADia` del self-check) cerca de los helpers del módulo. Si la reproducción del Step 1 apunta a OTRO historial (historial de cuadres), aplicar la misma normalización ahí.

- [ ] **Step 5: Verificar**

Elegir un día con registros en el filtro de fecha.
Expected: aparecen todos los registros de ese día sin importar la hora.

- [ ] **Step 6: Commit**

```bash
git add js/app/views/historial-operativo.js scripts/selfcheck-fecha-dia.js
git commit -m "fix(historial): filtrar por día normalizando el timestamp (s/ms/firestore)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Deploy de la Fase 1

**Files:** ninguno (solo despliegue)

- [ ] **Step 1: Smoke test local**

Run: `node scripts/test-mapa.js`
Expected: PASS (login → mapa → sidebar + controles).

- [ ] **Step 2: Deploy hosting (auto-bump SW)**

Run: `npm run deploy`
Expected: SW bumpeado, hosting desplegado a producción.

- [ ] **Step 3: Push a GitHub**

Run: `git push`
Expected: rama `main` sincronizada.

- [ ] **Step 4: Verificación post-deploy en app.mapgestion.com**

Reproducir los 7 bugs en producción (misma verificación de cada task). Confirmar el índice `asistencia` en estado *Enabled*.

---

## Self-Review

- **Cobertura del spec:** 1.1→T1, 1.2→T2, 1.3→T3, 1.4→T4, 1.5→T5, 1.6→T6, 1.7→T7, deploy→T8. ✅
- **Placeholders:** T3, T4, T6 tienen un Step 1 de reproducción porque la causa exacta es runtime-dependiente (contexto de permisos en iframe / regresión CSS / inyección de CSS). El fix concreto se aplica en el step siguiente con diff mostrado — no es "TODO", es diagnóstico legítimo antes de tocar. T1, T2, T5, T7 llevan código exacto.
- **Consistencia de tipos:** `plazaActual` normalizado `.toUpperCase().trim()` en T1 igual que en `api/cuadre.js`. `leidoPor` como campo canónico (T6) según `notifications-summary.js`. `_tsADia`/`tsADia` misma firma en self-check y en la vista (T7).
