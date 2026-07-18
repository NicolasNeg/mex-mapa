// ═══════════════════════════════════════════════════════════
//  js/app/features/mapa/mapa-incidencias-summary.js
//
//  FASE 14B-A — Shared data controller: incidencias summary
//  per MVA for /app/mapa.
//
//  SINGLE subscription per plaza → normalizes → groups by MVA
//  → exposes summary snapshot. Zero DOM dependency.
//
//  Does NOT:
//  - Write to Firestore
//  - Delete anything
//  - Touch UI / DOM
//  - Import views
//  - Create per-unit listeners
//
//  Usage:
//    import {
//      createMapaIncidenciasSummaryController,
//      normalizeNotaForMapaSummary,
//      buildIncidenciasSummaryByMva,
//      getSummaryForMva
//    } from '/js/app/features/mapa/mapa-incidencias-summary.js';
// ═══════════════════════════════════════════════════════════

import { db as defaultDb, COL } from '/js/core/database.js';

// ── Helpers ──────────────────────────────────────────────

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
  console.log('[mapa-incidencias-summary]', ...args);
}

function _isPermissionDenied(error) {
  return String(error?.code || '').toLowerCase() === 'permission-denied';
}

function _isMissingIndex(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code === 'failed-precondition' || message.includes('requires an index');
}

// ── Date normalization ───────────────────────────────────

function _normalizeDateField(value) {
  if (!value) return null;
  // Firestore Timestamp
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.toMillis === 'function') return new Date(value.toMillis());
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  // ISO string or epoch
  if (typeof value === 'number' && value > 0) return new Date(value);
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function _dateToEpoch(value) {
  const d = _normalizeDateField(value);
  return d ? d.getTime() : 0;
}

// ── State normalization ──────────────────────────────────

function _normalizeEstado(value) {
  const raw = _safeUp(value);
  if (raw === 'RESUELTA' || raw === 'RESUELTO' || raw === 'CERRADA' || raw === 'CERRADO') {
    return 'resuelta';
  }
  if (raw === 'EN_PROCESO' || raw === 'EN PROCESO') return 'en_proceso';
  if (raw === 'ADJUNTO' || raw === 'DOCUMENTO' || raw === 'INFO') return 'adjunto';
  // abierta / pendiente / anything else
  return 'abierta';
}

function _normalizePrioridad(value) {
  const raw = _safeUp(value);
  if (['CRITICA', 'CRÍTICA', 'CRITICO', 'CRÍTICO', 'URGENTE'].includes(raw)) return 'critica';
  if (raw === 'ALTA') return 'alta';
  if (raw === 'BAJA') return 'baja';
  return 'media';
}

function _isCritica(prioridad) {
  return prioridad === 'critica' || prioridad === 'alta';
}

// ── Attachments normalization ────────────────────────────

function _normalizeAttachments(data) {
  const fromAdjuntos = Array.isArray(data.adjuntos) ? data.adjuntos : [];
  const fromEvidencias = Array.isArray(data.evidencias) ? data.evidencias : [];
  const fromUrls = Array.isArray(data.evidenciaUrls) ? data.evidenciaUrls.map(url => ({ url })) : [];
  const merged = [...fromAdjuntos, ...fromEvidencias, ...fromUrls];
  const seen = new Set();
  return merged
    .map(item => {
      if (typeof item === 'string') return { url: item };
      return item && typeof item === 'object' ? item : null;
    })
    .filter(Boolean)
    .filter(item => {
      const key = _safeText(item.path || item.url || item.fileName || '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// ═══════════════════════════════════════════════════════════
//  PUBLIC — normalizeNotaForMapaSummary
//  Takes a single nota/incidencia doc and returns a
//  normalized item suitable for the mapa summary.
// ═══════════════════════════════════════════════════════════

export function normalizeNotaForMapaSummary(id, data = {}) {
  const mva = _safeUp(data.mva || data.unidad || data.codigo || '');
  const estado = _normalizeEstado(data.estado);
  const prioridad = _normalizePrioridad(data.prioridad);
  const titulo = _safeText(data.titulo) || 'Incidencia';
  const descripcion = _safeText(data.descripcion || data.nota || '');
  const timestamp = _dateToEpoch(data.timestamp || data.fecha || data.creadoEn || 0);
  const resueltaEn = _dateToEpoch(data.resueltaEn || data.resueltoEn || 0);
  const plaza = _safeUp(data.plaza || data.plazaID || data.plazaId || '');

  return {
    id: String(id || data.id || ''),
    mva,
    titulo,
    descripcion,
    estado,
    prioridad,
    critica: _isCritica(prioridad),
    autor: _safeText(data.autor || data.creadoPor || ''),
    timestamp,
    resueltaEn,
    plaza,
    evidencias: _normalizeAttachments(data),
    source: _safeText(data.source || 'notas_admin'),
    version: Number(data.version || 1) || 1,
  };
}

// ═══════════════════════════════════════════════════════════
//  PUBLIC — buildIncidenciasSummaryByMva
//  Takes an array of normalized items and returns the
//  grouped summary object keyed by MVA.
// ═══════════════════════════════════════════════════════════

export function buildIncidenciasSummaryByMva(items = []) {
  const byMva = {};

  for (const item of items) {
    const mva = item.mva;
    if (!mva) continue;

    if (!byMva[mva]) {
      byMva[mva] = {
        mva,
        total: 0,
        abiertas: 0,
        criticas: 0,
        resueltas: 0,
        latestAt: 0,
        latestTitle: '',
        latestPriority: '',
        searchText: '',
        items: [],
      };
    }

    const bucket = byMva[mva];
    bucket.total += 1;
    const piece = `${item.titulo || ''} ${item.descripcion || ''}`.trim();
    if (piece) {
      const up = piece.toUpperCase();
      bucket.searchText = bucket.searchText ? `${bucket.searchText} ${up}` : up;
    }

    if (item.estado === 'abierta' || item.estado === 'en_proceso') {
      bucket.abiertas += 1;
    }
    if (item.estado === 'resuelta') {
      bucket.resueltas += 1;
    }
    if (item.critica && item.estado !== 'resuelta') {
      bucket.criticas += 1;
    }

    if (item.timestamp > bucket.latestAt) {
      bucket.latestAt = item.timestamp;
      bucket.latestTitle = item.titulo;
      bucket.latestPriority = item.prioridad;
    }

    bucket.items.push(item);
  }

  return byMva;
}

// ═══════════════════════════════════════════════════════════
//  PUBLIC — getSummaryForMva
//  Safe accessor: returns the summary entry for a single
//  MVA or a fallback empty shape.
// ═══════════════════════════════════════════════════════════

const EMPTY_MVA_SUMMARY = Object.freeze({
  mva: '',
  total: 0,
  abiertas: 0,
  criticas: 0,
  resueltas: 0,
  latestAt: 0,
  latestTitle: '',
  latestPriority: '',
  items: [],
});

export function getSummaryForMva(summary, mva) {
  if (!summary || !mva) return { ...EMPTY_MVA_SUMMARY, mva: _safeUp(mva || '') };
  const key = _safeUp(mva);
  const byMva = summary.byMva || summary;
  const entry = byMva[key];
  if (!entry) return { ...EMPTY_MVA_SUMMARY, mva: key };
  return { ...entry, items: [...entry.items] };
}

// ═══════════════════════════════════════════════════════════
//  PUBLIC — createMapaIncidenciasSummaryController
//
//  One subscription per plaza. Normalizes, groups by MVA,
//  pushes summary via onSummary callback.
//
//  Lifecycle:
//    const ctrl = createMapaIncidenciasSummaryController({ ... });
//    ctrl.subscribe();
//    ctrl.setPlaza('MERIDA');
//    const snap = ctrl.getSnapshot();
//    ctrl.cleanup();
// ═══════════════════════════════════════════════════════════

export function createMapaIncidenciasSummaryController({
  plaza = '',
  api = null,
  db = null,
  onSummary = null,
  onError = null,
  debug = undefined
} = {}) {
  // ── Resolve API & DB with safe fallbacks ──
  const _api = api || (typeof window !== 'undefined' ? window.api : null) || null;
  const _db = db || defaultDb || null;
  const _debug = _isDebugEnabled(debug);

  // ── Internal state ──
  let _active = false;
  let _token = 0;
  let _unsub = null;

  let _snapshot = {
    plaza: _safeUp(plaza),
    total: 0,
    byMva: {},
    updatedAt: 0,
    loading: false,
    error: '',
    permissionDenied: false,
    missingIndex: false,
  };

  // ── Emit helpers ──

  function _emitSummary() {
    if (typeof onSummary !== 'function') return;
    try { onSummary(getSnapshot()); } catch (_) {}
  }

  function _emitError(error) {
    if (typeof onError !== 'function') return;
    try { onError(error, getSnapshot()); } catch (_) {}
  }

  // ── Reset ──

  function _resetState(nextPlaza) {
    _snapshot = {
      plaza: _safeUp(nextPlaza),
      total: 0,
      byMva: {},
      updatedAt: 0,
      loading: false,
      error: '',
      permissionDenied: false,
      missingIndex: false,
    };
  }

  // ── Close current subscription safely ──

  function _closeSub() {
    if (_unsub) {
      try { _unsub(); } catch (_) {}
      _unsub = null;
    }
  }

  // ── Token-guarded update to prevent stale callbacks ──

  function _guardedUpdate(token, updater) {
    if (!_active || token !== _token) return false;
    updater();
    _snapshot.updatedAt = Date.now();
    return true;
  }

  // ── Process incoming data (from any source) ──

  function _processNotasData(token, rawItems) {
    const items = (Array.isArray(rawItems) ? rawItems : [])
      .map(item => normalizeNotaForMapaSummary(item?.id || item?.legacyNotaId || '', item));

    const byMva = buildIncidenciasSummaryByMva(items);
    const total = items.length;

    const ok = _guardedUpdate(token, () => {
      _snapshot.loading = false;
      _snapshot.error = '';
      _snapshot.permissionDenied = false;
      _snapshot.missingIndex = false;
      _snapshot.total = total;
      _snapshot.byMva = byMva;
    });

    if (ok) {
      _log(_debug, 'data', {
        plaza: _snapshot.plaza,
        total,
        mvas: Object.keys(byMva).length,
      });
      _emitSummary();
    }
  }

  // ── Handle errors ──

  function _handleError(token, error) {
    const ok = _guardedUpdate(token, () => {
      _snapshot.loading = false;
      _snapshot.permissionDenied = _isPermissionDenied(error);
      _snapshot.missingIndex = _isMissingIndex(error);
      _snapshot.error = _safeText(error?.message) || 'Error al obtener incidencias.';
    });
    if (!ok) return;
    _log(_debug, 'error', {
      plaza: _snapshot.plaza,
      permissionDenied: _snapshot.permissionDenied,
      missingIndex: _snapshot.missingIndex,
      message: _snapshot.error,
    });
    _emitError(error);
    _emitSummary();
  }

  // ── Subscribe ──

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
    _emitSummary();

    _log(_debug, 'subscribe', { plaza: activePlaza, token });

    if (!activePlaza) {
      _snapshot.loading = false;
      _snapshot.error = 'No hay plaza activa para suscribir incidencias.';
      _emitSummary();
      return;
    }

    // ── Strategy 1: window.api.suscribirNotasAdmin ──
    if (_api && typeof _api.suscribirNotasAdmin === 'function') {
      _log(_debug, 'source:api.suscribirNotasAdmin', { plaza: activePlaza });
      try {
        const unsubFn = _api.suscribirNotasAdmin(notas => {
          _processNotasData(token, notas);
        }, activePlaza);
        if (typeof unsubFn === 'function') {
          _unsub = unsubFn;
        }
        return;
      } catch (err) {
        _log(_debug, 'api.suscribirNotasAdmin failed, trying Firestore fallback', err?.message);
        // Fall through to Firestore direct
      }
    }

    // ── Strategy 2: Firestore direct ──
    if (_db) {
      _log(_debug, 'source:firestore-direct', { plaza: activePlaza });
      try {
        const query = _db.collection(COL.NOTAS)
          .where('plaza', '==', activePlaza)
          .orderBy('timestamp', 'desc');

        _unsub = query.onSnapshot(
          snap => {
            const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            _processNotasData(token, docs);
          },
          err => {
            // Handle missing-index by falling back to unfiltered query
            if (_isMissingIndex(err)) {
              _log(_debug, 'missing-index fallback (unscoped)', { plaza: activePlaza });
              try {
                _unsub = _db.collection(COL.NOTAS)
                  .orderBy('timestamp', 'desc')
                  .limit(300)
                  .onSnapshot(
                    fallbackSnap => {
                      const docs = fallbackSnap.docs
                        .filter(doc => {
                          const d = doc.data();
                          return _safeUp(d.plaza || d.plazaID || d.plazaId || '') === activePlaza;
                        })
                        .map(doc => ({ id: doc.id, ...doc.data() }));
                      _processNotasData(token, docs);
                    },
                    fallbackErr => _handleError(token, fallbackErr)
                  );
              } catch (fbErr) {
                _handleError(token, fbErr);
              }
              return;
            }
            _handleError(token, err);
          }
        );
        return;
      } catch (err) {
        _handleError(token, err);
        return;
      }
    }

    // ── No data source available ──
    _snapshot.loading = false;
    _snapshot.error = 'Sin fuente de datos disponible (api/db).';
    _emitSummary();
  }

  // ── Cleanup (idempotent) ──

  function cleanup() {
    if (!_active && !_unsub) return;
    _log(_debug, 'cleanup', { plaza: _snapshot.plaza, token: _token });
    _active = false;
    _token += 1;
    _closeSub();
    _snapshot.loading = false;
  }

  // ── Set plaza (closes old, re-subscribes if was active) ──

  function setPlaza(nextPlaza) {
    const normalized = _safeUp(nextPlaza);
    if (normalized === _snapshot.plaza) return;
    _log(_debug, 'setPlaza', { from: _snapshot.plaza, to: normalized });
    const wasActive = _active;
    cleanup();
    _resetState(normalized);
    if (wasActive) subscribe();
  }

  // ── Get snapshot (defensive copy) ──

  function getSnapshot() {
    // Deep copy byMva items arrays
    const byMvaCopy = {};
    for (const [key, entry] of Object.entries(_snapshot.byMva)) {
      byMvaCopy[key] = { ...entry, items: [...entry.items] };
    }
    return {
      ..._snapshot,
      byMva: byMvaCopy,
      active: _active,
    };
  }

  // ── Is active ──

  function isActive() {
    return _active;
  }

  // ── Public API ──

  return {
    subscribe,
    cleanup,
    setPlaza,
    getSnapshot,
    isActive,
  };
}
