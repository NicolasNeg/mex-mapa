# Post 13A Dashboard Smoke Results

Fecha: 2026-04-28  
Fase: 13A.1  
Alcance: QA final de `/home -> /app/dashboard` como primera vista `REAL_COMPLETA` con `APP_FIRST`.

| Área | Prueba | Resultado | Evidencia breve | Acción tomada | Pendiente |
|---|---|---|---|---|---|
| Redirect `/home` | `/home` redirige a `/app/dashboard` | PASS | `legacy-shell-bridge` incluye `/home` en `shouldAutoRedirect()` y usa `window.location.replace(appRoute + query + hash)` | Sin cambio | Validación visual en navegador real |
| Redirect `/home` | No loop en redirect | PASS | El bridge corre en legacy (`/home`) y apunta a `/app/dashboard`; no hay regla recursiva sobre `/app/dashboard` | Sin cambio | Ninguno |
| Redirect `/home` | Preserva query/hash | PASS | Construcción explícita `appRoute + query + hash` | Sin cambio | Validación manual con URL real en browser |
| Fallback `mex.legacy.force` | `/home` abre legacy con force=1 | PASS | `shouldForceLegacy()` bloquea auto-redirect cuando `mex.legacy.force==="1"` | Sin cambio | Validación visual por usuario final |
| Fallback `mex.legacy.force` | CTA legacy -> App Shell | PASS | Para `/home`, `isForcedOperationalLegacy` ahora incluye `/home` y banner usa texto `Estás en legacy · Abrir App Shell` | Sin cambio | Ninguno |
| Fallback `mex.legacy.force` | Sin doble header/sidebar roto | WARNING | Revisión estática del cleanup CSS/bridge correcta; falta evidencia visual 1:1 en browser | Documentado | Ejecutar check visual rápido en navegador |
| Roles | Programador/admin ve módulos `admin/programador` | PASS | `dashboard.js` en `_modulesForRole()` incluye ambos para `PROGRAMADOR/JEFE_OPERACION` | Sin cambio | Validar con sesión real programador |
| Roles | Jefe plaza ve módulos operativos + `cuadre/admin` según rol | PASS | `_isAdminRole()` y `_modulesForRole()` habilitan set de gestión para roles administrativos | Sin cambio | Validar con sesión real jefe de plaza |
| Roles | Operativo no ve `admin/programador` | PASS | Rama default de `_modulesForRole()` excluye `admin/programador` | Sin cambio | Validar con sesión operativa real |
| Roles | Usuario sin plaza válida muestra bloqueo claro | PASS | `dashboard.js` muestra `appdash__warning` cuando no hay plaza activa | Sin cambio | Confirmar copy con QA funcional |
| KPIs reales | Cargan unidades/externos/incidencias/solicitudes | PASS | `_loadMetrics()` consulta `CUADRE`, `EXTERNOS`, `NOTAS`, `solicitudes` (admin-only) | Sin cambio | Validación de valores con data productiva |
| KPIs reales | Pendientes cola y mensajes no leídos | PASS | `_loadPending()` lee `cola_preparacion/{plaza}/items` y `obtenerMensajesPrivados()` | Sin cambio | Validar muestra con dataset real |
| KPIs reales | Solicitudes solo admin | PASS | `isAdmin` en `_loadMetrics()` + card `#appDashPendSolCard` escondida para no-admin | Sin cambio | Ninguno |
| Preview mapa | Carga preview real | PASS | `_loadMapPreview()` usa `obtenerEstructuraMapa()`, `obtenerDatosParaMapa()`, `obtenerDatosFlotaConsola()` | Sin cambio | Validación visual por plaza |
| Preview mapa | No agrupa falso todo como PATIO | PASS | Summary usa celdas/zonas del view model (`buildMapaPreviewSummary`) sin bucket único PATIO | Sin cambio | Ninguno |
| Cambio de plaza | Recarga KPIs/preview/pendientes | PASS | `onPlazaChange()` ejecuta `Promise.all([_loadMetrics,_loadMapPreview,_loadPending])` | Sin cambio | Validar UX en browser móvil |
| Carga/queries | Sin queries repetitivas pesadas | PASS | Cargas en mount + cambio plaza; sin polling infinito en dashboard | Sin cambio | Monitoreo continuo en QA manual |
| Búsqueda global | Filtra módulos | PASS | `_applyQuery()` filtra por `data-module-text` | Sin cambio | Ninguno |
| Búsqueda global | MVA muestra CTA `Buscar en mapa` | PASS | CTA `#appDashSearchMapAction` visible si query parece unidad y abre `/app/mapa?q=<query>` | Sin cambio | Ninguno |
| Búsqueda global | Filtra pendientes visibles | PASS | `_applyQuery()` filtra `data-pending-text` en cards de pendientes | Sin cambio | Ninguno |
| Responsive | 390/430/768/1366/pantalla grande | WARNING | CSS tiene breakpoints `980`, `767`, `420`, y grids fluidos; falta evidencia visual por viewport real | Documentado | Ejecutar verificación visual multi-viewport |
| Console/Network | Sin `/config.js` runtime | PASS | Búsqueda repo: no referencias runtime en vistas activas (`dashboard/home/bridge`) | Sin cambio | Ninguno |
| Console/Network | Sin assets faltantes | FAIL -> PASS | Detectado `home.html` con favicon `logo.png` inexistente | Corregido a `/img/no-model.svg` | Revalidar en browser que no aparezca 404 |
| Console/Network | Sin Firebase duplicate app / errores críticos | WARNING | No se observó evidencia en código; falta inspección runtime de consola navegador | Documentado | Validación manual de consola |
| Service Worker | Instala con nueva versión | PASS | `CACHE_NAME` actualizado a `mapa-v259` para propagar hotfix QA | Bump de cache | Ninguno |

## Bugs encontrados

1. **Asset 404 potencial en fallback legacy de `/home`**: icono apuntaba a `/img/logo.png` inexistente.

## Bugs corregidos

1. `home.html`: favicon y apple-touch-icon migrados a `/img/no-model.svg`.
2. `sw.js`: bump `CACHE_NAME` `mapa-v258 -> mapa-v259`.

## Estado final 13A.1

- `/home -> /app/dashboard`: **APP_FIRST** y redirección activa por bridge.
- `mex.legacy.force`: mantiene fallback legacy para `/home` con CTA discreto a App Shell.
- `/app/dashboard`: se mantiene como **REAL_COMPLETA** (13A), sin exponer debug a usuario normal.
- QA 13A.1 documentado con evidencia técnica y pendientes de validación visual en navegador.

---

## Actualización FASE 13B (visual port desde `/home`)

La vista App del dashboard se reemplazó por la misma estructura visual que `js/views/home.js` → `renderHome` (grid bento, hero mapa, KPI columna, resumen + actividad). Estado documentado en inventario: **REAL_COMPLETA_VISUAL_PORT**. Las pruebas de esta tabla siguen siendo válidas salvo que la UI ya no usa el layout reinterpretado de fases anteriores.
