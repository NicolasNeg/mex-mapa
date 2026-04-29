# Legacy → App Shell — Blueprint real por vista

**Versión:** FASE 12H · **Fecha:** 2026-04-28  

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
| **Migrado App** | **Parcial fuerte 11D**: lista conversaciones, envío, marca leído, refresco ~45s |
| **Migrado App 11D** | Identidad canónica por email, dedupe robusto conversación, filtros plaza/rol/estado con metadata de usuario, validaciones de composer y fallback adjuntos a legacy |
| **Falta** | Paridad visual chatv2 1:1 total y adjuntos completos en App |
| **Esta fase** | Refuerzo operativo sin romper `/mensajes` legacy |

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
| Reordenar DnD | ⚠️ | se mantiene en legacy en 11G por seguridad |
| Todas listas (bulk checklist) | ⚠️ | se mantiene en legacy en 11G |
| Eliminar | ⚠️ | se mantiene en legacy en 11G |

**Migrado App (11G)**

- Layout + tarjetas con clases legacy (`prep-list-card`), modal crear, checklist/nota/salida/asignación, datalists usuarios/MVA y enriquecimiento desde `cuadre/externos`.
- Estados de vista reales: loading, vacío general, sin resultados por filtro, permission denied y error operativo.
- Instrumentación debug de listeners (`__mexTrackListener`) en mount/subscription/cleanup.

---

### 5. `/incidencias` vs `/app/incidencias`

**Dos productos legacy distintos:**

| Fuente | Ruta/página | Modelo Firestore |
|--------|-------------|------------------|
| **Kanban standalone** | `incidencias.html`, `js/views/incidencias.js` | `plazas/{plaza}/incidencias` (+ global según código) |
| **Bitácora operativa / mapa** | Modal mapa + App Shell | **`notas_admin`** vía API |

**App Shell usa `notas_admin`** (`subscribeIncidencias`, `createIncidencia`, `resolveIncidencia`) — mismo criterio que documentación previa.

**Migrado App**: lista + detalle + crear + resolver + evidencias URL.

**Migrado App 11D**:

- Prefill de MVA vía query (`/app/incidencias?mva=XXXX`).
- Evidencias robustas para string y objetos (`url/path/nombre`) con apertura segura cuando hay URL.
- Confirmación de resolver y mensajes de estado más claros.

**Falta Kanban**: no duplicado en App por decisión de datos únicos (`notas_admin`). Legacy Kanban permanece en `/incidencias`.

---

### 6. `/cuadre` → `/app/cuadre`

| Campo | Valor |
|-------|--------|
| **HTML** | `cuadre.html` |
| **JS** | `js/views/cuadre.js` |
| **CSS** | Legacy: estilos de `mapa.css` embebidos en `cuadre.html`; App: `css/app-cuadre.css` |
| **Migrado App** | Consola patio operativa fuerte (`js/app/views/cuadre.js`) |
| **Migrado App 11B/11G/12F** | Tabs `flota/externos/admins/historial`, KPIs top estado/ubicación/categoría, tabla amplia con columna de última actualización, panel detalle lateral (copiar MVA/JSON, abrir mapa App y legacy), filtro por fecha historial, búsqueda base maestra read-only, filtros avanzados por estado/categoría/ubicación, export CSV local y copiar resumen filtrado |
| **Falta** | Controles avanzados legacy (PDF/insertar/eliminar/edición masiva/cierre formal) |
| **Peligrosas bloqueadas** | Eliminar unidad, editar estado global, insertar unidad, cierre formal, PDF/reportes oficiales, edición masiva |
| **Redirect** | **NO ACTIVADO** en 12G: `/cuadre` permanece legacy-first (`KEEP_LEGACY_BACKUP`) |

---

### 7. `/gestion` → `/app/admin`

| Campo | Valor |
|-------|--------|
| **HTML** | Incrustado en flujo gestión |
| **JS** | `js/views/gestion.js`, panel en `js/views/mapa.js` para solicitudes |
| **Migrado App** | `admin.js` + `admin-*.js` (solicitudes/usuarios con reglas 10C) |
| **Migrado App 11B** | Tabla usuarios extendida (teléfono/admin/global), tabs operativos mantienen fallback discreto |
| **Migrado App 11C/12A/12C/12H** | Roles con agrupación real de permisos + rasgos global/admin/operativo; Plazas con detalle operativo y métricas (usuarios, unidades aprox, roles por plaza); Catálogos con conteo, preview y búsqueda local; Solicitudes con estado de perfil relacionado y rechazo/aprobación endurecidos; Usuarios con tabla reforzada (plazasPermitidas, último acceso, actualizado), alertas onboarding y edición segura |
| **Solicitudes** | Callable `procesarSolicitudAcceso` (Functions) cuando permisos |
| **Peligrosas** | Alta masiva usuarios, permisos finos, edición de roles/plazas/catálogos — mantener en legacy |
| **Redirect** | **NO ACTIVADO** en 12H: `/gestion` permanece legacy-first (`KEEP_LEGACY_BACKUP`) |

---

### 8. `/programador` → `/app/programador`

| Campo | Valor |
|-------|--------|
| **HTML** | `programador.html` |
| **JS** | `js/views/programador.js`, App: `js/app/views/programador.js` |
| **Migrado App** | Diagnósticos, flags, smoke, enlaces SW |
| **Migrado App 11B** | Beta readiness + smoke local + copia reporte + estado SW/Firebase/API + flags LS seguras |
| **Migrado App 11C/12A** | Inventario buscable de funciones `window.api`, limpieza de flags locales y CTA de rutas clave QA, agrupación API por dominio y copia de diagnóstico completo |
| **Peligrosas** | Mutar prod Firestore desde App — bloqueado |

---

### 9. `/profile` → `/app/profile`

| Campo | Valor |
|-------|--------|
| **HTML** | `profile.html` |
| **JS** | `js/views/profile.js`, App: `profile.js` |
| **Migrado App** | Parcial |
| **Migrado App 11B/12A** | Hero visual + edición segura (nombre/teléfono/avatar/preferencias) + sync App Shell; secciones contexto/seguridad read-only y preferencias extendidas |
| **Bloqueado** | Email/rol/password sin flujo Firebase dedicado |

---

### 10. `/login` + `/solicitud` (onboarding acceso)

| Campo | Valor |
|-------|--------|
| **Ruta pública** | `/solicitud` |
| **Colección** | `solicitudes` (doc id = email normalizado) |
| **Regla clave** | público: create-only; sin read/list/update/delete |
| **Autorización operativa** | no depende solo de Auth; requiere perfil Firestore `/usuarios` activo/autorizado |
| **Migrado App 12C** | login bloquea sesiones sin perfil o perfil inactivo/rechazado y muestra mensajes claros de cuenta no habilitada |

---

## Resumen de duplicaciones de modelo (evitar errores)

- **Incidencias Kanban** ≠ **notas_admin**. App = notas_admin.
- **Cola**: un solo modelo `cola_preparacion/{plaza}/items` legacy = App.

---

## Próximos pasos (roadmap técnico)

1. Consolidar `/solicitud` público como flujo canónico pre-login y validar duplicados/errores con QA.
2. Incidencias App: skin + copy claros como bitácora `notas_admin`; link a Kanban legacy.
3. Mensajes App: layout chatv2 + mismas llamadas API.
4. Cerrar huecos de paridad visual restante en Cuadre/Admin/Profile.
5. Mantener Admin escritura sensible en legacy hasta auditar edición segura de roles/plazas/catálogos.
