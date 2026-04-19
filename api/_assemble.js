// ═══════════════════════════════════════════════════════════
//  /api/_assemble.js  —  Ensambla window.api desde todos los módulos
//  Cargado ÚLTIMO, después de todos los /api/*.js
// ═══════════════════════════════════════════════════════════
(function () {
  const parts = window._mexParts || {};
  // Extend existing window.api (set by mex-api.js) so unmigrated functions survive.
  // New api/ modules take precedence over legacy mex-api.js for the same function name.
  window.api = Object.assign(
    window.api || {},
    parts.helpers  || {},
    parts.auth     || {},
    parts.mapa     || {},
    parts.cuadre   || {},
    parts.externos || {},
    parts.flota    || {},
    parts.alertas  || {},
    parts.notas    || {},
    parts.historial|| {},
    parts.settings || {},
    parts.users    || {}
  );

  // Función global de imagen de modelo (llamada directamente desde HTML en algunos lugares)
  window.obtenerUrlImagenModelo = function(modelo) {
    if (!modelo) return "";
    const IMAGENES_MODELOS = window.MEX_IMAGENES_MODELOS || {};
    const key = modelo.toString().trim().split(" ")[0].toLowerCase();
    for (const nombre in IMAGENES_MODELOS) { if (nombre.includes(key)) return IMAGENES_MODELOS[nombre]; }
    return "img/no-model.png";
  };

  if (typeof window._mex?._collectApiDiagnostics === 'function') {
    window.__mexApiDiagnostics = window._mex._collectApiDiagnostics(window.api);
    if (window.__mexApiDiagnostics.missing.length > 0) {
      console.warn('[MEX-API] Contrato incompleto:', window.__mexApiDiagnostics.missing.join(', '));
    }
  }

  try {
    window.dispatchEvent(new CustomEvent('mex:api-ready', {
      detail: { diagnostics: window.__mexApiDiagnostics || null }
    }));
  } catch (_) {}

  console.log('✅ [MEX-API] Firebase API lista con ' + Object.keys(window.api).length + ' funciones. Módulos: ' + Object.keys(parts).join(', '));
})();
