import assert from 'node:assert';
import { test } from 'node:test';
import { generarCodigo, nuevaInvitacion, estadoInvitacion, puedeUsarse } from './invitacion.model.js';

test('generarCodigo: 8 chars, sin caracteres ambiguos', () => {
  const c = generarCodigo();
  assert.match(c, /^[A-HJ-NP-Z2-9]{8}$/);
});

test('nuevaInvitacion: shape correcto y expiración futura', () => {
  const inv = nuevaInvitacion({ plaza: 'CDMX', rol: 'AUXILIAR', expiraEnDias: 7, creadoPor: 'jefe@x.com' });
  assert.equal(inv.plaza, 'CDMX');
  assert.equal(inv.rol, 'AUXILIAR');
  assert.equal(inv.usadaPor, null);
  assert.equal(inv.revocada, false);
  assert.ok(inv.expiraEnMs > inv.creadoEnMs);
});

test('estadoInvitacion: vigente / expirada / usada / revocada', () => {
  const base = nuevaInvitacion({ plaza: 'CDMX', rol: 'AUXILIAR', expiraEnDias: 7, creadoPor: 'x' });
  const ahora = base.creadoEnMs + 1000;
  assert.equal(estadoInvitacion(base, ahora), 'VIGENTE');
  assert.equal(estadoInvitacion(base, base.expiraEnMs + 1), 'EXPIRADA');
  assert.equal(estadoInvitacion({ ...base, usadaPor: 'a@b.com', usadaEnMs: ahora }, ahora), 'USADA');
  assert.equal(estadoInvitacion({ ...base, revocada: true }, ahora), 'REVOCADA');
});

test('puedeUsarse: solo si vigente', () => {
  const base = nuevaInvitacion({ plaza: 'CDMX', rol: 'AUXILIAR', expiraEnDias: 7, creadoPor: 'x' });
  assert.equal(puedeUsarse(base, base.creadoEnMs + 1000), true);
  assert.equal(puedeUsarse({ ...base, revocada: true }, base.creadoEnMs + 1000), false);
});
