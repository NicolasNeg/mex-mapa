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
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0E\uFE0F\u200D\u20E3\u{E0020}-\u{E007F}]/gu, '')
    .replace(/[✓✗✔✘✕✖☑☒]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Material Symbol sugerido para representar un evento operativo. */
export function historialIconName(value, tipo = '') {
  const text = stripEmoji(`${tipo} ${value}`).toUpperCase();
  if (/CHECKLIST|REVISI[OÓ]N|AUDITOR|VALIDACI[OÓ]N/.test(text)) return 'fact_check';
  if (/COLA|PREPARACI[OÓ]N|REORDEN/.test(text)) return 'format_list_bulleted';
  if (/NOTA|COMENTARIO|OBSERVACI[OÓ]N/.test(text)) return 'edit_note';
  if (/KILOMETRAJE|\bKM\b/.test(text)) return 'speed';
  if (/GASOLINA|COMBUSTIBLE|CARGA DE GAS/.test(text)) return 'local_gas_station';
  if (/ADJUNTO|ARCHIVO|DOCUMENTO/.test(text)) return 'attach_file';
  if (/INCIDENCIA|URGENTE|ERROR|ALERTA/.test(text)) return 'report_problem';
  if (/BAJA|ELIMIN|LIMBO/.test(text)) return 'delete_outline';
  if (/ALTA|INSERT|AGREG/.test(text)) return 'add_circle';
  if (/MOV|TRASLAD|UBICACI[OÓ]N|ORIGEN|DESTINO|CAJ[OÓ]N/.test(text)) return 'swap_horiz';
  if (/ESTADO|ACTUALIZ|CAMBIO/.test(text)) return 'sync_alt';
  return 'history';
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

function _firstText(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = _clean(value);
    if (text) return text;
  }
  return '';
}

function _finiteKm(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const normalized = typeof value === 'number'
      ? value
      : Number(String(value).replace(/[^0-9.-]/g, ''));
    if (Number.isFinite(normalized) && normalized >= 0) return normalized;
  }
  return null;
}

function _normalizeMotivoSalida(value) {
  const motivo = _upper(value);
  return motivo === 'RENTA' || motivo === 'OTRO' ? motivo : '';
}

function _structuredChanges(raw = {}) {
  if (!Array.isArray(raw.cambios)) return [];
  return raw.cambios
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const campo = _upper(item.campo || item.field).toLowerCase();
      if (!campo) return null;
      return {
        campo,
        anterior: _clean(item.anterior ?? item.oldValue ?? ''),
        nuevo: _clean(item.nuevo ?? item.newValue ?? '')
      };
    })
    .filter(Boolean);
}

function _changeForField(changes, field) {
  const wanted = _upper(field).toLowerCase();
  return changes.find(item => item.campo === wanted) || null;
}

function _transitionFromText(text, labels) {
  const labelPattern = labels.map(_escapeRe).join('|');
  const match = _clean(text).match(
    new RegExp(`(?:^|[|\u00b7])\\s*(?:[A-Z0-9][\\w-]*\\s*:\\s*)?(?:${labelPattern})\\s+(.+?)\\s*(?:\\u2192|->|\\u279c|\\u21d2)\\s*(.+?)(?=\\s*[|\\u00b7]|$)`, 'i')
  );
  return match
    ? { anterior: _clean(match[1]), nuevo: _clean(match[2]) }
    : { anterior: '', nuevo: '' };
}

function _kmFromText(text) {
  const match = _clean(text).match(/\bkm(?:\s+de\s+(?:entrada|salida))?\s*:?\s*([0-9][0-9.,]*)/i);
  return match ? _finiteKm(match[1]) : null;
}

function _motivoFromText(text) {
  const match = _clean(text).match(/\bmotivo\s*:?\s*(RENTA|OTRO)\b/i);
  return match ? _normalizeMotivoSalida(match[1]) : '';
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
  const cambios = _structuredChanges(raw);
  const estadoCambio = _changeForField(cambios, 'estado');
  const ubicacionCambio = _changeForField(cambios, 'ubicacion');
  const notaCambio = _changeForField(cambios, 'notas');

  const mva = _upper(
    raw.mva || raw.objetivo || raw.referencia || legacy.mva || ''
  );

  let estadoAnterior = _firstText(raw.estadoAnterior, estadoCambio?.anterior);
  let estadoNuevo = _firstText(raw.estadoNuevo, estadoCambio?.nuevo);
  if (!estadoAnterior && !estadoNuevo) {
    estadoAnterior = legacy.estadoAnterior;
    estadoNuevo = legacy.estadoNuevo;
  }

  const rawChangeText = [raw.cambio, accion].filter(Boolean).join(' | ');
  const legacyUbicacion = _transitionFromText(rawChangeText, ['Ubi', 'Ubicacion', 'Ubicación']);
  const ubicacionAnterior = _firstText(
    raw.ubicacionAnterior,
    raw.ubicacionOrigen,
    ubicacionCambio?.anterior,
    legacyUbicacion.anterior
  );
  const ubicacionNueva = _firstText(
    raw.ubicacionNueva,
    raw.ubicacionDestino,
    ubicacionCambio?.nuevo,
    legacyUbicacion.nuevo
  );
  const notaAnterior = _firstText(raw.notaAnterior, notaCambio?.anterior);
  const notaNueva = _firstText(raw.notaNueva, raw.notasNuevas, notaCambio?.nuevo);
  const km = _finiteKm(
    raw.km,
    raw.kmEntrada,
    raw.kmIngreso,
    raw.kmSalida,
    raw.kilometraje,
    _kmFromText(rawChangeText)
  );
  const motivoSalida = _normalizeMotivoSalida(
    raw.motivoSalida || raw.motivoBaja || raw.motivo || _motivoFromText(rawChangeText)
  );

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
    ubicacionAnterior,
    ubicacionNueva,
    notaAnterior,
    notaNueva,
    km,
    motivoSalida,
    cambios,
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
