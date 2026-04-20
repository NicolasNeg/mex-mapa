/**
 * js/core/error-tracking.js
 * Inicializa Sentry para captura de errores en producción.
 * Se carga DESPUÉS de firebase-init.js para poder adjuntar contexto de usuario.
 *
 * Uso:
 *   import { initErrorTracking, setErrorUser, captureError } from '/js/core/error-tracking.js';
 *
 * Fallback seguro: si Sentry no está disponible (bloqueado por adblocker, etc.),
 * todas las funciones son no-ops silenciosos.
 */

'use strict';

const _sentry = () => (typeof Sentry !== 'undefined' ? Sentry : null);

const IS_PROD = !window.location.hostname.includes('localhost') &&
                !window.location.hostname.includes('staging');

/**
 * Inicializar Sentry. Llamar una vez al arrancar la app.
 * @param {string} dsn - DSN del proyecto en sentry.io
 */
export function initErrorTracking(dsn) {
  const S = _sentry();
  if (!S || !dsn) return;

  S.init({
    dsn,
    environment:        IS_PROD ? 'production' : 'staging',
    release:            _resolveRelease(),
    tracesSampleRate:   IS_PROD ? 0.1 : 1.0,
    // No capturar errores de extensiones de Chrome ni scripts de terceros
    denyUrls: [
      /extensions\//i,
      /^chrome:\/\//i,
      /^chrome-extension:\/\//i,
      /gstatic\.com/i,
      /googleapis\.com/i,
    ],
    beforeSend(event) {
      // Ignorar errores de red (offline) que son esperados
      const msg = event?.exception?.values?.[0]?.value || '';
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') ||
          msg.includes('Load failed'))     return null;
      return event;
    }
  });
}

/**
 * Adjuntar identidad del usuario a todos los eventos posteriores.
 * Llamar justo después de que Firebase Auth confirme el login.
 * @param {{ email: string, role: string, plaza: string }} usuario
 */
export function setErrorUser({ email, role, plaza } = {}) {
  const S = _sentry();
  if (!S) return;
  S.setUser({ email, role, plaza });
}

/**
 * Capturar un error de forma explícita (en bloques catch de operaciones críticas).
 * @param {Error} err
 * @param {{ context?: string, extra?: object }} opts
 */
export function captureError(err, { context = '', extra = {} } = {}) {
  const S = _sentry();
  if (!S) {
    console.error(`[${context || 'error'}]`, err, extra);
    return;
  }
  S.withScope(scope => {
    if (context) scope.setTag('context', context);
    Object.entries(extra).forEach(([k, v]) => scope.setExtra(k, v));
    S.captureException(err);
  });
}

/**
 * Registrar un mensaje informativo (no un error).
 * Útil para trazar flujos importantes sin lanzar excepción.
 * @param {string} mensaje
 * @param {'info'|'warning'|'error'} nivel
 */
export function captureMessage(mensaje, nivel = 'info') {
  const S = _sentry();
  if (!S) return;
  S.captureMessage(mensaje, nivel);
}

// ── Privado ──────────────────────────────────────────────────
function _resolveRelease() {
  // Leer la versión del SW que está en window tras cargar sw.js
  // Si no está disponible, usar la fecha del build
  try {
    const swContent = window.__MEX_SW_VERSION;
    if (swContent) return swContent;
  } catch (_) {}
  return `mex-mapa@${new Date().toISOString().split('T')[0]}`;
}
