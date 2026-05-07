# Runbook demo beta - `/app/mapa` (histórico)

**Fase:** 14D-A
**Fecha:** 2026-05-04
**Estado:** histórico / obsoleto desde FASE 15A. `/app/mapa` ya es **OFICIAL_OPERATIVA**; usar `docs/mapa-vista-oficial.md` como guía vigente.

---

## Objetivo de la demo

Mostrar `/app/mapa` como centro operativo beta para consulta de flota, estructura de patio, filtros, detalle de unidad, incidencias por MVA y escape seguro a legacy. La demo no sustituye QA manual completa y no debe presentarse como validacion final de beta ampliada.

---

## Estado actual

| Ruta | Estado |
|------|--------|
| `/app/mapa` | **BETA_OPERATIVA_FUERTE + HARDENED_FOR_BETA** |
| `/mapa` | **KEEP_LEGACY_BACKUP** |
| Redirect `/mapa` -> `/app/mapa` | **NO redirige** |

DnD esta **OFF por defecto**. Si algo falla durante la demo, abrir `/mapa` legacy inmediatamente.

---

## Pre-demo setup

1. Confirmar que el usuario demo puede entrar a App Shell y tiene plaza asignada.
2. Confirmar que la plaza elegida tiene estructura `mapa_config` y flota visible.
3. Abrir primero `/mapa` legacy en una pestana separada como fallback.
4. Abrir `/app/mapa` y validar carga inicial antes de compartir pantalla.
5. No tocar login, auth, Functions, reglas, `sw.js` ni runtime antes de demo.

---

## Flags recomendados

| Flag | Valor demo base | Uso |
|------|-----------------|-----|
| `mex.appMapa.dnd` | `0` | DnD preview OFF por defecto |
| `mex.appMapa.dndPersist` | `0` | Persistencia DnD OFF por defecto |
| `mex.debug.mode` | `0` | Logs verbose OFF |
| `mex.legacy.force` | `0` | Mantener App Shell normal |

Para mostrar DnD preview: `localStorage.setItem('mex.appMapa.dnd','1')` y recargar con rol autorizado.

Para mostrar DnD persistente, solo si se decide explicitamente: activar tambien `localStorage.setItem('mex.appMapa.dndPersist','1')`, usar rol autorizado y confirmar contra legacy.

---

## Usuarios/roles recomendados

| Uso | Rol recomendado |
|-----|-----------------|
| Demo base read-only | Usuario operativo con plaza estable |
| DnD preview | `PROGRAMADOR` o admin global autorizado |
| DnD persistente | `PROGRAMADOR` o admin global autorizado, flags ON, plaza controlada |

No usar usuarios con permisos dudosos o plaza sin estructura para la demo principal.

---

## Flujo de demo principal

1. Entrar a `/app/mapa`.
2. Mostrar banner beta/hardened y toolbar con acceso a legacy.
3. Mostrar grid de cajones, buckets y contadores.
4. Usar filtros rapidos: en cajon, limbo/taller, con incidencias y criticas.
5. Buscar por MVA con `?q=` o busqueda global.
6. Abrir detalle de unidad: MVA, ubicacion, enlaces App y legacy, bloque de incidencias.
7. Abrir CTA a `/app/incidencias?mva=...` si aplica.
8. Volver a `/app/mapa` y mostrar refresh/resync si hace falta.

---

## Flujo de demo DnD preview

Condiciones: `mex.appMapa.dnd=1`, rol autorizado y estructura con cajones.

1. Recargar `/app/mapa`.
2. Confirmar badge/estado de DnD experimental.
3. Arrastrar unidad a cajon vacio.
4. Mostrar mensaje de movimiento simulado.
5. Aclarar que preview no escribe Firestore.
6. Intentar destino ocupado o bloqueado solo si conviene mostrar validaciones.

---

## Flujo de demo DnD persistente

Usar solo si se decide mostrar escritura real. Condiciones: `mex.appMapa.dnd=1`, `mex.appMapa.dndPersist=1`, rol autorizado y plaza controlada.

1. Abrir `/mapa` legacy en otra pestana para verificar antes/despues.
2. Elegir unidad y cajon vacio de bajo riesgo.
3. Arrastrar en `/app/mapa`.
4. Confirmar modal de persistencia.
5. Esperar confirmacion visual o resync.
6. Verificar en `/mapa` legacy que la posicion cambio.
7. Si hay duda, detener demo DnD y volver al flujo read-only.

No marcar esta prueba como PASS global si no se ejecuta completa en entorno real.

---

## Que NO mostrar en demo

- Editor de estructura, `editmap`, altas masivas, PDF/reportes, radar/chat/presencia legacy.
- Swap real de cajones ocupados.
- Zoom/pan de viewport legacy como si estuviera migrado a App Shell.
- Touch DnD como soportado.
- Cambios de login/auth/rules/Functions.
- Deploy, cache busting o cambios de `sw.js`.

---

## Fallback inmediato a `/mapa` legacy

Usar fallback si ocurre cualquiera de estos casos:

- `/app/mapa` no carga flota o estructura.
- Permission denied o error Firestore visible.
- Filtros/seleccion quedan incoherentes durante la demo.
- Persistencia DnD tarda demasiado o no refleja snapshot.
- La plaza demo tiene datos incompletos.

Accion: abrir `/mapa` directamente. `/mapa` no redirige y queda como backup operativo completo.

---

## Checklist 10 minutos antes de demo

1. Usuario demo autenticado y perfil activo.
2. Plaza correcta seleccionada.
3. `/app/mapa` carga sin errores visibles.
4. `/mapa` legacy abre en pestana separada.
5. Flags DnD base en OFF salvo demo DnD planificada.
6. MVA de ejemplo identificado para busqueda/detalle.
7. Incidencia de ejemplo identificada si se mostraran badges.
8. Pantalla en ancho suficiente; si se muestra movil/390px, tratarlo como WARNING visual pendiente.
9. No hay cambios pendientes de deploy o runtime.
10. Equipo sabe que fallback es `/mapa`.

---

## Problemas conocidos P1/P2

### P1

| Issue | Impacto demo | Mitigacion |
|-------|--------------|------------|
| `_cssRef` no nullificado | Bajo en demo unica | Evitar loops de remount innecesarios |
| Falta lock de re-drag durante persist | Medio si se muestra DnD real | No iniciar segundo drag hasta terminar confirmacion |
| `innerHTML` rebuild en plazas grandes | Medio/alto en plaza grande | Usar plaza mediana o fallback legacy |

### P2

| Issue | Impacto demo | Mitigacion |
|-------|--------------|------------|
| Touch DnD off | Bajo si demo desktop | No prometer DnD touch |
| Swap no soportado | Medio si preguntan | Explicar que ocupado se rechaza; swap queda legacy/futuro |
| Filtros 390px | Medio en movil estrecho | Demo desktop; movil queda QA pendiente |
| Sin zoom/pan | Bajo/medio | Mostrar legacy si necesitan viewport avanzado |
| Sin badge incidencias en lista | Bajo | Mostrar badges en grid/detalle |

---

## Go/No-Go rapido

| Pregunta | Decision |
|----------|----------|
| `/app/mapa` carga grid y flota? | Si: GO demo base. No: usar `/mapa` |
| Plaza y usuario correctos? | Si: GO. No: corregir antes de compartir |
| QA manual completa ejecutada? | No requerida para demo controlada; mantener WARNING |
| DnD flags OFF? | Si: GO base |
| Se mostrara DnD persistente? | Solo con aprobacion, flags ON, rol autorizado y fallback legacy |
| Algo falla en vivo? | Abrir `/mapa` legacy |

**Resultado esperado:** GO para demo beta controlada, no GO para beta ampliada sin QA manual.
