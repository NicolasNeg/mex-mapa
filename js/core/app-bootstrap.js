(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const root = window;
  const DEFAULT_COMPANY_NAME = 'EMPRESA';
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
    cache: new Map()
  });

  function safeText(value) {
    return String(value || '').trim();
  }

  function normalizeConfig(config = {}) {
    return {
      empresa: {
        ...(config?.empresa || {})
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

  function applyPageBranding(config = root.MEX_CONFIG || {}) {
    root.MEX_CONFIG = mergeConfig(root.MEX_CONFIG || {}, config);
    const companyName = companyNameFrom(root.MEX_CONFIG);
    root.__mexCompanyName = companyName;

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

  if (!state.started) {
    state.started = true;
    root.MEX_CONFIG = normalizeConfig(root.MEX_CONFIG || {});
    injectBootstrapStyle();
    document.documentElement.classList.add('mex-app-booting');
    updateOverlay(
      'Cargando empresa...',
      'Estamos preparando la configuración básica antes de mostrar la plataforma.'
    );

    root.__mexConfigReadyPromise = root.__mexEnsureConfigLoaded('')
      .then(config => {
        state.resolved = true;
        applyPageBranding(config);
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => {
            applyPageBranding(config);
            releaseOverlay();
          }, { once: true });
        } else {
          releaseOverlay();
        }
        return config;
      })
      .catch(error => {
        console.error('[app-bootstrap] init', error);
        updateOverlay(
          'No se pudo cargar la empresa',
          'Revisa tu conexión o la configuración base en Firebase e inténtalo de nuevo.',
          true
        );
        throw error;
      });
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureOverlayDom();
    applyPageBranding(root.MEX_CONFIG || {});
    if (state.resolved) releaseOverlay();
  });
})();
