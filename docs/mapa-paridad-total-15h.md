# Mapa paridad total 15H

Fecha: 2026-05-07

Estado objetivo:

- `/app/mapa`: `MAPA_COMPLETO_OFICIAL`
- `/mapa`: `FALLBACK_TECNICO` / rollback con `?legacy=1`

## Matriz de paridad

| Función legacy | Archivo | Handler/función | API usada | Existe en `/app/mapa` | Estado | Acción 15H |
|---|---|---|---|---|---|---|
| Render mapa/celdas/unidades | `mapa.html`, `js/views/mapa.js` | render grid / `_actualizarNodoUnidadMapa` | `suscribirMapaPlaza`, `suscribirEstructuraMapa` | Sí | Migrado | Renderer Shell conserva celdas, buckets, unidades y pintura de estados |
| Buscador | `mapa.html`, `js/views/mapa.js` | filtros/búsqueda | Datos locales | Sí | Migrado | `?q=`, input local, scroll y contador |
| Filtros | `mapa.html`, `js/views/mapa.js` | chips/filtros | Datos locales | Sí | Migrado | Listos, no arrendable, mtto/sucio, limbo, taller, incidencias |
| KPIs | `js/views/mapa.js` | `actualizarContadores` | Datos locales | Sí | Migrado | Barra KPI legacy en renderer |
| Cambio plaza | `js/views/mapa.js` | plaza activa | App state + API mapa | Sí | Migrado | `onPlazaChange` resuscribe mapa/incidencias |
| Click unidad | `js/views/mapa.js` | `mostrarDetalles` | Datos locales | Sí | Migrado | Selección y panel detalle |
| Panel detalle | `mapa.html`, `js/views/mapa.js` | panel info | Datos locales | Sí | Migrado | Datos, incidencias, acciones |
| DnD | `js/views/mapa.js` | drag/drop | `guardarNuevasPosiciones` | Sí | Migrado | DnD con permisos, confirmación y resync |
| Guardar posición | `api/cuadre.js` | `guardarNuevasPosiciones` | `guardarNuevasPosiciones` | Sí | Migrado | Persistencia App con validación |
| Cambiar estado | `api/cuadre.js` | `aplicarEstado` | `aplicarEstado` | Sí | Migrado | Modal seguro por unidad |
| Actualizar notas | `api/cuadre.js` | `aplicarEstado` | `aplicarEstado` | Sí | Migrado | Modal seguro por unidad |
| Actualizar gasolina | `api/cuadre.js` | `aplicarEstado` | `aplicarEstado` | Sí | Migrado | Modal seguro por unidad |
| Marcar listo/no listo | `api/cuadre.js` | `aplicarEstado` | `aplicarEstado` | Sí | Migrado | Acción segura de marcar LISTO |
| Crear incidencia | `js/views/mapa.js`, `api/notas.js` | notas admin | `crearNotaAdmin` / Firestore | Sí | Migrado | Incidencia rápida y link a bitácora App |
| Resolver incidencia | `js/views/mapa.js`, `api/notas.js` | resolver nota | Incidencias App | Sí | Migrado | Flujo completo en `/app/incidencias` enlazado por MVA |
| Bitácora/historial | `js/views/mapa.js` | mini historial | `notas_admin` | Sí | Migrado | Mini bitácora + App incidencias |
| Panel de cambios/historial | `js/views/mapa.js`, `api/historial.js` | historial | datos locales/API | Sí | Migrado parcial operativo | Últimos cambios visibles en detalle y DnD |
| Radar | `js/views/mapa.js` | radar state | datos mapa + incidencias | Sí | Migrado | Panel Radar dentro del Shell, sin listeners duplicados |
| Chat integrado | `js/views/mapa.js` | chatv2 | mensajes App | Sí | Migrado por ruta App | Acceso operativo vía `/app/mensajes`, no desde clásico |
| PDF | `mapa.html`, `js/views/mapa.js` | `exportarMapaPDF`, `abrirModalPDFReservas` | impresión/PDF browser | Sí | Migrado | Modal Reportes genera documento imprimible |
| Reportes | `js/views/mapa.js` | reportes/resumen | datos mapa | Sí | Migrado | Reporte resumen/lista desde `/app/mapa` |
| Editor patio/layout | `editmap.html`, `js/views/mapa.js`, `api/mapa.js` | `abrirEditorMapa`, `guardarMapaEditor` | `obtenerEstructuraMapa`, `guardarEstructuraMapa` | Sí | Migrado | Editor JSON controlado de `mapa_config` en Shell con confirmación |
| Editar celdas/mapa_config | `api/mapa.js` | `guardarEstructuraMapa` | `guardarEstructuraMapa` | Sí | Migrado | Reemplazo confirmado de estructura |
| Alta individual | `api/cuadre.js`, `api/externos.js` | `insertarUnidadDesdeHTML`, `insertarUnidadExterna` | mismas APIs | Sí | Migrado | Modal Alta unidad con validación |
| Alta masiva | `js/views/mapa.js` | batch bar/masivo | `insertarUnidadDesdeHTML`, `insertarUnidadExterna` | Sí | Migrado | Preview antes de aplicar |
| Insertar unidad | `api/cuadre.js` | `insertarUnidadDesdeHTML` | misma API | Sí | Migrado | Modal Alta unidad |
| Editar unidad | `api/flota.js` | `actualizarUnidadPlaza` | `actualizarUnidadPlaza` | Sí | Migrado | Botón Editar unidad en detalle/lista |
| Eliminar unidad | `api/flota.js` | `eliminarUnidadPlaza` | `eliminarUnidadPlaza` | Sí | Migrado | Confirmación fuerte por MVA |
| Externos | `api/externos.js` | `insertarUnidadExterna` | `insertarUnidadExterna` | Sí | Migrado | Alta individual/masiva como externo |
| Taller | `js/views/mapa.js` | buckets/estado | datos locales | Sí | Migrado | Filtro, bucket y detalle |
| Limbo/sin ubicación | `js/views/mapa.js` | buckets | datos locales | Sí | Migrado | Filtro, bucket y DnD |
| Solicitudes/alertas relacionadas | `js/views/mapa.js` | alertas/notas | App incidencias/notificaciones | Sí | Migrado operativo | Resumen por incidencias y rutas App |
| Panel flotante de acciones | `mapa.html`, `js/views/mapa.js` | acciones rápidas | APIs mapa/cuadre/flota | Sí | Migrado | Acciones operativas en panel detalle |
| Modales | `mapa.html`, `js/views/mapa.js` | custom modals | varias APIs | Sí | Migrado | Modales App para unidad, incidencia, reportes, radar, editor, masivos |
| Notificaciones mapa | `js/views/mapa.js` | notifications | core notifications | Sí | Migrado operativo | Shell conserva notificaciones globales |

## Permisos por acción

Mutaciones de mapa, unidad, altas, masivos, eliminación y editor requieren `PROGRAMADOR` o perfil `isAdmin=true` con rol global según `permissions.model.js`. Usuarios sin permiso ven consulta, filtros, detalle, incidencias y reportes de lectura.

## Archivos modificados

- `js/app/views/mapa.js`
- `js/app/features/mapa/mapa-renderer.js`
- `js/app/features/mapa/mapa-unit-actions.js`
- `js/app/features/mapa/mapa-official-tools.js`
- `css/app-mapa.css`
- `sw.js`
- `docs/mapa-paridad-total-15h.md`

## Confirmaciones

- Login/auth/functions/rules no se tocaron.
- Legacy no se destruyó.
- `CACHE_NAME`: `mapa-v284`.
- Validación visual autenticada: `VALIDACION_VISUAL_USUARIO_PENDIENTE`.
