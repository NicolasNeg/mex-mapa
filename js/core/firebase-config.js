// ─── Firebase Web SDK — configuración cliente (pública por diseño) ───
// No incluir service accounts, tokens de servidor ni secretos.
// Same-origin; ver docs/security-client-config-audit.md
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
})(typeof globalThis !== 'undefined' ? globalThis : window);
