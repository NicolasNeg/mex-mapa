# App Shell QA Before Map (Fase 8M)

## Estado general

- App Shell estable en rutas `/app/*` migradas.
- Fallbacks legacy mantienen operación.
- `/mapa` legacy se conserva sin cambios.

## Bugs corregidos en esta fase

1. **Mensajes interplaza / identidad**
   - Problema: algunas cuentas no veían conversaciones al usar una sola identidad (ej. nombre vs email histórico).
   - Fix: `js/app/views/mensajes.js` ahora consulta `obtenerMensajesPrivados` con múltiples identidades candidatas (`nombre`, `usuario`, `nombreCompleto`, `email`) y deduplica por `id`.
   - Resultado: la conversación carga por usuario (interplaza) sin filtrar por plaza.

2. **Plaza duplicada en header**
   - Problema: el badge móvil de plaza también quedaba visible en desktop.
   - Fix: `css/shell.css` oculta `.mex-header-plaza-mobile-badge` por defecto y solo se muestra en media query mobile.
   - Resultado: una sola representación de plaza por breakpoint.

3. **Cola preparación: falso error de permisos inicial**
   - Problema: condiciones de carrera podían renderizar error de un listener viejo.
   - Fix: `js/app/views/cola-preparacion.js` agrega guardas por secuencia de suscripción y plaza esperada antes de renderizar data/error.
   - Resultado: el primer render ya no muestra error falso por callback stale.

4. **FOUC / flash de estilos**
   - Problema: ciertos CSS se inyectaban tarde y/o se removían en cada `unmount`.
   - Fixes:
     - `app.html`: preload de `app-dashboard`, `app-cuadre`, `cola-preparacion`.
     - `js/app/views/dashboard.js` y `js/app/views/cuadre.js`: conservar link CSS al desmontar para evitar recarga visual.
   - Resultado: menor flicker al navegar entre vistas.

## QA técnico aplicado

- Listeners:
  - `cola-preparacion`, `incidencias`, `cuadre`, `admin`, `mensajes`, `dashboard`, `profile`, `programador` conservan cleanup de listeners/eventos en `unmount`.
  - No se agregaron auth listeners nuevos.
- Navegación:
  - Router conserva `setRoute`, cierre de drawer mobile y limpieza de búsqueda al cambio de ruta.
- Header:
  - Menú, búsqueda global, plaza y campana mantienen comportamiento esperado.
- Cache/SW:
  - `sw.js` versionado a `mapa-v224`.

## Pendientes / riesgos conocidos

- QA visual manual completa en todos los breakpoints extremos (360/390/430/768/1366/ultrawide) debe validarse en dispositivo real.
- Popover de campana en pantallas muy bajas puede requerir ajuste de altura/scroll interno si el contenido crece.
- La identidad histórica de chat depende de consistencia de datos legacy; se mitigó con multi-identidad, pero puede haber casos excepcionales con alias no documentados.

## Checklist para iniciar Fase 9A (mapa real)

- [x] Mensajes App Shell sin dependencia indebida de plaza.
- [x] Header sin duplicación de plaza.
- [x] Cola preparación estable en primer render.
- [x] FOUC reducido en shell/vistas críticas.
- [x] Fallback legacy operativo.
- [x] `/mapa` legacy intacto.
- [x] SW actualizado.

## Confirmaciones de alcance

- No se modificó `mapa.html`.
- No se modificó `js/views/mapa.js`.
- No se migró mapa real en esta fase.
