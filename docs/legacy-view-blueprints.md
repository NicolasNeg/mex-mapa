# Legacy → App Shell — Blueprint real por vista

**Versión:** FASE 11A · **Fecha:** 2026-04-27  

Este documento es la **fuente del inventario técnico** para migración por paridad. La App Shell solo sustituye shell (header/sidebar), navegación SPA en `/app/*`, plaza global y búsqueda global; **no inventa modelo de datos.**

---

## Leyenda rápida

| Col | Significado |
|-----|-------------|
| **Migrado App** | Implementado en `/js/app/views/*.js` |
| **Paridad** | ¿UI + datos + acciones seguras alineadas con legacy? |

---

### 1. `/home` → `/app/dashboard`

| Campo | Valor |
|-------|--------|
| **Ruta legacy** | `/home.html` · arranque home |
| **Ruta App Shell** | `/app/dashboard` |
| **HTML principal** | `home.html` |
| **JS principal** | `js/views/home.js` |
| **CSS principal** | `css/global.css`, shells |
| **Diseño visual** | Dashboard de métricas, módulos por rol |
| **Componentes** | KPIs, tarjetas módulo, enlaces cortos |
| **Acciones reales** | Navegar a `/app/*`, shortcuts |
| **`window.api` / mex-api** | Conteos vía Firestore donde aplica (`notas_admin`, solicitudes pendientes), `obtenerConfiguracion`-style |
| **Firestore** | `usuarios`, `settings`, métricas agregadas por vista |
| **Listeners** | Snapshot puntual / promesas — **no listeners globales nuevos sin cleanup** |
| **Seguras** | Navegación, lecturas |
| **Peligrosas** | Mutación masiva datos — solo en legacy |
| **Migrado App** | **Parcial**: KPIs/resúmenes (`dashboard.js`) |
| **Falta paridad** | Widgets al nivel visual home legacy |
| **Esta fase** | Inventario; mejoras opcionales si tiempo |

---

### 2. `/mapa` → `/app/mapa`

| Campo | Valor |
|-------|--------|
| **Ruta legacy** | `/mapa.html` |
| **Ruta App** | `/app/mapa` |
| **HTML** | `mapa.html` (motor completo) |
| **JS** | `js/views/mapa.js` (principal), App: `js/app/views/mapa.js` + features |
| **CSS** | `css/mapa.css`, `css/config.css` |
| **Diseño** | Vista mapa patio, sidebar config, overlays |
| **Datos** | `mapa_config`, `cuadre`/`externos`/índices vía API |
| **Listeners** | Muchos en legacy; App usa bridge + lifecycle (`mapa-lifecycle.js`) |
| **Migrado App** | **Parcial**: grid/lista, filtros, read-only fuerte |
| **Falta** | Paridad editor completa con legacy |
| **Esta fase** | Sin redirección; mejoras opcionales solo |

---

### 3. `/mensajes` → `/app/mensajes`

| Campo | Valor |
|-------|--------|
| **Ruta legacy** | `/mensajes.html` |
| **Ruta App** | `/app/mensajes` |
| **HTML** | Chat `chatv2-*`, `#buzon-modal`, `mensajes.html` |
| **JS** | `js/views/mensajes.js` |
| **CSS** | Inline + `fleet-modal`/`chatv2-*` |
| **`api`** | `obtenerMensajesPrivados`, `enviarMensajePrivado`, lecturas desde `window.api` |
| **Firestore** | Colección mensajes privados (contrato mex-api) |
| **Migrado App** | **Parcial**: lista conversaciones, envío, marca leído, refresco ~45s |
| **Falta** | Paridad visual chatv2 1:1 (layout lateral + header degrade) |
| **Esta fase** | CSS/layout acercamiento + misma semántica de datos |

---

### 4. `/cola-preparacion` → `/app/cola-preparacion`

| Campo | Valor |
|-------|--------|
| **Ruta legacy** | `/cola-preparacion.html` |
| **Ruta App** | `/app/cola-preparacion` |
| **HTML** | Dos columnas: command bar + board + detail + modal crear |
| **JS** | `js/views/cola-preparacion.js` |
| **CSS** | `css/cola-preparacion.css` |

**Datos**

- Colección: `cola_preparacion/{plaza}/items`
- Campos reales: `mva`, `fechaSalida`, `checklist.{lavado,gasolina,docs,revision}`, `asignado`, `notas`, `orden`, timestamps

**Listeners**

- Legacy: `onSnapshot` sobre `items` — App: igual con cleanup en `unmount`

**Acciones legacy**

| Acción | Segura | Notas |
|--------|--------|-------|
| Checklist toggle | ✓ | merge campo anidado |
| Asignarme / notas / salida | ✓ | |
| Crear salida (modal) | ✓ | doc id = MVA típico |
| Reordenar DnD | ✓ | batch `orden` |
| Todas listas (bulk checklist) | ✓ | rol admin legacy |
| Eliminar | ⚠️ | Dos toques + `canDelete()` (meta admin) |

**Migrado App (11A)**

- Layout + tarjetas con clases legacy (`prep-list-card`), modal crear, bulk, DnD, borrado condicionado, datalists usuarios/MVA.

---

### 5. `/incidencias` vs `/app/incidencias`

**Dos productos legacy distintos:**

| Fuente | Ruta/página | Modelo Firestore |
|--------|-------------|------------------|
| **Kanban standalone** | `incidencias.html`, `js/views/incidencias.js` | `plazas/{plaza}/incidencias` (+ global según código) |
| **Bitácora operativa / mapa** | Modal mapa + App Shell | **`notas_admin`** vía API |

**App Shell usa `notas_admin`** (`subscribeIncidencias`, `createIncidencia`, `resolveIncidencia`) — mismo criterio que documentación previa.

**Migrado App**: lista + detalle + crear + resolver + evidencias URL.

**Falta Kanban**: no duplicado en App por decisión de datos únicos (`notas_admin`). Legacy Kanban permanece en `/incidencias`.

---

### 6. `/cuadre` → `/app/cuadre`

| Campo | Valor |
|-------|--------|
| **HTML** | `cuadre.html` |
| **JS** | `js/views/cuadre.js` |
| **CSS** | `css/cuadre.css` |
| **Migrado App** | Consola patio parcial (`js/app/views/cuadre.js`) |
| **Falta** | Paridad visual tabla/tabs/KPI legacy |
| **Peligrosas bloqueadas** | Eliminar unidad, cierre formal, PDF masivos |

---

### 7. `/gestion` → `/app/admin`

| Campo | Valor |
|-------|--------|
| **HTML** | Incrustado en flujo gestión |
| **JS** | `js/views/gestion.js`, panel en `js/views/mapa.js` para solicitudes |
| **Migrado App** | `admin.js` + `admin-*.js` (solicitudes/usuarios con reglas 10C) |
| **Solicitudes** | Callable `procesarSolicitudAcceso` (Functions) cuando permisos |
| **Peligrosas** | Alta masiva usuarios, permisos finos — preferir legacy |

---

### 8. `/programador` → `/app/programador`

| Campo | Valor |
|-------|--------|
| **HTML** | `programador.html` |
| **JS** | `js/views/programador.js`, App: `js/app/views/programador.js` |
| **Migrado App** | Diagnósticos, flags, smoke, enlaces SW |
| **Peligrosas** | Mutar prod Firestore desde App — bloqueado |

---

### 9. `/profile` → `/app/profile`

| Campo | Valor |
|-------|--------|
| **HTML** | `profile.html` |
| **JS** | `js/views/profile.js`, App: `profile.js` |
| **Migrado App** | Parcial |
| **Bloqueado** | Email/rol/password sin flujo Firebase dedicado |

---

## Resumen de duplicaciones de modelo (evitar errores)

- **Incidencias Kanban** ≠ **notas_admin**. App = notas_admin.
- **Cola**: un solo modelo `cola_preparacion/{plaza}/items` legacy = App.

---

## Próximos pasos (roadmap técnico)

1. Paridad fuerte Cola App ↔ `cola-preparacion.js` legacy.
2. Incidencias App: skin + copy claros como bitácora `notas_admin`; link a Kanban legacy.
3. Mensajes App: layout chatv2 + mismas llamadas API.
4. Cuadre / Admin / Profile: iteración por snapshots en fases siguientes.
