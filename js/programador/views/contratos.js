// ═══════════════════════════════════════════════════════════
//  /js/programador/views/contratos.js
//  Gestor de contratos SaaS por empresa (panel Programador).
//  Genera contratos HTML, envía enlace público al cliente,
//  registra firma y estado en Firestore.
// ═══════════════════════════════════════════════════════════

let _container = null;
let _navigate  = null;
let _empresas  = [];
let _contratos = [];
let _selectedId = null;
let _proveedor  = {};
let _searchQ    = '';

const DEFAULT_PROVEEDOR = {
  razonSocial:   'MapGestion, S.A. de C.V.',
  rfc:           '',
  domicilio:     'León, Guanajuato, México',
  representante: 'Angel Armenta Negrete',
  cargo:         'Director General',
  email:         'contacto@mpagestion.com',
  plataforma:    'MapGestion',
  urlPlataforma: 'https://mapgestion.com',
  urlPrivacidad: 'https://mapgestion.com/aviso-privacidad',
};

export async function mount({ container, navigate }) {
  _container  = container;
  _navigate   = navigate;
  _selectedId = null;
  _contratos  = [];
  _searchQ    = '';
  container.innerHTML = _skeleton();
  await _loadAll();
}

export function unmount() {
  _container = null;
  _navigate  = null;
  _empresas  = [];
  _contratos = [];
  _selectedId = null;
  _proveedor  = {};
}

// ── Data ──────────────────────────────────────────────────

async function _loadAll() {
  const [emp, prov] = await Promise.all([_loadEmpresas(), _loadProveedor()]);
  _empresas = emp;
  _proveedor = prov;
  _render();
}

async function _loadEmpresas() {
  if (!window._db) return [];
  try {
    const snap = await window._db.collection('empresas').orderBy('nombre').limit(100).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
}

async function _loadProveedor() {
  if (!window._db) return { ...DEFAULT_PROVEEDOR };
  try {
    const snap = await window._db.collection('configuracion').doc('saas_proveedor').get();
    if (snap.exists) return { ...DEFAULT_PROVEEDOR, ...snap.data() };
  } catch {}
  return { ...DEFAULT_PROVEEDOR };
}

async function _loadContratos(empresaId) {
  if (!window._db || !empresaId) return [];
  try {
    const snap = await window._db.collection('contratos')
      .where('empresaId', '==', empresaId)
      .get();
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.fechaGenerado?.toMillis?.() || 0;
        const tb = b.fechaGenerado?.toMillis?.() || 0;
        return tb - ta;
      });
  } catch (err) { console.warn('[contratos]', err); return []; }
}

// ── Render ────────────────────────────────────────────────

function _render() {
  if (!_container) return;
  _container.innerHTML = _html();
  _bind();
}

function _html() {
  const empresa  = _empresas.find(e => e.id === _selectedId);
  const filtered = _empresas.filter(e => {
    const q = _searchQ.toLowerCase();
    return !q || (e.nombre || '').toLowerCase().includes(q) || (e.id || '').toLowerCase().includes(q);
  });

  return `
<div style="display:flex;height:100%;min-height:0;overflow:hidden;">

  <!-- Sidebar -->
  <div style="width:264px;flex-shrink:0;background:#080d17;border-right:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;overflow:hidden;">
    <div style="padding:14px 12px 10px;border-bottom:1px solid rgba(255,255,255,.06);">
      <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.18);margin-bottom:10px;">
        Empresas (${_empresas.length})
      </div>
      <input id="ctSearch" value="${_esc(_searchQ)}" placeholder="Buscar empresa..." autocomplete="off"
        style="width:100%;padding:7px 10px;background:#0f1b2d;border:1px solid rgba(255,255,255,.08);border-radius:7px;color:#fff;font-size:12px;font-family:Inter,sans-serif;outline:none;"/>
    </div>
    <div style="overflow-y:auto;flex:1;padding:6px 8px;">
      ${filtered.length
        ? filtered.map(e => _empresaCardHtml(e)).join('')
        : `<div style="padding:20px 12px;font-size:12px;color:rgba(255,255,255,.2);text-align:center;">Sin resultados</div>`}
    </div>
  </div>

  <!-- Main content -->
  <div style="flex:1;overflow-y:auto;min-width:0;">
    ${empresa ? _detailHtml(empresa) : _emptyStateHtml()}
  </div>

  <!-- Modal overlay (hidden by default) -->
  <div id="ctModalOverlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:800;align-items:center;justify-content:center;padding:16px;">
    <div id="ctModalBox" style="background:#0a1220;border:1px solid rgba(255,255,255,.1);border-radius:16px;max-width:700px;width:100%;max-height:90vh;overflow-y:auto;padding:24px 28px;position:relative;">
    </div>
  </div>

</div>

<div id="ctToastHost" style="position:fixed;bottom:20px;right:20px;z-index:900;display:flex;flex-direction:column;gap:8px;pointer-events:none;"></div>

<style>
  .ct-emp-card { padding:11px 12px;border-radius:9px;margin-bottom:3px;cursor:pointer;border:1px solid transparent;transition:background .12s; }
  .ct-emp-card:hover { background:rgba(255,255,255,.04) !important; }
  .ct-card { background:#0f1b2d;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:18px 20px;margin-bottom:14px; }
  .ct-card-title { font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:rgba(99,102,241,.65);margin-bottom:14px;display:flex;align-items:center;gap:7px; }
  .ct-label { font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:rgba(255,255,255,.25);margin-bottom:4px; }
  .ct-value { font-size:13px;color:rgba(255,255,255,.7); }
  .ct-btn-primary { display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border-radius:8px;background:#6366f1;color:#fff;border:none;font-size:12px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer; }
  .ct-btn-ghost { display:inline-flex;align-items:center;gap:7px;padding:9px 14px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.6);font-size:12px;font-family:Inter,sans-serif;font-weight:600;cursor:pointer; }
  .ct-btn-success { display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border-radius:8px;background:rgba(16,185,129,.15);border:1px solid rgba(16,185,129,.3);color:#34d399;font-size:12px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer; }
  .ct-inp { width:100%;padding:8px 10px;background:#070d16;border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;font-size:12px;font-family:Inter,sans-serif;outline:none; }
  .ct-inp:focus { border-color:rgba(99,102,241,.5); }
  select.ct-inp { cursor:pointer; }
  textarea.ct-inp { resize:vertical;min-height:64px; }
</style>`;
}

function _empresaCardHtml(e) {
  const est   = _estadoLabel((e.ultimoContrato || {}).estado);
  const activo = e.id === _selectedId;
  return `
<div class="ct-emp-card" data-ct-empresa="${_esc(e.id)}"
  style="background:${activo ? 'rgba(99,102,241,.14)' : 'transparent'};border-color:${activo ? 'rgba(99,102,241,.35)' : 'transparent'};">
  <div style="font-size:12px;font-weight:700;color:#dce0eb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(e.nombre || e.id)}</div>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-top:5px;">
    <span style="font-size:10px;color:rgba(255,255,255,.25);">${_esc(e.id)}</span>
    <span style="${_badgeStyle(est.color)}">${_esc(est.text)}</span>
  </div>
</div>`;
}

function _emptyStateHtml() {
  return `
<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:rgba(255,255,255,.15);">
  <span class="material-symbols-outlined" style="font-size:52px;margin-bottom:14px;opacity:.25;">description</span>
  <div style="font-size:14px;font-weight:600;">Selecciona una empresa</div>
  <div style="font-size:12px;margin-top:4px;color:rgba(255,255,255,.1);">para gestionar sus contratos</div>
</div>`;
}

function _detailHtml(empresa) {
  return `
<div style="padding:24px 28px;max-width:860px;">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:22px;flex-wrap:wrap;">
    <div>
      <h2 style="margin:0;font-size:18px;font-weight:800;color:#fff;">${_esc(empresa.nombre || empresa.id)}</h2>
      <div style="font-size:11px;color:rgba(255,255,255,.3);margin-top:3px;font-family:monospace;">${_esc(empresa.id)}${empresa.plan ? ` · ${_esc(empresa.plan)}` : ''}</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <button id="ctBtnSettings" class="ct-btn-ghost" type="button">
        <span class="material-symbols-outlined" style="font-size:15px;">settings</span>Proveedor
      </button>
      <button id="ctBtnNew" class="ct-btn-primary" type="button">
        <span class="material-symbols-outlined" style="font-size:15px;">add</span>Nuevo contrato
      </button>
    </div>
  </div>

  <div class="ct-card">
    <div class="ct-card-title">
      <span class="material-symbols-outlined" style="font-size:16px;">description</span>
      Historial de contratos
    </div>
    <div id="ctContratosList">${_contratosListHtml()}</div>
  </div>
</div>`;
}

function _contratosListHtml() {
  if (!_contratos.length) {
    return `<div style="padding:28px 0;text-align:center;color:rgba(255,255,255,.2);font-size:13px;">
      Sin contratos. Usa <strong style="color:rgba(255,255,255,.4);">Nuevo contrato</strong> para empezar.
    </div>`;
  }
  return _contratos.map(c => {
    const est  = _estadoLabel(c.estado);
    const fecha = c.fechaGenerado?.toDate ? c.fechaGenerado.toDate() : null;
    return `
<div style="background:#070d16;border:1px solid rgba(255,255,255,.06);border-radius:9px;padding:12px 14px;margin-bottom:7px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
  <div style="flex:1;min-width:200px;">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px;">
      <span style="${_badgeStyle(est.color)}">${_esc(est.text)}</span>
      ${fecha ? `<span style="font-size:11px;color:rgba(255,255,255,.28);">Generado ${_fmtDate(fecha)}</span>` : ''}
      ${c.vigenciaFin ? `<span style="font-size:11px;color:rgba(255,255,255,.22);">· Vence ${_fmtDate(c.vigenciaFin)}</span>` : ''}
    </div>
    <div style="font-size:11px;color:rgba(255,255,255,.45);">
      ${_esc(c.plan || '—')} · ${_esc(c.ciclo || '')} · ${c.tarifa ? _fmtMonto(c.tarifa, c.moneda) : '—'}
      ${c.representante ? ` · ${_esc(c.representante)}` : ''}
    </div>
    ${c.estado === 'firmado' ? `
    <div style="font-size:11px;color:#34d399;margin-top:4px;display:flex;align-items:center;gap:4px;">
      <span class="material-symbols-outlined" style="font-size:13px;">verified</span>
      Firmado ${c.fechaFirmado?.toDate ? _fmtDate(c.fechaFirmado.toDate()) : ''}
    </div>` : ''}
    ${c.estado === 'visto' ? `
    <div style="font-size:11px;color:#fbbf24;margin-top:4px;display:flex;align-items:center;gap:4px;">
      <span class="material-symbols-outlined" style="font-size:13px;">visibility</span>
      Visto por el cliente
    </div>` : ''}
  </div>
  <div style="display:flex;gap:6px;flex-shrink:0;">
    <button class="ct-btn-ghost" data-ct-preview="${_esc(c.id)}" type="button" style="padding:6px 10px;font-size:11px;">
      <span class="material-symbols-outlined" style="font-size:14px;">preview</span>Ver
    </button>
    <button class="ct-btn-success" data-ct-link="${_esc(c.id)}" type="button" style="padding:6px 10px;font-size:11px;">
      <span class="material-symbols-outlined" style="font-size:14px;">link</span>Enlace
    </button>
  </div>
</div>`;
  }).join('');
}

// ── Bind ──────────────────────────────────────────────────

function _bind() {
  if (!_container) return;

  _container.querySelector('#ctSearch')?.addEventListener('input', e => {
    _searchQ = e.target.value;
    _render();
  });

  _container.querySelectorAll('[data-ct-empresa]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.ctEmpresa;
      if (id === _selectedId) return;
      _selectedId = id;
      _contratos  = [];
      _render();
      _contratos = await _loadContratos(id);
      _render();
    });
  });

  _container.querySelector('#ctBtnNew')?.addEventListener('click', () => {
    const empresa = _empresas.find(e => e.id === _selectedId);
    if (!empresa) return;
    _openModal(_generateModalHtml(empresa));
    _bindGenerateModal(empresa);
  });

  _container.querySelector('#ctBtnSettings')?.addEventListener('click', () => {
    _openModal(_settingsModalHtml());
    _bindSettingsModal();
  });

  _container.querySelector('#ctModalOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'ctModalOverlay') _closeModal();
  });

  _container.querySelectorAll('[data-ct-preview]').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = _contratos.find(x => x.id === btn.dataset.ctPreview);
      if (c) _openPreviewModal(c);
    });
  });

  _container.querySelectorAll('[data-ct-link]').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = _contratos.find(x => x.id === btn.dataset.ctLink);
      if (c) {
        _openModal(_linkModalHtml(c));
        _bindLinkModal(c);
      }
    });
  });
}

// ── Modal system ──────────────────────────────────────────

function _openModal(html) {
  const overlay = _container?.querySelector('#ctModalOverlay');
  const box     = _container?.querySelector('#ctModalBox');
  if (!overlay || !box) return;
  box.innerHTML = html;
  overlay.style.display = 'flex';
}

function _closeModal() {
  const overlay = _container?.querySelector('#ctModalOverlay');
  if (overlay) overlay.style.display = 'none';
}

// ── Modal HTML builders ───────────────────────────────────

function _settingsModalHtml() {
  const p = _proveedor;
  const row = (key, label) => `
<div>
  <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">${_esc(label)}</div>
  <input class="ct-inp" name="${_esc(key)}" value="${_esc(p[key] || '')}" placeholder="${_esc(label)}"/>
</div>`;

  return `
<div style="font-size:16px;font-weight:800;color:#fff;margin-bottom:3px;">Configuración del Proveedor</div>
<div style="font-size:12px;color:rgba(255,255,255,.3);margin-bottom:20px;">Datos de tu empresa que aparecen en todos los contratos</div>
<form id="ctSettingsForm" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
  ${row('razonSocial',   'Razón Social')}
  ${row('rfc',           'RFC')}
  ${row('representante', 'Representante Legal')}
  ${row('cargo',         'Cargo')}
  ${row('email',         'Email legal')}
  ${row('plataforma',    'Nombre del SaaS')}
  ${row('urlPlataforma', 'URL Plataforma')}
  ${row('urlPrivacidad', 'URL Aviso de Privacidad')}
  <div style="grid-column:1/-1;">
    <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Domicilio fiscal</div>
    <input class="ct-inp" name="domicilio" value="${_esc(p.domicilio || '')}" placeholder="Domicilio fiscal completo"/>
  </div>
</form>
<div style="display:flex;gap:8px;margin-top:20px;">
  <button id="ctSettingsSave" class="ct-btn-primary" type="button">
    <span class="material-symbols-outlined" style="font-size:14px;">save</span>Guardar
  </button>
  <button id="ctSettingsCancel" class="ct-btn-ghost" type="button">Cancelar</button>
</div>`;
}

function _bindSettingsModal() {
  _container?.querySelector('#ctSettingsCancel')?.addEventListener('click', _closeModal);
  _container?.querySelector('#ctSettingsSave')?.addEventListener('click', async () => {
    const form = _container?.querySelector('#ctSettingsForm');
    if (!form) return;
    const data = {};
    new FormData(form).forEach((v, k) => { data[k] = String(v).trim(); });
    _proveedor = { ...DEFAULT_PROVEEDOR, ...data };
    try {
      await window._db.collection('configuracion').doc('saas_proveedor').set(_proveedor);
      _toast('Configuración del proveedor guardada', 'ok');
    } catch (err) { _toast('Error: ' + err.message, 'error'); }
    _closeModal();
  });
}

function _generateModalHtml(empresa) {
  const ci = empresa.contratoInfo || {};
  return `
<div style="font-size:16px;font-weight:800;color:#fff;margin-bottom:3px;">Generar contrato</div>
<div style="font-size:12px;color:rgba(255,255,255,.3);margin-bottom:20px;">${_esc(empresa.nombre || empresa.id)}</div>
<form id="ctGenForm" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">

  <div>
    <div class="ct-label">RFC del cliente</div>
    <input class="ct-inp" name="rfc" value="${_esc(ci.rfc || '')}" placeholder="RFC123456ABC"/>
  </div>
  <div>
    <div class="ct-label">Representante legal <span style="color:#f87171">*</span></div>
    <input class="ct-inp" name="representante" value="${_esc(ci.representante || '')}" required placeholder="Nombre completo"/>
  </div>
  <div>
    <div class="ct-label">Cargo</div>
    <input class="ct-inp" name="cargo" value="${_esc(ci.cargo || '')}" placeholder="Director General"/>
  </div>
  <div>
    <div class="ct-label">Email <span style="color:#f87171">*</span></div>
    <input class="ct-inp" name="email" type="email" value="${_esc(ci.email || '')}" required placeholder="correo@empresa.com"/>
  </div>
  <div style="grid-column:1/-1;">
    <div class="ct-label">Domicilio fiscal</div>
    <input class="ct-inp" name="domicilio" value="${_esc(ci.domicilio || '')}" placeholder="Calle, Col., Ciudad, Estado, CP"/>
  </div>

  <div>
    <div class="ct-label">Plan</div>
    <select class="ct-inp" name="plan">
      ${['free','starter','business','enterprise'].map(p =>
        `<option value="${p}" ${(ci.plan || empresa.plan) === p ? 'selected' : ''}>${p}</option>`
      ).join('')}
    </select>
  </div>
  <div>
    <div class="ct-label">Ciclo</div>
    <select class="ct-inp" name="ciclo">
      <option value="mensual" ${(ci.ciclo || 'mensual') === 'mensual' ? 'selected' : ''}>Mensual</option>
      <option value="anual" ${ci.ciclo === 'anual' ? 'selected' : ''}>Anual</option>
    </select>
  </div>
  <div>
    <div class="ct-label">Tarifa (sin IVA)</div>
    <input class="ct-inp" name="tarifa" type="number" min="0" step="0.01" value="${_esc(String(ci.tarifa || ''))}" placeholder="0.00"/>
  </div>
  <div>
    <div class="ct-label">Moneda</div>
    <select class="ct-inp" name="moneda">
      <option value="MXN" ${(ci.moneda || 'MXN') === 'MXN' ? 'selected' : ''}>MXN</option>
      <option value="USD" ${ci.moneda === 'USD' ? 'selected' : ''}>USD</option>
    </select>
  </div>
  <div>
    <div class="ct-label">Usuarios autorizados</div>
    <input class="ct-inp" name="usuarios" type="number" min="1" value="${_esc(String(ci.usuarios || empresa.limites?.maxUsuarios || 10))}"/>
  </div>
  <div>
    <div class="ct-label">Almacenamiento (GB)</div>
    <input class="ct-inp" name="almacenamiento" type="number" min="1" value="${_esc(String(ci.almacenamiento || 10))}"/>
  </div>
  <div style="grid-column:1/-1;">
    <div class="ct-label">Notas / condiciones especiales</div>
    <textarea class="ct-inp" name="notas" placeholder="Descuentos, condiciones especiales, etc.">${_esc(ci.notas || '')}</textarea>
  </div>
</form>
<div style="display:flex;gap:8px;margin-top:20px;flex-wrap:wrap;">
  <button id="ctGenSubmit" class="ct-btn-primary" type="button">
    <span class="material-symbols-outlined" style="font-size:14px;">description</span>Generar contrato
  </button>
  <button id="ctGenCancel" class="ct-btn-ghost" type="button">Cancelar</button>
</div>
<div id="ctGenStatus" style="margin-top:10px;font-size:12px;color:rgba(255,255,255,.4);min-height:16px;"></div>`;
}

function _bindGenerateModal(empresa) {
  _container?.querySelector('#ctGenCancel')?.addEventListener('click', _closeModal);
  _container?.querySelector('#ctGenSubmit')?.addEventListener('click', async () => {
    const form     = _container?.querySelector('#ctGenForm');
    const statusEl = _container?.querySelector('#ctGenStatus');
    const btn      = _container?.querySelector('#ctGenSubmit');
    if (!form) return;

    const fd = new FormData(form);
    const d  = {};
    fd.forEach((v, k) => { d[k] = String(v).trim(); });

    if (!d.representante) { _toast('Representante requerido', 'error'); return; }
    if (!d.email)         { _toast('Email requerido', 'error'); return; }

    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;">hourglass_top</span>Generando…'; }
    if (statusEl) statusEl.textContent = 'Guardando contrato…';

    try {
      const token   = _randomToken();
      const hoy     = _today();
      const ciclo   = d.ciclo || 'mensual';
      const vigFin  = _addMonths(hoy, ciclo === 'anual' ? 12 : 1);

      const contratoDoc = {
        empresaId:      _selectedId,
        empresaNombre:  empresa.nombre || _selectedId,
        rfc:            d.rfc || '',
        representante:  d.representante,
        cargo:          d.cargo || '',
        email:          d.email,
        domicilio:      d.domicilio || '',
        plan:           d.plan || 'starter',
        usuarios:       Number(d.usuarios) || 10,
        almacenamiento: Number(d.almacenamiento) || 10,
        tarifa:         Number(d.tarifa) || 0,
        moneda:         d.moneda || 'MXN',
        ciclo,
        vigenciaInicio: hoy,
        vigenciaFin:    vigFin,
        estado:         'borrador',
        notas:          d.notas || '',
        fechaGenerado:  firebase.firestore.FieldValue.serverTimestamp(),
        fechaEnviado:   null,
        fechaVisto:     null,
        fechaFirmado:   null,
        firmaData:      null,
        version:        1,
        proveedor:      { ..._proveedor },
      };

      await window._db.collection('contratos').doc(token).set(contratoDoc);

      // Persist contratoInfo + ultimoContrato snapshot back to empresa
      await window._db.collection('empresas').doc(_selectedId).update({
        contratoInfo: {
          rfc: d.rfc, representante: d.representante, cargo: d.cargo,
          email: d.email, domicilio: d.domicilio, plan: d.plan, ciclo,
          tarifa: Number(d.tarifa) || 0, moneda: d.moneda, usuarios: Number(d.usuarios) || 10,
          almacenamiento: Number(d.almacenamiento) || 10, notas: d.notas,
        },
        'ultimoContrato.estado':     'borrador',
        'ultimoContrato.token':      token,
        'ultimoContrato.vigenciaFin': vigFin,
      });

      const empIdx = _empresas.findIndex(e => e.id === _selectedId);
      if (empIdx >= 0) {
        _empresas[empIdx].contratoInfo  = contratoDoc;
        _empresas[empIdx].ultimoContrato = { estado: 'borrador', token, vigenciaFin: vigFin };
      }

      _closeModal();
      _toast('Contrato generado', 'ok');
      _contratos = await _loadContratos(_selectedId);
      _render();

      // Immediately open link modal
      const c = _contratos.find(x => x.id === token);
      if (c) {
        _openModal(_linkModalHtml(c));
        _bindLinkModal(c);
      }

    } catch (err) {
      console.error('[contratos]', err);
      if (statusEl) { statusEl.style.color = '#f87171'; statusEl.textContent = 'Error: ' + err.message; }
      if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;">description</span>Generar contrato'; }
    }
  });
}

function _openPreviewModal(contrato) {
  document.getElementById('ctPreviewOverlay')?.remove();

  const fullHtml     = _generarContratoHTML(contrato.proveedor || _proveedor, contrato);
  const styleMatch   = fullHtml.match(/<style>([\s\S]*?)<\/style>/i);
  const bodyContent  = fullHtml.replace(/[\s\S]*<body>/i, '').replace(/<\/body>[\s\S]*/i, '');
  const contractCSS  = styleMatch ? styleMatch[1] : '';

  const alreadySigned = contrato.estado === 'firmado' && contrato.firmaData;
  const sigDate       = contrato.fechaFirmado
    ? _fmtDate(contrato.fechaFirmado?.toDate ? contrato.fechaFirmado.toDate() : new Date(contrato.fechaFirmado))
    : '—';

  const overlay = document.createElement('div');
  overlay.id = 'ctPreviewOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:3000;display:flex;flex-direction:column;background:#111827;font-family:Inter,sans-serif;';

  overlay.innerHTML = `
<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#0a1220;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0;gap:12px;">
  <div>
    <div style="font-size:13px;font-weight:700;color:#fff;">${_esc(contrato.empresaNombre || contrato.empresaId)}</div>
    <div style="font-size:11px;color:rgba(255,255,255,.35);margin-top:2px;">${_esc(contrato.representante || '')}${contrato.plan ? ' · ' + _esc(contrato.plan) : ''}${contrato.vigenciaFin ? ' · vence ' + _esc(contrato.vigenciaFin) : ''}</div>
  </div>
  <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
    <button id="ctPv_print"  class="ct-btn-ghost" type="button" style="padding:6px 10px;font-size:11px;"><span class="material-symbols-outlined" style="font-size:14px;">print</span><span class="ct-pv-lbl">Imprimir</span></button>
    <button id="ctPv_dl"     class="ct-btn-ghost" type="button" style="padding:6px 10px;font-size:11px;"><span class="material-symbols-outlined" style="font-size:14px;">download</span><span class="ct-pv-lbl">Descargar</span></button>
    <button id="ctPv_link"   class="ct-btn-success" type="button" style="padding:6px 10px;font-size:11px;"><span class="material-symbols-outlined" style="font-size:14px;">link</span><span class="ct-pv-lbl">Enviar</span></button>
    <button id="ctPv_close"  class="ct-btn-ghost" type="button" style="padding:6px 10px;"><span class="material-symbols-outlined" style="font-size:16px;">close</span></button>
  </div>
</div>

<div style="flex:1;overflow-y:auto;padding:20px 12px 40px;-webkit-overflow-scrolling:touch;">
  <!-- Paper -->
  <div style="max-width:780px;margin:0 auto;background:#fff;padding:36px 40px;border-radius:4px;box-shadow:0 4px 32px rgba(0,0,0,.5);">
    <div id="ctPvBody"><style>
#ctPvBody{font-family:Arial,'Helvetica Neue',sans-serif;color:#222;line-height:1.75;font-size:10.5pt;}
${contractCSS}
</style>${bodyContent}</div>
  </div>

  <!-- Signature / firma section -->
  <div style="max-width:780px;margin:20px auto 0;">
    <div style="background:#fff;border-radius:12px;box-shadow:0 2px 16px rgba(0,0,0,.4);overflow:hidden;">
      <div style="padding:16px 20px 12px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span class="material-symbols-outlined" style="font-size:20px;color:#6366f1;">draw</span>
        <div>
          <div style="font-size:14px;font-weight:800;color:#1e293b;">Firma digital del cliente</div>
          <div style="font-size:12px;color:#64748b;margin-top:1px;">${_esc(contrato.representante || '')} — ${_esc(contrato.empresaNombre || '')}</div>
        </div>
        ${alreadySigned ? `<span style="margin-left:auto;display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#16a34a;font-weight:700;"><span class="material-symbols-outlined" style="font-size:14px;">verified</span>Firmado ${sigDate}</span>` : ''}
      </div>
      ${alreadySigned ? `
      <div style="padding:20px;text-align:center;">
        <img src="${_esc(contrato.firmaData)}" alt="Firma digital" style="max-height:80px;display:inline-block;border:1px solid #e2e8f0;border-radius:8px;padding:8px;"/>
      </div>` : `
      <div style="padding:16px 20px;">
        <div style="font-size:11px;color:#64748b;margin-bottom:8px;">Firma aquí con el ratón o tu dedo:</div>
        <div style="position:relative;border:2px dashed #cbd5e1;border-radius:8px;background:#f8fafc;">
          <canvas id="ctSigCanvas" style="display:block;width:100%;height:160px;cursor:crosshair;border-radius:6px;touch-action:none;"></canvas>
          <div id="ctSigHint" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;color:#94a3b8;font-size:13px;font-style:italic;">Toca o haz clic para firmar</div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
          <button id="ctSigClear"  class="ct-btn-ghost"   type="button" style="flex:1;min-width:90px;justify-content:center;"><span class="material-symbols-outlined" style="font-size:15px;">undo</span>Limpiar</button>
          <button id="ctSigSubmit" class="ct-btn-primary"  type="button" style="flex:2;min-width:140px;justify-content:center;"><span class="material-symbols-outlined" style="font-size:15px;">draw</span>Firmar contrato</button>
        </div>
        <div id="ctSigStatus" style="margin-top:8px;font-size:11px;color:#64748b;min-height:14px;"></div>
      </div>`}
    </div>

    <!-- Pago futuro placeholder -->
    <div style="margin-top:12px;padding:12px 16px;background:rgba(255,255,255,.04);border:1px dashed rgba(255,255,255,.1);border-radius:10px;display:flex;align-items:center;gap:8px;">
      <span class="material-symbols-outlined" style="font-size:18px;color:rgba(255,255,255,.25);">payments</span>
      <span style="font-size:11px;color:rgba(255,255,255,.25);">Próximamente: pago integrado (Mercado Pago / Stripe) en esta sección</span>
    </div>
  </div>
</div>

<style>
@media(max-width:520px){
  .ct-pv-lbl{display:none!important;}
  #ctPvBody{font-size:9pt!important;}
  #ctPreviewOverlay [style*="padding:36px 40px"]{padding:16px 12px!important;}
}
</style>`;

  document.body.appendChild(overlay);

  overlay.querySelector('#ctPv_close')?.addEventListener('click', () => overlay.remove());
  overlay.querySelector('#ctPv_print')?.addEventListener('click', () => {
    const html = _generarContratoHTML(contrato.proveedor || _proveedor, contrato);
    const win  = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 600);
  });
  overlay.querySelector('#ctPv_dl')?.addEventListener('click', () => {
    const html = _generarContratoHTML(contrato.proveedor || _proveedor, contrato);
    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `Contrato_${(contrato.empresaNombre || '').replace(/\s/g, '_')}_${contrato.vigenciaInicio || _today()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  });
  overlay.querySelector('#ctPv_link')?.addEventListener('click', () => {
    overlay.remove();
    _openModal(_linkModalHtml(contrato));
    _bindLinkModal(contrato);
  });

  _setupSigCanvas(overlay, contrato);
}

function _setupSigCanvas(overlay, contrato) {
  const canvas = overlay.querySelector('#ctSigCanvas');
  if (!canvas) return;
  const hint   = overlay.querySelector('#ctSigHint');
  const status = overlay.querySelector('#ctSigStatus');
  let drawing  = false;
  let hasMark  = false;

  function _resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    canvas.width  = Math.round(rect.width  * (window.devicePixelRatio || 1));
    canvas.height = Math.round(rect.height * (window.devicePixelRatio || 1));
    const ctx = canvas.getContext('2d');
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
  }
  setTimeout(_resize, 80);

  function _pos(e) {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  }

  function _start(e) {
    e.preventDefault();
    drawing = true;
    if (!hasMark) { hasMark = true; if (hint) hint.style.display = 'none'; }
    const p = _pos(e);
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function _move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = _pos(e);
    const ctx = canvas.getContext('2d');
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  function _end() { drawing = false; }

  canvas.addEventListener('mousedown',   _start);
  canvas.addEventListener('mousemove',   _move);
  canvas.addEventListener('mouseup',     _end);
  canvas.addEventListener('mouseleave',  _end);
  canvas.addEventListener('touchstart',  _start, { passive: false });
  canvas.addEventListener('touchmove',   _move,  { passive: false });
  canvas.addEventListener('touchend',    _end,   { passive: false });
  canvas.addEventListener('touchcancel', _end,   { passive: false });

  overlay.querySelector('#ctSigClear')?.addEventListener('click', () => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasMark = false;
    if (hint)   hint.style.display = 'flex';
    if (status) status.textContent = '';
  });

  overlay.querySelector('#ctSigSubmit')?.addEventListener('click', async () => {
    if (!hasMark) {
      if (status) { status.style.color = '#ef4444'; status.textContent = 'Dibuja tu firma antes de continuar.'; }
      return;
    }
    const sigData = canvas.toDataURL('image/png');
    const btn = overlay.querySelector('#ctSigSubmit');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;">hourglass_top</span>Guardando...'; }
    if (status) { status.style.color = '#6366f1'; status.textContent = 'Guardando firma…'; }
    try {
      await window._db.collection('contratos').doc(contrato.id).update({
        estado:       'firmado',
        firmaData:    sigData,
        fechaFirmado: firebase.firestore.FieldValue.serverTimestamp(),
      });
      const c = _contratos.find(x => x.id === contrato.id);
      if (c) { c.estado = 'firmado'; c.firmaData = sigData; }
      const emp = _empresas.find(e => e.id === _selectedId);
      if (emp?.ultimoContrato) emp.ultimoContrato.estado = 'firmado';
      overlay.remove();
      _toast('Contrato firmado exitosamente', 'ok');
      _render();
    } catch (err) {
      if (status) { status.style.color = '#ef4444'; status.textContent = 'Error: ' + err.message; }
      if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;">draw</span>Firmar contrato'; }
    }
  });
}

function _linkModalHtml(contrato) {
  const url = _getPublicUrl(contrato.id);
  const est = _estadoLabel(contrato.estado);
  return `
<div style="font-size:16px;font-weight:800;color:#fff;margin-bottom:3px;">Enlace del contrato</div>
<div style="font-size:12px;color:rgba(255,255,255,.3);margin-bottom:20px;">${_esc(contrato.empresaNombre || contrato.empresaId)}</div>

<div style="background:#0f1b2d;border:1px solid rgba(99,102,241,.25);border-radius:10px;padding:16px;margin-bottom:14px;">
  <div style="font-size:10px;font-weight:700;color:rgba(99,102,241,.7);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Enlace público</div>
  <div style="display:flex;gap:8px;align-items:center;">
    <input id="ctLinkUrl" value="${_esc(url)}" readonly
      style="flex:1;padding:8px 10px;background:#070d16;border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#a5b4fc;font-size:11px;font-family:monospace;outline:none;cursor:text;"/>
    <button id="ctCopyLink" class="ct-btn-primary" type="button" style="white-space:nowrap;padding:8px 14px;">
      <span class="material-symbols-outlined" style="font-size:14px;">content_copy</span>Copiar
    </button>
  </div>
  <div style="font-size:11px;color:rgba(255,255,255,.3);margin-top:10px;line-height:1.6;">
    Comparte este enlace con <strong style="color:rgba(255,255,255,.5);">${_esc(contrato.representante || 'el representante')}</strong>.
    Podrá ver el contrato y firmarlo digitalmente sin necesitar una cuenta.
  </div>
</div>

<div style="background:#0f1b2d;border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:14px 16px;margin-bottom:18px;">
  <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,.25);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Estado actual</div>
  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
    <span style="${_badgeStyle(est.color)}">${_esc(est.text)}</span>
    ${contrato.fechaVisto ? `<span style="font-size:11px;color:rgba(255,255,255,.3);">Visto ${_fmtDate(contrato.fechaVisto?.toDate ? contrato.fechaVisto.toDate() : new Date(contrato.fechaVisto))}</span>` : ''}
    ${contrato.estado === 'firmado' ? `<span style="font-size:11px;color:#34d399;display:flex;align-items:center;gap:4px;"><span class="material-symbols-outlined" style="font-size:13px;">verified</span>Firmado</span>` : ''}
  </div>
</div>

<div style="display:flex;gap:8px;flex-wrap:wrap;">
  <a href="${_esc(url)}" target="_blank" class="ct-btn-ghost" style="text-decoration:none;">
    <span class="material-symbols-outlined" style="font-size:14px;">open_in_new</span>Abrir enlace
  </a>
  ${contrato.estado !== 'enviado' && contrato.estado !== 'firmado' ? `
  <button id="ctMarkSent" class="ct-btn-success" type="button">
    <span class="material-symbols-outlined" style="font-size:14px;">send</span>Marcar como enviado
  </button>` : ''}
  <button id="ctLinkClose" class="ct-btn-ghost" type="button">Cerrar</button>
</div>`;
}

function _bindLinkModal(contrato) {
  const url = _getPublicUrl(contrato.id);

  _container?.querySelector('#ctCopyLink')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(url)
      .then(() => _toast('Enlace copiado', 'ok'))
      .catch(() => {
        const inp = _container?.querySelector('#ctLinkUrl');
        if (inp) { inp.select(); document.execCommand('copy'); }
        _toast('Enlace copiado', 'ok');
      });
  });

  _container?.querySelector('#ctLinkClose')?.addEventListener('click', _closeModal);

  _container?.querySelector('#ctMarkSent')?.addEventListener('click', async () => {
    try {
      await window._db.collection('contratos').doc(contrato.id).update({
        estado: 'enviado',
        fechaEnviado: firebase.firestore.FieldValue.serverTimestamp(),
      });
      const c = _contratos.find(x => x.id === contrato.id);
      if (c) c.estado = 'enviado';
      const emp = _empresas.find(e => e.id === _selectedId);
      if (emp?.ultimoContrato) emp.ultimoContrato.estado = 'enviado';
      _toast('Marcado como enviado', 'ok');
      _closeModal();
      _render();
    } catch (err) { _toast('Error: ' + err.message, 'error'); }
  });
}

// ── Contract HTML generator ───────────────────────────────

function _generarContratoHTML(prov, c) {
  const p        = prov || DEFAULT_PROVEEDOR;
  const fmtDate  = (str) => str
    ? new Date(str.length === 10 ? str + 'T12:00:00' : str)
        .toLocaleDateString('es-MX', { day:'2-digit', month:'long', year:'numeric' })
    : '—';
  const fechaIni  = fmtDate(c.vigenciaInicio);
  const fechaFin  = fmtDate(c.vigenciaFin);
  const tarifaFmt = new Intl.NumberFormat('es-MX', { style:'currency', currency: c.moneda || 'MXN' }).format(Number(c.tarifa) || 0);
  const periodo   = c.ciclo === 'anual' ? '12 meses' : '1 mes';

  const firmaSec = c.firmaData
    ? `<p>&#10003; <strong>Contrato firmado digitalmente</strong></p>
       <p>Firmante: ${c.representante} &lt;${c.email}&gt;</p>
       <p>Fecha: ${c.fechaFirmado ? new Date(c.fechaFirmado?.toDate ? c.fechaFirmado.toDate() : c.fechaFirmado).toLocaleString('es-MX') : '—'}</p>
       <img src="${c.firmaData}" alt="Firma digital" style="max-height:65px;margin-top:8px;display:block;"/>`
    : `<p>Fecha y hora: ____________________</p>
       <p>Firmante: ${c.representante} &lt;${c.email}&gt;</p>
       <p>M&eacute;todo: [ ] Firma digital &nbsp;&nbsp; [ ] FIEL &nbsp;&nbsp; [ ] Click-wrap</p>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Contrato SaaS &mdash; ${p.plataforma}</title>
<style>
  @page { size:letter; margin:2.5cm 2cm; }
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:Arial,'Helvetica Neue',sans-serif;color:#222;line-height:1.75;font-size:10.5pt;}
  .hdr{text-align:center;border-bottom:3px solid #1a3a6b;padding-bottom:18px;margin-bottom:28px;}
  .hdr h1{font-size:17pt;color:#1a3a6b;letter-spacing:.5px;}
  .hdr h2{font-size:11.5pt;color:#2e5fac;margin-top:4px;}
  .hdr .meta{font-size:8.5pt;color:#888;margin-top:8px;}
  h3{font-size:10.5pt;color:#1a3a6b;margin:20px 0 7px;border-bottom:1px solid #dde4ee;padding-bottom:3px;}
  p{margin:5px 0;text-align:justify;}
  .parties{display:flex;gap:20px;margin:12px 0;}
  .party{flex:1;background:#f4f7fb;border:1px solid #dde4ee;border-radius:6px;padding:11px 13px;}
  .party h4{margin:0 0 6px;color:#1a3a6b;font-size:9.5pt;}
  .party p{font-size:9pt;margin:2px 0;text-align:left;}
  .plan{background:#eef4ff;border:1px solid #c4d5f0;border-radius:6px;padding:11px 13px;margin:9px 0;}
  .plan .row{display:flex;justify-content:space-between;margin:2px 0;font-size:9pt;}
  .plan .lbl{color:#555;}
  .plan .val{font-weight:700;color:#1a3a6b;}
  .sigs{display:flex;gap:40px;margin-top:50px;page-break-inside:avoid;}
  .sig{flex:1;text-align:center;}
  .sigline{border-top:1px solid #333;margin-top:65px;padding-top:5px;font-size:9pt;color:#555;}
  .signame{font-weight:700;color:#1a3a6b;margin-top:3px;}
  .sigrole{font-size:8.5pt;color:#888;}
  .acept{background:#f0faf0;border:1px solid #b5ddb5;border-radius:6px;padding:11px 13px;margin-top:18px;page-break-inside:avoid;}
  .acept h4{color:#2a7a2a;margin:0 0 6px;font-size:9.5pt;}
  .acept p{font-size:9pt;color:#555;text-align:left;}
  .footer{text-align:center;font-size:8pt;color:#aaa;margin-top:32px;border-top:1px solid #ddd;padding-top:8px;}
  @media print{body{font-size:10pt;}}
</style>
</head>
<body>
<div class="hdr">
  <h1>CONTRATO DE LICENCIA Y SERVICIOS SaaS</h1>
  <h2>${p.plataforma}</h2>
  <div class="meta">Generado: ${fechaIni} &nbsp;|&nbsp; Vigencia hasta: ${fechaFin}</div>
</div>
<h3>IDENTIFICACI&Oacute;N DE LAS PARTES</h3>
<p>El presente Contrato de Licencia y Servicios SaaS se celebra entre:</p>
<div class="parties">
  <div class="party"><h4>EL PROVEEDOR</h4>
    <p><strong>${p.razonSocial}</strong></p>
    ${p.rfc ? `<p>RFC: ${p.rfc}</p>` : ''}
    <p>Domicilio: ${p.domicilio}</p>
    <p>Representante: ${p.representante} &mdash; ${p.cargo}</p>
    <p>Email: ${p.email}</p>
  </div>
  <div class="party"><h4>EL CLIENTE</h4>
    <p><strong>${c.empresaNombre}</strong></p>
    ${c.rfc ? `<p>RFC: ${c.rfc}</p>` : ''}
    ${c.domicilio ? `<p>Domicilio: ${c.domicilio}</p>` : ''}
    <p>Representante: ${c.representante}${c.cargo ? ` &mdash; ${c.cargo}` : ''}</p>
    <p>Email: ${c.email}</p>
  </div>
</div>
<h3>PLAN Y CONDICIONES ECON&Oacute;MICAS</h3>
<div class="plan">
  <div class="row"><span class="lbl">Plan:</span><span class="val">${c.plan}</span></div>
  <div class="row"><span class="lbl">Usuarios autorizados:</span><span class="val">${c.usuarios}</span></div>
  <div class="row"><span class="lbl">Almacenamiento:</span><span class="val">${c.almacenamiento} GB</span></div>
  <div class="row"><span class="lbl">Tarifa:</span><span class="val">${tarifaFmt} ${c.moneda} / ${c.ciclo}</span></div>
  <div class="row"><span class="lbl">Per&iacute;odo:</span><span class="val">${fechaIni} &mdash; ${fechaFin}</span></div>
  <div class="row"><span class="lbl">Plataforma:</span><span class="val">${p.urlPlataforma}</span></div>
</div>
${c.notas ? `<p><em><strong>Condiciones especiales:</strong> ${c.notas}</em></p>` : ''}
<h3>1. OBJETO</h3>
<p>El Proveedor otorga al Cliente una licencia de uso limitada, no exclusiva e intransferible para acceder a <strong>${p.plataforma}</strong> (${p.urlPlataforma}) durante el Per&iacute;odo de Suscripci&oacute;n, exclusivamente para sus fines comerciales internos. El Cliente no adquiere ning&uacute;n derecho de propiedad sobre el Software.</p>
<h3>2. DEFINICIONES</h3>
<p>&laquo;Usuarios Autorizados&raquo;: hasta ${c.usuarios} personas designadas por el Cliente. &laquo;Per&iacute;odo de Suscripci&oacute;n&raquo;: ${fechaIni} &mdash; ${fechaFin}, renovable autom&aacute;ticamente. &laquo;Datos del Cliente&raquo;: toda informaci&oacute;n cargada por el Cliente.</p>
<h3>3. TARIFAS Y FACTURACI&Oacute;N</h3>
<p>La tarifa del plan ${c.plan} es de ${tarifaFmt} ${c.moneda} por per&iacute;odo ${c.ciclo}, m&aacute;s IVA. El cobro es anticipado. El Proveedor emitir&aacute; CFDI dentro de los 5 d&iacute;as h&aacute;biles. En caso de mora, se aplicar&aacute;n intereses del 2% mensual y se podr&aacute; suspender el acceso tras 5 d&iacute;as de notificaci&oacute;n.</p>
<h3>4. VIGENCIA Y RENOVACI&Oacute;N</h3>
<p>El Contrato inicia el ${fechaIni} con una duraci&oacute;n de ${periodo}. Se renueva autom&aacute;ticamente salvo que cualquiera de las Partes notifique su intenci&oacute;n de no renovar con al menos 30 d&iacute;as de anticipaci&oacute;n.</p>
<h3>5. NIVEL DE SERVICIO (SLA)</h3>
<p>El Proveedor garantiza un Uptime mensual de al menos 99.5%. Cr&eacute;ditos por incumplimiento: 10% entre 99.0%&ndash;99.5%; 25% entre 95%&ndash;98.9%; 50% por debajo de 95%. Soporte disponible lunes a viernes 09:00&ndash;18:00 CST.</p>
<h3>6. SEGURIDAD Y PROTECCI&Oacute;N DE DATOS</h3>
<p>El Proveedor implementar&aacute; cifrado TLS 1.2+ en tr&aacute;nsito y en reposo. Realizar&aacute; backups diarios con retenci&oacute;n de 30 d&iacute;as. Notificar&aacute; brechas de seguridad en 72 horas. Ambas partes cumplir&aacute;n la LFPDPPP. Aviso de Privacidad: ${p.urlPrivacidad}.</p>
<h3>7. OBLIGACIONES DEL CLIENTE</h3>
<p>El Cliente se obliga a: pagar en tiempo y forma; no exceder ${c.usuarios} Usuarios Autorizados ni ${c.almacenamiento}&nbsp;GB; usar la Plataforma para fines l&iacute;citos; notificar accesos no autorizados de inmediato.</p>
<h3>8. USOS PROHIBIDOS</h3>
<p>El Cliente no podr&aacute;: realizar ingenier&iacute;a inversa; sublicenciar el acceso; almacenar contenido ilegal; usar bots o scraping masivo; intentar vulnerar la seguridad de la Plataforma.</p>
<h3>9. PROPIEDAD INTELECTUAL</h3>
<p>El Proveedor es titular exclusivo de la Plataforma y su c&oacute;digo. El Cliente es titular de sus Datos. El Proveedor solo usar&aacute; los Datos del Cliente para prestar el servicio contratado.</p>
<h3>10. CONFIDENCIALIDAD</h3>
<p>Cada Parte mantendr&aacute; en estricta confidencialidad la informaci&oacute;n no p&uacute;blica recibida de la otra. Esta obligaci&oacute;n subsistir&aacute; 3 a&ntilde;os despu&eacute;s de la terminaci&oacute;n.</p>
<h3>11. TERMINACI&Oacute;N</h3>
<p>Cualquiera de las Partes podr&aacute; terminar el Contrato si la otra incumple materialmente y no subsana en 30 d&iacute;as. Tras la terminaci&oacute;n, el Proveedor permitir&aacute; exportar datos durante 30 d&iacute;as en formato CSV/JSON.</p>
<h3>12. LIMITACI&Oacute;N DE RESPONSABILIDAD</h3>
<p style="font-variant:small-caps;">La responsabilidad total m&aacute;xima no exceder&aacute; el monto pagado en los 12 meses anteriores al evento. Ninguna Parte ser&aacute; responsable por da&ntilde;os indirectos o consecuentes.</p>
<h3>13. LEY APLICABLE</h3>
<p>Este Contrato se rige por las leyes de M&eacute;xico. Las controversias se resolver&aacute;n mediante negociaci&oacute;n directa (30 d&iacute;as) y, en su defecto, ante los tribunales de Le&oacute;n, Guanajuato.</p>
<h3>FIRMAS</h3>
<div class="sigs">
  <div class="sig">
    <div class="sigline">Firma del Proveedor</div>
    <div class="signame">${p.representante}</div>
    <div class="sigrole">${p.cargo} &mdash; ${p.razonSocial}</div>
  </div>
  <div class="sig">
    ${c.firmaData ? `<img src="${c.firmaData}" alt="Firma digital" style="max-height:60px;display:block;margin:0 auto 4px;"/>` : ''}
    <div class="sigline">Firma del Cliente</div>
    <div class="signame">${c.representante}</div>
    <div class="sigrole">${c.cargo ? c.cargo + ' &mdash; ' : ''}${c.empresaNombre}</div>
  </div>
</div>
<div class="acept">
  <h4>Registro de Aceptaci&oacute;n</h4>
  ${firmaSec}
</div>
<div class="footer">
  <p>Generado por ${p.plataforma} &nbsp;|&nbsp; Confidencial &nbsp;|&nbsp; ${fechaIni}</p>
</div>
</body>
</html>`;
}

// ── Utils ─────────────────────────────────────────────────

function _estadoLabel(estado) {
  if (!estado || estado === 'borrador') return { text: 'Borrador',  color: 'gray'  };
  if (estado === 'enviado')             return { text: 'Enviado',   color: 'blue'  };
  if (estado === 'visto')              return { text: 'Visto',     color: 'amber' };
  if (estado === 'firmado')            return { text: 'Firmado',   color: 'green' };
  return { text: estado, color: 'gray' };
}

function _badgeStyle(color) {
  const map = {
    green: 'display:inline-flex;align-items:center;font-size:10px;font-weight:800;padding:2px 8px;border-radius:5px;background:rgba(16,185,129,.12);color:#34d399;border:1px solid rgba(16,185,129,.2);',
    blue:  'display:inline-flex;align-items:center;font-size:10px;font-weight:800;padding:2px 8px;border-radius:5px;background:rgba(99,102,241,.12);color:#a5b4fc;border:1px solid rgba(99,102,241,.2);',
    amber: 'display:inline-flex;align-items:center;font-size:10px;font-weight:800;padding:2px 8px;border-radius:5px;background:rgba(245,158,11,.12);color:#fbbf24;border:1px solid rgba(245,158,11,.2);',
    red:   'display:inline-flex;align-items:center;font-size:10px;font-weight:800;padding:2px 8px;border-radius:5px;background:rgba(239,68,68,.12);color:#f87171;border:1px solid rgba(239,68,68,.2);',
    gray:  'display:inline-flex;align-items:center;font-size:10px;font-weight:800;padding:2px 8px;border-radius:5px;background:rgba(255,255,255,.06);color:rgba(255,255,255,.35);border:1px solid rgba(255,255,255,.1);',
  };
  return map[color] || map.gray;
}

function _fmtDate(d) {
  if (!d) return '—';
  const dt = typeof d === 'string'
    ? new Date(d.length === 10 ? d + 'T12:00:00' : d)
    : d;
  return dt.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function _fmtMonto(amount, moneda = 'MXN') {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: moneda }).format(amount);
}

function _today() {
  return new Date().toISOString().split('T')[0];
}

function _addMonths(dateStr, months) {
  const dt = new Date(dateStr + 'T12:00:00');
  dt.setMonth(dt.getMonth() + months);
  return dt.toISOString().split('T')[0];
}

function _randomToken() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function _getPublicUrl(token) {
  return window.location.origin + '/contrato-publico.html?token=' + encodeURIComponent(token);
}

function _skeleton() {
  return `<div style="padding:24px;display:flex;flex-direction:column;gap:14px;">
    <div style="height:28px;width:180px;background:rgba(255,255,255,.04);border-radius:8px;animation:skelPulse 1.4s ease-in-out infinite;"></div>
    <div style="height:160px;background:rgba(255,255,255,.04);border-radius:10px;animation:skelPulse 1.4s ease-in-out infinite;"></div>
    <style>@keyframes skelPulse{0%,100%{opacity:.4}50%{opacity:.9}}</style>
  </div>`;
}

function _toast(msg, type = 'ok') {
  const host = document.getElementById('ctToastHost');
  if (!host) return;
  const el   = document.createElement('div');
  const tone = type === 'error'
    ? 'background:#fee2e2;color:#7f1d1d;border:1px solid #fecaca;'
    : 'background:#d1fae5;color:#064e3b;border:1px solid #a7f3d0;';
  el.style.cssText = `pointer-events:auto;padding:10px 14px;border-radius:9px;font-size:13px;font-weight:600;max-width:320px;box-shadow:0 8px 20px rgba(0,0,0,.5);${tone}`;
  el.textContent   = msg;
  host.appendChild(el);
  setTimeout(() => { try { el.remove(); } catch {} }, 3500);
}

function _esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
