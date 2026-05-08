# Legacy → App Shell — Blueprint real por vista

**Versión:** FASE 15G · **Fecha inventario:** 2026-05-07 · **Mapa `/app/mapa`:** port literal legacy (ver `docs/mapa-vista-real-oficial.md`)

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
| **CSS principal** | Legacy: Tailwind + `css/global.css`; App: `css/app-dashboard.css` (equiv. visual scope `.appdash`) |
| **Diseño visual** | Grid 12: hero mapa inmersivo + 3 KPI lateral + fila resumen glass + actividad (igual `renderHome`) |
| **Componentes** | Saludo/fecha/Actualizar; overlay Activas/Externos/Alertas; tarjetas Vehículos/Incidencias/Solicitudes; bloques actividad |
| **Acciones reales** | Navegar a `/app/*`, shortcuts |
| **`window.api` / mex-api** | Conteos vía Firestore donde aplica (`notas_admin`, solicitudes pendientes), `obtenerConfiguracion`-style |
| **Firestore** | `usuarios`, `settings`, métricas agregadas por vista |
| **Listeners** | Snapshot puntual / promesas — **no listeners globales nuevos sin cleanup** |
| **Seguras** | Navegación, lecturas |
| **Peligrosas** | Mutación masiva datos — solo en legacy |
| **Migrado App** | **REAL_COMPLETA_VISUAL_PORT (13B)**: mismo layout DOM que `home.js` `renderHome` (sin sidebar/topbar legacy); mini mapa con `buildMapaViewModel` como legacy; KPIs y métricas iguales; chips plaza/rol + empresa en resumen |
| **Falta paridad** | Diferencia solo por contenedor App Shell (padding/ancho); sin lista de módulos en el cuerpo (legacy tampoco la pintaba en main — navegación en sidebar App) |
| **Esta fase** | Búsqueda global: hooks ocultos con `data-module-text` para filtrar sin cambiar la vista |

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
| **Listeners** | Muchos en legacy; App usa `mapa-lifecycle` + `mapa-data` con cleanup al salir de `/app/mapa` |
| **Migrado App** | **OFICIAL_REAL_LEGACY_PORT (15G)**: DOM/canvas alineados a `mapa.html` (`.content`, KPIs, `map-stage` / `map-grid`, celdas `spot`, unidades `car`); estilos en `css/app-mapa.css` sin capa clara competidora ni toolbar de prueba; datos y DnD vía `mapa-lifecycle`, `mapa-renderer`, `mapa-dnd`, etc. |
| **Falta (P1/P2)** | Overlays finos, responsive real por dispositivo, zoom/pan nativo como clásico, editor `editmap`, radar/chat completo, PDF, altas masivas, eliminación/alta/masivo/cierre formal/reportes operativos avanzados → `/mapa?legacy=1` |
| **Esta fase** | 15F = port visual literal; `/mapa` App-first; clásico intacto con escape |

---

### 3. `/mensajes` → `/app/mensajes`

| Campo | Valor |
|-------|--------|
| **Ruta legacy** | `/mensajes.html` |
| **Ruta App** | `/app/mensajes` |
| **HTML** | Chat `chatv2-*`, `#buzon-modal`, `mensajes.html` |
| **JS** | `js/views/mensajes.js` |
| **CSS** | Legacy: Inline + `fleet-modal`/`chatv2-*`; App: `css/app-mensajes.css` |
| **`api`** | `obtenerMensajesPrivados`, `enviarMensajePrivado`, `marcarMensajesLeidosArray`, lecturas metadata de `usuarios/{email}` |
| **Firestore** | Colección mensajes privados (contrato mex-api) |
| **Migrado App** | **OFICIAL_OPERATIVA (15E)**: bandeja/conversaciones + chat oficial, bubbles mío/otro, composer, refresh, no leídos, búsqueda global, filtros plaza/rol/estado y última sincronización |
| **Identidad** | Canónica por email (`remitenteEmail`/`destinatarioEmail`) con fallback a nombre legacy; display name no define la clave de conversación |
| **Falta** | Adjuntos completos, edición, borrado, reacciones complejas y push avanzado |
| **Redirect** | **ACTIVADO 15E**: `/mensajes -> /app/mensajes`; clásico con `mex.legacy.force=1` o `?legacy=1` |
| **Esta fase** | Oficialización App-first sin romper `/mensajes?legacy=1` |

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

**Migrado App (13D)**

- Port visual fuerte del layout legacy dentro de App Shell (`command bar`, filtros/chips, board/lista, detalle contextual y modal de alta).
- Datos y flujo operativo mantenidos desde App: `cola_preparacion/{plaza}/items`, enriquecimiento de unidades, datalists de usuarios/MVA.
- Estados reales: loading, vacío total, sin resultados por filtro, permission denied y error operativo.
- Lifecycle seguro App Shell: `mount/unmount` con cleanup explícito de snapshot + `onPlazaChange` + `mex:global-search`.
- Acciones seguras conservadas: checklist toggle, marcar checklist completo con confirmación, asignarme, guardar notas/salida, crear salida.
- Acciones peligrosas se mantienen bloqueadas/fallback legacy: eliminar, bulk masivo y reorder DnD.

---

### 5. `/incidencias` vs `/app/incidencias`

**Dos productos legacy distintos:**

| Fuente | Ruta/página | Modelo Firestore |
|--------|-------------|------------------|
| **Kanban standalone** | `incidencias.html`, `js/views/incidencias.js` | `plazas/{plaza}/incidencias` (+ global según código) |
| **Bitácora operativa / mapa** | Modal mapa + App Shell | **`notas_admin`** vía API |

**App Shell usa `notas_admin`** (`subscribeIncidencias`, `createIncidencia`, `resolveIncidencia`) — mismo criterio que documentación previa.

**Migrado App (13E/13E.1)**: port visual completo de la bitácora legacy real (`/mapa` modal incidencias) dentro de App Shell: header KPI, tabs Historial/+Nueva, filtros de prioridad/estado, cards de historial, formulario de creación y modal de resolución.

**Migrado App 13E**:

- Prefill de MVA vía query (`/app/incidencias?mva=XXXX`) en formulario real.
- Evidencias robustas para string y objetos (`url/path/nombre`) con apertura segura cuando hay URL y fallback visual cuando solo existe path.
- Resolución con comentario obligatorio + confirmación explícita (compat `resolverNotaDirecto`).
- Se mantiene CTA a legacy para acciones avanzadas de adjuntos/eliminación.
- Hotfix 13E.1: se restauró el renderer de preview en `/app/incidencias` para eliminar `ReferenceError: _renderPreview is not defined` en carga e interacción.

**Falta Kanban standalone**: se mantiene en `/incidencias` legacy por decisión de fuente única App en `notas_admin`; no se migra el modelo `plazas/{plaza}/incidencias` en esta fase.

---

### 6. `/cuadre` → `/app/cuadre`

| Campo | Valor |
|-------|--------|
| **HTML** | `cuadre.html` |
| **JS** | `js/views/cuadre.js` |
| **CSS** | Legacy: estilos de `mapa.css` embebidos en `cuadre.html`; App: `css/app-cuadre.css` |
| **Migrado App** | **OFICIAL_OPERATIVA (15D)**: consola oscura densa en `js/app/views/cuadre.js` + `css/app-cuadre.css`, ahora ruta principal App-first |
| **Migrado App 15D** | Header “Cuadre operativo”, KPIs total/listos/sucio-mtto/externos/resguardo/sin ubicación, tabs `flota/externos/admins/historial/classic`, tabla 12 columnas, panel detalle, copiar MVA/JSON, abrir mapa App, filtros avanzados, export CSV, copiar resumen, búsqueda base maestra read-only y modales oficiales para estado/notas/gas/listo cuando la API segura + rol autorizado existen |
| **Falta** | Controles avanzados clásicos (PDF/insertar/eliminar/edición masiva/cierre formal) y acciones destructivas/globales |
| **Peligrosas bloqueadas** | Eliminar unidad, alta, masivos, cierre formal, PDF/reportes oficiales, edición estructura/global |
| **Redirect** | **ACTIVADO 15D**: `/cuadre -> /app/cuadre`; clásico queda con `mex.legacy.force=1` o `?legacy=1` |

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
| **Migrado App** | **REAL_COMPLETA_VISUAL_PORT (13C)** |
| **Migrado App 13C** | Port visual de estructura legacy (hero, tabs, cards de General/Preferencias/Accesos, copy y acciones guardar/cancelar) dentro de `contentEl` App Shell; sin sidebar/header legacy duplicados |
| **Lógica conservada App Shell** | Guardado seguro con `merge` a `usuarios`, `updatedFrom: "app_profile"`, sync `app-state` + `shell.setProfile`, restaurar/cancelar, validación avatar URL |
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

### Centro vivo — notificaciones (App Shell + legacy mapa)

| Campo | Valor |
|-------|--------|
| **Superficie** | Campana header App (`ShellLayout`) y sidebar legacy `btnNotificationCenter` cuando existe |
| **HTML / DOM** | `#notifications-center-modal` inyectado por `js/core/notifications.js` (`_ensureNotificationCenterDom`) |
| **CSS** | `css/notificaciones.css` (modal, chips, lista, settings); App: `css/app-notifications.css` (complemento responsive / kicker) |
| **App Shell** | `js/app/features/notifications/notification-center.js` — `configureNotifications` con `getState()` y rutas `/app/*`; `js/app/main.js` abre `openNotificationCenter` |
| **Legacy mapa** | `js/views/mapa.js` — `configureNotifications` + `initNotificationCenter` sin cambios destructivos en esta fase |
| **Firestore** | `usuarios/{docId}/inbox` (80 últimas por `timestamp`), `usuarios/{docId}/devices/{deviceId}` (prefs push + meta) |
| **Datos por tab** | Misma colección inbox; chips filtran por `type` (mensajes / cuadre=inventario / alert / solicitud+request). Sin fuentes extra por tab fuera del inbox |
| **Badge header App** | `getNotificationsSummary` + `getCurrentDeviceSnapshot().unread` |
| **15G RangeError** | Causa típica: `init` concurrente o `configure` que pisaba estado; mitigación: `autoConfigured` al `configureNotifications`, mutex en `initNotificationCenter`, `prefChangeGuard` en sync de checkboxes |

---

## Resumen de duplicaciones de modelo (evitar errores)

- **Incidencias Kanban** ≠ **notas_admin**. App = notas_admin.
- **Cola**: un solo modelo `cola_preparacion/{plaza}/items` legacy = App.

---

## Próximos pasos (roadmap técnico)

1. Consolidar `/solicitud` público como flujo canónico pre-login y validar duplicados/errores con QA.
2. Incidencias App: mantener hardening funcional (sin operaciones destructivas ni subida compleja de adjuntos), y conservar mapa clásico para flujo avanzado.
3. Mensajes App: layout chatv2 + mismas llamadas API.
4. Cerrar huecos de paridad visual restante en Cuadre/Admin/Profile.
5. Mantener Admin escritura sensible en legacy hasta auditar edición segura de roles/plazas/catálogos.
