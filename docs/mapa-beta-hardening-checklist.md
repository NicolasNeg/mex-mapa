# Checklist de Hardening Beta — `/app/mapa`

**Fases:** 14C-A (auditoría estática) + **14C-B** (hardening UI) + **14C.1** (reconciliación docs)  
**Fecha:** 2026-05-04  
**Estado actual:** **BETA_OPERATIVA_FUERTE + HARDENED_FOR_BETA (14C)** + Incidencias summary (14B)  
**Código (referencia auditoría):** ~3381 líneas JS (features 2464 + view 917) + 962 CSS  

**Política documentada**

| Ruta | Clasificación |
|------|----------------|
| `/app/mapa` | **BETA_OPERATIVA_FUERTE + HARDENED_FOR_BETA** |
| `/mapa` (legacy) | **KEEP_LEGACY_BACKUP** — motor completo (editor, PDF, altas, etc.) |
| Redirect `/mapa` → `/app/mapa` | **NO ACTIVADO** (hasta decisión explícita) |

**Auditorías relacionadas (14C-A):** [`mapa-dnd-audit.md`](mapa-dnd-audit.md) · [`mapa-listeners-audit.md`](mapa-listeners-audit.md) · [`mapa-persist-audit.md`](mapa-persist-audit.md)

---

## Reconciliación 14C-A / 14C-B

| Criterio | Estado | Nota |
|----------|--------|------|
| P0 bloqueantes | **0** | Ninguno en auditoría estática 14C-A (ver `mapa-*-audit.md`) |
| Beta controlada | **GO CONTROLADO** | DnD OFF por defecto y legacy disponible |
| QA manual E2E (sección 10) | **WARNING** | No equivale a PASS hasta smoke en entorno real |
| Runtime / SW / UI en 14C.1-B | **Sin cambios** | Solo documentación |
| Login/auth/functions/rules en 14C.1-B | **Sin cambios** | — |

### Fixes 14C-B (revisión estática; no sustituyen QA manual)

| Fix 14C-B | Estado |
|-----------|--------|
| Selección alineada con filtros | OK (código) |
| Error state con CTA legacy | OK (código) |
| Banner HARDENED / beta operativa | OK (código) |
| Toolbar con acceso explícito a legacy | OK (código) |
| Detalle de unidad reforzado | OK (código) |
| Responsive toolbar/filtros | OK (código); QA 390px sigue en WARNING |

**Veredicto reconciliado:** **GO CONTROLADO para beta**. `/app/mapa` queda como centro operativo beta hardened; `/mapa` sigue siendo backup legacy completo y **no redirige**.

---

## Resumen de estado

| Componente | Estado | Fuente |
|------------|--------|--------|
| Grid celdas reales | ✅ Operativo | `mapa-renderer.js` + `mapa-view-model.js` |
| Flota tiempo real | ✅ Operativo | `mapa-data.js` → `suscribirMapaPlaza` |
| Estructura `mapa_config` | ✅ Operativo | `mapa-data.js` → `suscribirEstructuraMapa` |
| DnD preview | ✅ Operativo (flag) | `mapa-dnd.js` + `mex.appMapa.dnd` |
| DnD persistencia | ✅ Operativo (flag+rol) | `mapa-mutations.js` + `mex.appMapa.dndPersist` |
| Incidencias summary por MVA | ✅ Operativo | `mapa-incidencias-summary.js` (14B) |
| Badges incidencias en celdas | ✅ Operativo | `mapa-renderer.js` L101-148 |
| Filtros rápidos (11 opciones) | ✅ Operativo | `applyMapaQuickFilter` |
| Vista lista | ✅ Operativo | `renderMapaReadOnly` viewMode=list |
| Búsqueda global `?q=` | ✅ Operativo | `_bindGlobalSearch` + URL sync |
| Detalle de unidad | ✅ Operativo | Panel lateral con enlaces App + legacy |
| Cleanup en unmount | ✅ Implementado | `unmount()` L733-764 |
| `/mapa` legacy | ✅ Intacto, sin redirect | política DO_NOT_REDIRECT |

---

## 1. Auditoría de Lifecycle

### 1.1 mount (`mapa.js` L322-731)

| Aspecto | Estado | Observación |
|---------|--------|-------------|
| Crea lifecycle controller | ✅ | `createMapaLifecycleController` → `_lifecycle` |
| Monta DnD controller | ✅ | `createMapaDndController` → `_dndController` |
| Carga incidencias summary | ✅ | `_syncIncSummaryPlaza(plaza)` con generation guard |
| Suscribe plaza change | ✅ | `onPlazaChange` → `_offPlaza` |
| Suscribe global search | ✅ | `_bindGlobalSearch` → `_offGlobalSearch` |
| Suscribe popstate | ✅ | `window.addEventListener('popstate')` → `_offPopstate` |
| Suscribe state changes | ✅ | `subscribe()` → `_offState` |
| Registra click handlers | ✅ | `_onClick` + `_toolbarHandler` en container |
| Carga CSS dinámico | ✅ | `_ensureCss()` |

### 1.2 unmount (`mapa.js` L733-764)

| Recurso | Limpieza | Línea |
|---------|----------|-------|
| Modales abiertos | ✅ `_removeMapaModals()` | 734 |
| Incidencias ctrl | ✅ `_incCtrl?.cleanup()` + null | 736-739 |
| popstate listener | ✅ `removeEventListener` | 741 |
| toolbar click | ✅ `removeEventListener` | 743 |
| onClick | ✅ `removeEventListener` | 745 |
| global search | ✅ `_offGlobalSearch()` | 746 |
| plaza sub | ✅ `_offPlaza()` | 747 |
| state sub | ✅ `_offState()` | 748 |
| DnD controller | ✅ `unmount()` + null | 749-750 |
| lifecycle | ✅ `unmount()` + null | 751, 755 |
| refs nullified | ✅ container, contentEl, etc. | 753-762 |

**⚠️ P1 — `_cssRef` no se limpia en unmount.** El `<link>` CSS permanece en `<head>`. No causa bug funcional (guard de duplicación en `_ensureCss()`), pero `_cssRef` no se nullifica.

### 1.3 onPlazaChange (`mapa.js` L593-602)

| Paso | Estado |
|------|--------|
| DnD disable + unmount | ✅ |
| Header actualizado | ✅ |
| selectedId reset | ✅ |
| snapshot reset | ✅ |
| Loading UI inmediato | ✅ |
| Inc summary re-sync | ✅ |
| lifecycle setPlaza | ✅ |

---

## 2. Auditoría DnD

### 2.1 Flags y Roles

| Rol | Preview | Persistencia |
|-----|---------|--------------|
| PROGRAMADOR | ✅ | ✅ (si flag persist) |
| Admin global (isAdmin + esGlobal) | ✅ | ✅ |
| CORPORATIVO_USER | ❌ denied | ❌ |
| JEFE_OPERACION | ❌ denied | ❌ |
| AUXILIAR / OPERACION | ❌ denied | ❌ |

### 2.2 Validaciones de persistencia (`validatePersistMove`)

Validaciones completas: AUTH, FLAGS, NO_PLAZA, SNAPSHOT_PLAZA, NO_STRUCTURE, NO_MVA, NO_DEST, SAME, UNIT_NOT_FOUND, ORIGIN_MISMATCH, INVALID_CELL, CELL_PLAZA, BLOCKED, OCCUPIED — todas implementadas ✅.

### 2.3 Cleanup de listeners DnD

- `pointerdown` en root (capture) → removido en `unmount()` ✅
- `pointermove/up/cancel` en window (capture) → removido en `_finishInteraction` ✅
- `touchstart` en root → NO registrado (`pointerOnlyPreview=true`) ✅
- Ghost DOM element → removido en `_removeGhost` ✅
- Zone highlights → limpiados en `_clearZoneHighlight` ✅

**✅ Listeners window son temporales — solo durante gesto activo.**

---

## 3. Auditoría Incidencias Summary

| Aspecto | Estado |
|---------|--------|
| Una sola suscripción por plaza | ✅ |
| setPlaza limpia anterior | ✅ (token guard + `_closeSub`) |
| No listener por unidad | ✅ |
| Fallback si falla | ✅ (API → Firestore → missing-index) |
| No bloquea mapa | ✅ (async, graceful degradation) |
| Generation guard | ✅ (`_incSyncGen`) |
| Plaza mismatch guard | ✅ |
| Cleanup en unmount | ✅ |

---

## 4. Performance

| Aspecto | Riesgo | Recomendación |
|---------|--------|---------------|
| Full innerHTML rebuild cada snapshot | **P1** plazas >200 | Throttle/diff parcial |
| Lista truncada a 420 rows | Bajo | OK |
| `_incidentSearchMap` recalculado cada render | Bajo-Medio | Cache si ref no cambió |

---

## 5. Tabla P0/P1/P2

### P0 — Bloqueantes: **Ninguno detectado** ✅

### P1 — Corregir antes de beta ampliada

| # | Issue | Recomendación |
|---|-------|---------------|
| 1 | Full innerHTML rebuild en plazas grandes | Medir; considerar throttle |
| 2 | Sin lock de re-drag durante persist | Flag `_persistInProgress` |
| 3 | `_cssRef` no nullificado en unmount | Añadir `_cssRef = null` |

### P2 — Post-beta

| # | Issue | Recomendación |
|---|-------|---------------|
| 4 | Touch DnD deshabilitado | Evaluar post-scroll-tests |
| 5 | Swap no soportado | Fase futura |
| 6 | Filtros pueden overflow 390px | Verificar scroll horizontal |
| 7 | Sin viewport zoom/pan | Diferencia aceptada |
| 8 | Sin badge incidencias en vista lista | Añadir columna |

---

## 6. Tabla de Riesgos Beta

| Riesgo | Prob. | Impacto | Mitigación |
|--------|-------|---------|------------|
| Plaza sin estructura | Media | Medio | Mensaje + CTA legacy |
| Permission-denied | Baja | Alto | Mensaje claro + link legacy |
| Missing index notas | Media | Bajo | Fallback limit 300 |
| Snapshot stale en persist | Baja | Medio | Fresh fetch + doble validación |
| Freeze plaza >300 units | Media | Alto | innerHTML completo — medir |
| Dos tabs DnD simultáneo | Baja | Medio | Firestore es autoridad |

---

## 7. Flags Requeridos

| Flag | Beta default | Efecto ON |
|------|-------------|-----------|
| `mex.appMapa.dnd` | `0` (off) | Preview DnD |
| `mex.appMapa.dndPersist` | `0` (off) | Persistencia real |
| `mex.debug.mode` | `0` (off) | Logs verbose |
| `mex.legacy.force` | `0` (off) | Fuerza legacy |

---

## 8. Qué NO Tocar Antes de Beta

- `login.html` / `js/views/login.js` — auth
- `firestore.rules` / `storage.rules` — seguridad
- `functions/index.js` — backend
- `sw.js` — solo cache bump si deploy
- `mapa.html` / `js/views/mapa.js` (legacy)
- Redirect `/mapa` → `/app/mapa` — NO activar

---

## 9. Qué Dejar en Legacy

Editor de estructura, PDF/reportes, altas masivas, swap, radar/chat/presencia, viewport zoom/pan, categoría validación DnD completa.

---

## 10. QA Manual

**Estado global:** **WARNING** — la lista siguiente es **guía de verificación en entorno real**; no sustituye ejecución manual ni CI. Hasta completar smoke por plaza/rol, no marcar esta sección como PASS.

### 10.1 Mapa básico
1. Login → `/app/mapa` → verificar grid celdas, plaza header, contadores, buckets, link legacy.

### 10.2 DnD preview
1. `mex.appMapa.dnd=1` → recargar → badge DnD visible.
2. Arrastrar unidad cajón→cajón → "Movimiento simulado".
3. Arrastrar a bloqueado/fuera/misma celda → mensajes correctos.
4. Verificar NO escritura Firestore.

### 10.3 DnD persistencia
1. Ambos flags ON → recargar → badge "Persistencia lista".
2. Arrastrar a cajón vacío → modal confirmar → "Guardado y visible".
3. Verificar en legacy que posición cambió.
4. Arrastrar a ocupado → "Cajón ya ocupado".

### 10.4 Cambio de plaza
1. Cambiar plaza → "Actualizando…" → datos nuevos → incidencias re-sync.

### 10.5 Incidencias por MVA
1. Crear incidencia en `/app/incidencias` → volver a mapa → badge numérico.
2. Detalle unidad → sección incidencias con conteos → link "Ver incidencias".
3. Filtros "Con incidencias" / "Críticas".

### 10.6 Fallback legacy
1. `/mapa` directamente → carga legacy completo sin redirect.

### 10.7 Búsqueda
1. `?q=MVA` → resaltado + scroll → URL sync.

---

## 11. Go / No-Go

| Criterio | Estado | Go? |
|----------|--------|-----|
| Grid renderiza | ✅ (código) | Go |
| Datos tiempo real | ✅ (código) | Go |
| Cleanup unmount | ✅ (código) | Go |
| DnD preview sin escritura | ✅ (código) | Go |
| DnD persist con confirmación | ✅ (código) | Go |
| Incidencias summary | ✅ (código) | Go |
| Legacy intacto | ✅ (política) | Go |
| Sin redirect `/mapa` | ✅ (política) | Go |
| Auth/rules no tocados | ✅ (política fases mapa) | Go |
| Performance plaza mediana | ⚠️ Verificar | Condicional |
| **QA manual sección 10** | **⚠️ WARNING (pendiente)** | **No PASS hasta smoke** |

**Veredicto:** **GO condicional para beta controlada** (flags DnD OFF por defecto) mientras la **QA manual permanezca en WARNING**; **P0 bloqueantes: 0** (revisión estática + auditorías 14C-A). P1/P2: ver §5.

---

## 12. Backlog post–14C.1 (seguimiento)

1. **P1** — `_cssRef = null` en unmount (ver §1.2).
2. **P1** — Throttle renders si plaza grande causa jank.
3. **P2** — Badge incidencias en vista lista (columna "Inc").
4. **P1** — Lock de re-drag durante persist.
5. **P2** — Memoizar `_incidentSearchMap`.

*14C-B UI ya abordó banner/toolbar legacy, selección vs filtros, CTA error a legacy y responsive de filtros; ver `app-real-view-migration-status.md`.*
