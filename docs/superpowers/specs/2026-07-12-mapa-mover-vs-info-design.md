# Mapa: separar "mover unidad" de "ver info" — diseño

**Fecha:** 2026-07-12 · **Estado:** aprobado, en implementación (PC)

## Problema

El panel "unidad seleccionada" (sidebar rediseñado) se abre con cualquier clic en
una unidad y **tapa las columnas/cajones de la derecha del mapa**, justo donde el
usuario necesita ver para decidir a dónde mover la unidad. Además, el drag & drop
no permite scrollear mientras arrastras, así que para cajones lejanos no sirve.

## Decisión (PC primero; móvil después)

Separar las dos intenciones con clic izquierdo / derecho:

- **Clic izquierdo en una unidad → MOVER.**
  - Selecciona la unidad **sin abrir el panel** (mapa 100% visible).
  - Una mini-tarjeta (ghost con MVA + estado) **sigue el cursor** (modo "carry").
  - Los cajones destino válidos se resaltan (`spot-available-hint`).
  - Se coloca haciendo **clic en el cajón destino** (click-to-place → funciona a
    cualquier distancia, se puede scrollear mientras cargas). El drag & drop clásico
    (presionar + mover) se conserva para movimientos cercanos.
  - `Esc` o clic en zona vacía = cancela.
- **Clic derecho en una unidad → VER INFO.**
  - Abre el sidebar rediseñado. Se cierra con la X, clic en el mapa, o
    automáticamente al levantar otra unidad para mover. Se hace `preventDefault`
    del menú contextual del navegador sobre las unidades.

No se encoge el mapa (se descartó el enfoque "panel empuja el mapa" por eso).

## Móvil (fase posterior, anotado)

`tap` = levantar/mover (carry) · `long-press` = panel de info. Como el carry no
usa drag mantenido, no hay conflicto con el gesto de arrastre en táctil.

## Implementación (reúso)

Ya existe toda la infra de arrastre en `js/views/mapa.js`:
- Ghost que sigue el cursor: `_createMapDragGhost` / `_positionMapDragGhost` / `_removeMapDragGhost`.
- Highlight de destino: `_updateMapDropHighlight`, `_resolveMapDropZone`.
- Sugerencias de cajones válidos: `_mostrarSugerenciasDisponibles`.
- Mover/persistir: `_handleMapUnitDrop(car, zone, opts)` → `guardarNuevasPosiciones`.
- **Ya funciona** "seleccionar + clic en cajón para colocar" (handler de click,
  rama `spotClicked && selectedAuto`).

Cambios:
1. Click handler (`document.addEventListener('click', …)`): clic en `.car` pasa de
   `_selectCarOnMap(car)` (abre panel) a `_selectCarOnMap(car, {openPanel:false})`
   + `_enterCarrySelect(car)` (activa el ghost/carry).
2. `_bindCarMapInteractions`: agregar `contextmenu` → `_handleMapCarContextMenu`
   (preventDefault + `_selectCarOnMap(car, {openPanel:true})`).
3. `_enterCarrySelect` / `_exitCarrySelect`: ghost + sugerencias + follow del cursor
   (pointermove) + `Esc`. Salir al colocar, cancelar o abrir info.
4. Colocar (rama `spotClicked && selectedAuto`) y cancelar → `_exitCarrySelect()`.

Discoverability: hint sutil la primera vez ("clic derecho = info").
