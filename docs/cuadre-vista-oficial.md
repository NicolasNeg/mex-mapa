# Cuadre vista oficial

Fecha: 2026-05-07 · FASE 15D

## Estado

- `/app/cuadre` = **OFICIAL_OPERATIVA**.
- `/cuadre` = **CLASSIC_FALLBACK**.
- Redirect `/cuadre -> /app/cuadre` = **ACTIVO**.
- Escape clásico: `localStorage["mex.legacy.force"] = "1"` o abrir `/cuadre?legacy=1`.

## Funciones oficiales en `/app/cuadre`

- Header “Cuadre operativo” con plaza, última actualización, refrescar, export CSV, copiar resumen y accesos clásicos.
- KPIs de total, listos, sucio/mantenimiento, externos, resguardo y sin ubicación, más top estado/ubicación/categoría.
- Filtros por chips, estado, categoría, ubicación, origen y fecha para historial.
- Tabla operativa de 12 columnas: MVA, modelo, placas, categoría, gas, estado, ubicación, posición, tipo, notas, última actualización y acciones.
- Panel detalle con MVA grande, modelo, placas, categoría, gas, estado, ubicación, posición, origen, plaza, timestamps y copia MVA/JSON.
- Tabs Flota patio, Externos, Cuadre admins, Historial y Clásico.
- Admins e historial read-only.
- Acciones oficiales con modal y confirmación: cambiar estado, actualizar notas, actualizar gasolina y marcar listo, solo cuando existe API segura y rol autorizado.

## Funciones en cuadre clásico

- Alta/baja de unidad.
- Altas o cambios masivos.
- Cierre formal.
- PDF/reportes oficiales.
- Cambios globales destructivos.
- Edición de estructura o flujos administrativos no auditados.

## QA

- `/cuadre` debe redirigir a `/app/cuadre` si `mex.legacy.force` no está activo.
- `/cuadre?legacy=1` debe abrir el clásico y activar el escape.
- En clásico debe aparecer CTA “Estás en cuadre clásico · Abrir cuadre operativo”.
- Cancelar modal no ejecuta acción.
- Error de acción no debe dejar UI optimista falsa.
- Cambio de plaza debe limpiar selección, modal y estado pendiente.
