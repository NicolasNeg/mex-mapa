# Centro de Notificaciones — vista oficial (FASE 15G)

**Estado:** **OFICIAL_OPERATIVO** en App Shell (`/app.html`). El dropdown pequeño del header (`#mexHdrNotifMenu`) fue **eliminado** y sustituido por el **Centro vivo** (mismo modal que legacy, núcleo compartido).

## UI portada

- Modal `#notifications-center-modal` (tarjeta amplia, overlay, cierre, backdrop).
- Cabecera: kicker **Centro vivo**, título **Notificaciones**, badge **Todo al día** / conteo pendientes, texto de resumen dinámico.
- Tabs (chips): **Todos**, **Mensajes**, **Inventario**, **Alertas**, **Solicitudes**.
- Barra: estado push (incl. **Push no disponible** si el navegador no soporta), botón **Activar** si aplica, **refresh** asíncrono con estado busy.
- Lista agrupada por fecha o vacío **Todo tranquilo** con copy acordado.
- **Configuración de notificaciones** colapsable (prefs dispositivo; lectura/escritura vía Firestore `devices` como ya hacía el core).

## Datos reales por tab

| Tab | Fuente |
|-----|--------|
| Todos | Inbox Firestore `usuarios/{docId}/inbox` (últimas 80) |
| Mensajes | Mismo inbox; filtro `type` contiene `message` |
| Inventario | Mismo inbox; filtro `type` contiene `cuadre` |
| Alertas | Mismo inbox; filtro `type` contiene `alert` |
| Solicitudes | Mismo inbox; filtro `type` contiene `solicitud` o `request` |

No se añadieron lecturas nuevas agresivas ni listeners por ítem. Lo que no llegue por inbox queda en **cero** o vacío.

## RangeError `Maximum call stack size exceeded` (mapa.js ~2532)

**Causas corregidas en `js/core/notifications.js`:**

1. **`configureNotifications` sin marcar `autoConfigured`:** `initNotificationCenter` llamaba `_ensureAutoConfiguration()`, que volvía a ejecutar `configureNotifications` con rutas por defecto y podía **pisar** `routeHandlers` y `toast` del host (p. ej. `mapa.js`) y re-renderizar en cascada con listeners ya registrados.
2. **Inicialización concurrente:** varias vistas podían llamar `initNotificationCenter()` en el mismo tick; ahora hay **una promesa en vuelo** compartida.
3. **Bucle prefs (defensivo):** al escribir `checked` en los checkboxes de configuración, algunos entornos pueden encadenar `change` → `persistCurrentDevicePrefs` → `_renderNotificationCenter` → … Se añadió **`prefChangeGuard`** alrededor de la asignación programática.

## Listeners y cleanup

- Los listeners del modal se registran **una sola vez** al crear el DOM (`_ensureNotificationCenterDom` sale si el modal ya existe).
- **Escape** global único (`window.__mexNotifCenterEscapeBound`) cierra el modal activo.
- `teardownNotificationCenter` cancela snapshots inbox/device y resetea flags; en App se usa `teardownAppNotificationShell()` (`notification-center.js`) para también permitir re-setup limpio.

## Archivos tocados (15G)

- `js/core/notifications.js` — fixes init/configure/prefs/refresh/Escape.
- `js/app/features/notifications/notification-center.js` — integración App Shell.
- `js/app/main.js` — campana → centro vivo; toast shell; teardown.
- `css/app-notifications.css` — complemento scoped.
- `app.html` — enlace stylesheet.
- `sw.js` — `CACHE_NAME` **mapa-v282** + opcionales nuevos.
- `docs/*` — este archivo, `app-real-view-migration-status.md`, `legacy-view-blueprints.md`.

## No tocado (confirmación fase)

- `login.html`, `js/views/login.js`, auth, `functions/index.js`, reglas Firestore/Storage, `mapa.html`, `js/views/mapa.js`, `css/mapa.css` sin cambios destructivos para esta entrega.
