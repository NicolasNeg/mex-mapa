# Mapa App Shell — Vista real oficial (FASE 15F)

Fecha: 2026-05-07

## Estado

- `/app/mapa`: **OFICIAL_REAL_VISUAL_PORT** (misma jerarquía visual que el mapa legacy en `mapa.html`, dentro del App Shell).
- `/mapa`: **CLASSIC_FALLBACK** (`?legacy=1` o `localStorage mex.legacy.force=1`).
- Redirect `/mapa` → `/app/mapa`: **activo** en `legacy-shell-bridge.js` salvo escape clásico.

## Qué se portó en 15F (literal)

- Contenedor tipo `.content` + barra **KPI** como en legacy (`kpi-container`, mismos labels; conteos alineados con `actualizarContadores` en `js/views/mapa.js`: TOTALES = unidades con ubicación PATIO, LISTOS/SUCIOS/MANTENIMIENTO por estado, EN PATIO / EN TALLER por ubicación).
- Zona de canvas: estructura análoga a `#map-stage` / `#map-zoom-container` / `#grid-map` con clase `map-grid`, fondo asfalto y textura de puntos como en `css/mapa.css`.
- Celdas: clase `spot` sobre el contenedor de celda; unidades con clases `car` + pintura legacy (`listo`, `sucio`, `mantenimiento`, etc.).
- Panel lateral de detalle: clases `info-sidebar` integradas al tema oscuro del mapa (no card blanca flotante genérica).
- Banda de búsqueda activa compacta bajo KPIs cuando hay texto de filtro; botón limpiar enlazado a la misma acción que el buscador del shell.
- **Sin** pseudo-elementos decorativos tipo óvalo en celdas (`::after` / `::before` eliminados en slots).
- **Copiar JSON** y diagnóstico similar: solo si el rol es PROGRAMADOR o admin global (`esGlobal`), igual criterio que otras herramientas técnicas.

## Chrome legacy (puente)

- En `/mapa?tab=cuadre`, el bridge añade `legacy-map-content-only` y `legacy-cuadre-content-only` junto a `legacy-mapa-cuadre-tab` para ocultar sidebar/header/topbar legacy sin afectar `/mapa?legacy=1` ni `/editmap` como rutas operativas clásicas.

## Lo que sigue solo en mapa clásico

- Editor de estructura (`/editmap`), PDF/reportes, altas masivas, radar y demás herramientas no portadas.
- CTA: **Abrir mapa clásico** → `/mapa?legacy=1`.

## Restricciones preservadas

- Sin cambios en login/auth/functions/rules.
- Sin cambios destructivos en `mapa.html`, `js/views/mapa.js` ni `css/mapa.css`.
- Service worker: revisar `CACHE_NAME` en `sw.js` tras cambios de assets (p. ej. `mapa-v281`).
