# Mapa oficial operativo

Fecha: 2026-05-06 · FASE 15A

## 1. Estado

| Ruta | Estado |
|---|---|
| `/app/mapa` | **OFICIAL_OPERATIVA** |
| `/mapa` | **CLASSIC_FALLBACK** |
| Redirect `/mapa` → `/app/mapa` | **ACTIVADO** |
| Escape clásico | `localStorage["mex.legacy.force"] = "1"` o `/mapa?legacy=1` |

`/app/mapa` es la ruta principal del mapa dentro del App Shell. `/mapa` se mantiene intacto como mapa clásico para funciones avanzadas no migradas.

## 2. Funciones oficiales en `/app/mapa`

- Render del mapa operativo en App Shell.
- Celdas/cajones reales desde `mapa_config`.
- Unidades reales por plaza.
- Búsqueda global y soporte `/app/mapa?q=MVA`.
- Filtros rápidos.
- Vista por celdas y vista lista.
- Panel detalle por unidad.
- Incidencias/notas por MVA.
- Acciones operativas seguras por unidad cuando el módulo/API/rol lo permiten.
- Movimiento DnD según permisos y flags.
- Movimiento con guardado solo con `mex.appMapa.dnd=1`, `mex.appMapa.dndPersist=1` y rol autorizado.
- Botón permanente para abrir mapa clásico.

## 3. Funciones que siguen en mapa clásico

- Editor de estructura/layout.
- Reportes.
- PDF.
- Radar/chat completo.
- Altas masivas.
- Eliminación de unidad.
- Edición directa de estructura `mapa_config`.
- Cierre formal.
- Acciones globales peligrosas o masivas.

Estas funciones no se presentan como activas en `/app/mapa`; se nombran como funciones avanzadas en mapa clásico.

## 4. Reglas operativas

- No tocar login/auth/rules/functions para operar el mapa.
- No borrar ni degradar `/mapa` clásico.
- No activar movimiento con guardado por defecto.
- No cambiar permisos DnD sin auditoría.
- No habilitar eliminación, altas masivas, reportes/PDF, editor o cierre formal dentro de App si no tienen contrato seguro.
- Usar `mex.legacy.force=1` para permanecer en mapa clásico.

## 5. QA oficial

Checklist mínimo:

- Abrir `/app/mapa` y confirmar título “Mapa operativo”.
- Confirmar que `/mapa` redirige a `/app/mapa` sin `mex.legacy.force`.
- Activar `localStorage.setItem("mex.legacy.force", "1")` y abrir `/mapa`.
- Confirmar CTA “Estás en mapa clásico · Abrir mapa operativo”.
- Confirmar que `/mapa?legacy=1` abre mapa clásico.
- Confirmar que `/editmap`, `/solicitud`, `/cuadre`, login y App Shell no se afectan.
- Confirmar que las funciones no migradas dicen “mapa clásico”.
- Confirmar que DnD con guardado sigue OFF por defecto.
- Confirmar que acciones 14F, incidencias 14B, filtros, búsqueda y detalle siguen operativos.

## 6. Cómo abrir clásico y volver

Abrir clásico:

```js
localStorage.setItem("mex.legacy.force", "1");
location.href = "/mapa";
```

Volver al mapa operativo:

```js
localStorage.removeItem("mex.legacy.force");
location.href = "/app/mapa";
```
