import { db, auth } from '/js/core/database.js';

const DEDUPE_MS = 8000;
const _recentErrors = new Map();
let _reporterInstalled = false;
let _reporterContext = {
  screen: 'unknown',
  getProfile: () => null,
  getBuild: () => '',
  enabled: () => true
};

function _normalizeString(value) {
  return String(value || '').trim();
}

function _safePath() {
  try {
    return `${window.location.pathname}${window.location.search || ''}`;
  } catch {
    return '';
  }
}

function _errorKey(kind, message, stack = '') {
  return `${kind}|${message}|${String(stack || '').slice(0, 180)}`;
}

export async function reportProgrammerError(payload = {}) {
  try {
    if (!_reporterContext.enabled()) return false;
    const profile = _reporterContext.getProfile?.() || null;
    const message = _normalizeString(payload.message || payload.reason || 'Error desconocido');
    if (!message) return false;

    const key = _errorKey(payload.kind || 'client', message, payload.stack || '');
    const now = Date.now();
    const prev = _recentErrors.get(key) || 0;
    if ((now - prev) < DEDUPE_MS) return false;
    _recentErrors.set(key, now);

    const userDocId = _normalizeString(profile?.email || auth.currentUser?.email || '');
    await db.collection('programmer_errors').add({
      timestamp: now,
      fecha: new Date(now).toISOString(),
      kind: _normalizeString(payload.kind || 'client'),
      scope: _normalizeString(payload.scope || _reporterContext.screen || 'web'),
      route: _safePath(),
      message,
      stack: _normalizeString(payload.stack || ''),
      code: _normalizeString(payload.code || ''),
      plaza: _normalizeString(profile?.plazaAsignada || ''),
      role: _normalizeString(profile?.rol || ''),
      userDocId,
      userEmail: _normalizeString(auth.currentUser?.email || profile?.email || ''),
      userName: _normalizeString(profile?.nombre || ''),
      build: _normalizeString(payload.build || _reporterContext.getBuild?.() || ''),
      source: _normalizeString(payload.source || ''),
      userAgent: _normalizeString(navigator.userAgent || '')
    });
    return true;
  } catch (_) {
    return false;
  }
}

export function installProgrammerErrorReporter(options = {}) {
  _reporterContext = {
    ..._reporterContext,
    ...options
  };

  if (_reporterInstalled) return;
  _reporterInstalled = true;

  window.addEventListener('error', event => {
    reportProgrammerError({
      kind: 'window.error',
      scope: _reporterContext.screen,
      message: event?.message || 'window error',
      stack: event?.error?.stack || '',
      source: event?.filename || ''
    });
  });

  window.addEventListener('unhandledrejection', event => {
    const reason = event?.reason;
    reportProgrammerError({
      kind: 'unhandledrejection',
      scope: _reporterContext.screen,
      message: reason?.message || reason || 'Promise rejection',
      stack: reason?.stack || ''
    });
  });
}
