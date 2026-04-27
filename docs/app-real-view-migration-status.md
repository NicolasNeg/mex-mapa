# Inventario paridad vistas — Legacy vs App Shell (`/app/*`)

**Fecha:** 2026-04-27 · FASE 10A (actualizado en la misma fase)  
Fuente de verdad operativa sigue en **rutas legacy** donde el motor completo aún vive ahí. Sin roadmap.

| Vista legacy | Vista App Shell | Estado actual | Datos reales | Acciones migradas | Pendiente | Dependencias legacy | Riesgo | Prioridad |
|--------------|-----------------|---------------|--------------|-------------------|-----------|---------------------|--------|-----------|
| `/home` | `/app/dashboard` | **REAL_PARCIAL** | KPIs/resúmenes desde estado/API donde existan | Navegación, búsqueda | Más widgets al nivel de home legacy | `window.api`, cuadre/mapa shortcuts | Medio | Alta |
| `/mapa` | `/app/mapa` | **REAL_PARCIAL** | Firestore mapa_config + unidades vía API | Read-only, DnD preview/persist (flags, rol) | Paridad herramientas/edición con legacy | `guardarNuevasPosiciones`, legacy mapa motor | Alto si se fuerza paridad UI | Alta |
| `/mensajes` | `/app/mensajes` | **REAL_PARCIAL** | Firestore mensajes, email canónico | Igual + refresco ligero (~45s, pestaña visible), CTAs legacy menos prominentes | Adjuntos avanzados, UI 1:1 legacy | `mex-api` mensajes | Medio | Alta |
| `/cola-preparacion` | `/app/cola-preparacion` | **REAL_PARCIAL** (10A más cercano al legacy) | `cola_preparacion/{plaza}/items` + enriquecimiento CUADRE/EXTERNOS | Filtros tipo legacy (urgente/pendiente/listo/míos), orden legacy o por salida, checklist editable, salida/notas/asignación, checklist “marcar todo” con confirmación | DnD reorden masivo y borrado siguen solo en legacy / roles admin legacy | Cuadre/EXTERNOS hidratación por chunks | Medio | Alta |
| `/incidencias` | `/app/incidencias` | **REAL_PARCIAL** fuerte en **notas_admin** | `notas_admin` | Listado/filtros/detalle; crear vía `createIncidencia`/`guardarNuevaNotaDirecto`; resolver vía `resolveIncidencia`; evidencias como URLs | Kanban legacy (`plazas/.../incidencias`) otro modelo; adjuntos nuevos desde App fuera de alcance | `guardarNuevaNotaDirecto`, `resolverNotaDirecto` | Medio | Alta |
| `/cuadre` | `/app/cuadre` | **REAL_PARCIAL** | Cuadre por plaza | Consulta principal según implementación actual | Paridad total con cuadre legacy | APIs cuadre, PDF | Medio | Media |
| `/gestion` | `/app/admin` | **REAL_PARCIAL** · **READ_ONLY / consulta** | Usuarios, roles meta, plazas, catálogos, solicitudes (lectura) | Tablas + detalle + banner “modo consulta” | Crear/editar/aprobar en App (bloqueado explícito) | Admin legacy completo | Bajo lectura | Media |
| `/programador` | `/app/programador` | **REAL_COMPLETA** (alcance QA) | Diagnósticos runtime, flags, smoke | Flags locales, Beta Readiness | — | SW, Firebase cliente | Bajo | Baja |
| `/profile` | `/app/profile` | **REAL_PARCIAL** | Perfil sesión | Ver/editar según vista | Paridad total con profile legacy | Auth, Firestore usuarios | Bajo | Media |

## Clasificación rápida

| Clave | Vistas |
|-------|--------|
| **REAL_COMPLETA** | Ninguna a nivel producto 1:1 con todo el legacy; **programador** completo para su rol QA. |
| **REAL_PARCIAL** | Dashboard, mapa App, mensajes, cola, incidencias, cuadre, admin, profile. |
| **READ_ONLY** | Admin (sin mutaciones destructivas); solicitudes sin aprobar desde App. |
| **PLACEHOLDER** | Sin pantallas “vacías” globales tras 10A; restos marcados en UI como “consulta” o CTA legacy. |
| **LEGACY_FALLBACK** | Rutas legacy intactas; banner “Abrir en App Shell” vía `legacy-shell-bridge.js` (excepto `/mapa` según página). |
| **REQUIERE_MIGRACION_FUERTE** | Mapa editor completo, cuadre PDF avanzado, mensajes adjuntos, admin mutaciones. |

## Notas de incidencias

- **Fuente operativa actual:** `notas_admin` (API `suscribirNotasAdmin`, mismos registros que modal/bitácota del mapa cuando usa las mismas funciones).
- **Incidencias Kanban legacy** (`js/views/incidencias.js`) usa otro esquema (`plazas/.../incidencias`); **no** es la fuente única en App Shell.

## Cola preparación

- Legacy y App comparten colección **`cola_preparacion/{plaza}/items`**.
- Modelo real legacy: checklist objeto (`lavado`, `gasolina`, `docs`, `revision`), `fechaSalida`, `orden`, `asignado`, `notas`.
- **10A:** App hidrata MVA desde `cuadre`/`externos`; estadísticas sobre el conjunto **filtrado** como en legacy; escrituras merge con metadatos `actualizadoAt`; sin borrado ni reorder DnD en App.

## Mensajes App

- Refresco automático conservador cuando la pestaña está visible (no aumenta listeners Firestore; reuso de la misma carga por API).

## Service Worker

- Tras cambios en vistas App: **`CACHE_NAME`** bump (p. ej. `mapa-v236`).
