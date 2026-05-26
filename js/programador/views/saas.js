// ═══════════════════════════════════════════════════════════
//  /js/programador/views/saas.js
//  Gestión de tenants: lista de empresas, plans, features.
//  No carga datos operativos — solo el documento empresas/{id}.
// ═══════════════════════════════════════════════════════════

let _container = null;
let _navigate  = null;
let _empresas  = [];
let _filtered  = [];
let _query     = '';
let _filterTipo = '';
let _filterPlan = '';

export async function mount({ container, navigate }) {
  _container = container;
  _navigate  = navigate;
  _query = _filterTipo = _filterPlan = '';
  _renderSkeleton();

  try {
    const snap = await window._db.collection('empresas').orderBy('nombre').get();
    _empresas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _filtered = [..._empresas];
  } catch (err) {
    if (_container) _container.innerHTML = `<div style="padding:40px;color:#f87171;font-size:13px;">Error: ${_esc(err.message)}</div>`;
    return;
  }

  _render();
  _bind();
}

export function unmount() {
  _container = null;
  _navigate  = null;
  _empresas  = [];
  _filtered  = [];
}

// ── Acciones ──────────────────────────────────────────────

async function _enterEmpresa(btn, empresaId) {
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;">refresh</span>';

  try {
    if (typeof window.mexEmpresaContext?.switchEmpresa === 'function') {
      await window.mexEmpresaContext.switchEmpresa(empresaId);
    } else {
      const doc = await window._db.collection('empresas').doc(empresaId).get();
      if (!doc.exists) throw new Error('Empresa no encontrada');
      window._empresaActual = { id: doc.id, ...doc.data() };
      sessionStorage.setItem('mex.empresaCtx.v1', JSON.stringify(empresaId));
      localStorage.setItem('mex.empresaCtx.local.v1', JSON.stringify(empresaId));
    }
    window.location.href = '/app/dashboard';
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = orig;
    _toast('Error: ' + err.message, 'error');
  }
}

// ── Filtrado ──────────────────────────────────────────────

function _applyFilters() {
  const q = _query.toLowerCase();
  _filtered = _empresas.filter(e => {
    const matchQ = !q
      || String(e.nombre || '').toLowerCase().includes(q)
      || String(e.id || '').toLowerCase().includes(q);
    const matchTipo = !_filterTipo || e.tipo_negocio === _filterTipo;
    const matchPlan = !_filterPlan || e.plan === _filterPlan;
    return matchQ && matchTipo && matchPlan;
  });
}

// ── Nueva Empresa Modal ───────────────────────────────────

function _openNuevaEmpresaModal(navigate) {
  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.id = 'nuevaEmpresaOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;animation:fadeIn 0.2s ease;';

  overlay.innerHTML = `
    <div style="background:var(--p-card,#0f1b2d);border-radius:20px;padding:28px;width:100%;max-width:480px;border:1px solid var(--p-border,rgba(255,255,255,0.1));box-shadow:0 40px 80px rgba(0,0,0,0.6);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
        <div>
          <h3 style="margin:0;font-size:18px;font-weight:800;color:var(--p-text,#e2e8f0);">Nueva Empresa</h3>
          <p style="margin:4px 0 0;font-size:12px;color:var(--p-text-muted,#64748b);">Crea un nuevo tenant en la plataforma</p>
        </div>
        <button id="closeNuevaEmpresa" style="background:transparent;border:none;color:var(--p-text-muted,#64748b);cursor:pointer;padding:4px;border-radius:8px;display:flex;align-items:center;">
          <span class="material-symbols-outlined" style="font-size:20px;">close</span>
        </button>
      </div>

      <div style="display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="display:block;font-size:11px;font-weight:700;color:var(--p-text-muted,#64748b);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">Nombre de la empresa *</label>
          <input id="neNombre" type="text" placeholder="Ej: Estacionamiento Central" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--p-border,rgba(255,255,255,0.12));background:var(--p-bg,#070d16);color:var(--p-text,#e2e8f0);font-size:13px;outline:none;box-sizing:border-box;font-family:inherit;">
        </div>
        <div>
          <label style="display:block;font-size:11px;font-weight:700;color:var(--p-text-muted,#64748b);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">ID único *</label>
          <input id="neId" type="text" placeholder="estacionamiento-central" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--p-border,rgba(255,255,255,0.12));background:var(--p-bg,#070d16);color:var(--p-text,#e2e8f0);font-size:13px;outline:none;box-sizing:border-box;font-family:inherit;font-family:monospace;">
          <p style="margin:4px 0 0;font-size:11px;color:var(--p-text-muted,#475569);">Solo letras minúsculas, números y guiones. Usado como document ID.</p>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="display:block;font-size:11px;font-weight:700;color:var(--p-text-muted,#64748b);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">Tipo de negocio</label>
            <select id="neTipo" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--p-border,rgba(255,255,255,0.12));background:var(--p-bg,#070d16);color:var(--p-text,#e2e8f0);font-size:13px;outline:none;box-sizing:border-box;font-family:inherit;">
              <option value="ESTACIONAMIENTO">Estacionamiento</option>
              <option value="RENTA_AUTOS">Renta de Autos</option>
              <option value="FLOTA">Flota / Logística</option>
              <option value="GENERICO">Otro</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:11px;font-weight:700;color:var(--p-text-muted,#64748b);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">Plan</label>
            <select id="nePlan" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--p-border,rgba(255,255,255,0.12));background:var(--p-bg,#070d16);color:var(--p-text,#e2e8f0);font-size:13px;outline:none;box-sizing:border-box;font-family:inherit;">
              <option value="lite">Mapa Lite — $990 MXN/mes</option>
              <option value="local" selected>Local — $1,990 MXN/mes</option>
              <option value="regional">Regional — $4,490 MXN/mes</option>
              <option value="corporativo">Corporativo — $9,990 MXN/mes</option>
            </select>
          </div>
        </div>

        <!-- Resumen del plan seleccionado (se actualiza dinámicamente) -->
        <div id="nePlanInfo" style="border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);padding:12px 14px;font-size:12px;"></div>

        <div id="neError" style="display:none;padding:10px 14px;border-radius:10px;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);color:#f87171;font-size:13px;"></div>

        <div style="display:flex;gap:10px;margin-top:4px;">
          <button id="cancelNuevaEmpresa" style="flex:1;padding:11px;border-radius:10px;border:1px solid var(--p-border,rgba(255,255,255,0.1));background:transparent;color:var(--p-text-muted,#64748b);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Cancelar</button>
          <button id="submitNuevaEmpresa" style="flex:2;padding:11px;border-radius:10px;border:none;background:linear-gradient(135deg,#6366f1,#818cf8);color:white;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">Crear Empresa</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // Auto-generate ID from nombre
  document.getElementById('neNombre')?.addEventListener('input', (e) => {
    const id = e.target.value
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim().replace(/\s+/g, '-');
    document.getElementById('neId').value = id;
  });

  // Render plan summary card
  function _renderPlanInfo(planKey) {
    const PLANES = window.mexFeatures?.PLANES;
    const infoEl = document.getElementById('nePlanInfo');
    if (!infoEl) return;
    if (!PLANES || !PLANES[planKey]) {
      infoEl.innerHTML = '';
      return;
    }
    const p = PLANES[planKey];
    const lim = p.limites;
    const plazasLabel  = lim.maxPlazas  === -1 ? 'Ilimitadas' : lim.maxPlazas;
    const usuariosLabel= lim.maxUsuarios === -1 ? 'Ilimitados' : lim.maxUsuarios;
    const gpsLabel     = lim.gps_refresh_sec >= 60 ? `Cada ${lim.gps_refresh_sec/60} min` : `Cada ${lim.gps_refresh_sec} seg`;
    const histLabel    = lim.historial_dias === 365 ? '1 año' : `${lim.historial_dias} días`;

    const featureMap = [
      ['cuadre','Cuadre'], ['alertas','Alertas'], ['incidencias','Incidencias'],
      ['cola_preparacion','Cola prep.'], ['mensajeria','Mensajería'], ['reportes','Reportes'],
      ['multi_plaza','Multi-plaza'], ['api_access','API'], ['white_label','White-label'],
    ];
    const pills = featureMap.map(([k, l]) => {
      const on = p.features[k] === true;
      return `<span style="font-size:10px;padding:2px 7px;border-radius:20px;
        border:1px solid ${on ? 'rgba(59,130,246,0.35)' : 'rgba(255,255,255,0.07)'};
        color:${on ? '#93c5fd' : 'rgba(255,255,255,0.2)'};
        background:${on ? 'rgba(59,130,246,0.08)' : 'transparent'};
        text-decoration:${on ? 'none' : 'line-through'};
      ">${l}</span>`;
    }).join('');

    infoEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="font-size:11px;font-weight:800;text-transform:uppercase;
          padding:2px 8px;border-radius:5px;background:${p.color};color:#fff;">
          ${p.label}
        </span>
        <span style="font-size:12px;color:rgba(255,255,255,0.5);">$${p.precio_mxn.toLocaleString('es-MX')} MXN/mes</span>
      </div>
      <div style="display:flex;gap:16px;margin-bottom:8px;font-size:11px;color:rgba(255,255,255,0.45);">
        <span>Plazas: <strong style="color:rgba(255,255,255,0.75);">${plazasLabel}</strong></span>
        <span>Usuarios: <strong style="color:rgba(255,255,255,0.75);">${usuariosLabel}</strong></span>
        <span>GPS: <strong style="color:rgba(255,255,255,0.75);">${gpsLabel}</strong></span>
        <span>Historial: <strong style="color:rgba(255,255,255,0.75);">${histLabel}</strong></span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;">${pills}</div>`;
  }

  // Init plan info and listen for changes
  _renderPlanInfo('local');
  document.getElementById('nePlan')?.addEventListener('change', (e) => _renderPlanInfo(e.target.value));

  function close() { overlay.remove(); }
  document.getElementById('closeNuevaEmpresa')?.addEventListener('click', close);
  document.getElementById('cancelNuevaEmpresa')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  document.getElementById('submitNuevaEmpresa')?.addEventListener('click', async () => {
    const nombre  = document.getElementById('neNombre')?.value.trim();
    const id      = document.getElementById('neId')?.value.trim();
    const tipo    = document.getElementById('neTipo')?.value;
    const planKey = document.getElementById('nePlan')?.value;
    const errorEl = document.getElementById('neError');

    if (!nombre || !id) {
      errorEl.textContent = 'El nombre y el ID son obligatorios.';
      errorEl.style.display = 'block';
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(id) && !/^[a-z0-9]$/.test(id)) {
      errorEl.textContent = 'El ID solo puede contener letras minúsculas, números y guiones.';
      errorEl.style.display = 'block';
      return;
    }
    errorEl.style.display = 'none';

    const btn = document.getElementById('submitNuevaEmpresa');
    btn.disabled = true;
    btn.textContent = 'Creando...';

    // Obtener features y límites del catálogo de planes
    const PLANES = window.mexFeatures?.PLANES;
    const planDef = PLANES?.[planKey];
    const features = planDef ? { ...planDef.features } : {};
    const limites  = planDef ? { ...planDef.limites  } : { maxPlazas: 1, maxUsuarios: 10, maxUnidades: -1, gps_refresh_sec: 30, historial_dias: 90 };

    try {
      const existing = await window._db.collection('empresas').doc(id).get();
      if (existing.exists) {
        errorEl.textContent = 'Ya existe una empresa con ese ID. Elige otro.';
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Crear Empresa';
        return;
      }

      await window._db.collection('empresas').doc(id).set({
        nombre,
        slug:         id,
        tipo_negocio: tipo,
        plan:         planKey,
        features,
        limites,
        plazas:       [],
        plazasDetalle:{},
        branding:     { nombre, nombreComercial: nombre, colorPrincipal: planDef?.color || '#3b82f6', correosInternos: [] },
        activa:       true,
        onboarding_completado: false,
        onboarding_paso:       'inicio',
        creadaEn:     firebase.firestore.FieldValue.serverTimestamp(),
        _updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
      });

      close();
      _toast(`Empresa "${nombre}" creada con plan ${planDef?.label || planKey}.`, 'success');
      setTimeout(() => navigate('/programador/saas'), 300);
    } catch (err) {
      console.error('[saas] createEmpresa:', err);
      errorEl.textContent = 'Error al crear la empresa: ' + (err.message || err);
      errorEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Crear Empresa';
    }
  });
}

// ── Bind ──────────────────────────────────────────────────

function _bind(navigate) {
  const searchEl = _container?.querySelector('#saasSearch');
  const tipoEl   = _container?.querySelector('#saasTipo');
  const planEl   = _container?.querySelector('#saasPlan');

  searchEl?.addEventListener('input', () => {
    _query = searchEl.value;
    _applyFilters();
    _rerenderGrid();
  });
  tipoEl?.addEventListener('change', () => {
    _filterTipo = tipoEl.value;
    _applyFilters();
    _rerenderGrid();
  });
  planEl?.addEventListener('change', () => {
    _filterPlan = planEl.value;
    _applyFilters();
    _rerenderGrid();
  });

  _container?.addEventListener('click', async e => {
    const enterBtn = e.target.closest('[data-enter-empresa]');
    if (enterBtn && !enterBtn.disabled) {
      await _enterEmpresa(enterBtn, enterBtn.dataset.enterEmpresa);
    }
    const newBtn = e.target.closest('[data-new-empresa]');
    if (newBtn) {
      _openNuevaEmpresaModal(_navigate);
    }
  });
}

// ── Render ────────────────────────────────────────────────

function _render() {
  if (!_container) return;
  _container.innerHTML = _html();
}

function _rerenderGrid() {
  const grid = _container?.querySelector('#saasGrid');
  if (!grid) return;
  grid.innerHTML = _gridHtml();
  const count = _container?.querySelector('#saasCount');
  if (count) count.textContent = `${_filtered.length} empresa${_filtered.length !== 1 ? 's' : ''}`;
}

function _renderSkeleton() {
  if (!_container) return;
  _container.innerHTML = `<div style="padding:24px 28px;display:flex;flex-direction:column;gap:14px;">
    <div style="height:40px;width:300px;background:rgba(255,255,255,0.04);border-radius:8px;animation:skelPulse 1.4s ease-in-out infinite;"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;">
      ${[...Array(4)].map(() => `<div style="height:170px;background:rgba(255,255,255,0.04);border-radius:12px;animation:skelPulse 1.4s ease-in-out infinite;"></div>`).join('')}
    </div>
    <style>@keyframes skelPulse{0%,100%{opacity:.4}50%{opacity:.9}}</style>
  </div>`;
}

function _html() {
  const tipos = [...new Set(_empresas.map(e => e.tipo_negocio).filter(Boolean))];
  const planes = [...new Set(_empresas.map(e => e.plan).filter(Boolean))];

  return `
<div style="padding:20px;max-width:1400px;margin:0 auto;">

  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
    <div>
      <h2 style="margin:0 0 3px;font-size:20px;font-weight:800;color:#fff;">Empresas · SaaS</h2>
      <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.3);" id="saasCount">
        ${_empresas.length} empresa${_empresas.length !== 1 ? 's' : ''} registradas
      </p>
    </div>
    <button data-new-empresa type="button" style="
      display:flex;align-items:center;gap:7px;padding:9px 14px;
      border-radius:9px;background:rgba(99,102,241,0.12);
      border:1px solid rgba(99,102,241,0.28);
      color:#a5b4fc;font-size:13px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;
      white-space:nowrap;
    ">
      <span class="material-symbols-outlined" style="font-size:16px;">add</span>
      Nueva empresa
    </button>
  </div>

  <!-- Filtros -->
  <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
    <div style="position:relative;flex:1;min-width:180px;max-width:320px;">
      <span class="material-symbols-outlined" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:16px;color:rgba(255,255,255,0.3);pointer-events:none;">search</span>
      <input id="saasSearch" type="text" placeholder="Buscar empresa o ID…" style="
        width:100%;padding:8px 10px 8px 34px;
        background:#0f1b2d;border:1px solid rgba(255,255,255,0.1);border-radius:8px;
        color:#fff;font-size:13px;font-family:Inter,sans-serif;outline:none;
      "/>
    </div>
    <select id="saasTipo" style="padding:8px 10px;background:#0f1b2d;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:rgba(255,255,255,0.65);font-size:12px;font-family:Inter,sans-serif;cursor:pointer;">
      <option value="">Todos los tipos</option>
      ${tipos.map(t => `<option value="${_esc(t)}">${_esc(_tipoLabel(t))}</option>`).join('')}
    </select>
    <select id="saasPlan" style="padding:8px 10px;background:#0f1b2d;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:rgba(255,255,255,0.65);font-size:12px;font-family:Inter,sans-serif;cursor:pointer;">
      <option value="">Todos los planes</option>
      ${planes.map(p => `<option value="${_esc(p)}">${_esc(p)}</option>`).join('')}
    </select>
  </div>

  <!-- Grid -->
  <div id="saasGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">
    ${_gridHtml()}
  </div>
</div>
<div id="saasToastHost" style="position:fixed;bottom:20px;right:20px;z-index:400;display:flex;flex-direction:column;gap:8px;pointer-events:none;"></div>`;
}

function _gridHtml() {
  if (!_filtered.length) {
    return `<div style="grid-column:1/-1;padding:60px;text-align:center;color:rgba(255,255,255,0.2);">
      <span class="material-symbols-outlined" style="font-size:48px;display:block;margin-bottom:10px;color:rgba(255,255,255,0.08);">search_off</span>
      Sin resultados para los filtros aplicados.
    </div>`;
  }
  return _filtered.map(_card).join('');
}

function _card(e) {
  const nombre   = String(e.nombre || e.id || '—');
  const plazas   = Array.isArray(e.plazas) ? e.plazas : Object.keys(e.plazasDetalle || {});
  const features = e.features || {};
  const color    = String((e.branding || {}).colorPrincipal || '#6366f1');
  const isActive = e.activo !== false;

  return `
<div style="
  background:#0f1b2d;border:1px solid rgba(255,255,255,${isActive ? '0.07' : '0.04'});
  border-radius:13px;overflow:hidden;display:flex;flex-direction:column;
  opacity:${isActive ? '1' : '0.55'};
">
  <div style="height:3px;background:${_esc(color)};flex-shrink:0;"></div>
  <div style="padding:14px 15px 13px;flex:1;display:flex;flex-direction:column;gap:9px;">

    <!-- Nombre + plan -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
      <div style="min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
          <div style="font-size:14px;font-weight:800;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(nombre)}</div>
          ${!isActive ? `<span style="font-size:9px;font-weight:700;background:rgba(239,68,68,0.15);color:#f87171;border-radius:4px;padding:1px 5px;flex-shrink:0;">INACTIVA</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
          <span style="font-size:10px;color:rgba(255,255,255,0.35);">${_esc(_tipoLabel(e.tipo_negocio))}</span>
          <span style="font-size:9px;color:rgba(255,255,255,0.2);font-family:monospace;">${_esc(e.id)}</span>
        </div>
      </div>
      ${_planBadge(e.plan)}
    </div>

    <!-- Feature pills -->
    <div style="display:flex;flex-wrap:wrap;gap:4px;">
      ${_featurePills(features)}
    </div>

    <!-- Límites + stats -->
    <div style="display:flex;gap:14px;">
      ${_limitCell('Plazas', `${plazas.length}${e.limites?.maxPlazas > 0 ? '/' + e.limites.maxPlazas : ''}`)}
      ${_limitCell('Máx usuarios', e.limites?.maxUsuarios > 0 ? e.limites.maxUsuarios : '∞')}
      ${_limitCell('Onboarding', e.onboarding_completado ? '✓' : '—')}
    </div>

    <!-- Botones -->
    <div style="display:flex;gap:7px;margin-top:auto;padding-top:2px;">
      <a data-prog-route="/programador/empresa/${_esc(e.id)}/config"
         href="/programador/empresa/${_esc(e.id)}/config"
         style="
           flex:1;display:flex;align-items:center;justify-content:center;gap:5px;
           padding:7px 10px;border-radius:7px;
           background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
           color:rgba(255,255,255,0.65);text-decoration:none;
           font-size:11px;font-family:Inter,sans-serif;font-weight:700;
         ">
        <span class="material-symbols-outlined" style="font-size:14px;">settings</span>
        Gestionar
      </a>
      <button data-enter-empresa="${_esc(e.id)}" type="button" style="
        flex:1;display:flex;align-items:center;justify-content:center;gap:5px;
        padding:7px 10px;border-radius:7px;
        background:#6366f1;color:#fff;border:none;
        font-size:11px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;
      ">
        <span class="material-symbols-outlined" style="font-size:14px;">login</span>
        Ver App
      </button>
    </div>
  </div>
</div>`;
}

// ── Helpers ───────────────────────────────────────────────

function _limitCell(label, val) {
  return `<div style="font-size:11px;">
    <div style="color:rgba(255,255,255,0.25);">${_esc(label)}</div>
    <div style="color:rgba(255,255,255,0.7);font-weight:700;margin-top:2px;">${_esc(String(val))}</div>
  </div>`;
}

function _planBadge(plan) {
  const p = String(plan || '').toLowerCase();
  const PLANES = window.mexFeatures?.PLANES;
  const color = PLANES?.[p]?.color || { starter:'#d97706', business:'#6366f1', enterprise:'#059669', free:'#334155', pro:'#8b5cf6' }[p] || '#334155';
  const label = PLANES?.[p]?.label || plan || '—';
  return `<span style="flex-shrink:0;font-size:10px;font-weight:800;text-transform:uppercase;border-radius:5px;padding:2px 7px;background:${color};color:#fff;">${_esc(label)}</span>`;
}

function _featurePills(f) {
  return [
    ['alertas','Alertas'], ['cuadre','Cuadre'], ['mensajeria','Msgs'],
    ['incidencias','Incid.'], ['ia_placas','IA'], ['cola_preparacion','Cola'],
  ].map(([k, l]) => {
    const on = f[k] !== false;
    return `<span style="font-size:10px;padding:2px 6px;border-radius:20px;border:1px solid ${on?'rgba(99,102,241,0.3)':'rgba(255,255,255,0.06)'};color:${on?'#a5b4fc':'rgba(255,255,255,0.18)'};background:${on?'rgba(99,102,241,0.07)':'transparent'};">${l}</span>`;
  }).join('');
}

function _tipoLabel(t) {
  return { RENTA_AUTOS:'Renta Autos', ESTACIONAMIENTO:'Estacionamiento', FLOTA:'Flota', GENERICO:'Genérico' }[t] || (t || '—');
}

function _toast(msg, type = 'info') {
  const host = document.getElementById('saasToastHost');
  if (!host) return;
  const el = document.createElement('div');
  const tone = type === 'error'
    ? 'background:#fee2e2;color:#7f1d1d;border:1px solid #fecaca;'
    : 'background:#e0e7ff;color:#1e1b4b;border:1px solid #c7d2fe;';
  el.style.cssText = `pointer-events:auto;padding:10px 14px;border-radius:9px;font-size:13px;font-weight:600;max-width:320px;box-shadow:0 8px 20px rgba(0,0,0,.5);${tone}`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { try { el.remove(); } catch (_) {} }, 4000);
}

function _esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
