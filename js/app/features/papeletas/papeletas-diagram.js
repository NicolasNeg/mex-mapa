/**
 * Drawable vehicle diagram for papeletas (freehand marks over multi-view SVG).
 * Strokes are normalized 0–1 so they survive resize.
 */

const VIEWBOX = { w: 360, h: 280 };

/** Minimal multi-view car silhouette (front / top / sides / rear). */
export function diagramSvgMarkup() {
  return `
<svg class="pap-diagram__svg" viewBox="0 0 ${VIEWBOX.w} ${VIEWBOX.h}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.85">
    <!-- Top (center) -->
    <rect x="118" y="78" width="124" height="124" rx="18"/>
    <rect x="138" y="98" width="84" height="40" rx="4"/>
    <rect x="138" y="148" width="84" height="36" rx="4"/>
    <circle cx="132" cy="108" r="7"/><circle cx="228" cy="108" r="7"/>
    <circle cx="132" cy="172" r="7"/><circle cx="228" cy="172" r="7"/>
    <!-- Front (top) -->
    <path d="M150 18 h60 c14 0 22 8 22 18 v18 H128 V36 c0-10 8-18 22-18z"/>
    <line x1="140" y1="42" x2="220" y2="42"/>
    <!-- Rear (bottom) -->
    <path d="M150 244 h60 c14 0 22-8 22-18 v-14 H128 v14 c0 10 8 18 22 18z"/>
    <line x1="140" y1="226" x2="220" y2="226"/>
    <!-- Left side -->
    <path d="M28 110 h56 c8 0 12 6 12 14 v32 c0 8-4 14-12 14 H28 c-8 0-12-6-12-14 v-32 c0-8 4-14 12-14z"/>
    <circle cx="40" cy="158" r="6"/><circle cx="72" cy="158" r="6"/>
    <!-- Right side -->
    <path d="M276 110 h56 c8 0 12 6 12 14 v32 c0 8-4 14-12 14 h-56 c-8 0-12-6-12-14 v-32 c0-8 4-14 12-14z"/>
    <circle cx="288" cy="158" r="6"/><circle cx="320" cy="158" r="6"/>
  </g>
  <g fill="currentColor" font-size="9" font-family="Inter,sans-serif" opacity="0.45">
    <text x="180" y="14" text-anchor="middle">FRENTE</text>
    <text x="180" y="274" text-anchor="middle">TRASERA</text>
    <text x="44" y="100" text-anchor="middle">IZQ</text>
    <text x="316" y="100" text-anchor="middle">DER</text>
    <text x="180" y="92" text-anchor="middle">SUPERIOR</text>
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
        <span class="pap-diagram__title">Diagrama — rayar daños</span>
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
    // Composite SVG + canvas into offscreen canvas for PDF
    const out = document.createElement('canvas');
    out.width = VIEWBOX.w * 2;
    out.height = VIEWBOX.h * 2;
    const octx = out.getContext('2d');
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, out.width, out.height);
    octx.strokeStyle = '#334155';
    octx.lineWidth = 2;
    // Draw strokes scaled
    octx.lineCap = 'round';
    octx.lineJoin = 'round';
    for (const s of strokes) {
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
    // Note: SVG base is shown in HTML PDF separately; this exports marks layer.
    return out.toDataURL('image/png');
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

/** Render marks-only PNG data URL for PDF (sync). */
export function strokesToDataUrl(strokes = []) {
  const out = document.createElement('canvas');
  out.width = VIEWBOX.w * 2;
  out.height = VIEWBOX.h * 2;
  const octx = out.getContext('2d');
  octx.fillStyle = '#f8fafc';
  octx.fillRect(0, 0, out.width, out.height);
  // Light guide boxes
  octx.strokeStyle = '#94a3b8';
  octx.lineWidth = 2;
  octx.strokeRect(out.width * 0.33, out.height * 0.28, out.width * 0.34, out.height * 0.44);
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
