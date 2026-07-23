# Papeletas → TypeScript migration — Design

**Status:** Draft, pending user review
**Related:** `docs/superpowers/plans/2026-07-22-papeletas-v3-hibrido.md` (feature roadmap for the same module — file map and responsibilities below are aligned with it), `docs/superpowers/specs/2026-07-22-papeletas-v3-hibrido-design.md`

## Motivation

Triggered by three unrelated runtime errors observed in production (Storage 404 on a stale `fotoPath`, a Firestore transaction `failed-precondition`, and a 500 from the `generarYSubirPdf` Cloud Function) — the request was to reduce future errors by migrating the Papeletas module to TypeScript.

**Explicit non-goal:** this migration does not fix those three errors. They are data/runtime/infra bugs (wrong stored value, transaction contention, server-side function failure), not type errors — TypeScript would not have caught any of them. That debugging effort is a separate, later piece of work (see "Relationship to the open runtime bugs" below).

What TypeScript *does* buy here: catching wrong field names/shapes when reading/writing Firestore documents (e.g. the `zonas.<id>.fotoPath` inconsistency seen in the console log — some zones store a raw Storage path, others a full Cloudinary URL, and nothing today enforces one shape), wrong function signatures across the ~10 files in this module, and null/undefined handling in the DOM-heavy view code.

## Scope

Convert exactly these 11 files from `.js` to `.ts` (source). No other file in the repo changes.

| File | Role (per v3-híbrido plan) |
|---|---|
| `domain/papeleta.model.js` | Zonas, gates, tapetes validation, progress helpers — pure functions, no Firebase |
| `js/app/features/papeletas/papeletas-constants.js` | Status labels |
| `js/app/features/papeletas/papeletas-data.js` | create/update/finalize + side-effects (Firestore) |
| `js/app/features/papeletas/papeletas-storage.js` | Firebase Storage / Cloudinary URL resolution |
| `js/app/features/papeletas/papeletas-reportes-data.js` | Reportes de daños (Ventas) subcollection |
| `js/app/features/unidades/unidades-data.js` | Unit catalog + `buscarUnidad` autocomplete |
| `js/app/features/papeletas/papeletas-camera.js` | Guided camera capture flow |
| `js/app/features/papeletas/papeletas-diagram.js` | Car-silhouette damage diagram |
| `js/app/features/papeletas/papeletas-photo-annotate.js` | Fullscreen photo overlay editor |
| `js/app/features/papeletas/papeletas-pdf.js` | PDF export via Cloud Function |
| `js/app/views/papeletas.js` | The view itself (3600+ lines) — converted last, once every dependency above is already typed |

Everything these files import that lives *outside* this list — `js/core/database.js`, `js/core/dialogs.js`, `js/core/export-menu.js`, `js/core/export-signing.js`, `js/core/hist-move-popover.js`, `js/app/app-state.js`, the router, `js/app/views/reportes-danos.js` (which itself imports `papeletas-reportes-data.js`) — stays plain `.js`, untouched, and is consumed by the `.ts` files as loosely-typed dependencies (typed `any` unless a quick JSDoc-inferred shape is good enough).

**Explicitly out of scope:** the rest of the SPA, the legacy standalone pages, `functions/`, introducing a bundler (Vite/webpack/esbuild), and rewriting any business logic beyond what's needed to satisfy the type checker.

## Tooling

- **`tsconfig.papeletas.json`** at repo root, scoped via `include` to just the 11 files above (not the whole repo) — unrelated `.js` files never get type-checked or forced to change.
- Compiler options (to be pinned exactly during the Phase 0 spike below, since browser-native ESM + `tsc`-only (no bundler) has a specific, easy-to-get-wrong resolution mode):
  - `strict: true` (per your choice — real null-safety and no-implicit-any from day one)
  - `allowJs: true` so `tsc` can read the surrounding untouched `.js` files for inference; `checkJs: false` so it doesn't force-check them
  - `module`/`moduleResolution` set so that a `.ts` file can write `import { db } from '/js/core/database.js'` (note the `.js` extension, required because the *browser* loads this as native ESM) and have `tsc` resolve it to the real `.js` file's shape, while emitting that same `.js`-suffixed specifier unchanged in the compiled output
  - `outDir`/`rootDir` such that the compiled `.js` lands in the *exact same path* the browser already requests today (e.g. `js/app/views/papeletas.ts` → `js/app/views/papeletas.js`, same directory) — this is what lets every other file in the app keep importing these modules with zero changes
- **`types/globals.d.ts`** — minimal ambient declarations for the `window.*` globals this module actually touches: `window.MEX_CONFIG`, `window.mexPerms`, `window.mexFeatures`, `window._auth`, `window.api`, `window.mexDialog`/`mexAlert`/`mexConfirm`/`mexPrompt`, `window.showToast`. Not an attempt to type the whole app's global surface — grows only as this module needs it.
- **New `package.json` scripts:** `build:papeletas` (`tsc -p tsconfig.papeletas.json`), `watch:papeletas` (same, `--watch`, for active development).
- **Deploy scripts updated:** `deploy`, `deploy:full`, `deploy:staging`, `deploy:staging:full` all run `npm run build:papeletas` before `scripts/bump-sw.js`, so the committed `.js` is always freshly regenerated from `.ts` at deploy time — matches this repo's existing "never deploy without bumping the SW" discipline.
- **Compiled `.js` is committed to git** (per your choice) — same convention already used for `sw.js`'s generated `CACHE_NAME` bump. Worst case if someone forgets to rebuild locally: they see the last-committed (slightly stale) build, never a missing/broken file.

## Migration order

Five phases, each its own commit + SW bump + manual smoke test (there is no automated test coverage for Papeletas today — Playwright's only smoke test covers `/app/mapa` — so manual verification of the affected flow is a required step at each phase, not an optional nicety).

1. **Phase 0 — tooling spike.** Write `tsconfig.papeletas.json` + `types/globals.d.ts`, convert only the smallest file (`papeletas-constants.js`) to `.ts`, and verify end-to-end: `tsc` resolves the `.js`-suffixed relative imports correctly, emits working `.js` in place, the browser loads it with no console errors, and a local `npm run build:papeletas && firebase emulators:start --only hosting` smoke-test of `/app/papeletas` works. Nothing bigger gets touched until this is proven.
2. **Phase 1 — domain layer.** `domain/papeleta.model.js` → `.ts`. Pure functions, no Firebase SDK — the easiest file to get fully strict, and the natural home for the core `Papeleta`, `ZonaEstado`, `DamageMark` interfaces the rest of the module will import.
3. **Phase 2 — data/storage layer.** `papeletas-data.js`, `papeletas-storage.js`, `papeletas-reportes-data.js`, `unidades-data.js`. This is where the `Papeleta`/`Unidad`/`ReporteDano` Firestore document interfaces get defined and enforced — the layer most likely to surface real bugs like the `fotoPath` shape inconsistency seen in the console log (not fixed here, but the interface work will make that class of bug visible going forward).
4. **Phase 3 — browser-API feature modules.** `papeletas-camera.js`, `papeletas-diagram.js`, `papeletas-photo-annotate.js`, `papeletas-pdf.js`.
5. **Phase 4 — the view.** `papeletas.js` itself, last, once everything it imports already has real types.

## Relationship to the open runtime bugs

The three errors that triggered this request (Storage 404, Firestore transaction race, PDF 500) are **not** part of this spec and are **not** fixed by any phase above. They need their own root-cause investigation (already started, via `systematic-debugging`, before this migration was requested). Recommendation: treat that as a separate follow-up, picked up after Phase 4 lands — typed `Papeleta`/zona interfaces from Phase 2 will make that debugging easier (e.g., a `fotoPath: string` field with a documented "Storage path OR Cloudinary URL" union will force a decision on which shape is canonical), but the debugging itself is independent work, not a phase of this plan.

## Risks / open questions carried into implementation

- Exact `module`/`moduleResolution` combination for "browser-native ESM in, `.js`-suffixed specifiers out, `tsc`-only, no bundler" needs to be validated empirically in Phase 0 — this is a known-tricky TS configuration and the design intentionally doesn't pin the exact flags until the spike proves them.
- `papeletas.js` (Phase 4) is 3600+ lines. The original v3-híbrido plan already flagged it as a candidate to "split later if >4k" — this migration doesn't force that split, but if strict-mode conversion becomes unwieldy at that size, splitting the file is an in-scope option to keep the phase reviewable (not a requirement).
- Type coverage stops at the boundary with untouched `.js` files (`database.js`, `dialogs.js`, etc.) — those remain `any`-typed from this module's perspective unless minimal ambient types are added to `globals.d.ts`.
