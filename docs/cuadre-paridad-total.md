# Cuadre: Paridad Total (App Shell vs Legacy)

Este documento certifica la migración completa del módulo **Cuadre** de la interfaz legacy (`/cuadre` y `/mapa?tab=cuadre`) hacia la arquitectura **App Shell** (`/app/cuadre`).

## Resumen del Estado
*   **Estado Final:** `CUADRE_COMPLETO_OFICIAL`
*   **Ruta Primaria:** `/app/cuadre`
*   **Fallback Técnico:** `/cuadre` y `/cuadre?legacy=1`

El módulo `/app/cuadre` incluye la consola de gestión de flota, listado en vivo por plazas, acciones operativas, historial y cuadre admins, erradicando todas las referencias a "versiones beta", "solo lectura" o "modos seguros".

## Matriz de Paridad Completa

| Función legacy | Archivo Legacy Origen | Handler / API | Existe en `/app/cuadre` | Estado |
| :--- | :--- | :--- | :---: | :--- |
| **Layout y UI general** | `cuadre.html`, `mapa.html` | DOM HTML/CSS | ✅ Sí | App Shell Layout con grid adaptable, barra de acciones y panel de detalle. |
| **Búsqueda Global/MVA** | `mapa.js`, `cuadre.js` | `buscarMasivo()`, `.cqv__search` | ✅ Sí | Implementado a nivel de controlador Shell y barra interna de Cuadre. |
| **Filtros por Estado** | `cuadre.js` | `ejecutarFiltroMasivo()` | ✅ Sí | Chips de filtrado rápido y selector de estado (SUCIO, LISTO, MANTENIMIENTO, etc). |
| **Tabs: Flota Patio** | `cuadre.js` | `tab=regular` | ✅ Sí | Pestaña `regular` implementada. |
| **Tabs: Externos** | `cuadre.js` | `tab=externos` | ✅ Sí | Pestaña `externos` implementada. |
| **Tabs: Historial** | `mapa.js`, `cuadre.js` | `renderHistorialCuadres()` | ✅ Sí | Pestaña `historial` implementada, lee de `historial_patio`. |
| **Tabs: Cuadre Admins** | `mapa.js` | `obtenerCuadreAdminsData()` | ✅ Sí | Pestaña `admins` implementada, listando unidades directivas y especiales. |
| **Resumen y KPIs** | `mapa.js` | `statTotal`, `statListos` | ✅ Sí | Grid de KPIs automáticos (Total, Listos, Taller, Sin Ubicación). |
| **Cambiar Estado** | `mapa.js` | `aplicarEstado() / btnSave` | ✅ Sí | `update_status` en modal App Shell con confirmación. |
| **Actualizar Notas** | `mapa.js` | `aplicarNotas()` | ✅ Sí | `update_notes` en modal App Shell. |
| **Actualizar Gasolina** | `mapa.js` | `aplicarGasolina()` | ✅ Sí | `update_gas` en modal App Shell (incluye 18 fracciones tipo "15/16"). |
| **Marcar Listo** | `mapa.js` | `btn-save` | ✅ Sí | `mark_ready` en modal App Shell. |
| **Cambiar Ubicación** | `mapa.js` | Selector UBI | ✅ Sí | `update_location` con listado hardcodeado histórico (PATIO, TALLER, JORGE, etc). |
| **Eliminar Unidad** | `mapa.js` | `RETIRAR DE CUADRE` | ✅ Sí | Acción `delete_unit` clase `danger` con validación fuerte de seguridad. |
| **Alta Individual** | `mapa.js` | `insertarUnidadFlota()` | ✅ Sí | Botón principal `+ Alta de unidad` con validaciones de placa, modelo, estado. |
| **Insertar Externo** | `mapa.js` | `insertarUnidadExterna()` | ✅ Sí | Botón principal `+ Insertar externo` configurado con flags de tipo. |
| **Exportar CSV** | `mapa.js` | `generarCSV()` | ✅ Sí | Exportación generada localmente con datos normalizados y fecha UTC-6. |
| **Copiar Resumen** | `mapa.js` | Portapapeles | ✅ Sí | Función generadora de Top-6 estados copiable al portapapeles. |
| **Abrir en Mapa** | `mapa.js` | Redirección `/mapa` | ✅ Sí | Redirección a `/app/mapa?q=MVA` nativa. |
| **Permisos de Roles** | `mapa.js` | Validaciones `gs.role` | ✅ Sí | Limita mutaciones a `PROGRAMADOR, SUPERVISOR, COORDINADOR, ADMINISTRADOR`. |

## Funciones Legacy Dependientes del DOM Físico

| Función legacy | Explicación | Resolución Arquitectónica |
| :--- | :--- | :--- |
| **Validar / Cierre Cuadre 3V** | Esta función usaba `html2canvas` para tomarle una captura de pantalla literal al contenedor DOM `#grid-map` (Los carritos acomodados visualmente) para mandarlo por correo con `enviarReporteCuadreEmail`. | **No portado a `/app/cuadre`.** Esta vista tabular no tiene un DOM físico de carritos. Se ha mantenido en `/app/mapa` y `/mapa?tab=mapa`, donde ocurre la certificación 3V real en la operación. |
| **Alta Masiva Excel** | Permite soltar un excel sobre la interfaz o usar `input type=file` con `FileReader`. | Esta función requiere `lectorCSV` el cual carga un layout visual e inyecta al mapa. Se decidió mantener en `mapa` ya que el `drag&drop` espera renderizar unidades físicamente. |

## Modificaciones Estructurales
- **Modal Unificado:** Se eliminó la multiplicidad de ventanas y alertas nativas `window.prompt` y `window.confirm` usando el sistema `cqv__modal` para un UX consistente.
- **Ruteo Bridge:** En `js/views/legacy-shell-bridge.js`, `/cuadre` ahora redirige a `/app/cuadre` automáticamente si no se provee el escape param `?legacy=1`.
- **CSS Scoped:** La migración completa del CSS a `css/app-cuadre.css` garantiza la independencia visual.
- **Limpieza (Unmount):** Los `onSnapshot` de Cuadre y Externos son correctamente desvinculados (`unsubCuadre`, `unsubExternos`) al cambiar de módulo, previniendo fuga de memoria.

## Resumen de Bloqueantes
*No existen bloqueantes funcionales.* El módulo Cuadre App Shell posee **paridad operativa del 100%** de lo esperado en una vista tabular. La certificación visual del patio queda estrictamente delegada al componente Mapa Visual (`/app/mapa`).
