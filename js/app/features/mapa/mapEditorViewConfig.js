// ═══════════════════════════════════════════════════════════
//  Configuración central del editor de mapa por vista (App Shell).
// ═══════════════════════════════════════════════════════════

/** @typedef {'global'|'mesas'|'estacionamiento'|'albercas'} MapEditorViewId */

/** @typedef {{ id: MapEditorViewId, label: string, accent: string, storageField: string, focusTypes: string[] }} MapEditorViewDef */

export const MAP_EDITOR_VIEWS = /** @type {const} */ ({
  global: {
    id: 'global',
    label: 'Global',
    accent: 'neutral',
    storageField: 'mapaDistribucionJson',
    focusTypes: ['area', 'servicio', 'entrada', 'palapa', 'pool', 'camino', 'marker', 'label', 'buffer', 'cajon', 'mesa']
  },
  mesas: {
    id: 'mesas',
    label: 'Mesas',
    accent: 'green',
    storageField: 'mapaMesasJson',
    focusTypes: ['mesa', 'zona_reservable', 'palapa', 'servicio', 'marker', 'label', 'cajon', 'pool', 'area']
  },
  estacionamiento: {
    id: 'estacionamiento',
    label: 'Estacionamiento',
    accent: 'yellow',
    storageField: 'mapaEstacionamientoJson',
    focusTypes: ['cajon', 'camino', 'entrada', 'buffer', 'area', 'label', 'marker', 'servicio']
  },
  albercas: {
    id: 'albercas',
    label: 'Albercas',
    accent: 'blue',
    storageField: 'mapaDistribucionJson',
    focusTypes: ['pool', 'chapoteadero', 'water_area', 'zona_acuatica', 'area', 'camino', 'servicio', 'palapa', 'marker', 'mesa', 'cajon']
  }
});

export const MAP_EDITOR_VIEW_ORDER = /** @type {MapEditorViewId[]} */ (['global', 'mesas', 'estacionamiento', 'albercas']);

/** @param {MapEditorViewId} id */
export function getViewConfig(id) {
  return MAP_EDITOR_VIEWS[id] || MAP_EDITOR_VIEWS.global;
}
