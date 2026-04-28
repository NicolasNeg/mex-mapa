# Inventario paridad vistas — Legacy vs App Shell (`/app/*`)

**Última actualización:** 2026-04-27 · **FASE 11B**

| Vista legacy | Vista App Shell | Estado | Fuente datos App | Paridad fuerte esta fase |
|--------------|-----------------|--------|------------------|---------------------------|
| `/home` | `/app/dashboard` | REAL_PARCIAL | KPIs/API | Inventario blueprint; sin cambios mayores |
| `/mapa` | `/app/mapa` | REAL_PARCIAL | Firestore/API mapa | Sin redirección legacy |
| `/mensajes` | `/app/mensajes` | REAL_PARCIAL · **CSS legacy** | `obtenerMensajesPrivados`, etc. | `mensajes.css` + layout `chatv2-*`; lógica ya alineada |
| `/cola-preparacion` | `/app/cola-preparacion` | **REAL_PARCIAL → PARIDAD OPERATIVA SUBIDA** | `cola_preparacion/{plaza}/items` | Tarjetas `prep-list-card`, modal crear, bulk checklist, DnD reorder, datalists plaza, borrado admin |
| `/incidencias` | `/app/incidencias` | REAL_PARCIAL · **`notas_admin`** | Suscripción incidencias-data | Carga `incidencias.css`; Kanban legacy (`/incidencias`) sigue otro modelo |
| `/cuadre` | `/app/cuadre` | REAL_PARCIAL (sube paridad) | Cuadre + externos + admins/historial (read) | Tabs reales (`regular/externos/admins/historial`), KPIs por estado/ubicación/categoría, detalle y acciones seguras |
| `/gestion` | `/app/admin` | REAL_PARCIAL · acciones beta seguras | usuarios/solicitudes/roles/plazas/catálogos | Tabla usuarios más completa (tel/admin/global) + edición básica segura |
| `/programador` | `/app/programador` | REAL_COMPLETA QA | Runtime | Beta readiness, smoke local, flags LS, SW/Firebase/API status |
| `/profile` | `/app/profile` | REAL_PARCIAL (sube paridad) | `usuarios/{id}` + app-state | Hero + preview avatar + edición segura merge + sync sidebar |

## Clasificación

| Clave | Vista |
|-------|--------|
| REAL_COMPLETA (QA) | Programador |
| PARIDAD OPERATIVA ALT (11A Cola) | Cola preparación App |
| REAL_PARCIAL | Dashboard, Mapa App, Mensajes, Incidencias (`notas_admin`), Cuadre, Admin, Profile |

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
| Incidencias | Crear, resolver, ver evidencias URL | Borrar nota/adjuntos Storage masivo → legacy |
| Mensajes | Enviar, refresco, agrupación email | Adjuntos nuevos |
| Cuadre | Refrescar, tabs de lectura, copiar MVA/datos, abrir App Mapa por MVA, abrir legacy | Alta/baja, editar estado, cierre formal, PDF/reportes críticos |
| Admin | Edición básica usuario + solicitudes seguras según permisos | Rol/permisos/email/password/eliminar usuario, acciones masivas |
| Profile | Nombre/teléfono/avatar/preferencias visuales, sync estado shell | Email/rol/permisos/plazas/password |
| Programador | Smoke local, copiar reporte, flags LS, navegación QA | Mutaciones Firestore, reset destructivo |

## Pendiente paridad total

- Dashboard vs `home.js` widgets.
- Mapa editor vs `mapa.js` completo.
- Mensajes UI 100% igual a `#buzon-modal` HTML.
- Incidencias Kanban (`plazas/...`) vs elegir unificar modelo (no hecho).
- Cuadre: aún falta paridad 1:1 de controles avanzados (PDF/insertar/eliminar global).
- Admin: faltan operaciones avanzadas y matrices de edición global.
- Profile: faltan secciones completas legacy (atajos/notificaciones/seguridad profundas).

## Referencias

- **`docs/legacy-view-blueprints.md`** — blueprint por vista (16 campos).

## Service Worker

- **`CACHE_NAME`** `mapa-v240` (11B).
