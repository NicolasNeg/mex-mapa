// ═══════════════════════════════════════════════════════════
//  /js/app/features/turnos/turnos-view-model.js
//  Helpers puros para la vista de turnos (sin Firestore).
// ═══════════════════════════════════════════════════════════

export const ROLES_ADMIN = new Set([
  'SUPERVISOR', 'JEFE_PATIO', 'GERENTE_PLAZA',
  'JEFE_REGIONAL', 'CORPORATIVO_USER', 'JEFE_OPERACION', 'PROGRAMADOR',
]);

export const LISTENER_ERROR = Object.freeze({
  INDEX_MISSING: 'INDEX_MISSING',
  OTHER: 'OTHER',
});

export function isTurnosAdmin(role) {
  return ROLES_ADMIN.has(String(role || '').toUpperCase());
}

export function isFirestoreIndexError(err) {
  const code = String(err?.code || '').toLowerCase();
  const message = String(err?.message || '').toLowerCase();
  return code === 'failed-precondition' || message.includes('requires an index');
}

export function listenerErrorFrom(err, source) {
  return {
    code: isFirestoreIndexError(err) ? LISTENER_ERROR.INDEX_MISSING : LISTENER_ERROR.OTHER,
    source,
    message: String(err?.message || err || 'Error desconocido'),
  };
}

export function normalizeUsuarioUid(u) {
  return String(u?.uid || u?.id || '').trim();
}

export function normalizePlazaUsuario(u) {
  return String(u?.plazaAsignada || u?.plaza || u?.plazaId || '').toUpperCase().trim();
}

export function nombreUsuario(u) {
  return String(u?.nombreCompleto || u?.nombre || u?.email || u?.id || '—')
    .split(/\s+/).slice(0, 2).join(' ');
}

export function initialUsuario(u) {
  return nombreUsuario(u).charAt(0).toUpperCase();
}

export function escHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatElapsed(ms) {
  const safe = Math.max(0, Number(ms) || 0);
  const h = Math.floor(safe / 3600000);
  const m = Math.floor((safe % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatDuration(ms) {
  return formatElapsed(ms);
}

export function turnoInicioDate(turno) {
  return turno?.inicio?.toDate?.() || new Date(Number(turno?.inicio) || Date.now());
}

export function turnoFinDate(turno) {
  return turno?.fin?.toDate?.() || new Date(Number(turno?.fin) || Date.now());
}

/** Lista de usuarios para grid: admin ve todos; no-admin con fallback fila propia. */
export function resolveUsuariosLista(usuarios, { isAdmin, uid, profile }) {
  const list = Array.isArray(usuarios) ? usuarios : [];
  if (isAdmin) return list;
  const own = list.filter(u => normalizeUsuarioUid(u) === uid);
  if (own.length || !uid) return own;
  return [{ uid, id: uid, ...profile }];
}

export function indexErrorBannerHtml(errors = {}) {
  const hit = Object.values(errors).find(e => e?.code === LISTENER_ERROR.INDEX_MISSING);
  if (!hit) return '';
  return `<div class="tu-banner tu-banner--index" role="alert">
    <span class="material-symbols-outlined">construction</span>
    <div>
      <strong>Índice de Firestore en construcción</strong>
      <p>Algunos datos (${escHtml(hit.source || 'consulta')}) no están disponibles todavía.
         Despliega los índices con <code>firebase deploy --only firestore:indexes</code>.</p>
    </div>
  </div>`;
}

export function usuariosPlazaEmptyMessage({ usuariosLoading, hasIndexError, hasUsuarios }) {
  if (usuariosLoading) return null;
  if (hasIndexError) {
    return 'No se pudo cargar la lista de colaboradores — índice de Firestore pendiente.';
  }
  if (!hasUsuarios) {
    return 'No hay usuarios registrados en esta plaza.';
  }
  return null;
}

/** Semana (lunes ISO) estrictamente anterior a la semana actual. */
export function esSemanaPasada(semana) {
  const actual = (() => {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  })();
  return String(semana || '') < actual;
}

/** Busca plantilla por id o por horas coincidentes. */
export function matchPlantilla(cell, plantillas = []) {
  if (!cell || cell.tipo !== 'NORMAL') return null;
  if (cell.plantillaId) {
    const byId = plantillas.find(p => p.id === cell.plantillaId);
    if (byId) return byId;
  }
  return plantillas.find(p => p.inicio === cell.inicio && p.fin === cell.fin) || null;
}

/** Minutos netos de celda (sin dependencia de Firestore). */
export function minutosEntre(inicio, fin, pausaMin = 0) {
  const parse = (s) => {
    const [h, m] = String(s || '0:0').split(':').map(Number);
    return (Number(h) || 0) * 60 + (Number(m) || 0);
  };
  const a = parse(inicio);
  const b = parse(fin);
  if (b <= a) return 0;
  return Math.max(0, b - a - Math.max(0, Number(pausaMin) || 0));
}

/** Total de minutos de una lista de horarios (semana visible). */
export function totalMinutosSemana(horarios = [], diasKeys = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom']) {
  let min = 0;
  for (const h of horarios) {
    for (const d of diasKeys) {
      const cell = h?.dias?.[d];
      if (cell?.tipo === 'NORMAL') {
        min += minutosEntre(cell.inicio, cell.fin, cell.pausaMin);
      }
    }
  }
  return min;
}
