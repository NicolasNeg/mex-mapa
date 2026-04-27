# Auditoría: estructura real del mapa legacy vs App Shell read-only (Fase 9B.1)

## 1. Cómo se obtiene la estructura (legacy y App)

- **API:** `obtenerEstructuraMapa(plaza)` en `mex-api.js` (también `api/mapa.js` en PWA):
  - `mapa_config/{plazaId}/estructura` ordenada por `orden`, o
  - Documentos legacy en `mapa_config` cuyo id empieza con `cel_`, o
  - Estructura por defecto generada.
- **App Shell:** `mapa-data.js` suscribe `suscribirEstructuraMapa` y mantiene `snapshot.structure` alineado a la misma fuente.

## 2. Forma de la estructura (celdas reales)

- Cada documento se normaliza con `normalizarElemento` (`domain/mapa.model.js`):
  - `valor` — **etiqueta de cajón** (p. ej. S-1, S-2, L-1); en el DOM legacy se expone como `data-spot` y en el id `spot-{plaza}-{token}`.
  - `tipo` — p. ej. `cajon`, `label`, `camino`, etc.
  - `zone` / `subzone` — metadatos de agrupación lógica.
  - `orden` — orden de recorrido al dibujar.
- `dibujarMapaCompleto` pasa por `_normalizarEstructuraMapa` para x/y/width/height (canvas absoluto en legacy).

## 3. Cómo el legacy asigna una unidad a un cajón

- `normalizarUnidad` (`domain/unidad.model.js`) deja **`pos`** en mayúsculas; por defecto `LIMBO` si no hay dato.
- En el mapa, la unidad se coloca con `_obtenerDestinoUnidadMapa` (`js/views/mapa.js`):
  - Si `pos === 'LIMBO'` → `#unidades-limbo` o `#unidades-taller` según `ubicacion === 'TALLER'`.
  - Si no → `#spot-{plaza}-{sanitize(pos)}`.
  - Si el nodo no existe → fallback limbo/taller como arriba.
- El **token** del spot coincide con `_sanitizeSpotToken(valor)` de la celda y con `sanitizeSpotToken(unit.pos)` (misma regla que `mapa-view-model.js`).

## 4. Por qué `/app/mapa` agrupaba todo como “PATIO”

- El renderer anterior (`normalizeMapaViewModel` en `mapa-renderer.js`) definía la “zona” UI como `_coalesce(unit.ubicacion, unit.pos, …)`.
- Casi todas las unidades en patio tienen **`ubicacion: PATIO`** (clasificación física), mientras que la **celda real** está en **`pos`** (S-1, etc.).
- Al priorizar `ubicacion`, todas las tarjetas caían en una sola agrupación genérica **PATIO**, ignorando la coincidencia **pos ↔ valor de celda**.

## 5. Qué se corrigió

- Nuevo **`js/app/features/mapa/mapa-view-model.js`**:
  - Índice de celdas ocupables solo para `tipo === 'cajon'` (no labels ni caminos).
  - Clasificación por **`resolveUnitCell`** alineada a legacy: limbo / taller / celda real / **huérfano** (pos no encontrada en estructura).
  - Orden visual según `orden` de la estructura; en cada celda se listan las unidades cuyo `pos` sanitizado coincide con el `valor` de la celda.
  - Bucket explícito **“Sin ubicación en mapa”** para huérfanos — sin forzar PATIO.
- **`mapa-renderer.js`** pinta rejilla de celdas + secciones limbo/taller/huérfanos.
- **Dashboard** usa el mismo VM (`buildMapaPreviewSummary`) para KPIs y mini muestra de celdas ocupadas.
- **Router:** preserva query string (`/app/mapa?q=`) para deeplinks y búsqueda global.

## 6. Pendiente para paridad visual 1:1 con legacy

- Posiciones **x/y** absolutas y zoom/pan como `map-grid` legacy.
- Reglas visuales de categoría/bloqueo/reserva en tiempo real como en mapa completo.
- Rendimiento si la estructura tiene cientos de celdas (virtualización).

## 7. Alcance explícito

- Sin DnD nuevo en esta fase (la bandera 9C existente no forma parte de 9B.1).
- Sin escrituras Firestore ni cambios en reglas.
