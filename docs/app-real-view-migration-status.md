# Inventario paridad vistas — Legacy vs App Shell (`/app/*`)

**Última actualización:** 2026-05-07 · **FASE 15H mapa** (migración total de funciones principales a `/app/mapa`)

| Vista legacy | Vista App Shell | Estado | Fuente datos App | Paridad fuerte esta fase |
|--------------|-----------------|--------|------------------|---------------------------|
| `/home` | `/app/dashboard` | **REAL_COMPLETA_VISUAL_PORT (13B)** · **APP_FIRST** | Igual que 13A (KPIs Firestore + mini mapa `buildMapaViewModel`) | UI copiada desde `renderHome` (grid bento, hero mapa, KPI columna, resumen + actividad); sin chrome legacy; búsqueda global vía hooks ocultos |
| `/mapa` | `/app/mapa` | **MAPA_COMPLETO_OFICIAL (15H)** · `/mapa` = `FALLBACK_TECNICO` | Mapa + `mapa-incidencias-summary.js` + `mapa-unit-actions.js` + `mapa-official-tools.js` | **15H:** conserva port visual 15G y agrega en Shell Radar, Reportes/PDF, Alta unidad, Alta masiva, Editar unidad, Eliminar unidad y Editar patio/layout con APIs existentes, roles autorizados, confirmación y resync; `sw.js` **mapa-v284** |
| `/mensajes` | `/app/mensajes` | **OFICIAL_OPERATIVA** · `/mensajes` = `CLASSIC_FALLBACK` | `obtenerMensajesPrivados`, `enviarMensajePrivado`, `marcarMensajesLeidosArray`, metadata `usuarios/{email}` read-only | 15E oficializa Mensajes: redirect `/mensajes -> /app/mensajes`, escape `mex.legacy.force=1` o `?legacy=1`, chat operativo con bandeja/conversaciones, bubbles mío/otro, filtros plaza/rol/no leídos/activos, identidad canónica por email, envío real, marca leído y adjuntos bloqueados al clásico |
| `/cola-preparacion` | `/app/cola-preparacion` | **REAL_COMPLETA_VISUAL_PORT (13D)** · **APP_FIRST** | `cola_preparacion/{plaza}/items` | Port visual fuerte del layout legacy (command bar, board, cards, panel detalle y modal), con lógica App Shell segura: checklist/notas/salida/asignación/crear; acciones destructivas siguen en legacy |
| `/incidencias` | `/app/incidencias` | **REAL_COMPLETA_VISUAL_PORT (13E/13E.1)** · **APP_FIRST** | `suscribirNotasAdmin`, `guardarNuevaNotaDirecto`, `resolverNotaDirecto` | Port visual de bitácora legacy real (header KPI, tabs, filtros, historial/cards, formulario y bloque resolver); mantiene `notas_admin`, acciones seguras crear/resolver y evidencias solo lectura; adjuntos avanzados/borrado en legacy. **13E.1:** hotfix runtime para restaurar `_renderPreview` y eliminar `ReferenceError` en mount/interacción. |
| `/cuadre` | `/app/cuadre` | **OFICIAL_OPERATIVA** · `/cuadre` = `CLASSIC_FALLBACK` | `obtenerDatosFlotaConsola` + `cuadre/externos` + admins/historial (read) + `mapa-unit-actions.js` para mutaciones seguras si API/rol lo permiten | 15D oficializa Cuadre: redirect `/cuadre -> /app/cuadre`, escape `mex.legacy.force=1` o `?legacy=1`, header “Cuadre operativo”, KPIs ampliados, filtros, tabla 12 columnas, detalle, modales seguros de estado/notas/gas/listo, export CSV, copiar resumen y admins/historial read-only |
| `/gestion` | `/app/admin` | **REAL_PARCIAL_FUERTE (12H)** · `KEEP_LEGACY_BACKUP` | usuarios/solicitudes/roles/plazas/catálogos | Usuarios reforzado (tabla ampliada, timestamps, alertas onboarding, edición segura), Solicitudes con estado onboarding y acciones seguras, Roles/Plazas/Catálogos con detalle operativo real y fallback de edición en legacy |
| `/programador` | `/app/programador` | REAL_COMPLETA QA (12A) | Runtime | Beta readiness, smoke local, flags LS + limpieza local, estado Firestore transport y copia diagnóstico corto/completo + agrupación `window.api` por dominio |
| `/profile` | `/app/profile` | **REAL_COMPLETA_VISUAL_PORT (13C)** · **APP_FIRST** | `usuarios/{id}` + app-state | Port visual real de cards/tabs/hero/acciones del legacy dentro de App Shell, edición segura (nombre/teléfono/avatar/preferencias) y sync inmediato de sidebar |
| **Centro vivo (campana header)** | App Shell global | **OFICIAL_OPERATIVO (15G)** | Mismo núcleo `js/core/notifications.js` + DOM modal en `notificaciones.css`: inbox Firestore `usuarios/{doc}/inbox` (límite 80), prefs en `devices/{deviceId}`, badge shell mezcla `getNotificationsSummary` + `unread` del inbox; rutas deep-link a `/app/mensajes`, `/app/cuadre`, `/app/mapa?notif=alerts` vía `notification-center.js` |
| `/login` + `/solicitud` | N/A | HARDENED (12C) · **PUBLIC_FORM / DO_NOT_REDIRECT** | Auth + `solicitudes` + `usuarios` | Auth = identidad; acceso operativo depende de perfil Firestore activo/autorizado. `/solicitud` se mantiene pública y sin redirect |

## Clasificación

| Clave | Vista |
|-------|--------|
| REAL_COMPLETA_VISUAL_PORT | Dashboard (`/home` DOM portado), Profile (`/profile` DOM portado sin chrome legacy), Cola preparación (`/cola-preparacion` visual legacy en App Shell), Incidencias (`/incidencias` bitácora legacy en App Shell) |
| REAL_COMPLETA | Programador |
| PARIDAD OPERATIVA ALT (11G Cola reforzada) | — (elevado a REAL_COMPLETA_VISUAL_PORT en 13D) |
| REAL_PARCIAL | Mensajes (fuerte 11D), Cuadre, Admin |
| OFICIAL_OPERATIVA_COMPLETA_P1 | Mapa App — elevado a **MAPA_COMPLETO_OFICIAL (15H)** |

## Diseño legacy migrado (11A)

| Vista | Qué se acercó al legacy |
|-------|-------------------------|
| **Cola App** | `cola-preparacion.css`, clases `prep-list-card`, `prep-modal-*`, mismo modelo Firestore con checklist/nota/salida/asignación y modal de alta segura |
| **Mensajes App** | `mensajes.css` + grid `fleet-wrapper chatv2-layout` / `chatv2-contacts` |
| **Incidencias App** | Port visual de bitácora legacy `/mapa` (`incv2-*`, filtros prioridad/estado, cards `nota-*`, resolver modal y compose lateral) con estilos scopeados `css/app-incidencias.css` y datos `notas_admin` |
| **Mapa App (14A–15H)** | Misma normalización de celdas/unidades que el dominio (`mapa.model` / `unidad.model`), estructura `mapa_config` vía `suscribirEstructuraMapa`, flota vía `suscribirMapaPlaza`, grid de cajones + buckets limbo/taller/huérfanos, DnD con `mapa-dnd` + `guardarNuevasPosiciones`. **15H:** Radar, Reportes/PDF, CRUD de unidad, altas masivas y editor de patio dentro del App Shell |

## Funciones legacy reutilizadas

- Cola: Firestore directo mismo que `js/views/cola-preparacion.js` (crear doc, checklist, asignación, notas y salida).
- Mensajes: bridge `database.js` → `window.api` mensajes.
- Incidencias: `createIncidencia`, `resolveIncidencia`, `subscribeIncidencias`.
- Cuadre: `obtenerCuadreAdminsData`, `obtenerHistorialCuadres` (solo lectura segura).
- Profile: merge directo a `usuarios` (campos no sensibles) + `setState`.

## Acciones habilitadas / bloqueadas

| Vista | Habilitadas (App) | Bloqueadas |
|-------|-------------------|---------------------|
| Cola | Checklist, notas/salida/asignación, crear salida, filtros operativos + global search | Reordenar DnD, bulk masivo y eliminar (se mantienen en legacy) |
| Incidencias | Crear, resolver, ver evidencias URL/objeto/path, prefill MVA por query | Borrar nota y subir/eliminar adjuntos en Storage → legacy |
| Mensajes | Enviar, refresco, agrupación email canónica, leído por conversación, filtros plaza/rol/estado/no leídos, búsqueda global, bubbles mío/otro, abrir clásico | Adjuntos/subida, editar/eliminar/reacciones/push complejo |
| Cuadre | Refrescar, tabs, filtros avanzados (estado/categoría/ubicación/origen), copiar MVA/datos, export CSV local, copiar resumen filtrado, abrir App Mapa por MVA, abrir cuadre clásico, filtro fecha historial, búsqueda base maestra read-only, modales seguros de estado/notas/gas/listo cuando `aplicarEstado` + rol autorizado están disponibles | Alta/baja, masivos, cierre formal, PDF/reportes críticos, edición estructura/global y acciones destructivas |
| Mapa App | Ver flota + `mapa_config`, filtros rápidos (incl. incidencias), resumen `notas_admin` por MVA con mini bitácora, búsqueda global + `?q=`, lista/grid, detalle, acciones operativas, modales seguros de estado/notas/gas/lista, incidencia rápida, DnD con confirmación, Radar, Reportes/PDF, Alta unidad, Alta masiva, Editar unidad, Eliminar unidad y Editar patio/layout | Acciones sin API segura o sin rol autorizado quedan deshabilitadas en la sesión |
| Admin | Edición básica usuario + solicitudes seguras según permisos + detalle real de roles/plazas/catálogos | Crear/editar rol, jerarquía, editar plaza, editar catálogos, email/password/permisos sensibles, acciones masivas |
| Profile | Nombre/teléfono/avatar/preferencias visuales, sync estado shell | Email/rol/permisos/plazas/password |
| Programador | Smoke local, copiar reporte, flags LS, limpieza flags locales, navegación QA, inventario `window.api` | Mutaciones Firestore, reset SW automático, borrar cache destructivo |

## Pendiente paridad total

- Dashboard: paridad completa declarada en 13A (legacy queda fallback).
- Mapa: matriz 15H documentada en `docs/mapa-paridad-total-15h.md`; validación visual autenticada queda a cargo del usuario.
- Mensajes: oficial operativo desde 15E; adjuntos completos, edición, borrado, reacciones complejas y archivo avanzado permanecen en mensajes clásico.
- Incidencias Kanban (`plazas/...`) vs mantener modelo único `notas_admin` (legacy Kanban sigue separado).
- Cuadre: oficial operativo desde 15D; PDF/insertar/eliminar global/cierre formal/masivos permanecen en cuadre clásico.
- Mapa App: **15H** completa funciones principales dentro de `/app/mapa`; `/mapa?legacy=1` queda como rollback técnico.
- Admin: faltan operaciones avanzadas de escritura global (roles/plazas/catálogos) que permanecen en legacy.
- Profile: migrado a visual real en 13C; diferencias menores aceptadas por contenedor App Shell y bloques operativos de solo lectura.

## Política de rutas (12D)

- `APP_FIRST`: `/home` (REAL_COMPLETA_VISUAL_PORT), `/profile` (REAL_COMPLETA_VISUAL_PORT), `/cola-preparacion` (REAL_COMPLETA_VISUAL_PORT), `/incidencias` (REAL_COMPLETA_VISUAL_PORT), `/mensajes`.
- `PUBLIC_FORM / DO_NOT_REDIRECT`: `/solicitud`.
- `APP_FIRST`: `/mapa` → `/app/mapa` desde 15A.
- `DO_NOT_REDIRECT`: `/editmap`.
- `KEEP_LEGACY_BACKUP`: `/gestion`, `/programador`.
- Escape global: si `localStorage["mex.legacy.force"] === "1"`, las rutas con redirect App-first permanecen en vista clásica y muestran CTA discreto para abrir App Shell. En `/mapa`, el CTA dice “Estás en mapa clásico · Abrir mapa operativo”.
- Redirect `/mapa -> /app/mapa`: **ACTIVADO** (15A; `/mapa` = `FALLBACK_TECNICO` con `mex.legacy.force=1` o `?legacy=1`).
- Redirect `/cuadre -> /app/cuadre`: **ACTIVADO** en 15D (`/cuadre` = `CLASSIC_FALLBACK` con `mex.legacy.force=1` o `?legacy=1`; CTA “Estás en cuadre clásico · Abrir cuadre operativo”).
- Redirect `/mensajes -> /app/mensajes`: **ACTIVADO** en 15E (`/mensajes` = `CLASSIC_FALLBACK` con `mex.legacy.force=1` o `?legacy=1`; CTA “Estás en mensajes clásico · Abrir mensajes operativo”).
- Redirect `/gestion -> /app/admin`: **NO ACTIVADO** en 12H.

## Referencias

- **`docs/legacy-view-blueprints.md`** — blueprint por vista (16 campos).
- **`docs/notificaciones-vista-oficial.md`** — Centro vivo: datos, tabs, fix RangeError 15G.

## Service Worker

- **`CACHE_NAME`** `mapa-v284` (15H mapa completo oficial).
