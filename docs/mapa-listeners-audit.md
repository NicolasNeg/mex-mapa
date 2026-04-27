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
