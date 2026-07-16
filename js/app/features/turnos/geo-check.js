// ═══════════════════════════════════════════════════════════
//  geo-check.js — coords + reverse geocode + soft-warn plaza
//  Nominatim pattern from CHECADOR assets/js/geo.js
// ═══════════════════════════════════════════════════════════

const GEO_WARN_METROS = 500;
const cache = new Map();

const key = (lat, lon) => `${lat.toFixed(4)},${lon.toFixed(4)}`;

export const mapsLink = (lat, lon) => `https://www.google.com/maps?q=${lat},${lon}`;

export function direccionDesdeCoords(lat, lon) {
  if (lat == null || lon == null) return Promise.resolve(null);
  const k = key(lat, lon);
  if (cache.has(k)) return cache.get(k);

  const p = (async () => {
    try {
      const guardada = sessionStorage.getItem('tu_dir_' + k);
      if (guardada) return guardada;
    } catch (_) {}
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=es`,
        { headers: { Accept: 'application/json' } }
      );
      if (!r.ok) return null;
      const d = await r.json();
      const a = d.address || {};
      const calle = [a.road, a.house_number].filter(Boolean).join(' ');
      const texto = [
        calle || a.neighbourhood || a.suburb,
        a.city || a.town || a.village || a.municipality || a.county,
        a.state,
      ].filter(Boolean).join(', ') || d.display_name || null;
      if (texto) {
        try { sessionStorage.setItem('tu_dir_' + k, texto); } catch (_) {}
      }
      return texto;
    } catch {
      return null;
    }
  })();

  cache.set(k, p);
  return p;
}

/** Distancia en metros (haversine). */
export function distanciaMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Lee lat/lon de un objeto plaza (plazasDetalle u otro). */
export function coordsPlaza(plazaId) {
  const id = String(plazaId || '').toUpperCase().trim();
  if (!id) return null;
  const detalle = window.MEX_CONFIG?.empresa?.plazasDetalle
    || window._empresaActual?.plazasDetalle
    || [];
  const plaza = (Array.isArray(detalle) ? detalle : []).find(
    (p) => String(p?.id || p?.plazaId || '').toUpperCase().trim() === id
  );
  if (!plaza) return null;
  const lat = Number(
    plaza.lat ?? plaza.latitude ?? plaza.latitud ?? plaza.coords?.lat ?? plaza.geo?.lat
  );
  const lon = Number(
    plaza.lon ?? plaza.lng ?? plaza.longitude ?? plaza.longitud ?? plaza.coords?.lon ?? plaza.coords?.lng ?? plaza.geo?.lon
  );
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

/**
 * Obtiene ubicación actual.
 * Prefiere el snapshot global de la app; fallback getCurrentPosition.
 */
export async function obtenerUbicacion({ force = false, timeoutMs = 12000 } = {}) {
  if (typeof window.__mexGetExactLocationSnapshot === 'function') {
    try {
      const snap = await window.__mexGetExactLocationSnapshot({ force, maxAgeMs: force ? 0 : 60_000 });
      const el = snap?.exactLocation;
      const lat = Number(el?.latitude);
      const lon = Number(el?.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return {
          lat,
          lon,
          accuracy: Number(el.accuracy || 0),
          status: snap.status || 'granted',
        };
      }
    } catch (_) {}
  }

  if (!navigator.geolocation) {
    return { lat: null, lon: null, accuracy: 0, status: 'bloqueada' };
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy || 0,
          status: 'granted',
        });
      },
      () => resolve({ lat: null, lon: null, accuracy: 0, status: 'bloqueada' }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 }
    );
  });
}

/**
 * Evalúa soft-warn vs plaza. No bloquea.
 * @returns {{ geoWarn: boolean, distanciaPlazaM: number|null, direccion: string|null }}
 */
export async function evaluarGeoPlaza(lat, lon, plazaId) {
  let direccion = null;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    direccion = await direccionDesdeCoords(lat, lon);
  }

  const plaza = coordsPlaza(plazaId);
  let distanciaPlazaM = null;
  let geoWarn = false;
  if (plaza && Number.isFinite(lat) && Number.isFinite(lon)) {
    distanciaPlazaM = Math.round(distanciaMetros(lat, lon, plaza.lat, plaza.lon));
    geoWarn = distanciaPlazaM > GEO_WARN_METROS;
  }

  return { geoWarn, distanciaPlazaM, direccion, umbralM: GEO_WARN_METROS };
}

export { GEO_WARN_METROS };
