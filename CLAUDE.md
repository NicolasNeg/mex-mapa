# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Golden rules (`agente.md`, `.cursor/rules/*.mdc`)

**Task closeout** — whenever a task with code changes is finished, even if nothing was deployed:

1. `node scripts/bump-sw.js` (increments `CACHE_NAME` in `sw.js`) — skip only if a `npm run deploy*` in the same change already bumped it.
2. `git add -A && git commit -m "<message>"`
3. `git push`

**Export/signing** — every exported PDF/Excel/CSV must identify the exporting user and company:
- PDF/Excel: signature **inside the file** (header/footer/metadata, "Exportado por …").
- CSV: signature **only in the filename** (no meta row required).
- Download filename for all types: `NOMBRE_USUARIO_FECHA_NOMBREEMPRESA.ext` (user uppercase, spaces→`_`; date `YYYY_MM_DD`; company sanitized uppercase). Example: `ANGEL_ARMENTA_2026_09_16_OPTIMARENTACAR.pdf`.

**SPA listados (tabla + rutas)** — operational lists in `/app/*` use dense table + routes `/`, `/nuevo`, `/v/:id`; detail/create are full-page in-module (not permanent side panel / modal as primary). See `agente.md` and Traslados/Unidades.

---

## Deploy commands

```bash
# Deploy hosting only (production) — auto-bumps SW version
npm run deploy

# Deploy hosting + functions + rules (production)
npm run deploy:full

# Staging equivalents
npm run deploy:staging
npm run deploy:staging:full

# Deploy only Cloud Functions
npm run deploy:functions

# Deploy only Firestore + Storage rules
npm run deploy:rules
```

The `npm run deploy` scripts automatically call `scripts/bump-sw.js`, which increments `CACHE_NAME = 'mapa-vXXX'` in `sw.js`. **Never deploy without bumping the SW version**, or returning users will receive stale cached assets.

There is no build step or linter. The only automated test is a Playwright smoke test.

---

## Local development

There is no build step or bundler. Serve the project root with any static file server that supports `cleanUrls`:

```bash
# Preferred — uses Firebase Hosting emulator (matches production headers)
firebase emulators:start --only hosting

# Quick alternative
npx serve . --single
```

For functions development, use:

```bash
firebase emulators:start --only hosting,functions,firestore
```

---

## Running the smoke test

`scripts/test-mapa.js` is a Playwright end-to-end smoke test (login → `/app/mapa` → sidebar + controles menu). It auto-starts a local Firebase Hosting emulator if none is running.

```bash
# Headless (default) — against local emulator
node scripts/test-mapa.js

# Show browser window
node scripts/test-mapa.js --headed

# Against a specific URL (e.g., staging)
node scripts/test-mapa.js --url=https://staging.example.com
```

The test credentials (`jlp@gmail.com` / `123456`) must exist in the target Firebase project.

---

## Architecture

### Two parallel experiences

**Legacy pages** (`mapa.html`, `home.html`, `gestion.html`, etc.) are standalone HTML files with their own script stacks. They use Firebase compat SDKs loaded via `<script>` tags and call `window.api.*` functions assembled by `mex-api.js`.

**Modern SPA** (`/app/*`) is a single-page app served from `app.html`. All navigation happens client-side via a History API router (`js/app/router.js`). Each view is a JS module that exports `mount(ctx)` and `unmount()`. The router lazy-loads views with dynamic `import()`.

The goal is to migrate all legacy pages into the SPA shell over time (Phases defined in `PLAN_MAESTRO.md`).

### Boot sequence (SPA)

1. `app.html` loads Firebase SDKs, `mex-api.js`, `api/*.js`, `js/core/app-bootstrap.js`, `js/core/empresa-context.js`, `js/core/feature-gates.js` as blocking `<script>` tags.
2. `app-bootstrap.js` runs immediately (IIFE): fetches `MEX_CONFIG` (empresa + listas) from Firestore, shows a full-screen overlay while loading, then releases it. Exposes `window.__mexConfigReadyPromise`.
3. `js/app/main.js` (ES module, loaded last) waits for Firebase Auth state → loads user profile via `window.__mexLoadCurrentUserRecord()` → initializes `app-state.js` → mounts `ShellLayout` → creates router → router renders the initial view.

### Key global objects

| Global | Description |
|---|---|
| `window._db` | Firestore instance |
| `window._auth` | Firebase Auth instance |
| `window.api` | Assembled API object (all `api/*.js` modules) |
| `window.MEX_CONFIG` | Current config: `{ empresa, listas }` |
| `window._empresaActual` | Current tenant document from `empresas/{id}` |
| `window.mexFeatures` | Feature gate checker: `.puedeUsar(featureKey)` |
| `window.mexPerms` | Permission checker: `.canDo(permissionKey)` |
| `window.__mexCurrentPlazaId` | Active plaza (branch) |

### Multi-tenancy

`js/core/empresa-context.js` loads the tenant document from `empresas/{empresaId}` in Firestore and sets `window._empresaActual`. Feature availability is controlled by `js/core/feature-gates.js` via `window.mexFeatures.puedeUsar(feature)`.

Plans (`lite`, `local`, `regional`, `corporativo`) are defined in `feature-gates.js`. Each plan controls which features are enabled and operational limits (max plazas, users, GPS refresh rate, etc.).

The bootstrap programmer email (`angelarmentta@icloud.com`) always gets role `PROGRAMADOR` with superadmin access and an `isSuperAdminContext` empresa context that bypasses all feature gates and permissions.

### Role & permission system

Roles (ascending privilege): `AUXILIAR` → `VENTAS` → `SUPERVISOR` → `JEFE_PATIO` → `GERENTE_PLAZA` → `JEFE_REGIONAL` → `JEFE_OPERACION` → `CORPORATIVO_USER` → `PROGRAMADOR`.

Roles `PROGRAMADOR`, `JEFE_OPERACION`, and `CORPORATIVO_USER` have full access and bypass all permission checks.

Check access with `window.mexPerms.canDo('permission_key')`.

### Route resolver

`js/app/route-resolver.js` is the single source of truth for the legacy ↔ App Shell route mapping. `ROUTE_MAP` has one entry per module with fields:

- `legacyRoute` / `appRoute` — canonical URL forms
- `navRoute` — sidebar item to highlight
- `shellIntegrated` — `true` once the module has its own `/app/*` view
- `fullModuleMigrated` — `true` once all business logic lives in the SPA

Key exports: `toAppRoute(path)`, `toLegacyRoute(path)`, `isMigratedRoute(path)`, `getNavRoute(path)`, `normalizePath(path)`. Query strings are preserved by all functions.

### Legacy views inside the SPA shell

`js/app/views/legacy-stage.js` wraps legacy HTML pages as iframes rendered inside `#mexShellMain`. The legacy page is loaded with `?shell=1` so it renders content-only (no sidebar/header). A subset of views is kept alive in an **iframe pool** (`_iframePool` map) so they are not destroyed on route change:

> dashboard, mapa, cuadre, admin, mensajes, cola, incidencias, programador, editmap, profile

Views outside this set are destroyed on unmount. When adding a new legacy stage route, add it to `LEGACY_BY_ID` in `legacy-stage.js` and the `ROUTE_TABLE` in `router.js` using the `legacyStage(id, navRoute)` helper.

The router also listens to the `mex:empresa-change` custom event (dispatched when the programmer console switches tenants) and re-renders the current route.

### Domain layer

`domain/*.model.js` contains **pure JavaScript business logic** with no Firebase dependency:

- `permissions.model.js` — role metadata, `esAdmin()`, `esGlobal()`, `tieneAccesoTotal()`
- `unidad.model.js`, `estado.model.js`, `movimiento.model.js`, `mapa.model.js` — entity shapes and pure helpers

Import from `domain/` when writing logic that should be testable in isolation from Firebase.

### API layer

All data access goes through `api/*.js` modules. Each file exports functions that are assembled by `api/_assemble.js` into `window.api`. The entry point `mex-api.js` also exposes a `window.api` facade and legacy globals.

For new features inside the SPA, prefer the data modules in `js/app/features/*/` which import directly from the API modules using ES module syntax. These `*-data.js` files use `onSnapshot` directly for real-time listeners. Each feature folder may contain multiple sub-modules: `*-data.js` (Firestore subscriptions), `*-mutations.js` (writes), `*-renderer.js` (DOM), `*-view-model.js` (derived state), etc. — see `js/app/features/mapa/` as the reference implementation.

`js/core/database.js` is a **bridge module** that re-exports `window.api` functions under ES module imports, and additionally exports `db`, `auth`, `storage`, `functions` (Firebase instances) and a `COL` constants object for all Firestore collection names. Import from here in new SPA code rather than accessing `window.api` directly:

```js
import { db, COL } from '/js/core/database.js';
// COL.CUADRE, COL.EXTERNOS, COL.USUARIOS, etc.
```

When the migration is complete, `database.js` will contain direct implementations and `mex-api.js` can be removed.

The `COL` object covers the main collections listed above plus `CUADRE_ADM`, `AUDITORIA`, `HISTORIAL_CUADRES`, `SIPP`, `CONFIG`, `PLANTILLAS_ALERTAS` — see `js/core/database.js` for the full list.

### Core utility modules

`js/core/` contains several shared utilities beyond the bridge/state modules:

| Module | Exports / purpose |
|---|---|
| `dialogs.js` | `mexDialog()`, `mexAlert()`, `mexConfirm()`, `mexPrompt()` — design-system modals that replace `alert()`/`confirm()`/`prompt()`. Use these everywhere instead of native browser dialogs. |
| `error-logger.js` | `reportProgrammerError(payload)` — sends client errors to Firestore `programmer_errors`. Used by the global error handler and callable manually for caught exceptions. |
| `observability.js` | Performance and error observability helpers — instruments `reportProgrammerError` with screen/profile context. |
| `notifications.js` | Push notification helpers — request permission, subscribe/unsubscribe from FCM topics. |
| `pwa-install.js` | Listens for the `beforeinstallprompt` event and exposes the deferred prompt for the install button in the shell. |

`firebase-messaging-sw.js` (in the project root, alongside `sw.js`) is a second service worker used exclusively for FCM background push notifications. It does **not** handle asset caching.

### Mapa modular architecture

The mapa view is being decomposed into a per-`tipoNegocio` modular system. `mapa/mapa-loader.js` orchestrates loading:

1. **Config** — reads `window._empresaActual.tipoNegocio` and dynamically imports `mapa/configs/{tipoNegocio}.config.js` (falls back to `default.config.js`). Valid types: `estacionamiento`, `flotilla`, `arrendadora`, `default`. Each config exports `{ features: [...paths], ... }`.
2. **Core feature modules** — always loaded from `mapa/features/core/`: `init`, `render`, `permissions`, `modals`, `search`, `plaza-switcher`, `unit-selection`, `notifications`.
3. **Type-specific modules** — loaded from the config's `features` array (e.g., `mapa/features/estacionamiento/grid.js`).
4. **Extras** — feature-gate-controlled: `editmap-inline`, `auditoria`, `ocr`, `pdf-reports`, `supervision` loaded from `mapa/features/extras/`.
5. **Templates** — per-`tipoNegocio` HTML fragments live in `mapa/templates/` (e.g., `mapa-estacionamiento.html`, `mapa-flotilla.html`). Feature modules fetch and inject these rather than building HTML in JS.

Shared state across all mapa feature modules lives in `mapa/mapa-store.js` (`mapaStore` object + `setStore()` + `onStoreChange(key, fn)` observer). Do not use module-level variables for state that multiple feature modules need — put it in `mapaStore` instead.

The legacy monolith (`js/views/mapa.js`) is still the active implementation; `mapa-loader.js` is the in-progress replacement (Fase 6).

### App Shell

`js/shell/shell-layout.js` — `ShellLayout` class that composes:
- `js/shell/sidebar.js` — `ShellSidebar` (dark glassmorphism sidebar, `#07111f` background)
- `js/shell/header.js` — `ShellHeader` (glassmorphism topbar)

Navigation config lives in `js/shell/navigation.config.js`.

Navigation links must use `data-app-route="/app/route"` attribute (not bare `href`) so the router intercepts the click without a full page reload.

The `navRoute` field in `ROUTE_TABLE` entries sets which sidebar item is highlighted as active when that route is mounted. It can differ from the actual URL path (e.g., `/app/dashboard` highlights the `/home` nav item).

### App state

`js/app/app-state.js` is a minimal pub/sub state store (no framework). It holds session, profile, role, active plaza, and available plazas. Import `getState()`, `setState()`, `subscribe()`, `setCurrentPlaza()` from it inside ES modules. Do not use `window.__mex*` globals in new SPA code — use app-state instead.

### Cloud Functions

`functions/index.js` — Node.js 18, Firebase Functions v1, deployed to `us-central1`. Key callable functions include: `crearEmpresa`, `seedPrimeraEmpresa`, user management, push notifications, and audit logging. All functions guard with `PROGRAMMER_ROLES` or `ADMIN_ROLES` checks before mutating data.

Deploy with `npm run deploy:functions`.

### Key Firestore collections

| Collection | Purpose |
|---|---|
| `empresas/{id}` | Tenant documents — plan, features, plazas, limits |
| `usuarios/{id}` | User profiles and roles |
| `solicitudes` | Access requests |
| `configuracion/{empresaId}` | Per-tenant config (listas, settings) |
| `mapa_config/{empresaId}` | Map overlays and zone configuration |
| `ops_events` | Operational audit log |
| `programmer_errors` / `programmer_jobs` | Programmer console data |
| `bitacora_gestion` | Admin audit trail |

### CSS organization

`css/global.css` is a pure `@import` manifest. **Never add styles directly to it.** Add styles to the appropriate module file:

| File | Scope |
|---|---|
| `css/base.css` | CSS variables, dark theme, animations |
| `css/shell.css` | App shell: sidebar, header, layout |
| `css/app-*.css` | Per-view SPA styles (injected on view mount) |
| `css/mapa.css`, `css/alertas.css`, etc. | Legacy page styles |

### Service Worker

`sw.js` uses cache-first for static assets and network-first for Firestore/API calls. The `CACHE_NAME` version in `sw.js` must be incremented before every deploy — `npm run deploy` does this automatically via `scripts/bump-sw.js`.

---

## Design system

Read `ESTILO.md` before writing any CSS or Tailwind classes. **Tailwind is loaded via CDN only in `app.html`** (`https://cdn.tailwindcss.com`) — Tailwind classes work in SPA views but **not** in standalone legacy HTML pages. The runtime config is set in `js/tailwind-config.js` (sets `tailwind.config` after the CDN script loads). Never add Tailwind classes to legacy `*.html` files.

Critical rules:

- **Font**: Inter only. Weights 400/500/600/700.
- **Icons**: `<span class="material-symbols-outlined">icon_name</span>` only. No emojis as functional icons.
- **Accent**: `#3b82f6` (Blue). Hover: `#2563eb`.
- **Sidebar brand**: `#07111f` background, `#2ecc71` accent — only inside sidebar, not in content.
- **Spacing**: 4px base unit only. Multiples: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96px.
- **Border-radius tokens**: `4px / 8px / 12px / 16px / 9999px` — no arbitrary values.
- **Dark mode**: via `body.dark-theme` class. Use `var(--bg)`, `var(--surface)`, `var(--text)`, `var(--border)` CSS variables.
- **Unit status colors**: exact hex values defined in `ESTILO.md` — do not substitute.
- No `!important` except in documented dark-theme overrides.
- No hardcoded hex colors in component CSS — always use the defined CSS variables.

---

## Adding a new SPA view

1. Create `js/app/views/my-view.js` exporting `mount({ container, navigate, shell, state })` and `unmount()`.
2. Add the route to `ROUTE_TABLE` in `js/app/router.js` with a `loader` and, if feature-gated, a `feature` key.
3. Add an entry to `ROUTE_MAP` in `js/app/route-resolver.js` with `shellIntegrated: true`.
4. Create `css/app-my-view.css` for view-specific styles and inject it in the `mount()` function.
5. Update `js/shell/navigation.config.js` if adding a sidebar navigation item.

## Design documents

`docs/` contains ~40 markdown files: feature specs, migration runbooks, QA checklists, and view blueprints. Key files for ongoing work:

- `agente.md` — regla de oro de exportación/firma de documentos (PDF, Excel, CSV)
- `docs/app-real-view-migration-status.md` — per-view migration progress
- `docs/app-shell-migration-policy.md` — rules for when a view qualifies as "migrated"
- `docs/legacy-view-blueprints.md` — visual/behavioral spec for each legacy page being ported
- `docs/smoke-matrix.md` — manual QA checklist matrix per release

---

## Firebase project aliases

Deploy scripts use two named Firebase project aliases:

| Alias | Usage |
|---|---|
| `production` | `npm run deploy`, `npm run deploy:full`, `npm run deploy:functions`, `npm run deploy:rules` |
| `staging` | `npm run deploy:staging`, `npm run deploy:staging:full` |

These aliases are configured in `.firebaserc`. Hosting rewrites in `firebase.json` map clean URLs (e.g., `/app/**` → `app.html`, `/mapa` → `mapa.html`) — add new clean-URL pages there if needed.
