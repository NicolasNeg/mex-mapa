# Inventario paridad vistas — Legacy vs App Shell (`/app/*`)

**Última actualización:** 2026-04-27 · **FASE 11A**

| Vista legacy | Vista App Shell | Estado | Fuente datos App | Paridad fuerte esta fase |
|--------------|-----------------|--------|------------------|---------------------------|
| `/home` | `/app/dashboard` | REAL_PARCIAL | KPIs/API | Inventario blueprint; sin cambios mayores |
| `/mapa` | `/app/mapa` | REAL_PARCIAL | Firestore/API mapa | Sin redirección legacy |
| `/mensajes` | `/app/mensajes` | REAL_PARCIAL · **CSS legacy** | `obtenerMensajesPrivados`, etc. | `mensajes.css` + layout `chatv2-*`; lógica ya alineada |
| `/cola-preparacion` | `/app/cola-preparacion` | **REAL_PARCIAL → PARIDAD OPERATIVA SUBIDA** | `cola_preparacion/{plaza}/items` | Tarjetas `prep-list-card`, modal crear, bulk checklist, DnD reorder, datalists plaza, borrado admin |
| `/incidencias` | `/app/incidencias` | REAL_PARCIAL · **`notas_admin`** | Suscripción incidencias-data | Carga `incidencias.css`; Kanban legacy (`/incidencias`) sigue otro modelo |
| `/cuadre` | `/app/cuadre` | REAL_PARCIAL | Cuadre por plaza | Pendiente pintura legacy |
| `/gestion` | `/app/admin` | REAL_PARCIAL · acciones beta | usuarios/solicitudes/… | Solicitudes/usuarios edición segura (FASE 10C+) |
| `/programador` | `/app/programador` | REAL_COMPLETA QA | Runtime | Sin cambios mayores |
| `/profile` | `/app/profile` | REAL_PARCIAL | Perfil sesión | Pendiente paridad total |

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

## Acciones habilitadas / bloqueadas

| Vista | Habilitadas (App) | Bloqueadas / Legacy |
|-------|-------------------|---------------------|
| Cola | Checklist, notas/salida/asignación, crear salida, reordenar, bulk (admin), borrar (admin dos toques) | — |
| Incidencias | Crear, resolver, ver evidencias URL | Borrar nota/adjuntos Storage masivo → legacy |
| Mensajes | Enviar, refresco, agrupación email | Adjuntos nuevos |

## Pendiente paridad total

- Dashboard vs `home.js` widgets.
- Mapa editor vs `mapa.js` completo.
- Mensajes UI 100% igual a `#buzon-modal` HTML.
- Incidencias Kanban (`plazas/...`) vs elegir unificar modelo (no hecho).
- Cuadre visual idéntico a `cuadre.css`.
- Admin gestión masiva como `gestion.js`.

## Referencias

- **`docs/legacy-view-blueprints.md`** — blueprint por vista (16 campos).

## Service Worker

- **`CACHE_NAME`** `mapa-v239` (11A).
