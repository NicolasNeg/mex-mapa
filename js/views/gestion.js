// js/views/gestion.js
// La lógica del panel administrativo está en mapa.js (cargado como módulo en gestion.html).
// Este archivo solo maneja el redirect de auth antes de que mapa.js cargue.
import { auth } from '/js/core/database.js';

auth.onAuthStateChanged((user) => {
  if (!user) {
    window.location.replace('/login');
  }
});
