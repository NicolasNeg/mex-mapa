// ═══════════════════════════════════════════════════════════
//  /js/app/views/programador.js — Bridge view
//  La consola técnica completa vive en js/views/programador.js.
// ═══════════════════════════════════════════════════════════

import { getState } from '/js/app/app-state.js';
import { ROLE_LABELS } from '/js/shell/navigation.config.js';

export function mount({ container }) {
  const { profile, role } = getState();
  container.innerHTML = _html(profile, role);
}

export function unmount() { /* sin listeners */ }

function _html(profile, role) {
  const name      = _name(profile);
  const roleLabel = ROLE_LABELS[role] || role;
  const plaza     = _plaza(profile);

  // Info del entorno disponible de forma segura
  const swVersion  = typeof caches !== 'undefined' ? 'mapa-v206' : '—';
  const origin     = typeof location !== 'undefined' ? location.origin : '—';

  return `
<div style="padding:28px 24px 56px;max-width:640px;margin:0 auto;font-family:'Inter',sans-serif;">

  <!-- Cabecera -->
  <div style="display:flex;align-items:center;gap:16px;margin-bottom:28px;">
    <div style="width:52px;height:52px;border-radius:16px;background:#e0f2fe;
                display:flex;align-items:center;justify-content:center;flex-shrink:0;">
      <span class="material-symbols-outlined" style="font-size:28px;color:#0ea5e9;">terminal</span>
    </div>
    <div>
      <h1 style="font-size:22px;font-weight:900;color:#0f172a;margin:0 0 3px;">Consola técnica</h1>
      <p style="font-size:13px;color:#64748b;margin:0;">Diagnóstico y configuración del sistema</p>
    </div>
  </div>

  <!-- Sesión -->
  ${name ? `
  <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#0f172a;
              border-radius:12px;margin-bottom:20px;">
    <div style="width:32px;height:32px;border-radius:50%;background:${_avatarColor(name)};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#fff;flex-shrink:0;">${esc(name.slice(0,1).toUpperCase())}</div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:13px;font-weight:700;color:#e2e8f0;">${esc(name)}</div>
      <div style="font-size:11px;color:#64748b;">${esc(roleLabel)}${plaza?' · '+esc(plaza):''}</div>
    </div>
    <span style="padding:3px 10px;border-radius:100px;background:rgba(14,165,233,0.15);color:#38bdf8;font-size:11px;font-weight:700;font-family:monospace;">PROGRAMADOR</span>
  </div>` : ''}

  <!-- Info del entorno (estática, sin ejecución de código externo) -->
  <div style="background:#0f172a;border-radius:16px;padding:20px;margin-bottom:20px;font-family:'Courier New',monospace;">
    <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:12px;">Entorno</div>
    ${[
      ['APP_SHELL',   'mapa-v206 (Fase 6)'],
      ['ORIGIN',      origin],
      ['USER_AGENT',  navigator.userAgent.substring(0, 60) + '…'],
    ].map(([k, v]) => `
      <div style="display:flex;gap:12px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <span style="font-size:11px;color:#38bdf8;white-space:nowrap;min-width:120px;">${esc(k)}</span>
        <span style="font-size:11px;color:rgba(255,255,255,0.6);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(v)}</span>
      </div>`).join('')}
  </div>

  <!-- CTA -->
  <div style="background:linear-gradient(135deg,#0c4a6e,#075985);
              border-radius:20px;padding:28px;margin-bottom:20px;text-align:center;">
    <div style="width:56px;height:56px;border-radius:18px;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
      <span class="material-symbols-outlined" style="font-size:28px;color:#38bdf8;">terminal</span>
    </div>
    <h2 style="font-size:17px;font-weight:800;color:#fff;margin:0 0 8px;">Consola técnica completa</h2>
    <p style="font-size:13px;color:rgba(255,255,255,0.55);margin:0 0 20px;line-height:1.6;">
      Accede a logs, configuración avanzada y herramientas de diagnóstico.
    </p>
    <a href="/programador"
       style="display:inline-flex;align-items:center;gap:8px;padding:12px 24px;
              background:#38bdf8;color:#0c4a6e;border-radius:12px;text-decoration:none;
              font-size:14px;font-weight:800;box-shadow:0 4px 16px rgba(0,0,0,0.2);">
      <span class="material-symbols-outlined" style="font-size:18px;">open_in_new</span>
      Abrir consola técnica
    </a>
  </div>

  <!-- Funciones -->
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:20px;margin-bottom:16px;">
    <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:14px;">Funciones de la consola</div>
    <div style="display:grid;gap:8px;grid-template-columns:1fr 1fr;">
      ${[
        ['code',           'Editor de configuración'],
        ['bug_report',     'Diagnóstico de errores'],
        ['storage',        'Inspector de Firestore'],
        ['security',       'Auditoría de reglas'],
        ['settings',       'Config del sistema'],
        ['monitor_heart',  'Métricas de salud'],
      ].map(([fi, label]) => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#fff;border-radius:10px;border:1px solid #f1f5f9;">
          <span class="material-symbols-outlined" style="font-size:16px;color:#0ea5e9;flex-shrink:0;">${fi}</span>
          <span style="font-size:12px;color:#334155;font-weight:500;">${esc(label)}</span>
        </div>`).join('')}
    </div>
  </div>

  <!-- Nota -->
  <div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;
              background:#fefce8;border:1px solid #fef08a;border-radius:12px;">
    <span class="material-symbols-outlined" style="font-size:18px;color:#ca8a04;flex-shrink:0;margin-top:1px;">info</span>
    <div style="font-size:12px;color:#78350f;line-height:1.55;">
      La consola técnica completa está en /programador. Esta vista muestra información estática del entorno.
    </div>
  </div>
</div>`;
}

function _name(p)  { return p?.nombreCompleto || p?.nombre || p?.usuario || p?.email || ''; }
function _plaza(p) { return String(p?.plazaAsignada || p?.plaza || '').toUpperCase().trim(); }
function esc(v) { return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _avatarColor(s='') {
  const c=['#e53e3e','#dd6b20','#d69e2e','#38a169','#3182ce','#805ad5','#d53f8c','#00b5d8'];
  let h=0; for(const ch of String(s||'')) h=(h*31+ch.charCodeAt(0))|0;
  return c[Math.abs(h)%c.length];
}
