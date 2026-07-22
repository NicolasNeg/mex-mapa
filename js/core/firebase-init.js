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
    // Flag manual (Programador / localStorage). No combinar Force + AutoDetect.
    // Por defecto: AutoDetect — el SDK cambia a long-polling si WebChannel/QUIC falla
    // (errores Listen 400 / QUIC_NETWORK_IDLE_TIMEOUT suelen ser transitorios y el SDK reintenta).
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

  // ── App Check (reCAPTCHA) — antes de Auth / Firestore / Functions ──
  // Requiere firebase-app-check-compat.js y window.MEX_APPCHECK_SITE_KEY.
  // Docs: /docs/app-check.md
  function _isLocalhost() {
    const host = String(location.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  }

  function _resolveAppCheckDebugToken() {
    // Prioridad: window.MEX_APPCHECK_DEBUG_TOKEN → localStorage → auto localhost
    if (typeof window.MEX_APPCHECK_DEBUG_TOKEN !== 'undefined' && window.MEX_APPCHECK_DEBUG_TOKEN !== null) {
      return window.MEX_APPCHECK_DEBUG_TOKEN;
    }
    try {
      const ls = _lsGet('mex.appcheck.debug');
      if (ls === '1' || ls === 'true') return true;
      if (ls && String(ls).trim().length > 8) return String(ls).trim();
    } catch (_) { /* ignore */ }
    // En localhost usar debug provider (no añadir localhost a dominios reCAPTCHA).
    if (_isLocalhost()) return true;
    return null;
  }

  function _initAppCheck() {
    if (window.__mexAppCheck) return window.__mexAppCheck;
    const siteKey = String(window.MEX_APPCHECK_SITE_KEY || '').trim();
    if (!siteKey) {
      console.warn('[firebase-init] App Check omitido: define window.MEX_APPCHECK_SITE_KEY (site key pública). Ver docs/app-check.md');
      return null;
    }
    if (typeof firebase.appCheck !== 'function' || !firebase.appCheck) {
      console.warn('[firebase-init] App Check omitido: carga firebase-app-check-compat.js antes de firebase-init.js');
      return null;
    }

    const debugToken = _resolveAppCheckDebugToken();
    if (debugToken !== null && debugToken !== undefined) {
      // Debe asignarse ANTES de activate() — ver Firebase App Check debug provider.
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
      if (_isDebugMode() || _isLocalhost()) {
        console.info('[firebase-init] App Check debug token habilitado. Si ves un UUID en consola, regístralo en Firebase Console → App Check → Manage debug tokens.');
      }
    }

    const providerName = String(window.MEX_APPCHECK_PROVIDER || 'enterprise').trim().toLowerCase();
    const useEnterprise = providerName !== 'v3' && providerName !== 'recaptcha-v3';
    let provider;
    try {
      if (useEnterprise) {
        provider = new firebase.appCheck.ReCaptchaEnterpriseProvider(siteKey);
      } else {
        provider = new firebase.appCheck.ReCaptchaV3Provider(siteKey);
      }
    } catch (err) {
      console.error('[firebase-init] No se pudo crear provider App Check:', err);
      return null;
    }

    try {
      const appCheck = firebase.appCheck();
      appCheck.activate(provider, /* isTokenAutoRefreshEnabled */ true);
      window.__mexAppCheck = appCheck;
      window._appCheck = appCheck;
      console.log(
        '[firebase-init] ✅ App Check activo:',
        useEnterprise ? 'ReCaptchaEnterpriseProvider' : 'ReCaptchaV3Provider'
      );
      return appCheck;
    } catch (err) {
      console.error('[firebase-init] App Check activate falló:', err);
      return null;
    }
  }

  _initAppCheck();

  // ── Instancias globales ───────────────────────────────────
  const db        = _configureFirestoreTransport(firebase.firestore());
  const auth      = (typeof firebase.auth === 'function') ? firebase.auth() : null;
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
