// js/views/mensajes.js
// Shell y chat son montados por mapa.js (_mountMessagesShell) cuando detecta _isMessagesMode().
import { auth } from '/js/core/database.js';

auth.onAuthStateChanged((user) => {
  if (!user) {
    window.location.replace('/login');
  }
});
