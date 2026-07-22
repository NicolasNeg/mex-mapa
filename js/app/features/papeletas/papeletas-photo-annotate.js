/**
 * Fullscreen photo annotator for papeletas (v3).
 * Reuses diagram tools: freehand pen + typed damage stamps over a photo bitmap.
 */

import {
  DAMAGE_TYPES,
  DAMAGE_TYPE_LABELS,
  DAMAGE_SEVERITIES,
  DAMAGE_SEVERITY_LABELS,
  createDamageMark,
  nextDisplayNumber,
} from '/domain/papeleta.model.js';
import { DIAGRAM_LEGEND } from '/js/app/features/papeletas/papeletas-diagram.js';

const TOOL_GLYPH = Object.freeze({
  dent: '0',
  glass: '*',
  missing: 'F',
  scratch: '—',
  deep: '=',
  hit: '•',
  other: '?',
});

/**
 * @param {{
 *   photoUrl: string,
 *   photoPath?: string,
 *   strokes?: object[],
 *   marks?: object[],
 *   title?: string,
 *   onSave?: (payload: { overlayBlob: Blob, strokes: object[], marks: object[], compositeBlob: Blob }) => void | Promise<void>,
 *   onCancel?: () => void,
 * }} opts
 * @returns {{ close: () => void, promise: Promise<object|null> }}
 */
export function openPhotoAnnotator(opts = {}) {
  const photoUrl = String(opts.photoUrl || '').trim();
  if (!photoUrl) throw new Error('photoUrl requerido');

  let strokes = Array.isArray(opts.strokes) ? opts.strokes.map(_cloneStroke) : [];
  let marks = Array.isArray(opts.marks) ? opts.marks.map((m) => ({ ...m })) : [];
  let tool = 'pen';
  let drawing = false;
  let current = null;
  let gesture = null;
  let closed = false;
  let resolvePromise = null;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });

  const root = document.createElement('div');
  root.className = 'pap-annotate';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML = `
    <div class="pap-annotate__bar">
      <button type="button" class="pap-btn pap-btn--ghost pap-btn--tiny" data-ann-act="cancel" title="Cerrar">
        <span class="material-symbols-outlined">close</span>
      </button>
      <strong class="pap-annotate__title">${_esc(opts.title || 'Anotar foto')}</strong>
      <div class="pap-annotate__actions">
        <button type="button" class="pap-btn pap-btn--ghost pap-btn--tiny ${tool === 'pen' ? 'is-tool-on' : ''}" data-ann-tool="pen" title="Lápiz">
          <span class="material-symbols-outlined">draw</span>
        </button>
        <button type="button" class="pap-btn pap-btn--ghost pap-btn--tiny ${tool === 'mark' ? 'is-tool-on' : ''}" data-ann-tool="mark" title="Marca">
          <span class="material-symbols-outlined">add_location</span>
        </button>
        <button type="button" class="pap-btn pap-btn--ghost pap-btn--tiny" data-ann-act="undo" title="Deshacer">
          <span class="material-symbols-outlined">undo</span>
        </button>
        <button type="button" class="pap-btn pap-btn--ghost pap-btn--tiny" data-ann-act="clear" title="Limpiar">
          <span class="material-symbols-outlined">ink_eraser</span>
        </button>
        <button type="button" class="pap-btn pap-btn--primary pap-btn--tiny" data-ann-act="save">Guardar</button>
      </div>
    </div>
    <div class="pap-annotate__stage" data-ann-stage>
      <img class="pap-annotate__bg" alt="" draggable="false" crossorigin="anonymous"/>
      <canvas class="pap-annotate__canvas"></canvas>
    </div>
    <div class="pap-annotate__legend" role="toolbar" aria-label="Leyenda">
      ${DIAGRAM_LEGEND.map((l) => `
        <button type="button" class="pap-diagram__stamp" data-ann-tool="${_esc(l.tool)}" title="${_esc(l.label)}">
          <b>${_esc(l.mark)}</b><span>${_esc(l.label)}</span>
        </button>
      `).join('')}
      <span class="pap-diagram__tip">Lápiz o marca tipada sobre la foto. Guardar persiste el overlay.</span>
    </div>
  `;
  document.body.appendChild(root);
  document.body.classList.add('pap-annotate-open');

  const bg = root.querySelector('.pap-annotate__bg');
  const canvas = root.querySelector('.pap-annotate__canvas');
  const ctx = canvas.getContext('2d');
  const stage = root.querySelector('[data-ann-stage]');
  bg.src = photoUrl;

  function setTool(next) {
    tool = next || 'pen';
    root.querySelectorAll('[data-ann-tool]').forEach((btn) => {
      btn.classList.toggle('is-tool-on', btn.getAttribute('data-ann-tool') === tool);
    });
    canvas.style.cursor = tool === 'pen' ? 'crosshair' : 'cell';
  }
  setTool(tool);

  function resize() {
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const natW = bg.naturalWidth || rect.width || 1;
    const natH = bg.naturalHeight || rect.height || 1;
    const fit = Math.min(rect.width / natW, rect.height / natH);
    const cssW = Math.max(120, Math.floor(natW * fit));
    const cssH = Math.max(120, Math.floor(natH * fit));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    bg.style.width = `${cssW}px`;
    bg.style.height = `${cssH}px`;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint();
  }

  function paint() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes) {
      if (s.type === 'stamp') {
        _paintStamp(ctx, s, w, h);
        continue;
      }
      if (!s.points?.length) continue;
      ctx.strokeStyle = s.color || '#dc2626';
      ctx.lineWidth = s.width || 2.8;
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const x = p.x * w;
        const y = p.y * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    for (const d of marks) {
      _paintMark(ctx, d, w, h);
    }
  }

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    if (!src) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (src.clientX - r.left) / (r.width || 1))),
      y: Math.min(1, Math.max(0, (src.clientY - r.top) / (r.height || 1))),
    };
  }

  function beginStroke(p) {
    drawing = true;
    current = { type: 'stroke', color: '#dc2626', width: 2.8, points: [p] };
    strokes.push(current);
    paint();
  }

  function start(e) {
    e.preventDefault();
    const p = pos(e);
    gesture = { tool, startPos: p, moved: false };
    if (tool === 'pen') beginStroke(p);
  }

  function move(e) {
    if (!gesture) return;
    e.preventDefault();
    const p = pos(e);
    gesture.moved = true;
    if (drawing && current) {
      current.points.push(p);
      paint();
    }
  }

  async function end() {
    const g = gesture;
    gesture = null;
    if (!g) return;
    if (drawing) {
      drawing = false;
      current = null;
      return;
    }
    if (g.tool === 'mark' && !g.moved) {
      const mark = await _promptDamageMark(g.startPos, marks);
      if (mark) {
        marks.push(mark);
        paint();
      }
      return;
    }
    if (TOOL_GLYPH[g.tool] && !g.moved) {
      strokes.push({
        type: 'stamp',
        tool: g.tool,
        glyph: TOOL_GLYPH[g.tool],
        x: g.startPos.x,
        y: g.startPos.y,
        color: '#dc2626',
        size: 0.05,
      });
      paint();
    }
  }

  async function exportBlobs() {
    const w = bg.naturalWidth || canvas.clientWidth || 800;
    const h = bg.naturalHeight || canvas.clientHeight || 600;
    const overlay = document.createElement('canvas');
    overlay.width = w;
    overlay.height = h;
    const octx = overlay.getContext('2d');
    for (const s of strokes) {
      if (s.type === 'stamp') {
        _paintStamp(octx, s, w, h);
        continue;
      }
      if (!s.points?.length) continue;
      octx.strokeStyle = s.color || '#dc2626';
      octx.lineWidth = Math.max(2, (s.width || 2.8) * (w / Math.max(1, canvas.clientWidth)));
      octx.lineCap = 'round';
      octx.lineJoin = 'round';
      octx.beginPath();
      s.points.forEach((p, i) => {
        const x = p.x * w;
        const y = p.y * h;
        if (i === 0) octx.moveTo(x, y);
        else octx.lineTo(x, y);
      });
      octx.stroke();
    }
    for (const d of marks) _paintMark(octx, d, w, h);

    const composite = document.createElement('canvas');
    composite.width = w;
    composite.height = h;
    const cctx = composite.getContext('2d');
    try {
      cctx.drawImage(bg, 0, 0, w, h);
    } catch (_) {
      // CORS tainted — overlay-only still useful
    }
    cctx.drawImage(overlay, 0, 0);

    const overlayBlob = await new Promise((r) => overlay.toBlob(r, 'image/png'));
    const compositeBlob = await new Promise((r) => composite.toBlob(r, 'image/jpeg', 0.88));
    return { overlayBlob, compositeBlob };
  }

  async function save() {
    const { overlayBlob, compositeBlob } = await exportBlobs();
    const payload = {
      overlayBlob,
      compositeBlob,
      strokes: strokes.map(_cloneStroke),
      marks: marks.map((m) => ({ ...m })),
      photoPath: opts.photoPath || '',
    };
    if (typeof opts.onSave === 'function') await opts.onSave(payload);
    close(payload);
  }

  function close(result = null) {
    if (closed) return;
    closed = true;
    canvas.removeEventListener('mousedown', start);
    canvas.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', end);
    canvas.removeEventListener('touchstart', start);
    canvas.removeEventListener('touchmove', move);
    canvas.removeEventListener('touchend', end);
    root.removeEventListener('click', onClick);
    window.removeEventListener('resize', resize);
    document.body.classList.remove('pap-annotate-open');
    root.remove();
    if (typeof opts.onCancel === 'function' && result == null) opts.onCancel();
    resolvePromise?.(result);
  }

  function onClick(e) {
    const toolBtn = e.target.closest('[data-ann-tool]');
    if (toolBtn) {
      setTool(toolBtn.getAttribute('data-ann-tool'));
      return;
    }
    const btn = e.target.closest('[data-ann-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-ann-act');
    if (act === 'cancel') close(null);
    if (act === 'undo') {
      if (strokes.length) strokes.pop();
      else if (marks.length) marks.pop();
      paint();
    }
    if (act === 'clear') {
      strokes = [];
      marks = [];
      paint();
    }
    if (act === 'save') void save().catch((err) => {
      console.error('[papeletas] annotate save', err);
      window.alert?.(err?.message || 'No se pudo guardar la anotación');
    });
  }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);
  root.addEventListener('click', onClick);
  window.addEventListener('resize', resize);
  bg.addEventListener('load', resize);
  bg.addEventListener('error', resize);
  resize();

  return { close: () => close(null), promise };
}

function _promptDamageMark(pos, existing) {
  return new Promise((resolve) => {
    const sheet = document.createElement('div');
    sheet.className = 'pap-annotate-sheet';
    sheet.innerHTML = `
      <div class="pap-annotate-sheet__panel">
        <h3>Marca de daño</h3>
        <label>Tipo
          <select data-ann-type>
            ${DAMAGE_TYPES.map((t) => `<option value="${t}">${_esc(DAMAGE_TYPE_LABELS[t] || t)}</option>`).join('')}
          </select>
        </label>
        <label>Severidad
          <select data-ann-sev>
            ${DAMAGE_SEVERITIES.map((s) => `<option value="${s}" ${s === 'medium' ? 'selected' : ''}>${_esc(DAMAGE_SEVERITY_LABELS[s] || s)}</option>`).join('')}
          </select>
        </label>
        <label>Nota
          <input type="text" data-ann-note maxlength="200" placeholder="Opcional"/>
        </label>
        <div class="pap-annotate-sheet__acts">
          <button type="button" class="pap-btn pap-btn--ghost" data-ann-sheet="cancel">Cancelar</button>
          <button type="button" class="pap-btn pap-btn--primary" data-ann-sheet="ok">Agregar</button>
        </div>
      </div>
    `;
    document.body.appendChild(sheet);
    sheet.addEventListener('click', (e) => {
      const act = e.target.closest('[data-ann-sheet]')?.getAttribute('data-ann-sheet');
      if (!act) return;
      if (act === 'cancel') {
        sheet.remove();
        resolve(null);
        return;
      }
      if (act === 'ok') {
        const damageType = sheet.querySelector('[data-ann-type]')?.value || 'scratch';
        const severity = sheet.querySelector('[data-ann-sev]')?.value || 'medium';
        const note = sheet.querySelector('[data-ann-note]')?.value || '';
        const num = nextDisplayNumber(existing);
        sheet.remove();
        resolve(createDamageMark({
          x: pos.x,
          y: pos.y,
          view: 'photo',
          damageType,
          severity,
          note,
          nextDisplayNumber: num,
        }));
      }
    });
  });
}

function _paintStamp(ctx, s, w, h) {
  const x = (s.x || 0) * w;
  const y = (s.y || 0) * h;
  const size = Math.max(16, (s.size || 0.05) * Math.min(w, h));
  ctx.save();
  ctx.fillStyle = s.color || '#dc2626';
  ctx.strokeStyle = s.color || '#dc2626';
  ctx.font = `700 ${size}px Inter, ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const g = s.glyph || TOOL_GLYPH[s.tool] || '•';
  if (g === '—' || g === '=') {
    ctx.lineWidth = g === '=' ? Math.max(2, size * 0.18) : Math.max(1.5, size * 0.12);
    const len = size * 0.9;
    ctx.beginPath();
    ctx.moveTo(x - len / 2, y);
    ctx.lineTo(x + len / 2, y);
    ctx.stroke();
    if (g === '=') {
      ctx.beginPath();
      ctx.moveTo(x - len / 2, y + size * 0.22);
      ctx.lineTo(x + len / 2, y + size * 0.22);
      ctx.stroke();
    }
  } else {
    ctx.fillText(g, x, y);
  }
  ctx.restore();
}

function _paintMark(ctx, d, w, h) {
  const x = Math.min(1, Math.max(0, Number(d.x) || 0)) * w;
  const y = Math.min(1, Math.max(0, Number(d.y) || 0)) * h;
  const r = Math.max(14, Math.min(w, h) * 0.03);
  ctx.save();
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${Math.max(11, r * 1.1)}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(Number(d.displayNumber) || ''), x, y + 0.5);
  ctx.restore();
}

function _cloneStroke(s) {
  if (s?.type === 'stamp') {
    return {
      type: 'stamp',
      tool: s.tool || 'dent',
      glyph: s.glyph || TOOL_GLYPH[s.tool] || '0',
      x: +s.x || 0,
      y: +s.y || 0,
      color: s.color || '#dc2626',
      size: s.size || 0.05,
    };
  }
  return {
    type: 'stroke',
    color: s?.color || '#dc2626',
    width: s?.width || 2.8,
    points: Array.isArray(s?.points) ? s.points.map((p) => ({ x: +p.x || 0, y: +p.y || 0 })) : [],
  };
}

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
