// ============================================================================
//  /api/traslados.js - Fase B: ciclo de vida de traslados
//  Script clasico. Depende de window._mex y api/cuadre.js.
// ============================================================================
(function () {
  const {
    db, COL, firebase,
    _normalizePlazaId, _mvaToDocId, _now, _ts,
    _actualizarFeed, _registrarLog, _registrarEventoGestion,
    _matchesPlaza
  } = window._mex;

  const FV = firebase && firebase.firestore ? firebase.firestore.FieldValue : window.firebase.firestore.FieldValue;
  const TRASLADOS_COL = 'traslados';
  const DEFAULT_TIPOS = [
    { codigo: 'CORT', etiqueta: 'Cortesia' },
    { codigo: 'GAS', etiqueta: 'Carga de gasolina' },
    { codigo: 'TRANS', etiqueta: 'Transporte de personal' },
    { codigo: 'DROP', etiqueta: 'Retorno por drop off' },
    { codigo: 'INTER', etiqueta: 'Intercambio' },
    { codigo: 'NOCOM', etiqueta: 'No comercial' }
  ];
  const ROLE_LEVEL = {
    AUXILIAR: 1,
    VENTAS: 2,
    SUPERVISOR: 3,
    JEFE_PATIO: 4,
    GERENTE_PLAZA: 5,
    JEFE_REGIONAL: 6,
    CORPORATIVO_USER: 7,
    JEFE_OPERACION: 8,
    PROGRAMADOR: 9
  };

  function _upper(v) { return String(v || '').trim().toUpperCase(); }
  function _text(v) { return String(v || '').trim(); }
  function _num(v) {
    const raw = String(v == null ? '' : v).replace(/[,\s]/g, '');
    return /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
  }
  function _toMs(v) {
    if (!v) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'object' && typeof v.seconds === 'number') return v.seconds * 1000;
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const parts = v.split('-').map(Number);
      return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
    }
    const ms = new Date(v).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  function _iso(v, fallbackMs) {
    const ms = _toMs(v) || fallbackMs || Date.now();
    return new Date(ms).toISOString();
  }
  function _estadoDerivado(t, nowMs) {
    if (_upper(t && t.estado) === 'CERRADO') return 'CERRADO';
    return 'ABIERTO';
  }
  function _choferElegible(u) {
    return u
      && u.isChofer === true
      && !!_text(u.licenciaVencimiento || u.licenciaChoferVence)
      && !!_text(u.licenciaArchivoUrl || u.licenciaArchivoPath || u.licenciaUrl);
  }
  function _userName(u) { return _text(u.nombreCompleto || u.displayName || u.nombre || u.usuario || u.email || 'Usuario'); }
  function _tipoList() {
    const raw = window.MEX_CONFIG && window.MEX_CONFIG.listas;
    const list = raw && (raw.tiposTraslado || raw.razonesTraslado || raw.trasladosTipos);
    if (!Array.isArray(list) || !list.length) return DEFAULT_TIPOS;
    return list.map(item => {
      if (typeof item === 'string') return { codigo: _upper(item), etiqueta: item };
      return {
        codigo: _upper(item.codigo || item.id || item.valor || item.nombre),
        etiqueta: _text(item.etiqueta || item.label || item.nombre || item.codigo || item.id)
      };
    }).filter(item => item.codigo);
  }
  function _plazasList() {
    const emp = window.MEX_CONFIG && window.MEX_CONFIG.empresa;
    const fromSimple = Array.isArray(emp && emp.plazas) ? emp.plazas : [];
    const fromDetail = Array.isArray(emp && emp.plazasDetalle) ? emp.plazasDetalle.map(item => item && (item.id || item.codigo || item.nombre)) : [];
    return Array.from(new Set(fromSimple.concat(fromDetail).map(_normalizePlazaId).filter(Boolean))).sort();
  }
  function _tipoEtiqueta(codigo) {
    const raw = _upper(codigo);
    const found = _tipoList().find(item => _upper(item.codigo) === raw);
    return found ? found.etiqueta : raw;
  }
  function _canManageTraslados(roleOverride = '') {
    if (window.mexPerms?.canDo?.('traslados_gestionar')) return true;
    return (ROLE_LEVEL[_upper(roleOverride) || _currentRole()] || 0) >= ROLE_LEVEL.VENTAS;
  }
  function _currentRole() {
    return _upper(
      window.MEX_CONFIG?.profile?.rol ||
      window._userProfile?.rol ||
      window.currentUserProfile?.rol ||
      window.CURRENT_USER_PROFILE?.rol ||
      window.MEX_CONFIG?.profile?.role ||
      ''
    );
  }
  function _canViewTraslados(roleOverride = '') {
    const role = _upper(roleOverride) || _currentRole();
    return _canManageTraslados(role) || (ROLE_LEVEL[role] || 0) >= ROLE_LEVEL.VENTAS;
  }
  function _actorName(usuario) { return _text(usuario || window.MEX_CONFIG?.profile?.nombre || window._userProfile?.nombre || window._auth?.currentUser?.email || 'Sistema'); }

  async function _nextFolio() {
    const ref = db.collection(COL.CONFIG || 'configuracion').doc('counters');
    const next = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const current = snap.exists && typeof snap.data().traslados === 'number' ? snap.data().traslados : 0;
      const n = current + 1;
      tx.set(ref, { traslados: n, trasladosUpdatedAt: _ts() }, { merge: true });
      return n;
    });
    return 'TR-' + String(next).padStart(5, '0');
  }

  async function _findUnidadCuadre(mva, plaza) {
    const mvaStr = _upper(mva);
    const plazaUp = _normalizePlazaId(plaza);
    const snap = await db.collection(COL.CUADRE).where('plaza', '==', plazaUp).where('mva', '==', mvaStr).limit(1).get();
    if (!snap.empty) return { ref: snap.docs[0].ref, id: snap.docs[0].id, data: snap.docs[0].data() };
    const ref = db.collection(COL.CUADRE).doc(_mvaToDocId(mvaStr));
    const doc = await ref.get();
    if (doc.exists && (!plazaUp || _matchesPlaza(doc.data(), plazaUp))) return { ref, id: doc.id, data: doc.data() };
    return null;
  }

  async function _findChofer(uid) {
    const key = _text(uid);
    if (!key) return null;
    const direct = await db.collection(COL.USERS).doc(key).get();
    if (direct.exists) return { id: direct.id, ref: direct.ref, data: direct.data() };
    const snap = await db.collection(COL.USERS).where('authUid', '==', key).limit(1).get();
    if (!snap.empty) return { id: snap.docs[0].id, ref: snap.docs[0].ref, data: snap.docs[0].data() };
    return null;
  }

  async function _openTrasladoForMva(mva) {
    const snap = await db.collection(TRASLADOS_COL).where('mva', '==', _upper(mva)).where('estado', '==', 'ABIERTO').limit(1).get();
    return snap.empty ? null : { id: snap.docs[0].id, data: snap.docs[0].data() };
  }

  async function _loadTraslados(plaza) {
    const plazaUp = _normalizePlazaId(plaza);
    const snaps = plazaUp
      ? await Promise.all([
          db.collection(TRASLADOS_COL).where('plazaOrigen', '==', plazaUp).limit(250).get(),
          db.collection(TRASLADOS_COL).where('plazaDestino', '==', plazaUp).limit(250).get()
        ])
      : [await db.collection(TRASLADOS_COL).limit(300).get()];
    const map = new Map();
    snaps.forEach(snap => snap.docs.forEach(doc => map.set(doc.id, { id: doc.id, ...doc.data() })));
    const rows = Array.from(map.values());
    rows.sort((a, b) => (_toMs(b.fechaCreacion) || _toMs(b.fechaSalida)) - (_toMs(a.fechaCreacion) || _toMs(a.fechaSalida)));
    return rows.map(row => ({ ...row, estadoOperativo: _estadoDerivado(row) }));
  }

  async function _loadUnidades(plaza) {
    const plazaUp = _normalizePlazaId(plaza);
    const snap = await db.collection(COL.CUADRE).where('plaza', '==', plazaUp).get();
    const rows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(u => u.mva);
    rows.sort((a, b) => String(a.mva || '').localeCompare(String(b.mva || '')));
    return rows;
  }

  async function _loadChoferes() {
    const snap = await db.collection(COL.USERS).limit(300).get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(_choferElegible)
      .map(u => ({
        id: u.id,
        uid: u.authUid || u.id,
        nombre: _userName(u),
        licenciaVencimiento: u.licenciaVencimiento || '',
        licenciaArchivoUrl: u.licenciaArchivoUrl || ''
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  function _edicion(campo, antes, despues, usuario) {
    return { campo, antes: antes == null ? '' : String(antes), despues: despues == null ? '' : String(despues), usuario: _actorName(usuario), fecha: _now(), timestamp: _ts() };
  }

  function _validarCierre(data, kmLlegada, fechaCierre) {
    if (kmLlegada == null || kmLlegada < 0) return 'Kilometraje de llegada invalido';
    if (typeof data.kmSalida === 'number' && kmLlegada < data.kmSalida) return 'El km de llegada no puede ser menor al km de salida';
    const now = Date.now();
    const cierreMs = _toMs(fechaCierre) || now;
    if (cierreMs > now) return 'La fecha de cierre no puede estar en el futuro';
    if (cierreMs < now - 5 * 60 * 1000) return 'La fecha de cierre no puede ser anterior a 5 minutos';
    const salidaMs = _toMs(data.fechaSalida);
    if (salidaMs && cierreMs < salidaMs) return 'La fecha de cierre no puede ser anterior a la salida';
    return '';
  }

  window._mexParts = window._mexParts || {};
  window._mexParts.traslados = {
    async obtenerTrasladosBootstrap(opts = {}) {
      if (!_canViewTraslados(opts.actorRole || opts.rol)) throw new Error('No tienes permiso para ver traslados');
      const plaza = _normalizePlazaId(opts.plaza || window.__mexCurrentPlazaId || window.MEX_CONFIG?.profile?.plazaAsignada || '');
      const [traslados, unidades, choferes] = await Promise.all([
        _loadTraslados(plaza), _loadUnidades(plaza), _loadChoferes()
      ]);
      return { plaza, plazas: _plazasList(), traslados, unidades, choferes, tipos: _tipoList(), canManage: _canManageTraslados(opts.actorRole || opts.rol) };
    },

    async crearTraslado(payload = {}) {
      if (!_canManageTraslados(payload.actorRole || payload.rol)) return { ok: false, error: 'No tienes permiso para gestionar traslados' };
      const mva = _upper(payload.mva);
      const plazaOrigen = _normalizePlazaId(payload.plazaOrigen);
      const plazaDestino = _normalizePlazaId(payload.plazaDestino || plazaOrigen);
      const choferUid = _text(payload.choferUid);
      const tipo = _upper(payload.tipo);
      const kmSalida = _num(payload.kmSalida);
      if (!mva) return { ok: false, error: 'Selecciona una unidad' };
      if (!plazaOrigen || !plazaDestino) return { ok: false, error: 'Selecciona plaza origen y destino' };
      if (!choferUid) return { ok: false, error: 'Selecciona chofer' };
      if (!tipo) return { ok: false, error: 'Selecciona razon del traslado' };
      if (kmSalida == null) return { ok: false, error: 'Captura km de salida' };
      const unit = await _findUnidadCuadre(mva, plazaOrigen);
      if (!unit) return { ok: false, error: 'La unidad debe estar en el cuadre de la plaza origen' };
      const open = await _openTrasladoForMva(mva);
      if (open) return { ok: false, error: 'La unidad ya tiene un traslado abierto' };
      const chofer = await _findChofer(choferUid);
      if (!chofer || !_choferElegible(chofer.data)) return { ok: false, error: 'El chofer debe estar registrado con licencia cargada' };

      const actor = _actorName(payload.usuario);
      const nowText = _now();
      const salidaIso = _iso(payload.fechaSalida, Date.now());
      const folio = await _nextFolio();
      const ref = db.collection(TRASLADOS_COL).doc();
      const data = {
        folio, mva, modelo: unit.data.modelo || '', placas: unit.data.placas || '', categoria: unit.data.categoria || '',
        tipo, tipoEtiqueta: _text(payload.tipoEtiqueta || _tipoEtiqueta(tipo)), choferUid: chofer.data.authUid || chofer.id,
        choferNombre: _userName(chofer.data), plazaOrigen, plazaDestino,
        kmSalida, gasSalida: unit.data.gasolina || 'N/A', fechaSalida: salidaIso,
        fechaRegresoEstimada: payload.fechaRegresoEstimada ? _iso(payload.fechaRegresoEstimada) : '',
        estado: 'ABIERTO', creadoPor: actor, fechaCreacion: nowText, timestampCreacion: _ts(),
        notas: payload.nota ? [{ texto: _text(payload.nota), usuario: actor, fecha: nowText, timestamp: _ts() }] : [],
        ediciones: [], estadoAntesTraslado: unit.data.estado || '', ubicacionAntesTraslado: unit.data.ubicacion || ''
      };
      await ref.set(data);
      const kmRes = await window.api.registrarKm({ mva, km: kmSalida, fuente: 'TRASLADO_SALIDA', usuario: actor, plaza: plazaOrigen, trasladoId: ref.id });
      if (kmRes !== 'EXITO') {
        await ref.delete();
        return { ok: false, error: kmRes || 'No se pudo registrar el kilometraje de salida' };
      }
      await unit.ref.set({ estado: 'TRASLADO', traslado_destino: plazaDestino, trasladoId: ref.id, trasladoFolio: folio, _updatedAt: nowText, _updatedBy: actor }, { merge: true });
      await _actualizarFeed('TRASLADO SALIDA: ' + mva + ' -> ' + plazaDestino, actor, plazaOrigen);
      await _registrarLog('TRASLADO', 'TRASLADO CREADO: ' + folio + ' · ' + mva + ' -> ' + plazaDestino, actor, plazaOrigen);
      await _registrarEventoGestion('TRASLADO_CREADO', 'Creo traslado ' + folio + ' para ' + mva, actor, { entidad: 'TRASLADO', referencia: ref.id, plaza: plazaOrigen });
      return { ok: true, id: ref.id, folio };
    },

    async actualizarTraslado(id, cambios = {}) {
      if (!_canManageTraslados(cambios.actorRole || cambios.rol)) return { ok: false, error: 'No tienes permiso para gestionar traslados' };
      const ref = db.collection(TRASLADOS_COL).doc(_text(id));
      const snap = await ref.get();
      if (!snap.exists) return { ok: false, error: 'Traslado no encontrado' };
      const cur = snap.data();
      if (_upper(cur.estado) === 'CERRADO') return { ok: false, error: 'El traslado ya esta cerrado' };
      const actor = _actorName(cambios.usuario);
      const update = {};
      const edits = [];
      const setField = (field, value) => {
        if (value == null || value === '') return;
        const next = field.includes('plaza') ? _normalizePlazaId(value) : _text(value);
        if (String(cur[field] || '') === String(next || '')) return;
        update[field] = next;
        edits.push(_edicion(field, cur[field], next, actor));
      };
      setField('tipo', cambios.tipo ? _upper(cambios.tipo) : '');
      if (update.tipo) update.tipoEtiqueta = _tipoEtiqueta(update.tipo);
      setField('plazaDestino', cambios.plazaDestino);
      setField('fechaSalida', cambios.fechaSalida ? _iso(cambios.fechaSalida) : '');
      setField('fechaRegresoEstimada', cambios.fechaRegresoEstimada ? _iso(cambios.fechaRegresoEstimada) : '');
      if (cambios.choferUid) {
        const chofer = await _findChofer(cambios.choferUid);
        if (!chofer || !_choferElegible(chofer.data)) return { ok: false, error: 'El chofer debe estar registrado con licencia cargada' };
        if (String(cur.choferUid || '') !== String(chofer.data.authUid || chofer.id)) {
          update.choferUid = chofer.data.authUid || chofer.id;
          update.choferNombre = _userName(chofer.data);
          edits.push(_edicion('chofer', cur.choferNombre, update.choferNombre, actor));
        }
      }
      if (cambios.nota) {
        const notas = Array.isArray(cur.notas) ? cur.notas.slice() : [];
        notas.push({ texto: _text(cambios.nota), usuario: actor, fecha: _now(), timestamp: _ts() });
        update.notas = notas;
      }
      if (!Object.keys(update).length && !edits.length) return { ok: true, id };
      update.ediciones = (Array.isArray(cur.ediciones) ? cur.ediciones : []).concat(edits);
      update.actualizadoPor = actor;
      update.fechaActualizacion = _now();
      await ref.set(update, { merge: true });
      if (update.plazaDestino) {
        const unit = await _findUnidadCuadre(cur.mva, cur.plazaOrigen);
        if (unit) await unit.ref.set({ traslado_destino: update.plazaDestino, _updatedAt: _now(), _updatedBy: actor }, { merge: true });
      }
      return { ok: true, id };
    },

    async cerrarTraslado(id, payload = {}) {
      if (!_canManageTraslados(payload.actorRole || payload.rol)) return { ok: false, error: 'No tienes permiso para gestionar traslados' };
      const ref = db.collection(TRASLADOS_COL).doc(_text(id));
      const snap = await ref.get();
      if (!snap.exists) return { ok: false, error: 'Traslado no encontrado' };
      const data = snap.data();
      if (_upper(data.estado) === 'CERRADO') return { ok: false, error: 'El traslado ya esta cerrado' };
      const actor = _actorName(payload.usuario);
      const kmLlegada = _num(payload.kmLlegada);
      const gasLlegada = _text(payload.gasLlegada || data.gasSalida || 'N/A').toUpperCase();
      const fechaCierre = _iso(payload.fechaCierre, Date.now());
      const err = _validarCierre(data, kmLlegada, fechaCierre);
      if (err) return { ok: false, error: err };

      const unit = await _findUnidadCuadre(data.mva, data.plazaOrigen);
      const kmRes = await window.api.registrarKm({ mva: data.mva, km: kmLlegada, fuente: 'TRASLADO_LLEGADA', usuario: actor, plaza: data.plazaDestino, trasladoId: ref.id });
      if (kmRes !== 'EXITO') {
        return { ok: false, error: kmRes || 'No se pudo registrar el kilometraje de llegada' };
      }
      const samePlaza = _normalizePlazaId(data.plazaOrigen) === _normalizePlazaId(data.plazaDestino);
      const clearFields = { traslado_destino: FV.delete(), trasladoId: FV.delete(), trasladoFolio: FV.delete() };
      if (samePlaza) {
        if (unit) await unit.ref.set({ ...clearFields, estado: data.estadoAntesTraslado || 'LISTO', ubicacion: data.ubicacionAntesTraslado || 'PATIO', gasolina: gasLlegada, km: kmLlegada, _updatedAt: _now(), _updatedBy: actor }, { merge: true });
      } else {
        const base = unit ? unit.data : {};
        if (unit) await unit.ref.delete();
        await db.collection(COL.CUADRE).doc(_mvaToDocId(data.mva)).set({
          ...base, ...clearFields, mva: data.mva, modelo: data.modelo || base.modelo || '', placas: data.placas || base.placas || '',
          plaza: data.plazaDestino, pos: 'LIMBO', ubicacion: 'PATIO', estado: data.estadoAntesTraslado || 'SUCIO', gasolina: gasLlegada,
          km: kmLlegada, fechaIngreso: new Date().toISOString(), _updatedAt: _now(), _updatedBy: actor
        }, { merge: true });
        const idx = await db.collection(COL.INDEX).where('mva', '==', data.mva).limit(1).get();
        if (!idx.empty) await idx.docs[0].ref.set({ plazaActual: data.plazaDestino, pos: 'LIMBO', ubicacion: 'PATIO' }, { merge: true });
      }
      const cierreNota = _text(payload.nota || '');
      const notas = Array.isArray(data.notas) ? data.notas.slice() : [];
      if (cierreNota) notas.push({ texto: cierreNota, usuario: actor, fecha: _now(), timestamp: _ts(), tipo: 'CIERRE' });
      const cierre = { estado: 'CERRADO', kmLlegada, gasLlegada, fechaCierre, cerradoPor: actor, notaCierre: cierreNota, notas, ediciones: (Array.isArray(data.ediciones) ? data.ediciones : []).concat([_edicion('estado', 'ABIERTO', 'CERRADO', actor)]) };
      await ref.set(cierre, { merge: true });
      await _actualizarFeed('TRASLADO CERRADO: ' + data.mva + ' -> ' + data.plazaDestino, actor, data.plazaDestino);
      await _registrarLog('TRASLADO', 'TRASLADO CERRADO: ' + (data.folio || ref.id) + ' · ' + data.mva, actor, data.plazaDestino);
      return { ok: true, id: ref.id };
    }
  };
})();
