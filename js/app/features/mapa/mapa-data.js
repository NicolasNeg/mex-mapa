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
    _emitData();
    _log(_debug, 'subscribe', { plaza: activePlaza, token });

    if (!activePlaza) {
      _snapshot.loading = false;
      _snapshot.error = 'No hay plaza activa para suscribir datos de mapa.';
      _emitData();
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
        if (ok) _emitData();
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
          if (ok) _emitData();
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
        if (ok) _emitData();
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

  return {
    subscribe,
    cleanup,
    setPlaza,
    getSnapshot,
    isActive
  };
}
