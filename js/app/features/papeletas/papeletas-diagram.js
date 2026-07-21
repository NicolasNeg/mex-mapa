/**
 * Drawable vehicle diagram for papeletas.
 * Capture UI base = clean car drawable PNG; overlay = freehand strokes + typed danosMarcados.
 * Paper HOJA scan kept only as legacy formal reference URL (not interactive bg).
 * Coords: normalized 0–1 within the active diagram stage (view bounds).
 */

/** Primary interactive / PDF silhouette (copied from img/PAPELETA_CAR_DRAWABLE.png). */
export const DIAGRAM_IMAGE_URL = '/assets/papeletas/car-drawable.png';

/** Source path kept in repo root img/ — same bytes as assets copy. */
export const DIAGRAM_IMAGE_SOURCE = '/img/PAPELETA_CAR_DRAWABLE.png';

/** Legacy paper HOJA scan — formal reference only; do not use as capture background. */
export const DIAGRAM_IMAGE_LEGACY_HOJA_URL = '/assets/papeletas/hoja-inspeccion-auto.png';
export const DIAGRAM_IMAGE_WIDE_URL = '/assets/papeletas/hoja-inspeccion-diagram-wide.png';

/** Intrinsic ratio of car-drawable.png (1664×2530). */
const VIEWBOX = { w: 416, h: 632 };

export const DIAGRAM_LEGEND = Object.freeze([
  { mark: '0', label: 'Abolladura', tool: 'dent' },
  { mark: '*', label: 'Rotura vidrio', tool: 'glass' },
  { mark: 'F', label: 'Faltante', tool: 'missing' },
  { mark: '—', label: 'Rayón', tool: 'scratch' },
  { mark: '=', label: 'Rayón profundo', tool: 'deep' },
  { mark: '•', label: 'Golpe', tool: 'hit' },
  { mark: '?', label: 'Otro', tool: 'other' },
]);

const TOOL_GLYPH = Object.freeze({
  dent: '0',
  glass: '*',
  missing: 'F',
  scratch: '—',
  deep: '=',
  hit: '•',
  other: '?',
  pen: null,
  mark: null,
});

/**
 * Lightweight SVG fallback if image fails (keeps layout).
 */
export function diagramSvgMarkup() {
  return `
<svg class="pap-diagram__svg" viewBox="0 0 ${VIEWBOX.w} ${VIEWBOX.h}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect width="100%" height="100%" fill="#F6F8FC"/>
  <g fill="none" stroke="#334155" stroke-width="1.4" stroke-linejoin="round" opacity="0.55">
    <rect x="130" y="160" width="156" height="220" rx="28"/>
    <path d="M158 48 h100 c18 0 28 12 30 26 l4 24 H124 l4-24 c2-14 12-26 30-26z"/>
    <path d="M158 520 h100 c18 0 28-12 30-26 l4-20 H124 l4 20 c2 14 12 26 30 26z"/>
    <path d="M24 220 h78 c8 0 14 8 14 16 v80 c0 8-6 16-14 16 H24 c-8 0-14-8-14-16 v-80 c0-8 6-16 14-16z"/>
    <path d="M314 220 h78 c8 0 14 8 14 16 v80 c0 8-6 16-14 16 h-78 c-8 0-14-8-14-16 v-80 c0-8 6-16 14-16z"/>
  </g>
</svg>`;
}

/**
 * @param {HTMLElement} host
 * @param {{
 *   strokes?: object[],
 *   danosMarcados?: object[],
 *   editable?: boolean,
 *   onChange?: (strokes: object[]) => void,
 *   onDamagesChange?: (danos: object[]) => void,
 *   onTap?: (payload: { x: number, y: number, view: string }) => void,
 *   view?: string,
 * }} opts
 */
export function mountDiagram(host, opts = {}) {
  if (!host) return null;
  const editable = opts.editable !== false;
  let strokes = Array.isArray(opts.strokes) ? opts.strokes.map(_cloneStroke) : [];
  let danos = Array.isArray(opts.danosMarcados) ? opts.danosMarcados.map((d) => ({ ...d })) : [];
  let tool = typeof opts.onTap === 'function' ? 'mark' : 'pen';
  let drawing = false;
  let current = null;
  const activeView = String(opts.view || 'top');
  const title = String(opts.title || (editable ? 'Marcar daños' : 'Diagrama · salida'));
  const showLegend = opts.showLegend !== false;
  const showMarksList = opts.showMarksList !== false;

  host.innerHTML = `
    <div class="pap-diagram ${editable ? '' : 'pap-diagram--ro'}" data-diagram-root>
      <div class="pap-diagram__toolbar">
        <span class="pap-diagram__title">${_escAttr(title)}</span>
        <div class="pap-diagram__actions">
          ${editable ? `
            <button type="button" class="pap-btn pap-btn--ghost pap-btn--tiny ${tool === 'mark' ? 'is-tool-on' : ''}" data-diagram-tool="mark" title="Marcar daño">
              <span class="material-symbols-outlined">add_location</span>
            </button>
            <button type="button" class="pap-btn pap-btn--ghost pap-btn--tiny ${tool === 'pen' ? 'is-tool-on' : ''}" data-diagram-tool="pen" title="Lápiz libre">
              <span class="material-symbols-outlined">draw</span>
            </button>
            <button type="button" class="pap-btn pap-btn--ghost pap-btn--tiny" data-diagram-act="undo" title="Deshacer trazo">
              <span class="material-symbols-outlined">undo</span>
            </button>
            <button type="button" class="pap-btn pap-btn--ghost pap-btn--tiny" data-diagram-act="clear" title="Limpiar trazos">
              <span class="material-symbols-outlined">ink_eraser</span>
            </button>
          ` : ((strokes.length || danos.length) ? '' : '<span class="pap-muted">Sin marcas</span>')}
        </div>
      </div>
      <div class="pap-diagram__stage">
        <img class="pap-diagram__bg" src="${DIAGRAM_IMAGE_URL}" alt="Silueta del vehículo" draggable="false"
          data-diagram-src="${DIAGRAM_IMAGE_URL}" data-diagram-fallback="${DIAGRAM_IMAGE_SOURCE}"/>
        <canvas class="pap-diagram__canvas" width="${VIEWBOX.w}" height="${VIEWBOX.h}"></canvas>
      </div>
      ${showLegend ? `
      <div class="pap-diagram__legend ${editable ? '' : 'pap-diagram__legend--ro'}" role="toolbar" aria-label="Leyenda de daños">
        ${DIAGRAM_LEGEND.map((l) => `
          <button type="button" class="pap-diagram__stamp" data-diagram-tool="${_escAttr(l.tool)}" ${editable ? '' : 'disabled'} title="${_escAttr(l.label)}">
            <b>${_escAttr(l.mark)}</b><span>${_escAttr(l.label)}</span>
          </button>
        `).join('')}
        ${editable ? '<span class="pap-diagram__tip">Toca el auto para marcar un daño, o usa el lápiz para trazo libre</span>' : ''}
      </div>` : ''}
      ${showMarksList ? `
      <ul class="pap-diagram__marks-list" data-diagram-marks-list ${danos.length ? '' : 'hidden'}>
        ${danos.map((d) => `
          <li data-damage-id="${_escAttr(d.id)}">
            <b>#${Number(d.displayNumber) || '?'}</b>
            ${_escAttr(d.damageType || '')} · ${_escAttr(d.severity || '')}
          </li>
        `).join('')}
      </ul>` : ''}
    </div>
  `;

  const canvas = host.querySelector('.pap-diagram__canvas');
  const ctx = canvas.getContext('2d');
  const root = host.querySelector('[data-diagram-root]');
  const bg = host.querySelector('.pap-diagram__bg');

  function resize() {
    const stage = host.querySelector('.pap-diagram__stage');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const natW = bg?.naturalWidth || VIEWBOX.w;
    const natH = bg?.naturalHeight || VIEWBOX.h;
    const ratio = natH / natW || (VIEWBOX.h / VIEWBOX.w);
    const cssW = Math.max(260, Math.floor(rect.width));
    const cssH = Math.max(280, Math.floor(cssW * ratio));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint();
  }

  function paint() {
    const w = canvas.clientWidth || VIEWBOX.w;
    const h = canvas.clientHeight || VIEWBOX.h;
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
      ctx.lineWidth = s.width || 2.4;
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const x = p.x * w;
        const y = p.y * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    for (const d of danos) {
      _paintDamageMark(ctx, d, w, h);
    }
  }

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    const w = r.width || 1;
    const h = r.height || 1;
    return {
      x: Math.min(1, Math.max(0, (src.clientX - r.left) / w)),
      y: Math.min(1, Math.max(0, (src.clientY - r.top) / h)),
    };
  }

  function emit() {
    if (typeof opts.onChange === 'function') opts.onChange(getStrokes());
  }

  function setTool(next) {
    tool = next || 'pen';
    root.querySelectorAll('[data-diagram-tool]').forEach((btn) => {
      btn.classList.toggle('is-tool-on', btn.getAttribute('data-diagram-tool') === tool);
    });
  }

  function placeStamp(p) {
    const glyph = TOOL_GLYPH[tool];
    if (!glyph) return;
    strokes.push({
      type: 'stamp',
      tool,
      glyph,
      x: p.x,
      y: p.y,
      color: '#dc2626',
      size: 0.045,
    });
    paint();
    emit();
  }

  function start(e) {
    if (!editable) return;
    e.preventDefault();
    const p = pos(e);
    if (tool === 'mark' && typeof opts.onTap === 'function') {
      opts.onTap({ x: p.x, y: p.y, view: activeView });
      return;
    }
    if (tool !== 'pen' && TOOL_GLYPH[tool]) {
      placeStamp(p);
      return;
    }
    drawing = true;
    current = { type: 'stroke', color: '#dc2626', width: 2.4, points: [p] };
    strokes.push(current);
    paint();
  }

  function move(e) {
    if (!drawing || !current) return;
    e.preventDefault();
    current.points.push(pos(e));
    paint();
  }

  function end() {
    if (!drawing) return;
    drawing = false;
    current = null;
    emit();
  }

  function onClick(e) {
    const toolBtn = e.target.closest('[data-diagram-tool]');
    if (toolBtn && editable) {
      setTool(toolBtn.getAttribute('data-diagram-tool'));
      return;
    }
    const btn = e.target.closest('[data-diagram-act]');
    if (!btn || !editable) return;
    const act = btn.getAttribute('data-diagram-act');
    if (act === 'undo') {
      strokes.pop();
      paint();
      emit();
    }
    if (act === 'clear') {
      strokes = [];
      paint();
      emit();
    }
  }

  if (editable) {
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
    root?.addEventListener('click', onClick);
  }

  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => resize())
    : null;
  const stage = host.querySelector('.pap-diagram__stage');
  if (ro && stage) ro.observe(stage);
  else window.addEventListener('resize', resize);
  bg?.addEventListener('load', resize);
  bg?.addEventListener('error', () => {
    if (bg && bg.dataset.diagramFallback && !bg.dataset.triedFallback) {
      bg.dataset.triedFallback = '1';
      bg.src = bg.dataset.diagramFallback;
      return;
    }
    if (stage && !stage.querySelector('.pap-diagram__svg')) {
      stage.insertAdjacentHTML('afterbegin', diagramSvgMarkup());
    }
    resize();
  });
  resize();

  function getStrokes() {
    return strokes.map(_cloneStroke);
  }

  function getDamages() {
    return danos.map((d) => ({ ...d }));
  }

  function setDamages(next) {
    danos = Array.isArray(next) ? next.map((d) => ({ ...d })) : [];
    const list = host.querySelector('[data-diagram-marks-list]');
    if (list) {
      list.hidden = !danos.length;
      list.innerHTML = danos.map((d) => `
        <li data-damage-id="${_escAttr(d.id)}">
          <b>#${Number(d.displayNumber) || '?'}</b>
          ${_escAttr(d.damageType || '')} · ${_escAttr(d.severity || '')}
        </li>
      `).join('');
    }
    paint();
  }

  function setStrokes(next) {
    strokes = Array.isArray(next) ? next.map(_cloneStroke) : [];
    paint();
  }

  function toDataUrl() {
    return strokesToDataUrl(strokes, { withBg: true, danosMarcados: danos });
  }

  function destroy() {
    if (editable) {
      canvas.removeEventListener('mousedown', start);
      canvas.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
      canvas.removeEventListener('touchstart', start);
      canvas.removeEventListener('touchmove', move);
      canvas.removeEventListener('touchend', end);
      root?.removeEventListener('click', onClick);
    }
    if (ro && stage) ro.disconnect();
    else window.removeEventListener('resize', resize);
    host.innerHTML = '';
  }

  return {
    getStrokes,
    setStrokes,
    getDamages,
    setDamages,
    toDataUrl,
    destroy,
    paint,
    resize,
  };
}

function _paintStamp(ctx, s, w, h) {
  const x = (s.x || 0) * w;
  const y = (s.y || 0) * h;
  const size = Math.max(14, (s.size || 0.045) * Math.min(w, h));
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

function _paintDamageMark(ctx, d, w, h) {
  const x = Math.min(1, Math.max(0, Number(d.x) || 0)) * w;
  const y = Math.min(1, Math.max(0, Number(d.y) || 0)) * h;
  const r = Math.max(12, Math.min(w, h) * 0.028);
  const num = Number(d.displayNumber) || '';
  ctx.save();
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.max(10, r * 1.1)}px Inter, ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), x, y + 0.5);
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
      size: s.size || 0.045,
    };
  }
  return {
    type: 'stroke',
    color: s?.color || '#dc2626',
    width: s?.width || 2.4,
    points: Array.isArray(s?.points) ? s.points.map((p) => ({ x: +p.x || 0, y: +p.y || 0 })) : [],
  };
}

function _escAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function _drawOverlay(octx, strokes, danos, width, height) {
  for (const s of strokes || []) {
    if (s?.type === 'stamp') {
      _paintStamp(octx, s, width, height);
      continue;
    }
    if (!s?.points?.length) continue;
    octx.strokeStyle = s.color || '#dc2626';
    octx.lineWidth = (s.width || 2.4) * 2;
    octx.lineCap = 'round';
    octx.lineJoin = 'round';
    octx.beginPath();
    s.points.forEach((p, i) => {
      const x = p.x * width;
      const y = p.y * height;
      if (i === 0) octx.moveTo(x, y);
      else octx.lineTo(x, y);
    });
    octx.stroke();
  }
  for (const d of danos || []) {
    _paintDamageMark(octx, d, width, height);
  }
}

/**
 * Composite diagram for PDF / read-only preview.
 * When withBg=false, canvas stays transparent so marks can overlay a live <img> bg.
 * @param {object[]} strokes
 * @param {{ withBg?: boolean, danosMarcados?: object[] }} opts
 */
export function strokesToDataUrl(strokes = [], opts = {}) {
  const withBg = opts.withBg !== false;
  const danos = opts.danosMarcados || [];
  const out = document.createElement('canvas');
  out.width = VIEWBOX.w * 2;
  out.height = VIEWBOX.h * 2;
  const octx = out.getContext('2d');
  if (withBg) {
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, out.width, out.height);
  } else {
    // Transparent overlay — do NOT fill white (that hid the car silhouette under marks).
    octx.clearRect(0, 0, out.width, out.height);
  }

  if (withBg) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    try {
      img.src = DIAGRAM_IMAGE_URL;
      if (img.complete && img.naturalWidth) {
        octx.drawImage(img, 0, 0, out.width, out.height);
        _drawOverlay(octx, strokes, danos, out.width, out.height);
        return out.toDataURL('image/png');
      }
      // Try fallback source if primary not yet cached
      img.src = DIAGRAM_IMAGE_SOURCE;
      if (img.complete && img.naturalWidth) {
        octx.drawImage(img, 0, 0, out.width, out.height);
        _drawOverlay(octx, strokes, danos, out.width, out.height);
        return out.toDataURL('image/png');
      }
    } catch (_) { /* fall through */ }
  }
  _drawOverlay(octx, strokes, danos, out.width, out.height);
  return out.toDataURL('image/png');
}

/**
 * Async composite with clean drawable silhouette for PDF.
 * @param {object[]} strokes
 * @param {{ danosMarcados?: object[] }} [opts]
 */
export function strokesToDataUrlAsync(strokes = [], opts = {}) {
  const danos = opts.danosMarcados || [];
  return new Promise((resolve) => {
    const out = document.createElement('canvas');
    out.width = VIEWBOX.w * 2;
    out.height = VIEWBOX.h * 2;
    const octx = out.getContext('2d');
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, out.width, out.height);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const finish = () => {
      try {
        if (img.naturalWidth) octx.drawImage(img, 0, 0, out.width, out.height);
      } catch (_) { /* ignore */ }
      _drawOverlay(octx, strokes, danos, out.width, out.height);
      resolve(out.toDataURL('image/png'));
    };
    img.onload = finish;
    img.onerror = () => {
      // Fallback to /img source path
      const img2 = new Image();
      img2.crossOrigin = 'anonymous';
      img2.onload = () => {
        try { octx.drawImage(img2, 0, 0, out.width, out.height); } catch (_) { /* ignore */ }
        _drawOverlay(octx, strokes, danos, out.width, out.height);
        resolve(out.toDataURL('image/png'));
      };
      img2.onerror = finish;
      img2.src = DIAGRAM_IMAGE_SOURCE;
    };
    img.src = DIAGRAM_IMAGE_URL;
  });
}
