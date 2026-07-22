// ─── Firebase Web SDK — configuración cliente (pública por diseño) ───
// No incluir service accounts, tokens de servidor ni secretos.
// Same-origin; ver docs/security-client-config-audit.md
// App Check: ver docs/app-check.md
(function (g) {
  'use strict';
  if (!g.FIREBASE_CONFIG || !String(g.FIREBASE_CONFIG.projectId || '').trim()) {
    g.FIREBASE_CONFIG = {
      apiKey: 'AIzaSyBk_A5U37Surm-K1PxZnNbzN-htyrnNmVc',
      authDomain: 'mex-mapa-bjx.firebaseapp.com',
      projectId: 'mex-mapa-bjx',
      storageBucket: 'mex-mapa-bjx.firebasestorage.app',
      messagingSenderId: '35913204070',
      appId: '1:35913204070:web:8d2c2fa94376449dbd08a7'
    };
  }

  // ── Login gate: reCAPTCHA v2 checkbox ("No soy un robot") ─────────
  // Site key PÚBLICA del widget checkbox. Secreto de servidor: RECAPTCHA_V2_SECRET
  // (functions config recaptcha.v2_secret). Ver docs/app-check.md.
  // IMPORTANTE: esta clave es v2 — NO sirve para App Check (necesita v3 distinta).
  if (g.MEX_RECAPTCHA_V2_SITE_KEY == null || String(g.MEX_RECAPTCHA_V2_SITE_KEY).trim() === '') {
    g.MEX_RECAPTCHA_V2_SITE_KEY = '6Lf1714tAAAAAK3wyyOhB8nCk6JRh7uwIFlR6ufC';
  }

  // ── App Check (reCAPTCHA v3) — desactivado por defecto ────────────
  // Activar solo con site key v3 válida en Firebase Console + MEX_APPCHECK_DISABLED = false.
  // Mientras esté off, no se carga ReCaptcha v3 ni aparece appCheck/recaptcha-error.
  if (g.MEX_APPCHECK_DISABLED !== false) {
    g.MEX_APPCHECK_DISABLED = true;
  }
  const v2Key = String(g.MEX_RECAPTCHA_V2_SITE_KEY || '').trim();
  let acKey = String(g.MEX_APPCHECK_SITE_KEY || '').trim();
  if (g.MEX_APPCHECK_DISABLED === true) {
    g.MEX_APPCHECK_SITE_KEY = '';
  } else if (!acKey || (v2Key && acKey === v2Key)) {
    g.MEX_APPCHECK_SITE_KEY = '';
  }
  if (g.MEX_APPCHECK_PROVIDER == null || String(g.MEX_APPCHECK_PROVIDER).trim() === '') {
    g.MEX_APPCHECK_PROVIDER = 'v3';
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
