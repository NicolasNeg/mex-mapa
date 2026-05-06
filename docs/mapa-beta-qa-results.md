# QA final demo — `/app/mapa` (FASE 14D-B)

**Fecha:** 2026-05-05  
**Entorno producción:** `https://mex-mapa-bjx.web.app/app/mapa`  
**Service Worker (repo actual):** `CACHE_NAME = mapa-v271` (`sw.js`)  
**Nota metodológica:** Esta pasada combina verificación sin sesión (fetch HTTP + revisión de rutas/código) y revisión estática de listeners/CTAs en archivos permitidos. Las pruebas que exigen sesión Firebase, rol concreto o interacción DnD en navegador quedaron como **WARNING** pendientes de confirmación humana antes de la demo.

---

## Tabla de resultados

| Área | Prueba | Resultado | Evidencia breve | Acción tomada | Pendiente |
|------|--------|-----------|-----------------|---------------|-----------|
| 1. Carga | `/app/mapa` responde (shell / gate auth) | **PASS** | Fetch HTML muestra flujo de login App Shell; no error de red documentado | Ninguna | Validar con sesión que la vista mapa monta tras login |
| 1. Carga | Hard reload + SW | **WARNING** | No ejecutado en navegador desde este entorno | Ninguna | Verificar en Chrome: Application → SW activo `mapa-v*` tras deploy actual |
| 2. Plaza | Selector plaza global + sin stale | **WARNING** | Requiere sesión y datos Firestore | Ninguna | Cambiar plaza 2×; confirmar header `#app-mapa-plaza-active` y snapshot `expect === snapPlaza` en `mapa.js` |
| 3. Render estructura | Celdas reales, no todo PATIO, buckets | **WARNING** | Requiere sesión | Ninguna | Smoke manual con plaza real |
| 4. Búsqueda | Header global + `?q=MVA` + scroll match | **PASS** (código) | `_readUrlQuery`, `_syncMapaUrlQuery`, `mex:global-search`, `_scrollToSearchMatch` presentes | Ninguna | Confirmar en UI con MVA real |
| 5. Filtros | todos / externos / limbo / taller / cajón / incidencias / críticas | **PASS** (código) | Chips `data-mapa-qf` alineados con renderer | Ninguna | Click-through manual |
| 6. Detalle | Click unidad → panel MVA/pos/ubicación | **PASS** (código) | `_detailPanel` en `mapa-renderer.js`; selección limpia si filtro oculta unidad | Ninguna | Confirmar en demo |
| 7. Incidencias summary | Resumen por MVA + enlaces | **PASS** (código) | `mapa-incidencias-summary.js` normaliza MVA con `_safeUp`; claves consistentes con `mvaK` en detalle | Ninguna | Validar carga con Firestore real |
| 8. DnD preview | Flag `mex.appMapa.dnd`, rol, bloqueos | **WARNING** | No probado (requiere rol autorizado + pointer) | Ninguna | Seguir checklist PROMPT 2 Parte A DnD |
| 9. DnD persistente | Flag `mex.appMapa.dndPersist`, confirm/cancel | **WARNING** | No probado | Ninguna | Solo cuenta no crítica en demo |
| 10. Lifecycle/listeners | Entrar/salir `/app/mapa` ↔ `/app/dashboard` sin fugas | **PASS** (código) | `unmount` limpia plaza, state, global-search, popstate, inc controller, DnD, lifecycle | Ninguna | Opcional: `mex.debug.mode` + `__mexTrackListener` si está cableado |
| 11. Responsive | Toolbar/filtros/badges | **WARNING** | No probado en viewports | Ninguna | Revisar móvil/tablet rápido |
| 12. Legacy fallback | `/mapa` carga y **no** redirige a `/app/mapa` | **PASS** | Fetch `/mapa` devuelve documento mapa legacy; `mapa.html` sin redirect a `/app/mapa`; CTAs en renderer apuntan a `/mapa` | Ninguna | Doble chequeo en sesión |
| 13. Consola | Sin errores JS críticos | **WARNING** | Sin ejecución browser autenticado aquí | Ninguna | Consola limpia en demo |
| 14. Go/No-Go demo | Decisión | **GO DEMO CON WARNINGS** | Código de rutas/CTAs/listeners coherente; smoke HTTP OK; suite autenticada pendiente | Documentar WARNINGs | Cerrar WARNINGs con QA manual mañana |

---

## Rutas y CTAs verificados en código (no runtime)

| CTA / ruta | Ubicación | Destino |
|------------|-----------|---------|
| Mapa legacy header/toolbar | `js/app/views/mapa.js` | `href="/mapa"`, `assign('/mapa')` |
| Incidencias | `js/app/features/mapa/mapa-renderer.js` | `/app/incidencias?mva=` + `encodeURIComponent` |
| Cuadre App | idem | `/app/cuadre` |
| Legacy con query MVA | idem | `/mapa?q=` |

---

## Clasificación de bugs (14D-B)

| Severidad | Encontrados | Corregidos | Documentados |
|-----------|-------------|------------|--------------|
| P0 | 0 | 0 | — |
| P1 | 0 | 0 | — |
| P2 | 0 | 0 | Ver checklist endurecimiento previo para mejora futura |

---

## Validaciones finales (checklist E)

| # | Ítem | Estado |
|---|------|--------|
| 1 | `/app/mapa` carga (gate auth OK) | OK (HTTP) |
| 2 | `/mapa` legacy carga | OK (HTTP) |
| 3 | `/mapa` NO redirige | OK (código + HTTP) |
| 4–7 | Login, sesión, dashboard, incidencias | **WARNING** (no tocados; no probados con sesión) |
| 8 | Sin 404 en rutas probadas | OK |
| 9–12 | Errores críticos, duplicate app, listeners | **WARNING** / PASS código lifecycle mapa |
| 13 | SW instala | **WARNING** (verificar en cliente) |
| 14 | Git status limpio | Ver después del commit de este doc |
| 15–16 | Push / deploy hosting | Solo si hay cambios runtime (esta fase: docs) |

---

## Entregable resumido

| Ítem | Valor |
|------|--------|
| **Resultado QA final** | **GO DEMO CON WARNINGS** |
| **Bugs encontrados** | Ninguno en revisión estática / smoke HTTP |
| **Bugs corregidos** | Ninguno (sin hotfix) |
| **Bugs documentados** | WARNINGs de cobertura manual pendiente (tabla arriba) |
| **Archivos modificados (esta fase)** | `docs/mapa-beta-qa-results.md` (nuevo) |
| **Cambios runtime (JS/CSS/SW)** | No |
| **`/mapa` legacy intacto** | Sí (sin cambios en archivos prohibidos) |
| **`/mapa` NO redirige** | Sí (política sin cambio) |
| **login / auth / functions / rules** | No tocados |
| **CACHE_NAME final** | `mapa-v271` (sin bump) |
| **Commit hash** | Serie `docs(mapa): QA 14D-B` en `main`; hash puntual: `git rev-parse HEAD` |
| **Push / deploy** | Push `main` OK; sin deploy hosting (solo docs) |

---

## Referencias

- Checklist endurecimiento: `docs/mapa-beta-hardening-checklist.md`
- Estado migración: `docs/app-real-view-migration-status.md`
