export const TIPOS_NEGOCIO = {
  RENTA_AUTOS: {
    id: 'RENTA_AUTOS',
    label: 'Renta de Autos',
    descripcion: 'Flota de vehículos en renta. Control estricto por VIN, placas y número económico.',
    campos_unidad: {
      mva: {
        requerido: true,
        autocompletar: false,
        etiqueta: 'Número Económico (MVA)',
        tipo: 'text',
        alias: ['mva', 'no_economico', 'num_economico', 'economico', 'numero_economico', 'eco', 'unidad'],
      },
      placas: {
        requerido: true,
        autocompletar: true,
        etiqueta: 'Placas',
        tipo: 'text',
        alias: ['placas', 'placa', 'plates', 'matricula'],
      },
      vin: {
        requerido: true,
        autocompletar: true,
        etiqueta: 'VIN (17 caracteres)',
        tipo: 'text',
        alias: ['vin', 'niv', 'numero_serie', 'num_serie', 'serie', 'chasis'],
      },
      modelo: {
        requerido: true,
        autocompletar: true,
        etiqueta: 'Modelo',
        tipo: 'text',
        alias: ['modelo', 'model', 'descripcion_modelo'],
      },
      marca: {
        requerido: true,
        autocompletar: true,
        etiqueta: 'Marca',
        tipo: 'text',
        alias: ['marca', 'brand', 'fabricante', 'make'],
      },
      anio: {
        requerido: false,
        autocompletar: true,
        etiqueta: 'Año',
        tipo: 'number',
        alias: ['anio', 'año', 'year', 'modelo_anio', 'anio_modelo'],
      },
      color: {
        requerido: false,
        autocompletar: false,
        etiqueta: 'Color',
        tipo: 'text',
        alias: ['color', 'colour', 'color_exterior'],
      },
      num_economico: {
        requerido: false,
        autocompletar: false,
        etiqueta: 'Número Económico Alt.',
        tipo: 'text',
        alias: ['num_economico', 'numero_economico', 'no_eco'],
      },
    },
    unidades_on_demand: false,
    importacion_requerida: true,
    autocompletar_desde_catalogo: true,
    validar_vin: true,
  },

  PATIO_GENERAL: {
    id: 'PATIO_GENERAL',
    label: 'Patio General',
    descripcion: 'Patio de vehículos con registro flexible. Unidades se crean bajo demanda o por importación.',
    campos_unidad: {
      mva: {
        requerido: true,
        autocompletar: true,
        etiqueta: 'Número Económico (MVA)',
        tipo: 'text',
        alias: ['mva', 'no_economico', 'num_economico', 'economico', 'numero_economico', 'eco', 'unidad'],
      },
      placas: {
        requerido: false,
        autocompletar: true,
        etiqueta: 'Placas',
        tipo: 'text',
        alias: ['placas', 'placa', 'plates', 'matricula'],
      },
      vin: {
        requerido: false,
        autocompletar: true,
        etiqueta: 'VIN',
        tipo: 'text',
        alias: ['vin', 'niv', 'numero_serie', 'num_serie', 'serie', 'chasis'],
      },
      modelo: {
        requerido: false,
        autocompletar: true,
        etiqueta: 'Modelo',
        tipo: 'text',
        alias: ['modelo', 'model', 'descripcion_modelo'],
      },
      marca: {
        requerido: false,
        autocompletar: true,
        etiqueta: 'Marca',
        tipo: 'text',
        alias: ['marca', 'brand', 'fabricante', 'make'],
      },
      anio: {
        requerido: false,
        autocompletar: true,
        etiqueta: 'Año',
        tipo: 'number',
        alias: ['anio', 'año', 'year', 'modelo_anio', 'anio_modelo'],
      },
      color: {
        requerido: false,
        autocompletar: true,
        etiqueta: 'Color',
        tipo: 'text',
        alias: ['color', 'colour', 'color_exterior'],
      },
      num_economico: {
        requerido: false,
        autocompletar: true,
        etiqueta: 'Número Económico Alt.',
        tipo: 'text',
        alias: ['num_economico', 'numero_economico', 'no_eco'],
      },
    },
    unidades_on_demand: true,
    importacion_requerida: false,
    autocompletar_desde_catalogo: true,
    validar_vin: false,
  },

  ESTACIONAMIENTO: {
    id: 'ESTACIONAMIENTO',
    label: 'Estacionamiento',
    descripcion: 'Control de acceso vehicular. Registros temporales automáticos. Sin catálogo previo necesario.',
    campos_unidad: {
      mva: {
        requerido: false,
        autocompletar: false,
        etiqueta: 'Ticket / ID',
        tipo: 'text',
        alias: ['mva', 'ticket', 'id_acceso', 'no_economico', 'economico'],
      },
      placas: {
        requerido: false,
        autocompletar: false,
        etiqueta: 'Placas',
        tipo: 'text',
        alias: ['placas', 'placa', 'plates', 'matricula'],
      },
      vin: null,
      modelo: {
        requerido: false,
        autocompletar: false,
        etiqueta: 'Modelo',
        tipo: 'text',
        alias: ['modelo', 'model'],
      },
      marca: {
        requerido: false,
        autocompletar: false,
        etiqueta: 'Marca',
        tipo: 'text',
        alias: ['marca', 'brand', 'make'],
      },
      anio: null,
      color: {
        requerido: false,
        autocompletar: false,
        etiqueta: 'Color',
        tipo: 'text',
        alias: ['color', 'colour'],
      },
      num_economico: null,
    },
    unidades_on_demand: true,
    importacion_requerida: false,
    autocompletar_desde_catalogo: false,
    validar_vin: false,
  },
};

export function getConfigForTipo(tipo) {
  return TIPOS_NEGOCIO[tipo] || null;
}

export function buildEmpresaConfiguracion(tipo) {
  const cfg = getConfigForTipo(tipo);
  if (!cfg) throw new Error(`Tipo de negocio desconocido: ${tipo}`);
  return {
    tipo_negocio: cfg.id,
    campos_unidad: cfg.campos_unidad,
    unidades_on_demand: cfg.unidades_on_demand,
    importacion_requerida: cfg.importacion_requerida,
    autocompletar_desde_catalogo: cfg.autocompletar_desde_catalogo,
    validar_vin: cfg.validar_vin,
  };
}

export function getCsvColumnas(tipo) {
  const cfg = getConfigForTipo(tipo);
  if (!cfg) return [];
  return Object.entries(cfg.campos_unidad)
    .filter(([, def]) => def !== null)
    .map(([key, def]) => ({
      key,
      etiqueta: def.etiqueta,
      requerido: def.requerido,
    }));
}

function _buildAliasMap(tipo) {
  const cfg = getConfigForTipo(tipo);
  if (!cfg) return {};
  const map = {};
  for (const [key, def] of Object.entries(cfg.campos_unidad)) {
    if (!def) continue;
    for (const alias of def.alias || []) {
      map[alias] = key;
    }
  }
  return map;
}

function _normalizeColName(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s.#]+/g, '_');
}

export function normalizarFila(rawRow, tipo) {
  const cfg = getConfigForTipo(tipo);
  if (!cfg) return { valid: false, errors: [{ campo: 'tipo', mensaje: 'Tipo de negocio inválido' }], data: {} };

  const aliasMap = _buildAliasMap(tipo);
  const normalized = {};

  for (const [rawCol, value] of Object.entries(rawRow)) {
    const colNorm = _normalizeColName(rawCol);
    const fieldKey = aliasMap[colNorm] || colNorm;
    if (cfg.campos_unidad[fieldKey] !== undefined) {
      normalized[fieldKey] = String(value || '').trim();
    }
  }

  const errors = [];
  const data = {};

  for (const [key, def] of Object.entries(cfg.campos_unidad)) {
    if (!def) continue;
    const raw = normalized[key] || '';

    if (key === 'mva') {
      data.mva = String(raw).toUpperCase().trim();
    } else if (key === 'vin') {
      data.vin = String(raw).toUpperCase().trim();
    } else if (key === 'placas') {
      data.placas = String(raw).toUpperCase().trim();
    } else {
      data[key] = raw;
    }

    if (def.requerido && !data[key]) {
      errors.push({ campo: key, mensaje: `${def.etiqueta} es requerido` });
    }
  }

  if (cfg.validar_vin && data.vin) {
    if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(data.vin)) {
      errors.push({ campo: 'vin', mensaje: 'El VIN debe tener exactamente 17 caracteres alfanuméricos (sin I, O, Q)' });
    }
  }

  return { valid: errors.length === 0, errors, data };
}
