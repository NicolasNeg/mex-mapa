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

// ── Bind ──────────────────────────────────────────────────

function _bind() {
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
      _toast('Creación de empresas: próximamente desde este panel', 'info');
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
<div style="padding:24px 28px;max-width:1400px;margin:0 auto;">

  <!-- Header -->
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
    <div>
      <h2 style="margin:0 0 4px;font-size:21px;font-weight:800;color:#fff;">Empresas · SaaS</h2>
      <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.3);" id="saasCount">
        ${_empresas.length} empresa${_empresas.length !== 1 ? 's' : ''} registradas
      </p>
    </div>
    <button data-new-empresa type="button" style="
      display:flex;align-items:center;gap:7px;padding:9px 14px;
      border-radius:9px;background:rgba(99,102,241,0.12);
      border:1px solid rgba(99,102,241,0.28);
      color:#a5b4fc;font-size:13px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;
    ">
      <span class="material-symbols-outlined" style="font-size:16px;">add</span>
      Nueva empresa
    </button>
  </div>

  <!-- Filtros -->
  <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap;">
    <div style="position:relative;flex:1;min-width:200px;max-width:320px;">
      <span class="material-symbols-outlined" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:16px;color:rgba(255,255,255,0.3);pointer-events:none;">search</span>
      <input id="saasSearch" type="text" placeholder="Buscar empresa o ID…" style="
        width:100%;padding:8px 10px 8px 34px;
        background:#0f1b2d;border:1px solid rgba(255,255,255,0.1);border-radius:8px;
        color:#fff;font-size:13px;font-family:Inter,sans-serif;outline:none;
      "/>
    </div>
    <select id="saasTipo" style="padding:8px 12px;background:#0f1b2d;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:rgba(255,255,255,0.65);font-size:12px;font-family:Inter,sans-serif;cursor:pointer;">
      <option value="">Todos los tipos</option>
      ${tipos.map(t => `<option value="${_esc(t)}">${_esc(_tipoLabel(t))}</option>`).join('')}
    </select>
    <select id="saasPlan" style="padding:8px 12px;background:#0f1b2d;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:rgba(255,255,255,0.65);font-size:12px;font-family:Inter,sans-serif;cursor:pointer;">
      <option value="">Todos los planes</option>
      ${planes.map(p => `<option value="${_esc(p)}">${_esc(p)}</option>`).join('')}
    </select>
  </div>

  <!-- Grid -->
  <div id="saasGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;">
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

  return `
<div style="
  background:#0f1b2d;border:1px solid rgba(255,255,255,0.07);
  border-radius:13px;overflow:hidden;
  display:flex;flex-direction:column;
">
  <div style="height:3px;background:${_esc(color)};flex-shrink:0;"></div>
  <div style="padding:15px 16px 14px;flex:1;display:flex;flex-direction:column;gap:10px;">

    <!-- Nombre + plan -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
      <div style="min-width:0;">
        <div style="font-size:15px;font-weight:800;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(nombre)}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap;">
          <span style="font-size:11px;color:rgba(255,255,255,0.4);">${_esc(_tipoLabel(e.tipo_negocio))}</span>
          <span style="font-size:10px;color:rgba(255,255,255,0.2);font-family:monospace;">${_esc(e.id)}</span>
        </div>
      </div>
      ${_planBadge(e.plan)}
    </div>

    <!-- Feature pills -->
    <div style="display:flex;flex-wrap:wrap;gap:4px;">
      ${_featurePills(features)}
    </div>

    <!-- Límites -->
    <div style="display:flex;gap:12px;">
      ${_limitCell('Plazas', `${plazas.length}${e.limites?.maxPlazas > 0 ? '/' + e.limites.maxPlazas : ''}`)}
      ${_limitCell('Usuarios', e.limites?.maxUsuarios > 0 ? `máx ${e.limites.maxUsuarios}` : '∞')}
      ${_limitCell('Onboarding', e.onboarding_completado ? '✓' : 'pendiente')}
    </div>

    <!-- Botones -->
    <div style="display:flex;gap:8px;margin-top:auto;padding-top:2px;">
      <a data-prog-route="/programador/empresa/${_esc(e.id)}/config"
         href="/programador/empresa/${_esc(e.id)}/config"
         style="
           flex:1;display:flex;align-items:center;justify-content:center;gap:5px;
           padding:7px 10px;border-radius:7px;
           background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
           color:rgba(255,255,255,0.65);text-decoration:none;
           font-size:12px;font-family:Inter,sans-serif;font-weight:700;
         ">
        <span class="material-symbols-outlined" style="font-size:14px;">settings</span>
        Gestionar
      </a>
      <button data-enter-empresa="${_esc(e.id)}" type="button" style="
        flex:1;display:flex;align-items:center;justify-content:center;gap:5px;
        padding:7px 10px;border-radius:7px;
        background:#6366f1;color:#fff;border:none;
        font-size:12px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;
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
  const p = String(plan || 'free').toLowerCase();
  const bg = { starter:'#d97706', business:'#6366f1', enterprise:'#059669', free:'#334155' }[p] || '#334155';
  return `<span style="flex-shrink:0;font-size:10px;font-weight:800;text-transform:uppercase;border-radius:5px;padding:2px 7px;background:${bg};color:#fff;">${_esc(plan || 'free')}</span>`;
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
