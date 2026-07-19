# Design: Panel Admin — reglas globales + migración SPA

**Date:** 2026-07-19  
**Status:** Approved (approach B)  
**Related:** chrome global (CONTROLES / sin hero), Phase 0 cards Usuarios/Choferes en iframe, Unidades/Traslados (patrón editor por ruta)

## Goal

Definir reglas de producto y arquitectura para rehacer el Centro Admin **módulo a módulo** como SPA nativa (`/app/admin/*`), con UI minimalista corporativa, dark mode, y dos patrones de interacción claros: **LISTAS** y **OPCIONES**.

## Locked decisions

| Tema | Decisión |
|------|----------|
| Controles | Minimalistas; layout organizado; sin hero/toolbar global de título+métricas+acciones |
| LISTAS | Usuarios, Choferes, Roles, Solicitudes |
| OPCIONES | Estados, Categorías, Modelos, Gasolinas, Motivos traslado, Plazas, Ubicaciones |
| Aparte | Empresa (form full), Programador (ruta dedicada existente) |
| LISTAS UX | Card 2–3 datos clave (foto/avatar, nombre, correo; meta corta opcional) → click rellena panel derecho grande |
| OPCIONES UX | Lista en índice → click abre `/app/admin/{sección}/{id}` editor pantalla completa (estilo Unidades/Traslados) |
| Navegación OPCIONES | Lista + detalle por URL; atrás vuelve a la lista |
| Entrega | **SPA nativa por módulo** (no quedarse en iframe a largo plazo) |
| Rollout | **B — módulo a módulo** (no big bang) |

## Visual / UX rules

1. **Chrome:** sidebar CONTROLES (claro: blanco + tipografía/iconos oscuros; oscuro: contraste alto). Expand/collapse cambia el **ancho del sidebar**, no solo el texto.
2. **Workspace:** solo contenido del módulo (sin breadcrumb/título/chips/toolbar globales).
3. **Estética:** minimalista, corporativa, profesional, limpia; tokens escalables; `body.dark-theme` obligatorio.
4. **Densidad:** generosa en LISTAS (cards legibles); OPCIONES densas pero ordenadas como catálogo actual.
5. **Iconos:** Material Symbols Outlined; tipografía Inter (ESTILO del producto).

## Architecture

```
/app/admin                    → redirect a /app/admin/usuarios (o último visitado)
/app/admin/:section           → índice LISTA u OPCIONES
/app/admin/:section/:id       → solo OPCIONES (y deep-link opcional LISTAS)
```

### Shell SPA

- Vista contenedora admin (sidebar CONTROLES + `#admin-main`) montada por router.
- Cada sección es un módulo lazy (`js/app/views/admin/<section>.js` o features).
- Datos: `js/app/features/admin/*-data.js` + mutaciones; preferir `js/core/database.js` / API existente.
- CSS por dominio: `css/app-admin.css` (tokens) + `css/app-admin-<section>.css` si hace falta.
- Mientras un módulo no esté migrado, puede seguir el iframe legacy **solo** para ese tab; al migrar, se corta el iframe para esa ruta.

### Patrón LISTAS

```
[ cards stack ] | [ editor / empty state ]
```

- Izquierda: búsqueda + cards (avatar/foto, nombre, correo, meta).
- Derecha: formulario completo al seleccionar; empty state si no hay selección.
- Deep-link opcional: `/app/admin/usuarios/:id` selecciona card sin cambiar el layout split.

### Patrón OPCIONES

```
/app/admin/estados          → lista (orden actual del catálogo)
/app/admin/estados/LISTO    → editor full (tabla/form contextual como Unidades/Traslados)
```

- El “inspector” no es un panel lateral estrecho: es la **ruta de detalle**.
- Crear nuevo: `/app/admin/{sección}/nuevo` o acción en lista que navega al editor vacío (definir por módulo en implementación).

## Migration order (1×1)

1. **Shell SPA admin** + **Usuarios** (LISTAS) — reemplaza iframe en esa ruta  
2. Choferes  
3. Roles  
4. Solicitudes  
5. **Estados** (plantilla OPCIONES reutilizable)  
6. Categorías → Modelos → Gasolinas → Motivos  
7. Plazas → Ubicaciones  
8. Empresa  
9. Retirar iframe `gestion.html` del admin cuando no queden tabs legacy  

## Phase 0 (hecho en iframe, no invalida SPA)

- Usuarios/Choferes: directorio cards + panel derecho; fix de carga (sin filtrar usuario actual; shell con altura real).  
- Se reimplementa en SPA en el paso 1–2 con la misma UX.

## Non-goals (este spec)

- Rediseñar Programador completo.
- Cambiar modelo de datos Firestore de usuarios/catálogos.
- Big bang ni dual permanente iframe+SPA.

## Acceptance (reglas globales)

1. Ninguna ruta admin migrada muestra el hero/toolbar global antiguo.  
2. LISTAS migradas: click en card muestra detalle a la derecha con datos reales.  
3. OPCIONES migradas: URL de detalle abre editor full; atrás vuelve a lista.  
4. Modo claro y oscuro legibles en sidebar y contenido.  
5. Cada módulo migrado se valida antes de pasar al siguiente.

## Open points (resolver en plan por módulo)

- Campos exactos de card en Roles/Solicitudes.  
- ID de catálogo en URL (nombre vs docId).  
- Permisos por sección (reutilizar `canViewAdmin*` / feature gates actuales).
