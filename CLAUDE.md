# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

After every deploy, also run `git add . && git commit && git push` to keep GitHub in sync.

The `npm run deploy` scripts automatically call `scripts/bump-sw.js`, which increments `CACHE_NAME = 'mapa-vXXX'` in `sw.js`. **Never deploy without bumping the SW version**, or returning users will receive stale cached assets.

There is no build step, linter, or test suite — the project is plain HTML/CSS/JS served directly by Firebase Hosting.

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

### Legacy views inside the SPA shell

`js/app/views/legacy-stage.js` wraps legacy HTML pages as iframes rendered inside `#mexShellMain`. The legacy page is loaded with `?shell=1` so it renders content-only (no its own sidebar/header). A subset of views is kept alive in an **iframe pool** (`_iframePool` map) so they are not destroyed on route change:

> dashboard, mapa, cuadre, admin, mensajes, cola, incidencias, programador, editmap, profile

Views outside this set are destroyed on unmount. When adding a new legacy stage route, add it to `LEGACY_BY_ID` in `legacy-stage.js` and the `ROUTE_TABLE` in `router.js` using the `legacyStage(id, navRoute)` helper.

### Domain layer

`domain/*.model.js` contains **pure JavaScript business logic** with no Firebase dependency:

- `permissions.model.js` — role metadata, `esAdmin()`, `esGlobal()`, `tieneAccesoTotal()`
- `unidad.model.js`, `estado.model.js`, `movimiento.model.js`, `mapa.model.js` — entity shapes and pure helpers

Import from `domain/` when writing logic that should be testable in isolation from Firebase.

### API layer

All data access goes through `api/*.js` modules. Each file exports functions that are assembled by `api/_assemble.js` into `window.api`. The entry point `mex-api.js` also exposes a `window.api` facade and legacy globals.

For new features inside the SPA, prefer the data modules in `js/app/features/*/` which import directly from the API modules using ES module syntax.

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

Read `ESTILO.md` before writing any CSS or Tailwind classes. Critical rules:

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
3. Create `css/app-my-view.css` for view-specific styles and inject it in the `mount()` function.
4. Update `js/shell/navigation.config.js` if adding a sidebar navigation item.
