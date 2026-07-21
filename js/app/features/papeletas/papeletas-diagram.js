/**
 * Drawable vehicle diagram for papeletas.
 * Background = paper HOJA exploded-car scan; overlay = freehand + stamp symbols.
 * Strokes/stamps use normalized 0–1 coords so they survive resize.
 */

export const DIAGRAM_IMAGE_URL = '/assets/papeletas/hoja-inspeccion-auto.png';
export const DIAGRAM_IMAGE_WIDE_URL = '/assets/papeletas/hoja-inspeccion-diagram-wide.png';

/** Intrinsic ratio of cropped auto asset (approx). */
const VIEWBOX = { w: 378, h: 410 };

export const DIAGRAM_LEGEND = Object.freeze([
  { mark: '0', label: 'Abolladura', tool: 'dent' },
  { mark: '*', label: 'Rotura vidrio', tool: 'glass' },
  { mark: 'F', label: 'Faltante', tool: 'missing' },
  { mark: '—', label: 'Rayón', tool: 'scratch' },
  { mark: '=', label: 'Rayón profundo', tool: 'deep' },
]);

const TOOL_GLYPH = Object.freeze({
  dent: '0',
  glass: '*',
  missing: 'F',
  scratch: '—',
  deep: '=',
  pen: null,
});

/**
 * Lightweight SVG fallback if image fails (keeps layout).
 */
export function diagramSvgMarkup() {
  return `
<svg class="pap-diagram__svg" viewBox="0 0 ${VIEWBOX.w} ${VIEWBOX.h}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect width="100%" height="100%" fill="#f7f4ee"/>
  <g fill="none" stroke="#1a1a1a" stroke-width="1.4" stroke-linejoin="round" opacity="0.55">
    <rect x="120" y="110" width="138" height="170" rx="22"/>
    <path d="M148 28 h82 c16 0 26 10 28 22 l4 20 H116 l4-20 c2-12 12-22 28-22z"/>
    <path d="M148 360 h82 c16 0 26-10 28-22 l4-16 H116 l4 16 c2 12 12 22 28 22z"/>
    <path d="M18 150 h70 c8 0 14 8 14 16 v60 c0 8-6 16-14 16 H18 c-8 0-14-8-14-16 v-60 c0-8 6-16 14-16z"/>
    <path d="M290 150 h70 c8 0 14 8 14 16 v60 c0 8-6 16-14 16 h-70 c-8 0-14-8-14-16 v-60 c0-8 6-16 14-16z"/>
  </g>
</svg>`;
}

/**
 * @param {HTMLElement} host
 * @param {{ strokes?: object[], editable?: boolean, onChange?: (strokes: object[]) => void }} opts
 */
export function mountDiagram(host, opts = {}) {
  if (!host) return null;
  const editable = opts.editable !== false;
  let strokes = Array.isArray(opts.strokes) ? opts.strokes.map(_cloneStroke) : [];
  let tool = 'pen'; // pen | dent | glass | missing | scratch | deep
  let drawing = false;
  let current = null;

  host.innerHTML = `
    <div class="pap-diagram" data-diagram-root>
      <div class="pap-diagram__toolbar">
        <span class="pap-diagram__title">Diagrama · rayar / sellar daños</span>
        <div class="pap-diagram__actions">
          ${editable ? `
            <button type="button" class="pap-btn pap-btn--ghost pap-btn--tiny is-tool-on" data-diagram-tool="pen" title="Lápiz">
              <span class="material-symbols-outlined">draw</span>
            </button>
            <button type="button" class="pap-btn pap-btn--ghost pap-btn--tiny" data-diagram-act="undo" title="Deshacer">
              <span class="material-symbols-outlined">undo</span>
            </button>
            <button type="button" class="pap-btn pap-btn--ghost pap-btn--tiny" data-diagram-act="clear" title="Limpiar">
              <span class="material-symbols-outlined">ink_eraser</span>
            </button>
          ` : ''}
        </div>
      </div>
      <div class="pap-diagram__stage">
        <img class="pap-diagram__bg" src="${DIAGRAM_IMAGE_URL}" alt="Diagrama del vehículo" draggable="false"/>
        <canvas class="pap-diagram__canvas" width="${VIEWBOX.w}" height="${VIEWBOX.h}"></canvas>
      </div>
      <div class="pap-diagram__legend" role="toolbar" aria-label="Leyenda de daños">
        ${DIAGRAM_LEGEND.map((l) => `
          <button type="button" class="pap-diagram__stamp" data-diagram-tool="${_escAttr(l.tool)}" ${editable ? '' : 'disabled'} title="${_escAttr(l.label)}">
            <b>${_escAttr(l.mark)}</b><span>${_escAttr(l.label)}</span>
          </button>
        `).join('')}
        ${editable ? '<span class="pap-diagram__tip">Toca un símbolo y luego el diagrama, o usa el lápiz</span>' : ''}
      </div>
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
    const cssW = Math.max(260, Math.floor(rect.width));
    const cssH = Math.max(280, Math.floor(cssW * (VIEWBOX.h / VIEWBOX.w)));
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
      ctx.strokeStyle = s.color || '#c41212';
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
      color: '#c41212',
      size: 0.045,
    });
    paint();
    emit();
  }

  function start(e) {
    if (!editable) return;
    e.preventDefault();
    const p = pos(e);
    if (tool !== 'pen' && TOOL_GLYPH[tool]) {
      placeStamp(p);
      return;
    }
    drawing = true;
    current = { type: 'stroke', color: '#c41212', width: 2.4, points: [p] };
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
    // Fallback silhouette if asset missing
    if (stage && !stage.querySelector('.pap-diagram__svg')) {
      stage.insertAdjacentHTML('afterbegin', diagramSvgMarkup());
    }
    resize();
  });
  resize();

  function getStrokes() {
    return strokes.map(_cloneStroke);
  }

  function setStrokes(next) {
    strokes = Array.isArray(next) ? next.map(_cloneStroke) : [];
    paint();
  }

  function toDataUrl() {
    return strokesToDataUrl(strokes, { withBg: true });
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

  return { getStrokes, setStrokes, toDataUrl, destroy, paint, resize };
}

function _paintStamp(ctx, s, w, h) {
  const x = (s.x || 0) * w;
  const y = (s.y || 0) * h;
  const size = Math.max(14, (s.size || 0.045) * Math.min(w, h));
  ctx.save();
  ctx.fillStyle = s.color || '#c41212';
  ctx.strokeStyle = s.color || '#c41212';
  ctx.font = `700 ${size}px "IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace`;
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

function _cloneStroke(s) {
  if (s?.type === 'stamp') {
    return {
      type: 'stamp',
      tool: s.tool || 'dent',
      glyph: s.glyph || TOOL_GLYPH[s.tool] || '0',
      x: +s.x || 0,
      y: +s.y || 0,
      color: s.color || '#c41212',
      size: s.size || 0.045,
    };
  }
  return {
    type: 'stroke',
    color: s?.color || '#c41212',
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

/**
 * Composite diagram for PDF / read-only preview.
 * @param {object[]} strokes
 * @param {{ withBg?: boolean }} opts
 */
export function strokesToDataUrl(strokes = [], opts = {}) {
  const withBg = opts.withBg !== false;
  const out = document.createElement('canvas');
  out.width = VIEWBOX.w * 2;
  out.height = VIEWBOX.h * 2;
  const octx = out.getContext('2d');
  octx.fillStyle = '#f7f4ee';
  octx.fillRect(0, 0, out.width, out.height);

  const drawMarks = () => {
    for (const s of strokes || []) {
      if (s?.type === 'stamp') {
        _paintStamp(octx, s, out.width, out.height);
        continue;
      }
      if (!s?.points?.length) continue;
      octx.strokeStyle = s.color || '#c41212';
      octx.lineWidth = (s.width || 2.4) * 2;
      octx.lineCap = 'round';
      octx.lineJoin = 'round';
      octx.beginPath();
      s.points.forEach((p, i) => {
        const x = p.x * out.width;
        const y = p.y * out.height;
        if (i === 0) octx.moveTo(x, y);
        else octx.lineTo(x, y);
      });
      octx.stroke();
    }
  };

  if (withBg) {
    const img = new Image();
    // Sync path won't load async in all contexts — draw marks; PDF caller can prefer async helper.
    img.crossOrigin = 'anonymous';
    try {
      // Attempt sync draw if already cached by browser
      img.src = DIAGRAM_IMAGE_URL;
      if (img.complete && img.naturalWidth) {
        octx.drawImage(img, 0, 0, out.width, out.height);
        drawMarks();
        return out.toDataURL('image/png');
      }
    } catch (_) { /* fall through */ }
  }
  drawMarks();
  return out.toDataURL('image/png');
}

/** Async composite with background image for PDF. */
export function strokesToDataUrlAsync(strokes = []) {
  return new Promise((resolve) => {
    const out = document.createElement('canvas');
    out.width = VIEWBOX.w * 2;
    out.height = VIEWBOX.h * 2;
    const octx = out.getContext('2d');
    octx.fillStyle = '#f7f4ee';
    octx.fillRect(0, 0, out.width, out.height);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const finish = () => {
      try {
        if (img.naturalWidth) octx.drawImage(img, 0, 0, out.width, out.height);
      } catch (_) { /* ignore */ }
      for (const s of strokes || []) {
        if (s?.type === 'stamp') {
          _paintStamp(octx, s, out.width, out.height);
          continue;
        }
        if (!s?.points?.length) continue;
        octx.strokeStyle = s.color || '#c41212';
        octx.lineWidth = (s.width || 2.4) * 2;
        octx.lineCap = 'round';
        octx.lineJoin = 'round';
        octx.beginPath();
        s.points.forEach((p, i) => {
          const x = p.x * out.width;
          const y = p.y * out.height;
          if (i === 0) octx.moveTo(x, y);
          else octx.lineTo(x, y);
        });
        octx.stroke();
      }
      resolve(out.toDataURL('image/png'));
    };
    img.onload = finish;
    img.onerror = finish;
    img.src = DIAGRAM_IMAGE_URL;
  });
}
