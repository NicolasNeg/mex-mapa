// ═══════════════════════════════════════════════════════════
//  /js/app/views/historial-operativo.js
//  Historial Operativo — vista SPA independiente.
//
//  Tab 1: Movimientos (historial_patio — MOVE/SWAP/ADD/EDIT/DEL)
//         → en el futuro se moverá a Cuadre
//  Tab 2: Estados (COL.LOGS: IN / BAJA / EDIT / GESTION)
// ═══════════════════════════════════════════════════════════

let _container  = null;
let _state      = null;
let _cssInjected = false;
let _abortCtrl  = null;

const PAGE_SIZES = [25, 50, 100];

// ── Estado interno ───────────────────────────────────────────
function _makeState() {
  return {
    tab:          'movimientos',   // 'movimientos' | 'estado'
    movimientos:  [],
    estado:       [],
    loadingMov:   false,
    loadingEst:   false,
    // filtros movimientos
    qMov:         '',
    tipoMov:      '',
    fechaMov:     '',
    usuarioMov:   '',
    pageMov:      1,
    pageSizeMov:  50,
    // filtros estado
    qEst:         '',
    tipoEst:      'TODOS',
    pageEst:      1,
    pageSizeEst:  50,
  };
}

// ── CSS ──────────────────────────────────────────────────────
function _ensureCss() {
  if (_cssInjected) return;
  _cssInjected = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/app-historial-operativo.css?v=20260715a';
  link.setAttribute('data-hist-op-css', '1');
  document.head.appendChild(link);
}

// ── Helpers ──────────────────────────────────────────────────
const q   = id  => _container?.querySelector(`#hist-op-${id}`);
const esc = str => String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function _csvCell(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function _exportDate() {
  return new Date().toISOString().slice(0, 10);
}

function _toast(message, type = 'info') {
  if (typeof window.showToast === 'function') window.showToast(message, type);
  else console[type === 'error' ? 'error' : 'log'](message);
}

function _pagerHtml(prefix, page, pageSize, total) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = total ? (safePage - 1) * pageSize + 1 : 0;
  const end = Math.min(safePage * pageSize, total);
  const sizeOpts = PAGE_SIZES.map(n =>
    `<option value="${n}"${n === pageSize ? ' selected' : ''}>${n}</option>`
  ).join('');
  return `
    <div class="hist-op-pager">
      <label class="hist-op-page-size"><span>Mostrar</span>
        <select id="hist-op-pageSize${prefix}">${sizeOpts}</select>
      </label>
      <span class="hist-op-pager-label">${total ? `${start}–${end} de ${total}` : 'Sin registros'}</span>
      <div class="hist-op-pager-btns">
        <button type="button" class="hist-op-btn-page" data-page-action="prev-${prefix}" ${safePage <= 1 ? 'disabled' : ''}>Anterior</button>
        <button type="button" class="hist-op-btn-page" data-page-action="next-${prefix}" ${safePage >= totalPages ? 'disabled' : ''}>Siguiente</button>
      </div>
    </div>`;
}

function _filteredMovimientos() {
  const qv = _state.qMov.toLowerCase();
  let rows = _state.movimientos;
  if (qv) rows = rows.filter(r => [r.mva, r.usuario, r.detalles, r.tipo].some(v => (v || '').toLowerCase().includes(qv)));
  if (_state.tipoMov) rows = rows.filter(r => _normalizeTipo(r.tipo) === _state.tipoMov);
  if (_state.fechaMov) rows = rows.filter(r => _tsADia(r.timestamp) === _state.fechaMov);
  if (_state.usuarioMov) rows = rows.filter(r => r.usuario === _state.usuarioMov);
  return rows;
}

function _filteredEstado() {
  const qv = _state.qEst.toLowerCase();
  let rows = _state.estado.filter(_estadoPermitido);
  if (qv) {
    rows = rows.filter(r =>
      [r.mva, r.autor, r.accion, r.tipo, r.detalles, r.objetivo]
        .some(v => _cleanAuditText(v).toLowerCase().includes(qv))
    );
  }
  if (_state.tipoEst && _state.tipoEst !== 'TODOS') {
    rows = rows.filter(r => _normalizeTipo(r.tipo) === _state.tipoEst);
  }
  return rows;
}

// Normaliza cualquier timestamp (segundos | ms | Firestore {seconds}) a día local
// 'YYYY-MM-DD'. El filtro fallaba cuando timestamp llegaba como objeto (*1000=NaN).
function _tsADia(ts) {
  if (ts == null) return '';
  let ms;
  if (typeof ts === 'object' && 'seconds' in ts) ms = ts.seconds * 1000;
  else if (typeof ts === 'number') ms = ts < 1e12 ? ts * 1000 : ts; // <1e12 => segundos
  else ms = new Date(ts).getTime();
  if (!isFinite(ms)) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _normalizeTipo(tipo) {
  const t = String(tipo || "").toUpperCase().trim();
  if (t === "MODIF" || t === "MODIFICACION" || t === "MODIFICACIÓN") return "EDIT";
  if (t === "DELETE") return "DEL";
  return t || "OTRO";
}

function _tipoBadgeClass(tipo) {
  const t = _normalizeTipo(tipo);
  const map = { MOVE:"badge-move", SWAP:"badge-swap", ADD:"badge-add", EDIT:"badge-edit", DEL:"badge-del", IN:"badge-add", BAJA:"badge-del", GESTION:"badge-gestion" };
  return map[t] || "badge-otro";
}

function _tipoLabel(tipo) {
  const t = _normalizeTipo(tipo);
  return t === "OTRO" ? "INFO" : t;
}

function _tipoIcon(tipo) {
  const map = {
    MOVE: "arrow_forward",
    SWAP: "swap_horiz",
    ADD: "add_circle",
    DEL: "remove_circle",
    IN: "login",
    BAJA: "logout",
    EDIT: "edit_note",
    GESTION: "settings_suggest"
  };
  return map[_normalizeTipo(tipo)] || "info";
}

function _cleanAuditText(value) {
  return String(value || "")
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]/gu, "")
    .replace(/\s*\|\s*Notas eliminadas/gi, "")
    .replace(/Notas reemplazadas/gi, "Notas actualizadas")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function _estadoPermitido(row) {
  return ["IN", "BAJA", "EDIT", "GESTION"].includes(_normalizeTipo(row?.tipo));
}

function _toMs(ts) {
  if (ts == null) return 0;
  if (typeof ts === "object" && "seconds" in ts) return ts.seconds * 1000;
  if (typeof ts === "number") return ts < 1e12 ? ts * 1000 : ts;
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

// ── Popover cajón-a-cajón (solo PC con hover) ────────────────
let _pop = null;
function _ensurePop() {
  if (_pop) return _pop;
  _pop = document.createElement('div');
  _pop.className = 'hist-move-pop';
  _pop.style.display = 'none';
  document.body.appendChild(_pop);
  return _pop;
}
function _parseMove(detalles) {
  const parts = String(detalles || '').split(/→|->/);
  return { origen: (parts[0] || '').trim(), destino: (parts[1] || '').trim() };
}
function _showPop(tr) {
  const { origen, destino } = _parseMove(tr.dataset.detalles);
  if (!origen && !destino) return;
  const mva  = tr.dataset.mva || "";
  const tipo = _normalizeTipo(tr.dataset.tipo);
  const oLimbo = /limbo/i.test(origen);
  const dLimbo = /limbo/i.test(destino);
  const pop = _ensurePop();
  const variant = (tipo === "SWAP") ? "hmp-swap"
    : (tipo === "DEL" || dLimbo) ? "hmp-del"
    : (tipo === "ADD" || oLimbo) ? "hmp-add"
    : "hmp-move";
  pop.className = "hist-move-pop " + variant;
  pop.innerHTML = [
    `<div class="hmp-track">`,
    `<div class="hmp-box hmp-origin ${oLimbo ? "hmp-box-limbo" : ""}"><span>${esc(origen || "Origen")}</span></div>`,
    `<span class="hmp-arrow material-icons">${tipo === "SWAP" ? "sync_alt" : "arrow_forward"}</span>`,
    `<div class="hmp-box hmp-dest ${dLimbo ? "hmp-box-limbo" : ""}"><span>${esc(destino || "Destino")}</span></div>`,
    `<div class="hmp-unit hmp-unit-a">${esc(mva || "Unidad")}</div>`,
    tipo === "SWAP" ? `<div class="hmp-unit hmp-unit-b">OCUPANTE</div>` : "",
    `</div>`,
    `<div class="hmp-caption"><span class="material-icons">${_tipoIcon(tipo)}</span> ${esc(_tipoLabel(tipo))} · ${esc(mva)}</div>`
  ].join("");
  pop.style.display = "block";
  const r  = tr.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let top  = r.bottom + 8;
  if (top + pr.height > window.innerHeight - 8) top = r.top - pr.height - 8;
  let left = r.left + 40;
  if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
  pop.style.top  = Math.max(8, top) + "px";
  pop.style.left = Math.max(8, left) + "px";
}
function _hidePop() { if (_pop) _pop.style.display = 'none'; }

// ── Render ───────────────────────────────────────────────────
function _renderShell() {
  _container.innerHTML = `
    <div class="hist-op-root">
      <header class="hist-op-header">
        <div>
          <p class="hist-op-kicker">Auditoria operativa</p>
          <h1>Historial de cambios</h1>
        </div>
        <div class="hist-op-header-note">Movimientos, estados y bajas de unidad</div>
      </header>
      <div class="hist-op-tabs">
        <button id="hist-op-tab-mov" class="hist-op-tab ${_state.tab === 'movimientos' ? 'active' : ''}"
          data-tab="movimientos">
          <span class="material-icons">swap_horiz</span> Movimientos
        </button>
        <button id="hist-op-tab-est" class="hist-op-tab ${_state.tab === 'estado' ? 'active' : ''}"
          data-tab="estado">
          <span class="material-icons">tune</span> Estados
        </button>
      </div>

      <div id="hist-op-panel-movimientos" class="hist-op-panel ${_state.tab === 'movimientos' ? '' : 'hidden'}">
        <div class="hist-op-filters">
          <input id="hist-op-qMov" type="text" placeholder="Buscar MVA, usuario o movimiento" value="${esc(_state.qMov)}">
          <input id="hist-op-fechaMov" type="date" value="${esc(_state.fechaMov)}">
          <select id="hist-op-tipoMov">
            ${['','MOVE','SWAP','ADD','EDIT','DEL'].map(t =>
              `<option value="${t}" ${_state.tipoMov===t?'selected':''}>${t || 'Todos los tipos'}</option>`).join('')}
          </select>
          <select id="hist-op-usuarioMov">
            <option value="">Todos los usuarios</option>
          </select>
          <button id="hist-op-limpiarMov" class="hist-op-btn-clear" type="button">Limpiar</button>
          <button id="hist-op-exportMov" class="hist-op-btn-export" type="button" title="Exportar CSV">
            <span class="material-icons">download</span> Exportar
          </button>
          <button id="hist-op-recargarMov" class="hist-op-btn-refresh" type="button">
            <span class="material-icons">sync</span>
          </button>
          <span id="hist-op-contadorMov" class="hist-op-counter"></span>
        </div>
        <div id="hist-op-tablaMov" class="hist-op-table-wrap"></div>
      </div>

      <div id="hist-op-panel-estado" class="hist-op-panel ${_state.tab === 'estado' ? '' : 'hidden'}">
        <div class="hist-op-filters">
          <input id="hist-op-qEst" type="text" placeholder="Buscar unidad, autor o cambio" value="${esc(_state.qEst)}">
          <select id="hist-op-tipoEst">
            ${['TODOS','IN','BAJA','EDIT','GESTION'].map(t =>
              `<option value="${t}" ${_state.tipoEst===t?'selected':''}>${_tipoLabel(t)}</option>`).join('')}
          </select>
          <button id="hist-op-exportEst" class="hist-op-btn-export" type="button" title="Exportar CSV">
            <span class="material-icons">download</span> Exportar
          </button>
          <button id="hist-op-recargarEst" class="hist-op-btn-refresh" type="button">
            <span class="material-icons">sync</span>
          </button>
          <span id="hist-op-contadorEst" class="hist-op-counter"></span>
        </div>
        <div id="hist-op-tablaEst" class="hist-op-table-wrap"></div>
      </div>
    </div>
  `;
}

function _renderMovimientos() {
  const wrap = q('tablaMov');
  if (!wrap) return;

  if (_state.loadingMov) {
    wrap.innerHTML = `<div class="hist-op-loading"><span class="material-icons spin">sync</span> Cargando movimientos…</div>`;
    return;
  }

  const rows = _filteredMovimientos();
  const ctr = q('contadorMov');
  if (ctr) ctr.textContent = `${rows.length} de ${_state.movimientos.length} registros`;

  const totalPages = Math.max(1, Math.ceil(rows.length / _state.pageSizeMov) || 1);
  if (_state.pageMov > totalPages) _state.pageMov = totalPages;
  if (_state.pageMov < 1) _state.pageMov = 1;
  const start = (_state.pageMov - 1) * _state.pageSizeMov;
  const pageRows = rows.slice(start, start + _state.pageSizeMov);

  if (!rows.length) {
    wrap.innerHTML = `${_pagerHtml('Mov', _state.pageMov, _state.pageSizeMov, 0)}
      <div class="hist-op-empty">No hay registros que coincidan.</div>`;
    return;
  }

  wrap.innerHTML = `
    ${_pagerHtml('Mov', _state.pageMov, _state.pageSizeMov, rows.length)}
    <div class="hist-op-table-scroll">
      <table class="hist-op-table hist-op-table--dense">
        <thead><tr>
          <th>FECHA</th><th>TIPO</th><th>MVA</th><th>MOVIMIENTO</th><th>USUARIO</th>
        </tr></thead>
        <tbody>
          ${pageRows.map(r => `
            <tr data-detalles="${esc(r.detalles)}" data-mva="${esc(r.mva)}" data-tipo="${esc(r.tipo)}">
              <td class="hist-op-cell-date">${esc(r.fecha)}</td>
              <td><span class="hist-op-badge ${_tipoBadgeClass(r.tipo)}"><span class="material-icons">${_tipoIcon(r.tipo)}</span>${esc(_tipoLabel(r.tipo))}</span></td>
              <td class="hist-op-cell-mva">${esc(r.mva)}</td>
              <td>${esc(_cleanAuditText(r.detalles))}</td>
              <td>${esc(_cleanAuditText(r.usuario))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function _renderEstado() {
  const wrap = q("tablaEst");
  if (!wrap) return;

  if (_state.loadingEst) {
    wrap.innerHTML = `<div class="hist-op-loading"><span class="material-icons spin">sync</span> Cargando historial de cambios...</div>`;
    return;
  }

  const rows = _filteredEstado();
  const ctr = q("contadorEst");
  if (ctr) ctr.textContent = `${rows.length} de ${_state.estado.length} registros`;

  const totalPages = Math.max(1, Math.ceil(rows.length / _state.pageSizeEst) || 1);
  if (_state.pageEst > totalPages) _state.pageEst = totalPages;
  if (_state.pageEst < 1) _state.pageEst = 1;
  const start = (_state.pageEst - 1) * _state.pageSizeEst;
  const pageRows = rows.slice(start, start + _state.pageSizeEst);

  if (!rows.length) {
    wrap.innerHTML = `${_pagerHtml('Est', _state.pageEst, _state.pageSizeEst, 0)}
      <div class="hist-op-empty"><span class="material-icons">rule</span><div>No hay cambios de estado con esos filtros.</div></div>`;
    return;
  }

  wrap.innerHTML = `
    ${_pagerHtml('Est', _state.pageEst, _state.pageSizeEst, rows.length)}
    <div class="hist-op-table-scroll">
      <table class="hist-op-table hist-op-table--dense">
        <thead><tr>
          <th>FECHA</th><th>TIPO</th><th>UNIDAD</th><th>CAMBIO</th><th>AUTOR</th>
        </tr></thead>
        <tbody>
          ${pageRows.map(r => {
            const tipo = _normalizeTipo(r.tipo);
            const accion = _cleanAuditText(r.accion || r.detalles || "Cambio registrado");
            const target = _cleanAuditText(r.mva || r.objetivo || r.referencia || "—");
            return `
              <tr>
                <td class="hist-op-cell-date">${esc(r.fecha || "")}</td>
                <td><span class="hist-op-badge ${_tipoBadgeClass(tipo)}"><span class="material-icons">${_tipoIcon(tipo)}</span>${esc(_tipoLabel(tipo))}</span></td>
                <td class="hist-op-cell-mva">${esc(target)}</td>
                <td>${esc(accion)}</td>
                <td>${esc(_cleanAuditText(r.autor || r.usuario || "Sistema"))}</td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

function _exportCsv(kind) {
  const isMov = kind === 'mov';
  const rows = isMov ? _filteredMovimientos() : _filteredEstado();
  if (!rows.length) {
    _toast('No hay registros para exportar.', 'error');
    return;
  }
  const header = isMov
    ? ['Fecha', 'Tipo', 'MVA', 'Movimiento', 'Usuario']
    : ['Fecha', 'Tipo', 'Unidad', 'Cambio', 'Autor'];
  const body = rows.map(r => {
    if (isMov) {
      return [r.fecha, _tipoLabel(r.tipo), r.mva, _cleanAuditText(r.detalles), _cleanAuditText(r.usuario)];
    }
    return [
      r.fecha || '',
      _tipoLabel(r.tipo),
      _cleanAuditText(r.mva || r.objetivo || r.referencia || ''),
      _cleanAuditText(r.accion || r.detalles || ''),
      _cleanAuditText(r.autor || r.usuario || 'Sistema')
    ];
  });
  const csv = '\ufeff' + [header.map(_csvCell).join(','), ...body.map(line => line.map(_csvCell).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const name = isMov ? 'movimientos' : 'estados';
  _downloadBlob(blob, `historial-${name}-${_exportDate()}.csv`);
  _toast(`Exportados ${rows.length} registros (CSV).`, 'success');
}

// ── Carga de datos ───────────────────────────────────────────
async function _loadMovimientos() {
  if (_state.loadingMov) return;
  _state.loadingMov = true;
  _renderMovimientos();
  try {
    const logs = await window.api.obtenerHistorialLogs();
    _state.movimientos = logs;
    const sel = q('usuarioMov');
    if (sel) {
      const usuarios = [...new Set(logs.map(l => l.usuario).filter(Boolean))].sort();
      sel.innerHTML = `<option value="">Todos los usuarios</option>` +
        usuarios.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
      if (_state.usuarioMov) sel.value = _state.usuarioMov;
    }
  } catch (e) {
    console.error('[historial-op] movimientos', e);
    _state.movimientos = [];
  } finally {
    _state.loadingMov = false;
    _renderMovimientos();
  }
}

async function _loadEstado() {
  if (_state.loadingEst) return;
  _state.loadingEst = true;
  _renderEstado();
  try {
    const serverLogs = await (window.api.obtenerLogsServer?.() || Promise.resolve([]));
    _state.estado = (Array.isArray(serverLogs) ? serverLogs : [])
      .map(log => ({
        ...log,
        tipo: _normalizeTipo(log.tipo),
        accion: _cleanAuditText(log.accion || log.detalles || ""),
        detalles: _cleanAuditText(log.detalles || ""),
        autor: _cleanAuditText(log.autor || log.usuario || "Sistema")
      }))
      .filter(_estadoPermitido)
      .sort((a, b) => _toMs(b.timestamp) - _toMs(a.timestamp));
  } catch (e) {
    console.error("[historial-op] estado", e);
    _state.estado = [];
  } finally {
    _state.loadingEst = false;
    _renderEstado();
  }
}

// ── Eventos ──────────────────────────────────────────────────
function _bindEvents() {
  _abortCtrl?.abort();
  _abortCtrl = new AbortController();
  const sig = { signal: _abortCtrl.signal };
  _container.addEventListener('click', e => {
    if (!_state) return;
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      _state.tab = tabBtn.dataset.tab;
      _container.querySelectorAll('.hist-op-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === _state.tab));
      document.getElementById('hist-op-panel-movimientos')?.classList.toggle('hidden', _state.tab !== 'movimientos');
      document.getElementById('hist-op-panel-estado')?.classList.toggle('hidden', _state.tab !== 'estado');
      if (_state.tab === 'movimientos' && !_state.movimientos.length && !_state.loadingMov) _loadMovimientos();
      if (_state.tab === 'estado' && !_state.estado.length && !_state.loadingEst) _loadEstado();
      return;
    }

    if (e.target.closest('#hist-op-limpiarMov')) {
      _state.qMov = ''; _state.tipoMov = ''; _state.fechaMov = ''; _state.usuarioMov = '';
      _state.pageMov = 1;
      const qi = q('qMov'); if (qi) qi.value = '';
      const ti = q('tipoMov'); if (ti) ti.value = '';
      const fi = q('fechaMov'); if (fi) fi.value = '';
      const ui = q('usuarioMov'); if (ui) ui.value = '';
      _renderMovimientos();
      return;
    }
    if (e.target.closest('#hist-op-exportMov')) { _exportCsv('mov'); return; }
    if (e.target.closest('#hist-op-exportEst')) { _exportCsv('est'); return; }
    if (e.target.closest('#hist-op-recargarMov')) { _state.movimientos = []; _state.pageMov = 1; _loadMovimientos(); return; }
    if (e.target.closest('#hist-op-recargarEst')) { _state.estado = []; _state.pageEst = 1; _loadEstado(); return; }

    const pageBtn = e.target.closest('[data-page-action]');
    if (pageBtn) {
      const act = pageBtn.dataset.pageAction;
      if (act === 'prev-Mov') { _state.pageMov = Math.max(1, _state.pageMov - 1); _renderMovimientos(); return; }
      if (act === 'next-Mov') { _state.pageMov += 1; _renderMovimientos(); return; }
      if (act === 'prev-Est') { _state.pageEst = Math.max(1, _state.pageEst - 1); _renderEstado(); return; }
      if (act === 'next-Est') { _state.pageEst += 1; _renderEstado(); return; }
    }
  }, sig);

  _container.addEventListener('input', e => {
    if (!_state) return;
    if (e.target.id === 'hist-op-qMov') { _state.qMov = e.target.value; _state.pageMov = 1; _renderMovimientos(); return; }
    if (e.target.id === 'hist-op-qEst') { _state.qEst = e.target.value; _state.pageEst = 1; _renderEstado(); return; }
  }, sig);

  _container.addEventListener('change', e => {
    if (!_state) return;
    if (e.target.id === 'hist-op-tipoMov') { _state.tipoMov = e.target.value; _state.pageMov = 1; _renderMovimientos(); return; }
    if (e.target.id === 'hist-op-fechaMov') { _state.fechaMov = e.target.value; _state.pageMov = 1; _renderMovimientos(); return; }
    if (e.target.id === 'hist-op-usuarioMov') { _state.usuarioMov = e.target.value; _state.pageMov = 1; _renderMovimientos(); return; }
    if (e.target.id === 'hist-op-tipoEst') { _state.tipoEst = e.target.value; _state.pageEst = 1; _renderEstado(); return; }
    if (e.target.id === 'hist-op-pageSizeMov') {
      _state.pageSizeMov = Number(e.target.value) || 50;
      _state.pageMov = 1;
      _renderMovimientos();
      return;
    }
    if (e.target.id === 'hist-op-pageSizeEst') {
      _state.pageSizeEst = Number(e.target.value) || 50;
      _state.pageEst = 1;
      _renderEstado();
      return;
    }
  }, sig);

  if (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) {
    let curTr = null;
    _container.addEventListener('mouseover', e => {
      const tr = e.target.closest('tr[data-detalles]');
      if (tr && tr !== curTr) { curTr = tr; _showPop(tr); }
    }, sig);
    _container.addEventListener('mouseout', e => {
      const tr = e.target.closest('tr[data-detalles]');
      if (tr && !tr.contains(e.relatedTarget)) { curTr = null; _hidePop(); }
    }, sig);
  }
}

// ── API pública del módulo ───────────────────────────────────
export function mount(ctx) {
  _ensureCss();
  _container = ctx?.container || document.getElementById('mexShellMain');
  if (!_container) return;
  _state = _makeState();
  _renderShell();
  _bindEvents();
  _loadMovimientos();
}

export function unmount() {
  _abortCtrl?.abort();
  _abortCtrl = null;
  if (_pop) { _pop.remove(); _pop = null; }
  if (_container) _container.innerHTML = '';
  _container = null;
  _state     = null;
}
