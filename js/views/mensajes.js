// js/views/mensajes.js
// Redirect de auth — la UI del chat la carga mapa.js detectando _isMessagesMode()
import { auth } from '/js/core/database.js';

auth.onAuthStateChanged((user) => {
  if (!user) {
    window.location.replace('/login');
  }
});
