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

