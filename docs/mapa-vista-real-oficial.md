# Mapa App Shell — Vista real oficial (FASE 15G)

Fecha: 2026-05-07

## Estado

- `/app/mapa`: **OFICIAL_REAL_LEGACY_PORT** (misma jerarquía DOM que el patio legacy en `mapa.html` + `css/mapa.css`, dentro del App Shell; validación visual final **PENDIENTE_USUARIO** con sesión real).
- `/mapa`: **CLASSIC_FALLBACK** (`?legacy=1` o `localStorage mex.legacy.force=1`).
- Redirect `/mapa` → `/app/mapa`: **activo** en `legacy-shell-bridge.js` salvo escape clásico.

## Qué se portó (literal)

- Contenedor `.content` + barra **KPI** (`kpi-container`, mismos labels; conteos alineados con la lógica de `actualizarContadores` / `mapa.js`).
- Canvas: `#map-stage` / `#map-zoom-container` análogos (`map-stage`, `map-zoom-container`) + `map-grid` con textura de puntos (misma familia visual que legacy; **no** es un óvalo decorativo: `radial-gradient` solo en patrón 1px).
- Celdas `spot`; unidades `car` + pintura legacy (`listo`, `sucio`, …).
- Panel `info-sidebar` oscuro integrado (sin card blanca de marketing).
- Búsqueda: banda compacta con contador + limpiar; sincronía con `?q=` y búsqueda global del shell.

## 15G — corrección “no reinterpretación”

- **Causa típica** del aspecto “reinterpretado”: reglas **14G** con `section.app-mapa-view { background: #eef2f7 }` y toolbar/canvas con **fondos claros** ganaban mezcla visual contra el patio oscuro ( sensación de óvalo / capa flotante ).
- **CSS:** fondo de `section.app-mapa-view.app-mapa-operativo` forzado a oscuro; toolbar/controles/buckets/panel sin blancos de card; `::after` decorativo de celdas desactivado; grid KPI y map-grid con **border-radius** más contenido; textura del viewport sin doble `radial-gradient` decorativo.
- **Chrome App:** barra compacta (plaza + sync + último guardado); solo **Actualizar** y **Mapa clásico**; filtros rápidos reducidos a los operativos habituales; DnD/modo en `<details>` solo PROGRAMADOR o admin global.
- **Copy:** sin banners de “funciones avanzadas”; JSON solo como **“Copiar JSON técnico”** para rol técnico.

## Chrome legacy (puente)

- En `/mapa?tab=cuadre`, el bridge añade `legacy-map-content-only` y `legacy-cuadre-content-only` junto a `legacy-mapa-cuadre-tab` para ocultar sidebar/header/topbar legacy sin afectar `/mapa?legacy=1` ni `/editmap` como rutas operativas clásicas.

## Lo que sigue solo en mapa clásico

- Editor de estructura (`/editmap`), PDF/reportes, altas masivas, radar y demás herramientas no portadas.
- CTA: **Mapa clásico** → `/mapa?legacy=1`.

## Restricciones preservadas

- Sin cambios en login/auth/functions/rules.
- Sin cambios destructivos en `mapa.html`, `js/views/mapa.js` ni `css/mapa.css`.
- Service worker: `CACHE_NAME` **mapa-v283** en `sw.js` para esta entrega.
