---
title: Mapa sin iframe — carga instantánea nativa en el shell
date: 2026-07-10
status: approved-approach / staged
---

# Mapa sin iframe (nativo en el shell)

## Problema (medido, no teoría)

El mapa se monta como **iframe keep-alive** (`mapa.html` vía `legacy-stage.js`).
Abrir ese iframe **rearranca la app completa por segunda vez**: recarga 6 SDKs de
Firebase + `mex-api.js` + 11 módulos `/api/*` + `mapa.js` (**23,136 líneas**), y
hace su propio `firebase init` + `onAuthStateChanged`. Todo eso el **shell ya lo
tiene cargado**. Por eso las demás secciones (vistas SPA nativas) son instantáneas
y el mapa no: es un boot entero desde cero.

Objetivo del usuario (textual): **instantáneo (<2s)**, **sin iframe**, **sin
redibujar en cada apertura**, **sin gastar lecturas** al reabrir.

## Enfoque

Montar el DOM del mapa **dentro del shell** como vista nativa (`mount()/unmount()`)
y dejar que `mapa.js` corra en el contexto del shell, **reusando** su Firebase/api
ya cargados. Sin iframe → sin segundo boot. DOM persistente oculto al salir → sin
redibujar. Cache local existente (`_readMapCache`/`_hydrateMapFromLocalCache`) →
sin lecturas al reabrir (solo el listener en vivo para cambios).

### Riesgo principal
`mapa.js` asume que es la página completa: manipula `document.body`,
`window.history`, overlays de login/carga, registra `auth.onAuthStateChanged`, y
define cientos de `window.*`. En el shell comparte `document`/`window` → posibles
colisiones con el router y el layout del shell. **Ya existen guards** de contexto
(`_enShellIframe`, `SHOULD_SKIP_MAIN_MAP_BOOTSTRAP`, `_isDedicated*`) que
reaprovechamos y ampliamos.

### Mitigación: feature flag + etapas
- **Flag**: `localStorage['mex.mapaNative'] === '1'` (toggle desde consola). Con
  el flag **apagado (default)** el mapa sigue por el iframe actual — **cero
  cambios de comportamiento** para el usuario normal.
- Se implementa y prueba con el flag **encendido** hasta estar estable; entonces
  se voltea el default y se retira el iframe.

## Etapas

### Etapa 1 — Scaffold detrás del flag (esta sesión)
- `js/app/views/mapa-native.js`: vista SPA con `mount()/unmount()` que:
  1. Inyecta el fragmento del `<body>` de `mapa.html` en un **host persistente**
     dentro del shell (patrón similar al `legacyStageHost`, pero **div, no iframe**).
  2. Carga `mapa.js` **una sola vez** (dynamic import) y llama a un
     `window.__mexMountMapaNative()` nuevo (arranque bajo demanda).
- `mapa.js`: exponer `__mexMountMapaNative()` que corre la init del mapa **sin**
  los efectos de página que colisionan (history/overlays/body), reusando la
  lógica interna de render (`dibujarMapaCompleto`, listeners de datos).
- Router (`router.js` / `route-resolver.js` / `legacy-stage.js`): si el flag está
  ON, la ruta `/app/mapa` monta `mapa-native` en vez del iframe; si OFF, el iframe.
- **Entregable**: con el flag ON, el mapa aparece nativo (aunque falten pulidos);
  con el flag OFF, todo igual que hoy.

### Etapa 2 — Domar colisiones
- `window.history`/rutas: gate para que el mapa nativo no toque el history del
  shell (extender los guards `_isDedicated*`).
- `document.body` classes y overlays: ámbito acotado al host del mapa.
- `auth.onAuthStateChanged`: no re-registrar; usar el estado ya resuelto del shell.
- IDs duplicados entre `mapa.html` body y el shell: renombrar/scoping si colisionan.
- Handlers globales `window.*` que el shell ya define: evitar pisarlos.

### Etapa 3 — Persistencia real (sin redraw, sin lecturas)
- Al `unmount()`: **ocultar** el host (display:none), NO destruir → volver es
  instantáneo, sin redibujar.
- Primer render desde cache local; suscripción en vivo solo para deltas.
- Verificar en consola que reabrir el mapa **no dispara lecturas** de estructura
  (solo el snapshot incremental).

### Etapa 4 — Voltear el default y limpiar
- Cuando esté estable: flag ON por default, quitar la rama iframe del mapa en
  `legacy-stage.js` (`mapa` sale del pool keep-alive de iframes).
- Mantener cuadre/admin como iframe por ahora (fuera de alcance).

## Criterios de éxito
- `/app/mapa` carga **instantáneo** (como dashboard), sin segundo boot de Firebase.
- Volver al mapa desde otra pestaña: instantáneo, **sin redibujar**.
- Reabrir no genera lecturas de estructura (solo listener incremental).
- Con el flag OFF, comportamiento idéntico al actual (red de seguridad).

## Fuera de alcance
- Reescribir `mapa.js` al sistema modular `mapa-loader.js` (Fase 6). Aquí
  **reusamos el monolito**, solo cambiamos dónde/cómo se monta.
- De-iframe de cuadre/admin.
