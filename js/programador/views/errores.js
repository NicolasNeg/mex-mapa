// ═══════════════════════════════════════════════════════════
//  /js/programador/views/errores.js
//  Monitoreo de errores — colección error_logs (via error-logger.js)
// ═══════════════════════════════════════════════════════════

const CAT_META = {
  APP:       { label: 'App',       color: '#ef4444', bg: 'rgba(239,68,68,0.12)',     icon: 'bug_report'     },
  SERVER:    { label: 'Servidor',  color: '#f97316', bg: 'rgba(249,115,22,0.12)',    icon: 'dns'            },
  USER:      { label: 'Usuario',   color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',    icon: 'person_alert'   },
  NETWORK:   { label: 'Red',       color: '#6366f1', bg: 'rgba(99,102,241,0.12)',    icon: 'wifi_off'       },
  PAYMENT:   { label: 'Pago',      color: '#ec4899', bg: 'rgba(236,72,153,0.12)',    icon: 'payment'        },
  EXTERNAL:  { label: 'Externo',   color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)',    icon: 'cloud_off'      },
  FIRESTORE: { label: 'Firestore', color: '#0ea5e9', bg: 'rgba(14,165,233,0.12)',    icon: 'database'       },
};

const SEV_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#6366f1' };

let _container = null;
let _allErrors  = [];
let _filterCat  = '';
let _filterSev  = '';
let _filterText = '';
let _lastDoc    = null;
let _loading    = false;

export async function mount({ container }) {
  _container = container;
  _allErrors  = [];
  _lastDoc    = null;
  _filterCat  = '';
  _filterSev  = '';
  _filterText = '';
  container.innerHTML = _skeleton();
  await _load(false);
  if (_container) { _renderAll(); _bind(); }
}

export function unmount() { _container = null; }

// ── Query ─────────────────────────────────────────────────

async function _load(more = false) {
  if (!window._db || _loading) return;
  _loading = true;
  try {
    let q = window._db.collection('error_logs').orderBy('timestamp', 'desc').limit(60);
    if (more && _lastDoc) q = q.startAfter(_lastDoc);
    const snap = await q.get();
    if (!snap.empty) {
      _lastDoc = snap.docs[snap.docs.length - 1];
      const items = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
      if (more) _allErrors.push(...items);
      else _allErrors = items;
    }
  } catch (err) {
    console.warn('[errores] No se pudo cargar error_logs:', err.message);
    // Fallback: window.__mexErrorLog
    if (!more) _allErrors = (window.__mexErrorLog || []).map((e, i) => ({ _id: `local-${i}`, ...e }));
  } finally {
    _loading = false;
  }
}

// ── Filtrado ──────────────────────────────────────────────

function _filtered() {
  return _allErrors.filter(e => {
    if (_filterCat  && e.category  !== _filterCat)  return false;
    if (_filterSev  && e.severity  !== _filterSev)  return false;
    if (_filterText) {
      const hay = `${e.message} ${e.route} ${e.userName} ${e.service}`.toLowerCase();
      if (!hay.includes(_filterText.toLowerCase())) return false;
    }
    return true;
  });
}

// ── Render ────────────────────────────────────────────────

function _renderAll() {
  if (!_container) return;
  _container.innerHTML = _html();
  _bind();
}

function _html() {
  const filtered = _filtered();
  const cats     = [...new Set(_allErrors.map(e => e.category).filter(Boolean))];
  const byCat    = {};
  for (const cat of Object.keys(CAT_META)) {
    byCat[cat] = _allErrors.filter(e => e.category === cat).length;
  }

  return `
<div style="padding:24px 28px;max-width:1300px;margin:0 auto;">

  <!-- Encabezado -->
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;gap:12px;flex-wrap:wrap;">
    <div>
      <h2 style="margin:0 0 4px;font-size:21px;font-weight:800;color:var(--p-text,#fff);">Errores del Sistema</h2>
      <p style="margin:0;font-size:13px;color:var(--p-text-muted,rgba(255,255,255,0.3));">${_allErrors.length} registros · ${filtered.length} visibles</p>
    </div>
    <button id="errRefresh" type="button" style="display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:7px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);font-size:12px;font-family:Inter,sans-serif;font-weight:600;cursor:pointer;">
      <span class="material-symbols-outlined" style="font-size:15px;">refresh</span>Recargar
    </button>
  </div>

  <!-- Stat cards por categoría -->
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-bottom:20px;">
    ${Object.entries(CAT_META).map(([k, m]) => `
    <button data-err-cat="${k}" type="button" style="
      text-align:left;border:1px solid ${_filterCat===k ? m.color : 'rgba(255,255,255,0.07)'};
      border-radius:10px;padding:12px 14px;cursor:pointer;transition:border-color .14s;
      background:${_filterCat===k ? m.bg : '#0f1b2d'};
    ">
      <span class="material-symbols-outlined" style="font-size:18px;color:${m.color};display:block;margin-bottom:6px;">${m.icon}</span>
      <div style="font-size:18px;font-weight:900;color:${m.color};line-height:1;">${byCat[k] || 0}</div>
      <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.35);margin-top:3px;text-transform:uppercase;letter-spacing:.04em;">${m.label}</div>
    </button>`).join('')}
  </div>

  <!-- Filtros de texto + severidad -->
  <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center;">
    <input id="errSearch" type="text" placeholder="Buscar mensaje, ruta, empresa…" value="${_esc(_filterText)}" style="
      flex:1;min-width:180px;padding:7px 11px;border-radius:7px;
      border:1px solid rgba(255,255,255,0.1);background:#0f1b2d;
      color:#fff;font-size:12px;font-family:Inter,sans-serif;outline:none;
    "/>
    ${['', 'high', 'medium', 'low'].map(s => `
    <button data-err-sev="${s}" type="button" style="
      padding:6px 11px;border-radius:6px;font-size:11px;font-weight:700;
      font-family:Inter,sans-serif;cursor:pointer;border:1px solid ${_filterSev===s&&s ? SEV_COLOR[s] : 'rgba(255,255,255,0.1)'};
      background:${_filterSev===s&&s ? `rgba(${_hexToRgb(SEV_COLOR[s])},0.12)` : 'rgba(255,255,255,0.04)'};
      color:${s ? SEV_COLOR[s] : 'rgba(255,255,255,0.45)'};
    ">${s ? s.toUpperCase() : 'Todos'}</button>`).join('')}
    ${_filterCat || _filterSev || _filterText ? `<button id="errClearFilters" type="button" style="display:inline-flex;align-items:center;gap:4px;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:700;font-family:Inter,sans-serif;cursor:pointer;border:1px solid rgba(255,255,255,0.1);background:transparent;color:rgba(255,255,255,0.35);"><span class="material-symbols-outlined" aria-hidden="true" style="font-size:14px;">close</span>Limpiar</button>` : ''}
  </div>

  <!-- Tabla de errores -->
  ${filtered.length ? `
  <div style="background:#0f1b2d;border:1px solid rgba(255,255,255,0.07);border-radius:10px;overflow:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
      <thead>
        <tr style="background:#0a1220;">
          <th style="${_th()}">Categoría</th>
          <th style="${_th()}">Sev.</th>
          <th style="${_th()}">Mensaje</th>
          <th style="${_th()}">Ruta</th>
          <th style="${_th()}">Usuario</th>
          <th style="${_th()}">Fecha</th>
          <th style="${_th()}">Acción</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.slice(0, 100).map(e => _row(e)).join('')}
      </tbody>
    </table>
    ${filtered.length > 100 ? `<div style="padding:10px 14px;font-size:11px;color:rgba(255,255,255,0.3);">Mostrando 100 de ${filtered.length}</div>` : ''}
  </div>
  ${_allErrors.length >= 60 ? `<button id="errLoadMore" type="button" style="margin-top:12px;display:block;width:100%;padding:10px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.5);font-size:12px;font-family:Inter,sans-serif;font-weight:600;cursor:pointer;">Cargar más</button>` : ''}
  ` : `
  <div style="padding:60px;text-align:center;">
    <span class="material-symbols-outlined" style="font-size:48px;display:block;margin-bottom:12px;color:rgba(16,185,129,0.3);">check_circle</span>
    <div style="font-size:14px;color:#10b981;font-weight:700;">${_allErrors.length ? 'Sin errores con estos filtros' : 'Sin errores registrados'}</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.25);margin-top:6px;">La colección error_logs está vacía o no hay coincidencias.</div>
  </div>`}
</div>`;
}

function _row(e) {
  const cat   = CAT_META[e.category] || { label: e.category || '?', color: '#888', icon: 'error' };
  const sev   = e.severity || 'low';
  const sevC  = SEV_COLOR[sev] || '#888';
  let date    = '—';
  try { date = (e.timestamp?.toDate ? e.timestamp.toDate() : new Date(e.clientTs || e.timestamp)).toLocaleString('es-MX', { dateStyle:'short', timeStyle:'short' }); } catch (_) {}

  return `<tr style="border-top:1px solid rgba(255,255,255,0.04);">
    <td style="padding:8px 12px;white-space:nowrap;">
      <span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:${cat.bg||'rgba(255,255,255,0.06)'};color:${cat.color};">
        <span class="material-symbols-outlined" style="font-size:11px;">${cat.icon}</span>${_esc(cat.label)}
      </span>
    </td>
    <td style="padding:8px 12px;white-space:nowrap;">
      <span style="font-size:10px;font-weight:800;color:${sevC};text-transform:uppercase;">${_esc(sev)}</span>
    </td>
    <td style="padding:8px 12px;max-width:320px;color:#fca5a5;vertical-align:top;">
      <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(e.message || '—')}</div>
      ${e.service ? `<div style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:2px;">svc: ${_esc(e.service)}</div>` : ''}
      ${e.stack    ? `<details style="margin-top:3px;"><summary style="font-size:10px;color:rgba(255,255,255,0.25);cursor:pointer;">stack</summary><pre style="font-size:9px;color:rgba(255,255,255,0.3);white-space:pre-wrap;margin:4px 0 0;">${_esc(String(e.stack).slice(0,800))}</pre></details>` : ''}
    </td>
    <td style="padding:8px 12px;color:rgba(255,255,255,0.45);font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(e.route || '—')}</td>
    <td style="padding:8px 12px;color:rgba(255,255,255,0.35);white-space:nowrap;font-size:11px;">${_esc(e.userName || e.userId || '—')}</td>
    <td style="padding:8px 12px;color:rgba(255,255,255,0.3);white-space:nowrap;font-size:11px;">${_esc(date)}</td>
    <td style="padding:8px 12px;">
      ${!e.resolved ? `<button data-err-resolve="${e._id}" type="button" style="padding:3px 8px;border-radius:5px;border:1px solid rgba(16,185,129,0.3);background:rgba(16,185,129,0.07);color:#34d399;font-size:10px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;">Resolver</button>` : `<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;color:#34d399;font-weight:700;"><span class="material-symbols-outlined" aria-hidden="true" style="font-size:13px;">check_circle</span>Resuelto</span>`}
    </td>
  </tr>`;
}

// ── Bind ──────────────────────────────────────────────────

function _bind() {
  _container?.querySelector('#errRefresh')?.addEventListener('click', async () => {
    if (!_container) return;
    _container.innerHTML = _skeleton();
    _allErrors = []; _lastDoc = null;
    await _load(false);
    if (_container) _renderAll();
  });

  _container?.querySelector('#errLoadMore')?.addEventListener('click', async () => {
    await _load(true);
    if (_container) _renderAll();
  });

  _container?.querySelector('#errSearch')?.addEventListener('input', e => {
    _filterText = e.target.value;
    _renderAll();
  });

  _container?.querySelector('#errClearFilters')?.addEventListener('click', () => {
    _filterCat = ''; _filterSev = ''; _filterText = '';
    _renderAll();
  });

  _container?.querySelectorAll('[data-err-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      _filterCat = _filterCat === btn.dataset.errCat ? '' : btn.dataset.errCat;
      _renderAll();
    });
  });

  _container?.querySelectorAll('[data-err-sev]').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = btn.dataset.errSev;
      _filterSev = (_filterSev === s || !s) ? '' : s;
      _renderAll();
    });
  });

  _container?.querySelectorAll('[data-err-resolve]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.errResolve;
      if (!id || id.startsWith('local-') || !window._db) return;
      btn.textContent = '…';
      try {
        await window._db.collection('error_logs').doc(id).update({ resolved: true, resolvedAt: new Date() });
        const item = _allErrors.find(e => e._id === id);
        if (item) item.resolved = true;
        _renderAll();
      } catch (err) {
        btn.textContent = 'Error';
        console.warn('[errores] resolve:', err.message);
      }
    });
  });
}

// ── Utils ─────────────────────────────────────────────────

function _th() {
  return 'text-align:left;padding:9px 12px;font-size:10px;font-weight:700;text-transform:uppercase;color:rgba(255,255,255,0.3);white-space:nowrap;';
}

function _skeleton() {
  return `<div style="padding:24px 28px;display:flex;flex-direction:column;gap:12px;">
    ${[...Array(4)].map(() => `<div style="height:64px;background:rgba(255,255,255,0.04);border-radius:10px;animation:skelPulse 1.4s ease-in-out infinite;"></div>`).join('')}
    <style>@keyframes skelPulse{0%,100%{opacity:.4}50%{opacity:.9}}</style>
  </div>`;
}

function _hexToRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? `${parseInt(r[1],16)},${parseInt(r[2],16)},${parseInt(r[3],16)}` : '255,255,255';
}

function _esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
