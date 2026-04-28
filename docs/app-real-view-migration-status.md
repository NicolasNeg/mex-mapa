# Inventario paridad vistas — Legacy vs App Shell (`/app/*`)

**Última actualización:** 2026-04-28 · **FASE 12C**

| Vista legacy | Vista App Shell | Estado | Fuente datos App | Paridad fuerte esta fase |
|--------------|-----------------|--------|------------------|---------------------------|
| `/home` | `/app/dashboard` | REAL_PARCIAL | KPIs/API | Inventario blueprint; sin cambios mayores |
| `/mapa` | `/app/mapa` | REAL_PARCIAL | Firestore/API mapa | Sin redirección legacy |
| `/mensajes` | `/app/mensajes` | REAL_PARCIAL fuerte (11D) · **CSS legacy** | `obtenerMensajesPrivados`, `enviarMensajePrivado`, `marcarMensajesLeidosArray` | Email canónico, dedupe por identidad, filtros plaza/rol/estado, leído al abrir, validaciones composer |
| `/cola-preparacion` | `/app/cola-preparacion` | **REAL_PARCIAL fuerte (11G)** | `cola_preparacion/{plaza}/items` | Tarjetas `prep-list-card`, checklist/nota/salida/asignación, modal crear, datalists por plaza, estados reales y listeners con cleanup |
| `/incidencias` | `/app/incidencias` | REAL_PARCIAL fuerte (11D) · **`notas_admin`** | `suscribirNotasAdmin`, `guardarNuevaNotaDirecto`, `resolverNotaDirecto` | UI bitácora operativa, crear/resolver con confirmación, evidencias URL/objeto, prefill `?mva=` |
| `/cuadre` | `/app/cuadre` | REAL_PARCIAL fuerte (11G) | Cuadre + externos + admins/historial (read) | Tabs reales (`regular/externos/admins/historial`), KPIs por estado/ubicación/categoría, notas en tabla, filtro fecha historial, búsqueda base maestra read-only y acciones seguras |
| `/gestion` | `/app/admin` | REAL_PARCIAL fuerte (12C) | usuarios/solicitudes/roles/plazas/catálogos | Usuarios: edición segura + plaza/plazasPermitidas/status/activo; Solicitudes: onboarding con estado de perfil relacionado y rechazo/aprobación reforzados |
| `/programador` | `/app/programador` | REAL_COMPLETA QA (12A) | Runtime | Beta readiness, smoke local, flags LS + limpieza local, estado Firestore transport y copia diagnóstico corto/completo + agrupación `window.api` por dominio |
| `/profile` | `/app/profile` | REAL_PARCIAL fuerte (12A) | `usuarios/{id}` + app-state | Secciones operativas/read-only, preferencias extendidas (tema/densidad/idioma/vista inicial/plaza default), validación avatar URL, sync sidebar |
| `/login` + `/solicitud` | N/A | HARDENED (12C) | Auth + `solicitudes` + `usuarios` | Auth = identidad; acceso operativo depende de perfil Firestore activo/autorizado. Mensajería de login robusta para no habilitados/rechazados |

## Clasificación

| Clave | Vista |
|-------|--------|
| REAL_COMPLETA (QA) | Programador |
| PARIDAD OPERATIVA ALT (11G Cola reforzada) | Cola preparación App |
| REAL_PARCIAL | Dashboard, Mapa App, Mensajes (fuerte 11D), Incidencias (`notas_admin`, fuerte 11D), Cuadre, Admin, Profile |

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
| Cuadre | Refrescar, tabs de lectura, copiar MVA/datos, abrir App Mapa por MVA, abrir legacy, filtro fecha historial, búsqueda base maestra read-only | Alta/baja, editar estado, cierre formal, PDF/reportes críticos, edición masiva |
| Admin | Edición básica usuario + solicitudes seguras según permisos + detalle real de roles/plazas/catálogos | Crear/editar rol, jerarquía, editar plaza, editar catálogos, email/password/permisos sensibles, acciones masivas |
| Profile | Nombre/teléfono/avatar/preferencias visuales, sync estado shell | Email/rol/permisos/plazas/password |
| Programador | Smoke local, copiar reporte, flags LS, limpieza flags locales, navegación QA, inventario `window.api` | Mutaciones Firestore, reset SW automático, borrar cache destructivo |

## Pendiente paridad total

- Dashboard vs `home.js` widgets.
- Mapa editor vs `mapa.js` completo.
- Mensajes: faltan adjuntos completos y panel de info/archivo igual a legacy.
- Incidencias Kanban (`plazas/...`) vs mantener modelo único `notas_admin` (legacy Kanban sigue separado).
- Cuadre: aún falta paridad 1:1 de controles avanzados (PDF/insertar/eliminar global/cierre oficial).
- Admin: faltan operaciones avanzadas de escritura global (roles/plazas/catálogos) que permanecen en legacy.
- Profile: faltan secciones completas legacy (atajos/notificaciones/seguridad profundas).

## Referencias

- **`docs/legacy-view-blueprints.md`** — blueprint por vista (16 campos).

## Service Worker

- **`CACHE_NAME`** `mapa-v250` (12C).
