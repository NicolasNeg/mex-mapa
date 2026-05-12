# Mapa oficial operativo

Fecha: 2026-05-07 · FASE 15H

## 1. Estado

| Ruta | Estado |
|---|---|
| `/app/mapa` | **MAPA_COMPLETO_OFICIAL** |
| `/mapa` | **FALLBACK_TECNICO** |
| Redirect `/mapa` → `/app/mapa` | **ACTIVADO** |
| Escape técnico | `localStorage["mex.legacy.force"] = "1"` o `/mapa?legacy=1` |

`/app/mapa` es la ruta principal del mapa dentro del App Shell. La matriz completa está en `docs/mapa-paridad-total-15h.md`; `/mapa` queda como rollback técnico.

## 2. Funciones oficiales en `/app/mapa`

- Render del mapa operativo en App Shell.
- Celdas/cajones reales desde `mapa_config`.
- Unidades reales por plaza.
- Búsqueda global y soporte `/app/mapa?q=MVA`.
- Filtros rápidos.
- Vista por celdas y vista lista.
- Panel detalle por unidad.
- Incidencias/notas por MVA con mini bitácora.
- Acciones operativas seguras por unidad cuando el módulo/API/rol lo permiten.
- Modales oficiales para estado, notas, gasolina y lista/no lista.
- Incidencia rápida desde unidad si `guardarNuevaNotaDirecto` está disponible; si no, apertura de bitácora completa.
- Movimiento DnD según permisos y flags.
- Movimiento con guardado solo con `mex.appMapa.dnd=1`, `mex.appMapa.dndPersist=1` y rol autorizado.
- Radar operativo dentro del Shell.
- Reportes/PDF desde los datos actuales del mapa.
- Alta individual, alta masiva con preview, editar unidad y eliminar unidad con confirmación fuerte.
- Editor de patio/layout con `guardarEstructuraMapa`.

## 3. Funciones 15H

La paridad total auditada está en `docs/mapa-paridad-total-15h.md`.

## 4. Reglas operativas

- No tocar login/auth/rules/functions para operar el mapa.
- No borrar ni degradar `/mapa`; queda como rollback técnico.
- No activar movimiento con guardado por defecto.
- No cambiar permisos DnD sin auditoría.
- Mutaciones y editor requieren rol autorizado.
- Usar `mex.legacy.force=1` solo para rollback técnico.

## 5. QA oficial

Checklist mínimo:

- Abrir `/app/mapa` y confirmar título “Mapa operativo”.
- Confirmar que `/mapa` redirige a `/app/mapa` sin `mex.legacy.force`.
- Activar `localStorage.setItem("mex.legacy.force", "1")` y abrir `/mapa`.
- Confirmar que `/mapa?legacy=1` abre fallback técnico.
- Confirmar que `/editmap`, `/solicitud`, `/cuadre`, login y App Shell no se afectan.
- Confirmar Radar, Reportes/PDF, altas, edición, eliminación y editor dentro de `/app/mapa`.
- Confirmar que DnD con guardado sigue OFF por defecto.
- Confirmar que acciones 14F, incidencias 14B, filtros, búsqueda y detalle siguen operativos.
- Confirmar que modales 15B cancelan sin ejecutar y sincronizan después de éxito.

## 6. Rollback técnico

Abrir fallback técnico:

```js
localStorage.setItem("mex.legacy.force", "1");
location.href = "/mapa";
```

Volver al mapa operativo:

```js
localStorage.removeItem("mex.legacy.force");
location.href = "/app/mapa";
```
