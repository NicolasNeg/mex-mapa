# Diseño: Cola ↔ turnos activos (asignado)

> **Fecha:** 2026-07-18
> **Alcance:** Fase 3 (parcial) de `docs/plan-turnos-potenciado.md` §5.4 y `docs/plan-cola-preparacion-cuadre.md` — solo el campo `asignado` de Cola. Responde la pregunta abierta #7 de `plan-turnos-potenciado.md` §7: **asignar sin turno activo solo advierte, no bloquea.**

## 1. Estado actual

`asignado` en `cola_preparacion/items/{mva}` es texto libre (`js/app/views/cola-preparacion.js`), con un `<datalist id="prepUsersDatalist">` de sugerencias poblado por `loadPlazaUsers(plaza)` (`js/app/features/cola-preparacion/cola-data.js:100`) — **todos** los usuarios de la plaza, sin distinguir quién está en turno. Sin relación con `turnos`/`onTurnosActivos`.

## 2. Cambios

### 2.1 `js/app/views/cola-preparacion.js`
- Importar `onTurnosActivos` de `turnos-data.js`.
- En `mount()`: suscribirse con la plaza activa; mantener un `Set` (`_turnoActivoKeys`) de claves normalizadas (email lower + nombre lower) de quienes tienen turno `ACTIVO` ahora. Cleanup del listener en `unmount()` (patrón ya usado por otros unsubs del archivo).
- `_renderDatalists()`: ordenar `_plazaUsers` con los de turno activo primero; su `<option>` label agrega ` — En turno`.
- Nuevo helper `_estaEnTurno(asignadoStr)`: normaliza y compara contra `_turnoActivoKeys` (match por email exacto o nombre case-insensitive).
- Card (línea ~958) y panel de detalle (línea ~1018-1024): si `_estaEnTurno(it.asignado)` → pill verde "En turno" junto al nombre. Sin match → nada (sin advertencia negativa, evita ruido/falsos negativos por typos).

### 2.2 CSS
- Nueva clase `.cola-badge-turno` en `css/cola-preparacion.css`: pill `border-radius:9999px`, `background: var(--success-pale, rgba(16,185,129,.12))`, texto `#10b981` (o el token success del proyecto), 11px/600.

## 3. Fuera de alcance
- No se toca `js/views/cola-preparacion.js` (legacy, ya marcado para retiro en Fase 2 de `plan-cola-preparacion-cuadre.md`).
- No se bloquea la asignación a alguien sin turno — decisión confirmada.
- No se agrega badge "fuera de turno" — solo señal positiva.
- Push/notificación de turno patio y horario del día (además de turno activo) quedan para un ciclo posterior.

## 4. Verificación
Sin test automatizado disponible (mismo límite de sandbox de sesiones anteriores). Verificación: `node --check` en los archivos tocados; revisión manual del diff contra los IDs/clases reales usados por el archivo.
