# Cuadre vista completa oficial

Fecha: 2026-05-07 · FASE 15C

## Estado

`/app/cuadre` pasa a **OFICIAL_OPERATIVA_VISUAL_15C**.

## Causa detectada

El router sí apuntaba a `js/app/views/cuadre.js` y `sw.js` incluía `js/app/views/cuadre.js` + `css/app-cuadre.css`, pero la vista App no se percibía como migración real porque:

- El diseño seguía siendo una tabla/panel claro muy parecido a una vista administrativa genérica.
- La jerarquía visual no imitaba una consola de patio.
- El legacy `/mapa?tab=cuadre` podía quedar contaminado por chrome/offsets antiguos.

## Corrección runtime

- Se refuerza `css/app-cuadre.css` con una consola oscura, densa y operativa.
- Se elimina texto `BETA` visible.
- Se cambian CTAs a “módulo clásico” / “mapa clásico”.
- Se mantiene `js/app/router.js`: `/app/cuadre` carga `js/app/views/cuadre.js`.
- Se mantiene `css/app-cuadre.css` inyectado por la vista.

## Funciones visibles

- Header operativo interno.
- KPIs superiores/laterales.
- Toolbar con refrescar, export CSV, copiar resumen y accesos clásicos.
- Tabs: flota patio, externos, cuadre admins, historial, clásico.
- Filtros por categoría, ubicación, estado, origen y chips.
- Tabla principal real.
- Panel detalle con copiar MVA, copiar JSON y abrir mapa.
- Historial y admins en modo lectura.

## Bloqueado / módulo clásico

- Eliminar unidad.
- Alta de unidad.
- Edición masiva.
- Cierre formal.
- PDF/reportes oficiales.
- Cambios destructivos globales.

## QA pendiente

Validación manual autenticada con datos reales de plaza: selección, filtros, tabs admins/historial, export CSV y copia al portapapeles.
