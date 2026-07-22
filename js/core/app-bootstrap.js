(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const root = window;
  const DEFAULT_COMPANY_NAME = 'EMPRESA';
  const SESSION_BOOTSTRAP_CONFIG_KEY = 'mex.bootstrap.baseConfig.v1';
  const LOCAL_BOOTSTRAP_CONFIG_KEY = 'mex.bootstrap.baseConfig.local.v1';
  const SESSION_BOOTSTRAP_WARM_KEY = 'mex.bootstrap.warm.v1';
  const SESSION_PROFILE_CACHE_PREFIX = 'mex.bootstrap.profile.v1.';
  const LOCAL_PROFILE_CACHE_PREFIX = 'mex.bootstrap.profile.local.v1.';
  const PROFILE_CACHE_TTL_MS = 120000;
  const SESSION_REVERSE_GEOCODE_KEY = 'mex.location.reverse.v1';
  const SESSION_ACTIVE_PLAZA_KEY = 'mex.activePlaza.v1';
  const LOCAL_ACTIVE_PLAZA_KEY = 'mex.activePlaza.local.v1';
  const BOOTSTRAP_PROGRAMMER_EMAILS = Object.freeze([
    'angelarmentta@icloud.com',
    'armentanegreteangelnicolas@gmail.com'
  ]);
  const DEFAULT_LISTS = {
    ubicaciones: [],
    estados: [],
    gasolinas: [],
    categorias: []
  };

  const state = root.__mexBootstrapState || (root.__mexBootstrapState = {
    overlayAttached: false,
    started: false,
    resolved: false,
    shortcutsBound: false,
    cache: new Map(),
    location: {
      status: 'pending',
      exactLocation: null,
      lastUpdated: 0,
      error: '',
      watchId: null,
      pendingPromise: null,
      permissionPollTimer: null
    }
  });

  function safeText(value) {
    return String(value || '').trim();
  }

  function safeJsonParse(raw, fallback = null) {
    try {
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function readSessionItem(key, fallback = null) {
    try {
      return safeJsonParse(sessionStorage.getItem(key), fallback);
    } catch (_) {
      return fallback;
    }
  }

  function writeSessionItem(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  function readLocalItem(key, fallback = null) {
    try {
      return safeJsonParse(localStorage.getItem(key), fallback);
    } catch (_) {
      return fallback;
    }
  }

  function writeLocalItem(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  function markBootstrapWarm() {
    try {
      sessionStorage.setItem(SESSION_BOOTSTRAP_WARM_KEY, '1');
    } catch (_) {}
  }

  function clearBootstrapWarm() {
    try {
      sessionStorage.removeItem(SESSION_BOOTSTRAP_WARM_KEY);
      sessionStorage.removeItem(SESSION_BOOTSTRAP_CONFIG_KEY);
      localStorage.removeItem(LOCAL_BOOTSTRAP_CONFIG_KEY);
    } catch (_) {}
  }

  function readCachedBaseConfig() {
    const cached = readSessionItem(SESSION_BOOTSTRAP_CONFIG_KEY, null)
      || readLocalItem(LOCAL_BOOTSTRAP_CONFIG_KEY, null);
    if (!cached || typeof cached !== 'object') return null;
    return normalizeConfig(cached);
  }

  function persistCachedBaseConfig(config = {}) {
    const normalized = normalizeConfig(config);
    const wroteSession = writeSessionItem(SESSION_BOOTSTRAP_CONFIG_KEY, normalized);
    writeLocalItem(LOCAL_BOOTSTRAP_CONFIG_KEY, normalized);
    if (wroteSession) {
      markBootstrapWarm();
    }
    return normalized;
  }

  function upperText(value) {
    return safeText(value).toUpperCase();
  }

  function lowerText(value) {
    return safeText(value).toLowerCase();
  }

  function safeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function coerceTimestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function isBootstrapProgrammerEmail(email = '') {
    return BOOTSTRAP_PROGRAMMER_EMAILS.includes(lowerText(email));
  }

  function inferProfileRole(raw = {}, email = '') {
    if (isBootstrapProgrammerEmail(email)) return 'PROGRAMADOR';
    const explicit = upperText(raw.rol || raw.role || raw.perfil || raw.cargo || raw.tipo);
    if (explicit) return explicit;
    if (raw.isGlobal === true) return 'CORPORATIVO_USER';
    if (raw.isAdmin === true) return 'VENTAS';
    return 'AUXILIAR';
  }

  function getProfileAvatarUrl(raw = {}) {
    return safeText(
      raw.avatarUrl
      || raw.avatarURL
      || raw.fotoURL
      || raw.photoURL
      || raw.profilePhotoUrl
    );
  }

  function normalizeCurrentUserRecord(raw = {}, fallbackUser = null) {
    const email = lowerText(raw.email || raw.id || fallbackUser?.email || '');
    const nombreCompleto = upperText(
      raw.nombreCompleto
      || raw.displayName
      || raw.nombre
      || raw.usuario
      || raw.nombreUsuario
      || fallbackUser?.displayName
      || email
      || 'USUARIO'
    );
    const usuario = upperText(raw.usuario || raw.nombreUsuario || raw.userName || raw.username || nombreCompleto);
    return {
      ...safeObject(raw),
      id: safeText(raw.id || email || fallbackUser?.uid),
      authUid: safeText(raw.authUid || raw.uid || fallbackUser?.uid),
      email,
      nombre: nombreCompleto,
      nombreCompleto,
      displayName: nombreCompleto,
      usuario,
      nombreUsuario: usuario,
      rol: inferProfileRole(raw, email),
      plazaAsignada: upperText(raw.plazaAsignada || raw.plaza || raw.sucursalAsignada || raw.sucursal || ''),
      plazasPermitidas: safeArray(raw.plazasPermitidas).map(upperText).filter(Boolean),
      telefono: safeText(raw.telefono),
      status: upperText(raw.status || 'ACTIVO') || 'ACTIVO',
      isAdmin: raw.isAdmin === true,
      isGlobal: raw.isGlobal === true,
      isOnline: raw.isOnline === true,
      lastSeenAt: coerceTimestamp(raw.lastSeenAt || raw.lastActiveAt || raw.ultimaConexionTs),
      avatarUrl: getProfileAvatarUrl(raw),
      avatarPath: safeText(raw.avatarPath),
      permissionOverrides: safeObject(raw.permissionOverrides || raw.permisosUsuario),
      profilePreferences: safeObject(raw.profilePreferences || raw.uiPreferences)
    };
  }

  function profileCacheMapKey(emailOrUid = '') {
    return `PROFILE:${lowerText(emailOrUid || '')}`;
  }

  function sessionProfileCacheKey(email = '') {
    return `${SESSION_PROFILE_CACHE_PREFIX}${lowerText(email)}`;
  }

  function localProfileCacheKey(email = '') {
    return `${LOCAL_PROFILE_CACHE_PREFIX}${lowerText(email)}`;
  }

  function readCachedCurrentUserRecord(email = '', options = {}) {
    const key = lowerText(email);
    if (!key) return null;
    const maxAgeMs = Number.isFinite(options.maxAgeMs) ? Number(options.maxAgeMs) : PROFILE_CACHE_TTL_MS;
    const cached = readSessionItem(sessionProfileCacheKey(key), null)
      || readLocalItem(localProfileCacheKey(key), null);
    if (!cached || typeof cached !== 'object') return null;
    const ts = Number(cached.ts || 0);
    if (!Number.isFinite(ts) || (maxAgeMs > 0 && (Date.now() - ts) > maxAgeMs)) return null;
    const data = safeObject(cached.data);
    if (!Object.keys(data).length) return null;
    return normalizeCurrentUserRecord(data);
  }

  function persistCachedCurrentUserRecord(record = {}, fallbackUser = null) {
    const normalized = normalizeCurrentUserRecord(record, fallbackUser);
    const email = lowerText(normalized.email || fallbackUser?.email || '');
    if (!email) return normalized;
    const payload = {
      ts: Date.now(),
      data: normalized
    };
    writeSessionItem(sessionProfileCacheKey(email), payload);
    writeLocalItem(localProfileCacheKey(email), payload);
    state.cache.set(profileCacheMapKey(email), Promise.resolve(normalized));
    return normalized;
  }

  function clearCachedCurrentUserRecord(email = '') {
    const key = lowerText(email);
    if (!key) return;
    try {
      sessionStorage.removeItem(sessionProfileCacheKey(key));
      localStorage.removeItem(localProfileCacheKey(key));
    } catch (_) {}
    state.cache.delete(profileCacheMapKey(key));
  }

  async function ensureBootstrapProgrammerRecord(user = null) {
    const email = lowerText(user?.email || '');
    if (!email || !isBootstrapProgrammerEmail(email) || !root._db) return null;

    const nombre = upperText(user?.displayName || 'PROGRAMADOR') || 'PROGRAMADOR';
    const payload = {
      email,
      nombre,
      usuario: nombre,
      rol: 'PROGRAMADOR',
      isAdmin: true,
      isGlobal: true,
      plazaAsignada: '',
      telefono: '',
      status: 'ACTIVO',
      authUid: safeText(user?.uid),
      bootstrapProgrammer: true,
      lastBootstrapLoginAt: Date.now()
    };

    await root._db.collection('usuarios').doc(email).set(payload, { merge: true });
    const persisted = await root._db.collection('usuarios').doc(email).get().catch(() => null);
    if (persisted?.exists) {
      return normalizeCurrentUserRecord({ id: persisted.id, ...persisted.data(), email }, user);
    }
    return normalizeCurrentUserRecord({ id: email, ...payload }, user);
  }

  async function fetchCurrentUserRecordDirect(user = null) {
    if (!root._db) throw new Error('Firebase no está listo para cargar el perfil.');
    const email = lowerText(user?.email || '');
    const uid = safeText(user?.uid);
    if (!email && !uid) return null;

    if (email) {
      const [docByEmail, queryByEmail] = await Promise.all([
        root._db.collection('usuarios').doc(email).get().catch(() => null),
        root._db.collection('usuarios').where('email', '==', email).limit(1).get().catch(() => null)
      ]);

      if (docByEmail?.exists) {
        return normalizeCurrentUserRecord({ id: docByEmail.id, ...docByEmail.data(), email }, user);
      }

      if (queryByEmail && !queryByEmail.empty) {
        const doc = queryByEmail.docs[0];
        return normalizeCurrentUserRecord({ id: doc.id, ...doc.data(), email }, user);
      }
    }

    if (uid) {
      const docByUid = await root._db.collection('usuarios').doc(uid).get().catch(() => null);
      if (docByUid?.exists) {
        return normalizeCurrentUserRecord({ id: docByUid.id, ...docByUid.data(), email }, user);
      }
    }

    if (isBootstrapProgrammerEmail(email)) {
      return ensureBootstrapProgrammerRecord(user);
    }

    return null;
  }

  function readStoredCurrentPlaza() {
    return upperText(
      root.__mexCurrentPlazaId
      || root.__mexActivePlazaId
      || readSessionItem(SESSION_ACTIVE_PLAZA_KEY, '')
      || readLocalItem(LOCAL_ACTIVE_PLAZA_KEY, '')
    );
  }

  function dispatchCurrentPlazaChange(plaza = '', source = 'app-bootstrap') {
    try {
      root.dispatchEvent(new CustomEvent('mex:plaza-change', {
        detail: { plaza, source }
      }));
    } catch (_) {}
  }

  function syncCurrentPlazaGlobals(plaza = '') {
    const normalized = upperText(plaza);
    root.__mexCurrentPlazaId = normalized;
    root.__mexActivePlazaId = normalized;
    if (typeof refreshPlazaEmailGlobals === 'function') {
      refreshPlazaEmailGlobals();
      root.PLAZA_ACTUAL_EMAIL = root.getPlazaActualEmail(normalized);
    }
    return normalized;
  }

  function setCurrentPlaza(plaza = '', options = {}) {
    const { persistLocal = true, source = 'app-bootstrap' } = options || {};
    const normalized = upperText(plaza);
    syncCurrentPlazaGlobals(normalized);
    try {
      if (normalized) {
        sessionStorage.setItem(SESSION_ACTIVE_PLAZA_KEY, JSON.stringify(normalized));
        if (persistLocal) localStorage.setItem(LOCAL_ACTIVE_PLAZA_KEY, JSON.stringify(normalized));
      } else {
        sessionStorage.removeItem(SESSION_ACTIVE_PLAZA_KEY);
        if (persistLocal) localStorage.removeItem(LOCAL_ACTIVE_PLAZA_KEY);
      }
    } catch (_) {}
    dispatchCurrentPlazaChange(normalized, source);
    return normalized;
  }

  function clearCurrentPlaza(options = {}) {
    return setCurrentPlaza('', options);
  }

  root.getMexCurrentPlaza = function (fallback = '') {
    return readStoredCurrentPlaza() || upperText(fallback);
  };
  root.setMexCurrentPlaza = setCurrentPlaza;
  root.clearMexCurrentPlaza = clearCurrentPlaza;
  syncCurrentPlazaGlobals(readStoredCurrentPlaza());

  function isShortcutEditableTarget(target) {
    const el = target && target.nodeType === 1 ? target : target?.parentElement;
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = lowerText(el.tagName);
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return Boolean(el.closest?.('[contenteditable="true"], input, textarea, select'));
  }

  function handleGlobalRouteShortcuts(event) {
    if (event.defaultPrevented) return;
    if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    if (isShortcutEditableTarget(event.target)) return;

    const pathname = lowerText(root.location.pathname || '/');
    if (pathname === '/mapa' || pathname === '/mapa.html' || pathname === '/') return;

    const key = lowerText(event.key || '');
    if (key === 'p') {
      event.preventDefault();
      root.location.href = '/profile';
      return;
    }
    if (key === 'm') {
      event.preventDefault();
      root.location.href = '/mensajes';
    }
  }

  function bindGlobalRouteShortcuts() {
    if (state.shortcutsBound) return;
    document.addEventListener('keydown', handleGlobalRouteShortcuts);
    state.shortcutsBound = true;
  }

  bindGlobalRouteShortcuts();

  function normalizePlazasDetalle(plazasDetalle = []) {
    if (!Array.isArray(plazasDetalle)) return [];
    return plazasDetalle
      .filter(Boolean)
      .map(item => ({
        ...(item || {}),
        id: upperText(item?.id),
        correo: lowerText(item?.correo),
        correoGerente: lowerText(item?.correoGerente)
      }));
  }

  function normalizeCorreosInternos(empresa = {}) {
    const normalized = [];
    const seen = new Map();
    const plazasDetalle = normalizePlazasDetalle(empresa?.plazasDetalle || []);
    const rawList = Array.isArray(empresa?.correosInternos) ? empresa.correosInternos : [];

    function upsert(rawItem, fallback = {}) {
      const fromObject = rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem);
      const correo = lowerText(
        fromObject
          ? (rawItem.correo || rawItem.email || rawItem.mail)
          : rawItem
      );
      if (!correo) return;

      const next = {
        titulo: safeText(
          fromObject
            ? (rawItem.titulo || rawItem.nombre)
            : fallback.titulo
        ) || safeText(fallback.titulo),
        correo,
        plazaId: upperText(
          fromObject
            ? rawItem.plazaId
            : fallback.plazaId
        ) || upperText(fallback.plazaId)
      };

      if (seen.has(correo)) {
        const existing = seen.get(correo);
        if (!existing.titulo && next.titulo) existing.titulo = next.titulo;
        if (!existing.plazaId && next.plazaId) existing.plazaId = next.plazaId;
        return;
      }

      seen.set(correo, next);
      normalized.push(next);
    }

    rawList.forEach(item => upsert(item));

    plazasDetalle.forEach(plaza => {
      if (plaza?.correo) {
        upsert(
          { correo: plaza.correo, plazaId: plaza.id },
          { titulo: `${upperText(plaza.id)} INSTITUCIONAL`, plazaId: plaza.id }
        );
      }
      if (plaza?.correoGerente) {
        upsert(
          { correo: plaza.correoGerente, plazaId: plaza.id },
          { titulo: `${upperText(plaza.id)} GERENCIA`, plazaId: plaza.id }
        );
      }
    });

    return normalized;
  }

  function normalizeEmpresa(empresa = {}) {
    return {
      ...(empresa || {}),
      plazas: Array.isArray(empresa?.plazas) ? empresa.plazas.map(upperText).filter(Boolean) : [],
      plazasDetalle: normalizePlazasDetalle(empresa?.plazasDetalle || []),
      correosInternos: normalizeCorreosInternos(empresa || {})
    };
  }

  // Client-safe defaults only (cloud name appears in delivery URLs; never API secret).
  const DEFAULT_MEDIA_CONFIG = Object.freeze({
    provider: 'cloudinary',
    cloudName: 'dcoma38r',
    baseFolder: 'mapgestion/prod'
  });

  function normalizeMediaConfig(media = {}, empresa = {}) {
    const fromEmpresa = empresa?.media && typeof empresa.media === 'object' ? empresa.media : {};
    const src = { ...DEFAULT_MEDIA_CONFIG, ...fromEmpresa, ...(media && typeof media === 'object' ? media : {}) };
    return {
      provider: safeText(src.provider) || DEFAULT_MEDIA_CONFIG.provider,
      cloudName: safeText(src.cloudName || src.cloud_name) || DEFAULT_MEDIA_CONFIG.cloudName,
      baseFolder: safeText(src.baseFolder || src.base_folder) || DEFAULT_MEDIA_CONFIG.baseFolder
    };
  }

  function normalizeConfig(config = {}) {
    const empresa = {
      ...normalizeEmpresa(config?.empresa || {})
    };
    return {
      empresa,
      listas: {
        ...DEFAULT_LISTS,
        ...(config?.listas || {})
      },
      // Client-safe Cloudinary config (no API secret). Prefer empresa.media.
      media: normalizeMediaConfig(config?.media, empresa)
    };
  }

  function mergeConfig(baseConfig = {}, extraConfig = {}) {
    const base = normalizeConfig(baseConfig);
    const extra = normalizeConfig(extraConfig);
    return {
      empresa: {
        ...base.empresa,
        ...extra.empresa
      },
      listas: {
        ...base.listas,
        ...extra.listas
      },
      media: normalizeMediaConfig(extra.media, {
        ...base.empresa,
        ...extra.empresa,
        media: { ...(base.media || {}), ...(extra.media || {}) }
      })
    };
  }

  function companyNameFrom(config = root.MEX_CONFIG || {}) {
    const empresa = config?.empresa || {};
    return safeText(
      empresa?.nombre
      || empresa?.nombreComercial
      || empresa?.razonSocial
    ) || DEFAULT_COMPANY_NAME;
  }

  function getPlazaEmailFromConfig(plazaId = '', config = root.MEX_CONFIG || {}) {
    const plazaKey = upperText(plazaId);
    if (!plazaKey) return '';
    const plazasDetalle = normalizePlazasDetalle(config?.empresa?.plazasDetalle || []);
    const plaza = plazasDetalle.find(item => upperText(item?.id) === plazaKey);
    return lowerText(plaza?.correo);
  }

  function refreshPlazaEmailGlobals() {
    root.getPlazaEmail = function (plazaId = '') {
      return getPlazaEmailFromConfig(plazaId, root.MEX_CONFIG || {});
    };
    root.getPlazaActualEmail = function (plazaId = '') {
      const activePlaza = upperText(plazaId || root.__mexCurrentPlazaId || root.__mexActivePlazaId || '');
      return getPlazaEmailFromConfig(activePlaza, root.MEX_CONFIG || {});
    };
    root.PLAZA_ACTUAL_EMAIL = root.getPlazaActualEmail();
  }

  function locationMapsUrl(exactLocation = null) {
    const lat = Number(exactLocation?.latitude);
    const lng = Number(exactLocation?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
    return `https://maps.google.com/?q=${lat},${lng}`;
  }

  function buildLocationLabel(place = {}) {
    const city = safeText(place.city || place.town || place.village || place.hamlet || place.county || place.locality);
    const state = safeText(place.state || place.region || place.province || place.principalSubdivision);
    const country = safeText(place.country || place.countryName);
    const addressLabel = [city, state].filter(Boolean).join(', ');
    return {
      city,
      state,
      country,
      addressLabel: addressLabel || [state, country].filter(Boolean).join(', ')
    };
  }

  function reverseGeoCacheKey(exactLocation = null) {
    const lat = Number(exactLocation?.latitude);
    const lng = Number(exactLocation?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
    return `${lat.toFixed(4)},${lng.toFixed(4)}`;
  }

  function readReverseGeoCache() {
    const cached = readSessionItem(SESSION_REVERSE_GEOCODE_KEY, {});
    return cached && typeof cached === 'object' ? cached : {};
  }

  function writeReverseGeoCache(cache = {}) {
    writeSessionItem(SESSION_REVERSE_GEOCODE_KEY, cache);
  }

  async function reverseGeocodeLocation(exactLocation = null) {
    const lat = Number(exactLocation?.latitude);
    const lng = Number(exactLocation?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || typeof fetch !== 'function') return exactLocation;

    const cacheKey = reverseGeoCacheKey(exactLocation);
    const reverseCache = readReverseGeoCache();
    if (cacheKey && reverseCache[cacheKey]) {
      return {
        ...exactLocation,
        ...reverseCache[cacheKey]
      };
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 2800) : null;
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&addressdetails=1&accept-language=es&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller?.signal
        }
      );
      if (!response.ok) return exactLocation;
      const payload = await response.json();
      const locationLabel = buildLocationLabel({
        ...(payload?.address || {}),
        locality: payload?.name || '',
        displayName: payload?.display_name || ''
      });
      const next = {
        city: locationLabel.city,
        state: locationLabel.state,
        country: locationLabel.country,
        addressLabel: locationLabel.addressLabel || safeText(payload?.display_name)
      };
      if (cacheKey) {
        reverseCache[cacheKey] = next;
        writeReverseGeoCache(reverseCache);
      }
      return {
        ...exactLocation,
        ...next
      };
    } catch (_) {
      return exactLocation;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function buildExactLocation(position) {
    const latitude = Number(position?.coords?.latitude);
    const longitude = Number(position?.coords?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    const exactLocation = {
      latitude,
      longitude,
      accuracy: Number(position?.coords?.accuracy || 0),
      capturedAt: Date.now(),
      source: 'browser'
    };
    const mapsUrl = locationMapsUrl(exactLocation);
    if (mapsUrl) exactLocation.googleMapsUrl = mapsUrl;
    return exactLocation;
  }

  function cloneLocationState() {
    return {
      status: safeText(state.location?.status) || 'pending',
      exactLocation: state.location?.exactLocation ? { ...state.location.exactLocation } : null,
      lastUpdated: Number(state.location?.lastUpdated || 0),
      error: safeText(state.location?.error)
    };
  }

  function dispatchLocationUpdate() {
    root.dispatchEvent(new CustomEvent('mex-location-updated', {
      detail: cloneLocationState()
    }));
  }

  function locationAuthEmail() {
    try {
      return safeText(
        root.firebase?.auth?.()?.currentUser?.email
        || root._auth?.currentUser?.email
        || ''
      ).toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function locationCacheKey(email = locationAuthEmail()) {
    const e = safeText(email).toLowerCase();
    return e ? `mex.location.last.v1:${e}` : 'mex.location.last.v1';
  }

  function clearLocationCaches() {
    try {
      localStorage.removeItem('mex.location.last.v1');
      const email = locationAuthEmail();
      if (email) localStorage.removeItem(locationCacheKey(email));
    } catch (_) {}
  }

  function readLocationCache() {
    try {
      const keyed = localStorage.getItem(locationCacheKey());
      if (keyed) return JSON.parse(keyed);
      // Migración: clave global antigua (sin email).
      const legacy = localStorage.getItem('mex.location.last.v1');
      return legacy ? JSON.parse(legacy) : null;
    } catch (_) {
      return null;
    }
  }

  function applyLocationSnapshot(status = 'pending', exactLocation = null, error = '') {
    const prevStatus = safeText(state.location?.status) || 'pending';
    state.location.status = safeText(status) || 'pending';
    state.location.exactLocation = exactLocation ? { ...exactLocation } : null;
    state.location.lastUpdated = Date.now();
    state.location.error = safeText(error);
    // Persistir el último snapshot CONCEDIDO para el fast-path (evita el flash del
    // gate al abrir otra pestaña). Si se deniega, se limpia.
    try {
      if (state.location.status === 'granted' && state.location.exactLocation) {
        const payload = JSON.stringify({
          exactLocation: state.location.exactLocation,
          lastUpdated: state.location.lastUpdated
        });
        localStorage.setItem(locationCacheKey(), payload);
        // Limpiar clave legacy para no mezclar usuarios en el mismo browser.
        localStorage.removeItem('mex.location.last.v1');
      } else if (state.location.status === 'denied') {
        clearLocationCaches();
      }
    } catch (_) {}
    dispatchLocationUpdate();

    // Revocación mid-sesión: gate bloqueante inmediato (sin esperar otra acción).
    if (state.location.status === 'denied' && prevStatus !== 'denied') {
      queueMicrotask(() => {
        try {
          if (state.location.status !== 'denied') return;
          root.__mexRequireLocationAccess?.({ allowLogout: true, force: true });
        } catch (_) {}
      });
    }
    return cloneLocationState();
  }

  function ensureLocationWatch() {
    if (!root.isSecureContext || !navigator.geolocation) return;
    if (Number.isInteger(state.location.watchId)) return;
    state.location.watchId = navigator.geolocation.watchPosition(
      async position => {
        const baseLocation = buildExactLocation(position);
        const exactLocation = baseLocation ? await reverseGeocodeLocation(baseLocation) : null;
        applyLocationSnapshot(exactLocation ? 'granted' : 'error', exactLocation, exactLocation ? '' : 'Coordenadas inválidas');
      },
      error => {
        const denied = Number(error?.code) === 1;
        const lastSnapshot = cloneLocationState();
        if (denied) {
          applyLocationSnapshot('denied', null, error?.message || '');
          return;
        }
        if (lastSnapshot.exactLocation) {
          applyLocationSnapshot('granted', lastSnapshot.exactLocation, error?.message || '');
          return;
        }
        applyLocationSnapshot('error', null, error?.message || '');
      },
      {
        enableHighAccuracy: true,
        maximumAge: 20000,
        timeout: 15000
      }
    );
  }

  async function readExactLocation(options = {}) {
    const force = options.force === true;
    const maxAgeMs = Number(options.maxAgeMs || (force ? 0 : 45000));
    const now = Date.now();
    const current = cloneLocationState();

    // 1. Si tenemos una ubicación reciente y no se fuerza, retornarla de inmediato.
    if (!force && current.exactLocation && current.lastUpdated && (now - current.lastUpdated) <= maxAgeMs) {
      return current;
    }

    if (!root.isSecureContext || !navigator.geolocation) {
      return applyLocationSnapshot('unsupported', null, 'Geolocalización no disponible.');
    }

    // 2. Intentar una lectura rápida si ya sabemos que el permiso está concedido.
    // Esto evita que el usuario vea el overlay durante el timeout largo de 12s.
    return new Promise(resolve => {
      let isSettled = false;

      const finishAttempt = (snapshot) => {
        if (isSettled) return;
        isSettled = true;
        resolve(snapshot);
      };

      // Si el permiso ya es granted, intentamos un máximo de 3.5s antes de rendirnos a la caché
      const fastTimeoutMs = force ? Number(options.timeoutMs || 12000) : 3500;

      navigator.geolocation.getCurrentPosition(
        async position => {
          const baseLocation = buildExactLocation(position);
          const exactLocation = baseLocation ? await reverseGeocodeLocation(baseLocation) : null;
          const snapshot = applyLocationSnapshot(exactLocation ? 'granted' : 'error', exactLocation, exactLocation ? '' : 'Coordenadas inválidas');
          if (snapshot.status === 'granted') ensureLocationWatch();
          finishAttempt(snapshot);
        },
        error => {
          const denied = Number(error?.code) === 1;
          const lastSnapshot = cloneLocationState();
          if (!denied && lastSnapshot.exactLocation) {
            finishAttempt(applyLocationSnapshot('granted', lastSnapshot.exactLocation, error?.message || 'Ubicación anterior reutilizada.'));
            return;
          }
          finishAttempt(applyLocationSnapshot(denied ? 'denied' : 'error', null, error?.message || 'No se pudo obtener la ubicación.'));
        },
        {
          enableHighAccuracy: true,
          maximumAge: force ? 0 : Math.min(maxAgeMs, 30000),
          timeout: fastTimeoutMs
        }
      );

      // Fallback si tarda demasiado y tenemos caché
      if (!force && current.exactLocation) {
        setTimeout(() => {
          if (!isSettled) {
            console.log("📍 Location taking too long, using cache as fallback to avoid blocking UI.");
            finishAttempt(current);
          }
        }, fastTimeoutMs + 500);
      }
    });
  }

  function injectBootstrapStyle() {
    if (document.getElementById('mex-app-bootstrap-style')) return;
    const style = document.createElement('style');
    style.id = 'mex-app-bootstrap-style';
    style.textContent = `
      html.mex-app-booting,
      html.mex-app-booting body {
        overflow: hidden !important;
      }

      html.mex-app-booting body > *:not(#mexAppBootstrapOverlay) {
        visibility: hidden !important;
      }

      #mexAppBootstrapOverlay {
        position: fixed;
        inset: 0;
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background:
          radial-gradient(circle at top, rgba(56, 189, 248, 0.22), transparent 38%),
          linear-gradient(180deg, #091123 0%, #0c1d3f 50%, #08101f 100%);
        color: #f8fafc;
        font-family: 'Inter', sans-serif;
        transition: opacity 220ms ease;
      }

      #mexAppBootstrapOverlay.ready {
        opacity: 0;
        pointer-events: none;
      }

      .mex-app-bootstrap-card {
        width: min(420px, 100%);
        padding: 28px 24px;
        border-radius: 28px;
        background: rgba(9, 17, 35, 0.78);
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 28px 80px rgba(0, 0, 0, 0.45);
        text-align: center;
        backdrop-filter: blur(18px);
      }

      .mex-app-bootstrap-spinner {
        width: 62px;
        height: 62px;
        margin: 0 auto 18px;
        border-radius: 999px;
        border: 4px solid rgba(255, 255, 255, 0.14);
        border-top-color: #22c55e;
        border-right-color: #38bdf8;
        animation: mex-app-bootstrap-spin 900ms linear infinite;
      }

      .mex-app-bootstrap-kicker {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(59, 130, 246, 0.14);
        color: #bfdbfe;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .mex-app-bootstrap-title {
        margin: 16px 0 10px;
        font-size: 28px;
        font-weight: 900;
        line-height: 1.05;
      }

      .mex-app-bootstrap-subtitle {
        margin: 0;
        color: #cbd5e1;
        font-size: 14px;
        line-height: 1.6;
      }

      .mex-app-bootstrap-retry {
        margin-top: 18px;
        padding: 12px 18px;
        border: none;
        border-radius: 14px;
        background: linear-gradient(135deg, #2563eb, #22c55e);
        color: white;
        font-size: 13px;
        font-weight: 800;
        cursor: pointer;
      }

      #mexLocationGateOverlay {
        --mex-location-bg: var(--bg, #f8fafc);
        --mex-location-surface: var(--surface, #ffffff);
        --mex-location-text: var(--text, #0f172a);
        --mex-location-muted: var(--text-muted, var(--muted, #64748b));
        --mex-location-border: var(--border, #d5deec);
        --mex-location-border-md: var(--border-md, var(--border, #cbd5e1));
        --mex-location-accent: var(--accent, var(--primary, #2563eb));
        --mex-location-accent-hover: var(--accent-hover, var(--primary-d, #1d4ed8));
        --mex-location-accent-pale: var(--accent-pale, #eff6ff);
        --mex-location-on-accent: var(--on-accent, #ffffff);
        --mex-location-error: var(--color-error, var(--danger, #dc2626));
        --mex-location-card-radius: var(--radius-xl, 12px);
        --mex-location-control-radius: var(--radius-md, 8px);
        --mex-location-shadow: var(--shadow-lg, 0 24px 64px rgba(15, 23, 42, 0.24));
        position: fixed;
        inset: 0;
        z-index: 999998;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 24px;
        overflow: auto;
        background: rgba(2, 6, 23, 0.68);
        background: color-mix(in srgb, var(--slate-950, #020617) 68%, transparent);
        overscroll-behavior: contain;
      }

      #mexLocationGateOverlay,
      #mexLocationGateOverlay * {
        box-sizing: border-box;
      }

      #mexLocationGateOverlay .material-symbols-outlined {
        width: 1em;
        height: 1em;
        overflow: hidden;
        display: inline-grid;
        flex: 0 0 auto;
        place-items: center;
        font-family: 'Material Symbols Outlined' !important;
        font-style: normal;
        font-weight: 400;
        line-height: 1;
        letter-spacing: 0;
        text-transform: none;
        white-space: nowrap;
        direction: ltr;
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
        font-feature-settings: 'liga';
        font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
      }

      #mexLocationGateOverlay.active {
        display: flex;
      }

      .mex-location-gate-card {
        width: min(400px, 100%);
        padding: 24px;
        border-radius: var(--mex-location-card-radius);
        background: var(--mex-location-surface);
        border: 1px solid var(--mex-location-border);
        box-shadow: var(--mex-location-shadow);
        color: var(--mex-location-text);
        font-family: 'Inter', sans-serif;
        text-align: left;
      }

      .mex-location-gate-header {
        display: flex;
        align-items: flex-start;
        gap: 12px;
      }

      .mex-location-gate-heading { min-width: 0; }

      .mex-location-gate-icon {
        width: 40px;
        height: 40px;
        flex-shrink: 0;
        border-radius: var(--mex-location-control-radius);
        display: grid;
        place-items: center;
        background: var(--mex-location-accent-pale);
        color: var(--mex-location-accent);
      }

      .mex-location-gate-card.is-denied .mex-location-gate-icon {
        background: color-mix(in srgb, var(--mex-location-error) 12%, transparent);
        color: var(--mex-location-error);
      }

      .mex-location-gate-icon .material-symbols-outlined {
        font-size: 20px;
      }

      .mex-location-gate-kicker {
        color: var(--mex-location-muted);
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .mex-location-gate-card.is-denied .mex-location-gate-kicker {
        color: var(--mex-location-error);
      }

      .mex-location-gate-title {
        margin: 4px 0 0;
        font-size: 20px;
        font-weight: 600;
        line-height: 28px;
        color: var(--mex-location-text);
        text-wrap: balance;
      }

      .mex-location-gate-copy {
        margin: 16px 0 0;
        color: var(--mex-location-muted);
        font-size: 14px;
        line-height: 20px;
        font-weight: 400;
        text-wrap: pretty;
      }

      .mex-location-gate-status {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 16px;
        padding: 12px;
        border-radius: var(--mex-location-control-radius);
        background: var(--mex-location-bg);
        border: 1px solid var(--mex-location-border);
        color: var(--mex-location-text);
        font-size: 12px;
        font-weight: 400;
        line-height: 16px;
      }

      .mex-location-gate-status .material-symbols-outlined {
        flex-shrink: 0;
        color: var(--mex-location-muted);
        font-size: 18px;
      }

      .mex-location-gate-card.is-denied .mex-location-gate-status {
        background: color-mix(in srgb, var(--mex-location-error) 8%, var(--mex-location-surface));
        border-color: color-mix(in srgb, var(--mex-location-error) 32%, var(--mex-location-border));
        color: var(--mex-location-text);
      }

      .mex-location-gate-card.is-denied .mex-location-gate-status .material-symbols-outlined {
        color: var(--mex-location-error);
      }

      .mex-location-gate-card.is-busy .mex-location-gate-status .material-symbols-outlined,
      .mex-location-gate-btn.is-busy .material-symbols-outlined {
        animation: mex-app-bootstrap-spin 900ms linear infinite;
      }

      .mex-location-gate-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        flex-wrap: wrap;
        margin-top: 20px;
      }

      .mex-location-gate-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        height: 40px;
        padding: 0 16px;
        border-radius: var(--mex-location-control-radius);
        border: 1px solid var(--mex-location-border-md);
        background: var(--mex-location-surface);
        color: var(--mex-location-text);
        font-family: 'Inter', sans-serif;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
      }

      .mex-location-gate-btn .material-symbols-outlined {
        font-size: 18px;
      }

      .mex-location-gate-btn.primary {
        background: var(--mex-location-accent);
        border-color: var(--mex-location-accent);
        color: var(--mex-location-on-accent);
      }

      .mex-location-gate-btn.primary:hover {
        background: var(--mex-location-accent-hover);
        border-color: var(--mex-location-accent-hover);
      }

      .mex-location-gate-btn:active:not(:disabled) { transform: translateY(1px); }
      .mex-location-gate-btn:focus-visible,
      .mex-location-gate-card:focus-visible { outline: 2px solid var(--mex-location-accent); outline-offset: 2px; }

      .mex-location-gate-btn:disabled {
        opacity: 0.56;
        cursor: default;
      }

      .mex-location-gate-btn[hidden] { display: none; }

      /* base.css aplica color global a spans legacy en dark mode. */
      body.dark-theme .mex-location-gate-icon .material-symbols-outlined,
      body.dark-theme .mex-location-gate-btn .material-symbols-outlined,
      body.dark-theme .mex-location-gate-btn span { color: inherit !important; }
      body.dark-theme .mex-location-gate-status .material-symbols-outlined { color: var(--mex-location-muted) !important; }
      body.dark-theme .mex-location-gate-card.is-denied .mex-location-gate-status .material-symbols-outlined { color: var(--mex-location-error) !important; }
      body.dark-theme .mex-location-gate-btn.primary span { color: var(--mex-location-on-accent) !important; }

      @media (max-width: 480px) {
        #mexLocationGateOverlay { padding: 16px; }
        .mex-location-gate-card { padding: 20px; }
        .mex-location-gate-actions { flex-direction: column-reverse; }
        .mex-location-gate-btn { width: 100%; }
      }

      @keyframes mex-app-bootstrap-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureOverlayDom() {
    if (state.overlayAttached) return document.getElementById('mexAppBootstrapOverlay');
    if (!document.body) {
      requestAnimationFrame(ensureOverlayDom);
      return null;
    }

    const overlay = document.createElement('div');
    overlay.id = 'mexAppBootstrapOverlay';
    overlay.innerHTML = `
      <div class="mex-app-bootstrap-card">
        <div class="mex-app-bootstrap-spinner"></div>
        <div class="mex-app-bootstrap-kicker">Configuracion global</div>
        <h1 class="mex-app-bootstrap-title" id="mexAppBootstrapTitle">Cargando empresa...</h1>
        <p class="mex-app-bootstrap-subtitle" id="mexAppBootstrapSubtitle">Estamos preparando la plataforma antes de mostrar la interfaz.</p>
      </div>
    `;
    document.body.prepend(overlay);
    state.overlayAttached = true;
    return overlay;
  }

  function updateOverlay(title, subtitle, withRetry = false) {
    const overlay = ensureOverlayDom();
    if (!overlay) return;
    const titleEl = overlay.querySelector('#mexAppBootstrapTitle');
    const subtitleEl = overlay.querySelector('#mexAppBootstrapSubtitle');
    if (titleEl) titleEl.textContent = title;
    if (subtitleEl) subtitleEl.textContent = subtitle;

    const existingRetry = overlay.querySelector('.mex-app-bootstrap-retry');
    if (existingRetry) existingRetry.remove();

    if (withRetry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mex-app-bootstrap-retry';
      button.textContent = 'Reintentar carga';
      button.addEventListener('click', () => {
        root.__mexRetryBootstrap?.();
      });
      overlay.querySelector('.mex-app-bootstrap-card')?.appendChild(button);
    }
  }

  function releaseOverlay() {
    console.log('[BOOTSTRAP-DEBUG] releaseOverlay() fired — removiendo mex-app-booting');
    document.documentElement.classList.remove('mex-app-booting');
    const overlay = document.getElementById('mexAppBootstrapOverlay');
    if (!overlay) return;
    overlay.classList.add('ready');
    setTimeout(() => overlay.remove(), 240);
  }

  function setLocationRetryButton(button, label, busy = false) {
    if (!button) return;
    const labelEl = button.querySelector('[data-location-retry-label]');
    const iconEl = button.querySelector('.material-symbols-outlined');
    if (labelEl) labelEl.textContent = label;
    else button.textContent = label;
    if (iconEl) iconEl.textContent = busy ? 'progress_activity' : 'my_location';
    button.classList.toggle('is-busy', busy);
  }

  function ensureLocationGateOverlay() {
    let overlay = document.getElementById('mexLocationGateOverlay');
    if (overlay) return overlay;
    if (!document.body) return null;
    overlay = document.createElement('div');
    overlay.id = 'mexLocationGateOverlay';
    overlay.innerHTML = `
      <div class="mex-location-gate-card" role="dialog" aria-modal="true" aria-labelledby="mexLocationGateTitle" aria-describedby="mexLocationGateCopy" tabindex="-1">
        <header class="mex-location-gate-header">
          <div class="mex-location-gate-icon"><span class="material-symbols-outlined" id="mexLocationGateIcon" aria-hidden="true">location_on</span></div>
          <div class="mex-location-gate-heading">
            <div class="mex-location-gate-kicker" id="mexLocationGateKicker">Acceso requerido</div>
            <h2 class="mex-location-gate-title" id="mexLocationGateTitle">Permite tu ubicación</h2>
          </div>
        </header>
        <p class="mex-location-gate-copy" id="mexLocationGateCopy">Necesitamos tu ubicación exacta para registrar auditorías y movimientos. No podrás continuar hasta permitirla.</p>
        <div class="mex-location-gate-status" role="status" aria-live="polite">
          <span class="material-symbols-outlined" id="mexLocationGateStatusIcon" aria-hidden="true">info</span>
          <span id="mexLocationGateStatus">Esperando permiso del navegador...</span>
        </div>
        <div class="mex-location-gate-actions">
          <button type="button" class="mex-location-gate-btn" id="mexLocationGateLogout" hidden><span class="material-symbols-outlined" aria-hidden="true">logout</span><span>Cerrar sesión</span></button>
          <button type="button" class="mex-location-gate-btn primary" id="mexLocationGateRetry"><span class="material-symbols-outlined" aria-hidden="true">my_location</span><span data-location-retry-label>Permitir ubicación</span></button>
        </div>
      </div>
    `;

    const card = overlay.querySelector('.mex-location-gate-card');
    overlay.addEventListener('pointerdown', event => {
      if (event.target === overlay) card?.focus({ preventScroll: true });
    });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        card?.focus({ preventScroll: true });
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(overlay.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
        .filter(el => !el.hidden && el.getAttribute('aria-hidden') !== 'true' && el.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        card?.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!focusable.includes(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    document.body.appendChild(overlay);
    return overlay;
  }

  function updateLocationGate(options = {}) {
    const overlay = ensureLocationGateOverlay();
    if (!overlay) return;
    const wasActive = overlay.classList.contains('active');
    if (!wasActive) state.locationGateReturnFocus = document.activeElement;
    overlay.classList.add('active');
    const card = overlay.querySelector('.mex-location-gate-card');
    const titleEl = overlay.querySelector('.mex-location-gate-title');
    const copyEl = overlay.querySelector('.mex-location-gate-copy');
    const statusEl = overlay.querySelector('#mexLocationGateStatus');
    const statusIconEl = overlay.querySelector('#mexLocationGateStatusIcon');
    const iconEl = overlay.querySelector('#mexLocationGateIcon');
    const kickerEl = overlay.querySelector('#mexLocationGateKicker');
    const denied = options.variant === 'denied'
      || /bloqueado|denegad|denied/i.test(safeText(options.status) + ' ' + safeText(options.title));
    const busy = options.busy === true
      || /solicitando|validando|verificando|confirmando/i.test(safeText(options.status));
    if (card) card.classList.toggle('is-denied', denied);
    if (card) {
      card.classList.toggle('is-busy', busy);
      card.setAttribute('aria-busy', busy ? 'true' : 'false');
    }
    if (iconEl) iconEl.textContent = denied ? 'location_off' : 'location_on';
    if (statusIconEl) statusIconEl.textContent = denied ? 'error' : (busy ? 'progress_activity' : 'info');
    if (kickerEl) kickerEl.textContent = denied ? 'Permiso bloqueado' : 'Acceso requerido';
    if (titleEl) titleEl.textContent = safeText(options.title) || (denied ? 'Ubicación requerida' : 'Permite tu ubicación');
    if (copyEl) {
      copyEl.textContent = safeText(options.copy)
        || (denied
          ? 'El permiso está bloqueado. Actívalo en el navegador o en ajustes del dispositivo y pulsa Reintentar.'
          : 'Necesitamos tu ubicación exacta para registrar auditorías y movimientos. No podrás continuar hasta permitirla.');
    }
    if (statusEl) statusEl.textContent = safeText(options.status) || 'Esperando permiso del navegador...';
    const retryBtn = overlay.querySelector('#mexLocationGateRetry');
    if (retryBtn && !retryBtn.disabled) {
      setLocationRetryButton(
        retryBtn,
        busy ? 'Verificando...' : (denied ? 'Reintentar' : 'Permitir ubicación'),
        busy
      );
    }
    const logoutBtn = overlay.querySelector('#mexLocationGateLogout');
    if (logoutBtn) logoutBtn.hidden = options.allowLogout !== true;

    if (!wasActive || !overlay.contains(document.activeElement)) {
      requestAnimationFrame(() => {
        const focusTarget = retryBtn && !retryBtn.disabled ? retryBtn : card;
        focusTarget?.focus({ preventScroll: true });
      });
    }
  }

  function hideLocationGate() {
    const overlay = document.getElementById('mexLocationGateOverlay');
    if (!overlay || !overlay.classList.contains('active')) return;
    overlay.classList.remove('active');
    const returnFocus = state.locationGateReturnFocus;
    state.locationGateReturnFocus = null;
    if (returnFocus?.isConnected && typeof returnFocus.focus === 'function') {
      requestAnimationFrame(() => returnFocus.focus({ preventScroll: true }));
    }
  }

  function applyPageBranding(config = root.MEX_CONFIG || {}) {
    root.MEX_CONFIG = mergeConfig(root.MEX_CONFIG || {}, config);
    const companyName = companyNameFrom(root.MEX_CONFIG);
    root.__mexCompanyName = companyName;
    refreshPlazaEmailGlobals();

    const pageTitle = safeText(document.documentElement.dataset.pageTitle);
    document.title = pageTitle ? `${pageTitle} — ${companyName}` : companyName;

    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appleTitle) appleTitle.setAttribute('content', companyName);

    const descriptionMeta = document.querySelector('meta[name="description"]');
    const descriptionTemplate = safeText(document.documentElement.dataset.pageDescription);
    if (descriptionMeta && descriptionTemplate) {
      descriptionMeta.setAttribute('content', descriptionTemplate.replace(/%COMPANY%/g, companyName));
    }

    const color = safeText(root.MEX_CONFIG?.empresa?.colorPrincipal);
    if (color) {
      document.documentElement.style.setProperty('--mex-blue', color);
    }

    const byId = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    byId('resv2-company-name', companyName);
    byId('empresa-cfg-lbl', companyName);
    byId('cfg-footer-company-name', companyName);
    byId('chatv2-company-label', companyName);
    byId('loginBrandName', companyName);

    const loginBrandSub = document.getElementById('loginBrandSub');
    if (loginBrandSub) {
      const slogan = safeText(root.MEX_CONFIG?.empresa?.slogan);
      loginBrandSub.textContent = slogan;
      loginBrandSub.style.display = slogan ? '' : 'none';
    }

    document.querySelectorAll('[data-company-name]').forEach(node => {
      node.textContent = companyName;
    });
  }

  async function fetchBaseConfigDirect() {
    if (!root._db) {
      throw new Error('Firebase no está listo para cargar la configuración global.');
    }
    const [listasSnap, empresaSnap] = await Promise.all([
      root._db.collection('configuracion').doc('listas').get(),
      root._db.collection('configuracion').doc('empresa').get()
    ]);
    // La config del tenant vive en configuracion/empresa (single-tenant).
    const empresaData = empresaSnap.exists
      ? (empresaSnap.data() || {})
      : ((root.MEX_CONFIG && root.MEX_CONFIG.empresa) ? root.MEX_CONFIG.empresa : {});
    return normalizeConfig({
      empresa: empresaData,
      listas: listasSnap.exists ? (listasSnap.data() || {}) : {}
    });
  }

  async function fetchConfig(plaza = '') {
    const key = safeText(plaza).toUpperCase() || 'GLOBAL';
    if (state.cache.has(key)) return state.cache.get(key);

    const task = (async () => {
      const config = (root.api?.obtenerConfiguracion && key !== 'GLOBAL')
        ? await root.api.obtenerConfiguracion(key)
        : (root.api?.obtenerConfiguracion
          ? await root.api.obtenerConfiguracion('')
          : await fetchBaseConfigDirect());
      const normalized = normalizeConfig(config);
      if (key === 'GLOBAL') persistCachedBaseConfig(normalized);
      applyPageBranding(normalized);
      return normalized;
    })().catch(error => {
      state.cache.delete(key);
      throw error;
    });

    state.cache.set(key, task);
    return task;
  }

  root.__mexEnsureConfigLoaded = async function (plaza = '') {
    const baseConfig = await fetchConfig('');
    const plazaKey = safeText(plaza).toUpperCase();
    if (!plazaKey || plazaKey === 'GLOBAL') {
      applyPageBranding(baseConfig);
      return baseConfig;
    }
    const plazaConfig = await fetchConfig(plazaKey);
    const merged = mergeConfig(baseConfig, plazaConfig);
    applyPageBranding(merged);
    return merged;
  };

  root.__mexRetryBootstrap = function () {
    document.documentElement.classList.add('mex-app-booting');
    updateOverlay(
      'Reintentando carga...',
      'Estamos consultando de nuevo la configuración base de la empresa.'
    );
    root.__mexConfigReadyPromise = root.__mexEnsureConfigLoaded('')
      .then(config => {
        state.resolved = true;
        applyPageBranding(config);
        releaseOverlay();
        return config;
      })
      .catch(error => {
        console.error('[app-bootstrap] retry', error);
        updateOverlay(
          'No se pudo cargar la empresa',
          'Revisa tu conexión o la configuración base en Firebase e inténtalo de nuevo.',
          true
        );
        throw error;
      });
    return root.__mexConfigReadyPromise;
  };

  root.__mexInvalidateConfigCache = function (plaza = '') {
    const key = safeText(plaza).toUpperCase();
    if (!key) {
      state.cache.clear();
      clearBootstrapWarm();
    } else {
      state.cache.delete(key);
      state.cache.delete('GLOBAL');
      if (key === 'GLOBAL') clearBootstrapWarm();
    }
    // Selects de mapa/cuadre dependen de MEX_CONFIG; invalidar su cache en memoria.
    try {
      if (typeof root.__mexInvalidateSelectsCache === 'function') {
        root.__mexInvalidateSelectsCache();
      }
    } catch (_) { /* no-op si mapa aún no cargó */ }
  };

  root.__mexLoadCurrentUserRecord = async function (user = root._auth?.currentUser || root.auth?.currentUser || null, options = {}) {
    const activeUser = user || root._auth?.currentUser || root.auth?.currentUser || null;
    const email = lowerText(activeUser?.email || '');
    const uid = safeText(activeUser?.uid);
    const cacheKey = profileCacheMapKey(email || uid);
    const force = options?.force === true;
    const maxAgeMs = Number.isFinite(options?.maxAgeMs) ? Number(options.maxAgeMs) : PROFILE_CACHE_TTL_MS;

    if (!activeUser || (!email && !uid)) return null;

    if (!force) {
      const cached = readCachedCurrentUserRecord(email, { maxAgeMs });
      if (cached) {
        state.cache.set(cacheKey, Promise.resolve(cached));
        return cached;
      }
      if (state.cache.has(cacheKey)) return state.cache.get(cacheKey);
    }

    const task = fetchCurrentUserRecordDirect(activeUser)
      .then(record => {
        if (!record) {
          clearCachedCurrentUserRecord(email);
          state.cache.delete(cacheKey);
          return null;
        }
        const normalized = persistCachedCurrentUserRecord(record, activeUser);
        // (empresa context loading removed — single-tenant, MEX_CONFIG.empresa already set)
        return normalized;
      })
      .catch(error => {
        state.cache.delete(cacheKey);
        throw error;
      });

    state.cache.set(cacheKey, task);
    return task;
  };

  root.__mexSeedCurrentUserRecordCache = function (record = {}, user = root._auth?.currentUser || root.auth?.currentUser || null) {
    return persistCachedCurrentUserRecord(record, user);
  };

  root.__mexInvalidateCurrentUserRecordCache = function (userOrEmail = '') {
    const email = lowerText(
      typeof userOrEmail === 'string'
        ? userOrEmail
        : (userOrEmail?.email || userOrEmail?.id || '')
    );
    clearCachedCurrentUserRecord(email);
  };

  root.__mexGetExactLocationSnapshot = async function (options = {}) {
    const snapshot = await readExactLocation(options);
    if (snapshot.status === 'granted') ensureLocationWatch();
    return snapshot;
  };

  root.__mexGetLastExactLocationSnapshot = function () {
    return cloneLocationState();
  };

  root.__mexGetLastLocationAuditPayload = function () {
    const snapshot = cloneLocationState();
    const payload = {
      locationStatus: snapshot.status || 'pending'
    };
    if (snapshot.exactLocation) {
      payload.exactLocation = {
        ...snapshot.exactLocation,
        googleMapsUrl: safeText(snapshot.exactLocation.googleMapsUrl) || locationMapsUrl(snapshot.exactLocation)
      };
    }
    return payload;
  };

  root.__mexBuildLocationAuditPayload = async function (options = {}) {
    const snapshot = await root.__mexGetExactLocationSnapshot(options);
    const payload = {
      locationStatus: snapshot.status || 'pending'
    };
    if (snapshot.exactLocation) {
      payload.exactLocation = {
        ...snapshot.exactLocation,
        googleMapsUrl: safeText(snapshot.exactLocation.googleMapsUrl) || locationMapsUrl(snapshot.exactLocation)
      };
    }
    return payload;
  };

  async function queryGeolocationPermission() {
    try {
      if (!navigator?.permissions?.query) return { state: '', status: null };
      const status = await navigator.permissions.query({ name: 'geolocation' });
      return {
        state: safeText(status?.state).toLowerCase(),
        status
      };
    } catch (_) {
      return { state: '', status: null };
    }
  }

  root.__mexRequireLocationAccess = async function (options = {}) {
    const currentSnapshot = cloneLocationState();
    if (currentSnapshot.status === 'granted' && currentSnapshot.exactLocation) {
      ensureLocationWatch();
      hideLocationGate();
      return currentSnapshot;
    }

    // Fast-path persistente: si se concedió en una sesión reciente (<6h), hidratar
    // del localStorage (por usuario) y devolver YA, sin overlay → sin flash al abrir pestañas.
    // La verificación real del permiso corre en 2º plano: si fue revocado, limpia
    // el flag y el gate bloquea de inmediato.
    try {
      const saved = readLocationCache();
      if (saved && saved.exactLocation && saved.lastUpdated && (Date.now() - saved.lastUpdated) < 21600000) {
        applyLocationSnapshot('granted', saved.exactLocation, '');
        ensureLocationWatch();
        hideLocationGate();
        queryGeolocationPermission().then(({ state: st }) => {
          if (st === 'denied') {
            clearLocationCaches();
            applyLocationSnapshot('denied', null, 'Permiso de ubicación revocado.');
          }
        }).catch(() => {});
        readExactLocation({ force: false, timeoutMs: 15000 }).catch(() => {});
        return cloneLocationState();
      }
    } catch (_) {}

    if (state.location.pendingPromise) return state.location.pendingPromise;

    state.location.pendingPromise = (async () => {
      const { state: permissionState } = await queryGeolocationPermission();
      
      if (permissionState === 'granted') {
        ensureLocationWatch();
        hideLocationGate();
        state.location.pendingPromise = null;
        readExactLocation({ force: false, timeoutMs: 15000 }).catch(() => {});
        return cloneLocationState();
      }

      return new Promise(resolve => {
        const overlay = ensureLocationGateOverlay();
        if (!overlay) {
          state.location.pendingPromise = null;
          resolve(cloneLocationState());
          return;
        }

        const retryBtn = overlay.querySelector('#mexLocationGateRetry');
        const logoutBtn = overlay.querySelector('#mexLocationGateLogout');
        const cleanupFns = [];
        let settled = false;
        let attemptRunning = false;
        let currentAttemptId = 0;
        let attachedPermissionStatus = null;
        let permissionOnChangeHandler = null;
        let permissionPollTimer = null;

        const addCleanup = fn => {
          if (typeof fn === 'function') cleanupFns.push(fn);
        };

        const finish = snapshot => {
          if (settled) return;
          settled = true;
          cleanupFns.splice(0).forEach(fn => {
            try { fn(); } catch (_) {}
          });
          hideLocationGate();
          state.location.pendingPromise = null;
          resolve(snapshot);
        };

        const showPendingPermissionState = permissionState => {
          const normalized = safeText(permissionState).toLowerCase();
          if (normalized === 'granted') {
            updateLocationGate({
              title: safeText(options.title) || 'Ubicación detectada',
              copy: safeText(options.copy) || 'Permiso activo. Estamos confirmando la ubicación exacta para desbloquear la plataforma.',
              status: 'Permiso concedido. Validando ubicación exacta...',
              allowLogout: options.allowLogout === true
            });
            return;
          }
          if (normalized === 'denied') {
            updateLocationGate({
              variant: 'denied',
              title: safeText(options.title) || 'Ubicación requerida',
              copy: safeText(options.copy) || 'El permiso está bloqueado. Actívalo en el navegador o en ajustes del dispositivo y pulsa Reintentar.',
              status: 'El permiso está bloqueado. Actívalo en tu navegador o ajustes del dispositivo y vuelve a intentar.',
              allowLogout: options.allowLogout === true
            });
            return;
          }
          updateLocationGate({
            variant: 'prompt',
            title: safeText(options.title) || 'Permite tu ubicación',
            copy: safeText(options.copy) || 'Necesitamos tu ubicación exacta para registrar auditorías y movimientos. No podrás continuar hasta permitirla.',
            status: 'Esperando permiso del navegador...',
            allowLogout: options.allowLogout === true
          });
        };

        const attempt = async (force = true, source = 'manual') => {
          if (settled) return;
          if (attemptRunning && !force) return;
          const myAttemptId = ++currentAttemptId;
          attemptRunning = true;
          if (retryBtn) {
            retryBtn.disabled = true;
            setLocationRetryButton(retryBtn, 'Verificando...', true);
          }
          updateLocationGate({
            variant: 'prompt',
            title: safeText(options.title) || 'Permite tu ubicación',
            copy: safeText(options.copy) || 'Necesitamos tu ubicación exacta para registrar auditorías y movimientos. No podrás continuar hasta permitirla.',
            status: source === 'permission-change' ? 'Permiso actualizado. Validando ubicación exacta...' : 'Solicitando permiso del navegador...',
            allowLogout: options.allowLogout === true
          });

          let lastAttemptStatus = '';
          try {
            const snapshot = await root.__mexGetExactLocationSnapshot({
              force,
              timeoutMs: Number(options.timeoutMs || 12000),
              maxAgeMs: Number(options.maxAgeMs || 30000)
            });
            lastAttemptStatus = safeText(snapshot?.status);

            if (myAttemptId !== currentAttemptId) return;

            const usableSnapshot = snapshot?.exactLocation && snapshot?.status !== 'denied' && snapshot?.status !== 'unsupported';
            if (usableSnapshot) {
              finish({ ...snapshot, status: 'granted' });
              return;
            }

            const statusText = snapshot.status === 'denied'
              ? 'El permiso fue denegado. Actívalo en tu navegador o en los ajustes del dispositivo y vuelve a intentar.'
              : (snapshot.status === 'unsupported'
                ? 'Este equipo o navegador no expone geolocalización segura, así que no se puede abrir la plataforma.'
                : (snapshot.error || 'No pudimos leer tu ubicación exacta. Reintenta en unos segundos.'));

            updateLocationGate({
              variant: snapshot.status === 'denied' ? 'denied' : 'prompt',
              title: safeText(options.title) || (snapshot.status === 'denied' ? 'Ubicación requerida' : 'Permite tu ubicación'),
              copy: safeText(options.copy) || (snapshot.status === 'denied'
                ? 'El permiso está bloqueado. Actívalo en el navegador o en ajustes del dispositivo y pulsa Reintentar.'
                : 'Necesitamos tu ubicación exacta para registrar auditorías y movimientos. No podrás continuar hasta permitirla.'),
              status: statusText,
              allowLogout: options.allowLogout === true
            });
          } finally {
            if (myAttemptId === currentAttemptId) {
              attemptRunning = false;
              if (retryBtn) {
                retryBtn.disabled = false;
                setLocationRetryButton(
                  retryBtn,
                  lastAttemptStatus === 'denied' ? 'Reintentar' : 'Permitir ubicación',
                  false
                );
              }
            }
          }
        };

        if (retryBtn) retryBtn.onclick = () => {
          attempt(true, 'manual-click').catch(() => {});
        };

        if (logoutBtn) {
          logoutBtn.onclick = () => {
            try {
              root.firebase?.auth?.()?.signOut?.();
            } catch (_) {}
            window.location.replace('/login');
          };
        }

        const onLocationUpdated = event => {
          const detail = event?.detail || {};
          if (detail.status === 'granted' && detail.exactLocation) {
            finish(detail);
          }
        };
        root.addEventListener('mex-location-updated', onLocationUpdated);
        addCleanup(() => root.removeEventListener('mex-location-updated', onLocationUpdated));

        const onWindowFocus = () => {
          if (!settled) attempt(true, 'window-focus').catch(() => {});
        };
        const onVisibility = () => {
          if (document.visibilityState === 'visible' && !settled) {
            attempt(true, 'visibility').catch(() => {});
          }
        };
        root.addEventListener('focus', onWindowFocus);
        document.addEventListener('visibilitychange', onVisibility);
        addCleanup(() => root.removeEventListener('focus', onWindowFocus));
        addCleanup(() => document.removeEventListener('visibilitychange', onVisibility));

        queryGeolocationPermission().then(({ state: permissionState, status }) => {
          if (settled) return;
          showPendingPermissionState(permissionState);
          if (permissionState === 'granted') {
            attempt(true, 'permission-already-granted').catch(() => {});
          }
          if (!status) return;
          attachedPermissionStatus = status;
          permissionOnChangeHandler = () => {
            const nextState = safeText(attachedPermissionStatus?.state).toLowerCase();
            showPendingPermissionState(nextState);
            if (nextState === 'granted' && !settled) {
              attempt(true, 'permission-change').catch(() => {});
            }
          };
          if (typeof attachedPermissionStatus.addEventListener === 'function') {
            attachedPermissionStatus.addEventListener('change', permissionOnChangeHandler);
            addCleanup(() => attachedPermissionStatus.removeEventListener('change', permissionOnChangeHandler));
          }
        });

        permissionPollTimer = setInterval(() => {
          if (!settled && document.visibilityState === 'visible') {
            attempt(true, 'permission-poll').catch(() => {});
          }
        }, 1600);
        addCleanup(() => {
          if (permissionPollTimer) {
            clearInterval(permissionPollTimer);
            permissionPollTimer = null;
          }
        });

        attempt(options.force === true, 'initial').catch(() => {});
      });
    })();

    return state.location.pendingPromise;
  };

  if (!state.started) {
    state.started = true;
    const cachedBaseConfig = readCachedBaseConfig();
    root.MEX_CONFIG = mergeConfig(normalizeConfig(root.MEX_CONFIG || {}), cachedBaseConfig || {});
    injectBootstrapStyle();
    if (!cachedBaseConfig) {
      document.documentElement.classList.add('mex-app-booting');
      updateOverlay(
        'Cargando empresa...',
        'Estamos preparando la configuración básica antes de mostrar la plataforma.'
      );
    } else {
      state.resolved = true;
      applyPageBranding(root.MEX_CONFIG || {});
      markBootstrapWarm();
    }

    root.__mexConfigReadyPromise = root.__mexEnsureConfigLoaded('')
      .then(config => {
        state.resolved = true;
        applyPageBranding(config);
        persistCachedBaseConfig(config);
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => {
            applyPageBranding(config);
            if (!cachedBaseConfig) releaseOverlay();
          }, { once: true });
        } else {
          if (!cachedBaseConfig) releaseOverlay();
        }
        return config;
      })
      .catch(error => {
        console.error('[app-bootstrap] init', error);
        if (cachedBaseConfig) {
          state.resolved = true;
          applyPageBranding(cachedBaseConfig);
          return cachedBaseConfig;
        }
        updateOverlay(
          'No se pudo cargar la empresa',
          'Revisa tu conexión o la configuración base en Firebase e inténtalo de nuevo.',
          true
        );
        throw error;
      });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.documentElement.classList.contains('mex-app-booting')) ensureOverlayDom();
    applyPageBranding(root.MEX_CONFIG || {});
    if (state.resolved && document.documentElement.classList.contains('mex-app-booting')) releaseOverlay();
  });
})();
