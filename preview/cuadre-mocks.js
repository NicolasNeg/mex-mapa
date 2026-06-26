// preview/cuadre-mocks.js — mocks para el PREVIEW de cuadre (NO producción).
// El import-map de cuadre-preview.html redirige los 3 imports de
// js/app/views/cuadre.js a este módulo, así la vista operativa real se
// renderiza con datos falsos y sin tocar Firebase.

const PLAZA = 'CDMX';

const _u = (mva, modelo, categoria, placas, gasolina, estado, ubicacion, pos, tipo = 'renta', notas = '') => ({
  id: mva, mva, modelo, categoria, placas, gasolina, estado, ubicacion, notas, pos,
  plaza: PLAZA, tipo, fechaIngreso: Date.now() - 86400000,
  updatedAt: Date.now() - 3600000, updatedBy: 'preview', version: 1,
});

const UNITS = [
  _u('MVA1001', 'Nissan Versa 2023',   'ECONOMICO', 'ABC-12-34', 'LLENO',   'LISTO',        'A1',  'PATIO'),
  _u('MVA1002', 'Kia Rio 2022',        'ECONOMICO', 'XYZ-98-76', '3/4',     'SUCIO',        'A2',  'PATIO'),
  _u('MVA1003', 'Toyota Corolla 2024', 'INTERMEDIO','JKL-55-22', 'MEDIO',   'MANTENIMIENTO','TALLER','TALLER'),
  _u('MVA1004', 'VW Jetta 2023',       'INTERMEDIO','QWE-33-11', 'LLENO',   'LISTO',        'B1',  'PATIO'),
  _u('MVA1005', 'Chevrolet Aveo 2021', 'ECONOMICO', 'RTY-77-88', '1/4',     'RESGUARDO',    'B2',  'PATIO'),
  _u('MVA1006', 'Honda CR-V 2024',     'SUV',       'POI-44-99', 'LLENO',   'LISTO',        '',    'LIMBO'),
  _u('EXT2001', 'Mazda 3 2023',        'INTERMEDIO','EXT-10-10', 'MEDIO',   'LISTO',        'EXTERNO','PATIO', 'externo'),
  _u('EXT2002', 'Renault Stepway 2022','ECONOMICO', 'EXT-20-20', '3/4',     'SUCIO',        'EXTERNO','PATIO', 'externo'),
];

// ── /js/app/app-state.js ──────────────────────────────────────
export function getState() { return { currentPlaza: PLAZA }; }
export function onPlazaChange(_cb) { return () => {}; }

// ── /js/app/features/cuadre/cuadre-data.js ────────────────────
export function subscribeCuadre({ plaza, onData }) {
  setTimeout(() => { try { onData(UNITS.slice()); } catch (_) {} }, 150);
  return () => {};
}
export async function getUnidadBitacora({ mva } = {}) {
  return [
    { accion: 'CAMBIO_ESTADO', de: 'SUCIO', a: 'LISTO', autor: 'preview', timestamp: Date.now() - 7200000, mva },
    { accion: 'GASOLINA',      de: '1/2',   a: 'LLENO', autor: 'preview', timestamp: Date.now() - 3600000, mva },
  ];
}
export function readCuadreCache() { return []; }
export function writeCuadreCache() {}
export function getCuadreSnapshot() { return Promise.resolve(UNITS.slice()); }
export function normalizeCuadreRecord(id, d = {}) { return { id, ...d }; }

// ── /js/core/database.js ──────────────────────────────────────
export async function obtenerCuadreAdminsData() {
  return [
    _u('ADM3001', 'Audi A4 2024',  'PREMIUM', 'ADM-01-01', 'LLENO', 'LISTO', 'VIP1', 'PATIO', 'admin'),
    _u('ADM3002', 'BMW 320i 2023', 'PREMIUM', 'ADM-02-02', 'MEDIO', 'SUCIO', 'VIP2', 'PATIO', 'admin'),
  ];
}
export async function obtenerHistorialCuadres() {
  return [
    { id: 'H1', fecha: '2026-06-25', autor: 'Gerente', total: 42, listos: 30, sucios: 8, plaza: PLAZA },
    { id: 'H2', fecha: '2026-06-24', autor: 'Supervisor', total: 40, listos: 28, sucios: 9, plaza: PLAZA },
  ];
}
// db/COL stubs por si algún import los referencia.
export const db = {};
export const COL = { CUADRE: 'cuadre', EXTERNOS: 'externos' };
