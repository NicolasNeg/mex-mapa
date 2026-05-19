// ═══════════════════════════════════════════════════════════
//  /js/programador/shell.js  —  Shell del Panel Programador
//
//  Shell propio con sidebar + header oscuro para el rol PROGRAMADOR.
//  Gestión de empresas (tenants), diagnóstico técnico y logs.
// ═══════════════════════════════════════════════════════════

let _root = null;
let _profile = null;
let _currentSection = '';
let _unsubCurrentView = null;

const SECTIONS = {
  empresas: { label: 'Empresas',    icon: 'domain'    },
  tecnico:  { label: 'Diagnóstico', icon: 'terminal'  },
};

export function mountProgramadorShell({ profile, user, root }) {
  _root   = root;
  _profile = profile;

  root.innerHTML = _shellHtml(profile);
  _bindShellEvents();
  _navigateTo('empresas');
}

// ── HTML del shell ────────────────────────────────────────

function _shellHtml(profile) {
  const initials = _initials(profile);
  const name = String(profile.nombreCompleto || profile.nombre || profile.email || 'Programador').trim();
  const shortName = name.split(' ')[0];

  return `
<div id="progShell" style="
  display:flex; height:100dvh; min-height:0;
  background:#070d16; font-family:Inter,sans-serif;
  color:#fff; overflow:hidden;
">
  <!-- ── Sidebar ──────────────────────────────────── -->
  <aside style="
    width:220px; flex-shrink:0;
    background:#0b1524;
    border-right:1px solid rgba(255,255,255,0.06);
    display:flex; flex-direction:column;
  ">
    <!-- Branding -->
    <div style="
      padding:18px 16px 14px;
      border-bottom:1px solid rgba(255,255,255,0.06);
    ">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="
          width:34px; height:34px; border-radius:9px;
          background:linear-gradient(135deg,#6366f1,#818cf8);
          display:flex; align-items:center; justify-content:center; flex-shrink:0;
        ">
          <span style="font-size:15px;font-weight:900;color:#fff;">M</span>
        </div>
        <div>
          <div style="font-size:11px;font-weight:800;color:#818cf8;text-transform:uppercase;letter-spacing:.07em;line-height:1.2;">MEX Platform</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.3);line-height:1.4;">Panel Programador</div>
        </div>
      </div>
    </div>

    <!-- Nav -->
    <nav id="progNav" style="flex:1;padding:10px 8px;display:flex;flex-direction:column;gap:2px;">
      ${Object.entries(SECTIONS).map(([key, s]) => `
      <button data-prog-nav="${_esc(key)}" type="button" class="prog-nav-btn">
        <span class="material-symbols-outlined prog-nav-icon">${_esc(s.icon)}</span>
        <span>${_esc(s.label)}</span>
      </button>`).join('')}
    </nav>

    <!-- User footer -->
    <div style="padding:10px 8px 14px;border-top:1px solid rgba(255,255,255,0.06);">
      <div style="padding:8px;display:flex;align-items:center;gap:9px;margin-bottom:6px;">
        <div style="
          width:30px;height:30px;border-radius:50%;
          background:#1e2d42;
          display:flex;align-items:center;justify-content:center;
          flex-shrink:0;font-size:11px;font-weight:800;color:#818cf8;
        ">${_esc(initials)}</div>
        <div style="min-width:0;flex:1;">
          <div style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.85);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(shortName)}</div>
          <div style="font-size:10px;color:#6366f1;font-weight:600;">PROGRAMADOR</div>
        </div>
      </div>
      <button id="progLogoutBtn" type="button" style="
        width:100%;display:flex;align-items:center;gap:8px;
        padding:8px 10px;border-radius:8px;border:none;
        background:transparent;color:rgba(255,255,255,0.35);
        font-size:12px;font-family:Inter,sans-serif;font-weight:600;
        cursor:pointer;transition:background .15s,color .15s;
      ">
        <span class="material-symbols-outlined" style="font-size:16px;">logout</span>
        <span>Cerrar sesión</span>
      </button>
    </div>
  </aside>

  <!-- ── Main area ─────────────────────────────────── -->
  <main style="flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0;">
    <!-- Header -->
    <header style="
      height:52px;flex-shrink:0;
      background:#070d16;
      border-bottom:1px solid rgba(255,255,255,0.06);
      display:flex;align-items:center;justify-content:space-between;
      padding:0 20px;gap:12px;
    ">
      <h1 id="progHeaderTitle" style="
        margin:0;font-size:15px;font-weight:700;color:#fff;
      ">Empresas</h1>

      <div style="display:flex;align-items:center;gap:8px;">
        <span style="
          font-size:10px;font-weight:800;text-transform:uppercase;
          background:rgba(99,102,241,0.12);color:#818cf8;
          border:1px solid rgba(99,102,241,0.22);border-radius:5px;
          padding:3px 8px;letter-spacing:.04em;
        ">SUPERADMIN</span>
        <a href="/app/dashboard" style="
          display:flex;align-items:center;gap:5px;
          padding:6px 10px;border-radius:8px;
          background:rgba(255,255,255,0.05);
          border:1px solid rgba(255,255,255,0.08);
          color:rgba(255,255,255,0.55);
          text-decoration:none;font-size:12px;font-weight:600;
          transition:background .15s;
        " title="Ver App como PROGRAMADOR">
          <span class="material-symbols-outlined" style="font-size:14px;">open_in_new</span>
          <span>Ver App</span>
        </a>
      </div>
    </header>

    <!-- Content -->
    <div id="progContent" style="
      flex:1;overflow:auto;background:#070d16;
    "></div>
  </main>
</div>

<style>
  .prog-nav-btn {
    display:flex;align-items:center;gap:10px;width:100%;
    padding:9px 10px;border-radius:8px;border:none;
    background:transparent;color:rgba(255,255,255,0.42);
    font-size:13px;font-family:Inter,sans-serif;font-weight:600;
    cursor:pointer;text-align:left;transition:background .14s,color .14s;
  }
  .prog-nav-btn:hover { background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.78); }
  .prog-nav-btn.active { background:rgba(99,102,241,0.14);color:#a5b4fc; }
  .prog-nav-icon { font-size:18px; }
  .prog-nav-btn.active .prog-nav-icon { color:#6366f1; }
</style>`;
}

// ── Eventos ───────────────────────────────────────────────

function _bindShellEvents() {
  document.getElementById('progNav')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-prog-nav]');
    if (!btn) return;
    _navigateTo(btn.dataset.progNav);
  });

  document.getElementById('progLogoutBtn')?.addEventListener('click', async () => {
    try { await window._auth?.signOut(); } catch (_) {}
    window.location.replace('/login');
  });
}

// ── Navegación interna ────────────────────────────────────

async function _navigateTo(section) {
  if (_currentSection === section) return;
  _currentSection = section;

  // Actualizar nav
  document.querySelectorAll('[data-prog-nav]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.progNav === section);
  });

  // Actualizar título header
  const titleEl = document.getElementById('progHeaderTitle');
  if (titleEl) titleEl.textContent = SECTIONS[section]?.label || section;

  // Unmount vista anterior
  if (typeof _unsubCurrentView === 'function') {
    try { _unsubCurrentView(); } catch (_) {}
    _unsubCurrentView = null;
  }

  const contentEl = document.getElementById('progContent');
  if (!contentEl) return;
  contentEl.innerHTML = '<div style="padding:40px;text-align:center;color:rgba(255,255,255,0.25);font-size:13px;">Cargando…</div>';

  try {
    if (section === 'empresas') {
      const mod = await import('/js/programador/views/empresas.js');
      await mod.mount({ container: contentEl, profile: _profile });
      _unsubCurrentView = mod.unmount ?? null;
    } else if (section === 'tecnico') {
      const mod = await import('/js/app/views/programador.js');
      await mod.mount({ container: contentEl, navigate: r => { window.location.href = r; } });
      _unsubCurrentView = mod.unmount ?? null;
    }
  } catch (err) {
    console.error('[prog/shell] Error cargando sección:', section, err);
    contentEl.innerHTML = `
      <div style="padding:40px;text-align:center;">
        <div style="color:#f87171;font-size:13px;margin-bottom:8px;">Error cargando vista</div>
        <code style="color:rgba(255,255,255,0.3);font-size:11px;">${_esc(String(err?.message || err))}</code>
      </div>`;
  }
}

// ── Utils ─────────────────────────────────────────────────

function _initials(profile) {
  const name = String(profile.nombreCompleto || profile.nombre || profile.email || '').trim();
  const parts = name.replace(/[._@]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] || 'P').slice(0, 2).toUpperCase();
}

function _esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
