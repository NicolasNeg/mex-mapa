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
  { key: 'datos',       label: 'Datos',          icon: 'business'       },
  { key: 'facturacion', label: 'Facturación',    icon: 'payments'       },
  { key: 'contratos',   label: 'Contratos',      icon: 'description'    },
  { key: 'config',      label: 'Configuración',  icon: 'settings'       },
  { key: 'features',    label: 'Features',       icon: 'toggle_on'      },
  { key: 'permisos',    label: 'Permisos',       icon: 'security'       },
  { key: 'plazas',      label: 'Plazas',         icon: 'location_on'    },
  { key: 'listas',      label: 'Listas',         icon: 'list'           },
  { key: 'usuarios',    label: 'Usuarios',       icon: 'group'          },
  { key: 'actividad',   label: 'Actividad',      icon: 'monitoring'     },
  { key: 'soporte',     label: 'Soporte',        icon: 'support_agent'  },
  { key: 'login',       label: 'Login',          icon: 'language'       },
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
  if (tab === 'datos')       _bindDatos();
  if (tab === 'facturacion') _bindFact();
  if (tab === 'contratos')   _bindContratosEmpresa();
  if (tab === 'config')      _bindConfig();
  if (tab === 'features')    _bindFeatures();
  if (tab === 'permisos')    _bindPermisos();
  if (tab === 'plazas')      _bindPlazas();
  if (tab === 'listas')      _bindListas();
  if (tab === 'usuarios')    _loadUsuarios();
  if (tab === 'actividad')   _loadActividad();
  if (tab === 'soporte')     _bindSoporte();
  if (tab === 'login')       _bindLoginPresencia();
}

// ── Config tab ────────────────────────────────────────────

function _bindConfig() {
  const form = _container?.querySelector('#empConfigForm');
  if (!form) return;

  // Color picker sync
  const colorInput = form.querySelector('[name=colorPrincipal]');
  const colorDisplay = form.querySelector('#colorHexDisplay');
  if (colorInput && colorDisplay) {
    colorInput.addEventListener('input', () => { colorDisplay.value = colorInput.value; });
  }

  // Full migration button (all collections + settings + mapa_config + listas)
  const btnMigrarCompleto = _container?.querySelector('#btnMigrarCompleto');
  const migCompletoStatus = _container?.querySelector('#migrarCompletoStatus');
  if (btnMigrarCompleto) {
    btnMigrarCompleto.addEventListener('click', async () => {
      if (!confirm(`¿Ejecutar migración completa de TODOS los datos legacy para "${_empresaId}"?\n\nEsto hará:\n• Añadir empresaId a: alertas, notas, logs, bitácora, historial, mensajes…\n• Copiar settings y mapa_config de plazas al nuevo esquema por empresa\n• Copiar listas globales a la empresa (si no tiene listas propias)\n\nPuede tardar hasta 9 minutos.`)) return;
      btnMigrarCompleto.disabled = true;
      btnMigrarCompleto.textContent = 'Migrando todo…';
      if (migCompletoStatus) migCompletoStatus.textContent = 'Ejecutando migración completa, puede tardar varios minutos…';
      try {
        const fn = firebase.functions().httpsCallable('migrarDatosLegacyCompleto');
        const res = await fn({ empresaId: _empresaId });
        const d = res.data;
        const c = d.conteos || {};
        const resumen = Object.entries(c).map(([k, v]) => `${k}: ${v}`).join(', ');
        if (migCompletoStatus) {
          migCompletoStatus.style.color = '#4ade80';
          migCompletoStatus.textContent = `✓ Migración completa — ${resumen}`;
        }
        _toast('Migración completa exitosa', 'ok');
        btnMigrarCompleto.textContent = 'Migración completa ✓';
      } catch (err) {
        if (migCompletoStatus) { migCompletoStatus.style.color = '#f87171'; migCompletoStatus.textContent = 'Error: ' + err.message; }
        _toast('Error en migración completa: ' + err.message, 'error');
        btnMigrarCompleto.disabled = false;
        btnMigrarCompleto.textContent = 'Migración completa (todos los datos)';
      }
    });
  }

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
        // Re-render to update label colors
        _switchTab('features');
      } catch (err) {
        toggle.checked = !val;
        _toast('Error: ' + err.message, 'error');
      }
    });
  });

  const FEATURE_KEYS = ['dashboard','estados_mapa','alertas','cuadre','mensajeria','incidencias','ia_placas','cola_preparacion','exportar_excel','edicion_mapa'];

  _container?.querySelector('#featEnableAll')?.addEventListener('click', async () => {
    const updates = {};
    FEATURE_KEYS.forEach(k => { updates[`features.${k}`] = true; });
    try {
      await window._db.collection('empresas').doc(_empresaId).update(updates);
      if (!_empresa.features) _empresa.features = {};
      FEATURE_KEYS.forEach(k => { _empresa.features[k] = true; });
      _toast('Todas las features activadas', 'ok');
      _switchTab('features');
    } catch (err) { _toast('Error: ' + err.message, 'error'); }
  });

  _container?.querySelector('#featDisableAll')?.addEventListener('click', async () => {
    const updates = {};
    FEATURE_KEYS.forEach(k => { updates[`features.${k}`] = false; });
    try {
      await window._db.collection('empresas').doc(_empresaId).update(updates);
      if (!_empresa.features) _empresa.features = {};
      FEATURE_KEYS.forEach(k => { _empresa.features[k] = false; });
      _toast('Todas las features desactivadas', 'ok');
      _switchTab('features');
    } catch (err) { _toast('Error: ' + err.message, 'error'); }
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
<div style="padding:20px;max-width:1100px;margin:0 auto;">

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
  display:flex;align-items:center;gap:6px;padding:8px 12px;border:none;
  background:transparent;color:rgba(255,255,255,0.38);font-size:12px;
  font-family:Inter,sans-serif;font-weight:600;cursor:pointer;
  border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .12s;
  white-space:nowrap;
}
.emp-tab-btn:hover { color:rgba(255,255,255,0.7); }
.emp-tab-btn.emp-tab-active { color:#a5b4fc;border-bottom-color:#6366f1; }
.emp-tab-btn span.material-symbols-outlined { flex-shrink:0; }
@media (max-width:540px) {
  .emp-tab-btn span:not(.material-symbols-outlined) { display:none; }
  .emp-tab-btn { padding:8px 10px; }
}
</style>`;
}

function _tabContent(tab) {
  if (tab === 'datos')       return _datosTabHtml();
  if (tab === 'facturacion') return _facturacionTabHtml();
  if (tab === 'contratos')   return _contratosEmpresaTabHtml();
  if (tab === 'config')      return _configTabHtml();
  if (tab === 'features')    return _featuresTabHtml();
  if (tab === 'permisos')    return _permisosTabHtml();
  if (tab === 'plazas')      return _plazasTabHtml();
  if (tab === 'listas')      return _listasTabHtml();
  if (tab === 'usuarios')    return _usuariosTabHtml();
  if (tab === 'actividad')   return _actividadTabHtml();
  if (tab === 'soporte')     return _soporteTabHtml();
  if (tab === 'login')       return _loginPresenciaTabHtml();
  return '';
}

function _configTabHtml() {
  const e = _empresa;
  const b = e.branding || {};
  const l = e.limites || {};
  return `
<form id="empConfigForm" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;max-width:720px;">
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
</form>
<div style="margin-top:24px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);">
  <div style="font-size:12px;font-weight:700;color:rgba(99,102,241,0.7);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Migración completa (multi-tenant)</div>
  <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:12px;line-height:1.6;">
    Migra <strong>todos</strong> los datos legacy de la empresa al nuevo esquema multi-tenant:
    alertas, notas, logs, bitácora, historial de patio, mensajes, plantillas de alertas, auditoría,
    settings por plaza, estructura del mapa y listas (categorías, estados, gasolinas).
    <br><strong style="color:#f87171;">Ejecutar solo una vez. Puede tardar varios minutos.</strong>
  </div>
  <button id="btnMigrarCompleto" type="button" style="padding:9px 18px;border-radius:8px;background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;font-size:13px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;">
    Migración completa (todos los datos)
  </button>
  <div id="migrarCompletoStatus" style="margin-top:10px;font-size:12px;color:rgba(255,255,255,0.5);min-height:18px;"></div>
</div>`;
}

function _featuresTabHtml() {
  const features = _empresa.features || {};
  const hasFeatures = _empresa.features && typeof _empresa.features === 'object';
  const list = [
    ['dashboard',        'Dashboard de inicio', 'Si está desactivado, el mapa es la pantalla inicial al entrar'],
    ['estados_mapa',     'Estados operativos',  'Permite estados en unidades. Desactivar para modo estacionamiento simple (solo datos del auto)'],
    ['cuadre',           'Cuadre',              'Módulo de cuadre. Al desactivar, también oculta Categorías del menú'],
    ['alertas',          'Alertas',             'Emisión y gestión de alertas masivas'],
    ['mensajeria',       'Mensajería',          'Mensajes internos entre usuarios'],
    ['incidencias',      'Incidencias',         'Reporte y seguimiento de incidencias'],
    ['ia_placas',        'IA Placas',           'Reconocimiento de placas con Vision AI'],
    ['cola_preparacion', 'Cola preparación',    'Módulo de cola de salida'],
    ['exportar_excel',   'Exportar Excel',      'Exportación de reportes a Excel'],
    ['edicion_mapa',     'Editor de mapa',      'Configuración visual del mapa de patio'],
  ];
  return `
<div style="max-width:680px;display:flex;flex-direction:column;gap:10px;">
  ${!hasFeatures ? `<div style="padding:12px 14px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;font-size:12px;color:#fbbf24;margin-bottom:4px;">Esta empresa no tiene features configuradas. Activa las que necesite.</div>` : ''}
  <div style="display:flex;gap:8px;margin-bottom:4px;">
    <button id="featEnableAll" type="button" style="padding:6px 12px;border-radius:7px;background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.25);color:#a5b4fc;font-size:11px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;">Activar todas</button>
    <button id="featDisableAll" type="button" style="padding:6px 12px;border-radius:7px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.4);font-size:11px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;">Desactivar todas</button>
  </div>
  ${list.map(([key, label, desc]) => {
    const on = features[key] === true;
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

function _listaItemName(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') return item.nombre || item.label || item.name || JSON.stringify(item);
  return String(item ?? '');
}

function _listasTabHtml() {
  const listas = _empresa.listas || {};
  const secciones = [
    { key: 'categorias', label: 'Categorías', placeholder: 'SEDAN', hint: 'Tipos de vehículo (ej: SEDAN, SUV, CAMIONETA)' },
    { key: 'modelos',    label: 'Modelos',    placeholder: 'TSURU', hint: 'Modelos de vehículo (ej: TSURU, VERSA, AVEO)' },
    { key: 'estados',    label: 'Estados operativos', placeholder: 'DISPONIBLE', hint: 'Estados del mapa (ej: DISPONIBLE, OCUPADO)' },
    { key: 'gasolinas',  label: 'Tipos de combustible', placeholder: 'MAGNA', hint: 'Tipos de gasolina (ej: MAGNA, PREMIUM, DIESEL)' },
  ];

  return `
<div style="max-width:800px;display:flex;flex-direction:column;gap:20px;">
  <div style="padding:12px 14px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:8px;font-size:12px;color:#a5b4fc;">
    Las listas definen los catálogos propios de esta empresa (categorías, modelos, etc.).<br/>
    Si se dejan vacías, se usan los catálogos globales del sistema.
  </div>
  ${secciones.map(s => {
    const items = Array.isArray(listas[s.key]) ? listas[s.key] : [];
    return `
<div style="background:#0f1b2d;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:16px;">
  <div style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">${_esc(s.label)}</div>
  <div style="font-size:11px;color:rgba(255,255,255,0.25);margin-bottom:10px;">${_esc(s.hint)}</div>
  <div id="lista-items-${_esc(s.key)}" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;min-height:24px;">
    ${items.map((item, idx) => `
    <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:20px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);font-size:11px;font-weight:700;color:#a5b4fc;">
      ${_esc(_listaItemName(item))}
      <button data-lista-remove="${_esc(s.key)}" data-lista-index="${idx}" type="button" style="display:inline-flex;align-items:center;background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;padding:0;font-size:12px;line-height:1;">×</button>
    </span>`).join('')}
    ${!items.length ? `<span style="font-size:11px;color:rgba(255,255,255,0.2);">Sin items — se usará el catálogo global</span>` : ''}
  </div>
  <form data-lista-form="${_esc(s.key)}" style="display:flex;gap:6px;align-items:center;">
    <input type="text" placeholder="${_esc(s.placeholder)}" data-lista-input="${_esc(s.key)}" style="
      flex:1;padding:7px 10px;background:#070d16;border:1px solid rgba(255,255,255,0.1);
      border-radius:7px;color:#fff;font-size:12px;font-family:Inter,sans-serif;outline:none;
    " required/>
    <button type="submit" style="padding:7px 12px;border-radius:7px;background:#6366f1;color:#fff;border:none;font-size:12px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;">Agregar</button>
  </form>
</div>`;
  }).join('')}
</div>`;
}

function _bindListas() {
  _container?.querySelectorAll('[data-lista-form]').forEach(form => {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const key = form.dataset.listaForm;
      const input = form.querySelector(`[data-lista-input="${key}"]`);
      const val = String(input?.value || '').trim().toUpperCase();
      if (!val) return;

      const current = Array.isArray(_empresa.listas?.[key]) ? [..._empresa.listas[key]] : [];
      const names = current.map(i => _listaItemName(i).toUpperCase());
      if (names.includes(val)) { _toast(`"${val}" ya existe`, 'ok'); return; }
      const updated = [...current, val];

      try {
        await window._db.collection('empresas').doc(_empresaId).update({ [`listas.${key}`]: updated });
        if (!_empresa.listas) _empresa.listas = {};
        _empresa.listas[key] = updated;
        input.value = '';
        _toast(`${val} agregado a ${key}`, 'ok');
        _switchTab('listas');
      } catch (err) { _toast('Error: ' + err.message, 'error'); }
    });
  });

  _container?.querySelectorAll('[data-lista-remove]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.listaRemove;
      const idx = Number(btn.dataset.listaIndex);
      const current = Array.isArray(_empresa.listas?.[key]) ? [..._empresa.listas[key]] : [];
      const itemName = _listaItemName(current[idx] ?? '');
      const updated = current.filter((_, i) => i !== idx);

      try {
        await window._db.collection('empresas').doc(_empresaId).update({ [`listas.${key}`]: updated });
        if (!_empresa.listas) _empresa.listas = {};
        _empresa.listas[key] = updated;
        _toast(`${itemName} eliminado`, 'ok');
        _switchTab('listas');
      } catch (err) { _toast('Error: ' + err.message, 'error'); }
    });
  });
}

// ── Permisos tab ─────────────────────────────────────────

const _CONFIGURABLE_ROLES = ['AUXILIAR', 'VENTAS', 'SUPERVISOR', 'JEFE_PATIO', 'GERENTE_PLAZA', 'JEFE_REGIONAL'];
const _ROLE_LABELS = { AUXILIAR:'Auxiliar', VENTAS:'Ventas', SUPERVISOR:'Supervisor', JEFE_PATIO:'Jefe Patio', GERENTE_PLAZA:'Gerente Plaza', JEFE_REGIONAL:'Jefe Regional' };

// Mirrors domain/permissions.model.js DEFAULT_ROLE_PERMISSIONS
const _PERM_DEFAULTS = {
  AUXILIAR:     { view_dashboard:true,  view_mapa:true,  view_cuadre:true,  view_incidencias:true, view_cola_preparacion:true, view_mensajes:true, view_alertas:true, view_admin:false, view_reportes:false, edit_mapa_layout:false, move_units:true, change_unit_state:true, manage_unit_info:false, view_cuadre_admin:false, edit_cuadre_admin:false, export_data:false, create_incidencia:true,  edit_incidencia:false, delete_incidencia:false, manage_users:false, manage_solicitudes:false, manage_fleet:false, emit_alerts:false, delete_alerts:false, manage_settings:false },
  VENTAS:       { view_dashboard:true,  view_mapa:true,  view_cuadre:true,  view_incidencias:true, view_cola_preparacion:true, view_mensajes:true, view_alertas:true, view_admin:true,  view_reportes:true,  edit_mapa_layout:false, move_units:true, change_unit_state:true, manage_unit_info:true,  view_cuadre_admin:true,  edit_cuadre_admin:false, export_data:true,  create_incidencia:true,  edit_incidencia:true,  delete_incidencia:false, manage_users:false, manage_solicitudes:false, manage_fleet:false, emit_alerts:false, delete_alerts:false, manage_settings:false },
  SUPERVISOR:   { view_dashboard:true,  view_mapa:true,  view_cuadre:true,  view_incidencias:true, view_cola_preparacion:true, view_mensajes:true, view_alertas:true, view_admin:true,  view_reportes:true,  edit_mapa_layout:false, move_units:true, change_unit_state:true, manage_unit_info:true,  view_cuadre_admin:true,  edit_cuadre_admin:true,  export_data:true,  create_incidencia:true,  edit_incidencia:true,  delete_incidencia:true,  manage_users:false, manage_solicitudes:false, manage_fleet:false, emit_alerts:true,  delete_alerts:false, manage_settings:false },
  JEFE_PATIO:   { view_dashboard:true,  view_mapa:true,  view_cuadre:true,  view_incidencias:true, view_cola_preparacion:true, view_mensajes:true, view_alertas:true, view_admin:true,  view_reportes:true,  edit_mapa_layout:true,  move_units:true, change_unit_state:true, manage_unit_info:true,  view_cuadre_admin:true,  edit_cuadre_admin:true,  export_data:true,  create_incidencia:true,  edit_incidencia:true,  delete_incidencia:true,  manage_users:false, manage_solicitudes:true,  manage_fleet:true,  emit_alerts:true,  delete_alerts:true,  manage_settings:false },
  GERENTE_PLAZA:{ view_dashboard:true,  view_mapa:true,  view_cuadre:true,  view_incidencias:true, view_cola_preparacion:true, view_mensajes:true, view_alertas:true, view_admin:true,  view_reportes:true,  edit_mapa_layout:true,  move_units:true, change_unit_state:true, manage_unit_info:true,  view_cuadre_admin:true,  edit_cuadre_admin:true,  export_data:true,  create_incidencia:true,  edit_incidencia:true,  delete_incidencia:true,  manage_users:true,  manage_solicitudes:true,  manage_fleet:true,  emit_alerts:true,  delete_alerts:true,  manage_settings:true  },
  JEFE_REGIONAL:{ view_dashboard:true,  view_mapa:true,  view_cuadre:true,  view_incidencias:true, view_cola_preparacion:true, view_mensajes:true, view_alertas:true, view_admin:true,  view_reportes:true,  edit_mapa_layout:true,  move_units:true, change_unit_state:true, manage_unit_info:true,  view_cuadre_admin:true,  edit_cuadre_admin:true,  export_data:true,  create_incidencia:true,  edit_incidencia:true,  delete_incidencia:true,  manage_users:true,  manage_solicitudes:true,  manage_fleet:true,  emit_alerts:true,  delete_alerts:true,  manage_settings:true  },
};

const _PERM_GROUPS = [
  { label: 'Navegación', items: [
    { key: 'view_dashboard',        label: 'Dashboard',               desc: 'Acceso al panel principal' },
    { key: 'view_mapa',             label: 'Mapa',                    desc: 'Ver el mapa de unidades' },
    { key: 'view_cuadre',           label: 'Cuadre',                  desc: 'Acceso al módulo de cuadre' },
    { key: 'view_incidencias',      label: 'Incidencias',             desc: 'Ver reportes de incidencias' },
    { key: 'view_cola_preparacion', label: 'Cola preparación',        desc: 'Ver la cola de salida' },
    { key: 'view_mensajes',         label: 'Mensajes',                desc: 'Acceso a mensajería interna' },
    { key: 'view_alertas',          label: 'Alertas',                 desc: 'Ver alertas del sistema' },
    { key: 'view_admin',            label: 'Panel Admin',             desc: 'Acceso al módulo de administración' },
    { key: 'view_reportes',         label: 'Reportes',                desc: 'Ver reportes y estadísticas' },
  ]},
  { label: 'Mapa', items: [
    { key: 'edit_mapa_layout',  label: 'Editar estructura',           desc: 'Modificar celdas y layout del mapa' },
    { key: 'move_units',        label: 'Mover unidades',              desc: 'Arrastrar y reubicar unidades en el mapa' },
    { key: 'change_unit_state', label: 'Cambiar estado',              desc: 'Modificar el estado operativo de una unidad' },
    { key: 'manage_unit_info',  label: 'Editar info de unidad',       desc: 'Actualizar datos de la unidad (placas, modelo, etc.)' },
  ]},
  { label: 'Cuadre', items: [
    { key: 'view_cuadre_admin', label: 'Ver cuadre administrativo',   desc: 'Acceso a la vista admin del cuadre' },
    { key: 'edit_cuadre_admin', label: 'Editar cuadre administrativo', desc: 'Modificar registros del cuadre admin' },
    { key: 'export_data',       label: 'Exportar datos',              desc: 'Exportar a Excel o PDF' },
  ]},
  { label: 'Incidencias', items: [
    { key: 'create_incidencia', label: 'Crear incidencias',           desc: 'Reportar nuevas incidencias' },
    { key: 'edit_incidencia',   label: 'Editar incidencias',          desc: 'Modificar incidencias existentes' },
    { key: 'delete_incidencia', label: 'Eliminar incidencias',        desc: 'Borrar incidencias del sistema' },
  ]},
  { label: 'Usuarios y Admin', items: [
    { key: 'manage_users',       label: 'Gestionar usuarios',         desc: 'Crear, editar y desactivar usuarios' },
    { key: 'manage_solicitudes', label: 'Gestionar solicitudes',      desc: 'Aprobar o rechazar solicitudes de acceso' },
    { key: 'manage_fleet',       label: 'Gestionar flota',            desc: 'Administrar el catálogo de unidades' },
  ]},
  { label: 'Alertas', items: [
    { key: 'emit_alerts',   label: 'Emitir alertas',                  desc: 'Crear y enviar alertas masivas' },
    { key: 'delete_alerts', label: 'Eliminar alertas',                desc: 'Remover alertas del sistema' },
  ]},
  { label: 'Sistema', items: [
    { key: 'manage_settings', label: 'Configuración de la empresa',   desc: 'Modificar ajustes y configuración de la empresa' },
  ]},
];

let _permActiveRole = 'AUXILIAR';

function _permisosTabHtml() {
  return `
<div style="max-width:820px;">
  <div style="padding:12px 14px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:8px;font-size:12px;color:#a5b4fc;line-height:1.6;margin-bottom:20px;">
    Define qué puede hacer cada rol en esta empresa. Los cambios aplican <strong>solo para esta empresa</strong> y no afectan a otras.
    Los roles PROGRAMADOR, JEFE_OPERACIÓN y CORPORATIVO tienen acceso total y no se configuran aquí.
  </div>
  <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.07);padding-bottom:0;" id="permRoleTabs">
    ${_CONFIGURABLE_ROLES.map(r => `
    <button data-perm-role-tab="${_esc(r)}"
            class="emp-tab-btn perm-role-tab-btn ${r === _permActiveRole ? 'emp-tab-active' : ''}"
            type="button">
      ${_esc(_ROLE_LABELS[r] || r)}
    </button>`).join('')}
  </div>
  <div id="permRoleContent">
    ${_permRoleContentHtml(_permActiveRole)}
  </div>
</div>`;
}

function _permRoleContentHtml(rol) {
  const defaults = _PERM_DEFAULTS[rol] || _PERM_DEFAULTS.AUXILIAR;
  const overrides = _empresa?.rolePermissions?.[rol];
  const hasOverrides = overrides && typeof overrides === 'object' && Object.keys(overrides).length > 0;

  const rows = _PERM_GROUPS.map(group => {
    const items = group.items.map(perm => {
      const defaultVal = defaults[perm.key] === true;
      const override   = overrides?.[perm.key];
      const effective  = typeof override === 'boolean' ? override : defaultVal;
      const isCustom   = typeof override === 'boolean' && override !== defaultVal;

      return `
<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 14px;border-top:1px solid rgba(255,255,255,0.04);">
  <div style="flex:1;min-width:0;">
    <div style="display:flex;align-items:center;gap:7px;">
      <span style="font-size:13px;font-weight:600;color:${effective ? '#e2e8f0' : 'rgba(255,255,255,0.35)'};">${_esc(perm.label)}</span>
      ${isCustom ? `<span style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#f59e0b;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.25);border-radius:4px;padding:1px 5px;">empresa</span>` : `<span style="font-size:9px;font-weight:700;color:rgba(255,255,255,0.2);font-family:monospace;">sistema</span>`}
    </div>
    <div style="font-size:11px;color:rgba(255,255,255,0.28);margin-top:2px;">${_esc(perm.desc)}</div>
  </div>
  <label style="position:relative;display:inline-block;width:38px;height:22px;flex-shrink:0;cursor:pointer;">
    <input type="checkbox" data-perm-key="${_esc(perm.key)}" data-perm-role="${_esc(rol)}" ${effective ? 'checked' : ''} style="opacity:0;width:0;height:0;position:absolute;"/>
    <span style="position:absolute;inset:0;border-radius:22px;background:${effective ? '#6366f1' : 'rgba(255,255,255,0.12)'};transition:background .18s;pointer-events:none;"></span>
    <span style="position:absolute;left:${effective ? '18px' : '2px'};top:2px;width:18px;height:18px;background:#fff;border-radius:50%;transition:left .18s;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.3);"></span>
  </label>
</div>`;
    }).join('');

    return `
<div style="background:#0f1b2d;border:1px solid rgba(255,255,255,0.07);border-radius:10px;margin-bottom:10px;overflow:hidden;">
  <div style="padding:10px 14px;background:rgba(255,255,255,0.02);font-size:11px;font-weight:700;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:.05em;">
    ${_esc(group.label)}
  </div>
  ${items}
</div>`;
  }).join('');

  return `
<div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
  <div>
    <div style="font-size:13px;font-weight:700;color:#fff;">${_esc(_ROLE_LABELS[rol] || rol)}</div>
    <div style="font-size:11px;color:rgba(255,255,255,0.3);margin-top:2px;">
      ${hasOverrides ? `<span style="color:#f59e0b;">Permisos personalizados para esta empresa</span>` : `<span>Usando valores del sistema predeterminados</span>`}
    </div>
  </div>
  ${hasOverrides ? `
  <button data-reset-role="${_esc(rol)}" type="button"
          style="padding:6px 12px;border-radius:7px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);color:#fca5a5;font-size:11px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;white-space:nowrap;">
    Restaurar predeterminados
  </button>` : ''}
</div>
${rows}`;
}

function _bindPermisos() {
  _permActiveRole = _CONFIGURABLE_ROLES[0];

  _container?.querySelectorAll('[data-perm-role-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      _permActiveRole = btn.dataset.permRoleTab;
      _container?.querySelectorAll('[data-perm-role-tab]').forEach(b => {
        b.classList.toggle('emp-tab-active', b.dataset.permRoleTab === _permActiveRole);
      });
      const content = _container?.querySelector('#permRoleContent');
      if (content) {
        content.innerHTML = _permRoleContentHtml(_permActiveRole);
        _bindPermToggles();
        _bindPermReset(_permActiveRole);
      }
    });
  });

  _bindPermToggles();
  _bindPermReset(_permActiveRole);
}

function _bindPermToggles() {
  _container?.querySelectorAll('[data-perm-key]').forEach(chk => {
    chk.addEventListener('change', async () => {
      const key  = chk.dataset.permKey;
      const rol  = chk.dataset.permRole;
      const val  = chk.checked;
      const track = chk.nextElementSibling;
      const knob  = track?.nextElementSibling;
      if (track) track.style.background = val ? '#6366f1' : 'rgba(255,255,255,0.12)';
      if (knob)  knob.style.left         = val ? '18px'   : '2px';

      try {
        await window._db.collection('empresas').doc(_empresaId).update({
          [`rolePermissions.${rol}.${key}`]: val,
        });
        if (!_empresa.rolePermissions)      _empresa.rolePermissions = {};
        if (!_empresa.rolePermissions[rol]) _empresa.rolePermissions[rol] = {};
        _empresa.rolePermissions[rol][key] = val;
        _toast(`${_ROLE_LABELS[rol] || rol} · ${key} → ${val ? 'permitido' : 'denegado'}`, 'ok');
        // Refresh badge/header row without full re-render
        const content = _container?.querySelector('#permRoleContent');
        if (content) {
          content.innerHTML = _permRoleContentHtml(rol);
          _bindPermToggles();
          _bindPermReset(rol);
        }
      } catch (err) {
        chk.checked = !val;
        if (track) track.style.background = !val ? '#6366f1' : 'rgba(255,255,255,0.12)';
        if (knob)  knob.style.left         = !val ? '18px'   : '2px';
        _toast('Error: ' + err.message, 'error');
      }
    });
  });
}

function _bindPermReset(rol) {
  _container?.querySelector(`[data-reset-role="${rol}"]`)?.addEventListener('click', async () => {
    if (!confirm(`¿Restaurar permisos predeterminados para "${_ROLE_LABELS[rol] || rol}"?\nEsto eliminará todas las personalizaciones de este rol en esta empresa.`)) return;
    try {
      const updates = {};
      updates[`rolePermissions.${rol}`] = firebase.firestore.FieldValue.delete();
      await window._db.collection('empresas').doc(_empresaId).update(updates);
      if (_empresa.rolePermissions) delete _empresa.rolePermissions[rol];
      _toast(`Permisos de ${_ROLE_LABELS[rol] || rol} restaurados`, 'ok');
      const content = _container?.querySelector('#permRoleContent');
      if (content) {
        content.innerHTML = _permRoleContentHtml(rol);
        _bindPermToggles();
        _bindPermReset(rol);
      }
    } catch (err) {
      _toast('Error: ' + err.message, 'error');
    }
  });
}

// ── Datos tab ─────────────────────────────────────────────

function _datosTabHtml() {
  const d = _empresa.datosLegales || {};
  const c = _empresa.contacto || {};
  const sectors = ['Renta de Autos','Estacionamiento','Flota Corporativa','Hotelería','Transporte','Logística','Otro'];
  return `
<form id="datosForm" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;max-width:760px;">
  <div style="grid-column:1/-1;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:rgba(99,102,241,.65);padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,.06);">Datos legales</div>
  ${_field('Razón social', `<input name="razonSocial" value="${_esc(d.razonSocial||_empresa.nombre||'')}" placeholder="Empresa S.A. de C.V." style="${_inp()}"/>`)}
  ${_field('RFC', `<input name="rfc" value="${_esc(d.rfc||'')}" placeholder="EMP123456ABC" style="${_inp()}"/>`)}
  <div style="grid-column:1/-1;">${_field('Domicilio fiscal', `<input name="domicilio" value="${_esc(d.domicilio||'')}" placeholder="Calle, Col., Ciudad, Estado, CP" style="${_inp()}"/>`)}</div>

  <div style="grid-column:1/-1;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:rgba(99,102,241,.65);padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,.06);margin-top:6px;">Contacto</div>
  ${_field('Email de contacto', `<input name="emailContacto" type="email" value="${_esc(c.email||'')}" placeholder="hola@empresa.com" style="${_inp()}"/>`)}
  ${_field('Teléfono', `<input name="telefono" value="${_esc(c.telefono||'')}" placeholder="+52 477 000 0000" style="${_inp()}"/>`)}
  ${_field('Sitio web', `<input name="website" value="${_esc(c.website||'')}" placeholder="https://empresa.com" style="${_inp()}"/>`)}
  ${_field('Sector', `<select name="sector" style="${_inp()}">
    ${sectors.map(s => `<option value="${_esc(s)}" ${(_empresa.sector||'')=== s?'selected':''}>${_esc(s)}</option>`).join('')}
  </select>`)}

  <div style="grid-column:1/-1;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:rgba(99,102,241,.65);padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,.06);margin-top:6px;">Notas internas</div>
  <div style="grid-column:1/-1;">${_field('Notas del programador (no visibles para el cliente)',
    `<textarea name="notasProgramador" rows="4" placeholder="Situación especial del cliente, soporte previo, acuerdos…" style="${_inp()}resize:vertical;">${_esc(_empresa.notasProgramador||'')}</textarea>`)}</div>

  <div style="grid-column:1/-1;">
    <button type="submit" style="padding:9px 20px;border-radius:8px;background:#6366f1;color:#fff;border:none;font-size:13px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;">Guardar datos</button>
  </div>
</form>`;
}

function _bindDatos() {
  const form = _container?.querySelector('#datosForm');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const ch = {
        'datosLegales.razonSocial': form.razonSocial.value.trim(),
        'datosLegales.rfc':         form.rfc.value.trim().toUpperCase(),
        'datosLegales.domicilio':   form.domicilio.value.trim(),
        'contacto.email':           form.emailContacto.value.trim(),
        'contacto.telefono':        form.telefono.value.trim(),
        'contacto.website':         form.website.value.trim(),
        sector:           form.sector.value,
        notasProgramador: form.notasProgramador.value.trim(),
      };
      await window._db.collection('empresas').doc(_empresaId).update(ch);
      _empresa.datosLegales = { razonSocial: ch['datosLegales.razonSocial'], rfc: ch['datosLegales.rfc'], domicilio: ch['datosLegales.domicilio'] };
      _empresa.contacto = { email: ch['contacto.email'], telefono: ch['contacto.telefono'], website: ch['contacto.website'] };
      _empresa.sector = ch.sector;
      _empresa.notasProgramador = ch.notasProgramador;
      _toast('Datos guardados', 'ok');
      btn.textContent = 'Guardado ✓';
      setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = 'Guardar datos'; } }, 2200);
    } catch (err) {
      _toast('Error: ' + err.message, 'error');
      btn.disabled = false; btn.textContent = 'Guardar datos';
    }
  });
}

// ── Facturación tab ────────────────────────────────────────

function _facturacionTabHtml() {
  const f   = _empresa.facturacion || {};
  const plan = _empresa.plan || 'free';
  const tarifaFmt = f.tarifa
    ? new Intl.NumberFormat('es-MX', { style:'currency', currency: f.moneda||'MXN' }).format(Number(f.tarifa))
    : '—';
  const payBadge = _pagoStatusBadge(f.proximoPago);
  const plazaCount = Array.isArray(_empresa.plazas)
    ? _empresa.plazas.length
    : Object.keys(_empresa.plazasDetalle || {}).length;

  return `
<div style="max-width:760px;display:flex;flex-direction:column;gap:16px;">

  <div style="background:#0f1b2d;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:18px 20px;">
    <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:rgba(99,102,241,.65);margin-bottom:14px;">Plan activo</div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
      ${_planBadge(plan)}
      <span style="${payBadge.style}">${_esc(payBadge.text)}</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:14px;">
      ${_statCell('Tarifa', tarifaFmt + (f.ciclo ? ' / ' + f.ciclo : ''))}
      ${_statCell('Próx. pago', f.proximoPago ? _fmtDateStr(f.proximoPago) : '—')}
      ${_statCell('Método', f.metodoPago || '—')}
      ${_statCell('Moneda', f.moneda || 'MXN')}
    </div>
  </div>

  <div style="background:#0f1b2d;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:18px 20px;">
    <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:rgba(99,102,241,.65);margin-bottom:14px;">Uso</div>
    ${_usageBar('Plazas', plazaCount, _empresa.limites?.maxPlazas || 0)}
    <div id="factUsageEl">${_usageBar('Usuarios', '…', _empresa.limites?.maxUsuarios || 0)}</div>
  </div>

  <div style="background:#0f1b2d;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:18px 20px;">
    <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:rgba(99,102,241,.65);margin-bottom:14px;">Configurar facturación</div>
    <form id="facturacionForm" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;">
      ${_field('Tarifa (sin IVA)', `<input name="tarifa" type="number" min="0" step="0.01" value="${_esc(String(f.tarifa||''))}" style="${_inp()}"/>`)}
      ${_field('Ciclo', `<select name="ciclo" style="${_inp()}">
        <option value="mensual" ${(f.ciclo||'mensual')==='mensual'?'selected':''}>Mensual</option>
        <option value="anual" ${f.ciclo==='anual'?'selected':''}>Anual</option>
      </select>`)}
      ${_field('Moneda', `<select name="moneda" style="${_inp()}">
        <option value="MXN" ${(f.moneda||'MXN')==='MXN'?'selected':''}>MXN</option>
        <option value="USD" ${f.moneda==='USD'?'selected':''}>USD</option>
      </select>`)}
      ${_field('Próximo pago', `<input name="proximoPago" type="date" value="${_esc(f.proximoPago||'')}" style="${_inp()}"/>`)}
      ${_field('Método', `<select name="metodoPago" style="${_inp()}">
        ${['Transferencia','Tarjeta','Efectivo','Cheque','SPEI','Otro'].map(m=>`<option value="${m}" ${f.metodoPago===m?'selected':''}>${_esc(m)}</option>`).join('')}
      </select>`)}
      <div style="grid-column:1/-1;">${_field('Notas', `<input name="notasFact" value="${_esc(f.notas||'')}" placeholder="Condiciones especiales…" style="${_inp()}"/>`)}</div>
      <div style="grid-column:1/-1;">
        <button type="submit" style="padding:9px 18px;border-radius:8px;background:#6366f1;color:#fff;border:none;font-size:13px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;">Guardar</button>
      </div>
    </form>
  </div>

  <div style="background:#0f1b2d;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:18px 20px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
      <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:rgba(99,102,241,.65);">Historial de pagos</div>
      <button id="btnNuevoPago" type="button" style="padding:6px 12px;border-radius:7px;background:#6366f1;color:#fff;border:none;font-size:11px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;">+ Registrar pago</button>
    </div>
    <div id="pagosListEl" style="font-size:12px;color:rgba(255,255,255,.25);">Cargando…</div>
  </div>
</div>

<div id="pagoModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:800;align-items:center;justify-content:center;padding:16px;">
  <div style="background:#0a1220;border:1px solid rgba(255,255,255,.1);border-radius:16px;max-width:480px;width:100%;padding:24px;">
    <div style="font-size:15px;font-weight:800;color:#fff;margin-bottom:16px;">Registrar pago</div>
    <form id="pagoForm" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      ${_field('Monto', `<input name="monto" type="number" min="0" step="0.01" placeholder="0.00" style="${_inp()}" required/>`)}
      ${_field('Moneda', `<select name="moneda" style="${_inp()}"><option value="MXN">MXN</option><option value="USD">USD</option></select>`)}
      ${_field('Fecha', `<input name="fecha" type="date" value="${new Date().toISOString().split('T')[0]}" style="${_inp()}" required/>`)}
      ${_field('Método', `<select name="metodo" style="${_inp()}">
        ${['Transferencia','Tarjeta','Efectivo','Cheque','SPEI','Otro'].map(m=>`<option value="${m}">${_esc(m)}</option>`).join('')}
      </select>`)}
      ${_field('Referencia', `<input name="referencia" placeholder="TRF-001" style="${_inp()}"/>`)}
      <div style="grid-column:1/-1;">${_field('Notas', `<input name="notas" placeholder="Pago mensual…" style="${_inp()}"/>`)}</div>
      <div style="grid-column:1/-1;display:flex;gap:8px;margin-top:4px;">
        <button type="submit" style="padding:9px 18px;border-radius:8px;background:#6366f1;color:#fff;border:none;font-size:13px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;">Guardar</button>
        <button type="button" id="pagoModalClose" style="padding:9px 14px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.5);font-size:13px;font-family:Inter,sans-serif;cursor:pointer;">Cancelar</button>
      </div>
    </form>
  </div>
</div>`;
}

function _pagoStatusBadge(proximoPago) {
  if (!proximoPago) return { text: 'Sin fecha de pago', style: 'font-size:11px;color:rgba(255,255,255,.3);' };
  const diff = Math.floor((new Date(proximoPago + 'T12:00:00') - new Date()) / 86400000);
  if (diff < 0)  return { text: '⚠ Vencido',       style: 'font-size:11px;font-weight:700;color:#f87171;' };
  if (diff <= 7) return { text: '⚡ Por vencer',    style: 'font-size:11px;font-weight:700;color:#fbbf24;' };
  return { text: '✓ Al corriente', style: 'font-size:11px;font-weight:700;color:#34d399;' };
}

function _statCell(label, val) {
  return `<div>
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:rgba(255,255,255,.25);margin-bottom:4px;">${_esc(String(label))}</div>
    <div style="font-size:14px;font-weight:700;color:#fff;">${_esc(String(val ?? '—'))}</div>
  </div>`;
}

function _usageBar(label, used, max) {
  const pct = (typeof used === 'number' && typeof max === 'number' && max > 0)
    ? Math.min(100, Math.round(used / max * 100)) : null;
  const color = pct === null ? '#6366f1' : pct >= 90 ? '#f87171' : pct >= 70 ? '#fbbf24' : '#6366f1';
  return `<div style="margin-bottom:14px;">
    <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
      <span style="font-size:12px;font-weight:600;color:rgba(255,255,255,.6);">${_esc(String(label))}</span>
      <span style="font-size:12px;color:rgba(255,255,255,.4);">${_esc(String(used))} / ${_esc(String(max || '?'))}</span>
    </div>
    <div style="height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden;">
      <div style="height:100%;width:${pct ?? 0}%;background:${color};border-radius:3px;"></div>
    </div>
  </div>`;
}

function _fmtDateStr(s) {
  if (!s) return '—';
  try { return new Date(s + 'T12:00:00').toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' }); }
  catch { return s; }
}

async function _bindFact() {
  // Async: user count for usage bar
  try {
    const snap = await window._db.collection('usuarios').where('empresaId','==',_empresaId).get();
    const el = _container?.querySelector('#factUsageEl');
    if (el) el.innerHTML = _usageBar('Usuarios', snap.size, _empresa.limites?.maxUsuarios || 0);
  } catch {}

  _loadPagos();

  const form = _container?.querySelector('#facturacionForm');
  if (form) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        const ch = {
          'facturacion.tarifa':      Number(form.tarifa.value) || 0,
          'facturacion.ciclo':       form.ciclo.value,
          'facturacion.moneda':      form.moneda.value,
          'facturacion.proximoPago': form.proximoPago.value,
          'facturacion.metodoPago':  form.metodoPago.value,
          'facturacion.notas':       form.notasFact.value.trim(),
        };
        await window._db.collection('empresas').doc(_empresaId).update(ch);
        if (!_empresa.facturacion) _empresa.facturacion = {};
        Object.assign(_empresa.facturacion, {
          tarifa: Number(form.tarifa.value) || 0, ciclo: form.ciclo.value,
          moneda: form.moneda.value, proximoPago: form.proximoPago.value,
          metodoPago: form.metodoPago.value, notas: form.notasFact.value.trim(),
        });
        _toast('Facturación guardada', 'ok');
        btn.textContent = 'Guardado ✓';
        setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = 'Guardar'; } }, 2200);
      } catch (err) { _toast('Error: ' + err.message, 'error'); btn.disabled = false; btn.textContent = 'Guardar'; }
    });
  }

  const modal = _container?.querySelector('#pagoModal');
  _container?.querySelector('#btnNuevoPago')?.addEventListener('click', () => { if (modal) modal.style.display = 'flex'; });
  _container?.querySelector('#pagoModalClose')?.addEventListener('click', () => { if (modal) modal.style.display = 'none'; });
  modal?.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });

  const pagoForm = _container?.querySelector('#pagoForm');
  if (pagoForm) {
    pagoForm.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = pagoForm.querySelector('[type=submit]');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await window._db.collection('empresas').doc(_empresaId).collection('pagos').add({
          monto:      Number(pagoForm.monto.value) || 0,
          moneda:     pagoForm.moneda.value,
          fecha:      pagoForm.fecha.value,
          metodo:     pagoForm.metodo.value,
          referencia: pagoForm.referencia.value.trim(),
          notas:      pagoForm.notas.value.trim(),
          createdAt:  firebase.firestore.FieldValue.serverTimestamp(),
        });
        if (modal) modal.style.display = 'none';
        pagoForm.reset(); pagoForm.fecha.value = new Date().toISOString().split('T')[0];
        _toast('Pago registrado', 'ok'); _loadPagos();
      } catch (err) { _toast('Error: ' + err.message, 'error'); }
      finally { btn.disabled = false; btn.textContent = 'Guardar'; }
    });
  }
}

async function _loadPagos() {
  const el = _container?.querySelector('#pagosListEl');
  if (!el || !window._db) return;
  try {
    const snap = await window._db.collection('empresas').doc(_empresaId)
      .collection('pagos').orderBy('createdAt', 'desc').limit(30).get();
    if (!snap.docs.length) {
      el.innerHTML = `<div style="padding:14px 0;font-size:12px;color:rgba(255,255,255,.25);">Sin pagos registrados.</div>`;
      return;
    }
    el.innerHTML = snap.docs.map(d => {
      const p = d.data();
      const monto = new Intl.NumberFormat('es-MX', { style:'currency', currency: p.moneda||'MXN' }).format(p.monto||0);
      return `<div style="background:#070d16;border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:11px 14px;margin-bottom:6px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <span style="font-size:13px;font-weight:800;color:#34d399;">${_esc(monto)}</span>
        <span style="font-size:11px;color:rgba(255,255,255,.35);">${_esc(p.fecha||'')} · ${_esc(p.metodo||'')}</span>
        ${p.referencia?`<span style="font-size:11px;font-family:monospace;color:rgba(255,255,255,.25);">${_esc(p.referencia)}</span>`:''}
        ${p.notas?`<span style="font-size:11px;color:rgba(255,255,255,.3);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(p.notas)}</span>`:''}
        <button data-del-pago="${_esc(d.id)}" type="button" style="margin-left:auto;background:none;border:none;color:rgba(239,68,68,.4);font-size:14px;cursor:pointer;flex-shrink:0;">✕</button>
      </div>`;
    }).join('');
    el.querySelectorAll('[data-del-pago]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este pago?')) return;
        try {
          await window._db.collection('empresas').doc(_empresaId).collection('pagos').doc(btn.dataset.delPago).delete();
          _toast('Pago eliminado', 'ok'); _loadPagos();
        } catch (err) { _toast('Error: ' + err.message, 'error'); }
      });
    });
  } catch (err) {
    el.innerHTML = `<div style="color:#f87171;font-size:12px;">Error al cargar pagos: ${_esc(err.message)}</div>`;
  }
}

// ── Contratos tab (empresa) ────────────────────────────────

function _contratosEmpresaTabHtml() {
  return `
<div style="max-width:900px;">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
    <div style="font-size:12px;color:rgba(255,255,255,.4);">Contratos de <strong style="color:rgba(255,255,255,.7);">${_esc(_empresa.nombre||_empresaId)}</strong></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      <button id="btnSubirFisicoEmp" type="button" style="padding:7px 14px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.55);font-size:12px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">
        <span class="material-symbols-outlined" style="font-size:15px;">upload_file</span>Subir físico
      </button>
      <button id="btnNuevoContratoEmp" type="button" style="padding:7px 14px;border-radius:8px;background:#6366f1;color:#fff;border:none;font-size:12px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">
        <span class="material-symbols-outlined" style="font-size:15px;">add</span>Nuevo contrato
      </button>
    </div>
  </div>
  <div id="contratosEmpList"><div style="font-size:12px;color:rgba(255,255,255,.25);padding:16px 0;">Cargando contratos…</div></div>

  <!-- Subir contrato físico -->
  <div id="subirFisicoEmpForm" style="display:none;background:#0f1b2d;border:1px solid rgba(99,102,241,.2);border-radius:12px;padding:20px;margin-top:12px;">
    <div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:4px;">Subir contrato físico</div>
    <div style="font-size:11px;color:rgba(255,255,255,.3);margin-bottom:14px;">Escanea o fotografía el contrato firmado y súbelo como registro digital.</div>
    <form id="uploadFisicoEmpForm" style="display:flex;flex-direction:column;gap:10px;">
      ${_field('Descripción *', `<input name="descripcion" placeholder="Contrato firmado físico — ene 2025" required style="${_inp()}"/>`)}
      <div>
        <label style="display:block;font-size:11px;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:5px;">Archivo (PDF, PNG, JPG — máx. 10 MB) *</label>
        <div style="display:flex;align-items:center;gap:10px;">
          <input type="file" id="fisicoFileInput" accept=".pdf,.png,.jpg,.jpeg" style="display:none;">
          <button type="button" id="fisicoPickBtn" style="padding:7px 12px;border-radius:7px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.55);font-size:12px;font-family:Inter,sans-serif;cursor:pointer;flex-shrink:0;">Seleccionar archivo</button>
          <span id="fisicoFileName" style="font-size:11px;color:rgba(255,255,255,.3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Sin archivo</span>
        </div>
        <div id="fisicoUploadBar" style="display:none;margin-top:8px;height:4px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden;">
          <div id="fisicoUploadFill" style="height:100%;width:0%;background:#6366f1;transition:width .25s;"></div>
        </div>
      </div>
      <div style="display:flex;gap:8px;">
        <button type="submit" style="padding:8px 16px;border-radius:8px;background:#6366f1;color:#fff;border:none;font-size:12px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;">Subir</button>
        <button type="button" id="cancelSubirFisicoEmp" style="padding:8px 14px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.5);font-size:12px;font-family:Inter,sans-serif;cursor:pointer;">Cancelar</button>
      </div>
      <div id="subirFisicoStatus" style="font-size:11px;min-height:14px;color:rgba(255,255,255,.4);"></div>
    </form>
  </div>

  <!-- Nuevo contrato generado -->
  <div id="nuevoContratoEmpForm" style="display:none;background:#0f1b2d;border:1px solid rgba(99,102,241,.2);border-radius:12px;padding:20px;margin-top:12px;">
    <div style="font-size:14px;font-weight:800;color:#fff;margin-bottom:14px;">Generar contrato</div>
    <form id="genContratoEmpForm" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      ${_field('Representante legal *', `<input name="representante" value="${_esc(_empresa.contratoInfo?.representante||_empresa.datosLegales?.razonSocial||'')}" style="${_inp()}" required/>`)}
      ${_field('Email *', `<input name="email" type="email" value="${_esc(_empresa.contratoInfo?.email||_empresa.contacto?.email||'')}" style="${_inp()}" required/>`)}
      ${_field('Cargo', `<input name="cargo" value="${_esc(_empresa.contratoInfo?.cargo||'')}" style="${_inp()}"/>`)}
      ${_field('RFC', `<input name="rfc" value="${_esc(_empresa.contratoInfo?.rfc||_empresa.datosLegales?.rfc||'')}" style="${_inp()}"/>`)}
      <div style="grid-column:1/-1;">${_field('Domicilio', `<input name="domicilio" value="${_esc(_empresa.contratoInfo?.domicilio||_empresa.datosLegales?.domicilio||'')}" style="${_inp()}"/>`)}</div>
      ${_field('Plan', `<select name="plan" style="${_inp()}">
        ${['free','starter','business','enterprise'].map(p=>`<option value="${p}" ${(_empresa.plan||'')=== p?'selected':''}>${p}</option>`).join('')}
      </select>`)}
      ${_field('Ciclo', `<select name="ciclo" style="${_inp()}">
        <option value="mensual" ${(_empresa.facturacion?.ciclo||'mensual')==='mensual'?'selected':''}>Mensual</option>
        <option value="anual" ${_empresa.facturacion?.ciclo==='anual'?'selected':''}>Anual</option>
      </select>`)}
      ${_field('Tarifa', `<input name="tarifa" type="number" min="0" step="0.01" value="${_esc(String(_empresa.facturacion?.tarifa||0))}" style="${_inp()}"/>`)}
      ${_field('Moneda', `<select name="moneda" style="${_inp()}">
        <option value="MXN" ${(_empresa.facturacion?.moneda||'MXN')==='MXN'?'selected':''}>MXN</option>
        <option value="USD" ${_empresa.facturacion?.moneda==='USD'?'selected':''}>USD</option>
      </select>`)}
      ${_field('Usuarios', `<input name="usuarios" type="number" value="${_esc(String(_empresa.limites?.maxUsuarios||10))}" style="${_inp()}"/>`)}
      ${_field('Almacenamiento (GB)', `<input name="almacenamiento" type="number" value="10" style="${_inp()}"/>`)}
      <div style="grid-column:1/-1;">${_field('Notas / condiciones especiales', `<textarea name="notas" rows="2" style="${_inp()}resize:vertical;"></textarea>`)}</div>
      <div style="grid-column:1/-1;background:rgba(234,179,8,.05);border:1px solid rgba(234,179,8,.18);border-radius:9px;padding:14px 16px;">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#fbbf24;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
          <span class="material-symbols-outlined" style="font-size:14px;">lock</span>Contraseña de acceso (opcional)
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,.3);margin-bottom:10px;line-height:1.5;">El enlace puede filtrarse. Con contraseña el destinatario debe ingresarla para ver el contenido — se guarda encriptada en la base de datos.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          ${_field('Contraseña', `<input type="password" name="contrasenaCont" autocomplete="new-password" placeholder="Dejar vacío = sin protección" style="${_inp()}"/>`)}
          ${_field('Confirmar contraseña', `<input type="password" name="contrasenaContConfirm" placeholder="Repite la contraseña" style="${_inp()}"/>`)}
        </div>
      </div>
      <div style="grid-column:1/-1;display:flex;gap:8px;margin-top:4px;">
        <button type="submit" style="padding:9px 16px;border-radius:8px;background:#6366f1;color:#fff;border:none;font-size:12px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;">Generar contrato</button>
        <button type="button" id="cancelNuevoContratoEmp" style="padding:9px 14px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.5);font-size:12px;font-family:Inter,sans-serif;cursor:pointer;">Cancelar</button>
      </div>
      <div id="genContratoEmpStatus" style="grid-column:1/-1;font-size:11px;color:rgba(255,255,255,.4);min-height:14px;"></div>
    </form>
  </div>
</div>`;
}

async function _sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function _bindContratosEmpresa() {
  _loadContratosEmp();

  _container?.querySelector('#btnNuevoContratoEmp')?.addEventListener('click', () => {
    const f = _container?.querySelector('#nuevoContratoEmpForm');
    const u = _container?.querySelector('#subirFisicoEmpForm');
    if (u?.style.display !== 'none') { u.style.display = 'none'; return; }
    if (f) f.style.display = f.style.display === 'none' ? 'block' : 'none';
  });
  _container?.querySelector('#btnSubirFisicoEmp')?.addEventListener('click', () => {
    const f = _container?.querySelector('#nuevoContratoEmpForm');
    const u = _container?.querySelector('#subirFisicoEmpForm');
    if (f?.style.display !== 'none') { f.style.display = 'none'; return; }
    if (u) u.style.display = u.style.display === 'none' ? 'block' : 'none';
  });
  _container?.querySelector('#cancelNuevoContratoEmp')?.addEventListener('click', () => {
    const f = _container?.querySelector('#nuevoContratoEmpForm');
    if (f) f.style.display = 'none';
  });
  _container?.querySelector('#cancelSubirFisicoEmp')?.addEventListener('click', () => {
    const u = _container?.querySelector('#subirFisicoEmpForm');
    if (u) u.style.display = 'none';
  });

  const fisicoPickBtn = _container?.querySelector('#fisicoPickBtn');
  const fisicoInput   = _container?.querySelector('#fisicoFileInput');
  const fisicoLabel   = _container?.querySelector('#fisicoFileName');
  fisicoPickBtn?.addEventListener('click', () => fisicoInput?.click());
  fisicoInput?.addEventListener('change', () => {
    const f = fisicoInput.files?.[0];
    if (fisicoLabel) fisicoLabel.textContent = f ? f.name : 'Sin archivo';
  });

  const uploadForm = _container?.querySelector('#uploadFisicoEmpForm');
  if (uploadForm) {
    uploadForm.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = uploadForm.querySelector('[type=submit]');
      const statusEl = uploadForm.querySelector('#subirFisicoStatus');
      const file = fisicoInput?.files?.[0];
      if (!file) { _toast('Selecciona un archivo', 'error'); return; }
      if (file.size > 10 * 1024 * 1024) { _toast('El archivo supera 10 MB', 'error'); return; }
      btn.disabled = true; btn.textContent = 'Subiendo…';
      const bar  = uploadForm.querySelector('#fisicoUploadBar');
      const fill = uploadForm.querySelector('#fisicoUploadFill');
      if (bar) bar.style.display = 'block';
      if (statusEl) { statusEl.style.color = 'rgba(255,255,255,.4)'; statusEl.textContent = 'Subiendo archivo…'; }
      try {
        const ts   = Date.now();
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
        const path = `contratos_fisicos/${_empresaId}/${ts}_${safe}`;
        const ref  = firebase.storage().ref(path);
        const task = ref.put(file, { contentType: file.type });
        task.on('state_changed', snap => {
          const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
          if (fill) fill.style.width = pct + '%';
        });
        await task;
        const url = await ref.getDownloadURL();
        const token = _empRandToken();
        const desc  = uploadForm.querySelector('[name=descripcion]').value.trim();
        await window._db.collection('contratos').doc(token).set({
          empresaId: _empresaId, empresaNombre: _empresa.nombre || _empresaId,
          tipo: 'fisico', descripcion: desc,
          archivoUrl: url, archivoNombre: file.name, archivoTipo: file.type,
          estado: 'firmado',
          fechaGenerado: firebase.firestore.FieldValue.serverTimestamp(),
          version: 1,
        });
        uploadForm.reset();
        if (fisicoLabel) fisicoLabel.textContent = 'Sin archivo';
        if (bar) bar.style.display = 'none';
        const formEl = _container?.querySelector('#subirFisicoEmpForm');
        if (formEl) formEl.style.display = 'none';
        _toast('Contrato físico subido', 'ok');
        _loadContratosEmp();
      } catch (err) {
        if (statusEl) { statusEl.style.color = '#f87171'; statusEl.textContent = 'Error: ' + err.message; }
        _toast('Error: ' + err.message, 'error');
      } finally { btn.disabled = false; btn.textContent = 'Subir'; }
    });
  }

  const genForm = _container?.querySelector('#genContratoEmpForm');
  if (genForm) {
    genForm.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = genForm.querySelector('[type=submit]');
      const statusEl = genForm.querySelector('#genContratoEmpStatus');
      btn.disabled = true; btn.textContent = 'Generando…';
      try {
        const fd = new FormData(genForm), d = {};
        fd.forEach((v, k) => { d[k] = String(v).trim(); });
        if (!d.representante || !d.email) {
          _toast('Representante y email requeridos', 'error');
          btn.disabled = false; btn.textContent = 'Generar contrato'; return;
        }
        if (d.contrasenaCont && d.contrasenaCont !== d.contrasenaContConfirm) {
          _toast('Las contraseñas no coinciden', 'error');
          btn.disabled = false; btn.textContent = 'Generar contrato'; return;
        }
        if (d.contrasenaCont && d.contrasenaCont.length < 4) {
          _toast('Contraseña mínimo 4 caracteres', 'error');
          btn.disabled = false; btn.textContent = 'Generar contrato'; return;
        }
        let passwordHash = null;
        if (d.contrasenaCont) passwordHash = await _sha256Hex(d.contrasenaCont);

        const token = _empRandToken();
        const hoy   = new Date().toISOString().split('T')[0];
        const vigFin = _empAddMonths(hoy, d.ciclo === 'anual' ? 12 : 1);
        let prov = {};
        try {
          const ps = await window._db.collection('configuracion').doc('saas_proveedor').get();
          if (ps.exists) prov = ps.data();
        } catch {}

        const data = {
          empresaId: _empresaId, empresaNombre: _empresa.nombre || _empresaId,
          rfc: d.rfc, representante: d.representante, cargo: d.cargo,
          email: d.email, domicilio: d.domicilio,
          plan: d.plan||'starter', usuarios: Number(d.usuarios)||10,
          almacenamiento: Number(d.almacenamiento)||10,
          tarifa: Number(d.tarifa)||0, moneda: d.moneda||'MXN', ciclo: d.ciclo||'mensual',
          vigenciaInicio: hoy, vigenciaFin: vigFin,
          estado: 'borrador', notas: d.notas,
          fechaGenerado: firebase.firestore.FieldValue.serverTimestamp(),
          fechaEnviado: null, fechaVisto: null, fechaFirmado: null, firmaData: null,
          version: 1, proveedor: { ...prov },
        };
        if (passwordHash) data.passwordHash = passwordHash;

        await window._db.collection('contratos').doc(token).set(data);
        await window._db.collection('empresas').doc(_empresaId).update({
          'ultimoContrato.estado': 'borrador',
          'ultimoContrato.token': token,
          'ultimoContrato.vigenciaFin': vigFin,
        });
        _empresa.ultimoContrato = { estado: 'borrador', token, vigenciaFin: vigFin };
        const formEl = _container?.querySelector('#nuevoContratoEmpForm');
        if (formEl) formEl.style.display = 'none';
        _toast(`Contrato generado${passwordHash ? ' 🔒' : ''}`, 'ok');
        _loadContratosEmp();
      } catch (err) {
        if (statusEl) { statusEl.style.color = '#f87171'; statusEl.textContent = 'Error: ' + err.message; }
        _toast('Error: ' + err.message, 'error');
      } finally { btn.disabled = false; btn.textContent = 'Generar contrato'; }
    });
  }
}

async function _loadContratosEmp() {
  const el = _container?.querySelector('#contratosEmpList');
  if (!el || !window._db) return;
  try {
    const snap = await window._db.collection('contratos').where('empresaId','==',_empresaId).get();
    const contratos = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.fechaGenerado?.toMillis?.() || 0) - (a.fechaGenerado?.toMillis?.() || 0));

    if (!contratos.length) {
      el.innerHTML = `<div style="padding:16px 0;font-size:13px;color:rgba(255,255,255,.25);">Sin contratos. Usa <strong style="color:rgba(255,255,255,.4);">Nuevo contrato</strong> para empezar.</div>`;
      return;
    }

    const stMap = {
      borrador: { t:'Borrador', c:'rgba(255,255,255,.4)', bg:'rgba(255,255,255,.05)', b:'rgba(255,255,255,.1)' },
      enviado:  { t:'Enviado',  c:'#a5b4fc', bg:'rgba(99,102,241,.12)', b:'rgba(99,102,241,.2)' },
      visto:    { t:'Visto',    c:'#fbbf24', bg:'rgba(245,158,11,.12)', b:'rgba(245,158,11,.2)' },
      firmado:  { t:'Firmado',  c:'#34d399', bg:'rgba(16,185,129,.12)', b:'rgba(16,185,129,.2)' },
    };
    const _bs = (bg, border, color) =>
      `padding:5px 9px;border-radius:6px;background:${bg};border:1px solid ${border};color:${color};font-size:11px;font-family:Inter,sans-serif;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:3px;`;

    el.innerHTML = contratos.map(c => {
      const st       = stMap[c.estado] || stMap.borrador;
      const fecha    = c.fechaGenerado?.toDate ? c.fechaGenerado.toDate() : null;
      const esFisico = c.tipo === 'fisico';

      const actions = esFisico
        ? (c.archivoUrl
            ? `<a href="${_esc(c.archivoUrl)}" target="_blank" style="${_bs('rgba(99,102,241,.12)','rgba(99,102,241,.25)','#a5b4fc')} text-decoration:none;"><span class="material-symbols-outlined" style="font-size:12px;">download</span>Descargar</a>`
            : '')
        : `<button data-cemp-preview="${_esc(c.id)}" type="button" style="${_bs('rgba(255,255,255,.04)','rgba(255,255,255,.1)','rgba(255,255,255,.55)')}"><span class="material-symbols-outlined" style="font-size:12px;">preview</span>Vista previa</button>
           <button data-cemp-pdf="${_esc(c.id)}" type="button" style="${_bs('rgba(239,68,68,.1)','rgba(239,68,68,.25)','#f87171')}"><span class="material-symbols-outlined" style="font-size:12px;">picture_as_pdf</span>PDF</button>
           <button data-cemp-copy="${_esc(c.id)}" type="button" style="${_bs('rgba(16,185,129,.12)','rgba(16,185,129,.25)','#34d399')}"><span class="material-symbols-outlined" style="font-size:12px;">link</span>Enlace</button>
           <button data-cemp-pw="${_esc(c.id)}" data-has-pw="${c.passwordHash?'1':'0'}" type="button" style="${_bs(c.passwordHash?'rgba(234,179,8,.1)':'rgba(255,255,255,.03)',c.passwordHash?'rgba(234,179,8,.25)':'rgba(255,255,255,.08)',c.passwordHash?'#fbbf24':'rgba(255,255,255,.3)')}"><span class="material-symbols-outlined" style="font-size:12px;">${c.passwordHash?'lock':'lock_open'}</span>${c.passwordHash?'Contraseña':'Sin contraseña'}</button>`;

      return `<div style="background:#070d16;border:1px solid rgba(255,255,255,.06);border-radius:10px;margin-bottom:8px;overflow:hidden;">
        <div style="padding:11px 14px;display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:180px;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;flex-wrap:wrap;">
              ${esFisico?`<span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:5px;background:rgba(245,158,11,.1);color:#fbbf24;border:1px solid rgba(245,158,11,.2);">📎 Físico</span>`:''}
              <span style="font-size:10px;font-weight:800;padding:2px 8px;border-radius:5px;background:${st.bg};color:${st.c};border:1px solid ${st.b};">${st.t}</span>
              ${c.passwordHash?`<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:5px;background:rgba(234,179,8,.08);color:#fbbf24;border:1px solid rgba(234,179,8,.2);display:inline-flex;align-items:center;gap:2px;"><span class="material-symbols-outlined" style="font-size:11px;">lock</span>Protegido</span>`:''}
              ${fecha?`<span style="font-size:10px;color:rgba(255,255,255,.25);">${fecha.toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'})}</span>`:''}
            </div>
            ${esFisico
              ?`<div style="font-size:12px;color:rgba(255,255,255,.55);">${_esc(c.descripcion||c.archivoNombre||'Contrato físico')}</div>`
              :`<div style="font-size:11px;color:rgba(255,255,255,.4);">${_esc(c.plan||'—')} · ${_esc(c.ciclo||'')} · ${c.tarifa?new Intl.NumberFormat('es-MX',{style:'currency',currency:c.moneda||'MXN'}).format(c.tarifa):'—'}${c.vigenciaFin?` · Vence ${_fmtDateStr(c.vigenciaFin)}`:''}</div>
               <div style="font-size:11px;color:rgba(255,255,255,.25);margin-top:2px;">${_esc(c.representante||'')}${c.email?` · ${_esc(c.email)}`:''}</div>`
            }
          </div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:flex-start;flex-shrink:0;">${actions}</div>
        </div>
        ${!esFisico?`<div id="cemp_preview_${_esc(c.id)}" style="display:none;border-top:1px solid rgba(255,255,255,.06);"><iframe data-preview-frame="${_esc(c.id)}" style="width:100%;height:560px;border:none;background:#fff;" sandbox="allow-same-origin"></iframe></div>`:''}
      </div>`;
    }).join('');

    el.querySelectorAll('[data-cemp-preview]').forEach(btn => {
      btn.addEventListener('click', () => _toggleContratoPreview(btn.dataset.cempPreview, contratos));
    });
    el.querySelectorAll('[data-cemp-pdf]').forEach(btn => {
      btn.addEventListener('click', () => _downloadContratoPdf(btn.dataset.cempPdf, contratos));
    });
    el.querySelectorAll('[data-cemp-copy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = `${window.location.origin}/contrato-publico.html?token=${encodeURIComponent(btn.dataset.cempCopy)}`;
        navigator.clipboard?.writeText(url).then(() => _toast('Enlace copiado', 'ok')).catch(() => _toast('URL: ' + url, 'ok'));
      });
    });
    el.querySelectorAll('[data-cemp-pw]').forEach(btn => {
      btn.addEventListener('click', () => _gestionarContrasenaContrato(btn.dataset.cempPw, btn.dataset.hasPw === '1'));
    });
  } catch (err) {
    el.innerHTML = `<div style="color:#f87171;font-size:12px;">Error: ${_esc(err.message)}</div>`;
  }
}

async function _toggleContratoPreview(contratoId, contratos) {
  const panel = _container?.querySelector(`#cemp_preview_${contratoId}`);
  if (!panel) return;
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  const frame = panel.querySelector('[data-preview-frame]');
  if (!frame || frame.dataset.loaded) return;
  const c = contratos.find(x => x.id === contratoId);
  if (!c) return;
  let prov = {};
  try { const ps = await window._db.collection('configuracion').doc('saas_proveedor').get(); if (ps.exists) prov = ps.data(); } catch {}
  frame.srcdoc = _contratoDocHTML(prov, c);
  frame.dataset.loaded = '1';
}

function _downloadContratoPdf(contratoId, contratos) {
  const c = contratos.find(x => x.id === contratoId);
  if (!c) return;
  (async () => {
    let prov = {};
    try { const ps = await window._db.collection('configuracion').doc('saas_proveedor').get(); if (ps.exists) prov = ps.data(); } catch {}
    const html = _contratoDocHTML(prov, c);
    const win = window.open('', '_blank', 'width=860,height=740');
    if (!win) { _toast('Permite popups para imprimir/guardar PDF', 'error'); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => { try { win.focus(); win.print(); } catch {} }, 700);
  })();
}

async function _gestionarContrasenaContrato(contratoId, hasPw) {
  const pwd = prompt(hasPw
    ? '🔒 Contrato protegido.\nNueva contraseña (dejar vacío para quitar protección):'
    : 'Define una contraseña para proteger este contrato (o Cancelar):');
  if (pwd === null) return;
  try {
    if (pwd.trim()) {
      if (pwd.trim().length < 4) { _toast('Mínimo 4 caracteres', 'error'); return; }
      const hash = await _sha256Hex(pwd.trim());
      await window._db.collection('contratos').doc(contratoId).update({ passwordHash: hash });
      _toast('Contraseña guardada', 'ok');
    } else if (hasPw) {
      await window._db.collection('contratos').doc(contratoId).update({ passwordHash: firebase.firestore.FieldValue.delete() });
      _toast('Contraseña eliminada', 'ok');
    } else { return; }
    _loadContratosEmp();
  } catch (err) { _toast('Error: ' + err.message, 'error'); }
}

function _contratoDocHTML(prov, c) {
  const p = prov || {};
  const _fd = s => {
    if (!s) return '—';
    try { return new Date(typeof s === 'string' && s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('es-MX',{day:'2-digit',month:'long',year:'numeric'}); } catch { return s; }
  };
  const fi = _fd(c.vigenciaInicio), ff = _fd(c.vigenciaFin);
  const tf = new Intl.NumberFormat('es-MX',{style:'currency',currency:c.moneda||'MXN'}).format(Number(c.tarifa)||0);
  const per = c.ciclo === 'anual' ? '12 meses' : '1 mes';
  const sig = c.firmaData
    ? `<p>&#10003; <strong>Firmado digitalmente</strong></p><p>Firmante: ${c.representante} &lt;${c.email}&gt;</p><img src="${c.firmaData}" alt="Firma" style="max-height:60px;margin-top:6px;display:block;"/>`
    : `<p>Fecha: ____________________</p><p>Firmante: ${c.representante} &lt;${c.email}&gt;</p>`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>
    @page{size:letter;margin:2.5cm 2cm}*{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,sans-serif;color:#222;line-height:1.75;font-size:10.5pt}
    .hdr{text-align:center;border-bottom:3px solid #1a3a6b;padding-bottom:18px;margin-bottom:28px}
    .hdr h1{font-size:17pt;color:#1a3a6b}.hdr h2{font-size:11.5pt;color:#2e5fac;margin-top:4px}
    .hdr .meta{font-size:8.5pt;color:#888;margin-top:8px}
    h3{font-size:10.5pt;color:#1a3a6b;margin:20px 0 7px;border-bottom:1px solid #dde4ee;padding-bottom:3px}
    p{margin:5px 0;text-align:justify}.parties{display:flex;gap:20px;margin:12px 0}
    .party{flex:1;background:#f4f7fb;border:1px solid #dde4ee;border-radius:6px;padding:11px 13px}
    .party h4{margin:0 0 6px;color:#1a3a6b;font-size:9.5pt}.party p{font-size:9pt;margin:2px 0;text-align:left}
    .plan{background:#eef4ff;border:1px solid #c4d5f0;border-radius:6px;padding:11px 13px;margin:9px 0}
    .plan .row{display:flex;justify-content:space-between;margin:2px 0;font-size:9pt}.plan .lbl{color:#555}.plan .val{font-weight:700;color:#1a3a6b}
    .sigs{display:flex;gap:40px;margin-top:50px;page-break-inside:avoid}.sig{flex:1;text-align:center}
    .sigline{border-top:1px solid #333;margin-top:65px;padding-top:5px;font-size:9pt;color:#555}
    .signame{font-weight:700;color:#1a3a6b;margin-top:3px}.sigrole{font-size:8.5pt;color:#888}
    .acept{background:#f0faf0;border:1px solid #b5ddb5;border-radius:6px;padding:11px 13px;margin-top:18px}
    .acept h4{color:#2a7a2a;margin:0 0 6px;font-size:9.5pt}.acept p{font-size:9pt;color:#555;text-align:left}
    .footer{text-align:center;font-size:8pt;color:#aaa;margin-top:32px;border-top:1px solid #ddd;padding-top:8px}
    @media print{body{font-size:10pt}}
  </style></head><body>
  <div class="hdr"><h1>CONTRATO DE LICENCIA Y SERVICIOS SaaS</h1><h2>${p.plataforma||'MapGestion'}</h2>
    <div class="meta">Generado: ${fi} &nbsp;|&nbsp; Vigencia hasta: ${ff}</div></div>
  <h3>IDENTIFICACIÓN DE LAS PARTES</h3><p>El presente Contrato se celebra entre:</p>
  <div class="parties">
    <div class="party"><h4>EL PROVEEDOR</h4><p><strong>${p.razonSocial||''}</strong></p>${p.rfc?`<p>RFC: ${p.rfc}</p>`:''}<p>Domicilio: ${p.domicilio||''}</p><p>Representante: ${p.representante||''} &mdash; ${p.cargo||''}</p><p>Email: ${p.email||''}</p></div>
    <div class="party"><h4>EL CLIENTE</h4><p><strong>${c.empresaNombre||''}</strong></p>${c.rfc?`<p>RFC: ${c.rfc}</p>`:''}${c.domicilio?`<p>Domicilio: ${c.domicilio}</p>`:''}<p>Representante: ${c.representante||''}${c.cargo?` &mdash; ${c.cargo}`:''}</p><p>Email: ${c.email||''}</p></div>
  </div>
  <h3>PLAN Y CONDICIONES ECONÓMICAS</h3>
  <div class="plan">
    <div class="row"><span class="lbl">Plan:</span><span class="val">${c.plan||''}</span></div>
    <div class="row"><span class="lbl">Usuarios:</span><span class="val">${c.usuarios||''}</span></div>
    <div class="row"><span class="lbl">Almacenamiento:</span><span class="val">${c.almacenamiento||''} GB</span></div>
    <div class="row"><span class="lbl">Tarifa:</span><span class="val">${tf} ${c.moneda||'MXN'} / ${c.ciclo||''}</span></div>
    <div class="row"><span class="lbl">Período:</span><span class="val">${fi} &mdash; ${ff}</span></div>
    <div class="row"><span class="lbl">Plataforma:</span><span class="val">${p.urlPlataforma||''}</span></div>
  </div>
  ${c.notas?`<p><em><strong>Condiciones especiales:</strong> ${c.notas}</em></p>`:''}
  <h3>1. OBJETO</h3><p>El Proveedor otorga al Cliente una licencia de uso limitada, no exclusiva e intransferible para acceder a <strong>${p.plataforma||'la Plataforma'}</strong> durante el Período de Suscripción, exclusivamente para fines comerciales internos.</p>
  <h3>2. VIGENCIA</h3><p>Inicia el ${fi} con duración de ${per}, renovable automáticamente salvo aviso con 30 días de anticipación.</p>
  <h3>3. TARIFAS</h3><p>La tarifa del plan ${c.plan||''} es de ${tf} ${c.moneda||'MXN'} por período ${c.ciclo||''}, más IVA. El cobro es anticipado. En caso de mora se aplicarán intereses del 2% mensual.</p>
  <h3>4. SLA</h3><p>El Proveedor garantiza Uptime mensual ≥ 99.5%. Soporte disponible lunes a viernes 09:00–18:00 CST.</p>
  <h3>5. SEGURIDAD Y DATOS</h3><p>Cifrado TLS 1.2+ en tránsito y en reposo. Backups diarios con retención de 30 días. Cumplimiento LFPDPPP.</p>
  <h3>6. PROPIEDAD INTELECTUAL</h3><p>El Proveedor es titular exclusivo de la Plataforma. El Cliente es titular de sus datos, los cuales sólo se usan para prestar el servicio.</p>
  <h3>7. LIMITACIÓN DE RESPONSABILIDAD</h3><p style="font-variant:small-caps;">La responsabilidad máxima no excederá el monto pagado en los 12 meses anteriores al evento. No se responde por daños indirectos.</p>
  <h3>8. LEY APLICABLE</h3><p>Este Contrato se rige por las leyes de México. Controversias ante los tribunales de León, Guanajuato.</p>
  <h3>FIRMAS</h3>
  <div class="sigs">
    <div class="sig">${c.firmaData?`<img src="${c.firmaData}" alt="Firma" style="max-height:60px;display:block;margin:0 auto 4px;"/>`:''}<div class="sigline">Firma del Proveedor</div><div class="signame">${p.representante||''}</div><div class="sigrole">${p.cargo||''} &mdash; ${p.razonSocial||''}</div></div>
    <div class="sig"><div class="sigline">Firma del Cliente</div><div class="signame">${c.representante||''}</div><div class="sigrole">${c.cargo?c.cargo+' &mdash; ':''}${c.empresaNombre||''}</div></div>
  </div>
  <div class="acept"><h4>Registro de Aceptación</h4>${sig}</div>
  <div class="footer"><p>Generado por ${p.plataforma||'MapGestion'} &nbsp;|&nbsp; Confidencial &nbsp;|&nbsp; ${fi}</p></div>
  </body></html>`;
}

function _empRandToken() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
}

function _empAddMonths(dateStr, months) {
  const dt = new Date(dateStr + 'T12:00:00');
  dt.setMonth(dt.getMonth() + months);
  return dt.toISOString().split('T')[0];
}

// ── Actividad tab ──────────────────────────────────────────

function _actividadTabHtml() {
  return `
<div style="max-width:900px;display:flex;flex-direction:column;gap:14px;">
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:10px;" id="actividadKpis">
    ${_kpiCard('⏳','…','Cargando')}
  </div>
  <div style="background:#0f1b2d;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:16px 18px;">
    <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:rgba(239,68,68,.65);margin-bottom:12px;">Errores — últimos 7 días</div>
    <div id="actividadErrChartEl" style="font-size:12px;color:rgba(255,255,255,.2);">Cargando…</div>
  </div>
  <div style="background:#0f1b2d;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:16px 18px;">
    <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:rgba(99,102,241,.65);margin-bottom:12px;">Usuarios — actividad reciente</div>
    <div id="actividadUsersEl" style="font-size:12px;color:rgba(255,255,255,.25);">Cargando…</div>
  </div>
</div>`;
}

function _kpiCard(icon, value, label, color) {
  return `<div style="background:#0f1b2d;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:14px 16px;display:flex;align-items:flex-start;gap:10px;">
    <div style="font-size:20px;line-height:1;flex-shrink:0;">${icon}</div>
    <div><div style="font-size:20px;font-weight:900;color:${_esc(color||'#fff')};line-height:1.2;">${_esc(String(value))}</div>
    <div style="font-size:10px;color:rgba(255,255,255,.3);margin-top:2px;">${_esc(String(label))}</div></div>
  </div>`;
}

async function _loadActividad() {
  if (!window._db) return;
  const kpisEl     = _container?.querySelector('#actividadKpis');
  const usersEl    = _container?.querySelector('#actividadUsersEl');
  const errChartEl = _container?.querySelector('#actividadErrChartEl');
  try {
    const ahora  = Date.now();
    const hace7d = ahora - 7 * 86400000;
    const hace24h = ahora - 86400000;

    const [usersSnap, errSnap, turnosSnap] = await Promise.all([
      window._db.collection('usuarios').where('empresaId','==',_empresaId).limit(100).get(),
      window._db.collection('programmer_errors')
        .where('empresaId','==',_empresaId)
        .where('timestamp','>=', hace7d)
        .get().catch(() => ({ docs: [], size: 0 })),
      window._db.collection('turnos').where('empresaId','==',_empresaId)
        .where('estado','==','ACTIVO').get().catch(() => ({ size: 0 })),
    ]);

    const errHoy = (errSnap.docs || []).filter(d => (d.data().timestamp||0) >= hace24h).length;
    const errSem = errSnap.docs?.length ?? 0;
    const activos24h = usersSnap.docs.filter(d => {
      const ts = d.data().lastSeenAt || d.data().lastActiveAt;
      return ts && ts >= hace24h;
    }).length;

    if (kpisEl) {
      kpisEl.innerHTML =
        _kpiCard('👤', usersSnap.size, 'Usuarios registrados', '#a5b4fc') +
        _kpiCard('🟢', activos24h, 'Activos 24 h', activos24h > 0 ? '#34d399' : 'rgba(255,255,255,.35)') +
        _kpiCard('✅', turnosSnap.size, 'Turnos activos', turnosSnap.size > 0 ? '#34d399' : 'rgba(255,255,255,.35)') +
        _kpiCard('🔴', errHoy, 'Errores hoy', errHoy > 3 ? '#f87171' : errHoy > 0 ? '#fbbf24' : 'rgba(255,255,255,.35)') +
        _kpiCard('⚠️', errSem, 'Errores 7 días', errSem > 10 ? '#f87171' : errSem > 3 ? '#fbbf24' : 'rgba(255,255,255,.35)');
    }

    // Error chart (7 days)
    if (errChartEl) {
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(ahora - i * 86400000);
        days.push({ key: d.toISOString().split('T')[0], label: d.toLocaleDateString('es-MX',{weekday:'short',day:'2-digit'}), count: 0 });
      }
      (errSnap.docs || []).forEach(d => {
        const ts = d.data().timestamp;
        if (!ts) return;
        const key = new Date(ts).toISOString().split('T')[0];
        const day = days.find(x => x.key === key);
        if (day) day.count++;
      });
      const maxC = Math.max(...days.map(d => d.count), 1);
      if (!days.some(d => d.count > 0)) {
        errChartEl.innerHTML = `<div style="color:rgba(255,255,255,.2);font-size:12px;">Sin errores en los últimos 7 días ✓</div>`;
      } else {
        errChartEl.innerHTML = `<div style="display:flex;align-items:flex-end;gap:6px;height:72px;">
          ${days.map(d => {
            const h = Math.max(4, Math.round((d.count / maxC) * 62));
            const col = d.count > 5 ? '#f87171' : d.count > 2 ? '#fbbf24' : d.count > 0 ? '#a5b4fc' : 'rgba(255,255,255,.07)';
            return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;">
              <div style="font-size:9px;color:rgba(255,255,255,.3);">${d.count > 0 ? d.count : ''}</div>
              <div style="width:100%;height:${h}px;background:${col};border-radius:3px 3px 0 0;min-height:4px;"></div>
              <div style="font-size:9px;color:rgba(255,255,255,.22);white-space:nowrap;">${d.label}</div>
            </div>`;
          }).join('')}
        </div>`;
      }
    }

    // Users table
    if (usersEl) {
      if (!usersSnap.size) {
        usersEl.innerHTML = `<div style="color:rgba(255,255,255,.25);">Sin usuarios registrados.</div>`;
        return;
      }
      const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.lastSeenAt||b.lastActiveAt||0) - (a.lastSeenAt||a.lastActiveAt||0));
      usersEl.innerHTML = `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;min-width:560px;">
        <thead><tr style="color:rgba(255,255,255,.2);">
          <th style="text-align:left;padding:0 10px 8px 0;font-size:10px;text-transform:uppercase;">Nombre</th>
          <th style="text-align:left;padding:0 10px 8px;font-size:10px;text-transform:uppercase;">Rol</th>
          <th style="text-align:left;padding:0 10px 8px;font-size:10px;text-transform:uppercase;">Plaza</th>
          <th style="text-align:left;padding:0 8px 8px;font-size:10px;text-transform:uppercase;">Status</th>
          <th style="text-align:left;padding:0 0 8px;font-size:10px;text-transform:uppercase;">Últ. actividad</th>
        </tr></thead>
        <tbody>
          ${users.map(u => {
            const ts = u.lastSeenAt || u.lastActiveAt;
            const dot = ts ? ((ahora-ts)<86400000?'#34d399':(ahora-ts)<7*86400000?'#fbbf24':'rgba(255,255,255,.2)') : 'rgba(255,255,255,.1)';
            const lastSeen = ts ? new Date(ts).toLocaleString('es-MX',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
            return `<tr style="border-top:1px solid rgba(255,255,255,.04);">
              <td style="${_td()}"><div style="display:flex;align-items:center;gap:7px;"><span style="width:7px;height:7px;border-radius:50%;background:${dot};flex-shrink:0;display:inline-block;"></span>${_esc(u.nombreCompleto||u.nombre||u.email||'—')}</div></td>
              <td style="${_td()}">${_rolBadge(u.rol)}</td>
              <td style="${_td()}font-size:11px;color:rgba(255,255,255,.3);">${_esc(u.plazaAsignada||'—')}</td>
              <td style="${_td()}"><span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:${u.status==='ACTIVO'?'rgba(16,185,129,.12)':'rgba(255,255,255,.05)'};color:${u.status==='ACTIVO'?'#34d399':'rgba(255,255,255,.25)'};">${_esc(u.status||'—')}</span></td>
              <td style="${_td()}font-size:11px;color:rgba(255,255,255,.3);">${_esc(lastSeen)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>`;
    }
  } catch (err) {
    if (kpisEl) kpisEl.innerHTML = `<div style="color:#f87171;font-size:12px;">Error: ${_esc(err.message)}</div>`;
  }
}

// ── Soporte tab ────────────────────────────────────────────

const _TICKET_PRIORIDADES = ['Baja','Media','Alta','Crítica'];
const _TICKET_ESTADOS     = ['Abierto','En progreso','Resuelto','Cerrado'];
const _NOTA_CATS          = ['General','Técnica','Comercial','Soporte','Incidencia'];

function _soporteTabHtml() {
  return `
<div style="max-width:760px;display:flex;flex-direction:column;gap:0;">
  <div style="display:flex;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:16px;gap:2px;">
    <button data-soporte-tab="tickets" class="sop-tab" style="padding:8px 14px;background:none;border:none;font-size:12px;font-family:Inter,sans-serif;font-weight:700;color:#a5b4fc;border-bottom:2px solid #6366f1;cursor:pointer;outline:none;">Tickets</button>
    <button data-soporte-tab="notas" class="sop-tab" style="padding:8px 14px;background:none;border:none;font-size:12px;font-family:Inter,sans-serif;font-weight:600;color:rgba(255,255,255,.4);border-bottom:2px solid transparent;cursor:pointer;outline:none;">Notas internas</button>
  </div>

  <div id="soporteTicketsPanel">
    <button id="btnNuevoTicket" type="button" style="margin-bottom:12px;padding:7px 14px;border-radius:8px;background:#6366f1;color:#fff;border:none;font-size:12px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">
      <span class="material-symbols-outlined" style="font-size:15px;">add</span>Nuevo ticket
    </button>
    <div id="nuevoTicketForm" style="display:none;background:#0f1b2d;border:1px solid rgba(99,102,241,.2);border-radius:12px;padding:18px;margin-bottom:12px;">
      <form id="ticketFormEl" style="display:flex;flex-direction:column;gap:10px;">
        ${_field('Título *', `<input name="titulo" placeholder="Describe el problema brevemente" required style="${_inp()}"/>`)}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          ${_field('Prioridad', `<select name="prioridad" style="${_inp()}">
            ${_TICKET_PRIORIDADES.map(p=>`<option value="${_esc(p)}">${_esc(p)}</option>`).join('')}
          </select>`)}
          ${_field('Categoría', `<select name="categoria" style="${_inp()}">
            ${['Técnica','Comercial','Soporte','Facturación','General'].map(c=>`<option value="${_esc(c)}">${_esc(c)}</option>`).join('')}
          </select>`)}
        </div>
        ${_field('Descripción', `<textarea name="descripcion" rows="3" placeholder="Detalla el problema, pasos para reproducirlo, impacto…" style="${_inp()}resize:vertical;"></textarea>`)}
        <div style="display:flex;gap:8px;">
          <button type="submit" style="padding:8px 16px;border-radius:8px;background:#6366f1;color:#fff;border:none;font-size:12px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;">Crear ticket</button>
          <button type="button" id="cancelTicket" style="padding:8px 14px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.5);font-size:12px;font-family:Inter,sans-serif;cursor:pointer;">Cancelar</button>
        </div>
      </form>
    </div>
    <div id="ticketsList"><div style="font-size:12px;color:rgba(255,255,255,.25);padding:10px 0;">Cargando tickets…</div></div>
  </div>

  <div id="soporteNotasPanel" style="display:none;">
    <div style="background:#0f1b2d;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:18px 20px;margin-bottom:12px;">
      <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:rgba(99,102,241,.65);margin-bottom:12px;">Nueva nota interna</div>
      <form id="notaForm" style="display:flex;flex-direction:column;gap:10px;">
        ${_field('Categoría', `<select name="categoria" style="${_inp()}">
          ${_NOTA_CATS.map(c=>`<option value="${_esc(c)}">${_esc(c)}</option>`).join('')}
        </select>`)}
        ${_field('Nota', `<textarea name="texto" rows="3" placeholder="Escribe una nota sobre esta empresa…" required style="${_inp()}resize:vertical;"></textarea>`)}
        <div><button type="submit" style="padding:8px 16px;border-radius:8px;background:#6366f1;color:#fff;border:none;font-size:12px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;">Guardar nota</button></div>
      </form>
    </div>
    <div id="notasList"><div style="font-size:12px;color:rgba(255,255,255,.25);padding:10px 0;">Cargando notas…</div></div>
  </div>
</div>`;
}

async function _bindSoporte() {
  // Subtab switching
  _container?.querySelectorAll('[data-soporte-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.soporteTab;
      _container?.querySelectorAll('[data-soporte-tab]').forEach(b => {
        const active = b.dataset.soporteTab === tab;
        b.style.color       = active ? '#a5b4fc' : 'rgba(255,255,255,.4)';
        b.style.fontWeight  = active ? '700' : '600';
        b.style.borderBottom = active ? '2px solid #6366f1' : '2px solid transparent';
      });
      const tp = _container?.querySelector('#soporteTicketsPanel');
      const np = _container?.querySelector('#soporteNotasPanel');
      if (tp) tp.style.display = tab === 'tickets' ? 'block' : 'none';
      if (np) np.style.display = tab === 'notas'   ? 'block' : 'none';
    });
  });

  _container?.querySelector('#btnNuevoTicket')?.addEventListener('click', () => {
    const f = _container?.querySelector('#nuevoTicketForm');
    if (f) f.style.display = f.style.display === 'none' ? 'block' : 'none';
  });
  _container?.querySelector('#cancelTicket')?.addEventListener('click', () => {
    const f = _container?.querySelector('#nuevoTicketForm');
    if (f) f.style.display = 'none';
  });

  const ticketFormEl = _container?.querySelector('#ticketFormEl');
  if (ticketFormEl) {
    ticketFormEl.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = ticketFormEl.querySelector('[type=submit]');
      btn.disabled = true; btn.textContent = 'Creando…';
      try {
        const fd = new FormData(ticketFormEl), d = {};
        fd.forEach((v,k) => { d[k] = String(v).trim(); });
        if (!d.titulo) { _toast('Título requerido', 'error'); return; }
        await window._db.collection('empresas').doc(_empresaId).collection('tickets_programador').add({
          titulo: d.titulo, descripcion: d.descripcion,
          prioridad: d.prioridad || 'Media', categoria: d.categoria || 'General',
          estado: 'Abierto',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          autor: window.MEX_CONFIG?.profile?.email || 'programador',
          resolucion: '',
        });
        ticketFormEl.reset();
        const f = _container?.querySelector('#nuevoTicketForm');
        if (f) f.style.display = 'none';
        _toast('Ticket creado', 'ok');
        _loadTickets();
      } catch (err) { _toast('Error: ' + err.message, 'error'); }
      finally { btn.disabled = false; btn.textContent = 'Crear ticket'; }
    });
  }

  const notaForm = _container?.querySelector('#notaForm');
  if (notaForm) {
    notaForm.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = notaForm.querySelector('[type=submit]');
      const texto = notaForm.texto.value.trim();
      if (!texto) return;
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await window._db.collection('empresas').doc(_empresaId).collection('notas_programador').add({
          texto, categoria: notaForm.categoria.value,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          autor: window.MEX_CONFIG?.profile?.email || 'programador',
        });
        notaForm.reset();
        _toast('Nota guardada', 'ok');
        _loadNotas();
      } catch (err) { _toast('Error: ' + err.message, 'error'); }
      finally { btn.disabled = false; btn.textContent = 'Guardar nota'; }
    });
  }

  await Promise.all([_loadTickets(), _loadNotas()]);
}

async function _loadTickets() {
  const el = _container?.querySelector('#ticketsList');
  if (!el || !window._db) return;
  try {
    const snap = await window._db.collection('empresas').doc(_empresaId)
      .collection('tickets_programador').orderBy('createdAt','desc').limit(60).get();

    if (!snap.docs.length) {
      el.innerHTML = `<div style="padding:10px 0;font-size:12px;color:rgba(255,255,255,.25);">Sin tickets. Crea el primero con el botón de arriba.</div>`;
      return;
    }

    const prioColor  = { 'Crítica':'#f87171', 'Alta':'#fbbf24', 'Media':'#a5b4fc', 'Baja':'rgba(255,255,255,.3)' };
    const estadoColor = { 'Abierto':'#f87171', 'En progreso':'#fbbf24', 'Resuelto':'#34d399', 'Cerrado':'rgba(255,255,255,.3)' };
    const estadoBg   = { 'Abierto':'rgba(239,68,68,.1)', 'En progreso':'rgba(245,158,11,.1)', 'Resuelto':'rgba(16,185,129,.1)', 'Cerrado':'rgba(255,255,255,.04)' };

    el.innerHTML = snap.docs.map(doc => {
      const t = doc.data();
      const ts = t.createdAt?.toDate ? t.createdAt.toDate() : null;
      const pc = prioColor[t.prioridad] || 'rgba(255,255,255,.3)';
      const ec = estadoColor[t.estado]  || 'rgba(255,255,255,.3)';
      const eb = estadoBg[t.estado]     || 'rgba(255,255,255,.04)';
      return `<div style="background:#0f1b2d;border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:12px 14px;margin-bottom:8px;">
        <div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;">
          <div style="flex:1;min-width:180px;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;flex-wrap:wrap;">
              <span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:5px;background:${eb};color:${ec};border:1px solid ${ec}33;">${_esc(t.estado||'Abierto')}</span>
              <span style="font-size:10px;font-weight:700;color:${pc};">⚡ ${_esc(t.prioridad||'Media')}</span>
              <span style="font-size:10px;color:rgba(255,255,255,.2);">${_esc(t.categoria||'')}</span>
              ${ts?`<span style="font-size:10px;color:rgba(255,255,255,.2);">${ts.toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'})}</span>`:''}
            </div>
            <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:3px;">${_esc(t.titulo||'')}</div>
            ${t.descripcion?`<div style="font-size:12px;color:rgba(255,255,255,.45);line-height:1.5;">${_esc(t.descripcion)}</div>`:''}
            ${t.resolucion?`<div style="font-size:11px;color:#34d399;margin-top:5px;">✓ ${_esc(t.resolucion)}</div>`:''}
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0;">
            <select data-ticket-estado="${_esc(doc.id)}" style="padding:5px 7px;background:#070d16;border:1px solid rgba(255,255,255,.1);border-radius:6px;color:rgba(255,255,255,.6);font-size:11px;font-family:Inter,sans-serif;cursor:pointer;outline:none;">
              ${_TICKET_ESTADOS.map(s=>`<option value="${_esc(s)}" ${t.estado===s?'selected':''}>${_esc(s)}</option>`).join('')}
            </select>
            <button data-ticket-del="${_esc(doc.id)}" type="button" style="padding:4px 8px;border-radius:6px;background:none;border:1px solid rgba(239,68,68,.2);color:rgba(239,68,68,.4);font-size:10px;font-family:Inter,sans-serif;cursor:pointer;">Eliminar</button>
          </div>
        </div>
      </div>`;
    }).join('');

    el.querySelectorAll('[data-ticket-estado]').forEach(sel => {
      sel.addEventListener('change', async () => {
        try {
          await window._db.collection('empresas').doc(_empresaId).collection('tickets_programador').doc(sel.dataset.ticketEstado).update({
            estado: sel.value, updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
          _toast('Estado actualizado', 'ok');
        } catch (err) { _toast('Error: ' + err.message, 'error'); }
      });
    });
    el.querySelectorAll('[data-ticket-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este ticket?')) return;
        try {
          await window._db.collection('empresas').doc(_empresaId).collection('tickets_programador').doc(btn.dataset.ticketDel).delete();
          _toast('Ticket eliminado', 'ok'); _loadTickets();
        } catch (err) { _toast('Error: ' + err.message, 'error'); }
      });
    });
  } catch (err) {
    el.innerHTML = `<div style="color:#f87171;font-size:12px;">Error: ${_esc(err.message)}</div>`;
  }
}

async function _loadNotas() {
  const el = _container?.querySelector('#notasList');
  if (!el || !window._db) return;
  try {
    const snap = await window._db.collection('empresas').doc(_empresaId)
      .collection('notas_programador').orderBy('createdAt','desc').limit(50).get();
    if (!snap.docs.length) {
      el.innerHTML = `<div style="padding:10px 0;font-size:12px;color:rgba(255,255,255,.25);">Sin notas.</div>`;
      return;
    }
    const catColor = { Técnica:'#a5b4fc', Comercial:'#34d399', Soporte:'#fbbf24', Incidencia:'#f87171', General:'rgba(255,255,255,.4)' };
    el.innerHTML = snap.docs.map(d => {
      const n = d.data();
      const ts = n.createdAt?.toDate ? n.createdAt.toDate() : null;
      const c = catColor[n.categoria] || catColor.General;
      return `<div style="background:#0f1b2d;border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px 14px;margin-bottom:8px;position:relative;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
          <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:${c};">${_esc(n.categoria||'General')}</span>
          ${ts?`<span style="font-size:10px;color:rgba(255,255,255,.2);">${ts.toLocaleString('es-MX',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>`:''}
          ${n.autor?`<span style="font-size:10px;color:rgba(255,255,255,.18);">— ${_esc(n.autor)}</span>`:''}
        </div>
        <div style="font-size:13px;color:rgba(255,255,255,.75);white-space:pre-wrap;line-height:1.6;">${_esc(n.texto||'')}</div>
        <button data-del-nota="${_esc(d.id)}" type="button" style="position:absolute;top:10px;right:10px;background:none;border:none;color:rgba(239,68,68,.3);font-size:14px;cursor:pointer;line-height:1;">✕</button>
      </div>`;
    }).join('');
    el.querySelectorAll('[data-del-nota]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar esta nota?')) return;
        try {
          await window._db.collection('empresas').doc(_empresaId).collection('notas_programador').doc(btn.dataset.delNota).delete();
          _toast('Nota eliminada', 'ok'); _loadNotas();
        } catch (err) { _toast('Error: ' + err.message, 'error'); }
      });
    });
  } catch (err) {
    el.innerHTML = `<div style="color:#f87171;font-size:12px;">Error: ${_esc(err.message)}</div>`;
  }
}

// ── Login Presencia tab ───────────────────────────────────

function _loginPresenciaTabHtml() {
  const p = _empresa.loginPresencia || {};
  return `
<div style="max-width:560px;display:flex;flex-direction:column;gap:16px;">
  <div style="padding:12px 14px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:8px;font-size:12px;color:#a5b4fc;line-height:1.5;">
    Configura cómo aparece esta empresa en la sección <strong style="color:#c7d2fe;">"Empresas que nos usan"</strong> del login público.
    Si está visible, se mostrará en el marquee inferior de la pantalla de inicio.
  </div>
  <form id="loginPresenciaForm" style="display:flex;flex-direction:column;gap:14px;">
    <label style="display:flex;align-items:center;gap:12px;cursor:pointer;background:#0f1b2d;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:14px 16px;">
      <div style="position:relative;display:inline-block;width:42px;height:24px;flex-shrink:0;">
        <input type="checkbox" name="visible" id="lpVisible" ${p.visible ? 'checked' : ''} style="opacity:0;width:0;height:0;position:absolute;"/>
        <span id="lpTrack" style="position:absolute;inset:0;border-radius:24px;background:${p.visible?'#6366f1':'rgba(255,255,255,0.15)'};transition:background .2s;pointer-events:none;"></span>
        <span id="lpKnob" style="position:absolute;left:${p.visible?'20px':'2px'};top:2px;width:20px;height:20px;background:#fff;border-radius:50%;transition:left .2s;pointer-events:none;"></span>
      </div>
      <div>
        <div style="font-size:13px;font-weight:700;color:#fff;">Mostrar en el login</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:2px;">Aparece en el marquee de la pantalla de acceso</div>
      </div>
    </label>
    ${_field('Nombre para mostrar', `<input name="nombre" value="${_esc(p.nombre || _empresa.nombre || '')}" placeholder="${_esc(_empresa.nombre || 'Nombre')}" style="${_inp()}"/>`)}
    ${_field('Tagline (opcional)', `<input name="tagline" value="${_esc(p.tagline || '')}" placeholder="Gestión de flota desde 2018" style="${_inp()}"/>`)}
    <div>
      <label style="display:block;font-size:11px;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">Logo de la empresa</label>
      <div style="display:flex;align-items:center;gap:12px;">
        <div id="lpLogoThumb" style="width:56px;height:56px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">
          ${p.logoUrl
            ? `<img src="${_esc(p.logoUrl)}" style="width:100%;height:100%;object-fit:contain;padding:4px;" onerror="this.parentElement.innerHTML='<span style=\\'font-size:20px;opacity:.3;\\'>🏢</span>'">`
            : `<span style="font-size:20px;opacity:.3;">🏢</span>`}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;min-width:0;">
          <input type="file" id="lpLogoFile" accept="image/png,image/jpeg,image/svg+xml,image/webp" style="display:none;">
          <button type="button" id="lpLogoPickBtn" style="padding:7px 14px;border-radius:8px;background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.3);color:#a5b4fc;font-size:12px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;white-space:nowrap;">
            Seleccionar imagen
          </button>
          <span id="lpLogoFileName" style="font-size:11px;color:rgba(255,255,255,0.3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${p.logoUrl ? 'Logo actual guardado' : 'Sin logo — PNG, JPG, SVG o WebP'}
          </span>
        </div>
      </div>
      <input type="hidden" name="logoUrl" id="lpLogoUrl" value="${_esc(p.logoUrl || '')}">
      <div id="lpLogoUploadStatus" style="margin-top:6px;font-size:11px;color:rgba(255,255,255,0.4);min-height:16px;"></div>
    </div>
    ${_field('Sitio web de la empresa (opcional)', `<input name="sitioWeb" type="url" value="${_esc(p.sitioWeb || '')}" placeholder="https://miempresa.com" style="${_inp()}"/>`)}
    <div>
      <button type="submit" style="padding:9px 20px;border-radius:8px;background:#6366f1;color:#fff;border:none;font-size:13px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;">
        Guardar presencia
      </button>
    </div>
  </form>
  ${p.visible ? `
  <div style="padding:14px 16px;background:#070d16;border:1px solid rgba(255,255,255,0.06);border-radius:8px;">
    <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.25);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Preview hover card</div>
    <div style="background:rgba(10,18,32,0.95);border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:14px 16px;max-width:240px;box-shadow:0 12px 32px rgba(0,0,0,0.5);">
      ${p.logoUrl ? `<img src="${_esc(p.logoUrl)}" style="width:36px;height:36px;border-radius:8px;object-fit:contain;background:rgba(255,255,255,0.06);padding:3px;margin-bottom:8px;display:block;" onerror="this.style.display='none'"/>` : ''}
      <div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:3px;">${_esc(p.nombre || _empresa.nombre || '')}</div>
      ${p.tagline ? `<div style="font-size:11px;color:rgba(255,255,255,0.45);margin-bottom:10px;">${_esc(p.tagline)}</div>` : ''}
      ${p.sitioWeb ? `<a href="${_esc(p.sitioWeb)}" target="_blank" style="display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border-radius:8px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);color:#a5b4fc;font-size:11px;font-weight:700;text-decoration:none;"><span class="material-symbols-outlined" style="font-size:12px;">open_in_new</span>Visitar sitio</a>` : '<span style="font-size:11px;color:rgba(255,255,255,0.2);">Sin sitio web configurado</span>'}
    </div>
  </div>` : ''}
</div>`;
}

function _bindLoginPresencia() {
  const form = _container?.querySelector('#loginPresenciaForm');
  if (!form) return;

  const chk = form.querySelector('[name=visible]');
  const track = form.querySelector('#lpTrack');
  const knob  = form.querySelector('#lpKnob');
  if (chk && track && knob) {
    chk.addEventListener('change', () => {
      const v = chk.checked;
      track.style.background = v ? '#6366f1' : 'rgba(255,255,255,0.15)';
      knob.style.left = v ? '20px' : '2px';
    });
  }

  // ── Logo file picker ──────────────────────────────────
  let _pendingLogoFile = null;

  const pickBtn    = form.querySelector('#lpLogoPickBtn');
  const fileInput  = form.querySelector('#lpLogoFile');
  const thumb      = form.querySelector('#lpLogoThumb');
  const fileLabel  = form.querySelector('#lpLogoFileName');
  const uploadStat = form.querySelector('#lpLogoUploadStatus');

  pickBtn?.addEventListener('click', () => fileInput?.click());

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      _toast('El archivo no debe superar 2 MB', 'error');
      fileInput.value = '';
      return;
    }
    _pendingLogoFile = file;
    if (fileLabel) fileLabel.textContent = file.name;
    // Preview local inmediato
    const reader = new FileReader();
    reader.onload = ev => {
      if (thumb) thumb.innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:contain;padding:4px;">`;
    };
    reader.readAsDataURL(file);
    if (uploadStat) uploadStat.textContent = 'Archivo seleccionado. Se subirá al guardar.';
  });

  // ── Submit ────────────────────────────────────────────
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Guardando…';

    let logoUrl = form.logoUrl.value.trim();

    // Subir logo si hay archivo pendiente
    if (_pendingLogoFile) {
      if (uploadStat) uploadStat.textContent = 'Subiendo logo…';
      try {
        const ext  = _pendingLogoFile.name.split('.').pop().toLowerCase() || 'png';
        const path = `empresa_config/${_empresaId}_logo.${ext}`;
        const ref  = firebase.storage().ref(path);
        const snap = await ref.put(_pendingLogoFile, { contentType: _pendingLogoFile.type });
        logoUrl = await snap.ref.getDownloadURL();
        const urlInput = form.querySelector('#lpLogoUrl');
        if (urlInput) urlInput.value = logoUrl;
        if (uploadStat) uploadStat.textContent = 'Logo subido correctamente ✓';
        _pendingLogoFile = null;
      } catch (err) {
        _toast('Error al subir logo: ' + err.message, 'error');
        if (uploadStat) { uploadStat.style.color = '#f87171'; uploadStat.textContent = 'Error al subir: ' + err.message; }
        btn.disabled = false; btn.textContent = 'Guardar presencia';
        return;
      }
    }

    const data = {
      visible:  form.visible.checked,
      nombre:   form.nombre.value.trim() || _empresa.nombre || '',
      tagline:  form.tagline.value.trim(),
      logoUrl,
      sitioWeb: form.sitioWeb.value.trim(),
    };
    try {
      await window._db.collection('empresas').doc(_empresaId).update({ loginPresencia: data });
      _empresa.loginPresencia = data;
      await _syncLoginPresenciaPublica();
      _toast('Presencia guardada', 'ok');
      btn.textContent = 'Guardado ✓';
      setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = 'Guardar presencia'; } }, 2200);
      _switchTab('login');
    } catch (err) {
      _toast('Error: ' + err.message, 'error');
      btn.disabled = false; btn.textContent = 'Guardar presencia';
    }
  });
}

async function _syncLoginPresenciaPublica() {
  if (!window._db) return;
  try {
    const snap = await window._db.collection('empresas')
      .where('loginPresencia.visible', '==', true)
      .get();
    const lista = [];
    snap.forEach(doc => {
      const d = doc.data();
      if (d.loginPresencia?.visible) {
        lista.push({
          id:      doc.id,
          nombre:  d.loginPresencia.nombre || d.nombre || doc.id,
          tagline: d.loginPresencia.tagline || '',
          logoUrl: d.loginPresencia.logoUrl || '',
        });
      }
    });
    await window._db.collection('configuracion').doc('loginPresencia').set({
      lista,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn('[empresa-detail] syncLoginPresencia:', err);
  }
}

function _usuariosTabHtml() {
  return `
<div style="max-width:900px;overflow-x:auto;">
  <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:560px;">
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
