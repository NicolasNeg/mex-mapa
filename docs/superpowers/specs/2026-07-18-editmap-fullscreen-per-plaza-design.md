# Diseño: Editor de mapa — pantalla completa + ruta por plaza

> **Fecha:** 2026-07-18
> **Alcance:** arreglo de chrome/routing sobre el motor legado existente (`mapa.js`). No se toca lógica de drag/resize/undo/alinear. No es la reescritura nativa "Ciclo B" (`docs/superpowers/specs/2026-07-15-editor-mapa-profesional-design.md`) — esa sigue fuera de alcance.

## 1. Problema

`/app/editmap` hoy es un iframe hacia `/editmap/{plaza}?shell=1&appStage=1`. `editmap.html` es la única página legacy que **no** suprime su propio chrome en modo `shell=1`/`appStage=1` (a diferencia de cuadre.html, cola-preparacion.html, incidencias.html, gestion.html, mensajes.html, que sí lo hacen). Resultado: sidebar del App Shell + topbar oscuro propio del iframe ("Volver") + modal centrado con backdrop y bordes redondeados (`.modal-overlay` → `.mapa-editor-shell`) — triple chrome encimado, nunca pantalla completa real.

Además `css/editmap.css` (topbar/selector de plaza del iframe) ignora el sistema de variables del proyecto por completo (paleta oscura fija, no responde a `body.dark-theme`), y `css/app-editmap-chrome.css` tiene valores hardcodeados que desvían de `base.css`.

**Restricción importante encontrada en recon:** `#modal-editor-mapa` (mismo ID/clases/CSS) se usa en **dos contextos distintos**:
1. **Ruta dedicada** (`/editmap` standalone, `/app/editmap` vía iframe) — la página ENTERA es el editor. Aquí debe ir pantalla completa real, sin modal/backdrop.
2. **Modal inline** desde `mapa.html` / `mapa/templates/mapa-core.html` — el usuario ya está viendo el mapa y abre "editar" como overlay sobre esa vista. Aquí el comportamiento de modal (backdrop, tarjeta centrada) sigue siendo correcto — **no se debe romper este caso**.

## 2. Cambios

### 2.1 Routing — `/app/editmap/:plaza`
- `js/app/router.js`: agregar rama `key.startsWith('/app/editmap/')` en `_routeForPath` y `_styleKeyForPath` (mismo patrón ya usado para `/app/cuadre/u/`), resolviendo a `ROUTE_TABLE['/app/editmap']`.
- `js/app/route-resolver.js`: extender el manejo de `ROUTE_MAP.editmap` para reconocer el segmento de plaza en `toAppRoute`/`toLegacyRoute`/`normalizePath`, espejando el patrón de `/app/cuadre/u/:mva`.
- `js/app/views/editmap.js`: leer la plaza del path de la URL (`location.pathname`) en vez de depender solo de `getCurrentPlaza()`; si la URL no trae plaza, resolver desde app-state y navegar a la forma canónica `/app/editmap/{plaza}` (`history.replaceState`, sin recargar). Al cambiar de plaza vía el selector del shell, navegar a la nueva URL (no solo reapuntar el `src` del iframe silenciosamente).

### 2.2 Chrome — fusionar en un solo topbar, pantalla completa real
- `editmap.html`: agregar el mismo bloque de supresión `shell-embedded` que usan cuadre.html/cola-preparacion.html/etc. cuando `shell=1`/`appStage=1` — oculta el topbar propio "Volver" del iframe. Fuente de verdad de acciones (cerrar, deshacer, guardar) pasa a ser únicamente el topbar del propio editor (`.ed-topbar`).
- Marcar el body de `editmap.html` con una clase (`ed-standalone`) para diferenciar del caso "modal inline desde mapa.html". Todas las reglas de "quitar backdrop/bordes redondeados/centrado" en `app-editmap-chrome.css` van **scoped bajo `body.ed-standalone #modal-editor-mapa`** — el modal inline desde `/mapa` no se toca en su comportamiento de overlay, solo hereda la paleta de colores corregida.
- App Shell: cuando la ruta activa es `/app/editmap*`, ocultar sidebar/header del shell (modo enfoque) — mismo mecanismo que ya usan otras rutas fullBleed si existe, o vía CSS scoped a la ruta.

### 2.3 Paleta y tokens
- `app-editmap-chrome.css`: reemplazar `--ed-accent`/`--ed-muted` hardcodeados y los fallbacks de dark-theme que no coinciden con `base.css`, por `var(--accent)`/`var(--text-muted)`/etc. directos.
- `editmap.css` (topbar del iframe): reconectar a las variables del proyecto; agregar soporte real a `body.dark-theme` (hoy no existe).
- Lienzo en modo oscuro (`body.ed-standalone` + `dark-theme`): fondo `var(--bg-viewport)` (`#020617`, ya definido en `base.css`, sin uso actual) — negro real, no gris oscuro genérico.

### 2.4 Firma: lienzo tipo plano técnico
- Cuadrícula de puntos existente se mantiene/afina (usa `var(--border)`).
- Lectura de coordenadas (x,y) siguiendo el cursor o la celda seleccionada — pill flotante pequeña, `position:absolute`, se posiciona con JS existente de drag (mínimo cambio de JS, solo lectura de posición ya calculada, sin tocar lógica de negocio).

## 3. Fuera de alcance
- Reescritura nativa del motor (`mapa-visual-editor.js`) — Ciclo B, doc separado.
- Cambios a `abrirEditorMapa`/`guardarMapaEditor`/lógica de drag-resize-undo en `mapa.js`.
- Cambios al modelo de datos (`mapa_config/{plaza}` ya está correctamente escopado por plaza).

## 4. Verificación
Sin navegador disponible en este sandbox (limitación ya confirmada en sesión). Verificación: `node --check` no aplica a HTML/CSS puro; revisión manual de cada diff contra los selectores/IDs reales; confirmar que el modal inline desde `mapa.html` no perdió su backdrop (revisar que las reglas fullscreen quedaron correctamente scoped bajo `body.ed-standalone`).
