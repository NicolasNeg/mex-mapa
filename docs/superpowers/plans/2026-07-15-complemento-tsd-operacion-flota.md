# Plan operativo: complemento a TSD (gestión de flota primero)

> **Fecha:** 2026-07-15  
> **Prioridad:** AHORA — antes de cualquier MVP de arrendamiento / reemplazo TSD  
> **Horizonte arrendamiento completo:** 1+ año (ver roadmap largo, no bloquear esto)  
> **Fuentes:** Obsidian `MapGestion/`, memoria de sesión, planes cola/turnos/estados  

---

## 0. Principio de producto (acordado)

| Capa | Qué es | Cuándo |
|------|--------|--------|
| **A — Complemento a TSD** | Patio, mapa, cuadre, estados, cola, turnos, incidencias, bitácora, export/import flota | **Ahora** |
| **B — MVP pulido del complemento** | Estabilidad, índices, UX formal, sin bugs P0 de Obsidian | Después de A |
| **C — Arrendamiento / reemplazo TSD** | Reservas, contratos, pagos, CFDI… | **Después** (1+ año) |

MapGestion se vende hoy como:

> **La capa operativa que TSD (u otro RMS) no resuelve bien: el patio real.**

No se vende aún como reemplazo del mostrador/contratos.

El doc largo `docs/superpowers/plans/2026-07-15-mapgestion-rental-os-roadmap.md` queda como **visión futura**. Este doc es el **backlog ejecutable**.

---

## 1. Qué ya avanzamos (sesión reciente) — no reabrir sin QA

| Ítem | Estado | QA pendiente |
|------|--------|--------------|
| Estados flota vs patio (UI cuadre + sync index + buscador + expediente) | Código listo | Probar LISTO/SUCIO → ARRENDABLE; EN RENTA no se pisa |
| Cola Fase 1–2 (API, sync LISTO, bitácora, deep link) | Código listo | Confirmar sync + reglas `eventos` |
| Turnos: historial por usuario, semana readonly, copiar semana, export PDF | Código listo | Deploy índices |
| Turnos: asistencia PENDIENTE + confirm admin + rules | Código listo | **Deploy `firestore:rules`** |
| Cuadre mobile tabla / menú / insert formal | Parcial (sesión previa) | Revisar 390px |

---

## 2. Backlog Obsidian — P0 (arreglar antes de features nuevas)

Fuente: `MapGestion/POR ARREGLAR.md`

| # | Issue | Archivos probables | Done when |
|---|--------|-------------------|-----------|
| P0-1 | Alertas sin estilo + reaparecen aunque leídas | alertas CSS/JS, mark-as-read | Estilo correcto; leída no vuelve a “nueva” |
| P0-2 | Se puede insertar 2× la misma unidad; no valida `plazaActual` | `api/cuadre.js` insert, index | Insert bloquea si MVA ya en cuadre o `plazaActual` otra plaza |
| P0-3 | Buscador → “Ver en mapa” no resalta / no pasa MVA al mapa | `mapa-buscador.js`, `__mexGoToMapUnit`, mapa search | Al llegar, input + highlight de esa unidad |
| P0-4 | Cuadre sin “Más controles” / “Controles admin” | `cuadre.html`, shell iframe, `mapa.js` fleet UI | Menús restaurados en ruta cuadre |

---

## 3. Backlog Obsidian — Turnos (cerrar operación de personal)

Fuente: `MapGestion/(07) TURNOS.md` + `docs/plan-turnos-potenciado.md`

| # | Issue | Notas |
|---|--------|-------|
| T-1 | Deploy índices `asistencia` + `turnos` historial | Bloquea QA real |
| T-2 | Deploy rules asistencia PENDIENTE | Sin esto, check-in de no-admin no escribe |
| T-3 | “NO SE ENCONTRÓ TU USUARIO EN ESTA PLAZA” | Normalizar plaza en `getUsuariosPlaza`; mensajes separados índice vs pertenencia |
| T-4 | Roles operativos custom por plaza (CAPACITACIÓN, AEROPUERTO…) | Filas editables ≠ RBAC sistema; CHECADOR-style sections |
| T-5 | Guardado atómico por celda (evitar horarios corruptos) | P0 plan turnos |

**Fuera de este sprint operativo:** catálogo turnos con color completo, sync CHECADOR.

---

## 4. Backlog Obsidian — Flota / mapa / datos

| # | Fuente | Issue |
|---|--------|-------|
| F-1 | `(9)IDEAS` + `(11)` | Importador unidades CSV/XLS (prioridad ideas futuras) |
| F-2 | `(11)` | Export Excel/PDF/CSV de lo operativo (cuadre, reportes) |
| F-3 | `(11)` | Parser/reporte regresos estilo Optima (PDF) — si sigue siendo dolor del cliente |
| F-4 | `SUB PLAZAS` | Sub-plazas / mapas hijos heredan unidades/users/config de plaza madre |
| F-5 | `NUEVO EDITOR DE MAPA` | Editor más profesional (después de P0 mapa) |
| F-6 | `(3)PETICION DE UBICACION` | Pedir ubicación 1× por sesión (localStorage); bloquear UI si deniega; UI glass |
| F-7 | `(11)` Optima PDF | Solo si el cliente lo sigue pidiendo tras F-1/F-2 |

---

## 5. Estados y mapa — terminar lo empezado (complemento TSD)

Fuente: spec `2026-07-15-estados-flota-vs-patio-design.md` + memoria

### Ya hecho
- `estadoFlota` / `estadoPatio` + UI columnas + buscador chips + precheck contratos (hook)

### Pendiente operativo (sí, ahora)

| # | Tarea | Por qué es complemento TSD |
|---|--------|----------------------------|
| E-1 | QA + fixes de la UI de estados en cuadre/mapa real | TSD no ve patio; nosotros sí debemos verse claros |
| E-2 | Select de cambio en cuadre: solo estados **patio** (LISTO/SUCIO/…); acciones flota (NO ARRENDABLE/VENTA/TRASLADO) explícitas | Evitar mezclar otra vez |
| E-3 | Hidratar `estadoFlota` desde index en filas de cuadre cuando exista (no solo derivar) | Coherencia global ↔ patio |
| E-4 | Documentar para el equipo: flota = negocio, patio = operación | Onboarding operadores |
| E-5 | **Aplazar** comercial+custodia 4D completo | Es paso hacia RMS; no bloquea complemento |

Cola: Fase 3 (push turno, reservas) **después** de P0 Obsidian.

---

## 6. Orden de ejecución sugerido (semanas)

```text
Semana 1 — Estabilidad P0 Obsidian
  P0-1 alertas
  P0-2 insert duplicado / plazaActual
  P0-3 deep link buscador→mapa
  P0-4 controles cuadre
  Deploy: firestore indexes + rules (turnos/asistencia)

Semana 2 — Turnos operable
  T-3 usuarios plaza
  T-2/T-1 verificados en prod
  QA asistencia PENDIENTE → confirmar
  (si cabe) T-5 celdas atómicas

Semana 3 — Estados + cola polish
  E-1…E-4
  Cola: smoke sync LISTO + expediente badge
  Cuadre mobile smoke

Semana 4 — Datos flota
  F-1 importador CSV/XLS (MVP)
  F-2 export cuadre XLS/PDF básico
```

Luego: **B — pulir MVP complemento** (sub-plazas, editor mapa, roles operativos turnos).  
Solo después: retomar roadmap arrendamiento.

---

## 7. Definición de “complemento a TSD listo”

Una arrendadora puede:

1. Ver unidades en mapa/cuadre con **flota + patio + ubicación** claros.  
2. No duplicar inserts ni meter unidad de otra plaza.  
3. Buscar global → saltar al mapa con unidad resaltada.  
4. Preparar salidas en cola y reflejar LISTO en cuadre.  
5. Marcar asistencia al checar turno; admin confirma.  
6. Exportar/importar flota básica.  
7. Alertas confiables (estilo + leídas).

Si TSD (u otro) maneja contrato/cobro, MapGestion no lo compite todavía: **se integra por operación**.

---

## 8. Explicitamente NO hacer ahora

- Motor de tarifas / reservaciones / contratos / CFDI / pasarela  
- Reescritura Next/Nest/Postgres  
- 4D comercial+custodia completo (salvo que E-2 lo necesite mínimo)  
- Portal cliente / OTA / brokers  

Esas viven en el roadmap largo y no restan capacidad al patio.

---

## 9. Próxima acción concreta

1. Aprobar este orden.  
2. Empezar **P0-1 → P0-4** en ese orden (bugs Obsidian).  
3. En paralelo pedir deploy: `firebase deploy --only firestore:indexes,firestore:rules`.

---

## Changelog

| Fecha | Nota |
|-------|------|
| 2026-07-15 | Prioridad corregida: complemento TSD / flota primero; arrendamiento a 1+ año |
