// ═══════════════════════════════════════════════════════════
//  /js/app/app-cache.js
//  Precalentamiento compartido del App Shell.
//  Objetivo: que las vistas entren con snapshot visible y luego
//  sus listeners reales refresquen en segundo plano.
// ═══════════════════════════════════════════════════════════

import { db, COL, obtenerDatosParaMapa, obtenerEstructuraMapa } from '/js/core/database.js';
import { getCuadreSnapshot, writeCuadreCache } from '/js/app/features/cuadre/cuadre-data.js';
import { normalizeIncidencia, writeIncidenciasCache } from '/js/app/features/incidencias/incidencias-data.js';

const MAP_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const WARM_MIN_INTERVAL_MS = 75 * 1000;
const SECONDARY_PLAZA_DELAY_MS = 650;

const VIEW_MODULES = [
  '/js/app/views/dashboard.js',
  '/js/app/views/mapa.js',
  '/js/app/views/incidencias.js',
  '/js/app/views/alertas.js',
  '/js/app/views/profile.js',
  '/js/app/views/cuadrarflota.js',
  '/js/app/views/unidades.js'
];

const VIEW_STYLES = [
  '/css/app-dashboard.css',
  '/css/app-mapa.css',
  '/css/app-incidencias.css',
  '/css/app-alertas.css',
  '/css/app-profile.css',
  '/css/app-cuadrarflota.css',
  '/css/app-unidades.css'
];

let _assetsWarmed = false;
const _warmInflight = new Map();

function _safeUp(value) {
  return String(value || '').trim().toUpperCase();
}

function _unique(values = []) {
  const out = [];
  const seen = new Set();
  values.forEach(value => {
    const normalized = _safeUp(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });
  return out;
}

function _delay(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function _mapCacheKey(plaza) {
  return `mex.app.mapa.visible-snapshot.${_safeUp(plaza)}`;
}

function _dashMapCacheKey(plaza) {
  return `mex.app.dashboard.visible-map.${_safeUp(plaza)}`;
}

function _warmMarkerKey(plaza) {
  return `mex.app.cache.warmed.${_safeUp(plaza)}`;
}

function _readJson(key) {
  try {
    const raw = sessionStorage.getItem(key) || localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function _writeBoth(key, value) {
  try {
    const raw = JSON.stringify(value);
    sessionStorage.setItem(key, raw);
    localStorage.setItem(key, raw);
  } catch (_) {}
}

function _isFreshMarker(plaza) {
  const marker = _readJson(_warmMarkerKey(plaza));
  return marker && Date.now() - Number(marker.at || 0) < WARM_MIN_INTERVAL_MS;
}

function _markWarmed(plaza, detail = {}) {
  _writeBoth(_warmMarkerKey(plaza), {
    at: Date.now(),
    plaza: _safeUp(plaza),
    ...detail
  });
}

function _writeMapCaches(plaza, payload = {}) {
  const plazaUp = _safeUp(plaza);
  const resolvedPlaza = _safeUp(payload.resolvedPlaza || plazaUp);
  const units = Array.isArray(payload.units) ? payload.units : [];
  const structure = Array.isArray(payload.structure) ? payload.structure : [];
  if (!plazaUp || (!units.length && !structure.length)) return;

  _writeBoth(_mapCacheKey(plazaUp), {
    savedAt: Date.now(),
    plaza: plazaUp,
    lastUpdated: Date.now(),
    units: units.slice(0, 900),
    structure: structure.slice(0, 1200)
  });

  _writeBoth(_dashMapCacheKey(plazaUp), {
    savedAt: Date.now(),
    plaza: plazaUp,
    resolvedPlaza,
    unidades: units.slice(0, 650),
    estructura: structure.slice(0, 800)
  });
}

function _hasFreshMapCache(plaza) {
  const cached = _readJson(_mapCacheKey(plaza));
  if (!cached || !Array.isArray(cached.units) || !Array.isArray(cached.structure)) return false;
  return Date.now() - Number(cached.savedAt || 0) < MAP_CACHE_TTL_MS;
}

function _prefetchStyle(href) {
  if (!href || document.querySelector(`link[data-app-cache-style="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'style';
  link.href = href;
  link.dataset.appCacheStyle = href;
  document.head.appendChild(link);
}

export function warmAppAssets() {
  if (_assetsWarmed) return Promise.resolve();
  _assetsWarmed = true;
  VIEW_STYLES.forEach(_prefetchStyle);
  return Promise.allSettled(VIEW_MODULES.map(src => import(src))).then(() => undefined);
}

async function _warmMap(plaza, { force = false } = {}) {
  const plazaUp = _safeUp(plaza);
  if (!plazaUp) return null;
  if (!force && _hasFreshMapCache(plazaUp)) return _readJson(_mapCacheKey(plazaUp));

  const [structure, mapData] = await Promise.all([
    obtenerEstructuraMapa(plazaUp),
    obtenerDatosParaMapa(plazaUp)
  ]);
  const units = Array.isArray(mapData?.unidades) ? mapData.unidades : [];
  const normalizedStructure = Array.isArray(structure) ? structure : [];
  _writeMapCaches(plazaUp, {
    resolvedPlaza: plazaUp,
    units,
    structure: normalizedStructure
  });
  return { plaza: plazaUp, units, structure: normalizedStructure };
}

async function _warmCuadre(plaza) {
  const plazaUp = _safeUp(plaza);
  if (!plazaUp) return [];
  const rows = await getCuadreSnapshot(plazaUp);
  writeCuadreCache(plazaUp, rows);
  return rows;
}

async function _warmIncidencias(plaza) {
  const plazaUp = _safeUp(plaza);
  if (!plazaUp) return [];
  try {
    const snap = await db.collection(COL.NOTAS)
      .where('plaza', '==', plazaUp)
      .orderBy('timestamp', 'desc')
      .limit(300)
      .get();
    const rows = snap.docs.map(doc => normalizeIncidencia(doc.id, doc.data()));
    writeIncidenciasCache(plazaUp, rows);
    return rows;
  } catch (error) {
    const fallback = await db.collection(COL.NOTAS)
      .where('plaza', '==', plazaUp)
      .limit(300)
      .get()
      .catch(() => null);
    const rows = fallback?.docs?.map(doc => normalizeIncidencia(doc.id, doc.data())) || [];
    if (rows.length) writeIncidenciasCache(plazaUp, rows);
    return rows;
  }
}

async function _warmPlaza(plaza, options = {}) {
  const plazaUp = _safeUp(plaza);
  if (!plazaUp) return null;
  if (!options.force && _isFreshMarker(plazaUp)) {
    return { plaza: plazaUp, skipped: true };
  }
  const key = `${plazaUp}:${options.force ? 'force' : 'normal'}`;
  if (_warmInflight.has(key)) return _warmInflight.get(key);

  const job = Promise.allSettled([
    _warmMap(plazaUp, options),
    _warmCuadre(plazaUp),
    _warmIncidencias(plazaUp)
  ]).then(results => {
    _markWarmed(plazaUp, {
      ok: results.filter(item => item.status === 'fulfilled').length,
      fail: results.filter(item => item.status === 'rejected').length
    });
    window.dispatchEvent(new CustomEvent('mex:app-cache-update', {
      detail: { plaza: plazaUp, results }
    }));
    return { plaza: plazaUp, results };
  }).finally(() => {
    _warmInflight.delete(key);
  });

  _warmInflight.set(key, job);
  return job;
}

function _plazaQueue(state = {}) {
  return _unique([
    state.currentPlaza,
    state.profile?.plazaAsignada,
    state.profile?.plaza,
    ...(Array.isArray(state.availablePlazas) ? state.availablePlazas : [])
  ]);
}

export async function warmAppData(state = {}, options = {}) {
  const queue = _plazaQueue(state);
  const primary = queue[0];
  if (!primary) return null;

  const first = await _warmPlaza(primary, options);
  const rest = queue.slice(1);
  if (rest.length) {
    (async () => {
      for (const plaza of rest) {
        await _delay(SECONDARY_PLAZA_DELAY_MS);
        await _warmPlaza(plaza, { ...options, force: false }).catch(() => null);
      }
    })();
  }
  return first;
}

export function getAppCacheStatus(state = {}) {
  const plazas = _plazaQueue(state);
  return plazas.map(plaza => ({
    plaza,
    warmed: _readJson(_warmMarkerKey(plaza)),
    map: _readJson(_mapCacheKey(plaza))?.savedAt || 0,
    dashboard: _readJson(_dashMapCacheKey(plaza))?.savedAt || 0
  }));
}
