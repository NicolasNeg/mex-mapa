# Smoke test beta (App Shell + Firebase Hosting)

Documento de **validación actual** para esta beta: qué probar y cómo. No sustituye pruebas funcionales exhaustivas del negocio.

## Qué incluye la beta (alcance de estas pruebas)

Las pruebas cubren el **App Shell**, las **vistas `/app/*`** relevantes y la coexistencia con **`/mapa` legacy**. Detalle funcional está en `beta-release-notes.md`.

## Activar / desactivar flags (solo QA; `localStorage` en este navegador)

| Flag | Activar | Desactivar |
|------|---------|------------|
| DnD preview App Mapa | `localStorage.setItem('mex.appMapa.dnd','1')` | `localStorage.removeItem('mex.appMapa.dnd')` |
| DnD persistencia | `localStorage.setItem('mex.appMapa.dndPersist','1')` | `localStorage.removeItem('mex.appMapa.dndPersist')` |
| Logs de depuración mapa | `localStorage.setItem('mex.debug.mode','1')` | `localStorage.removeItem('mex.debug.mode')` |

También puedes usar **Programador → Flags experimentales App Shell** (solo roles autorizados).

**Persistencia DnD:** rol **PROGRAMADOR** o admin global real (`isAdmin` + rol global); no CORPORATIVO_USER, JEFE_OPERACION, AUXILIAR, OPERACION.

Después de mover una unidad en `/app/mapa` con persistencia: comprobar mensaje de éxito, posición actualizada en grid o tras «Refrescar mapa»; verificar que la `pos` en datos coincide con lo esperado (misma ruta que legacy `guardarNuevasPosiciones`).

## Qué es experimental (al validar)

- DnD preview y persistencia en `/app/mapa` según flags.
- Beta Readiness y smoke HTTP en Programador.

## Qué queda en legacy durante estas pruebas

- **`/mapa`** sigue siendo la vista operativa completa; las pruebas deben confirmar que **no está rota** y que no hay redirección forzada desde legacy hacia `/app/mapa`.

## Riesgos actuales a tener en cuenta al probar

- Posible **desfase** entre lo que muestra el cliente y el servidor en el momento del gesto; si falla la revalidación o el refresco, usar **Refrescar mapa** y repetir la comprobación.
- **Consola:** avisos no críticos pueden aparecer sin impedir el uso de la beta.

## Checklist manual

1. **Login** — sesión correcta, sin errores graves en consola.
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
14. **`/mapa` legacy** — intacto; sin redirección no deseada desde legacy.
15. **Viewport ~390px** — shell usable.
16. **Viewport ~1366px** — layout estable.
17. **Clear site data + reload** — login de nuevo; sin inicialización duplicada de Firebase.
18. **Service Worker** — versión coherente en Programador; sin 404 críticos en assets del shell.

## Smoke automático local

En **`/app/programador` → Beta Readiness → «Ejecutar smoke check local»**: peticiones `HEAD`/`GET` al mismo origen sobre rutas y assets listados; **no** escribe Firestore ni borra cache.

## Volver al mapa completo (legacy)

Desde `/app/mapa`: **Abrir mapa completo (legacy)** o navegar a **`/mapa`**.
