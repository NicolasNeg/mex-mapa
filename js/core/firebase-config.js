// ─── Firebase Web SDK — configuración cliente (pública por diseño) ───
// No incluir service accounts, tokens de servidor ni secretos.
// Same-origin; ver docs/security-client-config-audit.md
// App Check: ver docs/app-check.md
(function (g) {
  'use strict';
  if (g.FIREBASE_CONFIG && String(g.FIREBASE_CONFIG.projectId || '').trim()) return;
  g.FIREBASE_CONFIG = {
    apiKey: 'AIzaSyBk_A5U37Surm-K1PxZnNbzN-htyrnNmVc',
    authDomain: 'mex-mapa-bjx.firebaseapp.com',
    projectId: 'mex-mapa-bjx',
    storageBucket: 'mex-mapa-bjx.firebasestorage.app',
    messagingSenderId: '35913204070',
    appId: '1:35913204070:web:8d2c2fa94376449dbd08a7'
  };

  // ── App Check (reCAPTCHA v3) — solo site key PÚBLICA ───────────────
  // Firebase Console → App Check → app web "mapGestion" → reCAPTCHA (v3).
  // NO pegues API keys de Google Cloud ni secretos de servidor.
  // Override opcional antes de cargar este archivo: window.MEX_APPCHECK_SITE_KEY
  if (g.MEX_APPCHECK_SITE_KEY == null || String(g.MEX_APPCHECK_SITE_KEY).trim() === '') {
    g.MEX_APPCHECK_SITE_KEY = '6Lf1714tAAAAAK3wyyOhB8nCk6JRh7uwIFlR6ufC';
  }
  // 'v3' → ReCaptchaV3Provider | 'enterprise' → ReCaptchaEnterpriseProvider
  if (g.MEX_APPCHECK_PROVIDER == null || String(g.MEX_APPCHECK_PROVIDER).trim() === '') {
    g.MEX_APPCHECK_PROVIDER = 'v3';
  }

  // ── Login gate: reCAPTCHA v2 checkbox ("No soy un robot") ───────────
  // Site key PÚBLICA del widget checkbox. Secreto de servidor: RECAPTCHA_V2_SECRET
  // (functions config recaptcha.v2_secret). Ver docs/app-check.md.
  if (g.MEX_RECAPTCHA_V2_SITE_KEY == null || String(g.MEX_RECAPTCHA_V2_SITE_KEY).trim() === '') {
    g.MEX_RECAPTCHA_V2_SITE_KEY = '6Lf1714tAAAAAK3wyyOhB8nCk6JRh7uwIFlR6ufC';
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
