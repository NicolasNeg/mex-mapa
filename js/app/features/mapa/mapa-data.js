import { db as defaultDb, COL } from '/js/core/database.js';

function _safeText(value) {
  return String(value || '').trim();
}

function _safeUp(value) {
  return _safeText(value).toUpperCase();
}

function _isDebugEnabled(explicit) {
  if (typeof explicit === 'boolean') return explicit;
  try { return localStorage.getItem('mex.debug.mode') === '1'; } catch (_) { return false; }
}

function _log(debug, ...args) {
  if (!debug) return;
  console.log('[mapa-data]', ...args);
}

function _isPermissionDenied(error) {
  return String(error?.code || '').toLowerCase() === 'permission-denied';
}

function _isMissingIndex(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code === 'failed-precondition' || message.includes('requires an index');
}

function _toRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.unidades)) return payload.unidades;
  return [];
}

function _cacheKey(plaza) {
  return `mex.app.mapa.visible-snapshot.${_safeUp(plaza)}`;
}

function _readVisibleCache(plaza) {
  try {
    const raw = localStorage.getItem(_cacheKey(plaza)) || sessionStorage.getItem(_cacheKey(plaza));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.units) || !Array.isArray(parsed.structure)) return null;
    const age = Date.now() - Number(parsed.savedAt || 0);
    if (age > 1000 * 60 * 60 * 12) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function _writeVisibleCache(snapshot) {
  try {
    const plaza = _safeUp(snapshot?.plaza);
    if (!plaza) return;
    const units = Array.isArray(snapshot.units) ? snapshot.units : [];
    const structure = Array.isArray(snapshot.structure) ? snapshot.structure : [];
    if (!units.length && !structure.length) return;
    const payload = JSON.stringify({
      savedAt: Date.now(),
      plaza,
      lastUpdated: Number(snapshot.lastUpdated || Date.now()),
      units: units.slice(0, 900),
      structure: structure.slice(0, 1200)
    });
    localStorage.setItem(_cacheKey(plaza), payload);
    sessionStorage.setItem(_cacheKey(plaza), payload);
  } catch (_) {}
}

function _isLocalQaAuthBypassEnabled() {
  try {
    const host = window.location.hostname;
    const localHost = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
    return localHost && (window.__MEX_QA_AUTH_BYPASS === true || localStorage.getItem('mex.qa.authBypass') === '1');
  } catch (_) {
    return false;
  }
}

function _qaDemoStructure() {
  const spots = [];
  for (let i = 1; i <= 12; i += 1) {
    spots.push({
      valor: `A-${String(i).padStart(2, '0')}`,
      tipo: 'cajon',
      orden: i,
      zone: 'PATIO A',
      width: 120,
      height: 80
    });
  }
  return [
    { valor: 'PATIO A', tipo: 'label', esLabel: true, orden: 0 },
    ...spots,
    { valor: 'TALLER', tipo: 'label', esLabel: true, orden: 90 }
  ];
}

function _qaDemoUnits(plaza) {
  return [
    { id: 'qa-001', mva: 'QA001', modelo: 'VERSA', placas: 'QA-001', estado: 'LISTO', gasolina: '3/4', ubicacion: 'PATIO', pos: 'A-01', plaza, categoria: 'COMPACTO', notas: 'Unidad demo para revisar layout App Shell.' },
    { id: 'qa-002', mva: 'QA002', modelo: 'AVEO', placas: 'QA-002', estado: 'SUCIO', gasolina: '1/2', ubicacion: 'PATIO', pos: 'A-02', plaza, categoria: 'COMPACTO', notas: 'Requiere lavado.' },
    { id: 'qa-003', mva: 'QA003', modelo: 'RIO', placas: 'QA-003', estado: 'MANTENIMIENTO', gasolina: '1/4', ubicacion: 'TALLER', pos: 'LIMBO', plaza, categoria: 'COMPACTO', notas: 'Demo taller.' },
    { id: 'qa-004', mva: 'QA004', modelo: 'EXTERNO', placas: 'QA-004', estado: 'EXTERNO', gasolina: 'N/A', ubicacion: 'EXTERNO', pos: 'LIMBO', plaza, tipo: 'externo', categoria: 'EXTERNO', notas: 'Demo externo.' }
  ];
}

export function createMapaDataController({
  plaza = '',
  api = window.api || null,
  db = defaultDb,
  onData = null,
  onError = null,
  debug = undefined
} = {}) {
  let _active = false;
  let _token = 0;
  let _unsubs = [];
  let _snapshot = {
    plaza: _safeUp(plaza),
    loading: false,
    permissionDenied: false,
    missingIndex: false,
    error: '',
    units: [],
    structure: [],
    lastUpdated: 0
  };
  const _debug = _isDebugEnabled(debug);

  function _emitData() {
    if (typeof onData !== 'function') return;
    try { onData(getSnapshot()); } catch (_) {}
  }

  function _emitError(error) {
    if (typeof onError !== 'function') return;
    try { onError(error, getSnapshot()); } catch (_) {}
  }

  function _resetRuntimeState(nextPlaza) {
    _snapshot = {
      plaza: _safeUp(nextPlaza),
      loading: false,
      permissionDenied: false,
      missingIndex: false,
      error: '',
      units: [],
      structure: [],
      lastUpdated: 0
    };
  }

  function _closeAllUnsubs() {
    _unsubs.forEach(unsub => {
      try { unsub?.(); } catch (_) {}
    });
    _unsubs = [];
  }

  function _guardedUpdate(token, updater) {
    if (!_active || token !== _token) return false;
    updater();
    _snapshot.lastUpdated = Date.now();
    return true;
  }

  function subscribe() {
    if (_active) return;
    _active = true;
    _token += 1;
    const token = _token;
    const activePlaza = _safeUp(_snapshot.plaza);
    _snapshot.loading = true;
    _snapshot.error = '';
    _snapshot.permissionDenied = false;
    _snapshot.missingIndex = false;
    const cached = _readVisibleCache(activePlaza);
    if (cached) {
      _snapshot.units = cached.units || [];
      _snapshot.structure = cached.structure || [];
      _snapshot.lastUpdated = Number(cached.lastUpdated || cached.savedAt || Date.now());
    }
    _emitData();
    _log(_debug, 'subscribe', { plaza: activePlaza, token });

    if (!activePlaza) {
      _snapshot.loading = false;
      _snapshot.error = 'No hay plaza activa para suscribir datos de mapa.';
      _emitData();
      return;
    }

    if (_isLocalQaAuthBypassEnabled()) {
      window.setTimeout(() => {
        const ok = _guardedUpdate(token, () => {
          _snapshot.loading = false;
          _snapshot.error = '';
          _snapshot.permissionDenied = false;
          _snapshot.missingIndex = false;
          _snapshot.units = _qaDemoUnits(activePlaza);
          _snapshot.structure = _qaDemoStructure();
        });
        if (ok) _emitData();
      }, 120);
      return;
    }

    if (typeof api?.suscribirMapaPlaza === 'function') {
      const unsubMapa = api.suscribirMapaPlaza(activePlaza, payload => {
        const rows = _toRows(payload);
        const ok = _guardedUpdate(token, () => {
          _snapshot.loading = false;
          _snapshot.error = '';
          _snapshot.permissionDenied = false;
          _snapshot.missingIndex = false;
          _snapshot.units = rows;
        });
        if (ok) {
          _writeVisibleCache(_snapshot);
          _emitData();
        }
      });
      if (typeof unsubMapa === 'function') _unsubs.push(unsubMapa);
    } else if (db) {
      const unsubCuadre = db.collection(COL.CUADRE).where('plaza', '==', activePlaza).onSnapshot(
        snap => {
          const rows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          const ok = _guardedUpdate(token, () => {
            _snapshot.loading = false;
            _snapshot.error = '';
            _snapshot.permissionDenied = false;
            _snapshot.missingIndex = false;
            _snapshot.units = rows;
          });
          if (ok) {
            _writeVisibleCache(_snapshot);
            _emitData();
          }
        },
        err => _handleError(token, err)
      );
      _unsubs.push(unsubCuadre);
    }

    if (typeof api?.suscribirEstructuraMapa === 'function') {
      const unsubEstructura = api.suscribirEstructuraMapa(rows => {
        const ok = _guardedUpdate(token, () => {
          _snapshot.structure = Array.isArray(rows) ? rows : [];
        });
        if (ok) {
          _writeVisibleCache(_snapshot);
          _emitData();
        }
      }, activePlaza);
      if (typeof unsubEstructura === 'function') _unsubs.push(unsubEstructura);
    }
  }

  function _handleError(token, error) {
    const ok = _guardedUpdate(token, () => {
      _snapshot.loading = false;
      _snapshot.permissionDenied = _isPermissionDenied(error);
      _snapshot.missingIndex = _isMissingIndex(error);
      _snapshot.error = _safeText(error?.message) || 'Error de datos del mapa.';
    });
    if (!ok) return;
    _log(_debug, 'error', {
      plaza: _snapshot.plaza,
      permissionDenied: _snapshot.permissionDenied,
      missingIndex: _snapshot.missingIndex,
      message: _snapshot.error
    });
    _emitError(error);
    _emitData();
  }

  function cleanup() {
    if (!_active && _unsubs.length === 0) return;
    _log(_debug, 'cleanup', { plaza: _snapshot.plaza, token: _token });
    _active = false;
    _token += 1;
    _closeAllUnsubs();
    _snapshot.loading = false;
  }

  function setPlaza(nextPlaza) {
    const normalized = _safeUp(nextPlaza);
    if (normalized === _snapshot.plaza) return;
    const wasActive = _active;
    cleanup();
    _resetRuntimeState(normalized);
    if (wasActive) subscribe();
  }

  function getSnapshot() {
    return {
      ..._snapshot,
      units: [..._snapshot.units],
      structure: [..._snapshot.structure],
      active: _active
    };
  }

  function isActive() {
    return _active;
  }

  /** Reinicia listeners (útil si el snapshot parece desactualizado tras persistencia). */
  function resync() {
    const p = _safeUp(_snapshot.plaza);
    _log(_debug, 'resync', { plaza: p });
    cleanup();
    _resetRuntimeState(p);
    subscribe();
  }

  /**
   * Una lectura puntual de flota para revalidar ocupación antes de persistir (evita snapshot obsoleto).
   */
  async function fetchFreshUnitsForValidation() {
    const plazaUp = _safeUp(_snapshot.plaza);
    if (!plazaUp) return null;
    if (typeof api?.obtenerDatosFlotaConsola !== 'function') return null;
    try {
      const list = await api.obtenerDatosFlotaConsola(plazaUp);
      return Array.isArray(list) ? list : null;
    } catch (err) {
      _log(_debug, 'fetchFreshUnitsForValidation:error', err?.message || err);
      return null;
    }
  }

  return {
    subscribe,
    cleanup,
    setPlaza,
    getSnapshot,
    isActive,
    resync,
    fetchFreshUnitsForValidation
  };
}
