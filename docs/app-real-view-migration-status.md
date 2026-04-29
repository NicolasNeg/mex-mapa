# Inventario paridad vistas — Legacy vs App Shell (`/app/*`)

**Última actualización:** 2026-04-28 · **FASE 13A**

| Vista legacy | Vista App Shell | Estado | Fuente datos App | Paridad fuerte esta fase |
|--------------|-----------------|--------|------------------|---------------------------|
| `/home` | `/app/dashboard` | **REAL_COMPLETA (13A)** · **APP_FIRST** | KPIs/API + preview mapa real + pendientes por rol | Full parity operativa del home en App Shell; legacy solo fallback con `mex.legacy.force` |
| `/mapa` | `/app/mapa` | REAL_PARCIAL | Firestore/API mapa | Sin redirección legacy |
| `/mensajes` | `/app/mensajes` | **APP_FIRST (12D)** · fallback legacy discreto | `obtenerMensajesPrivados`, `enviarMensajePrivado`, `marcarMensajesLeidosArray` | Conversaciones reales, email canónico, envío simple, leído al abrir, refresh, fallback para adjuntos/funciones avanzadas |
| `/cola-preparacion` | `/app/cola-preparacion` | **APP_FIRST (12D)** · fallback legacy discreto | `cola_preparacion/{plaza}/items` | Listado/filtros reales, checklist, asignarme, notas/salida, crear salida, bulk/reorder/delete conservados en legacy |
| `/incidencias` | `/app/incidencias` | **APP_FIRST (12D)** · fallback legacy discreto | `suscribirNotasAdmin`, `guardarNuevaNotaDirecto`, `resolverNotaDirecto` | `notas_admin` reales, crear/resolver, evidencias URL/objeto/path, prefill `?mva=`, acciones complejas de adjuntos/borrado en legacy |
| `/cuadre` | `/app/cuadre` | **REAL_PARCIAL_FUERTE (12F/12G)** · `KEEP_LEGACY_BACKUP` | `obtenerDatosFlotaConsola` + `cuadre/externos` + admins/historial (read) | Consola de patio reforzada (tabla amplia + detalle lateral), tabs `regular/externos/admins/historial`, filtros operativos/chips + filtros por estado/categoría/ubicación, export CSV local, copiar resumen, copiar MVA/JSON, abrir App Mapa por MVA y fallback legacy |
| `/gestion` | `/app/admin` | **REAL_PARCIAL_FUERTE (12H)** · `KEEP_LEGACY_BACKUP` | usuarios/solicitudes/roles/plazas/catálogos | Usuarios reforzado (tabla ampliada, timestamps, alertas onboarding, edición segura), Solicitudes con estado onboarding y acciones seguras, Roles/Plazas/Catálogos con detalle operativo real y fallback de edición en legacy |
| `/programador` | `/app/programador` | REAL_COMPLETA QA (12A) | Runtime | Beta readiness, smoke local, flags LS + limpieza local, estado Firestore transport y copia diagnóstico corto/completo + agrupación `window.api` por dominio |
| `/profile` | `/app/profile` | REAL_PARCIAL fuerte (12A) | `usuarios/{id}` + app-state | Secciones operativas/read-only, preferencias extendidas (tema/densidad/idioma/vista inicial/plaza default), validación avatar URL, sync sidebar |
| `/login` + `/solicitud` | N/A | HARDENED (12C) · **PUBLIC_FORM / DO_NOT_REDIRECT** | Auth + `solicitudes` + `usuarios` | Auth = identidad; acceso operativo depende de perfil Firestore activo/autorizado. `/solicitud` se mantiene pública y sin redirect |

## Clasificación

| Clave | Vista |
|-------|--------|
| REAL_COMPLETA | Dashboard, Programador |
| PARIDAD OPERATIVA ALT (11G Cola reforzada) | Cola preparación App |
| REAL_PARCIAL | Mapa App, Mensajes (fuerte 11D), Incidencias (`notas_admin`, fuerte 11D), Cuadre, Admin, Profile |

## Diseño legacy migrado (11A)

| Vista | Qué se acercó al legacy |
|-------|-------------------------|
| **Cola App** | `cola-preparacion.css`, clases `prep-list-card`, `prep-modal-*`, mismo modelo Firestore con checklist/nota/salida/asignación y modal de alta segura |
| **Mensajes App** | `mensajes.css` + grid `fleet-wrapper chatv2-layout` / `chatv2-contacts` |
| **Incidencias App** | Link a `incidencias.css` (uso futuro Kanban/skin; datos siguen siendo bitácora `notas_admin`) |

## Funciones legacy reutilizadas

- Cola: Firestore directo mismo que `js/views/cola-preparacion.js` (crear doc, checklist, asignación, notas y salida).
- Mensajes: bridge `database.js` → `window.api` mensajes.
- Incidencias: `createIncidencia`, `resolveIncidencia`, `subscribeIncidencias`.
- Cuadre: `obtenerCuadreAdminsData`, `obtenerHistorialCuadres` (solo lectura segura).
- Profile: merge directo a `usuarios` (campos no sensibles) + `setState`.

## Acciones habilitadas / bloqueadas

| Vista | Habilitadas (App) | Bloqueadas / Legacy |
|-------|-------------------|---------------------|
| Cola | Checklist, notas/salida/asignación, crear salida, filtros operativos + global search | Reordenar DnD, bulk masivo y eliminar (se mantienen en legacy) |
| Incidencias | Crear, resolver, ver evidencias URL/objeto/path, prefill MVA por query | Borrar nota y subir/eliminar adjuntos en Storage → legacy |
| Mensajes | Enviar, refresco, agrupación email canónica, leído por conversación, filtros plaza/rol/estado | Adjuntos/subida, editar/eliminar/reacciones/push complejo |
| Cuadre | Refrescar, tabs de lectura, filtros avanzados (estado/categoría/ubicación), copiar MVA/datos, export CSV local, copiar resumen filtrado, abrir App Mapa por MVA, abrir legacy, filtro fecha historial, búsqueda base maestra read-only | Alta/baja, editar estado, cierre formal, PDF/reportes críticos, edición masiva |
| Admin | Edición básica usuario + solicitudes seguras según permisos + detalle real de roles/plazas/catálogos | Crear/editar rol, jerarquía, editar plaza, editar catálogos, email/password/permisos sensibles, acciones masivas |
| Profile | Nombre/teléfono/avatar/preferencias visuales, sync estado shell | Email/rol/permisos/plazas/password |
| Programador | Smoke local, copiar reporte, flags LS, limpieza flags locales, navegación QA, inventario `window.api` | Mutaciones Firestore, reset SW automático, borrar cache destructivo |

## Pendiente paridad total

- Dashboard: paridad completa declarada en 13A (legacy queda fallback).
- Mapa editor vs `mapa.js` completo.
- Mensajes: faltan adjuntos completos y panel de info/archivo igual a legacy.
- Incidencias Kanban (`plazas/...`) vs mantener modelo único `notas_admin` (legacy Kanban sigue separado).
- Cuadre: aún falta paridad 1:1 de controles avanzados (PDF/insertar/eliminar global/cierre oficial), por eso se mantiene en `KEEP_LEGACY_BACKUP`.
- Admin: faltan operaciones avanzadas de escritura global (roles/plazas/catálogos) que permanecen en legacy.
- Profile: faltan secciones completas legacy (atajos/notificaciones/seguridad profundas).

## Política de rutas (12D)

- `APP_FIRST`: `/home` (REAL_COMPLETA), `/profile`, `/mensajes`, `/cola-preparacion`, `/incidencias`.
- `PUBLIC_FORM / DO_NOT_REDIRECT`: `/solicitud`.
- `DO_NOT_REDIRECT`: `/mapa`, `/editmap`.
- `KEEP_LEGACY_BACKUP`: `/cuadre`, `/gestion`, `/programador`.
- Escape global: si `localStorage["mex.legacy.force"] === "1"`, las rutas con redirect App-first permanecen en legacy y muestran CTA discreto para abrir App Shell.
- Redirect `/cuadre -> /app/cuadre`: **NO ACTIVADO** en 12G.
- Redirect `/gestion -> /app/admin`: **NO ACTIVADO** en 12H.

## Referencias

- **`docs/legacy-view-blueprints.md`** — blueprint por vista (16 campos).

## Service Worker

- **`CACHE_NAME`** `mapa-v258` (13A).
