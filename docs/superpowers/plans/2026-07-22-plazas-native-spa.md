# Plazas Native SPA Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the "Plazas" admin section from the legacy iframe (`gestion.html?tab=plazas`) to a native SPA panel inside the App Shell's admin center, following the same master-detail pattern already proven by Usuarios/Empresa (`admin-usuarios-panel.js`, `admin-empresa-panel.js`), preserving every field and Firestore write the legacy version has today.

**Architecture:** New `domain/plaza.model.js` (pure validation/normalization, no Firebase) + `js/app/features/admin/admin-plazas-data.js` (Firestore reads/writes against the *same* `configuracion/empresa` doc fields the legacy code already uses: `plazas` string array, `plazasDetalle` object array, `correosInternos` catalog) + `js/app/features/admin/admin-plazas-panel.js` (UI: card list + detail form, master-detail like Usuarios) + a few new CSS rules appended to the existing single `css/app-admin.css` (all admin-shell panels share this one stylesheet — confirmed via `admin-shell.js`'s `_ensureCss()`) + two small wiring edits (`admin-nav.js`, `admin-shell.js`) to swap the iframe for the native panel.

**Tech Stack:** Vanilla ES modules, Firebase compat SDK (`db.collection(...)`), no build step, no bundler.

## Global Constraints

- **Same Firestore shape, no schema change.** Read/write `configuracion/empresa` fields `plazas` (`string[]`, uppercase plaza keys) and `plazasDetalle` (`array` of per-plaza objects) exactly as the legacy code in `js/views/mapa.js` does. Any other code (mapa rendering, plaza switcher, cuadre, etc.) reads these same fields from `window.MEX_CONFIG.empresa` — do not rename or restructure them.
- **`correosInternos` has a pre-existing dual shape in this codebase — do not try to reconcile it as part of this plan.** `js/views/mapa.js`'s `_normalizeCorreosInternosEmpresa()` (mapa.js:2423) treats it as an array of `{ titulo, correo, plazaId }` objects (auto-populated from each plaza's `correo`/`correoGerente`). The SPA Empresa panel (`admin-empresa-data.js`, already shipped) treats it as a flat array of plain email strings and will overwrite the array with plain strings the next time someone saves the Empresa panel's "Correos internos" card. This is a **pre-existing inconsistency**, not something introduced by this plan — Task 2 ports the object-shape reader/writer scoped to Plazas' own needs (the correo-select dropdowns and plaza↔correo tagging), without touching `admin-empresa-data.js`. Do not attempt a unifying refactor here; it is out of scope.
- **Out of scope for this migration:** "Duplicar hacia...", "Guardar plantilla", "Aplicar plantilla" (map-structure tools, `mapa.js` functions `abrirDuplicarEstructura`/`abrirGuardarPlantilla`/`abrirAplicarPlantilla`) are NOT ported. They stay legacy-only for now (not exposed in the new native panel). This is a deliberate scope cut — do not add placeholders or "coming soon" UI for them.
- **Permission gate:** reuse the exact pattern `admin-empresa-data.js`'s `canEditEmpresa` already uses — `hasAppPermission(profile, role, 'manage_system_settings') || hasAppPermission(profile, role, 'manage_settings')`, plus the `PROGRAMADOR`/`JEFE_OPERACION`/`CORPORATIVO_USER` role bypass. Import `hasAppPermission` from `/js/app/features/admin/admin-permissions.js`.
- **Design system:** no hardcoded hex colors, no `!important` outside documented dark-theme overrides, 4px spacing scale, existing `.adm-*` classes from `css/app-admin.css` — this stylesheet already has everything needed for card lists, detail panels, forms, buttons, pills, empty states (`.adm-listas`, `.adm-card`, `.adm-detail`, `.adm-form`, `.adm-btn`, `.adm-pill`, `.adm-empty`, `.adm-field-value`, `.adm-subsection`). Only add NEW rules for what doesn't already exist (toggle switch, contacts list, maps preview).
- **No new top-level route.** Plazas lives inside the existing `/app/admin/:section(/:id)?` addressing scheme (`admin-nav.js`'s `parseAdminRoute`/`adminSectionPath`). Do **not** touch `js/app/router.js` or `js/app/route-resolver.js` — nothing there needs to change.
- Task closeout per `CLAUDE.md`: after all tasks, run `node scripts/bump-sw.js`, commit, push — but only once, at the end of the whole plan (each task's own commit is a normal code commit; the final task in this plan does the SW bump + is followed by the controller's own closeout).

---

### Task 1: `domain/plaza.model.js` — pure validation/normalization

**Files:**
- Create: `domain/plaza.model.js`

**Interfaces:**
- Consumes: nothing (pure, no imports).
- Produces (used by Task 2): `normalizarPlazaKey(raw)`, `validarPlazaKey(key, plazasExistentes)`, `normalizarContactos(lista)`, `validarPlazaDetalle(datos)`, `normalizarPlazaDetalle(id, datos)`.

- [ ] **Step 1: Write the file**

```js
// domain/plaza.model.js
// Reglas puras de negocio del catálogo de Plazas (branches). Sin Firebase.

const PLAZA_KEY_RE = /^[A-Z0-9_-]{2,12}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizarPlazaKey(raw) {
  return String(raw || '').trim().toUpperCase();
}

/** @returns {string} mensaje de error, o '' si es válida. */
export function validarPlazaKey(key, plazasExistentes = []) {
  const k = normalizarPlazaKey(key);
  if (!k) return 'Escribe una clave para la plaza.';
  if (!PLAZA_KEY_RE.test(k)) return 'La clave solo puede tener letras, números, "-" o "_" (2 a 12 caracteres).';
  const existentes = (Array.isArray(plazasExistentes) ? plazasExistentes : []).map(normalizarPlazaKey);
  if (existentes.includes(k)) return 'Esa plaza ya existe.';
  return '';
}

export function normalizarContacto(c = {}) {
  return {
    nombre: String(c?.nombre || '').trim().toUpperCase(),
    rol: String(c?.rol || '').trim().toUpperCase(),
    telefono: String(c?.telefono || '').trim()
  };
}

export function normalizarContactos(lista = []) {
  return (Array.isArray(lista) ? lista : [])
    .map(normalizarContacto)
    .filter(c => c.nombre || c.telefono);
}

/** @returns {string} mensaje de error, o '' si es válido. */
export function validarPlazaDetalle(datos = {}) {
  const correo = String(datos?.correo || '').trim();
  const correoGerente = String(datos?.correoGerente || '').trim();
  if (correo && !EMAIL_RE.test(correo)) return 'El correo institucional no es válido.';
  if (correoGerente && !EMAIL_RE.test(correoGerente)) return 'El correo del gerente no es válido.';
  if (correo && correoGerente && correo.toLowerCase() === correoGerente.toLowerCase()) {
    return 'Selecciona correos distintos para la plaza y la gerencia.';
  }
  return '';
}

/** Normaliza el objeto completo de detalle de una plaza (para guardar). */
export function normalizarPlazaDetalle(id, datos = {}) {
  return {
    id: normalizarPlazaKey(id),
    nombre: String(datos?.nombre || '').trim(),
    descripcion: String(datos?.descripcion || '').trim(),
    localidad: String(datos?.localidad || '').trim(),
    direccion: String(datos?.direccion || '').trim(),
    mapsUrl: String(datos?.mapsUrl || '').trim(),
    temporal: Boolean(datos?.temporal),
    correo: String(datos?.correo || '').trim().toLowerCase(),
    telefono: String(datos?.telefono || '').trim(),
    gerente: String(datos?.gerente || '').trim().toUpperCase(),
    correoGerente: String(datos?.correoGerente || '').trim().toLowerCase(),
    contactos: normalizarContactos(datos?.contactos)
  };
}
```

- [ ] **Step 2: Self-check (no test framework in this repo for `domain/*`; verify by hand)**

Run: `node --input-type=module --check < domain/plaza.model.js`
Expected: no output (syntax OK). Then run this quick assertion script to check behavior:

```bash
node --input-type=module -e "
import('./domain/plaza.model.js').then(m => {
  console.assert(m.normalizarPlazaKey(' gdl ') === 'GDL', 'normalizarPlazaKey');
  console.assert(m.validarPlazaKey('', []) !== '', 'empty key must error');
  console.assert(m.validarPlazaKey('GDL', ['GDL']) !== '', 'dup key must error');
  console.assert(m.validarPlazaKey('GDL', ['BJX']) === '', 'valid unique key must pass');
  console.assert(m.validarPlazaDetalle({correo:'a@b.com', correoGerente:'a@b.com'}) !== '', 'same email must error');
  console.assert(m.validarPlazaDetalle({correo:'a@b.com', correoGerente:'c@d.com'}) === '', 'distinct emails must pass');
  console.assert(m.normalizarContactos([{nombre:'x'},{nombre:'',telefono:''}]).length === 1, 'empty contacts filtered');
  console.log('domain/plaza.model.js OK');
});
"
```
Expected output: `domain/plaza.model.js OK` with no assertion failures printed above it.

- [ ] **Step 3: Commit**

```bash
git add domain/plaza.model.js
git commit -m "feat(plazas): domain model puro para validacion de plazas"
```

---

### Task 2: `js/app/features/admin/admin-plazas-data.js` — Firestore data layer

**Files:**
- Create: `js/app/features/admin/admin-plazas-data.js`

**Interfaces:**
- Consumes: `normalizarPlazaKey`, `validarPlazaKey`, `validarPlazaDetalle`, `normalizarPlazaDetalle` from Task 1 (`/domain/plaza.model.js`); `hasAppPermission` from `/js/app/features/admin/admin-permissions.js`; `db` from `/js/core/database.js`; `registrarEventoGestion` from `/js/core/database.js`; `window.api.garantizarPlazasOperativas` (not yet bridged into `database.js` — call via `window.api`, same pattern already used by `admin-opciones-data.js`/`admin-catalogs-data.js`).
- Produces (used by Task 4): `canEditPlazas(profile, role)`, `getPlazasSnapshot()`, `getPlazaDetalle(id)`, `getCorreoOptions(selectedVal, currentPlazaId, fieldName, plazaData)`, `crearPlaza({ key, nombre, descripcion })` (throws on validation error), `guardarPlaza(id, datosForm)` (throws on validation error), `eliminarPlaza(id)`.

- [ ] **Step 1: Write the file**

```js
/**
 * Datos / mutaciones de la sección Plazas (panel admin SPA).
 * Misma fuente de verdad que la config legacy: configuracion/empresa,
 * campos `plazas` (string[]) y `plazasDetalle` (array de objetos).
 */
import { db, registrarEventoGestion } from '/js/core/database.js';
import { hasAppPermission } from '/js/app/features/admin/admin-permissions.js';
import {
  normalizarPlazaKey,
  validarPlazaKey,
  validarPlazaDetalle,
  normalizarPlazaDetalle
} from '/domain/plaza.model.js';

export function canEditPlazas(profile, role) {
  const r = String(role || '').trim().toUpperCase();
  if (r === 'PROGRAMADOR' || r === 'JEFE_OPERACION' || r === 'CORPORATIVO_USER') return true;
  return hasAppPermission(profile, role, 'manage_system_settings')
    || hasAppPermission(profile, role, 'manage_settings');
}

function _ensureEmpresa() {
  if (!window.MEX_CONFIG) window.MEX_CONFIG = {};
  if (!window.MEX_CONFIG.empresa || typeof window.MEX_CONFIG.empresa !== 'object') {
    window.MEX_CONFIG.empresa = {};
  }
  return window.MEX_CONFIG.empresa;
}

function _safeLower(v) { return String(v || '').trim().toLowerCase(); }
function _safeUpper(v) { return String(v || '').trim().toUpperCase(); }

/**
 * `correosInternos` en este doc tiene una forma dual heredada del legacy:
 * puede traer strings sueltos o { titulo, correo, plazaId }. Aquí SOLO lo
 * leemos/normalizamos para el selector de correos de Plazas — no se
 * reconcilia con la forma más simple que usa el panel Empresa (ver Global
 * Constraints del plan).
 */
function _correosInternosCatalog() {
  const emp = _ensureEmpresa();
  const normalized = [];
  const seen = new Map();
  const plazasDetalle = Array.isArray(emp.plazasDetalle) ? emp.plazasDetalle : [];
  const rawList = Array.isArray(emp.correosInternos) ? emp.correosInternos : [];

  function upsert(rawItem, fallback = {}) {
    const isObject = rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem);
    const correo = _safeLower(isObject ? (rawItem.correo || rawItem.email || rawItem.mail) : rawItem);
    if (!correo) return;
    const next = {
      titulo: String(isObject ? (rawItem.titulo || rawItem.nombre || fallback.titulo || '') : (fallback.titulo || '')).trim(),
      correo,
      plazaId: _safeUpper(isObject ? rawItem.plazaId : fallback.plazaId)
    };
    if (seen.has(correo)) {
      const current = seen.get(correo);
      if (!current.titulo && next.titulo) current.titulo = next.titulo;
      if (!current.plazaId && next.plazaId) current.plazaId = next.plazaId;
      return;
    }
    seen.set(correo, next);
    normalized.push(next);
  }

  rawList.forEach(item => upsert(item));
  plazasDetalle.forEach(plaza => {
    const plazaId = _safeUpper(plaza?.id);
    if (plaza?.correo) upsert({ correo: plaza.correo, plazaId }, { titulo: `${plazaId} INSTITUCIONAL`, plazaId });
    if (plaza?.correoGerente) upsert({ correo: plaza.correoGerente, plazaId }, { titulo: `${plazaId} GERENCIA`, plazaId });
  });
  return normalized;
}

function _reassignCorreoCatalogForPlaza(plazaId, correo = '', correoGerente = '') {
  const currentPlaza = _safeUpper(plazaId);
  const selected = new Set([_safeLower(correo), _safeLower(correoGerente)].filter(Boolean));
  const catalog = _correosInternosCatalog();
  catalog.forEach(item => {
    if (_safeUpper(item.plazaId) === currentPlaza && !selected.has(item.correo)) item.plazaId = '';
    if (selected.has(item.correo)) item.plazaId = currentPlaza;
  });
  selected.forEach(correoSel => {
    if (catalog.some(item => item.correo === correoSel)) return;
    catalog.push({
      titulo: correoSel === _safeLower(correoGerente) ? `${currentPlaza} GERENCIA` : `${currentPlaza} INSTITUCIONAL`,
      correo: correoSel,
      plazaId: currentPlaza
    });
  });
  _ensureEmpresa().correosInternos = catalog;
}

function _releaseCorreoCatalogForPlaza(plazaId) {
  const currentPlaza = _safeUpper(plazaId);
  const catalog = _correosInternosCatalog();
  catalog.forEach(item => { if (_safeUpper(item.plazaId) === currentPlaza) item.plazaId = ''; });
  _ensureEmpresa().correosInternos = catalog;
}

/** Opciones para un <select> de correo institucional/gerente, ya resueltas (sin HTML). */
export function getCorreoOptions(selectedVal = '', currentPlazaId = '', fieldName = 'correo', plazaData = {}) {
  const currentPlaza = _safeUpper(currentPlazaId);
  const currentValue = _safeLower(selectedVal);
  const counterpartValue = _safeLower(fieldName === 'correo' ? plazaData?.correoGerente : plazaData?.correo);
  const catalog = _correosInternosCatalog();

  const disponibles = catalog.filter(item => {
    if (!item.correo) return false;
    if (currentValue && item.correo === currentValue) return true;
    if (counterpartValue && item.correo === counterpartValue) return false;
    return !item.plazaId || item.plazaId === currentPlaza;
  }).sort((a, b) => a.correo.localeCompare(b.correo, 'es'));

  const items = [...disponibles];
  if (currentValue && !items.some(item => item.correo === currentValue)) {
    items.unshift({
      titulo: fieldName === 'correoGerente' ? `${currentPlaza} GERENCIA` : `${currentPlaza} INSTITUCIONAL`,
      correo: currentValue,
      plazaId: currentPlaza
    });
  }
  return items.map(item => {
    const assigned = _safeUpper(item.plazaId);
    const suffix = assigned && assigned !== currentPlaza ? ` · ${assigned}` : '';
    const label = item.titulo ? `${item.titulo} · ${item.correo}${suffix}` : `${item.correo}${suffix}`;
    return { value: item.correo, label, selected: item.correo === currentValue };
  });
}

export function getPlazasSnapshot() {
  const emp = window.MEX_CONFIG?.empresa || {};
  const ids = Array.isArray(emp.plazas) ? emp.plazas.map(normalizarPlazaKey) : [];
  const detalles = Array.isArray(emp.plazasDetalle) ? emp.plazasDetalle : [];
  return ids
    .map(id => {
      const d = detalles.find(x => normalizarPlazaKey(x?.id) === id) || {};
      return { ...d, id };
    })
    .sort((a, b) => a.id.localeCompare(b.id, 'es'));
}

export function getPlazaDetalle(id) {
  const key = normalizarPlazaKey(id);
  return getPlazasSnapshot().find(p => p.id === key) || null;
}

async function _persist(actionType, message, successMessage, extra = {}) {
  const emp = _ensureEmpresa();
  await db.collection('configuracion').doc('empresa').set(emp, { merge: true });
  try {
    if (window.api?.garantizarPlazasOperativas) {
      await window.api.garantizarPlazasOperativas(emp.plazas || []);
    }
  } catch (err) {
    console.warn('[admin-plazas] garantizarPlazasOperativas:', err?.message || err);
  }
  try {
    await registrarEventoGestion(actionType, message, extra);
  } catch (err) {
    console.warn('[admin-plazas] audit log:', err?.message || err);
  }
  try {
    if (typeof window.__mexInvalidateConfigCache === 'function') window.__mexInvalidateConfigCache();
  } catch (_) { /* ignore */ }
  return successMessage;
}

export async function crearPlaza({ key, nombre = '', descripcion = '' } = {}) {
  const emp = _ensureEmpresa();
  const error = validarPlazaKey(key, emp.plazas || []);
  if (error) throw new Error(error);
  const id = normalizarPlazaKey(key);
  emp.plazas = [...(emp.plazas || []), id];
  emp.plazasDetalle = [...(emp.plazasDetalle || []), { id, nombre: String(nombre || '').trim(), descripcion: String(descripcion || '').trim() }];
  await _persist('PLAZA_CREADA', `Creó la plaza ${id}`, `Plaza "${id}" creada.`, { entidad: 'PLAZAS', referencia: id });
  return id;
}

export async function guardarPlaza(id, datosForm = {}) {
  const plazaId = normalizarPlazaKey(id);
  const error = validarPlazaDetalle(datosForm);
  if (error) throw new Error(error);
  const emp = _ensureEmpresa();
  const datos = normalizarPlazaDetalle(plazaId, datosForm);
  emp.plazasDetalle = Array.isArray(emp.plazasDetalle) ? emp.plazasDetalle : [];
  const idx = emp.plazasDetalle.findIndex(d => normalizarPlazaKey(d?.id) === plazaId);
  if (idx > -1) emp.plazasDetalle[idx] = datos;
  else emp.plazasDetalle.push(datos);
  _reassignCorreoCatalogForPlaza(plazaId, datos.correo, datos.correoGerente);
  await _persist('PLAZA_GUARDADA', `Actualizó la plaza ${plazaId}`, `Plaza ${plazaId} guardada.`, {
    entidad: 'PLAZAS', referencia: plazaId, correo: datos.correo || '', correoGerente: datos.correoGerente || ''
  });
  return datos;
}

export async function eliminarPlaza(id) {
  const plazaId = normalizarPlazaKey(id);
  const emp = _ensureEmpresa();
  emp.plazas = (emp.plazas || []).filter(p => normalizarPlazaKey(p) !== plazaId);
  emp.plazasDetalle = (emp.plazasDetalle || []).filter(d => normalizarPlazaKey(d?.id) !== plazaId);
  _releaseCorreoCatalogForPlaza(plazaId);
  await _persist('PLAZA_ELIMINADA', `Eliminó la plaza ${plazaId}`, `Plaza "${plazaId}" eliminada.`, { entidad: 'PLAZAS', referencia: plazaId });
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --input-type=module --check < js/app/features/admin/admin-plazas-data.js`
Expected: no output (OK).

- [ ] **Step 3: Commit**

```bash
git add js/app/features/admin/admin-plazas-data.js
git commit -m "feat(plazas): capa de datos Firestore para plazas (paridad con legacy)"
```

---

### Task 3: CSS additions to `css/app-admin.css`

**Files:**
- Modify: `css/app-admin.css` (append near the end, after the existing `.adm-empresa-*` block around line 1498 — do not touch anything above it)

**Interfaces:**
- Consumes: existing CSS custom properties already used throughout this file (`var(--border, #e2e8f0)`, `var(--surface)`, `var(--text)`).
- Produces (used by Task 4): `.adm-plaza-toggle` (+ `.is-on` modifier), `.adm-plaza-contacts`, `.adm-plaza-contact-row`, `.adm-plaza-contact-row input`, `.adm-plaza-maps-preview`, `.adm-plaza-maps-preview iframe`, `.adm-plaza-danger` (reuses `.adm-btn.danger` for the button itself, this class is just the wrapping section).

- [ ] **Step 1: Append this block right after the `body.dark-theme .adm-empresa-tag` rule (around line 1498) and before `.adm-ribbon-field.is-open`**

```css
/* ── Plazas ── */
.adm-plaza-toggle {
  position: relative;
  width: 38px;
  height: 21px;
  border-radius: 9999px;
  background: #cbd5e1;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s;
  padding: 0;
}

.adm-plaza-toggle.is-on {
  background: #f59e0b;
}

.adm-plaza-toggle::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 15px;
  height: 15px;
  border-radius: 9999px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: left 0.15s;
}

.adm-plaza-toggle.is-on::after {
  left: 20px;
}

.adm-plaza-contacts {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.adm-plaza-contact-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 8px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
}

.adm-plaza-contact-row input {
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
}

.adm-plaza-maps-preview {
  margin-top: 8px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--border, #e2e8f0);
  height: 200px;
}

.adm-plaza-maps-preview iframe {
  width: 100%;
  height: 100%;
  border: 0;
}

body.dark-theme .adm-plaza-contact-row {
  background: var(--surface);
  border-color: var(--border);
}
```

- [ ] **Step 2: Verify no CSS syntax errors**

Run (from repo root): `node -e "require('fs').readFileSync('css/app-admin.css','utf8')" && echo READ_OK`
This just confirms the file still reads cleanly as UTF-8 text (this repo has no CSS linter/build step per `CLAUDE.md`). Visually double check braces balance by eye in the diff.

- [ ] **Step 3: Commit**

```bash
git add css/app-admin.css
git commit -m "feat(plazas): estilos para el panel nativo de Plazas"
```

---

### Task 4: `js/app/features/admin/admin-plazas-panel.js` — panel UI

**Files:**
- Create: `js/app/features/admin/admin-plazas-panel.js`

**Interfaces:**
- Consumes: everything from Task 2 (`canEditPlazas`, `getPlazasSnapshot`, `getPlazaDetalle`, `getCorreoOptions`, `crearPlaza`, `guardarPlaza`, `eliminarPlaza`) and Task 1's `validarPlazaKey`/`normalizarPlazaKey` (for inline "nueva plaza" key-format feedback, imported from `/domain/plaza.model.js`); `getState` from `/js/app/app-state.js`; `adminSectionPath` from `/js/app/features/admin/admin-nav.js` (for soft-navigating between plazas, same as `admin-usuarios-panel.js` does with `adminSectionPath('usuarios', id)`).
- Produces (used by Task 5): `mountPlazasPanel(host, { navigate, entityId })`, `unmountPlazasPanel()`, `syncPlazasSelection(entityId)` — same three-function contract as `mountUsuariosPanel`/`unmountUsuariosPanel`/`syncUsuariosSelection`.

- [ ] **Step 1: Write the file**

```js
/**
 * Panel SPA — Plazas (catálogo de sucursales/branches).
 */
import { getState } from '/js/app/app-state.js';
import { adminSectionPath } from '/js/app/features/admin/admin-nav.js';
import { validarPlazaKey, normalizarPlazaKey } from '/domain/plaza.model.js';
import {
  canEditPlazas,
  getPlazasSnapshot,
  getPlazaDetalle,
  getCorreoOptions,
  crearPlaza,
  guardarPlaza,
  eliminarPlaza
} from '/js/app/features/admin/admin-plazas-data.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(msg, type = 'info') {
  if (typeof window.showToast === 'function') window.showToast(msg, type);
  else console.log(msg);
}

function _confirm(title, text, tipo = 'danger') {
  if (typeof window.mexConfirm === 'function') return window.mexConfirm(title, text, tipo);
  return Promise.resolve(window.confirm(`${title}\n\n${text}`));
}

let _host = null;
let _navigate = null;
let _selectedId = '';
let _query = '';
let _editing = false;
let _creating = false;

function _actor() {
  const st = getState() || {};
  const profile = st.profile || window.__mexCurrentUserRecord || {};
  const role = String(st.role || profile.rol || profile.role || '').toUpperCase();
  return { profile, role };
}

function _canEdit() {
  const { profile, role } = _actor();
  return canEditPlazas(profile, role);
}

function _filtered() {
  const q = _query.trim().toLowerCase();
  const list = getPlazasSnapshot();
  if (!q) return list;
  return list.filter(p =>
    p.id.toLowerCase().includes(q)
    || String(p.nombre || '').toLowerCase().includes(q)
    || String(p.localidad || '').toLowerCase().includes(q)
  );
}

function _selected() {
  if (!_selectedId) return null;
  return getPlazaDetalle(_selectedId);
}

function _correoSelectHtml(id, name, options) {
  const opts = options.map(o => `<option value="${esc(o.value)}"${o.selected ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  return `<select id="${esc(id)}" name="${esc(name)}"><option value="">— Sin asignar —</option>${opts}</select>`;
}

function _contactsHtml(contactos, editing) {
  if (!contactos.length && !editing) {
    return '<div class="adm-field-value is-muted">Sin contactos registrados</div>';
  }
  const rows = contactos.map((c, i) => `
    <div class="adm-plaza-contact-row" data-contact-idx="${i}">
      <input type="text" data-field="nombre" value="${esc(c.nombre)}" placeholder="Nombre" ${editing ? '' : 'disabled'}>
      <input type="text" data-field="rol" value="${esc(c.rol)}" placeholder="Puesto/Rol" ${editing ? '' : 'disabled'}>
      <input type="tel" data-field="telefono" value="${esc(c.telefono)}" placeholder="Teléfono" ${editing ? '' : 'disabled'}>
      ${editing ? `<button type="button" class="adm-btn ghost" data-action="remove-contact" data-idx="${i}"><span class="material-symbols-outlined">delete_outline</span></button>` : '<span></span>'}
    </div>`).join('');
  return `<div class="adm-plaza-contacts" id="adm-plaza-contacts-list">${rows}</div>`;
}

function _detailHtml(plaza, canEdit) {
  const editing = canEdit && _editing;
  const mapsEmbedUrl = plaza.mapsUrl ? `https://maps.google.com/maps?q=${encodeURIComponent(plaza.mapsUrl)}&output=embed` : '';
  const correoOptions = getCorreoOptions(plaza.correo || '', plaza.id, 'correo', plaza);
  const correoGerenteOptions = getCorreoOptions(plaza.correoGerente || '', plaza.id, 'correoGerente', plaza);

  return `
    <div class="adm-detail">
      <div class="adm-detail-hero">
        <span class="adm-avatar adm-avatar--lg" style="background:${plaza.temporal ? '#f59e0b' : '#3b82f6'};color:#fff;">${esc(plaza.id.slice(0, 3))}</span>
        <div>
          <h3>${esc(plaza.nombre || plaza.id)}</h3>
          <p>${esc(plaza.descripcion || plaza.localidad || 'Sin descripción')}</p>
          <div class="adm-pills">
            <span class="adm-pill">${esc(plaza.id)}</span>
            ${plaza.temporal ? '<span class="adm-pill">Temporal</span>' : ''}
          </div>
        </div>
      </div>
      <form class="adm-form${editing ? '' : ' is-readonly'}" id="adm-plaza-form" onsubmit="return false;">
        <label class="adm-form-full" style="display:flex;align-items:center;gap:10px;">
          <button type="button" class="adm-plaza-toggle${plaza.temporal ? ' is-on' : ''}" data-action="toggle-temporal" ${editing ? '' : 'disabled'}></button>
          <span>Plaza temporal (resguardo externo / bodega)</span>
        </label>
        <label>
          <span>Nombre oficial</span>
          ${editing ? `<input name="nombre" type="text" value="${esc(plaza.nombre)}">` : `<div class="adm-field-value">${esc(plaza.nombre || '—')}</div>`}
        </label>
        <label>
          <span>Descripción</span>
          ${editing ? `<input name="descripcion" type="text" value="${esc(plaza.descripcion)}">` : `<div class="adm-field-value">${esc(plaza.descripcion || '—')}</div>`}
        </label>
        <label>
          <span>Localidad</span>
          ${editing ? `<input name="localidad" type="text" value="${esc(plaza.localidad)}">` : `<div class="adm-field-value">${esc(plaza.localidad || '—')}</div>`}
        </label>
        <label>
          <span>Dirección completa</span>
          ${editing ? `<input name="direccion" type="text" value="${esc(plaza.direccion)}">` : `<div class="adm-field-value">${esc(plaza.direccion || '—')}</div>`}
        </label>
        <label class="adm-form-full">
          <span>Dirección o coordenadas para Google Maps</span>
          ${editing ? `<input name="mapsUrl" type="text" id="adm-plaza-maps-url" value="${esc(plaza.mapsUrl)}" placeholder="Ej: 29.0924,-110.9600 o nombre del lugar">` : `<div class="adm-field-value">${esc(plaza.mapsUrl || '—')}</div>`}
        </label>
        ${mapsEmbedUrl ? `<div class="adm-plaza-maps-preview adm-form-full"><iframe src="${esc(mapsEmbedUrl)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>` : ''}
        <label>
          <span>Correo institucional</span>
          ${editing ? _correoSelectHtml('adm-plaza-correo', 'correo', correoOptions) : `<div class="adm-field-value">${esc(plaza.correo || '—')}</div>`}
        </label>
        <label>
          <span>Teléfono directo</span>
          ${editing ? `<input name="telefono" type="tel" value="${esc(plaza.telefono)}">` : `<div class="adm-field-value">${esc(plaza.telefono || '—')}</div>`}
        </label>
        <label>
          <span>Gerente de plaza</span>
          ${editing ? `<input name="gerente" type="text" value="${esc(plaza.gerente)}">` : `<div class="adm-field-value">${esc(plaza.gerente || '—')}</div>`}
        </label>
        <label>
          <span>Correo del gerente</span>
          ${editing ? _correoSelectHtml('adm-plaza-correo-gerente', 'correoGerente', correoGerenteOptions) : `<div class="adm-field-value">${esc(plaza.correoGerente || '—')}</div>`}
        </label>
        <div class="adm-form-full">
          <span class="adm-label-block">Contactos</span>
          ${_contactsHtml(plaza.contactos || [], editing)}
          ${editing ? '<button type="button" class="adm-btn ghost" data-action="add-contact" style="margin-top:8px;"><span class="material-symbols-outlined">person_add</span> Agregar contacto</button>' : ''}
        </div>
        <div class="adm-form-actions">
          ${canEdit && !editing ? '<button type="button" class="adm-btn primary" data-action="edit-plaza">Editar</button>' : ''}
          ${canEdit && editing ? `
            <button type="button" class="adm-btn ghost" data-action="cancel-edit-plaza">Cancelar</button>
            <button type="button" class="adm-btn primary" data-action="save-plaza">Guardar</button>
          ` : ''}
        </div>
      </form>
      ${canEdit && !editing ? `
        <section class="adm-subsection">
          <div class="adm-subsection-head"><h4>Zona de peligro</h4></div>
          <button type="button" class="adm-btn danger" data-action="delete-plaza">Eliminar plaza</button>
        </section>` : ''}
    </div>`;
}

function _creatingHtml() {
  return `
    <div class="adm-detail">
      <div class="adm-detail-hero">
        <span class="adm-avatar adm-avatar--lg" style="background:#3b82f6;color:#fff;">
          <span class="material-symbols-outlined">add_location_alt</span>
        </span>
        <div><h3>Nueva plaza</h3><p>Elige una clave corta (ej. GDL, BJX)</p></div>
      </div>
      <form class="adm-form" id="adm-plaza-new-form" onsubmit="return false;">
        <label>
          <span>Clave</span>
          <input name="key" type="text" id="adm-plaza-new-key" placeholder="Ej: GDL" maxlength="12" style="text-transform:uppercase;">
        </label>
        <label>
          <span>Nombre oficial</span>
          <input name="nombre" type="text" placeholder="Ej: Guadalajara Centro">
        </label>
        <label class="adm-form-full">
          <span>Descripción</span>
          <input name="descripcion" type="text" placeholder="Ej: Sucursal principal">
        </label>
        <div class="adm-form-actions">
          <button type="button" class="adm-btn ghost" data-action="cancel-new-plaza">Cancelar</button>
          <button type="button" class="adm-btn primary" data-action="confirm-new-plaza">Crear plaza</button>
        </div>
      </form>
    </div>`;
}

function _paint() {
  if (!_host) return;
  const list = _filtered();
  const plaza = _creating ? null : _selected();
  const canEdit = _canEdit();

  _host.innerHTML = `
    <div class="adm-listas">
      <div class="adm-listas-dir">
        <div class="adm-listas-head">
          <div><span class="adm-kicker">Estructura</span><h2>Plazas</h2></div>
          <span class="adm-count">${list.length} plazas</span>
        </div>
        <div class="adm-listas-toolbar">
          <label class="adm-search">
            <span class="material-symbols-outlined">search</span>
            <input type="search" id="adm-plaza-search" placeholder="Buscar clave, nombre o localidad…" value="${esc(_query)}">
          </label>
          ${canEdit ? '<button type="button" class="adm-btn primary" data-action="new-plaza"><span class="material-symbols-outlined">add</span> Nueva</button>' : ''}
        </div>
        <div class="adm-cards" id="adm-plaza-cards">
          ${list.length ? list.map(p => {
            const active = (!_creating && _selectedId && normalizarPlazaKey(_selectedId) === p.id) ? ' is-active' : '';
            return `
              <button type="button" class="adm-card${active}" data-plaza-id="${esc(p.id)}">
                <span class="adm-avatar" style="background:${p.temporal ? '#f59e0b' : '#3b82f6'};color:#fff;">${esc(p.id.slice(0, 3))}</span>
                <span class="adm-card-copy">
                  <strong>${esc(p.nombre || p.id)}</strong>
                  <small>${esc(p.id)}</small>
                  <span>${esc(p.localidad || 'Sin localidad')}${p.temporal ? ' · Temporal' : ''}</span>
                </span>
              </button>`;
          }).join('') : `
            <div class="adm-empty">
              <span class="material-symbols-outlined">location_off</span>
              <strong>Sin plazas</strong>
              <small>Ajusta la búsqueda o crea una nueva.</small>
            </div>`}
        </div>
      </div>
      <div class="adm-listas-detail" id="adm-plaza-detail">
        ${_creating ? _creatingHtml() : (plaza ? _detailHtml(plaza, canEdit) : `
          <div class="adm-empty adm-empty--panel">
            <span class="material-symbols-outlined">location_city</span>
            <strong>Selecciona una plaza</strong>
            <small>El detalle y la edición aparecen aquí.</small>
          </div>`)}
      </div>
    </div>`;

  _bind();
}

function _bind() {
  _host.querySelector('#adm-plaza-search')?.addEventListener('input', (e) => {
    _query = e.target.value || '';
    _paint();
    const input = _host.querySelector('#adm-plaza-search');
    if (input) { input.focus(); const len = input.value.length; input.setSelectionRange(len, len); }
  });

  _host.querySelectorAll('[data-plaza-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      _creating = false;
      _editing = false;
      _selectedId = btn.getAttribute('data-plaza-id') || '';
      if (typeof _navigate === 'function') _navigate(adminSectionPath('plazas', _selectedId), { replace: true, soft: true });
      _paint();
    });
  });

  _host.querySelector('[data-action="new-plaza"]')?.addEventListener('click', () => {
    if (!_canEdit()) return;
    _creating = true;
    _editing = false;
    _paint();
    _host.querySelector('#adm-plaza-new-key')?.focus();
  });
  _host.querySelector('#adm-plaza-new-key')?.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });
  _host.querySelector('[data-action="cancel-new-plaza"]')?.addEventListener('click', () => {
    _creating = false;
    _paint();
  });
  _host.querySelector('[data-action="confirm-new-plaza"]')?.addEventListener('click', () => _confirmNewPlaza());

  _host.querySelector('[data-action="edit-plaza"]')?.addEventListener('click', () => {
    if (!_canEdit()) return;
    _editing = true;
    _paint();
  });
  _host.querySelector('[data-action="cancel-edit-plaza"]')?.addEventListener('click', () => {
    _editing = false;
    _paint();
  });
  _host.querySelector('[data-action="save-plaza"]')?.addEventListener('click', () => _savePlaza());
  _host.querySelector('[data-action="delete-plaza"]')?.addEventListener('click', () => _deletePlaza());

  _host.querySelector('[data-action="toggle-temporal"]')?.addEventListener('click', (e) => {
    e.currentTarget.classList.toggle('is-on');
  });

  _host.querySelector('[data-action="add-contact"]')?.addEventListener('click', () => {
    const list = _host.querySelector('#adm-plaza-contacts-list');
    if (!list) return;
    const idx = list.querySelectorAll('.adm-plaza-contact-row').length;
    const row = document.createElement('div');
    row.className = 'adm-plaza-contact-row';
    row.dataset.contactIdx = String(idx);
    row.innerHTML = `
      <input type="text" data-field="nombre" placeholder="Nombre">
      <input type="text" data-field="rol" placeholder="Puesto/Rol">
      <input type="tel" data-field="telefono" placeholder="Teléfono">
      <button type="button" class="adm-btn ghost" data-action="remove-contact"><span class="material-symbols-outlined">delete_outline</span></button>`;
    list.appendChild(row);
    row.querySelector('[data-action="remove-contact"]').addEventListener('click', () => row.remove());
    row.querySelector('input')?.focus();
  });
  _host.querySelectorAll('[data-action="remove-contact"]').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.adm-plaza-contact-row')?.remove());
  });
}

async function _confirmNewPlaza() {
  const form = _host.querySelector('#adm-plaza-new-form');
  if (!form) return;
  const fd = new FormData(form);
  const key = String(fd.get('key') || '');
  const error = validarPlazaKey(key, getPlazasSnapshot().map(p => p.id));
  if (error) { toast(error, 'error'); return; }
  try {
    const id = await crearPlaza({ key, nombre: fd.get('nombre'), descripcion: fd.get('descripcion') });
    _creating = false;
    _selectedId = id;
    _editing = true;
    toast(`Plaza ${id} creada.`, 'success');
    if (typeof _navigate === 'function') _navigate(adminSectionPath('plazas', id), { replace: true, soft: true });
    _paint();
  } catch (err) {
    console.error('[admin-plazas] crear:', err);
    toast(err?.message || 'No se pudo crear la plaza.', 'error');
  }
}

function _readContactsFromDom() {
  return Array.from(_host.querySelectorAll('.adm-plaza-contact-row')).map(row => ({
    nombre: row.querySelector('[data-field="nombre"]')?.value || '',
    rol: row.querySelector('[data-field="rol"]')?.value || '',
    telefono: row.querySelector('[data-field="telefono"]')?.value || ''
  }));
}

async function _savePlaza() {
  const plaza = _selected();
  if (!plaza || !_canEdit()) return;
  const form = _host.querySelector('#adm-plaza-form');
  if (!form) return;
  const fd = new FormData(form);
  const datos = {
    nombre: String(fd.get('nombre') || ''),
    descripcion: String(fd.get('descripcion') || ''),
    localidad: String(fd.get('localidad') || ''),
    direccion: String(fd.get('direccion') || ''),
    mapsUrl: String(fd.get('mapsUrl') || ''),
    temporal: _host.querySelector('[data-action="toggle-temporal"]')?.classList.contains('is-on') || false,
    correo: String(fd.get('correo') || ''),
    telefono: String(fd.get('telefono') || ''),
    gerente: String(fd.get('gerente') || ''),
    correoGerente: String(fd.get('correoGerente') || ''),
    contactos: _readContactsFromDom()
  };
  try {
    await guardarPlaza(plaza.id, datos);
    _editing = false;
    toast('Plaza actualizada.', 'success');
    _paint();
  } catch (err) {
    console.error('[admin-plazas] guardar:', err);
    toast(err?.message || 'No se pudo guardar.', 'error');
  }
}

async function _deletePlaza() {
  const plaza = _selected();
  if (!plaza || !_canEdit()) return;
  const ok = await _confirm(`Eliminar plaza "${plaza.id}"`, 'Se eliminará del catálogo junto con sus datos configurados.', 'danger');
  if (!ok) return;
  try {
    await eliminarPlaza(plaza.id);
    _selectedId = '';
    toast(`Plaza "${plaza.id}" eliminada.`, 'success');
    if (typeof _navigate === 'function') _navigate(adminSectionPath('plazas'), { replace: true, soft: true });
    _paint();
  } catch (err) {
    console.error('[admin-plazas] eliminar:', err);
    toast(err?.message || 'No se pudo eliminar.', 'error');
  }
}

export function mountPlazasPanel(host, opts = {}) {
  unmountPlazasPanel();
  _host = host;
  _navigate = opts.navigate || null;
  _selectedId = String(opts.entityId || '').trim();
  _query = '';
  _editing = false;
  _creating = false;
  _paint();
}

export function syncPlazasSelection(entityId = '') {
  const next = String(entityId || '').trim();
  if (next !== _selectedId) { _editing = false; _creating = false; }
  _selectedId = next;
  _paint();
}

export function unmountPlazasPanel() {
  _host = null;
  _navigate = null;
  _selectedId = '';
  _query = '';
  _editing = false;
  _creating = false;
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --input-type=module --check < js/app/features/admin/admin-plazas-panel.js`
Expected: no output (OK).

- [ ] **Step 3: Commit**

```bash
git add js/app/features/admin/admin-plazas-panel.js
git commit -m "feat(plazas): panel nativo (lista + detalle + alta + baja)"
```

---

### Task 5: Wire into `admin-nav.js` + `admin-shell.js`

**Files:**
- Modify: `js/app/features/admin/admin-nav.js:42-53` (add `'plazas'` to `ADMIN_NATIVE_SECTIONS`)
- Modify: `js/app/views/admin-shell.js` (import + register the new panel; update the top comment)

**Interfaces:**
- Consumes: `mountPlazasPanel`, `unmountPlazasPanel`, `syncPlazasSelection` from Task 4.

- [ ] **Step 1: `admin-nav.js` — add `'plazas'` to the native set**

In `js/app/features/admin/admin-nav.js`, change:

```js
export const ADMIN_NATIVE_SECTIONS = new Set([
  'usuarios',
  'roles',
  'invitaciones',
  'estados',
  'categorias',
  'modelos',
  'gasolinas',
  'motivos_traslado',
  'ubicaciones',
  'empresa'
]);
```

to:

```js
export const ADMIN_NATIVE_SECTIONS = new Set([
  'usuarios',
  'roles',
  'invitaciones',
  'estados',
  'categorias',
  'modelos',
  'gasolinas',
  'motivos_traslado',
  'ubicaciones',
  'empresa',
  'plazas'
]);
```

- [ ] **Step 2: `admin-shell.js` — import the new panel and register it**

Change the top comment (currently line 3: `* LISTAS + OPCIONES operación nativas. Plazas/Ubicaciones/Empresa: iframe.`) to:

```js
 * LISTAS + OPCIONES operación nativas. Ubicaciones: iframe.
```

Add this import block after the existing `admin-empresa-panel.js` import (after line 34):

```js
import {
  mountPlazasPanel,
  unmountPlazasPanel,
  syncPlazasSelection
} from '/js/app/features/admin/admin-plazas-panel.js';
```

In `_unmountNative()`, add `unmountPlazasPanel();` alongside the other `unmount*Panel()` calls:

```js
function _unmountNative() {
  unmountUsuariosPanel();
  unmountRolesPanel();
  unmountInvitacionesPanel();
  unmountOpcionesPanel();
  unmountEmpresaPanel();
  unmountPlazasPanel();
  _nativeSection = '';
}
```

In `_showNative()`, add `plazas` to `mountMap`:

```js
  const mountMap = {
    usuarios: { mount: mountUsuariosPanel, sync: syncUsuariosSelection },
    roles: { mount: mountRolesPanel, sync: syncRolesSelection },
    invitaciones: { mount: mountInvitacionesPanel, sync: syncInvitacionesSelection },
    empresa: { mount: mountEmpresaPanel, sync: syncEmpresaSelection },
    plazas: { mount: mountPlazasPanel, sync: syncPlazasSelection }
  };
```

- [ ] **Step 3: Verify syntax**

Run:
```bash
node --input-type=module --check < js/app/features/admin/admin-nav.js
node --input-type=module --check < js/app/views/admin-shell.js
```
Expected: no output for either (OK).

- [ ] **Step 4: Manual smoke check (no Playwright available in this sandbox — do this by reading, not running a browser)**

Read the full updated `js/app/views/admin-shell.js` and confirm:
- `plazas` now appears in `ADMIN_NATIVE_SECTIONS` (imported from `admin-nav.js`).
- `mountPlazasPanel`/`unmountPlazasPanel`/`syncPlazasSelection` are imported and referenced in exactly the same shape as the other four panels (`usuarios`, `roles`, `invitaciones`, `empresa`).
- No other line in `_showNative`/`_unmountNative`/`_applySection` was altered.

- [ ] **Step 5: Bump SW, commit, push (task closeout per CLAUDE.md)**

```bash
node scripts/bump-sw.js
git add js/app/features/admin/admin-nav.js js/app/views/admin-shell.js sw.js
git commit -m "feat(plazas): activa el panel nativo en el Centro Admin"
git push
```
