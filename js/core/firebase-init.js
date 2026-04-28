// ═══════════════════════════════════════════════════════════
//  js/core/firebase-init.js
//  Script REGULAR (no module) — debe cargarse como <script src>
//  DESPUÉS de los CDN de Firebase y de /js/core/firebase-config.js.
//  Inicializa la app de Firebase y expone las instancias en
//  window._db / window._auth / window._storage para que
//  database.js (ES6 module) pueda consumirlas.
// ═══════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (!window.FIREBASE_CONFIG) {
    console.error('[firebase-init] window.FIREBASE_CONFIG no está definido. Carga /js/core/firebase-config.js antes.');
    return;
  }

  // ── Normalizar storageBucket legacy (.appspot.com → .firebasestorage.app) ──
  const cfg = Object.assign({}, window.FIREBASE_CONFIG);
  const projectId = String(cfg.projectId || '').trim();
  const rawBucket = String(cfg.storageBucket || '').trim().replace(/^gs:\/\//i, '');
  const newBucket  = projectId ? `${projectId}.firebasestorage.app` : '';
  if (newBucket && (!rawBucket || rawBucket.endsWith('.appspot.com'))) {
    cfg.storageBucket = newBucket;
  }
  window.FIREBASE_CONFIG = cfg;

  function _lsGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function _isDebugMode() {
    return _lsGet('mex.debug.mode') === '1';
  }

  function _configureFirestoreTransport(dbInstance) {
    if (!dbInstance || window.__mexFirestoreSettingsApplied) return dbInstance;
    const forceLongPolling = _lsGet('mex.firestore.forceLongPolling') === '1';
    const settings = forceLongPolling
      ? {
          ignoreUndefinedProperties: true,
          experimentalForceLongPolling: true
        }
      : {
          ignoreUndefinedProperties: true,
          experimentalAutoDetectLongPolling: true
        };
    try {
      dbInstance.settings(settings);
      window.__mexFirestoreSettingsApplied = true;
      window.__mexFirestoreTransport = {
        forceLongPolling,
        autoDetectLongPolling: !forceLongPolling,
        ignoreUndefinedProperties: true
      };
      if (_isDebugMode()) {
        console.info('[firebase-init] Firestore transport:', window.__mexFirestoreTransport);
      }
    } catch (err) {
      // No ocultar errores reales: registrar explícitamente si settings se aplicó tarde.
      console.error('[firebase-init] No se pudo aplicar settings de Firestore antes de uso:', err);
    }
    return dbInstance;
  }

  function _listenerDebug(route, view, action, extra) {
    if (_lsGet('mex.debug.mode') !== '1') return;
    const key = String(view || 'unknown');
    window.__mexListenerCounters = window.__mexListenerCounters || {};
    const current = Number(window.__mexListenerCounters[key] || 0);
    const next = action === 'create' ? current + 1 : Math.max(0, current - 1);
    window.__mexListenerCounters[key] = next;
    console.info('[listener-debug]', {
      route: String(route || window.location.pathname),
      view: key,
      action: String(action || 'create'),
      active: next,
      plaza: String(window.__mexCurrentPlazaId || window.__mexActivePlazaId || ''),
      ...(extra && typeof extra === 'object' ? extra : {})
    });
  }

  window.__mexConfigureFirestoreTransport = _configureFirestoreTransport;
  window.__mexTrackListener = _listenerDebug;

  // ── Inicializar (sólo una vez) ────────────────────────────
  if (!firebase.apps.length) {
    firebase.initializeApp(cfg);
  }

  // ── Instancias globales ───────────────────────────────────
  const db        = _configureFirestoreTransport(firebase.firestore());
  const auth      = firebase.auth();
  const storage   = (typeof firebase.storage === 'function') ? firebase.storage() : null;
  const functions = (typeof firebase.functions === 'function') ? firebase.app().functions('us-central1') : null;

  // El SDK compat ya marca esta ruta como deprecada. Dejamos Firestore
  // en modo online hasta migrar por completo a FirestoreSettings.cache.
  window._firestorePersistenceEnabled = false;

  // Exponer para ES6 modules y scripts legacy
  window._db      = db;
  window._auth    = auth;
  window._storage = storage;
  window._functions = functions;

  // Compatibilidad con mex-api.js (que también exporta auth/db en su propio scope)
  // No redeclaramos — mex-api.js los tiene internamente.

  console.log('[firebase-init] ✅ Firebase inicializado:', cfg.projectId);
})();
