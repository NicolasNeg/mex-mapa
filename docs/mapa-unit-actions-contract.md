# Contrato de integración — `mapa-unit-actions` (14F-B)

Estado en esta fase: **integración UI activa con import dinámico seguro** en `/app/mapa`.

## Contexto

- La vista `js/app/views/mapa.js` intenta cargar `import('/js/app/features/mapa/mapa-unit-actions.js')`.
- Si el módulo existe y expone factory compatible, habilita evaluación de acciones por unidad.
- Si no existe o falla, el mapa mantiene operación normal (read-only + DnD existente) y las mutaciones quedan bloqueadas con fallback a legacy.

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

- **Acciones rápidas** (siempre activas): copiar MVA, copiar JSON, ver incidencias, abrir cuadre, abrir legacy, refrescar.
- **Acciones seguras**: renderizadas desde `getAvailableActions`; solo mutantes disponibles se muestran como botones ejecutables.
- **Bloqueadas/legacy**: mostradas explícitamente en sección “Disponible en legacy”.
- Acciones mutantes usan confirmación/modal, `validateUnitAction(...)` y `executeUnitAction(...)`; muestran mensaje de éxito/error en hint y forzan resync si aplica.

## Restricciones preservadas

- No se tocó login/auth/functions/rules.
- `/mapa` legacy intacto y sin redirect a `/app/mapa`.
- Sin cambios en permisos DnD ni activación persistente por defecto.
