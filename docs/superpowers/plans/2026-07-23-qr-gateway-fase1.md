# QR Gateway de Unidades — Fase 1 (Gateway público) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Escanear un QR impreso pegado en una unidad abre `/app/qr/:token` y muestra su ficha pública (económico, marca, modelo, color, año, placas) sin necesidad de iniciar sesión — nunca hay redirect a `/login`.

**Architecture:** Un token `qrToken` (nanoid-like, generado client-side) vive en `index_unidades/{doc}`. Un botón "Generar QR" en la ficha de unidad (`/app/cuadre/u/:mva`) lo genera y lo escribe con la función ya existente `actualizarUnidadPlaza`. Una nueva Cloud Function callable **sin auth**, `getUnidadPublica(token)`, resuelve el token contra `index_unidades` (admin SDK, sin pasar por Firestore rules del cliente) y regresa solo los campos públicos. Una nueva vista SPA `js/app/views/qr-publica.js` consume esa función y se monta de dos formas: (a) dentro del router normal cuando hay sesión, (b) mediante un bypass explícito en `main.js` cuando NO hay sesión — porque `main.js` hoy redirige a `/login` de forma incondicional antes de que el router exista, lo cual viola la regla dura del spec.

**Tech Stack:** Firebase Functions v1 (`https.onCall`, sin auth), Firestore admin SDK, Web Crypto (`crypto.getRandomValues`) para el token, vanilla JS/ES modules (sin librerías nuevas), servicio público de imagen QR `api.qrserver.com` (sin dependencia npm).

## Global Constraints

- **Regla dura de UX (spec §0):** la misma URL `/app/qr/:token` sirve las dos vistas — nunca hay redirect a login. Sin sesión → datos públicos en la misma pantalla.
- **Alcance Fase 1 únicamente** (spec §3): NO implementar acciones autenticadas (Fase 2), integración con mapa (Fase 3), ni documentos adjuntos (Fase 4). Esas fases tienen su propio spec+plan.
- **Campos públicos permitidos (spec §2):** económico (mva), marca, modelo, color, año, placas, fotoUrl. Nada de `cuadre`/`externos`.
- **Sin backfill masivo** (spec §2): el token se genera on-demand, nunca en batch.
- **Token no adivinable** (spec §4): usar Web Crypto, no `Math.random()`.
- **Sin WAF, rate-limit básico** (spec §2): un contador simple con TTL alcanza; no se sobre-construye.
- **No se abre permiso nuevo más allá de lo ya aprobado en el spec** (spec §2): `qrToken` se añade a la whitelist de `actualizacionUbicacionIndexValida()`.
- **"Baja de unidad" (spec §2/§4) se implementa como chequeo en lectura, no como limpieza en escritura:** el spec dice "limpiar `qrToken` en el mismo flujo que marca la baja", pero el estado `FUERA_DE_FLOTA` que menciona no existe en esta base de código (se confirmó por grep) — el mecanismo real para dar de baja una unidad es el campo `activo` (`'Inactivo'`/`'BAJA'`, ver `isActive()` en `js/app/features/unidades/unidades-unit-form.js`). En vez de agregar limpieza de `qrToken` a cada sitio que pueda tocar `activo` (más riesgo, más superficie), `getUnidadPublica` (Task 1) verifica `activo` en el momento de la lectura y responde 404 si la unidad está inactiva — mismo resultado observable ("QR en unidad vendida no debe seguir resolviendo"), con un solo punto de verificación.
- **Este despliegue es single-tenant en la práctica** (confirmado en `js/app/router.js`: comentario "single-tenant, no empresa context switching" y `obtenerUnidadesPlazas()` no filtra por empresa). El caso borde de aislamiento cross-tenant del spec §1/§4 no aplica aquí — no se construye lógica de degradación multi-tenant que no existe en ningún otro módulo de esta base de código.
- **Golden rule de cierre de tarea** (CLAUDE.md): al terminar, `node scripts/bump-sw.js`, commit, push. Este plan además requiere `npm run deploy:functions` (nueva Cloud Function) y `npm run deploy` u otro deploy que incluya hosting + `firestore.rules` (`npm run deploy:full` o `deploy:rules`).

---

### Task 1: Cloud Function `getUnidadPublica(token)`

**Files:**
- Modify: `functions/index.js` (agregar después de `generarYSubirPdf`/`destroyCloudinaryMedia`, cerca de línea 3433, o al final del bloque de funciones — cualquier punto top-level después de que `db`, `admin`, `functions`, `REGION`, `HttpsError`, `normalizeString` ya estén definidos, que es desde la línea 72 en adelante)

**Interfaces:**
- Produces: `exports.getUnidadPublica` — callable HTTPS function, payload `{ token: string }`, respuesta `{ mva, marca, modelo, color, anio, placas, fotoUrl }` (todos strings, `''` si el campo no existe). Sin `context.auth` requerido. Lanza `HttpsError('not-found', ...)` para token inválido, unidad inexistente o inactiva. Lanza `HttpsError('resource-exhausted', ...)` si se excede el rate limit.
- Consumes: nada de tasks anteriores (es la base).

- [ ] **Step 1: Agregar la función al final del archivo, antes del `module.exports` final si existe (o simplemente después de `destroyCloudinaryMedia`, ~línea 3460)**

```js
// ─── QR Gateway — Fase 1 (gateway público) ────────────────
// Rate limit en memoria por IP: 30 solicitudes / 60s por instancia. Se
// resetea en cada cold start — suficiente para frenar abuso trivial de
// escaneo (spec: "no WAF; subir solo si hay abuso real").
const _qrRateLimit = new Map();
function _qrRateLimitOk(ip) {
  const key = String(ip || "unknown");
  const now = Date.now();
  const windowMs = 60000;
  const maxHits = 30;
  const entry = _qrRateLimit.get(key);
  if (!entry || now > entry.resetAt) {
    _qrRateLimit.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= maxHits;
}

function _isUnidadActiva(row = {}) {
  const raw = String(row.activo ?? row.active ?? "").toUpperCase().trim();
  if (!raw) return true;
  return !["NO", "FALSE", "INACTIVO", "0", "BAJA"].includes(raw);
}

/**
 * Callable: getUnidadPublica - SIN auth. Resuelve un token de QR contra
 * index_unidades y regresa solo los campos públicos de la unidad. 404
 * genérico si el token no existe o la unidad está dada de baja (nunca
 * revela que "existe pero está oculta" — spec §1).
 */
exports.getUnidadPublica = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    const ip = context.rawRequest?.ip
      || context.rawRequest?.headers?.["x-forwarded-for"]
      || "unknown";
    if (!_qrRateLimitOk(ip)) {
      throw new HttpsError("resource-exhausted", "Demasiadas solicitudes, intenta de nuevo en un minuto.");
    }

    const token = normalizeString(data?.token);
    if (!token) throw new HttpsError("not-found", "Unidad no disponible.");

    const snap = await db.collection("index_unidades").where("qrToken", "==", token).limit(1).get();
    if (snap.empty) throw new HttpsError("not-found", "Unidad no disponible.");

    const row = snap.docs[0].data() || {};
    if (!_isUnidadActiva(row)) throw new HttpsError("not-found", "Unidad no disponible.");

    return {
      mva: normalizeString(row.mva),
      marca: normalizeString(row.marca),
      modelo: normalizeString(row.modelo),
      color: normalizeString(row.color),
      anio: normalizeString(row.anio || row.año),
      placas: normalizeString(row.placas),
      fotoUrl: normalizeString(row.fotoUrl || row.foto),
    };
  });
```

- [ ] **Step 2: Verificar sintaxis localmente**

Run: `node -c functions/index.js`
Expected: sin salida (exit code 0).

- [ ] **Step 3: Probar contra el emulador**

```bash
firebase emulators:start --only functions,firestore
```

En otra terminal, seed manual de un doc con token y llamada directa al endpoint HTTP callable del emulador (mismo patrón que `scripts/test-generar-pdf.js`, sin Authorization header ya que esta función no requiere auth):

```bash
curl -s -X POST "http://127.0.0.1:5001/<PROJECT_ID>/us-central1/getUnidadPublica" \
  -H "Content-Type: application/json" \
  -d '{"data":{"token":"token-que-no-existe"}}'
```

Expected: respuesta JSON con `error.status: "NOT_FOUND"` (o equivalente `error.message` de not-found) — confirma que el 404 genérico funciona antes de tener datos reales.

- [ ] **Step 4: Commit**

```bash
git add functions/index.js
git commit -m "feat(qr-gateway): getUnidadPublica callable sin auth (Fase 1)"
```

---

### Task 2: Botón "Generar QR" en la ficha de unidad + whitelist de Firestore

**Files:**
- Modify: `firestore.rules:709-712` (whitelist de `actualizacionUbicacionIndexValida()`)
- Modify: `js/app/views/unidad-expediente.js` (botón + lógica de generación, sección de acciones existente en `_paintBody()` y `_onClick()`)

**Interfaces:**
- Consumes: `actualizarUnidadPlaza(data)` ya existente (`js/core/database.js` re-exporta `api/flota.js`), gate `_canManage()` ya existente en el mismo archivo.
- Produces: campo `qrToken` persistido en `index_unidades/{doc}`; formato de URL pública `${window.location.origin}/app/qr/${qrToken}` que Task 3 resuelve.

- [ ] **Step 1: Agregar `qrToken` a la whitelist en `firestore.rules`**

Ubicación exacta (línea 709-712 actual):

```js
    function actualizacionUbicacionIndexValida() {
      return request.resource.data.diff(resource.data).affectedKeys()
        .hasOnly(["plazaActual", "pos", "ubicacion", "km", "kmFecha", "kmFuenteUltima"]);
    }
```

Reemplazar por:

```js
    function actualizacionUbicacionIndexValida() {
      return request.resource.data.diff(resource.data).affectedKeys()
        .hasOnly(["plazaActual", "pos", "ubicacion", "km", "kmFecha", "kmFuenteUltima", "qrToken"]);
    }
```

- [ ] **Step 2: Agregar el helper de generación de token y el botón en `js/app/views/unidad-expediente.js`**

Agregar esta función nueva cerca de las demás funciones `_` privadas (por ejemplo, después de `_actor()`, línea ~704):

```js
function _genQrToken() {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function _qrPublicUrl(token) {
  return `${window.location.origin}/app/qr/${encodeURIComponent(token)}`;
}
```

- [ ] **Step 3: Agregar el botón "Generar QR" al bloque de acciones en `_paintBody()`**

Ubicación exacta (líneas 248-252 actuales):

```js
  if (actions) {
    actions.innerHTML = canMap
      ? '<button type="button" class="uexp-btn ghost" data-action="map"><span class="material-icons">map</span>Mapa</button>'
      : '';
  }
```

Reemplazar por:

```js
  if (actions) {
    const mapBtn = canMap
      ? '<button type="button" class="uexp-btn ghost" data-action="map"><span class="material-icons">map</span>Mapa</button>'
      : '';
    const qrBtn = _canManage()
      ? '<button type="button" class="uexp-btn ghost" data-action="generar-qr"><span class="material-icons">qr_code_2</span>Generar QR</button>'
      : '';
    actions.innerHTML = mapBtn + qrBtn;
  }
```

Y agregar el panel de resultado (mostrado solo si `_s.data.detail.qrToken` existe o tras generar), justo después del bloque `${_estadosBanner(d)}` en el `body.innerHTML` template (líneas 254-255 actuales):

```js
  body.innerHTML = `
    ${_estadosBanner(d)}
    ${_qrPanelHtml(d)}
```

Nueva función `_qrPanelHtml`, agregada junto a `_extrasPanel`:

```js
function _qrPanelHtml(d = {}) {
  const token = String(d.qrToken || '').trim();
  if (!token) return '';
  const url = _qrPublicUrl(token);
  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;
  return `
    <section class="uexp-panel uexp-qr-panel">
      <h2>QR de la unidad</h2>
      <div class="uexp-qr-body">
        <img src="${esc(qrImg)}" alt="QR de ${esc(d.mva || '')}" width="220" height="220" loading="lazy">
        <div class="uexp-qr-info">
          <label>
            <span>Enlace público</span>
            <input type="text" readonly value="${esc(url)}" data-qr-url>
          </label>
          <div class="uexp-qr-actions">
            <button type="button" class="uexp-btn ghost" data-action="copiar-qr-url">Copiar enlace</button>
            ${_canManage() ? '<button type="button" class="uexp-btn ghost" data-action="generar-qr">Regenerar</button>' : ''}
          </div>
        </div>
      </div>
    </section>
  `;
}
```

- [ ] **Step 4: Manejar los clicks en `_onClick(event)`**

Agregar estos dos bloques dentro de `_onClick`, junto a los demás `if (action === ...)` (después del bloque `if (action === 'map')`, línea ~521):

```js
  if (action === 'generar-qr') {
    if (!_canManage()) return;
    _generarQr();
    return;
  }
  if (action === 'copiar-qr-url') {
    const input = _ctr?.querySelector('[data-qr-url]');
    if (input) {
      input.select();
      navigator.clipboard?.writeText(input.value).then(
        () => _toast('Enlace copiado.', 'success'),
        () => _toast('No se pudo copiar. Selecciona y copia manualmente.', 'error')
      );
    }
    return;
  }
```

- [ ] **Step 5: Implementar `_generarQr()` con el paso de confirmación del MVA (spec: "muestra el MVA/económico antes de confirmar")**

Agregar junto a `_submitAdjunto`:

```js
async function _generarQr() {
  if (!_s?.data?.detail) return;
  const mva = _s.data.detail.mva || _s.mva;
  const yaExiste = Boolean(_s.data.detail.qrToken);
  const ok = await window.mexConfirm(
    yaExiste ? 'Regenerar QR' : 'Generar QR',
    `Vas a ${yaExiste ? 'regenerar' : 'generar'} el código QR para la unidad ${mva}. ${yaExiste ? 'El QR impreso anteriormente dejará de funcionar de inmediato. ' : ''}Verifica que es la unidad correcta antes de imprimir la calca.`
  );
  if (!ok) return;

  const token = _genQrToken();
  try {
    const res = await actualizarUnidadPlaza({
      id: _s.data.detail.id || _s.data.detail.fila || _s.mva,
      qrToken: token
    });
    if (res !== 'EXITO') throw new Error(String(res || 'No se pudo generar el QR.'));
    _toast('QR generado.', 'success');
    await _load();
  } catch (err) {
    _toast(err?.message || 'No se pudo generar el QR.', 'error');
  }
}
```

- [ ] **Step 6: Agregar estilos mínimos para `.uexp-qr-panel`/`.uexp-qr-body`/`.uexp-qr-info`/`.uexp-qr-actions` a `css/app-unidad-expediente.css`**

Leer primero el archivo existente para seguir sus convenciones de espaciado/variables (`var(--surface)`, `var(--border)`, `var(--text)`) antes de agregar las reglas — no inventar tokens nuevos.

- [ ] **Step 7: Verificación manual**

1. `firebase emulators:start --only hosting,firestore` (o contra staging).
2. Entrar como usuario con `manage_global_fleet` (GERENTE_PLAZA+), ir a `/app/cuadre/u/<mva-existente>`.
3. Click "Generar QR" → confirmar el diálogo → verificar que aparece el panel con imagen QR y el enlace.
4. Verificar en Firestore (consola o emulador UI) que `index_unidades/{doc}.qrToken` tiene el valor esperado.
5. Click "Regenerar" → confirmar que el token cambia (comparar el valor del input antes/después).

- [ ] **Step 8: Commit**

```bash
git add firestore.rules js/app/views/unidad-expediente.js css/app-unidad-expediente.css
git commit -m "feat(qr-gateway): boton Generar QR en ficha de unidad (Fase 1)"
```

---

### Task 3: Vista pública `/app/qr/:token` + bypass de auth en `main.js`

**Files:**
- Create: `js/app/views/qr-publica.js`
- Create: `css/app-qr-publica.css`
- Modify: `js/app/router.js` (registrar ruta `/app/qr` + prefix matching)
- Modify: `js/app/main.js` (bypass de auth antes del redirect a `/login`)
- Modify: `sw.js` (agregar el nuevo view file a la lista de precache — bump de versión se hace en el closeout)

**Interfaces:**
- Consumes: `functions` desde `/js/core/database.js` (patrón ya usado en `js/core/pdf-export.js`), Cloud Function `getUnidadPublica` de Task 1.
- Produces: `mount({ container, navigate })` / `unmount()` — mismo contrato que cualquier vista del router (`js/app/router.js`), pero tolera `navigate: null` para el caso pre-auth.

- [ ] **Step 1: Crear `js/app/views/qr-publica.js`**

```js
// ============================================================================
//  /js/app/views/qr-publica.js — Ficha pública de unidad vía QR (/app/qr/:token)
//  Se monta con o sin sesión (spec: nunca hay redirect a login). Fase 1:
//  solo lectura de datos públicos, sin acciones autenticadas (Fase 2).
// ============================================================================

import { functions } from '/js/core/database.js';

const ROUTE_PREFIX = '/app/qr/';

let _ctr = null;

export async function mount({ container }) {
  unmount();
  _ctr = container;
  _ensureCss();

  const token = _tokenFromPath();
  if (!token) {
    _renderNotFound();
    return;
  }

  _renderLoading();
  try {
    const call = functions.httpsCallable('getUnidadPublica');
    const { data } = await call({ token });
    _renderUnidad(data || {});
  } catch (err) {
    console.warn('[qr-publica]', err);
    _renderNotFound();
  }
}

export function unmount() {
  _ctr = null;
}

function _ensureCss() {
  const href = '/css/app-qr-publica.css';
  const attr = 'data-app-qr-publica-css';
  let link = document.querySelector(`link[${attr}="1"]`);
  if (link) return;
  link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute(attr, '1');
  document.head.appendChild(link);
}

function _tokenFromPath() {
  const path = String(window.location.pathname || '').replace(/\/+$/, '');
  if (!path.startsWith(ROUTE_PREFIX)) return '';
  return decodeURIComponent(path.slice(ROUTE_PREFIX.length) || '').trim();
}

function _esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _shell(bodyHtml) {
  if (!_ctr) return;
  _ctr.innerHTML = `
    <div class="qrp-page">
      <div class="qrp-card">
        <div class="qrp-brand">MapGestion</div>
        ${bodyHtml}
      </div>
    </div>
  `;
}

function _renderLoading() {
  _shell('<div class="qrp-loading"><span class="material-symbols-outlined spin">sync</span> Cargando unidad…</div>');
}

function _renderNotFound() {
  _shell(`
    <div class="qrp-notfound">
      <span class="material-symbols-outlined">search_off</span>
      <h1>No disponible</h1>
      <p>Este código QR no corresponde a ninguna unidad activa.</p>
    </div>
  `);
}

function _renderUnidad(u = {}) {
  const rows = [
    ['Marca', u.marca],
    ['Modelo', u.modelo],
    ['Color', u.color],
    ['Año', u.anio],
    ['Placas', u.placas],
  ].filter(([, v]) => String(v || '').trim());

  _shell(`
    ${u.fotoUrl ? `<img class="qrp-foto" src="${_esc(u.fotoUrl)}" alt="Foto de ${_esc(u.mva || '')}">` : ''}
    <h1 class="qrp-mva">${_esc(u.mva || 'Unidad')}</h1>
    <dl class="qrp-fields">
      ${rows.map(([label, value]) => `
        <div class="qrp-field">
          <dt>${_esc(label)}</dt>
          <dd>${_esc(value)}</dd>
        </div>
      `).join('')}
    </dl>
  `);
}
```

- [ ] **Step 2: Crear `css/app-qr-publica.css`**

```css
.qrp-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--bg, #f8fafc);
  font-family: 'Inter', sans-serif;
}

.qrp-card {
  width: min(420px, 100%);
  background: var(--surface, #ffffff);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 16px;
  padding: 32px 24px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.12);
}

.qrp-brand {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted, #64748b);
  margin-bottom: 20px;
}

.qrp-foto {
  width: 100%;
  max-height: 220px;
  object-fit: cover;
  border-radius: 12px;
  margin-bottom: 16px;
}

.qrp-mva {
  font-size: 28px;
  font-weight: 900;
  color: var(--text, #0f172a);
  margin: 0 0 16px;
}

.qrp-fields {
  display: grid;
  gap: 12px;
  text-align: left;
  margin: 0;
}

.qrp-field {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  background: var(--bg, #f8fafc);
  border-radius: 8px;
}

.qrp-field dt {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted, #64748b);
  text-transform: uppercase;
}

.qrp-field dd {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--text, #0f172a);
}

.qrp-loading,
.qrp-notfound {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--text-muted, #64748b);
  padding: 24px 0;
}

.qrp-notfound h1 {
  font-size: 18px;
  font-weight: 800;
  color: var(--text, #0f172a);
  margin: 0;
}

.qrp-loading .spin {
  animation: qrp-spin 0.9s linear infinite;
}

@keyframes qrp-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-color-scheme: dark) {
  .qrp-page { background: #07111f; }
  .qrp-card { background: #0f1c30; border-color: rgba(255,255,255,0.08); }
}
```

- [ ] **Step 3: Registrar la ruta en `js/app/router.js`**

Agregar al `ROUTE_TABLE` (junto a la entrada `/app/cuadre/u`, línea ~128):

```js
  '/app/qr': {
    loader:   () => import('/js/app/views/qr-publica.js'),
    navRoute: '/app/qr',
  },
```

Agregar el prefix matching en `_routeForPath` (línea ~307, junto al `if (key.startsWith('/app/cuadre/u/'))`):

```js
  if (key.startsWith('/app/qr/')) return ROUTE_TABLE['/app/qr'];
```

Y en `_styleKeyForPath` (línea ~319, mismo patrón) — no es estrictamente necesario porque la vista inyecta su propio CSS vía `_ensureCss()`, así que se omite para no duplicar el `<link>`.

- [ ] **Step 4: Bypass de auth en `js/app/main.js`**

Agregar estas dos funciones nuevas cerca de `_isLocalQaAuthBypassEnabled` (línea ~174):

```js
function _qrTokenFromPath() {
  const m = window.location.pathname.match(/^\/app\/qr\/([^/]+)\/?$/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function _mountPublicQr(token) {
  _setBootStatus('Cargando unidad…');
  if (window.__mexConfigReadyPromise) {
    try { await window.__mexConfigReadyPromise; } catch (_) {}
  }
  const appRoot = document.getElementById('appRoot');
  const loadSpinner = document.getElementById('appLoadingSpinner');
  if (!appRoot) return;
  appRoot.style.display = '';
  loadSpinner?.remove();
  const mod = await import('/js/app/views/qr-publica.js');
  await mod.mount({ container: appRoot, navigate: null });
}
```

Modificar el bloque existente (líneas 232-237 actuales):

```js
  const user = qaAuthBypass ? _qaBypassUser() : await waitForAuth();

  if (!user) {
    window.location.replace('/login');
    return;
  }
```

Reemplazar por:

```js
  const user = qaAuthBypass ? _qaBypassUser() : await waitForAuth();

  if (!user) {
    const qrToken = _qrTokenFromPath();
    if (qrToken) {
      await _mountPublicQr(qrToken);
      return;
    }
    window.location.replace('/login');
    return;
  }
```

- [ ] **Step 5: Agregar el nuevo archivo de vista al precache de `sw.js`**

Agregar `'/js/app/views/qr-publica.js',` a la lista de precache existente (junto a las demás entradas de `/js/app/views/*.js`, línea ~128).

- [ ] **Step 6: Verificación manual end-to-end**

1. Con el emulador o staging corriendo, generar un QR para una unidad real (Task 2).
2. Copiar el enlace del panel QR.
3. Abrir el enlace en una ventana de incógnito (sin sesión) → debe mostrar la ficha pública directamente, **sin pasar por `/login`**.
4. Verificar que un token inválido (`/app/qr/token-inventado`) muestra "No disponible", no un error crudo ni un 500.
5. Con sesión iniciada, abrir el mismo enlace en una pestaña normal → debe mostrar la misma ficha dentro del flujo normal de la SPA (sin necesidad de que el shell/sidebar aparezcan, ya que la vista no depende de ellos).
6. Marcar la unidad como Inactiva (`activo: 'Inactivo'`) desde la ficha y volver a abrir el enlace QR → debe mostrar "No disponible" (spec: unidad dada de baja no debe seguir resolviendo).

- [ ] **Step 7: Commit**

```bash
git add js/app/views/qr-publica.js css/app-qr-publica.css js/app/router.js js/app/main.js sw.js
git commit -m "feat(qr-gateway): vista publica /app/qr/:token sin redirect a login (Fase 1)"
```

---

### Task 4: Cierre (deploy)

**Files:**
- Modify: `sw.js` (bump automático vía script, no manual)

- [ ] **Step 1: Bump de versión del Service Worker**

```bash
node scripts/bump-sw.js
```

- [ ] **Step 2: Deploy — hosting + functions + reglas (la Fase 1 toca los tres)**

```bash
npm run deploy:full
```

Si se prefiere separar: `npm run deploy:functions` (Task 1) y `npm run deploy:rules` (Task 2) antes de `npm run deploy` (Task 3), en ese orden, para que la función y las reglas nuevas existan antes de que el hosting nuevo intente usarlas.

- [ ] **Step 3: Commit final del bump**

```bash
git add sw.js
git commit -m "chore(sw): bump tras deploy de QR Gateway Fase 1"
git push
```

- [ ] **Step 4: Pedir al usuario que pruebe en producción**

Generar un QR real desde una unidad de prueba, imprimir o simular el escaneo abriendo el enlace en un dispositivo sin sesión iniciada, y confirmar que el flujo cumple el entregable de Fase 1 ("escanear un QR impreso muestra la ficha pública sin login, demostrable solo").
