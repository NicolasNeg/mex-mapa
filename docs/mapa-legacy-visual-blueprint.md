# Blueprint visual legacy `/mapa` → App Shell `/app/mapa`

Fecha: 2026-05-06 · FASE 14G · Estado: **P0 visual implementado en App Shell**

## 1. Resumen visual del `/mapa` legacy

El `/mapa` legacy funciona como patio operativo: un lienzo oscuro con cajones tipo estacionamiento, autos/tarjetas de unidad compactas, estados por color, buckets laterales para limbo/taller/sin ubicación, toolbar operativa y paneles/modalidad de detalle. La App Shell conserva el runtime moderno, plaza global, filtros, incidencias, acciones 14F y DnD; 14G solo porta el lenguaje visual P0.

## 2. Estructura DOM principal legacy

- `mapa.html` carga el shell legacy propio, topbar/sidebar legacy y el contenedor del mapa.
- `js/views/mapa.js` pinta el mapa con elementos tipo `.map-grid`, `.mapa-canvas-libre`, `.spot`, `.area`, `.car` y paneles asociados.
- El App Shell no debe copiar header/sidebar/topbar legacy; solo adopta el lienzo/celdas/unidades/panel detalle de forma scopeada.

## 3. Contenedor/canvas/grid legacy

Legacy usa un fondo de patio oscuro, scroll interno y distribución por cajones/celdas. La App ahora adapta `.app-mapa-canvas`, `.app-mapa-canvas-viewport` y `.app-mapa-canvas-inner` con fondo asfalto, textura leve, cajones más espaciados y min-width navegable.

## 4. Cajones/celdas

Legacy representa cajones como `.spot` con bordes superiores/laterales, etiqueta corta y auto dentro. La App conserva `data-drop-cell`, `data-cell-type`, `data-cell-id`, `data-position`, `data-zone` y `data-zone-label`, pero estiliza `.app-mapa-slot` como cajón legacy.

## 5. Labels/caminos/decor

Legacy separa etiquetas/caminos/decoración del mapa. La App mantiene `.app-mapa-row-label` y `.app-mapa-row-decor` como elementos no drop-target: se ven como señalética/camino, pero no se tratan como cajones.

## 6. Unidad

Legacy usa `.car` con MVA prominente, estado por color y datos secundarios. La App conserva `data-dnd-unit`, `data-unit-id`, `data-mva`, `data-current-cell`, `data-current-position`, y agrega visual P0: MVA central, estado sobre la tarjeta, modelo/placas y barra de gasolina.

## 7. Clases visuales legacy relevantes

- `.map-grid`, `.mapa-canvas-libre`: canvas principal.
- `.spot`, `.spot label`: cajón/celda.
- `.area`: labels/decor/caminos.
- `.car`: unidad.
- `.listo`, `.sucio`, `.mantenimiento`, `.traslado`: estados visuales.
- `#unidades-limbo .car`, `#unidades-taller .car`: buckets fuera de cajón.

## 8. Colores por estado/categoría/ubicación

El port P0 replica la intención, no los selectores globales: listo en teal/verde, sucio en ámbar, mantenimiento/taller en rojo, traslado en morado, no arrendable/retenida/venta en slate. Gasolina usa barra verde/ámbar/roja por nivel.

## 9. Badges/indicadores legacy

Se mantienen badges de incidencias 14B, indicador crítico y chip de estado. No se agregan contadores nuevos ni listeners nuevos.

## 10. Toolbar/controles superiores legacy

La toolbar App se acerca al legacy con superficie blanca, sombra suave y botones compactos. Se conservan filtros actuales, refrescar y abrir legacy. No se crea buscador local duplicado; la búsqueda global App sigue siendo la fuente.

## 11. Paneles/overlays legacy

El panel detalle App adopta encabezado oscuro con MVA grande, posición/celda, ubicación, estado, gas/notas, incidencias, acciones operativas 14F y CTAs a incidencias, cuadre y mapa legacy. Modales complejos legacy quedan fuera de P0.

## 12. Estados limbo/taller/sin ubicación

Los buckets App se estilizan como listas legacy, con taller destacado en ámbar. Siguen siendo buckets separados y no reemplazan la lógica de ubicación.

## 13. Responsive legacy

El canvas mantiene scroll horizontal controlado en móvil, filtros/toolbar compactos y tarjetas legibles en 390px, 430px, 768px y desktop. El App Shell conserva su header y layout.

## 14. Qué NO se debe portar

- Sidebar legacy.
- Header legacy.
- Topbar global.
- Auth UI.
- Offsets del shell viejo.
- Estilos `body/html` globales.
- Reglas globales de `button`, `table`, `.sidebar` o `.topbar`.

## 15. Mapping visual

| Legacy visual element | Selector/clase legacy | Equivalente App actual | Acción |
|---|---|---|---|
| Canvas oscuro patio | `.map-grid`, `.mapa-canvas-libre` | `.app-mapa-canvas`, `.app-mapa-canvas-viewport` | PORTAR |
| Cajón de estacionamiento | `.spot` | `.app-mapa-slot[data-drop-cell]` | PORTAR |
| Etiqueta de cajón | `.spot label` | `.app-mapa-slot-label` | ADAPTAR |
| Camino/decor | `.area` | `.app-mapa-row-label`, `.app-mapa-row-decor` | ADAPTAR |
| Unidad | `.car` | `.app-mapa-unit[data-dnd-unit]` | PORTAR |
| Estado unidad | `.listo`, `.sucio`, `.mantenimiento`, `.traslado` | `.app-mapa-unit.is-*`, `.app-mapa-unit-state.is-*` | ADAPTAR |
| Gasolina | bloque gas legacy | `.app-mapa-gas` | ADAPTAR |
| Limbo/taller | `#unidades-limbo`, `#unidades-taller` | `.app-mapa-bucket--limbo`, `.app-mapa-bucket--taller` | PORTAR |
| Toolbar legacy | controles superiores mapa | `.app-mapa-toolbar`, `.app-mapa-controls` | ADAPTAR |
| Panel info | panel/modal unidad legacy | `.app-mapa-detail` | ADAPTAR |
| Radar/chat/editor/PDF | módulos legacy acoplados | Sin equivalente App P0 | QUEDA LEGACY |
| Header/sidebar/topbar | shell legacy | App Shell existente | OMITIR |

## 16. CSS extraction plan

- Reglas copiables scopeadas: canvas oscuro, cajón con bordes, unidad por estado, buckets limbo/taller, panel detalle.
- Reglas a renombrar: `.spot` → `.app-mapa-slot`, `.car` → `.app-mapa-unit`, estados → `.is-*`.
- Reglas peligrosas no copiadas: `body/html`, `.sidebar`, `.topbar`, IDs legacy globales, offsets del shell viejo, estilos globales de botones/tablas.
- Variables/colores útiles: teal listo, ámbar sucio, rojo mantenimiento, morado traslado, slate retenida/venta.
- Responsive: mantener scroll del canvas en móvil y no colapsar filtros.
- Z-index/modales: no portar z-index legacy alto; App Shell mantiene jerarquía.
- Hover/drag states: conservar `.app-mapa-drop-hover`, `.app-mapa-drop-invalid`, `.is-drag-origin`.

## 17. Riesgos

- CSS global rompiendo App Shell: mitigado con scope `.app-mapa-*` y `section.app-mapa-view`.
- IDs duplicados: no se copiaron IDs legacy.
- DnD dependiendo del DOM: se preservaron data attributes y targets.
- `innerHTML` rebuild: sigue como P1 conocido en plazas grandes.
- Performance en plazas grandes: P1/P2 pendiente de optimización.
- Touch DnD: sigue P2.
- Z-index: no se portaron overlays altos legacy.
- Dependencia topbar/sidebar legacy: omitida.

## 18. Prioridades

P0 visual implementado:
- Canvas/grid.
- Celdas/cajones.
- Unidades.
- Toolbar.
- Panel detalle.

P1 visual pendiente:
- Overlays.
- Badges finos adicionales.
- Responsive fino por dispositivos reales.
- Estados visuales avanzados.

P2 visual pendiente:
- Modales complejos.
- Zoom/pan.
- Editor.
- Radar/chat completo.

## Estado final 14G

`/app/mapa` queda como **BETA_OPERATIVA_FUERTE + LEGACY_VISUAL_PORT_P0**. `/mapa` queda como **KEEP_LEGACY_BACKUP** y **NO redirige**.
