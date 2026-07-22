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
  // Default: pan/zoom. Pen only draws when tool=pen. Mark for typed damages.
  let tool = editable
    ? (typeof opts.onTap === 'function' ? 'mark' : 'pan')
    : 'pan';
  if (opts.mode === 'pen' || opts.mode === 'mark' || opts.mode === 'pan') tool = opts.mode;
  let drawing = false;
  let current = null;
  let gesture = null; // { mode, clientX, clientY, startPos }
  let scale = 1;
  let panX = 0;
  let panY = 0;
  let fullscreen = !!opts.fullscreen;
  const DRAW_SLOP = 10;
  const activeView = String(opts.view || 'top');
  const title = String(opts.title || (editable ? 'Marcar daños' : 'Diagrama · salida'));
  const showLegend = opts.showLegend !== false;
  const showMarksList = opts.showMarksList !== false;

  /** Approximate hover regions (normalized) for desktop zone→foto preview */
  const ZONE_HITS = Object.freeze([
    { id: 'frente_defensa', x0: 0.28, y0: 0.02, x1: 0.72, y1: 0.16 },
    { id: 'parabrisas', x0: 0.30, y0: 0.16, x1: 0.70, y1: 0.28 },
    { id: 'lateral_izq', x0: 0.02, y0: 0.30, x1: 0.28, y1: 0.62 },
    { id: 'lateral_der', x0: 0.72, y0: 0.30, x1: 0.98, y1: 0.62 },
    { id: 'trasera_cajuela', x0: 0.28, y0: 0.78, x1: 0.72, y1: 0.98 },
    { id: 'interior', x0: 0.32, y0: 0.32, x1: 0.68, y1: 0.58 },
    { id: 'herramienta', x0: 0.35, y0: 0.60, x1: 0.65, y1: 0.75 },
  ]);

  host.innerHTML = `
    <div class="pap-diagram ${editable ? '' : 'pap-diagram--ro'} ${fullscreen ? 'pap-diagram--fs' : ''}" data-diagram-root>
      <div class="pap-diagram__toolbar">
        <span class="pap-diagram__title">${_escAttr(title)}</span>
        <div class="pap-diagram__actions">
          ${editable ? `
            <button type="button" class="pap-btn pap-btn--ghost pap-btn--tiny ${tool === 'pan' ? 'is-tool-on' : ''}" data-diagram-tool="pan" title="Mover / zoom">
              <span class="material-symbols-outlined">pan_tool</span>
            </button>
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
          <button type="button" class="pap-btn pap-btn--ghost pap-btn--tiny" data-diagram-act="fs" title="Pantalla completa">
            <span class="material-symbols-outlined">${fullscreen ? 'fullscreen_exit' : 'fullscreen'}</span>
          </button>
        </div>
      </div>
      <div class="pap-diagram__viewport">
        <div class="pap-diagram__stage" data-diagram-stage>
          <img class="pap-diagram__bg" src="${DIAGRAM_IMAGE_URL}" alt="Silueta del vehículo" draggable="false"
            data-diagram-src="${DIAGRAM_IMAGE_URL}" data-diagram-fallback="${DIAGRAM_IMAGE_SOURCE}"/>
          <canvas class="pap-diagram__canvas" width="${VIEWBOX.w}" height="${VIEWBOX.h}"></canvas>
        </div>
        <div class="pap-diagram__hover-preview" data-diagram-hover hidden>
          <img alt="" data-diagram-hover-img/>
          <span data-diagram-hover-label></span>
        </div>
      </div>
      ${showLegend ? `
      <div class="pap-diagram__legend ${editable ? '' : 'pap-diagram__legend--ro'}" role="toolbar" aria-label="Leyenda de daños">
        ${DIAGRAM_LEGEND.map((l) => `
          <button type="button" class="pap-diagram__stamp" data-diagram-tool="${_escAttr(l.tool)}" ${editable ? '' : 'disabled'} title="${_escAttr(l.label)}">
            <b>${_escAttr(l.mark)}</b><span>${_escAttr(l.label)}</span>
          </button>
        `).join('')}
        ${editable ? '<span class="pap-diagram__tip">Pan/zoom por defecto. Activa el lápiz solo para rayar.</span>' : ''}
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
  const stageEl = host.querySelector('[data-diagram-stage]');
  const hoverEl = host.querySelector('[data-diagram-hover]');
  const hoverImg = host.querySelector('[data-diagram-hover-img]');
  const hoverLabel = host.querySelector('[data-diagram-hover-label]');

  function applyTransform() {
    if (!stageEl) return;
    stageEl.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  }

  function syncTouchAction() {
    const isPen = editable && tool === 'pen';
    canvas.style.touchAction = isPen ? 'none' : 'none'; // we handle pan ourselves
    root?.classList.toggle('is-draw-mode', isPen);
    root?.classList.toggle('is-pan-mode', tool === 'pan' || !editable);
    applyTransform();
  }
  syncTouchAction();

  function resize() {
    const stage = host.querySelector('.pap-diagram__stage');
    const viewport = host.querySelector('.pap-diagram__viewport');
    if (!stage || !viewport) return;
    const rect = viewport.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const natW = bg?.naturalWidth || VIEWBOX.w;
    const natH = bg?.naturalHeight || VIEWBOX.h;
    const ratio = natH / natW || (VIEWBOX.h / VIEWBOX.w);
    const maxH = fullscreen
      ? Math.max(280, Math.floor(rect.height - 8))
      : Math.max(240, Math.min(Math.floor(rect.height || 420), Math.floor(window.innerHeight * 0.62)));
    const cssW = Math.max(220, Math.floor(rect.width));
    let cssH = Math.max(200, Math.floor(cssW * ratio));
    if (cssH > maxH) {
      cssH = maxH;
    }
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    if (bg) {
      bg.style.width = `${cssW}px`;
      bg.style.height = `${cssH}px`;
    }
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
    if (!src) return { x: 0, y: 0 };
    const w = r.width || 1;
    const h = r.height || 1;
    return {
      x: Math.min(1, Math.max(0, (src.clientX - r.left) / w)),
      y: Math.min(1, Math.max(0, (src.clientY - r.top) / h)),
    };
  }

  function clientXY(e) {
    const src = e.touches ? e.touches[0] : e;
    return src ? { x: src.clientX, y: src.clientY } : { x: 0, y: 0 };
  }

  function hitZone(p) {
    for (const z of ZONE_HITS) {
      if (p.x >= z.x0 && p.x <= z.x1 && p.y >= z.y0 && p.y <= z.y1) return z.id;
    }
    return null;
  }

  function emit() {
    if (typeof opts.onChange === 'function') opts.onChange(getStrokes());
  }

  function setTool(next) {
    tool = next || 'pan';
    root.querySelectorAll('[data-diagram-tool]').forEach((btn) => {
      btn.classList.toggle('is-tool-on', btn.getAttribute('data-diagram-tool') === tool);
    });
    syncTouchAction();
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

  function beginStroke(p) {
    drawing = true;
    current = { type: 'stroke', color: '#dc2626', width: 2.4, points: [p] };
    strokes.push(current);
    paint();
  }

  function start(e) {
    const xy = clientXY(e);
    const p = pos(e);
    // Pinch zoom start
    if (e.touches && e.touches.length === 2) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      gesture = { mode: 'pinch', dist: d, scale };
      e.preventDefault();
      return;
    }
    if (!editable) {
      gesture = { mode: 'pan', clientX: xy.x, clientY: xy.y, panX, panY };
      return;
    }
    gesture = {
      mode: tool === 'pen' ? 'undecided' : (tool === 'pan' ? 'pan' : 'undecided'),
      clientX: xy.x,
      clientY: xy.y,
      startPos: p,
      tool,
      panX,
      panY,
    };
    if (tool === 'pen' && !e.touches) {
      e.preventDefault?.();
      gesture.mode = 'draw';
      beginStroke(p);
    }
    if (tool === 'pan') {
      e.preventDefault?.();
    }
  }

  function move(e) {
    if (!gesture) return;
    if (gesture.mode === 'pinch' && e.touches && e.touches.length === 2) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const next = Math.min(3, Math.max(1, gesture.scale * (d / (gesture.dist || 1))));
      scale = next;
      applyTransform();
      e.preventDefault();
      return;
    }
    const xy = clientXY(e);
    const dx = xy.x - gesture.clientX;
    const dy = xy.y - gesture.clientY;
    const dist = Math.hypot(dx, dy);

    if (gesture.mode === 'pan') {
      panX = gesture.panX + dx;
      panY = gesture.panY + dy;
      applyTransform();
      e.preventDefault?.();
      return;
    }

    if (!editable) return;

    if (gesture.mode === 'undecided') {
      if (dist < DRAW_SLOP) return;
      if (gesture.tool === 'pan' || (Math.abs(dy) > Math.abs(dx) * 1.15 && gesture.tool !== 'pen')) {
        gesture.mode = 'pan';
        gesture.panX = panX;
        gesture.panY = panY;
        return;
      }
      if (gesture.tool === 'pen') {
        gesture.mode = 'draw';
        e.preventDefault();
        beginStroke(gesture.startPos);
        current.points.push(pos(e));
        paint();
        return;
      }
      gesture.mode = 'scroll';
      return;
    }

    if (gesture.mode === 'draw' && drawing && current) {
      e.preventDefault();
      current.points.push(pos(e));
      paint();
    }
  }

  function end(e) {
    const g = gesture;
    gesture = null;
    if (!g) return;

    if (g.mode === 'pinch' || g.mode === 'pan') return;

    if (!editable) return;

    if (g.mode === 'undecided' || g.mode === 'tap') {
      const p = g.startPos;
      if (g.tool === 'mark' && typeof opts.onTap === 'function') {
        opts.onTap({ x: p.x, y: p.y, view: activeView });
        return;
      }
      if (g.tool !== 'pen' && TOOL_GLYPH[g.tool]) {
        placeStamp(p);
        return;
      }
    }

    if (drawing) {
      drawing = false;
      current = null;
      emit();
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    scale = Math.min(3, Math.max(1, scale * delta));
    applyTransform();
  }

  function onMouseMoveHover(e) {
    if (typeof opts.onZoneHover !== 'function') return;
    if (window.matchMedia && !window.matchMedia('(min-width: 900px)').matches) return;
    const p = pos(e);
    const zoneId = hitZone(p);
    opts.onZoneHover(zoneId, p);
    if (!hoverEl) return;
    if (!zoneId) {
      hoverEl.hidden = true;
      return;
    }
    const info = opts.zonePreview?.(zoneId) || null;
    hoverLabel.textContent = info?.label || zoneId;
    if (info?.url) {
      hoverImg.src = info.url;
      hoverImg.hidden = false;
    } else {
      hoverImg.removeAttribute('src');
      hoverImg.hidden = true;
    }
    hoverEl.hidden = false;
    hoverEl.style.left = `${Math.min(e.offsetX + 12, (canvas.clientWidth || 200) - 90)}px`;
    hoverEl.style.top = `${Math.max(8, e.offsetY - 80)}px`;
  }

  function toggleFullscreen() {
    fullscreen = !fullscreen;
    root.classList.toggle('pap-diagram--fs', fullscreen);
    document.body.classList.toggle('pap-diagram-fs-open', fullscreen);
    const icon = root.querySelector('[data-diagram-act="fs"] .material-symbols-outlined');
    if (icon) icon.textContent = fullscreen ? 'fullscreen_exit' : 'fullscreen';
    resize();
  }

  function onClick(e) {
    const toolBtn = e.target.closest('[data-diagram-tool]');
    if (toolBtn && editable) {
      setTool(toolBtn.getAttribute('data-diagram-tool'));
      return;
    }
    const btn = e.target.closest('[data-diagram-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-diagram-act');
    if (act === 'undo' && editable) {
      strokes.pop();
      paint();
      emit();
    }
    if (act === 'clear' && editable) {
      strokes = [];
      paint();
      emit();
    }
    if (act === 'fs') toggleFullscreen();
  }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);
  canvas.addEventListener('touchcancel', end);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('mousemove', onMouseMoveHover);
  root?.addEventListener('click', onClick);

  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => resize())
    : null;
  const viewport = host.querySelector('.pap-diagram__viewport');
  if (ro && viewport) ro.observe(viewport);
  else window.addEventListener('resize', resize);
  bg?.addEventListener('load', resize);
  bg?.addEventListener('error', () => {
    if (bg && bg.dataset.diagramFallback && !bg.dataset.triedFallback) {
      bg.dataset.triedFallback = '1';
      bg.src = bg.dataset.diagramFallback;
      return;
    }
    if (stageEl && !stageEl.querySelector('.pap-diagram__svg')) {
      stageEl.insertAdjacentHTML('afterbegin', diagramSvgMarkup());
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
    canvas.removeEventListener('mousedown', start);
    canvas.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', end);
    canvas.removeEventListener('touchstart', start);
    canvas.removeEventListener('touchmove', move);
    canvas.removeEventListener('touchend', end);
    canvas.removeEventListener('touchcancel', end);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('mousemove', onMouseMoveHover);
    root?.removeEventListener('click', onClick);
    document.body.classList.remove('pap-diagram-fs-open');
    if (ro && viewport) ro.disconnect();
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
    setTool,
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
