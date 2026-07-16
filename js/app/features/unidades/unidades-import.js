// ============================================================================
//  unidades-import.js — Parseo CSV / Excel y mapeo de columnas
// ============================================================================

const HEADER_ALIASES = {
  id: ['id', 'fila', 'unidad id'],
  clase: ['clase', 'categoria', 'categoría', 'tipo', 'class'],
  vin: ['vin', 'serie', 'numero serie', 'número serie'],
  anio: ['año', 'anio', 'ano', 'year'],
  marca: ['marca', 'brand'],
  modelo: ['modelo', 'model'],
  mva: ['mva', 'numero economico', 'número económico', 'num economico', 'no economico', 'unidad', 'economico', 'económico'],
  placas: ['placas', 'placa', 'plates'],
  sucursal: ['sucursal', 'plaza', 'locacion propietaria', 'locación propietaria', 'ubicacion propietaria'],
  plazaActual: ['plaza actual', 'locacion actual', 'locación actual', 'ubicacion actual', 'ubicación actual'],
  estado: ['estatus', 'estado', 'status'],
  activo: ['activo', 'active'],
  color: ['color'],
  gasolina: ['gasolina', 'tanque gasolina', 'gas', 'combustible'],
  capacidadTanque: ['capacidad tanque', 'tanque litros', 'litros tanque', 'lts tanque', 'capacidad lts', 'capacidad litros'],
  km: ['km', 'kilometraje', 'kilómetros', 'kilometros'],
  descripcion: ['descripcion', 'descripción', 'notas', 'nota', 'observaciones']
};

export const IMPORT_FIELD_OPTIONS = [
  { key: '', label: '— Ignorar —' },
  { key: 'mva', label: 'Número económico' },
  { key: 'vin', label: 'VIN' },
  { key: 'clase', label: 'Clase' },
  { key: 'anio', label: 'Año' },
  { key: 'marca', label: 'Marca' },
  { key: 'modelo', label: 'Modelo' },
  { key: 'placas', label: 'Placas' },
  { key: 'sucursal', label: 'Loc. propietaria' },
  { key: 'plazaActual', label: 'Loc. actual' },
  { key: 'estado', label: 'Estatus' },
  { key: 'activo', label: 'Activo' },
  { key: 'color', label: 'Color' },
  { key: 'capacidadTanque', label: 'Capacidad tanque (L)' },
  { key: 'km', label: 'Kilometraje' },
  { key: 'descripcion', label: 'Descripción' }
];

const MAP_STORAGE_KEY = 'uni-import-column-map';

function deaccent(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function headerKey(value) {
  const raw = deaccent(String(value || '').toLowerCase().trim());
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.map(a => deaccent(a.toLowerCase())).includes(raw)) return key;
  }
  return '';
}

export function loadSavedMapping() {
  try {
    return JSON.parse(localStorage.getItem(MAP_STORAGE_KEY) || '{}');
  } catch (_) {
    return {};
  }
}

export function saveMapping(mapping) {
  try {
    localStorage.setItem(MAP_STORAGE_KEY, JSON.stringify(mapping || {}));
  } catch (_) {}
}

export async function loadXlsxLibrary() {
  if (typeof window !== 'undefined' && window.XLSX) return window.XLSX;
  await new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-uni-xlsx="1"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', reject, { once: true });
      if (window.XLSX) resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    s.dataset.uniXlsx = '1';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar el lector Excel.'));
    document.head.appendChild(s);
  });
  if (!window.XLSX) throw new Error('Lector Excel no disponible.');
  return window.XLSX;
}

export async function readSpreadsheetFile(file) {
  const XLSX = await loadXlsxLibrary();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { matrix: [], sheetName: '' };
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
    .map(row => (Array.isArray(row) ? row : []).map(cell => String(cell ?? '').trim()))
    .filter(row => row.some(Boolean));
  return { matrix, sheetName };
}

export function analyzeMatrix(matrix) {
  if (!matrix.length) {
    return { headers: [], body: [], hasHeader: false, mapping: {} };
  }
  const first = matrix[0].map(c => String(c ?? '').trim());
  const keys = first.map(headerKey);
  const hasHeader = keys.some(Boolean) && first.some(c => /mva|modelo|placa|vin|econom/i.test(c));
  const headers = hasHeader ? first : first.map((_, i) => `Columna ${i + 1}`);
  const body = hasHeader ? matrix.slice(1) : matrix;
  const mapping = buildAutoMapping(hasHeader ? keys : headers.length, hasHeader ? keys : null);
  return { headers, body, hasHeader, mapping };
}

function buildAutoMapping(countOrKeys, keys = null) {
  const saved = loadSavedMapping();
  const mapping = {};
  if (keys) {
    keys.forEach((k, i) => {
      mapping[i] = saved[i] || k || '';
    });
    return mapping;
  }
  const positional = ['mva', 'modelo', 'placas', 'clase', 'sucursal', 'plazaActual', 'estado', 'vin', 'anio', 'marca'];
  const len = typeof countOrKeys === 'number' ? countOrKeys : positional.length;
  for (let i = 0; i < len; i += 1) {
    mapping[i] = saved[i] || positional[i] || '';
  }
  return mapping;
}

export function applyMapping(body, mapping) {
  return body.map(cols => {
    const out = {};
    Object.entries(mapping || {}).forEach(([idx, key]) => {
      const k = String(key || '').trim();
      if (!k) return;
      out[k] = String(cols[Number(idx)] ?? '').trim();
    });
    return out;
  }).filter(row => row.mva);
}

export function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (!quoted && (ch === ',' || ch === '\t' || ch === ';')) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parseDelimitedText(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return { headers: [], body: [], hasHeader: false, mapping: {} };
  const matrix = lines.map(splitCsvLine).filter(r => r.some(Boolean));
  return analyzeMatrix(matrix);
}

function _loadScript(src, datasetKey) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-${datasetKey}="1"]`);
    if (existing) {
      if (existing.dataset.ready === '1') return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.dataset[datasetKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = '1';
    // data-uni-tesseract style
    s.setAttribute(`data-${datasetKey}`, '1');
    s.onload = () => { s.dataset.ready = '1'; resolve(); };
    s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(s);
  });
}

async function loadTesseract() {
  if (window.Tesseract) return window.Tesseract;
  await _loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js', 'uni-tesseract');
  if (!window.Tesseract) throw new Error('OCR no disponible.');
  return window.Tesseract;
}

async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'uni-pdfjs');
  const lib = window.pdfjsLib;
  if (!lib) throw new Error('Lector PDF no disponible.');
  lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return lib;
}

/** Limpia ruido típico de OCR y deja líneas tabulables. */
export function normalizeOcrText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[|¦]/g, '\t')
    .replace(/ {2,}/g, '\t')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .join('\n');
}

export async function extractTextFromImageFile(file, onProgress) {
  const Tesseract = await loadTesseract();
  const result = await Tesseract.recognize(file, 'spa+eng', {
    logger: (m) => {
      if (m?.status === 'recognizing text' && typeof onProgress === 'function') {
        onProgress(Math.round((m.progress || 0) * 100));
      }
    }
  });
  return normalizeOcrText(result?.data?.text || '');
}

export async function extractTextFromPdfFile(file, onProgress) {
  const pdfjs = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    if (typeof onProgress === 'function') {
      onProgress(Math.round((i / doc.numPages) * 100));
    }
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = (content.items || []).map(it => it.str || '').join(' ');
    pages.push(line);
  }
  return normalizeOcrText(pages.join('\n'));
}

/**
 * Intenta convertir texto OCR en matriz (filas/columnas).
 * Si no hay delimitadores claros, parte por espacios múltiples.
 */
export function matrixFromOcrText(text) {
  const cleaned = normalizeOcrText(text);
  if (!cleaned) return { headers: [], body: [], hasHeader: false, mapping: {} };
  // Preferir parseo CSV/TSV si hay comas/tabs.
  if (/[,\t;]/.test(cleaned)) return parseDelimitedText(cleaned);
  const lines = cleaned.split(/\n/).filter(Boolean);
  const matrix = lines.map(line => line.split(/\s{2,}|\t+/).map(c => c.trim()).filter(Boolean));
  return analyzeMatrix(matrix.filter(r => r.length >= 2));
}

