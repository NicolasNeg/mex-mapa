// ═══════════════════════════════════════════════════════════
//  /js/programador/views/metricas.js
//  Dashboard SaaS global — KPIs, MRR, tabla de empresas.
// ═══════════════════════════════════════════════════════════

let _container = null;

export async function mount({ container }) {
  _container = container;
  container.innerHTML = _skeleton();
  _load();
}

export function unmount() { _container = null; }

async function _load() {
  if (!window._db || !_container) return;
  try {
    const [empSnap, usrSnap, ctSnap] = await Promise.all([
      window._db.collection('empresas').get(),
      window._db.collection('usuarios').get(),
      window._db.collection('contratos').get(),
    ]);

    const empresas   = empSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const totalUsers = usrSnap.size;
    const contratos  = ctSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // MRR = sum of active contract tarifas normalized to monthly
    let mrr = 0;
    contratos.forEach(c => {
      if (c.estado === 'firmado' || c.estado === 'enviado' || c.estado === 'visto') {
        mrr += c.ciclo === 'anual' ? (Number(c.tarifa) || 0) / 12 : (Number(c.tarifa) || 0);
      }
    });
    const arr = mrr * 12;

    // Plan breakdown
    const byPlan = {};
    empresas.forEach(e => { const p = e.plan || 'free'; byPlan[p] = (byPlan[p] || 0) + 1; });

    // Empresas with active contract
    const empConContrato = new Set(contratos.filter(c => c.estado !== 'borrador').map(c => c.empresaId));
    const sinContrato = empresas.filter(e => !empConContrato.has(e.id)).length;

    // Errors last 24h
    let errores24h = 0;
    try {
      const errSnap = await window._db.collection('programmer_errors')
        .where('timestamp', '>=', Date.now() - 86400000).get();
      errores24h = errSnap.size;
    } catch {}

    // Empresa table: sort by plan tier then name
    const planOrder = { enterprise: 0, business: 1, starter: 2, free: 3 };
    const sorted = [...empresas].sort((a, b) => {
      const pa = planOrder[a.plan] ?? 4, pb = planOrder[b.plan] ?? 4;
      if (pa !== pb) return pa - pb;
      return (a.nombre || '').localeCompare(b.nombre || '');
    });

    const mrrFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(mrr);
    const arrFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(arr);

    if (!_container) return;
    _container.innerHTML = `
<div style="padding:24px 28px;max-width:1100px;">
  <h2 style="margin:0 0 4px;font-size:18px;font-weight:800;color:#fff;">Métricas SaaS</h2>
  <p style="margin:0 0 24px;font-size:12px;color:rgba(255,255,255,.3);">Snapshot en tiempo real del estado del negocio</p>

  <!-- KPI grid -->
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:28px;">
    ${_kpi('💰', mrrFmt, 'MRR estimado', '#34d399')}
    ${_kpi('📈', arrFmt, 'ARR estimado', '#a5b4fc')}
    ${_kpi('🏢', empresas.length, 'Empresas totales', '#fff')}
    ${_kpi('✅', empConContrato.size, 'Con contrato activo', '#34d399')}
    ${_kpi('⚠️', sinContrato, 'Sin contrato', sinContrato > 0 ? '#fbbf24' : '#fff')}
    ${_kpi('👥', totalUsers, 'Usuarios totales', '#fff')}
    ${_kpi('🔴', errores24h, 'Errores 24 h', errores24h > 5 ? '#f87171' : '#fff')}
  </div>

  <!-- Plan breakdown -->
  <div style="background:#0f1b2d;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:18px 20px;margin-bottom:24px;">
    <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:rgba(99,102,241,.65);margin-bottom:14px;">Distribución por plan</div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;">
      ${['enterprise','business','starter','free'].map(p => {
        const count = byPlan[p] || 0;
        const colors = { enterprise:'#059669', business:'#6366f1', starter:'#d97706', free:'#475569' };
        return `<div style="display:flex;align-items:center;gap:8px;">
          <div style="width:10px;height:10px;border-radius:2px;background:${colors[p]};flex-shrink:0;"></div>
          <span style="font-size:13px;color:rgba(255,255,255,.7);text-transform:capitalize;">${_esc(p)}</span>
          <span style="font-size:13px;font-weight:800;color:#fff;">${count}</span>
        </div>`;
      }).join('')}
    </div>
  </div>

  <!-- Empresas table -->
  <div style="background:#0f1b2d;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:18px 20px;overflow-x:auto;">
    <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:rgba(99,102,241,.65);margin-bottom:14px;">Empresas</div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:600px;">
      <thead>
        <tr style="color:rgba(255,255,255,.25);">
          <th style="text-align:left;padding:0 12px 8px 0;font-size:10px;text-transform:uppercase;">Empresa</th>
          <th style="text-align:left;padding:0 12px 8px;font-size:10px;text-transform:uppercase;">Plan</th>
          <th style="text-align:left;padding:0 12px 8px;font-size:10px;text-transform:uppercase;">Contrato</th>
          <th style="text-align:left;padding:0 12px 8px;font-size:10px;text-transform:uppercase;">Tarifa/mes</th>
          <th style="text-align:left;padding:0 12px 8px;font-size:10px;text-transform:uppercase;">Facturación</th>
          <th style="text-align:left;padding:0 0 8px;font-size:10px;text-transform:uppercase;"></th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(e => {
          const ct = contratos.filter(c => c.empresaId === e.id)
            .sort((a, b) => (b.fechaGenerado?.toMillis?.() || 0) - (a.fechaGenerado?.toMillis?.() || 0))[0];
          const ctEstado = ct ? ct.estado : null;
          const f = e.facturacion || {};
          const tarifa = f.tarifa
            ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: f.moneda || 'MXN' }).format(Number(f.tarifa))
            : ct?.tarifa
              ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: ct.moneda || 'MXN' }).format(Number(ct.tarifa))
              : '—';
          const { badge: payBadge, style: payStyle } = _payBadge(f.proximoPago);
          return `<tr style="border-top:1px solid rgba(255,255,255,.04);">
            <td style="padding:9px 12px 9px 0;color:rgba(255,255,255,.75);">
              <a data-prog-route="/programador/empresa/${_esc(e.id)}/datos" href="#"
                 style="color:inherit;text-decoration:none;font-weight:600;">${_esc(e.nombre || e.id)}</a>
              <div style="font-size:10px;color:rgba(255,255,255,.25);font-family:monospace;">${_esc(e.id)}</div>
            </td>
            <td style="padding:9px 12px;">${_planBadge(e.plan)}</td>
            <td style="padding:9px 12px;">${_ctBadge(ctEstado)}</td>
            <td style="padding:9px 12px;color:rgba(255,255,255,.6);">${_esc(tarifa)}</td>
            <td style="padding:9px 12px;"><span style="${payStyle}">${payBadge}</span></td>
            <td style="padding:9px 0;">
              <a data-prog-route="/programador/empresa/${_esc(e.id)}/datos" href="#"
                 style="font-size:11px;color:#818cf8;text-decoration:none;">Ver →</a>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>
</div>

<div id="metToastHost" style="position:fixed;bottom:20px;right:20px;z-index:400;display:flex;flex-direction:column;gap:8px;pointer-events:none;"></div>`;

  } catch (err) {
    if (_container) _container.innerHTML = `<div style="padding:40px;color:#f87171;font-size:13px;">Error: ${_esc(err.message)}</div>`;
  }
}

function _kpi(icon, value, label, color) {
  return `<div style="background:#0f1b2d;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:16px 18px;">
    <div style="font-size:22px;line-height:1;margin-bottom:8px;">${icon}</div>
    <div style="font-size:22px;font-weight:900;color:${_esc(color || '#fff')};line-height:1.2;margin-bottom:3px;">${_esc(String(value))}</div>
    <div style="font-size:11px;color:rgba(255,255,255,.3);">${_esc(label)}</div>
  </div>`;
}

function _planBadge(plan) {
  const p = String(plan || 'free').toLowerCase();
  const bg = { starter: '#d97706', business: '#6366f1', enterprise: '#059669', free: '#334155' }[p] || '#334155';
  return `<span style="font-size:10px;font-weight:800;text-transform:uppercase;border-radius:5px;padding:2px 7px;background:${bg};color:#fff;">${_esc(plan || 'free')}</span>`;
}

function _ctBadge(estado) {
  if (!estado) return `<span style="font-size:10px;color:rgba(255,255,255,.2);">—</span>`;
  const map = {
    borrador: ['Borrador',  'rgba(255,255,255,.06)', 'rgba(255,255,255,.35)', 'rgba(255,255,255,.1)'],
    enviado:  ['Enviado',   'rgba(99,102,241,.12)',  '#a5b4fc',              'rgba(99,102,241,.2)'],
    visto:    ['Visto',     'rgba(245,158,11,.12)', '#fbbf24',              'rgba(245,158,11,.2)'],
    firmado:  ['Firmado',   'rgba(16,185,129,.12)', '#34d399',              'rgba(16,185,129,.2)'],
  };
  const [t, bg, c, border] = map[estado] || map.borrador;
  return `<span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:5px;background:${bg};color:${c};border:1px solid ${border};">${t}</span>`;
}

function _payBadge(proximoPago) {
  if (!proximoPago) return { badge: '—', style: 'color:rgba(255,255,255,.2);font-size:11px;' };
  const diff = Math.floor((new Date(proximoPago + 'T12:00:00') - new Date()) / 86400000);
  if (diff < 0)  return { badge: '⚠ Vencido',    style: 'font-size:11px;font-weight:700;color:#f87171;' };
  if (diff <= 7) return { badge: '⚡ ' + diff + 'd', style: 'font-size:11px;font-weight:700;color:#fbbf24;' };
  return { badge: '✓ ' + diff + 'd', style: 'font-size:11px;color:#34d399;' };
}

function _skeleton() {
  return `<div style="padding:24px 28px;display:flex;flex-direction:column;gap:14px;">
    <div style="height:26px;width:200px;background:rgba(255,255,255,.04);border-radius:8px;animation:skelPulse 1.4s ease-in-out infinite;"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;">
      ${Array(7).fill(0).map(() => `<div style="height:90px;background:rgba(255,255,255,.04);border-radius:12px;animation:skelPulse 1.4s ease-in-out infinite;"></div>`).join('')}
    </div>
    <div style="height:200px;background:rgba(255,255,255,.04);border-radius:12px;animation:skelPulse 1.4s ease-in-out infinite;"></div>
    <style>@keyframes skelPulse{0%,100%{opacity:.4}50%{opacity:.9}}</style>
  </div>`;
}

function _esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
