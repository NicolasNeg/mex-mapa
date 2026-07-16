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

  window._mexParts = window._mexParts || {};
  window._mexParts.externos = {

    async insertarUnidadExterna(objeto) {
      const mvaStr = _sanitizeText(objeto?.mva).toUpperCase();
      const docId = _mvaToDocId(mvaStr);
      const plazaUp = _normalizePlazaId(objeto?.plaza);
      const actor = _sanitizeText(objeto?.responsableSesion || objeto?._updatedBy || objeto?._createdBy || 'Sistema') || 'Sistema';

      if (!mvaStr) return 'ERROR: El MVA es obligatorio para registrar un externo.';
      if (!plazaUp) return 'ERROR: La plaza es obligatoria para registrar un externo.';

      const dupQuery = db.collection(COL.EXTERNOS).where('plaza', '==', plazaUp).where('mva', '==', mvaStr).limit(1);
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
      await _registrarLog('IN', `🚗 EXTERNO INSERTADO: ${mvaStr}`, actor, plazaUp, {
        mva: mvaStr,
        cambio: 'Unidad externa insertada'
      });
      return `EXITO|${unitData.modelo}|${unitData.placas}`;
    },

    async obtenerExternosPlaza(plaza, options = {}) {
      const plazaUp = _normalizePlazaId(plaza);
      const limit = typeof _normalizePositiveInt === 'function'
        ? _normalizePositiveInt(options.limit, null)
        : null;
      let query = plazaUp
        ? db.collection(COL.EXTERNOS).where('plaza', '==', plazaUp).orderBy('_createdAt', 'desc')
        : db.collection(COL.EXTERNOS).orderBy('_createdAt', 'desc');
      if (limit) query = query.limit(limit);
      const snap = await query.get();
      return snap.docs.map(d => ({ id: d.id, ...d.data(), tipo: 'externo', ubicacion: 'EXTERNO' }));
    }

  };
})();
