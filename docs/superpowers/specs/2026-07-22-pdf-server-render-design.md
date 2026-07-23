# Diseño: PDF generado server-side + guardado en Cloudinary

> **Fecha:** 2026-07-22
> **Estado:** diseño aprobado — pendiente de plan de implementación
> **Origen:** bug reportado — `abrirReporteImpresion` (cuadre) abre un popup en blanco ("popup bloqueado") en vez de producir un PDF descargable
> **Alcance:** Cloud Function genérica HTML→PDF→Cloudinary, cableada a cuadre de flota y papeletas

---

## 0. Qué está roto y por qué

`js/core/cuadre-pdf.js` (`abrirReporteImpresion`) y `js/app/features/papeletas/papeletas-pdf.js` (`openPapeletaPdf`) hacen lo mismo: abren una ventana en blanco (`window.open('', '_blank')`), le escriben un HTML armado a mano, y llaman a `window.print()` esperando que el usuario elija "Guardar como PDF" en el diálogo nativo del navegador.

Esto nunca generó un archivo real:
- No hay ningún PDF binario en ningún momento — solo existe si el usuario completa el diálogo de impresión a mano.
- El campo `papeletas/{id}.pdfUrl` existe en el esquema pero **nunca se llena** — código muerto.
- "Ver PDF" en historial no abre nada guardado: vuelve a regenerar el HTML y a intentar imprimir, cada vez.
- El popup en sí es frágil: bloqueadores de popup, temporización del `document.write`, o que el usuario cierre la pestaña antes del render, dejan la pantalla en blanco reportada hoy.

No hay ninguna librería de HTML→PDF instalada en el proyecto (ni cliente ni servidor) — por eso nunca hubo un binario real que subir.

---

## 1. Arquitectura

```
Cliente arma el HTML (ya existe: generarHtmlAuditoriaCuadrePdf / openPapeletaPdf)
  → Cloud Function callable "generarYSubirPdf"
      → Puppeteer (puppeteer-core + @sparticuz/chromium) renderiza el HTML → buffer PDF
      → Cloudinary SDK (server-side, ya configurado) sube el buffer como resource_type: raw
      → si viene { kind, docId } → escribe la URL en el doc de Firestore correspondiente
  → Cliente recibe { url } → abre esa URL real en pestaña nueva (o la deja lista en historial)
```

No se reescribe la generación de HTML — `generarHtmlAuditoriaCuadrePdf` (cuadre-pdf.js) y el HTML que arma `openPapeletaPdf` (papeletas-pdf.js) se reutilizan tal cual como input de la Function. Solo cambia el paso final: en vez de "imprimir", se "renderiza y sube".

### Por qué Puppeteer server-side (y no jsPDF/html2canvas en cliente)

El usuario pidió explícitamente renderizado server-side: resultado visual idéntico entre dispositivos (el HTML ya trae `@page { size: A4 landscape }` pensado para impresión real), sin depender de la fidelidad de un canvas renderizado en el navegador del usuario, y sin pelear con Safari/iOS donde `html2canvas` suele fallar con `object-fit`, gradientes o fuentes web.

---

## 2. Cloud Function: `generarYSubirPdf`

```js
exports.generarYSubirPdf = functions
  .region(REGION)
  .runWith({ secrets: CLOUDINARY_SECRETS, timeoutSeconds: 60, memory: '1GB' })
  .https.onCall(async (data, context) => {
    await findUserProfileFromAuth(context.auth);   // mismo guard que el resto de Cloudinary functions
    const { kind, docId, html, filename } = data;
    // ...
  });
```

- **Auth:** igual que `getCloudinaryUploadSignature` — requiere perfil válido (`findUserProfileFromAuth`), sin gate de permiso adicional en la Function (la UI ya gatea quién puede llegar a "cerrar cuadre" / "finalizar papeleta"; la Function solo verifica que hay sesión).
- **`kind` es un enum cerrado (`'cuadre' | 'papeleta'`), no un `docPath` libre.** El cliente nunca manda una ruta de Firestore arbitraria — eso sería una escritura no acotada. La Function mapea internamente:

  | kind | Colección | Campo | Folder Cloudinary |
  |---|---|---|---|
  | `cuadre` | `historial_cuadres` | `pdfUrl` | `mapgestion/prod/reportes_cuadre` |
  | `papeleta` | `papeletas` | `pdfUrl` | `mapgestion/prod/reportes_papeletas` |

  `docId` se usa con `db.collection(COLECCION_DE(kind)).doc(docId).update({ pdfUrl, pdfGeneradoEn: FieldValue.serverTimestamp() })` — nunca como parte de un path armado desde texto libre fuera de esas dos colecciones fijas.
- **Render:**
  ```js
  const chromium = require('@sparticuz/chromium');
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdfBuffer = await page.pdf({ format: 'A4', landscape: true, printBackground: true });
  await browser.close();
  ```
- **Subida:** `cloudinary.uploader.upload_stream({ resource_type: 'raw', folder, public_id: filename, use_filename: true, unique_filename: false }, ...)` con el mismo `getCloudinarySdk()`/`sanitizeCloudinaryFolder()` ya existentes — nada nuevo que auditar en credenciales.
- **`filename`:** el cliente manda `buildExportFilename('pdf')` (ya existe en `export-signing.js`, produce `NOMBRE_USUARIO_FECHA_NOMBREEMPRESA.pdf`) — así el archivo en Cloudinary y lo que descarga el usuario ya cumple la regla de oro de exportación sin trabajo extra.
- **Respuesta:** `{ url }` (URL pública de Cloudinary, `resource_type=raw`, con el nombre firmado).

### Dependencias nuevas (`functions/package.json`)

```json
"puppeteer-core": "^23.x",
"@sparticuz/chromium": "^131.x"
```
(`@sparticuz/chromium` es el binario de Chromium empaquetado para entornos serverless — evita cargar un Chrome completo de ~300MB en el bundle de deploy.)

---

## 3. Cliente

Nuevo módulo compartido `js/core/pdf-export.js`:

```js
export async function generarYAbrirPdf(html, { kind, docId, onStatus } = {}) {
  onStatus?.('generando');
  const filename = buildExportFilename('pdf');
  const { data } = await functions.httpsCallable('generarYSubirPdf')({ kind, docId, html, filename });
  onStatus?.('listo');
  return data.url; // el caller decide: abrir, o solo guardar/refrescar historial
}
```

- `abrirReporteImpresion` (cuadre-pdf.js) y `openPapeletaPdf` (papeletas-pdf.js) dejan de hacer `window.open('', '_blank') + print()`. Llaman a `generarYAbrirPdf(html, { kind, docId })` y, al resolver, `window.open(url, '_blank')` — esta vez con una URL real de Cloudinary, navegación normal, sin el patrón de escritura-en-ventana-vacía que dispara bloqueadores de popup.
- **UX de espera:** Puppeteer + upload puede tardar 3–15s (más en cold start). Mientras tanto se muestra un toast/spinner "Generando PDF…" (ya existe el patrón de toast en ambas vistas). No hay indicación visual hoy de esa espera — es la causa real de que el usuario vea "nada pasa" antes del popup en blanco.
- **Historial:** si `item.pdfUrl` ya existe, el botón "Ver PDF" abre esa URL directo (instantáneo, sin volver a llamar la Function). Si no existe (cierres previos a este cambio), cae al flujo de generar-y-guardar de arriba.

---

## 4. Casos borde

- **Timeout de Puppeteer / cold start lento:** `timeoutSeconds: 60` da margen; si aun así falla, la Function retorna error y el cliente muestra "No se pudo generar el PDF, intenta de nuevo" — sin reintento automático (ponytail: no hay necesidad de una cola/retry hasta que se demuestre que falla seguido).
- **Cloudinary sube bien pero falla el `update` de Firestore:** el PDF ya existe en Cloudinary (no se pierde el render), pero el doc no queda enlazado. Se loggea el error server-side (`recordProgrammerError`, mismo patrón que el resto de Functions); el usuario puede reintentar y se sobreescribe el mismo `public_id` (mismo `filename` para el mismo cierre).
- **Cierres/papeletas históricos sin `pdfUrl`:** no se migra en batch — se genera on-demand la primera vez que alguien abre ese registro en historial, y desde ahí queda guardado.
- **PDF grande (muchas unidades / muchas fotos en papeleta):** el HTML ya está acotado a texto + estilos (sin imágenes pesadas embebidas más allá de firmas/logo, que ya son dataURL pequeños); no se anticipa un límite real de tamaño de Cloudinary raw (10MB+ en el plan actual) para este caso de uso.
- **Costo/cold start de Puppeteer:** Cloud Functions con Puppeteer son más caras que una function ligera (memoria 1GB + duración). Se acepta para este volumen (cierres de cuadre y papeletas finalizadas, no un endpoint de alto tráfico); si el volumen crece, la optimización futura es mantener la instancia "warm" (`minInstances`), no rediseñar el flujo.
- **Excel (.xls):** el usuario mencionó también `.xls` en el mensaje original, pero eso corre por un camino totalmente distinto (no pasa por HTML/Puppeteer). Queda **fuera de alcance** de este spec — si hace falta, es una spec separada.

---

## 5. Fases de implementación

1. **Function base:** `generarYSubirPdf` con `kind: 'cuadre'` únicamente + `js/core/pdf-export.js` + cablear `abrirReporteImpresion` en `cuadre-pdf.js`. Entregable: cerrar un cuadre produce un PDF real descargable, sin popup.
2. **Papeletas:** agregar `kind: 'papeleta'` a la Function (ya genérica, solo se agrega el mapeo) + cablear `openPapeletaPdf`.
3. **Historial:** botón "Ver PDF" en ambos historiales lee `pdfUrl` primero antes de regenerar.

Cada fase es un PR vertical y probable (no se hace todo en un commit).
