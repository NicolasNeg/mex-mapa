// ═══════════════════════════════════════════════════════════
//  /js/programador/views/facturacion-global.js
//  Vista global de cobranza SaaS — semáforo de pagos.
// ═══════════════════════════════════════════════════════════

let _container = null;
let _empresas  = [];
let _filter    = 'todas'; // todas | corriente | por-vencer | vencidas | sin-fecha

export async function mount({ container }) {
  _container = container;
  container.innerHTML = _skeleton();
  await _load();
}

export function unmount() { _container = null; _empresas = []; _filter = 'todas'; }

async function _load() {
  if (!window._db || !_container) return;
  try {
    const snap = await window._db.collection('empresas').orderBy('nombre').get();
    _empresas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _render();
  } catch (err) {
    if (_container) _container.innerHTML = `<div style="padding:40px;color:#f87171;font-size:13px;">Error: ${_esc(err.message)}</div>`;
  }
}

function _pagoStatus(proximoPago) {
  if (!proximoPago) return 'sin-fecha';
  const diff = Math.floor((new Date(proximoPago + 'T12:00:00') - new Date()) / 86400000);
  if (diff < 0)  return 'vencidas';
  if (diff <= 7) return 'por-vencer';
  return 'corriente';
}

function _render() {
  if (!_container) return;
  const filtered = _filter === 'todas'
    ? _empresas
    : _empresas.filter(e => _pagoStatus(e.facturacion?.proximoPago) === _filter);

  const counts = {
    'todas':      _empresas.length,
    'corriente':  _empresas.filter(e => _pagoStatus(e.facturacion?.proximoPago) === 'corriente').length,
    'por-vencer': _empresas.filter(e => _pagoStatus(e.facturacion?.proximoPago) === 'por-vencer').length,
    'vencidas':   _empresas.filter(e => _pagoStatus(e.facturacion?.proximoPago) === 'vencidas').length,
    'sin-fecha':  _empresas.filter(e => _pagoStatus(e.facturacion?.proximoPago) === 'sin-fecha').length,
  };

  _container.innerHTML = `
<div style="padding:24px 28px;max-width:1100px;">
  <h2 style="margin:0 0 4px;font-size:18px;font-weight:800;color:#fff;">Facturación</h2>
  <p style="margin:0 0 20px;font-size:12px;color:rgba(255,255,255,.3);">Estado de pagos y cobranza de todas las empresas</p>

  <!-- Summary chips -->
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:24px;">
    ${_sumChip('🟢 Al corriente', counts.corriente, '#34d399', 'corriente')}
    ${_sumChip('⚡ Por vencer', counts['por-vencer'], '#fbbf24', 'por-vencer')}
    ${_sumChip('🔴 Vencidos', counts.vencidas, '#f87171', 'vencidas')}
    ${_sumChip('⚪ Sin fecha', counts['sin-fecha'], 'rgba(255,255,255,.3)', 'sin-fecha')}
  </div>

  <!-- Filter tabs -->
  <div style="display:flex;gap:2px;margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,.07);padding-bottom:0;">
    ${[['todas','Todas'],['corriente','Al corriente'],['por-vencer','Por vencer'],['vencidas','Vencidas'],['sin-fecha','Sin fecha']].map(([k, l]) => `
    <button data-fact-filter="${_esc(k)}" type="button" class="fact-filter-btn ${k === _filter ? 'fact-filter-active' : ''}"
      style="padding:8px 12px;border:none;background:transparent;font-size:12px;font-family:Inter,sans-serif;font-weight:600;cursor:pointer;border-bottom:2px solid ${k === _filter ? '#6366f1' : 'transparent'};color:${k === _filter ? '#a5b4fc' : 'rgba(255,255,255,.38)'};margin-bottom:-1px;white-space:nowrap;">
      ${_esc(l)} <span style="font-size:10px;">(${counts[k] || 0})</span>
    </button>`).join('')}
  </div>

  <!-- Export CSV button -->
  <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
    <button id="factExportCSV" type="button" style="padding:6px 12px;border-radius:7px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.5);font-size:11px;font-family:Inter,sans-serif;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:5px;">
      <span class="material-symbols-outlined" style="font-size:14px;">download</span>Exportar CSV
    </button>
  </div>

  <!-- Table -->
  <div style="background:#0f1b2d;border:1px solid rgba(255,255,255,.07);border-radius:12px;overflow:hidden;">
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:700px;">
        <thead>
          <tr style="background:rgba(255,255,255,.02);color:rgba(255,255,255,.25);">
            <th style="text-align:left;padding:11px 12px;font-size:10px;text-transform:uppercase;">Empresa</th>
            <th style="text-align:left;padding:11px 12px;font-size:10px;text-transform:uppercase;">Plan</th>
            <th style="text-align:left;padding:11px 12px;font-size:10px;text-transform:uppercase;">Tarifa</th>
            <th style="text-align:left;padding:11px 12px;font-size:10px;text-transform:uppercase;">Ciclo</th>
            <th style="text-align:left;padding:11px 12px;font-size:10px;text-transform:uppercase;">Próx. pago</th>
            <th style="text-align:left;padding:11px 12px;font-size:10px;text-transform:uppercase;">Estado</th>
            <th style="text-align:left;padding:11px 12px;font-size:10px;text-transform:uppercase;">Método</th>
            <th style="text-align:left;padding:11px 12px;font-size:10px;text-transform:uppercase;"></th>
          </tr>
        </thead>
        <tbody>
          ${filtered.length ? filtered.map(e => {
            const f = e.facturacion || {};
            const st = _pagoStatus(f.proximoPago);
            const { icon, color } = { corriente: { icon:'✓', color:'#34d399' }, 'por-vencer': { icon:'⚡', color:'#fbbf24' }, vencidas: { icon:'⚠', color:'#f87171' }, 'sin-fecha': { icon:'—', color:'rgba(255,255,255,.2)' } }[st];
            const tarifa = f.tarifa
              ? new Intl.NumberFormat('es-MX', { style:'currency', currency: f.moneda||'MXN' }).format(Number(f.tarifa))
              : '—';
            const proxPago = f.proximoPago ? _fmtDate(f.proximoPago) : '—';
            const diff = f.proximoPago
              ? Math.floor((new Date(f.proximoPago + 'T12:00:00') - new Date()) / 86400000)
              : null;
            return `<tr style="border-top:1px solid rgba(255,255,255,.04);" data-empresa-id="${_esc(e.id)}">
              <td style="padding:11px 12px;color:rgba(255,255,255,.8);">
                <a data-prog-route="/programador/empresa/${_esc(e.id)}/facturacion" href="#"
                   style="font-weight:700;color:rgba(255,255,255,.85);text-decoration:none;">${_esc(e.nombre || e.id)}</a>
                <div style="font-size:10px;color:rgba(255,255,255,.2);font-family:monospace;">${_esc(e.id)}</div>
              </td>
              <td style="padding:11px 12px;">${_planBadge(e.plan)}</td>
              <td style="padding:11px 12px;font-family:monospace;color:rgba(255,255,255,.6);">${_esc(tarifa)}</td>
              <td style="padding:11px 12px;color:rgba(255,255,255,.4);text-transform:capitalize;">${_esc(f.ciclo||'—')}</td>
              <td style="padding:11px 12px;color:rgba(255,255,255,.5);">
                ${proxPago}
                ${diff !== null ? `<span style="font-size:10px;color:${color};margin-left:5px;">${diff < 0 ? diff+'d' : '+'+diff+'d'}</span>` : ''}
              </td>
              <td style="padding:11px 12px;">
                <span style="color:${color};font-size:12px;font-weight:700;">${icon} ${st === 'sin-fecha' ? 'Sin fecha' : st === 'corriente' ? 'Corriente' : st === 'por-vencer' ? 'Por vencer' : 'Vencido'}</span>
              </td>
              <td style="padding:11px 12px;color:rgba(255,255,255,.3);">${_esc(f.metodoPago||'—')}</td>
              <td style="padding:11px 12px;">
                <button data-reg-pago="${_esc(e.id)}" type="button"
                  style="padding:5px 10px;border-radius:6px;background:#6366f1;color:#fff;border:none;font-size:11px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;white-space:nowrap;">
                  + Pago
                </button>
              </td>
            </tr>`;
          }).join('') : `<tr><td colspan="8" style="padding:28px;text-align:center;color:rgba(255,255,255,.2);font-size:13px;">Sin empresas para este filtro</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- Pago rápido modal -->
<div id="factPagoModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:800;align-items:center;justify-content:center;padding:16px;">
  <div style="background:#0a1220;border:1px solid rgba(255,255,255,.1);border-radius:16px;max-width:480px;width:100%;padding:24px;">
    <div style="font-size:15px;font-weight:800;color:#fff;margin-bottom:4px;">Registrar pago</div>
    <div id="factPagoEmpNombre" style="font-size:12px;color:rgba(255,255,255,.3);margin-bottom:16px;"></div>
    <form id="factPagoForm" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div><label style="display:block;font-size:10px;font-weight:700;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Monto</label>
        <input name="monto" type="number" min="0" step="0.01" placeholder="0.00" required
          style="width:100%;padding:8px 10px;background:#070d16;border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;font-size:12px;font-family:Inter,sans-serif;outline:none;"/></div>
      <div><label style="display:block;font-size:10px;font-weight:700;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Moneda</label>
        <select name="moneda" style="width:100%;padding:8px 10px;background:#070d16;border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;font-size:12px;font-family:Inter,sans-serif;outline:none;">
          <option value="MXN">MXN</option><option value="USD">USD</option></select></div>
      <div><label style="display:block;font-size:10px;font-weight:700;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Fecha</label>
        <input name="fecha" type="date" required
          style="width:100%;padding:8px 10px;background:#070d16;border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;font-size:12px;font-family:Inter,sans-serif;outline:none;"/></div>
      <div><label style="display:block;font-size:10px;font-weight:700;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Método</label>
        <select name="metodo" style="width:100%;padding:8px 10px;background:#070d16;border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;font-size:12px;font-family:Inter,sans-serif;outline:none;">
          ${['Transferencia','Tarjeta','Efectivo','Cheque','SPEI','Otro'].map(m=>`<option>${_esc(m)}</option>`).join('')}</select></div>
      <div style="grid-column:1/-1;"><label style="display:block;font-size:10px;font-weight:700;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Notas</label>
        <input name="notas" placeholder="Referencia, folio…"
          style="width:100%;padding:8px 10px;background:#070d16;border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;font-size:12px;font-family:Inter,sans-serif;outline:none;"/></div>
      <div style="grid-column:1/-1;display:flex;gap:8px;margin-top:4px;">
        <button type="submit" style="padding:9px 18px;border-radius:8px;background:#6366f1;color:#fff;border:none;font-size:13px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;">Guardar</button>
        <button type="button" id="factPagoClose" style="padding:9px 14px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.5);font-size:13px;font-family:Inter,sans-serif;cursor:pointer;">Cancelar</button>
      </div>
    </form>
  </div>
</div>

<div id="factToastHost" style="position:fixed;bottom:20px;right:20px;z-index:900;display:flex;flex-direction:column;gap:8px;pointer-events:none;"></div>`;

  _bind(filtered);
}

function _bind(filtered) {
  if (!_container) return;

  // Filters
  _container.querySelectorAll('[data-fact-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      _filter = btn.dataset.factFilter;
      _render();
    });
  });

  // Export CSV
  _container.querySelector('#factExportCSV')?.addEventListener('click', () => {
    const rows = [['ID','Nombre','Plan','Tarifa','Moneda','Ciclo','Prox Pago','Estado','Metodo']];
    filtered.forEach(e => {
      const f = e.facturacion || {};
      rows.push([e.id, e.nombre||'', e.plan||'', f.tarifa||'', f.moneda||'MXN', f.ciclo||'', f.proximoPago||'', _pagoStatus(f.proximoPago), f.metodoPago||'']);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'facturacion_' + new Date().toISOString().split('T')[0] + '.csv';
    a.click(); URL.revokeObjectURL(url);
  });

  // Quick pay modal
  const modal = _container.querySelector('#factPagoModal');
  const pagoForm = _container.querySelector('#factPagoForm');
  let _activeEmpresaId = null;

  _container.querySelectorAll('[data-reg-pago]').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeEmpresaId = btn.dataset.regPago;
      const emp = _empresas.find(e => e.id === _activeEmpresaId);
      const nameEl = _container?.querySelector('#factPagoEmpNombre');
      if (nameEl) nameEl.textContent = emp?.nombre || _activeEmpresaId;
      if (pagoForm) {
        pagoForm.fecha.value = new Date().toISOString().split('T')[0];
        pagoForm.monto.value = '';
        pagoForm.notas.value = '';
      }
      if (modal) modal.style.display = 'flex';
    });
  });

  _container.querySelector('#factPagoClose')?.addEventListener('click', () => {
    if (modal) modal.style.display = 'none';
  });
  modal?.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });

  if (pagoForm) {
    pagoForm.addEventListener('submit', async e => {
      e.preventDefault();
      if (!_activeEmpresaId || !window._db) return;
      const btn = pagoForm.querySelector('[type=submit]');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await window._db.collection('empresas').doc(_activeEmpresaId).collection('pagos').add({
          monto:     Number(pagoForm.monto.value) || 0,
          moneda:    pagoForm.moneda.value,
          fecha:     pagoForm.fecha.value,
          metodo:    pagoForm.metodo.value,
          notas:     pagoForm.notas.value.trim(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        if (modal) modal.style.display = 'none';
        _toast('Pago registrado', 'ok');
      } catch (err) { _toast('Error: ' + err.message, 'error'); }
      finally { btn.disabled = false; btn.textContent = 'Guardar'; }
    });
  }
}

function _sumChip(label, count, color, key) {
  return `<div style="background:#0f1b2d;border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:14px 16px;cursor:pointer;" onclick="document.querySelector('[data-fact-filter=${key}]')?.click()">
    <div style="font-size:20px;font-weight:900;color:${_esc(color)};margin-bottom:3px;">${count}</div>
    <div style="font-size:11px;color:rgba(255,255,255,.35);">${_esc(label)}</div>
  </div>`;
}

function _planBadge(plan) {
  const p = String(plan || 'free').toLowerCase();
  const bg = { starter:'#d97706', business:'#6366f1', enterprise:'#059669', free:'#334155' }[p] || '#334155';
  return `<span style="font-size:10px;font-weight:800;text-transform:uppercase;border-radius:5px;padding:2px 7px;background:${bg};color:#fff;">${_esc(plan || 'free')}</span>`;
}

function _fmtDate(s) {
  try { return new Date(s + 'T12:00:00').toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' }); }
  catch { return s; }
}

function _skeleton() {
  return `<div style="padding:24px 28px;display:flex;flex-direction:column;gap:14px;">
    <div style="height:26px;width:200px;background:rgba(255,255,255,.04);border-radius:8px;animation:skelPulse 1.4s ease-in-out infinite;"></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">
      ${Array(4).fill(0).map(() => `<div style="height:72px;background:rgba(255,255,255,.04);border-radius:10px;animation:skelPulse 1.4s ease-in-out infinite;"></div>`).join('')}
    </div>
    <div style="height:300px;background:rgba(255,255,255,.04);border-radius:12px;animation:skelPulse 1.4s ease-in-out infinite;"></div>
    <style>@keyframes skelPulse{0%,100%{opacity:.4}50%{opacity:.9}}</style>
  </div>`;
}

function _toast(msg, type = 'ok') {
  const host = document.getElementById('factToastHost');
  if (!host) return;
  const el = document.createElement('div');
  const tone = type === 'error'
    ? 'background:#fee2e2;color:#7f1d1d;border:1px solid #fecaca;'
    : 'background:#d1fae5;color:#064e3b;border:1px solid #a7f3d0;';
  el.style.cssText = `pointer-events:auto;padding:10px 14px;border-radius:9px;font-size:13px;font-weight:600;max-width:320px;box-shadow:0 8px 20px rgba(0,0,0,.5);${tone}`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { try { el.remove(); } catch {} }, 3500);
}

function _esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
