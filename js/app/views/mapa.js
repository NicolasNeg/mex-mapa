import { getState, onPlazaChange, subscribe } from '/js/app/app-state.js';
import { esGlobal } from '/domain/permissions.model.js';
import { createMapaLifecycleController } from '/js/app/features/mapa/mapa-lifecycle.js';
import { createMapaDndController } from '/js/app/features/mapa/mapa-dnd.js';
import {
  persistDebug,
  persistUnitMove,
  validatePersistMove
} from '/js/app/features/mapa/mapa-mutations.js';
import { sanitizeSpotToken } from '/js/app/features/mapa/mapa-view-model.js';
import { renderMapaReadOnly, renderErrorState } from '/js/app/features/mapa/mapa-renderer.js';

let _container = null;
let _contentEl = null;
let _lifecycle = null;
let _dndController = null;
let _offPlaza = null;
let _offGlobalSearch = null;
let _offState = null;
let _onClick = null;
let _toolbarHandler = null;
let _cssRef = null;
let _dndHintEl = null;
let _lastDndEligibility = null;
/** @type {{ mva: string, originKey: string, destKey: string, at: number, user: string } | null} */
let _lastPersistSummary = null;
let _viewState = {
  query: '',
  selectedId: '',
  snapshot: null
};

function _readUrlQuery() {
  try {
    return String(new URLSearchParams(window.location.search).get('q') || '').trim();
  } catch (_) {
    return '';
  }
}

let _offPopstate = null;

function _readAppMapaDndFlag() {
  try {
    return localStorage.getItem('mex.appMapa.dnd') === '1';
  } catch (_) {
    return false;
  }
}

function _readAppMapaDndPersistFlag() {
  try {
    return localStorage.getItem('mex.appMapa.dndPersist') === '1';
  } catch (_) {
    return false;
  }
}

/** Roles que no deben tener preview ni persistencia DnD App Shell (incl. operación y auxiliares). */
const _DND_PREVIEW_DENIED = new Set([
  'CORPORATIVO_USER',
  'JEFE_OPERACION',
  'AUXILIAR',
  'OPERACION'
]);

/**
 * Quién puede usar DnD preview: PROGRAMADOR, o cuenta admin global (Firestore isAdmin + esGlobal),
 * excluyendo CORPORATIVO_USER y JEFE_OPERACION explícitamente.
 */
function _canRolePreviewDnd(state) {
  const r = String(state?.role || '').toUpperCase();
  if (_DND_PREVIEW_DENIED.has(r)) return false;
  if (r === 'PROGRAMADOR') return true;
  const p = state?.profile || {};
  return Boolean(p.isAdmin === true && esGlobal(r));
}

/** Requiere al menos un cajón en la estructura cargada (mapa_config). */
function _hasCajonStructure(snapshot) {
  const rows = snapshot?.structure;
  if (!Array.isArray(rows) || !rows.length) return false;
  return rows.some(raw => {
    const t = String(raw?.tipo || '').toLowerCase();
    return t === 'cajon' && raw?.esLabel !== true;
  });
}

/**
 * Flag localStorage + rol + estructura real; decide badge, data-dnd y montaje del controller.
 * Sin estructura de cajones → sin DnD aunque el flag esté en "1".
 */
function _dndFullyEnabled(state, snapshot) {
  return _readAppMapaDndFlag() && _canRolePreviewDnd(state) && _hasCajonStructure(snapshot);
}

/** Persistencia: además del preview, flag localStorage + mismo gate de rol + estructura. */
function _dndPersistFullyEnabled(state, snapshot) {
  return (
    _dndFullyEnabled(state, snapshot) &&
    _readAppMapaDndPersistFlag() &&
    _canRolePreviewDnd(state)
  );
}

function _actorName() {
  const p = getState().profile || {};
  return String(p.nombreCompleto || p.nombre || p.email || p.usuario || 'AppShell').trim() || 'AppShell';
}

function _spotTok(v) {
  return sanitizeSpotToken(String(v || ''));
}

function _removeMapaModals() {
  _container?.querySelectorAll?.('.app-mapa-modal-overlay')?.forEach(el => el.remove());
}

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function _waitSnapshotReflectsMove(mva, destKey, timeoutMs = 4800) {
  const want = _spotTok(destKey);
  const mv = String(mva || '').toUpperCase();
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const data = _lifecycle?.getSnapshot?.()?.data;
    const u = data?.units?.find(x => String(x?.mva || '').toUpperCase() === mv);
    if (u && _spotTok(u.pos || 'LIMBO') === want) return true;
    await _sleep(260);
  }
  return false;
}

function _snapshotShowsMove(mva, destKey) {
  const data = _lifecycle?.getSnapshot?.()?.data;
  const mv = String(mva || '').toUpperCase();
  const u = data?.units?.find(x => String(x?.mva || '').toUpperCase() === mv);
  return Boolean(u && _spotTok(u.pos || 'LIMBO') === _spotTok(destKey));
}

function _betaModeLabel(state, snapshot) {
  const ro = !_dndFullyEnabled(state, snapshot);
  if (ro) return 'Solo lectura';
  if (!_readAppMapaDndPersistFlag()) return 'DnD vista previa';
  if (_dndPersistFullyEnabled(state, snapshot)) return 'DnD persistente (experimental)';
  return 'DnD vista previa';
}

function _fmtShort(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'medium' });
  } catch (_) {
    return '—';
  }
}

function _updateMetaLines() {
  const syncEl = _container?.querySelector('#app-mapa-sync-line');
  const moveEl = _container?.querySelector('#app-mapa-last-move');
  const snap = _viewState.snapshot;
  const lu = snap?.lastUpdated;
  if (syncEl) {
    syncEl.textContent = lu
      ? `Última sincronización de datos: ${_fmtShort(lu)}`
      : 'Última sincronización de datos: —';
  }
  if (moveEl) {
    if (_lastPersistSummary) {
      const s = _lastPersistSummary;
      moveEl.textContent = `Último guardado: ${s.mva} · ${s.originKey}→${s.destKey} · ${_fmtShort(s.at)} · ${s.user}`;
      moveEl.hidden = false;
    } else {
      moveEl.textContent = '';
      moveEl.hidden = true;
    }
  }
}

function _updateExperimentalResetBtn() {
  const btn = _container?.querySelector('[data-app-mapa-action="clear-experimental"]');
  if (!btn) return;
  btn.style.display = _canRolePreviewDnd(getState()) ? 'inline-flex' : 'none';
}

function _updateBetaBanner() {
  const el = _container?.querySelector('#app-mapa-beta-state');
  if (!el) return;
  const snap = _viewState.snapshot;
  el.textContent = _betaModeLabel(getState(), snap);
}

function _updatePlazaHeader(plazaValue = '') {
  const el = _container?.querySelector('#app-mapa-plaza-active');
  if (!el) return;
  const safe = String(plazaValue || '').trim().toUpperCase();
  el.textContent = safe || '—';
}

function _showPersistConfirm({ mva, fromKey, toKey }) {
  return new Promise(resolve => {
    if (!_container) {
      resolve(false);
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'app-mapa-modal-overlay';
    wrap.setAttribute('role', 'dialog');
    wrap.innerHTML = `
      <div class="app-mapa-modal">
        <p class="app-mapa-modal-title">Confirmar movimiento</p>
        <p class="app-mapa-modal-body">¿Mover unidad <strong>${esc(mva)}</strong> de <strong>${esc(fromKey)}</strong> a <strong>${esc(toKey)}</strong>?</p>
        <div class="app-mapa-modal-actions">
          <button type="button" class="app-mapa-modal-btn app-mapa-modal-btn--ghost" data-act="cancel">Cancelar</button>
          <button type="button" class="app-mapa-modal-btn app-mapa-modal-btn--primary" data-act="ok">Confirmar movimiento</button>
        </div>
      </div>`;
    const done = ok => {
      wrap.remove();
      resolve(ok);
    };
    wrap.addEventListener('click', e => {
      if (e.target === wrap) done(false);
    });
    wrap.querySelector('[data-act="cancel"]')?.addEventListener('click', () => done(false));
    wrap.querySelector('[data-act="ok"]')?.addEventListener('click', () => done(true));
    _container.appendChild(wrap);
  });
}

export function mount({ container }) {
  _container = container;
  _ensureCss();
  const state = getState();
  const plaza = String(state.currentPlaza || state.profile?.plazaAsignada || '').toUpperCase();
  _viewState = { query: _readUrlQuery(), selectedId: '', snapshot: null };

  _container.innerHTML = `
    <section class="app-mapa-view">
      <div class="app-mapa-beta-banner" id="app-mapa-beta-banner">
        <span class="app-mapa-beta-banner-title">Mapa App Shell · Beta</span>
        <span class="app-mapa-beta-banner-state" id="app-mapa-beta-state">${esc(_betaModeLabel(state, null))}</span>
        <div class="app-mapa-meta-lines" aria-live="polite">
          <div id="app-mapa-sync-line" class="app-mapa-meta-line"></div>
          <div id="app-mapa-last-move" class="app-mapa-meta-line app-mapa-meta-line--persist" hidden></div>
        </div>
      </div>
      <header class="app-mapa-head">
        <div>
          <span class="app-mapa-badge">Vista App Shell experimental</span>
          <span id="app-mapa-dnd-badge" class="app-mapa-badge app-mapa-badge-dnd" style="display:${_dndFullyEnabled(state, null) ? 'inline-flex' : 'none'}">DnD experimental (preview)</span>
          <span id="app-mapa-persist-badge" class="app-mapa-badge app-mapa-badge-persist" style="display:${_dndPersistFullyEnabled(state, null) ? 'inline-flex' : 'none'}">DnD persistencia (experimental)</span>
          <h1>Mapa operativo</h1>
          <p>Plaza activa: <strong id="app-mapa-plaza-active">${esc(plaza || '—')}</strong></p>
        </div>
        <a class="app-mapa-cta" href="/mapa">Abrir mapa completo (legacy)</a>
      </header>
      <div class="app-mapa-toolbar" role="toolbar" aria-label="Acciones mapa beta">
        <button type="button" class="app-mapa-tool-btn" data-app-mapa-action="refresh">Refrescar mapa</button>
        <button type="button" class="app-mapa-tool-btn" data-app-mapa-action="copy-diag">Copiar diagnóstico</button>
        <button type="button" class="app-mapa-tool-btn" data-app-mapa-action="scroll-unplaced">Ver sin ubicación / huérfanos</button>
        <button type="button" class="app-mapa-tool-btn" data-app-mapa-action="scroll-occupancy">Ver ocupación</button>
        <button type="button" class="app-mapa-tool-btn app-mapa-tool-btn--danger" data-app-mapa-action="clear-experimental" style="display:none;">Desactivar modo experimental</button>
      </div>
      <div class="app-mapa-note">
        Vista beta en App Shell; el mapa legacy conserva todas las herramientas operativas.
      </div>
      <div id="app-mapa-dnd-hint" class="app-mapa-dnd-hint" hidden></div>
      <div id="app-mapa-content" class="app-mapa-status is-loading">Cargando mapa read-only...</div>
    </section>
  `;
  _contentEl = _container.querySelector('#app-mapa-content');
  _dndHintEl = _container.querySelector('#app-mapa-dnd-hint');

  _lifecycle = createMapaLifecycleController({
    plaza,
    onData: snapshot => {
      _viewState.snapshot = snapshot;
      _render();
    },
    onError: () => {
      _viewState.snapshot = _lifecycle?.getSnapshot?.()?.data || null;
      _render();
    }
  });
  _lifecycle.mount();

  _dndController = createMapaDndController({
    getSnapshot: () => _lifecycle?.getSnapshot?.()?.data || null,
    canMove: () => _dndFullyEnabled(getState(), _viewState.snapshot),
    getPersistAllowed: () => _dndPersistFullyEnabled(getState(), _viewState.snapshot),
    onPersistDrop: async ({ fromCtx, originKey, destKey, snapshot }) => {
      const st = getState();
      const plaza = String(
        snapshot?.plaza || st.currentPlaza || st.profile?.plazaAsignada || ''
      ).toUpperCase();
      let snap = snapshot || _viewState.snapshot;
      const baseOpts = {
        roleAllowed: _canRolePreviewDnd(st),
        persistFlagsOk: _readAppMapaDndFlag() && _readAppMapaDndPersistFlag()
      };

      if (_dndHintEl) {
        _dndHintEl.textContent = 'Validando movimiento…';
        _dndHintEl.hidden = false;
      }

      persistDebug('validate:start', {
        plaza,
        mva: fromCtx?.mva,
        originKey,
        destKey,
        units: snap?.units?.length,
        structure: snap?.structure?.length
      });

      let v = validatePersistMove(
        {
          snapshot: snap,
          mva: fromCtx?.mva,
          originKey,
          destKey,
          plaza
        },
        baseOpts
      );
      if (!v.ok) {
        persistDebug('validate:fail', v);
        _render();
        return {
          message: v.message,
          outcome: v.code === 'OCCUPIED' ? 'occupied' : 'invalid'
        };
      }

      const canFresh = typeof window.api?.obtenerDatosFlotaConsola === 'function';
      if (canFresh) {
        const freshUnits = await _lifecycle?.fetchFreshUnitsForValidation?.();
        if (freshUnits == null) {
          persistDebug('fresh:null');
          _render();
          return {
            message:
              'No se pudo verificar el estado actual en el servidor. Reintenta o usa Refrescar mapa.',
            outcome: 'stale'
          };
        }
        snap = { ...snap, units: freshUnits, plaza: snap?.plaza || plaza };
        v = validatePersistMove(
          {
            snapshot: snap,
            mva: fromCtx?.mva,
            originKey,
            destKey,
            plaza
          },
          baseOpts
        );
        persistDebug('validate:after-server', { ok: v.ok, code: v.code });
        if (!v.ok) {
          _render();
          return {
            message: v.message,
            outcome: v.code === 'OCCUPIED' ? 'occupied' : 'invalid'
          };
        }
      }

      const okModal = await _showPersistConfirm({
        mva: fromCtx.mva,
        fromKey: originKey,
        toKey: destKey
      });
      if (!okModal) {
        _render();
        return { message: 'Movimiento cancelado. No se guardó nada.', outcome: 'cancelled' };
      }
      if (_dndHintEl) {
        _dndHintEl.textContent = 'Guardando…';
        _dndHintEl.hidden = false;
      }
      const res = await persistUnitMove({
        api: window.api,
        plaza,
        usuario: _actorName(),
        mva: fromCtx.mva,
        posNueva: destKey
      });
      persistDebug('persist:api', {
        ok: res.success,
        error: res.error || null,
        mva: fromCtx.mva,
        dest: destKey,
        plaza,
        actor: _actorName()
      });
      if (!res.success) {
        _render();
        return {
          message: `No se pudo guardar: ${res.error || 'error'}`,
          outcome: 'error'
        };
      }

      _lastPersistSummary = {
        mva: String(fromCtx?.mva || ''),
        originKey: String(originKey || ''),
        destKey: String(destKey || ''),
        at: Date.now(),
        user: _actorName()
      };
      _updateMetaLines();

      if (_dndHintEl) {
        _dndHintEl.textContent =
          `Guardado: ${_lastPersistSummary.mva} ${_lastPersistSummary.originKey}→${_lastPersistSummary.destKey} · ${_fmtShort(_lastPersistSummary.at)} · ${_lastPersistSummary.user}. Esperando actualización…`;
        _dndHintEl.hidden = false;
      }

      const reflected = await _waitSnapshotReflectsMove(fromCtx.mva, destKey, 4800);
      if (reflected) {
        _render();
        return {
          message: 'Movimiento guardado y visible en el mapa.',
          outcome: 'saved'
        };
      }

      persistDebug('reflect:timeout-resync');
      await _lifecycle?.resyncData?.();
      await _sleep(850);
      if (_snapshotShowsMove(fromCtx.mva, destKey)) {
        _render();
        return {
          message: 'Movimiento guardado (sincronizado tras refresco de datos).',
          outcome: 'saved'
        };
      }

      _render();
      return {
        message:
          'Guardado en servidor. Si no ves el cambio, pulsa «Refrescar mapa» o abre el mapa legacy.',
        outcome: 'saved'
      };
    },
    pointerOnlyPreview: true,
    onMovePreview: payload => {
      if (_dndHintEl) {
        _dndHintEl.textContent = payload?.message || '';
        _dndHintEl.hidden = false;
      }
      const oc = payload?.outcome;
      if (oc === 'error' || oc === 'invalid' || oc === 'stale' || oc === 'cancelled') {
        _render();
      }
    },
    debug: (() => {
      try {
        return localStorage.getItem('mex.debug.mode') === '1';
      } catch (_) {
        return false;
      }
    })()
  });

  _offPlaza = onPlazaChange(nextPlaza => {
    _updatePlazaHeader(nextPlaza);
    _viewState.selectedId = '';
    _viewState.snapshot = null;
    if (_contentEl) _contentEl.innerHTML = '<div class="app-mapa-status is-loading">Actualizando plaza...</div>';
    _lifecycle?.setPlaza(nextPlaza);
  });

  _offGlobalSearch = _bindGlobalSearch();
  _offPopstate = () => {
    _viewState.query = _readUrlQuery();
    _render();
  };
  window.addEventListener('popstate', _offPopstate);

  _onClick = event => {
    if (_dndController?.shouldSuppressClick?.()) return;
    const btn = event.target?.closest?.('[data-unit-id]');
    if (!btn) return;
    _viewState.selectedId = String(btn.getAttribute('data-unit-id') || '');
    _render();
  };
  _container.addEventListener('click', _onClick);

  _toolbarHandler = ev => {
    const btn = ev.target?.closest?.('[data-app-mapa-action]');
    if (!btn || !_container.contains(btn)) return;
    const act = btn.getAttribute('data-app-mapa-action');
    if (act === 'refresh') {
      _lifecycle?.resyncData?.();
      if (_dndHintEl) {
        _dndHintEl.textContent = 'Actualizando datos del mapa…';
        _dndHintEl.hidden = false;
      }
      return;
    }
    if (act === 'copy-diag') {
      const d = _lifecycle?.getSnapshot?.()?.data;
      const text = JSON.stringify(
        {
          route: window.location.pathname,
          plaza: d?.plaza,
          units: d?.units?.length,
          structureCells: d?.structure?.length,
          lastUpdated: d?.lastUpdated,
          loading: d?.loading,
          error: d?.error || null
        },
        null,
        2
      );
      navigator.clipboard?.writeText?.(text).catch(() => {});
      if (_dndHintEl) {
        _dndHintEl.textContent = 'Diagnóstico copiado al portapapeles.';
        _dndHintEl.hidden = false;
      }
      return;
    }
    if (act === 'scroll-unplaced') {
      document.getElementById('app-mapa-buckets')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (act === 'scroll-occupancy') {
      document.querySelector('.app-mapa-summary')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (act === 'clear-experimental') {
      try {
        localStorage.removeItem('mex.appMapa.dnd');
        localStorage.removeItem('mex.appMapa.dndPersist');
      } catch (_) {}
      _lastPersistSummary = null;
      if (_dndHintEl) {
        _dndHintEl.textContent = 'Modo experimental desactivado en este navegador.';
        _dndHintEl.hidden = false;
      }
      _syncDndController();
      _render();
      return;
    }
  };
  _container.addEventListener('click', _toolbarHandler);

  _lastDndEligibility = _dndFullyEnabled(getState(), null);
  _syncDndController();
  _updateBetaBanner();
  _updateMetaLines();
  _updateExperimentalResetBtn();

  _offState = subscribe(() => {
    _syncDndController();
    const cur = _dndFullyEnabled(getState(), _viewState.snapshot);
    if (cur === _lastDndEligibility) return;
    _lastDndEligibility = cur;
    _render();
  });
}

export function unmount() {
  _removeMapaModals();
  if (_offPopstate) window.removeEventListener('popstate', _offPopstate);
  _offPopstate = null;
  if (_container && _toolbarHandler) _container.removeEventListener('click', _toolbarHandler);
  _toolbarHandler = null;
  if (_container && _onClick) _container.removeEventListener('click', _onClick);
  if (typeof _offGlobalSearch === 'function') _offGlobalSearch();
  if (typeof _offPlaza === 'function') _offPlaza();
  if (typeof _offState === 'function') _offState();
  _dndController?.unmount?.();
  _dndController = null;
  _lifecycle?.unmount?.();
  _container = null;
  _contentEl = null;
  _lifecycle = null;
  _offPlaza = null;
  _offGlobalSearch = null;
  _offState = null;
  _onClick = null;
  _dndHintEl = null;
  _lastDndEligibility = null;
  _lastPersistSummary = null;
}

function _syncDndController() {
  if (!_dndController || !_container) return;
  const badge = _container.querySelector('#app-mapa-dnd-badge');
  const pb = _container.querySelector('#app-mapa-persist-badge');
  const on = _dndFullyEnabled(getState(), _viewState.snapshot);
  const persistOn = _dndPersistFullyEnabled(getState(), _viewState.snapshot);
  if (badge) {
    badge.style.display = on ? 'inline-flex' : 'none';
  }
  if (pb) {
    pb.style.display = persistOn ? 'inline-flex' : 'none';
  }
  if (on) {
    _dndController.enable();
    _dndController.mount(_container);
  } else {
    _dndController.disable();
    _dndController.unmount();
    if (_dndHintEl) {
      _dndHintEl.textContent = '';
      _dndHintEl.hidden = true;
    }
  }
  _updateBetaBanner();
  _updateExperimentalResetBtn();
}

function _render() {
  if (!_contentEl) return;
  const snapshot = _viewState.snapshot;
  if (!snapshot || snapshot.loading) {
    _contentEl.innerHTML = '<div class="app-mapa-status is-loading">Cargando mapa read-only...</div>';
    _updateMetaLines();
    return;
  }
  if (snapshot.permissionDenied) {
    _contentEl.innerHTML = renderErrorState('No tienes permisos para ver mapa en esta plaza.');
    return;
  }
  if (snapshot.error) {
    _contentEl.innerHTML = renderErrorState(snapshot.error);
    return;
  }
  const eligible = _dndFullyEnabled(getState(), snapshot);
  if (eligible !== _lastDndEligibility) {
    _lastDndEligibility = eligible;
    _syncDndController();
  }
  renderMapaReadOnly(_contentEl, snapshot, {
    query: _viewState.query,
    selectedId: _viewState.selectedId,
    dndActive: eligible,
    plaza: snapshot.plaza || String(getState().currentPlaza || '').toUpperCase()
  });
  _updatePlazaHeader(snapshot.plaza || getState().currentPlaza || '');
  _updateBetaBanner();
  _updateMetaLines();
  _updateExperimentalResetBtn();
}

function _bindGlobalSearch() {
  const handler = event => {
    _viewState.query = String(event?.detail?.query || '').trim();
    _render();
  };
  window.addEventListener('mex:global-search', handler);
  return () => window.removeEventListener('mex:global-search', handler);
}

function _ensureCss() {
  if (_cssRef && document.contains(_cssRef)) return;
  _cssRef = document.querySelector('link[data-app-mapa-css="1"]');
  if (_cssRef) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/app-mapa.css';
  link.setAttribute('data-app-mapa-css', '1');
  document.head.appendChild(link);
  _cssRef = link;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
