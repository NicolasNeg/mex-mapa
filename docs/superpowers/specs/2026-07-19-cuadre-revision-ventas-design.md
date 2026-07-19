# Diseño: Revisión y firma de Ventas para Cuadre de Flota

> **Fecha:** 2026-07-19
> **Alcance:** Nueva vista SPA para que Ventas revise, corrija y firme el cierre del cuadre enviado por el auxiliar — reemplaza visualmente el paso "Revisión de Ventas / Firma de Ventas" que hoy vive dentro del modal legacy de `js/views/mapa.js`.
> **Fuente Obsidian:** `MapGestion/ARREGLAR DISEÑO DE CUADRAR FLOTA POR ADMIN.md`
> **Referencias visuales:** `Pasted image 20260719151750.png` (lista de revisión), `Pasted image 20260719151823.png` (paso de firma)
> **Approach:** Vista y ruta nuevas e independientes (no se toca la arquitectura de `cuadrarflota.js`, que sigue siendo solo el flujo del auxiliar). El único cambio a código legacy es agregar un link de salida desde "Historial de Cuadre".
> **Estado:** diseño, pendiente de plan de implementación

## 1. Decisiones aprobadas

| Tema | Decisión |
|---|---|
| Arquitectura | Vista nueva `js/app/views/cuadrarflota-ventas.js`, ruta `/app/cuadrarflota/ventas?missionId=X`, separada de `cuadrarflota.js` |
| Estilo visual | Reutiliza el lenguaje visual ya establecido en `cuadrarflota.js` (clases `.cf-*`, tokens `--cf-accent/--cf-ok/--cf-bad/--cf-warn`, ya compatible con dark mode) — nueva hoja `css/app-cuadrarflota-ventas.css` con clases `.cfv-*` que heredan esos tokens. Cero cards azules, cero íconos de escudo decorativos, tema industrial minimalista (ESTILO.md) |
| Corrección por unidad | Ventas **sí puede** marcar OK/Faltante por unidad, igual que el auxiliar (no es solo lectura) |
| Unidad extra | Ventas **sí puede** agregar una unidad extra (mismo formulario MVA/modelo/placas/gasolina que usa el auxiliar) |
| Firma | Pantalla completa (no modal encajado) — elimina el bug del botón "Firmar y cerrar" fuera de vista |
| Nombre del firmante | Campo de solo lectura, tomado de la sesión activa (no un input editable) |
| Entrada a la vista | Botón "Revisar y firmar" agregado al tab "Historial de Cuadre" existente (legacy, `mapa.js`), que navega a la ruta nueva con el `missionId`. No se construye un listado propio de misiones pendientes |
| Toast | Reutiliza `_toast()` que ya existe en `cuadrarflota.js` (estilo plano, abajo-derecha) |

## 2. Estado actual (lo que ya existe y se reutiliza)

El backend de este flujo **ya está completo** — no hace falta tocar Cloud Functions ni el modelo de datos:

- `obtenerRevisionAuditoria(plaza)` (`api/cuadre.js:871`) — lee `datosAuditoria` (el envío del auxiliar) desde el documento de configuración de la plaza y devuelve la lista de unidades + `meta` (missionId, auxiliarNombre, auxiliarDocId, firma del auxiliar). **Falta exportarla en `js/core/database.js`** (1 línea, sigue el patrón de las demás).
- `guardarAuditoriaCruzada(datosAuditoria, autor, plaza)` (`api/cuadre.js:890`, ya exportada) — persiste correcciones intermedias si se necesitara guardar antes de firmar (opcional, ver §5).
- `procesarAuditoriaDesdeAdmin(auditList, autorAdmin, stats, plaza, meta)` (`api/cuadre.js:998`, ya exportada) — es la función real de **cierre**: recibe la lista final de unidades, las estadísticas y un `meta` con `missionId, auxiliarNombre, auxiliarDocId, firmaAuxiliar, firmaAuxiliarUrl, firmaVentas, firmaNombre, firmaDataUrl, stats`. Al tener éxito, el flujo legacy también abre un reporte imprimible (`generarHtmlAuditoriaCuadrePdf`) — ver §5 sobre si se preserva.
- El estado `cuadreRevisionEstado: "PENDIENTE_VENTAS"` (escrito por `enviarAuditoriaAVentas`) es la señal de que hay una misión esperando revisión de Ventas en esa plaza.

El único código que cambia:
- **Nuevo:** `js/app/views/cuadrarflota-ventas.js`, `css/app-cuadrarflota-ventas.css`, entrada en `ROUTE_TABLE`/`ROUTE_MAP`.
- **Modificado (mínimo):** el tab "Historial de Cuadre" en `js/views/mapa.js` gana un botón que arma la URL `/app/cuadrarflota/ventas?missionId=...` y navega ahí en vez de abrir el modal `audit-modal` en modo `sales`.
- **Sin tocar:** `cuadrarflota.js` (flujo del auxiliar), Cloud Functions, reglas de Firestore.

## 3. Paso "review" — lista de unidades

Header con eyebrow + título (mismo patrón `.cf-head`/`.cf-eyebrow` de `cuadrarflota.js`), sin gradiente azul ni ícono de escudo. Barra de progreso/estadísticas: OK / Faltantes / Extras (reusa `.cf-ring` o una fila de stats simple, a definir en el plan según cuál se vea mejor con esta cantidad de datos).

- Barra de búsqueda por MVA/placa/modelo (mismo comportamiento que en la vista del auxiliar).
- Tarjetas por unidad con MVA, modelo, placas, chips de estado (categoría, ubicación) y dos botones (✓ presente / ✕ faltante) que Ventas puede tocar para corregir lo que marcó el auxiliar. Estado inicial de cada unidad = lo que vino en `obtenerRevisionAuditoria`.
- Botón "+ Añadir unidad extra" → mismo formulario que ya existe en `cuadrarflota.js` (MVA, modelo, placas, km, gasolina), agregando la unidad a la lista local con estatus EXTRA.
- Botón primario "Firmar y cerrar cuadre" → pasa al paso "sign". Deshabilitado si `total === 0`.

Todas las correcciones viven en estado local de la vista (mismo patrón que `_s.localByMva` en `cuadrarflota.js`) hasta el cierre final — no se escribe a Firestore unidad por unidad.

## 4. Paso "sign" — firma en pantalla completa

Toma control de toda la pantalla (`position: fixed; inset: 0`), no un modal centrado con scroll interno — así el botón de cierre **siempre** es visible sin depender de la altura del contenido.

- Resumen compacto arriba: OK / Faltantes / Extras + "Recibido de {auxiliarNombre} · Misión {missionId}" (de solo lectura, viene de `meta`).
- Campo "Firmado por": **texto estático**, no `<input>`, con el nombre de la sesión activa (`getState().profile.nombre` o equivalente — se resuelve el campo exacto en el plan).
- Canvas de firma + botón "Limpiar firma".
- Botón primario "Firmar y cerrar cuadre" — valida que haya tinta, llama `procesarAuditoriaDesdeAdmin(...)` con la lista final corregida + meta (incluyendo `firmaDataUrl` del canvas y `firmaVentas`/`firmaNombre` = nombre de sesión), muestra toast de éxito/error, y al éxito navega de regreso (a Historial de Cuadre o al home — a definir en el plan) en vez de dejar la vista en un estado intermedio.
- Botón "Volver" (no "Esc misterioso") para regresar al paso "review" sin perder las correcciones locales.

## 5. Fuera de alcance

- Rediseñar `cuadrarflota.js` (flujo del auxiliar) — no se toca.
- Cambiar el modelo de datos o Cloud Functions del cuadre.
- Construir un listado propio de "misiones pendientes de Ventas" — se entra vía el link desde Historial de Cuadre existente.
- Decidir si se preserva la apertura automática del reporte imprimible (`generarHtmlAuditoriaCuadrePdf`) al cerrar — se detalla y decide en el plan de implementación, no bloquea el diseño.
- Guardar correcciones intermedias en Firestore antes del cierre final (`guardarAuditoriaCruzada` queda disponible si se decide necesario, pero el diseño base no lo requiere).
- Multi-idioma, accesibilidad avanzada más allá de lo que ya sigue `cuadrarflota.js`.

## 6. Verificación

1. Desde Historial de Cuadre, con una misión en estado `PENDIENTE_VENTAS`, el botón nuevo navega a `/app/cuadrarflota/ventas?missionId=X` y carga la lista correcta de unidades.
2. Marcar una unidad como faltante y volver a OK se refleja en las stats sin escribir a Firestore hasta firmar.
3. Agregar una unidad extra aparece en la lista y en el conteo de "Extras".
4. El botón "Firmar y cerrar cuadre" es visible sin scroll en desktop y mobile (pantalla completa).
5. El campo de nombre del firmante no es editable y coincide con el usuario de la sesión.
6. Al firmar sin tinta → error claro, no se llama al backend.
7. Al firmar con éxito → `procesarAuditoriaDesdeAdmin` recibe el payload correcto, la misión se cierra, y la plaza vuelve a estado libre para un nuevo cuadre.
8. `missionId` inexistente, ya cerrado, o usuario sin permiso de Ventas en esa plaza → pantalla de error con botón "Volver", no un formulario a medio cargar.
9. Dark mode: toda la vista usa los tokens `--cf-*` (ya reactivos), sin fondos claros fijos ni texto ilegible.
