# Inventario paridad vistas — Legacy vs App Shell (`/app/*`)

**Última actualización:** 2026-05-07 · **FASE 15D** (Cuadre oficial App-first)

| Vista legacy | Vista App Shell | Estado | Fuente datos App | Paridad fuerte esta fase |
|--------------|-----------------|--------|------------------|---------------------------|
| `/home` | `/app/dashboard` | **REAL_COMPLETA_VISUAL_PORT (13B)** · **APP_FIRST** | Igual que 13A (KPIs Firestore + mini mapa `buildMapaViewModel`) | UI copiada desde `renderHome` (grid bento, hero mapa, KPI columna, resumen + actividad); sin chrome legacy; búsqueda global vía hooks ocultos |
| `/mapa` | `/app/mapa` | **OFICIAL_OPERATIVA_COMPLETA_P1_VISUAL_15C** · `/mapa` = `CLASSIC_FALLBACK` | Mapa + **`mapa-incidencias-summary.js`** + `mapa-unit-actions.js` + quick incident seguro | **15C:** corrige visual real: elimina óvalo/curva, canvas oscuro dominante, celdas/unidades compactas y panel integrado. Funciones avanzadas no migradas siguen en mapa clásico |
| `/mensajes` | `/app/mensajes` | **APP_FIRST (12D)** · fallback legacy discreto | `obtenerMensajesPrivados`, `enviarMensajePrivado`, `marcarMensajesLeidosArray` | Conversaciones reales, email canónico, envío simple, leído al abrir, refresh, fallback para adjuntos/funciones avanzadas |
| `/cola-preparacion` | `/app/cola-preparacion` | **REAL_COMPLETA_VISUAL_PORT (13D)** · **APP_FIRST** | `cola_preparacion/{plaza}/items` | Port visual fuerte del layout legacy (command bar, board, cards, panel detalle y modal), con lógica App Shell segura: checklist/notas/salida/asignación/crear; acciones destructivas siguen en legacy |
| `/incidencias` | `/app/incidencias` | **REAL_COMPLETA_VISUAL_PORT (13E/13E.1)** · **APP_FIRST** | `suscribirNotasAdmin`, `guardarNuevaNotaDirecto`, `resolverNotaDirecto` | Port visual de bitácora legacy real (header KPI, tabs, filtros, historial/cards, formulario y bloque resolver); mantiene `notas_admin`, acciones seguras crear/resolver y evidencias solo lectura; adjuntos avanzados/borrado en legacy. **13E.1:** hotfix runtime para restaurar `_renderPreview` y eliminar `ReferenceError` en mount/interacción. |
| `/cuadre` | `/app/cuadre` | **OFICIAL_OPERATIVA** · `/cuadre` = `CLASSIC_FALLBACK` | `obtenerDatosFlotaConsola` + `cuadre/externos` + admins/historial (read) + `mapa-unit-actions.js` para mutaciones seguras si API/rol lo permiten | 15D oficializa Cuadre: redirect `/cuadre -> /app/cuadre`, escape `mex.legacy.force=1` o `?legacy=1`, header “Cuadre operativo”, KPIs ampliados, filtros, tabla 12 columnas, detalle, modales seguros de estado/notas/gas/listo, export CSV, copiar resumen y admins/historial read-only |
| `/gestion` | `/app/admin` | **REAL_PARCIAL_FUERTE (12H)** · `KEEP_LEGACY_BACKUP` | usuarios/solicitudes/roles/plazas/catálogos | Usuarios reforzado (tabla ampliada, timestamps, alertas onboarding, edición segura), Solicitudes con estado onboarding y acciones seguras, Roles/Plazas/Catálogos con detalle operativo real y fallback de edición en legacy |
| `/programador` | `/app/programador` | REAL_COMPLETA QA (12A) | Runtime | Beta readiness, smoke local, flags LS + limpieza local, estado Firestore transport y copia diagnóstico corto/completo + agrupación `window.api` por dominio |
| `/profile` | `/app/profile` | **REAL_COMPLETA_VISUAL_PORT (13C)** · **APP_FIRST** | `usuarios/{id}` + app-state | Port visual real de cards/tabs/hero/acciones del legacy dentro de App Shell, edición segura (nombre/teléfono/avatar/preferencias) y sync inmediato de sidebar |
| `/login` + `/solicitud` | N/A | HARDENED (12C) · **PUBLIC_FORM / DO_NOT_REDIRECT** | Auth + `solicitudes` + `usuarios` | Auth = identidad; acceso operativo depende de perfil Firestore activo/autorizado. `/solicitud` se mantiene pública y sin redirect |

## Clasificación

| Clave | Vista |
|-------|--------|
| REAL_COMPLETA_VISUAL_PORT | Dashboard (`/home` DOM portado), Profile (`/profile` DOM portado sin chrome legacy), Cola preparación (`/cola-preparacion` visual legacy en App Shell), Incidencias (`/incidencias` bitácora legacy en App Shell) |
| REAL_COMPLETA | Programador |
| PARIDAD OPERATIVA ALT (11G Cola reforzada) | — (elevado a REAL_COMPLETA_VISUAL_PORT en 13D) |
| REAL_PARCIAL | Mensajes (fuerte 11D), Cuadre, Admin |
| OFICIAL_OPERATIVA_COMPLETA_P1 | Mapa App (`/app/mapa` — oficial desde 15A, flujos P1 operativos desde 15B; mapa clásico conserva editor/PDF/altas/radar/reportes y funciones peligrosas no migradas) |

## Diseño legacy migrado (11A)

| Vista | Qué se acercó al legacy |
|-------|-------------------------|
| **Cola App** | `cola-preparacion.css`, clases `prep-list-card`, `prep-modal-*`, mismo modelo Firestore con checklist/nota/salida/asignación y modal de alta segura |
| **Mensajes App** | `mensajes.css` + grid `fleet-wrapper chatv2-layout` / `chatv2-contacts` |
| **Incidencias App** | Port visual de bitácora legacy `/mapa` (`incv2-*`, filtros prioridad/estado, cards `nota-*`, resolver modal y compose lateral) con estilos scopeados `css/app-incidencias.css` y datos `notas_admin` |
| **Mapa App (14A–15B)** | Misma normalización de celdas/unidades que el dominio (`mapa.model` / `unidad.model`), estructura `mapa_config` vía `suscribirEstructuraMapa`, flota vía `suscribirMapaPlaza`, grid de cajones + buckets limbo/taller/huérfanos, DnD con `mapa-dnd` + `guardarNuevasPosiciones`. **15B:** modales de acciones unitarias, incidencia rápida, mini bitácora y lista operativa |

## Funciones legacy reutilizadas

- Cola: Firestore directo mismo que `js/views/cola-preparacion.js` (crear doc, checklist, asignación, notas y salida).
- Mensajes: bridge `database.js` → `window.api` mensajes.
- Incidencias: `createIncidencia`, `resolveIncidencia`, `subscribeIncidencias`.
- Cuadre: `obtenerCuadreAdminsData`, `obtenerHistorialCuadres` (solo lectura segura).
- Profile: merge directo a `usuarios` (campos no sensibles) + `setState`.

## Acciones habilitadas / bloqueadas

| Vista | Habilitadas (App) | Bloqueadas / mapa clásico |
|-------|-------------------|---------------------|
| Cola | Checklist, notas/salida/asignación, crear salida, filtros operativos + global search | Reordenar DnD, bulk masivo y eliminar (se mantienen en legacy) |
| Incidencias | Crear, resolver, ver evidencias URL/objeto/path, prefill MVA por query | Borrar nota y subir/eliminar adjuntos en Storage → legacy |
| Mensajes | Enviar, refresco, agrupación email canónica, leído por conversación, filtros plaza/rol/estado | Adjuntos/subida, editar/eliminar/reacciones/push complejo |
| Cuadre | Refrescar, tabs, filtros avanzados (estado/categoría/ubicación/origen), copiar MVA/datos, export CSV local, copiar resumen filtrado, abrir App Mapa por MVA, abrir cuadre clásico, filtro fecha historial, búsqueda base maestra read-only, modales seguros de estado/notas/gas/listo cuando `aplicarEstado` + rol autorizado están disponibles | Alta/baja, masivos, cierre formal, PDF/reportes críticos, edición estructura/global y acciones destructivas |
| Mapa App | Ver flota + `mapa_config`, filtros rápidos (incl. incidencias), resumen `notas_admin` por MVA con mini bitácora, búsqueda global + `?q=`, lista/grid, detalle, **acciones operativas rápidas**, modales seguros de estado/notas/gas/lista, incidencia rápida si API existe, movimiento DnD con confirmación y guardado según rol/flags | Editor de estructura, editmap, PDF, altas masivas, eliminación/alta/masivo/cierre formal/reportes y mutaciones no disponibles del módulo de acciones → `/mapa?legacy=1` |
| Admin | Edición básica usuario + solicitudes seguras según permisos + detalle real de roles/plazas/catálogos | Crear/editar rol, jerarquía, editar plaza, editar catálogos, email/password/permisos sensibles, acciones masivas |
| Profile | Nombre/teléfono/avatar/preferencias visuales, sync estado shell | Email/rol/permisos/plazas/password |
| Programador | Smoke local, copiar reporte, flags LS, limpieza flags locales, navegación QA, inventario `window.api` | Mutaciones Firestore, reset SW automático, borrar cache destructivo |

## Pendiente paridad total

- Dashboard: paridad completa declarada en 13A (legacy queda fallback).
- Mapa editor vs `mapa.js` completo.
- Mensajes: faltan adjuntos completos y panel de info/archivo igual a legacy.
- Incidencias Kanban (`plazas/...`) vs mantener modelo único `notas_admin` (legacy Kanban sigue separado).
- Cuadre: oficial operativo desde 15D; PDF/insertar/eliminar global/cierre formal/masivos permanecen en cuadre clásico.
- Mapa App: vista oficial operativa completa P1 desde 15B; editor/layout masivo y herramientas clásicas avanzadas permanecen en `/mapa?legacy=1`. **14B-A:** capa de datos `mapa-incidencias-summary.js` integrada. **14F-B:** UI de acciones operativas seguras integrada. **14G:** port visual P0 implementado. **15A:** redirect `/mapa → /app/mapa` activado con escape `mex.legacy.force=1`. **15B:** modales, incidencia rápida, mini bitácora y lista operativa reforzada.
- Admin: faltan operaciones avanzadas de escritura global (roles/plazas/catálogos) que permanecen en legacy.
- Profile: migrado a visual real en 13C; diferencias menores aceptadas por contenedor App Shell y bloques operativos de solo lectura.

## Política de rutas (12D)

- `APP_FIRST`: `/home` (REAL_COMPLETA_VISUAL_PORT), `/profile` (REAL_COMPLETA_VISUAL_PORT), `/cola-preparacion` (REAL_COMPLETA_VISUAL_PORT), `/incidencias` (REAL_COMPLETA_VISUAL_PORT), `/mensajes`.
- `PUBLIC_FORM / DO_NOT_REDIRECT`: `/solicitud`.
- `APP_FIRST`: `/mapa` → `/app/mapa` desde 15A.
- `DO_NOT_REDIRECT`: `/editmap`.
- `KEEP_LEGACY_BACKUP`: `/gestion`, `/programador`.
- Escape global: si `localStorage["mex.legacy.force"] === "1"`, las rutas con redirect App-first permanecen en vista clásica y muestran CTA discreto para abrir App Shell. En `/mapa`, el CTA dice “Estás en mapa clásico · Abrir mapa operativo”.
- Redirect `/mapa -> /app/mapa`: **ACTIVADO** (15A; `/mapa` = `CLASSIC_FALLBACK` con `mex.legacy.force=1` o `?legacy=1`).
- Redirect `/cuadre -> /app/cuadre`: **ACTIVADO** en 15D (`/cuadre` = `CLASSIC_FALLBACK` con `mex.legacy.force=1` o `?legacy=1`; CTA “Estás en cuadre clásico · Abrir cuadre operativo”).
- Redirect `/gestion -> /app/admin`: **NO ACTIVADO** en 12H.

## Referencias

- **`docs/legacy-view-blueprints.md`** — blueprint por vista (16 campos).

## Service Worker

- **`CACHE_NAME`** `mapa-v278` (15D; Cuadre oficial App-first).
