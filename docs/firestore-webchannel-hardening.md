# Firestore WebChannel Hardening (FASE 11F)

Fecha: 2026-04-28

## Síntomas observados

- `Listen/channel`: `net::ERR_QUIC_PROTOCOL_ERROR.QUIC_PUBLIC_RESET 200 (OK)`
- `Write/channel`: respuestas `400 (Bad Request)` en stream de escritura.

## Lectura técnica rápida

- Un `QUIC_PUBLIC_RESET` en listen puede ser transitorio de transporte (cambio de red, proxy, QUIC fallback, reconexión del SDK).
- Un `Write/channel 400` suele apuntar a una combinación de:
  - transporte inestable en ciertas redes,
  - payload inválido o escritura duplicada por flujo concurrente,
  - cambios de pestaña/SW con versión mezclada en runtime.

## Configuración aplicada

Se centralizó configuración de Firestore transport **antes del uso**:

- Archivo principal: `js/core/firebase-init.js`
- Fallback: `mex-api.js` (solo si no existe el configurador global)

### Modo por defecto (sin flag)

- `ignoreUndefinedProperties: true`
- `experimentalAutoDetectLongPolling: true`

### Modo forzado (flag local)

Si `localStorage['mex.firestore.forceLongPolling'] === '1'`:

- `ignoreUndefinedProperties: true`
- `experimentalForceLongPolling: true`
- No se combina con `experimentalAutoDetectLongPolling`.

## Cómo activar / desactivar forceLongPolling

- Activar:
  - `localStorage.setItem('mex.firestore.forceLongPolling', '1')`
- Desactivar:
  - `localStorage.removeItem('mex.firestore.forceLongPolling')`
- Recargar app después del cambio.

También disponible en `/app/programador` (roles autorizados) con botón de toggle y recarga.

## Riesgos / trade-offs

- `forceLongPolling` puede reducir rendimiento y aumentar latencia.
- Debe usarse solo si errores de WebChannel/QUIC son recurrentes.

## QA recomendado

1. Sin flag, validar rutas `/app/*` clave y escrituras básicas.
2. Activar `mex.firestore.forceLongPolling`, recargar y repetir.
3. Comparar frecuencia de errores `Listen/Write channel`.
4. Revisar `/app/programador`:
   - modo transport activo,
   - estado de persistence.
5. Limpiar cache cuando haya mezcla de versiones:
   - Application → Clear site data
   - hard reload
   - verificar versión SW en Programador.

## Alcance y límites

- No se cambiaron `Firestore rules`.
- No se cambiaron `Storage rules`.
- No se migró a SDK modular.
- No se rediseñó arquitectura Firebase.

