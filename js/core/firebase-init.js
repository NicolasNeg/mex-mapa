// ═══════════════════════════════════════════════════════════
//  js/core/firebase-init.js
//  Script REGULAR (no module) — debe cargarse como <script src>
//  DESPUÉS de los CDN de Firebase y de /config.js.
//  Inicializa la app de Firebase y expone las instancias en
//  window._db / window._auth / window._storage para que
//  database.js (ES6 module) pueda consumirlas.
// ═══════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (!window.FIREBASE_CONFIG) {
    console.error('[firebase-init] window.FIREBASE_CONFIG no está definido. Asegúrate de cargar /config.js antes.');
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

  // ── Inicializar (sólo una vez) ────────────────────────────
  if (!firebase.apps.length) {
    firebase.initializeApp(cfg);
  }

  // ── Instancias globales ───────────────────────────────────
  const db        = firebase.firestore();
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
