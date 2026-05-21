// ═══════════════════════════════════════════════════════════
//  /api/externos.js  —  Operaciones enfocadas en externos
//  Depende de: window._mex (expuesto por mex-api.js)
// ═══════════════════════════════════════════════════════════
(function () {
  const {
    db, COL,
    _mvaToDocId, _now, _sanitizeText, _normalizePlazaId,
    _actualizarFeed, _registrarLog, _buildPlazaScopedQuery, _normalizePositiveInt
  } = window._mex;

  function _eid() {
    const ctx = window._empresaActual;
    if (!ctx || ctx.isSuperAdminContext) return '';
    return ctx.id || '';
  }

  window._mexParts = window._mexParts || {};
  window._mexParts.externos = {

    async insertarUnidadExterna(objeto) {
      const mvaStr = _sanitizeText(objeto?.mva).toUpperCase();
      const docId = _mvaToDocId(mvaStr);
      const plazaUp = _normalizePlazaId(objeto?.plaza);
      const actor = _sanitizeText(objeto?.responsableSesion || objeto?._updatedBy || objeto?._createdBy || 'Sistema') || 'Sistema';

      if (!mvaStr) return 'ERROR: El MVA es obligatorio para registrar un externo.';
      if (!plazaUp) return 'ERROR: La plaza es obligatoria para registrar un externo.';

      const eidIUE = _eid();
      let dupQuery;
      if (eidIUE) {
        dupQuery = db.collection(COL.EXTERNOS).where('empresaId', '==', eidIUE).where('plaza', '==', plazaUp).where('mva', '==', mvaStr).limit(1);
      } else {
        dupQuery = typeof _buildPlazaScopedQuery === 'function'
          ? _buildPlazaScopedQuery(COL.EXTERNOS, plazaUp, { wheres: [['mva', '==', mvaStr]], limit: 1 })
          : db.collection(COL.EXTERNOS).where('plaza', '==', plazaUp).where('mva', '==', mvaStr).limit(1);
      }
      const dupSnap = await dupQuery.get();
      if (!dupSnap.empty) return `La unidad externa ${mvaStr} ya está registrada.`;

      const ahora = _now();
      const notaFinal = objeto?.notas ? `(${ahora}) - ${objeto.notas} - ${actor}` : '';
      const unitData = {
        mva: mvaStr,
        modelo: String(objeto?.modelo || 'S/M').trim().toUpperCase(),
        categoria: String(objeto?.categoria || objeto?.categ || 'EXTERNO').trim().toUpperCase(),
        placas: String(objeto?.placas || 'S/P').trim().toUpperCase(),
        estado: 'EXTERNO',
        ubicacion: 'EXTERNO',
        gasolina: 'N/A',
        notas: notaFinal,
        pos: 'LIMBO',
        plaza: plazaUp,
        tipo: 'externo',
        empresaId: _eid(),
        fechaIngreso: new Date().toISOString(),
        _createdAt: ahora,
        _createdBy: actor,
        _updatedAt: ahora,
        _updatedBy: actor,
        _version: 1,
        version: 1,
        lastTouchedAt: ahora,
        lastTouchedBy: actor
      };

      await db.collection(COL.EXTERNOS).doc(docId).set(unitData);
      await _actualizarFeed(`EXT IN: ${mvaStr} (${unitData.modelo})`, actor, plazaUp);
      await _registrarLog('IN', `🚗 EXTERNO INSERTADO: ${mvaStr}`, actor, plazaUp);
      return `EXITO|${unitData.modelo}|${unitData.placas}`;
    },

    async obtenerExternosPlaza(plaza, options = {}) {
      const plazaUp = _normalizePlazaId(plaza);
      const eidOEP = _eid();
      const limit = typeof _normalizePositiveInt === 'function'
        ? _normalizePositiveInt(options.limit, null)
        : null;
      let query;
      if (eidOEP && plazaUp) {
        query = db.collection(COL.EXTERNOS).where('empresaId', '==', eidOEP).where('plaza', '==', plazaUp).orderBy('_createdAt', 'desc');
      } else if (eidOEP) {
        query = db.collection(COL.EXTERNOS).where('empresaId', '==', eidOEP).orderBy('_createdAt', 'desc');
      } else if (plazaUp) {
        query = typeof _buildPlazaScopedQuery === 'function'
          ? _buildPlazaScopedQuery(COL.EXTERNOS, plazaUp, {
              orderBy: { field: '_createdAt', direction: 'desc' },
              limit
            })
          : db.collection(COL.EXTERNOS).where('plaza', '==', plazaUp).orderBy('_createdAt', 'desc');
      } else {
        query = db.collection(COL.EXTERNOS).orderBy('_createdAt', 'desc');
      }
      const snap = await (limit && !plazaUp && !eidOEP ? query.limit(limit).get() : query.get());
      return snap.docs.map(d => ({ id: d.id, ...d.data(), tipo: 'externo', ubicacion: 'EXTERNO' }));
    }

  };
})();
