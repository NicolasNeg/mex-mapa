# Smoke test beta (App Shell + Firebase Hosting)

Checklist manual rápido antes/después de desplegar. No sustituye pruebas funcionales completas.

## Activar / desactivar flags (solo QA; `localStorage` en este navegador)

| Flag | Activar | Desactivar |
|------|---------|------------|
| DnD preview App Mapa | `localStorage.setItem('mex.appMapa.dnd','1')` | `localStorage.removeItem('mex.appMapa.dnd')` |
| DnD persistencia | `localStorage.setItem('mex.appMapa.dndPersist','1')` | `localStorage.removeItem('mex.appMapa.dndPersist')` |
| Logs de depuración mapa | `localStorage.setItem('mex.debug.mode','1')` | `localStorage.removeItem('mex.debug.mode')` |

También puedes usar **Programador → Flags experimentales App Shell** (solo roles autorizados).

Requisitos persistencia: rol **PROGRAMADOR** o admin global real (`isAdmin` + rol global); no CORPORATIVO_USER, JEFE_OPERACION, AUXILIAR, OPERACION.

Tras mover una unidad en `/app/mapa` con persistencia: comprobar mensaje de éxito, posición actualizada en grid o tras «Refrescar mapa»; en Firestore/CUADRE/EXTERNOS la `pos` debe coincidir (misma ruta que legacy `guardarNuevasPosiciones`).

## Checklist

1. **Login** — sesión correcta, sin errores en consola.
2. **`/app/dashboard`** — carga, datos visibles.
3. **Selector de plaza** — cambio de plaza sin romper shell.
4. **Búsqueda global** — filtra; en `/app/mapa` resalta MVA/celdas si aplica.
5. **Campana / notificaciones** — panel abre sin error.
6. **`/app/mapa` sin flags** — solo lectura, sin DnD.
7. **`mex.appMapa.dnd=1`** — preview sin persistir.
8. **`dnd` + `dndPersist` + rol permitido** — confirmación, guardado, UI coherente.
9. **`/app/cuadre`** — carga.
10. **`/app/mensajes`** — carga.
11. **`/app/admin`** — carga (según rol).
12. **`/app/cola-preparacion`** — carga.
13. **`/app/incidencias`** — carga.
14. **`/mapa` legacy** — intacto; no redirige desde legacy.
15. **Viewport ~390px** — shell usable.
16. **Viewport ~1366px** — layout estable.
17. **Clear site data + reload** — login de nuevo, sin app duplicada Firebase.
18. **Service Worker** — versión actual en Programador; sin assets 404 críticos.

## Automático local

En **`/app/programador` → Beta Readiness → «Ejecutar smoke check local»** se hacen peticiones `HEAD`/`GET` al mismo origen sobre rutas y assets listados; no escribe Firestore ni borra cache.

## Volver al mapa completo

Desde `/app/mapa`: **Abrir mapa completo (legacy)** o navegar a **`/mapa`**.
