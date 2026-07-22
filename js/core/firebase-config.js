// ─── Firebase Web SDK — configuración cliente (pública por diseño) ───
// No incluir service accounts, tokens de servidor ni secretos.
// Same-origin; ver docs/security-client-config-audit.md
// App Check: ver docs/app-check.md
// Login captcha (reCAPTCHA v2 checkbox): ver docs/app-check.md § Login
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

<<<<<<< Updated upstream
  // ── Login gate: reCAPTCHA v2 checkbox ("No soy un robot") ───────────
  // Site key PÚBLICA del widget checkbox. Secreto de servidor: RECAPTCHA_V2_SECRET
  // (functions config recaptcha.v2_secret). Ver docs/app-check.md.
  // IMPORTANTE: esta clave es v2 — NO sirve para App Check (necesita v3 distinta).
=======
  // ── Login gate: reCAPTCHA v2 checkbox (“No soy un robot”) ─────────
  // Site key PÚBLICA de Google reCAPTCHA v2 (Checkbox). NO es App Check / v3.
  // Override opcional antes de cargar este archivo: window.MEX_RECAPTCHA_V2_SITE_KEY
>>>>>>> Stashed changes
  if (g.MEX_RECAPTCHA_V2_SITE_KEY == null || String(g.MEX_RECAPTCHA_V2_SITE_KEY).trim() === '') {
    g.MEX_RECAPTCHA_V2_SITE_KEY = '6Lf1714tAAAAAK3wyyOhB8nCk6JRh7uwIFlR6ufC';
  }

<<<<<<< Updated upstream
  // ── App Check (reCAPTCHA v3) — solo site key PÚBLICA distinta de v2 ─
  // Firebase Console → App Check → app web "mapGestion" → reCAPTCHA (v3).
  // NO reutilices la site key v2 del login: provoca appCheck/recaptcha-error.
  // Vacío = App Check omitido (app funciona; enforcement sigue en observación).
  // Override: window.MEX_APPCHECK_SITE_KEY = '<SITE_KEY_V3_PUBLICA>';
  const v2Key = String(g.MEX_RECAPTCHA_V2_SITE_KEY || '').trim();
  const acKey = String(g.MEX_APPCHECK_SITE_KEY || '').trim();
  if (!acKey || (v2Key && acKey === v2Key)) {
=======
  // ── App Check (reCAPTCHA v3 / Enterprise) — site key PÚBLICA aparte ─
  // Firebase Console → App Check → app web → proveedor reCAPTCHA (v3).
  // NO reutilices la site key v2 del login aquí (son productos distintos).
  // Dejar vacío = App Check desactivado en cliente (recomendado en /login).
  // Override: window.MEX_APPCHECK_SITE_KEY antes de cargar este archivo.
  if (g.MEX_APPCHECK_SITE_KEY == null) {
>>>>>>> Stashed changes
    g.MEX_APPCHECK_SITE_KEY = '';
  }
  // 'v3' → ReCaptchaV3Provider | 'enterprise' → ReCaptchaEnterpriseProvider
  if (g.MEX_APPCHECK_PROVIDER == null || String(g.MEX_APPCHECK_PROVIDER).trim() === '') {
    g.MEX_APPCHECK_PROVIDER = 'v3';
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
