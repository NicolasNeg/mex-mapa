// ═══════════════════════════════════════════════════════════
//  mapa/features/extras/ocr.js
//  Reconocimiento de placas mediante OCR (Tesseract / Vision API).
//  Gate: window.mexFeatures.puedeUsar('ia_placas')
//
//  Extraído de js/views/mapa.js Fase 4.
//  Dependencias externas (todas via window):
//    - window.api.analizarPlacaVisionAPI
//    - window.notificarRespuestaIA
//    - window.expandirTerminal
//    - window.ultimoMVA_MEXIA (escribe)
// ═══════════════════════════════════════════════════════════

export async function procesarImagenOCR(event) {
  const file = event.target.files[0];
  if (!file) return;

  window.notificarRespuestaIA?.('Procesando placa... por favor espera.');

  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.src = e.target.result;
    img.onload = function () {
      const canvas = document.createElement('canvas');
      const ctx    = canvas.getContext('2d');
      const MAX_WIDTH = 1000;
      let width  = img.width;
      let height = img.height;
      if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
      canvas.width  = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      const compressedBase64 = canvas.toDataURL('image/jpeg', 0.6);

      window.api.analizarPlacaVisionAPI(compressedBase64)
        .then(textoDetectado => ejecutarLogicaOCR(textoDetectado))
        .catch(() => window.notificarRespuestaIA?.('Error de comunicación con la cámara.'));
    };
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

export function ejecutarLogicaOCR(textoDetectado) {
  if (!textoDetectado || textoDetectado === 'NO_TEXT_FOUND' || textoDetectado.startsWith('ERROR')) {
    return window.notificarRespuestaIA?.('No logré leer la placa. Intenta de nuevo.');
  }

  const tokensOCR = textoDetectado.toUpperCase().split(/\s+/).map(p => p.replace(/[^A-Z0-9]/gi, ''));
  const todosLosAutos = Array.from(document.querySelectorAll('.car'));
  let carNode = null;

  for (const car of todosLosAutos) {
    const placaDB = (car.dataset.placas || '').toUpperCase().replace(/[^A-Z0-9]/gi, '');
    if (placaDB.length < 4) continue;
    if (tokensOCR.some(token => token.includes(placaDB) || (token.length >= 5 && placaDB.includes(token)))) {
      carNode = car;
      break;
    }
  }

  if (carNode) {
    window.ultimoMVA_MEXIA = carNode.dataset.mva;
    carNode.classList.add('car-focus');
    setTimeout(() => carNode.classList.remove('car-focus'), 5000);
    window.notificarRespuestaIA?.(`Identificado: ${carNode.dataset.mva}. ¿Qué orden tienes?`);
    window.expandirTerminal?.();
  } else {
    window.notificarRespuestaIA?.('Placa no registrada en el patio.');
  }
}
