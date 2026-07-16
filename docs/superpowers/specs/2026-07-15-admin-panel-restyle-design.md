# Design: Panel Admin — restyle corporativo con toque distintivo (Ciclo A)

**Date:** 2026-07-15  
**Status:** in progress (A1–A4 chrome shipped)  
**Cycle:** A — restyle visual (CSS + markup ESTILO), **sin migrar JS** ni quitar iframe  
**Out of cycle:** SPA nativa `/app/admin`, edición avanzada de roles/plazas fuera de legacy, redirect `/gestion → /app/admin`  
**Related:**  
- Blueprint: `docs/legacy-view-blueprints.md` §7  
- Go/No-Go: `docs/admin-appfirst-go-nogo.md`  
- Plan: `docs/superpowers/plans/2026-07-15-admin-panel-restyle.md`  

---

## 1. Product intent

**Centro Admin** es la sala de control de configuración del negocio: usuarios, accesos, catálogos operativos y plazas. La audiencia son gerentes de plaza, supervisores regionales y programador — personas que necesitan **confianza, claridad y velocidad**, no un dashboard “startup”.

**Job de la vista:** encontrar un módulo, ver el estado del sistema de un vistazo, editar sin miedo a romper operación.

**Ciclo A hace:** nuevo chrome ESTILO sobre el DOM legacy existente (`gestion.html` + modal en `mapa.html`).  
**Ciclo A no hace:** reescribir `abrirTabConfig` / lógica en `mapa.js`, ni sustituir iframe por SPA nativa.

---

## 2. Decisions locked

| Topic | Decision |
|---|---|
| Enfoque | **Ciclo A** — restyle visual (aprobado 2026-07-15) |
| Tono | **Empresarial / corporativo** con **un toque distintivo** (no plantilla SaaS genérica) |
| Arquitectura | Mantener iframe legacy `/gestion` en `/app/admin`; lógica en `mapa.js` |
| Layout | Sidebar fijo + workspace editorial (header → toolbar → contenido → status) |
| Fuente de verdad markup | `gestion.html` (canonical); sync obligatorio con bloque admin en `mapa.html` |
| CSS | Nuevo `css/app-admin-chrome.css`; deprecar conflictos en `admin-luminous.css` progresivamente |
| Mobile | Desktop-first (≥1024px); sidebar colapsable; tablas con scroll horizontal |

---

## 3. Current surface (do not replace)

| Piece | Role |
|---|---|
| `/app/admin`, `/app/gestion` (legacy) | `legacy-stage.js` → iframe `/gestion?shell=1&admin=1` |
| `/gestion` | `gestion.html` — panel completo `#modal-config-global` |
| Modal mapa | `#modal-config-global` duplicado en `mapa.html` / `mapa-core.html` |
| Lógica tabs | `abrirTabConfig()` y render por tab en `js/views/mapa.js` |
| CSS hoy | `config.css` (~7.8k), `admin-luminous.css` (~1.3k), import en `global.css` |
| `/app/gestion` (SPA) | Vista aparte: solo códigos de invitación (`js/app/views/gestion.js`) — **fuera de scope** salvo alinear tokens si comparte clases |

### Tabs in scope (14 módulos)

| Grupo | Tabs |
|---|---|
| Accesos | usuarios, choferes, roles, solicitudes |
| Operación | estados, categorias, modelos, gasolinas, motivos_traslado |
| Estructura | plazas, ubicaciones |
| Organización | empresa |
| Sistema | bloqueo patio (acción) |
| Programador | programador |

---

## 4. Visual direction — “Corporate Registry”

### Thesis

El admin debe sentirse como un **registro corporativo digital**: ordenado, sobrio, denso cuando hace falta — pero con una firma que lo hace reconocible: **la barra de registro viva** (sidebar con contadores + rail de acento animado) y **bandejas de datos** (double-bezel en tablas/paneles).

No es un hero marketing ni un bento Dribbble. Es una herramienta de back-office premium.

### Palette (ESTILO + corporate cool)

| Token | Valor | Uso |
|---|---|---|
| `--admin-accent` | `#3b82f6` | Activo, CTAs, rail |
| `--admin-accent-hover` | `#2563eb` | Hover |
| `--admin-accent-pale` | `rgba(59,130,246,0.12)` | Focus ring, badges |
| `--admin-bg` | `#f8fafc` | Workspace |
| `--admin-surface` | `#ffffff` | Cards, tablas |
| `--admin-sidebar` | `#07111f` | Nav (alineado shell; **solo sidebar**, no contenido) |
| `--admin-sidebar-text` | `#e2e8f0` | Labels nav |
| `--admin-sidebar-muted` | `#94a3b8` | Sublabels |
| `--admin-border` | `#e2e8f0` | Divisores workspace |
| `--admin-text` | `#0f172a` | Títulos |
| `--admin-muted` | `#64748b` | Meta, captions |
| Success / warn / error | `#10b981` / `#f59e0b` / `#ef4444` | Chips estado |

**Evitar:** púrpura neón, gradientes decorativos en headers, ALL CAPS, pesos 800/900, Material Icons (migrar a Symbols).

### Typography

- **Inter** 400/500/600/700 únicamente  
- Display workspace: 20px / 600  
- Section: 16px / 600  
- Body tabla: 14px / 400–500  
- Label caps: 11px / 500, `letter-spacing: 0.05em`  
- **Números en métricas:** tabular-nums; contadores sidebar en 12px/600

### Layout

```
┌─ App shell header (existente) ─────────────────────────────────────┐
├─ SIDEBAR 280px ────┬─ WORKSPACE ────────────────────────────────────┤
│ Brand compact      │ Kicker · Título módulo · badge CONFIG           │
│ Grupos colapsables │ Metric ribbon: usuarios | pendientes | catálogo │
│ Tab + count pill   ├─────────────────────────────────────────────────┤
│ ● accent rail      │ Toolbar: búsqueda · filtros · acciones rápidas  │
│ (animated)         ├─────────────────────────────────────────────────┤
│                    │ [ Double-bezel tray: tabla / form / detalle ]   │
│                    ├─────────────────────────────────────────────────┤
│                    │ Status: última sync · plaza · usuario           │
└────────────────────┴─────────────────────────────────────────────────┘
```

- **Ocultar** hero `cfg-v2-hero` interno (título vive en workspace + shell).  
- Sidebar llega hasta arriba del panel (sin franja decorativa duplicada).

### Signature element — “Registry rail + live counts”

1. **Accent rail:** barra vertical 3px en el tab activo del sidebar, color `--admin-accent`, transición suave al cambiar tab (`transform` + `opacity`, no `left`).  
2. **Live count pills:** cada tab muestra conteo cuando el JS ya expone insight (`cfg-insight-*`, badges solicitudes). Si no hay dato, pill oculta — no inventar números.  
3. **Metric ribbon:** fila compacta bajo el título del módulo (usuarios activos, solicitudes pendientes, ítems catálogo) alimentada por IDs existentes en DOM.

**Toque distintivo sin romper corporativo:** el rail animado + bandejas con borde interior sutil (ledger tray) — no ilustraciones ni glass excesivo.

### Components

| Componente | Tratamiento |
|---|---|
| Sidebar groups | Collapse con chevron; sublabel 11px muted |
| Nav tab | Icon 20px Symbols + label 14px; pill count a la derecha |
| Workspace header | Kicker uppercase 11px; título sentence case |
| Toolbar | Search con icono; botones secondary; primary = island CTA |
| Tablas | Sin card box pesado; tray double-bezel; `divide-y`; row hover slate-50 |
| Form fields | Label arriba; input 44px; focus ring accent pale |
| Chips estado | Pill 9999px; colores semánticos desaturados |
| Modales cfg | Mismo chrome; backdrop blur solo en overlay fijo |
| Empty / loading / error | Copy directo, acción sugerida (“Crea el primer estado”) |

### Motion

- Easing: `cubic-bezier(0.32, 0.72, 0, 1)`  
- Entrada workspace: fade-up 16px, 500–700ms, una sola vez al cambiar tab  
- Hover botones: `translateY(-1px)`; active `scale(0.98)`  
- `prefers-reduced-motion: reduce` → sin animaciones

### Dark theme

`body.dark-theme` vía variables `--bg`, `--surface`, `--border`, `--text`. Sidebar mantiene `#07111f`; workspace invierte a superficies oscuras.

---

## 5. Files map (Ciclo A)

| Path | Action |
|---|---|
| `css/app-admin-chrome.css` | **Create** — chrome principal, scope `#modal-config-global` |
| `css/global.css` | Add `@import` after `admin-luminous.css` (chrome overrides win) |
| `gestion.html` | Markup: classes `admin-*`, Symbols, metric ribbon shell, quitar inline toy |
| `mapa.html` + `mapa/templates/mapa-core.html` | Sync admin modal block with gestion.html |
| `css/admin-luminous.css` | Trim / override conflicts (no delete masivo en A1) |
| `css/config.css` | Solo overrides puntuales si chrome no alcanza (evitar editar 7k líneas) |
| `js/app/router.js` | Cache-bust if inject link added for admin iframe parent |

**Do not touch (unless ID/class hook required):** `js/views/mapa.js` business logic.

---

## 6. Phases

| Phase | Deliverable |
|---|---|
| **A1** | `app-admin-chrome.css` + shell/sidebar/workspace/status + hide hero |
| **A2** | Accesos: usuarios, choferes, roles, solicitudes |
| **A3** | Operación: estados, categorías, modelos, gasolinas, motivos |
| **A4** | Estructura + empresa + programador + bloqueo patio |
| **A5** | Sync HTML triple + QA smoke + deploy |

Each phase: visual QA en `/app/admin?tab=…` y modal admin desde `/app/mapa`.

---

## 7. Acceptance criteria

- [ ] `/app/admin` carga iframe con nuevo chrome; tabs navegables sin regresión funcional  
- [ ] Modal admin desde mapa idéntico visualmente  
- [ ] Inter + `#3b82f6` + Symbols; sin 800/900; sentence case  
- [ ] Sidebar accent rail visible en tab activo  
- [ ] Contadores visibles donde DOM/JS ya provee datos  
- [ ] Tablas y paneles usan double-bezel tray  
- [ ] Dark theme legible  
- [ ] `prefers-reduced-motion` respetado  
- [ ] Mobile ≥768: sidebar colapsa; contenido usable con scroll  
- [ ] No nuevos listeners ni cambios Firestore  

---

## 8. Out of scope (Ciclo B+)

- Migrar `/app/admin` a SPA nativa con `admin-*-data.js`  
- Redirect `/gestion → /app/admin`  
- Reescribir permisos / edición peligrosa de roles  
- Unificar `/app/gestion` invitaciones dentro del panel admin  

---

## 9. Self-review

| Check | OK |
|---|---|
| Placeholders / TBD | None |
| Contradictions with ESTILO | Resolved — Inter, accent blue, Symbols |
| Scope creep | JS migration explicitly out |
| Ambiguity on sync | gestion.html canonical, mapa.html mirror |
| Distinctive vs corporate balance | Single signature (rail + counts + ledger tray) |
