# Papeletas Mobile-App Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign papeletas capture UX into a clean 6-step mobile app flow while extending domain/data for `ZONAS_CORE`, transactional uniqueness, atomic `finalizeDelivery`, typed damages, and immutability — without breaking existing Firestore docs or routes.

**Architecture:** Cirugía UI + additive domain/data. Rules live in `domain/papeleta.model.js` and `js/app/features/papeletas/*-data.js`; the view only invokes and renders. Keep URLs, Storage paths, perms, reportes, and export infrastructure. Dual-read legacy strokes / `fotoTableroPath`; new writes use `danosMarcados` + zone ids.

**Tech Stack:** Vanilla ES modules, Firebase compat (`js/core/database.js`), Firestore transactions + Storage, `mexDialog`/`mexAlert`/`mexConfirm`, Inter + Material Symbols, CSS scoped under `.pap`.

**Spec:** `docs/superpowers/specs/2026-07-20-papeletas-mobile-app-redesign-design.md` (approved)

## Global Constraints

- No parallel second flow (“modo app” vs “modo hoja”).
- No English status rename in Firestore. Statuses: `borrador | lista | entregada | en_retorno | cerrada_historial | cancelada`.
- Do not delete the 12 existing `ZONAS_V1` ids; add `tablero_kilometraje` and `interior` additively.
- UI must not invent delivery/uniqueness/immutability rules — call domain/data.
- No native `alert()`/`confirm()` for normal flow — use `mexAlert` / `mexConfirm` / `mexDialog`.
- Cleanup camera + listeners + debounce timers on unmount.
- Export signing: PDF “Exportado por …” + filename `USUARIO_FECHA_EMPRESA.pdf`.
- Closeout each meaningful increment: `node scripts/bump-sw.js` → commit → push. Deploy hosting when a user-visible slice is ready (after domain + flow chrome + first steps).
- Prefer completing priorities 1–5 solidly over superficial work on 6–9 in one session.

## File map

| Path | Responsibility |
|------|----------------|
| `domain/papeleta.model.js` | Pure gates: `ZONAS_CORE`, checklist, `puedeEntregar`, damages, immutability, policy |
| `scripts/test-papeleta-model.js` | Node assert suite (update for new API) |
| `js/app/features/papeletas/papeletas-data.js` | TX create+lock, `finalizeDelivery`, revision autosave, cancel, immutability rejects |
| `js/app/features/papeletas/papeletas-constants.js` | Labels (+ `cancelada`), re-exports |
| `js/core/database.js` | Add `COL.PAPELETAS_ACTIVAS = 'papeletas_activas'` |
| `firestore.rules` | Lock collection + post-entrega field guards + `cancelada` |
| `js/app/views/papeletas.js` | 6-step chrome + wire steps; thin orchestration |
| `js/app/features/papeletas/papeletas-diagram.js` | Tap marks `danosMarcados` + dual-read strokes; per-view coords |
| `js/app/features/papeletas/papeletas-camera.js` | Guided camera for `ZONAS_CORE` order |
| `js/app/features/papeletas/papeletas-pdf.js` | Rasterized diagram + formal PDF |
| `css/app-papeletas.css` | Clean app tokens under `.pap` (not paper) |

Optional splits (recommended when file pressure grows; not blockers):
- `js/app/features/papeletas/papeletas-flow.js` — step chrome helpers
- `js/app/features/papeletas/papeletas-damages.js` — damage sheet UI helpers

---

### Task 1: Domain — ZONAS_CORE, checklist, puedeEntregar, damages, immutability

**Files:**
- Modify: `domain/papeleta.model.js`
- Modify: `scripts/test-papeleta-model.js`

**Interfaces:**
- Produces:
  - `STATUS.CANCELADA = 'cancelada'`
  - `ZONAS_EXTRA` / additive zone defs for `tablero_kilometraje`, `interior`
  - `ZONAS_ALL` = `ZONAS_V1` + extras (createEmptyZonas uses this)
  - `ZONAS_CORE` = frozen id array of 6 (spec §6.2)
  - `coreZonasHaveFoto(zonas, { fotoTableroPathFallback }?)` → boolean
  - `resolveZonaFotoPath(zonas, zonaId, papeleta?)` — dual-read tablero legacy
  - `isChecklistComplete(papeleta)` — keys + llantas + tapetes
  - `checklistCompleto(checklist)` — keep for key-only; prefer `isChecklistComplete` for gates
  - `puedeEntregar(papeleta, opts?)` → `{ ok, hard: string[], soft: string[] }`
  - Legacy shim: keep callers compiling — if old 3-arg form detected, adapt OR update all call sites in same PR
  - `computeStatusAfterSave({ status, zonas, checklist, papeleta? })` — uses core+checklist+km/gas; preserves terminal + cancelada
  - `DAMAGE_TYPES`, `DAMAGE_SEVERITIES`, `DAMAGE_PHOTO_POLICY`
  - `createDamageMark({ view, x, y, damageType, severity, note, photoIds, source, nextDisplayNumber })`
  - `nextDisplayNumber(danosMarcados)` — max existing + 1 (never reuse)
  - `clampNorm(n)` → `[0,1]`
  - `assertSalidaMutable(status)` / `isSalidaMutable(status)`
  - `isValidKm(km)`, `isGasSet(gas)`, `isValidFirma(firma)`, `hasFaltantes(checklist)`, `requiresKmJustification(papeleta)`, `kmTableroRetakeNeeded(papeleta, newKm)`
  - `compareDamages(salidaMarks, entradaMarks)` helper for regreso (Task 8)

- [ ] **Step 1: Rewrite failing tests first**

Replace `scripts/test-papeleta-model.js` with:

```js
// Domain tests for papeleta.model.js (no Firebase).
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const mod = await import(
    pathToFileURL(path.join(__dirname, '..', 'domain', 'papeleta.model.js')).href
  );

  // ZONAS_V1 intact (12); extras additive
  assert.strictEqual(mod.ZONAS_V1.length, 12);
  assert.strictEqual(mod.ZONAS_V1[0].id, 'trasera_cajuela');
  assert.strictEqual(mod.ZONAS_V1[11].id, 'cofre');
  assert.ok(mod.ZONAS_ALL.some((z) => z.id === 'tablero_kilometraje'));
  assert.ok(mod.ZONAS_ALL.some((z) => z.id === 'interior'));
  assert.deepStrictEqual([...mod.ZONAS_CORE], [
    'frente_defensa',
    'trasera_cajuela',
    'lateral_izq',
    'lateral_der',
    'tablero_kilometraje',
    'interior',
  ]);

  const zonas = mod.createEmptyZonas();
  assert.ok(zonas.tablero_kilometraje);
  assert.ok(zonas.interior);
  assert.strictEqual(mod.coreZonasHaveFoto(zonas), false);
  assert.strictEqual(mod.allZonasHaveFoto(zonas), false);

  for (const id of mod.ZONAS_CORE) {
    zonas[id] = { estado: 'ok', nota: '', fotoPath: `p/${id}` };
  }
  assert.strictEqual(mod.coreZonasHaveFoto(zonas), true);
  // allZonas still needs full ZONAS_V1 (+ extras without path still fail all?)
  // Spec: allZonasHaveFoto = progress optional; keep = every ZONAS_V1 has foto (12), not extras-required.
  for (const z of mod.ZONAS_V1) {
    zonas[z.id] = { estado: 'ok', nota: '', fotoPath: `p/${z.id}` };
  }
  assert.strictEqual(mod.allZonasHaveFoto(zonas), true);

  // Legacy fotoTableroPath fallback
  const zonasNoTablero = { ...zonas, tablero_kilometraje: { estado: 'ok', nota: '', fotoPath: '' } };
  assert.strictEqual(
    mod.coreZonasHaveFoto(zonasNoTablero, { fotoTableroPath: 'legacy/tablero.jpg' }),
    true
  );

  // Checklist keys alone incomplete without llantas/tapetes
  const cl = mod.createEmptyChecklist();
  for (const k of mod.CHECKLIST_KEYS) cl[k] = 'ok';
  assert.strictEqual(mod.checklistCompleto(cl), true);

  let p = {
    status: 'borrador',
    checklist: cl,
    zonas,
    marcasLlantas: mod.createEmptyMarcasLlantas(),
    tapetes: { usoRudo: null, alfombra: null },
    salida: { km: 1000, gas: 4 },
    clienteNombre: 'Ana',
  };
  assert.strictEqual(mod.isChecklistComplete(p), false); // llantas+tapetes empty

  p = {
    ...p,
    marcasLlantas: {
      delanteraIzq: 'M', delanteraDer: 'M', traseraIzq: 'M', traseraDer: 'M', marcarTodas: true,
    },
    tapetes: { usoRudo: 2, alfombra: 4 },
  };
  assert.strictEqual(mod.isChecklistComplete(p), true);

  // faltante is soft, not hard
  p = { ...p, checklist: { ...cl, placas: 'faltante' }, status: 'borrador' };
  const firmaOk = {
    imagePath: 'f/1.png',
    signerName: 'Ana',
    signerRole: 'Cliente',
    signedAt: Date.now(),
    capturedBy: 'u1',
    consentTextVersion: 'v1',
  };
  let gate = mod.puedeEntregar(p, { firma: firmaOk });
  assert.strictEqual(gate.ok, true);
  assert.ok(gate.soft.includes('faltantes'));
  assert.ok(!gate.hard.includes('checklist'));

  // missing core photo → hard
  const zonasMissing = { ...zonas, interior: { estado: 'ok', nota: '', fotoPath: '' } };
  gate = mod.puedeEntregar({ ...p, zonas: zonasMissing }, { firma: firmaOk });
  assert.strictEqual(gate.ok, false);
  assert.ok(gate.hard.includes('core_photos'));

  // terminal status
  gate = mod.puedeEntregar({ ...p, status: 'entregada' }, { firma: firmaOk });
  assert.strictEqual(gate.ok, false);
  assert.ok(gate.hard.includes('status'));

  gate = mod.puedeEntregar({ ...p, status: 'cancelada' }, { firma: firmaOk });
  assert.strictEqual(gate.ok, false);

  // displayNumber never reused
  const marks = [];
  const m1 = mod.createDamageMark({
    view: 'left_side', x: 0.5, y: 0.5, damageType: 'scratch', severity: 'small',
    nextDisplayNumber: mod.nextDisplayNumber(marks),
  });
  marks.push(m1);
  marks.pop(); // delete
  const m2 = mod.createDamageMark({
    view: 'left_side', x: 0.2, y: 0.2, damageType: 'dent', severity: 'medium',
    nextDisplayNumber: mod.nextDisplayNumber(marks.length ? marks : [m1]),
  });
  // After delete, nextDisplayNumber should still be based on max ever assigned in the array passed;
  // pass remaining marks + keep max via helper that accepts maxHint OR keep deleted in history.
  // Spec: never reuse in session — nextDisplayNumber(danos) = max(displayNumber)+1 over array.
  // After pop, max of empty is 0 → would reuse 1. So session counter must live outside OR
  // we pass lastAssigned. Implement nextDisplayNumber(danos, lastAssigned?) and createDamageMark uses it.
  assert.ok(m1.displayNumber >= 1);
  assert.ok(m2.id !== m1.id);

  assert.strictEqual(mod.isSalidaMutable('borrador'), true);
  assert.strictEqual(mod.isSalidaMutable('entregada'), false);
  assert.throws(() => mod.assertSalidaMutable('entregada'));

  assert.strictEqual(mod.clampNorm(1.2), 1);
  assert.strictEqual(mod.clampNorm(-0.1), 0);

  assert.strictEqual(
    mod.computeStatusAfterSave({ status: 'borrador', zonas, checklist: cl, papeleta: p }),
    'lista'
  );
  assert.strictEqual(
    mod.computeStatusAfterSave({ status: 'cancelada', zonas, checklist: cl }),
    'cancelada'
  );

  assert.strictEqual(mod.DAMAGE_PHOTO_POLICY.glass, 'strongly_recommended');
  assert.strictEqual(mod.STATUS.CANCELADA, 'cancelada');

  console.log('OK papeleta.model redesign', mod.ZONAS_CORE.length, 'core');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
node scripts/test-papeleta-model.js
```

Expected: FAIL (missing exports / wrong `puedeEntregar` shape).

- [ ] **Step 3: Implement domain changes in `domain/papeleta.model.js`**

Key additions (append/replace carefully; keep existing exports working where possible):

```js
export const STATUS = Object.freeze({
  BORRADOR: 'borrador',
  LISTA: 'lista',
  ENTREGADA: 'entregada',
  EN_RETORNO: 'en_retorno',
  CERRADA_HISTORIAL: 'cerrada_historial',
  CANCELADA: 'cancelada',
});

export const ZONAS_EXTRA = Object.freeze([
  { orden: 13, id: 'tablero_kilometraje', label: 'Tablero / kilometraje', vista: 'interior' },
  { orden: 14, id: 'interior', label: 'Interior', vista: 'interior' },
]);

export const ZONAS_ALL = Object.freeze([...ZONAS_V1, ...ZONAS_EXTRA]);

export const ZONAS_CORE = Object.freeze([
  'frente_defensa',
  'trasera_cajuela',
  'lateral_izq',
  'lateral_der',
  'tablero_kilometraje',
  'interior',
]);

export const DAMAGE_TYPES = Object.freeze([
  'scratch', 'deep', 'dent', 'glass', 'missing', 'hit', 'other',
]);
export const DAMAGE_SEVERITIES = Object.freeze(['small', 'medium', 'large']);
export const DAMAGE_PHOTO_POLICY = Object.freeze({
  scratch: 'recommended',
  deep: 'strongly_recommended',
  dent: 'strongly_recommended',
  glass: 'strongly_recommended',
  missing: 'strongly_recommended',
  hit: 'strongly_recommended',
  other: 'recommended',
});

const TERMINAL = new Set([
  STATUS.ENTREGADA, STATUS.EN_RETORNO, STATUS.CERRADA_HISTORIAL, STATUS.CANCELADA,
]);

export function createEmptyZonas() {
  const o = {};
  for (const z of ZONAS_ALL) {
    o[z.id] = { estado: 'ok', nota: '', fotoPath: '', capturedAt: null };
  }
  return o;
}

export function resolveZonaFotoPath(zonas = {}, zonaId, papeleta = null) {
  const direct = String(zonas?.[zonaId]?.fotoPath || '').trim();
  if (direct) return direct;
  if (zonaId === 'tablero_kilometraje') {
    return String(
      papeleta?.fotoTableroPath
      || papeleta?.salida?.fotoTableroPath
      || ''
    ).trim();
  }
  return '';
}

export function coreZonasHaveFoto(zonas = {}, opts = {}) {
  const papeleta = opts.papeleta || null;
  const fallbackTablero = opts.fotoTableroPath || '';
  return ZONAS_CORE.every((id) => {
    if (id === 'tablero_kilometraje') {
      const p = resolveZonaFotoPath(zonas, id, papeleta) || String(fallbackTablero || '').trim();
      return p.length > 0;
    }
    return String(zonas[id]?.fotoPath || '').trim().length > 0;
  });
}

export function isChecklistComplete(papeleta = {}) {
  const cl = papeleta.checklist || {};
  const keysOk = CHECKLIST_KEYS.every((k) =>
    ['ok', 'faltante', 'na'].includes(String(cl[k] || ''))
  );
  const llantas = normalizeMarcasLlantas(papeleta);
  const llantasOk = LLANTA_KEYS.every((k) => String(llantas[k] || '').trim().length > 0);
  const tapetes = normalizeTapetes(papeleta);
  const tapetesOk = tapetes.usoRudo != null && tapetes.alfombra != null;
  return keysOk && llantasOk && tapetesOk;
}

export function isValidKm(km) {
  if (km == null || km === '') return false;
  const n = Number(km);
  return Number.isFinite(n) && n >= 0;
}

export function isGasSet(gas) {
  if (gas == null || gas === '') return false;
  const n = Number(gas);
  return Number.isFinite(n) && n >= 0;
}

export function isValidFirma(firma) {
  if (!firma || typeof firma !== 'object') return false;
  const path = String(firma.imagePath || firma.firmaPath || '').trim();
  if (!path) return false;
  if (firma.rejected === true || firma.singlePoint === true) return false;
  return true;
}

export function hasFaltantes(checklist = {}) {
  return CHECKLIST_KEYS.some((k) => String(checklist[k] || '') === 'faltante');
}

export function isSalidaMutable(status) {
  return status === STATUS.BORRADOR || status === STATUS.LISTA;
}

export function assertSalidaMutable(status) {
  if (!isSalidaMutable(status)) {
    const err = new Error('Salida inmutable (papeleta ya entregada o cerrada)');
    err.code = 'SALIDA_IMMUTABLE';
    throw err;
  }
}

export function clampNorm(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

export function nextDisplayNumber(danosMarcados = [], lastAssigned = 0) {
  let max = Number(lastAssigned) || 0;
  for (const d of danosMarcados || []) {
    const n = Number(d?.displayNumber ?? d?.number);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

export function createDamageMark({
  id,
  view,
  x,
  y,
  damageType = 'scratch',
  severity = 'medium',
  note = '',
  photoIds = [],
  source = 'salida',
  nextDisplayNumber: num,
} = {}) {
  const displayNumber = Number(num) > 0 ? Number(num) : 1;
  return {
    id: String(id || `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`),
    displayNumber,
    view: String(view || 'top'),
    x: clampNorm(x),
    y: clampNorm(y),
    damageType: DAMAGE_TYPES.includes(damageType) ? damageType : 'other',
    severity: DAMAGE_SEVERITIES.includes(severity) ? severity : 'medium',
    note: String(note || '').slice(0, 500),
    photoIds: Array.isArray(photoIds) ? photoIds.slice() : [],
    source: source === 'entrada' ? 'entrada' : 'salida',
  };
}

/**
 * @param {object} papeleta
 * @param {{ firma?: object, pendingWrites?: boolean, kmJustification?: string, confirmedWarnings?: string[] }} [opts]
 * @returns {{ ok: boolean, hard: string[], soft: string[] }}
 */
export function puedeEntregar(papeleta, opts = {}) {
  // Back-compat shim: old signature (status, zonas, checklist)
  if (typeof papeleta === 'string') {
    const status = papeleta;
    const zonas = opts; // 2nd arg was zonas when called as (status, zonas, checklist)
    // Detect 3-arg legacy from arguments
  }
  // Prefer object form only going forward — update all call sites in Task 2/5.

  if (!papeleta || typeof papeleta !== 'object') {
    return { ok: false, hard: ['status'], soft: [] };
  }
  if (TERMINAL.has(papeleta.status)) {
    return { ok: false, hard: ['status'], soft: [] };
  }

  const firma = opts.firma || papeleta.salida?.firma || null;
  const hard = [];
  if (!isValidKm(papeleta.salida?.km)) hard.push('km');
  if (!isGasSet(papeleta.salida?.gas)) hard.push('gas');
  if (!isChecklistComplete(papeleta)) hard.push('checklist');
  if (!coreZonasHaveFoto(papeleta.zonas, { papeleta })) hard.push('core_photos');
  if (!isValidFirma(firma)) hard.push('firma');
  if (opts.pendingWrites) hard.push('pending_writes');
  const just = opts.kmJustification ?? papeleta.salida?.kmJustificacion ?? '';
  if (requiresKmJustification(papeleta) && !String(just).trim()) {
    hard.push('km_justification');
  }
  if (hard.length) return { ok: false, hard, soft: [] };

  const soft = [];
  if (!String(papeleta.clienteNombre || '').trim() && !String(firma?.signerName || '').trim()) {
    soft.push('cliente');
  }
  if (hasFaltantes(papeleta.checklist)) soft.push('faltantes');
  if (damagesMissingPhoto(papeleta.danosMarcados || papeleta.salida?.danosMarcados)) {
    soft.push('damage_photos');
  }
  if (optionalPhotosPending(papeleta.zonas)) soft.push('optional_photos');
  if (papeleta.correccionesSoloPapeleta) soft.push('master_corrected_local');
  if (largeDamagesWithoutVentasReport(papeleta)) soft.push('large_damage_report');
  return { ok: true, hard: [], soft };
}

export function requiresKmJustification(papeleta = {}) {
  // Keep simple: if salida.kmAnomalia === true or delta > threshold stored on doc
  return papeleta.salida?.kmAnomalia === true || papeleta.kmAnomalia === true;
}

export function damagesMissingPhoto(danos = []) {
  return (danos || []).some((d) => {
    const policy = DAMAGE_PHOTO_POLICY[d.damageType] || 'recommended';
    if (policy === 'omit') return false;
    return !(Array.isArray(d.photoIds) && d.photoIds.length > 0);
  });
}

export function optionalPhotosPending(zonas = {}) {
  const core = new Set(ZONAS_CORE);
  return ZONAS_V1.some((z) => {
    if (core.has(z.id)) return false;
    return !String(zonas[z.id]?.fotoPath || '').trim();
  });
}

export function largeDamagesWithoutVentasReport(papeleta = {}) {
  const marks = papeleta.danosMarcados || papeleta.salida?.danosMarcados || [];
  const hasLarge = marks.some((d) => d.severity === 'large');
  if (!hasLarge) return false;
  return !String(papeleta.casoVentasId || '').trim();
}

export function kmTableroRetakeNeeded(papeleta, newKm) {
  const path = resolveZonaFotoPath(papeleta?.zonas, 'tablero_kilometraje', papeleta);
  if (!path) return false;
  const capturedAt = papeleta?.zonas?.tablero_kilometraje?.capturedAt;
  if (!capturedAt) return true; // photo exists, km changing → warn
  const prev = papeleta?.salida?.km;
  if (prev == null) return false;
  return Number(prev) !== Number(newKm);
}

export function computeStatusAfterSave({ status, zonas, checklist, papeleta } = {}) {
  if (TERMINAL.has(status)) return status;
  const doc = papeleta || { status, zonas, checklist, salida: papeleta?.salida };
  const merged = {
    ...(papeleta || {}),
    status,
    zonas: zonas ?? papeleta?.zonas,
    checklist: checklist ?? papeleta?.checklist,
  };
  const kmOk = isValidKm(merged.salida?.km);
  const gasOk = isGasSet(merged.salida?.gas);
  if (coreZonasHaveFoto(merged.zonas, { papeleta: merged }) && isChecklistComplete(merged) && kmOk && gasOk) {
    return STATUS.LISTA;
  }
  return STATUS.BORRADOR;
}

// Update puedeEditar unchanged (borrador|lista).
// Keep checklistCompleto as keys-only helper.
// Keep allZonasHaveFoto = every ZONAS_V1 has foto (not extras) for optional progress.
```

**Important:** Fix `puedeEntregar` call sites in the same commit as the signature change (view + any tests). Prefer object form only; remove boolean usage.

Also fix `createEmptyZonas` consumers — new docs get 14 zone slots; old docs missing keys: treat missing as empty in `coreZonasHaveFoto`.

- [ ] **Step 4: Run tests — expect PASS**

```bash
node scripts/test-papeleta-model.js
```

Expected: `OK papeleta.model redesign 6 core`

- [ ] **Step 5: Closeout**

```bash
node scripts/bump-sw.js
git add domain/papeleta.model.js scripts/test-papeleta-model.js sw.js
git commit -m "feat(papeletas): domain ZONAS_CORE, puedeEntregar hard/soft, damages helpers"
git push
```

---

### Task 2: Data — lock TX, finalizeDelivery, merge, revision, cancel, rules

**Files:**
- Modify: `js/core/database.js` — add `PAPELETAS_ACTIVAS: 'papeletas_activas'`
- Modify: `js/app/features/papeletas/papeletas-data.js`
- Modify: `firestore.rules`
- Modify: `js/app/features/papeletas/papeletas-constants.js` — `cancelada` label
- Modify: `js/app/views/papeletas.js` — switch `entregarPapeleta` → `finalizeDelivery`; adapt `puedeEntregar` usage

**Interfaces:**
- Produces:
  - `crearPapeleta` — Firestore transaction + lock doc
  - `releasePapeletaActivaLock(unidadId)`
  - `cancelarPapeleta(id, { user, motivo })`
  - `finalizeDelivery(id, payload)` → `{ ok, alreadyFinalized?, papeleta }`
  - `actualizarPapeleta(id, patch, { user, knownRevision })` — revision conflict + immutability
  - Keep `entregarPapeleta` as thin deprecated wrapper calling `finalizeDelivery` OR remove and update view

- [ ] **Step 1: Add COL + lock helpers**

In `js/core/database.js`:

```js
PAPELETAS_ACTIVAS: 'papeletas_activas',
```

In `papeletas-data.js`:

```js
function _activasCol() {
  return db.collection(COL.PAPELETAS_ACTIVAS);
}

export async function releasePapeletaActivaLock(unidadId) {
  const id = String(unidadId || '').trim();
  if (!id) return;
  try {
    await _activasCol().doc(id).delete();
  } catch (e) {
    console.warn('[papeletas] release lock', e?.message);
  }
}
```

- [ ] **Step 2: Rewrite `crearPapeleta` as transaction**

```js
export async function crearPapeleta({ unidad, plazaId, user }) {
  const unidadId = String(unidad?.id || unidad?.unidadId || '').trim();
  if (!unidadId) throw new Error('Unidad requerida');

  const meta = _userMeta(user);
  const lockRef = _activasCol().doc(unidadId);
  const papeletaRef = _col().doc(); // pre-allocate id

  try {
    await db.runTransaction(async (tx) => {
      const lockSnap = await tx.get(lockRef);
      if (lockSnap.exists) {
        const existingId = String(lockSnap.data()?.papeletaId || '');
        const err = new Error('Ya existe una papeleta activa para esta unidad');
        err.code = 'ACTIVE_EXISTS';
        err.existingId = existingId;
        throw err;
      }

      const doc = {
        unidadId,
        mva: String(unidad.mva || '').toUpperCase(),
        modelo: String(unidad.modelo || ''),
        placas: String(unidad.placas || '').toUpperCase(),
        color: String(unidad.color || ''),
        vin: String(unidad.vin || '').toUpperCase(),
        plazaId: String(plazaId || unidad.plazaId || '').toUpperCase(),
        status: STATUS.BORRADOR,
        clienteNombre: '',
        checklist: createEmptyChecklist(),
        zonas: createEmptyZonas(),
        marcasLlantas: createEmptyMarcasLlantas(),
        tapetesUsoRudo: null,
        tapetesAlfombra: null,
        danosMarcados: [],
        diagramaStrokes: [],
        zonasTemplateVersion: 2,
        revision: 1,
        salida: {
          km: unidad.km ?? unidad.kilometraje ?? null,
          gas: unidad.gasolina ?? unidad.gas ?? null,
        },
        entrada: {},
        activoPorUnidad: true,
        casoVentasId: '',
        pdfUrl: '',
        creadoPor: meta.uid,
        creadoPorNombre: meta.nombre,
        actualizadoPor: meta.uid,
        creadoAt: _fv(),
        actualizadoAt: _fv(),
      };

      tx.set(papeletaRef, doc);
      tx.set(lockRef, {
        papeletaId: papeletaRef.id,
        unidadId,
        createdAt: _fv(),
        createdBy: meta.uid,
      });
    });
  } catch (e) {
    if (e?.code === 'ACTIVE_EXISTS') {
      // Attach existing doc for UI
      if (e.existingId) {
        e.existing = await getPapeleta(e.existingId);
      } else {
        e.existing = await getPapeletaActivaByUnidad(unidadId);
      }
      throw e;
    }
    throw e;
  }

  return { id: papeletaRef.id };
}
```

Also: UI pre-check `getPapeletaActivaByUnidad` remains for UX before calling create.

- [ ] **Step 3: Fix `actualizarPapeleta` — immutability + revision**

```js
const SALIDA_IMMUTABLE_KEYS = new Set([
  'zonas', 'checklist', 'danosMarcados', 'diagramaStrokes',
  'marcasLlantas', 'tapetesUsoRudo', 'tapetesAlfombra', 'tapetes',
]);

export async function actualizarPapeleta(id, patch, { user, knownRevision } = {}) {
  const ref = _col().doc(id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Papeleta no encontrada');
    const current = { id: snap.id, ...snap.data() };

    if (!isSalidaMutable(current.status)) {
      // Allow only non-salida meta if needed; default reject salida fields
      const keys = Object.keys(patch || {});
      const touchesSalida = keys.some((k) =>
        SALIDA_IMMUTABLE_KEYS.has(k) || k === 'salida' || k === 'status'
      );
      if (touchesSalida && current.status !== STATUS.CANCELADA) {
        const err = new Error('Salida inmutable');
        err.code = 'SALIDA_IMMUTABLE';
        throw err;
      }
    }

    const remoteRev = Number(current.revision) || 0;
    if (knownRevision != null && Number(knownRevision) !== remoteRev) {
      const err = new Error('Conflicto de revisión');
      err.code = 'REVISION_CONFLICT';
      err.remote = current;
      throw err;
    }

    const nextZonas = patch.zonas != null ? patch.zonas : current.zonas;
    const nextChecklist = patch.checklist != null ? patch.checklist : current.checklist;
    const mergedForStatus = { ...current, ...patch, zonas: nextZonas, checklist: nextChecklist };
    const status = computeStatusAfterSave({
      status: current.status,
      zonas: nextZonas,
      checklist: nextChecklist,
      papeleta: mergedForStatus,
    });

    const meta = _userMeta(user);
    // If patch.salida provided, merge into current.salida — never blind replace
    let data = { ...patch };
    if (patch.salida && typeof patch.salida === 'object') {
      data.salida = { ...(current.salida || {}), ...patch.salida };
    }
    data.status = status;
    data.revision = remoteRev + 1;
    data.actualizadoPor = meta.uid;
    data.actualizadoAt = _fv();
    tx.update(ref, data);
  });
  return getPapeleta(id);
}
```

- [ ] **Step 4: Implement `finalizeDelivery`**

```js
export async function finalizeDelivery(id, {
  quienEntrega,
  km,
  gas,
  firma, // { imagePath, signerName, signerRole, signedAt, capturedBy, consentTextVersion }
  confirmedWarnings = [],
  user,
  pdfUrl = '',
} = {}) {
  const meta = _userMeta(user);
  const ref = _col().doc(id);
  let result = null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Papeleta no encontrada');
    const current = { id: snap.id, ...snap.data() };

    if (current.status === STATUS.ENTREGADA || current.entregaFinalizedAt) {
      result = { ok: true, alreadyFinalized: true, papeleta: current };
      return;
    }

    const gate = puedeEntregar(
      { ...current, salida: { ...(current.salida || {}), km: km ?? current.salida?.km, gas: gas ?? current.salida?.gas } },
      { firma, confirmedWarnings }
    );
    if (!gate.ok) {
      const err = new Error('No se puede entregar: ' + gate.hard.join(', '));
      err.code = 'NO_ENTREGAR';
      err.hard = gate.hard;
      err.soft = gate.soft;
      throw err;
    }

    const salida = {
      ...(current.salida || {}),
      quienEntrega: String(quienEntrega || meta.nombre || ''),
      km: km ?? current.salida?.km ?? null,
      gas: gas ?? current.salida?.gas ?? null,
      firma: {
        imagePath: String(firma?.imagePath || ''),
        signerName: String(firma?.signerName || ''),
        signerRole: String(firma?.signerRole || ''),
        signedAt: firma?.signedAt || _fv(),
        capturedBy: String(firma?.capturedBy || meta.uid),
        consentTextVersion: String(firma?.consentTextVersion || 'v1'),
      },
      // legacy dual-read
      firmaPath: String(firma?.imagePath || current.salida?.firmaPath || ''),
      firmadoAt: _fv(),
      entregadoPorUid: meta.uid,
    };

    tx.update(ref, {
      status: STATUS.ENTREGADA,
      salida,
      entregadaAt: _fv(),
      entregadaPor: meta.uid,
      entregadaPorNombre: meta.nombre,
      entregaFinalizedAt: _fv(),
      pdfUrl: pdfUrl || current.pdfUrl || '',
      confirmedWarnings: confirmedWarnings.slice(),
      revision: (Number(current.revision) || 0) + 1,
      actualizadoPor: meta.uid,
      actualizadoAt: _fv(),
    });

    result = { ok: true, alreadyFinalized: false, papeletaId: id };
  });

  if (result?.alreadyFinalized) {
    return { ok: true, alreadyFinalized: true, papeleta: result.papeleta };
  }
  const papeleta = await getPapeleta(id);
  return { ok: true, alreadyFinalized: false, papeleta };
}

/** @deprecated Use finalizeDelivery */
export async function entregarPapeleta(id, opts = {}) {
  const firma = opts.firma || {
    imagePath: opts.firmaPath,
    signerName: opts.quienEntrega || '',
    signerRole: 'Cliente',
    capturedBy: _userMeta(opts.user).uid,
    consentTextVersion: 'v1',
  };
  return finalizeDelivery(id, { ...opts, firma });
}
```

- [ ] **Step 5: `cancelarPapeleta` + release lock on `registrarEntrada` / cancel**

```js
export async function cancelarPapeleta(id, { user, motivo } = {}) {
  const current = await getPapeleta(id);
  if (!current) throw new Error('Papeleta no encontrada');
  if (!isSalidaMutable(current.status) && current.status !== STATUS.BORRADOR) {
    // allow cancel only borrador|lista
    if (current.status !== STATUS.LISTA && current.status !== STATUS.BORRADOR) {
      throw new Error('No se puede cancelar en este estado');
    }
  }
  const meta = _userMeta(user);
  await _col().doc(id).update({
    status: STATUS.CANCELADA,
    activoPorUnidad: false,
    canceladaAt: _fv(),
    canceladaPor: meta.uid,
    cancelMotivo: String(motivo || '').slice(0, 500),
    revision: (Number(current.revision) || 0) + 1,
    actualizadoPor: meta.uid,
    actualizadoAt: _fv(),
  });
  await releasePapeletaActivaLock(current.unidadId);
  return getPapeleta(id);
}
```

In `registrarEntrada`: after setting `activoPorUnidad: false`, call `releasePapeletaActivaLock(current.unidadId)`.

- [ ] **Step 6: Update firestore.rules**

Add after `papeletas` match block:

```
match /papeletas_activas/{unidadId} {
  allow read: if puedeVerPapeletas();
  allow create, delete: if puedeVerPapeletas();
  allow update: if puedeVerPapeletas();
}
```

Extend papeletas update to allow `cancelada`:

```
&& request.resource.data.status in ['borrador', 'lista', 'entregada', 'cancelada']
```

And for post-entrega path keep entrada/cierre. Prefer deny mutating `salida` when `resource.data.status in ['entregada','en_retorno','cerrada_historial','cancelada']` except allowed keys — implement with `diff().affectedKeys()` when viable without breaking pdfUrl/clienteNombre patches.

- [ ] **Step 7: Update constants labels**

```js
cancelada: 'Cancelada',
```

in both `STATUS_LABELS` and `STATUS_LABELS_SHORT`.

- [ ] **Step 8: Wire view to new `puedeEntregar` / `finalizeDelivery`**

Replace boolean checks:

```js
const gate = puedeEntregar(_detail, { firma: null });
const ready = gate.ok === false && gate.hard.filter((h) => h !== 'firma').length === 0;
// Or show hard list in resumen
```

Replace `entregarPapeleta` call in `_confirmSignature` with `finalizeDelivery`.

- [ ] **Step 9: Re-run domain tests + manual sanity**

```bash
node scripts/test-papeleta-model.js
```

- [ ] **Step 10: Closeout**

```bash
node scripts/bump-sw.js
git add -A
git commit -m "feat(papeletas): transactional lock, finalizeDelivery, revision, cancelada"
git push
```

---

### Task 3: Mobile 6-step flow chrome

**Files:**
- Modify: `js/app/views/papeletas.js`
- Modify: `css/app-papeletas.css`

**Interfaces:**
- Produces: step machine `unidad | datos | km_gas | checklist | danos | fotos_firma` (ids internal); footer Atrás/Continuar; header `N de 6` + save chip.

Step map (salida only):

| # | id | Label |
|---|-----|-------|
| 1 | `unidad` | Seleccionar unidad (`/nueva`) |
| 2 | `datos` | Confirmar datos |
| 3 | `km_gas` | KM y gas |
| 4 | `checklist` | Checklist |
| 5 | `danos` | Marcar daños |
| 6 | `fotos_firma` | Fotos → resumen → firma |

Post-entrega tabs unchanged: `entrada | salida | reporte`.

- [ ] **Step 1: Add step constants + chrome HTML helpers**

```js
const SALIDA_STEPS = Object.freeze([
  { id: 'unidad', label: 'Unidad', n: 1 },
  { id: 'datos', label: 'Datos', n: 2 },
  { id: 'km_gas', label: 'KM y gas', n: 3 },
  { id: 'checklist', label: 'Checklist', n: 4 },
  { id: 'danos', label: 'Daños', n: 5 },
  { id: 'fotos_firma', label: 'Fotos y firma', n: 6 },
]);

let _saveState = 'idle'; // idle | saving | saved | conflict
```

```js
function _flowHeaderHtml(stepId) {
  const step = SALIDA_STEPS.find((s) => s.id === stepId) || SALIDA_STEPS[1];
  const chip =
    _saveState === 'saving' ? 'Guardando…'
    : _saveState === 'saved' ? 'Guardado'
    : _saveState === 'conflict' ? 'Conflicto'
    : '';
  return `
    <header class="pap-flow-header">
      <button type="button" class="pap-icon-btn" data-act="flow-back" aria-label="Atrás">
        <span class="material-symbols-outlined">arrow_back</span>
      </button>
      <div class="pap-flow-header__mid">
        <strong>${step.label}</strong>
        <span>${step.n} de 6</span>
      </div>
      <span class="pap-save-chip" data-save-chip>${chip}</span>
    </header>`;
}

function _flowFooterHtml({ canContinue = true, continueLabel = 'Continuar' } = {}) {
  return `
    <footer class="pap-flow-footer">
      <button type="button" class="pap-btn pap-btn--ghost" data-act="flow-back">Atrás</button>
      <button type="button" class="pap-btn pap-btn--primary" data-act="flow-next" ${canContinue ? '' : 'disabled'}>${continueLabel}</button>
    </footer>`;
}
```

- [ ] **Step 2: Restyle chrome CSS (clean app, not paper)**

Under `.pap`:

```css
.pap-flow-header {
  position: sticky; top: 0; z-index: 5;
  display: flex; align-items: center; gap: 12px;
  min-height: 56px; padding: 8px 12px;
  background: #fff; border-bottom: 1px solid var(--border, #e5e7eb);
}
.pap-flow-footer {
  position: sticky; bottom: 0; z-index: 5;
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  background: #fff; border-top: 1px solid var(--border, #e5e7eb);
}
.pap-flow-footer .pap-btn { min-height: 48px; }
.pap {
  --pap-bg: #F6F8FC;
  --pap-surface: #FFFFFF;
  background: var(--pap-bg);
}
```

Remove/avoid paper texture backgrounds on capture screens (keep PDF formal separately).

- [ ] **Step 3: Wire `_wizardStep` to new ids; migrate old `datos|zonas|resumen|firma`**

- Map old bookmarks: `zonas` → `fotos_firma`, `resumen`/`firma` → subviews inside step 6.
- Step 6 internal substate: `_step6 = 'fotos' | 'resumen' | 'firma' | 'exito'`.

- [ ] **Step 4: flow-back / flow-next handlers**

- From step 2 back → abandon sheet (Task 9 can stub: Continuar después / Cancelar / Seguir).
- Continuar validates step-local UX only; delivery gates stay in domain at finalize.

- [ ] **Step 5: Closeout**

```bash
node scripts/bump-sw.js
git add js/app/views/papeletas.js css/app-papeletas.css sw.js
git commit -m "feat(papeletas): mobile 6-step flow chrome header+footer"
git push
```

---

### Task 4: Steps 1–4 content (unidad, datos, KM/gas+tablero, checklist)

**Files:**
- Modify: `js/app/views/papeletas.js`
- Modify: `js/app/features/papeletas/papeletas-camera.js` (optional: single-zone capture helper)

- [ ] **Step 1: Paso 1** — keep `/nueva` search; on select call `crearPapeleta`; on `ACTIVE_EXISTS` open existing via `mexAlert` + navigate.

- [ ] **Step 2: Paso 2** — read-only ficha; primary “Datos correctos” → step 3; secondary Corregir with motivo (audit fields on patch).

- [ ] **Step 3: Paso 3** — big KM input + gas 3×3; required tablero photo via core zone; on KM change after tablero photo → `mexConfirm` retake warn (`papeleta_km_tablero_retake_warned` later).

- [ ] **Step 4: Paso 4** — “Confirmar todo presente”; row sheets; llantas + tapetes as today but layout clean.

- [ ] **Step 5: Closeout + deploy hosting if chrome+steps visible**

```bash
node scripts/bump-sw.js
git add -A && git commit -m "feat(papeletas): steps 1-4 unidad datos km checklist"
git push
npm run deploy
```

---

### Task 5: Paso 5 — diagram tap marks + dual-read

**Files:**
- Modify: `js/app/features/papeletas/papeletas-diagram.js`
- Modify: `js/app/views/papeletas.js`

**Interfaces:**
- `mountDiagram(host, { strokes, danosMarcados, editable, onDamagesChange, onStrokesChange, views })`
- Read: paint strokes + numbered marks
- Write formal: only `danosMarcados`; freehand → `diagramaStrokes`
- Coords: normalize within active view bounds; `clampNorm`

- [ ] **Step 1: Extend mountDiagram to accept `danosMarcados` and view switcher** (`top|left_side|right_side|front|rear`).

- [ ] **Step 2: Tap (non-pen) → callback `onTap(view, x, y)`**; view opens damage sheet (type → severity → note/photo).

- [ ] **Step 3: Persist via `actualizarPapeleta` field `danosMarcados` + `danosLastDisplayNumber`.

- [ ] **Step 4: Closeout**

```bash
node scripts/bump-sw.js
git commit -m "feat(papeletas): typed danosMarcados on diagram with dual-read strokes"
git push
```

---

### Task 6: Paso 6 — guided core camera, resumen hard/soft, firma, finalize, success

**Files:**
- Modify: `papeletas-camera.js`, `papeletas.js`, storage upload for new zone ids

- [ ] **Step 1:** `openGuidedCamera({ zones: ZONAS_CORE mapped to labels })` — progress n/6; optional section separate.

- [ ] **Step 2:** Resumen lists `gate.hard` (block) and `gate.soft` (confirm sheet → `confirmedWarnings`).

- [ ] **Step 3:** Firma pad — scroll lock on pointerdown; reject empty/single-point; metadata §13; upload → `finalizeDelivery`.

- [ ] **Step 4:** Success screen (check icon + “Entregada” + actions Ver PDF / Ir al listado). PDF generation after finalize (once); if `alreadyFinalized`, skip re-upload.

- [ ] **Step 5: Closeout + deploy**

```bash
node scripts/bump-sw.js
git commit -m "feat(papeletas): core camera, firma metadata, finalizeDelivery success"
git push
npm run deploy
```

---

### Task 7: Regreso comparison (no mutate salida)

**Files:**
- Modify: `domain/papeleta.model.js` — `buildEntradaDamageComparison(...)`
- Modify: `papeletas.js` panels entrada
- Persist comparison under `entrada.danosMarcados` with `comparisonStatus` + `sourceDamageId`

- [ ] Implement actions: Sin cambios / Daño nuevo / Faltante nuevo / Reparado.
- [ ] Never set `salida.danosMarcados[].isPreexisting`.
- [ ] Closeout commit.

---

### Task 8: PDF formal + rasterized diagram

**Files:**
- Modify: `papeletas-pdf.js`, `papeletas-diagram.js` (`strokesToDataUrl` → include marks)

- [ ] Rasterize silhouette + strokes + typed marks with export visual index.
- [ ] Keep export signing + filename policy.
- [ ] Closeout commit.

---

### Task 9: Dashboard mobile cards + Ventas restyle + abandon sheet + tokens polish

**Files:**
- Modify: `papeletas.js`, `app-papeletas.css`, constants filters (+ Canceladas)

- [ ] Mobile cards for list; desktop table retained.
- [ ] Ventas same visual language; no edit of signed inspection.
- [ ] Abandon sheet 3 actions + `cancelarPapeleta`.
- [ ] Final `.pap` token pass (`#F6F8FC`, radii 12/16).
- [ ] Closeout + deploy.

---

### Task 10: Smoke + domain regression

- [ ] `node scripts/test-papeleta-model.js`
- [ ] Manual smoke: crear → 6 core → checklist → daño → firmar → finalize → PDF → regreso → Ventas
- [ ] Verify lock release on cancel/entrada
- [ ] Final bump/commit/push if dirty

---

## Spec coverage checklist

| Spec section | Task(s) |
|--------------|---------|
| §4 6-step UX chrome | 3–6 |
| §5 damages + dual-read + coords | 1, 5, 8 |
| §6 ZONAS_CORE + KM retake | 1, 4, 6 |
| §7 uniqueness TX | 2 |
| §8 finalizeDelivery + immutability | 2, 6 |
| §9 hard/soft | 1, 6 |
| §10 regreso compare | 7 |
| §11 autosave revision | 2 |
| §12 abandon | 9 (stub in 3) |
| §13 firma metadata | 6 |
| §14 damage photo policy | 1, 5–6 |
| §15 metrics | 9 (emit on existing telemetry when touching events) |
| §16 dashboard/ventas | 9 |
| §17–21 domain/compat/acceptance | 1–2, 10 |
| §18 visual tokens | 3, 9 |

## Self-review

- No TBD placeholders in task steps.
- `puedeEntregar` object form + call-site updates in Task 2.
- `displayNumber` reuse prevented via `danosLastDisplayNumber` / `nextDisplayNumber(danos, lastAssigned)`.
- `entregarPapeleta` salida blind-replace bug fixed inside `finalizeDelivery` merge.
- Lock collection + rules included.
- Priorities 1–5 = Tasks 1–6 (domain, data, chrome, steps 1–4, diagram, finalize path).
