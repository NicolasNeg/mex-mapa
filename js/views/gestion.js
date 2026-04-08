// ═══════════════════════════════════════════════════════════
//  js/views/gestion.js  —  ES6 Module
//  Controlador de la vista /gestion
// ═══════════════════════════════════════════════════════════

import { auth } from '/js/core/database.js';

// Verificar sesión — redirigir a /login si no hay usuario
auth.onAuthStateChanged((user) => {
  if (!user) {
    window.location.replace('/login');
  }
});
