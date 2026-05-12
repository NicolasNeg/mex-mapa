/**
 * Editor visual de mapa por vista (App Shell / Firebase).
 * Inspiración UX: topbar fija, workspace oscuro, grid, inspector, zoom — sin copiar legacy Firebase/HTML.
 */
import { normalizarElemento } from '/domain/mapa.model.js';
import { MAP_EDITOR_VIEW_ORDER, getViewConfig } from '/js/app/features/mapa/mapEditorViewConfig.js';
import {
  getVisibilityByView,
  isElementVisibleInView,
  focusOpacityForType,
  inferVisibilityByView
} from '/js/app/features/mapa/mapViewVisibility.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function uid() {
  try {
    return crypto.randomUUID();
  } catch (_) {
    return `id_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}

function deepClone(o) {
  try {
    return JSON.parse(JSON.stringify(o));
  } catch (_) {
    return o;
  }
}

function _normList(raw) {
  return (Array.isArray(raw) ? raw : []).map((el, i) => normalizarElemento(el, i));
}

function ensureEditorIds(list) {
  return list.map((el, i) => {
    const x = { ...el };
    if (!x.id) x.id = uid();
    if (!Number.isFinite(Number(x.orden))) x.orden = i;
    return x;
  });
}

function canvasBounds(list) {
  let w = 960;
  let h = 640;
  for (const c of list) {
    w = Math.max(w, (c.x || 0) + (c.width || 120) + 80);
    h = Math.max(h, (c.y || 0) + (c.height || 80) + 80);
  }
  return { w, h };
}

function validateStructure(list) {
  const errors = [];
  const warnings = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    const id = String(el.id || '');
    if (id) {
      if (seen.has(id)) errors.push(`ID duplicado en índice ${i}: ${id}`);
      seen.add(id);
    }
    const ww = Number(el.width);
    const hh = Number(el.height);
    if (!Number.isFinite(ww) || ww <= 0 || !Number.isFinite(hh) || hh <= 0) {
      errors.push(`Elemento ${i + 1}: ancho o alto inválido.`);
    }
    if (!Number.isFinite(Number(el.x)) || !Number.isFinite(Number(el.y))) {
      errors.push(`Elemento ${i + 1}: posición inválida (NaN).`);
    }
    const t = String(el.tipo || '');
    if (t === 'mesa' && !String(el.nombrePublico || el.valor || '').trim()) {
      warnings.push(`Mesa en posición ${i + 1} sin nombre público.`);
    }
    if (t === 'cajon' && !String(el.valor || '').trim()) {
      warnings.push(`Cajón en posición ${i + 1} sin código (valor).`);
    }
    if (['pool', 'chapoteadero', 'water_area', 'zona_acuatica'].includes(t) && !String(el.nombrePublico || el.valor || '').trim()) {
      warnings.push(`Elemento acuático ${i + 1} sin nombre.`);
    }
    const vb = getVisibilityByView(el);
    if (!vb.global && !vb.mesas && !vb.estacionamiento && !vb.albercas) {
      warnings.push(`Elemento ${i + 1}: sin visibilidad en ninguna vista.`);
    }
  }
  return { errors, warnings };
}

function mergeVisibility(el, patch) {
  const cur = { ...inferVisibilityByView(el), ...(el.metadata?.visibilityByView || {}) };
  const next = { ...cur, ...patch };
  return {
    ...el,
    metadata: {
      ...(typeof el.metadata === 'object' && el.metadata ? el.metadata : {}),
      visibilityByView: next
    }
  };
}

function setMetaBackground(extras, viewId, bg) {
  const out = { ...extras };
  out.backgroundByView = { ...(out.backgroundByView || {}) };
  out.backgroundByView[viewId] = bg;
  return out;
}

async function uploadBackgroundFile(plaza, viewId, file) {
  const getStorage = window._mex?._getStorageClient;
  if (typeof getStorage !== 'function') throw new Error('Storage no disponible en esta sesión.');
  const storage = getStorage();
  const safe = String(file.name || 'img').replace(/[^\w.\-]+/g, '_').slice(0, 80);
  const path = `maps/backgrounds/${encodeURIComponent(viewId)}/${Date.now()}_${safe}`;
  const ref = storage.ref(path);
  await ref.put(file);
  const url = await ref.getDownloadURL();
  return {
    type: 'image',
    url,
    storagePath: path,
    opacity: 1,
    fit: 'cover',
    locked: false,
    visible: true
  };
}

function toolGroupsForView(viewId) {
  if (viewId === 'estacionamiento') {
    return [
      {
        title: 'Agregar al mapa',
        tools: [
          { id: 'cajon', label: 'Cajón', tipo: 'cajon', w: 100, h: 44, valor: 'P-' },
          { id: 'fila3', label: 'Fila x3', tipo: 'cajon', plantilla: 'row', n: 3, w: 88, h: 40, gap: 8 },
          { id: 'bloque', label: 'Bloque 2x5', tipo: 'cajon', plantilla: 'grid', cols: 2, rows: 5, w: 80, h: 36, gap: 6 },
          { id: 'entrada', label: 'Entrada / salida', tipo: 'entrada', w: 160, h: 36, valor: 'ENTRADA' },
          { id: 'area_taller', label: 'Área taller', tipo: 'area', w: 200, h: 120, valor: 'TALLER' },
          { id: 'area_patio', label: 'Área patio', tipo: 'area', w: 220, h: 140, valor: 'PATIO' },
          { id: 'camino', label: 'Circulación', tipo: 'camino', w: 240, h: 28, valor: '' },
          { id: 'label', label: 'Texto / etiqueta', tipo: 'label', w: 140, h: 32, valor: 'Etiqueta', esLabel: true },
          { id: 'marker', label: 'Marcador', tipo: 'marker', w: 28, h: 28, valor: '•' }
        ]
      },
      {
        title: 'Formas rápidas',
        tools: [
          { id: 'rect', label: 'Rectángulo', tipo: 'forma_rect', w: 120, h: 80, valor: '' },
          { id: 'line', label: 'Línea', tipo: 'forma_line', w: 160, h: 8, valor: '' },
          { id: 'buffer', label: 'Zona bloqueada', tipo: 'buffer', w: 140, h: 100, valor: 'BLOQUEADO', isBlocked: true }
        ]
      }
    ];
  }
  if (viewId === 'mesas') {
    return [
      {
        title: 'Mesas',
        tools: [
          { id: 'mesa_r', label: 'Mesa redonda', tipo: 'mesa', w: 72, h: 72, valor: 'M-1' },
          { id: 'mesa_c', label: 'Mesa cuadrada', tipo: 'mesa', w: 80, h: 80, valor: 'M-1' },
          { id: 'mesa_vip', label: 'Mesa VIP', tipo: 'mesa', w: 96, h: 96, valor: 'VIP-1', vip: true },
          { id: 'zona_m', label: 'Área de mesas', tipo: 'area', w: 260, h: 180, valor: 'ZONA MESAS' },
          { id: 'zona_r', label: 'Zona reservable', tipo: 'zona_reservable', w: 200, h: 120, valor: 'RESERVA' },
          { id: 'label', label: 'Texto', tipo: 'label', w: 120, h: 28, valor: 'Texto', esLabel: true }
        ]
      },
      {
        title: 'Extras',
        tools: [
          { id: 'sombrilla', label: 'Sombrilla', tipo: 'marker', w: 36, h: 36, valor: '☂' },
          { id: 'servicio', label: 'Servicio cercano', tipo: 'servicio', w: 100, h: 40, valor: 'SERV' }
        ]
      }
    ];
  }
  if (viewId === 'albercas') {
    return [
      {
        title: 'Albercas',
        tools: [
          { id: 'pool', label: 'Alberca', tipo: 'pool', w: 220, h: 140, valor: 'ALBERCA' },
          { id: 'chap', label: 'Chapoteadero', tipo: 'chapoteadero', w: 160, h: 100, valor: 'CHAP' },
          { id: 'water', label: 'Área acuática', tipo: 'water_area', w: 200, h: 120, valor: 'AGUA' },
          { id: 'zona_libre', label: 'Zona libre', tipo: 'buffer', w: 120, h: 90, valor: 'LIBRE' },
          { id: 'camastro', label: 'Sombra / camastro', tipo: 'palapa', w: 140, h: 60, valor: 'SOMBRA' },
          { id: 'label', label: 'Texto', tipo: 'label', w: 120, h: 28, valor: 'Texto', esLabel: true }
        ]
      },
      {
        title: 'Formas',
        tools: [
          { id: 'forma_rect', label: 'Rectángulo', tipo: 'forma_rect', w: 140, h: 90, valor: '' },
          { id: 'forma_line', label: 'Línea', tipo: 'forma_line', w: 140, h: 6, valor: '' }
        ]
      }
    ];
  }
  // global
  return [
    {
      title: 'Parque',
      tools: [
        { id: 'area', label: 'Área', tipo: 'area', w: 200, h: 140, valor: 'ÁREA' },
        { id: 'buffer', label: 'Zona libre', tipo: 'buffer', w: 160, h: 100, valor: 'LIBRE' },
        { id: 'camino', label: 'Camino', tipo: 'camino', w: 220, h: 32, valor: '' },
        { id: 'entrada', label: 'Entrada / salida', tipo: 'entrada', w: 160, h: 36, valor: 'ENTRADA' },
        { id: 'servicio', label: 'Servicio', tipo: 'servicio', w: 120, h: 48, valor: 'SERV' },
        { id: 'palapa', label: 'Palapa', tipo: 'palapa', w: 140, h: 80, valor: 'PALAPA' },
        { id: 'pool', label: 'Alberca (referencia)', tipo: 'pool', w: 180, h: 100, valor: 'POOL' },
        { id: 'est_area', label: 'Estacionamiento (área)', tipo: 'area', w: 240, h: 120, valor: 'EST' },
        { id: 'label', label: 'Texto', tipo: 'label', w: 120, h: 28, valor: 'Texto', esLabel: true },
        { id: 'marker', label: 'Marcador', tipo: 'marker', w: 28, h: 28, valor: '•' }
      ]
    }
  ];
}

/**
 * @param {object} opts
 * @param {HTMLElement|null} opts.container
 * @param {object} opts.api
 * @param {object} opts.snapshot
 * @param {object} opts.ctx
 * @param {Function|null} opts.resync
 */
export async function openVisualMapEditor({ container, api, snapshot = {}, ctx = {}, resync = null }) {
  const plaza = String(ctx.plaza || snapshot.plaza || '').toUpperCase().trim();
  const role = String(ctx.role || ctx.profile?.rol || '').toUpperCase();
  const isProgrammer = role === 'PROGRAMADOR';

  if (typeof window !== 'undefined' && window.innerWidth < 1024) {
    return _openMobileBlock(container, plaza);
  }

  let structure = ensureEditorIds(_normList(snapshot.structure || []));
  let mapExtras = {};
  try {
    if (typeof api?.obtenerMapaConfigPlaza === 'function') {
      mapExtras = (await api.obtenerMapaConfigPlaza(plaza))?.mapEditorExtras || {};
    }
  } catch (_) {
    mapExtras = {};
  }
  let backgroundByView = deepClone(mapExtras.backgroundByView || {});

  let activeView = /** @type {'global'|'mesas'|'estacionamiento'|'albercas'} */ ('estacionamiento');
  let focusMode = true;
  let showContext = true;
  let zoom = 1;
  let dirty = false;
  let saving = false;
  let saveError = '';
  const undoStack = [];
  const redoStack = [];
  let selectedIds = new Set();
  let addMode = null;
  const shell = document.createElement('div');
  shell.className = 'mapviz mapviz--open';
  shell.setAttribute('role', 'dialog');
  shell.setAttribute('aria-label', 'Editor del parque');

  const parent = container || document.body;
  parent.appendChild(shell);

  function pushUndo() {
    undoStack.push({ structure: deepClone(structure), extras: deepClone(backgroundByView) });
    if (undoStack.length > 45) undoStack.shift();
    redoStack.length = 0;
    dirty = true;
    renderChrome();
  }

  function applySnapshot(s) {
    structure = ensureEditorIds(_normList(s.structure || []));
    backgroundByView = deepClone(s.extras || {});
    selectedIds = new Set();
    renderAll();
    renderChrome();
  }

  function undo() {
    if (!undoStack.length) return;
    const cur = { structure: deepClone(structure), extras: deepClone(backgroundByView) };
    const prev = undoStack.pop();
    redoStack.push(cur);
    structure = ensureEditorIds(_normList(prev.structure || []));
    backgroundByView = deepClone(prev.extras || {});
    dirty = true;
    renderAll();
    renderChrome();
  }

  function redo() {
    if (!redoStack.length) return;
    const cur = { structure: deepClone(structure), extras: deepClone(backgroundByView) };
    const next = redoStack.pop();
    undoStack.push(cur);
    structure = ensureEditorIds(_normList(next.structure || []));
    backgroundByView = deepClone(next.extras || {});
    dirty = true;
    renderAll();
    renderChrome();
  }

  function close(result) {
    shell.remove();
    resolveOut(result);
  }

  let resolveOut = () => {};
  const done = new Promise(res => {
    resolveOut = res;
  });

  function selectedList() {
    return structure.filter(s => selectedIds.has(s.id));
  }

  function renderChrome() {
    const status = saving ? 'Guardando…' : saveError ? 'Error al guardar' : dirty ? 'Cambios sin guardar' : 'Guardado';
    const tab = id => {
      const cfg = getViewConfig(id);
      const on = activeView === id ? ' mapviz-tab--active mapviz-tab--' + cfg.accent : '';
      return `<button type="button" class="mapviz-tab${on}" data-view="${id}">${esc(cfg.label)}</button>`;
    };
    shell.innerHTML = `
      <div class="mapviz-inner${focusMode ? ' mapviz-inner--focus' : ''}">
        <header class="mapviz-topbar">
          <div class="mapviz-topbar-left">
            <strong class="mapviz-title">Editor del parque</strong>
            <span class="mapviz-status mapviz-status--${dirty ? 'dirty' : saveError ? 'err' : saving ? 'saving' : 'ok'}">${esc(status)}</span>
          </div>
          <nav class="mapviz-tabs" aria-label="Vista del mapa">
            ${MAP_EDITOR_VIEW_ORDER.map(tab).join('')}
          </nav>
          <div class="mapviz-topbar-right">
            <button type="button" class="mapviz-btn mapviz-btn--primary" data-act="save">Guardar</button>
            <button type="button" class="mapviz-btn" data-act="undo" title="Deshacer">Deshacer</button>
            <button type="button" class="mapviz-btn" data-act="redo" title="Rehacer">Rehacer</button>
            <button type="button" class="mapviz-btn" data-act="preview" title="Abrir vista operativa en otra pestaña">Vista previa</button>
            <button type="button" class="mapviz-btn" data-act="focus" title="Modo enfoque">${focusMode ? 'Salir enfoque' : 'Modo enfoque'}</button>
            ${isProgrammer ? '<button type="button" class="mapviz-btn" data-act="export" title="Exportar JSON técnico">Exportar</button>' : ''}
            <button type="button" class="mapviz-btn mapviz-btn--ghost" data-act="close">Cerrar</button>
          </div>
        </header>
        <div class="mapviz-body">
          <aside class="mapviz-sidebar" data-sidebar></aside>
          <main class="mapviz-main">
            <div class="mapviz-canvas-wrap" data-canvas-wrap>
              <div class="mapviz-zoombar" aria-label="Zoom">
                <button type="button" data-zoom="-0.1" title="Alejar">−</button>
                <span data-zoom-label>${Math.round(zoom * 100)}%</span>
                <button type="button" data-zoom="0.1" title="Acercar">+</button>
              </div>
              <div class="mapviz-canvas-scroll">
                <div class="mapviz-canvas" data-canvas></div>
              </div>
            </div>
          </main>
          <aside class="mapviz-inspector" data-inspector></aside>
        </div>
        <footer class="mapviz-footer">
          <span data-footer-meta>Plaza <strong>${esc(plaza || '—')}</strong> · Vista <strong>${esc(getViewConfig(activeView).label)}</strong></span>
          <label class="mapviz-toggle"><input type="checkbox" data-ctx-toggle ${showContext ? 'checked' : ''}/> Mostrar contexto</label>
          <span class="mapviz-footer-hint">Selecciona piezas en el lienzo. Mayúsculas + clic para varias.</span>
        </footer>
      </div>`;

    _bindChrome();
    renderSidebar();
    renderInspector();
    renderCanvas();
  }

  function _bindChrome() {
    shell.querySelector('[data-act="close"]')?.addEventListener('click', () => close({ ok: false, cancelled: true }));
    shell.querySelector('[data-act="save"]')?.addEventListener('click', () => save());
    shell.querySelector('[data-act="undo"]')?.addEventListener('click', () => undo());
    shell.querySelector('[data-act="redo"]')?.addEventListener('click', () => redo());
    shell.querySelector('[data-act="preview"]')?.addEventListener('click', () => {
      window.open(`/app/mapa?plaza=${encodeURIComponent(plaza)}`, '_blank', 'noopener');
    });
    shell.querySelector('[data-act="focus"]')?.addEventListener('click', () => {
      focusMode = !focusMode;
      renderChrome();
    });
    shell.querySelector('[data-act="export"]')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ structure, mapEditorExtras: { backgroundByView } }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `mapa-${plaza}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    shell.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeView = btn.getAttribute('data-view');
        addMode = null;
        renderChrome();
      });
    });
    shell.querySelector('[data-ctx-toggle]')?.addEventListener('change', e => {
      showContext = e.target.checked;
      renderCanvas();
    });
    shell.querySelector('[data-zoom="-0.1"]')?.addEventListener('click', () => {
      zoom = Math.max(0.35, Math.round((zoom - 0.1) * 100) / 100);
      renderCanvas();
    });
    shell.querySelector('[data-zoom="0.1"]')?.addEventListener('click', () => {
      zoom = Math.min(2, Math.round((zoom + 0.1) * 100) / 100);
      renderCanvas();
    });
  }

  function renderSidebar() {
    const el = shell.querySelector('[data-sidebar]');
    if (!el) return;
    const groups = toolGroupsForView(activeView);
    let html = '';
    for (const g of groups) {
      html += `<div class="mapviz-side-section"><h4>${esc(g.title)}</h4>`;
      for (const t of g.tools) {
        html += `<button type="button" class="mapviz-tool" data-add="${esc(t.id)}">${esc(t.label)}</button>`;
      }
      html += `</div>`;
    }
    html += `<div class="mapviz-side-section"><h4>Plantillas rápidas</h4>
      <button type="button" class="mapviz-tool" data-template="entrada-est">Entrada estacionamiento</button>
      <button type="button" class="mapviz-tool" data-template="pasillo">Pasillo circulación</button>
      <button type="button" class="mapviz-tool" data-template="fila5">Fila x5</button>
    </div>`;
    html += `<div class="mapviz-side-section"><h4>Capas (filtro)</h4>
      <p class="mapviz-muted">Usa la vista superior para enfocar herramientas. La visibilidad por vista está en el inspector.</p>
    </div>`;
    el.innerHTML = html;
    el.querySelectorAll('[data-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-add');
        const flat = groups.flatMap(x => x.tools);
        const def = flat.find(x => x.id === id);
        if (def) addFromToolDef(def);
      });
    });
    el.querySelector('[data-template="entrada-est"]')?.addEventListener('click', () => {
      pushUndo();
      structure.push(
        normalizarElemento(
          {
            id: uid(),
            tipo: 'entrada',
            valor: 'ENTRADA',
            x: 80,
            y: 80,
            width: 200,
            height: 40,
            orden: structure.length
          },
          structure.length
        )
      );
      renderAll();
    });
    el.querySelector('[data-template="pasillo"]')?.addEventListener('click', () => {
      pushUndo();
      structure.push(
        normalizarElemento(
          {
            id: uid(),
            tipo: 'camino',
            valor: '',
            x: 120,
            y: 200,
            width: 360,
            height: 36,
            orden: structure.length
          },
          structure.length
        )
      );
      renderAll();
    });
    el.querySelector('[data-template="fila5"]')?.addEventListener('click', () => {
      addFromToolDef({ id: 'x', label: '', tipo: 'cajon', plantilla: 'row', n: 5, w: 80, h: 40, gap: 8, valor: 'P-' });
    });
  }

  function addFromToolDef(def) {
    pushUndo();
    const baseOrden = structure.length;
    if (def.plantilla === 'row') {
      const n = def.n || 3;
      const gap = def.gap ?? 8;
      const startX = 80;
      const startY = 120;
      for (let i = 0; i < n; i++) {
        structure.push(
          normalizarElemento(
            {
              id: uid(),
              tipo: def.tipo,
              valor: `${def.valor || 'P-'}${i + 1}`,
              x: startX + i * (def.w + gap),
              y: startY,
              width: def.w,
              height: def.h,
              orden: baseOrden + i,
              vip: def.vip,
              esLabel: def.esLabel,
              isBlocked: def.isBlocked
            },
            baseOrden + i
          )
        );
      }
    } else if (def.plantilla === 'grid') {
      const cols = def.cols || 2;
      const rows = def.rows || 5;
      const gap = def.gap ?? 6;
      let k = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          structure.push(
            normalizarElemento(
              {
                id: uid(),
                tipo: 'cajon',
                valor: `P${k + 1}`,
                x: 80 + c * (def.w + gap),
                y: 80 + r * (def.h + gap),
                width: def.w,
                height: def.h,
                orden: baseOrden + k
              },
              baseOrden + k
            )
          );
          k++;
        }
      }
    } else {
      structure.push(
        normalizarElemento(
          {
            id: uid(),
            tipo: def.tipo,
            valor: def.valor || 'NUEVO',
            x: 120,
            y: 140,
            width: def.w,
            height: def.h,
            esLabel: def.esLabel === true,
            isBlocked: def.isBlocked === true,
            vip: def.vip === true,
            orden: baseOrden
          },
          baseOrden
        )
      );
    }
    renderAll();
  }

  function renderInspector() {
    const el = shell.querySelector('[data-inspector]');
    if (!el) return;
    const sel = selectedList();
    if (!sel.length) {
      el.innerHTML = `
        <h3>Inspector</h3>
        <p class="mapviz-muted">Selecciona una o varias piezas en el lienzo.</p>
        <hr class="mapviz-hr"/>
        <h4>Fondo del mapa</h4>
        <p class="mapviz-muted">Sube una imagen desde tu equipo (se guarda en Storage).</p>
        <input type="file" accept="image/*" data-bg-file class="mapviz-file"/>
        <div class="mapviz-row">
          <button type="button" class="mapviz-btn" data-bg-remove>Quitar imagen</button>
        </div>
        <label class="mapviz-field">Ajuste
          <select data-bg-fit>
            <option value="cover">Cubrir</option>
            <option value="contain">Contener</option>
            <option value="stretch">Estirar</option>
          </select>
        </label>
        <label class="mapviz-field">Opacidad (0–1)<input type="number" step="0.05" min="0" max="1" data-bg-op /></label>
        <label class="mapviz-check"><input type="checkbox" data-bg-lock/> Bloquear fondo</label>
        <label class="mapviz-check"><input type="checkbox" data-bg-vis checked/> Mostrar fondo</label>
        ${isProgrammer ? '<details class="mapviz-tech"><summary>Detalles técnicos</summary><pre data-bg-debug></pre></details>' : ''}
      `;
      _bindBgPanel(el);
      return;
    }
    if (sel.length === 1) {
      const c = sel[0];
      const vb = getVisibilityByView(c);
      const spotOpts = ['libre', 'ocupado', 'reservado', 'mantenimiento', 'taller', 'sucio']
        .map(
          o =>
            `<option value="${esc(o)}"${String(c.spotEstado || '') === o ? ' selected' : ''}>${esc(o)}</option>`
        )
        .join('');
      el.innerHTML = `
        <h3>Inspector</h3>
        <label class="mapviz-field">Código / valor<input data-f="valor" value="${esc(c.valor)}"/></label>
        <label class="mapviz-field">Tipo<select data-f="tipo">
          ${['cajon', 'mesa', 'pool', 'chapoteadero', 'water_area', 'area', 'camino', 'entrada', 'servicio', 'palapa', 'label', 'marker', 'buffer', 'forma_rect', 'forma_line', 'zona_reservable']
            .map(t => `<option value="${t}"${c.tipo === t ? ' selected' : ''}>${esc(t)}</option>`)
            .join('')}
        </select></label>
        ${c.tipo === 'cajon' ? `<label class="mapviz-field">Estado operativo<select data-f="spotEstado">${spotOpts}</select></label>` : ''}
        <label class="mapviz-field">Nombre público<input data-f="nombrePublico" value="${esc(c.nombrePublico || '')}" placeholder="Ej. Palapa norte"/></label>
        <label class="mapviz-field">Descripción pública<textarea data-f="descripcionPublica" rows="2">${esc(c.descripcionPublica || '')}</textarea></label>
        <div class="mapviz-field"><span>Visible en</span>
          <div class="mapviz-visibility">
            <label><input type="checkbox" data-vb="global"${vb.global !== false ? ' checked' : ''}/> Global</label>
            <label><input type="checkbox" data-vb="mesas"${vb.mesas ? ' checked' : ''}/> Mesas</label>
            <label><input type="checkbox" data-vb="estacionamiento"${vb.estacionamiento !== false ? ' checked' : ''}/> Estacionamiento</label>
            <label><input type="checkbox" data-vb="albercas"${vb.albercas ? ' checked' : ''}/> Albercas</label>
          </div>
        </div>
        <label class="mapviz-field">Ancho<input type="number" data-f="width" value="${c.width}"/></label>
        <label class="mapviz-field">Alto<input type="number" data-f="height" value="${c.height}"/></label>
        <label class="mapviz-field">Posición X<input type="number" data-f="x" value="${c.x}"/></label>
        <label class="mapviz-field">Posición Y<input type="number" data-f="y" value="${c.y}"/></label>
        <label class="mapviz-field">Rotación (°)<input type="number" data-f="rotation" value="${c.rotation}"/></label>
        <label class="mapviz-field">Color relleno<input data-f="fill" value="${esc(c.fill || '')}" placeholder="#334155"/></label>
        <label class="mapviz-field">Capacidad<input type="number" data-f="capacidad" value="${c.capacidad != null ? esc(c.capacidad) : ''}"/></label>
        <label class="mapviz-field">Precio base<input type="number" step="1" data-f="precioBase" value="${c.precioBase != null ? esc(c.precioBase) : ''}"/></label>
        <label class="mapviz-check"><input type="checkbox" data-f="vip"${c.vip ? ' checked' : ''}/> VIP</label>
        <label class="mapviz-check"><input type="checkbox" data-f="reservable"${c.reservable !== false ? ' checked' : ''}/> Reservable</label>
        <label class="mapviz-check"><input type="checkbox" data-f="hidden"${c.hidden ? ' checked' : ''}/> Oculto</label>
        <label class="mapviz-check"><input type="checkbox" data-f="locked"${c.locked ? ' checked' : ''}/> Bloquear edición</label>
        <label class="mapviz-field">Tipo alberca<select data-f="poolTipo">
          ${['alberca', 'chapoteadero', 'olas', 'zona libre'].map(p => `<option value="${p}"${String(c.poolTipo || '') === p ? ' selected' : ''}>${esc(p)}</option>`).join('')}
        </select></label>
        <hr class="mapviz-hr"/>
        <div class="mapviz-actions">
          <button type="button" class="mapviz-btn" data-act="dup">Duplicar</button>
          <button type="button" class="mapviz-btn" data-act="duprow">Duplicar fila</button>
          <button type="button" class="mapviz-btn" data-act="al-l">Alinear izquierda</button>
          <button type="button" class="mapviz-btn" data-act="al-c">Alinear centro H</button>
          <button type="button" class="mapviz-btn" data-act="al-r">Alinear derecha</button>
          <button type="button" class="mapviz-btn" data-act="dist-h">Distribuir H</button>
          <button type="button" class="mapviz-btn" data-act="flip-h">Voltear H</button>
          <button type="button" class="mapviz-btn" data-act="del">Eliminar</button>
        </div>
      `;
      el.querySelectorAll('[data-f]').forEach(inp => {
        const ev = inp.type === 'checkbox' ? 'change' : 'input';
        inp.addEventListener(ev, () => patchSelectedFromForm());
      });
      el.querySelectorAll('[data-vb]').forEach(inp => {
        inp.addEventListener('change', () => patchVisibilityFromForm());
      });
      el.querySelector('[data-act="dup"]')?.addEventListener('click', () => duplicateSelection());
      el.querySelector('[data-act="duprow"]')?.addEventListener('click', () => duplicateRow());
      el.querySelector('[data-act="al-l"]')?.addEventListener('click', () => alignMulti('left'));
      el.querySelector('[data-act="al-c"]')?.addEventListener('click', () => alignMulti('centerH'));
      el.querySelector('[data-act="al-r"]')?.addEventListener('click', () => alignMulti('right'));
      el.querySelector('[data-act="dist-h"]')?.addEventListener('click', () => distributeMulti('h'));
      el.querySelector('[data-act="flip-h"]')?.addEventListener('click', () => flipMulti('h'));
      el.querySelector('[data-act="del"]')?.addEventListener('click', () => deleteSelection());
      return;
    }
    el.innerHTML = `
      <h3>Inspector</h3>
      <p>${sel.length} piezas seleccionadas.</p>
      <div class="mapviz-actions">
        <button type="button" class="mapviz-btn" data-act="al-l">Alinear izquierda</button>
        <button type="button" class="mapviz-btn" data-act="al-c">Alinear centro H</button>
        <button type="button" class="mapviz-btn" data-act="al-r">Alinear derecha</button>
        <button type="button" class="mapviz-btn" data-act="dist-h">Distribuir H</button>
        <button type="button" class="mapviz-btn" data-act="flip-h">Voltear H</button>
        <button type="button" class="mapviz-btn" data-act="del">Eliminar</button>
      </div>`;
    el.querySelector('[data-act="al-l"]')?.addEventListener('click', () => alignMulti('left'));
    el.querySelector('[data-act="al-c"]')?.addEventListener('click', () => alignMulti('centerH'));
    el.querySelector('[data-act="al-r"]')?.addEventListener('click', () => alignMulti('right'));
    el.querySelector('[data-act="dist-h"]')?.addEventListener('click', () => distributeMulti('h'));
    el.querySelector('[data-act="flip-h"]')?.addEventListener('click', () => flipMulti('h'));
    el.querySelector('[data-act="del"]')?.addEventListener('click', () => deleteSelection());
  }

  function _bindBgPanel(root) {
    const bg = backgroundByView[activeView] || {};
    const fitEl = root.querySelector('[data-bg-fit]');
    const opEl = root.querySelector('[data-bg-op]');
    const lockEl = root.querySelector('[data-bg-lock]');
    const visEl = root.querySelector('[data-bg-vis]');
    const dbg = root.querySelector('[data-bg-debug]');
    if (fitEl) fitEl.value = bg.fit || 'cover';
    if (opEl) opEl.value = bg.opacity != null ? bg.opacity : 1;
    if (lockEl) lockEl.checked = !!bg.locked;
    if (visEl) visEl.checked = bg.visible !== false;
    if (dbg) dbg.textContent = JSON.stringify(bg, null, 2);
    fitEl?.addEventListener('change', () => {
      pushUndo();
      const next = { ...(backgroundByView[activeView] || {}), fit: fitEl.value };
      backgroundByView = setMetaBackground({ backgroundByView }, activeView, next).backgroundByView;
      dirty = true;
      renderCanvas();
      renderChrome();
    });
    opEl?.addEventListener('input', () => {
      const next = { ...(backgroundByView[activeView] || {}), opacity: Number(opEl.value) || 1 };
      backgroundByView = setMetaBackground({ backgroundByView }, activeView, next).backgroundByView;
      dirty = true;
      renderCanvas();
    });
    lockEl?.addEventListener('change', () => {
      const next = { ...(backgroundByView[activeView] || {}), locked: lockEl.checked };
      backgroundByView = setMetaBackground({ backgroundByView }, activeView, next).backgroundByView;
      dirty = true;
    });
    visEl?.addEventListener('change', () => {
      const next = { ...(backgroundByView[activeView] || {}), visible: visEl.checked };
      backgroundByView = setMetaBackground({ backgroundByView }, activeView, next).backgroundByView;
      dirty = true;
      renderCanvas();
    });
    root.querySelector('[data-bg-remove]')?.addEventListener('click', () => {
      pushUndo();
      const next = { ...(backgroundByView[activeView] || {}) };
      delete next.url;
      delete next.storagePath;
      backgroundByView = setMetaBackground({ backgroundByView }, activeView, next).backgroundByView;
      dirty = true;
      renderAll();
    });
    root.querySelector('[data-bg-file]')?.addEventListener('change', async e => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        saving = true;
        renderChrome();
        const uploaded = await uploadBackgroundFile(plaza, activeView, f);
        pushUndo();
        backgroundByView = setMetaBackground({ backgroundByView }, activeView, {
          ...uploaded,
          fit: fitEl?.value || 'cover',
          opacity: Number(opEl?.value) || 1,
          locked: !!lockEl?.checked,
          visible: visEl?.checked !== false
        }).backgroundByView;
        dirty = true;
      } catch (err) {
        await _validationModal(shell, 'No se pudo subir', [String(err?.message || err)]);
      } finally {
        saving = false;
        e.target.value = '';
        renderAll();
      }
    });
  }

  function patchSelectedFromForm() {
    const el = shell.querySelector('[data-inspector]');
    if (!el || selectedList().length !== 1) return;
    const id = selectedList()[0].id;
    structure = structure.map(c => {
      if (c.id !== id) return c;
      const next = { ...c };
      el.querySelectorAll('[data-f]').forEach(inp => {
        const k = inp.getAttribute('data-f');
        if (!k) return;
        if (inp.type === 'checkbox') next[k] = inp.checked;
        else if (['width', 'height', 'x', 'y', 'rotation', 'capacidad', 'precioBase'].includes(k)) {
          const n = Number(inp.value);
          next[k] = Number.isFinite(n) ? n : next[k];
        } else next[k] = inp.value;
      });
      return normalizarElemento(next, next.orden);
    });
    dirty = true;
    renderCanvas();
    renderInspector();
    renderChrome();
  }

  function patchVisibilityFromForm() {
    const el = shell.querySelector('[data-inspector]');
    if (!el || selectedList().length !== 1) return;
    const id = selectedList()[0].id;
    const patch = {};
    el.querySelectorAll('[data-vb]').forEach(inp => {
      patch[inp.getAttribute('data-vb')] = inp.checked;
    });
    structure = structure.map(c => (c.id === id ? mergeVisibility(c, patch) : c));
    dirty = true;
    renderCanvas();
    renderChrome();
  }

  function duplicateSelection() {
    const s = selectedList();
    if (!s.length) return;
    pushUndo();
    const clones = s.map(c => {
      const n = { ...c, id: uid(), x: (c.x || 0) + 24, y: (c.y || 0) + 24, orden: structure.length };
      return normalizarElemento(n, n.orden);
    });
    structure = structure.concat(clones);
    selectedIds = new Set(clones.map(c => c.id));
    renderAll();
  }

  function duplicateRow() {
    const s = selectedList();
    if (s.length !== 1) return;
    const base = s[0];
    pushUndo();
    const clone = normalizarElemento(
      { ...base, id: uid(), x: (base.x || 0) + (base.width || 0) + 12, orden: structure.length },
      structure.length
    );
    structure.push(clone);
    selectedIds = new Set([clone.id]);
    renderAll();
  }

  function deleteSelection() {
    if (!selectedIds.size) return;
    pushUndo();
    structure = structure.filter(c => !selectedIds.has(c.id));
    selectedIds = new Set();
    renderAll();
  }

  function alignMulti(mode) {
    const s = selectedList();
    if (s.length < 2) return;
    pushUndo();
    let minX = Math.min(...s.map(c => c.x));
    let maxX = Math.max(...s.map(c => c.x + c.width));
    const mid = (minX + maxX) / 2;
    structure = structure.map(c => {
      if (!selectedIds.has(c.id)) return c;
      let nx = c.x;
      if (mode === 'left') nx = minX;
      if (mode === 'right') nx = maxX - c.width;
      if (mode === 'centerH') nx = mid - c.width / 2;
      return normalizarElemento({ ...c, x: nx }, c.orden);
    });
    renderAll();
  }

  function distributeMulti(axis) {
    const s = selectedList().sort((a, b) => a.x - b.x);
    if (s.length < 3 || axis !== 'h') return;
    pushUndo();
    const minX = s[0].x;
    const maxX = s[s.length - 1].x;
    const totalW = s.reduce((sum, c) => sum + c.width, 0);
    const gap = (maxX - minX - totalW) / (s.length - 1);
    let cx = minX;
    const byId = new Map(s.map(c => [c.id, { ...c }]));
    for (const c of s) {
      const u = byId.get(c.id);
      u.x = cx;
      cx += u.width + gap;
    }
    structure = structure.map(c => (byId.has(c.id) ? normalizarElemento(byId.get(c.id), c.orden) : c));
    renderAll();
  }

  function flipMulti(dir) {
    const s = selectedList();
    if (!s.length) return;
    pushUndo();
    const cx = s.reduce((sum, c) => sum + c.x + c.width / 2, 0) / s.length;
    structure = structure.map(c => {
      if (!selectedIds.has(c.id)) return c;
      if (dir === 'h') {
        const center = c.x + c.width / 2;
        const dx = center - cx;
        return normalizarElemento({ ...c, x: cx - c.width / 2 - dx }, c.orden);
      }
      return c;
    });
    renderAll();
  }

  function renderCanvas() {
    const canvas = shell.querySelector('[data-canvas]');
    const zlab = shell.querySelector('[data-zoom-label]');
    if (!canvas) return;
    if (zlab) zlab.textContent = `${Math.round(zoom * 100)}%`;
    const { w, h } = canvasBounds(structure);
    const bg = backgroundByView[activeView] || {};
    const bgUrl = bg.visible === false ? '' : bg.url || '';
    const bgOp = bg.opacity != null ? bg.opacity : 1;
    const fit = bg.fit || 'cover';
    const bgSize = fit === 'contain' ? 'contain' : fit === 'stretch' ? '100% 100%' : 'cover';

    let html = `<div class="mapviz-canvas-inner" style="width:${w}px;height:${h}px;transform:scale(${zoom});transform-origin:0 0;">`;
    if (bgUrl) {
      html += `<div class="mapviz-bg" style="opacity:${bgOp};background-image:url('${esc(bgUrl)}');background-size:${bgSize};"></div>`;
    }
    html += `<div class="mapviz-grid" aria-hidden="true"></div>`;

    for (const cell of structure) {
      const inView = isElementVisibleInView(cell, activeView);
      if (!inView && !showContext) continue;
      let effOp;
      if (inView) {
        effOp = focusMode ? focusOpacityForType(cell.tipo, activeView) : 1;
      } else {
        effOp = Math.min(0.42, focusOpacityForType(cell.tipo, activeView) * 0.55);
      }
      const sel = selectedIds.has(cell.id);
      const label = cell.esLabel || cell.tipo === 'label';
      const fill = cell.fill || (label ? 'rgba(148,163,184,.25)' : 'rgba(30,41,59,.55)');
      const border = cell.stroke || 'rgba(148,163,184,.6)';
      const rot = cell.rotation ? `transform:rotate(${cell.rotation}deg);` : '';
      html += `<div class="mapviz-cell mapviz-cell--${esc(cell.tipo)}${sel ? ' mapviz-cell--sel' : ''}${cell.locked ? ' mapviz-cell--locked' : ''}"
        data-cell="${esc(cell.id)}"
        style="left:${cell.x}px;top:${cell.y}px;width:${cell.width}px;height:${cell.height}px;opacity:${effOp};background:${fill};border:1px solid ${border};${rot}">
        <span class="mapviz-cell-lbl">${esc(cell.valor || cell.nombrePublico || cell.tipo)}</span>
      </div>`;
    }
    html += `</div>`;
    canvas.innerHTML = html;

    canvas.querySelectorAll('[data-cell]').forEach(node => {
      node.addEventListener('mousedown', e => {
        const id = node.getAttribute('data-cell');
        const cell = structure.find(c => c.id === id);
        if (!cell || cell.locked) return;
        e.stopPropagation();
        if (e.shiftKey) {
          if (selectedIds.has(id)) selectedIds.delete(id);
          else selectedIds.add(id);
        } else {
          selectedIds = new Set([id]);
        }
        const ids = [...selectedIds];
        const origins = new Map(structure.filter(c => ids.includes(c.id)).map(c => [c.id, { x: c.x, y: c.y }]));
        pushUndo();
        const startX = e.clientX;
        const startY = e.clientY;

        const onMove = ev => {
          const dx = (ev.clientX - startX) / zoom;
          const dy = (ev.clientY - startY) / zoom;
          const innerLive = canvas.querySelector('.mapviz-canvas-inner');
          if (!innerLive) return;
          for (const c of structure) {
            if (!ids.includes(c.id)) continue;
            const o = origins.get(c.id);
            c.x = Math.round(o.x + dx);
            c.y = Math.round(o.y + dy);
          }
          for (const n of innerLive.querySelectorAll('[data-cell]')) {
            const cid = n.getAttribute('data-cell');
            const c = structure.find(x => x.id === cid);
            if (!c) continue;
            n.style.left = `${c.x}px`;
            n.style.top = `${c.y}px`;
          }
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          structure = structure.map((c, i) => normalizarElemento(c, i));
          dirty = true;
          renderChrome();
          renderInspector();
        };
        window.addEventListener('mousemove', onMove, { passive: true });
        window.addEventListener('mouseup', onUp);
        renderCanvas();
        renderInspector();
      });
    });
  }

  function renderAll() {
    renderSidebar();
    renderInspector();
    renderCanvas();
  }

  async function save() {
    const { errors, warnings } = validateStructure(structure);
    if (errors.length) {
      await _validationModal(shell, 'Revisa antes de guardar', errors, warnings);
      return;
    }
    if (warnings.length) {
      const ok = await _validationModal(shell, 'Advertencias', errors, warnings, true);
      if (!ok) return;
    }
    saving = true;
    saveError = '';
    renderChrome();
    try {
      const payload = structure.map((c, i) => normalizarElemento(c, i));
      const res = await api.guardarEstructuraMapa(payload, plaza, {
        mapEditorExtras: {
          ...mapExtras,
          backgroundByView,
          lastEditorView: activeView,
          lastSavedAt: Date.now()
        }
      });
      if (res !== 'OK' && res !== true) throw new Error(String(res?.message || res || 'Error'));
      dirty = false;
      await resync?.();
    } catch (e) {
      saveError = String(e?.message || e);
    } finally {
      saving = false;
      renderChrome();
    }
  }

  renderChrome();

  return done;
}

function _openMobileBlock(container, plaza) {
  const wrap = document.createElement('div');
  wrap.className = 'mapviz mapviz--mobile-block';
  wrap.innerHTML = `
    <div class="mapviz-mobile-card">
      <h2>Vista bloqueada</h2>
      <p>Este editor de mapas solo se puede usar desde computadora para evitar errores de edición.</p>
      <div class="mapviz-mobile-actions">
        <a class="mapviz-btn mapviz-btn--primary" href="/app/dashboard">Volver al panel</a>
        <a class="mapviz-btn" href="/">Abrir sitio</a>
        <a class="mapviz-btn" href="/app/mapa">Ver mapa operativo</a>
      </div>
    </div>`;
  (container || document.body).appendChild(wrap);
  return new Promise(res => {
    /* user navigates away; resolve cancelled */
    const t = setTimeout(() => {
      wrap.remove();
      res({ ok: false, cancelled: true, mobileBlocked: true });
    }, 600000);
    wrap.addEventListener(
      'click',
      e => {
        if (e.target.closest('a')) {
          clearTimeout(t);
          setTimeout(() => wrap.remove(), 50);
          res({ ok: false, cancelled: true, mobileBlocked: true });
        }
      },
      true
    );
  });
}

function _validationModal(shellParent, title, errors, warnings = [], allowContinue = false) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'mapviz-modal';
    wrap.innerHTML = `
      <div class="mapviz-modal-card">
        <h3>${esc(title)}</h3>
        ${errors.length ? `<div class="mapviz-modal-block"><strong>Errores</strong><ul>${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
        ${warnings.length ? `<div class="mapviz-modal-block"><strong>Advertencias</strong><ul>${warnings.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
        <div class="mapviz-modal-actions">
          ${allowContinue ? '<button type="button" class="mapviz-btn mapviz-btn--primary" data-act="go">Guardar de todas formas</button>' : ''}
          <button type="button" class="mapviz-btn" data-act="ok">${allowContinue ? 'Volver a revisar' : 'Entendido'}</button>
        </div>
      </div>`;
    (shellParent || document.body).appendChild(wrap);
    wrap.querySelector('[data-act="ok"]')?.addEventListener('click', () => {
      wrap.remove();
      resolve(false);
    });
    wrap.querySelector('[data-act="go"]')?.addEventListener('click', () => {
      wrap.remove();
      resolve(true);
    });
  });
}
