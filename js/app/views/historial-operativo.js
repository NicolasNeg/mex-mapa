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
    // filtros estado
    qEst:         '',
    tipoEst:      'TODOS',
  };
}

// ── CSS ──────────────────────────────────────────────────────
function _ensureCss() {
  if (_cssInjected) return;
  _cssInjected = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/app-historial-operativo.css';
  link.setAttribute('data-hist-op-css', '1');
  document.head.appendChild(link);
}

// ── Helpers ──────────────────────────────────────────────────
const q   = id  => _container?.querySelector(`#hist-op-${id}`);
const esc = str => String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

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

function _motionPreviewHtml(row = {}) {
  const tipo = _normalizeTipo(row.tipo);
  const cls = tipo === "SWAP" ? "is-swap"
    : tipo === "DEL" ? "is-del"
    : tipo === "ADD" ? "is-add"
    : "is-move";
  return [
    `<div class="hist-op-motion-mini ${cls}" aria-hidden="true">`,
    `<span class="hist-op-slot hist-op-slot-a"></span>`,
    `<span class="hist-op-slot hist-op-slot-b"></span>`,
    `<span class="hist-op-unit hist-op-unit-a"></span>`,
    tipo === "SWAP" ? `<span class="hist-op-unit hist-op-unit-b"></span>` : "",
    "</div>"
  ].join("");
}

// ── Popover cajón-a-cajón (solo PC con hover) ────────────────
// Al pasar el ratón sobre una fila reproduce una vez la animación
// de la unidad deslizándose del cajón origen al destino.
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
          <button id="hist-op-limpiarMov" class="hist-op-btn-clear">Limpiar</button>
          <button id="hist-op-recargarMov" class="hist-op-btn-refresh">
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
          <button id="hist-op-recargarEst" class="hist-op-btn-refresh">
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

  const qv = _state.qMov.toLowerCase();
  let rows = _state.movimientos;
  if (qv)              rows = rows.filter(r => [r.mva,r.usuario,r.detalles,r.tipo].some(v => (v||'').toLowerCase().includes(qv)));
  if (_state.tipoMov)  rows = rows.filter(r => _normalizeTipo(r.tipo) === _state.tipoMov);
  if (_state.fechaMov) rows = rows.filter(r => _tsADia(r.timestamp) === _state.fechaMov);
  if (_state.usuarioMov) rows = rows.filter(r => r.usuario === _state.usuarioMov);

  const ctr = q('contadorMov');
  if (ctr) ctr.textContent = `${rows.length} de ${_state.movimientos.length} registros`;

  if (!rows.length) {
    wrap.innerHTML = `<div class="hist-op-empty">No hay registros que coincidan.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="hist-op-table">
      <thead><tr>
        <th>FECHA</th><th>TIPO</th><th>MVA</th><th>MOVIMIENTO</th><th>ANIMACION</th><th>USUARIO</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr data-detalles="${esc(r.detalles)}" data-mva="${esc(r.mva)}" data-tipo="${esc(r.tipo)}">
            <td class="hist-op-cell-date">${esc(r.fecha)}</td>
            <td><span class="hist-op-badge ${_tipoBadgeClass(r.tipo)}"><span class="material-icons">${_tipoIcon(r.tipo)}</span>${esc(_tipoLabel(r.tipo))}</span></td>
            <td class="hist-op-cell-mva">${esc(r.mva)}</td>
            <td>${esc(_cleanAuditText(r.detalles))}</td>
            <td class="hist-op-motion-cell">${_motionPreviewHtml(r)}</td>
            <td>${esc(_cleanAuditText(r.usuario))}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function _renderEstado() {
  const wrap = q("tablaEst");
  if (!wrap) return;

  if (_state.loadingEst) {
    wrap.innerHTML = `<div class="hist-op-loading"><span class="material-icons spin">sync</span> Cargando historial de cambios...</div>`;
    return;
  }

  const qv = _state.qEst.toLowerCase();
  let rows = _state.estado.filter(_estadoPermitido);
  if (qv) rows = rows.filter(r => [r.mva,r.autor,r.accion,r.tipo,r.detalles,r.objetivo].some(v => _cleanAuditText(v).toLowerCase().includes(qv)));
  if (_state.tipoEst && _state.tipoEst !== "TODOS") rows = rows.filter(r => _normalizeTipo(r.tipo) === _state.tipoEst);

  const ctr = q("contadorEst");
  if (ctr) ctr.textContent = `${rows.length} de ${_state.estado.length} registros`;

  if (!rows.length) {
    wrap.innerHTML = `<div class="hist-op-empty"><span class="material-icons">rule</span><div>No hay cambios de estado con esos filtros.</div></div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="hist-op-state-list">
      ${rows.map((r, index) => {
        const tipo = _normalizeTipo(r.tipo);
        const accion = _cleanAuditText(r.accion || r.detalles || "Cambio registrado");
        const target = _cleanAuditText(r.mva || r.objetivo || r.referencia || "Unidad");
        return `
          <article class="hist-op-state-card is-${tipo.toLowerCase()}" style="animation-delay:${Math.min(index, 10) * 0.025}s">
            <div class="hist-op-state-mark"><span class="material-icons">${_tipoIcon(tipo)}</span></div>
            <div class="hist-op-state-body">
              <div class="hist-op-state-top">
                <span class="hist-op-badge ${_tipoBadgeClass(tipo)}"><span class="material-icons">${_tipoIcon(tipo)}</span>${esc(_tipoLabel(tipo))}</span>
                <strong>${esc(target)}</strong>
                <time>${esc(r.fecha || "")}</time>
              </div>
              <p>${esc(accion)}</p>
              <div class="hist-op-state-meta">
                <span class="material-icons">person</span>
                <span>${esc(_cleanAuditText(r.autor || r.usuario || "Sistema"))}</span>
              </div>
            </div>
            <div class="hist-op-state-anim" aria-hidden="true">
              <span></span><span></span><span></span>
            </div>
          </article>`;
      }).join("")}
    </div>`;
}

// ── Carga de datos ───────────────────────────────────────────
async function _loadMovimientos() {
  if (_state.loadingMov) return;
  _state.loadingMov = true;
  _renderMovimientos();
  try {
    const logs = await window.api.obtenerHistorialLogs();
    _state.movimientos = logs;
    // Poblar selector de usuarios
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
      _container.querySelectorAll('.hist-op-panel').forEach(p => p.classList.toggle('hidden', !p.id.endsWith(_state.tab.replace('-','-'))));
      document.getElementById('hist-op-panel-movimientos')?.classList.toggle('hidden', _state.tab !== 'movimientos');
      document.getElementById('hist-op-panel-estado')?.classList.toggle('hidden', _state.tab !== 'estado');
      if (_state.tab === 'movimientos' && !_state.movimientos.length && !_state.loadingMov) _loadMovimientos();
      if (_state.tab === 'estado'       && !_state.estado.length      && !_state.loadingEst) _loadEstado();
      return;
    }

    if (e.target.closest('#hist-op-limpiarMov')) {
      _state.qMov = ''; _state.tipoMov = ''; _state.fechaMov = ''; _state.usuarioMov = '';
      const qi = q('qMov'); if (qi) qi.value = '';
      const ti = q('tipoMov'); if (ti) ti.value = '';
      const fi = q('fechaMov'); if (fi) fi.value = '';
      const ui = q('usuarioMov'); if (ui) ui.value = '';
      _renderMovimientos();
      return;
    }
    if (e.target.closest('#hist-op-recargarMov')) { _state.movimientos = []; _loadMovimientos(); return; }
    if (e.target.closest('#hist-op-recargarEst')) { _state.estado = []; _loadEstado(); return; }
  }, sig);

  _container.addEventListener('input', e => {
    if (!_state) return;
    if (e.target.id === 'hist-op-qMov')   { _state.qMov = e.target.value; _renderMovimientos(); return; }
    if (e.target.id === 'hist-op-qEst')   { _state.qEst = e.target.value; _renderEstado(); return; }
  }, sig);

  _container.addEventListener('change', e => {
    if (!_state) return;
    if (e.target.id === 'hist-op-tipoMov')    { _state.tipoMov = e.target.value; _renderMovimientos(); return; }
    if (e.target.id === 'hist-op-fechaMov')   { _state.fechaMov = e.target.value; _renderMovimientos(); return; }
    if (e.target.id === 'hist-op-usuarioMov') { _state.usuarioMov = e.target.value; _renderMovimientos(); return; }
    if (e.target.id === 'hist-op-tipoEst')    { _state.tipoEst = e.target.value; _renderEstado(); return; }
  }, sig);

  // Popover cajón-a-cajón — solo en dispositivos con hover real (PC)
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
