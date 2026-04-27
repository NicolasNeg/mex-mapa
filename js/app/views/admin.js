// ═══════════════════════════════════════════════════════════
//  /js/app/views/admin.js — Bridge view
//  El panel completo vive en js/views/gestion.js / gestion.html.
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

  // Admin tabs que el panel completo tiene
  const adminTabs = [
    { tab: 'usuarios',    label: 'Usuarios',    route: '/gestion?tab=usuarios',    icon: 'group' },
    { tab: 'roles',       label: 'Roles',       route: '/gestion?tab=roles',       icon: 'shield' },
    { tab: 'plazas',      label: 'Plazas',      route: '/gestion?tab=plazas',      icon: 'location_city' },
    { tab: 'catalogos',   label: 'Catálogos',   route: '/gestion?tab=catalogos',   icon: 'list_alt' },
    { tab: 'solicitudes', label: 'Solicitudes', route: '/gestion?tab=solicitudes', icon: 'assignment' },
  ];

  return `
<div style="padding:28px 24px 56px;max-width:640px;margin:0 auto;font-family:'Inter',sans-serif;">

  <!-- Cabecera -->
  <div style="display:flex;align-items:center;gap:16px;margin-bottom:28px;">
    <div style="width:52px;height:52px;border-radius:16px;background:#ede9fe;
                display:flex;align-items:center;justify-content:center;flex-shrink:0;">
      <span class="material-symbols-outlined" style="font-size:28px;color:#8b5cf6;">admin_panel_settings</span>
    </div>
    <div>
      <h1 style="font-size:22px;font-weight:900;color:#0f172a;margin:0 0 3px;">Panel de administración</h1>
      <p style="font-size:13px;color:#64748b;margin:0;">Gestión de usuarios, roles y configuración</p>
    </div>
  </div>

  <!-- Sesión -->
  ${name ? `
  <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#fff;
              border:1px solid #f1f5f9;border-radius:12px;margin-bottom:20px;">
    <div style="width:32px;height:32px;border-radius:50%;background:${_avatarColor(name)};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#fff;flex-shrink:0;">${esc(name.slice(0,1).toUpperCase())}</div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:13px;font-weight:700;color:#0f172a;">${esc(name)}</div>
      <div style="font-size:11px;color:#64748b;">${esc(roleLabel)}${plaza?' · '+esc(plaza):''}</div>
    </div>
    <span style="padding:3px 10px;border-radius:100px;background:#ede9fe;color:#8b5cf6;font-size:11px;font-weight:700;">ADMIN</span>
  </div>` : ''}

  <!-- CTA principal -->
  <div style="background:linear-gradient(135deg,#2e1065,#4c1d95 60%,#5b21b6);
              border-radius:20px;padding:28px;margin-bottom:20px;">
    <h2 style="font-size:17px;font-weight:800;color:#fff;margin:0 0 8px;">Panel administrativo completo</h2>
    <p style="font-size:13px;color:rgba(255,255,255,0.65);margin:0 0 20px;line-height:1.6;">
      Administra usuarios, roles, plazas y catálogos del sistema operativo.
    </p>
    <a href="/gestion"
       style="display:inline-flex;align-items:center;gap:8px;padding:12px 24px;
              background:#fff;color:#4c1d95;border-radius:12px;text-decoration:none;
              font-size:14px;font-weight:800;box-shadow:0 4px 16px rgba(0,0,0,0.2);">
      <span class="material-symbols-outlined" style="font-size:18px;">open_in_new</span>
      Abrir panel completo
    </a>
  </div>

  <!-- Acceso rápido a secciones -->
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:20px;margin-bottom:16px;">
    <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;
                letter-spacing:0.07em;margin-bottom:14px;">Acceso directo por sección</div>
    <div style="display:grid;gap:8px;">
      ${adminTabs.map(({ route, label, icon }) => `
        <a href="${esc(route)}"
           style="display:flex;align-items:center;gap:12px;padding:10px 14px;
                  background:#fff;border:1px solid #f1f5f9;border-radius:12px;
                  text-decoration:none;transition:border-color 0.12s;"
           onmouseover="this.style.borderColor='#e2e8f0';" onmouseout="this.style.borderColor='#f1f5f9';">
          <span class="material-symbols-outlined" style="font-size:18px;color:#8b5cf6;">${icon}</span>
          <span style="font-size:13px;font-weight:600;color:#1e293b;flex:1;">${esc(label)}</span>
          <span style="font-size:12px;color:#94a3b8;">↗</span>
        </a>`).join('')}
    </div>
  </div>

  <!-- Nota -->
  <div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;
              background:#fefce8;border:1px solid #fef08a;border-radius:12px;">
    <span class="material-symbols-outlined" style="font-size:18px;color:#ca8a04;flex-shrink:0;margin-top:1px;">info</span>
    <div style="font-size:12px;color:#78350f;line-height:1.55;">
      El panel de administración completo con gestión en tiempo real está en la ruta legacy /gestion.
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
