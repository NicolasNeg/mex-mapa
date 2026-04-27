# Notas de release — Beta App Shell (Firebase Hosting)

## Qué incluye esta beta

- **App Shell** unificado (`/app.html`): sidebar, header, plaza, búsqueda global, notificaciones.
- **Vistas App** funcionales o en modo beta: dashboard, perfil, admin, programador, cola preparación, incidencias, cuadre, mensajes, **mapa App Shell** (`/app/mapa`).
- **Mapa App** con estructura real posición ↔ celda, lectura de datos por plaza, **DnD preview** y **DnD persistencia experimental** detrás de flags (`mex.appMapa.dnd`, `mex.appMapa.dndPersist`), con confirmación y API legacy `guardarNuevasPosiciones` (sin swap automático).
- **Programador**: flags locales, **Beta Readiness**, smoke check de rutas/assets (solo red mismo origen).
- **Legacy** **`/mapa`** y **`mapa.html`** se mantienen como referencia operativa completa.

## Qué sigue en legacy

- Mapa operativo completo (todas las herramientas, flujos y ajustes no portados aún a App Shell).
- Vistas fuera del shell donde aún aplique HTML clásico.

## Qué es experimental

- DnD en `/app/mapa` (preview / persistencia con flags).
- Paneles de diagnóstico y Beta Readiness.
- Cualquier UI marcada como «beta» o «experimental» en la app.

## Riesgos conocidos

- **Snapshot vs servidor**: puede haber carrera entre validación en cliente y datos en Firestore; la beta revalida unidades con `obtenerDatosFlotaConsola` cuando existe, y tras guardar espera reflexión en listener o fuerza **resync** de suscripciones.
- **Firestore `enableMultiTabIndexedDbPersistence`**: aviso conocido hasta migración modular futura (no bloqueante para esta beta).

## Qué no está soportado aún

- Swap de unidades entre cajones en un solo gesto (App Shell).
- Persistencia DnD táctil.
- Movimientos masivos, edición/eliminación de unidades desde App Mapa, cambio de estado operativo desde esta vista.

## Plan posterior (no implementado en esta beta)

- Producto tipo **SaaS** y multi-tenant.
- **TypeScript** y módulos formales.
- **Backend** propio / APIs desacopladas del cliente.
- **Hosting** productivo y pipeline CI/CD definitivo.
- **Firebase modular** (migración SDK) y limpieza de warnings asociados.
