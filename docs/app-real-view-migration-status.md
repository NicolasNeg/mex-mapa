# Inventario paridad vistas — Legacy vs App Shell (`/app/*`)

**Última actualización:** 2026-04-28 · **FASE 11D**

| Vista legacy | Vista App Shell | Estado | Fuente datos App | Paridad fuerte esta fase |
|--------------|-----------------|--------|------------------|---------------------------|
| `/home` | `/app/dashboard` | REAL_PARCIAL | KPIs/API | Inventario blueprint; sin cambios mayores |
| `/mapa` | `/app/mapa` | REAL_PARCIAL | Firestore/API mapa | Sin redirección legacy |
| `/mensajes` | `/app/mensajes` | REAL_PARCIAL fuerte (11D) · **CSS legacy** | `obtenerMensajesPrivados`, `enviarMensajePrivado`, `marcarMensajesLeidosArray` | Email canónico, dedupe por identidad, filtros plaza/rol/estado, leído al abrir, validaciones composer |
| `/cola-preparacion` | `/app/cola-preparacion` | **REAL_PARCIAL → PARIDAD OPERATIVA SUBIDA** | `cola_preparacion/{plaza}/items` | Tarjetas `prep-list-card`, modal crear, bulk checklist, DnD reorder, datalists plaza, borrado admin |
| `/incidencias` | `/app/incidencias` | REAL_PARCIAL fuerte (11D) · **`notas_admin`** | `suscribirNotasAdmin`, `guardarNuevaNotaDirecto`, `resolverNotaDirecto` | UI bitácora operativa, crear/resolver con confirmación, evidencias URL/objeto, prefill `?mva=` |
| `/cuadre` | `/app/cuadre` | REAL_PARCIAL (sube paridad) | Cuadre + externos + admins/historial (read) | Tabs reales (`regular/externos/admins/historial`), KPIs por estado/ubicación/categoría, detalle y acciones seguras |
| `/gestion` | `/app/admin` | REAL_PARCIAL fuerte (11C) | usuarios/solicitudes/roles/plazas/catálogos | Roles con permisos agrupados, plazas con detalle + unidades aprox, catálogos por secciones, solicitudes con detalle revisado |
| `/programador` | `/app/programador` | REAL_COMPLETA QA (11C) | Runtime | Beta readiness, smoke local, flags LS + limpieza local, SW/Firebase/config status y lista buscable `window.api` |
| `/profile` | `/app/profile` | REAL_PARCIAL (sube paridad) | `usuarios/{id}` + app-state | Hero + preview avatar + edición segura merge + sync sidebar |

## Clasificación

| Clave | Vista |
|-------|--------|
| REAL_COMPLETA (QA) | Programador |
| PARIDAD OPERATIVA ALT (11A Cola) | Cola preparación App |
| REAL_PARCIAL | Dashboard, Mapa App, Mensajes (fuerte 11D), Incidencias (`notas_admin`, fuerte 11D), Cuadre, Admin, Profile |

## Diseño legacy migrado (11A)

| Vista | Qué se acercó al legacy |
|-------|-------------------------|
| **Cola App** | `cola-preparacion.css`, clases `prep-list-card`, `prep-modal-*`, mismo modelo Firestore + batch orden/bulk/checklist/modal alta |
| **Mensajes App** | `mensajes.css` + grid `fleet-wrapper chatv2-layout` / `chatv2-contacts` |
| **Incidencias App** | Link a `incidencias.css` (uso futuro Kanban/skin; datos siguen siendo bitácora `notas_admin`) |

## Funciones legacy reutilizadas

- Cola: Firestore directo mismo que `js/views/cola-preparacion.js` (batch orden, crear doc, checklist).
- Mensajes: bridge `database.js` → `window.api` mensajes.
- Incidencias: `createIncidencia`, `resolveIncidencia`, `subscribeIncidencias`.
- Cuadre: `obtenerCuadreAdminsData`, `obtenerHistorialCuadres` (solo lectura segura).
- Profile: merge directo a `usuarios` (campos no sensibles) + `setState`.

## Acciones habilitadas / bloqueadas

| Vista | Habilitadas (App) | Bloqueadas / Legacy |
|-------|-------------------|---------------------|
| Cola | Checklist, notas/salida/asignación, crear salida, reordenar, bulk (admin), borrar (admin dos toques) | — |
| Incidencias | Crear, resolver, ver evidencias URL/objeto/path, prefill MVA por query | Borrar nota y subir/eliminar adjuntos en Storage → legacy |
| Mensajes | Enviar, refresco, agrupación email canónica, leído por conversación, filtros plaza/rol/estado | Adjuntos/subida, editar/eliminar/reacciones/push complejo |
| Cuadre | Refrescar, tabs de lectura, copiar MVA/datos, abrir App Mapa por MVA, abrir legacy | Alta/baja, editar estado, cierre formal, PDF/reportes críticos |
| Admin | Edición básica usuario + solicitudes seguras según permisos + detalle real de roles/plazas/catálogos | Crear/editar rol, jerarquía, editar plaza, editar catálogos, email/password/permisos sensibles, acciones masivas |
| Profile | Nombre/teléfono/avatar/preferencias visuales, sync estado shell | Email/rol/permisos/plazas/password |
| Programador | Smoke local, copiar reporte, flags LS, limpieza flags locales, navegación QA, inventario `window.api` | Mutaciones Firestore, reset SW automático, borrar cache destructivo |

## Pendiente paridad total

- Dashboard vs `home.js` widgets.
- Mapa editor vs `mapa.js` completo.
- Mensajes: faltan adjuntos completos y panel de info/archivo igual a legacy.
- Incidencias Kanban (`plazas/...`) vs mantener modelo único `notas_admin` (legacy Kanban sigue separado).
- Cuadre: aún falta paridad 1:1 de controles avanzados (PDF/insertar/eliminar global).
- Admin: faltan operaciones avanzadas de escritura global (roles/plazas/catálogos) que permanecen en legacy.
- Profile: faltan secciones completas legacy (atajos/notificaciones/seguridad profundas).

## Referencias

- **`docs/legacy-view-blueprints.md`** — blueprint por vista (16 campos).

## Service Worker

- **`CACHE_NAME`** `mapa-v242` (11D).
