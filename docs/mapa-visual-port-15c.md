# Mapa visual port 15C

Fecha: 2026-05-07

## Resultado

`/app/mapa` deja de considerarse visualmente completo por fases previas y se corrige como **OFICIAL_OPERATIVA_COMPLETA_P1_VISUAL_15C**.

## Problema corregido

- La composición anterior seguía pareciendo una vista de cards.
- El canvas quedaba comprimido por el panel lateral.
- La jerarquía visual no se parecía al mapa legacy real.
- El fondo/curva/óvalo visual se elimina mediante override scoped: `::before`/`::after` en raíz/canvas quedan desactivados.

## Cambios visuales

- Fondo oscuro operativo para toda la vista.
- Header, toolbar y filtros más compactos.
- Métricas superiores integradas y densas.
- Canvas dominante con patio oscuro.
- Celdas compactas tipo cajón, sin aspecto de card.
- Unidades compactas con MVA fuerte, color por estado, gasolina mini y badges.
- Panel detalle lateral oscuro, integrado y sin aplastar el canvas.

## Runtime conservado

- `data-drop-cell`, `data-cell-type`, `data-cell-id`, `data-position`, `data-zone`, `data-zone-label`.
- `data-dnd-unit`, `data-unit-id`, `data-mva`, `data-current-cell`, `data-current-position`.
- DnD con flags, sin persistencia por defecto.
- Incidencias summary.
- Acciones operativas.
- Búsqueda global y `/app/mapa?q=MVA`.
- Fallback `/mapa?legacy=1`.

## Pendiente visual

- Validación manual autenticada con plaza real.
- Ajustes finos por plaza si la estructura legacy usa zonas/decor muy específicos.
- Zoom/pan/editor siguen en módulo clásico.
