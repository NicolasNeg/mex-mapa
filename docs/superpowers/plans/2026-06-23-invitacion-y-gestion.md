# Plan 2 — Códigos de Invitación + Dashboard de Gestión

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el registro por empresa por un registro con **código de invitación** (pre-asigna plaza+rol, un solo uso, con expiración, **registro automático sin aprobación**), generado desde un nuevo dashboard SPA `/app/gestion` (plazas, usuarios, códigos).

**Architecture:** La lógica del código vive en una colección Firestore `invitaciones/{codigo}` y una función pura `domain/invitacion.model.js` (validable sin Firebase). La generación y el consumo pasan por Cloud Functions callables (`generarInvitacion`, `registrarConInvitacion`) para que el `crear usuario` ocurra server-side con privilegios. El registro reemplaza `solicitud.html`/modal de login por un flujo de un solo paso "código → datos → cuenta". El dashboard es una vista SPA siguiendo el patrón `js/app/views/*.js` (mount/unmount), reutilizando los data modules de `js/app/features/admin/`.

**Tech Stack:** Vanilla JS (ES modules + Firebase compat SDK), Firebase Functions v1 (Node 18), Firestore. Sin build. Lógica pura → `node:test`. UI → smoke test + verificación manual.

**Dependencia:** Requiere el **Plan 1 completado** (single-tenant; sin `empresaId`). Las invitaciones y usuarios ya no llevan `empresaId`; la separación es por `plazaId`.

## Global Constraints

- **Sin build step ni linter.** Lógica pura con `node:test`. No añadir frameworks.
- **Diseño:** leer `ESTILO.md`. **Reutilizar el sistema existente** (no crear uno nuevo). Fuente Inter; acento `#3b82f6`; iconos `material-symbols-outlined`; dark mode vía `body.dark-theme` + `var(--bg)/--surface/--text/--border`; spacing 4px; radios `4/8/12/16/9999`. CSS de la vista en `css/app-gestion.css`, inyectado en `mount()` como las demás vistas.
- **Modales:** usar `mexConfirm()`/`mexAlert()` de `js/core/dialogs.js`, nunca `confirm()`/`alert()` nativos.
- **Acción destructiva** (revocar código): confirmar con `mexConfirm()`; color semántico de peligro.
- **Tabla:** números tabulares para fechas/contadores; empty state cuando no hay datos; encabezado ordenable con `aria-sort`.
- **Permisos:** solo roles admin (`GERENTE_PLAZA`+ según `mexPerms.canDo('gestion_usuarios')`) ven `/app/gestion` y generan códigos.
- **Bump SW** en cada deploy; **git push** tras cada deploy.
- **Commits frecuentes**, uno por task.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `domain/invitacion.model.js` | **NUEVO** — lógica pura: generar código, validar estado (vigente/expirado/usado), shape del doc. Sin Firebase. |
| `functions/index.js` | **MODIFICAR** — añadir `generarInvitacion`, `registrarConInvitacion`, `revocarInvitacion`, `listarInvitaciones`. Borrar `procesarSolicitudAcceso`/`enviarCorreoSolicitud` si ya no se usan. |
| `firestore.rules` | **MODIFICAR** — reglas para `invitaciones/{codigo}` (lectura pública mínima para validar; escritura solo callable/admin). Retirar reglas de `solicitudes`. |
| `js/app/features/gestion/invitaciones-data.js` | **NUEVO** — `onSnapshot` de `invitaciones`, wrappers de callables. |
| `js/app/views/gestion.js` | **NUEVO** — vista SPA: tabs Plazas / Usuarios / Invitaciones. |
| `css/app-gestion.css` | **NUEVO** — estilos de la vista. |
| `js/app/router.js` | **MODIFICAR** — `/app/gestion` deja de redirigir; carga `views/gestion.js`. |
| `js/shell/navigation.config.js` | **MODIFICAR** — item de sidebar "Gestión". |
| `login.html` + `js/views/auth-ui.js` | **MODIFICAR** — reemplazar modal de solicitud por flujo de código de invitación. |
| `solicitud.html` | **BORRAR** — sustituido por el flujo de invitación. |

---

### Task 1: Modelo puro de invitación (`domain/invitacion.model.js`)

**Files:**
- Create: `domain/invitacion.model.js`
- Test: `domain/invitacion.model.test.mjs`

**Interfaces:**
- Produces:
  - `generarCodigo() → string` (8 chars A-Z2-9, sin ambiguos O/0/I/1)
  - `nuevaInvitacion({ plaza, rol, expiraEnDias, creadoPor }) → InvitacionDoc`
  - `estadoInvitacion(doc, ahoraMs) → 'VIGENTE' | 'EXPIRADA' | 'USADA' | 'REVOCADA'`
  - `puedeUsarse(doc, ahoraMs) → boolean`
  - `InvitacionDoc = { codigo, plaza, rol, creadoPor, creadoEnMs, expiraEnMs, usadaPor: null, usadaEnMs: null, revocada: false }`

- [ ] **Step 1: Escribir el test que falla**

```js
// domain/invitacion.model.test.mjs
import assert from 'node:assert';
import { test } from 'node:test';
import { generarCodigo, nuevaInvitacion, estadoInvitacion, puedeUsarse } from './invitacion.model.js';

test('generarCodigo: 8 chars, sin caracteres ambiguos', () => {
  const c = generarCodigo();
  assert.match(c, /^[A-HJ-NP-Z2-9]{8}$/);
});

test('nuevaInvitacion: shape correcto y expiración futura', () => {
  const inv = nuevaInvitacion({ plaza: 'CDMX', rol: 'AUXILIAR', expiraEnDias: 7, creadoPor: 'jefe@x.com' });
  assert.equal(inv.plaza, 'CDMX');
  assert.equal(inv.rol, 'AUXILIAR');
  assert.equal(inv.usadaPor, null);
  assert.equal(inv.revocada, false);
  assert.ok(inv.expiraEnMs > inv.creadoEnMs);
});

test('estadoInvitacion: vigente / expirada / usada / revocada', () => {
  const base = nuevaInvitacion({ plaza: 'CDMX', rol: 'AUXILIAR', expiraEnDias: 7, creadoPor: 'x' });
  const ahora = base.creadoEnMs + 1000;
  assert.equal(estadoInvitacion(base, ahora), 'VIGENTE');
  assert.equal(estadoInvitacion(base, base.expiraEnMs + 1), 'EXPIRADA');
  assert.equal(estadoInvitacion({ ...base, usadaPor: 'a@b.com', usadaEnMs: ahora }, ahora), 'USADA');
  assert.equal(estadoInvitacion({ ...base, revocada: true }, ahora), 'REVOCADA');
});

test('puedeUsarse: solo si vigente', () => {
  const base = nuevaInvitacion({ plaza: 'CDMX', rol: 'AUXILIAR', expiraEnDias: 7, creadoPor: 'x' });
  assert.equal(puedeUsarse(base, base.creadoEnMs + 1000), true);
  assert.equal(puedeUsarse({ ...base, revocada: true }, base.creadoEnMs + 1000), false);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test domain/invitacion.model.test.mjs`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar el modelo**

```js
// domain/invitacion.model.js — lógica pura de códigos de invitación (sin Firebase).
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin O,0,I,1
const DIA_MS = 24 * 60 * 60 * 1000;

export function generarCodigo() {
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  }
  return out;
}

export function nuevaInvitacion({ plaza, rol, expiraEnDias = 7, creadoPor }) {
  const ahora = Date.now();
  return {
    codigo: generarCodigo(),
    plaza: String(plaza || '').toUpperCase().trim(),
    rol: String(rol || 'AUXILIAR').toUpperCase().trim(),
    creadoPor: String(creadoPor || '').toLowerCase().trim(),
    creadoEnMs: ahora,
    expiraEnMs: ahora + Math.max(1, expiraEnDias) * DIA_MS,
    usadaPor: null,
    usadaEnMs: null,
    revocada: false,
  };
}

export function estadoInvitacion(doc, ahoraMs = Date.now()) {
  if (!doc) return 'REVOCADA';
  if (doc.revocada) return 'REVOCADA';
  if (doc.usadaPor) return 'USADA';
  if (ahoraMs > doc.expiraEnMs) return 'EXPIRADA';
  return 'VIGENTE';
}

export function puedeUsarse(doc, ahoraMs = Date.now()) {
  return estadoInvitacion(doc, ahoraMs) === 'VIGENTE';
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test domain/invitacion.model.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add domain/invitacion.model.js domain/invitacion.model.test.mjs
git commit -m "feat: modelo puro de códigos de invitación (domain/invitacion.model)"
```

---

### Task 2: Cloud Functions de invitación

**Files:**
- Modify: `functions/index.js`

**Interfaces:**
- Consumes: lógica equivalente al modelo puro (Functions no importa ES module del front; replicar `generarCodigo`/expiración inline o como helper Node).
- Produces callables:
  - `generarInvitacion({ plaza, rol, expiraEnDias }) → { codigo, expiraEnMs }` — requiere rol admin con `canManageUsersBackend`.
  - `registrarConInvitacion({ codigo, nombre, email, password, telefono }) → { ok, uid }` — **pública** (sin auth); valida código, crea auth user + perfil `usuarios/`, marca código `usadaPor`/`usadaEnMs` en transacción.
  - `revocarInvitacion({ codigo }) → { ok }` — admin.
  - `listarInvitaciones() → { items: [...] }` — admin (o usar onSnapshot directo en front, ver Task 4).

- [ ] **Step 1: Helper Node + `generarInvitacion`**

```js
// functions/index.js — sección invitaciones
const INVITACIONES_COL = "invitaciones";
const _ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const _DIA_MS = 24 * 60 * 60 * 1000;
function _genCodigo() {
  let o = ""; for (let i = 0; i < 8; i++) o += _ALFABETO[Math.floor(Math.random() * _ALFABETO.length)];
  return o;
}

exports.generarInvitacion = functions.region(REGION).https.onCall(async (data, context) => {
  const profile = await findUserProfileFromAuth(context.auth);
  const actorRole = inferRole(profile.data, profile.data?.email);
  const security = await loadSecurityConfig();
  if (!canManageUsersBackend(actorRole, security, profile.data || {})) {
    throw new HttpsError("permission-denied", "No autorizado para generar invitaciones.");
  }
  const plaza = normalizeUpper(data?.plaza || "");
  const rol   = normalizeUpper(data?.rol || "AUXILIAR");
  const dias  = Math.max(1, Math.min(90, Number(data?.expiraEnDias) || 7));
  if (!plaza) throw new HttpsError("invalid-argument", "Plaza requerida.");
  if (!canActorManageTargetRole(actorRole, rol, security)) {
    throw new HttpsError("permission-denied", `No puedes invitar con el rol ${rol}.`);
  }
  const ahora = Date.now();
  // Reintentar si colisiona el codigo (extremadamente raro).
  let codigo, ref, exists = true, tries = 0;
  do { codigo = _genCodigo(); ref = db.collection(INVITACIONES_COL).doc(codigo);
       exists = (await ref.get()).exists; } while (exists && ++tries < 5);
  if (exists) throw new HttpsError("internal", "No se pudo generar un código único.");
  const expiraEnMs = ahora + dias * _DIA_MS;
  await ref.set({
    codigo, plaza, rol,
    creadoPor: normalizeLower(profile.data?.email || ""),
    creadoEnMs: ahora, expiraEnMs,
    usadaPor: null, usadaEnMs: null, revocada: false,
    _createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true, codigo, expiraEnMs };
});
```

- [ ] **Step 2: `registrarConInvitacion` (pública, transaccional, registro automático)**

```js
exports.registrarConInvitacion = functions.region(REGION).https.onCall(async (data) => {
  const codigo = normalizeUpper(data?.codigo || "");
  const nombre = normalizeUpper(data?.nombre || "");
  const email  = normalizeLower(data?.email || "");
  const telefono = normalizeString(data?.telefono || "");
  const password = normalizeString(data?.password || "");
  if (!codigo || !nombre || !email) throw new HttpsError("invalid-argument", "Datos incompletos.");
  if (password.length < 6) throw new HttpsError("invalid-argument", "La contraseña debe tener 6+ caracteres.");

  const ref = db.collection(INVITACIONES_COL).doc(codigo);
  const ahora = Date.now();

  // Validar + reservar el código en transacción (un solo uso).
  const inv = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Código de invitación inválido.");
    const d = snap.data();
    if (d.revocada) throw new HttpsError("failed-precondition", "El código fue revocado.");
    if (d.usadaPor) throw new HttpsError("failed-precondition", "El código ya fue usado.");
    if (ahora > d.expiraEnMs) throw new HttpsError("failed-precondition", "El código expiró.");
    tx.update(ref, { usadaPor: email, usadaEnMs: ahora });
    return d;
  });

  // Crear/actualizar auth user.
  let authUser = null;
  try { authUser = await admin.auth().getUserByEmail(email); }
  catch (e) { if (e?.code !== "auth/user-not-found") throw e; }
  if (!authUser) {
    authUser = await admin.auth().createUser({ email, password, displayName: nombre });
  }

  // Crear perfil — registro automático, sin aprobación.
  const userRef = await resolveUserProfileDocRefByEmail(email, authUser);
  await userRef.set({
    nombre, email, telefono,
    rol: inv.rol,
    plaza: inv.plaza, plazaAsignada: inv.plaza,
    plazasPermitidas: [inv.plaza],
    status: "ACTIVO", activo: true, autorizado: true, accesoSistema: true,
    invitacionCodigo: codigo,
    creadoAt: nowIso(), creadoPor: inv.creadoPor || "invitacion",
    updatedFrom: "registro_invitacion",
  }, { merge: true });

  return { ok: true, uid: authUser.uid };
});
```

- [ ] **Step 3: `revocarInvitacion` + borrar funciones de solicitud obsoletas**

```js
exports.revocarInvitacion = functions.region(REGION).https.onCall(async (data, context) => {
  const profile = await findUserProfileFromAuth(context.auth);
  const actorRole = inferRole(profile.data, profile.data?.email);
  const security = await loadSecurityConfig();
  if (!canManageUsersBackend(actorRole, security, profile.data || {})) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }
  const codigo = normalizeUpper(data?.codigo || "");
  if (!codigo) throw new HttpsError("invalid-argument", "Código requerido.");
  await db.collection(INVITACIONES_COL).doc(codigo).update({ revocada: true });
  return { ok: true };
});
```
Borrar `exports.procesarSolicitudAcceso` y `exports.enviarCorreoSolicitud` (ya no hay solicitudes/aprobación).

- [ ] **Step 4: Parse check**

Run: `node --check functions/index.js`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add functions/index.js
git commit -m "feat: callables de invitación (generar/registrar/revocar); borrar solicitudes"
```

---

### Task 3: Reglas Firestore para `invitaciones`

**Files:**
- Modify: `firestore.rules`

**Interfaces:**
- Produces: colección `invitaciones` segura. La validación del código y la marca de uso ocurren server-side (callables con Admin SDK que **bypassa reglas**), así que las reglas de cliente pueden ser estrictas.

- [ ] **Step 1: Añadir el match y retirar `solicitudes`**

```
// invitaciones/{codigo} — gestionadas exclusivamente por Cloud Functions (Admin SDK).
// El cliente nunca lee/escribe directo: registro y validación pasan por callables.
match /invitaciones/{codigo} {
  allow read: if tienePerfilActual() && esAdminOperativo();
  allow write: if false; // solo Admin SDK
}
```
Borrar el bloque `match /solicitudes/...` completo (ya no se usa).

- [ ] **Step 2: Verificación**

Run: `grep -n "solicitudes\|invitaciones" firestore.rules`
Expected: aparece `invitaciones`, no aparece `solicitudes`.

- [ ] **Step 3: Validar compilación de reglas**

Run: `firebase emulators:start --only firestore` (esperar "Rules updated", Ctrl-C).
Expected: sin errores de compilación.

- [ ] **Step 4: Commit**

```bash
git add firestore.rules
git commit -m "feat: reglas para invitaciones; retirar reglas de solicitudes"
```

---

### Task 4: Data module de gestión (`invitaciones-data.js`)

**Files:**
- Create: `js/app/features/gestion/invitaciones-data.js`

**Interfaces:**
- Consumes: `db, COL` de `/js/core/database.js`; callables vía `firebase.functions()`.
- Produces:
  - `subscribeInvitaciones(cb) → unsubscribe` (onSnapshot de `invitaciones`, orden `creadoEnMs desc`).
  - `crearInvitacion({ plaza, rol, expiraEnDias }) → Promise<{codigo, expiraEnMs}>`
  - `revocarInvitacion(codigo) → Promise<void>`

- [ ] **Step 1: Implementar el módulo**

```js
// js/app/features/gestion/invitaciones-data.js
import { db } from '/js/core/database.js';
const COL_INV = 'invitaciones';

export function subscribeInvitaciones(cb) {
  return db.collection(COL_INV).orderBy('creadoEnMs', 'desc')
    .onSnapshot(snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function crearInvitacion({ plaza, rol, expiraEnDias }) {
  const fn = firebase.functions().httpsCallable('generarInvitacion');
  const res = await fn({ plaza, rol, expiraEnDias });
  return res.data;
}

export async function revocarInvitacion(codigo) {
  const fn = firebase.functions().httpsCallable('revocarInvitacion');
  await fn({ codigo });
}
```

- [ ] **Step 2: Commit**

```bash
git add js/app/features/gestion/invitaciones-data.js
git commit -m "feat: data module de invitaciones (subscribe/crear/revocar)"
```

---

### Task 5: Vista SPA `/app/gestion` (tabs Plazas / Usuarios / Invitaciones)

**Files:**
- Create: `js/app/views/gestion.js`, `css/app-gestion.css`
- Modify: `js/app/router.js` (línea ~100: `/app/gestion` deja de redirigir), `js/shell/navigation.config.js`

**Interfaces:**
- Consumes: `subscribeInvitaciones`, `crearInvitacion`, `revocarInvitacion` (Task 4); `estadoInvitacion` de `domain/invitacion.model.js`; `mexConfirm/mexAlert` de `js/core/dialogs.js`; usuarios/plazas de `js/app/features/admin/*-data.js`.
- Produces: `mount({ container, navigate, shell, state })`, `unmount()`.

**UX (skill ui-ux-pro-max aplicada):** tabla con `aria-sort` en cabeceras; números tabulares (`font-variant-numeric: tabular-nums`) para fechas/contadores; empty state con icono + texto + CTA; chip de estado con color semántico + texto (no solo color → regla `color-not-only`); botón "Copiar código" con feedback ≤100ms; revocar usa `mexConfirm` (regla `confirmation-dialogs`); inputs con label visible + validación inline (regla `input-labels`).

- [ ] **Step 1: Implementar la vista**

```js
// js/app/views/gestion.js
import { subscribeInvitaciones, crearInvitacion, revocarInvitacion } from '/js/app/features/gestion/invitaciones-data.js';
import { estadoInvitacion } from '/domain/invitacion.model.js';
import { mexConfirm, mexAlert } from '/js/core/dialogs.js';

let _unsub = null;
const ESTADO_CHIP = {
  VIGENTE:  { cls: 'chip-ok',   icon: 'check_circle' },
  USADA:    { cls: 'chip-mut',  icon: 'how_to_reg' },
  EXPIRADA: { cls: 'chip-warn', icon: 'schedule' },
  REVOCADA: { cls: 'chip-bad',  icon: 'block' },
};

function fmtFecha(ms) {
  return new Date(ms).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function ensureCss() {
  if (document.getElementById('app-gestion-css')) return;
  const l = document.createElement('link');
  l.id = 'app-gestion-css'; l.rel = 'stylesheet'; l.href = '/css/app-gestion.css';
  document.head.appendChild(l);
}

function plazasDisponibles() {
  const cfg = window.MEX_CONFIG?.empresa || {};
  return Array.isArray(cfg.plazas) ? cfg.plazas : [];
}

const ROLES = ['AUXILIAR', 'VENTAS', 'SUPERVISOR', 'JEFE_PATIO', 'GERENTE_PLAZA'];

export function mount({ container }) {
  ensureCss();
  const plazas = plazasDisponibles();
  container.innerHTML = `
    <section class="gestion-view">
      <header class="gestion-head">
        <h1 class="gestion-title">Gestión</h1>
        <p class="gestion-sub">Códigos de invitación por plaza</p>
      </header>

      <form class="gestion-card gestion-form" id="inv-form">
        <div class="field">
          <label for="inv-plaza">Plaza</label>
          <select id="inv-plaza" required>
            ${plazas.map(p => `<option value="${p}">${p}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="inv-rol">Rol</label>
          <select id="inv-rol" required>
            ${ROLES.map(r => `<option value="${r}">${r}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="inv-dias">Expira en (días)</label>
          <input id="inv-dias" type="number" min="1" max="90" value="7" required inputmode="numeric">
        </div>
        <button type="submit" class="btn-primary" id="inv-gen">
          <span class="material-symbols-outlined">add</span> Generar código
        </button>
      </form>

      <div class="gestion-card">
        <table class="gestion-table" id="inv-table">
          <thead>
            <tr>
              <th aria-sort="descending">Código</th><th>Plaza</th><th>Rol</th>
              <th>Estado</th><th>Expira</th><th></th>
            </tr>
          </thead>
          <tbody id="inv-tbody">
            <tr><td colspan="6" class="t-empty">Cargando…</td></tr>
          </tbody>
        </table>
      </div>
    </section>`;

  const tbody = container.querySelector('#inv-tbody');
  const form  = container.querySelector('#inv-form');

  function render(items) {
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="t-empty">
        <span class="material-symbols-outlined">mail</span>
        Aún no hay invitaciones. Genera la primera arriba.</td></tr>`;
      return;
    }
    const ahora = Date.now();
    tbody.innerHTML = items.map(it => {
      const est = estadoInvitacion(it, ahora);
      const chip = ESTADO_CHIP[est];
      const puedeRevocar = est === 'VIGENTE';
      return `<tr>
        <td class="t-code">
          <button class="btn-copy" data-copy="${it.codigo}" title="Copiar">
            <span class="material-symbols-outlined">content_copy</span></button>
          <code>${it.codigo}</code>
        </td>
        <td>${it.plaza}</td>
        <td>${it.rol}</td>
        <td><span class="chip ${chip.cls}">
          <span class="material-symbols-outlined">${chip.icon}</span>${est}</span></td>
        <td class="t-num">${fmtFecha(it.expiraEnMs)}</td>
        <td>${puedeRevocar
          ? `<button class="btn-danger-ghost" data-revoke="${it.codigo}">Revocar</button>`
          : ''}</td>
      </tr>`;
    }).join('');
  }

  _unsub = subscribeInvitaciones(render);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('#inv-gen');
    btn.disabled = true;
    try {
      const { codigo } = await crearInvitacion({
        plaza: form.querySelector('#inv-plaza').value,
        rol:   form.querySelector('#inv-rol').value,
        expiraEnDias: Number(form.querySelector('#inv-dias').value),
      });
      await mexAlert(`Código generado: ${codigo}`, 'Invitación creada');
    } catch (err) {
      await mexAlert(err?.message || 'No se pudo generar el código.', 'Error');
    } finally { btn.disabled = false; }
  });

  tbody.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      await navigator.clipboard.writeText(copyBtn.dataset.copy).catch(() => {});
      copyBtn.classList.add('copied');
      setTimeout(() => copyBtn.classList.remove('copied'), 800);
      return;
    }
    const revBtn = e.target.closest('[data-revoke]');
    if (revBtn) {
      const ok = await mexConfirm('¿Revocar este código? No podrá usarse para registrarse.', 'Revocar invitación');
      if (!ok) return;
      revBtn.disabled = true;
      try { await revocarInvitacion(revBtn.dataset.revoke); }
      catch (err) { await mexAlert(err?.message || 'No se pudo revocar.', 'Error'); revBtn.disabled = false; }
    }
  });
}

export function unmount() {
  if (_unsub) { _unsub(); _unsub = null; }
}
```

- [ ] **Step 2: CSS de la vista (tokens existentes, dark mode)**

```css
/* css/app-gestion.css — reutiliza tokens de base.css (var(--bg/--surface/--text/--border)) */
.gestion-view { padding: 24px; max-width: 960px; margin: 0 auto; }
.gestion-title { font-size: 24px; font-weight: 700; color: var(--text); margin: 0; }
.gestion-sub { color: var(--text-muted, #64748b); margin: 4px 0 24px; font-size: 14px; }
.gestion-card { background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 16px; margin-bottom: 16px; }
.gestion-form { display: flex; gap: 16px; align-items: flex-end; flex-wrap: wrap; }
.gestion-form .field { display: flex; flex-direction: column; gap: 4px; }
.gestion-form label { font-size: 12px; font-weight: 500; color: var(--text-muted, #64748b); }
.gestion-form select, .gestion-form input { height: 40px; min-width: 140px; padding: 0 12px;
  border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font: inherit; }
.btn-primary { height: 40px; display: inline-flex; align-items: center; gap: 8px; padding: 0 16px;
  background: #3b82f6; color: #fff; border: 0; border-radius: 8px; font-weight: 600; cursor: pointer; }
.btn-primary:hover { background: #2563eb; }
.btn-primary:disabled { opacity: .5; cursor: default; }
.gestion-table { width: 100%; border-collapse: collapse; }
.gestion-table th, .gestion-table td { text-align: left; padding: 12px; border-bottom: 1px solid var(--border); }
.gestion-table th { font-size: 12px; color: var(--text-muted, #64748b); font-weight: 600; }
.t-num { font-variant-numeric: tabular-nums; }
.t-code { display: flex; align-items: center; gap: 8px; }
.t-code code { font-variant-numeric: tabular-nums; letter-spacing: 1px; }
.t-empty { text-align: center; color: var(--text-muted, #64748b); padding: 32px; }
.t-empty .material-symbols-outlined { display: block; font-size: 32px; margin-bottom: 8px; opacity: .6; }
.chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 9999px;
  font-size: 12px; font-weight: 600; }
.chip .material-symbols-outlined { font-size: 14px; }
.chip-ok  { background: #dcfce7; color: #166534; }
.chip-mut { background: #e2e8f0; color: #475569; }
.chip-warn{ background: #fef3c7; color: #92400e; }
.chip-bad { background: #fee2e2; color: #991b1b; }
.btn-copy { background: none; border: 0; cursor: pointer; color: var(--text-muted, #64748b); padding: 4px; border-radius: 4px; }
.btn-copy.copied { color: #16a34a; }
.btn-danger-ghost { background: none; border: 1px solid #fca5a5; color: #dc2626; border-radius: 8px;
  padding: 6px 12px; font-weight: 500; cursor: pointer; }
.btn-danger-ghost:hover { background: #fee2e2; }
body.dark-theme .chip-ok  { background: rgba(34,197,94,.15);  color: #4ade80; }
body.dark-theme .chip-mut { background: rgba(148,163,184,.15); color: #94a3b8; }
body.dark-theme .chip-warn{ background: rgba(245,158,11,.15); color: #fbbf24; }
body.dark-theme .chip-bad { background: rgba(239,68,68,.15);  color: #f87171; }
body.dark-theme .btn-danger-ghost:hover { background: rgba(239,68,68,.12); }
```

- [ ] **Step 3: Registrar la ruta y la nav**

En `js/app/router.js` reemplazar la línea `'/app/gestion': { redirect: '/app/admin' },` por:
```js
  '/app/gestion': { loader: () => import('/js/app/views/gestion.js'), navRoute: '/gestion', feature: 'gestion_usuarios' },
```
En `js/shell/navigation.config.js` añadir el item (icono `mail`, ruta `/app/gestion`, label "Gestión"), visible solo si `mexPerms.canDo('gestion_usuarios')`.

- [ ] **Step 4: Smoke manual contra emulador**

Run: `firebase emulators:start --only hosting,functions,firestore` y abrir `/app/gestion` como usuario admin.
Expected: tabla vacía con empty state; generar código muestra alert con el código y aparece fila VIGENTE; copiar funciona; revocar pide confirmación y cambia a REVOCADA.

- [ ] **Step 5: Commit**

```bash
git add js/app/views/gestion.js css/app-gestion.css js/app/router.js js/shell/navigation.config.js
git commit -m "feat: vista SPA /app/gestion con generación/listado/revocación de invitaciones"
```

---

### Task 6: Registro con código en login (reemplaza solicitud)

**Files:**
- Modify: `login.html` (modal), `js/views/auth-ui.js` (lógica)
- Delete: `solicitud.html`
- Modify: `firebase.json` (quitar rewrite de `/solicitud` si existe), `js/views/login.js`/cualquier link `href="/solicitud"`

**Interfaces:**
- Consumes: callable `registrarConInvitacion`.
- Produces: flujo de registro de un paso: código → datos (nombre, email, password, teléfono) → cuenta creada → login automático.

- [ ] **Step 1: Reemplazar el contenido del modal en `login.html`**

Sustituir el modal `#modal-solicitud` (3 pasos de empresa/plaza/rol) por un único formulario:
```html
<div id="modal-solicitud" class="solicitud-modal-overlay" style="display:none;">
  <div class="solicitud-modal-card">
    <div class="solicitud-modal-header">
      <h2 class="solicitud-modal-title">Crear cuenta</h2>
      <p class="solicitud-modal-sub">Ingresa el código de invitación que te dieron.</p>
    </div>
    <form class="solicitud-form-body" id="inv-reg-form">
      <input id="reg_codigo" class="sol-input" placeholder="Código de invitación" required
             autocomplete="off" style="text-transform:uppercase;letter-spacing:2px;">
      <input id="reg_nombre" class="sol-input" placeholder="Nombre completo" required>
      <input id="reg_email" type="email" class="sol-input" placeholder="Correo" required autocomplete="email">
      <input id="reg_tel" type="tel" class="sol-input" placeholder="Teléfono (opcional)" autocomplete="tel">
      <input id="reg_pass" type="password" class="sol-input" placeholder="Contraseña (6+)" required autocomplete="new-password">
      <p id="reg_err" class="sol-error" style="display:none;color:#dc2626;font-size:13px;"></p>
      <button type="submit" class="sol-btn-primary" id="reg_submit">Crear cuenta</button>
    </form>
  </div>
</div>
```

- [ ] **Step 2: Lógica de registro en `js/views/auth-ui.js`**

Reemplazar el wiring de pasos por el submit del nuevo form:
```js
function wireRegistroInvitacion() {
  const form = document.getElementById('inv-reg-form');
  if (!form) return;
  const err = document.getElementById('reg_err');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.style.display = 'none';
    const btn = document.getElementById('reg_submit');
    btn.disabled = true; btn.textContent = 'Creando…';
    const payload = {
      codigo: document.getElementById('reg_codigo').value.trim().toUpperCase(),
      nombre: document.getElementById('reg_nombre').value.trim(),
      email:  document.getElementById('reg_email').value.trim().toLowerCase(),
      telefono: document.getElementById('reg_tel').value.trim(),
      password: document.getElementById('reg_pass').value,
    };
    try {
      await firebase.functions().httpsCallable('registrarConInvitacion')(payload);
      // Registro automático → login inmediato.
      await firebase.auth().signInWithEmailAndPassword(payload.email, payload.password);
      window.location.href = '/app';
    } catch (e2) {
      err.textContent = e2?.message || 'No se pudo crear la cuenta.';
      err.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Crear cuenta';
    }
  });
}
```
Llamar `wireRegistroInvitacion()` donde antes se inicializaba el flujo de solicitud. Cambiar el texto del botón de entrada de "Solicitar Acceso" a "Crear cuenta con código".

- [ ] **Step 3: Borrar solicitud.html y su link**

```bash
git rm solicitud.html
```
En `login.html` cambiar `<a href="/solicitud" ...>` para que abra el modal (`onclick` a `abrirModalSolicitud()`), no navegue a `/solicitud`. Quitar rewrite `/solicitud` de `firebase.json` si existe.

- [ ] **Step 4: Verificación**

Run: `grep -rn "/solicitud\b\|getEmpresaPublicInfo\|sol_empresa\|rolSolicitado" --include="*.js" --include="*.html" --include="*.json" . | grep -v node_modules`
Expected: sin resultados (exit 1).

- [ ] **Step 5: Prueba end-to-end manual (emulador)**

1. Como admin en `/app/gestion`, generar un código.
2. Logout. En login, "Crear cuenta con código", pegar código + datos.
3. Verificar: cuenta creada, login automático, usuario aterriza en su plaza con el rol asignado.
4. Reintentar el mismo código → error "ya fue usado".

Expected: todos los pasos OK.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: registro con código de invitación en login; borrar flujo de solicitud"
```

---

### Task 7: Deploy + verificación end-to-end

**Files:** ninguno.

- [ ] **Step 1: Deploy completo (bump SW automático)**

Run: `npm run deploy:full`
Expected: SW bumpeado; hosting+functions+rules desplegados.

- [ ] **Step 2: Smoke + flujo real en producción**

Run: `node scripts/test-mapa.js --url=https://<PROD_URL>`
Luego manual: generar código real → registrar cuenta nueva → login → plaza/rol correctos → revocar otro código.
Expected: PASS.

- [ ] **Step 3: Git sync**

```bash
git add . && git commit -m "chore: bump SW post-deploy invitaciones+gestión" && git push
```

---

## Self-Review

- **Cobertura del spec:** "solicitar registro con código" (Tasks 1,2,6); "código generado por la empresa en un nuevo dashboard" (Task 5); "pre-asigna plaza+rol" (Tasks 1,2); "un solo uso" (transacción Task 2); "con expiración" (modelo Task 1 + validación Task 2); "registro automático sin aprobación" (Task 2 crea perfil ACTIVO directo). ✔
- **Placeholders:** sin TODOs; cada paso de código tiene contenido completo y comando de verificación. ✔
- **Consistencia de tipos:** `estadoInvitacion(doc, ahoraMs)`/`puedeUsarse` (Task 1) reusados en vista (Task 5) y replicados server-side (Task 2) con los mismos campos `expiraEnMs/usadaPor/revocada`. `subscribeInvitaciones/crearInvitacion/revocarInvitacion` (Task 4) coinciden con su consumo en Task 5. Callable `registrarConInvitacion` mismo payload en Task 2 (def) y Task 6 (uso). ✔
- **Diseño:** reutiliza ESTILO.md/tokens; no se generó sistema nuevo (decisión ponytail). UX de tabla/forms/confirmación aplicada. ✔
- **Dependencia Plan 1:** sin `empresaId` en invitaciones/usuarios; separación por `plazaId`. ✔
