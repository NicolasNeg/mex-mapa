# Mapa oficial completo P1

Fecha: 2026-05-06 · FASE 15B

## Estado

| Ruta | Estado |
|---|---|
| `/app/mapa` | **OFICIAL_OPERATIVA_COMPLETA_P1** |
| `/mapa` | **CLASSIC_FALLBACK** |
| Redirect `/mapa` → `/app/mapa` | **ACTIVO** |
| Escape clásico | `localStorage["mex.legacy.force"] = "1"` o `/mapa?legacy=1` |

15B completa los flujos operativos principales dentro del App Shell sin migrar funciones peligrosas. El mapa clásico sigue disponible para editor, PDF, reportes, radar/chat completo, altas, eliminación, acciones masivas, cierre formal y edición de `mapa_config`.

## Matriz de flujos

| Flujo | Ya en `/app/mapa` | Falta | API segura | Riesgo | Implementar 15B | Estado |
|---|---|---|---|---|---|---|
| Cambiar estado | Controller `mapa-unit-actions` | QA manual autenticado | `api.aplicarEstado` | Medio | Sí | Implementado con modal oficial |
| Actualizar notas | Controller `mapa-unit-actions` | QA manual autenticado | `api.aplicarEstado` | Medio | Sí | Implementado con modal oficial |
| Actualizar gasolina | Controller `mapa-unit-actions` | QA manual autenticado | `api.aplicarEstado` | Medio | Sí | Implementado con modal oficial |
| Marcar lista/no lista | Controller `mapa-unit-actions` | QA manual autenticado | `api.aplicarEstado` | Medio | Sí | Implementado con modal oficial |
| Crear incidencia rápida desde unidad | Link a incidencias | Adjuntos/resolución desde mapa | `api.guardarNuevaNotaDirecto` | Bajo/Medio | Sí | Modal mínimo implementado |
| Ver mini bitácora por MVA | Resumen `notas_admin` | Detalle completo | `mapa-incidencias-summary` | Bajo | Sí | Implementado hasta 3 items |
| Ver historial básico unidad | No hay API específica clara | Historial profundo | No clara | Medio | No | Mapa clásico / futuro |
| Refrescar unidad | Refrescar mapa | Refresh unitario fino | `resyncData` | Bajo | Sí | Resync claro post-mutación |
| Resync después de mutación | Parcial | QA manual | `resyncData` | Bajo | Sí | Implementado |
| Movimiento DnD | Flags + rol | Touch/swap | `guardarNuevasPosiciones` | Medio | Mantener | Conservado |
| Vista lista operativa | Lista simple | Columnas/acciones | N/A | Bajo | Sí | Reforzada |
| Filtros avanzados | Filtros rápidos | Más combinaciones | N/A | Bajo | P1 futuro | Conservado |
| Mapa clásico para avanzadas | CTA existente | N/A | N/A | Bajo | Sí | Conservado |
| Diagnóstico técnico | Programador/admin | N/A | N/A | Bajo | Sí | Sigue oculto a usuarios normales |
| Permisos por rol | Controller + DnD gates | QA por roles reales | Contrato 14F | Medio | Sí | Conservado |

## Implementado en 15B

- Modales oficiales para `update_status`, `update_notes`, `update_gas` y `mark_ready`, con cancelar sin ejecución, validación del controller, confirmación y mensaje de éxito/error.
- Resync después de mutaciones seguras mediante `resyncData()`.
- Incidencia rápida desde detalle de unidad usando `guardarNuevaNotaDirecto` cuando existe; si la API no está disponible, el flujo abre `/app/incidencias?mva=MVA`.
- Mini bitácora en panel detalle usando el summary existente de `notas_admin`, sin crear listeners por unidad.
- Vista lista operativa con columnas MVA, modelo, placas, estado, gas, ubicación, posición, incidencias y acciones no mutantes.
- Cleanup: al cambiar plaza se cierran modales y se limpia selección; en unmount ya se remueven modales y controllers.

## Mantener en mapa clásico

- Eliminar unidad.
- Alta nueva y altas masivas.
- Cambio masivo.
- PDF/reportes.
- Editor y estructura `mapa_config`.
- Cierre formal.
- Radar/chat completo.
- Historial profundo si no hay API App segura.

## QA pendiente

No se marcan como PASS las pruebas autenticadas no ejecutadas por operador real:

- Cambiar estado, notas, gasolina y lista/no lista en plaza real.
- Crear incidencia rápida y verificar actualización en `/app/incidencias`.
- Movimiento DnD con y sin guardado por rol autorizado.
- Cambio de plaza con modal abierto.
