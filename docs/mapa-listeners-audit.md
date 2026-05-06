# Mapa Listeners Audit (Fase 9A)

Fecha: 2026-04-27  
Alcance: auditoría de `js/views/mapa.js` + contratos nuevos de lifecycle App Shell.  
Objetivo: inventariar listeners/suscripciones y preparar cleanup centralizado sin montar mapa real en `/app/mapa`.

## Resumen

- `mapa` legacy mantiene múltiples suscripciones y listeners globales activos en runtime.
- No existe `unmount()` único para toda la vista legacy.
- El riesgo principal sigue siendo duplicación de listeners al remount sin cleanup total.

## Inventario exacto de listeners/suscripciones

### A) Firestore `onSnapshot`

1. **Usuarios live (chat/dropdowns)**
   - Ubicación: `_iniciarSincronizacionUsuarios()`
   - Query: `db.collection(COL.USERS).onSnapshot(...)`
   - Datos: perfiles para chat, dropdowns y refresh de perfil actual
   - Unsub actual: `_unsubUsersLive`
   - Limpieza actual: sí (se cierra al reiniciar y en `cerrarSesion`)
   - Init: `_iniciarSincronizacionUsuarios()`
   - Cleanup recomendado: lifecycle mapa (mount/unmount)
   - Riesgo duplicación: **Medio**
   - Depende de plaza: no (global usuarios)
   - Scope ideal: lifecycle mapa

2. **Radar settings por plaza**
   - Ubicación: `iniciarRadarNotificaciones()`
   - Query: `settings/{plaza}.onSnapshot(...)`
   - Datos: estado operativo de plaza
   - Unsub actual: `_unsubRadar[]`
   - Limpieza actual: sí vía `_limpiarRadar()`
   - Riesgo: **Medio**
   - Depende de plaza: sí
   - Scope ideal: lifecycle mapa

3. **Radar settings global**
   - Ubicación: `iniciarRadarNotificaciones()`
   - Query: `settings/GLOBAL.onSnapshot(...)`
   - Unsub actual: `_unsubRadar[]`
   - Limpieza actual: sí (`_limpiarRadar`)
   - Riesgo: **Medio**
   - Depende de plaza: no (global)
   - Scope ideal: lifecycle mapa

4. **Radar alertas**
   - Ubicación: `iniciarRadarNotificaciones()`
   - Query: `alertas.orderBy(...).limit(50).onSnapshot(...)`
   - Unsub actual: `_unsubRadar[]`
   - Limpieza actual: sí (`_limpiarRadar`)
   - Riesgo: **Medio**
   - Depende de plaza: indirecto (filtro lógico)
   - Scope ideal: lifecycle mapa

5. **Radar mensajes**
   - Ubicación: `iniciarRadarNotificaciones()`
   - Query: `mensajes.where(destinatario == USER_NAME).onSnapshot(...)`
   - Unsub actual: `_unsubRadar[]`
   - Limpieza actual: sí (`_limpiarRadar`)
   - Riesgo: **Medio**
   - Depende de plaza: no
   - Scope ideal: lifecycle mapa

6. **Radar incidencias**
   - Ubicación: `iniciarRadarNotificaciones()`
   - Query: `notas_admin.where(estado == PENDIENTE).onSnapshot(...)`
   - Unsub actual: `_unsubRadar[]`
   - Limpieza actual: sí (`_limpiarRadar`)
   - Riesgo: **Medio**
   - Depende de plaza: no en query; sí en uso operativo
   - Scope ideal: lifecycle mapa

7. **Chat enviado**
   - Ubicación: `_iniciarListenersChat()`
   - Query: `mensajes.where(remitente == me).orderBy(...).onSnapshot(...)`
   - Unsub actual: `_chatListenerUnsubs[]`
   - Limpieza actual: sí (limpia array antes de reabrir)
   - Riesgo: **Medio**
   - Depende de plaza: no (interplaza)
   - Scope ideal: lifecycle mapa (sub-módulo chat)

8. **Chat recibido**
   - Ubicación: `_iniciarListenersChat()`
   - Query: `mensajes.where(destinatario == me).orderBy(...).onSnapshot(...)`
   - Unsub actual: `_chatListenerUnsubs[]`
   - Limpieza actual: sí
   - Riesgo: **Medio**
   - Depende de plaza: no
   - Scope ideal: lifecycle mapa (sub-módulo chat)

9. **Usuarios secundarios para módulos admin/chat**
   - Ubicación: bloque `let _unsubUsuarios = null` (sync de usuarios alterna)
   - Query: `db.collection(COL.USERS).onSnapshot(...)`
   - Unsub actual: `_unsubUsuarios`
   - Limpieza actual: parcial/no centralizada
   - Riesgo: **Alto**
   - Depende de plaza: no
   - Scope ideal: lifecycle mapa

10. **Notas admin específicas**
    - Ubicación: bloque `let _unsubNotasAdmin = null`
    - Query: notas/incidencias (según flujo de modal)
    - Unsub actual: `_unsubNotasAdmin`
    - Limpieza actual: parcial/no centralizada
    - Riesgo: **Medio**
    - Depende de plaza: sí (según flujo)
    - Scope ideal: lifecycle mapa (sub-módulo incidencias)

11. **Mapa principal y estructura**
    - Ubicación: flujo de `suscribirMapaPlaza`/`suscribirEstructuraMapa` legacy
    - Query: `cuadre`, `externos`, `mapa_config/{plaza}/estructura`
    - Unsub actual: `_unsubMapa`, `_unsubMapaEstructura`
    - Limpieza actual: sí (en cambios de plaza/cierre), pero no centralizada de todo mapa
    - Riesgo: **Alto**
    - Depende de plaza: sí
    - Scope ideal: `mapa-data` controller

### B) DOM / Window / Document listeners

1. `document.addEventListener('visibilitychange', ...)` para presencia.
   - Cleanup actual: no explícito (single-bind con guard)
   - Riesgo: **Medio**

2. `window.addEventListener('pagehide', ...)` para presencia.
   - Cleanup actual: no explícito
   - Riesgo: **Medio**

3. Listeners globales de atajos/teclas/clicks en múltiples bloques.
   - Cleanup actual: parcial
   - Riesgo: **Medio**

4. DnD/touch document-level:
   - `dragover`, `drop`, `pointermove`, `pointerup`, `pointercancel`
   - `touchmove`, `touchend`, `touchcancel` (`passive:false` en varios)
   - Cleanup actual: no centralizado global
   - Riesgo: **Alto**

5. Viewport map gestures:
   - `wheel`, `touchstart`, `touchmove`, `touchend`, `touchcancel`
   - Cleanup actual: por guardas runtime, no unmount central único
   - Riesgo: **Alto**

6. `window.addEventListener('popstate', ...)` (múltiples).
   - Cleanup actual: no centralizado
   - Riesgo: **Medio**

### C) Timers/intervals

1. `_presenceTimer` (`setInterval`) — heartbeat presencia.
   - Cleanup: `_detenerPresenciaUsuario()`
   - Riesgo: **Medio**

2. `radarInterval` (`setInterval`) — radar notificaciones.
   - Cleanup: `_limpiarRadar()`
   - Riesgo: **Medio**

3. `saveTimeout` debounce de persistencia mapa.
   - Cleanup: sí en varias rutas
   - Riesgo: **Bajo**

4. Varios `setTimeout` UI (`searchPanel`, focus, loaders, prefetch).
   - Cleanup: parcial
   - Riesgo: **Bajo/Medio**

## Dependencia de plaza activa (legacy vs App Shell)

- Fuente legacy principal:
  - `_miPlaza()`
  - `window.getMexCurrentPlaza()`
  - `window.__mexCurrentPlazaId`
  - storage (`mex.activePlaza.*`)
- Fuente App Shell:
  - `app-state.currentPlaza`
- Sincronización actual:
  - evento `mex:plaza-change` + `setMexCurrentPlaza` desde `app-state`
- Riesgo de divergencia:
  - **Medio** si se cambia plaza fuera del flujo esperado o con listeners duplicados.
- Estrategia futura:
  - `mapa-data.setPlaza(plaza)` como punto único para re-suscribir queries de mapa.

## Resultado Fase 9A

- Se crea contrato de datos: `js/app/features/mapa/mapa-data.js`
- Se crea contrato de lifecycle: `js/app/features/mapa/mapa-lifecycle.js`
- No se monta mapa real en `/app/mapa`.
- No se modifica DnD operativo.
- No se modifica lógica core de escritura de mapa.

## Riesgos restantes (para 9B)

1. Integrar DnD y document listeners bajo cleanup central sin romper touch.
2. Consolidar listeners legacy dispersos (`_unsubUsuarios`, `_unsubNotasAdmin`, popstate/click globales).
3. Introducir `unmount()` real de mapa con teardown total verificable.

---

## Actualización FASE 14A (`/app/mapa`)

- App Shell `/app/mapa` usa solo los listeners definidos en `mapa-data.js` (cuadre/map `suscribirMapaPlaza` + estructura); teardown vía `cleanup()` al `unmount` de la vista.
- DnD (`mapa-dnd.js`) registra listeners en `window` **solo durante** arrastre activo; root usa `pointerdown` capture; plaza change llama `disable`/`unmount` del controller antes de recargar datos.
- Guard de plaza en callbacks `onData`: no renderiza snapshot si `snapshot.plaza` no coincide con `getState().currentPlaza` (evita texto stale).
- No se añadieron `onSnapshot` extra (p. ej. notas) para no duplicar carga; enlaces a `/app/incidencias?mva=` cubren P1 sin listener adicional.

### FASE 14B-B (summary por MVA)

- `js/app/features/mapa/mapa-incidencias-summary.js` usa **`subscribeIncidencias`** (`incidencias-data.js`) → **una** suscripción Firestore a `notas_admin` por plaza, compartiendo el mismo patrón que `/app/incidencias`.
- Agregación en memoria por MVA (`aggregateIncidentsByMva`); **sin listeners por unidad**.
- `cleanup()` del controller al `unmount` de `/app/mapa`; al cambiar plaza se usa `setPlaza` sobre el mismo controller (tras `import()` dinámico único) o primer `create` si aún no existía.
- Si el módulo falla al cargar o Firestore error: UI del mapa sigue; badges/resumen se omiten o muestran estado degradado.

## Actualización FASE 14B-A (`mapa-incidencias-summary`)

- Nuevo módulo `js/app/features/mapa/mapa-incidencias-summary.js` añade UNA sola suscripción de `notas_admin` por plaza para obtener conteo/resumen de incidencias agrupado por MVA.
- Estrategia: prefiere `window.api.suscribirNotasAdmin(cb, plaza)` → fallback Firestore directo con `where('plaza','==',X).orderBy('timestamp','desc')` → fallback sin where + limit 300 + filtro client-side si falta índice.
- Token guard: cada `subscribe()` / `setPlaza()` incrementa token; callbacks de token anterior son ignorados silenciosamente.
- `setPlaza(nueva)` llama `cleanup()` antes de re-suscribir → garantiza 0 listeners huérfanos.
- `cleanup()` es idempotente (safe con N llamadas).
- Firestore client SDK comparte cache de snapshots internamente; si `/app/incidencias` ya tiene su listener a `notas_admin` con el mismo query, no se generan lecturas duplicadas del backend.
- Contrato completo: `docs/mapa-incidencias-summary-contract.md`.

## Actualización FASE 14C-A (hardening audit)

- Auditoría completa read-only de `js/app/views/mapa.js` (918 líneas) + 7 módulos features (2464 líneas).
- **Todos los listeners tienen cleanup en `unmount()`**: popstate, click handlers, plaza sub, state sub, global search, DnD controller, lifecycle controller, incidencias controller.
- **DnD listeners en window son temporales**: solo durante gesto activo, removidos en `_finishInteraction`.
- **P1 menor:** `_cssRef` (ref al `<link>` CSS) no se nullifica en unmount; el link persiste en `<head>` pero tiene guard de duplicación.
- **P0 bloqueantes: 0.**
- Checklist completo: `docs/mapa-beta-hardening-checklist.md`.

## Reconciliación FASE 14C-A / 14C-B

Estado final documentado: `/app/mapa` = **BETA_OPERATIVA_FUERTE + HARDENED_FOR_BETA**; `/mapa` = **KEEP_LEGACY_BACKUP** y **no redirige**.

| Punto | Estado reconciliado |
|-------|---------------------|
| Cleanup listeners App Shell | PASS por revisión de código |
| Listeners DnD en `window` | PASS por revisión de código; temporales durante gesto activo |
| Incidencias summary | PASS por revisión de código; una suscripción agregada por plaza, sin listener por unidad |
| `_cssRef` | **P1 pendiente**: no nullificado en `unmount()` |
| Fix 14C-B selección alineada con filtros | PASS por revisión de código |
| Fix 14C-B error state con CTA legacy | PASS por revisión de código |
| Fix 14C-B banner HARDENED / toolbar legacy / detalle reforzado | PASS por revisión de código |
| Toolbar/filtros responsive | PASS por revisión de código; WARNING QA 390px pendiente |
| QA manual lifecycle/remount | WARNING pendiente |

No se marcaron validaciones manuales como PASS. Esta auditoría no tocó runtime, login/auth, Functions ni reglas.

## FASE 14F.1-A (reconciliación controller acciones)

- `mapa-unit-actions.js` mantiene comportamiento data-only: sin `onSnapshot`, sin listeners DOM/window/document, sin timers y sin efectos al importarse.
- `cleanup()` agregado es no-op para cumplir contrato de integración tolerante; no registra ni remueve recursos porque el módulo no crea recursos persistentes.
- `refresh_unit` sigue siendo lectura puntual via `obtenerDatosFlotaConsola(plaza)`.
