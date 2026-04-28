# Post 12D Smoke Results

Fecha: 2026-04-28  
Ambiente objetivo: `https://mex-mapa-bjx.web.app`  
Alcance: smoke QA post App-first redirects + correcciones puntuales (sin features nuevas).

## Resultado consolidado

| Área | Prueba | Resultado | Evidencia breve | Acción tomada | Pendiente |
|---|---|---|---|---|---|
| Redirects App-first | `/home` -> `/app/dashboard` | PASS | Regla activa en `legacy-shell-bridge.js` (`shouldAutoRedirect`) | Sin cambio | Validación visual manual en browser real |
| Redirects App-first | `/profile` -> `/app/profile` | PASS | Regla activa en `legacy-shell-bridge.js` | Sin cambio | Validación visual manual |
| Redirects App-first | `/mensajes` -> `/app/mensajes` | PASS | Regla activa en `legacy-shell-bridge.js` | Sin cambio | Validación visual manual |
| Redirects App-first | `/cola-preparacion` -> `/app/cola-preparacion` | PASS | Regla activa en `legacy-shell-bridge.js` | Sin cambio | Validación visual manual |
| Redirects App-first | `/incidencias` -> `/app/incidencias` | PASS | Regla activa en `legacy-shell-bridge.js` | Sin cambio | Validación visual manual |
| Redirects App-first | Preserva query/hash | PASS | `window.location.replace(appRoute + query + hash)` | Sin cambio | Validación manual de casos con query/hash |
| Escape legacy | `mex.legacy.force=1` evita redirect | PASS | `if (shouldForceLegacy()) return false;` | Sin cambio | Validación visual manual |
| Escape legacy | CTA discreto en rutas operativas | PASS | Texto y condición presentes en bridge | Sin cambio | Validación visual manual |
| Escape legacy | CTA conserva query/hash al abrir App | PASS | Hotfix 12E: CTA usa `appRoute + query + hash` en rutas operativas forzadas | Corregido en `legacy-shell-bridge.js` | Ninguno |
| No redirigidas | `/solicitud` no redirect | PASS | No está en `shouldAutoRedirect`; perfil de ruta explícito | Sin cambio | Validación manual anónima |
| No redirigidas | `/mapa` no redirect | PASS | No está en `shouldAutoRedirect` | Sin cambio | Validación manual DnD/modales |
| No redirigidas | `/cuadre` no redirect | PASS | No está en `shouldAutoRedirect` | Sin cambio | Validación manual |
| No redirigidas | `/gestion` no redirect | PASS | No está en `shouldAutoRedirect` | Sin cambio | Validación manual |
| No redirigidas | `/editmap` no redirect | PASS | No está en `shouldAutoRedirect` | Sin cambio | Validación manual con permisos |
| Solicitud pública | Ícono/logo sin 404 | PASS | Referencia vigente a `/img/no-model.svg` en `solicitud.html` | Sin cambio | Verificación visual manual |
| Solicitud pública | No tocar reglas/functions | PASS | No hubo cambios en `firestore.rules`, `storage.rules`, `functions` | Sin cambio | Ninguno |
| App Shell | Fallback legacy discreto en `/app/mensajes` | PASS | Enlaces `href="/mensajes"` existentes | Sin cambio | Validación manual funcional |
| App Shell | Fallback legacy discreto en `/app/cola-preparacion` | PASS | CTA legacy existente para funciones avanzadas | Sin cambio | Validación manual funcional |
| App Shell | Fallback legacy discreto en `/app/incidencias` | PASS | CTA legacy + nota de adjuntos en legacy | Sin cambio | Validación manual funcional |
| Consola/Network | Reachability desde runner (producción) | WARNING | DNS temporal no resolvió `mex-mapa-bjx.web.app` en entorno CLI | Documentado | Repetir smoke en navegador local del operador |
| Service Worker | Versión cache | PASS | `CACHE_NAME` actualizado a `mapa-v252` | Bump aplicado en `sw.js` | Confirmar instalación visual en DevTools |

## 1) Redirects App-first

- Activos por código: `/home`, `/profile`, `/mensajes`, `/cola-preparacion`, `/incidencias`.
- Mecanismo: redirección cliente en `legacy-shell-bridge.js`.
- Estado: PASS en verificación de implementación.

## 2) Escape legacy

- Flag soportado: `localStorage["mex.legacy.force"] === "1"`.
- Comportamiento: no redirige y muestra CTA discreto para abrir App Shell en rutas operativas.
- Hotfix aplicado: CTA conserva `query/hash` en rutas operativas forzadas.

## 3) Rutas no redirigidas

- Confirmadas sin auto-redirect: `/solicitud`, `/mapa`, `/cuadre`, `/gestion`, `/editmap`.

## 4) Solicitud pública

- Se mantiene pública y sin redirect.
- Sin cambios en reglas ni backend en esta fase.
- Ícono/logo apunta a asset válido (`/img/no-model.svg`).

## 5) App Shell

- Fallback legacy discreto se mantiene en Mensajes, Cola e Incidencias.
- No se agregaron listeners nuevos ni migraciones nuevas.

## 6) Roles/permisos

- WARNING: pruebas de comportamiento por rol requieren sesión real multiusuario en navegador.
- No se tocaron reglas/functions/permisos en esta fase.

## 7) Responsive

- WARNING: requiere validación visual directa (390/430/768/1366) en DevTools.

## 8) Consola/Network

- WARNING: desde CLI no fue posible validar host de producción por DNS temporal del entorno.
- Pendiente ejecutar smoke visual final desde navegador operador y capturar evidencia local.

## 9) Bugs corregidos

1. **CTA legacy no conservaba query/hash** en modo `mex.legacy.force=1` para rutas operativas.
   - Impacto: pérdida de contexto al saltar a App Shell (ej. `?mva=...`).
   - Fix: CTA ahora usa `appRoute + query + hash` solo en rutas operativas forzadas.
   - Archivo: `js/views/legacy-shell-bridge.js`.

## 10) Pendientes reales

- Re-ejecutar smoke visual manual en navegador local sobre las validaciones funcionales end-to-end (login, creación solicitud, roles, responsive y consola runtime), debido a indisponibilidad DNS del host desde este runner.
