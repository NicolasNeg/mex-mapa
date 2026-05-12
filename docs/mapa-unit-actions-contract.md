# Contrato de integración — `mapa-unit-actions` (14F-B)

Estado en esta fase: **integración UI activa con import dinámico seguro** en `/app/mapa`.

## Contexto

- La vista `js/app/views/mapa.js` intenta cargar `import('/js/app/features/mapa/mapa-unit-actions.js')`.
- Si el módulo existe y expone factory compatible, habilita evaluación de acciones por unidad.
- Si no existe o falla, el mapa mantiene operación normal (read-only + DnD existente) y las mutaciones quedan bloqueadas con mensaje de permisos/API.

## Contrato esperado (compatibilidad tolerante)

El integrador intenta usar alguno de estos factories:

- `createMapaUnitActionsController(options)`
- `createUnitActionsController(options)`
- `createController(options)`

`options` entregados:

- `api` (`window.api`)
- `db` (`window._db` o `window.firebase.firestore()`)
- `getState`
- `getCurrentPlaza()`
- `getCurrentUser()`
- `profile()`
- `debug`

Métodos esperados del controller:

- `getAvailableActions(unit, context)` → `ActionDef[]`
- `validateUnitAction(action, unit, payload, context)`
- `executeUnitAction(action, unit, payload, context)`
- `cleanup()`

La reconciliación 14F.1-A confirma que el módulo exporta los tres aliases de factory anteriores, mantiene `createMapaUnitActionsController` como API principal y añade `resolveAvailableActions` como alias seguro de `getAvailableActions` para no romper integraciones tolerantes.

## `ActionDef` esperado

```js
{
  action: string, // id lógico
  label?: string,
  available: boolean,
  mutates?: boolean,
  blocked?: boolean,
  reason?: string,
  requiresConfirmation?: boolean
}
```

## UI en `/app/mapa` (14F-B)

- **Acciones rápidas** (siempre activas): copiar MVA, copiar JSON técnico, crear/ver incidencias, abrir cuadre, editar/eliminar unidad si rol autorizado y refrescar.
- **Acciones seguras**: renderizadas desde `getAvailableActions`; solo mutantes disponibles se muestran como botones ejecutables.
- **No disponibles para esta sesión**: mostradas por permiso/API faltante.
- Acciones mutantes usan confirmación/modal, `validateUnitAction(...)` y `executeUnitAction(...)`; muestran mensaje de éxito/error en hint y forzan resync si aplica.

## Restricciones preservadas

- No se tocó login/auth/functions/rules.
- `/mapa` intacto como fallback técnico.
- Sin cambios en permisos DnD ni activación persistente por defecto.

## Auditoría de acciones 14F.1-A

| Acción | API legacy | Estado |
|--------|------------|--------|
| `update_status` | `api.aplicarEstado` | Disponible si hay plaza, MVA, usuario, rol autorizado, API y confirmación |
| `update_notes` | `api.aplicarEstado` | Disponible con las mismas validaciones |
| `update_gas` | `api.aplicarEstado` | Disponible con las mismas validaciones |
| `mark_ready` | `api.aplicarEstado` con estado `LISTO` | Disponible con las mismas validaciones |
| `refresh_unit` | `api.obtenerDatosFlotaConsola` | Lectura puntual, sin listener |
| `persist_position` | `persistUnitMove` / `api.guardarNuevasPosiciones` | Delegado al contrato DnD/persist existente |
| `create_incident_link_only` | Link a `/app/incidencias?mva=` | Link-only, sin escritura |
| `open_legacy` | Link a `/mapa` | Fallback técnico |
| `copy_json` | Local | Sin escritura |
| `send_to_preparacion` | Sin API operativa segura detectada | Unavailable / `NO_SAFE_API` |

15H agrega herramientas oficiales en `mapa-official-tools.js` para eliminar unidad, altas, masivos, reportes/PDF y editar estructura/mapa_config con roles autorizados.
