# PDF server-side (Puppeteer + Cloudinary) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el patrón `window.open + print()` (roto: popup en blanco, nunca produce un binario real) por una Cloud Function que renderiza el HTML ya existente con Puppeteer, sube el PDF a Cloudinary, y guarda la URL en Firestore para que historial/papeletas lo sirvan instantáneo la próxima vez.

**Architecture:** Una Cloud Function callable genérica (`generarYSubirPdf`) recibe `{ kind, docId, html, filename }`, renderiza con `puppeteer-core` + `@sparticuz/chromium`, sube el buffer a Cloudinary vía el SDK server-side ya configurado (`getCloudinarySdk`), y escribe `pdfUrl` en el doc de Firestore que le corresponda a `kind` (mapeo cerrado, nunca un path libre). Un helper cliente compartido (`js/core/pdf-export.js`) llama la Function y abre la URL real. Las plantillas HTML existentes (`generarHtmlAuditoriaCuadrePdf`, `openPapeletaPdf`) no cambian — solo cambia el paso final de "imprimir" a "renderizar y subir".

**Tech Stack:** Firebase Functions v1 (Node 22), `puppeteer-core` + `@sparticuz/chromium`, Cloudinary Node SDK (ya instalado), Firestore, vanilla JS SPA (sin build step).

**Spec:** `docs/superpowers/specs/2026-07-22-pdf-server-render-design.md`

## Global Constraints

- No se reescriben las plantillas HTML (`generarHtmlAuditoriaCuadrePdf` en `js/core/cuadre-pdf.js`, el HTML de `openPapeletaPdf` en `js/app/features/papeletas/papeletas-pdf.js`) — se reutilizan tal cual.
- `kind` es un enum cerrado (`'cuadre' | 'papeleta'`); el cliente **nunca** manda un `docPath`/campo de Firestore libre — ver §2 del spec (riesgo de escritura no acotada).
- Nombre de archivo firmado: `buildExportFilename('pdf')` (ya existe en `js/core/export-signing.js`) — no se reinventa el nombre.
- Auth: `await findUserProfileFromAuth(context.auth)` al inicio de la Function, mismo patrón que `getCloudinaryUploadSignature`/`destroyCloudinaryMedia`.
- Secrets/config: reutilizar `CLOUDINARY_SECRETS`, `getCloudinarySdk()`, `sanitizeCloudinaryFolder()` ya definidos en `functions/index.js` — no se duplican.
- `.xls` queda fuera de alcance (ver spec §4) — no se toca `exportPapeletaXls`/`exportMatrixXls`.
- Cierre de tarea: `node scripts/bump-sw.js` + commit + push al terminar (regla de oro del repo, `CLAUDE.md`).

## File map

| File | Responsibility |
|---|---|
| `functions/package.json` | agrega `puppeteer-core`, `@sparticuz/chromium` |
| `functions/index.js` | nueva `exports.generarYSubirPdf` + helper puro `_pdfTargetFor(kind)` |
| `js/core/pdf-export.js` | **nuevo** — `generarYAbrirPdf(html, opts)`, llama la Function y abre la URL |
| `js/core/cuadre-pdf.js` | `abrirReporteImpresion` reescrito para llamar `pdf-export.js` |
| `js/app/views/cuadre-flota.js` | botón "Ver PDF": usa `item.pdfUrl` si existe; si no, genera y lo guarda en `_s.historial` |
| `js/app/views/cuadrarflota-ventas.js` | `_submit()`: pasa `docId: res.id` al generar el PDF de cierre |
| `js/app/features/papeletas/papeletas-pdf.js` | `openPapeletaPdf` reescrito para llamar `pdf-export.js` |
| `js/app/views/papeletas.js` | los dos call sites de `openPapeletaPdf` pasan `docId` |

---

### Task 1: Dependencias de Functions

**Files:**
- Modify: `functions/package.json`

- [ ] **Step 1: Instalar las dependencias**

```bash
cd functions
npm install puppeteer-core@latest @sparticuz/chromium@latest --save
cd ..
```

- [ ] **Step 2: Verificar que quedaron en `dependencies` y que `npm run lint` (dentro de `functions/`) sigue pasando**

Run: `cd functions && npm run lint && cd ..`
Expected: `node --check index.js` sin salida (exit 0) — `index.js` todavía no las usa, solo se confirma que el `npm install` no rompió nada.

- [ ] **Step 3: Commit**

```bash
git add functions/package.json functions/package-lock.json
git commit -m "chore(functions): agrega puppeteer-core + @sparticuz/chromium"
```

---

### Task 2: Cloud Function `generarYSubirPdf`

**Files:**
- Modify: `functions/index.js` (agregar justo antes de `exports.destroyCloudinaryMedia`, línea ~3319)
- Test: `scripts/test-generar-pdf.js` (nuevo)
- Modify: `package.json` (raíz) — nuevo script `test:pdf-export`

**Interfaces:**
- Consumes: `getCloudinarySdk()`, `sanitizeCloudinaryFolder()`, `CLOUDINARY_SECRETS`, `findUserProfileFromAuth(auth)`, `recordProgrammerError(scope, error, extra)`, `HttpsError`, `db`, `admin`, `logger`, `normalizeString` — todos ya definidos en `functions/index.js`.
- Produces: `exports.generarYSubirPdf` (callable), invocable desde cliente como `functions.httpsCallable('generarYSubirPdf')({ kind, docId, html, filename })` → resuelve `{ data: { url } }`.

- [ ] **Step 1: Helper puro de mapeo `kind` → destino (testeable sin Puppeteer/Cloudinary)**

Agregar en `functions/index.js`, justo antes de `exports.destroyCloudinaryMedia` (línea ~3319):

```js
// ─── PDF server-side (Puppeteer → Cloudinary) ─────────────
// kind es un enum cerrado: el cliente nunca manda un path de Firestore
// libre, solo elige entre estos dos destinos fijos.
function _pdfTargetFor(kind) {
  const k = normalizeString(kind).toLowerCase();
  if (k === "cuadre") {
    return { collection: "historial_cuadres", field: "pdfUrl", folder: "mapgestion/prod/reportes_cuadre" };
  }
  if (k === "papeleta") {
    return { collection: "papeletas", field: "pdfUrl", folder: "mapgestion/prod/reportes_papeletas" };
  }
  return null;
}
```

- [ ] **Step 2: Script de smoke-test manual (requiere emulador + credenciales Cloudinary reales — ver Step 6)**

Mismo patrón que `scripts/test-hosting-surface.js` (Node `fetch` plano, sin agregar el SDK `firebase` como dependencia — resuelve hosts vía el hub del emulador). Crear `scripts/test-generar-pdf.js`:

```js
#!/usr/bin/env node

const assert = require('node:assert/strict');

async function emulatorHost(name) {
  const hubHost = String(process.env.FIREBASE_EMULATOR_HUB || '127.0.0.1:4400').trim();
  const response = await fetch(`http://${hubHost}/emulators`);
  const emulators = await response.json();
  const entry = emulators?.[name];
  if (!entry?.host || !entry?.port) throw new Error(`Emulador '${name}' no está corriendo.`);
  return `${entry.host}:${entry.port}`;
}

async function signInAnonymously(authHost) {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) }
  );
  const body = await response.json();
  assert.ok(body.idToken, 'signUp anónimo del emulador de Auth debe devolver idToken');
  return body.idToken;
}

async function seedEmptyUserProfile(firestoreHost, uid) {
  // findUserProfileFromAuth solo exige que exista el doc en usuarios/{uid};
  // un doc vacío ya pasa isActiveUserProfile() (sin status bloqueado, sin
  // flags en false). No hace falta perfil real para este smoke test.
  const url = `http://${firestoreHost}/v1/projects/mex-mapa-bjx/databases/(default)/documents/usuarios/${uid}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {} }),
  });
  assert.ok(response.ok, `no se pudo sembrar usuarios/${uid} en el emulador de Firestore`);
}

(async () => {
  const authHost = await emulatorHost('auth');
  const firestoreHost = await emulatorHost('firestore');
  const functionsHost = await emulatorHost('functions');
  const idToken = await signInAnonymously(authHost);
  const uid = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8')).user_id;
  await seedEmptyUserProfile(firestoreHost, uid);

  const html = '<!DOCTYPE html><html><body><h1>Smoke test PDF</h1></body></html>';
  const response = await fetch(
    `http://${functionsHost}/mex-mapa-bjx/us-central1/generarYSubirPdf`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ data: { kind: 'cuadre', docId: '', html, filename: 'SMOKE_TEST_2026_07_22_MAPGESTION' } }),
    }
  );
  const body = await response.json();
  assert.ok(response.ok, `la Function respondió ${response.status}: ${JSON.stringify(body)}`);
  assert.ok(body.result && typeof body.result.url === 'string', 'debe devolver { result: { url } }');
  assert.match(body.result.url, /^https:\/\/res\.cloudinary\.com\//, 'la URL debe ser de Cloudinary');
  console.log('OK — PDF generado:', body.result.url);
})().catch((err) => { console.error('FAIL', err); process.exit(1); });
```

- [ ] **Step 3: Agregar el script npm**

En `package.json` (raíz), dentro de `"scripts"`, junto a los demás `test:*`:

```json
    "test:pdf-export": "firebase emulators:exec --only functions,firestore,auth \"node scripts/test-generar-pdf.js\"",
```

- [ ] **Step 4: Implementar la Cloud Function**

Agregar en `functions/index.js`, después del helper `_pdfTargetFor` (mismo lugar que Step 1, antes de `exports.destroyCloudinaryMedia`):

```js
exports.generarYSubirPdf = functions
  .region(REGION)
  .runWith({ secrets: CLOUDINARY_SECRETS, timeoutSeconds: 60, memory: "1GB" })
  .https.onCall(async (data, context) => {
    await findUserProfileFromAuth(context.auth);

    const html = normalizeString(data?.html);
    if (!html) throw new HttpsError("invalid-argument", "html requerido.");
    const filename = normalizeString(data?.filename) || `reporte_${Date.now()}`;
    const kind = normalizeString(data?.kind);
    const docId = normalizeString(data?.docId);
    const target = kind ? _pdfTargetFor(kind) : null;
    if (kind && !target) {
      throw new HttpsError("invalid-argument", "kind inválido (usa 'cuadre' o 'papeleta').");
    }

    let browser = null;
    let pdfBuffer;
    try {
      // eslint-disable-next-line global-require
      const chromium = require("@sparticuz/chromium");
      // eslint-disable-next-line global-require
      const puppeteer = require("puppeteer-core");
      browser = await puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      pdfBuffer = await page.pdf({ format: "A4", landscape: true, printBackground: true });
    } catch (error) {
      logger.error("generarYSubirPdf: render", error);
      await recordProgrammerError("generarYSubirPdf.render", error, { kind, docId });
      throw new HttpsError("internal", "No se pudo renderizar el PDF.");
    } finally {
      if (browser) { try { await browser.close(); } catch (_) { /* noop */ } }
    }

    const folder = sanitizeCloudinaryFolder(target?.folder || "mapgestion/prod/reportes_pdf");
    let uploadResult;
    try {
      const { cloudinary } = getCloudinarySdk();
      uploadResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            resource_type: "raw",
            folder,
            public_id: sanitizeCloudinaryPublicId(filename) || undefined,
            use_filename: true,
            unique_filename: false,
          },
          (err, result) => (err ? reject(err) : resolve(result))
        );
        stream.end(pdfBuffer);
      });
    } catch (error) {
      logger.error("generarYSubirPdf: upload", error);
      await recordProgrammerError("generarYSubirPdf.upload", error, { kind, docId });
      throw new HttpsError("internal", "No se pudo subir el PDF a Cloudinary.");
    }

    const url = uploadResult.secure_url || uploadResult.url;

    if (target && docId) {
      try {
        await db.collection(target.collection).doc(docId).update({
          [target.field]: url,
          pdfGeneradoEn: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (error) {
        // El PDF ya existe en Cloudinary aunque falle este update — no se pierde el render.
        logger.warn("generarYSubirPdf: firestore update failed", { kind, docId, err: error?.message });
        await recordProgrammerError("generarYSubirPdf.firestoreUpdate", error, { kind, docId });
      }
    }

    return { url };
  });
```

- [ ] **Step 5: Verificar sintaxis**

Run: `cd functions && npm run lint && cd ..`
Expected: exit 0, sin salida.

- [ ] **Step 6: Correr el smoke test (requiere Cloudinary real configurado — ver `docs/app-check.md`/env de Functions para dónde viven los secrets en local; si no hay credenciales a mano, documentar en el PR que este paso quedó pendiente de correr con secrets reales y seguir)**

Run: `npm run test:pdf-export`
Expected: `OK — PDF generado: https://res.cloudinary.com/...`

- [ ] **Step 7: Commit**

```bash
git add functions/index.js scripts/test-generar-pdf.js package.json
git commit -m "feat(functions): generarYSubirPdf — Puppeteer + Cloudinary"
```

---

### Task 3: Helper cliente compartido

**Files:**
- Create: `js/core/pdf-export.js`

**Interfaces:**
- Consumes: `functions` desde `/js/core/database.js`, `buildExportFilename` desde `/js/core/export-signing.js`.
- Produces: `generarYAbrirPdf(html, { kind, docId, onStatus } = {})` → `Promise<string>` (la URL de Cloudinary). Usado por Task 4 y Task 5.

- [ ] **Step 1: Crear el módulo**

```js
// ═══════════════════════════════════════════════════════════
// /js/core/pdf-export.js
// Genera un PDF server-side (Cloud Function generarYSubirPdf) a partir
// de un documento HTML completo y lo sube a Cloudinary. Reemplaza el
// patrón window.open + window.print() (nunca producía un archivo real).
// ═══════════════════════════════════════════════════════════
import { functions } from '/js/core/database.js';
import { buildExportFilename } from '/js/core/export-signing.js';

/**
 * @param {string} html documento HTML completo (doctype + head + body)
 * @param {{ kind?: 'cuadre'|'papeleta', docId?: string, onStatus?: (s: 'generando'|'listo'|'error') => void }} opts
 * @returns {Promise<string>} URL pública del PDF en Cloudinary
 */
export async function generarYAbrirPdf(html, { kind = '', docId = '', onStatus } = {}) {
  onStatus?.('generando');
  const filename = buildExportFilename('pdf').replace(/\.pdf$/i, '');
  try {
    const call = functions.httpsCallable('generarYSubirPdf');
    const { data } = await call({ kind, docId, html, filename });
    if (!data?.url) throw new Error('La Function no devolvió una URL.');
    onStatus?.('listo');
    return data.url;
  } catch (error) {
    onStatus?.('error');
    throw error;
  }
}
```

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check js/core/pdf-export.js`
Expected: exit 0, sin salida.

- [ ] **Step 3: Commit**

```bash
git add js/core/pdf-export.js
git commit -m "feat(pdf): helper cliente generarYAbrirPdf"
```

---

### Task 4: Cablear cuadre de flota

**Files:**
- Modify: `js/core/cuadre-pdf.js:426-481` (reemplaza `abrirReporteImpresion`)
- Modify: `js/app/views/cuadre-flota.js:386-397` (acción `ver-pdf`)
- Modify: `js/app/views/cuadrarflota-ventas.js:684-720` (`_submit`, pasar `docId`)

**Interfaces:**
- Consumes: `generarYAbrirPdf` desde `/js/core/pdf-export.js` (Task 3).
- Produces: `abrirReporteImpresion(htmlContenido, { kind, docId, onError, onStatus })` → ya no retorna nada útil sincrónicamente; abre `window.open(url, '_blank')` cuando resuelve.

- [ ] **Step 1: Reescribir `abrirReporteImpresion` en `js/core/cuadre-pdf.js`**

Reemplazar todo el bloque actual (líneas 426-481, desde el comentario `/** Abre un documento...` hasta el cierre de la función) por:

```js
import { generarYAbrirPdf } from '/js/core/pdf-export.js';

/**
 * Genera el PDF server-side y lo abre en pestaña nueva. Ya no depende
 * de window.print() ni de que el usuario complete el diálogo nativo.
 */
export async function abrirReporteImpresion(htmlContenido, { kind = 'cuadre', docId = '', onError, onStatus } = {}) {
  const signedTitle = buildExportFilename('pdf').replace(/\.pdf$/i, '');
  const docHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${String(signedTitle).replace(/</g, '')}</title>
  <style>
    html, body { margin: 0; padding: 0; background: #fff; color: #111; }
    body { font-family: Inter, Arial, sans-serif; }
  </style>
</head>
<body>
  <div id="reporte-pdf-container">${htmlContenido}</div>
</body>
</html>`;

  try {
    const url = await generarYAbrirPdf(docHtml, { kind, docId, onStatus });
    window.open(url, '_blank', 'noopener,noreferrer');
    return url;
  } catch (error) {
    console.error('No se pudo generar el PDF:', error);
    if (typeof onError === 'function') onError(error);
    return null;
  }
}
```

Nota: agregar el `import { generarYAbrirPdf } from '/js/core/pdf-export.js';` junto a los demás imports al inicio del archivo (línea 8-10), no dentro de la función.

- [ ] **Step 2: `js/app/views/cuadre-flota.js` — usar `pdfUrl` guardado si existe**

En el bloque `if (action === 'ver-pdf') { ... }` (líneas 386-397), reemplazar:

```js
  if (action === 'ver-pdf') {
    const item = _s.historial.find(h => String(h.id) === String(el.dataset.id));
    if (!item) {
      _toast('No encontré ese registro de cuadre.', 'error');
      return;
    }
    if (item.pdfUrl && /^https?:\/\//i.test(item.pdfUrl)) {
      window.open(item.pdfUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    _toast('Generando PDF…', 'info');
    const payload = _historialCuadrePayload(item);
    const url = await abrirReporteImpresion(
      generarHtmlAuditoriaCuadrePdf(payload.unidades, payload.stats, payload.meta, { plaza: _s.plaza, actorName: _actorName() }),
      { kind: 'cuadre', docId: item.id, onError: () => _toast('No se pudo generar el PDF.', 'error') }
    );
    if (url) item.pdfUrl = url; // cachea en memoria: el próximo clic ya no regenera
    return;
  }
```

`item.pdfUrl && /^https?:\/\//i.test(item.pdfUrl)` cubre el caso legacy donde `pdfUrl` a veces trae un JSON stringificado (ver `_historialCuadrePayload`, línea 285) — esos no matchean el regex y caen al flujo de generar.

`_onClick` ya es `async` (se ve en la firma de la línea 376) — no hace falta cambiar la firma.

- [ ] **Step 3: `js/app/views/cuadrarflota-ventas.js` — pasar `docId` del cierre**

En `_submit()` (líneas 707-710), reemplazar:

```js
    abrirReporteImpresion(
      generarHtmlAuditoriaCuadrePdf(payload, stats, pdfMeta, { plaza: _s.plaza, actorName: signedName }),
      { onError: () => _toast('No se pudo abrir el generador de PDF.', 'error') }
    );
```

por:

```js
    abrirReporteImpresion(
      generarHtmlAuditoriaCuadrePdf(payload, stats, pdfMeta, { plaza: _s.plaza, actorName: signedName }),
      { kind: 'cuadre', docId: res.id, onError: () => _toast('No se pudo generar el PDF de cierre.', 'error') }
    );
```

(`res` ya está en scope — es el resultado de `procesarAuditoriaDesdeAdmin(...)` en la línea anterior, y `res.id` es el id del doc recién creado en `historial_cuadres`.)

- [ ] **Step 4: Verificar sintaxis de los tres archivos**

Run: `node --check js/core/cuadre-pdf.js && node --check js/app/views/cuadre-flota.js && node --check js/app/views/cuadrarflota-ventas.js`
Expected: exit 0, sin salida.

- [ ] **Step 5: Prueba manual**

1. `firebase emulators:start --only hosting` (o el flujo local habitual del repo).
2. Cerrar un cuadre de flota completo (Ventas) → confirmar que aparece un toast de "generando" y luego se abre una pestaña nueva con un PDF real de Cloudinary (no `about:blank`).
3. Ir a Historial → "Ver PDF" sobre ese mismo registro → debe abrir instantáneo (sin volver a generar) porque ya quedó `pdfUrl` guardado.
4. "Ver PDF" sobre un registro viejo (cerrado antes de este cambio, sin `pdfUrl`) → debe generar on-demand y funcionar igual.

- [ ] **Step 6: Commit**

```bash
git add js/core/cuadre-pdf.js js/app/views/cuadre-flota.js js/app/views/cuadrarflota-ventas.js
git commit -m "fix(cuadre): PDF real via Cloud Function en vez de window.print"
```

---

### Task 5: Cablear papeletas

**Files:**
- Modify: `js/app/features/papeletas/papeletas-pdf.js:133-359` (`openPapeletaPdf`)
- Modify: `js/app/views/papeletas.js:3428` y `:3453` (pasar `docId`)

**Interfaces:**
- Consumes: `generarYAbrirPdf` desde `/js/core/pdf-export.js` (Task 3).
- Produces: `openPapeletaPdf(papeleta, { firmaUrl, fotoUrls, docId })` → ya no lanza si hay popup bloqueado (no hay popup); abre la URL real cuando resuelve.

- [ ] **Step 1: Reescribir el final de `openPapeletaPdf`**

En `js/app/features/papeletas/papeletas-pdf.js`, agregar el import junto a los demás (línea 1-6):

```js
import { generarYAbrirPdf } from '/js/core/pdf-export.js';
```

Cambiar la firma de la función (línea 133) para aceptar `docId`:

```js
export async function openPapeletaPdf(papeleta, { firmaUrl = '', fotoUrls = null, docId = '' } = {}) {
```

Reemplazar las últimas 6 líneas del archivo (353-358):

```js
  const w = window.open('', '_blank');
  if (!w) throw new Error('Permite ventanas emergentes para generar el PDF');
  w.document.open();
  w.document.write(html);
  w.document.close();
  return buildExportFilename('pdf');
}
```

por:

```js
  const url = await generarYAbrirPdf(html, { kind: 'papeleta', docId: docId || papeleta.id || '' });
  window.open(url, '_blank', 'noopener,noreferrer');
  return url;
}
```

(El botón `<button class="btn-print" ... onclick="window.print()">` y el `<script>window.onload=...window.print()</script>` que ya están embebidos en el `html` de más arriba no se tocan — dentro de Puppeteer headless `window.print()` es un no-op inofensivo, y ya no importan porque el HTML nunca se muestra en un navegador real, solo se renderiza server-side.)

- [ ] **Step 2: `js/app/views/papeletas.js` — pasar `docId` en los dos call sites**

Línea 3428, dentro de `_onFinalizeDelivery` (o el nombre de la función que contiene el bloque de la línea 3400-3434):

```js
      await openPapeletaPdf(result.papeleta || {
        ..._detail,
        status: 'entregada',
        salida: { ...(_detail.salida || {}), firma, firmaPath, km: kmRaw, gas: gasRaw },
      }, { firmaUrl, docId: papeletaId });
```

Línea 3453, dentro de `_doPdf`:

```js
    onPdf: async () => {
      const firmaUrl = await getDownloadUrl(p.salida?.firmaPath);
      await openPapeletaPdf(p, { firmaUrl, docId: p.id });
    },
```

- [ ] **Step 3: Verificar sintaxis**

Run: `node --check js/app/features/papeletas/papeletas-pdf.js && node --check js/app/views/papeletas.js`
Expected: exit 0, sin salida.

- [ ] **Step 4: Prueba manual**

1. Finalizar la entrega de una papeleta → debe abrir una pestaña con un PDF real de Cloudinary (no un popup en blanco ni el diálogo de impresión del navegador).
2. Desde el detalle de una papeleta ya entregada, exportar PDF de nuevo (`_doPdf`) → mismo resultado.
3. Confirmar en Firestore (`papeletas/{id}.pdfUrl`) que quedó guardada la URL real.

- [ ] **Step 5: Commit**

```bash
git add js/app/features/papeletas/papeletas-pdf.js js/app/views/papeletas.js
git commit -m "fix(papeletas): PDF real via Cloud Function en vez de window.print"
```

---

### Task 6: Cierre de tarea

- [ ] **Step 1: Bump del Service Worker**

Run: `node scripts/bump-sw.js`

- [ ] **Step 2: Commit del bump**

```bash
git add sw.js
git commit -m "chore(sw): bump tras PDF server-side"
```

- [ ] **Step 3: Push**

```bash
git push
```

- [ ] **Step 4: Deploy de Functions (requerido — la Function no existe en producción hasta este paso)**

Run: `npm run deploy:functions`

Nota: esto también corre `security:preflight` (ya en el script `deploy:functions` del `package.json` raíz). Confirmar que pasa antes de que el deploy real ocurra.
