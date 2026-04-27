// ═══════════════════════════════════════════════════════════
//  /js/app/views/mapa.js
//  Vista bridge /app/mapa — Fase 7.
//
//  REGLAS:
//  - NO carga mapa.html ni js/views/mapa.js.
//  - NO crea listeners Firestore.
//  - NO usa iframe.
//  - El mapa operativo completo sigue en /mapa (legacy).
//  - Esta vista solo integra la ruta en el shell y ofrece CTA.
// ═══════════════════════════════════════════════════════════

import { getState } from '/js/app/app-state.js';
import { ROLE_LABELS } from '/js/shell/navigation.config.js';

export function mount({ container }) {
  const { profile, role, company } = getState();
  const params = new URLSearchParams(window.location.search);
  const q = String(params.get('q') || '').trim();

  const name      = profile?.nombreCompleto || profile?.nombre || profile?.email || 'Usuario';
  const firstName = name.split(' ')[0];
  const roleLabel = ROLE_LABELS[role] || role;
  const plaza     = getState().currentPlaza || profile?.plazaAsignada || '—';

  container.innerHTML = _html({ firstName, roleLabel, plaza, company, role, q });
}

export function unmount() {
  // Sin listeners ni timers — nada que limpiar.
}

// ── HTML ─────────────────────────────────────────────────────
function _html({ firstName, roleLabel, plaza, company, role, q }) {
  const isOperativo = [
    'SUPERVISOR', 'JEFE_PATIO', 'GERENTE_PLAZA', 'JEFE_REGIONAL',
    'CORPORATIVO_USER', 'JEFE_OPERACION', 'PROGRAMADOR', 'VENTAS', 'AUXILIAR'
  ].includes(role);

  return `
<div style="padding:28px 24px 56px;max-width:720px;margin:0 auto;font-family:'Inter',sans-serif;">

  <!-- Cabecera -->
  <div style="margin-bottom:28px;">
    <div style="display:inline-flex;align-items:center;gap:8px;padding:5px 12px;
                border-radius:100px;background:#dcfce7;margin-bottom:14px;">
      <span style="width:6px;height:6px;border-radius:50%;background:#22c55e;display:inline-block;"></span>
      <span style="font-size:11px;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.07em;">
        Mapa operativo
      </span>
    </div>
    <h1 style="font-size:24px;font-weight:900;color:#0f172a;margin:0 0 6px;line-height:1.2;">
      Mapa — integrado en App Shell
    </h1>
    <p style="font-size:14px;color:#64748b;margin:0;line-height:1.6;">
      ${esc(roleLabel)} · ${esc(plaza)} · ${esc(company)}
    </p>
  </div>

  <!-- Cards de estado -->
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px;margin-bottom:28px;">
    ${_card('location_city',  '#2b6954', '#dcfce7', 'Plaza activa',       plaza !== '—' ? esc(plaza) : 'Sin asignar')}
    ${_card('verified_user',  '#0ea5e9', '#e0f2fe', 'Acceso operativo',   isOperativo ? 'Habilitado' : 'Solo lectura')}
    ${_card('map',            '#22c55e', '#f0fdf4', 'Mapa legacy',        'Activo')}
    ${_card('rocket_launch',  '#8b5cf6', '#ede9fe', 'Próxima fase',       'Migración controlada')}
  </div>

  <!-- Nota informativa -->
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:16px 18px;
              margin-bottom:28px;display:flex;align-items:flex-start;gap:12px;">
    <span class="material-symbols-outlined" style="font-size:20px;color:#94a3b8;flex-shrink:0;margin-top:1px;">info</span>
    <div>
      <p style="font-size:13px;font-weight:600;color:#1e293b;margin:0 0 4px;">
        Vista de transición — Fase 7
      </p>
      <p style="font-size:13px;color:#64748b;margin:0;line-height:1.6;">
        El mapa operativo completo sigue disponible en modo legacy (<code style="background:#e2e8f0;padding:1px 5px;border-radius:4px;font-size:12px;">/mapa</code>).
        Esta vista integra la ruta <code style="background:#e2e8f0;padding:1px 5px;border-radius:4px;font-size:12px;">/app/mapa</code> al shell sin modificar
        el motor de mapa, Firestore ni la lógica operativa. La migración completa del mapa se hará en una fase posterior.
      </p>
      ${q ? `<p style="font-size:12px;color:#0f172a;margin:8px 0 0;">Búsqueda recibida desde dashboard: <strong>${esc(q)}</strong></p>` : ''}
    </div>
  </div>

  <!-- Funcionalidades del mapa (solo informativo) -->
  <h2 style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;
             letter-spacing:.08em;margin:0 0 12px;">
    Funcionalidades disponibles en el mapa
  </h2>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-bottom:32px;">
    ${[
      ['drag_pan',          'Arrastrar y soltar unidades'],
      ['directions_car',    'Gestión de flota en tiempo real'],
      ['notifications',     'Alertas operativas'],
      ['history',           'Historial de movimientos'],
      ['calculate',         'Cuadre integrado'],
      ['chat',              'Mensajería operativa'],
    ].map(([icon, label]) => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;
                  background:#fff;border:1px solid #f1f5f9;border-radius:10px;">
        <span class="material-symbols-outlined" style="font-size:17px;color:#64748b;">${icon}</span>
        <span style="font-size:12.5px;color:#334155;font-weight:500;">${esc(label)}</span>
      </div>
    `).join('')}
  </div>

  <!-- CTAs -->
  <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;">
    <!-- Primario: abre mapa legacy con recarga completa (intencional) -->
    <a href="/mapa"
       style="display:inline-flex;align-items:center;gap:10px;padding:14px 24px;
              border-radius:14px;background:linear-gradient(135deg,#1a7a56,#2b6954);
              color:#fff;text-decoration:none;font-size:14px;font-weight:700;
              box-shadow:0 4px 16px rgba(43,105,84,.3);">
      <span class="material-symbols-outlined" style="font-size:18px;">map</span>
      Abrir mapa operativo completo
    </a>
    <!-- Secundario: navega dentro del shell (sin recarga) -->
    <a data-app-route="/app/dashboard" href="/app/dashboard"
       style="display:inline-flex;align-items:center;gap:8px;padding:12px 20px;
              border-radius:14px;background:#f1f5f9;color:#475569;text-decoration:none;
              font-size:13px;font-weight:600;border:1px solid #e2e8f0;">
      <span class="material-symbols-outlined" style="font-size:16px;">arrow_back</span>
      Volver al dashboard
    </a>
  </div>

</div>
  `;
}

// ── Helpers ──────────────────────────────────────────────────
function _card(icon, color, bg, label, value) {
  return `
    <div style="padding:14px 16px;background:#fff;border:1px solid #f1f5f9;border-radius:14px;">
      <div style="width:34px;height:34px;border-radius:10px;background:${bg};
                  display:flex;align-items:center;justify-content:center;margin-bottom:10px;">
        <span class="material-symbols-outlined" style="font-size:18px;color:${color};">${icon}</span>
      </div>
      <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;
                  letter-spacing:.06em;margin-bottom:3px;">${esc(label)}</div>
      <div style="font-size:14px;font-weight:700;color:#1e293b;">${esc(value)}</div>
    </div>
  `;
}

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
