# Legacy Route Redirect Plan (FASE 12D)

Fecha: 2026-04-28  
Nota: esta fase activa redirects App-first en rutas operativas ya migradas y mantiene escape con `mex.legacy.force`.

## Criterios

- `READY_TO_REDIRECT`: paridad fuerte estable + sin dependencias legacy críticas.
- `KEEP_LEGACY_BACKUP`: App sólida, pero conviene fallback temporal.
- `NEEDS_MORE_PARITY`: faltan funciones clave aún en App.
- `DO_NOT_REDIRECT_YET`: alto riesgo operativo o acoplamiento legacy.

## Plan por ruta

| Legacy | App equivalente | Estado actual | Clasificación | Condiciones antes de redirigir |
|---|---|---|---|---|
| `/home` | `/app/dashboard` | Redirección JS ligera activa (12A) | READY_TO_REDIRECT | Se respeta flag `mex.legacy.force=1` para permanecer en legacy |
| `/profile` | `/app/profile` | Redirección JS ligera activa (12A) | READY_TO_REDIRECT | Se respeta flag `mex.legacy.force=1` para permanecer en legacy |
| `/mensajes` | `/app/mensajes` | Redirect JS App-first activo (12D) | APP_FIRST | Escape `mex.legacy.force=1`; fallback legacy para adjuntos avanzados |
| `/cola-preparacion` | `/app/cola-preparacion` | Redirect JS App-first activo (12D) | APP_FIRST | Escape `mex.legacy.force=1`; fallback legacy para bulk/reorder |
| `/incidencias` | `/app/incidencias` | Redirect JS App-first activo (12D) | APP_FIRST | Escape `mex.legacy.force=1`; fallback legacy para adjuntos complejos |
| `/cuadre` | `/app/cuadre` | Paridad parcial | KEEP_LEGACY_BACKUP | Cerrar huecos de acciones avanzadas/reportes |
| `/gestion` | `/app/admin` | Paridad parcial fuerte | KEEP_LEGACY_BACKUP | Completar edición segura pendiente de roles/plazas/catálogos |
| `/programador` | `/app/programador` | QA completo | KEEP_LEGACY_BACKUP | Mantener acceso legacy visible; evaluar redirect solo para roles autorizados |
| `/mapa` | `/app/mapa` | App en progreso; legacy crítico | DO_NOT_REDIRECT | Paridad total de operación y DnD persistente segura |
| `/solicitud` | N/A | Flujo público de acceso | PUBLIC_FORM / DO_NOT_REDIRECT | Mantener ruta independiente de login/alta |
| `/editmap` | `/app/mapa` (editor futuro) | Editor legacy acoplado | DO_NOT_REDIRECT | Extraer editor plenamente al App Shell |

## Riesgos clave

- Redirección prematura de `/mapa` puede romper operación central.
- `/gestion` y `/cuadre` aún contienen acciones que usuarios esperan en legacy.
- `/mensajes` e `/incidencias` ya avanzaron, pero aún no 1:1 en adjuntos/kanban.

## Siguiente fase sugerida (solo planificación)

1. Monitorear métricas QA de `/app/mensajes`, `/app/cola-preparacion` y `/app/incidencias` con escape legacy.
2. Evaluar redirect condicionado por rol para `/programador`.
3. Mantener sin redirección: `/mapa`, `/cuadre`, `/gestion`, `/solicitud`, `/editmap`.

