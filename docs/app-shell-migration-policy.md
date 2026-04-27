## Politica de migracion de vistas reales App Shell

Desde FASE 8K, las vistas `/app/*` deben migrar logica real del legacy cuando sea seguro, no solo recrear interfaz.

### Flujo obligatorio

1. Auditar modulo legacy real antes de codificar:
- HTML, JS y CSS legacy.
- Funciones `window.api` usadas en produccion.
- Colecciones Firestore, queries y listeners.
- Dependencias de header/sidebar legacy.

2. Extraer logica segura hacia App Shell:
- Capa de datos clara (idealmente en `/js/app/features/*`).
- Normalizacion de datos.
- Render equivalente con filtros reales.
- Primera entrega en modo read-only.

3. Mantener contratos del App Shell:
- Plaza activa desde `app-state`.
- Busqueda principal desde header global (`mex:global-search`).
- `mount/unmount` con cleanup de listeners.
- Sin auth listeners nuevos por vista.

4. Mantener fallback legacy:
- CTA visible para "Abrir modulo completo".
- Ruta legacy intacta y operativa durante migracion.

5. Acciones destructivas:
- Solo en fase posterior, despues de estabilidad read-only.
- Nunca mezclar acciones destructivas con primera migracion.

### Alcance actual

- Aplicar esta politica a mejoras de `mensajes`, `admin`, `programador` y futuras vistas `/app/*`.
- No aplicar de forma destructiva todavia a `/mapa`, `mapa.html` ni `js/views/mapa.js`.
