# Diseño: Extender sección Invitaciones (UI/UX)

> **Fecha:** 2026-07-18  
> **Alcance:** Solo rediseño visual/responsive de `/app/gestion` (Invitaciones). Mismas funciones: generar, listar, copiar, revocar.  
> **Referencias visuales:** `assets/invitaciones-mobile-01-lista.png`, `assets/invitaciones-mobile-02-menu.png`, `assets/invitaciones-mobile-03-vacio.png`, `assets/invitaciones-web-01-form.png`, `assets/invitaciones-web-02-tabla.png`

## 1. Decisiones aprobadas

| Pregunta | Decisión |
|---|---|
| Alcance | **A)** UI/UX del panel actual; sin nuevas reglas de negocio ni callables |
| Mobile lista | **2)** Lista compacta tipo settings (filas densas + menú `···`) |
| Desktop form | **1)** Form arriba fijo → tabla debajo |
| Dirección visual | **Approach 1** — Industrial minimal (línea Registros / `ESTILO.md`) |

## 2. Estado actual

- Vista: `js/app/views/gestion.js` — form + `<table>` + subscribe/crear/revocar.
- Estilos: `css/app-gestion.css` — layout básico; form en flex wrap; **sin breakpoints mobile** dedicados.
- Datos: `js/app/features/gestion/invitaciones-data.js` + `domain/invitacion.model.js`.
- Callables: `generarInvitacion`, `revocarInvitacion` (sin cambios).

## 3. Layout objetivo

### 3.1 Desktop (≥768px)

1. Header: título **Gestión**, subtítulo **Códigos de invitación por plaza**.
2. Card form: Plaza | Rol | Expira en (días) | botón **Generar código** (fila horizontal, `align-items: flex-end`).
3. Card lista: tabla con columnas Código · Plaza · Rol · Estado · Expira · (acciones).
4. Código: `<code>` + botón copiar; **Revocar** ghost peligro solo si `VIGENTE`.

### 3.2 Mobile (&lt;768px)

1. Mismo orden vertical: header → form apilado (campos full-width) → lista.
2. Tabla se convierte en **lista de filas** (no cards grandes):
   - Línea 1: código (énfasis) + chip estado
   - Línea 2: `PLAZA · ROL` + fecha expira (muted)
   - Derecha: botón `more_vert` (`···`)
3. Sheet / menú de acciones al tocar `···`:
   - **Copiar código**
   - **Revocar** (solo si VIGENTE; confirma con `mexConfirm`)
   - Cancelar / cerrar
4. Empty state: icono mail, “Aún no hay invitaciones”, “Genera la primera arriba.” bajo el form.

### 3.3 Estados (chips — sin cambio semántico)

| Estado | Clase actual | Icono |
|---|---|---|
| VIGENTE | `chip-ok` | `check_circle` |
| USADA | `chip-mut` | `how_to_reg` |
| EXPIRADA | `chip-warn` | `schedule` |
| REVOCADA | `chip-bad` | `block` |

## 4. Visual / design system

- Fuente Inter; acento `#3b82f6` / hover `#2563eb`.
- Tokens: `var(--bg)`, `var(--surface)`, `var(--text)`, `var(--border)`; dark via `body.dark-theme`.
- Radios 8/12/9999; spacing múltiplos de 4; sin `!important` salvo overrides dark ya existentes.
- Iconos: solo `material-symbols-outlined`.
- Coherencia con rediseño industrial de Registros/Movimientos (hairlines, densidad calmada, sin glass/purple glow).

## 5. Comportamiento (sin cambiar API)

- Generar → `crearInvitacion` → `mexAlert` con código (igual).
- Copiar → `navigator.clipboard` + feedback `.copied`.
- Revocar → `mexConfirm` → `revocarInvitacion`.
- Subscribe realtime sin cambios.

## 6. Archivos a tocar

| Archivo | Cambio |
|---|---|
| `js/app/views/gestion.js` | Markup responsive: lista mobile + sheet acciones; conservar IDs/handlers |
| `css/app-gestion.css` | Breakpoints, filas settings, sheet, form stacked |

**Fuera de alcance:** `domain/invitacion.model.js`, Cloud Functions, login/registro con código, filtros/KPIs nuevos, tabs Plazas/Usuarios del plan antiguo.

## 7. Verificación

- `node --check js/app/views/gestion.js`
- Manual: desktop form+tabla; mobile lista + sheet Copiar/Revocar; empty state; dark theme; generar/revocar reales.
