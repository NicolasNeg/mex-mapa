// js/app/views/gestion.js — panel de gestión: generación de códigos de invitación.
import { subscribeInvitaciones, crearInvitacion, revocarInvitacion } from '/js/app/features/gestion/invitaciones-data.js';
import { estadoInvitacion } from '/domain/invitacion.model.js';
import '/js/core/dialogs.js';  // side-effect: define window.mex* (sin exports ESM — también carga como <script> legacy)
const mexConfirm = (...a) => window.mexConfirm(...a);
const mexAlert   = (...a) => window.mexAlert(...a);

let _unsub = null;
const ESTADO_CHIP = {
  VIGENTE:  { cls: 'chip-ok',   icon: 'check_circle' },
  USADA:    { cls: 'chip-mut',  icon: 'how_to_reg' },
  EXPIRADA: { cls: 'chip-warn', icon: 'schedule' },
  REVOCADA: { cls: 'chip-bad',  icon: 'block' },
};

function fmtFecha(ms) {
  return new Date(ms).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function ensureCss() {
  if (document.getElementById('app-gestion-css')) return;
  const l = document.createElement('link');
  l.id = 'app-gestion-css'; l.rel = 'stylesheet'; l.href = '/css/app-gestion.css';
  document.head.appendChild(l);
}

function plazasDisponibles() {
  const cfg = window.MEX_CONFIG?.empresa || {};
  const raw = Array.isArray(cfg.plazas) ? cfg.plazas : [];
  return raw.map(p => String(p?.nombre || p?.id || p || '').toUpperCase().trim()).filter(Boolean);
}

const ROLES = ['AUXILIAR', 'VENTAS', 'SUPERVISOR', 'JEFE_PATIO', 'GERENTE_PLAZA'];

export function mount({ container }) {
  ensureCss();
  const plazas = plazasDisponibles();
  container.innerHTML = `
    <section class="gestion-view">
      <header class="gestion-head">
        <h1 class="gestion-title">Gestión</h1>
        <p class="gestion-sub">Códigos de invitación por plaza</p>
      </header>

      <form class="gestion-card gestion-form" id="inv-form">
        <div class="field">
          <label for="inv-plaza">Plaza</label>
          <select id="inv-plaza" required>
            ${plazas.length
              ? plazas.map(p => `<option value="${p}">${p}</option>`).join('')
              : '<option value="" disabled selected>Sin plazas configuradas</option>'}
          </select>
        </div>
        <div class="field">
          <label for="inv-rol">Rol</label>
          <select id="inv-rol" required>
            ${ROLES.map(r => `<option value="${r}">${r}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="inv-dias">Expira en (días)</label>
          <input id="inv-dias" type="number" min="1" max="90" value="7" required inputmode="numeric">
        </div>
        <button type="submit" class="btn-primary" id="inv-gen">
          <span class="material-symbols-outlined">add</span> Generar código
        </button>
      </form>

      <div class="gestion-card gestion-table-wrap">
        <table class="gestion-table" id="inv-table">
          <thead>
            <tr>
              <th aria-sort="descending">Código</th><th>Plaza</th><th>Rol</th>
              <th>Estado</th><th>Expira</th><th></th>
            </tr>
          </thead>
          <tbody id="inv-tbody">
            <tr><td colspan="6" class="t-empty">Cargando…</td></tr>
          </tbody>
        </table>
      </div>

      <div class="gestion-card gestion-list" id="inv-list" aria-live="polite">
        <div class="t-empty">Cargando…</div>
      </div>
    </section>

    <div class="gestion-sheet-overlay" id="inv-sheet" hidden>
      <div class="gestion-sheet" role="dialog" aria-modal="true" aria-labelledby="inv-sheet-title">
        <p class="gestion-sheet-title" id="inv-sheet-title"></p>
        <button type="button" class="gestion-sheet-action" data-sheet="copy">
          <span class="material-symbols-outlined">content_copy</span> Copiar código
        </button>
        <button type="button" class="gestion-sheet-action danger" data-sheet="revoke" hidden>
          <span class="material-symbols-outlined">block</span> Revocar
        </button>
        <button type="button" class="gestion-sheet-cancel" data-sheet="close">Cancelar</button>
      </div>
    </div>`;

  const tbody  = container.querySelector('#inv-tbody');
  const listEl = container.querySelector('#inv-list');
  const sheet  = container.querySelector('#inv-sheet');
  const form   = container.querySelector('#inv-form');
  let _sheetCodigo = null;
  let _sheetPuedeRevocar = false;
  let _sheetCloseTimer = null;

  function openSheet(codigo, puedeRevocar) {
    if (_sheetCloseTimer) {
      clearTimeout(_sheetCloseTimer);
      _sheetCloseTimer = null;
    }
    _sheetCodigo = codigo;
    _sheetPuedeRevocar = puedeRevocar;
    sheet.querySelector('#inv-sheet-title').textContent = codigo;
    const revokeBtn = sheet.querySelector('[data-sheet="revoke"]');
    revokeBtn.hidden = !puedeRevocar;
    revokeBtn.disabled = false;
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('open'));
  }

  function closeSheet() {
    if (_sheetCloseTimer) {
      clearTimeout(_sheetCloseTimer);
      _sheetCloseTimer = null;
    }
    sheet.classList.remove('open');
    _sheetCloseTimer = setTimeout(() => {
      _sheetCloseTimer = null;
      sheet.hidden = true;
      _sheetCodigo = null;
      _sheetPuedeRevocar = false;
    }, 200);
  }

  function render(items) {
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="t-empty">
        <span class="material-symbols-outlined">mail</span>
        Aún no hay invitaciones. Genera la primera arriba.</td></tr>`;
      listEl.innerHTML = `<div class="t-empty">
        <span class="material-symbols-outlined">mail</span>
        Aún no hay invitaciones. Genera la primera arriba.</div>`;
      return;
    }
    const ahora = Date.now();
    tbody.innerHTML = items.map(it => {
      const est = estadoInvitacion(it, ahora);
      const chip = ESTADO_CHIP[est];
      const puedeRevocar = est === 'VIGENTE';
      return `<tr>
        <td class="t-code">
          <button class="btn-copy" data-copy="${it.codigo}" title="Copiar">
            <span class="material-symbols-outlined">content_copy</span></button>
          <code>${it.codigo}</code>
        </td>
        <td>${it.plaza}</td>
        <td>${it.rol}</td>
        <td><span class="chip ${chip.cls}">
          <span class="material-symbols-outlined">${chip.icon}</span>${est}</span></td>
        <td class="t-num">${fmtFecha(it.expiraEnMs)}</td>
        <td>${puedeRevocar
          ? `<button class="btn-danger-ghost" data-revoke="${it.codigo}">Revocar</button>`
          : ''}</td>
      </tr>`;
    }).join('');
    listEl.innerHTML = items.map(it => {
      const est = estadoInvitacion(it, ahora);
      const chip = ESTADO_CHIP[est];
      return `<div class="gestion-row" data-codigo="${it.codigo}" data-estado="${est}">
        <div class="gestion-row-main">
          <div class="gestion-row-code"><code>${it.codigo}</code></div>
          <div class="gestion-row-meta">${it.plaza} · ${it.rol} · ${fmtFecha(it.expiraEnMs)}</div>
        </div>
        <div class="gestion-row-side">
          <span class="chip ${chip.cls}">
            <span class="material-symbols-outlined">${chip.icon}</span>${est}</span>
          <button type="button" class="btn-more" data-more="${it.codigo}" aria-label="Acciones">
            <span class="material-symbols-outlined">more_vert</span>
          </button>
        </div>
      </div>`;
    }).join('');
  }

  _unsub = subscribeInvitaciones(render);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('#inv-gen');
    btn.disabled = true;
    try {
      const { codigo } = await crearInvitacion({
        plaza: form.querySelector('#inv-plaza').value,
        rol:   form.querySelector('#inv-rol').value,
        expiraEnDias: Number(form.querySelector('#inv-dias').value),
      });
      await mexAlert(`Código generado: ${codigo}`, 'Invitación creada');
    } catch (err) {
      await mexAlert(err?.message || 'No se pudo generar el código.', 'Error');
    } finally { btn.disabled = false; }
  });

  tbody.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      await navigator.clipboard.writeText(copyBtn.dataset.copy).catch(() => {});
      copyBtn.classList.add('copied');
      setTimeout(() => copyBtn.classList.remove('copied'), 800);
      return;
    }
    const revBtn = e.target.closest('[data-revoke]');
    if (revBtn) {
      const ok = await mexConfirm('¿Revocar este código? No podrá usarse para registrarse.', 'Revocar invitación');
      if (!ok) return;
      revBtn.disabled = true;
      try { await revocarInvitacion(revBtn.dataset.revoke); }
      catch (err) { await mexAlert(err?.message || 'No se pudo revocar.', 'Error'); revBtn.disabled = false; }
    }
  });

  listEl.addEventListener('click', (e) => {
    const more = e.target.closest('[data-more]');
    if (!more) return;
    const row = more.closest('.gestion-row');
    openSheet(more.dataset.more, row?.dataset.estado === 'VIGENTE');
  });

  sheet.addEventListener('click', async (e) => {
    if (e.target === sheet) { closeSheet(); return; }
    const act = e.target.closest('[data-sheet]');
    if (!act) return;
    const kind = act.dataset.sheet;
    if (kind === 'close') { closeSheet(); return; }
    if (kind === 'copy' && _sheetCodigo) {
      await navigator.clipboard.writeText(_sheetCodigo).catch(() => {});
      closeSheet();
      return;
    }
    if (kind === 'revoke' && _sheetCodigo && _sheetPuedeRevocar) {
      const ok = await mexConfirm('¿Revocar este código? No podrá usarse para registrarse.', 'Revocar invitación');
      if (!ok) return;
      const revokeBtn = sheet.querySelector('[data-sheet="revoke"]');
      revokeBtn.disabled = true;
      try {
        await revocarInvitacion(_sheetCodigo);
        closeSheet();
      } catch (err) {
        await mexAlert(err?.message || 'No se pudo revocar.', 'Error');
        revokeBtn.disabled = false;
      }
    }
  });
}

export function unmount() {
  if (_unsub) { _unsub(); _unsub = null; }
}
