// ═══════════════════════════════════════════════════════════
//  /js/programador/views/logs.js
//  Bitácora de gestión — queries sobre bitacora_gestion
// ═══════════════════════════════════════════════════════════

let _container  = null;
let _logs       = [];
let _lastDoc    = null;
let _filterEmpresa = '';
let _filterAccion  = '';
let _loading    = false;
const PAGE_SIZE = 50;

export async function mount({ container }) {
  _container     = container;
  _logs          = [];
  _lastDoc       = null;
  _filterEmpresa = '';
  _filterAccion  = '';

  _renderShell();
  await _loadPage(true);
  _bind();
}

export function unmount() {
  _container  = null;
  _logs       = [];
  _lastDoc    = null;
}

// ── Query ─────────────────────────────────────────────────

async function _loadPage(reset = false) {
  if (_loading || !window._db) return;
  _loading = true;
  if (reset) { _logs = []; _lastDoc = null; }

  const moreBtn = _container?.querySelector('#logsLoadMore');
  if (moreBtn) { moreBtn.disabled = true; moreBtn.textContent = 'Cargando…'; }

  try {
    let q = window._db.collection('bitacora_gestion').orderBy('timestamp', 'desc').limit(PAGE_SIZE);
    if (_filterEmpresa) q = q.where('empresaId', '==', _filterEmpresa);
    if (_lastDoc) q = q.startAfter(_lastDoc);

    const snap = await q.get();
    const newLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _logs.push(...newLogs);
    _lastDoc = snap.docs[snap.docs.length - 1] || null;

    _renderRows(reset);

    if (moreBtn) {
      moreBtn.disabled = false;
      moreBtn.textContent = snap.docs.length < PAGE_SIZE ? 'No hay más registros' : 'Cargar más';
      moreBtn.disabled = snap.docs.length < PAGE_SIZE;
    }
  } catch (err) {
    const tbody = _container?.querySelector('#logsTbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="padding:16px;color:#f87171;font-size:12px;">Error: ${_esc(err.message)}</td></tr>`;
  } finally {
    _loading = false;
  }
}

// ── Bind ──────────────────────────────────────────────────

function _bind() {
  _container?.querySelector('#logsLoadMore')?.addEventListener('click', () => _loadPage(false));

  _container?.querySelector('#logsSearchAccion')?.addEventListener('input', e => {
    _filterAccion = e.target.value.toLowerCase().trim();
    _renderRows(false, true);
  });

  _container?.querySelector('#logsRefresh')?.addEventListener('click', async () => {
    await _loadPage(true);
  });
}

// ── Render ────────────────────────────────────────────────

function _renderShell() {
  if (!_container) return;
  _container.innerHTML = `
<div style="padding:24px 28px;max-width:1300px;margin:0 auto;">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;gap:12px;flex-wrap:wrap;">
    <div>
      <h2 style="margin:0 0 4px;font-size:21px;font-weight:800;color:#fff;">Logs del Sistema</h2>
      <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.3);">Bitácora de gestión — colección bitacora_gestion</p>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <div style="position:relative;">
        <span class="material-symbols-outlined" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:15px;color:rgba(255,255,255,0.3);pointer-events:none;">search</span>
        <input id="logsSearchAccion" type="text" placeholder="Filtrar por acción…" style="padding:7px 10px 7px 30px;background:#0f1b2d;border:1px solid rgba(255,255,255,0.1);border-radius:7px;color:#fff;font-size:12px;font-family:Inter,sans-serif;outline:none;width:200px;"/>
      </div>
      <button id="logsRefresh" type="button" style="display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:7px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);font-size:12px;font-family:Inter,sans-serif;font-weight:600;cursor:pointer;">
        <span class="material-symbols-outlined" style="font-size:15px;">refresh</span>Recargar
      </button>
    </div>
  </div>

  <div style="background:#0f1b2d;border:1px solid rgba(255,255,255,0.07);border-radius:12px;overflow:hidden;">
    <div style="overflow:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="background:#0a1220;">
            <th style="${_th()}">Fecha</th>
            <th style="${_th()}">Actor</th>
            <th style="${_th()}">Acción</th>
            <th style="${_th()}">Entidad</th>
            <th style="${_th()}width:auto;">Descripción / Detalle</th>
          </tr>
        </thead>
        <tbody id="logsTbody">
          <tr><td colspan="5" style="padding:20px;text-align:center;color:rgba(255,255,255,0.2);">Cargando…</td></tr>
        </tbody>
      </table>
    </div>
    <div style="padding:12px 16px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
      <button id="logsLoadMore" type="button" style="padding:7px 16px;border-radius:7px;background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.25);color:#a5b4fc;font-size:12px;font-family:Inter,sans-serif;font-weight:600;cursor:pointer;">Cargar más</button>
    </div>
  </div>
</div>`;
}

function _renderRows(reset, filterOnly = false) {
  const tbody = _container?.querySelector('#logsTbody');
  if (!tbody) return;

  const visible = _filterAccion
    ? _logs.filter(l => String(l.accion || l.tipo || '').toLowerCase().includes(_filterAccion))
    : _logs;

  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:20px;text-align:center;color:rgba(255,255,255,0.2);">Sin registros</td></tr>`;
    return;
  }

  tbody.innerHTML = visible.map(log => {
    const isError = /error|fail/i.test(log.accion || log.tipo || '');
    return `<tr style="border-top:1px solid rgba(255,255,255,0.04);">
      <td style="${_td()}white-space:nowrap;font-family:monospace;font-size:10px;color:rgba(255,255,255,0.3);">${_formatDate(log.timestamp || log.fecha)}</td>
      <td style="${_td()}max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(log.actor || log.usuario || '—')}</td>
      <td style="${_td()}white-space:nowrap;"><span style="color:${isError?'#f87171':'#a5b4fc'};font-weight:700;">${_esc(log.accion || log.tipo || '—')}</span></td>
      <td style="${_td()}white-space:nowrap;color:rgba(255,255,255,0.4);">${_esc(log.entidad || '—')}</td>
      <td style="${_td()}max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(255,255,255,0.5);">${_esc(log.descripcion || log.detalles || log.referencia || '')}</td>
    </tr>`;
  }).join('');
}

function _formatDate(ts) {
  if (!ts) return '—';
  try {
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('es-MX', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
  } catch (_) { return String(ts).slice(0, 16); }
}

function _th() { return 'text-align:left;padding:10px 12px;font-size:10px;font-weight:700;text-transform:uppercase;color:rgba(255,255,255,0.3);letter-spacing:.04em;white-space:nowrap;'; }
function _td() { return 'padding:8px 12px;vertical-align:middle;color:rgba(255,255,255,0.65);'; }

function _esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
