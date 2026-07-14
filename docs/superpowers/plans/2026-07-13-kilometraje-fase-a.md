# Kilometraje global (Fase A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kilometraje actual + historial por unidad, capturado al insertar/retirar/cuadre de flota, con discrepancias detectadas, permiso de corrección, columna KM y gas-progressbar en la tabla del cuadre.

**Architecture:** Colecciones planas Firestore (`km_registros` append-only, `km_discrepancias`), km actual denormalizado en `index_unidades` y en el doc del cuadre. Lógica pura en `domain/kilometraje.model.js`; la API vive en `api/cuadre.js` (script clásico) con una copia privada de la clasificación. Sin Cloud Functions.

**Tech Stack:** Vanilla JS, Firebase compat SDK (v10 via script tags), Firestore rules, Playwright smoke test.

**Spec:** `docs/superpowers/specs/2026-07-13-kilometraje-traslados-design.md`

## Global Constraints

- No hay build step ni bundler. `api/*.js` son **scripts clásicos** (IIFE sobre `window._mexParts`); NO pueden usar `import`. `js/views/mapa.js` SÍ es ES module (`<script type="module">`).
- `api/_assemble.js` hace `Object.assign(window.api || {}, ...módulos)` → **api/cuadre.js pisa los duplicados de mex-api.js**. Solo tocar `api/cuadre.js`, nunca mex-api.js.
- Reglas Firestore: poner el check barato PRIMERO en cadenas OR (límite de 1000 expresiones — bug conocido).
- CSS: usar variables existentes (`var(--border)`, `var(--mex-blue)`); radius tokens `4/8/12/16/9999px`; el archivo de la tabla del cuadre es `css/mapa.css` (idioma legacy, hexes existentes OK).
- `km_registros` es append-only: nunca update/delete.
- Umbral de discrepancia: `window.MEX_CONFIG?.listas?.kmUmbralDiscrepancia`, default **5**.
- Al desplegar: `npm run deploy:rules` + `npm run deploy` (bump de SW automático), luego `git add . && git commit && git push`.
- Textos de UI en español, tono existente (labels con emoji en el form legacy están OK — es el idioma del archivo).

---

### Task 1: Lógica pura — domain/kilometraje.model.js

**Files:**
- Create: `domain/kilometraje.model.js`
- Test: `scripts/check-kilometraje.mjs`

**Interfaces:**
- Produces: `parseKm(raw) → number|null` (entero ≥ 0; acepta comas/espacios; null si inválido). `clasificarCaptura({ kmNuevo, kmAnterior, umbral=5, fuenteUltima='', esCorreccion=false }) → { tipo, delta }` con tipo ∈ `NORMAL | DISCREPANCIA | RECHAZADO_MENOR | CORRECCION | INVALIDO`. `SALIDAS_LEGITIMAS = ['RETIRO_RENTA','TRASLADO_SALIDA']`.
- Consumes: nada (puro).

- [ ] **Step 1: Escribir el check que falla**

Crear `scripts/check-kilometraje.mjs`:

```js
// Self-check de domain/kilometraje.model.js — correr: node scripts/check-kilometraje.mjs
import assert from 'node:assert/strict';
import { parseKm, clasificarCaptura } from '../domain/kilometraje.model.js';

// parseKm
assert.equal(parseKm('12,345'), 12345);
assert.equal(parseKm(' 150000 '), 150000);
assert.equal(parseKm(45210), 45210);
assert.equal(parseKm('abc'), null);
assert.equal(parseKm(''), null);
assert.equal(parseKm(null), null);
assert.equal(parseKm('-5'), null);
assert.equal(parseKm('15.5'), null); // km entero, sin decimales

// clasificarCaptura
assert.deepEqual(clasificarCaptura({ kmNuevo: 100, kmAnterior: null }), { tipo: 'NORMAL', delta: 0 }); // primera captura fija la base
assert.deepEqual(clasificarCaptura({ kmNuevo: 103, kmAnterior: 100 }), { tipo: 'NORMAL', delta: 3 }); // drift de patio ≤ umbral
assert.deepEqual(clasificarCaptura({ kmNuevo: 120, kmAnterior: 100 }), { tipo: 'DISCREPANCIA', delta: 20 }); // > umbral sin salida legítima
assert.deepEqual(clasificarCaptura({ kmNuevo: 900, kmAnterior: 100, fuenteUltima: 'RETIRO_RENTA' }), { tipo: 'NORMAL', delta: 800 }); // regreso de renta
assert.deepEqual(clasificarCaptura({ kmNuevo: 900, kmAnterior: 100, fuenteUltima: 'TRASLADO_SALIDA' }), { tipo: 'NORMAL', delta: 800 });
assert.deepEqual(clasificarCaptura({ kmNuevo: 90, kmAnterior: 100 }), { tipo: 'RECHAZADO_MENOR', delta: -10 }); // km no puede bajar
assert.deepEqual(clasificarCaptura({ kmNuevo: 90, kmAnterior: 100, esCorreccion: true }), { tipo: 'CORRECCION', delta: -10 }); // corrección sí puede
assert.deepEqual(clasificarCaptura({ kmNuevo: 106, kmAnterior: 100, umbral: 10 }), { tipo: 'NORMAL', delta: 6 }); // umbral configurable
assert.deepEqual(clasificarCaptura({ kmNuevo: -1, kmAnterior: 100 }), { tipo: 'INVALIDO', delta: 0 });

console.log('kilometraje.model OK');
```

- [ ] **Step 2: Correr y ver que falla**

Run: `node scripts/check-kilometraje.mjs`
Expected: FAIL — `Cannot find module '.../domain/kilometraje.model.js'`

- [ ] **Step 3: Implementar el modelo**

Crear `domain/kilometraje.model.js`:

```js
// domain/kilometraje.model.js — lógica pura de kilometraje (sin Firebase).
// OJO: api/cuadre.js lleva una copia privada de clasificarCaptura (_clasificarKm)
// porque los scripts clásicos no importan ES modules. Mantener en sincronía.

export const SALIDAS_LEGITIMAS = Object.freeze(['RETIRO_RENTA', 'TRASLADO_SALIDA']);

export function parseKm(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/[,\s]/g, '').trim();
  if (!s || !/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n >= 0 ? n : null;
}

export function clasificarCaptura({ kmNuevo, kmAnterior, umbral = 5, fuenteUltima = '', esCorreccion = false }) {
  if (typeof kmNuevo !== 'number' || !Number.isFinite(kmNuevo) || kmNuevo < 0) return { tipo: 'INVALIDO', delta: 0 };
  if (kmAnterior == null) return { tipo: 'NORMAL', delta: 0 };
  const delta = kmNuevo - kmAnterior;
  if (esCorreccion) return { tipo: 'CORRECCION', delta };
  if (delta < 0) return { tipo: 'RECHAZADO_MENOR', delta };
  if (delta <= umbral) return { tipo: 'NORMAL', delta };
  return SALIDAS_LEGITIMAS.includes(String(fuenteUltima).toUpperCase().trim())
    ? { tipo: 'NORMAL', delta }
    : { tipo: 'DISCREPANCIA', delta };
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `node scripts/check-kilometraje.mjs`
Expected: `kilometraje.model OK`

- [ ] **Step 5: Commit**

```bash
git add domain/kilometraje.model.js scripts/check-kilometraje.mjs
git commit -m "feat(km): modelo puro de kilometraje (parseKm, clasificarCaptura) + self-check"
```

---

### Task 2: API — registrarKm en api/cuadre.js + bridge

**Files:**
- Modify: `api/cuadre.js` (helpers tras `_syncIndexUbicacion` ~línea 30; método nuevo dentro de `window._mexParts.cuadre`; firma de `ejecutarEliminacion` ~línea 246)
- Modify: `js/core/database.js` (COL + bridge export)

**Interfaces:**
- Consumes: `window._mex` helpers ya destructurados en el archivo (`db, COL, _normalizePlazaId, _mvaToDocId, _now, _ts, _registrarLog`).
- Produces: `api.registrarKm({ mva, km, fuente, usuario, plaza, motivo?, nota?, trasladoId? }) → Promise<'EXITO'|'DISCREPANCIA'|string>` (string = mensaje de error). `ejecutarEliminacion(listaMvas, responsableSesion, plaza, retiro?)` con `retiro = { km, motivo }` opcional. Campos nuevos en `index_unidades`: `km, kmFecha, kmFuenteUltima`. Campo `km` en docs de `cuadre`.

- [x] **Step 1: Helpers privados en api/cuadre.js**

Insertar después de la función `_syncIndexUbicacion` (tras su `}` de cierre, ~línea 30):

```js
  // ── KILOMETRAJE ──────────────────────────────────────────
  // ponytail: copia privada de domain/kilometraje.model.js::clasificarCaptura
  // (los scripts clásicos no importan ES modules). Mantener en sincronía.
  function _clasificarKm({ kmNuevo, kmAnterior, umbral = 5, fuenteUltima = '', esCorreccion = false }) {
    if (typeof kmNuevo !== 'number' || !Number.isFinite(kmNuevo) || kmNuevo < 0) return { tipo: 'INVALIDO', delta: 0 };
    if (kmAnterior == null) return { tipo: 'NORMAL', delta: 0 };
    const delta = kmNuevo - kmAnterior;
    if (esCorreccion) return { tipo: 'CORRECCION', delta };
    if (delta < 0) return { tipo: 'RECHAZADO_MENOR', delta };
    if (delta <= umbral) return { tipo: 'NORMAL', delta };
    const legitimas = ['RETIRO_RENTA', 'TRASLADO_SALIDA'];
    return legitimas.includes(String(fuenteUltima).toUpperCase().trim())
      ? { tipo: 'NORMAL', delta }
      : { tipo: 'DISCREPANCIA', delta };
  }

  function _kmUmbral() {
    const n = parseInt(window.MEX_CONFIG && window.MEX_CONFIG.listas && window.MEX_CONFIG.listas.kmUmbralDiscrepancia, 10);
    return Number.isFinite(n) && n >= 0 ? n : 5;
  }
```

- [x] **Step 2: Método registrarKm**

Insertar dentro del objeto `window._mexParts.cuadre` (después del método `aplicarEstado`, antes de `insertarUnidadDesdeHTML`):

```js
    // Registra una captura de km: historial en km_registros (append-only),
    // actualiza index_unidades y el doc del cuadre si existe, y crea
    // discrepancia si el delta rebasa el umbral sin salida legítima.
    // fuente: INSERT | CUADRE | RETIRO | TRASLADO_SALIDA | TRASLADO_LLEGADA | CORRECCION
    async registrarKm({ mva, km, fuente, usuario, plaza, motivo = '', nota = '', trasladoId = '' }) {
      const mvaStr = String(mva || '').toUpperCase().trim();
      const kmNum = parseInt(String(km).replace(/[,\s]/g, ''), 10);
      if (!mvaStr) return 'Falta MVA';
      if (!Number.isFinite(kmNum) || kmNum < 0) return 'Kilometraje inválido';
      const plazaUp = _normalizePlazaId(plaza);
      const fuenteUp = String(fuente || '').toUpperCase().trim();

      const idxSnap = await db.collection(COL.INDEX).where('mva', '==', mvaStr).limit(1).get();
      const idxData = idxSnap.empty ? {} : idxSnap.docs[0].data();
      const kmAnterior = (typeof idxData.km === 'number') ? idxData.km : null;

      const esCorreccion = fuenteUp === 'CORRECCION';
      if (esCorreccion && !(window.mexPerms && window.mexPerms.canDo('km_corregir'))) {
        return 'No tienes permiso para corregir kilometraje';
      }

      const c = _clasificarKm({
        kmNuevo: kmNum, kmAnterior, umbral: _kmUmbral(),
        fuenteUltima: idxData.kmFuenteUltima || '', esCorreccion
      });
      if (c.tipo === 'INVALIDO') return 'Kilometraje inválido';
      if (c.tipo === 'RECHAZADO_MENOR') {
        return `El km (${kmNum}) es menor al último registrado (${kmAnterior}). Si el registro anterior está mal, usa una corrección.`;
      }

      const ahora = _now();
      // RETIRO por renta se recuerda como salida legítima: el regreso con delta
      // grande no genera discrepancia.
      const fuenteUltima = (fuenteUp === 'RETIRO' && String(motivo).toUpperCase().trim() === 'RENTA')
        ? 'RETIRO_RENTA' : fuenteUp;

      await db.collection('km_registros').add({
        mva: mvaStr, km: kmNum, kmAnterior, delta: c.delta,
        fuente: fuenteUp, motivo: String(motivo || '').toUpperCase().trim(),
        usuario: usuario || 'Sistema', plaza: plazaUp || '',
        fecha: ahora, timestamp: _ts(),
        trasladoId: trasladoId || '', nota: nota || ''
      });

      if (!idxSnap.empty) {
        await idxSnap.docs[0].ref.set({ km: kmNum, kmFecha: ahora, kmFuenteUltima: fuenteUltima }, { merge: true });
      }
      // update (no set): si la unidad no está en el cuadre NO crear doc fantasma.
      db.collection(COL.CUADRE).doc(_mvaToDocId(mvaStr)).update({ km: kmNum }).catch(function () {});

      if (c.tipo === 'DISCREPANCIA') {
        await db.collection('km_discrepancias').add({
          mva: mvaStr, kmEsperado: kmAnterior, kmCapturado: kmNum, delta: c.delta,
          fuente: fuenteUp, usuario: usuario || 'Sistema', plaza: plazaUp || '',
          fecha: ahora, timestamp: _ts(), estado: 'PENDIENTE'
        });
        await _registrarLog('KM', `⚠️ KM DISCREPANCIA: ${mvaStr} · ${kmAnterior} ➜ ${kmNum} (+${c.delta} km sin salida registrada)`, usuario, plazaUp);
        return 'DISCREPANCIA';
      }
      if (esCorreccion) {
        await _registrarLog('KM', `✏️ KM CORREGIDO: ${mvaStr} · ${kmAnterior} ➜ ${kmNum}`, usuario, plazaUp);
      }
      return 'EXITO';
    },
```

- [x] **Step 3: km al insertar y al retirar (misma api/cuadre.js)**

En `insertarUnidadDesdeHTML`, justo ANTES del `return \`EXITO|...\`` final (después del bloque que sincroniza el índice), insertar:

```js
      // Captura de km al insertar (obligatoria en el form; tolerante aquí para
      // callers legacy sin km, p.ej. el comando de voz).
      if (objeto.km != null && String(objeto.km) !== '') {
        await this.registrarKm({
          mva: mvaStr, km: objeto.km, fuente: 'INSERT',
          usuario: objeto.responsableSesion, plaza: plazaUp
        });
      }
```

En `ejecutarEliminacion`, cambiar la firma y añadir la captura al inicio del cuerpo (`registrarKm` devuelve strings de error, no lanza — best-effort: la eliminación procede aunque la captura falle, la UI ya validó el valor):

```js
    async ejecutarEliminacion(listaMvas, responsableSesion, plaza, retiro = null) {
      // Km de salida + motivo (RENTA/OTRO), solo para retiros individuales.
      if (retiro && retiro.km != null && listaMvas.length === 1) {
        await this.registrarKm({
          mva: listaMvas[0], km: retiro.km, fuente: 'RETIRO',
          motivo: retiro.motivo || '', usuario: responsableSesion, plaza
        });
      }
```

- [x] **Step 4: COL + bridge en js/core/database.js**

En el objeto `COL` añadir (antes del cierre `});`):

```js
  KM_REGISTROS:       'km_registros',
  KM_DISCREPANCIAS:   'km_discrepancias',
```

En la sección `// ── Operaciones de flota ──` añadir junto a `ejecutarEliminacion`:

```js
export const registrarKm              = (...a) => _api().registrarKm(...a);
```

- [x] **Step 5: Verificar sintaxis**

Run: `node --check api/cuadre.js && node --check js/core/database.js && echo OK`
Expected: `OK` (database.js es ES module: si `--check` protesta por `export`, usar `node --input-type=module --check < js/core/database.js`)

- [x] **Step 6: Commit**

```bash
git add api/cuadre.js js/core/database.js
git commit -m "feat(km): api.registrarKm + captura en insertar/retirar + COL/bridge"
```

---

### Task 3: Permiso km_corregir + reglas Firestore

**Files:**
- Modify: `domain/permissions.model.js` (DEFAULT_ROLE_PERMISSIONS, línea ~78)
- Modify: `js/core/feature-gates.js` (_PERM_DEFAULTS, línea ~18)
- Modify: `firestore.rules` (rolTienePermiso ~línea 100; actualizacionUbicacionIndexValida ~línea 597; bloques nuevos tras `historial_patio` ~línea 644)

**Interfaces:**
- Produces: permiso `km_corregir` (default: GERENTE_PLAZA y JEFE_REGIONAL true, resto false; overrideable vía `configuracion/empresa.rolePermissions`). Reglas para `km_registros` (create-only) y `km_discrepancias` (resolver solo con permiso).
- Consumes: helpers de rules existentes `tienePerfilActual()`, `tienePermiso()`, `perfilActual()`.

- [ ] **Step 1: Defaults en domain/permissions.model.js**

En `DEFAULT_ROLE_PERMISSIONS`, añadir al final de cada objeto de rol (tras `manage_settings`):
- `AUXILIAR`, `VENTAS`, `SUPERVISOR`, `JEFE_PATIO`: `km_corregir: false,`
- `GERENTE_PLAZA`, `JEFE_REGIONAL`: `km_corregir: true,`

- [ ] **Step 2: Espejo en js/core/feature-gates.js**

En `_PERM_DEFAULTS` (es el espejo del domain, una línea por rol), añadir la misma clave al final de cada rol: `km_corregir:false` para AUXILIAR/VENTAS/SUPERVISOR/JEFE_PATIO y `km_corregir:true` para GERENTE_PLAZA/JEFE_REGIONAL.

- [ ] **Step 3: rolTienePermiso en firestore.rules**

En la función `rolTienePermiso` (~línea 100), añadir una rama al ternario ANTES del `: hasPerm;` final (mismo patrón que `manage_global_fleet`):

```
        : permiso == "km_corregir"
          ? (role == "GERENTE_PLAZA" || role == "JEFE_REGIONAL" || hasPerm)
```

- [ ] **Step 4: Whitelist del índice + colecciones nuevas**

En `actualizacionUbicacionIndexValida()` (~línea 597) ampliar el hasOnly:

```
      return request.resource.data.diff(resource.data).affectedKeys()
        .hasOnly(["plazaActual", "pos", "ubicacion", "km", "kmFecha", "kmFuenteUltima"]);
```

Después del bloque `match /historial_patio/{doc} { ... }` (~línea 644), insertar:

```
    // ─── KILOMETRAJE ────────────────────────────────────────
    // Historial append-only: nadie edita ni borra capturas.
    // ponytail: la monotonía (km >= anterior) se valida solo en cliente —
    // validarla aquí exigiría un get() por escritura y el doc del índice
    // tiene id automático (no direccionable desde rules).
    match /km_registros/{doc} {
      allow read: if tienePerfilActual();
      allow create: if tienePerfilActual()
        && request.resource.data.mva is string
        && request.resource.data.km is number
        && request.resource.data.km >= 0;
      allow update, delete: if false;
    }

    // Discrepancias: crear cualquiera autenticado; resolver solo con permiso.
    match /km_discrepancias/{doc} {
      allow read: if tienePerfilActual();
      allow create: if tienePerfilActual()
        && request.resource.data.estado == "PENDIENTE";
      allow update: if tienePerfilActual()
        && request.resource.data.estado == "RESUELTA"
        && tienePermiso(perfilActual(), "km_corregir");
      allow delete: if false;
    }
```

(Nota el orden del `&&` en update: el check barato de `estado` va antes del `tienePermiso` — regla de la casa.)

- [ ] **Step 5: Validar reglas y self-check**

Run: `firebase deploy --only firestore:rules --dry-run 2>&1 | tail -3` (si la CLI no soporta dry-run: `firebase emulators:start --only firestore` debe arrancar sin error de compilación de reglas; Ctrl+C después)
Expected: reglas compilan sin error.
Run: `node scripts/check-kilometraje.mjs`
Expected: `kilometraje.model OK`

- [ ] **Step 6: Commit**

```bash
git add domain/permissions.model.js js/core/feature-gates.js firestore.rules
git commit -m "feat(km): permiso km_corregir + reglas km_registros/km_discrepancias"
```

---

### Task 4: Insertar con km obligatorio (form del cuadre)

**Files:**
- Modify: `cuadre.html` (form `form-fields-container`, tras el grid-2 de ESTADO/GASOLINA ~línea 537)
- Modify: `js/views/mapa.js` (`ejecutarGuardadoFlota` ~línea 6486; `prepararNuevoFlota`; import de domain al inicio del archivo)

**Interfaces:**
- Consumes: `parseKm` de `domain/kilometraje.model.js` (Task 1); `api.insertarUnidadDesdeHTML` con `payload.km` (Task 2).
- Produces: input `#f_km` en el form; `payload.km` (number) al insertar.

- [ ] **Step 1: Campo en cuadre.html**

Después del `</div>` que cierra el `grid-2` de ESTADO/GASOLINA (~línea 537), insertar:

```html
                <div class="field">
                  <label>KILOMETRAJE 🛞</label>
                  <input type="text" id="f_km" inputmode="numeric" autocomplete="off"
                    placeholder="Km actual del tablero" onchange="validarBotonGuardar()">
                </div>
```

- [ ] **Step 2: Import en mapa.js**

En la primera línea de `js/views/mapa.js` (es ES module), añadir:

```js
import { parseKm } from '/domain/kilometraje.model.js';
```

- [ ] **Step 3: Validación y payload en ejecutarGuardadoFlota**

En `ejecutarGuardadoFlota` (~línea 6486), tras el bloque de validación de `estField`, añadir:

```js
  const kmField = document.getElementById('f_km');
  const kmVal = kmField ? parseKm(kmField.value) : null;
  if (MODO_FLOTA === "INSERTAR" && kmVal == null) {
    if (kmField) { kmField.classList.add('input-error'); setTimeout(() => kmField.classList.remove('input-error'), 400); }
    showToast("Captura el kilometraje de la unidad", "error");
    isValid = false;
  }
```

Y en el objeto `payload` (~línea 6511) añadir la línea:

```js
    km: kmVal,
```

- [ ] **Step 4: Limpiar el campo en prepararNuevoFlota**

Localizar `function prepararNuevoFlota` (grep) y añadir dentro, junto a la limpieza de los otros campos:

```js
  const fKm = document.getElementById('f_km');
  if (fKm) { fKm.value = ''; fKm.disabled = false; fKm.dataset.kmOriginal = ''; }
```

- [ ] **Step 5: Modo edición — solo lectura (Task 7 lo habilita con permiso)**

Localizar `function seleccionarFilaFlota` (grep) y añadir al final del rellenado del form:

```js
  const fKmEdit = document.getElementById('f_km');
  if (fKmEdit) {
    const u = DATOS_TABLA_ACTUAL[index] || {};
    fKmEdit.value = (typeof u.km === 'number') ? u.km : '';
    fKmEdit.dataset.kmOriginal = (typeof u.km === 'number') ? String(u.km) : '';
    fKmEdit.disabled = true; // corrección con permiso llega en Task 7
  }
```

(Si el primer parámetro de `seleccionarFilaFlota` no se llama `index`, usar el nombre real del parámetro que indexa `DATOS_TABLA_ACTUAL`.)

- [ ] **Step 6: Verificar en el emulador**

Run: `firebase emulators:start --only hosting` (background) y en el navegador `http://localhost:5000/cuadre` (login `jlp@gmail.com`/`123456`): abrir "+" (nuevo), buscar una unidad, dejar km vacío → GUARDAR debe mostrar el toast "Captura el kilometraje"; con km → inserta y en Firestore prod aparece el doc en `km_registros` (fuente INSERT) y `km` en `index_unidades`.
Expected: ambas ramas funcionan. (El emulador de hosting usa el Firestore REAL — usar una unidad de prueba, p. ej. mva `TEST1`, y eliminarla después.)

- [ ] **Step 7: Commit**

```bash
git add cuadre.html js/views/mapa.js
git commit -m "feat(km): captura obligatoria de km al insertar unidad al cuadre"
```

---

### Task 5: Retiro con km + motivo

**Files:**
- Modify: `js/views/mapa.js` (`confirmarBorradoFlotaUI` línea ~379; `ejecutarBorradoReal` ~línea 6567)

**Interfaces:**
- Consumes: `parseKm` (import de Task 4); `api.ejecutarEliminacion(lista, usuario, plaza, retiro)` (Task 2).
- Produces: diálogo propio `_pedirKmRetiro(mva, kmPrev) → Promise<{km, motivo}|null>`; variable módulo `_retiroPendiente`.

- [ ] **Step 1: Diálogo de retiro**

Insertar antes de `function confirmarBorradoFlotaUI()` (~línea 379):

```js
let _retiroPendiente = null;

// Mini-diálogo propio para capturar km + motivo al retirar. No usa
// mostrarCustomModal porque necesita dos inputs.
function _pedirKmRetiro(mva, kmPrev) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `
      <div style="background:var(--surface,#fff);border-radius:16px;padding:24px;max-width:360px;width:100%;box-shadow:0 25px 60px rgba(0,0,0,.35);">
        <h3 style="margin:0 0 4px;font-size:16px;font-weight:800;color:#dc2626;display:flex;align-items:center;gap:8px;">
          <span class="material-icons">delete_forever</span> Retirar ${mva}
        </h3>
        <p style="margin:0 0 16px;font-size:12px;color:#64748b;">Captura el km del tablero para cerrar su registro.${kmPrev != null ? ` Último: <b>${kmPrev.toLocaleString('es-MX')}</b>` : ''}</p>
        <label style="font-size:11px;font-weight:800;color:#334155;">KILOMETRAJE</label>
        <input id="retKm" type="text" inputmode="numeric" autocomplete="off" placeholder="Ej: 45210"
          style="width:100%;padding:10px 12px;margin:4px 0 12px;border:1px solid var(--border,#e2e8f0);border-radius:8px;font-weight:700;">
        <label style="font-size:11px;font-weight:800;color:#334155;">MOTIVO DE SALIDA</label>
        <select id="retMotivo" style="width:100%;padding:10px 12px;margin:4px 0 20px;border:1px solid var(--border,#e2e8f0);border-radius:8px;font-weight:700;">
          <option value="RENTA">✈️ RENTA</option>
          <option value="OTRO">📤 OTRO</option>
        </select>
        <div style="display:flex;gap:8px;">
          <button id="retCancel" style="flex:1;padding:10px;border:1px solid var(--border,#e2e8f0);background:transparent;border-radius:8px;font-weight:800;cursor:pointer;">Cancelar</button>
          <button id="retOk" style="flex:1;padding:10px;border:none;background:#dc2626;color:#fff;border-radius:8px;font-weight:800;cursor:pointer;">ELIMINAR</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const kmInput = overlay.querySelector('#retKm');
    kmInput.focus();
    overlay.querySelector('#retCancel').onclick = () => { overlay.remove(); resolve(null); };
    overlay.querySelector('#retOk').onclick = () => {
      const km = parseKm(kmInput.value);
      if (km == null) { showToast('Kilometraje inválido', 'error'); return; }
      if (kmPrev != null && km < kmPrev) { showToast(`El km no puede ser menor al último registrado (${kmPrev})`, 'error'); return; }
      const motivo = overlay.querySelector('#retMotivo').value;
      overlay.remove();
      resolve({ km, motivo });
    };
  });
}
```

- [ ] **Step 2: Reemplazar confirmarBorradoFlotaUI**

Sustituir el cuerpo completo de `confirmarBorradoFlotaUI` (que hoy llama `mostrarCustomModal(...)`) por:

```js
function confirmarBorradoFlotaUI() {
  if (!SELECT_REF_FLOTA) return;
  const u = (typeof DB_FLOTA !== 'undefined' && DB_FLOTA.find(x => x.mva === SELECT_REF_FLOTA.mva)) || {};
  _pedirKmRetiro(SELECT_REF_FLOTA.mva, (typeof u.km === 'number') ? u.km : null).then(datos => {
    if (!datos) return; // canceló
    _retiroPendiente = datos;
    ejecutarBorradoReal();
  });
}
```

- [ ] **Step 3: Pasar el retiro a la API**

En `ejecutarBorradoReal` (~línea 6592), cambiar la llamada:

```js
    api.ejecutarEliminacion([mvaABorrar], USER_NAME, _miPlaza(), _retiroPendiente).catch(() => showToast("Error de sincronización al borrar", "error"));
    _retiroPendiente = null;
```

- [ ] **Step 4: Verificar en el emulador**

Con el emulador de hosting: seleccionar la unidad de prueba TEST1 en la tabla → botón eliminar → aparece el diálogo → km menor al anterior es rechazado → km válido + RENTA elimina la unidad y crea `km_registros` con fuente RETIRO, motivo RENTA, y en `index_unidades` queda `kmFuenteUltima: 'RETIRO_RENTA'`.
Expected: todo lo anterior; reinsertar TEST1 con km mucho mayor NO crea discrepancia (regreso de renta).

- [ ] **Step 5: Commit**

```bash
git add js/views/mapa.js
git commit -m "feat(km): retiro con captura de km + motivo (RENTA/OTRO)"
```

---

### Task 6: Tabla del cuadre — columna KM + gas progressbar

**Files:**
- Modify: `cuadre.html` (thead ~línea 331; colspan inicial línea ~384)
- Modify: `js/views/mapa.js` (`renderFlota` líneas 6173-6231; comparador de `filtrarFlota`)
- Modify: `css/mapa.css` (junto a `.td-gas` ~línea 3775)

**Interfaces:**
- Consumes: `u.km` en docs del cuadre (Task 2/4); `_fuelToPct` existente (mapa.js:5233).
- Produces: columna KM ordenable (sin filtro dropdown); celda GAS como barra.

- [ ] **Step 1: thead y colspans**

En `cuadre.html` tras el `<th onclick="sortFlota('placas')"...>` y el th de Gas (línea 331), insertar después del th de Gas:

```html
                    <th onclick="sortFlota('km')" class="sortable">KM ↕</th>
```

En la fila placeholder (línea ~384) cambiar `colspan="7"` → `colspan="8"`.

- [ ] **Step 2: Celdas en renderFlota**

En `js/views/mapa.js` línea 6173 cambiar `colspan="8"` → `colspan="9"` (estado vacío).

Eliminar la línea 6178 (`const gasClass = ...`) y en el template de la fila (línea 6225) reemplazar:

```js
      <td><span class="${gasClass}">${u.gasolina}</span></td>
```

por:

```js
      <td>${(() => {
        const pct = _fuelToPct(u.gasolina);
        if (pct == null) return `<span class="td-gas">${u.gasolina || 'N/A'}</span>`;
        return `<div class="gas-cell" title="${u.gasolina}"><div class="gas-cell-track"><div class="gas-cell-fill${pct <= 25 ? ' gas-cell-fill--low' : ''}" style="width:${pct}%"></div></div><span class="gas-cell-label">${u.gasolina}</span></div>`;
      })()}</td>
      <td class="td-km">${(typeof u.km === 'number') ? u.km.toLocaleString('es-MX') : '—'}</td>
```

- [ ] **Step 3: Orden numérico para km**

En `filtrarFlota`, localizar el bloque que aplica `sortCol` al array (grep `sortCol` dentro de la función) e insertar al inicio del comparador:

```js
      if (sortCol === 'km') {
        const va = (typeof a.km === 'number') ? a.km : -1;
        const vb = (typeof b.km === 'number') ? b.km : -1;
        return sortAsc ? va - vb : vb - va;
      }
```

- [ ] **Step 4: CSS**

En `css/mapa.css`, junto a `.td-gas` (~línea 3775), añadir:

```css
    .gas-cell { display: flex; align-items: center; gap: 8px; min-width: 90px; }
    .gas-cell-track { flex: 1; height: 6px; border-radius: 9999px; background: var(--border, #e2e8f0); overflow: hidden; }
    .gas-cell-fill { height: 100%; border-radius: 9999px; background: var(--mex-blue, #3b82f6); }
    .gas-cell-fill--low { background: #dc2626; }
    .gas-cell-label { font-size: 10px; font-weight: 800; color: #64748b; min-width: 30px; text-align: right; }
    .td-km { font-weight: 700; color: #0f172a; white-space: nowrap; }
```

Si `css/mapa.css` tiene bloque `body.dark-theme` para la tabla, añadir ahí: `body.dark-theme .td-km { color: var(--text, #e2e8f0); }`.

- [ ] **Step 5: Verificar visual**

Con el emulador: `/cuadre` muestra la columna KM tras GAS (— para unidades sin km), la barra de gas con % correcto (F=100, H=50, 1/4=25 en rojo), orden por KM funciona, y el th de KM NO tiene dropdown de filtro.
Expected: sin desalineación de columnas en FLOTA REGULAR ni en CUADRE ADMINS (la vista ADMINS añade th-autor: verificar que las filas siguen cuadrando).

- [ ] **Step 6: Commit**

```bash
git add cuadre.html js/views/mapa.js css/mapa.css
git commit -m "feat(cuadre): columna KM (ordenable) + gasolina como progressbar"
```

---

### Task 7: Corrección de km con permiso (modo edición)

**Files:**
- Modify: `js/views/mapa.js` (`seleccionarFilaFlota` — el bloque añadido en Task 4 Step 5; `ejecutarGuardadoFlota` rama MODIFICAR)

**Interfaces:**
- Consumes: `window.mexPerms.canDo('km_corregir')` (Task 3); `api.registrarKm` con fuente CORRECCION (Task 2); `#f_km.dataset.kmOriginal` (Task 4).
- Produces: corrección de km desde el form de edición, solo con permiso.

- [ ] **Step 1: Habilitar el campo según permiso**

En el bloque de `seleccionarFilaFlota` añadido en Task 4 Step 5, reemplazar la línea `fKmEdit.disabled = true; // corrección con permiso llega en Task 7` por:

```js
    const puedeCorregir = !!(window.mexPerms && window.mexPerms.canDo('km_corregir'));
    fKmEdit.disabled = !puedeCorregir;
    fKmEdit.title = puedeCorregir ? 'Corregir kilometraje (queda registrado)' : 'Solo usuarios con permiso pueden corregir km';
```

- [ ] **Step 2: Disparar la corrección al guardar**

En `ejecutarGuardadoFlota`, dentro de la rama `else` de MODIFICAR (la que llama `api.aplicarEstado`, ~línea 6547), añadir ANTES de esa llamada:

```js
      const kmOriginal = kmField && kmField.dataset.kmOriginal !== '' ? parseInt(kmField.dataset.kmOriginal, 10) : null;
      if (kmField && !kmField.disabled && kmVal != null && kmVal !== kmOriginal) {
        api.registrarKm({ mva: payload.mva, km: kmVal, fuente: 'CORRECCION', usuario: USER_NAME, plaza: _miPlaza() })
          .then(r => { if (r !== 'EXITO') showToast(r, 'error'); else showToast('Km corregido', 'success'); })
          .catch(() => showToast('Error al corregir km', 'error'));
      }
```

- [ ] **Step 3: Verificar**

Emulador, con el usuario de prueba (rol con y sin permiso — el bootstrap PROGRAMADOR siempre puede): editar TEST1, cambiar km hacia abajo → se guarda como CORRECCION en `km_registros` con delta negativo y el índice queda con el nuevo valor. Con un usuario sin permiso el campo aparece deshabilitado.
Expected: ambos comportamientos.

- [ ] **Step 4: Commit**

```bash
git add js/views/mapa.js
git commit -m "feat(km): corrección de km desde edición del cuadre (permiso km_corregir)"
```

---

### Task 8: Cuadre de flota — km prellenado en la auditoría

**Files:**
- Modify: `js/views/mapa.js` (`_renderAuditCard` línea ~12408; `marcarUnidadAudit` ~12496; carga de AUDIT_LIST del auxiliar línea ~12783)
- Modify: `css/mapa.css` (junto a los estilos `.audit-card`)

**Interfaces:**
- Consumes: `DB_FLOTA` (docs del cuadre con `u.km`), `parseKm`, `api.registrarKm` fuente CUADRE.
- Produces: input `#audit-km-{mva}` por tarjeta; captura al marcar OK solo si el valor cambió.

- [ ] **Step 1: km en la misión del auxiliar**

Línea ~12783, reemplazar el `.map(...)`:

```js
        window.AUDIT_LIST = window.UNIDADES_SISTEMA_CORPORATIVO.map(u => {
          const local = (typeof DB_FLOTA !== 'undefined' && DB_FLOTA.find(x => x.mva === u.mva)) || {};
          return { mva: u.mva, placas: u.placas, modelo: u.modelo, status: 'PENDIENTE', km: (typeof local.km === 'number') ? local.km : null };
        });
```

- [ ] **Step 2: Input en la tarjeta**

En `_renderAuditCard`, dentro de `<div class="audit-card-info">`, después de la línea del `audit-card-meta`, insertar:

```js
        <div class="audit-card-km" onclick="event.stopPropagation()">
          <span class="material-icons" style="font-size:14px;">speed</span>
          <input id="audit-km-${u.mva}" type="text" inputmode="numeric" autocomplete="off"
            value="${u.km != null ? u.km : ''}" placeholder="km">
        </div>
```

- [ ] **Step 3: Captura al marcar OK**

En `marcarUnidadAudit`, ANTES de la línea que limpia el buscador (`const searchInput = ...`), insertar:

```js
    // Captura de km del cuadre de flota: solo el auxiliar (no la revisión del
    // admin) y solo si el valor tecleado difiere del último conocido.
    if (status === 'OK' && (typeof userRole === 'undefined' || userRole !== 'admin')) {
      const inp = document.getElementById(`audit-km-${mva}`);
      const val = inp ? parseKm(inp.value) : null;
      const prev = window.AUDIT_LIST[index].km;
      if (val != null && val !== prev) {
        window.AUDIT_LIST[index].km = val;
        api.registrarKm({ mva, km: val, fuente: 'CUADRE', usuario: USER_NAME, plaza: _miPlaza() })
          .then(r => {
            if (r === 'DISCREPANCIA') showToast(`⚠️ ${mva}: diferencia de km sin salida registrada`, 'error');
            else if (r !== 'EXITO') showToast(`${mva}: ${r}`, 'error');
          })
          .catch(() => {});
      }
    }
```

(Nota: la tarjeta se re-renderiza al marcar; el valor tecleado se lee justo antes, así que el flujo natural — teclear y tocar ✓ — no pierde datos. Teclear sin marcar y marcar OTRA unidad sí lo descarta: aceptado.)

- [ ] **Step 4: CSS**

En `css/mapa.css`, junto a los estilos `.audit-card` existentes (grep `.audit-card-meta`), añadir:

```css
    .audit-card-km { display: flex; align-items: center; gap: 6px; margin-top: 6px; color: #64748b; }
    .audit-card-km input { width: 90px; padding: 4px 8px; border: 1px solid var(--border, #e2e8f0); border-radius: 8px; font-weight: 800; font-size: 12px; }
```

- [ ] **Step 5: Verificar**

Emulador: iniciar cuadre (admin sube CSV con TEST1), como auxiliar abrir la misión → la tarjeta muestra el km prellenado → confirmar sin tocar = ✓ sin escritura en `km_registros`; teclear +2 km y ✓ = registro CUADRE silencioso; teclear +50 km y ✓ = registro + doc en `km_discrepancias` PENDIENTE + toast de advertencia.
Expected: los tres casos.

- [ ] **Step 6: Commit**

```bash
git add js/views/mapa.js css/mapa.css
git commit -m "feat(km): captura de km en el pase de lista del cuadre de flota"
```

---

### Task 9: Verificación integral + deploy

**Files:**
- Ninguno nuevo (verificación y despliegue).

- [ ] **Step 1: Self-check + sintaxis**

Run: `node scripts/check-kilometraje.mjs && node --check api/cuadre.js && echo TODO-OK`
Expected: `kilometraje.model OK` y `TODO-OK`.

- [ ] **Step 2: Smoke test Playwright**

Run: `node scripts/test-mapa.js` (auto-arranca emulador de hosting)
Expected: `19 passed 0 failed` (o el total vigente, 0 failed).

- [ ] **Step 3: Pasada manual (emulador)**

Checklist: insertar unidad TEST1 con km → columna KM la muestra; gas progressbar OK en F/H/fracciones/N-A; retirar TEST1 (RENTA) → reinsertar con km alto sin discrepancia; editar km hacia abajo con permiso → CORRECCION; borrar los docs de prueba de `cuadre`, `index_unidades`, `km_registros`, `km_discrepancias`.
Expected: todo verde; datos de prueba limpiados.

- [ ] **Step 4: Deploy + push**

```bash
npm run deploy:rules && npm run deploy
git add . && git commit -m "feat(km): kilometraje global Fase A — captura, historial, discrepancias, UI cuadre" && git push
```

Expected: deploy sin errores; SW bumpeado automáticamente; GitHub sincronizado.

- [ ] **Step 5: Verificación en producción**

Abrir app.mapgestion.com/cuadre (hard-refresh), confirmar columna KM + barra de gas y una inserción real con km.
Expected: sin errores de consola; reglas no bloquean las escrituras (`km_registros` create OK).
