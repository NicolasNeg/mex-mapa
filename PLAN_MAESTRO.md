# MEX MAPA — Plan Maestro de Desarrollo
> Última actualización: 2026-04-20
> Para uso colaborativo: Claude Code + agentes externos
>
> REGLA GLOBAL: Nunca romper funcionalidad existente.
> Toda refactorización es incremental. Siempre deployar y verificar antes de continuar.

---

## COORDINACIÓN DE AGENTES

> Este bloque se actualiza cada vez que un agente comienza o termina una tarea.
> Antes de tocar cualquier archivo, revisar aquí quién lo tiene tomado.

### Asignación de Fases

| Fase | Agente | Estado | Archivos principales | Notas |
|---|---|---|---|---|
| **0 — Fundamentos** | 🤖 Claude Code | ✅ Completo | `sw.js`, `package.json`, `scripts/bump-sw.js`, `.firebaserc`, `js/core/error-tracking.js` | `npm run deploy` ya hace bump automático. Sentry listo, activar con DSN. |
| **1 — Refactor mapa.js** | 🤖 Claude Code | ⬜ Pendiente (después de Fase 0) | `js/views/mapa.js`, `js/features/**` | Requiere conocimiento profundo del archivo. NO tocar sin coordinación |
| **2 — Dividir global.css** | 🤖 Claude Code | ⬜ Pendiente | `css/global.css`, `css/**` | Coordinar con Fase 1 para no duplicar trabajo |
| **3 — PWA instalable** | 🤖 Agente externo | ⬜ Pendiente | `js/core/pwa-install.js` (nuevo), `mapa.html` (solo agregar banner) | NO modificar lógica existente de mapa.html |
| **4 — Dashboard y analítica** | 🤖 Agente externo | ⬜ Pendiente | `js/features/dashboard/` (nuevo), `mapa.html` (agregar strip) | Leer datos de Firestore, no tocar lógica de mapa.js |
| **5.1 — Cola de preparación** | 🤖 Agente externo | ⬜ Pendiente | `cola-preparacion.html` (nuevo), `js/views/cola-preparacion.js` (nuevo) | Página standalone, no toca mapa.js |
| **5.2 — Semáforo de docs** | 🤖 Agente externo | ⬜ Pendiente | `functions/index.js`, campos en Firestore | Cloud Function cron + campos nuevos en unidades |
| **5.3 — Comentarios por unidad** | 🤖 Agente externo | ⬜ Pendiente | Subcolección Firestore, panel lateral en mapa.html | Solo agregar HTML al panel de unidad, no tocar lógica |
| **5.4 — Kanban incidencias** | 🤖 Agente externo | ⬜ Pendiente | `incidencias.html` (nuevo), `js/views/incidencias.js` (nuevo) | Página standalone |
| **6 — REST API** | ⬜ Sin asignar | ⬜ Pendiente | `functions/api/v1.js` (nuevo) | Solo Cloud Functions, no toca frontend |
| **7 — Escalabilidad datos** | ⬜ Sin asignar | ⬜ Pendiente | `scripts/migrate-config.js`, `api/*.js` | Requiere coordinación con Claude Code (toca api layer) |
| **8 — Webhook reservas** | ⬜ Sin asignar | ⬜ Pendiente | `functions/`, `js/views/mapa.js` (modal) | Parte en functions, parte toca mapa.js → coordinar |

---

### Log de cambios por agente

> Formato: `[FECHA] [AGENTE] [ACCIÓN] — descripción breve`
> Agregar una línea aquí cada vez que se complete una tarea o se tome una decisión importante.

```
[2026-04-20] Claude Code — ✅ COMPLETÓ Fase 0 — Fundamentos
  Archivos creados/modificados:
    + scripts/bump-sw.js         — auto-incrementa versión del SW
    + package.json               — npm run deploy / deploy:staging / etc.
    + js/core/error-tracking.js  — módulo Sentry (activar con DSN)
    ~ mapa.html                  — comentarios Sentry listos para descomentar
    ~ js/views/mapa.js           — import error-tracking + initErrorTracking + setErrorUser
    ~ sw.js                      — handler GET_VERSION + error-tracking.js en SHELL_ASSETS
    ~ .firebaserc                — alias production y staging
  Pendiente del usuario: crear proyecto mex-mapa-staging en Firebase Console
    y crear cuenta en sentry.io para obtener DSN.

[2026-04-20] Claude Code — TOMÓ Fases 0, 1, 2
[2026-04-20] Claude Code — CREÓ este documento PLAN_MAESTRO.md como punto de coordinación
[2026-04-20] Claude Code → CODEX: Hola CODEX. Yo me encargo de los fundamentos y el refactor
  de mapa.js. Tu tienes libre las Fases 3, 4, 5 — todas son páginas/módulos nuevos y
  Cloud Functions. Lee la sección "Notas para Agentes Externos" al final antes de empezar.
  La regla más importante: no toques js/views/mapa.js ni api/*.js sin avisarme aquí.
  Cuando termines algo, agrega una línea al log con los archivos que modificaste.
  Cualquier duda sobre la arquitectura existente, pregúntame aquí. Buena suerte. — Claude Code
```

---

### Reglas de coordinación

1. **Antes de empezar** una tarea: marcar estado como `🟡 En progreso` y agregar línea al log
2. **Al terminar**: marcar como `✅ Completo`, agregar log con qué archivos se modificaron
3. **Si un agente necesita tocar un archivo marcado por otro**: agregar nota en el log y esperar confirmación del usuario
4. **Archivos EXCLUSIVOS de Claude Code** (no tocar sin coordinación):
   - `js/views/mapa.js`
   - `js/features/**` (directorio nuevo que Claude Code creará)
   - `css/global.css` durante la Fase 2
   - `api/*.js`
5. **Archivos LIBRES** para el agente externo:
   - Cualquier archivo nuevo en `js/views/` que sea página standalone
   - `functions/index.js` para agregar nuevas Cloud Functions al final
   - HTML de nuevas páginas standalone
   - `firebase.json` solo para agregar nuevos rewrites al array existente

---

## ESTADO ACTUAL DEL SISTEMA

### Stack
- **Frontend**: Vanilla JS ES6 modules, HTML, CSS (global.css ~17k líneas)
- **Backend**: Firebase Hosting + Firestore + Storage + Cloud Functions (Node 18)
- **Auth**: Firebase Auth (email/password)
- **Notificaciones**: FCM (Firebase Cloud Messaging)
- **SW**: Service Worker manual con cache-first, versión bumpeada a mano

### Páginas existentes (rutas standalone)
| Ruta | Archivo | Estado |
|---|---|---|
| `/` → `/mapa` | mapa.html + js/views/mapa.js | ✅ Principal |
| `/login` | login.html + js/views/login.js | ✅ |
| `/gestion` | gestion.html (carga mapa.js como módulo) | ✅ |
| `/cuadre` | cuadre.html + iframe a /mapa?fleet=1 | ✅ |
| `/mensajes` | mensajes.html + js/views/mensajes.js | ✅ |
| `/profile` | profile.html + js/views/profile.js | ✅ |
| `/editmap/:plaza` | editmap.html + js/views/editmap.js | ✅ |
| `/solicitud` | solicitud.html | ✅ |
| `/programador` | programador.html + js/views/programador.js | ✅ |
| `/*` | 404.html | ✅ |

### Archivos críticos
- `js/views/mapa.js` — 20,000+ líneas, toda la lógica principal
- `css/global.css` — 17,000+ líneas, todos los estilos
- `api/*.js` — capa de datos separada (ya migrada de mex-api.js)
- `js/core/database.js` — re-exporta auth/db/storage
- `js/core/dialogs.js` — mexDialog/mexConfirm/mexAlert/mexPrompt
- `sw.js` — Service Worker, versión manual (mapa-vXXX)

### Roles y permisos existentes
```
PROGRAMADOR > ADMIN_MASTER > ADMIN_EMPRESA > ADMIN > JEFE_PLAZA
> SUPERVISOR > COORDINADOR > CHECADOR > OPERARIO
```
Permisos granulares: lock_map, manage_global_fleet, can_emit_alerts,
view_all_plazas, insert_external, edit_global, etc.

---

## FASE 0 — FUNDAMENTOS (Hacer PRIMERO, sin tocar UI)

### 0.1 Ambiente Staging
**Por qué**: Cada deploy actual va directo a producción. Sin staging,
cualquier cambio es un riesgo real para usuarios activos.

**Pasos**:
1. Crear proyecto Firebase: `mex-mapa-staging`
2. Copiar `firebase.json` → `firebase-staging.json` apuntando al nuevo proyecto
3. Crear branch `develop` en GitHub
4. En GitHub Actions (o manualmente por ahora):
   - `develop` → deploy a mex-mapa-staging
   - `main` → deploy a mex-mapa-bjx (producción)
5. Crear `config.staging.js` con las credenciales del proyecto staging
6. Verificar que Firestore rules y Storage rules se puedan aplicar a staging

**Archivos a crear/modificar**:
- `.firebaserc` → agregar alias `staging`
- `firebase-staging.json`
- `config.staging.js`
- `.github/workflows/deploy.yml` (opcional, se puede hacer manual al inicio)

**Criterio de éxito**: `firebase deploy --project staging` despliega a staging
sin afectar producción.

---

### 0.2 Error Tracking
**Por qué**: Los bugs en producción son invisibles. Los usuarios reportan
por WhatsApp. Necesitamos saber qué falla, cuándo y para quién.

**Opción elegida**: Sentry (free tier cubre las necesidades)

**Pasos**:
1. Crear cuenta en sentry.io, crear proyecto JS
2. Instalar SDK via CDN (no npm, para mantener el stack actual):
   ```html
   <script src="https://browser.sentry-cdn.com/7.x.x/bundle.min.js"></script>
   ```
3. Inicializar en `js/core/firebase-init.js` DESPUÉS de que firebase inicialice:
   ```js
   Sentry.init({
     dsn: "TU_DSN",
     environment: window.location.hostname.includes('staging') ? 'staging' : 'production',
     release: window.MEX_CACHE_VERSION, // usar la versión del SW
   });
   ```
4. Capturar errores no manejados ya los captura automáticamente
5. Agregar contexto de usuario cuando hace login:
   ```js
   Sentry.setUser({ email: user.email, role: userRole });
   ```
6. En los catch de funciones críticas, agregar `Sentry.captureException(err)`

**Archivos a modificar**:
- `mapa.html`, `gestion.html`, `cuadre.html`, `mensajes.html` → agregar script tag
- `js/core/firebase-init.js` → init de Sentry
- `js/views/mapa.js` → setUser al autenticar + captureException en catch críticos

**Criterio de éxito**: Lanzar un error intencional con `throw new Error('test')`
y verlo aparecer en el dashboard de Sentry.

---

### 0.3 Automatizar versión del Service Worker
**Por qué**: La versión manual (`mapa-v129`) se olvida, causando que usuarios
sirvan versiones viejas. Se ha bumpeado 15+ veces en las últimas sesiones.

**Solución sin build system** (simple, aplica ahora):
Crear un script Node que lee `sw.js`, extrae la versión, la incrementa y guarda.
Correrlo antes de cada `firebase deploy`.

```js
// scripts/bump-sw.js
const fs = require('fs');
const sw = fs.readFileSync('sw.js', 'utf8');
const match = sw.match(/mapa-v(\d+)/);
const newVersion = parseInt(match[1]) + 1;
const updated = sw.replace(/mapa-v\d+/g, `mapa-v${newVersion}`);
fs.writeFileSync('sw.js', updated);
console.log(`SW bumped to v${newVersion}`);
```

Agregar a `package.json`:
```json
{
  "scripts": {
    "deploy": "node scripts/bump-sw.js && firebase deploy --only hosting",
    "deploy:staging": "node scripts/bump-sw.js && firebase deploy --only hosting --project staging"
  }
}
```

**Archivos a crear/modificar**:
- `scripts/bump-sw.js` (nuevo)
- `package.json` → agregar scripts

**Criterio de éxito**: `npm run deploy` bumpa automáticamente y despliega.

---

## FASE 1 — REFACTORIZACIÓN DE mapa.js

### Estrategia: Barrel pattern (NO rompe nada)

```
ANTES:                          DESPUÉS:
mapa.js (20k líneas)            mapa.js (~300 líneas — solo imports + window exports)
                                    ↓ importa de:
                                js/features/auth/permisos.js
                                js/features/auth/sesion.js
                                js/features/mapa-visual/render.js
                                js/features/mapa-visual/drag-drop.js
                                js/features/flota/flota-modal.js
                                js/features/flota/flota-table.js
                                js/features/alertas/alertas-list.js
                                js/features/alertas/alerta-editor.js
                                js/features/cuadre/prediccion.js
                                js/features/cuadre/pdf-reservas.js
                                js/features/configuracion/config-tabs.js
                                js/features/configuracion/usuarios.js
```

**Regla de extracción**: Una función se extrae cuando:
1. Se puede sacar SIN modificar su lógica interna
2. Sus dependencias (variables de módulo) se pueden pasar como parámetro o importar
3. El archivo barrel (mapa.js) la re-exporta a window inmediatamente

**Orden de extracción** (de menor a mayor riesgo):

### 1.1 js/features/cuadre/pdf-reservas.js
**Funciones a mover**:
- `parsearTablaSucia(texto, esReserva)`
- `validarTextareasActividad()`
- `procesarActividadDiaria()`
- `generarHtmlActividadDiaria(reservas, regresos, vencidos, autor, fecha)`
- `abrirReporteImpresion(html)`

**Dependencias externas que necesita**:
- `api.generarPDFActividadDiaria` → importar `window.api`
- `USER_NAME` → pasar como parámetro o leer de `window.USER_NAME`
- `showToast` → importar de un futuro `js/core/ui.js`

**Riesgo**: Bajo. Funciones puras de parseo y generación de HTML.

---

### 1.2 js/features/cuadre/prediccion.js
**Funciones a mover**:
- `reiniciarPrediccion()`
- `ejecutarPrediccion()`
- `descargarPDFPrediccion()`
- `crearExcelPrediccion()`
- `generarHtmlPrediccion(data)`

**Dependencias**:
- `api.obtenerUnidadesVeloz` → window.api
- `_miPlaza()` → necesita la función de plaza activa
- `mexConfirm` → window.mexConfirm

**Riesgo**: Bajo-medio. Funciones relativamente aisladas.

---

### 1.3 js/features/auth/permisos.js
**Funciones a mover**:
- `hasPermission(key)`
- `hasFullAccess()`
- `canLockMap()`
- `canEmitMasterAlerts()`
- `canInsertExternalUnits()`
- `canViewAdminCuadre()`
- `canOpenAdminPanel()`
- `ACCESS_ROLE_META` (constante)
- `userAccessRole`, `userRole` (estado — manejar con cuidado)

**Dependencias**:
- Estado global `_profile`, `userRole` → convertir a getter functions
- `ACCESS_ROLE_META` del database.js ya existe allí

**Riesgo**: Medio. Muchas funciones dependen de estas. Hacerlo último dentro de este sub-grupo.

---

### 1.4 js/features/mapa-visual/drag-drop.js
**Funciones a mover**:
- `procesarDropSeguro(e)`
- `procesarInputSeguro(input)`
- Lógica de swap entre cajones
- Lógica de validación de categorías

**Dependencias**:
- `mexConfirm` → window.mexConfirm
- `api.moverUnidad` → window.api
- `sincronizarMapa()` → circular! Necesita callback o event

**Riesgo**: Medio-alto. El drag-drop es la operación más crítica del sistema.
Extraer SOLO después de que 1.1-1.3 estén verificados en staging.

---

### 1.5 js/features/flota/ (flota-modal + flota-table)
**Funciones a mover**:
- `abrirModalFlota`, `cerrarModalFlota`
- `cargarFlota`, `renderTablaFlota`
- `sortFlota`, `seleccionarFilaFlota`
- `guardarEdicionGlobal`, `abrirModalEditarGlobal`

**Dependencias**:
- Muchas referencias a IDs del DOM en mapa.html
- `api.*` → window.api
- `userRole`, permisos → del módulo de permisos

**Riesgo**: Alto. La flota es el panel más complejo y más usado.
Extraer SOLO después de que todo lo anterior esté en staging y verificado.

---

### 1.6 js/features/alertas/
**Funciones a mover**:
- `cargarAlertas`, `renderizarListaAlertas`
- `abrirEditorAlerta`, `guardarAlerta`, `cerrarEditorAlerta`
- `_actualizarBannerAlerta`, `_actualizarBannerGlobal`
- `_actualizarBannerAlertaUI`

**Riesgo**: Medio. Las alertas tienen muchos listeners y callbacks.

---

### 1.7 mapa.js como barrel final
Después de extraer todos los módulos, mapa.js queda así:
```js
// js/views/mapa.js — Barrel
import { hasPermission, hasFullAccess, canLockMap } from './features/auth/permisos.js';
import { cerrarSesion, iniciarApp } from './features/auth/sesion.js';
import { procesarActividadDiaria, validarTextareasActividad } from './features/cuadre/pdf-reservas.js';
import { ejecutarPrediccion, reiniciarPrediccion } from './features/cuadre/prediccion.js';
// ... etc

// Re-exportar TODO a window para que los onclick en HTML sigan funcionando
Object.assign(window, {
  hasPermission, hasFullAccess, canLockMap,
  cerrarSesion, iniciarApp,
  procesarActividadDiaria, validarTextareasActividad,
  ejecutarPrediccion, reiniciarPrediccion,
  // ... todos los demás
});

// Inicializar app
iniciarApp();
```

**Los onclick en HTML NO cambian. Los IDs del DOM NO cambian.**
**Las API calls NO cambian. Los usuarios no notan nada.**

---

## FASE 2 — CSS: DIVIDIR global.css

### Estrategia
global.css tiene ~17,000 líneas. Igual que mapa.js, se divide en archivos
por sección. global.css queda como barrel de @imports.

**Estructura propuesta**:
```
css/
  global.css          ← solo @imports (barrel)
  base/
    reset.css         ← variables CSS, reset, body, fuentes
    layout.css        ← grid, flex helpers, containers
  components/
    buttons.css       ← todos los botones
    modals.css        ← modal-overlay, fleet-modal, console-card
    forms.css         ← inputs, selects, textareas
    toasts.css        ← toast container y variantes
    dialogs.css       ← mex-dialog-overlay y variantes
    badges.css        ← chips, badges, pills
    cards.css         ← cards, panels
  views/
    mapa.css          ← grid-map, cajones, unidades
    flota.css         ← fleet-modal, tabla de flota
    alertas.css       ← editor de alertas, banner
    sidebar.css       ← sidebars admin y nav
    cuadre.css        ← prediccion, pdf-reservas
    config.css        ← panel de configuración
  utils/
    animations.css    ← keyframes globales
    dark-theme.css    ← todas las overrides de dark mode
    responsive.css    ← media queries
```

**Nota**: `@import` en CSS tiene overhead en navegadores viejos, pero con
el Service Worker cacheando todos los archivos, el impacto es mínimo.
Alternativa: seguir el patrón de las páginas standalone (profile.css,
editmap.css) — cada página importa solo los CSS que necesita.

---

## FASE 3 — PWA INSTALABLE

### 3.1 Banner de instalación guiado

**Flujo**:
1. Capturar evento `beforeinstallprompt` y guardarlo
2. Mostrar banner discreto (no intrusivo) al usuario
3. Al hacer click → mostrar prompt nativo del browser
4. Si acepta → guardar en localStorage que ya instaló
5. Si rechaza → no mostrar por 30 días

**Implementación en `js/core/pwa-install.js`**:
```js
let _installPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _installPrompt = e;
  _mostrarBannerInstalacion();
});

function _mostrarBannerInstalacion() {
  if (localStorage.getItem('mex.pwa.installed')) return;
  if (localStorage.getItem('mex.pwa.dismissed.at')) {
    const dismissedAt = parseInt(localStorage.getItem('mex.pwa.dismissed.at'));
    if (Date.now() - dismissedAt < 30 * 24 * 60 * 60 * 1000) return; // 30 días
  }
  // Mostrar banner HTML en el DOM
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.style.display = 'flex';
}

window.mexInstalarApp = async function() {
  if (!_installPrompt) return;
  _installPrompt.prompt();
  const { outcome } = await _installPrompt.userChoice;
  if (outcome === 'accepted') {
    localStorage.setItem('mex.pwa.installed', '1');
  } else {
    localStorage.setItem('mex.pwa.dismissed.at', Date.now());
  }
  document.getElementById('pwa-install-banner').style.display = 'none';
};
```

**HTML a agregar en mapa.html** (banner flotante bottom):
```html
<div id="pwa-install-banner" style="display:none; position:fixed; bottom:80px;
  left:50%; transform:translateX(-50%); background:#0f172a; color:white;
  border-radius:16px; padding:14px 20px; z-index:99000; box-shadow:0 8px 32px rgba(0,0,0,0.4);
  align-items:center; gap:14px; max-width:380px; border:1px solid rgba(255,255,255,0.1);">
  <span class="material-icons" style="color:#38bdf8; font-size:28px;">install_mobile</span>
  <div>
    <div style="font-weight:900; font-size:13px;">Instalar MEX MAPA</div>
    <div style="font-size:11px; color:#94a3b8;">Acceso rápido desde tu pantalla de inicio</div>
  </div>
  <button onclick="mexInstalarApp()" style="background:#38bdf8; color:#0f172a; border:none;
    border-radius:8px; padding:8px 14px; font-weight:900; font-size:12px; cursor:pointer;">
    INSTALAR
  </button>
  <button onclick="localStorage.setItem('mex.pwa.dismissed.at',Date.now());
    this.parentElement.style.display='none'"
    style="background:none; border:none; color:#64748b; cursor:pointer; font-size:18px;">✕</button>
</div>
```

**Archivos a crear/modificar**:
- `js/core/pwa-install.js` (nuevo)
- `mapa.html` → script tag + HTML del banner

---

### 3.2 Push notifications mejoradas

**Deep links funcionales**:
Cuando llega una notificación, el payload de FCM debe incluir una URL.
Al hacer click, navegar directo a esa URL.

En `firebase-messaging-sw.js`:
```js
messaging.onBackgroundMessage(payload => {
  const { title, body, url, tipo, referencia } = payload.data;
  self.registration.showNotification(title, {
    body,
    icon: '/img/logo.png',
    badge: '/img/logo.png',
    data: {
      url: url || `/mapa?highlight=${referencia}`,
      tipo,
      referencia
    }
  });
});
```

En `sw.js` (ya existe el handler, mejorarlo):
```js
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/mapa';
  // Navegar a la URL específica en lugar de solo /
  event.waitUntil(clients.openWindow(url));
});
```

**Badge de app con contador**:
```js
// En hacerPingNotificaciones, cuando hay alertas pendientes:
if ('setAppBadge' in navigator) {
  navigator.setAppBadge(cantidadAlertas).catch(() => {});
}
// Al leer todas las alertas:
if ('clearAppBadge' in navigator) {
  navigator.clearAppBadge().catch(() => {});
}
```

**Preferencias de notificación por usuario**:
Nuevo campo en el documento del usuario en Firestore:
```js
notificationPreferences: {
  alertasMaestras: true,
  bloqueoMapa: true,
  movimientosFlota: false,
  mensajes: true
}
```
UI en `/profile` → sección de notificaciones con toggles.

---

### 3.3 Offline funcional

**Qué cachear para offline**:
- La estructura del mapa (layout de cajones) → ya se puede guardar en localStorage
- El estado actual de las unidades → snapshot en IndexedDB al hacer sincronizar
- Las configuraciones (estados, modelos, etc.) → ya parcialmente en memoria

**Queue de acciones offline**:
```js
// En js/core/offline-queue.js
const QUEUE_KEY = 'mex.offline.queue';

function encolarAccion(tipo, payload) {
  const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  queue.push({ tipo, payload, ts: Date.now() });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

async function drainQueue() {
  const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  if (queue.length === 0) return;
  for (const accion of queue) {
    await ejecutarAccion(accion); // según tipo: moverUnidad, aplicarEstado, etc.
  }
  localStorage.removeItem(QUEUE_KEY);
  showToast(`${queue.length} accion(es) sincronizada(s) ✓`, 'success');
}

// Al volver a conectar:
window.addEventListener('online', drainQueue);
```

**Indicador visual de datos del caché**:
En el badge de sync, agregar estado `offline-cache`:
```
● LIVE → datos en tiempo real
⏳ QUEUED → hay cambios pendientes de guardar
💾 CACHÉ → sin red, mostrando datos guardados
```

---

## FASE 4 — DASHBOARD Y ANALÍTICA

### 4.1 Dashboard Ejecutivo (pantalla de bienvenida)

**Concepto**: Al entrar al mapa, antes de ver los cajones, una vista de 2-3 segundos
con los KPIs más importantes. O como una barra fija encima del mapa.

**KPIs a mostrar**:
- Total unidades en patio / Total cajones
- % Ocupación con barra visual
- Por estado: Listos, Sucios, Mantenimiento, Traslado, Taller
- Alertas activas (críticas en rojo)
- Último cuadre registrado

**Implementación**: Extender el `#global-status-banner` existente con más info,
o crear un `#dashboard-strip` entre el header y el mapa.

**HTML conceptual**:
```html
<div id="dashboard-strip" class="dashboard-strip">
  <div class="dash-kpi">
    <span class="dash-kpi-valor" id="dash-ocupacion">—%</span>
    <span class="dash-kpi-label">Ocupación</span>
    <div class="dash-kpi-bar"><div id="dash-bar-ocup" class="dash-kpi-fill"></div></div>
  </div>
  <div class="dash-kpi dash-kpi-estado" id="dash-estados-mini">
    <!-- Generado por JS: un chip por estado con cantidad -->
  </div>
  <div class="dash-kpi">
    <span class="dash-kpi-valor" id="dash-alertas">0</span>
    <span class="dash-kpi-label">Alertas</span>
  </div>
</div>
```

---

### 4.2 Heatmap de ocupación

**Concepto**: Overlay sobre el mapa visual. Cada cajón se colorea según
cuántas veces ha estado ocupado en los últimos N días.

**Datos necesarios**: `historial_patio` ya tiene los movimientos.
Agregar campo `cajonId` al registrar movimientos (hoy no se guarda).

**Toggle en toolbar del mapa**:
```html
<button id="btnHeatmap" onclick="toggleHeatmapMode()" class="mapa-tool-btn">
  <span class="material-icons">thermostat</span>
  <span>Heatmap</span>
</button>
```

**Lógica**:
```js
async function toggleHeatmapMode() {
  if (_heatmapActive) {
    _heatmapActive = false;
    document.querySelectorAll('.spot').forEach(s => s.style.removeProperty('--heat-color'));
    return;
  }
  _heatmapActive = true;
  const desde = new Date(); desde.setDate(desde.getDate() - 30);
  const snap = await db.collection('historial_patio')
    .where('plaza', '==', _miPlaza())
    .where('fecha', '>=', desde)
    .get();
  const conteos = {};
  snap.docs.forEach(d => {
    const cajon = d.data().cajonId;
    if (cajon) conteos[cajon] = (conteos[cajon] || 0) + 1;
  });
  const max = Math.max(...Object.values(conteos), 1);
  document.querySelectorAll('.spot').forEach(spot => {
    const id = spot.dataset.valor;
    const heat = (conteos[id] || 0) / max; // 0 a 1
    spot.style.setProperty('--heat-color',
      `hsl(${Math.round(240 - heat * 240)}, 80%, 50%)`); // azul→rojo
  });
}
```

---

### 4.3 Reportes automáticos programados

**Cloud Function con cron** (Firebase Scheduler):

```js
// functions/index.js
const { onSchedule } = require('firebase-functions/v2/scheduler');

exports.reporteDiarioAutomatico = onSchedule('0 8 * * *', async () => {
  // Obtener todas las plazas activas
  const plazas = await db.collection('configuracion')
    .doc('GLOBAL').get().then(d => d.data()?.plazasDetalle || []);

  for (const plaza of plazas) {
    const settings = await db.collection('configuracion').doc(plaza.id).get();
    const correosDestino = settings.data()?.correosReporte || [];
    if (correosDestino.length === 0) continue;

    // Obtener datos del patio
    const unidades = await db.collection('unidades')
      .where('plaza', '==', plaza.id).get();

    // Generar HTML del reporte (reutilizar lógica existente)
    const html = generarHtmlReporteDiario(unidades.docs, plaza.id);

    // Enviar por correo
    await enviarCorreo(correosDestino, `Reporte Diario ${plaza.id}`, html);
  }
});
```

**UI de configuración** en el panel admin, tab Empresa:
- Lista de correos que reciben el reporte diario
- Hora de envío (configurable, default 8am)
- Toggle activo/inactivo por plaza

---

## FASE 5 — FEATURES OPERATIVAS

### 5.1 Cola de Preparación

**Concepto**: Panel en `/cuadre` que muestra unidades con reserva próxima
(próximas 24-48 horas) con checklist de preparación.

**Ruta**: `/cuadre?tab=preparacion` o como tab nuevo en el fleet-modal

**Datos necesarios**:
- Reservas del día siguiente (del módulo de predicción/reservas existente)
- Estado actual de cada unidad
- Checklist items: Lavado, Gasolina, Documentación, Revisión mecánica

**Estructura Firestore**:
```
cola_preparacion/{plaza}/items/{mva}
  - mva: string
  - fechaSalida: timestamp
  - checklist: { lavado: false, gasolina: false, docs: false, revision: false }
  - asignado: string (email del operativo)
  - notas: string
  - creadoAt: timestamp
```

**UI**: Lista drag-to-reorder con checkboxes por ítem.
Notificación push al turno de patio a la hora configurada.

---

### 5.2 Semáforo de Documentación

**Campos nuevos en documento de unidad**:
```js
documentacion: {
  tarjetaCirculacion: { vencimiento: '2026-12-31', adjunto: 'url' },
  seguro:             { vencimiento: '2026-08-15', adjunto: 'url' },
  verificacion:       { vencimiento: '2026-06-01', adjunto: 'url' },
  tenencia:           { al_corriente: true }
}
```

**Indicador en cajón del mapa**:
- Verde: todo vigente (30+ días)
- Amarillo: algo vence en menos de 30 días
- Rojo: algo ya venció

```js
function _docsStatus(unidad) {
  const hoy = new Date();
  const pronto = new Date(); pronto.setDate(pronto.getDate() + 30);
  const docs = unidad.documentacion || {};
  let status = 'ok';
  for (const doc of Object.values(docs)) {
    if (!doc.vencimiento) continue;
    const vence = new Date(doc.vencimiento);
    if (vence < hoy) return 'vencido';
    if (vence < pronto) status = 'proximo';
  }
  return status;
}
```

**Cloud Function cron para alertas**:
```js
exports.alertaDocumentosProximos = onSchedule('0 9 * * *', async () => {
  // Buscar unidades con documentos que vencen en 30 días
  // Crear alerta automática en la colección alertas
  // Enviar push a admins de la plaza
});
```

---

### 5.3 Comentarios por Unidad en Tiempo Real

**Estructura Firestore**:
```
unidades/{mva}/comentarios/{id}
  - texto: string
  - autor: string
  - autorEmail: string
  - ts: timestamp
  - resuelto: boolean
```

**UI**: Mini-feed en el panel lateral de la unidad (el panel que ya existe al
hacer click en una unidad). Nuevo tab "Notas" dentro del panel.

```js
function _iniciarFeedComentarios(mva) {
  return db.collection('unidades').doc(mva)
    .collection('comentarios')
    .orderBy('ts', 'desc')
    .limit(20)
    .onSnapshot(snap => _renderComentarios(snap.docs, mva));
}

async function _agregarComentario(mva, texto) {
  await db.collection('unidades').doc(mva)
    .collection('comentarios').add({
      texto,
      autor: USER_NAME,
      autorEmail: auth.currentUser.email,
      ts: firebase.firestore.FieldValue.serverTimestamp(),
      resuelto: false
    });
}
```

---

### 5.4 Tablero de Incidencias Kanban

**Concepto**: Las notas/alertas actuales visualizadas como tarjetas
en columnas: Pendiente → En Proceso → Resuelto.

**Ruta**: Nueva página `/incidencias` (standalone)

**Archivos a crear**:
- `incidencias.html`
- `js/views/incidencias.js`
- `css/incidencias.css`

**Columnas**:
```
PENDIENTE | EN PROCESO | RESUELTO (últimas 24h)
```

**Drag entre columnas**: Actualiza el campo `estado` en Firestore.
Asignar responsable al mover a "En Proceso".

**Agregar a firebase.json rewrites**:
```json
{ "source": "/incidencias", "destination": "/incidencias.html" }
```

---

## FASE 6 — API PÚBLICA

### 6.1 REST API via Cloud Functions

**Endpoints propuestos**:

```
GET  /api/v1/disponibilidad?plaza=BJX
     → { total, disponibles, ocupados, sucios, mantenimiento }

GET  /api/v1/unidades?plaza=BJX&estado=LISTO
     → [{ mva, estado, cajon, modelo, color, ... }]

GET  /api/v1/unidad/:mva
     → { mva, estado, cajon, historial_reciente, documentacion }

GET  /api/v1/unidad/:mva/historial?desde=2026-01-01
     → [{ fecha, accion, actor, cajon_origen, cajon_destino }]

POST /api/v1/movimiento
     → Body: { mva, cajon_destino, actor, plaza }
     → Requiere API key en header: X-MEX-API-KEY

POST /api/v1/alerta
     → Body: { tipo, descripcion, plaza, mva? }
     → Requiere API key
```

**Autenticación**: API keys guardadas en Firestore:
```
api_keys/{keyHash}
  - nombre: 'Sistema de Rentas XYZ'
  - plazas: ['BJX', 'CUU']
  - permisos: ['read', 'write_movimientos']
  - activa: true
  - creadaAt: timestamp
```

**Implementación**:
```js
// functions/api/v1.js
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: true }));

// Middleware de autenticación por API key
app.use(async (req, res, next) => {
  const key = req.headers['x-mex-api-key'];
  if (!key) return res.status(401).json({ error: 'API key requerida' });
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const keyDoc = await db.collection('api_keys').doc(hash).get();
  if (!keyDoc.exists || !keyDoc.data().activa) {
    return res.status(401).json({ error: 'API key inválida' });
  }
  req.apiKey = keyDoc.data();
  next();
});

app.get('/disponibilidad', async (req, res) => { ... });
// etc.

exports.api = onRequest(app);
```

---

## FASE 7 — ESCALABILIDAD DE DATOS

### 7.1 Migración de colección configuracion

**Estado actual**: Todo en `configuracion/{plaza}` como un solo documento grande.
Con muchos modelos/estados/ubicaciones, puede exceder el límite de 1MB de Firestore.

**Estado objetivo**:
```
configuracion/{plaza}              ← metadata de plaza (nombre, coordenadas, etc.)
configuracion/{plaza}/estados/{id} ← subcolección
configuracion/{plaza}/modelos/{id} ← subcolección
configuracion/{plaza}/ubicaciones/{id} ← subcolección
configuracion/{plaza}/categorias/{id} ← subcolección
```

**Script de migración** (sin downtime):
```js
// scripts/migrate-config.js
// 1. Leer doc actual
// 2. Escribir cada array como subcolección
// 3. Mantener arrays en el doc principal como fallback durante N días
// 4. Después de verificar que todo lee de subcolecciones, limpiar arrays del doc
```

**Impacto en código**: Las funciones `renderizarTabConfig*` en mapa.js
necesitan leer de subcolecciones. Migración con fallback:
```js
async function obtenerEstados(plaza) {
  // Intentar subcolección primero
  const sub = await db.collection('configuracion').doc(plaza)
    .collection('estados').get();
  if (!sub.empty) return sub.docs.map(d => d.data());
  // Fallback al doc legacy
  const doc = await db.collection('configuracion').doc(plaza).get();
  return doc.data()?.estados || [];
}
```

---

### 7.2 Paginación en Flota e Historial

**Estado actual**: `cargarFlota()` trae todas las unidades con un `.get()`.
Con 500+ unidades esto es lento y costoso.

**Solución**: Cursor-based pagination de Firestore.

```js
let _flotaLastDoc = null;
const FLOTA_PAGE_SIZE = 50;

async function cargarFlotaPaginada(reset = false) {
  if (reset) _flotaLastDoc = null;
  let query = db.collection('unidades')
    .where('plaza', '==', _miPlaza())
    .orderBy('mva')
    .limit(FLOTA_PAGE_SIZE);
  if (_flotaLastDoc) query = query.startAfter(_flotaLastDoc);
  const snap = await query.get();
  _flotaLastDoc = snap.docs[snap.docs.length - 1] || null;
  const unidades = snap.docs.map(d => d.data());
  _appendTablaFlota(unidades);
  // Mostrar/ocultar botón "Cargar más"
  document.getElementById('btnCargarMasFlota').style.display =
    snap.docs.length < FLOTA_PAGE_SIZE ? 'none' : 'flex';
}
```

**Virtualización** (para tablas de 500+ filas):
Considerar [clusterize.js](https://clusterize.js.org/) — librería ligera (3KB)
que solo renderiza las filas visibles del viewport.

---

### 7.3 Backups automáticos a Google Sheets

**Concepto**: Cloud Function diaria que exporta el estado del patio
a una hoja de cálculo de Google Sheets. Los managers pueden ver datos
sin acceder al sistema.

**Implementación**:
```js
// Usando Google Sheets API v4
const { google } = require('googleapis');

exports.exportarASheets = onSchedule('0 20 * * *', async () => {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // Obtener datos de Firestore
  const unidades = await db.collection('unidades')
    .where('activa', '==', true).get();

  const filas = unidades.docs.map(d => {
    const u = d.data();
    return [u.mva, u.estado, u.plaza, u.modelo, u.cajon, u.ultimaModificacion];
  });

  // Escribir en Sheets
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SHEETS_ID,
    range: 'Reporte!A2:F',
    valueInputOption: 'RAW',
    requestBody: { values: filas }
  });
});
```

---

## FASE 8 — RECEPTOR DE RESERVAS AUTOMÁTICO

### 8.1 Webhook de reservas

**Concepto**: El modal de "PDF Reservas" actualmente requiere copiar-pegar
texto manualmente. Crear un endpoint que reciba los datos del sistema de
rentas y los procese automáticamente.

**Flujo**:
```
Sistema de rentas → POST /api/v1/reservas/webhook
→ Cloud Function parsea y guarda en Firestore
→ Al abrir modal, las reservas ya están pre-cargadas
→ Usuario solo revisa y confirma
```

**Estructura Firestore**:
```
reservas_diarias/{fecha_plaza}
  - fecha: string (YYYY-MM-DD)
  - plaza: string
  - reservas: array
  - regresos: array
  - procesado: boolean
  - creadoAt: timestamp
```

**En el modal de reservas**, al abrir:
```js
async function abrirModalReservas() {
  document.getElementById('modal-lector-reservas').classList.add('active');
  // Buscar si hay datos pre-cargados del día
  const hoy = new Date().toISOString().split('T')[0];
  const docId = `${hoy}_${_miPlaza()}`;
  const snap = await db.collection('reservas_diarias').doc(docId).get();
  if (snap.exists && !snap.data().procesado) {
    const { reservas, regresos } = snap.data();
    // Pre-llenar los textareas con los datos formateados
    document.getElementById('textoBrutoReservas').value = formatearParaTextarea(reservas);
    document.getElementById('textoBrutoRegresos').value = formatearParaTextarea(regresos);
    validarTextareasActividad();
    showToast('Reservas del día pre-cargadas automáticamente ✓', 'success');
  }
}
```

---

## FASE 9 — MULTI-EMPRESA (futuro, si hay plan comercial)

> Esta fase solo si se decide escalar el sistema como SaaS.

### 9.1 Estructura de datos multi-tenant
```
empresas/{tenantId}
  - nombre, logo, plazas, plan, activa

unidades/{tenantId}_{mva}   ← o subcollección
configuracion/{tenantId}_{plaza}
historial_patio/{tenantId}_{movimientoId}
```

### 9.2 Firestore Rules por tenant
```js
match /unidades/{tenantId}_{mva} {
  allow read, write: if request.auth.token.tenantId == tenantId;
}
```

### 9.3 Panel de super-admin
Nueva ruta `/superadmin` (solo PROGRAMADOR):
- Lista de empresas activas
- Métricas por empresa
- Gestión de planes y límites

---

## CONVENCIONES PARA TRABAJO COLABORATIVO

### Para este proyecto específico:

1. **Antes de cualquier cambio en mapa.js**: Buscar si la función ya existe con
   `grep -n "nombreFuncion"`. El archivo tiene 20k líneas y es fácil duplicar.

2. **Después de cada tarea**: Bumpar SW con `npm run deploy` (cuando exista el script)
   o manualmente modificar `const CACHE_NAME = 'mapa-vXXX'` en sw.js.

3. **Deploy siempre en este orden**:
   ```
   firebase deploy --only hosting
   git add -A
   git commit -m "descripción"
   git push
   ```

4. **Para agregar funciones a window** (accesibles desde onclick en HTML):
   Buscar el bloque `Object.assign(window, {` cerca del final de mapa.js (~línea 18303)
   y agregar la función allí. NO usar `window.fn = function(){}` disperso en el archivo.

5. **Z-index escala del proyecto**:
   ```
   Mapa base:        100-999
   Tooltips:         1000-1999
   Dropdowns:        2000-4999
   Modales normales: 5000-69999   ← fleet-modal vive en 70000
   Modales sobre flota: 70001-75999
   Modales críticos: 76000-89999  ← PDF Reservas, Predicciones
   Dialogs sistema:  90000-99999  ← mexDialog, bloqueo
   Overlay global:   9999999      ← audit overlay
   ```

6. **IDs de DOM que NO se deben cambiar** (referenciados en mapa.js por getElementById):
   Ver lista completa en: `grep -n "getElementById" js/views/mapa.js`
   Son ~200 IDs. Cualquier cambio de ID en HTML requiere buscar en mapa.js primero.

7. **Colecciones Firestore activas**:
   ```
   usuarios/           unidades/           historial_patio/
   configuracion/      alertas/            notas/
   mensajes/           solicitudes_acceso/ mapa_config/
   cuadre/{plaza}/     externos/{plaza}/
   ```

8. **Variables globales de estado en mapa.js** (no tocar desde fuera):
   ```
   USER_NAME, userRole, userEmail, userAccessRole
   PLAZA_ACTIVA_MAPA, window.MAPA_LOCKED
   _profile (perfil del usuario logueado)
   ```

---

## TRACKING DE PROGRESO

| Fase | Item | Estado | Responsable | Notas |
|---|---|---|---|---|
| 0.1 | Staging | ⬜ Pendiente | | |
| 0.2 | Sentry | ⬜ Pendiente | | |
| 0.3 | Script bump-sw | ⬜ Pendiente | | |
| 1.1 | Extraer pdf-reservas.js | ⬜ Pendiente | | |
| 1.2 | Extraer prediccion.js | ⬜ Pendiente | | |
| 1.3 | Extraer permisos.js | ⬜ Pendiente | | |
| 1.4 | Extraer drag-drop.js | ⬜ Pendiente | | |
| 1.5 | Extraer flota/ | ⬜ Pendiente | | |
| 1.6 | Extraer alertas/ | ⬜ Pendiente | | |
| 1.7 | mapa.js como barrel | ⬜ Pendiente | | |
| 2.x | global.css dividir | ⬜ Pendiente | | |
| 3.1 | Banner instalación PWA | ⬜ Pendiente | | |
| 3.2 | Push deep links | ⬜ Pendiente | | |
| 3.3 | Offline queue | ⬜ Pendiente | | |
| 4.1 | Dashboard KPIs | ⬜ Pendiente | | |
| 4.2 | Heatmap ocupación | ⬜ Pendiente | | |
| 4.3 | Reportes automáticos | ⬜ Pendiente | | |
| 5.1 | Cola de preparación | ⬜ Pendiente | | |
| 5.2 | Semáforo docs | ⬜ Pendiente | | |
| 5.3 | Comentarios por unidad | ⬜ Pendiente | | |
| 5.4 | Kanban incidencias | ⬜ Pendiente | | |
| 6.1 | REST API Cloud Functions | ⬜ Pendiente | | |
| 7.1 | Migrar configuracion a subcolecciones | ⬜ Pendiente | | |
| 7.2 | Paginación flota | ⬜ Pendiente | | |
| 7.3 | Backup a Google Sheets | ⬜ Pendiente | | |
| 8.1 | Webhook receptor reservas | ⬜ Pendiente | | |
| 9.x | Multi-empresa | ⬜ Backlog | | Solo si escala a SaaS |

---

## NOTAS PARA AGENTES EXTERNOS

Si eres una IA colaborando en este proyecto, lee esto primero:

- **El archivo más importante es `js/views/mapa.js`** — 20,000+ líneas.
  Antes de editar cualquier función, búscala con grep y lee su contexto completo.

- **`mapa.html` tiene ~4,000 líneas de HTML**. Los IDs de elementos DOM
  son la interfaz entre HTML y mapa.js. No renombres IDs sin buscar en mapa.js.

- **El patrón de permisos**: Cada acción del usuario pasa por `hasPermission(key)`.
  Las keys están en `ACCESS_ROLE_META` en `js/core/database.js`.

- **Firebase Firestore rules**: Están en `firestore.rules`. Cualquier cambio
  de estructura de datos requiere revisar y posiblemente actualizar las rules.

- **El Service Worker** (`sw.js`) tiene un `CACHE_NAME` que debe bumpearse
  con cada deploy que cambie archivos servidos. Sin esto, los usuarios sirven
  versiones viejas.

- **Nunca usar `alert()`, `confirm()`, `prompt()`** — usar `mexAlert()`,
  `mexConfirm()`, `mexPrompt()` de `js/core/dialogs.js`.

- **Para mostrar mensajes al usuario**: `showToast(mensaje, tipo)`
  donde tipo es: `'success'`, `'error'`, `'warning'`, `'info'`.
