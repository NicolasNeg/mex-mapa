function _upper(value) {
  return String(value || '').trim().toUpperCase();
}

function _toMs(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  try {
    const d = value?.toDate ? value.toDate() : new Date(value);
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : 0;
  } catch (_) {
    return 0;
  }
}

export function getMiniBitacoraItems(summaryByMva, mva, limit = 3) {
  const key = _upper(mva);
  const items = summaryByMva?.[key]?.items;
  if (!Array.isArray(items) || !items.length) return [];
  return [...items]
    .sort((a, b) => _toMs(b?.timestamp || b?.fecha || b?.createdAt) - _toMs(a?.timestamp || a?.fecha || a?.createdAt))
    .slice(0, Math.max(0, Number(limit) || 3))
    .map(item => ({
      id: String(item?.id || ''),
      titulo: String(item?.titulo || item?.title || 'Incidencia'),
      descripcion: String(item?.descripcion || item?.description || ''),
      estado: String(item?.estado || ''),
      prioridad: String(item?.prioridad || item?.priority || ''),
      timestamp: _toMs(item?.timestamp || item?.fecha || item?.createdAt)
    }));
}
