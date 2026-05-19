// ═══════════════════════════════════════════════════════════
//  /js/programador/views/empresa-detail.js
//  Config/management de una empresa específica.
//  Tabs: Configuración | Features | Plazas | Usuarios
// ═══════════════════════════════════════════════════════════

let _container = null;
let _navigate  = null;
let _empresa   = null;
let _empresaId = null;

const TABS = [
  { key: 'config',   label: 'Configuración', icon: 'settings'    },
  { key: 'features', label: 'Features',       icon: 'toggle_on'   },
  { key: 'plazas',   label: 'Plazas',         icon: 'location_on' },
  { key: 'usuarios', label: 'Usuarios',        icon: 'group'       },
];

export async function mount({ container, params, pathname, navigate }) {
  _container = container;
  _navigate  = navigate;
  _empresaId = params?.id || '';

  container.innerHTML = _skeleton();

  if (!_empresaId || !window._db) {
    container.innerHTML = `<div style="padding:40px;color:#f87171;font-size:13px;">ID de empresa requerido</div>`;
    return;
  }

  try {
    const snap = await window._db.collection('empresas').doc(_empresaId).get();
    if (!snap.exists) {
      container.innerHTML = `<div style="padding:40px;color:#f87171;font-size:13px;">Empresa "${_esc(_empresaId)}" no encontrada</div>`;
      return;
    }
    _empresa = { id: snap.id, ...snap.data() };
  } catch (err) {
    container.innerHTML = `<div style="padding:40px;color:#f87171;font-size:13px;">Error: ${_esc(err.message)}</div>`;
    return;
  }

  const activeTab = _tabFromPath(pathname, _empresaId);
  if (_container) {
    _container.innerHTML = _html(activeTab);
    _bind(activeTab);
  }
}

export function unmount() {
  _container = null;
  _navigate  = null;
  _empresa   = null;
  _empresaId = null;
}

// ── Tab routing ───────────────────────────────────────────

function _tabFromPath(pathname, id) {
  const suffix = pathname.replace(`/programador/empresa/${id}/`, '');
  return TABS.find(t => t.key === suffix)?.key || 'config';
}

// ── Bind ──────────────────────────────────────────────────

function _bind(activeTab) {
  // Tab click
  _container?.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (_navigate) _navigate(`/programador/empresa/${_empresaId}/${tab}`);
      // Re-render tab content sin recargar empresa
      _switchTab(tab);
    });
  });

  // Bind tab content
  _bindTab(activeTab);
}

function _switchTab(tab) {
  // Update tab buttons
  _container?.querySelectorAll('[data-tab]').forEach(btn => {
    btn.classList.toggle('emp-tab-active', btn.dataset.tab === tab);
  });
  // Update content
  const content = _container?.querySelector('#empTabContent');
  if (content) {
    content.innerHTML = _tabContent(tab);
    _bindTab(tab);
  }
}

function _bindTab(tab) {
  if (tab === 'config')   _bindConfig();
  if (tab === 'features') _bindFeatures();
  if (tab === 'plazas')   _bindPlazas();
  if (tab === 'usuarios') _loadUsuarios();
}

// ── Config tab ────────────────────────────────────────────

function _bindConfig() {
  const form = _container?.querySelector('#empConfigForm');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Guardando…';

    const changes = {
      nombre:           form.nombre.value.trim(),
      tipo_negocio:     form.tipo_negocio.value,
      plan:             form.plan.value,
      'branding.colorPrincipal': form.colorPrincipal.value,
      'limites.maxPlazas':   Number(form.maxPlazas.value) || 0,
      'limites.maxUsuarios': Number(form.maxUsuarios.value) || 0,
      onboarding_completado: form.onboarding.checked,
    };

    try {
      await window._db.collection('empresas').doc(_empresaId).update(changes);
      // Actualizar local
      Object.assign(_empresa, {
        nombre: changes.nombre, tipo_negocio: changes.tipo_negocio, plan: changes.plan,
        onboarding_completado: changes.onboarding_completado,
        branding: { ..._empresa.branding, colorPrincipal: changes['branding.colorPrincipal'] },
        limites:  { ..._empresa.limites,  maxPlazas: changes['limites.maxPlazas'], maxUsuarios: changes['limites.maxUsuarios'] },
      });
      _toast('Guardado correctamente', 'ok');
      btn.textContent = 'Guardado ✓';
      setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = 'Guardar cambios'; } }, 2200);
    } catch (err) {
      _toast('Error: ' + err.message, 'error');
      btn.disabled = false; btn.textContent = 'Guardar cambios';
    }
  });
}

// ── Features tab ──────────────────────────────────────────

function _bindFeatures() {
  _container?.querySelectorAll('[data-feature-key]').forEach(toggle => {
    toggle.addEventListener('change', async () => {
      const key = toggle.dataset.featureKey;
      const val = toggle.checked;
      try {
        await window._db.collection('empresas').doc(_empresaId).update({ [`features.${key}`]: val });
        if (!_empresa.features) _empresa.features = {};
        _empresa.features[key] = val;
        _toast(`Feature "${key}" ${val ? 'activada' : 'desactivada'}`, 'ok');
      } catch (err) {
        toggle.checked = !val; // revert
        _toast('Error: ' + err.message, 'error');
      }
    });
  });
}

// ── Plazas tab ────────────────────────────────────────────

function _bindPlazas() {
  const addForm = _container?.querySelector('#addPlazaForm');
  if (!addForm) return;
  addForm.addEventListener('submit', async e => {
    e.preventDefault();
    const plazaId   = addForm.plazaId.value.trim().toUpperCase();
    const plazaNombre = addForm.plazaNombre.value.trim();
    if (!plazaId) return;

    const btn = addForm.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Agregando…';

    try {
      const update = {};
      if (Array.isArray(_empresa.plazas)) {
        if (!_empresa.plazas.includes(plazaId)) {
          update['plazas'] = [..._empresa.plazas, plazaId];
        }
      } else {
        update[`plazasDetalle.${plazaId}`] = { nombre: plazaNombre || plazaId, activa: true };
      }
      await window._db.collection('empresas').doc(_empresaId).update(update);
      if (Array.isArray(_empresa.plazas)) {
        _empresa.plazas = [...(_empresa.plazas || []), plazaId];
      } else {
        if (!_empresa.plazasDetalle) _empresa.plazasDetalle = {};
        _empresa.plazasDetalle[plazaId] = { nombre: plazaNombre || plazaId, activa: true };
      }
      _toast(`Plaza ${plazaId} agregada`, 'ok');
      addForm.reset();
      // Re-render plazas list
      const listEl = _container?.querySelector('#plazasListContainer');
      if (listEl) listEl.innerHTML = _plazasListHtml();
    } catch (err) {
      _toast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Agregar';
    }
  });
}

// ── Usuarios tab ──────────────────────────────────────────

async function _loadUsuarios() {
  const tbody = _container?.querySelector('#usuariosTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;text-align:center;color:rgba(255,255,255,0.25);">Cargando…</td></tr>';

  try {
    const snap = await window._db.collection('usuarios').where('empresaId', '==', _empresaId).limit(100).get();
    if (!snap.docs.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;text-align:center;color:rgba(255,255,255,0.2);">Sin usuarios para esta empresa</td></tr>';
      return;
    }
    tbody.innerHTML = snap.docs.map(d => {
      const u = d.data();
      return `<tr style="border-top:1px solid rgba(255,255,255,0.04);">
        <td style="${_td()}">${_esc(u.nombreCompleto || u.nombre || u.usuario || '—')}</td>
        <td style="${_td()}font-family:monospace;font-size:11px;">${_esc(u.email || d.id)}</td>
        <td style="${_td()}">${_rolBadge(u.rol)}</td>
        <td style="${_td()}">${_statusDot(u.status || u.activo)}</td>
        <td style="${_td()}font-family:monospace;font-size:10px;color:rgba(255,255,255,0.3);">${_esc(u.plazaAsignada || '—')}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:20px;color:#f87171;font-size:12px;">Error: ${_esc(err.message)}</td></tr>`;
  }
}

// ── HTML ──────────────────────────────────────────────────

function _html(activeTab) {
  const nombre = _empresa.nombre || _empresa.id;
  const color  = (_empresa.branding || {}).colorPrincipal || '#6366f1';

  return `
<div style="padding:24px 28px;max-width:1100px;margin:0 auto;">

  <!-- Breadcrumb + empresa info -->
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
    <a data-prog-route="/programador/saas" href="/programador/saas" style="font-size:12px;color:#818cf8;text-decoration:none;display:flex;align-items:center;gap:4px;">
      <span class="material-symbols-outlined" style="font-size:14px;">arrow_back</span>
      Empresas
    </a>
    <span style="font-size:12px;color:rgba(255,255,255,0.2);">/</span>
    <span style="font-size:12px;color:rgba(255,255,255,0.55);">${_esc(nombre)}</span>
  </div>

  <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px;">
    <div style="width:10px;height:10px;border-radius:50%;background:${_esc(color)};flex-shrink:0;"></div>
    <h2 style="margin:0;font-size:20px;font-weight:800;color:#fff;">${_esc(nombre)}</h2>
    ${_planBadge(_empresa.plan)}
    <span style="font-size:11px;color:rgba(255,255,255,0.3);font-family:monospace;">${_esc(_empresa.id)}</span>
  </div>

  <!-- Tabs -->
  <div style="display:flex;gap:2px;margin-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.07);padding-bottom:0;">
    ${TABS.map(t => `
    <button data-tab="${_esc(t.key)}" class="emp-tab-btn ${t.key === activeTab ? 'emp-tab-active' : ''}" type="button">
      <span class="material-symbols-outlined" style="font-size:15px;">${_esc(t.icon)}</span>
      ${_esc(t.label)}
    </button>`).join('')}
  </div>

  <!-- Tab content -->
  <div id="empTabContent">
    ${_tabContent(activeTab)}
  </div>
</div>

<div id="empToastHost" style="position:fixed;bottom:20px;right:20px;z-index:400;display:flex;flex-direction:column;gap:8px;pointer-events:none;"></div>

<style>
.emp-tab-btn {
  display:flex;align-items:center;gap:6px;padding:8px 14px;border:none;
  background:transparent;color:rgba(255,255,255,0.38);font-size:12px;
  font-family:Inter,sans-serif;font-weight:600;cursor:pointer;
  border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .12s;
}
.emp-tab-btn:hover { color:rgba(255,255,255,0.7); }
.emp-tab-btn.emp-tab-active { color:#a5b4fc;border-bottom-color:#6366f1; }
</style>`;
}

function _tabContent(tab) {
  if (tab === 'config')   return _configTabHtml();
  if (tab === 'features') return _featuresTabHtml();
  if (tab === 'plazas')   return _plazasTabHtml();
  if (tab === 'usuarios') return _usuariosTabHtml();
  return '';
}

function _configTabHtml() {
  const e = _empresa;
  const b = e.branding || {};
  const l = e.limites || {};
  return `
<form id="empConfigForm" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:720px;">
  ${_field('Nombre de la empresa', `<input name="nombre" value="${_esc(e.nombre||'')}" style="${_inp()}" required/>`)}
  ${_field('Tipo de negocio', `<select name="tipo_negocio" style="${_inp()}">
    ${['RENTA_AUTOS','ESTACIONAMIENTO','FLOTA','GENERICO'].map(t => `<option value="${t}" ${e.tipo_negocio===t?'selected':''}>${_tipoLabel(t)}</option>`).join('')}
  </select>`)}
  ${_field('Plan', `<select name="plan" style="${_inp()}">
    ${['free','starter','business','enterprise'].map(p => `<option value="${p}" ${e.plan===p?'selected':''}>${p}</option>`).join('')}
  </select>`)}
  ${_field('Color branding', `<div style="display:flex;gap:8px;align-items:center;">
    <input type="color" name="colorPrincipal" value="${_esc(b.colorPrincipal||'#6366f1')}" style="width:40px;height:34px;padding:2px;background:#0f1b2d;border:1px solid rgba(255,255,255,0.1);border-radius:6px;cursor:pointer;"/>
    <input type="text" id="colorHexDisplay" value="${_esc(b.colorPrincipal||'#6366f1')}" style="${_inp()}flex:1;" readonly/>
  </div>`)}
  ${_field('Máx plazas', `<input name="maxPlazas" type="number" value="${l.maxPlazas??5}" min="1" style="${_inp()}"/>`)}
  ${_field('Máx usuarios', `<input name="maxUsuarios" type="number" value="${l.maxUsuarios??20}" min="1" style="${_inp()}"/>`)}
  <div style="grid-column:1/-1;display:flex;align-items:center;gap:10px;padding:12px 0;border-top:1px solid rgba(255,255,255,0.06);">
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:rgba(255,255,255,0.65);">
      <input type="checkbox" name="onboarding" ${e.onboarding_completado?'checked':''} style="width:15px;height:15px;accent-color:#6366f1;cursor:pointer;"/>
      Onboarding completado
    </label>
  </div>
  <div style="grid-column:1/-1;">
    <button type="submit" style="padding:9px 20px;border-radius:8px;background:#6366f1;color:#fff;border:none;font-size:13px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;">
      Guardar cambios
    </button>
  </div>
</form>`;
}

function _featuresTabHtml() {
  const features = _empresa.features || {};
  const list = [
    ['alertas',          'Alertas',          'Emisión y gestión de alertas masivas'],
    ['cuadre',           'Cuadre',           'Módulo de cuadre de flota/patio'],
    ['mensajeria',       'Mensajería',        'Mensajes internos entre usuarios'],
    ['incidencias',      'Incidencias',       'Reporte y seguimiento de incidencias'],
    ['ia_placas',        'IA Placas',         'Reconocimiento de placas con Vision AI'],
    ['cola_preparacion', 'Cola preparación',  'Módulo de cola de salida'],
    ['exportar_excel',   'Exportar Excel',    'Exportación de reportes a Excel'],
    ['edicion_mapa',     'Editor de mapa',    'Configuración visual del mapa de patio'],
  ];
  return `
<div style="max-width:680px;display:flex;flex-direction:column;gap:10px;">
  ${list.map(([key, label, desc]) => {
    const on = features[key] !== false;
    return `
<div style="background:#0f1b2d;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
  <div>
    <div style="font-size:13px;font-weight:700;color:${on?'#fff':'rgba(255,255,255,0.4)'};">${_esc(label)}</div>
    <div style="font-size:11px;color:rgba(255,255,255,0.3);margin-top:2px;">${_esc(desc)}</div>
  </div>
  <label style="position:relative;display:inline-block;width:42px;height:24px;flex-shrink:0;cursor:pointer;">
    <input type="checkbox" data-feature-key="${_esc(key)}" ${on?'checked':''} style="opacity:0;width:0;height:0;position:absolute;"/>
    <span style="
      position:absolute;inset:0;border-radius:24px;
      background:${on?'#6366f1':'rgba(255,255,255,0.15)'};
      transition:background .2s;
    "></span>
    <span style="
      position:absolute;left:${on?'20px':'2px'};top:2px;
      width:20px;height:20px;background:#fff;border-radius:50%;
      transition:left .2s;
    "></span>
  </label>
</div>`;
  }).join('')}
</div>`;
}

function _plazasTabHtml() {
  return `
<div style="max-width:680px;display:flex;flex-direction:column;gap:16px;">
  <div id="plazasListContainer">
    ${_plazasListHtml()}
  </div>
  <div style="background:#0f1b2d;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:16px;">
    <div style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.5);margin-bottom:12px;text-transform:uppercase;letter-spacing:.04em;">Agregar plaza</div>
    <form id="addPlazaForm" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
      ${_field('ID (ej: BJX)', `<input name="plazaId" placeholder="BJX" style="${_inp()}width:100px;" required/>`)}
      ${_field('Nombre', `<input name="plazaNombre" placeholder="Bajío" style="${_inp()}flex:1;min-width:140px;"/>`)}
      <div style="padding-bottom:0;">
        <button type="submit" style="padding:8px 14px;border-radius:7px;background:#6366f1;color:#fff;border:none;font-size:12px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;">Agregar</button>
      </div>
    </form>
  </div>
</div>`;
}

function _plazasListHtml() {
  const e = _empresa;
  const plazas = Array.isArray(e.plazas) ? e.plazas.map(id => ({ id, nombre: id }))
    : Object.entries(e.plazasDetalle || {}).map(([id, d]) => ({ id, nombre: d?.nombre || id, ...d }));

  if (!plazas.length) {
    return `<div style="padding:20px 0;font-size:13px;color:rgba(255,255,255,0.3);">Sin plazas configuradas.</div>`;
  }
  return `<div style="display:flex;flex-direction:column;gap:6px;">
    ${plazas.map(p => `
    <div style="background:#0f1b2d;border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-family:monospace;font-size:12px;font-weight:800;color:#a5b4fc;background:rgba(99,102,241,0.1);padding:2px 7px;border-radius:5px;">${_esc(p.id)}</span>
        <span style="font-size:13px;color:rgba(255,255,255,0.65);">${_esc(p.nombre)}</span>
      </div>
      <span style="font-size:10px;color:rgba(255,255,255,0.2);">${p.activa === false ? 'inactiva' : 'activa'}</span>
    </div>`).join('')}
  </div>`;
}

function _usuariosTabHtml() {
  return `
<div style="max-width:900px;">
  <table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead>
      <tr style="color:rgba(255,255,255,0.3);">
        <th style="text-align:left;padding:0 10px 10px 0;font-weight:600;font-size:10px;text-transform:uppercase;">Nombre</th>
        <th style="text-align:left;padding:0 10px 10px;font-weight:600;font-size:10px;text-transform:uppercase;">Email</th>
        <th style="text-align:left;padding:0 10px 10px;font-weight:600;font-size:10px;text-transform:uppercase;">Rol</th>
        <th style="text-align:left;padding:0 10px 10px;font-weight:600;font-size:10px;text-transform:uppercase;">Status</th>
        <th style="text-align:left;padding:0 0 10px;font-weight:600;font-size:10px;text-transform:uppercase;">Plaza</th>
      </tr>
    </thead>
    <tbody id="usuariosTableBody">
      <tr><td colspan="5" style="padding:20px;text-align:center;color:rgba(255,255,255,0.25);">Cargando…</td></tr>
    </tbody>
  </table>
</div>`;
}

// ── Helpers ───────────────────────────────────────────────

function _field(label, input) {
  return `<div>
    <label style="display:block;font-size:11px;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:5px;">${_esc(label)}</label>
    ${input}
  </div>`;
}
function _inp() {
  return 'width:100%;padding:8px 10px;background:#070d16;border:1px solid rgba(255,255,255,0.1);border-radius:7px;color:#fff;font-size:13px;font-family:Inter,sans-serif;outline:none;';
}
function _td() { return 'padding:8px 10px 8px 0;color:rgba(255,255,255,0.65);vertical-align:middle;'; }

function _planBadge(plan) {
  const p = String(plan || 'free').toLowerCase();
  const bg = { starter:'#d97706', business:'#6366f1', enterprise:'#059669', free:'#334155' }[p] || '#334155';
  return `<span style="font-size:10px;font-weight:800;text-transform:uppercase;border-radius:5px;padding:2px 7px;background:${bg};color:#fff;">${_esc(plan || 'free')}</span>`;
}
function _rolBadge(rol) {
  return `<span style="font-size:10px;font-weight:700;background:rgba(99,102,241,0.12);color:#a5b4fc;border-radius:4px;padding:2px 6px;">${_esc(rol || '—')}</span>`;
}
function _statusDot(status) {
  const on = status === 'ACTIVO' || status === true;
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${on?'#10b981':'#f87171'};"></span>`;
}
function _tipoLabel(t) {
  return { RENTA_AUTOS:'Renta Autos', ESTACIONAMIENTO:'Estacionamiento', FLOTA:'Flota', GENERICO:'Genérico' }[t] || (t || '—');
}

function _skeleton() {
  return `<div style="padding:24px 28px;display:flex;flex-direction:column;gap:14px;">
    <div style="height:30px;width:280px;background:rgba(255,255,255,0.04);border-radius:8px;animation:skelPulse 1.4s ease-in-out infinite;"></div>
    <div style="height:50px;background:rgba(255,255,255,0.04);border-radius:10px;animation:skelPulse 1.4s ease-in-out infinite;"></div>
    <div style="height:300px;background:rgba(255,255,255,0.04);border-radius:12px;animation:skelPulse 1.4s ease-in-out infinite;"></div>
    <style>@keyframes skelPulse{0%,100%{opacity:.4}50%{opacity:.9}}</style>
  </div>`;
}

function _toast(msg, type = 'ok') {
  const host = document.getElementById('empToastHost');
  if (!host) return;
  const el = document.createElement('div');
  const tone = type === 'error'
    ? 'background:#fee2e2;color:#7f1d1d;border:1px solid #fecaca;'
    : 'background:#d1fae5;color:#064e3b;border:1px solid #a7f3d0;';
  el.style.cssText = `pointer-events:auto;padding:10px 14px;border-radius:9px;font-size:13px;font-weight:600;max-width:320px;box-shadow:0 8px 20px rgba(0,0,0,.5);${tone}`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { try { el.remove(); } catch (_) {} }, 3500);
}

function _esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
