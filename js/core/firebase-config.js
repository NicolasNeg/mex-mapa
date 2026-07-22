// ÔöÇÔöÇÔöÇ Firebase Web SDK ÔÇö configuraci├│n cliente (p├║blica por dise├▒o) ÔöÇÔöÇÔöÇ
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

  // ÔöÇÔöÇ Login gate: reCAPTCHA v2 checkbox ("No soy un robot") ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  // Site key P├ÜBLICA del widget checkbox. Secreto de servidor: RECAPTCHA_V2_SECRET
  // (functions config recaptcha.v2_secret). Ver docs/app-check.md.
  // IMPORTANTE: esta clave es v2 ÔÇö NO sirve para App Check (necesita v3 distinta).
  if (g.MEX_RECAPTCHA_V2_SITE_KEY == null || String(g.MEX_RECAPTCHA_V2_SITE_KEY).trim() === '') {
    g.MEX_RECAPTCHA_V2_SITE_KEY = '6Lf1714tAAAAAK3wyyOhB8nCk6JRh7uwIFlR6ufC';
  }

  // ÔöÇÔöÇ App Check (reCAPTCHA v3) ÔÇö solo site key P├ÜBLICA distinta de v2 ÔöÇ
  // Firebase Console ÔåÆ App Check ÔåÆ app web "mapGestion" ÔåÆ reCAPTCHA (v3).
  // NO reutilices la site key v2 del login: provoca appCheck/recaptcha-error.
  // Vac├¡o = App Check omitido (app funciona; enforcement sigue en observaci├│n).
  // Override: window.MEX_APPCHECK_SITE_KEY = '<SITE_KEY_V3_PUBLICA>';
  const v2Key = String(g.MEX_RECAPTCHA_V2_SITE_KEY || '').trim();
  const acKey = String(g.MEX_APPCHECK_SITE_KEY || '').trim();
  if (!acKey || (v2Key && acKey === v2Key)) {
    g.MEX_APPCHECK_SITE_KEY = '';
  }
  // 'v3' ÔåÆ ReCaptchaV3Provider | 'enterprise' ÔåÆ ReCaptchaEnterpriseProvider
  if (g.MEX_APPCHECK_PROVIDER == null || String(g.MEX_APPCHECK_PROVIDER).trim() === '') {
    g.MEX_APPCHECK_PROVIDER = 'v3';
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
