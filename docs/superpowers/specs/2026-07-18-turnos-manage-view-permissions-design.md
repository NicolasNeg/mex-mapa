# Diseño: permisos `manage_turnos` / `view_turnos`

> **Fecha:** 2026-07-18
> **Alcance:** Fase 1 (parcial) de `docs/plan-turnos-potenciado.md` — solo el ítem de permisos. No incluye catálogo de turnos, roles operativos UI, ni modularización del resto de `turnos.js`.
> **Precede a:** implementación vía `writing-plans`.

## 1. Problema

El gate admin de Turnos (`isTurnosAdmin(role)` / `ROLES_ADMIN` en `js/app/features/turnos/turnos-view-model.js:6-18`) es un hardcode de roles que no pasa por `window.mexPerms.canDo(...)`, violando la regla de oro del proyecto ("Permisos y feature-gates siempre" — `MapGestion/REGLAS DE ORO...md` §2.5).

Al investigar el reemplazo se encontró un problema más serio: **las reglas de Firestore para `turnos`/`horarios`/`asistencia`/`notas_asistencia`/`turnos_roles_operativos` no tienen ningún concepto propio de "admin de turnos".** Usan `esAdminOperativo()` (`firestore.rules:185-198`), que se satisface con el permiso `view_admin_cuadre` **o** `edit_admin_cuadre` — permisos de Cuadre, prestados. `view_admin_cuadre` es `true` por default para `VENTAS` (`firestore.rules:114`). Resultado: un usuario `VENTAS`, a quien la UI le oculta las pestañas Horarios/Asistencia, **puede escribir esos datos igual llamando a Firestore directo**, porque las reglas nunca lo bloquean. Es exactamente el anti-patrón que el propio doc de reglas de oro prohíbe ("la seguridad vive en firestore.rules, no en ocultar código").

También se confirmó que el modelo de permisos vive **triplicado y desincronizado**: `domain/permissions.model.js` (cliente puro), `js/core/feature-gates.js` (espejo manual del cliente) y `firestore.rules` → `rolTienePermiso()` (servidor, con nombres de clave invertidos — `view_admin_cuadre` vs `view_cuadre_admin` — y leyendo overrides desde una ruta distinta). Unificar esas tres fuentes es un proyecto aparte; este diseño solo añade las dos claves nuevas respetando el patrón existente en las tres.

## 2. Cambios

### 2.1 `domain/permissions.model.js`
- Añadir `'view_turnos'`, `'manage_turnos'` a `PERMISSION_KEYS`.
- Añadir a `DEFAULT_ROLE_PERMISSIONS` para cada rol no-fullAccess:
  - `view_turnos: true` en `AUXILIAR, VENTAS, SUPERVISOR, JEFE_PATIO, GERENTE_PLAZA, JEFE_REGIONAL` (replica el comportamiento actual: sin gate de ruta).
  - `manage_turnos: false` en `AUXILIAR, VENTAS`; `true` en `SUPERVISOR, JEFE_PATIO, GERENTE_PLAZA, JEFE_REGIONAL` (replica `ROLES_ADMIN` actual).
- `PROGRAMADOR/JEFE_OPERACION/CORPORATIVO_USER` no necesitan entrada — `tieneAccesoTotal()` ya los cubre.

### 2.2 `js/core/feature-gates.js`
- Espejar las mismas dos claves/defaults en `_PERM_DEFAULTS` para cada rol (mismo patrón manual que las claves existentes).

### 2.3 `firestore.rules`
- Nuevo helper junto a `esAdminOperativo()` (línea ~198):
  ```
  function puedeGestionarTurnos() {
    return esProgramadorBootstrap()
      || (tienePerfilActual() && tienePermiso(perfilActual(), "manage_turnos"));
  }
  ```
- Nueva rama en `rolTienePermiso()` (junto a las de `km_corregir`/`manage_global_fleet`, línea ~121):
  ```
  : permiso == "manage_turnos"
    ? (role == "SUPERVISOR" || role == "JEFE_PATIO" || role == "GERENTE_PLAZA" || role == "JEFE_REGIONAL" || hasPerm)
  ```
- Reemplazar `esAdminOperativo()` → `puedeGestionarTurnos()` **solo** en los 5 call sites de la sección TURNOS (líneas 1042, 1062, 1073, 1081, 1118, 1132 — `turnos` update, `horarios` create/update, `asistencia` create/update rama admin, `notas_asistencia` create/update/delete, `turnos_roles_operativos` create/update/delete). `esAdminOperativo()` en sí no se toca — sigue siendo correcto para las reglas de Cuadre que sí dependen de él.
- `view_turnos` no requiere cambio de reglas: las lecturas de estas colecciones ya son `estaAutenticado()` sin más restricción.

### 2.4 `js/app/views/turnos.js`
- L389: `isAdmin: isTurnosAdmin(role)` → `isAdmin: window.mexPerms.canDo('manage_turnos')` (único call site de `isTurnosAdmin`, confirmado por grep — todo lo demás en el archivo consume `_s.isAdmin`).
- Guard nuevo al inicio de `mount()`: si `!window.mexPerms.canDo('view_turnos')`, renderizar un estado "sin acceso" en vez de montar el módulo. Con el default `true` para todos los roles esto no cambia comportamiento visible hoy; le da un propósito real a la clave (antes no existía ningún gate de vista) y respeta la regla de oro de permisos.

### 2.5 Limpieza
- `turnos-view-model.js`: eliminar `isTurnosAdmin`/`ROLES_ADMIN` una vez confirmado que no los importa nada más que `turnos.js`.

## 3. Verificación

No hay test automatizado de `/app/turnos` (Playwright headless no corre en el sandbox de esta sesión — confirmado, es una limitación del entorno, no de la app). Verificación:

- **Manual (obligatoria):** login como `VENTAS`, confirmar que Horarios/Asistencia siguen ocultos en UI (sin cambio de comportamiento).
- **Runnable check (rules-only, sin browser):** el repo ya tiene `@firebase/rules-unit-testing` como devDependency (sin uso actual). Añadir un script mínimo (`firebase emulators:exec --only firestore "node scripts/test-turnos-rules.js"` o similar) que verifique con el Firestore Rules Test SDK: un usuario `VENTAS` NO puede escribir en `horarios`/`asistencia`/`notas_asistencia`, y un `SUPERVISOR` sí puede. Esto prueba directamente el hueco de seguridad cerrado, sin depender de un navegador.

## 4. Fuera de alcance

- Unificar las tres fuentes de permisos (cliente ×2 + reglas) — deuda preexistente, no se resuelve aquí.
- `notas_semana` y `horarios_plantillas` siguen gateadas por `tienePerfilActual()` (cualquier perfil, no solo admin) — se observó pero no se pidió cambiarlo; posible ítem futuro si se decide que también deben requerir `manage_turnos`.
- Catálogo de turnos, roles operativos UI, integración Cola/Cuadre — Fases 1 (resto)/3 del plan maestro, specs separados.
