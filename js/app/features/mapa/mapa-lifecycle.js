import { createMapaDataController } from '/js/app/features/mapa/mapa-data.js';

function _safeUp(value) {
  return String(value || '').trim().toUpperCase();
}

function _isDebugEnabled() {
  try { return localStorage.getItem('mex.debug.mode') === '1'; } catch (_) { return false; }
}

function _log(...args) {
  if (!_isDebugEnabled()) return;
  console.log('[mapa-lifecycle]', ...args);
}

export function createMapaLifecycleController(ctx = {}) {
  let _mounted = false;
  let _paused = false;
  let _plaza = _safeUp(ctx.plaza || '');
  let _listeners = [];
  let _data = null;

  function _cleanupListeners() {
    _listeners.forEach(off => {
      try { off?.(); } catch (_) {}
    });
    _listeners = [];
  }

  function mount() {
    if (_mounted) return;
    _mounted = true;
    _paused = false;
    _data = createMapaDataController({
      plaza: _plaza,
      api: ctx.api,
      db: ctx.db,
      onData: ctx.onData,
      onError: ctx.onError,
      debug: ctx.debug
    });
    _data.subscribe();
    _log('mount', { plaza: _plaza });
  }

  function unmount() {
    if (!_mounted && !_data) return;
    _mounted = false;
    _paused = false;
    _cleanupListeners();
    try { _data?.cleanup?.(); } catch (_) {}
    _data = null;
    _log('unmount');
  }

  function setPlaza(nextPlaza) {
    _plaza = _safeUp(nextPlaza);
    if (_data) _data.setPlaza(_plaza);
    _log('setPlaza', { plaza: _plaza });
  }

  function pause() {
    if (_paused) return;
    _paused = true;
    try { _data?.cleanup?.(); } catch (_) {}
    _log('pause');
  }

  function resume() {
    if (!_mounted || !_paused) return;
    _paused = false;
    if (_data && !_data.isActive()) _data.subscribe();
    _log('resume', { plaza: _plaza });
  }

  function addManagedListener(off) {
    if (typeof off !== 'function') return;
    _listeners.push(off);
  }

  function getSnapshot() {
    return {
      mounted: _mounted,
      paused: _paused,
      plaza: _plaza,
      data: _data?.getSnapshot?.() || null
    };
  }

  return {
    mount,
    unmount,
    setPlaza,
    pause,
    resume,
    addManagedListener,
    getSnapshot
  };
}
