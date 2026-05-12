# Auditoría persistencia `/app/mapa` (Fase 9D)

## Función legacy

`window.api.guardarNuevasPosiciones(reporte, usuarioResponsable, plaza, extra)` en `mex-api.js` (~1620+).

## Payload esperado

- `reporte`: array de objetos `{ mva, pos }` (solo mayúsculas/normalización interna).
- No envía `ubicacion` en este batch: solo hace merge `{ pos }` sobre el doc en CUADRE o EXTERNOS según donde exista la unidad.

## Comportamiento

1. Busca cada MVA en **CUADRE** y **EXTERNOS** por plaza (`unitMap`).
2. Si no está en colección plana, intenta `_buscarUnidadEnSubcol`.
3. Si encuentra doc y `posAnterior !== posNueva`: `batch.set(ref, { pos }, { merge: true })`.
4. Si hubo cambios reales (`histBatch.length`): `batch.commit()`, luego escribe **historial_patio** por movimiento con tipo `MOVE`/`SWAP`/`DEL`, autor, plaza, opcional auditoría desde `extra` (`_windowLocationAuditExtra`).
5. Retorna `true` si no hubo cambios pendientes **o** tras escritura exitosa del historial.

Cuadre vs externos: ambos exponen los mismos campos de posición (`pos`); la unidad vive en una sola colección por MVA/plaza según donde esté registrada.

## Plaza

`_normalizePlazaId(plaza)` — movimientos están acotados al documento encontrado para esa plaza.

## Riesgos

- Dos unidades no pueden ocupar la misma `pos` si los datos están consistentes; la UI App Shell bloquea destino ocupado **sin swap** (fase posterior).
- Si el snapshot local está obsoleto, una validación client-side puede pasar pero la API sigue siendo autoridad en Firestore.
- `ubicacion` (interno vs externo) **no** se corrige aquí solo con `pos`; la unidad ya está en CUADRE o EXTERNOS.

## Pendiente (9E sugerido)

Swap explícito, persistencia táctil, refresco explícito post-commit si listeners no llegan a tiempo.

## FASE 14A

- Flujo App `/app/mapa` sin cambiar contrato: mismo `guardarNuevasPosiciones(reporte, usuario, plaza, extra)` tras confirmación y validación de cajón ocupado sin swap.

## FASE 14C-A (hardening audit)

- Flujo persist auditado end-to-end: `_onPersistDrop` (mapa.js L418-571) → `validatePersistMove` (mapa-mutations.js) → `_showPersistConfirm` modal → `persistUnitMove` → `_waitSnapshotReflectsMove` → resync fallback.
- **Double validation**: primero contra snapshot local, luego contra `obtenerDatosFlotaConsola` fresh si disponible.
- **Sin swap**: destino ocupado → rechazo claro con `OCCUPIED`.
- **Post-persist**: espera hasta 4.8s que snapshot refleje el cambio; si no, resync + 850ms; si no, mensaje "pulsa Refrescar".
- Checklist completo: `docs/mapa-beta-hardening-checklist.md`.

## Reconciliación FASE 14C-A / 14C-B

Estado final documentado: persistencia en `/app/mapa` queda **GO CONTROLADO** para beta, detrás de flags, rol autorizado y confirmación. `/mapa` sigue disponible como backup legacy y no redirige.

| Punto | Estado reconciliado |
|-------|---------------------|
| Contrato `guardarNuevasPosiciones` | PASS por revisión de código; sin cambio de contrato |
| Doble validación snapshot/fresh | PASS por revisión de código |
| Confirmación antes de persistir | PASS por revisión de código |
| Espera/resync post-persist | PASS por revisión de código |
| Destino ocupado | PASS por revisión de código: rechazo `OCCUPIED`, sin swap |
| Lock re-drag mientras persiste | **P1 pendiente** |
| Error state con CTA legacy 14C-B | PASS por revisión de código |
| Toolbar legacy visible 14C-B | PASS por revisión de código |
| QA manual persist real + verificación legacy | WARNING pendiente |

No se marcaron pruebas manuales como PASS. Esta reconciliación no tocó runtime, login/auth, Functions ni reglas.

## FASE 14F.1-A (reconciliación controller acciones)

- Se conserva el controller integrado por Cursor en 14F-B y se agregan solo mejoras compatibles: aliases `createUnitActionsController`/`createController`, `resolveAvailableActions` y `cleanup()` no-op.
- La API pública usada por `/app/mapa` se mantiene: `getAvailableActions`, `validateUnitAction`, `executeUnitAction`.
- Mutaciones siguen delegando en `api.aplicarEstado` o `persistUnitMove`; no se agregan escrituras nuevas ni cambios al DnD existente.
- Acciones sin rol autorizado o sin API segura siguen sin ejecutar nada.

## FASE 15B (acciones unitarias oficiales)

- `/app/mapa` agrega modales oficiales para `update_status`, `update_notes`, `update_gas` y `mark_ready`, siempre delegando validación/ejecución en `mapa-unit-actions.js`.
- Después de mutaciones seguras se llama `resyncData()` para evitar UI falsa; error muestra mensaje claro.
- Incidencia rápida usa `guardarNuevaNotaDirecto` sobre `notas_admin`; es escritura pequeña auditada y no toca DnD ni `guardarNuevasPosiciones`.
- En 15H, eliminar, alta, masivos, PDF/reportes y editor tienen entrada operativa en `/app/mapa` con permisos y confirmaciones.
