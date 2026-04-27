/**
 * DnD preview/persist para /app/mapa (App Shell).
 * Preview: sin escritura. Persistencia opcional vía callbacks (usa API legacy).
 *
 * Listeners en window solo durante un arrastre activo (o gesto pendiente).
 * Preview opcional solo pointer (sin touch) para reducir riesgo de scroll/bloqueos.
 */

import { sanitizeSpotToken } from '/js/app/features/mapa/mapa-view-model.js';

const MOVE_THRESHOLD_PX = 8;

function _now() {
  return Date.now();
}

function _normalizeToken(v) {
  return sanitizeSpotToken(String(v || ''));
}

export function createMapaDndController({
  root = null,
  getSnapshot = () => ({}),
  onMovePreview = null,
  onMoveCommit = null,
  canMove = () => false,
  /** Persistencia activa (flag + rol); si false solo preview simulado. */
  getPersistAllowed = () => false,
  /**
   * Persistencia controlada (confirmación + API). Debe resolver con { message, outcome }.
   */
  onPersistDrop = null,
  /** Si true (defecto), no se registran listeners touch en el root — solo mouse/pen vía PointerEvent. */
  pointerOnlyPreview = true,
  debug = false
} = {}) {
  let _root = root;
  let _enabled = false;
  let _mounted = false;

  let _pending = null;
  let _dragging = false;
  let _unitEl = null;
  let _ghost = null;
  let _activeZoneEl = null;
  let _suppressClickUntil = 0;

  const _log = (...args) => {
    if (!debug) return;
    console.log('[mapa-dnd]', ...args);
  };

  function _clearZoneHighlight() {
    if (_activeZoneEl?.classList) {
      _activeZoneEl.classList.remove('app-mapa-drop-hover', 'app-mapa-drop-invalid');
      if (_activeZoneEl.dataset) delete _activeZoneEl.dataset._dndCls;
    }
    _activeZoneEl = null;
  }

  /**
   * Solo celdas reales: [data-drop-cell="1"][data-cell-type="cajon"] dentro del root.
   */
  function _resolveDropZoneFromPoint(clientX, clientY) {
    const stack = document.elementsFromPoint(clientX, clientY) || [];
    for (const el of stack) {
      if (!(el instanceof Element)) continue;
      const zone = el.closest?.('[data-drop-cell="1"]');
      if (!zone || !_root?.contains?.(zone)) continue;
      if (String(zone.getAttribute('data-cell-type') || '').toLowerCase() !== 'cajon') continue;
      return zone;
    }
    return null;
  }

  function _classifyZone(zoneEl) {
    if (!zoneEl) return 'none';
    if (String(zoneEl.getAttribute('data-drop-cell') || '') !== '1') return 'invalid';
    if (String(zoneEl.getAttribute('data-cell-type') || '').toLowerCase() !== 'cajon') return 'invalid';
    if (zoneEl.classList.contains('is-blocked')) return 'blocked';
    return 'ok';
  }

  function _highlightZone(zoneEl) {
    const cls = _classifyZone(zoneEl);
    if (_activeZoneEl === zoneEl && _activeZoneEl?.dataset?._dndCls === cls) return;
    _clearZoneHighlight();
    if (!zoneEl || cls === 'none') return;
    _activeZoneEl = zoneEl;
    _activeZoneEl.dataset._dndCls = cls;
    if (cls === 'ok') zoneEl.classList.add('app-mapa-drop-hover');
    else zoneEl.classList.add('app-mapa-drop-invalid');
  }

  function _removeGhost() {
    if (_ghost?.isConnected) _ghost.remove();
    _ghost = null;
  }

  function _createGhost(label) {
    _removeGhost();
    const ghost = document.createElement('div');
    ghost.className = 'app-mapa-dnd-ghost';
    ghost.textContent = String(label || 'UNIDAD');
    document.body.appendChild(ghost);
    _ghost = ghost;
  }

  function _positionGhost(clientX, clientY) {
    if (!_ghost) return;
    _ghost.style.left = `${clientX + 12}px`;
    _ghost.style.top = `${clientY + 12}px`;
  }

  function _removeWindowPointerListeners() {
    window.removeEventListener('pointermove', _onWindowPointerMove, true);
    window.removeEventListener('pointerup', _onWindowPointerEnd, true);
    window.removeEventListener('pointercancel', _onWindowPointerEnd, true);
  }

  function _removeWindowTouchListeners() {
    window.removeEventListener('touchmove', _onWindowTouchMove, { capture: true });
    window.removeEventListener('touchend', _onWindowTouchEnd, { capture: true });
    window.removeEventListener('touchcancel', _onWindowTouchEnd, { capture: true });
  }

  function _cleanupDragVisuals() {
    _clearZoneHighlight();
    _removeGhost();
    if (_unitEl) _unitEl.classList.remove('is-drag-origin');
    _unitEl = null;
    _dragging = false;
  }

  function _readUnitContext(el) {
    if (!el) return null;
    const mva = String(el.getAttribute('data-mva') || '').trim();
    const unitId = String(el.getAttribute('data-unit-id') || '').trim();
    const currentCell = String(el.getAttribute('data-current-cell') || '').trim();
    const pos = String(el.getAttribute('data-current-position') || '').trim();
    if (!mva && !unitId) return null;
    return {
      mva: mva || unitId,
      unitId,
      currentCell,
      pos,
      positionKey: _normalizeToken(pos || currentCell)
    };
  }

  function _readZoneContext(zoneEl) {
    if (!zoneEl) return null;
    if (_classifyZone(zoneEl) !== 'ok') return null;
    const zone = String(zoneEl.getAttribute('data-zone') || '').trim();
    const cellId = String(zoneEl.getAttribute('data-cell-id') || '').trim();
    const positionKey = String(zoneEl.getAttribute('data-position') || '').trim();
    const label = String(zoneEl.getAttribute('data-zone-label') || zone || '').trim();
    return { zone, label, cellId, positionKey: _normalizeToken(positionKey) };
  }

  function _emitPreview(payload) {
    if (typeof onMovePreview === 'function') {
      try { onMovePreview(payload); } catch (_) { /* noop */ }
    }
    if (typeof onMoveCommit === 'function') {
      try { onMoveCommit(payload); } catch (_) { /* noop */ }
    }
    _log('preview', payload);
  }

  function _finishInteraction(commitPreview) {
    _removeWindowPointerListeners();
    _removeWindowTouchListeners();
    _cleanupDragVisuals();
    _pending = null;
    if (commitPreview) {
      _suppressClickUntil = _now() + 450;
    }
  }

  function _startDrag(unitEl, clientX, clientY) {
    _dragging = true;
    _unitEl = unitEl;
    _unitEl.classList.add('is-drag-origin');
    const ctx = _readUnitContext(_unitEl);
    _createGhost(ctx?.mva || 'UNIDAD');
    _positionGhost(clientX, clientY);
    _highlightZone(_resolveDropZoneFromPoint(clientX, clientY));
  }

  function _onWindowPointerMove(event) {
    if (!_pending && !_dragging) return;

    const pid = _pending?.pointerId;
    if (pid != null && event.pointerId !== pid) return;

    if (_pending && !_dragging) {
      const dx = event.clientX - _pending.startX;
      const dy = event.clientY - _pending.startY;
      if (Math.hypot(dx, dy) < MOVE_THRESHOLD_PX) return;
      _startDrag(_pending.unit, event.clientX, event.clientY);
    }

    if (!_dragging) return;
    event.preventDefault();
    _positionGhost(event.clientX, event.clientY);
    const zone = _resolveDropZoneFromPoint(event.clientX, event.clientY);
    if (!zone) {
      _clearZoneHighlight();
      return;
    }
    _highlightZone(zone);
  }

  async function _completeDrag(clientX, clientY) {
    const fromCtx = _readUnitContext(_unitEl);
    const rawZone = _resolveDropZoneFromPoint(clientX, clientY);
    const cls = _classifyZone(rawZone);

    if (!fromCtx) {
      _emitPreview({ message: 'No se pudo leer la unidad.', outcome: 'error' });
      _finishInteraction(false);
      return;
    }

    if (!rawZone || cls === 'none') {
      _emitPreview({
        from: fromCtx,
        to: null,
        snapshot: typeof getSnapshot === 'function' ? getSnapshot() : null,
        message: 'Destino no válido: suelta solo sobre celdas cajón de la estructura.',
        outcome: 'invalid-target'
      });
      _finishInteraction(true);
      return;
    }

    if (cls === 'blocked') {
      _emitPreview({
        from: fromCtx,
        to: _readZoneContext(rawZone),
        snapshot: typeof getSnapshot === 'function' ? getSnapshot() : null,
        message: 'Cajón bloqueado — no se simula guardado en producción.',
        outcome: 'blocked'
      });
      _finishInteraction(true);
      return;
    }

    if (cls === 'invalid') {
      _emitPreview({
        from: fromCtx,
        to: null,
        snapshot: typeof getSnapshot === 'function' ? getSnapshot() : null,
        message: 'Destino no válido: solo celdas tipo cajón del mapa.',
        outcome: 'invalid-target'
      });
      _finishInteraction(true);
      return;
    }

    const toCtx = _readZoneContext(rawZone);
    const destKey = toCtx?.positionKey || '';
    const originKey = fromCtx.positionKey || _normalizeToken(fromCtx.pos);
    const sameCell = Boolean(destKey && originKey && destKey === originKey);

    if (sameCell) {
      _emitPreview({
        from: fromCtx,
        to: toCtx,
        snapshot: typeof getSnapshot === 'function' ? getSnapshot() : null,
        message: 'Misma celda — preview sin cambios. No se guardó en producción.',
        outcome: 'same-cell'
      });
      _finishInteraction(true);
      return;
    }

    const persistOn =
      typeof getPersistAllowed === 'function' &&
      getPersistAllowed() &&
      typeof onPersistDrop === 'function';

    if (persistOn) {
      _removeWindowPointerListeners();
      _removeWindowTouchListeners();
      _cleanupDragVisuals();
      _pending = null;
      try {
        const result = await onPersistDrop({
          fromCtx,
          toCtx,
          originKey,
          destKey,
          snapshot: typeof getSnapshot === 'function' ? getSnapshot() : null
        });
        _emitPreview({
          from: fromCtx,
          to: toCtx,
          snapshot: typeof getSnapshot === 'function' ? getSnapshot() : null,
          message: result?.message || '',
          outcome: result?.outcome || 'persist'
        });
      } catch (err) {
        _emitPreview({
          message: String(err?.message || err || 'Error al persistir.'),
          outcome: 'error'
        });
      }
      _suppressClickUntil = _now() + 450;
      return;
    }

    _emitPreview({
      from: fromCtx,
      to: toCtx,
      snapshot: typeof getSnapshot === 'function' ? getSnapshot() : null,
      message: 'Movimiento simulado. No se guardó en producción.',
      outcome: 'simulated'
    });
    _finishInteraction(true);
  }

  function _onWindowPointerEnd(event) {
    const pid = _pending?.pointerId;
    if (pid != null && event.pointerId !== pid) return;

    if (_dragging) {
      event.preventDefault();
      void _completeDrag(event.clientX, event.clientY);
      return;
    }

    _finishInteraction(false);
  }

  function _findTouch(list, id) {
    if (!list || id == null) return null;
    return Array.from(list).find(t => t.identifier === id) || null;
  }

  function _onWindowTouchMove(event) {
    if (!_pending?.isTouch || !_pending.touchId) return;

    const touch =
      _findTouch(event.touches, _pending.touchId)
      || _findTouch(event.changedTouches, _pending.touchId);
    if (!touch) return;

    if (_pending && !_dragging) {
      const dx = touch.clientX - _pending.startX;
      const dy = touch.clientY - _pending.startY;
      if (Math.hypot(dx, dy) < MOVE_THRESHOLD_PX) return;
      _startDrag(_pending.unit, touch.clientX, touch.clientY);
    }

    if (!_dragging) return;
    event.preventDefault();
    _positionGhost(touch.clientX, touch.clientY);
    const zone = _resolveDropZoneFromPoint(touch.clientX, touch.clientY);
    if (!zone) {
      _clearZoneHighlight();
      return;
    }
    _highlightZone(zone);
  }

  function _onWindowTouchEnd(event) {
    if (!_pending?.isTouch || !_pending.touchId) return;

    const touch = _findTouch(event.changedTouches, _pending.touchId);
    if (!touch) {
      _finishInteraction(false);
      return;
    }

    if (_dragging) {
      event.preventDefault();
      void _completeDrag(touch.clientX, touch.clientY);
      return;
    }

    _finishInteraction(false);
  }

  function _onRootPointerDown(event) {
    if (!_mounted || !_enabled || !canMove()) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;

    const unit = event.target?.closest?.('[data-dnd-unit="1"]');
    if (!unit || !_root?.contains?.(unit)) return;

    _finishInteraction(false);
    _pending = {
      pointerId: event.pointerId,
      unit,
      startX: event.clientX,
      startY: event.clientY,
      isTouch: false
    };

    window.addEventListener('pointermove', _onWindowPointerMove, true);
    window.addEventListener('pointerup', _onWindowPointerEnd, true);
    window.addEventListener('pointercancel', _onWindowPointerEnd, true);
  }

  function _onRootTouchStart(event) {
    if (pointerOnlyPreview) return;
    if (!_mounted || !_enabled || !canMove()) return;
    if (window.PointerEvent) return;
    if (event.touches?.length !== 1) return;

    const touch = event.touches[0];
    const unit = event.target?.closest?.('[data-dnd-unit="1"]');
    if (!unit || !_root?.contains?.(unit)) return;

    _finishInteraction(false);
    _pending = {
      touchId: touch.identifier,
      unit,
      startX: touch.clientX,
      startY: touch.clientY,
      isTouch: true
    };

    window.addEventListener('touchmove', _onWindowTouchMove, { capture: true, passive: false });
    window.addEventListener('touchend', _onWindowTouchEnd, { capture: true, passive: false });
    window.addEventListener('touchcancel', _onWindowTouchEnd, { capture: true, passive: false });
  }

  function mount(rootEl) {
    unmount();
    _root = rootEl || _root;
    if (!_root) return;
    _mounted = true;
    _root.addEventListener('pointerdown', _onRootPointerDown, true);
    if (!pointerOnlyPreview && !window.PointerEvent) {
      _root.addEventListener('touchstart', _onRootTouchStart, { passive: false, capture: true });
    }
    _log('mount', { pointerOnlyPreview });
  }

  function unmount() {
    _finishInteraction(false);
    if (_root) {
      _root.removeEventListener('pointerdown', _onRootPointerDown, true);
      if (!pointerOnlyPreview && !window.PointerEvent) {
        _root.removeEventListener('touchstart', _onRootTouchStart, {
          capture: true,
          passive: false
        });
      }
    }
    _mounted = false;
    _root = null;
    _log('unmount');
  }

  function enable() {
    _enabled = true;
  }

  function disable() {
    _enabled = false;
    _finishInteraction(false);
  }

  function isEnabled() {
    return _enabled;
  }

  function shouldSuppressClick() {
    return _now() < _suppressClickUntil;
  }

  return {
    mount,
    unmount,
    enable,
    disable,
    isEnabled,
    shouldSuppressClick,
    setRoot(el) {
      _root = el;
    }
  };
}
