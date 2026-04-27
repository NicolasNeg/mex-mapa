// ═══════════════════════════════════════════════════════════
//  /js/app/views/incidencias.js — Bridge view
//  El módulo completo vive en js/views/incidencias.js.
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

  return _bridge({
    icon:        'warning',
    iconColor:   '#f97316',
    iconBg:      '#fff7ed',
    gradFrom:    '#7c2d12',
    gradTo:      '#9a3412',
    accentColor: '#fb923c',
    title:       'Incidencias',
    subtitle:    'Registro y seguimiento de incidencias operativas',
    legacyRoute: '/incidencias',
    ctaLabel:    'Abrir incidencias',
    user:        { name, roleLabel, plaza },
    features: [
      ['report',           'Registro de incidencias'],
      ['search',           'Búsqueda y filtros'],
      ['assignment_late',  'Estado y prioridad'],
      ['person',           'Asignación de responsable'],
      ['history',          'Historial completo'],
      ['check_circle',     'Cierre y resolución'],
    ],
    note: 'El módulo completo de incidencias con registro en tiempo real está disponible en la ruta legacy.'
  });
}

function _bridge({ icon, iconColor, iconBg, gradFrom, gradTo,
                   title, subtitle, legacyRoute, ctaLabel, user, features, note }) {
  return `
<div style="padding:28px 24px 56px;max-width:640px;margin:0 auto;font-family:'Inter',sans-serif;">
  <div style="display:flex;align-items:center;gap:16px;margin-bottom:28px;">
    <div style="width:52px;height:52px;border-radius:16px;background:${iconBg};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
      <span class="material-symbols-outlined" style="font-size:28px;color:${iconColor};">${icon}</span>
    </div>
    <div>
      <h1 style="font-size:22px;font-weight:900;color:#0f172a;margin:0 0 3px;">${esc(title)}</h1>
      <p style="font-size:13px;color:#64748b;margin:0;">${esc(subtitle)}</p>
    </div>
  </div>
  ${user.name ? _userChip(user, iconColor) : ''}
  <div style="background:linear-gradient(135deg,${gradFrom},${gradTo});border-radius:20px;padding:28px;margin-bottom:20px;text-align:center;">
    <div style="width:56px;height:56px;border-radius:18px;background:rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
      <span class="material-symbols-outlined" style="font-size:28px;color:#fff;">${icon}</span>
    </div>
    <h2 style="font-size:17px;font-weight:800;color:#fff;margin:0 0 8px;">${esc(title)} disponible</h2>
    <p style="font-size:13px;color:rgba(255,255,255,0.65);margin:0 0 20px;line-height:1.6;">Accede al módulo completo con todas las funciones operativas.</p>
    <a href="${esc(legacyRoute)}"
       style="display:inline-flex;align-items:center;gap:8px;padding:12px 24px;background:#fff;color:${gradFrom};border-radius:12px;text-decoration:none;font-size:14px;font-weight:800;box-shadow:0 4px 16px rgba(0,0,0,0.2);">
      <span class="material-symbols-outlined" style="font-size:18px;">open_in_new</span>${esc(ctaLabel)}
    </a>
  </div>
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:20px;margin-bottom:16px;">
    <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:14px;">Funciones del módulo</div>
    <div style="display:grid;gap:8px;grid-template-columns:1fr 1fr;">
      ${features.map(([fi, label]) => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#fff;border-radius:10px;border:1px solid #f1f5f9;">
          <span class="material-symbols-outlined" style="font-size:16px;color:${iconColor};flex-shrink:0;">${fi}</span>
          <span style="font-size:12px;color:#334155;font-weight:500;">${esc(label)}</span>
        </div>`).join('')}
    </div>
  </div>
  <div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;background:#fefce8;border:1px solid #fef08a;border-radius:12px;">
    <span class="material-symbols-outlined" style="font-size:18px;color:#ca8a04;flex-shrink:0;margin-top:1px;">info</span>
    <div style="font-size:12px;color:#78350f;line-height:1.55;">${esc(note)}</div>
  </div>
</div>`;
}

function _userChip({ name, roleLabel, plaza }, accentColor) {
  return `<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#fff;border:1px solid #f1f5f9;border-radius:12px;margin-bottom:20px;">
    <div style="width:32px;height:32px;border-radius:50%;background:${_avatarColor(name)};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#fff;flex-shrink:0;">${esc(name.slice(0,1).toUpperCase())}</div>
    <div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:700;color:#0f172a;">${esc(name)}</div><div style="font-size:11px;color:#64748b;">${esc(roleLabel)}${plaza?' · '+esc(plaza):''}</div></div>
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
