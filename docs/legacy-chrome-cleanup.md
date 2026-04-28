# Legacy Chrome Cleanup (FASE 11E)

Fecha: 2026-04-28

## Objetivo

Quitar o neutralizar chrome legacy (headers/sidebars/topbars de navegación global antigua) sin romper la lógica funcional de cada módulo legacy ni el App Shell.

## Auditoría por ruta legacy

| Ruta legacy | Chrome detectado | Acción 11E | Estado content-only | Equivalente App |
|---|---|---|---|---|
| `/home` | Shell legacy inyectado por JS | Neutralizado por `legacy-shell-bridge.js` + clases de body | Sí | `/app/dashboard` |
| `/profile` | Shell legacy inyectado por JS | Neutralizado por bridge | Sí | `/app/profile` |
| `/mensajes` | Top/header de chat propio + botón volver mapa | Se oculta navegación redundante de retorno; chat funcional intacto | Sí (módulo chat) | `/app/mensajes` |
| `/cola-preparacion` | Links de navegación legacy en panel lateral | Se ocultan links de navegación global vieja | Sí (módulo cola) | `/app/cola-preparacion` |
| `/incidencias` | Sin sidebar global; módulo kanban propio | Se mantiene módulo; bridge solo limpia offsets y CTA | Sí | `/app/incidencias` |
| `/cuadre` | Shell legacy inyectado por JS | Neutralizado por bridge | Sí (módulo cuadre) | `/app/cuadre` |
| `/gestion` | Sidebar de navegación interna del módulo admin | No se oculta (dependencia funcional de tabs) | Parcial (requiere cuidado) | `/app/admin` |
| `/programador` | Shell legacy inyectado por JS | Neutralizado por bridge | Sí | `/app/programador` |
| `/solicitud` | No chrome legacy global | Se agregó bridge para estandarizar clase y futura CTA | Sí | N/A (flujo acceso/login) |
| `/mapa` | Topbar + sidebar de unidades + overlays críticos | No neutralización destructiva (acoplamiento funcional alto) | Parcial (requiere cuidado extremo) | `/app/mapa` |
| `/editmap` | Topbar local del editor | Se conserva (es parte del módulo), bridge agregado para estandarización | Parcial (módulo específico) | `/app/mapa` |

## Qué se quitó / neutralizó

- Ocultamiento no destructivo de selectores de chrome legacy frecuentes:
  - `#admin-sidebar`, `#topbar`, `#legacySidebar`, `#legacyHeader`, `.legacy-topbar`, `.legacy-sidebar`
- Eliminación de offsets de layout viejos con clase de body:
  - `legacy-content-only`
  - `legacy-chrome-disabled` (solo rutas seguras)
- Limpieza adicional por ruta:
  - `/mensajes`: se oculta botón de navegación redundante a mapa dentro del header de contactos.
  - `/cola-preparacion`: se ocultan links legacy directos a `/mapa` y `/gestion`.

## Qué quedó intencionalmente

- `/gestion`: sidebar interna del módulo para cambiar tabs y grupos (sin eso se rompe la operación).
- `/mapa`: topbar/sidebar y overlays siguen activos porque están acoplados a DnD, paneles, modales y búsquedas.
- `/editmap`: topbar del editor y shell del editor se conservan (son parte del módulo, no chrome global).

## Riesgos y mitigaciones

- Riesgo: romper navegación interna de `gestion`.
  - Mitigación: no ocultar `cfg-v2-sidebar` para esa ruta.
- Riesgo: romper funcionalidad de `/mapa`.
  - Mitigación: ruta marcada sin neutralización de chrome operativo.
- Riesgo: offsets vacíos por CSS histórico.
  - Mitigación: reglas scoped a `body.legacy-content-only` en bridge; no cambios agresivos globales.

## Cambios técnicos aplicados

- `js/views/legacy-shell-bridge.js`
  - Perfil por ruta para decidir si ocultar chrome o no.
  - Nuevas clases de body: `legacy-content-only`, `legacy-chrome-disabled` (condicional).
  - CTA discreto "Abrir en App Shell" para rutas con equivalente.
  - Limpieza de offsets/layout no destructiva.
- `solicitud.html`
  - Se agregó script `legacy-shell-bridge.js`.
- `editmap.html`
  - Se agregó script `legacy-shell-bridge.js`.

