// ═══════════════════════════════════════════════════════════
//  /js/core/error-logger.js
//
//  Sistema centralizado de logging de errores.
//  Escribe en Firestore colección: error_logs
//
//  API: window.mexLog.app(msg, extra?)
//       window.mexLog.server(msg, extra?)
//       window.mexLog.user(msg, extra?)
//       window.mexLog.network(msg, extra?)
//       window.mexLog.payment(msg, extra?)
//       window.mexLog.external(service, msg, extra?)
//       window.mexLog.catch(err, extra?)   ← captura un Error JS
//
//  Categorías de error:
//   APP      — bug en nuestro código (nunca debería pasar)
//   SERVER   — error en Firebase / Cloud Functions / backend
//   USER     — acción inválida del usuario (input, permisos)
//   NETWORK  — sin internet, timeout, conexión interrumpida
//   PAYMENT  — fallo en Stripe / proceso de pago
//   EXTERNAL — servicio externo: Stripe, APIs, Vision AI, etc.
//   FIRESTORE — error específico de lectura/escritura Firestore
// ═══════════════════════════════════════════════════════════

(function () {
  'use strict';

  const COL = 'error_logs';
  const MAX_QUEUE = 30;          // máx errores en cola offline
  const FLUSH_DELAY = 1500;      // ms antes de escribir a Firestore
  const SUPPRESS_DUPLICATE_MS = 5000; // no re-loggear el mismo error en 5s

  let _queue = [];
  let _flushTimer = null;
  const _recentHashes = new Map();

  // ── Categorías ────────────────────────────────────────────

  const CATEGORIES = {
    APP:       { label: 'Error de aplicación',  desc: 'Bug en el código de la app',           severity: 'high',   color: '#ef4444' },
    SERVER:    { label: 'Error de servidor',     desc: 'Error en Firebase / Cloud Functions',  severity: 'high',   color: '#f97316' },
    USER:      { label: 'Acción de usuario',     desc: 'Input inválido o permiso insuficiente',severity: 'low',    color: '#f59e0b' },
    NETWORK:   { label: 'Error de conexión',     desc: 'Sin internet o timeout de red',        severity: 'medium', color: '#6366f1' },
    PAYMENT:   { label: 'Error de pago',         desc: 'Fallo en Stripe o procesamiento',      severity: 'high',   color: '#ec4899' },
    EXTERNAL:  { label: 'Error de servicio ext.', desc: 'API externa: Stripe, Vision AI, etc.', severity: 'medium', color: '#8b5cf6' },
    FIRESTORE: { label: 'Error de base de datos', desc: 'Lectura/escritura en Firestore',       severity: 'high',   color: '#0ea5e9' },
  };

  // ── Helpers ───────────────────────────────────────────────

  function _empresaId() {
    try { return window._empresaActual?.id || ''; } catch (_) { return ''; }
  }

  function _userId() {
    try {
      const profile = window.__mexCurrentProfile;
      if (profile) return String(profile.id || profile.email || profile.uid || '');
      return window._auth?.currentUser?.uid || '';
    } catch (_) { return ''; }
  }

  function _userName() {
    try {
      const profile = window.__mexCurrentProfile;
      if (profile) return String(profile.nombreCompleto || profile.nombre || profile.email || '');
      return window._auth?.currentUser?.displayName || window._auth?.currentUser?.email || '';
    } catch (_) { return ''; }
  }

  function _route() {
    try { return window.location.pathname + window.location.search; } catch (_) { return ''; }
  }

  function _hash(category, message) {
    return `${category}:${String(message).slice(0, 120)}`;
  }

  function _isDuplicate(category, message) {
    const key = _hash(category, message);
    const last = _recentHashes.get(key);
    if (last && Date.now() - last < SUPPRESS_DUPLICATE_MS) return true;
    _recentHashes.set(key, Date.now());
    // Limpiar hashes viejos
    if (_recentHashes.size > 50) {
      const now = Date.now();
      for (const [k, t] of _recentHashes) {
        if (now - t > SUPPRESS_DUPLICATE_MS * 2) _recentHashes.delete(k);
      }
    }
    return false;
  }

  // ── Core log ──────────────────────────────────────────────

  function _log(category, message, extra = {}) {
    const cat = CATEGORIES[category] || CATEGORIES.APP;
    if (_isDuplicate(category, message)) return;

    const entry = {
      category,
      severity:   extra.severity || cat.severity,
      message:    String(message || '').slice(0, 2000),
      stack:      String(extra.stack || '').slice(0, 3000),
      empresaId:  extra.empresaId || _empresaId(),
      route:      extra.route || _route(),
      action:     String(extra.action || '').slice(0, 200),
      userId:     extra.userId || _userId(),
      userName:   extra.userName || _userName(),
      service:    String(extra.service || '').slice(0, 100), // para EXTERNAL: 'stripe', 'vision-ai', etc.
      userMessage:String(extra.userMessage || '').slice(0, 500), // mensaje amigable para el usuario
      context:    extra.context || {},
      ua:         navigator.userAgent.slice(0, 200),
      timestamp:  Date.now(),
      resolved:   false,
    };

    _queue.push(entry);
    if (_queue.length > MAX_QUEUE) _queue.shift();

    // También guardar en window.__mexErrorLog para errores.js
    try {
      window.__mexErrorLog = window.__mexErrorLog || [];
      window.__mexErrorLog.unshift(entry);
      if (window.__mexErrorLog.length > 100) window.__mexErrorLog.pop();
    } catch (_) {}

    // Consola (dev)
    const lvl = entry.severity === 'low' ? 'warn' : 'error';
    console[lvl]?.(`[mexLog:${category}]`, message, extra);

    // Flush diferido
    clearTimeout(_flushTimer);
    _flushTimer = setTimeout(_flush, FLUSH_DELAY);
  }

  // ── Flush a Firestore ─────────────────────────────────────

  async function _flush() {
    if (!_queue.length || !window._db) return;
    const toWrite = _queue.splice(0, _queue.length);
    try {
      const batch = window._db.batch();
      for (const entry of toWrite) {
        const ref = window._db.collection(COL).doc();
        const ts = window.firebase?.firestore?.FieldValue?.serverTimestamp?.() || new Date();
        batch.set(ref, { ...entry, timestamp: ts, clientTs: entry.timestamp });
      }
      await batch.commit();
    } catch (err) {
      // Devolver a la cola si falla (offline)
      _queue.unshift(...toWrite.slice(0, MAX_QUEUE - _queue.length));
      console.warn('[mexLog] No se pudo escribir en Firestore:', err.message);
    }
  }

  // ── Auto-captura de errores globales ──────────────────────

  window.addEventListener('error', ev => {
    if (!ev.error && !ev.message) return;
    _log('APP', ev.message || String(ev.error), {
      stack:  ev.error?.stack || '',
      action: 'window.onerror',
      context: { filename: ev.filename, lineno: ev.lineno, colno: ev.colno },
    });
  });

  window.addEventListener('unhandledrejection', ev => {
    const err = ev.reason;
    if (!err) return;
    const msg = err?.message || String(err);
    // Firestore offline / permission-denied → categoría distinta
    const isFirestore = msg.includes('firestore') || msg.includes('permission-denied') || msg.includes('PERMISSION_DENIED');
    const isNetwork   = msg.includes('network') || msg.includes('offline') || msg.includes('Failed to fetch');
    _log(
      isFirestore ? 'FIRESTORE' : isNetwork ? 'NETWORK' : 'APP',
      msg,
      { stack: err?.stack || '', action: 'unhandledrejection' }
    );
  });

  // ── API pública ───────────────────────────────────────────

  window.mexLog = Object.freeze({
    /** Bug en nuestro código */
    app(message, extra = {}) { _log('APP', message, extra); },

    /** Error en Firebase / backend */
    server(message, extra = {}) { _log('SERVER', message, extra); },

    /** Acción inválida del usuario */
    user(message, extra = {}) { _log('USER', message, extra); },

    /** Sin internet o timeout */
    network(message, extra = {}) { _log('NETWORK', message, extra); },

    /** Fallo en pago (Stripe) */
    payment(message, extra = {}) { _log('PAYMENT', message, { service: 'stripe', ...extra }); },

    /** Servicio externo: stripe, vision-ai, gemini, etc. */
    external(service, message, extra = {}) { _log('EXTERNAL', message, { service, ...extra }); },

    /** Captura un objeto Error de JS */
    catch(err, extra = {}) {
      if (!err) return;
      const isFirestore = err.code?.includes('firestore') || err.message?.includes('permission-denied');
      const isNetwork   = err.message?.includes('network') || err.message?.includes('offline') || err.message?.includes('Failed to fetch');
      const cat = isFirestore ? 'FIRESTORE' : isNetwork ? 'NETWORK' : 'APP';
      _log(cat, err.message || String(err), { stack: err.stack || '', ...extra });
    },

    /** Forzar escritura inmediata (útil antes de logout o beforeunload) */
    flush() { return _flush(); },

    /** Metadatos de categorías para la UI */
    CATEGORIES,
  });

  // Flush antes de cerrar la página
  window.addEventListener('beforeunload', () => {
    if (_queue.length && window._db) {
      // Usar sendBeacon si está disponible (no-blocking)
      _flush();
    }
  });

})();
