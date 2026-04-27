# Migracion `notas_admin` -> `incidencias` (plazaID)

Este documento define la migracion futura de datos para consolidar incidencias en una coleccion canonica `incidencias` con `plazaID`.

## Estado actual

- Fuente operativa vigente: `notas_admin`.
- Lectura/escritura legacy: `obtenerTodasLasNotas`, `suscribirNotasAdmin`, `guardarNuevaNotaDirecto`, `resolverNotaDirecto`, `eliminarNotaDirecto`.
- App Shell `/app/incidencias` ya lee desde `notas_admin` mediante un data layer (`incidencias-data.js`).

## Modelo objetivo (`incidencias`)

Campos minimos por documento:

- `id`
- `plazaID` (canonico, obligatorio)
- `plaza` (compatibilidad)
- `mva`
- `titulo`
- `descripcion`
- `tipo`
- `prioridad`
- `estado`
- `autor`
- `creadoPor`
- `creadoEn`
- `actualizadoPor`
- `actualizadoEn`
- `resueltoPor`
- `resueltoEn`
- `solucion`
- `evidencias`
- `source`
- `legacyNotaId`
- `version`

## Mapeo recomendado

- `legacyNotaId` = id original de `notas_admin`.
- `plazaID` = `plaza` normalizada en mayusculas.
- `descripcion` = `descripcion` || `nota`.
- `prioridad`:
  - `CRITICA|URGENTE|ALTA` -> `alta`
  - `MEDIA` -> `media`
  - `BAJA` -> `baja`
- `estado`:
  - `PENDIENTE` -> `abierta`
  - `RESUELTA` -> `resuelta`
- `evidencias` = merge de `adjuntos`/`evidencias`/`evidenciaUrls`.
- `source` = `notas_admin_migration`.
- `version` = conservar valor actual o `1`.

## Estrategia segura (sin destruccion)

1. **Snapshot**: exportar respaldo de `notas_admin`.
2. **Dry run**: generar conteos por plaza y muestreo de documentos mapeados.
3. **Upsert idempotente**:
   - clave sugerida en `incidencias`: mismo id de nota o hash estable.
   - guardar `legacyNotaId` para dedupe.
4. **Validacion**:
   - comparar conteos por plaza (`notas_admin` vs `incidencias`).
   - validar campos obligatorios (`plazaID`, `estado`, `prioridad`, `creadoEn`).
5. **Rollout dual**:
   - lectura primaria continua en `notas_admin` durante transicion.
   - lectura secundaria en `incidencias` opcional para QA.
6. **Cutover** (fase futura):
   - cambiar fuente principal a `incidencias`.
   - mantener compatibilidad de escritura por un periodo controlado.

## Indices sugeridos (fase futura)

- `incidencias`: `plazaID + creadoEn desc`
- `incidencias`: `plazaID + estado + creadoEn desc`
- `incidencias`: `plazaID + prioridad + creadoEn desc`

## Rollback

- Si falla validacion, volver lectura principal a `notas_admin`.
- No borrar `notas_admin` hasta confirmar estabilidad en produccion.
- Mantener script idempotente para reintentos parciales.

## Nota

Este documento no ejecuta ninguna migracion automatica ni modifica datos en produccion.
