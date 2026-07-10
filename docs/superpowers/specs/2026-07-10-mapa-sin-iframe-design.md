---
title: Mapa — carga instantánea (ya es nativo, no iframe)
date: 2026-07-10
status: corregido tras investigación
---

# Mapa: carga instantánea

## Corrección clave (tras leer el código real)
El mapa **YA NO usa iframe**. La ruta `/app/mapa` carga `js/app/views/mapa.js`, una
vista **nativa** que:
- Crea un `<div id="mex-legacy-mapa-stage">` persistente en `#mexShellMain` (no iframe).
- Inyecta el `<body>` de `mapa.html` (sin scripts) una sola vez.
- Hace `import('/js/views/mapa.js')` (monolito) una sola vez (`stage.dataset.mexInit`).
- Al salir: `display:none` (no destruye) → volver es instantáneo, sin redibujar.
- `mex:navigate-mapa` solo cierra el fleet modal; `mex:plaza-change` solo redibuja si
  cambió la plaza. Cache local ya existe (`_readMapCache`).

Así que "sacar el mapa del iframe" **ya estaba hecho**. La migración NO es el trabajo.

## Problema real
1. **Primera carga lenta**: `import()` del monolito (23,136 líneas) + su boot ocurren
   bajo demanda al primer clic → ese es el retraso.
2. **Quedaba en blanco al volver**: los fixes previos se pusieron en `legacy-stage.js`
   (el path de IFRAME, que NO sirve al mapa). Archivo equivocado.
3. **"Ver en mapa" no resalta**: el foco pendiente (`__mexPendingMapFocus`) lo aplicaba
   `legacy-stage.js`, no la vista nativa → nunca se aplicaba.

## Solución (implementada, bajo riesgo, en el archivo correcto)
- **A) Precarga en idle** (`js/app/main.js`): tras el boot, en idle (2.5s) se hace
  `import('/js/app/views/mapa.js').then(m => m.ensureStageReady())` si no estás ya en
  el mapa → el import del monolito + inyección del stage suceden en segundo plano →
  el **primer clic al mapa es instantáneo**. Idempotente (guard `mexInit`).
- **B) No quedar en blanco al mostrar** (`js/app/views/mapa.js` `mount()`):
  `_kickMapaRender()` → `resize` + `window.__mexEnsureMapaRendered()` (re-fit; redibuja
  SOLO si el grid está vacío — no redibuja un mapa ya pintado).
- **C) "Ver en mapa" resalta** (`js/app/views/mapa.js` `mount()`): `_applyPendingFocus()`
  consume `window.__mexPendingMapFocus` y llama `window.__mexFocusUnidad(mva)` con
  reintento ~18s (las unidades tardan en renderizar tras cambiar de plaza).

## Sobre "no gastar lecturas / no redibujar"
Ya se cumple: el monolito bootea una vez, render desde cache local, listener en vivo
solo para deltas. `__mexEnsureMapaRendered` redibuja únicamente si el grid quedó vacío.

## Pendiente / a validar
- Confirmar en prod que el primer clic ya es instantáneo (por la precarga) y que
  reabrir no redibuja.
- Si la precarga del monolito en el dashboard causara algún glitch (acoplamiento del
  boot con `document.body`), gatearla; hasta ahora el stage nace oculto → bajo riesgo.
- (Futuro) Buscador flotante dentro del mapa desde el engranaje — pedido del usuario,
  se hará aparte.
