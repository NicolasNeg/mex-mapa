// ═══════════════════════════════════════════════════════════
//  /api/helpers.js  —  Helpers compartidos de queries y compat
//  Depende de: window._mex (expuesto por mex-api.js)
// ═══════════════════════════════════════════════════════════
(function () {
  const mex = window._mex || {};
  const { db, _normalizePlazaId } = mex;

  if (!db || typeof _normalizePlazaId !== 'function') {
    console.warn('[api/helpers.js] window._mex no está listo; se omite inicialización.');
    return;
  }

  function _normalizePositiveInt(value, fallback = null) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
  }

  function _applyQueryWheres(query, wheres = []) {
    return (Array.isArray(wheres) ? wheres : []).reduce((acc, clause) => {
      if (!Array.isArray(clause) || clause.length < 3) return acc;
      return acc.where(clause[0], clause[1], clause[2]);
    }, query);
  }

  function _applyQueryOrder(query, orderBy = null) {
    if (!orderBy || !orderBy.field) return query;
    const direction = String(orderBy.direction || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    return query.orderBy(orderBy.field, direction);
  }

  function _applyQueryLimit(query, limit = null) {
    const safeLimit = _normalizePositiveInt(limit, null);
    return safeLimit ? query.limit(safeLimit) : query;
  }

  function _buildCollectionQuery(collectionName, options = {}) {
    let query = db.collection(collectionName);
    query = _applyQueryWheres(query, options.wheres);
    query = _applyQueryOrder(query, options.orderBy);
    query = _applyQueryLimit(query, options.limit);
    return query;
  }

  function _buildPlazaScopedQuery(collectionName, plaza, options = {}) {
    const plazaUp = _normalizePlazaId(plaza);
    const wheres = Array.isArray(options.wheres) ? [...options.wheres] : [];
    if (plazaUp) wheres.unshift(['plaza', '==', plazaUp]);
    return _buildCollectionQuery(collectionName, { ...options, wheres });
  }

  function _isMissingIndexError(error) {
    const code = String(error?.code || '').trim().toLowerCase();
    const message = String(error?.message || '').toLowerCase();
    return code === 'failed-precondition' || message.includes('requires an index');
  }

  function _warnQueryFallback(label, error) {
    if (!_isMissingIndexError(error)) return;
    console.warn(`[${label}] Falta índice compuesto; usando fallback temporal legacy.`, error);
  }

  const REQUIRED_API_SURFACE = Object.freeze([
    'obtenerCredencialesMapa',
    'obtenerDatosParaMapa',
    'obtenerEstructuraMapa',
    'guardarEstructuraMapa',
    'guardarNuevasPosiciones',
    'aplicarEstado',
    'procesarModificacionMaestra',
    'obtenerCuadreAdminsData',
    'obtenerConfiguracion',
    'obtenerTodasLasNotas',
    'obtenerTodasLasAlertas',
    'obtenerMensajesPrivados',
    'enviarMensajePrivado',
    'modificarUsuario',
    'eliminarUsuario'
  ]);

  function _collectApiDiagnostics(api = window.api || {}) {
    const availableFunctions = Object.keys(api).sort();
    const missing = REQUIRED_API_SURFACE.filter(name => typeof api[name] !== 'function');
    return {
      generatedAt: Date.now(),
      loadedModules: Object.keys(window._mexParts || {}).sort(),
      availableFunctions,
      availableCount: availableFunctions.length,
      requiredSurface: [...REQUIRED_API_SURFACE],
      requiredCount: REQUIRED_API_SURFACE.length,
      missing,
      hasMexRuntime: Boolean(window._mex),
      hasApiObject: Boolean(window.api),
      hasFirebaseRuntime: Boolean(window.firebase)
    };
  }

  Object.assign(window._mex, {
    _normalizePositiveInt,
    _buildCollectionQuery,
    _buildPlazaScopedQuery,
    _isMissingIndexError,
    _warnQueryFallback,
    _collectApiDiagnostics,
    _requiredApiSurface: REQUIRED_API_SURFACE
  });

  window._mexParts = window._mexParts || {};
  window._mexParts.helpers = {
    obtenerDiagnosticoCompatibilidad() {
      return _collectApiDiagnostics(window.api || {});
    }
  };
})();
