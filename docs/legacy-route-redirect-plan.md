# Legacy Route Redirect Plan (FASE 13D, cola visual port desde /cola-preparacion)

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
| `/home` | `/app/dashboard` | Redirect App-first + UI equivalente a `renderHome` legacy (13B) | APP_FIRST · REAL_COMPLETA_VISUAL_PORT | Se respeta flag `mex.legacy.force=1`; en force se muestra CTA `Estás en legacy · Abrir App Shell` |
| `/profile` | `/app/profile` | Redirección App-first activa + visual parity completa (13C) | APP_FIRST · REAL_COMPLETA_VISUAL_PORT | Se respeta flag `mex.legacy.force=1`; en force muestra CTA `Estás en legacy · Abrir App Shell` preservando query/hash |
| `/mensajes` | `/app/mensajes` | Redirect JS App-first activo (12D) | APP_FIRST | Escape `mex.legacy.force=1`; fallback legacy para adjuntos avanzados |
| `/cola-preparacion` | `/app/cola-preparacion` | Redirect App-first activo + visual parity completa (13D) | APP_FIRST · REAL_COMPLETA_VISUAL_PORT | Escape `mex.legacy.force=1`; fallback legacy para bulk/reorder/delete |
| `/incidencias` | `/app/incidencias` | Redirect JS App-first activo (12D) | APP_FIRST | Escape `mex.legacy.force=1`; fallback legacy para adjuntos complejos |
| `/cuadre` | `/app/cuadre` | Paridad operativa fuerte (12F/12G) | KEEP_LEGACY_BACKUP | Redirect **no activado** en esta fase; mantener `/cuadre` legacy como entrada principal y `/app/cuadre` como opción avanzada |
| `/gestion` | `/app/admin` | Paridad operativa reforzada (12H) | KEEP_LEGACY_BACKUP | Redirect **no activado**; mantener `/gestion` como entrada principal para acciones avanzadas (roles/permisos/catálogos globales) |
| `/programador` | `/app/programador` | QA completo | KEEP_LEGACY_BACKUP | Mantener acceso legacy visible; evaluar redirect solo para roles autorizados |
| `/mapa` | `/app/mapa` | App en progreso; legacy crítico | DO_NOT_REDIRECT | Paridad total de operación y DnD persistente segura |
| `/solicitud` | N/A | Flujo público de acceso | PUBLIC_FORM / DO_NOT_REDIRECT | Mantener ruta independiente de login/alta |
| `/editmap` | `/app/mapa` (editor futuro) | Editor legacy acoplado | DO_NOT_REDIRECT | Extraer editor plenamente al App Shell |

## Riesgos clave

- Redirección prematura de `/mapa` puede romper operación central.
- `/gestion` aún contiene acciones que usuarios esperan en legacy.
- `/app/admin` cubre operación diaria segura, pero edición global avanzada se mantiene en legacy.
- `/mensajes` e `/incidencias` ya avanzaron, pero aún no 1:1 en adjuntos/kanban.
- `/cuadre` App está listo para futura activación, pero se mantiene legacy-first para minimizar riesgo operativo.

## Siguiente fase sugerida (solo planificación)

1. Ejecutar smoke E2E final de `/app/cuadre` por rol/plaza y validar cero regresiones sobre `/cuadre` legacy.
2. Evaluar redirect condicionado por rol para `/programador`.
3. Mantener sin redirección: `/mapa`, `/cuadre`, `/gestion`, `/solicitud`, `/editmap`.

