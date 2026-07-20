// ═══════════════════════════════════════════════════════════
//  /domain/historial-log.model.js
//  Pure helpers to normalize operational change-history logs.
//  Prefer structured Firestore fields; parse legacy accion blobs.
// ═══════════════════════════════════════════════════════════

const ARROW = /\s*(?:→|->|➜|⇒)\s*/;

function _escapeRe(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Quita emojis de un texto (bitacora/log deben usar iconos, no emojis). */
export function stripEmoji(value) {
  return String(value || '')
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function _clean(value) {
  return stripEmoji(value)
    .replace(/\s*\|\s*Notas eliminadas/gi, '')
    .replace(/Notas reemplazadas/gi, 'Notas actualizadas')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function _upper(value) {
  return String(value || '').toUpperCase().trim();
}

/**
 * Extract Estado / Gas / Ubi transitions from a free-text change blob.
 * @returns {{ estadoAnterior: string, estadoNuevo: string, otros: string[] }}
 */
export function parseChangeParts(text) {
  const raw = _clean(text);
  if (!raw) return { estadoAnterior: '', estadoNuevo: '', otros: [] };

  const chunks = raw.split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean);
  let estadoAnterior = '';
  let estadoNuevo = '';
  const otros = [];

  for (const chunk of chunks) {
    const est = chunk.match(/^Estado\s+(.+?)\s*(?:→|->|➜|⇒)\s*(.+)$/i);
    if (est) {
      estadoAnterior = _clean(est[1]);
      estadoNuevo = _clean(est[2]);
      continue;
    }
    const gas = chunk.match(/^Gas(?:olina)?\s+(.+?)\s*(?:→|->|➜|⇒)\s*(.+)$/i);
    if (gas) {
      otros.push(`Gasolina ${_clean(gas[1])} → ${_clean(gas[2])}`);
      continue;
    }
    const ubi = chunk.match(/^Ubi(?:caci[oó]n)?\s+(.+?)\s*(?:→|->|➜|⇒)\s*(.+)$/i);
    if (ubi) {
      otros.push(`Ubicación ${_clean(ubi[1])} → ${_clean(ubi[2])}`);
      continue;
    }
    if (/^nota/i.test(chunk) || /^notas/i.test(chunk)) {
      otros.push(_clean(chunk));
      continue;
    }
    // Generic "A → B" when labelled as estado elsewhere is rare; keep as other
    otros.push(_clean(chunk));
  }

  return { estadoAnterior, estadoNuevo, otros };
}

/**
 * Pull MVA / entity id and a human cambio description from legacy accion text.
 * @returns {{ mva: string, cambio: string, estadoAnterior: string, estadoNuevo: string }}
 */
export function parseLegacyAccion(accion) {
  const text = _clean(accion);
  if (!text) {
    return { mva: '', cambio: '', estadoAnterior: '', estadoNuevo: '' };
  }

  // INSERTADO: MVA / EXTERNO INSERTADO: MVA
  let m = text.match(/^(?:EXTERNO\s+)?INSERTADO:\s*([A-Z0-9][\w-]*)\s*$/i);
  if (m) {
    return {
      mva: _upper(m[1]),
      cambio: /externo/i.test(text) ? 'Unidad externa insertada' : 'Unidad insertada',
      estadoAnterior: '',
      estadoNuevo: ''
    };
  }

  // SE ELIMINÓ LA UNIDAD: MVA
  m = text.match(/^SE\s+ELIMIN[OÓ]\s+LA\s+UNIDAD:\s*([A-Z0-9][\w-]*)\s*$/i);
  if (m) {
    return { mva: _upper(m[1]), cambio: 'Unidad eliminada', estadoAnterior: '', estadoNuevo: '' };
  }

  // KM DISCREPANCIA / KM CORREGIDO: MVA · old ➜ new (...)
  m = text.match(/^KM\s+(DISCREPANCIA|CORREGIDO):\s*([A-Z0-9][\w-]*)\s*[·•]\s*(.+)$/i);
  if (m) {
    const kind = m[1].toUpperCase() === 'DISCREPANCIA' ? 'Discrepancia de km' : 'Km corregido';
    return {
      mva: _upper(m[2]),
      cambio: `${kind}: ${_clean(m[3]).replace(ARROW, ' → ')}`,
      estadoAnterior: '',
      estadoNuevo: ''
    };
  }

  // MVA (revisión sin cambios)
  m = text.match(/^([A-Z0-9][\w-]*)\s*\(\s*revisi[oó]n\s+sin\s+cambios\s*\)$/i);
  if (m) {
    return {
      mva: _upper(m[1]),
      cambio: 'Revisión sin cambios',
      estadoAnterior: '',
      estadoNuevo: ''
    };
  }

  // MVA: Estado X → Y | Gas … | Ubi …
  m = text.match(/^([A-Z0-9][\w-]*)\s*:\s*(.+)$/i);
  if (m) {
    const mva = _upper(m[1]);
    const parts = parseChangeParts(m[2]);
    const cambioBits = [];
    if (parts.estadoAnterior || parts.estadoNuevo) cambioBits.push('Cambio de estado');
    cambioBits.push(...parts.otros);
    return {
      mva,
      cambio: cambioBits.length ? cambioBits.join(' · ') : _clean(m[2]),
      estadoAnterior: parts.estadoAnterior,
      estadoNuevo: parts.estadoNuevo
    };
  }

  // COLA / generic "LABEL: MVA → …" or "LABEL: MVA · …"
  m = text.match(/^(.+?):\s*([A-Z0-9][\w-]*)\s*(?:[·•]|→|->|➜)?\s*(.*)$/i);
  if (m && m[2] && m[2].length <= 16) {
    const label = _clean(m[1]);
    const rest = _clean(m[3]);
    const parts = parseChangeParts(rest);
    return {
      mva: _upper(m[2]),
      cambio: rest
        ? (parts.otros.length || parts.estadoAnterior
          ? [label, ...parts.otros].filter(Boolean).join(' · ')
          : `${label}: ${rest.replace(ARROW, ' → ')}`)
        : label,
      estadoAnterior: parts.estadoAnterior,
      estadoNuevo: parts.estadoNuevo
    };
  }

  // Fallback: try leading token as MVA if it looks like one
  m = text.match(/^([A-Z0-9][\w-]{1,15})\b\s*(.*)$/);
  if (m && /[0-9]/.test(m[1])) {
    const rest = _clean(m[2]).replace(/^[:·•\-–—]\s*/, '');
    const parts = parseChangeParts(rest);
    return {
      mva: _upper(m[1]),
      cambio: rest || text,
      estadoAnterior: parts.estadoAnterior,
      estadoNuevo: parts.estadoNuevo
    };
  }

  return { mva: '', cambio: text, estadoAnterior: '', estadoNuevo: '' };
}

/**
 * Normalize a raw log row (Firestore or API) for table display.
 * Structured fields win; legacy accion is parsed as fallback.
 *
 * @returns {{
 *   mva: string,
 *   cambio: string,
 *   estadoAnterior: string,
 *   estadoNuevo: string,
 *   estadoLabel: string,
 *   tipo: string,
 *   autor: string,
 *   fecha: string,
 *   timestamp: *,
 *   raw: object
 * }}
 */
export function normalizeHistorialLog(raw = {}) {
  const tipo = _upper(raw.tipo || 'OTRO');
  const autor = _clean(raw.autor || raw.usuario || 'Sistema') || 'Sistema';
  const accion = raw.accion || raw.detalles || '';
  const legacy = parseLegacyAccion(accion);

  const mva = _upper(
    raw.mva || raw.objetivo || raw.referencia || legacy.mva || ''
  );

  let estadoAnterior = _clean(raw.estadoAnterior || '');
  let estadoNuevo = _clean(raw.estadoNuevo || '');
  if (!estadoAnterior && !estadoNuevo) {
    estadoAnterior = legacy.estadoAnterior;
    estadoNuevo = legacy.estadoNuevo;
  }

  // Structured `cambio` preferred; else legacy; strip leading MVA: if still present
  let cambio = _clean(raw.cambio || '');
  if (!cambio) cambio = legacy.cambio;
  if (!cambio) cambio = _clean(accion);
  if (mva && cambio) {
    cambio = cambio.replace(new RegExp(`^${_escapeRe(mva)}\\s*:\\s*`, 'i'), '').trim();
  }
  // If cambio is only the estado arrow text, prefer a short label
  if (estadoAnterior && estadoNuevo) {
    const onlyEstado = new RegExp(
      `^Estado\\s+${_escapeRe(estadoAnterior)}\\s*(?:→|->|➜)\\s+${_escapeRe(estadoNuevo)}$`,
      'i'
    );
    if (onlyEstado.test(cambio) || cambio === `${estadoAnterior} → ${estadoNuevo}`) {
      cambio = 'Cambio de estado';
    }
  }
  if (!cambio) cambio = 'Cambio registrado';

  const estadoLabel = (estadoAnterior || estadoNuevo)
    ? `${estadoAnterior || '—'} → ${estadoNuevo || '—'}`
    : '';

  return {
    mva: mva || '—',
    cambio,
    estadoAnterior,
    estadoNuevo,
    estadoLabel,
    tipo,
    autor,
    fecha: raw.fecha || '',
    timestamp: raw.timestamp || 0,
    raw
  };
}

/** Best-effort MVA extraction for write-time auto-stamp. */
export function extractMvaFromAccion(accion) {
  return parseLegacyAccion(accion).mva || '';
}
