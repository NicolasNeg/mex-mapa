import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeHistorialLog } from './historial-log.model.js';

test('BAJA conserva el motivo y kilometraje capturados', () => {
  const row = normalizeHistorialLog({
    tipo: 'BAJA',
    accion: 'SE ELIMINO LA UNIDAD: D5129',
    mva: 'D5129',
    cambio: 'Unidad eliminada',
    motivoSalida: 'renta',
    km: 84520
  });

  assert.equal(row.mva, 'D5129');
  assert.equal(row.motivoSalida, 'RENTA');
  assert.equal(row.km, 84520);
});

test('BAJA historica no inventa un motivo ausente', () => {
  const row = normalizeHistorialLog({
    tipo: 'BAJA',
    accion: 'SE ELIMINO LA UNIDAD: B2380'
  });

  assert.equal(row.mva, 'B2380');
  assert.equal(row.motivoSalida, '');
  assert.equal(row.km, null);
});

test('IN conserva kilometraje cero como valor valido', () => {
  const row = normalizeHistorialLog({
    tipo: 'IN',
    accion: 'INSERTADO: D4003',
    mva: 'D4003',
    cambio: 'Unidad insertada',
    km: 0
  });

  assert.equal(row.km, 0);
});

test('IN reciente recupera km desde el texto legacy', () => {
  const row = normalizeHistorialLog({
    tipo: 'IN',
    accion: 'INSERTADO: D4003',
    cambio: 'Unidad insertada - km 45210'
  });

  assert.equal(row.km, 45210);
  assert.equal(row.cambio, 'Unidad insertada - km 45210');
});

test('EDIT normaliza estado, ubicacion y nota nueva estructurados', () => {
  const row = normalizeHistorialLog({
    tipo: 'EDIT',
    accion: 'B1673: Estado SUCIO -> LISTO | Ubi A-2 -> B-8 | Notas actualizadas',
    mva: 'B1673',
    cambio: 'Cambio de estado - Cambio de ubicacion - Notas actualizadas',
    cambios: [
      { campo: 'estado', anterior: 'SUCIO', nuevo: 'LISTO' },
      { campo: 'ubicacion', anterior: 'A-2', nuevo: 'B-8' },
      { campo: 'notas', anterior: 'Golpe leve', nuevo: 'Lavado terminado' }
    ]
  });

  assert.equal(row.estadoAnterior, 'SUCIO');
  assert.equal(row.estadoNuevo, 'LISTO');
  assert.equal(row.ubicacionAnterior, 'A-2');
  assert.equal(row.ubicacionNueva, 'B-8');
  assert.equal(row.notaAnterior, 'Golpe leve');
  assert.equal(row.notaNueva, 'Lavado terminado');
});

test('EDIT legacy recupera ubicacion sin campos nuevos', () => {
  const row = normalizeHistorialLog({
    tipo: 'EDIT',
    accion: 'I165: Estado LISTO -> SUCIO | Ubi TALLER-2 -> LAVADOINT-2'
  });

  assert.equal(row.estadoAnterior, 'LISTO');
  assert.equal(row.estadoNuevo, 'SUCIO');
  assert.equal(row.ubicacionAnterior, 'TALLER-2');
  assert.equal(row.ubicacionNueva, 'LAVADOINT-2');
  assert.equal(row.notaNueva, '');
});

test('EDIT legacy recupera un cambio que solo contiene ubicacion', () => {
  const row = normalizeHistorialLog({
    tipo: 'MODIF',
    accion: 'C2185: Ubi L-8 -> A-9'
  });

  assert.equal(row.ubicacionAnterior, 'L-8');
  assert.equal(row.ubicacionNueva, 'A-9');
});
