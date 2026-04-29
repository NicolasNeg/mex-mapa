---
title: "MEX MAPA - Contexto Maestro del Proyecto"
created: 2026-04-29
updated: 2026-04-29
tags:
  - mex-mapa
  - arquitectura
  - firebase
  - app-shell
  - legacy
---

# MEX MAPA - Contexto Maestro

## 1) Que es este proyecto

**MEX MAPA** es una plataforma web operativa para administracion de flota vehicular, seguimiento de unidades, incidencias, comunicaciones internas y gestion de usuarios.

Actualmente conviven dos capas:
- **Legacy HTML + JS** (rutas clasicas como `/home`, `/mapa`, `/gestion`, etc.).
- **App Shell SPA** en rutas **`/app/*`** (sidebar/header global + vistas modulares migradas).

La estrategia del proyecto es migrar modulo por modulo a App Shell, conservando contratos de datos y fallback legacy para reducir riesgo operativo.

---

## 2) Objetivo funcional del sistema

El sistema permite:
- Visualizar operacion de unidades (mapa y vistas de apoyo).
- Gestionar incidencias y notas administrativas.
- Operar mensajeria interna entre usuarios.
- Revisar cuadres, inventario y estados operativos.
- Administrar usuarios, solicitudes de acceso y configuraciones.
- Gestionar perfil y preferencias de experiencia.

---

## 3) Stack tecnico (alto nivel)

- **Frontend:** HTML + JS (ES modules en App Shell), Tailwind/CSS custom.
- **Backend:** Firebase (Firestore, Auth, Storage, Cloud Functions).
- **Hosting:** Firebase Hosting.
- **PWA:** Service Worker (`sw.js`) + `manifest.json`.
- **Contrato de API cliente:** `window.api` (ensamblado por `api/_assemble.js`, compat con `mex-api.js`).

---

## 4) Estructura principal del repositorio

## Raiz
- `app.html`: entrypoint SPA App Shell.
- `home.html`, `mapa.html`, `profile.html`, etc.: vistas legacy.
- `mex-api.js`: adaptador legacy principal.
- `firebase.json`, `firestore.rules`, `storage.rules`: configuracion Firebase.
- `sw.js`: service worker principal.

## Carpetas clave
- `js/app/`: router SPA, estado global y vistas App Shell.
- `js/views/`: logica legacy por pagina.
- `js/core/`: bootstrap/config firebase, bridge de datos, notificaciones, etc.
- `js/shell/`: layout global App Shell (sidebar/header).
- `api/`: modulos del contrato publico `window.api`.
- `functions/`: Cloud Functions (`functions/index.js`).
- `css/`: estilos globales, legacy y App Shell.
- `docs/`: bitacora tecnica, politicas y estado de migracion.
- `domain/`: modelos/permisos de dominio.

---

## 5) Arquitectura de ejecucion

## Flujo App Shell (`/app/*`)
1. `app.html` carga Firebase + bootstrap.
2. `js/app/main.js` valida sesion (`auth`), carga perfil y estado.
3. Monta `ShellLayout` (sidebar + header persistentes).
4. `js/app/router.js` renderiza vista segun ruta `/app/...`.
5. Cada vista expone `mount/unmount` y debe limpiar listeners.

## Flujo Legacy
- Cada HTML legacy carga su JS dedicado en `js/views/*`.
- `js/views/legacy-shell-bridge.js` aplica redirect App-first segun ruta y flag.

---

## 6) Modelo de rutas y migracion

Estado actual de rutas (resumen operativo):

- **App-first (redirect a `/app/*`):**
  - `/home` -> `/app/dashboard`
  - `/profile` -> `/app/profile`
  - `/mensajes` -> `/app/mensajes`
  - `/cola-preparacion` -> `/app/cola-preparacion`
  - `/incidencias` -> `/app/incidencias`

- **Se mantienen legacy-first (backup activo):**
  - `/cuadre` (App existe, no redirect forzado)
  - `/gestion` (App admin existe, no redirect forzado)
  - `/programador` (App QA, legacy disponible)

- **No redirigir aun:**
  - `/mapa`
  - `/editmap`
  - `/solicitud` (formulario publico)

## Escape global
Si `localStorage["mex.legacy.force"] === "1"`:
- Se evita redirect automatico en rutas app-first.
- Se muestra CTA discreto para abrir App Shell.

---

## 7) Estado de paridad visual/funcional por modulo

- `/app/dashboard`: **REAL_COMPLETA_VISUAL_PORT** (paridad fuerte con `/home`).
- `/app/profile`: **REAL_COMPLETA_VISUAL_PORT** (port visual legacy + guardado seguro).
- `/app/programador`: **REAL_COMPLETA QA**.
- `/app/mensajes`, `/app/cola-preparacion`, `/app/incidencias`: **APP_FIRST** con fallback legacy para acciones avanzadas.
- `/app/cuadre`, `/app/admin`, `/app/mapa`: **REAL_PARCIAL / PARCIAL_FUERTE** (legacy backup segun modulo).

Fuente de verdad para este inventario:
- `docs/app-real-view-migration-status.md`
- `docs/legacy-view-blueprints.md`
- `docs/legacy-route-redirect-plan.md`

---

## 8) Seguridad y control de acceso (resumen)

- **Auth Firebase** identifica usuario.
- **Acceso operativo** depende de perfil en `usuarios` (Firestore).
- Login endurecido para bloquear acceso sin perfil valido/activo/autorizado.
- `solicitudes` es ruta publica separada (onboarding).
- Campos sensibles (rol/permisos/admin/global/password) no se editan desde App profile.

Archivos clave:
- `firestore.rules`
- `storage.rules`
- `js/views/login.js`
- `functions/index.js`

---

## 9) Datos principales en Firestore (vista funcional)

Colecciones relevantes usadas en el flujo:
- `usuarios`
- `solicitudes`
- `notas_admin`
- `cola_preparacion/{plaza}/items`
- `cuadre`, `externos`
- `settings`, `configuracion`, `mapa_config`
- Colecciones admin/roles/plazas segun modulo de gestion

Nota: hay coexistencia de modelos legacy y migrados en algunos modulos (ejemplo: incidencias kanban legacy vs bitacora `notas_admin` en App Shell).

---

## 10) Contrato `window.api` (compatibilidad)

El proyecto mantiene congelada la superficie publica `window.api` para no romper paginas legacy mientras se migra.

Puntos clave:
- `js/core/database.js` reexporta el bridge hacia `window.api`.
- `api/*` tiene prioridad sobre implementaciones equivalentes en `mex-api.js`.
- El ensamblado final se hace en `api/_assemble.js`.

Inventario detallado:
- `docs/api-contract-inventory.md`

---

## 11) Service Worker y cache

- Service worker principal: `sw.js`
- Version de cache actual: **`mapa-v263`**
- Estrategia general:
  - Cache-first para assets estaticos.
  - Network-first para llamadas de datos/API.

Cuando cambia frontend (HTML/JS/CSS), se debe bump de `CACHE_NAME`.

---

## 12) Cloud Functions

Ubicacion:
- `functions/index.js`

Uso:
- Funciones operativas/admin especificas.
- Incluye endpoints de soporte de seguridad/autorizacion y procesos de solicitud.

Despliegue selectivo tipico:
- `firebase deploy --only functions:<nombre>,hosting`

---

## 13) Flujo de despliegue

## Hosting
- `firebase deploy --only hosting`

## Rules (cuando aplica)
- `firebase deploy --only firestore:rules`
- `firebase deploy --only storage`

## Functions (cuando aplica)
- `firebase deploy --only functions:<fn>`

---

## 14) Convenciones actuales de migracion

Reglas practicas usadas en el proyecto:
- Migrar primero en modo seguro/read-first cuando el modulo es sensible.
- Mantener fallback legacy mientras no haya paridad completa de riesgo alto.
- No romper rutas legacy existentes.
- No introducir listeners sin cleanup en vistas App.
- Evitar auth listeners nuevos por vista App.
- Mantener sincronia App Shell (`app-state`, `shell.setProfile`, plaza global).

Referencia:
- `docs/app-shell-migration-policy.md`

---

## 15) Roadmap tecnico inmediato (resumen)

Pendientes importantes:
- Cerrar paridad avanzada de `/app/mapa`.
- Completar capacidades avanzadas pendientes en `/app/cuadre` y `/app/admin`.
- Elevar paridad de adjuntos/flujo completo en `/app/mensajes`.
- Mantener estabilidad de login, perfil y persistencia como area critica.

---

## 16) Glosario rapido

- **App Shell:** contenedor SPA comun para `/app/*` con sidebar/header persistentes.
- **Legacy:** rutas HTML clasicas fuera de `/app/*`.
- **App-first:** ruta legacy que redirige automaticamente a App Shell.
- **KEEP_LEGACY_BACKUP:** App funcional, pero se conserva entrada principal legacy.
- **REAL_COMPLETA_VISUAL_PORT:** paridad visual fuerte con la vista legacy.
- **mex.legacy.force:** flag local para forzar permanecer en legacy.

---

## 17) Mapa rapido de archivos para onboarding

Si alguien nuevo entra al proyecto, leer en este orden:
1. `docs/contexto-proyecto-obsidian.md` (este archivo).
2. `docs/app-real-view-migration-status.md`.
3. `docs/legacy-view-blueprints.md`.
4. `docs/legacy-route-redirect-plan.md`.
5. `docs/api-contract-inventory.md`.
6. `js/app/main.js`, `js/app/router.js`, `js/app/app-state.js`.
7. `js/views/legacy-shell-bridge.js`.
8. `firestore.rules` y `functions/index.js`.

