/**
 * Select tipo cinta (panel debajo del trigger) para paneles admin.
 */

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _shortSub(text, max = 40) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * @param {{ id: string, name?: string, value?: string, options: {value:string,label:string,sub?:string}[], placeholder?: string, disabled?: boolean }} cfg
 */
export function admRibbonSelectHtml(cfg = {}) {
  const id = String(cfg.id || '').trim();
  const name = String(cfg.name || '').trim();
  const val = String(cfg.value ?? '');
  const placeholder = String(cfg.placeholder || 'Seleccionar');
  const disabled = cfg.disabled === true;
  const options = Array.isArray(cfg.options) ? cfg.options : [];
  const hit = options.find(o => String(o.value) === val);
  const display = hit
    ? (hit.sub ? `${hit.label} · ${_shortSub(hit.sub, 24)}` : hit.label)
    : placeholder;

  return `
    <div class="adm-ribbon-field${disabled ? ' is-disabled' : ''}" data-adm-ribbon-id="${_esc(id)}">
      <input type="hidden" id="${_esc(id)}" ${name ? `name="${_esc(name)}"` : ''} value="${_esc(val)}">
      <button type="button" class="adm-ribbon-trigger" data-action="adm-ribbon-toggle" data-adm-ribbon="${_esc(id)}" ${disabled ? 'disabled' : ''} aria-haspopup="listbox" aria-expanded="false">
        <span class="adm-ribbon-value">${_esc(display)}</span>
        <span class="material-symbols-outlined" aria-hidden="true">expand_more</span>
      </button>
      <div class="adm-ribbon-panel" data-adm-ribbon-panel="${_esc(id)}" hidden role="listbox">
        <ul class="adm-ribbon-list">
          ${options.map(o => {
            const selected = String(o.value) === val;
            return `
            <li>
              <button type="button" class="adm-ribbon-option${selected ? ' is-selected' : ''}" data-action="adm-ribbon-select" data-adm-ribbon="${_esc(id)}" data-value="${_esc(o.value)}" data-label="${_esc(o.label)}"${o.sub ? ` data-sub="${_esc(o.sub)}"` : ''}>
                <span class="adm-ribbon-option-main">${_esc(o.label)}</span>
                ${o.sub ? `<span class="adm-ribbon-option-sub">${_esc(_shortSub(o.sub, 48))}</span>` : ''}
              </button>
            </li>`;
          }).join('')}
        </ul>
      </div>
    </div>`;
}

export function admCloseAllRibbons(root, exceptField = null) {
  if (!root) return;
  root.querySelectorAll('.adm-ribbon-field.is-open').forEach(field => {
    if (exceptField && field === exceptField) return;
    field.classList.remove('is-open');
    const panel = field.querySelector('.adm-ribbon-panel');
    if (panel) panel.hidden = true;
    field.querySelector('.adm-ribbon-trigger')?.setAttribute('aria-expanded', 'false');
  });
}

export function admToggleRibbon(field, open, root) {
  if (!field) return;
  admCloseAllRibbons(root, open ? field : null);
  const panel = field.querySelector('.adm-ribbon-panel');
  const trigger = field.querySelector('.adm-ribbon-trigger');
  if (!panel) return;
  field.classList.toggle('is-open', open);
  panel.hidden = !open;
  trigger?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

export function admApplyRibbonSelect(btn, root) {
  const id = btn.dataset.admRibbon || '';
  const value = btn.dataset.value ?? '';
  const label = btn.dataset.label || '';
  const sub = btn.dataset.sub || '';
  const field = root?.querySelector(`.adm-ribbon-field[data-adm-ribbon-id="${id}"]`);
  const hidden = field?.querySelector('input[type="hidden"]');
  if (hidden) hidden.value = value;
  const display = sub ? `${label} · ${_shortSub(sub, 24)}` : label;
  const valueEl = field?.querySelector('.adm-ribbon-value');
  if (valueEl) valueEl.textContent = display || label;
  field?.querySelectorAll('.adm-ribbon-option').forEach(opt => {
    opt.classList.toggle('is-selected', opt.dataset.value === value);
  });
  admToggleRibbon(field, false, root);
  return { id, name: hidden?.getAttribute('name') || '', value, label };
}

/**
 * Delegación de clics para cintas dentro de `root`.
 */
export function admBindRibbonRoot(root, { onSelect } = {}) {
  if (!root || root.dataset.admRibbonBound === '1') return;
  root.dataset.admRibbonBound = '1';
  root.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-action="adm-ribbon-toggle"]');
    if (toggle) {
      const id = toggle.dataset.admRibbon || '';
      const field = root.querySelector(`.adm-ribbon-field[data-adm-ribbon-id="${id}"]`);
      if (field && !field.classList.contains('is-disabled')) {
        admToggleRibbon(field, !field.classList.contains('is-open'), root);
      }
      event.stopPropagation();
      return;
    }
    const selectBtn = event.target.closest('[data-action="adm-ribbon-select"]');
    if (selectBtn) {
      const payload = admApplyRibbonSelect(selectBtn, root);
      if (typeof onSelect === 'function') onSelect(payload, selectBtn);
      event.stopPropagation();
      return;
    }
    if (!event.target.closest('.adm-ribbon-field')) {
      admCloseAllRibbons(root);
    }
  });
}
