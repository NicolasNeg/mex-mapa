# Cuadre de Flota — Design Spec

## Goal

Move "Historial de Cuadre" and mission creation/send out of the legacy
`/cuadre` tab system into a new dedicated SPA subsection, "Cuadre de flota",
with a redesigned table-based historial and a mission-send flow now usable
by Ventas (not just admin roles).

## Current state (as found)

- `/cuadre` (legacy `cuadre.html` + `js/views/mapa.js`) has 2 live tabs:
  Flota Regular / Cuadre Admins, plus a "⋮ Más controles" dropdown item
  `mcHistorialCuadre` → `abrirHistorialCuadres()` (card-based modal).
- That modal's header has a "Cuadrar Flota" button (`abrirCuadrarFlotaDesdeHistorial()`)
  that opens the mission-creation flow: pick auxiliar → `iniciarMisionAuditoria()`
  → `iniciarProtocoloDesdeAdmin` (already bridged in `js/core/database.js`).
  Gated by `canViewAdminCuadre()`.
- `js/views/mapa.js`'s `btnProtocoloV3`/`manejadorFlujoV3` state machine is
  dead code (no live DOM element anywhere) — nothing to remove there.
- Both `iniciarProtocoloDesdeAdmin` and `obtenerHistorialCuadres` are already
  exported from `js/core/database.js` — **no backend changes needed**.

## Decisions (confirmed with user)

1. New SPA view, not another legacy modal tab.
2. Mission-send capability: VENTAS role + existing admin-ish roles
   (`canViewAdminCuadre()`), not opened to every role that sees "Cuadre" nav.
3. No old duplicate entry point to worry about (it was dead code already).

## New structure

**Route:** `/app/cuadre/flota` — added to `ROUTE_TABLE` (router.js) and
`ROUTE_MAP` (route-resolver.js), `shellIntegrated: true`, `fullModuleMigrated: true`,
`feature: 'cuadre'`.

**View file:** `js/app/views/cuadre-flota.js`, two internal tabs:

### Tab 1 — Historial (default)

- Real `<table>` (brutalist style established this session for Flota
  Regular/Admins tables — no pills, dots for status, `.table-container`
  pattern).
- Columns: Fecha de cierre, Auxiliar, Autorizó (Ventas), Cuadrados,
  Faltantes, Sobrantes, Acciones (Ver PDF).
- Data: `obtenerHistorialCuadres(plaza)`.
- Search/date/author filters carried over from the old modal (functionality
  preserved, presentation changed to table).

### Tab 2 — Cuadrar flota

- If no mission active (LIBRE): auxiliar picker (dropdown, patio staff for
  current plaza) + "Enviar misión" button. Reuses `iniciarProtocoloDesdeAdmin`
  exactly as `iniciarMisionAuditoria()` does today (full plaza fleet
  snapshot, no partial unit selection — matches current behavior).
- If mission in PROCESO: status card, no form (mission is out with the
  auxiliar).
- If mission in REVISION: status card with link to `/app/cuadrarflota/ventas`
  (already built this session).

### Permissions

Tab 2 (and the mission-send action) gated by `canViewAdminCuadre() || role === 'VENTAS'`.
Tab 1 (historial) visible to anyone who can already see `/cuadre`.

### Removed from legacy Cuadre page

- `mcHistorialCuadre` item in `cuadre.html`'s "⋮ Más controles" dropdown —
  repointed to navigate to `/app/cuadre/flota` instead of opening the old
  card modal (cross-iframe navigation, same pattern as `irARevisionVentasCuadre`
  built earlier this session).

## Out of scope (not touched)

- The old card-based `historial-cuadres-modal` DOM/JS in `js/views/mapa.js`
  is left in place (still reachable via other legacy code paths like
  `abrirCuadrarFlotaDesdeHistorial`) — not deleted in this pass, just no
  longer the primary entry point. Cleanup deferred to avoid destabilizing
  other legacy call sites that still reference it.
- `js/views/profile.js`'s independent `initNotificationCenter()` call —
  unrelated to this feature.
