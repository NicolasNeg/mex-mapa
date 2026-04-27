# Auditoría técnica — Migración del mapa legacy a App Shell

**Fecha:** 2026-04-27  
**Alcance:** Análisis estático de `mapa.html`, `js/views/mapa.js`, `mex-api.js`, `js/core/database.js`  
**Modo:** Solo lectura. Ningún archivo fue modificado.  
**Estado de migración actual:** `/app/mapa` existe como bridge. Motor real intacto en `/mapa`.

---

## 1. Resumen ejecutivo

### Nivel de riesgo global: 🔴 ALTO

El módulo de mapa es el más complejo del sistema. No es un módulo con interfaz simple — es una aplicación completa embebida en una sola página, con 22 739 líneas de código JavaScript monolítico, 14+ modales, suscripciones Firestore a 8+ colecciones en tiempo real, drag-and-drop con persistencia, sistema de alertas con editor WYSIWYG, protocolo de auditoría de patio, y control granular de roles.

### Qué se puede migrar con bajo riesgo
- Header contextual (título, avatar, campana) → ya existe en Shell Header
- Cards de estado y métricas de plaza (read-only, sin listeners propios)
- Vistas de solo lectura: historial de logs, historial de alertas
- Modal de PDF de reservas (autónomo, no depende de Firestore)

### Qué es crítico y requiere planificación detallada
- Motor de suscripciones Firestore (`suscribirMapa`, `suscribirMapaPlaza`, `suscribirEstructuraMapa`) — deben tener lifecycle mount/unmount explícito
- Drag-and-drop de unidades — requiere DOM muy específico y eventos `passive: false` en touch
- Sistema de modales — 14+ modales con IDs fijos, sin stack de gestión
- Auditoría de patio — bloquea la UI completa con overlay, lógica de roles crítica
- Persistencia offline de Firestore (`enablePersistence`) — compartida entre tabs

### Estimación de complejidad
| Componente | Líneas aprox. | Riesgo |
|---|---|---|
| Inicialización y auth | ~800 | Medio |
| Render del mapa (celdas/zonas) | ~3 000 | Alto |
| Drag and drop (pointer + touch) | ~1 200 | Alto |
| Modales y formularios | ~5 000 | Medio |
| Firestore listeners | ~600 | Muy Alto |
| Sistema de alertas | ~2 500 | Medio |
| Configuración global | ~2 000 | Medio |
| Historial y logs | ~1 500 | Bajo |
| Auditoría de patio | ~900 | Muy Alto |
| Mensajería interna | ~1 200 | Medio |
| Permisos y roles | ~400 | Medio |
| Utilidades y helpers | ~3 000 | Bajo |

---

## 2. Dependencias de mapa.html

### 2.1 Contenedores principales

| ID | Rol |
|---|---|
| `mapaLeftSidebarContainer` | Sidebar izquierdo (inyectado por `ShellSidebar` legacy) |
| `mapaMainStage` | Escenario principal del mapa, recibe clases `shell-main-stage shell-main-offset` |
| `global-status-banner` | Banner de estado global (oculto por defecto) |
| `overlayAuditoria` | Overlay que bloquea UI durante protocolo de auditoría |
| `auditViewAdmin` | Vista admin durante auditoría (`audit-card-pill`) |
| `auditViewUser` | Vista usuario bloqueada (`audit-card-intrusive`) |
| `offline-banner` | Banner de desconexión de red |

### 2.2 Scripts cargados (en orden)

```
Firebase SDK v10.12.0 (compat):
  firebase-app-compat / firestore / auth / storage / functions / messaging

/config.js              → expone window.FIREBASE_CONFIG
/js/core/firebase-init.js
/mex-api.js             → expone window.api (monolítico legacy)

Módulos API modularizados:
  /api/helpers.js
  /api/auth.js
  /api/mapa.js
  /api/cuadre.js
  /api/externos.js
  /api/flota.js
  /api/alertas.js
  /api/notas.js
  /api/historial.js
  /api/settings.js
  /api/users.js
  /api/_assemble.js     → ensambla todo en window.api

/js/core/app-bootstrap.js
/js/views/mapa.js       → controlador principal (22 739 líneas)
```

**Nota:** El proyecto está en transición arquitectónica. `mex-api.js` (monolítico) y los módulos `/api/*.js` (modulares) coexisten. `_assemble.js` ensambla los módulos en `window.api` sobreescribiendo el objeto legacy. Ambas arquitecturas exponen la misma API pública.

### 2.3 CSS necesarios

- `/css/global.css` (con partes específicas de mapa: `.shell-*`, `.mapa-*`)
- `/css/mapa.css` — Sistema de componentes propio: celdas, zonas, cars, overlays, modales fleet

### 2.4 IDs usados por mapa.js (selección crítica)

Estos IDs son referenciados por `mapa.js` mediante `getElementById` o `querySelector`. Moverlos, renombrarlos o eliminarlos rompe el módulo:

```
mapaMainStage, mapaLeftSidebarContainer, global-status-banner,
overlayAuditoria, auditViewAdmin, auditViewUser,
customModal, modalIcon, modalTitle, modalText, modalConfirmBtn,
logs-modal, logsBuscador, logsFecha, logsTipo, logsUsuario, logsContador, logs-table-body,
gestor-alertas-modal, alertaHistStatsBar, alertaHistBuscador, alertaHistTipo, alertaHistModo, listaHistorialAlertas,
reserveModal, reserveReason, btnConfirmRes, resIcon, resTitle, resText,
crear-alerta-modal, alertaNuevaTipo, alertaAutorModo, alertaAutorCustom,
alertaBannerCustomToggle, alertaBannerLabel, alertaBannerBg, alertaBannerText,
destBtnGlobal, destBtnSel, destBtnSolo, destBuscadorUsuarios, destListaCheckboxes, destSoloUsuario,
modoCardInterr, modoCardPasiva, alertaModoActual,
alertaNuevaTitulo, alertaFile, alertaNuevaImagen, btnQuitarImagenAlerta,
alertaActionType, alertaActionLabel, alertaActionValue, alertaActionExtra,
alertaColorPicker, alertaEditorCuerpo, alertaEditorStats,
alertaPreviewBanner, alertaPreviewTitulo, alertaPreviewMensaje, alertaPreviewActionBtn,
alertaPlantillasSelect, btnEmitirAlertaGlobal,
modal-config-global, cfg-tab-usuarios, cfg-tab-roles, cfg-tab-solicitudes,
cfg-tab-estados, cfg-tab-categorias, cfg-tab-modelos, cfg-tab-gasolinas,
cfg-tab-plazas, cfg-tab-ubicaciones, cfg-tab-empresa, cfg-tab-programador,
cfg-action-bloqueo-patio, cfg-lista-items, cfg-search-input, badge-config-solicitudes,
modal-cfg-add, cfg-add-name, cfg-add-is-plaza, cfg-add-ubi-plaza, cfg-add-color,
cfg-add-orden, cfg-add-modelo-cat, cfg-add-modelo-file, cfg-add-color-presets,
modal-nueva-plaza, nueva-plaza-id, nueva-plaza-nombre, nueva-plaza-descripcion,
mex-dialog-overlay, mex-dlg-icon, mex-dlg-title, mex-dlg-text, mex-dlg-input,
mex-dlg-confirm, mex-dlg-cancel, mex-dlg-extra,
modal-comparador-plazas, modal-recordatorio, recordatorio-mva, recordatorio-fecha, recordatorio-mensaje,
modal-pdf-reservas, pdf-drop-zone, pdf-file-input, pdf-texto-bruto, btn-analizar-pdf, pdf-resultados,
popover-evidencia, popover-evidencia-img, popover-evidencia-label,
pwa-install-banner, pwa-install-banner-ios, pwa-install-btn, pwa-dismiss-btn, pwa-dismiss-ios-btn
```

---

## 3. Dependencias globales

### 3.1 Variables de configuración

| Variable | Origen | Uso en mapa |
|---|---|---|
| `window.FIREBASE_CONFIG` | `/config.js` | Inicialización Firebase en `mex-api.js` |
| `window.MEX_CONFIG` | `app-bootstrap.js` + Firestore | Empresa, plazas, estados, categorías, modelos, gasolinas |
| `window.MEX_CONFIG.empresa.plazas` | Firestore `configuracion/empresa` | Lista de plazas del sistema |
| `window.MEX_CONFIG.empresa.plazasDetalle` | Firestore `configuracion/empresa` | Emails, gerentes por plaza |
| `window.MEX_CONFIG.empresa.security.roles` | Firestore `configuracion/empresa` | Definición de permisos por rol |
| `window.__mexConfigReadyPromise` | `app-bootstrap.js` | Mapa espera esta Promise antes de arrancar |
| `window.__mexEnsureConfigLoaded(plaza)` | `app-bootstrap.js` | Recarga config por plaza específica |

### 3.2 Variables de plaza activa

| Variable | Setter | Getter | Persistencia |
|---|---|---|---|
| `window.__mexCurrentPlazaId` | `setMexCurrentPlaza()` | `getMexCurrentPlaza()` | `sessionStorage` + `localStorage` |
| `window.PLAZA_ACTIVA_MAPA` | mapa.js interno | mapa.js interno | Solo memoria |
| `window.PLAZA_ACTUAL_EMAIL` | `refreshPlazaEmailGlobals()` | Directo | Solo memoria |

**Riesgo:** `PLAZA_ACTIVA_MAPA` es una variable propia de mapa.js que no está sincronizada con el sistema de App Shell. Si el shell cambia de plaza, mapa puede quedar desincronizado.

### 3.3 Variables de usuario

| Variable | Origen | Uso |
|---|---|---|
| `window.CURRENT_USER_PROFILE` | mapa.js (inicialización) | Perfil completo del usuario autenticado |
| `window.__mexSeedCurrentUserRecordCache(profile, user)` | `app-bootstrap.js` | Cachea perfil para otras partes del sistema |
| `window.__mexGetLastLocationAuditPayload()` | `app-bootstrap.js` | Payload de auditoría de ubicación |
| `window.__mexGetExactLocationSnapshot()` | `app-bootstrap.js` | Snapshot de geolocalización |
| `window.__mexPendingShellSearch` | Shell legacy | Búsqueda pendiente entre páginas |

### 3.4 Funciones globales expuestas por mapa.js

```javascript
// Modales
window.cerrarCustomModal()
window.mostrarCustomModal(titulo, texto, icono, color, textConfirm, colorBtn, onConfirm)
window.showToast(msg, type)
window.cerrarReserveModal()
window.confirmarReserva()

// Alertas
window.emitirAlertaGlobal()
window.cargarPlantillaSeleccionada()
window.guardarComoPlantilla()

// Configuración
window.abrirTabConfig(tabName, elemento)
window._cfgToggleSidebarPin()
window._cfgQuickAction(action)

// Helpers de permisos
window._miPlaza()             → string: plaza activa del usuario
window._puedeVerTodasPlazas() → boolean
window.hasPermission(key, profile, role) → boolean
window.canManageUsers()
window.canEmitMasterAlerts()
window.canEditAdminCuadre()
window.canViewAdminCuadre()
window.canUseProgrammerConfig()
window.canViewExactLocationLogs()
window.canLockMap()
window.canInsertExternalUnits()
window.hasFullAccess()
window.canViewAdminUsers()
```

### 3.5 Eventos globales usados/emitidos

| Evento | Dirección | Descripción |
|---|---|---|
| `mex-location-updated` | Escucha (línea 2477) | Actualización de ubicación GPS |
| `mex:plaza-change` | Emite + Escucha | Cambio de plaza activa |
| `afterprint` | Escucha | Limpieza post-impresión |
| `visibilitychange` | Escucha | Detecta tab oculta |
| `pagehide` | Escucha | Detecta cierre/navegación |
| `popstate` | Escucha (líneas 1827, 1873) | Cambios de historia del navegador |

---

## 4. Firestore y datos

### 4.1 Colecciones

| Colección | Operación | Tipo | Quién |
|---|---|---|---|
| `cuadre` | Read + Write | Realtime (`onSnapshot`) | `suscribirMapa`, `suscribirMapaPlaza`, `aplicarEstado`, `insertarUnidadDesdeHTML` |
| `externos` | Read + Write | Realtime (`onSnapshot`) | `suscribirMapa`, `suscribirMapaPlaza`, `insertarUnidadExterna` |
| `mapa_config/{plaza}/estructura` | Read + Write | One-shot + Realtime | `obtenerEstructuraMapa`, `suscribirEstructuraMapa`, `guardarEstructuraMapa` |
| `usuarios` | Read | Realtime (`onSnapshot`) | Líneas 2625, 6308 — live update de usuarios |
| `settings/{plaza}` | Read | Realtime (`onSnapshot`) | Línea 8363 — config de plaza |
| `settings/GLOBAL` | Read | Realtime (`onSnapshot`) | Línea 8371 — config global |
| `alertas` | Read + Write | Realtime (`onSnapshot`) | Línea 8379 — últimas 50 alertas |
| `mensajes` | Read + Write | Realtime (`onSnapshot`) | Líneas 8387, 13262, 13271 — mensajería |
| `notas_admin` | Read + Write | Realtime (`onSnapshot`) | Línea 8395 — notas pendientes |
| `logs` | Read + Write | One-shot | Historial de cambios |
| `historial_cuadres` | Read + Write | One-shot | Historial de cuadres |
| `auditoria` | Read + Write | One-shot | Protocolo de auditoría |
| `plantillas_alertas` | Read + Write | One-shot | Plantillas de alertas |
| `configuracion/empresa` | Read | One-shot | Config empresa y listas |
| `configuracion/listas` | Read | One-shot | Listas del sistema |

### 4.2 Suscripciones realtime activas al cargar el mapa

Todas se activan en la función de inicialización de mapa.js (alrededor de las líneas 8360–8400):

```javascript
// 1. Configuración de plaza
db.collection('settings').doc(plaza).onSnapshot(...)

// 2. Configuración global
db.collection('settings').doc('GLOBAL').onSnapshot(...)

// 3. Alertas recientes (últimas 50)
db.collection('alertas').orderBy('timestamp', 'desc').limit(50).onSnapshot(...)

// 4. Mensajes recibidos
db.collection('mensajes').where('destinatario', '==', USER_NAME).onSnapshot(...)

// 5. Notas admin pendientes
db.collection('notas_admin').where('estado', '==', 'PENDIENTE').onSnapshot(...)

// 6. Unidades del mapa (cuadre + externos — dos listeners)
db.collection(COL.CUADRE).onSnapshot(...)
db.collection(COL.EXTERNOS).onSnapshot(...)

// 7. Estructura del mapa
db.collection('mapa_config').doc(plaza).collection('estructura').onSnapshot(...)

// 8. Usuarios (para dropdowns internos)
db.collection(COL.USERS).onSnapshot(...)   // al menos dos instancias
```

**Total: mínimo 9 suscripciones simultáneas al arrancar.**

### 4.3 Limpieza de listeners

**No existe un `unmount()` centralizado.** Las funciones de unsubscribe que retorna `suscribirMapa()` y `suscribirMapaPlaza()` existen, pero los listeners abiertos directamente en `mapa.js` (líneas 2625, 6308, 8363–8395) no tienen referencias guardadas en ninguna estructura de cleanup accesible desde fuera.

**Riesgo de listeners duplicados:** Si el componente se monta dos veces sin haber limpiado los listeners del montaje anterior (posible si el router reutiliza el contenedor sin invocar `unmount()`), se acumularán suscripciones. Con 9+ listeners y un ciclo de mount/unmount, el riesgo de duplicados es alto.

### 4.4 Persistencia offline

```javascript
db.enablePersistence({ synchronizeTabs: true })
```

Activo en `mex-api.js`. Una sola pestaña puede tomar el lock. Si el mapa corre en paralelo con otras rutas del App Shell, hay riesgo de conflicto de persistencia si se abre en una nueva tab.

---

## 5. Drag and drop

### 5.1 Funciones involucradas

| Función | Evento | Sujeto |
|---|---|---|
| `_handleMapCarDragStart` | `dragstart` | Unidad (car element) |
| `_handleMapCarDragEnd` | `dragend` | Unidad |
| `_handleMapZoneDragOver` | `dragover` | Zona/celda destino |
| `_handleMapZoneDrop` | `drop` | Zona/celda destino |
| `_handleMapPointerDown` / `_handleMapCarPointerDown` | `pointerdown` | Unidad |
| `_handleMapCarTouchStart` | `touchstart` | Unidad (mobile) |
| `_handleMapTouchDragMove` | `touchmove` | Documento (mobile drag) |
| `_handleMapTouchDragEnd` | `touchend` / `touchcancel` | Documento (mobile) |

Además hay listeners globales en `document` para `dragover`, `drop`, `pointermove`, `pointerup`, `pointercancel` que gestionan el estado del drag en curso.

### 5.2 DOM requerido

El DnD asume que el DOM tiene esta jerarquía:
```
#mapaMainStage
  └─ .mapa-viewport (wheel, touch listeners)
       └─ .mapa-zona (dragover, drop listeners)
            └─ .mapa-car[draggable="true"] (dragstart, dragend, pointerdown, touchstart)
```

Los atributos `data-mva`, `data-zona`, `data-celda`, `data-plaza` en cada `.mapa-car` son leídos por los handlers de drop para identificar qué unidad se movió y a qué celda.

### 5.3 Eventos con `passive: false`

```javascript
// Críticos — deben ser non-passive para preventDefault()
viewport.addEventListener('touchmove', _handleMapTouchMove, { passive: false });
document.addEventListener('touchmove', ..., { passive: false });
```

Estos listeners no pueden vivir en un `<iframe>` ni en un Shadow DOM sin reconfiguración, ya que deben poder llamar `preventDefault()` para bloquear el scroll del navegador durante un drag touch.

### 5.4 Qué datos modifica el DnD

Al finalizar un drop exitoso:
1. Llama `guardarNuevasPosiciones(reporte, usuarioResponsable, plaza, extra)`
2. Que hace batch updates en `cuadre` / `externos`: campos `ubicacion`, `estado`, `_updatedAt`, `_updatedBy`
3. Inserta registro en `logs` con tipo `MOVE`
4. Re-renderiza el mapa (los listeners `onSnapshot` disparan automáticamente)

### 5.5 Riesgos al mover DnD a /app/mapa

- Los listeners `passive: false` en `document` o `viewport` son globales. Si el mapa se monta dentro de un `div` del shell, los eventos de touch bubble hasta `document` normalmente — no es un bloqueante técnico, pero requiere verificación en dispositivos reales.
- El viewport de zoom y pan del mapa necesita un contenedor con `overflow: hidden` y `position: relative` de dimensiones fijas o calculadas. El layout del App Shell (sidebar + header + `contentEl`) debe garantizar que `contentEl` tenga dimensiones correctas.
- El z-index de los overlays del mapa (hasta z-index 70000) puede colisionar con el header del shell (que usa z-index 1100).

---

## 6. Plaza activa

### 6.1 Cómo se detecta al arrancar el mapa

```javascript
// mapa.js al iniciar:
1. Intenta leer window.__mexCurrentPlazaId (puente de app-bootstrap.js)
2. Fallback a sessionStorage ('mex.activePlaza.v1')
3. Fallback a localStorage ('mex.activePlaza.local.v1')
4. Fallback al campo plazaAsignada del perfil del usuario
5. Si no hay ninguna → pide al usuario seleccionarla en un selector
```

### 6.2 Cómo se guarda

- `window.PLAZA_ACTIVA_MAPA` — en memoria, solo mapa.js
- `window.__mexCurrentPlazaId` — sincronizado con `setMexCurrentPlaza()`
- `sessionStorage['mex.activePlaza.v1']`
- `localStorage['mex.activePlaza.local.v1']`

Cuando el usuario cambia de plaza dentro del mapa: se llama `setMexCurrentPlaza(plaza)` → emite evento `mex:plaza-change` → recarga datos del mapa para la nueva plaza.

### 6.3 Cómo se comparte con el resto del sistema

El evento `mex:plaza-change` es el canal de sincronización. Si la App Shell no escucha este evento, el shell y el mapa pueden mostrar plazas diferentes.

`app-state.js` tiene `currentPlaza` pero no está sincronizado con el sistema de plazas de `app-bootstrap.js`. **Deuda técnica:** hay dos sistemas de plaza activa en paralelo que no se hablan.

### 6.4 Riesgo al cambiar de plaza dentro de App Shell

Si el usuario está en `/app/mapa` y cambia de plaza, el mapa re-suscribe sus listeners (cierra los anteriores, abre nuevos para la plaza nueva). Esto es correcto en el flujo legacy.

El riesgo es que si la App Shell también tiene lógica de plaza (para mostrar info en el sidebar o dashboard), cambia de plaza en el shell pero el mapa ya cerró y re-abrió sus propios listeners sin que el shell lo sepa. Requiere que `app-state.js` escuche `mex:plaza-change` para mantenerse sincronizado.

---

## 7. Header y sidebar legacy

### 7.1 Qué partes del mapa dependen del header viejo

El mapa inyecta su propio sidebar en `#mapaLeftSidebarContainer` usando `ShellSidebar` (el componente de Fase 1 del shell). Este sidebar legacy del mapa tiene su propio estado de colapso y navegación.

El mapa NO depende del header HTML de las páginas legacy (`.mex-topbar`, etc.) — ya fue abstraído en `ShellHeader` en Fase 1. Esto es una ventaja: el mapa ya usa los componentes del shell modular.

### 7.2 Qué partes ya podrían usar Shell Header del App Shell

- Título contextual (`setTitle()`) → ya disponible en `ShellHeader.setTitle()`
- Badge de campana → ya disponible en `ShellHeader.setBellBadge()`
- Avatar del usuario → ya disponible en `ShellHeader.setProfile()`

El App Shell ya monta su propio `ShellHeader`. Si el mapa se monta dentro del App Shell, no debe montar otro `ShellHeader` — debe reutilizar el que ya existe.

### 7.3 Funciones que deberían moverse a header contextual

- Badge de alertas no leídas (actualmente actualiza un elemento del header legacy)
- Contador de mensajes no leídos (ídem)
- Indicador de plaza activa (podría ir en el header como chip)

---

## 8. Modales y overlays

### 8.1 Inventario completo

| ID | Tipo | Criticidad | Depende de IDs fijos |
|---|---|---|---|
| `customModal` | Confirmación genérica | Alta — usado en toda la app | Sí |
| `mex-dialog-overlay` | Diálogo MEX custom | Alta | Sí |
| `logs-modal` | Historial de cambios | Media | Sí |
| `gestor-alertas-modal` | Historial de alertas | Media | Sí |
| `reserveModal` | Reservar unidad | Alta (operativa) | Sí |
| `crear-alerta-modal` | Emitir alerta maestra | Alta | Sí (20+ IDs) |
| `modal-config-global` | Configuración del sistema | Muy Alta | Sí (11 tabs) |
| `modal-cfg-add` | Añadir ítem de config | Media | Sí |
| `modal-nueva-plaza` | Crear nueva plaza | Media | Sí |
| `modal-comparador-plazas` | Comparar plazas | Baja | Sí |
| `modal-recordatorio` | Recordatorios de unidad | Media | Sí |
| `modal-pdf-reservas` | Análisis de PDF | Baja | Sí |
| `popover-evidencia` | Imagen flotante | Baja | Sí |
| `overlayAuditoria` | Bloqueo de auditoría | Muy Alta | Sí |

### 8.2 Cuáles podrían convertirse en componentes

- `customModal` / `mex-dialog-overlay` → componente `<MexDialog>` reutilizable
- `logs-modal` → componente `<LogsViewer>` con props (plaza, fecha)
- `gestor-alertas-modal` → componente `<AlertsHistory>` con props
- `modal-pdf-reservas` → componente `<PdfAnalyzer>` autónomo (ya lo es)
- `popover-evidencia` → componente `<ImagePopover>` autónomo

### 8.3 Cuáles dependen demasiado del contexto del mapa

- `reserveModal` — necesita el MVA y estado actual de la unidad seleccionada
- `crear-alerta-modal` — necesita lista de usuarios, plaza activa, plantillas de Firestore
- `modal-config-global` — necesita acceso completo a `window.api` y permisos de rol
- `overlayAuditoria` — bloquea toda la UI, requiere coordinación con backend

---

## 9. Separación propuesta por módulos

Estructura futura recomendada cuando se inicie la migración real:

```
/js/app/views/
  mapa-real.js          → Entry point del mapa dentro de App Shell.
                          Llama mount/unmount, coordina sub-módulos.

/js/mapa/
  mapa-controller.js    → Orquestador: inicializa módulos, maneja ciclo de vida.
                          Expone mount({ container, navigate, shell }) y unmount().
                          Reemplaza la función de inicialización de mapa.js.

  mapa-renderer.js      → Renderiza celdas, zonas, cars en el DOM.
                          Recibe datos normalizados, devuelve DOM.
                          Sin lógica de Firestore.

  mapa-dnd.js           → Drag and drop (pointer + touch + HTML5 DnD).
                          Recibe callbacks onDrop(mva, zonaOrigen, zonaDestino).
                          Sin Firestore directo — solo emite eventos.

  mapa-data.js          → Abre y gestiona listeners Firestore.
                          Expone: subscribe(plaza, callbacks) → unsubscribe()
                          Garantiza un solo set de listeners activos a la vez.
                          cleanup() cierra todos los onSnapshot antes de unmount.

  mapa-modals.js        → Gestiona el DOM de modales (abrir, cerrar, poblar).
                          Requiere que los IDs existan en el contenedor montado.

  mapa-filters.js       → Lógica de filtrado: por plaza, por estado, por categoría.
                          Sin efectos secundarios — funciones puras.
```

**Restricción crítica:** `mapa-data.js` debe garantizar que `cleanup()` cierra todos los `onSnapshot` antes de que el router llame al siguiente `mount()`. Sin esto, los listeners se acumulan.

---

## 10. Plan de migración futuro

### Fase 9A — Extracción de render sin cambiar comportamiento
**Objetivo:** Separar la función de render del mapa en `mapa-renderer.js` sin alterar la lógica de negocio.  
**Alcance:** Mover funciones `_renderMapa()`, `_renderCelda()`, `_renderCar()`, `_renderZona()` a módulo independiente.  
**Riesgo:** Bajo (solo refactor de presentación).  
**Prerequisito:** Suite de tests de smoke que verifiquen que el render produce el mismo DOM.

### Fase 9B — Extracción de drag and drop
**Objetivo:** Mover toda la lógica DnD a `mapa-dnd.js`.  
**Alcance:** Funciones `_handleMapCar*`, `_handleMapZone*`, `_handleMapTouch*`, listeners de documento.  
**Riesgo:** Alto — requiere verificación en dispositivos táctiles reales.  
**Prerequisito:** Fase 9A completa. Tests de DnD en desktop y mobile.

### Fase 9C — Extracción de listeners con lifecycle mount/unmount
**Objetivo:** Mover todos los `onSnapshot` a `mapa-data.js` con `subscribe()` / `unsubscribe()` explícitos.  
**Alcance:** Las 9+ suscripciones Firestore activas, con cleanup garantizado.  
**Riesgo:** Muy Alto — el orden de cierre/apertura de listeners afecta datos en pantalla.  
**Prerequisito:** Fases 9A y 9B completas. Pruebas de cambio de plaza sin memory leaks.

### Fase 9D — Montar mapa real dentro de /app/mapa experimental
**Objetivo:** Que `mapa-controller.js` se monte en `shell.contentEl` con sidebar y header del App Shell.  
**Alcance:** Integrar módulos 9A+9B+9C en el contenedor del App Shell.  
**Riesgo:** Muy Alto — z-index, dimensiones, eventos de touch, persistencia Firestore.  
**Prerequisito:** Fases 9A, 9B y 9C completas. Feature flag para usuarios PROGRAMADOR únicamente.

### Fase 9E — Pruebas paralelas /mapa vs /app/mapa
**Objetivo:** Ambas rutas funcionando, comparación lado a lado.  
**Alcance:** Mismo usuario, misma plaza, mismo día — comparar paridad funcional.  
**Riesgo:** Medio — riesgo de datos duplicados si ambas versiones escriben simultáneamente.  
**Prerequisito:** Fase 9D con al menos 2 semanas de uso interno.

### Fase 9F — Redirect gradual
**Objetivo:** `/ → /mapa` empieza a redirigir a `/app/mapa` para roles seleccionados.  
**Alcance:** Firebase Hosting `rewrites` o redirect en mapa.html para roles no críticos primero.  
**Riesgo:** Bajo si 9E fue exitosa.  
**Prerequisito:** Fase 9E completa sin regresiones.

---

## 11. Lista de riesgos

### 🔴 Alto

| Riesgo | Descripción | Mitigación |
|---|---|---|
| Listeners Firestore acumulados | Sin `unmount()` centralizado, cada mount agrega ~9 listeners | Implementar `mapa-data.js` con cleanup explícito antes de iniciar migración |
| Z-index de overlays | Modales del mapa usan z-index hasta 70000; shell header usa 1100 | Definir tabla de z-index global antes de migrar |
| DnD en touch mobile | `preventDefault()` en `touchmove` require `passive: false` a nivel documento | Verificar en iOS Safari y Android Chrome antes de confirmar arquitectura |
| Sincronización de plaza activa | Dos sistemas de plaza (app-state.js vs app-bootstrap) no sincronizados | Crear bridge que escuche `mex:plaza-change` y actualice `app-state` |
| Persistencia Firestore offline | `enablePersistence({synchronizeTabs:true})` puede fallar con múltiples pestañas | No abrir el mapa en múltiples pestañas durante la migración; documentar limitación |
| DOMContentLoaded ya disparado | mapa.js escucha `DOMContentLoaded`; dentro del App Shell el evento ya ocurrió | El init debe ser invocado directamente desde `mount()`, no esperar al evento |

### 🟡 Medio

| Riesgo | Descripción | Mitigación |
|---|---|---|
| IDs de modal fijos | 80+ IDs hardcodeados que deben existir en el DOM | El HTML de modales debe incluirse en el template del componente, no en `app.html` |
| Funciones globales `window.*` | Dependencias de `window.hasPermission`, `window._miPlaza`, etc. | Exportarlas como módulo ES6 antes de migrar |
| Dos arquitecturas API coexistiendo | `mex-api.js` monolítico + módulos `/api/*.js` | No requiere resolver antes de migrar el mapa — `window.api` sigue siendo la interfaz |
| Viewport del mapa sin dimensiones fijas | El mapa requiere `height: 100%` en el contenedor | `shell.contentEl` debe tener `height: 100%; overflow: hidden` cuando está el mapa montado |
| CSS global con clases del mapa | `.shell-main-stage`, `.mapa-car`, etc. en `global.css` | Auditar qué clases son exclusivas del mapa y moverlas a `mapa.css` |

### 🟢 Bajo

| Riesgo | Descripción | Mitigación |
|---|---|---|
| Atajos de teclado globales | `keydown` con Shift+P, Shift+M en `app-bootstrap.js` navegan a rutas legacy | Actualizar shortcuts para usar `navigate('/app/profile')` |
| `afterprint` listener | Limpieza post-impresión; no crítico | Incluirlo en el `unmount()` del controlador |
| `pagehide` listener | Guarda estado al salir; dentro del shell no se dispara | Mover lógica a `visibilitychange` o al `unmount()` del router |
| PWA install banners en el mapa | Aparecen dentro del contenedor del mapa | Moverlos al nivel del App Shell donde tienen más sentido |

---

## 12. Checklist de pruebas obligatorio

Antes de cada fase de migración, ejecutar este checklist completo en producción con un usuario real:

### Autenticación y acceso
- [ ] Login con correo/contraseña funciona
- [ ] Login con Google funciona
- [ ] Redirección post-login va a `/app/dashboard`
- [ ] Logout desde App Shell cierra sesión correctamente
- [ ] Usuario sin permisos es bloqueado

### Apertura del mapa
- [ ] `/mapa` legacy abre sin errores de consola
- [ ] Datos de unidades se cargan dentro de los primeros 5 segundos
- [ ] Estructura de celdas/zonas se renderiza correctamente
- [ ] Plaza activa se detecta y muestra correctamente
- [ ] Header muestra título "Mapa operativo"

### Cambio de plaza
- [ ] Selector de plaza funciona
- [ ] Al cambiar plaza, los datos de unidades se actualizan
- [ ] Los listeners de la plaza anterior se cierran (verificar en Network/Firebase console)
- [ ] La nueva plaza se persiste en sessionStorage
- [ ] Otros módulos del sistema reflejan la plaza nueva (mensajes, alertas)

### Drag and drop — Desktop
- [ ] Arrastrar unidad de zona A a zona B funciona
- [ ] El cambio se persiste en Firestore
- [ ] El mapa se actualiza en tiempo real
- [ ] Intentar mover a zona bloqueada muestra error correcto
- [ ] Mover múltiples unidades en secuencia rápida no genera inconsistencias

### Drag and drop — Mobile (iOS Safari y Android Chrome)
- [ ] Touch drag inicia correctamente
- [ ] El scroll de la página no interfiere con el drag
- [ ] Drop en celda destino funciona
- [ ] Scroll del mapa (pan) funciona independiente del drag

### Click en unidad
- [ ] Click abre panel de detalles de la unidad
- [ ] Estado, gasolina, notas se muestran correctos
- [ ] Botón de editar abre formulario correcto
- [ ] Cambios se persisten en Firestore

### Editar unidad
- [ ] Formulario de edición carga datos actuales
- [ ] Guardar cambios persiste en Firestore
- [ ] El mapa se actualiza tras guardar
- [ ] Cancelar no guarda cambios

### Insertar unidad
- [ ] Formulario de inserción funciona
- [ ] Validación de MVA duplicado funciona
- [ ] La unidad aparece en el mapa tras insertar

### Eliminar unidad
- [ ] Confirmación previa a eliminación aparece
- [ ] La unidad desaparece del mapa tras eliminar
- [ ] El registro queda en logs

### Listeners realtime
- [ ] Abrir el mapa en dos pestañas: cambio en una se refleja en la otra
- [ ] Cerrar el mapa y volver: no hay listeners duplicados (verificar en Firebase console)
- [ ] Desconexión y reconexión de red: el mapa se recupera
- [ ] Cambio hecho por otro usuario aparece sin recargar

### Panel admin / Configuración
- [ ] Usuario con rol PROGRAMADOR ve la consola de config
- [ ] Usuario AUXILIAR NO ve opciones de admin
- [ ] Crear usuario nuevo funciona
- [ ] Modificar usuario funciona
- [ ] Bloqueo de patio funciona (requiere rol con permiso `lock_map`)

### Alertas
- [ ] Emitir alerta global funciona (requiere permiso `emit_master_alerts`)
- [ ] Alerta aparece en usuarios destinatarios
- [ ] Marcar como leída funciona
- [ ] Historial de alertas filtra correctamente

### Mensajes internos
- [ ] Redactar mensaje funciona
- [ ] Mensaje llega al destinatario en tiempo real
- [ ] Contador de no leídos se actualiza

### Mobile — Funcionalidad general
- [ ] El mapa es navegable en pantalla pequeña (375px)
- [ ] El sidebar se puede abrir/cerrar como drawer
- [ ] Los modales no desbordan la pantalla
- [ ] Los botones tienen tamaño táctil adecuado (≥44px)

### Service Worker
- [ ] SW instala correctamente (v209)
- [ ] Assets críticos están cacheados (verificar en DevTools > Application > Cache)
- [ ] Offline: el mapa intenta cargar desde caché
- [ ] Actualización de SW: nueva versión se activa sin requerir cierre manual del browser

### No regresiones del App Shell
- [ ] `/app/dashboard` → `/app/mapa` → `/app/profile` no recarga el shell
- [ ] Back/forward funciona entre rutas del App Shell
- [ ] `/mapa` legacy sigue funcionando igual después de cualquier cambio
- [ ] No hay errores `firebase: Firebase App named '[DEFAULT]' already exists`

---

## Apéndice — Estructura de datos de mapa_config

Cada celda de la estructura del mapa se guarda en `mapa_config/{plaza}/estructura/cel_{orden}`:

```javascript
{
  valor: string,                   // Nombre/código de celda
  tipo: 'cajon' | 'label' | ...,  // Tipo de elemento
  esLabel: boolean,
  orden: number,
  x: number,                       // Posición en canvas (px)
  y: number,
  width: number,                   // Ancho (default: 120)
  height: number,                  // Alto (default: 80)
  rotation: number,                // Grados (default: 0)
  zone: string | null,
  subzone: string | null,
  isReserved: boolean,
  isBlocked: boolean,
  isTemporaryHolding: boolean,
  allowedCategories: string[],
  priority: number,
  googleMapsUrl: string | null,
  pathType: string | null
}
```

## Apéndice — Roles y permisos del sistema

```javascript
ACCESS_ROLE_META = {
  AUXILIAR:         { isAdmin: false, isGlobal: false, fullAccess: false },
  VENTAS:           { isAdmin: true,  isGlobal: false, fullAccess: false },
  SUPERVISOR:       { isAdmin: true,  isGlobal: false, fullAccess: false },
  JEFE_PATIO:       { isAdmin: true,  isGlobal: false, fullAccess: false },
  GERENTE_PLAZA:    { isAdmin: true,  isGlobal: false, fullAccess: false },
  JEFE_REGIONAL:    { isAdmin: true,  isGlobal: false, fullAccess: false },
  CORPORATIVO_USER: { isAdmin: true,  isGlobal: true,  fullAccess: true  },
  PROGRAMADOR:      { isAdmin: true,  isGlobal: true,  fullAccess: true  },
  JEFE_OPERACION:   { isAdmin: true,  isGlobal: true,  fullAccess: true  }
}
```

Permisos granulares verificables: `manage_users`, `process_access_requests`, `emit_master_alerts`, `edit_admin_cuadre`, `view_admin_cuadre`, `use_programmer_console`, `view_exact_location_logs`, `lock_map`, `insert_external_units`, `platform_full_access`, `view_admin_users`.
