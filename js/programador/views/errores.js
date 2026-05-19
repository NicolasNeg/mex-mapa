// ═══════════════════════════════════════════════════════════
//  /js/programador/views/errores.js
//  Monitoreo de errores: eventos de error en bitácora +
//  errores capturados por error-tracking.js en Firestore.
// ═══════════════════════════════════════════════════════════

let _container = null;

export async function mount({ container }) {
  _container = container;
  container.innerHTML = _skeleton();

  const [firestoreErrors, bitacoraErrors] = await Promise.all([
    _loadFirestoreErrors(),
    _loadBitacoraErrors(),
  ]);

  if (_container) {
    _container.innerHTML = _html(firestoreErrors, bitacoraErrors);
    _bind();
  }
}

export function unmount() {
  _container = null;
}

// ── Queries ───────────────────────────────────────────────

async function _loadFirestoreErrors() {
  if (!window._db) return [];
  try {
    // Colección logs (error-tracking.js escribe aquí)
    const snap = await window._db.collection('logs')
      .where('level', 'in', ['error', 'ERROR', 'critical', 'CRITICAL'])
      .orderBy('timestamp', 'desc').limit(30).get();
    if (snap.docs.length) return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (_) {}
  // Fallback: buscar en logs sin filtro (puede no tener índice compuesto)
  try {
    const snap = await window._db.collection('logs').orderBy('timestamp', 'desc').limit(50).get();
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(l => /error|critical|fatal/i.test(l.level || l.tipo || l.accion || ''));
  } catch (_) { return []; }
}

async function _loadBitacoraErrors() {
  if (!window._db) return [];
  try {
    const snap = await window._db.collection('bitacora_gestion')
      .orderBy('timestamp', 'desc').limit(200).get();
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(l => /error|fail|excep/i.test(l.accion || l.tipo || l.descripcion || ''))
      .slice(0, 40);
  } catch (_) { return []; }
}

// ── Bind ──────────────────────────────────────────────────

function _bind() {
  _container?.querySelector('#errRefresh')?.addEventListener('click', async () => {
    _container.innerHTML = _skeleton();
    const [fe, be] = await Promise.all([_loadFirestoreErrors(), _loadBitacoraErrors()]);
    if (_container) { _container.innerHTML = _html(fe, be); _bind(); }
  });
}

// ── HTML ──────────────────────────────────────────────────

function _html(firestoreErrors, bitacoraErrors) {
  const total = firestoreErrors.length + bitacoraErrors.length;
  return `
<div style="padding:24px 28px;max-width:1200px;margin:0 auto;">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;gap:12px;flex-wrap:wrap;">
    <div>
      <h2 style="margin:0 0 4px;font-size:21px;font-weight:800;color:#fff;">Errores</h2>
      <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.3);">${total} evento${total!==1?'s':''} de error detectados</p>
    </div>
    <button id="errRefresh" type="button" style="display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:7px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);font-size:12px;font-family:Inter,sans-serif;font-weight:600;cursor:pointer;">
      <span class="material-symbols-outlined" style="font-size:15px;">refresh</span>Recargar
    </button>
  </div>

  <!-- Resumen de estado -->
  <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:18px;">
    ${_statCard('Errores en logs', firestoreErrors.length, firestoreErrors.length > 0 ? '#ef4444' : '#10b981')}
    ${_statCard('Errores en bitácora', bitacoraErrors.length, bitacoraErrors.length > 0 ? '#f59e0b' : '#10b981')}
    ${_statCard('window.__mexErrorLog', window.__mexErrorLog?.length || 0, window.__mexErrorLog?.length > 0 ? '#f59e0b' : '#10b981')}
  </div>

  <!-- Errores de la colección logs -->
  ${firestoreErrors.length ? `
  <div style="margin-bottom:18px;">
    <div style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">
      Colección: logs (level=error)
    </div>
    ${_errTable(firestoreErrors, ['timestamp','level','message','source','url'])}
  </div>` : ''}

  <!-- Errores de bitácora -->
  ${bitacoraErrors.length ? `
  <div style="margin-bottom:18px;">
    <div style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">
      Bitácora de gestión — eventos de error
    </div>
    ${_errTable(bitacoraErrors, ['timestamp','actor','accion','descripcion'])}
  </div>` : ''}

  <!-- Runtime errors -->
  ${window.__mexErrorLog?.length ? `
  <div>
    <div style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">
      Errores capturados en runtime (window.__mexErrorLog)
    </div>
    <div style="background:#0f1b2d;border:1px solid rgba(255,255,255,0.07);border-radius:10px;overflow:hidden;">
      ${window.__mexErrorLog.slice(0, 20).map(e => `
      <div style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:12px;">
        <div style="color:#f87171;font-weight:600;margin-bottom:3px;">${_esc(e.message || String(e))}</div>
        ${e.source ? `<div style="color:rgba(255,255,255,0.3);font-family:monospace;font-size:10px;">${_esc(e.source)}${e.lineno ? `:${e.lineno}` : ''}</div>` : ''}
      </div>`).join('')}
    </div>
  </div>` : ''}

  ${total === 0 && !window.__mexErrorLog?.length ? `
  <div style="padding:60px;text-align:center;color:rgba(255,255,255,0.2);">
    <span class="material-symbols-outlined" style="font-size:48px;display:block;margin-bottom:12px;color:rgba(16,185,129,0.3);">check_circle</span>
    <div style="font-size:14px;color:#10b981;font-weight:700;">Sin errores detectados</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.25);margin-top:6px;">Las colecciones logs y bitacora_gestion no muestran errores recientes.</div>
  </div>` : ''}
</div>`;
}

function _statCard(label, value, color) {
  return `<div style="background:#0f1b2d;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:14px 16px;">
    <div style="font-size:11px;color:rgba(255,255,255,0.4);font-weight:600;margin-bottom:6px;">${_esc(label)}</div>
    <div style="font-size:22px;font-weight:900;color:${_esc(color)};">${_esc(String(value))}</div>
  </div>`;
}

function _errTable(items, cols) {
  const colLabels = { timestamp:'Fecha', level:'Level', message:'Mensaje', source:'Fuente', url:'URL', actor:'Actor', accion:'Acción', descripcion:'Detalle' };
  return `<div style="background:#0f1b2d;border:1px solid rgba(255,255,255,0.07);border-radius:10px;overflow:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
      <thead>
        <tr style="background:#0a1220;">
          ${cols.map(c => `<th style="text-align:left;padding:9px 12px;font-size:10px;font-weight:700;text-transform:uppercase;color:rgba(255,255,255,0.3);white-space:nowrap;">${_esc(colLabels[c]||c)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${items.map(item => `<tr style="border-top:1px solid rgba(255,255,255,0.04);">
          ${cols.map(c => {
            let val = item[c] ?? '—';
            if (c === 'timestamp' || c === 'fecha') {
              try { val = (val?.toDate ? val.toDate() : new Date(val)).toLocaleString('es-MX'); } catch (_) {}
            }
            const isErr = c === 'message' || c === 'accion';
            return `<td style="padding:7px 12px;color:${isErr?'#f87171':'rgba(255,255,255,0.55)'};vertical-align:top;max-width:350px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(String(val))}</td>`;
          }).join('')}
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

function _skeleton() {
  return `<div style="padding:24px 28px;display:flex;flex-direction:column;gap:12px;">
    ${[...Array(3)].map(() => `<div style="height:80px;background:rgba(255,255,255,0.04);border-radius:10px;animation:skelPulse 1.4s ease-in-out infinite;"></div>`).join('')}
    <style>@keyframes skelPulse{0%,100%{opacity:.4}50%{opacity:.9}}</style>
  </div>`;
}

function _esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
