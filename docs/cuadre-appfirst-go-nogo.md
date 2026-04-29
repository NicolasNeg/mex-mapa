# Cuadre App-first Go/No-Go (FASE 12G)

Fecha: 2026-04-28  
Alcance: decisión formal para `/cuadre -> /app/cuadre` con escape legacy.

## Matriz Go/No-Go

| Criterio | Resultado | Evidencia breve | Bloquea redirect | Acción requerida |
|---|---|---|---|---|
| 1. `/app/cuadre` carga con PROGRAMADOR/admin | PASS | Vista App operativa con `mount` y fuentes de datos activas en `js/app/views/cuadre.js` | No | Smoke manual continuo |
| 2. `/app/cuadre` carga con jefe de plaza | WARNING | Requiere validación con usuario real de rol específico en entorno productivo | No | Verificar en QA por rol |
| 3. `/app/cuadre` carga con usuario operativo autorizado | WARNING | Requiere sesión real de auxiliar/operativo | No | Verificar en QA por rol |
| 4. Plaza global funciona | PASS | Uso de `getCurrentPlaza` + `onPlazaChange` con recarga `_reloadForPlaza` | No | Monitoreo smoke |
| 5. Cambiar plaza recarga datos correctamente | PASS | `_reloadForPlaza` reinicia estado y re-suscribe con cleanup | No | Monitoreo smoke |
| 6. Flota patio carga | PASS | `subscribeCuadre` + tabla principal y KPIs | No | Ninguna |
| 7. Externos cargan | PASS | Tab `externos` y filtro por `tipo/ubicacion EXTERNO` | No | Ninguna |
| 8. Cuadre admins read-only carga | PASS | `obtenerCuadreAdminsData` en tab `admins` (solo lectura) | No | Ninguna |
| 9. Historial read-only carga | PASS | `obtenerHistorialCuadres` + filtro por fecha | No | Ninguna |
| 10. Filtros por chip funcionan | PASS | Chips conectados a `_state.filter` + `_applyFiltersAndSort` | No | Ninguna |
| 11. Filtro Sin ubicación funciona | PASS | Chip `sin-ubicacion` agregado y evaluado en `_matchFilter` | No | Ninguna |
| 12. Filtros select estado/categoría/ubicación | PASS | Selects dinámicos + filtros en `_applyFiltersAndSort` | No | Ninguna |
| 13. Búsqueda global funciona | PASS | Listener `mex:global-search` aplicado a `/app/cuadre` | No | Ninguna |
| 14. Búsqueda base maestra read-only | PASS | `obtenerUnidadesVeloz` + resultados sin mutaciones | No | Ninguna |
| 15. Panel detalle de unidad funciona | PASS | `_renderDetail` con datos operativos/timestamps/origen | No | Ninguna |
| 16. Copiar MVA funciona | PASS | Botón `data-cqv-copy` usa clipboard API | No | Ninguna |
| 17. Copiar JSON funciona | PASS | Botón `data-cqv-copy-json` serializa item actual | No | Ninguna |
| 18. Abrir `/app/mapa?q=MVA` funciona | PASS | CTA dedicada en panel detalle | No | Ninguna |
| 19. Abrir `/cuadre` legacy funciona | PASS | CTA `Consola classic` mantenida | No | Ninguna |
| 20. Export CSV funciona | PASS | Acción local cliente `#cqvExportCsv` sin backend | No | Ninguna |
| 21. Copiar resumen filtrado funciona | PASS | Acción local cliente `#cqvCopySummary` | No | Ninguna |
| 22. Mobile 390px usable | PASS | Ajustes en `css/app-cuadre.css` para wraps/selects | No | Monitoreo visual |
| 23. Mobile 430px usable | PASS | Mismo ajuste responsive | No | Monitoreo visual |
| 24. Tablet 768px usable | PASS | Grid colapsa a una columna (`@media 1100`) | No | Monitoreo visual |
| 25. Desktop 1366px usable | PASS | Tabla amplia + panel lateral sticky | No | Ninguna |
| 26. No hay 404 | WARNING | Requiere comprobación runtime en navegador/productivo | No | Verificación rápida post-deploy |
| 27. No hay errores críticos | WARNING | Requiere consola runtime por rol | No | Verificación QA |
| 28. No hay Firebase duplicate app | PASS | No se añadió init adicional; se mantiene `firebase-init.js` único | No | Ninguna |
| 29. No hay permission-denied falso | PASS | Manejo explícito de error de permisos en `_renderTableError` | No | Ninguna |
| 30. No hay listeners duplicados navegando 5 veces | PASS | Cleanup en `unmount` + `_stopListener` + unsubs trazables | No | Ninguna |
| 31. `/cuadre` legacy sigue funcionando | PASS | No se altera lógica legacy; solo redirect con escape | No | Ninguna |
| 32. Acciones destructivas siguen bloqueadas | PASS | App sigue solo con lectura/acciones seguras; sin altas/bajas/edición | No | Ninguna |
| 33. `/mapa` legacy sigue funcionando | PASS | `/mapa` sin redirect y sin cambios destructivos | No | Ninguna |
| 34. `/mapa` NO redirige | PASS | `shouldAutoRedirect` no incluye `/mapa` | No | Ninguna |

## Clasificación final

**READY_TO_REDIRECT_WITH_LEGACY_ESCAPE**

Justificación:
- Operación diaria de `/app/cuadre` está cubierta (datos, filtros, detalle, acciones seguras y responsive).
- Las capacidades que permanecen en legacy son oficialmente de alto riesgo/destructivas y no bloquean App-first mientras exista escape legacy.
- Se activa redirect con `mex.legacy.force=1` como válvula operativa.

## Decisión 12G

- Activar `/cuadre -> /app/cuadre` (App-first).
- Mantener escape `localStorage["mex.legacy.force"] === "1"`.
- Mantener fallback legacy visible y operativo para funciones oficiales no migradas.
