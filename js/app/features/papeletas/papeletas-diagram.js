/**
 * Drawable vehicle diagram for papeletas (freehand marks over multi-view SVG).
 * Strokes are normalized 0–1 so they survive resize.
 * Layout mirrors paper HOJA: front / left / top / right / rear.
 */

const VIEWBOX = { w: 360, h: 300 };

/** Multi-view car silhouette closer to paper inspection sheet. */
export function diagramSvgMarkup() {
  return `
<svg class="pap-diagram__svg" viewBox="0 0 ${VIEWBOX.w} ${VIEWBOX.h}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">
    <!-- Front elevation (top) -->
    <g opacity="0.9">
      <path d="M142 10 h76 c18 0 28 10 30 22 l6 18 H106 l6-18 c2-12 12-22 30-22z"/>
      <rect x="128" y="38" width="104" height="22" rx="3"/>
      <line x1="148" y1="28" x2="212" y2="28"/>
      <circle cx="136" cy="54" r="5"/><circle cx="224" cy="54" r="5"/>
    </g>
    <!-- Top / plan (center) -->
    <g opacity="0.95">
      <rect x="118" y="78" width="124" height="132" rx="20"/>
      <path d="M138 98 h84 v28 h-84z" opacity="0.7"/>
      <path d="M138 140 h84 v28 h-84z" opacity="0.55"/>
      <path d="M138 180 h84 v16 h-84z" opacity="0.4"/>
      <circle cx="130" cy="108" r="8"/><circle cx="230" cy="108" r="8"/>
      <circle cx="130" cy="180" r="8"/><circle cx="230" cy="180" r="8"/>
      <line x1="180" y1="86" x2="180" y2="202" stroke-dasharray="3 4" opacity="0.35"/>
    </g>
    <!-- Rear elevation (bottom) -->
    <g opacity="0.9">
      <path d="M142 278 h76 c18 0 28-10 30-22 l6-14 H106 l6 14 c2 12 12 22 30 22z"/>
      <rect x="128" y="236" width="104" height="18" rx="3"/>
      <line x1="148" y1="258" x2="212" y2="258"/>
      <circle cx="136" cy="246" r="5"/><circle cx="224" cy="246" r="5"/>
    </g>
    <!-- Left side -->
    <g opacity="0.9">
      <path d="M18 118 h62 c10 0 16 8 16 16 v40 c0 8-6 16-16 16 H18 c-10 0-16-8-16-16 v-40 c0-8 6-16 16-16z"/>
      <path d="M30 130 h38 v20 H30z" opacity="0.55"/>
      <circle cx="32" cy="176" r="7"/><circle cx="66" cy="176" r="7"/>
    </g>
    <!-- Right side -->
    <g opacity="0.9">
      <path d="M280 118 h62 c10 0 16 8 16 16 v40 c0 8-6 16-16 16 h-62 c-10 0-16-8-16-16 v-40 c0-8 6-16 16-16z"/>
      <path d="M292 130 h38 v20 h-38z" opacity="0.55"/>
      <circle cx="294" cy="176" r="7"/><circle cx="328" cy="176" r="7"/>
    </g>
  </g>
  <g fill="currentColor" font-size="9" font-family="Inter,sans-serif" opacity="0.5" letter-spacing="0.04em">
    <text x="180" y="8" text-anchor="middle">FRENTE</text>
    <text x="180" y="296" text-anchor="middle">TRASERA</text>
    <text x="49" y="112" text-anchor="middle">IZQ</text>
    <text x="311" y="112" text-anchor="middle">DER</text>
    <text x="180" y="90" text-anchor="middle">SUPERIOR</text>
  </g>
</svg>`;
}

export const DIAGRAM_LEGEND = Object.freeze([
  { mark: '0', label: 'Abolladura' },
  { mark: '*', label: 'Rotura vidrio' },
  { mark: 'F', label: 'Faltante' },
  { mark: '—', label: 'Rayón' },
  { mark: '=', label: 'Rayón profundo' },
]);

/**
 * @param {HTMLElement} host
 * @param {{ strokes?: object[], editable?: boolean, onChange?: (strokes: object[]) => void }} opts
 */
export function mountDiagram(host, opts = {}) {
  if (!host) return null;
  const editable = opts.editable !== false;
  let strokes = Array.isArray(opts.strokes) ? opts.strokes.map(_cloneStroke) : [];
  let drawing = false;
  let current = null;

  host.innerHTML = `
    <div class="pap-diagram" data-diagram-root>
      <div class="pap-diagram__toolbar">
        <span class="pap-diagram__title">Diagrama del vehículo — rayar daños</span>
        <div class="pap-diagram__actions">
          ${editable ? `
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
        ${diagramSvgMarkup()}
        <canvas class="pap-diagram__canvas" width="${VIEWBOX.w}" height="${VIEWBOX.h}"></canvas>
      </div>
      <div class="pap-diagram__legend">
        ${DIAGRAM_LEGEND.map((l) => `<span><b>${l.mark}</b> ${l.label}</span>`).join('')}
        ${editable ? '<span class="pap-diagram__tip">Usa el dedo o mouse para marcar</span>' : ''}
      </div>
    </div>
  `;

  const canvas = host.querySelector('.pap-diagram__canvas');
  const ctx = canvas.getContext('2d');
  const root = host.querySelector('[data-diagram-root]');

  function resize() {
    const stage = host.querySelector('.pap-diagram__stage');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(280, Math.floor(rect.width));
    const cssH = Math.max(220, Math.floor(cssW * (VIEWBOX.h / VIEWBOX.w)));
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
      if (!s.points?.length) continue;
      ctx.strokeStyle = s.color || '#dc2626';
      ctx.lineWidth = s.width || 2.5;
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

  function start(e) {
    if (!editable) return;
    e.preventDefault();
    drawing = true;
    current = { color: '#dc2626', width: 2.5, points: [pos(e)] };
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
  resize();

  function getStrokes() {
    return strokes.map(_cloneStroke);
  }

  function setStrokes(next) {
    strokes = Array.isArray(next) ? next.map(_cloneStroke) : [];
    paint();
  }

  function toDataUrl() {
    return strokesToDataUrl(strokes);
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

function _cloneStroke(s) {
  return {
    color: s?.color || '#dc2626',
    width: s?.width || 2.5,
    points: Array.isArray(s?.points) ? s.points.map((p) => ({ x: +p.x || 0, y: +p.y || 0 })) : [],
  };
}

/** Render marks + light guide boxes as PNG data URL for PDF (sync). */
export function strokesToDataUrl(strokes = []) {
  const out = document.createElement('canvas');
  out.width = VIEWBOX.w * 2;
  out.height = VIEWBOX.h * 2;
  const octx = out.getContext('2d');
  octx.fillStyle = '#f8fafc';
  octx.fillRect(0, 0, out.width, out.height);
  octx.strokeStyle = '#94a3b8';
  octx.lineWidth = 2;
  // Guide: top plan box
  octx.strokeRect(out.width * 0.33, out.height * 0.26, out.width * 0.34, out.height * 0.44);
  // Front / rear guides
  octx.strokeRect(out.width * 0.36, out.height * 0.03, out.width * 0.28, out.height * 0.16);
  octx.strokeRect(out.width * 0.36, out.height * 0.78, out.width * 0.28, out.height * 0.16);
  octx.lineCap = 'round';
  octx.lineJoin = 'round';
  for (const s of strokes || []) {
    if (!s.points?.length) continue;
    octx.strokeStyle = s.color || '#dc2626';
    octx.lineWidth = (s.width || 2.5) * 2;
    octx.beginPath();
    s.points.forEach((p, i) => {
      const x = p.x * out.width;
      const y = p.y * out.height;
      if (i === 0) octx.moveTo(x, y);
      else octx.lineTo(x, y);
    });
    octx.stroke();
  }
  return out.toDataURL('image/png');
}
