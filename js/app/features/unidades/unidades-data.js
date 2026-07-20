import { db, COL } from '/js/core/database.js';
import { getCsvColumnas, normalizarFila } from '/js/app/features/onboarding/onboarding-config.js';

const COL_UNIDADES = 'unidades_catalogo';

function _fv() {
  return window.firebase?.firestore?.FieldValue?.serverTimestamp?.() || Date.now();
}

function _unidadesRef() {
  return db.collection(COL_UNIDADES);
}

function _normKey(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function _unitPlazaKeys(u) {
  return [
    u?.plazaId,
    u?.plazaActual,
    u?.sucursal,
    u?.plaza,
    u?.ubicacionActual,
  ].map((x) => String(x || '').toUpperCase().trim()).filter(Boolean);
}

function _unitMatchesPlaza(u, plazaId) {
  if (!plazaId) return true;
  return _unitPlazaKeys(u).includes(plazaId);
}

export function onUnidades(callback) {
  return _unidadesRef()
    .where('estado', '!=', 'INACTIVO')
    .onSnapshot(
      snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => {
        console.warn('[unidades] onSnapshot:', err?.message);
        callback([]);
      }
    );
}

export async function getUnidades() {
  const snap = await _unidadesRef()
    .where('estado', '!=', 'INACTIVO')
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function crearUnidad(unitData) {
  const doc = {
    ...unitData,
    estado: 'ACTIVO',
    creadoEn: _fv(),
  };
  const ref = await _unidadesRef().add(doc);
  return ref.id;
}

export async function actualizarUnidad(unitId, fields) {
  if (!unitId) throw new Error('unitId requerido');
  await _unidadesRef().doc(unitId).update(fields);
}

export async function eliminarUnidad(unitId) {
  if (!unitId) throw new Error('unitId requerido');
  await _unidadesRef().doc(unitId).update({ estado: 'INACTIVO' });
}

let _unidadesCache = null;
let _unidadesCacheAt = 0;
let _indexCache = null;
let _indexCacheAt = 0;
const UNIDADES_CACHE_MS = 60_000;

/** Cache corto del catálogo onboarding (`unidades_catalogo`). */
export async function getUnidadesCached(force = false) {
  const now = Date.now();
  if (!force && _unidadesCache && (now - _unidadesCacheAt) < UNIDADES_CACHE_MS) {
    return _unidadesCache;
  }
  _unidadesCache = await getUnidades();
  _unidadesCacheAt = now;
  return _unidadesCache;
}

/**
 * Inventario operativo real (`index_unidades`) — misma fuente que /app/unidades y mapa buscador.
 */
export async function getIndexUnidadesCached(force = false) {
  const now = Date.now();
  if (!force && _indexCache && (now - _indexCacheAt) < UNIDADES_CACHE_MS) {
    return _indexCache;
  }
  const snap = await db.collection(COL.INDEX).get();
  _indexCache = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((u) => u && (u.mva || u.placas));
  _indexCacheAt = now;
  return _indexCache;
}

export function invalidateUnidadesCache() {
  _unidadesCache = null;
  _unidadesCacheAt = 0;
  _indexCache = null;
  _indexCacheAt = 0;
}

/**
 * Autocompletado de unidades (papeletas / forms).
 * Prioriza `index_unidades`; si está vacío, cae a `unidades_catalogo`.
 * @param {string} query
 * @param {{ limit?: number, plazaId?: string }} [opts]
 */
export async function buscarUnidad(query, opts = {}) {
  const limit = Math.max(1, Number(opts.limit) || 20);
  const plazaId = String(opts.plazaId || '').toUpperCase().trim();
  const qRaw = String(query || '').toUpperCase().trim();
  const q = _normKey(qRaw);

  let all = await getIndexUnidadesCached();
  if (!all.length) {
    try { all = await getUnidadesCached(); } catch (_) { all = []; }
  }

  // Sin query: sugerencias de la plaza activa (si hay).
  if (!q) {
    if (plazaId) {
      const inPlaza = all.filter((u) => _unitMatchesPlaza(u, plazaId));
      if (inPlaza.length) all = inPlaza;
    }
    return all.slice(0, limit);
  }

  // Con query: buscar en todo el índice (como mapa buscador); rankear plaza activa arriba.
  const scored = [];
  for (const u of all) {
    const mva = _normKey(u.mva || u.numeroEconomico || u.economico);
    const placas = _normKey(u.placas);
    const vin = _normKey(u.vin);
    const modelo = String(u.modelo || '').toUpperCase();
    const color = String(u.color || '').toUpperCase();
    let score = 0;
    if (mva === q || placas === q) score = 100;
    else if (mva.startsWith(q)) score = 90;
    else if (placas.startsWith(q)) score = 85;
    else if (mva.includes(q)) score = 70;
    else if (placas.includes(q)) score = 65;
    else if (modelo.includes(qRaw)) score = 50;
    else if (vin.includes(q)) score = 40;
    else if (color.includes(qRaw)) score = 20;
    if (score && plazaId && _unitMatchesPlaza(u, plazaId)) score += 5;
    if (score) scored.push({ u, score });
  }
  scored.sort((a, b) => b.score - a.score || String(a.u.mva || '').localeCompare(String(b.u.mva || '')));
  return scored.slice(0, limit).map((x) => x.u);
}

export function generarTemplateCsv(tipoNegocio) {
  const cols = getCsvColumnas(tipoNegocio);
  if (!cols.length) return '';
  const header = cols.map(c => c.etiqueta).join(',');

  const ex1 = cols.map(c => {
    if (c.key === 'mva') return 'MVA001';
    if (c.key === 'placas') return 'AAA-000';
    if (c.key === 'vin') return '1HGCM82633A004352';
    if (c.key === 'marca') return 'Toyota';
    if (c.key === 'modelo') return 'Corolla';
    if (c.key === 'anio') return '2022';
    if (c.key === 'color') return 'Blanco';
    return '';
  }).join(',');

  const ex2 = cols.map(c => {
    if (c.key === 'mva') return 'MVA002';
    if (c.key === 'placas') return 'BBB-111';
    if (c.key === 'vin') return '2T1BURHE0JC072969';
    if (c.key === 'marca') return 'Honda';
    if (c.key === 'modelo') return 'Civic';
    if (c.key === 'anio') return '2021';
    if (c.key === 'color') return 'Gris';
    return '';
  }).join(',');

  return [header, ex1, ex2].join('\n');
}

function _stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function _parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ',') { fields.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
  }
  fields.push(cur.trim());
  return fields;
}

function _normalizeColName(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s.#]+/g, '_');
}

export async function importarCsv(csvText, tipoNegocio) {
  const text = _stripBom(String(csvText || ''));
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');

  if (lines.length < 2) {
    return { total: 0, importados: 0, errores: [] };
  }

  const headerFields = _parseCsvLine(lines[0]).map(_normalizeColName);
  const validRows = [];
  const errorRows = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = _parseCsvLine(lines[i]);
    const rawRow = {};
    headerFields.forEach((col, idx) => {
      rawRow[col] = vals[idx] || '';
    });
    const result = normalizarFila(rawRow, tipoNegocio);
    if (result.valid) {
      validRows.push(result.data);
    } else {
      errorRows.push({ fila: i + 1, errores: result.errors });
    }
  }

  const BATCH_SIZE = 400;
  let importados = 0;

  for (let start = 0; start < validRows.length; start += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = validRows.slice(start, start + BATCH_SIZE);
    for (const unitData of chunk) {
      const ref = _unidadesRef().doc();
      batch.set(ref, {
        ...unitData,
        estado: 'ACTIVO',
        creadoEn: _fv(),
      });
    }
    await batch.commit();
    importados += chunk.length;
  }

  return {
    total: lines.length - 1,
    importados,
    errores: errorRows,
  };
}

export async function importarDesdeArchivo(file, tipoNegocio) {
  if (!file) return { ok: false, errorTipo: 'no_file', mensaje: 'No se proporcionó archivo', total: 0, importados: 0, errores: [] };

  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return {
      ok: false,
      errorTipo: 'xlsx_not_supported',
      mensaje: 'Exporta el archivo como CSV (.csv) desde Excel o Google Sheets',
      total: 0,
      importados: 0,
      errores: [],
    };
  }

  if (!name.endsWith('.csv') && !name.endsWith('.txt')) {
    return {
      ok: false,
      errorTipo: 'tipo_no_soportado',
      mensaje: 'Solo se aceptan archivos .csv o .txt',
      total: 0,
      importados: 0,
      errores: [],
    };
  }

  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const result = await importarCsv(e.target.result, tipoNegocio);
        resolve({ ok: true, ...result });
      } catch (err) {
        resolve({ ok: false, errorTipo: 'parse_error', mensaje: err.message || 'Error al procesar CSV', total: 0, importados: 0, errores: [] });
      }
    };
    reader.onerror = () => resolve({ ok: false, errorTipo: 'read_error', mensaje: 'No se pudo leer el archivo', total: 0, importados: 0, errores: [] });
    reader.readAsText(file, 'UTF-8');
  });
}
