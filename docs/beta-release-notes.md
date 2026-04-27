# Notas de release — Beta App Shell (Firebase Hosting)

## Qué incluye la beta actual

- **App Shell** unificado (`/app.html`): sidebar, header, plaza, búsqueda global, notificaciones.
- **Vistas App** funcionales o en modo beta: dashboard, perfil, admin, programador, cola preparación, incidencias, cuadre, mensajes, **mapa App Shell** (`/app/mapa`).
- **Mapa App** con estructura real posición ↔ celda, lectura de datos por plaza, **DnD preview** y **DnD persistencia experimental** detrás de flags (`mex.appMapa.dnd`, `mex.appMapa.dndPersist`), con confirmación y API legacy `guardarNuevasPosiciones` (sin swap automático).
- **Programador**: flags locales, **Beta Readiness**, smoke check de rutas/assets (solo red mismo origen).
- Rutas **legacy** **`/mapa`** y **`mapa.html`** siguen disponibles como referencia operativa completa.

## Qué queda en legacy durante esta beta

- Mapa operativo completo en **`/mapa`** (todas las herramientas y flujos no cubiertos por la vista App).
- Páginas HTML clásicas donde la vista equivalente en App Shell aún no sustituye al legacy.

## Qué es experimental

- DnD en `/app/mapa` (preview / persistencia con flags).
- Paneles de diagnóstico y Beta Readiness en Programador.
- Cualquier UI marcada como «beta» o «experimental» en la app.

## Qué no está soportado en esta beta

- Swap de unidades entre cajones en un solo gesto en App Shell.
- Persistencia DnD táctil.
- Movimientos masivos, edición o eliminación de unidades desde App Mapa, cambio de estado operativo desde esa vista.

## Riesgos actuales

- **Snapshot vs servidor**: puede haber carrera entre validación en cliente y datos en Firestore; la app revalida unidades con `obtenerDatosFlotaConsola` cuando existe, y tras guardar espera reflexión en listener o fuerza **resync** de suscripciones.
- **Consola del navegador**: pueden aparecer avisos no bloqueantes (por ejemplo relacionados con Firebase en cliente).

## Qué se debe probar ahora

Seguir el checklist y los pasos de activación de flags en **`docs/beta-smoke-test.md`**. Incluye login, rutas principales del shell, mapa read-only / preview / persistencia con flags, legacy `/mapa`, viewports, limpieza de datos del sitio y comprobación del Service Worker.

## Pasos de validación actuales

1. Ejecutar el **checklist manual** de `beta-smoke-test.md` en el entorno donde se despliegue la beta.
2. Opcional: en **`/app/programador` → Beta Readiness → Ejecutar smoke check local** para comprobar rutas y assets por HTTP (mismo origen).
3. Con persistencia DnD activa y rol autorizado: confirmar que el movimiento se refleja en UI o tras «Refrescar mapa», y que los datos coinciden con lo esperado en CUADRE/EXTERNOS para la plaza.
