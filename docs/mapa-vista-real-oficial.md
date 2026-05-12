# Mapa App Shell — Vista real oficial (FASE 15H)

Fecha: 2026-05-07

## Estado

- `/app/mapa`: **MAPA_COMPLETO_OFICIAL** (patio operativo, acciones, radar, reportes/PDF, altas, edición/eliminación y editor de layout dentro del App Shell; validación visual final **VALIDACION_VISUAL_USUARIO_PENDIENTE** con sesión real).
- `/mapa`: **FALLBACK_TECNICO** (`?legacy=1` o `localStorage mex.legacy.force=1`).
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
- **Chrome App:** barra compacta (plaza + sync + último guardado); incluye Actualizar, Radar, Reportes, Alta unidad, Alta masiva y Editar patio según permisos; filtros rápidos reducidos a los operativos habituales; DnD/modo en `<details>` solo PROGRAMADOR o admin global.
- **Copy:** sin banners de “funciones avanzadas”; JSON solo como **“Copiar JSON técnico”** para rol técnico.

## Chrome legacy (puente)

- En `/mapa?tab=cuadre`, el bridge añade `legacy-map-content-only` y `legacy-cuadre-content-only` junto a `legacy-mapa-cuadre-tab` para ocultar sidebar/header/topbar legacy sin afectar `/mapa?legacy=1` ni `/editmap` como rutas operativas clásicas.

## Fase 15H

La matriz completa de paridad vive en `docs/mapa-paridad-total-15h.md`. Las funciones principales que antes se reportaban fuera del Shell ahora tienen entrada operativa en `/app/mapa`: Radar, Reportes/PDF, Alta de unidad, Alta masiva, Editar unidad, Eliminar unidad y Editar patio/layout.

## Restricciones preservadas

- Sin cambios en login/auth/functions/rules.
- Sin cambios destructivos en `mapa.html`, `js/views/mapa.js` ni `css/mapa.css`.
- Service worker: `CACHE_NAME` **mapa-v284** en `sw.js` para esta entrega.
