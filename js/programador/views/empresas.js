// ═══════════════════════════════════════════════════════════
//  /js/programador/views/empresas.js
//  Lista y gestión de empresas (tenants) para el PROGRAMADOR.
// ═══════════════════════════════════════════════════════════

let _container = null;
let _empresas  = [];

export async function mount({ container }) {
  _container = container;
  _render('<div style="padding:40px;text-align:center;color:rgba(255,255,255,0.25);font-size:13px;">Cargando empresas…</div>');

  try {
    const snap = await window._db.collection('empresas').orderBy('nombre').get();
    _empresas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    _render(`<div style="padding:40px;color:#f87171;font-size:13px;">Error: ${_esc(err.message)}</div>`);
    return;
  }

  _render(_html(_empresas));
  _bind();
}

export function unmount() {
  _container = null;
  _empresas  = [];
}

// ── Acciones ──────────────────────────────────────────────

async function _enterEmpresa(btn, empresaId) {
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;animation:progSpin .8s linear infinite;">refresh</span> Entrando…';

  try {
    if (typeof window.mexEmpresaContext?.switchEmpresa === 'function') {
      await window.mexEmpresaContext.switchEmpresa(empresaId);
    } else {
      // Fallback manual
      const doc = await window._db.collection('empresas').doc(empresaId).get();
      if (!doc.exists) throw new Error('Empresa no encontrada');
      const empresa = { id: doc.id, ...doc.data() };
      window._empresaActual = empresa;
      try {
        sessionStorage.setItem('mex.empresaCtx.v1', JSON.stringify(empresaId));
        localStorage.setItem('mex.empresaCtx.local.v1', JSON.stringify(empresaId));
      } catch (_) {}
    }
    window.location.href = '/app/dashboard';
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;">login</span> Entrar';
    _showToast('Error al entrar: ' + err.message, 'error');
  }
}

// ── Bind ──────────────────────────────────────────────────

function _bind() {
  _container?.addEventListener('click', async e => {
    const enterBtn = e.target.closest('[data-enter-empresa]');
    if (enterBtn && !enterBtn.disabled) {
      await _enterEmpresa(enterBtn, enterBtn.dataset.enterEmpresa);
      return;
    }

    const toggleBtn = e.target.closest('[data-toggle-details]');
    if (toggleBtn) {
      const id = toggleBtn.dataset.toggleDetails;
      const details = _container.querySelector(`[data-empresa-details="${id}"]`);
      if (details) {
        const hidden = details.style.display === 'none';
        details.style.display = hidden ? '' : 'none';
        toggleBtn.querySelector('span.material-symbols-outlined').textContent = hidden ? 'expand_less' : 'expand_more';
      }
    }
  });
}

// ── HTML ──────────────────────────────────────────────────

function _html(empresas) {
  return `
<div style="padding:24px 28px;max-width:1280px;margin:0 auto;">
  <style>@keyframes progSpin { to { transform:rotate(360deg); } }</style>

  <!-- Encabezado -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;gap:12px;flex-wrap:wrap;">
    <div>
      <h2 style="margin:0 0 4px;font-size:22px;font-weight:800;color:#fff;">Empresas registradas</h2>
      <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.35);">
        ${empresas.length} tenant${empresas.length !== 1 ? 's' : ''} en la plataforma
      </p>
    </div>
    <button data-new-empresa type="button" style="
      display:flex;align-items:center;gap:7px;
      padding:9px 14px;border-radius:10px;
      background:rgba(99,102,241,0.12);
      border:1px solid rgba(99,102,241,0.28);
      color:#a5b4fc;font-size:13px;font-family:Inter,sans-serif;
      font-weight:700;cursor:pointer;transition:background .15s;
    ">
      <span class="material-symbols-outlined" style="font-size:16px;">add</span>
      Nueva empresa
    </button>
  </div>

  <!-- Grid de empresas -->
  ${empresas.length
    ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px;">
        ${empresas.map(_card).join('')}
      </div>`
    : `<div style="padding:60px;text-align:center;color:rgba(255,255,255,0.25);">
        <span class="material-symbols-outlined" style="font-size:48px;display:block;margin-bottom:12px;color:rgba(255,255,255,0.1);">domain_disabled</span>
        No hay empresas registradas aún.
      </div>`
  }
</div>

<div id="progToastHost" style="position:fixed;bottom:20px;right:20px;z-index:400;display:flex;flex-direction:column;gap:8px;pointer-events:none;"></div>`;
}

function _card(e) {
  const nombre   = String(e.nombre || e.id || '—');
  const plazas   = Array.isArray(e.plazas) ? e.plazas : Object.keys(e.plazasDetalle || {});
  const features = e.features || {};
  const branding = e.branding || {};
  const color    = String(branding.colorPrincipal || '#6366f1');

  return `
<div style="
  background:#0f1b2d;
  border:1px solid rgba(255,255,255,0.07);
  border-radius:14px;overflow:hidden;
">
  <!-- Color bar -->
  <div style="height:3px;background:${_esc(color)};"></div>

  <div style="padding:16px 18px 14px;">
    <!-- Nombre + plan -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px;">
      <div style="min-width:0;">
        <div style="
          font-size:16px;font-weight:800;color:#fff;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        ">${_esc(nombre)}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap;">
          ${_tipoBadge(e.tipo_negocio)}
          <span style="font-size:10px;color:rgba(255,255,255,0.2);font-family:monospace;">${_esc(e.id)}</span>
        </div>
      </div>
      <div style="flex-shrink:0;">
        ${_planBadge(e.plan)}
      </div>
    </div>

    <!-- Feature pills -->
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px;">
      ${_featurePills(features)}
    </div>

    <!-- Plazas + botón Entrar -->
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
      <div style="font-size:11px;color:rgba(255,255,255,0.3);">
        ${plazas.length} plaza${plazas.length !== 1 ? 's' : ''}:
        <span style="color:rgba(255,255,255,0.5);">${_esc(plazas.slice(0,3).join(', '))}${plazas.length > 3 ? `… +${plazas.length - 3}` : ''}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <button data-toggle-details="${_esc(e.id)}" type="button" style="
          display:flex;align-items:center;gap:4px;
          padding:6px 8px;border-radius:7px;
          background:transparent;border:1px solid rgba(255,255,255,0.1);
          color:rgba(255,255,255,0.4);font-size:11px;
          font-family:Inter,sans-serif;cursor:pointer;
        ">
          <span class="material-symbols-outlined" style="font-size:14px;">expand_more</span>
        </button>
        <button data-enter-empresa="${_esc(e.id)}" type="button" style="
          display:flex;align-items:center;gap:6px;
          padding:7px 13px;border-radius:8px;
          background:#6366f1;color:#fff;border:none;
          font-size:12px;font-family:Inter,sans-serif;font-weight:700;
          cursor:pointer;transition:background .15s;
        ">
          <span class="material-symbols-outlined" style="font-size:14px;">login</span>
          Entrar
        </button>
      </div>
    </div>

    <!-- Detalles expandibles -->
    <div data-empresa-details="${_esc(e.id)}" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);">
      ${_detailRows(e)}
    </div>
  </div>
</div>`;
}

function _detailRows(e) {
  const rows = [
    ['onboarding', e.onboarding_completado ? 'Completado' : 'Pendiente'],
    ['Tipo negocio', e.tipo_negocio || '—'],
    ['Plan', e.plan || '—'],
    ['Límite plazas', e.limites?.maxPlazas ?? '—'],
    ['Límite usuarios', e.limites?.maxUsuarios ?? '—'],
    ['Color branding', e.branding?.colorPrincipal || '—'],
    ['Creado', e.creadaEn ? new Date(e.creadaEn).toLocaleDateString('es-MX') : '—'],
  ];
  return rows.map(([k, v]) => `
    <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px;border-bottom:1px solid rgba(255,255,255,0.04);">
      <span style="color:rgba(255,255,255,0.35);">${_esc(k)}</span>
      <span style="color:rgba(255,255,255,0.65);font-weight:600;">${_esc(String(v))}</span>
    </div>`).join('');
}

function _featurePills(features) {
  const list = [
    ['alertas',          'Alertas'],
    ['cuadre',           'Cuadre'],
    ['mensajeria',       'Mensajes'],
    ['incidencias',      'Incidencias'],
    ['ia_placas',        'IA Placas'],
    ['cola_preparacion', 'Cola Prep.'],
    ['exportar_excel',   'Excel'],
  ];
  return list.map(([key, label]) => {
    const on = features[key] !== false;
    return `<span style="
      font-size:10px;padding:2px 7px;border-radius:20px;font-weight:500;
      border:1px solid ${on ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.07)'};
      color:${on ? '#a5b4fc' : 'rgba(255,255,255,0.2)'};
      background:${on ? 'rgba(99,102,241,0.08)' : 'transparent'};
    ">${_esc(label)}</span>`;
  }).join('');
}

function _planBadge(plan) {
  const p = String(plan || 'free').toLowerCase();
  const styles = {
    starter:    'background:#d97706;color:#fff;',
    business:   'background:#6366f1;color:#fff;',
    enterprise: 'background:#059669;color:#fff;',
    free:       'background:#334155;color:#94a3b8;',
  };
  return `<span style="
    font-size:10px;font-weight:800;text-transform:uppercase;
    border-radius:5px;padding:2px 7px;
    ${styles[p] || styles.free}
  ">${_esc(plan || 'free')}</span>`;
}

function _tipoBadge(tipo) {
  const labels = {
    RENTA_AUTOS:   'Renta de Autos',
    ESTACIONAMIENTO: 'Estacionamiento',
    FLOTA:         'Flota',
    GENERICO:      'Genérico',
  };
  return `<span style="font-size:11px;color:rgba(255,255,255,0.4);font-weight:500;">${_esc(labels[tipo] || tipo || '—')}</span>`;
}

// ── Render / utils ────────────────────────────────────────

function _render(html) {
  if (_container) _container.innerHTML = html;
}

function _showToast(msg, type = 'info') {
  const host = document.getElementById('progToastHost');
  if (!host) return;
  const el = document.createElement('div');
  const tone = type === 'error'
    ? 'background:#fee2e2;border:1px solid #fecaca;color:#7f1d1d;'
    : 'background:#e0e7ff;border:1px solid #c7d2fe;color:#1e1b4b;';
  el.style.cssText = `pointer-events:auto;padding:10px 14px;border-radius:10px;font-size:13px;font-weight:600;max-width:320px;box-shadow:0 8px 24px rgba(0,0,0,.4);${tone}`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { try { el.remove(); } catch (_) {} }, 4500);
}

function _esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
