(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const root = window;
  const DEFAULT_COMPANY_NAME = 'EMPRESA';
  const SESSION_BOOTSTRAP_CONFIG_KEY = 'mex.bootstrap.baseConfig.v1';
  const SESSION_BOOTSTRAP_WARM_KEY = 'mex.bootstrap.warm.v1';
  const SESSION_REVERSE_GEOCODE_KEY = 'mex.location.reverse.v1';
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
    cache: new Map(),
    location: {
      status: 'pending',
      exactLocation: null,
      lastUpdated: 0,
      error: '',
      watchId: null,
      pendingPromise: null
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

  function markBootstrapWarm() {
    try {
      sessionStorage.setItem(SESSION_BOOTSTRAP_WARM_KEY, '1');
    } catch (_) {}
  }

  function clearBootstrapWarm() {
    try {
      sessionStorage.removeItem(SESSION_BOOTSTRAP_WARM_KEY);
      sessionStorage.removeItem(SESSION_BOOTSTRAP_CONFIG_KEY);
    } catch (_) {}
  }

  function readCachedBaseConfig() {
    const cached = readSessionItem(SESSION_BOOTSTRAP_CONFIG_KEY, null);
    if (!cached || typeof cached !== 'object') return null;
    return normalizeConfig(cached);
  }

  function persistCachedBaseConfig(config = {}) {
    const normalized = normalizeConfig(config);
    if (writeSessionItem(SESSION_BOOTSTRAP_CONFIG_KEY, normalized)) {
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

  function normalizeConfig(config = {}) {
    return {
      empresa: {
        ...normalizeEmpresa(config?.empresa || {})
      },
      listas: {
        ...DEFAULT_LISTS,
        ...(config?.listas || {})
      }
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
      }
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

  function applyLocationSnapshot(status = 'pending', exactLocation = null, error = '') {
    state.location.status = safeText(status) || 'pending';
    state.location.exactLocation = exactLocation ? { ...exactLocation } : null;
    state.location.lastUpdated = Date.now();
    state.location.error = safeText(error);
    dispatchLocationUpdate();
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
        applyLocationSnapshot(denied ? 'denied' : 'error', null, error?.message || '');
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
    const maxAgeMs = Number(options.maxAgeMs || 45000);
    const now = Date.now();
    const current = cloneLocationState();
    if (!force && current.exactLocation && current.lastUpdated && (now - current.lastUpdated) <= maxAgeMs) {
      return current;
    }

    if (!root.isSecureContext || !navigator.geolocation) {
      return applyLocationSnapshot('unsupported', null, 'Geolocalización no disponible.');
    }

    return new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        async position => {
          const baseLocation = buildExactLocation(position);
          const exactLocation = baseLocation ? await reverseGeocodeLocation(baseLocation) : null;
          const snapshot = applyLocationSnapshot(exactLocation ? 'granted' : 'error', exactLocation, exactLocation ? '' : 'Coordenadas inválidas');
          if (snapshot.status === 'granted') ensureLocationWatch();
          resolve(snapshot);
        },
        error => {
          const denied = Number(error?.code) === 1;
          resolve(applyLocationSnapshot(denied ? 'denied' : 'error', null, error?.message || 'No se pudo obtener la ubicación.'));
        },
        {
          enableHighAccuracy: true,
          maximumAge: force ? 0 : Math.min(maxAgeMs, 30000),
          timeout: Number(options.timeoutMs || 12000)
        }
      );
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
        position: fixed;
        inset: 0;
        z-index: 999998;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(8, 15, 31, 0.72);
        backdrop-filter: blur(10px);
      }

      #mexLocationGateOverlay.active {
        display: flex;
      }

      .mex-location-gate-card {
        width: min(460px, 100%);
        padding: 30px 26px;
        border-radius: 28px;
        background: rgba(9, 17, 35, 0.92);
        border: 1px solid rgba(255,255,255,0.08);
        box-shadow: 0 28px 80px rgba(0, 0, 0, 0.45);
        color: #f8fafc;
        text-align: center;
      }

      .mex-location-gate-icon {
        width: 66px;
        height: 66px;
        margin: 0 auto 16px;
        border-radius: 22px;
        display: grid;
        place-items: center;
        background: linear-gradient(135deg, rgba(34,197,94,.22), rgba(59,130,246,.24));
        color: #bbf7d0;
      }

      .mex-location-gate-icon .material-icons {
        font-size: 34px;
      }

      .mex-location-gate-kicker {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(34,197,94,.12);
        color: #bbf7d0;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: .12em;
        text-transform: uppercase;
      }

      .mex-location-gate-title {
        margin: 16px 0 10px;
        font-size: 28px;
        font-weight: 900;
        line-height: 1.08;
      }

      .mex-location-gate-copy {
        margin: 0;
        color: #cbd5e1;
        font-size: 14px;
        line-height: 1.65;
      }

      .mex-location-gate-status {
        margin-top: 14px;
        padding: 12px 14px;
        border-radius: 16px;
        background: rgba(148, 163, 184, 0.12);
        color: #e2e8f0;
        font-size: 12px;
        font-weight: 800;
        line-height: 1.5;
      }

      .mex-location-gate-actions {
        display: flex;
        gap: 10px;
        justify-content: center;
        flex-wrap: wrap;
        margin-top: 18px;
      }

      .mex-location-gate-btn {
        min-height: 44px;
        padding: 0 16px;
        border-radius: 14px;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.08);
        color: white;
        font-size: 13px;
        font-weight: 900;
        cursor: pointer;
      }

      .mex-location-gate-btn.primary {
        background: linear-gradient(135deg, #2563eb, #22c55e);
        border-color: transparent;
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
    document.documentElement.classList.remove('mex-app-booting');
    const overlay = document.getElementById('mexAppBootstrapOverlay');
    if (!overlay) return;
    overlay.classList.add('ready');
    setTimeout(() => overlay.remove(), 240);
  }

  function ensureLocationGateOverlay() {
    let overlay = document.getElementById('mexLocationGateOverlay');
    if (overlay) return overlay;
    if (!document.body) return null;
    overlay = document.createElement('div');
    overlay.id = 'mexLocationGateOverlay';
    overlay.innerHTML = `
      <div class="mex-location-gate-card">
        <div class="mex-location-gate-icon"><span class="material-icons">my_location</span></div>
        <div class="mex-location-gate-kicker">Ubicación obligatoria</div>
        <h2 class="mex-location-gate-title">Activa tu ubicación</h2>
        <p class="mex-location-gate-copy">Necesitamos una ubicación exacta para habilitar auditoría operativa, movimientos y acciones sensibles dentro de la plataforma.</p>
        <div class="mex-location-gate-status" id="mexLocationGateStatus">Esperando permiso del navegador...</div>
        <div class="mex-location-gate-actions">
          <button type="button" class="mex-location-gate-btn primary" id="mexLocationGateRetry">Permitir ubicación</button>
          <button type="button" class="mex-location-gate-btn" id="mexLocationGateLogout" style="display:none;">Cerrar sesión</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function updateLocationGate(options = {}) {
    const overlay = ensureLocationGateOverlay();
    if (!overlay) return;
    overlay.classList.add('active');
    const titleEl = overlay.querySelector('.mex-location-gate-title');
    const copyEl = overlay.querySelector('.mex-location-gate-copy');
    const statusEl = overlay.querySelector('#mexLocationGateStatus');
    if (titleEl) titleEl.textContent = safeText(options.title) || 'Activa tu ubicación';
    if (copyEl) copyEl.textContent = safeText(options.copy) || `Necesitamos una ubicación exacta para habilitar auditoría operativa dentro de ${companyNameFrom(root.MEX_CONFIG)}.`;
    if (statusEl) statusEl.textContent = safeText(options.status) || 'Esperando permiso del navegador...';
    const logoutBtn = overlay.querySelector('#mexLocationGateLogout');
    if (logoutBtn) logoutBtn.style.display = options.allowLogout ? '' : 'none';
  }

  function hideLocationGate() {
    const overlay = document.getElementById('mexLocationGateOverlay');
    if (overlay) overlay.classList.remove('active');
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
    const [empresaSnap, listasSnap] = await Promise.all([
      root._db.collection('configuracion').doc('empresa').get(),
      root._db.collection('configuracion').doc('listas').get()
    ]);
    return normalizeConfig({
      empresa: empresaSnap.exists ? (empresaSnap.data() || {}) : {},
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
      return;
    }
    state.cache.delete(key);
    state.cache.delete('GLOBAL');
    if (key === 'GLOBAL') clearBootstrapWarm();
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

  root.__mexRequireLocationAccess = function (options = {}) {
    const currentSnapshot = cloneLocationState();
    if (currentSnapshot.status === 'granted' && currentSnapshot.exactLocation) {
      ensureLocationWatch();
      hideLocationGate();
      return Promise.resolve(currentSnapshot);
    }
    if (state.location.pendingPromise) return state.location.pendingPromise;

    state.location.pendingPromise = new Promise(resolve => {
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
      let attachedPermissionStatus = null;
      let permissionOnChangeHandler = null;

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
            title: safeText(options.title) || 'Ubicación requerida',
            copy: safeText(options.copy) || 'La plataforma necesita tu ubicación exacta para permitir movimientos, auditorías y acciones administrativas.',
            status: 'El permiso está bloqueado. Actívalo en tu navegador o ajustes del dispositivo y vuelve a intentar.',
            allowLogout: options.allowLogout === true
          });
          return;
        }
        updateLocationGate({
          title: safeText(options.title) || 'Activa tu ubicación',
          copy: safeText(options.copy) || `Para entrar a ${companyNameFrom(root.MEX_CONFIG)} debes permitir ubicación exacta. Esto protege auditorías, movimientos y cambios sensibles.`,
          status: 'Esperando permiso del navegador...',
          allowLogout: options.allowLogout === true
        });
      };

      const attempt = async (force = true, source = 'manual') => {
        if (settled || attemptRunning) return;
        attemptRunning = true;
        if (retryBtn) {
          retryBtn.disabled = true;
          retryBtn.textContent = 'Verificando...';
        }
        updateLocationGate({
          title: safeText(options.title) || 'Activa tu ubicación',
          copy: safeText(options.copy) || `Para entrar a ${companyNameFrom(root.MEX_CONFIG)} debes permitir ubicación exacta. Esto protege auditorías, movimientos y cambios sensibles.`,
          status: source === 'permission-change' ? 'Permiso actualizado. Validando ubicación exacta...' : 'Solicitando permiso del navegador...',
          allowLogout: options.allowLogout === true
        });

        try {
          const snapshot = await root.__mexGetExactLocationSnapshot({
            force,
            timeoutMs: Number(options.timeoutMs || 12000),
            maxAgeMs: Number(options.maxAgeMs || 30000)
          });

          if (snapshot.status === 'granted' && snapshot.exactLocation) {
            finish(snapshot);
            return;
          }

          const statusText = snapshot.status === 'denied'
            ? 'El permiso fue denegado. Actívalo en tu navegador o en los ajustes del dispositivo y vuelve a intentar.'
            : (snapshot.status === 'unsupported'
              ? 'Este equipo o navegador no expone geolocalización segura, así que no se puede abrir la plataforma.'
              : (snapshot.error || 'No pudimos leer tu ubicación exacta. Reintenta en unos segundos.'));

          updateLocationGate({
            title: safeText(options.title) || 'Ubicación requerida',
            copy: safeText(options.copy) || 'La plataforma necesita tu ubicación exacta para permitir movimientos, auditorías y acciones administrativas.',
            status: statusText,
            allowLogout: options.allowLogout === true
          });
        } finally {
          attemptRunning = false;
          if (retryBtn) {
            retryBtn.disabled = false;
            retryBtn.textContent = 'Permitir ubicación';
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
        } else {
          attachedPermissionStatus.onchange = permissionOnChangeHandler;
          addCleanup(() => {
            if (attachedPermissionStatus?.onchange === permissionOnChangeHandler) {
              attachedPermissionStatus.onchange = null;
            }
          });
        }
      }).catch(() => {});

      attempt(options.force === true, 'initial').catch(() => {});
    });

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
