// ═══════════════════════════════════════════════════════════
//  /js/core/estado-bridge.js
//  Expone window.mexEstados para scripts clásicos (mapa, buscador).
//  Fuente de verdad ES: /domain/estado.model.js — mantener en sync.
// ═══════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  var ESTADOS_FLOTA = Object.freeze([
    'ARRENDABLE', 'NO ARRENDABLE', 'EN RENTA', 'TRASLADO', 'VENTA', 'MANTENIMIENTO'
  ]);

  var ESTADOS_FLOTA_CERRADOS = Object.freeze(['EN RENTA', 'TRASLADO', 'VENTA']);

  var ESTADOS_PATIO_ARRENDABLES = Object.freeze(['LISTO', 'SUCIO', 'RESGUARDO']);

  var ESTADOS_PATIO = Object.freeze([
    'LISTO', 'SUCIO', 'MANTENIMIENTO', 'RESGUARDO',
    'TRASLADO', 'NO ARRENDABLE', 'RETENIDA', 'VENTA'
  ]);

  function normalizarEstadoPatio(valor) {
    var upper = String(valor || '').trim().toUpperCase();
    if (!upper) return null;
    if (ESTADOS_PATIO.indexOf(upper) !== -1 || upper === 'EXTERNO') return upper;
    return upper;
  }

  function normalizarEstadoFlota(valor) {
    var upper = String(valor || '').trim().toUpperCase();
    if (!upper) return null;
    if (upper === 'RENTADO' || upper === 'RENTADA') return 'EN RENTA';
    if (upper === 'DISPONIBLE' || upper === 'LIMPIO') return 'ARRENDABLE';
    if (ESTADOS_FLOTA.indexOf(upper) !== -1) return upper;
    return null;
  }

  function leerEstadoFlota(doc) {
    doc = doc || {};
    return normalizarEstadoFlota(doc.estadoFlota || doc.estado || doc.estatus);
  }

  function leerEstadoPatio(doc) {
    doc = doc || {};
    var patio = normalizarEstadoPatio(doc.estadoPatio || doc.estadoCuadre || null);
    if (patio) return patio;
    // Índice / merge: a veces solo viene `estado` del cuadre (LISTO/SUCIO…).
    var raw = doc.estado;
    if (raw && !normalizarEstadoFlota(raw)) {
      return normalizarEstadoPatio(raw);
    }
    return null;
  }

  function esFlotaCerrada(flota) {
    var f = normalizarEstadoFlota(flota);
    return !!(f && ESTADOS_FLOTA_CERRADOS.indexOf(f) !== -1);
  }

  function derivarFlotaDesdePatio(estadoPatio, flotaActual) {
    var patio = normalizarEstadoPatio(estadoPatio);
    var actual = normalizarEstadoFlota(flotaActual);
    if (esFlotaCerrada(actual)) return actual;
    if (!patio || patio === 'EXTERNO') return actual;
    if (ESTADOS_PATIO_ARRENDABLES.indexOf(patio) !== -1) return 'ARRENDABLE';
    if (patio === 'MANTENIMIENTO') return 'MANTENIMIENTO';
    if (patio === 'NO ARRENDABLE' || patio === 'RETENIDA') return 'NO ARRENDABLE';
    if (patio === 'TRASLADO') return 'TRASLADO';
    if (patio === 'VENTA') return 'VENTA';
    return actual;
  }

  /** Flota efectiva para display: index gana si está cerrada; si no, deriva del patio. */
  function resolverEstadoFlota(doc) {
    doc = doc || {};
    var flota = leerEstadoFlota(doc);
    var patio = leerEstadoPatio(doc) || normalizarEstadoPatio(doc.estado);
    if (esFlotaCerrada(flota)) return flota;
    if (patio) {
      var derived = derivarFlotaDesdePatio(patio, flota);
      return derived || flota || null;
    }
    return flota;
  }

  function evaluarListoParaContrato(opts) {
    opts = opts || {};
    var flota = normalizarEstadoFlota(opts.estadoFlota);
    var patio = normalizarEstadoPatio(opts.estadoPatio);
    var enCuadre = !!String(opts.plazaActual || '').trim();
    if (flota && flota !== 'ARRENDABLE') {
      return { ok: false, nivel: 'block', motivo: 'Estado flota: ' + flota };
    }
    if (!enCuadre) {
      return { ok: true, nivel: 'warn', motivo: 'Unidad no está en cuadre de plaza' };
    }
    if (patio === 'MANTENIMIENTO') {
      return { ok: false, nivel: 'block', motivo: 'Unidad en mantenimiento de patio' };
    }
    if (patio === 'SUCIO') {
      return { ok: true, nivel: 'warn', motivo: 'Unidad sucia — confirmar preparación' };
    }
    if (patio === 'LISTO') {
      return { ok: true, nivel: 'ok', motivo: '' };
    }
    if (patio === 'RESGUARDO') {
      return { ok: true, nivel: 'warn', motivo: 'Unidad en resguardo' };
    }
    return { ok: true, nivel: 'warn', motivo: patio ? ('Patio: ' + patio) : 'Sin estado de patio' };
  }

  /** HTML chips compactos para buscador / fichas. */
  function chipsHtml(doc, escFn) {
    escFn = escFn || function (v) {
      return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    };
    var flota = resolverEstadoFlota(doc);
    var patio = leerEstadoPatio(doc);
    // En cuadre el campo estado es patio; en index puede no haber estadoPatio aún.
    if (!patio && doc && doc.estado && !normalizarEstadoFlota(doc.estado)) {
      patio = normalizarEstadoPatio(doc.estado);
    }
    var parts = [];
    if (flota) {
      parts.push('<span class="mex-estado-chip mex-estado-chip--flota">' + escFn(flota) + '</span>');
    }
    if (patio && patio !== flota) {
      var slug = String(patio).replace(/\s+/g, '');
      parts.push('<span class="mex-estado-chip mex-estado-chip--patio st-' + escFn(slug) + '">' + escFn(patio) + '</span>');
    }
    return parts.join('');
  }

  global.mexEstados = {
    ESTADOS_FLOTA: ESTADOS_FLOTA,
    ESTADOS_PATIO: ESTADOS_PATIO,
    ESTADOS_FLOTA_CERRADOS: ESTADOS_FLOTA_CERRADOS,
    normalizarEstadoFlota: normalizarEstadoFlota,
    normalizarEstadoPatio: normalizarEstadoPatio,
    leerEstadoFlota: leerEstadoFlota,
    leerEstadoPatio: leerEstadoPatio,
    esFlotaCerrada: esFlotaCerrada,
    derivarFlotaDesdePatio: derivarFlotaDesdePatio,
    resolverEstadoFlota: resolverEstadoFlota,
    evaluarListoParaContrato: evaluarListoParaContrato,
    chipsHtml: chipsHtml
  };

  // Hook estable para contratos / renta futura.
  global.__mexPrecheckContrato = function (unidad) {
    return evaluarListoParaContrato({
      estadoFlota: resolverEstadoFlota(unidad || {}),
      estadoPatio: leerEstadoPatio(unidad || {}) || normalizarEstadoPatio((unidad || {}).estado),
      plazaActual: (unidad || {}).plazaActual || (unidad || {}).plaza || ''
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
