# Legacy Route Redirect Plan (FASE 15B — mapa App oficial App-first)

Fecha: 2026-05-06 · **15B** mantiene `/app/mapa` como mapa principal y completa flujos operativos P1.
Nota: `/mapa` redirige App-first a `/app/mapa` salvo escape `localStorage["mex.legacy.force"] === "1"` o apertura explícita con `?legacy=1`. `/mapa` queda como **CLASSIC_FALLBACK** para editor, PDF, radar/chat completo, altas masivas, eliminación, estructura `mapa_config`, cierre formal y acciones globales peligrosas.

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
| `/incidencias` | `/app/incidencias` | Redirect JS App-first activo + visual parity completa (13E) + hotfix runtime (13E.1) | APP_FIRST · REAL_COMPLETA_VISUAL_PORT | Escape `mex.legacy.force=1`; fallback legacy para adjuntos complejos y eliminación |
| `/cuadre` | `/app/cuadre` | Paridad visual/operativa fuerte (12F/12G/13F) | KEEP_LEGACY_BACKUP | Redirect **no activado** en esta fase; mantener `/cuadre` legacy como entrada principal y `/app/cuadre` como opción avanzada |
| `/gestion` | `/app/admin` | Paridad operativa reforzada (12H) | KEEP_LEGACY_BACKUP | Redirect **no activado**; mantener `/gestion` como entrada principal para acciones avanzadas (roles/permisos/catálogos globales) |
| `/programador` | `/app/programador` | QA completo | KEEP_LEGACY_BACKUP | Mantener acceso legacy visible; evaluar redirect solo para roles autorizados |
| `/mapa` | `/app/mapa` | **OFICIAL_OPERATIVA_COMPLETA_P1 (15B)** — mapa principal en App Shell | APP_FIRST_ACTIVO · CLASSIC_FALLBACK | Redirect **activado**; escape `mex.legacy.force=1` o `?legacy=1`; clásico sigue disponible para editor, radar y herramientas completas |
| `/solicitud` | N/A | Flujo público de acceso | PUBLIC_FORM / DO_NOT_REDIRECT | Mantener ruta independiente de login/alta |
| `/editmap` | `/app/mapa` (editor futuro) | Editor legacy acoplado | DO_NOT_REDIRECT | Extraer editor plenamente al App Shell |

## Riesgos clave

- `/mapa` App-first exige mantener escape clásico claro para funciones avanzadas no migradas.
- `/gestion` aún contiene acciones que usuarios esperan en legacy.
- `/app/admin` cubre operación diaria segura, pero edición global avanzada se mantiene en legacy.
- `/mensajes` sigue con brecha de paridad en adjuntos avanzados; `/incidencias` queda App-first con fallback legacy para acciones destructivas/adjuntos complejos.
- `/cuadre` App está listo para futura activación, pero se mantiene legacy-first para minimizar riesgo operativo.

## Siguiente fase sugerida (solo planificación)

1. Ejecutar smoke E2E final de `/app/cuadre` por rol/plaza y validar cero regresiones sobre `/cuadre` legacy.
2. Evaluar redirect condicionado por rol para `/programador`.
3. Mantener sin redirección: `/cuadre`, `/gestion`, `/solicitud`, `/editmap`. `/mapa` ya es App-first desde 15A.
