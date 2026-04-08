// ═══════════════════════════════════════════════════════════
//  js/views/cuadre.js  —  ES6 Module
//  Controlador de la vista /cuadre
// ═══════════════════════════════════════════════════════════

import { auth } from '/js/core/database.js';

// Verificar sesión — redirigir a /login si no hay usuario
auth.onAuthStateChanged((user) => {
  if (!user) {
    window.location.replace('/login');
  }
});
