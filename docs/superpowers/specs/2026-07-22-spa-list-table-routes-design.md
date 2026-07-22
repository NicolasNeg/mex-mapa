# Design: SPA listados — tabla + rutas (regla de oro)

> **Fecha:** 2026-07-22  
> **Estado:** aprobado — implementar  
> **Alcance:** regla de oro documentada + rediseño Notas + Reportes de daños

## Resumen

Los listados operativos del App Shell usan el mismo patrón que Traslados/Unidades:

1. **Tabla densa** como superficie principal (no cards / kanban / lista custom permanente).
2. **Rutas** para modos: lista `/app/{módulo}`, nuevo `/app/{módulo}/nuevo`, detalle `/app/{módulo}/v/:id`.
3. **Detalles dentro** del módulo (misma vista SPA + breadcrumb Volver), no panel lateral permanente ni modal como flujo principal de detalle/alta.
4. Toolbar: búsqueda + chips/tabs de estado + filtros colapsables + contador.
5. Click en fila → navegar a detalle; CTA primario → `/nuevo`.

## Fuera de alcance

- Legacy `incidencias.html` Kanban.
- Migrar colección `notas_admin` → `incidencias`.
- Bulk resolve real en Notas.
- Cambios de dominio Firestore en reportes (`papeletas_reportes`).

## Notas (`/app/notas`)

| Ruta | Modo |
|------|------|
| `/app/notas` | Tabla |
| `/app/notas/nuevo` | Formulario crear (página completa) |
| `/app/notas/v/:id` | Detalle + acciones |
| `/app/incidencias` | Redirect a `/app/notas` |

**Columnas:** Folio · Título · MVA · Tipo · Prioridad · Estado · Autor · Fecha

**Filtros:** búsqueda, tabs Todas/Mías/Sigo, prioridad/estado/tipo (toolbar, sin rail izquierdo permanente).

**Data:** sin cambio de contrato (`incidencias-data.js` / `notas_admin`).

## Reportes de daños (`/app/reportes-danos`)

Ya tiene list/create/detail; la lista es cards. Cambios:

| Ruta | Modo |
|------|------|
| `/app/reportes-danos` | Tabla (reemplaza cards) |
| `/app/reportes-danos/nuevo` | Crear (sin cambio funcional) |
| `/app/reportes-danos/v/:id` | Detalle (migrar desde `/:id`; redirect del id suelto) |

**Columnas:** Folio/MVA · Tipo · Estado · Plaza · Autor · Fecha · Marcas (#)

## Archivos

- `agente.md`, `.cursor/rules/spa-list-table-routes.mdc`
- `js/app/views/incidencias.js`, `css/app-incidencias.css`, `js/app/router.js`
- `js/app/views/reportes-danos.js`, `css/app-reportes-danos.css`
- `js/shell/navigation.config.js` (títulos de ruta si aplica)

## Criterios de éxito

- Notas y Reportes: lista = `<table>`; crear y detalle vía URL.
- Deep-link a `/nuevo` y `/v/:id` funciona con refresh.
- Permisos y mutaciones existentes se preservan.
- SW bump + commit + push al cerrar.
