// ═══════════════════════════════════════════════════════════
//  mapa-loader.js — Orquestador modular del mapa
//  Carga el config correcto (arrendadora), los templates HTML
//  y los feature modules.
//
//  Reemplaza el import directo de /js/views/mapa.js en
//  js/app/views/mapa.js una vez completada la migración.
// ═══════════════════════════════════════════════════════════

// TODO Fase 6: implementar orquestador completo.
// Por ahora re-exporta el bootstrap del monolito legado.

export async function loadMapa(stageEl) {
  // Producto especializado: único giro soportado.
  const configModule = await import('/mapa/configs/arrendadora.config.js');
  const config = configModule.default;

  // Cargar feature modules del core (siempre)
  await Promise.all([
    import('/mapa/features/core/init.js'),
    import('/mapa/features/core/render.js'),
    import('/mapa/features/core/permissions.js'),
    import('/mapa/features/core/modals.js'),
    import('/mapa/features/core/search.js'),
    import('/mapa/features/core/plaza-switcher.js'),
    import('/mapa/features/core/unit-selection.js'),
    import('/mapa/features/core/notifications.js'),
  ]);

  // Cargar feature modules por tipo
  if (config.features?.length) {
    await Promise.all(config.features.map(f => import(f).catch(() => {})));
  }

  // Cargar extras controlados por feature gates
  const gate = window.mexFeatures?.puedeUsar || (() => true);
  const extras = [
    gate('edicion_mapa')  && import('/mapa/features/extras/editmap-inline.js'),
    gate('auditoria')     && import('/mapa/features/extras/auditoria.js'),
    gate('ia_placas')     && import('/mapa/features/extras/ocr.js'),
    gate('reportes')      && import('/mapa/features/extras/pdf-reports.js'),
    gate('multi_plaza')   && import('/mapa/features/extras/supervision.js'),
  ].filter(Boolean);
  await Promise.all(extras.map(p => p.catch(() => {})));

  return config;
}
