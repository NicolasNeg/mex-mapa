// ═══════════════════════════════════════════════════════════
//  /js/app/views/dashboard.js
//  Vista /app/dashboard — Panel principal post-login (Fase 6).
//
//  Links con data-app-route → cargan dentro del shell sin recargar.
//  Links con href normal   → navegación real (legacy).
//  /mapa siempre con href normal — NO migrado.
// ═══════════════════════════════════════════════════════════

import { getState } from '/js/app/app-state.js';
import { ROLE_LABELS } from '/js/shell/navigation.config.js';

let _cleanup = null;

export function mount({ container }) {
  const { profile, role, company } = getState();

  const name      = profile?.nombreCompleto || profile?.nombre || profile?.email || 'Usuario';
  const roleLabel = ROLE_LABELS[role] || role;
  const plaza     = profile?.plazaAsignada || '—';
  const hora      = _greeting();

  container.innerHTML = _html({ name, roleLabel, plaza, company, hora, role });
  _cleanup = null;
}

export function unmount() {
  if (typeof _cleanup === 'function') _cleanup();
  _cleanup = null;
}

// ── HTML ─────────────────────────────────────────────────────
function _html({ name, roleLabel, plaza, company, hora, role }) {
  const firstName = name.split(' ')[0];

  const ADMIN_ROLES = ['SUPERVISOR','JEFE_PATIO','GERENTE_PLAZA','JEFE_REGIONAL',
                       'CORPORATIVO_USER','JEFE_OPERACION','PROGRAMADOR'];
  const isAdmin      = ADMIN_ROLES.includes(role);
  const isProgrammer = role === 'PROGRAMADOR';

  // ── Módulos integrados en App Shell (sin recarga) ──────────
  const SHELL_MODULES = [
    { appRoute: '/app/profile',          label: 'Mi perfil',          icon: 'person',               color: '#64748b', bg: '#f1f5f9' },
    { appRoute: '/app/mensajes',         label: 'Mensajes',           icon: 'chat',                 color: '#8b5cf6', bg: '#ede9fe' },
    { appRoute: '/app/cola-preparacion', label: 'Cola de preparación',icon: 'fact_check',           color: '#2b6954', bg: '#dcfce7' },
    { appRoute: '/app/incidencias',      label: 'Incidencias',        icon: 'warning',              color: '#f97316', bg: '#fff7ed' },
    { appRoute: '/app/cuadre',           label: 'Cuadre',             icon: 'calculate',            color: '#ef4444', bg: '#fef2f2',
      roles: ['VENTAS','SUPERVISOR','JEFE_PATIO','GERENTE_PLAZA','JEFE_REGIONAL','CORPORATIVO_USER','JEFE_OPERACION','PROGRAMADOR'] },
    ...(isAdmin      ? [{ appRoute: '/app/admin',      label: 'Panel admin',   icon: 'admin_panel_settings', color: '#8b5cf6', bg: '#ede9fe' }] : []),
    ...(isProgrammer ? [{ appRoute: '/app/programador', label: 'Consola técnica', icon: 'terminal',          color: '#0ea5e9', bg: '#e0f2fe' }] : []),
  ].filter(m => !m.roles || m.roles.includes(role));

  // ── Módulos legacy seguros (recarga completa) ──────────────
  const LEGACY_MODULES = [
    { route: '/mapa',    label: 'Mapa operativo',  icon: 'map',   color: '#2b6954', bg: '#dcfce7', note: 'Módulo principal' },
    { route: '/home',    label: 'Home legacy',     icon: 'home',  color: '#0ea5e9', bg: '#e0f2fe', note: 'Vista anterior' },
  ];

  // ── Debug / roadmap: solo PROGRAMADOR o modo debug ─────────
  const showRoadmap = role === 'PROGRAMADOR' ||
    (() => { try { return localStorage.getItem('mex.debug.mode') === '1'; } catch { return false; } })();

  return `
<div style="padding:28px 24px 56px;max-width:800px;margin:0 auto;font-family:'Inter',sans-serif;">

  <!-- Saludo -->
  <div style="margin-bottom:28px;">
    <p style="font-size:13px;color:#64748b;margin:0 0 4px;font-weight:500;">${esc(hora)}</p>
    <h1 style="font-size:26px;font-weight:900;color:#0f172a;margin:0 0 4px;line-height:1.2;">
      Hola, ${esc(firstName)} 👋
    </h1>
    <p style="font-size:14px;color:#64748b;margin:0;">
      ${esc(roleLabel)} · ${esc(plaza)} · ${esc(company)}
    </p>
  </div>

  <!-- ── Módulos integrados en App Shell ── -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
    <h2 style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;margin:0;">
      Módulos integrados en App Shell
    </h2>
    <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;
                 border-radius:100px;background:#dcfce7;color:#16a34a;font-size:10.5px;font-weight:700;">
      <span style="width:5px;height:5px;border-radius:50%;background:#22c55e;"></span>
      Sin recarga
    </span>
  </div>
  <div style="display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));margin-bottom:28px;">
    ${SHELL_MODULES.map(({ appRoute, label, icon, color, bg }) => `
      <a data-app-route="${esc(appRoute)}" href="${esc(appRoute)}"
         style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:#fff;
                border:1px solid #f1f5f9;border-radius:14px;text-decoration:none;
                transition:box-shadow 0.12s,border-color 0.12s;"
         onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,0.06)';this.style.borderColor='#e2e8f0';"
         onmouseout="this.style.boxShadow='none';this.style.borderColor='#f1f5f9';">
        <div style="width:38px;height:38px;border-radius:11px;background:${bg};
                    display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <span class="material-symbols-outlined" style="font-size:20px;color:${color};">${icon}</span>
        </div>
        <span style="font-size:13px;font-weight:600;color:#1e293b;">${esc(label)}</span>
      </a>
    `).join('')}
  </div>

  <!-- ── Módulos legacy seguros ── -->
  <h2 style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;
             letter-spacing:0.08em;margin:0 0 12px;">
    Módulos operativos legacy
  </h2>
  <div style="display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));margin-bottom:28px;">
    ${LEGACY_MODULES.map(({ route, label, icon, color, bg, note }) => `
      <a href="${esc(route)}"
         style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:#fff;
                border:1px dashed #e2e8f0;border-radius:14px;text-decoration:none;
                transition:box-shadow 0.12s,border-color 0.12s;"
         onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,0.04)';this.style.borderColor='#cbd5e1';"
         onmouseout="this.style.boxShadow='none';this.style.borderColor='#e2e8f0';">
        <div style="width:38px;height:38px;border-radius:11px;background:${bg};
                    display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <span class="material-symbols-outlined" style="font-size:20px;color:${color};">${icon}</span>
        </div>
        <div>
          <div style="font-size:13px;font-weight:600;color:#1e293b;">${esc(label)}</div>
          <div style="font-size:10.5px;color:#94a3b8;margin-top:1px;">${esc(note)}</div>
        </div>
      </a>
    `).join('')}
  </div>

  <!-- ── Estado de migración (solo PROGRAMADOR o debug) ── -->
  ${showRoadmap ? `
  <div style="background:linear-gradient(135deg,#07111f,#0f2042);border-radius:16px;padding:20px;">
    <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.4);
                text-transform:uppercase;letter-spacing:0.07em;margin-bottom:14px;">
      Progreso de migración al App Shell
    </div>
    ${[
      ['✅', 'Fase 1', 'Componentes shell standalone'],
      ['✅', 'Fase 2', 'App Shell experimental en /app'],
      ['✅', 'Fase 3', 'Router interno + History API'],
      ['✅', 'Fase 4', 'Profile como primera vista real'],
      ['✅', 'Fase 5', 'Mensajes — bridge hacia chat completo'],
      ['✅', 'Fase 6', 'App Shell como destino post-login + bridges secundarios'],
      ['⏳', 'Fase 7', 'Migrar mapa (módulo crítico, al final)'],
    ].map(([status, phase, desc]) => `
      <div style="display:flex;align-items:flex-start;gap:12px;padding:8px 0;
                  border-bottom:1px solid rgba(255,255,255,0.05);">
        <span style="font-size:13px;flex-shrink:0;margin-top:1px;">${status}</span>
        <div>
          <span style="font-size:12px;font-weight:700;color:#2ecc71;">${esc(phase)}</span>
          <span style="font-size:12px;color:rgba(255,255,255,0.45);margin-left:6px;">${esc(desc)}</span>
        </div>
      </div>
    `).join('')}
  </div>` : ''}

</div>
  `;
}

// ── Utilidades ───────────────────────────────────────────────
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}
