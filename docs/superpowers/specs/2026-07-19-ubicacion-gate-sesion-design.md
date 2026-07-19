# Diseño: Gate de ubicación (rediseño) + sesión anti-loop

> **Fecha:** 2026-07-19  
> **Alcance:** Rediseño industrial del overlay de geolocalización + endurecer reload de perfil/sesión (anti-loop) en SPA y legacy.  
> **Fuente Obsidian:** `MapGestion/(3)PETICION DE UBICACION.md`, `MapGestion/LOCALSTORAGE.md`  
> **Referencias visuales:** `assets/ubicacion-web-01-gate-pedir.png`, `assets/ubicacion-web-02-gate-denegado.png`, `assets/ubicacion-mobile-01-pedir.png`, `assets/ubicacion-mobile-02-denegado.png`  
> **Approach:** 1 — Parche en lo existente (`app-bootstrap.js` + watcher en SPA)  
> **Estado:** implementado (`mapa-v601`)

## 1. Decisiones aprobadas

| Tema | Decisión |
|---|---|
| Visual del gate | **Industrial minimal** (ESTILO.md): card opaca, acento `#3b82f6`, sin glass ni gradient verde/azul |
| Revocación mid-sesión | **Gate bloqueante inmediato** |
| Cambio plaza/rol | Reload con `_reloadRequired` + **anti-loop estricto** (firma + limpiar flag) |
| Usuario eliminado / `activo=false` | `signOut` inmediato |
| Persistencia ubicación | `localStorage` por usuario; no re-pedir al abrir otra pestaña si el permiso sigue granted |

## 2. Estado actual

### 2.1 Ubicación (`js/core/app-bootstrap.js`)
- Overlay `#mexLocationGateOverlay` con estilo glass + gradient (no alineado a ESTILO.md).
- API: `__mexRequireLocationAccess`, `watchPosition`, `permissions.query`.
- Caché `mex.location.last.v1` (~6h) para evitar flash al abrir pestañas.
- Gate se invoca desde login / mapa / home (legacy); **SPA `main.js` no llama el gate de forma central**.

### 2.2 Sesión / reload (`js/views/mapa.js`)
- Ya existe anti-loop parcial: `sessionStorage._reloadGuard` + firma en `localStorage` (`mex.reload.handled.{email}`) + intento de `_reloadRequired: false`.
- Falta paridad en **SPA** (`js/app/main.js`).
- Riesgo histórico: si el flag no se limpia y la firma no se actualiza bien → bucle de reload.

## 3. Gate de ubicación — UX / visual

### 3.1 Layout
- Overlay fixed full-viewport, backdrop `rgba(15,23,42,.55)` **sin** blur glass fuerte (o blur mínimo ≤4px si hace falta legibilidad).
- Card centrada: `background: var(--surface)`, `border: 1px solid var(--border)`, `border-radius: 12px`, padding 24px, max-width ~420px.
- Icono Material Symbols `location_on` / `location_off` en círculo suave accent/error.
- Título, copy corto (2 líneas), status strip muted, acciones.

### 3.2 Estados
| Estado | Título | CTA primario | Secundario |
|---|---|---|---|
| Prompt / prompt | Activa tu ubicación | Permitir ubicación | Cerrar sesión |
| Validando | Ubicación detectada | (disabled / Verificando…) | Cerrar sesión |
| Denied / blocked | Ubicación requerida | Reintentar | Cerrar sesión |
| Unsupported | Ubicación no disponible | — | Cerrar sesión |

### 3.3 Copy (ES)
- Prompt: “Para operar en la plataforma necesitas permitir ubicación exacta. Se usa en auditorías y movimientos.”
- Denied: “El permiso está bloqueado. Actívalo en el navegador o en ajustes del dispositivo y pulsa Reintentar.”

### 3.4 Comportamiento
1. **Login / primera entrada de sesión:** llamar `__mexRequireLocationAccess({ allowLogout: true })`.
2. **Nueva pestaña:** si `permissions.state === 'granted'` o caché válida por usuario → sin overlay; hidratar + `watchPosition`.
3. **Revocación mid-sesión:** listener `permissions.change` + fallo `watchPosition` code=1 → `show` gate bloqueante de inmediato (no esperar acción de negocio).
4. Clave caché: `mex.location.last.v1:{emailNormalizado}` (migrar/limpiar la clave global antigua si existe).
5. Dark theme: tokens `--surface/--text/--border`; chips/status legibles.

### 3.5 Archivos
- Modificar: `js/core/app-bootstrap.js` (markup + CSS inyectado del gate).
- Opcional: mover estilos a `css/app-location-gate.css` **solo si** no complica el boot; default = seguir inyectado pero industrial.
- Asegurar llamada central desde `js/app/main.js` post-auth (una vez por sesión SPA).

## 4. Sesión — reload / kick

### 4.1 Reglas
| Evento | Acción |
|---|---|
| Perfil: plaza / rol / plazasPermitidas / status relevantes + `_reloadRequired === true` | Toast → limpiar flag → marcar firma consumida → `location.reload()` |
| Doc usuario ausente o `activo === false` / `autorizado === false` / `accesoSistema === false` | `auth.signOut()` + redirect `/login` |
| Mismo `_reloadRequired` + misma firma ya manejada | **No** recargar |
| Update a `_reloadRequired: false` falla | Conservar firma en localStorage; **no** loop |

### 4.2 Anti-loop (contrato)
Orden obligatorio antes de `reload()`:
1. Calcular `reloadMarker` (firma estable del perfil: rol, plaza, plazasPermitidas, status, version/updatedAt).
2. Si `localStorage[mex.reload.handled.{email}] === reloadMarker` → abort.
3. Set `sessionStorage._reloadGuard = '1'`.
4. Set `localStorage[mex.reload.handled.{email}] = reloadMarker`.
5. `update({ _reloadRequired: false })` (fire-and-forget con log).
6. Toast + `setTimeout(reload, ~1200ms)`.
7. Cuando el snapshot llega con `_reloadRequired` falsy → `_clearReloadTracking(email)`.

### 4.3 Dónde vive
- Extraer helpers compartidos si es trivial; si no:
  - Mantener/mejorar lógica en `mapa.js` (legacy).
  - **Portar la misma lógica** a `js/app/main.js` (listener `onSnapshot` del doc del usuario actual o colección users filtrada).
- Al escribir usuarios (admin): seguir seteando `_reloadRequired: true` en cambios de rol/plaza (ya existe en parte).

## 5. Fuera de alcance
- App Check / rate limiting / CSP (nota Seguridad).
- Cambiar reglas de negocio de *cuándo* se audita ubicación.
- Focus trap completo / i18n.
- Sub-plazas.

## 6. Verificación
1. Login fresco → gate industrial → permitir → entra; nueva pestaña → sin flash.
2. Denegar permiso → gate denied; Reintentar / Cerrar sesión.
3. Concedido → revocar en chrome://settings → gate aparece sin navegar.
4. Admin cambia rol del usuario logueado → **un** reload; no loop.
5. Si Firestore niega limpiar flag → igual no loop (firma).
6. Desactivar usuario → signOut.
7. `node --check` en archivos tocados; dark theme del gate legible.
