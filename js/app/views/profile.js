// ═══════════════════════════════════════════════════════════
//  /js/app/views/profile.js
//  Vista /app/profile — Perfil de usuario (solo lectura).
//
//  Datos: tomados de app-state (perfil ya cargado en boot).
//  Sin auth listeners nuevos. Sin imports del profile legacy.
//  Sin escrituras a Firestore en esta fase.
//
//  "Abrir perfil completo" → /profile (legacy, con edición).
// ═══════════════════════════════════════════════════════════

import { getState } from '/js/app/app-state.js';
import { ROLE_LABELS } from '/js/shell/navigation.config.js';

// ── Estado de la vista ───────────────────────────────────────
let _cleanupFns = [];

// ── API pública ──────────────────────────────────────────────

/**
 * @param {{ container: HTMLElement, navigate: (path: string) => void, shell?: any }} ctx
 */
export function mount({ container, navigate }) {
  const { profile, role, company } = getState();

  if (!profile) {
    _renderFallback(container);
    return;
  }

  container.innerHTML = _html(profile, role, company);
  _bindEvents(container, navigate);
}

export function unmount() {
  _cleanupFns.forEach(fn => fn());
  _cleanupFns = [];
}

// ── Render ────────────────────────────────────────────────────
function _html(profile, role, company) {
  const name       = profile.nombreCompleto || profile.nombre || profile.usuario || profile.email || 'Usuario';
  const email      = profile.email || profile.id || '';
  const roleLabel  = ROLE_LABELS[role] || profile.roleLabel || role;
  const plaza      = _normalizePlaza(profile.plazaAsignada || profile.plaza || '');
  const plazasExtra = _safeArray(profile.plazasPermitidas).map(_normalizePlaza).filter(Boolean);
  const avatarUrl  = _avatarUrl(profile);
  const isOnline   = _isOnline(profile);
  const lastSeen   = _formatRelativeTime(profile.lastSeenAt || profile.lastActiveAt);
  const status     = String(profile.status || 'ACTIVO').toUpperCase();
  const isAdmin    = Boolean(profile.isAdmin || profile.isGlobal);
  const modules    = _availableModules(profile, role);
  const allPlazas  = [plaza, ...plazasExtra].filter(Boolean);

  const avatarContent = avatarUrl
    ? `<img src="${esc(avatarUrl)}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"
            onerror="this.style.display='none';this.parentElement.textContent='${esc(name.slice(0, 1).toUpperCase())}';">`
    : esc(name.slice(0, 1).toUpperCase() || 'U');

  const avatarBg = avatarUrl ? '#0f172a' : _avatarColor(name);

  return `
<div style="padding:28px 24px 56px;max-width:680px;margin:0 auto;font-family:'Inter',sans-serif;">

  <!-- Hero -->
  <div style="display:flex;align-items:center;gap:20px;margin-bottom:28px;flex-wrap:wrap;">
    <!-- Avatar -->
    <div style="width:80px;height:80px;border-radius:50%;background:${avatarBg};
                display:flex;align-items:center;justify-content:center;
                font-size:32px;font-weight:800;color:#fff;flex-shrink:0;overflow:hidden;
                border:3px solid rgba(255,255,255,0.1);">
      ${avatarContent}
    </div>

    <!-- Info -->
    <div style="flex:1;min-width:0;">
      <h1 style="font-size:22px;font-weight:900;color:#0f172a;margin:0 0 4px;
                 white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${esc(name)}
      </h1>
      <p style="font-size:13px;color:#64748b;margin:0 0 8px;
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${esc(email)}
      </p>
      <!-- Badges -->
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${_badge(roleLabel, '#2b6954', '#dcfce7')}
        ${plaza ? _badge(plaza, '#0ea5e9', '#e0f2fe') : ''}
        ${_badge(
          isOnline ? 'En línea' : `Visto ${lastSeen}`,
          isOnline ? '#16a34a' : '#64748b',
          isOnline ? '#f0fdf4' : '#f8fafc',
          isOnline ? '●&nbsp;' : ''
        )}
        ${status !== 'ACTIVO' ? _badge(status, '#ef4444', '#fef2f2') : ''}
        ${isAdmin ? _badge('Admin', '#8b5cf6', '#ede9fe') : ''}
      </div>
    </div>
  </div>

  <!-- Grid de datos -->
  <div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));margin-bottom:24px;">
    ${_infoCard('shield', 'Rol', roleLabel, '#8b5cf6', '#ede9fe')}
    ${_infoCard('location_on', 'Plaza principal', plaza || '—', '#0ea5e9', '#e0f2fe')}
    ${_infoCard('business', 'Empresa', company || 'MAPA', '#f59e0b', '#fef9c3')}
    ${_infoCard('schedule', 'Último acceso', lastSeen, '#64748b', '#f8fafc')}
  </div>

  <!-- Plazas permitidas -->
  ${allPlazas.length > 1 ? `
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:16px;margin-bottom:16px;">
    <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:10px;">
      Plazas con acceso
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">
      ${allPlazas.map(p => _badge(p, '#0ea5e9', '#e0f2fe')).join('')}
    </div>
  </div>
  ` : ''}

  <!-- Módulos disponibles -->
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:16px;margin-bottom:24px;">
    <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:10px;">
      Módulos disponibles
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">
      ${modules.map(m => _badge(m, '#2b6954', '#dcfce7')).join('')}
    </div>
  </div>

  <!-- CTA — perfil completo -->
  <div style="background:linear-gradient(135deg,#07111f,#0f2042);border-radius:16px;padding:20px;
              display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
    <div>
      <div style="font-size:13px;font-weight:700;color:rgba(255,255,255,0.9);margin-bottom:4px;">
        ¿Necesitas editar tu perfil?
      </div>
      <div style="font-size:12px;color:rgba(255,255,255,0.45);line-height:1.5;">
        Cambiar foto, teléfono, preferencias y notificaciones.
      </div>
    </div>
    <a href="/profile"
       style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;
              background:#2ecc71;color:#07111f;border-radius:10px;text-decoration:none;
              font-size:13px;font-weight:700;white-space:nowrap;flex-shrink:0;">
      <span class="material-symbols-outlined" style="font-size:16px;">open_in_new</span>
      Abrir perfil completo
    </a>
  </div>

</div>
  `;
}

function _renderFallback(container) {
  container.innerHTML = `
    <div style="padding:48px 24px;max-width:480px;margin:0 auto;text-align:center;font-family:'Inter',sans-serif;">
      <div style="width:64px;height:64px;border-radius:20px;background:#fef2f2;display:flex;
                  align-items:center;justify-content:center;margin:0 auto 20px;">
        <span class="material-symbols-outlined" style="font-size:32px;color:#ef4444;">person_off</span>
      </div>
      <h2 style="font-size:18px;font-weight:800;color:#0f172a;margin:0 0 8px;">
        No se pudo cargar el perfil
      </h2>
      <p style="font-size:13px;color:#64748b;margin:0 0 24px;line-height:1.6;">
        El perfil no está disponible dentro de App Shell en este momento.
      </p>
      <a href="/profile"
         style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;
                border-radius:10px;background:#0f172a;color:#fff;text-decoration:none;
                font-size:13px;font-weight:600;">
        <span class="material-symbols-outlined" style="font-size:16px;">open_in_new</span>
        Abrir perfil completo
      </a>
    </div>
  `;
}

function _bindEvents(_container, _navigate) {
  // Vista read-only: sin listeners adicionales.
  // Links usan <a href> normales → navegación real al hacer click.
}

// ── Componentes HTML ─────────────────────────────────────────
function _badge(text, color, bg, prefix = '') {
  return `<span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:100px;
                        background:${bg};color:${color};font-size:11.5px;font-weight:700;
                        white-space:nowrap;">${prefix}${esc(text)}</span>`;
}

function _infoCard(icon, label, value, iconColor, iconBg) {
  return `
    <div style="background:#fff;border:1px solid #f1f5f9;border-radius:14px;padding:14px;">
      <div style="width:32px;height:32px;border-radius:9px;background:${iconBg};
                  display:flex;align-items:center;justify-content:center;margin-bottom:8px;">
        <span class="material-symbols-outlined" style="font-size:17px;color:${iconColor};">${icon}</span>
      </div>
      <div style="font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;
                  letter-spacing:0.07em;margin-bottom:3px;">${esc(label)}</div>
      <div style="font-size:13px;color:#1e293b;font-weight:700;
                  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
           title="${esc(value)}">${esc(value)}</div>
    </div>
  `;
}

// ── Utilidades ───────────────────────────────────────────────
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _normalizePlaza(v) {
  return String(v || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function _safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function _avatarUrl(profile) {
  return String(
    profile.avatarUrl || profile.avatarURL || profile.photoURL ||
    profile.fotoURL   || profile.profilePhotoUrl || ''
  ).trim();
}

function _isOnline(profile) {
  const lastSeen = _coerceTs(profile?.lastSeenAt || profile?.lastActiveAt);
  return profile?.isOnline === true && lastSeen > 0 && (Date.now() - lastSeen) < 120_000;
}

function _coerceTs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function _formatRelativeTime(raw) {
  const ts = _coerceTs(raw);
  if (!ts) return 'sin registro';
  const diff = Date.now() - ts;
  const min  = Math.floor(diff / 60_000);
  const hr   = Math.floor(diff / 3_600_000);
  const day  = Math.floor(diff / 86_400_000);
  if (diff < 60_000)   return 'ahora mismo';
  if (min < 60)        return `hace ${min} min`;
  if (hr < 24)         return `hace ${hr} h`;
  if (day === 1)       return 'ayer';
  if (day < 7)         return `hace ${day} días`;
  try {
    return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(ts));
  } catch (_) {
    return 'hace tiempo';
  }
}

function _avatarColor(str = '') {
  const colors = ['#e53e3e','#dd6b20','#d69e2e','#38a169','#3182ce','#805ad5','#d53f8c','#00b5d8'];
  let hash = 0;
  for (const ch of String(str || '')) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

function _availableModules(profile, role) {
  const modules = ['Dashboard', 'Mapa', 'Mensajes', 'Cuadres', 'Perfil'];
  const adminRoles = ['SUPERVISOR','JEFE_PATIO','GERENTE_PLAZA','JEFE_REGIONAL','CORPORATIVO_USER','JEFE_OPERACION','PROGRAMADOR'];
  if (adminRoles.includes(role) || profile.isAdmin || profile.isGlobal) modules.push('Panel Admin');
  if (role === 'PROGRAMADOR') modules.push('Consola');
  if (profile.isGlobal) modules.push('Global');
  return [...new Set(modules)];
}
