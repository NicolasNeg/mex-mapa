# Legacy Route Redirect Plan (FASE 15H — mapa completo oficial en App Shell)

Fecha: 2026-05-07 · **15H** declara `/app/mapa` como **MAPA_COMPLETO_OFICIAL**: patio, acciones, radar, reportes/PDF, altas, edición/eliminación y editor de layout en Shell.
Nota: `/mapa`, `/cuadre` y `/mensajes` redirigen App-first salvo escape `localStorage["mex.legacy.force"] === "1"` o apertura explícita con `?legacy=1`. En mapa, la ruta clásica queda como **FALLBACK_TECNICO** / rollback.

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
| `/mensajes` | `/app/mensajes` | **OFICIAL_OPERATIVA** con chat App real | APP_FIRST_ACTIVO · CLASSIC_FALLBACK | Redirect **activado**; escape `mex.legacy.force=1` o `?legacy=1`; clásico conserva adjuntos, edición, borrado y reacciones complejas |
| `/cola-preparacion` | `/app/cola-preparacion` | Redirect App-first activo + visual parity completa (13D) | APP_FIRST · REAL_COMPLETA_VISUAL_PORT | Escape `mex.legacy.force=1`; fallback legacy para bulk/reorder/delete |
| `/incidencias` | `/app/incidencias` | Redirect JS App-first activo + visual parity completa (13E) + hotfix runtime (13E.1) | APP_FIRST · REAL_COMPLETA_VISUAL_PORT | Escape `mex.legacy.force=1`; fallback legacy para adjuntos complejos y eliminación |
| `/cuadre` | `/app/cuadre` | **OFICIAL_OPERATIVA** con consola App real + modales seguros | APP_FIRST_ACTIVO · CLASSIC_FALLBACK | Redirect **activado**; escape `mex.legacy.force=1` o `?legacy=1`; clásico conserva altas/bajas/masivos/cierre formal/PDF/reportes |
| `/gestion` | `/app/admin` | Paridad operativa reforzada (12H) | KEEP_LEGACY_BACKUP | Redirect **no activado**; mantener `/gestion` como entrada principal para acciones avanzadas (roles/permisos/catálogos globales) |
| `/programador` | `/app/programador` | QA completo | KEEP_LEGACY_BACKUP | Mantener acceso legacy visible; evaluar redirect solo para roles autorizados |
| `/mapa` | `/app/mapa` | **MAPA_COMPLETO_OFICIAL (15H)** — funciones principales portadas al Shell | APP_FIRST_ACTIVO · FALLBACK_TECNICO | Redirect **activado**; escape `mex.legacy.force=1` o `?legacy=1` solo para rollback técnico |
| `/solicitud` | N/A | Flujo público de acceso | PUBLIC_FORM / DO_NOT_REDIRECT | Mantener ruta independiente de login/alta |
| `/editmap` | `/app/mapa` | Editor layout integrado en Shell | APP_FIRST_FUNCIONAL · FALLBACK_TECNICO | Mantener `/editmap` como ruta técnica mientras el usuario valida visualmente el editor Shell |

## Riesgos clave

- `/mapa` App-first conserva escape técnico para rollback mientras el usuario valida visualmente sesión real.
- `/gestion` aún contiene acciones que usuarios esperan en legacy.
- `/app/admin` cubre operación diaria segura, pero edición global avanzada se mantiene en legacy.
- `/mensajes` queda App-first; el clásico se conserva para adjuntos, edición, borrado y reacciones complejas.
- `/cuadre` App queda App-first; el clásico se conserva para acciones avanzadas/destructivas y auditoría operacional.

## Siguiente fase sugerida (solo planificación)

1. Ejecutar smoke E2E final de `/app/cuadre` por rol/plaza y validar cero regresiones sobre `/cuadre?legacy=1`.
2. Evaluar redirect condicionado por rol para `/programador`.
3. Mantener sin redirección: `/gestion`, `/solicitud`, `/editmap`. `/mapa`, `/cuadre` y `/mensajes` son App-first.
