# Plan 1 — Destruir SaaS Multi-Empresa → Single-Tenant Arrendadora

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar por completo la capa multi-empresa (`empresaId`), dejar un único tenant arrendadora, y borrar la consola SaaS del programador; la separación operativa queda solo por `plazaId`.

**Architecture:** Purga total de `empresaId` en api/reglas/funciones/datos (no se queda constante: se elimina el campo y los IDs compuestos `{empresaId}__{PLAZA}` → `{PLAZA}`). El `tipoNegocio` se fija a `arrendadora`, se borran los configs/templates/features de otros giros, y se elimina el catálogo de planes (todas las features quedan ON). Se borra la consola SaaS y las Cloud Functions de gestión multi-empresa.

**Tech Stack:** Vanilla JS (ES modules + Firebase compat SDK), Firebase Functions v1 (Node 18), Firestore, sin build step. Único test automatizado: Playwright smoke (`scripts/test-mapa.js`). Lógica pura testeable con `node --test` / asserts en `domain/`.

## Global Constraints

- **MANTENER la configuración en la nube.** `configuracion/empresa` + `configuracion/listas` son la **única fuente de verdad** del tenant (nombre de empresa, variables, ubicaciones/plazas, permisos vía `configuracion/empresa.security`). **NO se borran** — permiten vender el software a otro cliente y configurarlo rápido. Lo que se elimina es la colección `empresas/{empresaId}` (doc SaaS: plan, features, onboarding) y el campo `empresaId`. Todo lo que hoy escribe a `empresas/{id}` (onboarding, plazas, tipoNegocio) se **reapunta a `configuracion/empresa`**. `app-bootstrap.js` ya carga `configuracion/*` en `window.MEX_CONFIG` → esa sigue siendo la config viva.
- **Sin build step ni linter.** No introducir bundler ni framework de test nuevo. Para lógica pura usar `node:assert` + `node:test` (ya disponible en Node 18). UI/Firestore se verifica con el smoke test + verificación manual.
- **Bump SW obligatorio:** todo deploy corre `scripts/bump-sw.js` (vía `npm run deploy`). Nunca desplegar sin incrementar `CACHE_NAME` en `sw.js`.
- **Git tras cada deploy:** `git add . && git commit && git push`.
- **Diseño:** leer `ESTILO.md`. Fuente Inter, acento `#3b82f6`, iconos `material-symbols-outlined`, tokens de spacing 4px, radios `4/8/12/16/9999`, dark mode vía `var(--bg)`/`var(--surface)`/`var(--text)`/`var(--border)`. Sin `!important` salvo overrides dark-theme documentados. Sin hex hardcodeado en CSS de componentes.
- **RIESGO DE DATOS (purga total):** los docs en `settings/` usan ID compuesto `{empresaId}__{PLAZA}`. Cambiar el esquema requiere migración + **backup previo de Firestore** (Task 8). No desplegar reglas/funciones nuevas hasta que la migración haya corrido en producción.
- **Commits frecuentes**, uno por task.

---

## File Structure

| Archivo | Responsabilidad tras el cambio |
|---|---|
| `js/core/empresa-context.js` | **BORRAR** — ya no hay contexto de empresa. |
| `js/core/feature-gates.js` | Reducir a un checker que siempre devuelve `true` (sin planes). |
| `js/core/constants.js` | **NUEVO** — `export const TIPO_NEGOCIO = 'arrendadora'`. Único lugar con el giro. |
| `api/*.js` (alertas, notas, historial, externos, users, cuadre, mapa, settings, flota) | Quitar `_eid()`, `.where('empresaId',...)`, escritura de `empresaId`; IDs compuestos → solo `plaza`. |
| `mex-api.js` | Quitar helper de empresaId y composición `{empresaId}__{PLAZA}`. |
| `firestore.rules` | Quitar toda comparación `empresaId`; mantener reglas por `plaza`/rol. |
| `functions/index.js` | Borrar funciones SaaS (crear/listar/seed/migrar empresa, getEmpresaPublicInfo, listarEmpresasPublicas); quitar `_PLAN_CATALOG`, `EMPRESAS_COL`, escritura de empresaId. |
| `mapa/mapa-loader.js` | Fijar a `arrendadora.config.js` (sin lectura de `tipoNegocio`). |
| `mapa/configs/{estacionamiento,flotilla,default}.config.js` | **BORRAR**. |
| `mapa/features/estacionamiento/*`, `mapa/templates/mapa-{estacionamiento,flotilla}.html` | **BORRAR**. |
| `js/programador/views/{empresas,saas,contratos,empresa-detail,facturacion-global}.js` | **BORRAR**. |
| `js/programador/main.js`, `js/shell/navigation.config.js`, `js/app/router.js` | Quitar rutas/nav a vistas SaaS borradas. |
| `scripts/migrate-drop-empresaid.js` | **NUEVO** — migración Firestore (Task 8). |

---

### Task 1: Constante de giro + neutralizar feature-gates

**Files:**
- Create: `js/core/constants.js`
- Modify: `js/core/feature-gates.js` (reemplazo completo del cuerpo)
- Test: `js/core/feature-gates.test.mjs`

**Interfaces:**
- Produces: `window.mexFeatures.puedeUsar(key) → true` siempre; `TIPO_NEGOCIO = 'arrendadora'` exportado desde `constants.js`.

- [ ] **Step 1: Escribir el test que falla**

```js
// js/core/feature-gates.test.mjs
import assert from 'node:assert';
import { test } from 'node:test';

// Cargamos el IIFE en un global simulado.
test('puedeUsar siempre true, sin catálogo de planes', async () => {
  const window = {};
  globalThis.window = window;
  await import('./feature-gates.js');
  assert.equal(window.mexFeatures.puedeUsar('cuadre'), true);
  assert.equal(window.mexFeatures.puedeUsar('lo_que_sea'), true);
  assert.equal(window.mexFeatures.PLANES, undefined, 'no debe existir catálogo de planes');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test js/core/feature-gates.test.mjs`
Expected: FAIL — el `feature-gates.js` actual expone `PLANES`.

- [ ] **Step 3: Crear `constants.js`**

```js
// js/core/constants.js — única fuente del giro de negocio (producto especializado).
export const TIPO_NEGOCIO = 'arrendadora';
```

- [ ] **Step 4: Reemplazar `feature-gates.js` por la versión sin planes**

```js
// Feature gates — producto single-tenant arrendadora.
// Sin planes: todas las features están habilitadas. Se conserva la API
// window.mexFeatures.puedeUsar() para no romper llamadas existentes.
(function () {
  'use strict';
  window.mexFeatures = {
    puedeUsar() { return true; },
    limite() { return -1; }, // sin límites
  };
})();
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `node --test js/core/feature-gates.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add js/core/constants.js js/core/feature-gates.js js/core/feature-gates.test.mjs
git commit -m "refactor: eliminar catálogo de planes; feature-gates siempre ON + TIPO_NEGOCIO constante"
```

---

### Task 2: Fijar mapa-loader a arrendadora y borrar otros giros

**Files:**
- Modify: `mapa/mapa-loader.js:14-24`
- Delete: `mapa/configs/estacionamiento.config.js`, `mapa/configs/flotilla.config.js`, `mapa/configs/default.config.js`
- Delete: `mapa/features/estacionamiento/` (todo el directorio), `mapa/templates/mapa-estacionamiento.html`, `mapa/templates/mapa-flotilla.html`

**Interfaces:**
- Consumes: `mapa/configs/arrendadora.config.js` (único config que queda).
- Produces: `mapaLoader` que siempre carga el config de arrendadora.

- [ ] **Step 1: Reemplazar la resolución de tipoNegocio en `mapa-loader.js`**

Reemplazar el bloque actual (líneas ~14-24):

```js
  // Fase 5 → detectar tipoNegocio y cargar config
  const tipoNegocio = window._empresaActual?.tipoNegocio || 'default';

  let configModule;
  try {
    configModule = await import(`/mapa/configs/${tipoNegocio}.config.js`);
  } catch (_) {
    configModule = await import('/mapa/configs/default.config.js');
  }

  const config = configModule.default;
```

por:

```js
  // Producto especializado: único giro soportado.
  const configModule = await import('/mapa/configs/arrendadora.config.js');
  const config = configModule.default;
```

- [ ] **Step 2: Borrar configs/templates/features de otros giros**

```bash
git rm mapa/configs/estacionamiento.config.js mapa/configs/flotilla.config.js mapa/configs/default.config.js
git rm -r mapa/features/estacionamiento
git rm mapa/templates/mapa-estacionamiento.html mapa/templates/mapa-flotilla.html
```

- [ ] **Step 3: Verificar que no quedan referencias a los archivos borrados**

Run:
```bash
grep -rn "estacionamiento.config\|flotilla.config\|default.config\|features/estacionamiento\|mapa-estacionamiento\|mapa-flotilla" --include="*.js" --include="*.html" . | grep -v node_modules
```
Expected: sin resultados (exit 1). Si aparece algo, eliminar esa referencia.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: mapa fijo a giro arrendadora; borrar configs/features de otros giros"
```

---

### Task 3: Purga de empresaId en la capa API (`api/*.js` + `mex-api.js`)

**Regla de transformación** (aplicar a cada archivo de la lista). El campo es repetitivo y mecánico; en vez de duplicar código se da la regla + ejemplo + verificación. `ponytail:` se elige la regla sobre 200 bloques idénticos.

1. Borrar la función helper `function _eid() { ... }` y cualquier `const eidXXX = _eid();`.
2. Borrar toda cláusula `if (eid...) query = query.where('empresaId', '==', eid...);` (la query queda sin ese filtro).
3. En queries inline `db.collection(X).where('empresaId','==',eid).where('plaza',...)`, quitar **solo** el `.where('empresaId',...)`, conservar el resto.
4. Borrar toda propiedad `empresaId: _eid()` / `empresaId: ... ` en payloads de escritura.
5. IDs compuestos `{empresaId}__{PLAZA}`: reemplazar por solo el `plaza` normalizado. Buscar funciones tipo `_mapaConfigDocId`, `_settingsDocId`, y en `mex-api.js` el helper de scope.

**Files:**
- Modify: `api/alertas.js`, `api/notas.js`, `api/historial.js`, `api/externos.js`, `api/users.js`, `api/cuadre.js`, `api/mapa.js`, `api/settings.js`, `api/flota.js`, `mex-api.js`

**Interfaces:**
- Produces: capa API que ya no lee/escribe/filtra por `empresaId`; doc IDs de `settings/` y `mapa_config/` solo por `plaza`.

- [ ] **Step 1: Worked example — `api/mapa.js` doc id compuesto**

Cambiar `_mapaConfigDocId` (líneas ~18-24):

```js
  function _mapaConfigDocId(plaza) {
    const p = _normalizePlazaId(plaza);
    const eid = _eid();
    return eid ? `${eid}__${p}` : p;
  }
```

por:

```js
  function _mapaConfigDocId(plaza) {
    return _normalizePlazaId(plaza);
  }
```

y borrar `function _eid() {...}` arriba.

- [ ] **Step 2: Aplicar la regla de transformación a los 9 archivos api/ + mex-api.js**

Editar archivo por archivo siguiendo la regla. Tras cada archivo, sanity-check rápido de que no quedó `eid` huérfano:
```bash
grep -n "empresaId\|_eid\|eid" api/mapa.js
```

- [ ] **Step 3: Verificación global — cero referencias a empresaId en api/**

Run:
```bash
grep -rn "empresaId\|_eid(" api/ mex-api.js | grep -v "// "
```
Expected: sin resultados (exit 1). Comentarios explicativos pueden quedar; código no.

- [ ] **Step 4: Smoke test contra emulador**

Run: `node scripts/test-mapa.js`
Expected: PASS (login → /app/mapa → sidebar + controles). Si falla por query rota, revisar el archivo señalado en el stacktrace.

- [ ] **Step 5: Commit**

```bash
git add api/ mex-api.js
git commit -m "refactor: purga total de empresaId en capa API y mex-api"
```

---

### Task 4: Borrar empresa-context.js y sus consumidores

**Files:**
- Delete: `js/core/empresa-context.js`
- Modify: `app.html` (quitar `<script>` de empresa-context), `js/core/app-bootstrap.js`, `js/app/main.js`, `js/app/router.js` (quitar `mex:empresa-change` listener y `switchEmpresa`)

**Interfaces:**
- Consumes: nada de empresa-context.
- Produces: boot sin contexto de empresa; `window._empresaActual` deja de existir. Toda lectura se redirige a `window.MEX_CONFIG.empresa` (cargado desde `configuracion/empresa`, que **se queda**).

- [ ] **Step 1: Localizar todos los consumidores**

Run:
```bash
grep -rn "_empresaActual\|mexEmpresaContext\|empresa-context\|mex:empresa-change\|switchEmpresa" --include="*.js" --include="*.html" . | grep -v node_modules
```
Resolver cada uno con esta tabla de sustitución (la config sigue viva en `MEX_CONFIG`/`configuracion`):
- `window._empresaActual.plazas` / `.plazasDetalle` → `window.MEX_CONFIG.empresa.plazas` / `.plazasDetalle`
- `window._empresaActual.nombre` → `window.MEX_CONFIG.empresa.nombre`
- `window._empresaActual.tipoNegocio` → `TIPO_NEGOCIO` de `js/core/constants.js`
- `window._empresaActual.features` → eliminar (feature-gates siempre true)
- `window._empresaActual.security` / permisos → siguen leyéndose de `configuracion/empresa.security` (reglas) y `window.mexPerms` (cliente) — sin cambio.

- [ ] **Step 2: Borrar el módulo y su `<script>`**

```bash
git rm js/core/empresa-context.js
```
Quitar de `app.html` la línea `<script src="/js/core/empresa-context.js"></script>`.

- [ ] **Step 3: Quitar el listener `mex:empresa-change` del router**

En `js/app/router.js` borrar el `addEventListener('mex:empresa-change', ...)` y su re-render asociado.

- [ ] **Step 4: Verificación**

Run:
```bash
grep -rn "_empresaActual\|mexEmpresaContext\|empresa-context\|mex:empresa-change" --include="*.js" --include="*.html" . | grep -v node_modules
```
Expected: sin resultados (exit 1).

- [ ] **Step 5: Smoke test**

Run: `node scripts/test-mapa.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: eliminar empresa-context y todos sus consumidores"
```

---

### Task 5: Purga de empresaId en firestore.rules

**Files:**
- Modify: `firestore.rules` (líneas ~446-495, ~758-823, ~946-956 y cualquier otra con `empresaId`)

**Interfaces:**
- Produces: reglas que validan por `plaza`/rol, sin comparación de tenant.

- [ ] **Step 1: Quitar la validación de tenant en escrituras**

En cada bloque "Soft tenant enforcement" (líneas ~758, ~782, ~808), borrar las condiciones que comparan `request.resource.data.empresaId == perfilActual().empresaId` y `resource.data.empresaId == perfilActual().empresaId`. Si el bloque queda vacío (`allow ...: if true && ...`), simplificar manteniendo las condiciones de rol/plaza que sí aplican.

- [ ] **Step 2: Quitar empresaId del schema de `solicitudes`**

En el `match /solicitudes/...` (líneas ~446-495) quitar `empresaId`, `empresaNombre` de las listas de campos permitidos y sus validaciones de tipo/tamaño. (Nota: la colección `solicitudes` se reemplaza en el Plan 2; aquí solo se limpia empresaId.)

- [ ] **Step 3: Subcolección `empresas/{empresaId}/unidades`**

Mover el catálogo de unidades fuera del tenant: cambiar `match /empresas/{empresaId}/unidades/{unitId}` a `match /unidades_catalogo/{unitId}` con reglas equivalentes por rol (`esAdminOperativo()`), sin la comparación `perfilActual().empresaId == empresaId`. *(Coordinar con la migración Task 8 que reubica esos docs.)*

- [ ] **Step 4: Verificación**

Run: `grep -n "empresaId" firestore.rules`
Expected: sin resultados (exit 1).

- [ ] **Step 5: Validar sintaxis de reglas con el emulador**

Run: `firebase emulators:start --only firestore` (arranca y valida la compilación de reglas; Ctrl-C tras "Rules updated").
Expected: sin errores de compilación.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules
git commit -m "refactor: purga de empresaId en reglas Firestore"
```

---

### Task 6: Purga de empresaId en Cloud Functions + borrar funciones SaaS

**Files:**
- Modify: `functions/index.js`

**Interfaces:**
- Produces: funciones sin `empresaId`; sin endpoints de gestión multi-empresa.

- [ ] **Step 1: Borrar funciones SaaS exportadas**

Borrar de `functions/index.js` estos exports completos:
`seedPrimeraEmpresa`, `migrarEmpresaIdUsuarios`, `listarEmpresas`, `getEmpresaPublicInfo`, `listarEmpresasPublicas`, `migrarUnidadesLegacy` (si solo sirve a empresas), `migrarDatosLegacyCompleto`. Borrar también la constante `_PLAN_CATALOG` (líneas ~2707+) y `EMPRESAS_COL`.

- [ ] **Step 2: Quitar escritura/lectura de empresaId en las funciones restantes**

En `procesarSolicitudAcceso` (y helpers `resolveUserProfileDocRefByEmail`, payloads de usuario) quitar campos `empresaId`. En triggers (`onCuadreSettingsWritten` usa `${SETTINGS_COL}/{plazaId}` — ya por plaza, OK). Buscar y limpiar:
```bash
grep -n "empresaId\|EMPRESAS_COL\|_PLAN_CATALOG" functions/index.js
```

- [ ] **Step 3: Verificación**

Run: `grep -n "empresaId\|EMPRESAS_COL\|_PLAN_CATALOG\|getEmpresaPublicInfo\|listarEmpresas" functions/index.js`
Expected: sin resultados (exit 1).

- [ ] **Step 4: Lint de Node (parse check)**

Run: `node --check functions/index.js`
Expected: sin errores de sintaxis.

- [ ] **Step 5: Commit**

```bash
git add functions/index.js
git commit -m "refactor: borrar funciones SaaS multi-empresa y purgar empresaId en Functions"
```

---

### Task 7: Borrar la consola SaaS del programador

**Files:**
- Delete: `js/programador/views/empresas.js`, `js/programador/views/saas.js`, `js/programador/views/contratos.js`, `js/programador/views/empresa-detail.js`, `js/programador/views/facturacion-global.js`
- Modify: `js/programador/main.js`, `js/programador/views/overview.js`, `js/shell/navigation.config.js`, `js/app/router.js`, `programador.html`

**Interfaces:**
- Produces: consola de programador sin secciones de empresas/SaaS/contratos/facturación.

- [ ] **Step 1: Borrar las vistas SaaS**

```bash
git rm js/programador/views/empresas.js js/programador/views/saas.js js/programador/views/contratos.js js/programador/views/empresa-detail.js js/programador/views/facturacion-global.js
```

- [ ] **Step 2: Quitar referencias (imports, rutas de menú)**

Run:
```bash
grep -rn "empresas\|/saas\|contratos\|empresa-detail\|facturacion-global" js/programador/ js/shell/navigation.config.js js/app/router.js programador.html | grep -v node_modules
```
Eliminar cada import/entrada de menú/ruta encontrada.

- [ ] **Step 3: Verificación**

Run:
```bash
grep -rn "views/empresas\|views/saas\|views/contratos\|empresa-detail\|facturacion-global" --include="*.js" --include="*.html" . | grep -v node_modules
```
Expected: sin resultados (exit 1).

- [ ] **Step 4: Smoke test**

Run: `node scripts/test-mapa.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: borrar consola SaaS del programador (empresas/saas/contratos/facturacion)"
```

---

### Task 7B: Reapuntar onboarding y editores de config a `configuracion/empresa`

Mantiene viva la "configuración en la nube" (configurar rápido un cliente nuevo) ahora que `empresas/{id}` desaparece.

**Files:**
- Modify: `js/app/features/onboarding/onboarding-data.js`, `js/app/views/onboarding.js`
- Modify: cualquier escritor de config que apunte a `empresas/{id}` (verificar `js/views/editmap.js`, `api/settings.js`, `mex-api.js`)

**Interfaces:**
- Produces: alta/edición de nombre, plazas/ubicaciones, listas y demás config escriben en `configuracion/empresa` (y `configuracion/listas`), no en `empresas/{id}`. Sin parámetro `empresaId`.

- [ ] **Step 1: Reescribir `onboarding-data.js` contra `configuracion/empresa`**

Reemplazar `const COL_EMPRESAS = 'empresas';` y todas las llamadas `db.collection('empresas').doc(empresaId).update({...})` por escrituras a `db.collection('configuracion').doc('empresa').set({...}, { merge: true })`. Quitar el parámetro `empresaId` de todas las funciones (`iniciarOnboarding`, `configurarTipoNegocio`, `guardarPlazas`, `completarOnboarding`, `getEstadoOnboarding`, `onEstadoOnboarding`, `registrarImportacion`). `configurarTipoNegocio` deja de recibir tipo (fijo a `arrendadora`) o se elimina si ya no aporta.

Ejemplo — `guardarPlazas`:
```js
// Antes: db.collection('empresas').doc(empresaId).update({ plazas, ... })
export async function guardarPlazas(plazas) {
  const lista = (plazas || []).map(p => String(p).toUpperCase().trim()).filter(Boolean);
  await db.collection('configuracion').doc('empresa').set({
    plazas: lista,
    onboarding_paso: 'plazas',
    _updatedAt: Date.now(),
  }, { merge: true });
}
```

- [ ] **Step 2: Actualizar `onboarding.js` (vista) a la nueva firma sin empresaId**

Quitar de la vista la obtención/paso de `empresaId` a los data functions.

- [ ] **Step 3: Verificar otros escritores de config**

Run:
```bash
grep -rn "collection('empresas')\|collection(\"empresas\")\|COL_EMPRESAS\|EMPRESAS_COL\|empresas/" --include="*.js" . | grep -v node_modules | grep -v functions/
```
Expected: sin resultados (exit 1). Cada hallazgo se reapunta a `configuracion/empresa` o se elimina.

- [ ] **Step 4: Smoke test**

Run: `node scripts/test-mapa.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: onboarding y editores de config escriben a configuracion/empresa (no empresas/{id})"
```

---

### Task 8: Migración de datos Firestore (drop empresaId + reubicar doc IDs)

> **PRE-REQUISITO:** ejecutar **antes** de desplegar reglas/funciones nuevas. Hacer **backup** primero.

**Files:**
- Create: `scripts/migrate-drop-empresaid.js`

**Interfaces:**
- Consumes: Firebase Admin SDK (ya en `functions/node_modules` o instalar `firebase-admin` en `scripts/`).
- Produces: colecciones sin campo `empresaId`; `settings/{empresaId}__{PLAZA}` → `settings/{PLAZA}`; `mapa_config/{empresaId}__{PLAZA}` → `mapa_config/{PLAZA}`; `empresas/{id}/unidades/*` → `unidades_catalogo/*`.

- [ ] **Step 1: Backup de Firestore**

Run:
```bash
gcloud firestore export gs://<BUCKET>/backups/pre-empresaid-purge-$(date +%F)
```
Expected: export completo confirmado. **No continuar sin esto.**

- [ ] **Step 2: Escribir el script de migración (idempotente, batched)**

```js
// scripts/migrate-drop-empresaid.js
// Uso: GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/migrate-drop-empresaid.js [--dry]
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const DRY = process.argv.includes('--dry');

// Colecciones donde solo hay que ELIMINAR el campo empresaId.
const DROP_FIELD_COLS = [
  'alertas', 'notas', 'externos', 'usuarios', 'cuadre', 'cuadre_adm',
  'historial_patio', 'historial_cuadres', 'auditoria', 'ops_events',
  'index', 'mensajes', 'plantillas_alertas',
];

// Colecciones con doc id compuesto {empresaId}__{PLAZA} → {PLAZA}.
const RENAME_DOCID_COLS = ['settings', 'mapa_config'];

async function dropField(col) {
  const snap = await db.collection(col).get();
  let batch = db.batch(), n = 0, total = 0;
  for (const doc of snap.docs) {
    if (!('empresaId' in doc.data())) continue;
    if (!DRY) batch.update(doc.ref, { empresaId: admin.firestore.FieldValue.delete() });
    total++;
    if (++n >= 400) { if (!DRY) await batch.commit(); batch = db.batch(); n = 0; }
  }
  if (!DRY && n) await batch.commit();
  console.log(`[${col}] empresaId borrado en ${total} docs${DRY ? ' (dry)' : ''}`);
}

async function renameDocIds(col) {
  const snap = await db.collection(col).get();
  let moved = 0;
  for (const doc of snap.docs) {
    const id = doc.id;
    const sep = id.indexOf('__');
    if (sep < 0) continue; // ya es {PLAZA}
    const plaza = id.slice(sep + 2);
    if (!plaza) continue;
    const data = doc.data();
    delete data.empresaId;
    if (!DRY) {
      await db.collection(col).doc(plaza).set(data, { merge: true });
      await doc.ref.delete();
    }
    moved++;
  }
  console.log(`[${col}] ${moved} doc ids {empresaId}__{PLAZA} → {PLAZA}${DRY ? ' (dry)' : ''}`);
}

async function moveUnidadesCatalogo() {
  const empresas = await db.collection('empresas').get();
  let moved = 0;
  for (const emp of empresas.docs) {
    const units = await emp.ref.collection('unidades').get();
    for (const u of units.docs) {
      if (!DRY) await db.collection('unidades_catalogo').doc(u.id).set(u.data(), { merge: true });
      moved++;
    }
  }
  console.log(`[unidades_catalogo] ${moved} unidades movidas${DRY ? ' (dry)' : ''}`);
}

(async () => {
  for (const c of DROP_FIELD_COLS) await dropField(c);
  for (const c of RENAME_DOCID_COLS) await renameDocIds(c);
  await moveUnidadesCatalogo();
  console.log('Migración completa.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Dry-run y verificar conteos**

Run: `GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/migrate-drop-empresaid.js --dry`
Expected: imprime conteos coherentes por colección, sin escribir nada.

- [ ] **Step 4: Ejecutar la migración real**

Run: `GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/migrate-drop-empresaid.js`
Expected: "Migración completa." sin errores.

- [ ] **Step 5: Verificar que no queda empresaId (muestreo)**

Run (consola Firestore o un quick script): confirmar que un doc de `cuadre`, `settings/{PLAZA}` y `unidades_catalogo/*` existen sin `empresaId` y con el nuevo id.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate-drop-empresaid.js
git commit -m "chore: script de migración drop empresaId + reubicar doc ids por plaza"
```

---

### Task 9: Deploy completo + verificación end-to-end

**Files:** ninguno (deploy).

- [ ] **Step 1: Deploy con reglas + funciones (bump SW automático)**

Run: `npm run deploy:full`
Expected: SW bumpeado, hosting+functions+rules desplegados sin error.

- [ ] **Step 2: Smoke test contra producción**

Run: `node scripts/test-mapa.js --url=https://<PROD_URL>`
Expected: PASS.

- [ ] **Step 3: Verificación manual mínima**

Login real → `/app/mapa` carga datos de una plaza → cambiar de plaza muestra datos distintos → cuadre lista por plaza. Sin errores 500 de reglas en consola.

- [ ] **Step 4: Git sync**

```bash
git add . && git commit -m "chore: bump SW post-deploy single-tenant" && git push
```

---

## Self-Review

- **Cobertura del spec:** multi-empresa eliminado (Tasks 3-8), single-tenant por plaza (3,5,8), arrendadora fija (1,2), consola SaaS borrada (6,7), planes eliminados (1,6). ✔
- **Placeholders:** la purga API (Task 3) usa regla+ejemplo+verificación en vez de N bloques idénticos — decisión `ponytail:` consciente, no placeholder; cada paso tiene comando de verificación concreto. ✔
- **Consistencia de tipos:** `puedeUsar`/`limite` (Task 1) coinciden con la API existente `window.mexFeatures`; `_mapaConfigDocId(plaza)` mantiene firma. ✔
- **Dependencia con Plan 2:** la colección `solicitudes` se limpia aquí (empresaId) pero se reemplaza por invitaciones en Plan 2. ✔
