# Diseño: Cuadre de flota — nuevos errores (externos, listener, grid Ventas, timers, PDF)

> **Fecha:** 2026-07-22  
> **Alcance:** Correcciones al flujo SPA de Cuadre de flota ya migrado (auxiliar + Ventas + historial).  
> **Fuente Obsidian:** `MapGestion/CUADRE DE FLOTA NUEVOS ERRORES.md`  
> **Referencias visuales:** `Pasted image 20260722144528.png` (externo en patio), `20260722144624.png` (espera Ventas), `20260722144744.png` (lista Ventas), `20260722144835.png` (éxito), `20260722144921.png` (PDF en blanco)  
> **Approach:** Parches locales sobre el código existente (sin unificar auxiliar/ventas ni tocar Cloud Functions).  
> **Estado:** diseño aprobado; pendiente plan de implementación

## 1. Decisiones aprobadas

| Tema | Decisión |
|---|---|
| Arquitectura | Enfoque 1 — parches locales en API flota/cuadre, `cuadre-flota.js`, `cuadrarflota-ventas.js`, `cuadre-pdf.js` |
| Unidades externas | **C)** Filtrar en `obtenerDatosFlotaConsola` **y** guard extra en `iniciarProtocoloDesdeAdmin`; filtrar también al pintar patio/ventas si la misión ya trae externos |
| Criterio “externo” | `tipo === 'externo'` **o** `estado` / `ubicacion` / `categoria` normalizados contienen `EXTERNO` **o** doc originado en `COL.EXTERNOS` |
| Listener Ventas | `onSnapshot` a `settings/{plaza}` mientras `/app/cuadre/flota` esté montada |
| Reacción al envío del auxiliar | **A)** Actualizar in-place la tarjeta a “Lista para revisión” + botón Revisar y firmar; **sin** auto-navegar |
| Vista Ventas | Solo lista tipo **grid 4×4** (sin toggle Tarjeta/Lista) |
| Edición en Ventas | **B)** Puede cambiar Presente/Faltante, gasolina y km; puede agregar sobrante |
| PDF | **B)** Abrir al cerrar el cuadre en Ventas **y** desde Historial → Ver PDF |
| Timer auxiliar | Tras éxito de envío a Ventas: **2 s** → `/app/dashboard` |
| Timer Ventas | Tras cierre exitoso: **3 s** → `/app/cuadre/flota` con tab Historial |
| Fuera de alcance | Unificar vistas auxiliar/ventas; FCM nuevo; mapa legacy; Cloud Functions |

## 2. Problema actual (evidencia en código)

1. **Externos en el cuadre.** `api/flota.js` → `obtenerDatosFlotaConsola` concatena `COL.CUADRE` + `COL.EXTERNOS`. La misión se arma con esa lista (`cuadre-flota.js` → `iniciarProtocoloDesdeAdmin`), por eso aparecen unidades tipo JOELMARES con chip EXTERNO en el pase de lista del auxiliar.
2. **Ventas no se entera al instante.** `cuadre-flota.js` hace un `_checkActiveMission()` puntual en `_load()`; no hay listener. Con la pestaña “Cuadrar flota” abierta en “Misión en patio”, no pasa a “Lista para revisión” hasta recargar.
3. **UI Ventas.** `cuadrarflota-ventas.js` reutiliza tarjeta + lista lineal del auxiliar. El pedido es grid 4×4 con imagen de modelo y status visible, editable.
4. **Post-éxito sin redirect automático.** Pantallas de éxito con botones manuales; faltan timers 2 s / 3 s.
5. **PDF en blanco.** `abrirReporteImpresion` inyecta `#reporte-pdf-container` y usa `@media print { body * { visibility:hidden } }`. En el shell SPA eso deja la hoja vacía. Además `procesarAuditoriaDesdeAdmin` guarda el payload en `jsonCompleto` con `pdfUrl: ""`, y `_historialCuadrePayload` intenta parsear `pdfUrl` primero — Historial no reconstruye el reporte.

## 3. Arquitectura de cambios

| Archivo | Cambio |
|---|---|
| `api/flota.js` | `obtenerDatosFlotaConsola`: solo `COL.CUADRE` (ya no lee `EXTERNOS`) |
| `api/cuadre.js` | Helper `_esUnidadExterna(u)`; en `iniciarProtocoloDesdeAdmin` filtrar antes de persistir; si el array queda vacío → retorno de error (no crear misión) |
| `js/app/views/cuadre-flota.js` | `onSnapshot` settings plaza; transición de UI por `estadoCuadreV3`; cleanup en `unmount` |
| `js/app/views/cuadrarflota.js` | Filtrar externos al construir `_s.units`; timer 2 s → dashboard en pantalla de éxito |
| `js/app/views/cuadrarflota-ventas.js` | Vista fija grid 4×4 editable; filtrar externos; al cerrar abrir PDF; timer 3 s → historial |
| `css/app-cuadrarflota.css` | Estilos `.cfv-grid` 4/2/1 columnas; celda con imagen + badge + campos + acciones (misma hoja que ya carga la ruta ventas) |
| `js/core/cuadre-pdf.js` | Print-safe: contenido imprimible sin depender de ocultar todo el `body` con `visibility` |
| `js/app/views/cuadre-flota.js` (historial) | `_historialCuadrePayload` lee `jsonCompleto` (y meta/unidades) antes que `pdfUrl` vacío |

Sin cambios a Cloud Functions, reglas Firestore, ni `ROUTE_TABLE` (rutas ya existen).

## 4. Flujo de datos y listener

### 4.1 Exclusión de externos

Orden de defensa:

1. **Fuente:** `obtenerDatosFlotaConsola(plaza)` → solo documentos de `COL.CUADRE` filtrados por plaza.
2. **Envío de misión:** `iniciarProtocoloDesdeAdmin` aplica `_esUnidadExterna` al array parseado; unidades descartadas no se persisten en `misionAuditoria`. Si tras el filtro `unidades.length === 0`, devolver `{ exito: false, error: 'No hay unidades de patio para el cuadre' }` y **no** poner `estadoCuadreV3: PROCESO`. El caller en `cuadre-flota.js` muestra el `error` en toast.
3. **Carga UI:** en auxiliar y Ventas, al mapear unidades de la misión, omitir las que aún cumplan `_esUnidadExterna` (misiones antiguas).

`_esUnidadExterna(u)`:

```
tipo === 'externo'
OR upper(estado|ubicacion|categoria) includes 'EXTERNO'
```

### 4.2 Listener en `cuadre-flota.js`

- Suscribirse a `db.collection(COL.SETTINGS).doc(plazaDocId)` con `onSnapshot` cuando `_s.canSendMission` y la vista está montada.
- Re-suscribir al cambiar plaza (`onPlazaChange`).
- Mapear `estadoCuadreV3`:
  - `PROCESO` → `_s.mission = { state: 'PROCESO', meta }`
  - `REVISION` → `_s.mission = { state: 'REVISION', meta }` (meta desde `datosAuditoria` / campos `cuadreMissionId`, auxiliar)
  - `LIBRE` / vacío / sin misión → `_s.mission = null` y, si aplica, recargar flota/auxiliares para el formulario de envío
- Repintar solo cuando el `state` efectivo cambie (evitar toasts/spam por cada snapshot de otros campos).
- Unsubscribe en `unmount` y antes de re-suscribir.

Comportamiento al pasar a `REVISION`: actualizar la tarjeta in-place; **no** llamar `_navigate` automáticamente.

## 5. UI Ventas — grid 4×4

Solo `/app/cuadrarflota/ventas`.

- Quitar el toggle Tarjeta/Lista; `_s.view` fijo a grid (o eliminar el modo card).
- Toolbar: búsqueda + **+ Sobrante** + recargar.
- Grid CSS: 4 columnas desktop, 2 tablet, 1 móvil.
- Celda por unidad:
  - Imagen modelo (`_modelImageUrl` / fallback `/img/default_car.png`)
  - Badge Presente / Faltante / Sobrante / Pendiente (mismos tonos `.is-ok` / `.is-missing` / `.is-extra`)
  - MVA, modelo · placas
  - Selects/inputs gasolina + km (misma lógica actual)
  - Botones ✕ / ✓ (toggle de status como hoy)
- Footer isla: “Faltan N…” / Continuar a firma — sin cambio de reglas.
- Paso firma: sin cambio funcional.
- Auxiliar (`cuadrarflota.js`): conserva tarjeta + lista; no adopta el grid 4×4.

## 6. PDF, timers y errores

### 6.1 PDF

1. **Historial:** `_historialCuadrePayload` prioriza `JSON.parse(item.jsonCompleto)` (y `item.meta`/`item.unidades`); `pdfUrl` solo si es JSON válido no vacío.
2. **`abrirReporteImpresion`:** print-safe con documento autocontenido en `window.open` (o iframe blob) que llama a `print()`; dejar de depender de `body * { visibility:hidden }` sobre el shell SPA. El HTML de `generarHtmlAuditoriaCuadrePdf` ya trae estilos propios y `exportFooterHtml` / `buildExportFilename`.
3. **Cierre Ventas:** tras `procesarAuditoriaDesdeAdmin` exitoso, llamar `generarHtmlAuditoriaCuadrePdf` + `abrirReporteImpresion` con unidades/stats/meta del cierre; si print falla → toast de error; el cierre ya quedó persistido.
4. Nombre de descarga / título: política de firma existente (`NOMBRE_USUARIO_FECHA_EMPRESA`).

### 6.2 Timers

| Rol | Disparador | Delay | Destino |
|---|---|---|---|
| Auxiliar | `_s.completed === true` tras enviar a Ventas | 2 s | `/app/dashboard` |
| Ventas | `_s.completed === true` tras cerrar | 3 s | `/app/cuadre/flota` con tab Historial |

- Guardar `timeoutId` en estado de módulo; `clearTimeout` en `unmount`.
- Botones manuales (mapa / ver estado) siguen disponibles; el timer no bloquea interacción.

### 6.3 Errores

- Misión sin unidades de patio → toast/error en UI de envío; no crear misión.
- Fallo de impresión → toast; no revertir cierre.
- Error en `onSnapshot` → log + no tumbar la vista; el load puntual existente sigue como fallback al montar / cambiar plaza.

## 7. Verificación

1. Enviar misión: ninguna unidad con chip/estado EXTERNO aparece en el pase del auxiliar.
2. `obtenerDatosFlotaConsola` no incluye docs de `EXTERNOS`.
3. Intentar enviar solo con externos (o lista filtrada vacía) → error, plaza sigue libre.
4. Ventas en “Cuadrar flota” con “Misión en patio”: al enviar el auxiliar, la tarjeta pasa a “Lista para revisión” sin F5 y sin auto-abrir `/app/cuadrarflota/ventas`.
5. Vista Ventas: grid 4×4 con imagen y badge; se puede cambiar Presente/Faltante y gas/km; se puede agregar sobrante; no hay toggle Tarjeta/Lista.
6. Auxiliar tras enviar: a los ~2 s navega a dashboard.
7. Ventas tras firmar: se abre el diálogo de impresión con contenido visible (no hoja en blanco); a los ~3 s navega a historial de flota.
8. Historial → Ver PDF: abre el mismo reporte con unidades/stats/firmas (desde `jsonCompleto`).
9. Unmount durante el timer: no navega tras abandonar la vista.
10. Dark mode: celdas del grid usan tokens existentes (`.cf*` / variables de tema), legibles.

## 8. Fuera de alcance

- Refactor para compartir un único módulo de revisión auxiliar/ventas.
- Notificaciones push/FCM nuevas para el evento de revisión.
- Cambios al modal legacy de cuadre en `js/views/mapa.js` (salvo que el PDF compartido en `cuadre-pdf.js` beneficie ambos).
- Migrar `obtenerDatosFlotaConsola` a ES modules / `database.js` puro.
- Backfill masivo de misiones históricas en Firestore.
