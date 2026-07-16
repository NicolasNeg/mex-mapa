/* ═══════════════════════════════════════════════════════════
   BUSCAR UNIDAD — panel overlay (2 pestañas: Unidades · Usuarios)
   Script clásico. Lee de window: buscarMasivo, __mexSelectCarOnMap,
   api (historial), _db (usuarios). Autocontenido: inyecta su CSS y DOM.
   Disparado por el botón lupa (desktop + mobile). z-index alto: sobrepuesto
   a todo, como un sidebar más.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__mexBuscadorReady) return;
  window.__mexBuscadorReady = true;

  var TAB = 'unidades';
  var _usersCache = null;
  var _unitsCache = null;

  // ── Cache persistente (localStorage + TTL) ─────────────────
  var CACHE_TTL_MS = 6 * 60 * 60 * 1000;   // válido 6h (recarga sin re-descargar)
  var REFRESH_AGE_MS = 30 * 60 * 1000;     // si la copia local tiene >30min, refresca en 2º plano
  var MAX_LS_BYTES = 4 * 1024 * 1024;      // guard de tamaño ~4MB
  var LS_UNITS = 'mexbz.units.v1';
  var LS_USERS = 'mexbz.users.v1';

  function _lsRead(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || (Date.now() - o.t) > CACHE_TTL_MS) return null;
      return o;   // { t, d }
    } catch (_) { return null; }
  }
  function _lsWrite(key, data) {
    try {
      var raw = JSON.stringify({ t: Date.now(), d: data });
      if (raw.length > MAX_LS_BYTES) return;   // demasiado grande → solo cache en memoria
      localStorage.setItem(key, raw);
    } catch (_) { /* quota/priv mode → ignorar */ }
  }

  // ── CSS ────────────────────────────────────────────────────
  function injectCss() {
    if (document.getElementById('mexbz-css')) return;
    var s = document.createElement('style');
    s.id = 'mexbz-css';
    s.textContent = [
      '#mexbzFab{position:fixed;top:10px;right:10px;z-index:9000;width:46px;height:46px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(15,23,42,.92);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 8px 22px rgba(0,0,0,.28);transition:transform .12s,background .15s}',
      '#mexbzFab:hover{background:#1e293b;transform:translateY(-1px)}',
      '#mexbzFab .material-icons{font-size:24px}',
      '#mexbzOverlay{position:fixed;inset:0;z-index:100000;background:rgba(7,17,31,.5);opacity:0;visibility:hidden;transition:opacity .25s ease,visibility .25s}',
      '#mexbzOverlay.open{opacity:1;visibility:visible}',
      '@keyframes mexbzSpin{to{transform:rotate(360deg)}}',
      '@keyframes mexbzRowIn{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}',
      '@keyframes mexbzFadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}',
      '.mexbz-row{animation:mexbzRowIn .18s ease both}',
      '.mexbz-ficha{animation:mexbzFadeIn .2s ease both}',
      '@media (prefers-reduced-motion:reduce){#mexbzOverlay,#mexbzPanel,.mexbz-row,.mexbz-ficha{transition:none!important;animation:none!important}}',
      '#mexbzPanel{position:absolute;top:0;right:0;bottom:0;width:min(420px,92vw);background:#fff;display:flex;flex-direction:column;box-shadow:-12px 0 40px rgba(0,0,0,.28);transform:translateX(100%);transition:transform .28s cubic-bezier(.16,1,.3,1)}',
      '#mexbzOverlay.open #mexbzPanel{transform:translateX(0)}',
      '.mexbz-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #eef2f7}',
      '.mexbz-head h2{margin:0;font-size:17px;font-weight:800;color:#0f172a;font-family:Inter,system-ui,sans-serif}',
      '.mexbz-x{background:none;border:none;cursor:pointer;color:#64748b;width:34px;height:34px;border-radius:8px;display:flex;align-items:center;justify-content:center}',
      '.mexbz-x:hover{background:#f1f5f9}',
      '.mexbz-tabs{display:flex;gap:6px;padding:10px 14px 0}',
      '.mexbz-tab{flex:1;padding:9px;border:none;background:#f1f5f9;color:#475569;font-weight:700;font-size:13px;border-radius:10px 10px 0 0;cursor:pointer;font-family:inherit}',
      '.mexbz-tab.active{background:#2563eb;color:#fff}',
      '.mexbz-searchwrap{padding:12px 14px;position:relative}',
      '.mexbz-searchwrap .material-icons{position:absolute;left:24px;top:50%;transform:translateY(-50%);color:#94a3b8;font-size:20px;pointer-events:none}',
      '#mexbzInput{width:100%;height:46px;border:1.5px solid #e2e8f0;border-radius:12px;padding:0 14px 0 44px;font-size:15px;font-family:Inter,system-ui,sans-serif;color:#0f172a}',
      '#mexbzInput:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 4px rgba(37,99,235,.12)}',
      '.mexbz-body{flex:1;overflow-y:auto;padding:0 14px 18px}',
      '.mexbz-row{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:12px;cursor:pointer;border:1px solid transparent}',
      '.mexbz-row:hover{background:#f8fafc;border-color:#eef2f7}',
      '.mexbz-row .mva{font-weight:800;color:#0f172a;font-size:14px}',
      '.mexbz-row .sub{font-size:12px;color:#64748b}',
      '.mexbz-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}',
      '.mexbz-avatar{width:38px;height:38px;border-radius:50%;flex-shrink:0;object-fit:cover;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-weight:800;color:#475569;font-size:14px}',
      '.mexbz-empty{text-align:center;color:#94a3b8;font-size:13px;padding:30px 10px}',
      '.mexbz-ficha{padding:6px 4px}',
      '.mexbz-ficha h3{margin:0 0 2px;font-size:22px;font-weight:800;color:#0f172a}',
      '.mexbz-badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.03em}',
      '.mexbz-kv{display:flex;justify-content:space-between;gap:10px;padding:9px 2px;border-bottom:1px solid #f1f5f9;font-size:13.5px}',
      '.mexbz-kv .k{color:#64748b}',
      '.mexbz-kv .v{color:#0f172a;font-weight:600;text-align:right}',
      '.mexbz-cuadre{margin:12px 0;padding:10px 12px;border-radius:12px;font-size:13px;font-weight:700;display:flex;align-items:center;gap:8px}',
      '.mexbz-cuadre.ok{background:#ecfdf5;color:#047857}',
      '.mexbz-cuadre.no{background:#fef2f2;color:#b91c1c}',
      '.mexbz-estado-row{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px}',
      '.mex-estado-chip{display:inline-block;padding:4px 10px;border-radius:4px;font-size:11px;font-weight:600;letter-spacing:.02em}',
      '.mex-estado-chip--flota{background:#f9fafb;color:#374151;border:1px solid #d1d5db}',
      '.mex-estado-chip--patio{border:1px solid transparent}',
      '.mex-estado-chip--patio.st-LISTO{background:#dcfce7;color:#166534}',
      '.mex-estado-chip--patio.st-SUCIO{background:#fef3c7;color:#92400e}',
      '.mex-estado-chip--patio.st-MANTENIMIENTO{background:#fee2e2;color:#991b1b}',
      '.mex-estado-chip--patio.st-RESGUARDO,.mex-estado-chip--patio.st-RETENIDA{background:#e0e7ff;color:#3730a3}',
      '.mexbz-btn{width:100%;height:48px;border:none;border-radius:12px;background:#2563eb;color:#fff;font-weight:700;font-size:15px;cursor:pointer;font-family:inherit;margin-top:0;display:flex;align-items:center;justify-content:center;gap:8px}',
      '.mexbz-btn:hover{background:#1d4ed8}',
      '.mexbz-btn.ghost{background:#f1f5f9;color:#334155}',
      '.mexbz-actions{display:flex;flex-direction:column;gap:8px;margin-top:12px}',
      '.mexbz-hist{margin-top:8px}',
      '.mexbz-hist-item{display:flex;gap:10px;padding:9px 2px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#334155}',
      '.mexbz-hist-item .material-icons{font-size:18px;color:#94a3b8;flex-shrink:0}',
      '.mexbz-hist-item time{display:block;font-size:11px;color:#94a3b8;margin-top:1px}',
      '.mexbz-back{background:none;border:none;color:#2563eb;font-weight:700;cursor:pointer;font-size:13px;padding:6px 0;font-family:inherit;display:flex;align-items:center;gap:4px}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── DOM ────────────────────────────────────────────────────
  function build() {
    // Sin FAB: el disparador es el buscador del header del shell (__mexBuscadorOpen).
    var ov = document.createElement('div');
    ov.id = 'mexbzOverlay';
    ov.innerHTML =
      '<aside id="mexbzPanel">' +
        '<div class="mexbz-head"><h2>Buscar</h2><div style="display:flex;gap:2px"><button class="mexbz-x" id="mexbzRefresh" title="Actualizar datos"><span class="material-icons">refresh</span></button><button class="mexbz-x" id="mexbzClose"><span class="material-icons">close</span></button></div></div>' +
        '<div class="mexbz-tabs">' +
          '<button class="mexbz-tab active" data-tab="unidades">Unidades</button>' +
          '<button class="mexbz-tab" data-tab="usuarios">Usuarios</button>' +
        '</div>' +
        '<div class="mexbz-searchwrap"><span class="material-icons">search</span><input id="mexbzInput" placeholder="Buscar unidad..." autocomplete="off"></div>' +
        '<div class="mexbz-body" id="mexbzResults"></div>' +
      '</aside>';
    document.body.appendChild(ov);

    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#mexbzClose').addEventListener('click', close);
    ov.querySelector('#mexbzRefresh').addEventListener('click', function () {
      var btn = this.querySelector('.material-icons');
      if (btn) btn.style.animation = 'mexbzSpin .7s linear infinite';
      Promise.all([loadUnitsApi(true), loadUsers(true)]).then(function () {
        if (btn) btn.style.animation = '';
        runSearch();
      });
    });
    ov.querySelectorAll('.mexbz-tab').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.tab); });
    });
    var input = ov.querySelector('#mexbzInput');
    var t;
    input.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(runSearch, 140);
    });
  }

  function open(query) {
    document.getElementById('mexbzOverlay').classList.add('open');
    var i = document.getElementById('mexbzInput');
    if (typeof query === 'string') { TAB = 'unidades'; syncTabButtons(); i.value = query; }
    setTimeout(function () { i.focus(); }, 120);
    runSearch();
  }
  // Punto de entrada global (lo llama el buscador del header del shell).
  window.__mexBuscadorOpen = function (query) { open(query || ''); };

  // Prefetch: calienta el cache (índice + usuarios) al iniciar sesión / boot, en
  // idle. Así la primera búsqueda es instantánea. Usa localStorage si está fresco
  // (0 lecturas) o descarga una vez.
  window.__mexBuscadorPrefetch = function () {
    try { loadUnitsApi(false).then(maybeBackfill); loadUsers(false); } catch (_) {}
  };

  // Auto-heal: si el índice global no tiene poblado plazaActual (ninguna unidad
  // lo trae), corre el backfill UNA vez (por navegador) y refresca el cache. Los
  // writes son solo de ubicación → permitidos para cualquier usuario. Idempotente.
  function maybeBackfill(units) {
    if (!units || !units.length) return;
    var poblado = units.some(function (u) { return u.plazaActual !== undefined && u.plazaActual !== null; });
    if (poblado) return;
    var api = window.api;
    if (!api || typeof api.backfillUbicacionGlobal !== 'function') return;
    try { if (localStorage.getItem('mexbz.backfill.v1')) return; localStorage.setItem('mexbz.backfill.v1', String(Date.now())); } catch (_) {}
    api.backfillUbicacionGlobal().then(function () {
      _unitsCache = null;
      try { localStorage.removeItem(LS_UNITS); } catch (_) {}
      loadUnitsApi(true).then(function () {
        var ov = document.getElementById('mexbzOverlay');
        if (ov && ov.classList.contains('open')) runSearch();
      });
    }).catch(function () {
      try { localStorage.removeItem('mexbz.backfill.v1'); } catch (_) {}  // permitir reintento
    });
  }

  function syncTabButtons() {
    document.querySelectorAll('.mexbz-tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === TAB);
    });
    var input = document.getElementById('mexbzInput');
    if (input) input.placeholder = TAB === 'unidades' ? 'Buscar unidad...' : 'Buscar usuario...';
  }
  function close() {
    document.getElementById('mexbzOverlay').classList.remove('open');
    // Limpiar el filtro en vivo para no dejar el mapa filtrado al cerrar.
    var live = document.getElementById('searchInput') || document.getElementById('searchInputMobile');
    if (live && live.value) { live.value = ''; if (typeof window.buscarMasivo === 'function') window.buscarMasivo(); }
  }

  function switchTab(tab) {
    if (tab === TAB) return;
    TAB = tab;
    document.querySelectorAll('.mexbz-tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    var input = document.getElementById('mexbzInput');
    input.placeholder = tab === 'unidades' ? 'Buscar unidad...' : 'Buscar usuario...';
    // Mismo buscador: el texto se conserva al cambiar de pestaña; cada sección
    // filtra su dominio con el mismo término.
    runSearch();
  }

  function runSearch() {
    if (TAB === 'unidades') return searchUnidades();
    return searchUsuarios();
  }

  // ── TAB UNIDADES ───────────────────────────────────────────
  // Fuente doble: si estamos en el mapa (hay .car en el DOM) usamos esos +
  // filtro en vivo. Si no (a nivel shell / otras rutas), consultamos Firestore
  // vía window.api.obtenerUnidadesVeloz.
  function _normCar(el) {
    var d = el.dataset;
    return { mva: d.mva, estado: d.estado, ubicacion: d.ubicacion, placas: d.placas, modelo: d.modelo,
      categoria: d.categoria, gasolina: d.gasolina, notas: d.notas, lastTouchedBy: d.lastTouchedBy,
      hay: [d.mva, d.placas, d.modelo, d.notas, d.searchTokens].join(' ').toLowerCase(), _car: el };
  }
  // Unidad del índice GLOBAL (todas las plazas). sucursal = de dónde es;
  // plazaActual = dónde está ahora; pos = spot del mapa; ubicacion = área.
  function _normRaw(u) {
    return {
      mva: u.mva, placas: u.placas, modelo: u.modelo, categoria: u.categoria || u.clase,
      vin: u.vin, anio: u.anio || u['año'] || u.anio,
      sucursal: u.sucursal, plazaActual: u.plazaActual, pos: u.pos, ubicacion: u.ubicacion,
      estado: u.estado,
      estadoFlota: u.estadoFlota || u.estado || u.estatus || '',
      estadoPatio: u.estadoPatio || '',
      hay: [u.mva, u.placas, u.modelo, u.vin, u.categoria, u.sucursal, u.plazaActual, u.estadoFlota, u.estadoPatio, u.estado].join(' ').toLowerCase(),
      _car: null
    };
  }
  function _fetchUnitsFromServer() {
    var api = window.api;
    if (!api || typeof api.obtenerUnidadesPlazas !== 'function') return Promise.resolve(_unitsCache || []);
    return api.obtenerUnidadesPlazas().then(function (list) {
      _unitsCache = (list || []).filter(function (u) { return u && u.mva; }).map(_normRaw);
      _lsWrite(LS_UNITS, _unitsCache);
      return _unitsCache;
    }).catch(function () { return _unitsCache || []; });
  }
  // force=true → servidor. Si no: memoria → localStorage (refresca en 2º plano si
  // es viejo) → servidor.
  function loadUnitsApi(force) {
    if (force) return _fetchUnitsFromServer();
    if (_unitsCache) return Promise.resolve(_unitsCache);
    var ls = _lsRead(LS_UNITS);
    if (ls) {
      _unitsCache = ls.d;
      if ((Date.now() - ls.t) > REFRESH_AGE_MS) _fetchUnitsFromServer();
      return Promise.resolve(_unitsCache);
    }
    return _fetchUnitsFromServer();
  }
  // Devuelve unidades ya en cache (memoria o LS) sin ir al servidor, o null.
  function unitsReady() {
    if (_unitsCache) return _unitsCache;
    var ls = _lsRead(LS_UNITS);
    if (ls) { _unitsCache = ls.d; if ((Date.now() - ls.t) > REFRESH_AGE_MS) _fetchUnitsFromServer(); return _unitsCache; }
    return null;
  }

  function searchUnidades() {
    var q = (document.getElementById('mexbzInput').value || '').toLowerCase().trim();
    // Siempre desde el índice global (mismo comportamiento en todas las rutas).
    // Si el cache está caliente (prefetch/localStorage) render instantáneo.
    var filtrar = function (units) {
      return (units || []).filter(function (d) { return !q || d.hay.indexOf(q) > -1; }).slice(0, 60);
    };
    var ready = unitsReady();
    if (ready) { renderUnitRows(filtrar(ready)); return; }
    var box = document.getElementById('mexbzResults');
    box.innerHTML = '<div class="mexbz-empty">Cargando unidades...</div>';
    loadUnitsApi().then(function (units) { renderUnitRows(filtrar(units)); });
  }

  // Estado de cuadre según plazaActual (índice global): En cuadre / No
  // Registrado / ERROR. plazaActual = dónde está AHORA la unidad.
  function estadoCuadre(d) {
    var pa = d.plazaActual;
    if (typeof pa === 'string' && pa.trim()) return { key: 'ok', txt: 'En cuadre', color: '#16a34a' };
    if (pa === '' || pa == null) return { key: 'no', txt: 'No Registrado', color: '#64748b' };
    return { key: 'err', txt: 'ERROR', color: '#dc2626' };
  }

  function chipsEstadoHtml(d) {
    if (window.mexEstados && typeof window.mexEstados.chipsHtml === 'function') {
      return window.mexEstados.chipsHtml(d, esc);
    }
    var flota = String(d.estadoFlota || d.estado || '').trim().toUpperCase();
    var patio = String(d.estadoPatio || '').trim().toUpperCase();
    var html = '';
    if (flota) html += '<span class="mex-estado-chip mex-estado-chip--flota">' + esc(flota) + '</span>';
    if (patio && patio !== flota) {
      html += '<span class="mex-estado-chip mex-estado-chip--patio st-' + esc(patio.replace(/\s+/g, '')) + '">' + esc(patio) + '</span>';
    }
    return html;
  }

  function flotaLabel(d) {
    if (window.mexEstados && typeof window.mexEstados.resolverEstadoFlota === 'function') {
      return window.mexEstados.resolverEstadoFlota(d) || '';
    }
    return String(d.estadoFlota || d.estado || '').trim().toUpperCase();
  }
  function ubicacionTexto(d, st) {
    if (st.key !== 'ok') return 'Sin ubicar';
    var pos = String(d.pos || '').toUpperCase();
    if (pos && pos !== 'LIMBO') return pos;              // cajón real
    if (d.ubicacion) return String(d.ubicacion);         // área operativa (PATIO…)
    return pos === 'LIMBO' ? 'Limbo' : 'Sin ubicar';
  }

  function renderUnitRows(list) {
    var box = document.getElementById('mexbzResults');
    if (!list.length) { box.innerHTML = '<div class="mexbz-empty">Sin unidades que coincidan.</div>'; return; }
    box.innerHTML = '';
    list.forEach(function (d, idx) {
      var st = estadoCuadre(d);
      var flota = flotaLabel(d);
      var row = document.createElement('div');
      row.className = 'mexbz-row';
      row.style.animationDelay = Math.min(idx, 12) * 25 + 'ms';
      row.innerHTML =
        '<span class="mexbz-dot" style="background:' + st.color + '"></span>' +
        '<div style="flex:1;min-width:0">' +
          '<div class="mva">' + esc(d.mva) + (flota ? ' <span style="font-size:11px;font-weight:600;color:#6b7280">· ' + esc(flota) + '</span>' : '') + '</div>' +
          '<div class="sub">' + esc(d.sucursal || '?') + (st.key === 'ok' ? ' → ' + esc(d.plazaActual) : ' · ' + st.txt) + (d.modelo ? ' · ' + esc(d.modelo) : '') + '</div>' +
        '</div><span class="material-icons" style="color:#cbd5e1">chevron_right</span>';
      row.addEventListener('click', function () { fichaUnidad(d); });
      box.appendChild(row);
    });
  }

  function fichaUnidad(d) {
    var st = estadoCuadre(d);
    var canView = st.key === 'ok' && typeof window.__mexCanViewPlaza === 'function' && window.__mexCanViewPlaza(d.plazaActual);
    var canUnit = typeof window.__mexCanViewUnidadExpediente === 'function' && window.__mexCanViewUnidadExpediente();
    var chips = chipsEstadoHtml(d);
    var box = document.getElementById('mexbzResults');
    box.innerHTML =
      '<button class="mexbz-back" id="mexbzBack"><span class="material-icons" style="font-size:16px">arrow_back</span>Resultados</button>' +
      '<div class="mexbz-ficha">' +
        '<h3>' + esc(d.mva) + '</h3>' +
        (chips ? '<div class="mexbz-estado-row">' + chips + '</div>' : '') +
        '<div class="mexbz-cuadre ' + (st.key === 'ok' ? 'ok' : 'no') + '" style="' + (st.key === 'err' ? 'background:#fef2f2;color:#dc2626' : '') + '"><span class="material-icons" style="font-size:18px">' + (st.key === 'ok' ? 'check_circle' : (st.key === 'err' ? 'error' : 'help')) + '</span>' + st.txt + '</div>' +
        kv('Sucursal (origen)', d.sucursal || '—') +
        kv('Plaza actual', st.key === 'ok' ? d.plazaActual : '—') +
        kv('Estado flota', flotaLabel(d) || '—') +
        kv('Estado patio', (d.estadoPatio || (window.mexEstados && window.mexEstados.leerEstadoPatio ? window.mexEstados.leerEstadoPatio(d) : '')) || '—') +
        kv('Ubicación', ubicacionTexto(d, st)) +
        kv('Placas', d.placas || '—') +
        kv('Modelo', d.modelo || '—') +
        kv('Categoría', d.categoria || '—') +
        (d.anio ? kv('Año', d.anio) : '') +
        (d.vin ? kv('VIN', d.vin) : '') +
        '<div class="mexbz-actions">' +
        (canUnit ? '<button class="mexbz-btn ghost" id="mexbzGoUnit"><span class="material-icons">directions_car</span>Ver unidad</button>' : '') +
        (canView ? '<button class="mexbz-btn" id="mexbzGoMap"><span class="material-icons">map</span>Ver en mapa</button>' : '') +
        '</div>' +
      '</div>';
    box.querySelector('#mexbzBack').addEventListener('click', searchUnidades);
    var goUnit = box.querySelector('#mexbzGoUnit');
    if (goUnit) goUnit.addEventListener('click', function () {
      close();
      if (typeof window.__mexGoToUnidad === 'function') {
        window.__mexGoToUnidad(d.mva);
      } else {
        window.__mexShellNavigate?.('/app/cuadre/u/' + encodeURIComponent(String(d.mva || '').trim().toUpperCase()));
      }
    });
    var go = box.querySelector('#mexbzGoMap');
    if (go) go.addEventListener('click', function () {
      close();
      if (typeof window.__mexGoToMapUnit === 'function') {
        window.__mexGoToMapUnit(d.mva, d.plazaActual);
      } else {
        window.location.assign('/app/mapa');
      }
    });
  }

  // ── TAB USUARIOS ───────────────────────────────────────────
  function _fetchUsersFromServer() {
    var db = window._db;
    if (!db) return Promise.resolve(_usersCache || []);
    return db.collection('usuarios').get().then(function (snap) {
      _usersCache = snap.docs.map(function (doc) { var x = doc.data() || {}; x.id = doc.id; return x; });
      _lsWrite(LS_USERS, _usersCache);
      return _usersCache;
    }).catch(function () { return _usersCache || []; });
  }
  function loadUsers(force) {
    if (force) return _fetchUsersFromServer();
    if (_usersCache) return Promise.resolve(_usersCache);
    var ls = _lsRead(LS_USERS);
    if (ls) {
      _usersCache = ls.d;
      if ((Date.now() - ls.t) > REFRESH_AGE_MS) _fetchUsersFromServer();
      return Promise.resolve(_usersCache);
    }
    return _fetchUsersFromServer();
  }
  function usersReady() {
    if (_usersCache) return _usersCache;
    var ls = _lsRead(LS_USERS);
    if (ls) { _usersCache = ls.d; if ((Date.now() - ls.t) > REFRESH_AGE_MS) _fetchUsersFromServer(); return _usersCache; }
    return null;
  }

  function searchUsuarios() {
    var q = (document.getElementById('mexbzInput').value || '').toLowerCase().trim();
    var box = document.getElementById('mexbzResults');
    var ready = usersReady();
    if (!ready) box.innerHTML = '<div class="mexbz-empty">Cargando usuarios...</div>';
    (ready ? Promise.resolve(ready) : loadUsers()).then(function (users) {
      var list = users.filter(function (u) {
        var name = (u.nombreCompleto || u.nombre || u.usuario || '').toLowerCase();
        var mail = (u.email || u.id || '').toLowerCase();
        return !q || name.indexOf(q) > -1 || mail.indexOf(q) > -1;
      }).slice(0, 40);
      if (!list.length) { box.innerHTML = '<div class="mexbz-empty">Sin usuarios que coincidan.</div>'; return; }
      box.innerHTML = '';
      list.forEach(function (u, idx) {
        var row = document.createElement('div');
        row.className = 'mexbz-row';
        row.style.animationDelay = Math.min(idx, 12) * 25 + 'ms';
        row.innerHTML = avatarHtml(u) +
          '<div style="flex:1;min-width:0">' +
            '<div class="mva">' + esc(u.nombreCompleto || u.nombre || u.usuario || 'Usuario') + '</div>' +
            '<div class="sub">' + esc(u.rol || u.role || '—') + ' · ' + esc(u.email || u.id || '') + '</div>' +
          '</div><span class="material-icons" style="color:#cbd5e1">chevron_right</span>';
        row.addEventListener('click', function () { fichaUsuario(u); });
        box.appendChild(row);
      });
    });
  }

  function fichaUsuario(u) {
    var activo = String(u.status || 'ACTIVO').toUpperCase() !== 'INACTIVO';
    var box = document.getElementById('mexbzResults');
    box.innerHTML =
      '<button class="mexbz-back" id="mexbzBack"><span class="material-icons" style="font-size:16px">arrow_back</span>Resultados</button>' +
      '<div class="mexbz-ficha">' +
        '<div style="display:flex;align-items:center;gap:14px;margin-bottom:8px">' + avatarHtml(u, 58) +
          '<div><h3 style="font-size:18px">' + esc(u.nombreCompleto || u.nombre || u.usuario || 'Usuario') + '</h3>' +
          '<span class="mexbz-badge" style="background:' + (activo ? '#ecfdf5;color:#047857' : '#fef2f2;color:#b91c1c') + '">' + (activo ? 'Activo' : 'Inactivo') + '</span></div>' +
        '</div>' +
        kv('Rol', u.rol || u.role || '—') +
        kv('Correo', u.email || u.id || '—') +
        kv('Teléfono', u.telefono || '—') +
        kv('Plaza', u.plazaAsignada || u.plaza || '—') +
        '<button class="mexbz-btn ghost" id="mexbzVerMas"><span class="material-icons">history</span>Ver movimientos recientes</button>' +
        '<div class="mexbz-hist" id="mexbzHist"></div>' +
      '</div>';
    box.querySelector('#mexbzBack').addEventListener('click', searchUsuarios);
    box.querySelector('#mexbzVerMas').addEventListener('click', function () { verHistorial(u); });
  }

  function verHistorial(u) {
    var host = document.getElementById('mexbzHist');
    host.innerHTML = '<div class="mexbz-empty">Cargando historial...</div>';
    var name = (u.nombreCompleto || u.nombre || u.usuario || '').toUpperCase().trim();
    var api = window.api || {};
    Promise.all([
      api.obtenerHistorialLogs ? api.obtenerHistorialLogs().catch(function () { return []; }) : [],
      api.obtenerLogsServer ? api.obtenerLogsServer().catch(function () { return []; }) : []
    ]).then(function (res) {
      var moves = res[0] || [], logs = res[1] || [], items = [];
      moves.forEach(function (m) {
        if ((m.autor || '').toUpperCase().trim() !== name) return;
        var txt;
        if (m.tipo === 'DEL') txt = 'Eliminó la unidad ' + (m.mva || '');
        else if (m.tipo === 'SWAP') txt = 'Intercambió ' + (m.mva || '') + ' · ' + (m.detalles || '');
        else txt = 'Movió ' + (m.mva || '') + ' · ' + (m.detalles || '');
        items.push({ ts: m.timestamp || 0, txt: txt, icon: m.tipo === 'DEL' ? 'delete' : 'swap_horiz' });
      });
      logs.forEach(function (l) {
        if ((l.autor || '').toUpperCase().trim() !== name) return;
        var txt = l.estado ? ('Cambió estado ' + (l.mva || '') + ' → ' + l.estado) : (l.accion || (l.tipo + ' ' + (l.mva || '')));
        items.push({ ts: l.timestamp || 0, txt: txt, icon: 'edit' });
      });
      items.sort(function (a, b) { return b.ts - a.ts; });
      items = items.slice(0, 20);
      if (!items.length) { host.innerHTML = '<div class="mexbz-empty">Sin movimientos registrados.</div>'; return; }
      host.innerHTML = items.map(function (it) {
        return '<div class="mexbz-hist-item"><span class="material-icons">' + it.icon + '</span>' +
          '<div>' + esc(it.txt) + '<time>' + fmtTs(it.ts) + '</time></div></div>';
      }).join('');
    });
  }

  // ── Helpers ────────────────────────────────────────────────
  function kv(k, v) { return '<div class="mexbz-kv"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></div>'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function fmtTs(ts) { if (!ts) return ''; try { return new Date(ts).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } }
  function estadoColor(estado) {
    var e = (estado || '').toUpperCase();
    if (e.indexOf('LISTO') > -1 || e.indexOf('DISPONIBLE') > -1) return '#16a34a';
    if (e.indexOf('SUCIO') > -1) return '#eab308';
    if (e.indexOf('TALLER') > -1 || e.indexOf('MANTEN') > -1) return '#dc2626';
    if (e.indexOf('TRASLAD') > -1) return '#2563eb';
    return '#64748b';
  }
  function avatarHtml(u, size) {
    var s = size || 38;
    var url = u.avatarUrl || u.fotoURL || u.photoURL || '';
    var ini = (u.nombreCompleto || u.nombre || u.usuario || '?').trim().charAt(0).toUpperCase();
    if (url) return '<img class="mexbz-avatar" style="width:' + s + 'px;height:' + s + 'px" src="' + esc(url) + '" onerror="this.replaceWith(Object.assign(document.createElement(\'div\'),{className:\'mexbz-avatar\',textContent:\'' + esc(ini) + '\'}))">';
    return '<div class="mexbz-avatar" style="width:' + s + 'px;height:' + s + 'px">' + esc(ini) + '</div>';
  }

  // ── Init ───────────────────────────────────────────────────
  function init() { injectCss(); build(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
