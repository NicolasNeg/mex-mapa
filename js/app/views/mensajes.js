// ═══════════════════════════════════════════════════════════
//  /js/app/views/mensajes.js
//  Vista /app/mensajes — Bridge hacia el chat interno.
//
//  El chat completo vive en mapa.js / mensajes.html (chatv2).
//  Migrar el chat completo aquí requeriría tocar mapa.js,
//  que es el módulo más crítico del sistema.
//
//  Esta vista:
//  - Muestra información del usuario desde app-state.
//  - No crea listeners de auth ni de Firestore.
//  - Redirige al chat completo con un CTA claro.
//  - Es 100% segura: sin side-effects en unmount.
//
//  Cuando el chat sea migrado, reemplazar este archivo.
// ═══════════════════════════════════════════════════════════

import { getState } from '/js/app/app-state.js';
import { ROLE_LABELS } from '/js/shell/navigation.config.js';

// ── API pública ──────────────────────────────────────────────

/**
 * @param {{ container: HTMLElement, navigate: (path: string) => void, shell?: any }} ctx
 */
export function mount({ container }) {
  const { profile, role } = getState();
  container.innerHTML = _html(profile, role);
}

export function unmount() {
  // Sin listeners: nada que limpiar.
}

// ── Render ────────────────────────────────────────────────────
function _html(profile, role) {
  const name      = profile?.nombreCompleto || profile?.nombre || profile?.usuario || profile?.email || 'Usuario';
  const roleLabel = ROLE_LABELS[role] || role;
  const plaza     = _normalizePlaza(profile?.plazaAsignada || profile?.plaza || '');
  const initial   = name.slice(0, 1).toUpperCase() || 'U';
  const avatarUrl = _avatarUrl(profile);
  const avatarBg  = avatarUrl ? '#0f172a' : _avatarColor(name);

  const avatarContent = avatarUrl
    ? `<img src="${esc(avatarUrl)}" alt="Avatar"
            style="width:100%;height:100%;object-fit:cover;border-radius:50%;"
            onerror="this.style.display='none';this.parentElement.textContent='${esc(initial)}';">`
    : esc(initial);

  return `
<div style="padding:28px 24px 56px;max-width:640px;margin:0 auto;font-family:'Inter',sans-serif;">

  <!-- Cabecera de la vista -->
  <div style="display:flex;align-items:center;gap:16px;margin-bottom:32px;">
    <div style="width:52px;height:52px;border-radius:16px;background:#ede9fe;
                display:flex;align-items:center;justify-content:center;flex-shrink:0;">
      <span class="material-symbols-outlined" style="font-size:28px;color:#8b5cf6;">forum</span>
    </div>
    <div>
      <h1 style="font-size:22px;font-weight:900;color:#0f172a;margin:0 0 3px;">Mensajes internos</h1>
      <p style="font-size:13px;color:#64748b;margin:0;">Chat del equipo operativo</p>
    </div>
  </div>

  <!-- Sesión activa -->
  <div style="display:flex;align-items:center;gap:14px;padding:16px;background:#fff;
              border:1px solid #f1f5f9;border-radius:16px;margin-bottom:20px;">
    <div style="width:44px;height:44px;border-radius:50%;background:${avatarBg};
                display:flex;align-items:center;justify-content:center;font-size:18px;
                font-weight:800;color:#fff;flex-shrink:0;overflow:hidden;">
      ${avatarContent}
    </div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:14px;font-weight:700;color:#0f172a;
                  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${esc(name)}
      </div>
      <div style="font-size:12px;color:#64748b;margin-top:2px;">
        ${esc(roleLabel)}${plaza ? ` · ${esc(plaza)}` : ''}
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:5px;padding:4px 10px;
                border-radius:100px;background:#f0fdf4;">
      <span style="width:6px;height:6px;border-radius:50%;background:#22c55e;display:inline-block;"></span>
      <span style="font-size:11px;font-weight:700;color:#16a34a;">En sesión</span>
    </div>
  </div>

  <!-- CTA principal -->
  <div style="background:linear-gradient(135deg,#4c1d95,#6d28d9 60%,#7c3aed);
              border-radius:20px;padding:28px;margin-bottom:20px;text-align:center;">
    <div style="width:56px;height:56px;border-radius:18px;background:rgba(255,255,255,0.15);
                display:flex;align-items:center;justify-content:center;margin:0 auto 16px;backdrop-filter:blur(8px);">
      <span class="material-symbols-outlined" style="font-size:28px;color:#fff;">chat</span>
    </div>
    <h2 style="font-size:17px;font-weight:800;color:#fff;margin:0 0 8px;">
      Chat del equipo disponible
    </h2>
    <p style="font-size:13px;color:rgba(255,255,255,0.65);margin:0 0 20px;line-height:1.6;">
      El chat completo — conversaciones, archivos, búsqueda y filtros —
      está disponible en la vista de mensajes integrada.
    </p>
    <a href="/mensajes"
       style="display:inline-flex;align-items:center;gap:8px;padding:12px 24px;
              background:#fff;color:#5b21b6;border-radius:12px;text-decoration:none;
              font-size:14px;font-weight:800;box-shadow:0 4px 16px rgba(0,0,0,0.2);">
      <span class="material-symbols-outlined" style="font-size:18px;">open_in_new</span>
      Abrir mensajes completos
    </a>
  </div>

  <!-- Qué incluye la vista completa -->
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:20px;margin-bottom:20px;">
    <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;
                letter-spacing:0.07em;margin-bottom:14px;">
      Funciones del chat completo
    </div>
    <div style="display:grid;gap:10px;grid-template-columns:1fr 1fr;">
      ${[
        ['chat', 'Conversaciones directas'],
        ['group', 'Mensajes grupales'],
        ['attach_file', 'Archivos e imágenes'],
        ['search', 'Búsqueda de mensajes'],
        ['notifications', 'Notificaciones push'],
        ['mic', 'Mensajes de voz'],
      ].map(([icon, label]) => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;
                    background:#fff;border-radius:10px;border:1px solid #f1f5f9;">
          <span class="material-symbols-outlined" style="font-size:16px;color:#8b5cf6;flex-shrink:0;">${icon}</span>
          <span style="font-size:12px;color:#334155;font-weight:500;">${esc(label)}</span>
        </div>
      `).join('')}
    </div>
  </div>

  <!-- Nota sobre la migración -->
  <div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;
              background:#fefce8;border:1px solid #fef08a;border-radius:12px;">
    <span class="material-symbols-outlined" style="font-size:18px;color:#ca8a04;flex-shrink:0;margin-top:1px;">info</span>
    <div>
      <div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:3px;">
        Integración en progreso
      </div>
      <div style="font-size:12px;color:#78350f;line-height:1.55;">
        El chat completo se integrará en el App Shell en una fase posterior.
        Por ahora, usa la vista completa desde el botón de arriba.
      </div>
    </div>
  </div>

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

function _avatarUrl(profile) {
  return String(
    profile?.avatarUrl || profile?.avatarURL || profile?.photoURL ||
    profile?.fotoURL   || profile?.profilePhotoUrl || ''
  ).trim();
}

function _avatarColor(str = '') {
  const colors = ['#e53e3e','#dd6b20','#d69e2e','#38a169','#3182ce','#805ad5','#d53f8c','#00b5d8'];
  let hash = 0;
  for (const ch of String(str || '')) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}
