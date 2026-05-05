# Contrato: mapa-incidencias-summary.js

**FASE 14B-A** · Fecha: 2026-05-04  
**Módulo:** `js/app/features/mapa/mapa-incidencias-summary.js`  
**Propósito:** Capa de datos compartida para que `/app/mapa` consulte conteo/resumen de incidencias/notas por MVA usando UNA SOLA suscripción por plaza, sin duplicar listeners y sin romper `/app/incidencias`.

---

## Propósito

Proveer a la vista de mapa un resumen agrupado por MVA de las incidencias activas (y resueltas) para la plaza activa, sin que cada unidad/celda abra su propio listener de Firestore. Una sola suscripción alimenta un cache que la UI puede consultar síncronamente por MVA.

---

## API pública

### `createMapaIncidenciasSummaryController(options)`

Crea un controlador con estado interno y una suscripción gestionada.

```js
import {
  createMapaIncidenciasSummaryController
} from '/js/app/features/mapa/mapa-incidencias-summary.js';

const ctrl = createMapaIncidenciasSummaryController({
  plaza: 'MERIDA',             // plaza inicial
  api: window.api,             // opcional, fallback a window.api
  db: window._db,              // opcional, fallback a import { db }
  onSummary: (snapshot) => {},  // callback con cada update
  onError: (error, snap) => {},// callback de error
  debug: undefined             // forzar debug; si no, lee mex.debug.mode
});
```

**Métodos:**

| Método | Descripción |
|--------|-------------|
| `subscribe()` | Inicia la suscripción. Idempotente (no-op si ya activa). |
| `cleanup()` | Cierra listener y marca inactivo. Idempotente y seguro de llamar múltiples veces. |
| `setPlaza(plaza)` | Cierra listener anterior, reinicia estado, re-suscribe si estaba activo. No-op si la plaza es igual. |
| `getSnapshot()` | Retorna copia defensiva del estado actual (seguro de mutar). |
| `isActive()` | Boolean: true si hay suscripción activa. |

### `normalizeNotaForMapaSummary(id, data)`

Normaliza un documento de `notas_admin` a un item limpio para el summary.

```js
import { normalizeNotaForMapaSummary } from '/js/app/features/mapa/mapa-incidencias-summary.js';

const item = normalizeNotaForMapaSummary('12345', docData);
// → { id, mva, titulo, descripcion, estado, prioridad, critica, autor, timestamp, ... }
```

### `buildIncidenciasSummaryByMva(items)`

Agrupa items normalizados por MVA.

```js
import { buildIncidenciasSummaryByMva } from '/js/app/features/mapa/mapa-incidencias-summary.js';

const byMva = buildIncidenciasSummaryByMva(normalizedItems);
// → { "12345": { mva, total, abiertas, criticas, resueltas, latestAt, ... }, ... }
```

### `getSummaryForMva(summary, mva)`

Accessor seguro. Retorna entry para un MVA o empty shape si no existe.

```js
import { getSummaryForMva } from '/js/app/features/mapa/mapa-incidencias-summary.js';

const entry = getSummaryForMva(snapshot, '12345');
// → { mva: '12345', total: 0, abiertas: 0, criticas: 0, ... }
```

---

## Shape del summary (snapshot)

```js
{
  plaza: 'MERIDA',
  total: 15,             // total incidencias en la plaza
  byMva: {
    '12345': {
      mva: '12345',
      total: 3,
      abiertas: 2,       // abierta + en_proceso
      criticas: 1,        // critica o alta Y no resuelta
      resueltas: 1,
      latestAt: 1714847000000,  // epoch ms
      latestTitle: 'Fuga de aceite',
      latestPriority: 'critica',
      items: [...]        // array de items normalizados
    }
  },
  updatedAt: 1714847000000,
  loading: false,
  error: '',
  permissionDenied: false,
  missingIndex: false,
  active: true
}
```

### Shape de cada item normalizado

```js
{
  id: '1714847000',
  mva: '12345',
  titulo: 'Fuga de aceite',
  descripcion: 'Se observa fuga en motor',
  estado: 'abierta',         // 'abierta' | 'en_proceso' | 'resuelta'
  prioridad: 'critica',      // 'critica' | 'alta' | 'media' | 'baja'
  critica: true,              // shorthand (prioridad critica o alta)
  autor: 'ADMIN',
  timestamp: 1714847000000,   // epoch ms
  resueltaEn: 0,
  plaza: 'MERIDA',
  evidencias: [...],
  source: 'notas_admin',
  version: 1
}
```

---

## Fuente de datos

**Prioridad 1:** `window.api.suscribirNotasAdmin(callback, plaza)`  
- Usa el listener ya existente en `mex-api.js` / `api/notas.js`.
- Filtra por plaza server-side con `where('plaza', '==', plaza)`.
- Retorna unsubscribe function.

**Prioridad 2 (fallback):** Firestore directo  
- `db.collection('notas_admin').where('plaza', '==', plaza).orderBy('timestamp', 'desc').onSnapshot(...)`
- Si falla por índice faltante → fallback sin where, filtra client-side + limit 300.

---

## Normalización de campos legacy

| Campo fuente | Destino |
|-------------|---------|
| `mva`, `unidad`, `codigo` | `mva` |
| `titulo` | `titulo` |
| `descripcion`, `nota` | `descripcion` |
| `prioridad` | `prioridad` (normalizado) |
| `estado` | `estado` (normalizado) |
| `timestamp`, `fecha`, `creadoEn` | `timestamp` (epoch ms) |
| `resueltaEn`, `resueltoEn` | `resueltaEn` (epoch ms) |
| `adjuntos`, `evidencias`, `evidenciaUrls` | `evidencias` (merged, deduped) |
| `plaza`, `plazaID`, `plazaId` | `plaza` |
| `autor`, `creadoPor` | `autor` |

### Normalización de estados

| Valor en Firestore | Estado normalizado |
|--------------------|--------------------|
| PENDIENTE, ABIERTA, EN_PROCESO, (cualquier otro) | `abierta` |
| EN_PROCESO, EN PROCESO | `en_proceso` |
| RESUELTA, RESUELTO, CERRADA, CERRADO | `resuelta` |

### Normalización de prioridades

| Valor en Firestore | Prioridad normalizada |
|---------------------|-----------------------|
| CRITICA, CRÍTICA, CRITICO, CRÍTICO, URGENTE | `critica` |
| ALTA | `alta` |
| BAJA | `baja` |
| (cualquier otro) | `media` |

---

## Cleanup / Lifecycle

```
subscribe()     → abre UNA suscripción para la plaza actual
cleanup()       → cierra listener, incrementa token (invalida callbacks pendientes)
setPlaza(next)  → cleanup() → reset state → subscribe() si estaba activo
```

- `cleanup()` es idempotente: llamarlo N veces es seguro.
- Token guard: cada subscribe incrementa `_token`; callbacks con token viejo son ignorados.
- `setPlaza()` cierra listener anterior **antes** de abrir nuevo → 0 listeners duplicados.
- `_unsub` se nullifica después de llamar → doble-cleanup no explota.

---

## Errores manejados

| Error | Detección | Acción |
|-------|-----------|--------|
| `permission-denied` | `error.code === 'permission-denied'` | Marca `permissionDenied`, emite error |
| Missing index | `error.code === 'failed-precondition'` o message contiene `requires an index` | Marca `missingIndex`, intenta fallback sin where + limit 300 |
| Sin plaza | `plaza === ''` | Emite error descriptivo, no abre listener |
| Sin fuente de datos | ni api ni db | Emite error, no abre listener |
| API falla en setup | try/catch around suscribirNotasAdmin | Fallthrough a Firestore directo |

---

## Cómo Cursor debe integrarlo en `mapa.js`

### 1. Importar

```js
import {
  createMapaIncidenciasSummaryController,
  getSummaryForMva
} from '/js/app/features/mapa/mapa-incidencias-summary.js';
```

### 2. Crear controlador (dentro de mount o init)

```js
let _incSummaryCtrl = null;

function mountIncidenciasSummary(plaza) {
  _incSummaryCtrl = createMapaIncidenciasSummaryController({
    plaza,
    onSummary: (snap) => {
      // Actualizar badges/conteos en celdas del mapa
      renderIncidenciasBadges(snap);
    },
    onError: (err) => {
      console.warn('[mapa] incidencias summary error:', err?.message);
    }
  });
  _incSummaryCtrl.subscribe();
}
```

### 3. Cambio de plaza

```js
// Al cambiar plaza, no crear nuevo controlador:
_incSummaryCtrl?.setPlaza(nuevaPlaza);
```

### 4. Consultar por MVA (síncrono)

```js
const snap = _incSummaryCtrl.getSnapshot();
const info = getSummaryForMva(snap, unidad.mva);
// info.total, info.abiertas, info.criticas, info.latestTitle
```

### 5. Cleanup en unmount

```js
function unmountView() {
  _incSummaryCtrl?.cleanup();
  _incSummaryCtrl = null;
}
```

---

## Qué NO hace este módulo

- ❌ NO toca el DOM
- ❌ NO escribe en Firestore (read-only)
- ❌ NO borra incidencias
- ❌ NO sube/borra adjuntos en Storage
- ❌ NO importa vistas ni CSS
- ❌ NO crea listeners por unidad individual
- ❌ NO duplica el listener de `/app/incidencias` (es una suscripción independiente al mismo Firestore, cada vista maneja su propio lifecycle)
- ❌ NO modifica `mapa.js` ni ningún archivo de vista
- ❌ NO toca login/auth/functions/rules

---

## Riesgos

| Riesgo | Mitigación |
|--------|------------|
| Dos vistas suscritas a `notas_admin` al mismo tiempo | Firestore client cache comparte snapshots del mismo query; no hay doble lectura del backend |
| Plaza sin datos | Retorna `{ total: 0, byMva: {} }` limpio |
| Índice faltante en Firestore | Fallback a query sin where + filtro client-side (limit 300) |
| Campo `mva` vacío en notas | El item se normaliza pero se excluye del grouping (no aparece en `byMva`) |
| Callback stale tras setPlaza rápido | Token guard descarta callbacks de tokens previos |

---

## Validaciones manuales

- [x] Sin errores de sintaxis (ES6 module, import/export limpio)
- [x] Sin dependencia de DOM (no `document`, no `window.document`, no `querySelector`)
- [x] No importa vistas
- [x] No escribe Firestore (solo `onSnapshot` / lectura)
- [x] `cleanup()` seguro con N llamadas
- [x] `setPlaza()` cierra anterior antes de abrir nuevo
- [x] Debug solo con `mex.debug.mode === "1"`
- [x] Funciones puras exportadas para uso fuera del controlador

---

## Archivos

| Archivo | Acción |
|---------|--------|
| `js/app/features/mapa/mapa-incidencias-summary.js` | **NUEVO** |
| `docs/mapa-incidencias-summary-contract.md` | **NUEVO** (este archivo) |
| `docs/mapa-listeners-audit.md` | **Nota mínima** (sección 14B-A) |
| `docs/app-real-view-migration-status.md` | **Nota mínima** (pendiente 14B) |

---

## Commit sugerido

```
feat(mapa): add incidencias summary data controller

FASE 14B-A — Shared data layer for incidencias/notas per MVA.
Single subscription per plaza via api.suscribirNotasAdmin or
Firestore fallback. Normalizes legacy fields, groups by MVA.
Exposes reactive summary with idempotent cleanup.

New files:
- js/app/features/mapa/mapa-incidencias-summary.js
- docs/mapa-incidencias-summary-contract.md

No UI changes. No mapa.js/css/sw/login/functions/rules touched.
```
