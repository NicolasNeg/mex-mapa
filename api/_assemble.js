// ═══════════════════════════════════════════════════════════
//  /api/_assemble.js  —  Ensambla window.api desde todos los módulos
//  Cargado ÚLTIMO, después de todos los /api/*.js
// ═══════════════════════════════════════════════════════════
(function () {
  const parts = window._mexParts || {};
  window.api = Object.assign(
    {},
    parts.auth     || {},
    parts.mapa     || {},
    parts.cuadre   || {},
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

  console.log('✅ [MEX-API] Firebase API lista con ' + Object.keys(window.api).length + ' funciones. Módulos: ' + Object.keys(parts).join(', '));
})();
