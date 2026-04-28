# Legacy Route Redirect Plan (FASE 11E)

Fecha: 2026-04-28  
Nota: esta fase **no implementa redirects**. Solo define elegibilidad y condiciones.

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
| `/mensajes` | `/app/mensajes` | Paridad parcial fuerte (11D) | NEEDS_MORE_PARITY | Adjuntos completos + parity visual final chat |
| `/cola-preparacion` | `/app/cola-preparacion` | Operativa fuerte | KEEP_LEGACY_BACKUP | Validar ciclo operativo completo en móvil |
| `/incidencias` | `/app/incidencias` | Paridad parcial fuerte (11D, notas_admin) | NEEDS_MORE_PARITY | Definir convergencia con kanban legacy y adjuntos completos |
| `/cuadre` | `/app/cuadre` | Paridad parcial | NEEDS_MORE_PARITY | Cerrar huecos de acciones avanzadas/reportes |
| `/gestion` | `/app/admin` | Paridad parcial fuerte | NEEDS_MORE_PARITY | Completar edición segura pendiente de roles/plazas/catálogos |
| `/programador` | `/app/programador` | QA completo | KEEP_LEGACY_BACKUP | Mantener acceso legacy visible; evaluar redirect solo para roles autorizados |
| `/mapa` | `/app/mapa` | App en progreso; legacy crítico | DO_NOT_REDIRECT_YET | Paridad total de operación y DnD persistente segura |
| `/solicitud` | N/A | Flujo público de acceso | DO_NOT_REDIRECT_YET | Mantener ruta independiente de login/alta |
| `/editmap` | `/app/mapa` (editor futuro) | Editor legacy acoplado | DO_NOT_REDIRECT_YET | Extraer editor plenamente al App Shell |

## Riesgos clave

- Redirección prematura de `/mapa` puede romper operación central.
- `/gestion` y `/cuadre` aún contienen acciones que usuarios esperan en legacy.
- `/mensajes` e `/incidencias` ya avanzaron, pero aún no 1:1 en adjuntos/kanban.

## Siguiente fase sugerida (solo planificación)

1. Validar en producción redirects suaves ya activos para `/home` y `/profile` (sin loop).
2. Evaluar redirect condicionado por rol para `/programador`.
3. Mantener sin redirección: `/mapa`, `/cuadre`, `/gestion`, `/mensajes`, `/cola-preparacion`, `/incidencias`, `/solicitud`, `/editmap`.

