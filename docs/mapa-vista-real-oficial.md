# Mapa App Shell — Vista real oficial (FASE 15E)

Fecha: 2026-05-07

## Estado

- `/app/mapa`: **OFICIAL_REAL_VISUAL**
- `/mapa`: **CLASSIC_FALLBACK**
- Redirect de `/mapa`: **NO activo**

## Qué se migró visualmente en 15E

- Header operativo interno más cercano a legado (título, plaza, estado de operación y CTA discreta a clásico).
- Canvas dominante y jerarquía visual tipo legacy en la zona principal.
- KPIs superiores operativos (unidades, celdas, ocupación, limbo, taller, huérfanos, incidencias abiertas).
- Buscador integrado dentro del módulo mapa (soporta `?q=` y resaltado existente).
- Panel lateral de detalle más integrado al mapa.
- Toolbar depurada para operación real (refresh, abrir clásico, sin ubicación/huérfanos, ocupación).

## Limpieza aplicada

- Se eliminaron decoraciones pseudo-ovales/elipses del layout de `/app/mapa`.
- Se ocultó copy de etapa beta/tester y se mantuvo copy operativo corto.
- Se retiraron controles de diagnóstico visibles en toolbar principal de usuario final.

## Lo que sigue en mapa clásico

- Editor avanzado de estructura.
- Flujos avanzados heredados (PDF/reportes y operaciones no migradas).
- Herramientas legacy completas vía CTA: `Abrir mapa clásico`.

## Restricciones preservadas

- Sin cambios en login/auth/functions/rules.
- Sin cambios destructivos en `mapa.html`, `js/views/mapa.js` y `css/mapa.css`.
