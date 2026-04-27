// ═══════════════════════════════════════════════════════════
//  /js/app/views/dashboard.js
//  Vista /app/dashboard — Panel de acceso rápido.
//
//  Patrón de vista:
//    mount({ container, navigate }) — inyecta HTML en container
//    unmount()                      — limpia listeners / timers
//
//  No toca el sidebar ni el header (el router se encarga).
//  Links internos: <a data-app-route="/app/...">
//  Links legacy:   <a href="/mapa"> (navegación real)
// ═══════════════════════════════════════════════════════════

import { getState } from '/js/app/app-state.js';
import { ROLE_LABELS } from '/js/shell/navigation.config.js';

// ── API pública ──────────────────────────────────────────────

/** @type {() => void | null} */
let _cleanup = null;

/**
 * @param {{ container: HTMLElement, navigate: (path: string) => void }} opts
 */
export function mount({ container, navigate }) {
  const state   = getState();
  const profile = state.profile;
  const role    = state.role;
  const company = state.company;

  const name      = profile?.nombreCompleto || profile?.nombre || profile?.email || 'Usuario';
  const roleLabel = ROLE_LABELS[role] || role;
  const plaza     = profile?.plazaAsignada || '—';
  const hora      = _greeting();

  container.innerHTML = _html({ name, roleLabel, plaza, company, hora, role });

  // Bind cards de rutas legacy (click tracking si se necesita en el futuro)
  // Los clicks en [data-app-route] los intercepta el router globalmente.
  // No hay listeners adicionales en esta vista.
  _cleanup = null;
}

export function unmount() {
  if (typeof _cleanup === 'function') _cleanup();
  _cleanup = null;
}

// ── HTML ─────────────────────────────────────────────────────
function _html({ name, roleLabel, plaza, company, hora, role }) {
  const firstName = name.split(' ')[0];

  // Rutas rápidas disponibles para todos los roles.
  // appRoute: carga sin recargar dentro del App Shell (usa data-app-route).
  // route:    navega con href normal (recarga completa a ruta legacy).
  const QUICK_LINKS = [
    { route: '/home',             label: 'Dashboard',          icon: 'home',                  color: '#0ea5e9', bg: '#e0f2fe' },
    { route: '/mapa',             label: 'Mapa operativo',     icon: 'map',                   color: '#2b6954', bg: '#dcfce7' },
    { route: '/mensajes',         label: 'Mensajes',           icon: 'chat',                  color: '#8b5cf6', bg: '#ede9fe' },
    { route: '/cola-preparacion', label: 'Cola preparación',   icon: 'format_list_bulleted',  color: '#f59e0b', bg: '#fef9c3' },
    { route: '/cuadre',           label: 'Cuadre',             icon: 'calculate',             color: '#ef4444', bg: '#fef2f2' },
    { route: '/incidencias',      label: 'Incidencias',        icon: 'warning',               color: '#f97316', bg: '#fff7ed' },
    { appRoute: '/app/profile',   label: 'Mi perfil',          icon: 'person',                color: '#64748b', bg: '#f1f5f9' },
  ];

  // Rutas admin (solo roles con acceso)
  const ADMIN_ROLES = ['SUPERVISOR','JEFE_PATIO','GERENTE_PLAZA','JEFE_REGIONAL','CORPORATIVO_USER','JEFE_OPERACION','PROGRAMADOR'];
  const showAdmin = ADMIN_ROLES.includes(role);

  return `
<div style="padding:28px 24px 56px;max-width:760px;margin:0 auto;font-family:'Inter',sans-serif;">

  <!-- Saludo -->
  <div style="margin-bottom:28px;">
    <p style="font-size:13px;color:#64748b;margin:0 0 4px;font-weight:500;">${esc(hora)}</p>
    <h1 style="font-size:28px;font-weight:900;color:#0f172a;margin:0 0 4px;line-height:1.2;">
      Hola, ${esc(firstName)} 👋
    </h1>
    <p style="font-size:14px;color:#64748b;margin:0;">
      ${esc(roleLabel)} · ${esc(plaza)} · ${esc(company)}
    </p>
  </div>

  <!-- Accesos rápidos -->
  <h2 style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 12px;">
    Accesos rápidos
  </h2>
  <div style="display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));margin-bottom:32px;">
    ${QUICK_LINKS.map(({ route, appRoute, label, icon, color, bg }) => `
      <a ${appRoute ? `data-app-route="${esc(appRoute)}" href="${esc(appRoute)}"` : `href="${esc(route)}"`}
         style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:#fff;border:1px solid #f1f5f9;border-radius:14px;text-decoration:none;transition:box-shadow 0.12s,border-color 0.12s;"
         onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,0.06)';this.style.borderColor='#e2e8f0';"
         onmouseout="this.style.boxShadow='none';this.style.borderColor='#f1f5f9';">
        <div style="width:38px;height:38px;border-radius:11px;background:${bg};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <span class="material-symbols-outlined" style="font-size:20px;color:${color};">${icon}</span>
        </div>
        <span style="font-size:13.5px;font-weight:600;color:#1e293b;">${esc(label)}</span>
      </a>
    `).join('')}
    ${showAdmin ? `
      <a href="${esc('/gestion')}"
         style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:#fff;border:1px solid #f1f5f9;border-radius:14px;text-decoration:none;transition:box-shadow 0.12s,border-color 0.12s;"
         onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,0.06)';this.style.borderColor='#e2e8f0';"
         onmouseout="this.style.boxShadow='none';this.style.borderColor='#f1f5f9';">
        <div style="width:38px;height:38px;border-radius:11px;background:#fef2f2;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <span class="material-symbols-outlined" style="font-size:20px;color:#ef4444;">admin_panel_settings</span>
        </div>
        <span style="font-size:13.5px;font-weight:600;color:#1e293b;">Panel admin</span>
      </a>
    ` : ''}
  </div>

  <!-- Roadmap del shell (informativo) -->
  <h2 style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 12px;">
    Estado de la migración
  </h2>
  <div style="background:linear-gradient(135deg,#07111f,#0f2042);border-radius:16px;padding:20px;">
    ${[
      ['✅', 'Fase 1', 'Componentes shell standalone'],
      ['✅', 'Fase 2', 'App Shell experimental en /app'],
      ['✅', 'Fase 3', 'Router interno + History API'],
      ['⏳', 'Fase 4', 'Migrar profile, mensajes, cola-preparacion'],
      ['⏳', 'Fase 5', 'Migrar admin con subrutas /app/admin/**'],
      ['⏳', 'Fase 6', 'Migrar mapa (al final)'],
      ['⏳', 'Fase 7', 'Redirects graduales y limpieza']
    ].map(([status, phase, desc]) => `
      <div style="display:flex;align-items:flex-start;gap:12px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
        <span style="font-size:13px;flex-shrink:0;margin-top:1px;">${status}</span>
        <div>
          <span style="font-size:12px;font-weight:700;color:#2ecc71;">${esc(phase)}</span>
          <span style="font-size:12px;color:rgba(255,255,255,0.5);margin-left:6px;">${esc(desc)}</span>
        </div>
      </div>
    `).join('')}
  </div>

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
