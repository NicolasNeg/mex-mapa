// Popover cajón-a-cajón al hover sobre filas de movimientos de patio (MOVE/SWAP/ADD/DEL).

let _pop = null;
let _popHideTimer = null;
let _abortCtrl = null;

function _normalizeTipo(tipo) {
  const t = String(tipo || '').toUpperCase().trim();
  if (t === 'MODIF' || t === 'MODIFICACION' || t === 'MODIFICACIÓN') return 'EDIT';
  if (t === 'DELETE') return 'DEL';
  return t || 'OTRO';
}

function _tipoIcon(tipo) {
  const map = {
    MOVE: 'arrow_forward',
    SWAP: 'swap_horiz',
    ADD: 'add_circle',
    DEL: 'remove_circle',
    EDIT: 'edit_note',
  };
  return map[_normalizeTipo(tipo)] || 'info';
}

function _tipoLabel(tipo) {
  const t = _normalizeTipo(tipo);
  return t === 'OTRO' ? 'INFO' : t;
}

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

function _defaultEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _hidePop({ immediate = false } = {}) {
  if (_popHideTimer) clearTimeout(_popHideTimer);
  const hide = () => {
    if (_pop) _pop.style.display = 'none';
    _popHideTimer = null;
  };
  if (immediate) hide();
  else _popHideTimer = setTimeout(hide, 280);
}

function _showPop(tr, esc) {
  if (_popHideTimer) {
    clearTimeout(_popHideTimer);
    _popHideTimer = null;
  }
  const { origen, destino } = _parseMove(tr.dataset.detalles);
  if (!origen && !destino) return;
  const mva = tr.dataset.mva || '';
  const tipo = _normalizeTipo(tr.dataset.tipo);
  const oLimbo = /limbo/i.test(origen);
  const dLimbo = /limbo/i.test(destino);
  const pop = _ensurePop();
  const variant = (tipo === 'SWAP') ? 'hmp-swap'
    : (tipo === 'DEL' || dLimbo) ? 'hmp-del'
    : (tipo === 'ADD' || oLimbo) ? 'hmp-add'
    : 'hmp-move';
  pop.className = 'hist-move-pop ' + variant;
  const e = typeof esc === 'function' ? esc : _defaultEsc;
  pop.innerHTML = [
    '<div class="hmp-track">',
    `<div class="hmp-box hmp-origin ${oLimbo ? 'hmp-box-limbo' : ''}"><span>${e(origen || 'Origen')}</span></div>`,
    `<span class="hmp-arrow material-icons">${tipo === 'SWAP' ? 'sync_alt' : 'arrow_forward'}</span>`,
    `<div class="hmp-box hmp-dest ${dLimbo ? 'hmp-box-limbo' : ''}"><span>${e(destino || 'Destino')}</span></div>`,
    `<div class="hmp-unit hmp-unit-a">${e(mva || 'Unidad')}</div>`,
    tipo === 'SWAP' ? '<div class="hmp-unit hmp-unit-b">OCUPANTE</div>' : '',
    '</div>',
    `<div class="hmp-caption"><span class="material-icons">${_tipoIcon(tipo)}</span> ${e(_tipoLabel(tipo))} · ${e(mva)}</div>`,
  ].join('');
  pop.style.display = 'block';
  const r = tr.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let top = r.bottom + 8;
  if (top + pr.height > window.innerHeight - 8) top = r.top - pr.height - 8;
  let left = r.left + 40;
  if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
  pop.style.top = `${Math.max(8, top)}px`;
  pop.style.left = `${Math.max(8, left)}px`;
}

/**
 * @param {HTMLElement|null} root Container that holds movement rows (data-detalles).
 * @param {{ esc?: (str: unknown) => string }} [options]
 */
export function bindHistMovePopover(root, options = {}) {
  unbindHistMovePopover();
  if (!root || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
  _abortCtrl = new AbortController();
  const { signal } = _abortCtrl;
  const esc = options.esc;
  let curTr = null;
  root.addEventListener('mouseover', (e) => {
    const tr = e.target.closest('tr[data-detalles]');
    if (tr && tr !== curTr) {
      curTr = tr;
      _showPop(tr, esc);
    }
  }, { signal });
  root.addEventListener('mouseout', (e) => {
    const tr = e.target.closest('tr[data-detalles]');
    if (tr && !tr.contains(e.relatedTarget)) {
      curTr = null;
      _hidePop();
    }
  }, { signal });
}

export function unbindHistMovePopover() {
  _abortCtrl?.abort();
  _abortCtrl = null;
  _hidePop({ immediate: true });
}
