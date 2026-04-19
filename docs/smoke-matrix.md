# Smoke Matrix Operativa

## Objetivo
- Tener una red mínima de seguridad para refactors pequeños sin suite E2E completa.
- Ejecutar esta lista antes de fusionar cambios en API, mapa, notificaciones, chat o configuración.

## Rutas
- `/login`
  - Carga sin errores.
  - Auth redirige correctamente a la ruta operativa.
- `/mapa`
  - Carga `window.api`, `database.js` y `js/views/mapa.js`.
  - Suscribe estructura y unidades de la plaza actual.
  - Permite buscar, seleccionar, mover y guardar posiciones.
- `/gestion`
  - Abre panel administrativo sin romper bootstrap.
  - Mantiene navegación y auth guard.
- `/cuadre`
  - Carga la vista embebida de flota/cuadre sin errores.
- `/mensajes`
  - Valida auth y monta el iframe hacia `/mapa?messages=1`.
- `/programador`
  - Carga el centro de control con `window.api` disponible.

## Flujos críticos
- Mover unidad entre cajones y guardar.
- Swap entre dos unidades.
- Mover una unidad al limbo.
- Cambiar estado/gasolina/notas.
- Insertar unidad normal.
- Insertar unidad externa.
- Crear, modificar y eliminar registro en Cuadre Admins.
- Crear, resolver y eliminar nota administrativa.
- Crear, editar y borrar alerta.
- Enviar y leer mensajes.
- Abrir historial, logs y auditoría.
- Abrir editor de mapa y guardar estructura.

## Compatibilidad
- Verificar `window.__mexApiDiagnostics.missing.length === 0`.
- Verificar que `window.api.obtenerDiagnosticoCompatibilidad()` responda.
- Confirmar que las páginas que cargan `mex-api.js` también cargan `api/helpers.js`, `api/externos.js` y `api/_assemble.js`.
- Confirmar que `js/core/database.js` siga resolviendo la misma API pública.

## Escenarios legacy
- Docs operativos con y sin `plaza`.
- Estructura legacy sin campos extendidos.
- Registros con `_version` pero sin `version`.
- Evidencias antiguas en formato simple URL/path.
- Extras parciales por unidad.

## Escenarios de conflicto
- Guardado de mapa con `expectedVersion` desfasado.
- Cambio de estado sobre un registro recién tocado por otro usuario.
- Movimiento hacia cajón bloqueado o restringido por categoría.
- Unidad en `TRASLADO` con destino visible.

## Validación de datos
- Revisar consola por warnings de `_assemble`.
- Confirmar que las queries por plaza no mezclen datos de otras plazas.
- Confirmar que el fallback legacy siga funcionando para búsquedas/acciones puntuales.
