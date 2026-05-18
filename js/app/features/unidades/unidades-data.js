import { db } from '/js/core/database.js';
import { getCsvColumnas, normalizarFila } from '/js/app/features/onboarding/onboarding-config.js';

const COL_EMPRESAS = 'empresas';
const SUB_UNIDADES = 'unidades';

function _fv() {
  return window.firebase?.firestore?.FieldValue?.serverTimestamp?.() || Date.now();
}

function _unidadesRef(empresaId) {
  return db.collection(COL_EMPRESAS).doc(empresaId).collection(SUB_UNIDADES);
}

export function onUnidades(empresaId, callback) {
  if (!empresaId) { callback([]); return () => {}; }
  return _unidadesRef(empresaId)
    .where('estado', '!=', 'INACTIVO')
    .onSnapshot(
      snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => {
        console.warn('[unidades] onSnapshot:', err?.message);
        callback([]);
      }
    );
}

export async function getUnidades(empresaId) {
  if (!empresaId) return [];
  const snap = await _unidadesRef(empresaId)
    .where('estado', '!=', 'INACTIVO')
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function crearUnidad(empresaId, unitData) {
  if (!empresaId) throw new Error('empresaId requerido');
  const doc = {
    ...unitData,
    empresaId,
    estado: 'ACTIVO',
    creadoEn: _fv(),
  };
  const ref = await _unidadesRef(empresaId).add(doc);
  return ref.id;
}

export async function actualizarUnidad(empresaId, unitId, fields) {
  if (!empresaId || !unitId) throw new Error('empresaId y unitId requeridos');
  await _unidadesRef(empresaId).doc(unitId).update(fields);
}

export async function eliminarUnidad(empresaId, unitId) {
  if (!empresaId || !unitId) throw new Error('empresaId y unitId requeridos');
  await _unidadesRef(empresaId).doc(unitId).update({ estado: 'INACTIVO' });
}

export async function buscarUnidad(empresaId, query) {
  const q = String(query || '').toUpperCase().trim();
  if (!q) return [];
  const all = await getUnidades(empresaId);
  return all.filter(u => {
    const mva = String(u.mva || '').toUpperCase();
    const placas = String(u.placas || '').toUpperCase();
    const vin = String(u.vin || '').toUpperCase();
    return mva.startsWith(q) || mva.includes(q)
      || placas.startsWith(q) || placas.includes(q)
      || vin.startsWith(q) || vin.includes(q);
  });
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

export async function importarCsv(empresaId, csvText, tipoNegocio) {
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
      const ref = _unidadesRef(empresaId).doc();
      batch.set(ref, {
        ...unitData,
        empresaId,
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

export async function importarDesdeArchivo(empresaId, file, tipoNegocio) {
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
        const result = await importarCsv(empresaId, e.target.result, tipoNegocio);
        resolve({ ok: true, ...result });
      } catch (err) {
        resolve({ ok: false, errorTipo: 'parse_error', mensaje: err.message || 'Error al procesar CSV', total: 0, importados: 0, errores: [] });
      }
    };
    reader.onerror = () => resolve({ ok: false, errorTipo: 'read_error', mensaje: 'No se pudo leer el archivo', total: 0, importados: 0, errores: [] });
    reader.readAsText(file, 'UTF-8');
  });
}
