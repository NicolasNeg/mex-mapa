// Feature gates — producto single-tenant arrendadora.
// Sin planes: todas las features están habilitadas. Se conserva la API
// window.mexFeatures.puedeUsar() para no romper llamadas existentes.
(function () {
  'use strict';
  window.mexFeatures = {
    puedeUsar() { return true; },
    limite() { return -1; }, // sin límites
  };
})();
