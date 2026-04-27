# Mapa DnD Audit (Fase 9C — legacy + App Shell preview)

**Fecha:** 2026-04-27  
**Alcance:** drag-and-drop operativo del mapa legacy (`js/views/mapa.js`, DOM de `mapa.html`, estilos en `css/mapa.css`) vs preview controlado en `/app/mapa`.

---

## 1. Funciones legacy que inician DnD

| Función | Rol |
|---------|-----|
| `_bindCarMapInteractions(car)` | Marca `dataset.dragBound`, `draggable`, registra eventos por unidad |
| `_handleMapCarDragStart` | HTML5 `dragstart` sobre `.car` |
| `_handleMapCarTouchStart` | Long-press (~220 ms) antes de iniciar ghost |
| `_handleMapCarPointerDown` | Estado pendiente antes de mover > 8 px |
| `_bindMapDragDropEvents()` | Registra **listeners globales** una sola vez (`dragBindingsBound`) |

---

## 2. Handlers dragstart / dragover / drop

| Handler | Evento |
|---------|--------|
| `_handleMapZoneDragOver` | `dragover` en zona (`.spot`, limbo, taller) |
| `_handleMapZoneDrop` | `drop` en zona |
| `_handleMapDragOver` | `dragover` en **document** |
| `_handleMapDrop` | `drop` en **document** |

---

## 3. Touch / pointer / mouse

| Función | Uso |
|---------|-----|
| `_handleMapPointerMove` / `_handleMapPointerUp` | Pointer drag + ghost |
| `_handleMapTouchDragMove` / `_handleMapTouchDragEnd` | Touch después de activar drag |
| `_handleMapWheelZoom` / `_handleMapTouch*` | Gestos viewport (zoom/pan), no son DnD pero comparten viewport |

---

## 4. Listeners document / window

`_bindMapDragDropEvents()` agrega sobre **document**:

- `dragover`, `drop`
- `pointermove`, `pointerup`, `pointercancel` (`passive: false`)
- `touchmove`, `touchend`, `touchcancel` (`passive: false`)

Permanecen mientras exista sesión legacy; no hay teardown central al salir del mapa.

---

## 5. `passive: false`

Legacy usa `preventDefault()` durante drag en document/viewport para bloquear scroll nativo:

- `pointermove` document
- `touchmove` document
- `wheel` / `touchmove` en `.mapa-viewport` (zoom/pan)

---

## 6. Datos necesarios para mover una unidad

Del elemento `.car` / dataset:

- `dataset.mva`, categoría, spot origen
- Referencia DOM al elemento unidad (`sourceCar`)

Del modelo de unidad:

- Estado, ubicación previa para swap/limbo

---

## 7. Datos zona / celda destino

Legacy resuelve con `_resolveMapDropZone(target)` → `.spot`, `#unidades-limbo`, `#unidades-taller`.

Dataset de spot:

- `blocked`, `reserved`, `allowedCategories`

---

## 8. Escritura / persistencia

Flujo principal:

1. `_handleMapUnitDrop(sourceCar, zone, …)`
2. `moverUnidadInmediato` / `mostrarConfirmacionSwap`
3. **`api.guardarNuevasPosiciones(...)`** (batch cuadre/externos + logs)

También existen `api.aplicarEstado`, insertar/eliminar desde flota — fuera del path DnD directo pero relacionados.

---

## 9. Permisos

Validaciones mezcladas:

- UI: bloqueos de cajón (`blocked`), advertencias categoría
- Negocio: `MAPA_LOCKED`, permisos de rol en acciones admin
- Confirmaciones (`mexConfirm`) para limbo / swap

---

## 10. Qué reutilizar en App Shell (preview)

- Idea de ghost + highlight de zona
- Resolución de zona bajo cursor (`elementFromPoint` + data attributes)
- Umbral de movimiento antes de considerar drag

---

## 11. Qué NO migrar aún

- Copiar `_bindMapDragDropEvents` permanente en document
- `guardarNuevasPosiciones`, `moverUnidadInmediato`, swap real
- Modales legacy, modo swap, validación categorías completa
- Viewport zoom/pan del canvas legacy

---

## App Shell `/app/mapa` (Fase 9C)

- Feature flag: `localStorage.getItem('mex.appMapa.dnd') === '1'`
- Roles preview: `PROGRAMADOR`, `CORPORATIVO_USER`, `JEFE_OPERACION`
- Implementación: `js/app/features/mapa/mapa-dnd.js` — solo preview local, sin Firestore

### Controlador `mapa-dnd.js`

- API: `createMapaDndController({ root, getSnapshot, onMovePreview, onMoveCommit, canMove, debug })` → `mount`, `unmount`, `enable`, `disable`, `isEnabled`, `shouldSuppressClick`
- Arrastre: `pointerdown` en `[data-dnd-unit="1"]` → umbral 8px → ghost + listeners en **window** solo durante el gesto → `touchend`/`pointerup` limpian listeners
- No llama `guardarNuevasPosiciones` ni escribe Firestore
- Mensajes de preview (9C.1): *Movimiento simulado. No se guardó en producción.*, *Misma celda — preview sin cambios…*, o avisos de destino inválido / cajón bloqueado

### Política Fase 9C.1 (roles + celdas reales)

**Quién decide el preview DnD** (`js/app/views/mapa.js`):

| Función | Rol |
|---------|-----|
| `_readAppMapaDndFlag()` | `localStorage['mex.appMapa.dnd'] === '1'` |
| `_canRolePreviewDnd(state)` | `PROGRAMADOR` **o** (`profile.isAdmin === true` **y** `esGlobal(role)` en `domain/permissions.model.js`), **excluyendo** siempre `CORPORATIVO_USER` y `JEFE_OPERACION`. |
| `_hasCajonStructure(snapshot)` | Al menos un elemento en `snapshot.structure` con `tipo === 'cajon'` y no `esLabel`. |
| `_dndFullyEnabled(state, snapshot)` | Flag **y** rol **y** estructura con cajones. Sin estructura → sin DnD aunque el flag esté activo. |

**Destinos:** solo elementos con `data-drop-cell="1"` y `data-cell-type="cajon"` (renderer). Buckets limbo/taller/sin celda **no** son drop zones; unidades ahí llevan `allowUnitDrag: false` (sin `data-dnd-unit`).

**Touch:** preview por defecto **solo pointer** (`pointerOnlyPreview: true` en `createMapaDndController`) — sin `touchstart` en el root; touch nativo queda documentado como pendiente si se reactiva con `pointerOnlyPreview: false`.

### Activación

| Condición | Comportamiento |
|-----------|----------------|
| Flag off o rol no permitido | Sin listeners DnD en el contenedor; vista read-only |
| Flag on + rol permitido + estructura con cajones | Listeners en `#app-mapa` root; badge “DnD experimental” |

**Nota:** Cambiar `localStorage` en la misma pestaña no dispara `storage`; puede hacer falta recargar o provocar otro `setState` en App Shell para refrescar atributos `data-dnd-unit`.

### Pendiente (DnD persistente / fase futura)

- Reutilizar validaciones de cajón (`blocked`, categorías) del legacy
- Llamar `guardarNuevasPosiciones` solo tras confirmación y permisos operativos
- No usar listeners globales permanentes en `document` como el legacy
