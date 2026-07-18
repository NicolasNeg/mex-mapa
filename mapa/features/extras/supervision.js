// ═══════════════════════════════════════════════════════════
//  mapa/features/extras/supervision.js
//  Comparador multi-plaza para planes Regional/Corporativo.
//  Gate: window.mexFeatures.puedeUsar('multi_plaza')
//
//  Extraído de js/views/mapa.js Fase 4.
//  Dependencias externas:
//    - window.api    (mex-api.js)
//    - window.showToast (mapa.js → window)
// ═══════════════════════════════════════════════════════════

import { escapeHtml, descargarArchivoLocal } from '/mapa/features/core/utils.js';
import { buildExportFilename } from '/js/core/export-signing.js';

const api = window.api;

let _comparadorCache = null;

async function _obtenerMetricasComparadorPlaza(plaza) {
  const [lista, estructura] = await Promise.all([
    api.obtenerDatosFlotaConsola(plaza),
    api.obtenerEstructuraMapa(plaza),
  ]);

  const registros = Array.isArray(lista) ? lista : [];
  const totalSpots = Array.isArray(estructura)
    ? estructura.filter(item => String(item?.tipo || (item?.esLabel ? 'label' : 'cajon')).trim().toLowerCase() === 'cajon').length
    : 0;

  const metricas = {
    plaza,
    total: registros.length,
    listos: 0, sucios: 0, manto: 0, externos: 0, traslados: 0,
    totalSpots,
    ocupacion: totalSpots > 0 ? Math.round((registros.length / totalSpots) * 100) : null,
  };

  registros.forEach(item => {
    const estado    = String(item?.estado    || '').trim().toUpperCase();
    const ubicacion = String(item?.ubicacion || '').trim().toUpperCase();
    if (estado === 'LISTO') metricas.listos++;
    if (estado === 'SUCIO') metricas.sucios++;
    if (estado === 'MANTENIMIENTO' || estado === 'TALLER' ||
        estado === 'NO ARRENDABLE' || estado === 'RETENIDA') metricas.manto++;
    if (estado === 'TRASLADO') metricas.traslados++;
    if (ubicacion === 'EXTERNO') metricas.externos++;
  });

  return metricas;
}

export async function abrirComparadorPlazas() {
  const modal = document.getElementById('modal-comparador-plazas');
  if (!modal) return;
  modal.style.display = 'flex';
  _renderComparadorLoading();
  try {
    const plazas = window.MEX_CONFIG?.empresa?.plazas || [];
    if (plazas.length === 0) {
      document.getElementById('comparador-content').innerHTML =
        '<div style="text-align:center; padding:40px; color:#94a3b8; font-weight:700;">No hay plazas configuradas.</div>';
      return;
    }
    const resultados = await Promise.all(plazas.map(async p => {
      try { return await _obtenerMetricasComparadorPlaza(p); }
      catch { return { plaza: p, error: true }; }
    }));
    _comparadorCache = resultados;
    _renderComparadorTabla(resultados);
  } catch (e) {
    document.getElementById('comparador-content').innerHTML =
      `<div style="text-align:center; padding:40px; color:#ef4444; font-weight:700;">Error cargando datos: ${escapeHtml(String(e.message || e))}</div>`;
  }
}

export function cerrarComparadorPlazas() {
  const modal = document.getElementById('modal-comparador-plazas');
  if (modal) modal.style.display = 'none';
}

export function exportarComparadorCSV() {
  if (!_comparadorCache?.length) { window.showToast?.('Abre el comparador primero', 'warning'); return; }
  const plazasDetalle = window.MEX_CONFIG?.empresa?.plazasDetalle || [];
  const encabezado = ['Plaza', 'Localidad', 'Temporal', 'Total', 'Listos', 'Sucios', 'Manto', 'Externos', '% Ocup'];
  const filas = _comparadorCache.map(r => {
    const d = plazasDetalle.find(x => x.id === r.plaza) || {};
    const total = r.total || r.totalUnidades || 0;
    const spots = r.totalSpots || r.cajones || 0;
    const pct   = spots > 0 ? Math.round((total / spots) * 100) : '';
    return [
      r.plaza,
      d.localidad || d.nombre || '',
      d.temporal ? 'TEMPORAL' : 'FIJA',
      total,
      r.listos  || r.totalListos || 0,
      r.sucios  || r.totalSucios || 0,
      r.manto   || r.totalManto  || r.totalMantenimiento || 0,
      r.externos || r.totalExternos || 0,
      pct !== '' ? pct + '%' : '—',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  const csv = [encabezado.join(','), ...filas].join('\n');
  descargarArchivoLocal(buildExportFilename('csv'), '﻿' + csv, 'text/csv;charset=utf-8;');
  window.showToast?.('CSV exportado correctamente', 'success');
}

function _renderComparadorLoading() {
  const c = document.getElementById('comparador-content');
  if (!c) return;
  c.innerHTML = '<div style="text-align:center; padding:40px; color:#94a3b8; font-weight:700; display:flex; align-items:center; justify-content:center; gap:10px;"><span class="material-icons" style="animation:spin 1s linear infinite; font-size:22px;">sync</span> Cargando datos de todas las plazas...</div>';
}

function _renderComparadorTabla(resultados) {
  const c = document.getElementById('comparador-content');
  if (!c) return;
  const plazasDetalle = window.MEX_CONFIG?.empresa?.plazasDetalle || [];
  const exitosos = resultados.filter(item => !item.error);

  const cols = [
    { key: 'total',    label: 'Total',    color: '#0f172a' },
    { key: 'listos',   label: 'Listos',   color: '#10b981' },
    { key: 'sucios',   label: 'Sucios',   color: '#f59e0b' },
    { key: 'manto',    label: 'Manto.',   color: '#ef4444' },
    { key: 'externos', label: 'Externos', color: '#6366f1' },
    { key: 'ocupacion',label: '% Ocup.',  color: '#0ea5e9' },
  ];

  const topOcupacion = exitosos
    .filter(item => typeof item.ocupacion === 'number')
    .sort((a, b) => b.ocupacion - a.ocupacion)[0];
  const topListos    = [...exitosos].sort((a, b) => (b.listos || 0) - (a.listos || 0))[0];
  const totalUnidades = exitosos.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const totalExternos = exitosos.reduce((sum, item) => sum + Number(item.externos || 0), 0);

  const resumenCards = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:12px;">
      <div style="padding:12px 14px;border-radius:14px;background:#eff6ff;border:1px solid #bfdbfe;">
        <div style="font-size:11px;font-weight:900;color:#1d4ed8;letter-spacing:.06em;text-transform:uppercase;">Unidades consolidadas</div>
        <div style="font-size:26px;font-weight:900;color:#0f172a;margin-top:4px;">${totalUnidades}</div>
        <div style="font-size:11px;color:#64748b;font-weight:700;">Lectura rápida de todas las plazas</div>
      </div>
      <div style="padding:12px 14px;border-radius:14px;background:#fefce8;border:1px solid #fde68a;">
        <div style="font-size:11px;font-weight:900;color:#b45309;letter-spacing:.06em;text-transform:uppercase;">Mayor ocupación</div>
        <div style="font-size:26px;font-weight:900;color:#0f172a;margin-top:4px;">${topOcupacion ? `${topOcupacion.ocupacion}%` : '—'}</div>
        <div style="font-size:11px;color:#64748b;font-weight:700;">${escapeHtml(topOcupacion?.plaza || 'Sin datos')}</div>
      </div>
      <div style="padding:12px 14px;border-radius:14px;background:#f0fdf4;border:1px solid #bbf7d0;">
        <div style="font-size:11px;font-weight:900;color:#047857;letter-spacing:.06em;text-transform:uppercase;">Plaza más lista</div>
        <div style="font-size:26px;font-weight:900;color:#0f172a;margin-top:4px;">${topListos ? topListos.listos : 0}</div>
        <div style="font-size:11px;color:#64748b;font-weight:700;">${escapeHtml(topListos?.plaza || 'Sin datos')}</div>
      </div>
      <div style="padding:12px 14px;border-radius:14px;background:#eef2ff;border:1px solid #c7d2fe;">
        <div style="font-size:11px;font-weight:900;color:#4338ca;letter-spacing:.06em;text-transform:uppercase;">Externos total</div>
        <div style="font-size:26px;font-weight:900;color:#0f172a;margin-top:4px;">${totalExternos}</div>
        <div style="font-size:11px;color:#64748b;font-weight:700;">Unidades fuera de patio</div>
      </div>
    </div>`;

  const filas = resultados.map(item => {
    if (item.error) {
      return `<tr><td style="font-weight:800;color:#0f172a;">${escapeHtml(item.plaza)}</td>${cols.map(() => '<td style="color:#94a3b8;">—</td>').join('')}<td><span style="font-size:11px;color:#ef4444;font-weight:700;">Error</span></td></tr>`;
    }
    const detalle  = plazasDetalle.find(x => x.id === item.plaza) || {};
    const esTemporal = detalle.temporal;
    const pct = item.totalSpots > 0 ? Math.round((item.total / item.totalSpots) * 100) : null;
    const pctColor = pct === null ? '#64748b' : pct >= 90 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#10b981';
    const vals = cols.map(col => {
      const v = item[col.key];
      if (col.key === 'ocupacion') return `<td style="font-weight:800;color:${pctColor};">${pct !== null ? pct + '%' : '—'}</td>`;
      return `<td style="font-weight:700;color:${col.color};">${v ?? '—'}</td>`;
    }).join('');
    return `<tr>
      <td style="font-weight:900;color:#0f172a;">${escapeHtml(item.plaza)}${esTemporal ? ' <span style="font-size:10px;color:#f59e0b;font-weight:800;">TEMP</span>' : ''}</td>
      ${vals}
      <td><span style="font-size:11px;color:#64748b;font-weight:700;">${escapeHtml(detalle.localidad || detalle.nombre || '—')}</span></td>
    </tr>`;
  }).join('');

  c.innerHTML = resumenCards + `
    <div style="overflow-x:auto; border-radius:12px; border:1px solid #e2e8f0;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;">
            <th style="padding:10px 12px;text-align:left;font-weight:900;color:#0f172a;letter-spacing:.04em;">Plaza</th>
            ${cols.map(col => `<th style="padding:10px 12px;text-align:left;font-weight:900;color:${col.color};letter-spacing:.04em;">${col.label}</th>`).join('')}
            <th style="padding:10px 12px;text-align:left;font-weight:900;color:#64748b;letter-spacing:.04em;">Localidad</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
    <div style="margin-top:10px; font-size:11px; color:#94a3b8; font-weight:600; text-align:right;">
      Última consulta: ${new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
      · <button onclick="abrirComparadorPlazas()" style="background:none;border:none;color:#0ea5e9;font-size:11px;font-weight:800;cursor:pointer;">Actualizar</button>
    </div>`;
}
