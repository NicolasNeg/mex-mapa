# Handoff beta — MAPA App Shell (release candidate)

**Fecha:** 2026-04-27  
**Estado:** beta candidata a congelamiento operativo.

## URL de la beta

- Producción Firebase Hosting: `https://mex-mapa-bjx.web.app`
- También: `https://mex-mapa-bjx.firebaseapp.com`

No incluir aquí usuarios ni contraseñas. Usar cuentas internas ya acordadas con el equipo.

## Rutas principales

| Área | Ruta App Shell | Legacy (paralelo) |
|------|----------------|---------------------|
| Dashboard | `/app/dashboard` | `/home` |
| Mapa beta | `/app/mapa` | **`/mapa`** (motor completo) |
| Mensajes | `/app/mensajes` | `/mensajes` |
| Cola preparación | `/app/cola-preparacion` | `/cola-preparacion` |
| Incidencias | `/app/incidencias` | `/incidencias` |
| Cuadre | `/app/cuadre` | `/cuadre` |
| Administración | `/app/admin` | `/gestion` |
| Programador / QA | `/app/programador` | `/programador` |
| Perfil | `/app/profile` | `/profile` |

La entrada `https://mex-mapa-bjx.web.app/` redirige al shell (`/app`). El mapa operativo histórico sigue en **`/mapa`** sin eliminación ni redirección forzada.

## Cuentas / roles a probar (sin credenciales)

Documentar internamente quién tiene:

- Rol **operativo estándar** (sin admin global): debe ver App Shell pero **no** flags editables ni DnD persistente por política de rol.
- Rol **PROGRAMADOR** o **admin global real** (`isAdmin` + alcance global): puede ver flags experimentales, Beta Readiness en `/app/programador`, y activar DnD preview/persistencia solo con flags locales.

Validar plaza, cambio de plaza si aplica, campana y búsqueda global desde header.

## Configuración Firebase cliente

- **Archivo cargado:** `/js/core/firebase-config.js` define `window.FIREBASE_CONFIG` (parámetros públicos del SDK Web).
- **`/config.js` en raíz:** no debe cargarse desde HTML (legado fuera del flujo actual).

## Flags experimentales (solo este navegador)

| Clave localStorage | Efecto |
|--------------------|--------|
| `mex.appMapa.dnd` = `1` | Habilita **vista previa DnD** en `/app/mapa` si el rol lo permite. Sin flag → solo lectura en App Mapa. |
| `mex.appMapa.dndPersist` = `1` | Permite **persistencia experimental** solo si también `dnd` está activo y el rol autoriza (PROGRAMADOR / admin global autorizado). |
| `mex.debug.mode` = `1` | Logs extra en vistas que lo respetan. |

Activación recomendada solo desde **`/app/programador`** para quienes tengan permiso.

### Desactivar modo experimental en mapa App

En `/app/mapa`, usuarios autorizados pueden usar **«Desactivar modo experimental»**, que borra `mex.appMapa.dnd` y `mex.appMapa.dndPersist` y refresca la vista.

## Qué es experimental vs estable

| Experimental | Estable / legacy paralelo |
|--------------|---------------------------|
| `/app/mapa`: DnD preview y persistencia con flags | **`/mapa`** — herramientas completas históricas |
| Flags en Programador | Operación diaria sin flags |
| Beta Readiness / smoke HEAD | Datos reales siguen protegidos por rules |

## QA desde Programador

En **`/app/programador`** → bloque **Beta Readiness**:

- Ejecutar **smoke check local** (solo peticiones mismo origen; **no escribe** Firestore).
- Ver versión **Service Worker / cache**, flags, estado de script legacy `/config.js`, y `FIREBASE_CONFIG`.
- **Copiar reporte** al portapapeles.
- Abrir rutas rápidas (dashboard, mapa App, mapa legacy).

## Known issues actuales (no bloqueantes acordados)

- Consola puede mostrar **advertencias** del SDK Firebase compat (p. ej. persistencia multi-pestaña / APIs deprecadas). Documentado en código; no implica rotura de login ni datos.
- **`apiKey` Web visible** en cliente: esperado; la seguridad efectiva es **reglas** Firestore/Storage y restricciones de API key en Google Cloud.

## Checklist de validación rápida

- [ ] Login y sesión.
- [ ] `/app/dashboard` carga.
- [ ] `/app/mapa` read-only sin flags.
- [ ] Con flags + rol adecuado: preview y flujo de persistencia con confirmación.
- [ ] **`/mapa`** legacy intacto y usable.
- [ ] `/app/mensajes`, `/app/cola-preparacion`, `/app/incidencias`, `/app/cuadre`, `/app/admin`, `/app/profile`.
- [ ] Sidebar, header, plaza, búsqueda, campana.
- [ ] Navegación atrás/adelante sin estado roto grave.
- [ ] Sin `/config.js` en pestaña Network del documento principal.
- [ ] Sin errores críticos JS ni 404 de assets obligatorios.
- [ ] Service Worker versión actual (`mapa-v235` o superior tras deploy).

## Rollback simple

1. Identificar commit estable anterior: `git log --oneline -5`
2. Revertir o checkout del commit bueno.
3. `git push`
4. `firebase deploy --only hosting`
5. En navegadores afectados: recarga forzada o borrar datos del sitio si el SW sirviera assets viejos.

---

## Freeze para beta

Durante esta beta candidata:

- **No** activar DnD persistente a usuarios normales (solo flags locales + rol autorizado).
- **No** eliminar ni redirigir **`/mapa`** legacy.
- **No** cambiar **Firestore / Storage rules** sin QA explícito y ventana acordada.
- **No** mover “secretos” al frontend; la config Web sigue siendo la pública del SDK.
- **No** editar roles o datos sensibles desde el App Shell Programador en esta fase (consola read-only / sin acciones destructivas).
- **No** ejecutar desde Programador acciones destructivas (limpieza cache global forzada, borrados masivos, etc.).
