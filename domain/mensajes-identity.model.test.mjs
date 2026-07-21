import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildIdentityDirectory,
  buildMyIdentity,
  canonicalizeArchivedConversations,
  getCanonicalMessageIdentity,
  getPeerKey,
  isMessageMine
} from './mensajes-identity.model.js';

test('unifica nombre y correo cuando pertenecen al mismo UID', () => {
  const directory = buildIdentityDirectory([
    { authUid: 'uid-angel', email: 'angel@example.com', nombre: 'Angel Armenta' }
  ]);
  const me = buildMyIdentity({ uid: 'uid-me', email: 'yo@example.com', nombre: 'Yo' });

  const legacy = { remitente: 'ANGEL ARMENTA', destinatario: 'YO' };
  const modern = {
    remitente: 'ANGEL@EXAMPLE.COM',
    remitenteEmail: 'angel@example.com',
    destinatario: 'YO@EXAMPLE.COM',
    destinatarioEmail: 'yo@example.com'
  };

  assert.equal(getPeerKey(legacy, me, directory), 'UID:uid-angel');
  assert.equal(getPeerKey(modern, me, directory), 'UID:uid-angel');
});

test('nombre y correo terminan en una sola agrupacion de historial', () => {
  const directory = buildIdentityDirectory([
    { authUid: 'uid-angel', email: 'angel@example.com', nombre: 'Angel Armenta' }
  ]);
  const me = buildMyIdentity({ uid: 'uid-me', email: 'yo@example.com', nombre: 'Yo' });
  const messages = [
    { id: 'legacy', remitente: 'ANGEL ARMENTA', destinatario: 'YO', leido: false },
    {
      id: 'email',
      remitente: 'YO@EXAMPLE.COM',
      remitenteEmail: 'yo@example.com',
      destinatario: 'ANGEL@EXAMPLE.COM',
      destinatarioEmail: 'angel@example.com',
      leido: true
    }
  ];
  const grouped = new Map();

  for (const message of messages) {
    const key = getPeerKey(message, me, directory);
    grouped.set(key, [...(grouped.get(key) || []), message.id]);
  }

  assert.equal(grouped.size, 1);
  assert.deepEqual(grouped.get('UID:uid-angel'), ['legacy', 'email']);
});

test('no fusiona homonimos cuando el alias de nombre es ambiguo', () => {
  const directory = buildIdentityDirectory([
    { uid: 'uid-1', email: 'uno@example.com', nombre: 'Juan Perez' },
    { uid: 'uid-2', email: 'dos@example.com', nombre: 'Juan Perez' }
  ]);

  assert.equal(
    getCanonicalMessageIdentity(' Juan   Perez ', '', directory).key,
    'LEGACY:JUAN PEREZ'
  );
  assert.equal(
    getCanonicalMessageIdentity('uno@example.com', '', directory).key,
    'UID:uid-1'
  );
  assert.equal(
    getCanonicalMessageIdentity('dos@example.com', '', directory).key,
    'UID:uid-2'
  );
});

test('normaliza mayusculas y espacios en nombres y correos', () => {
  const directory = buildIdentityDirectory([
    { uid: 'uid-angel', email: ' Angel@Example.COM ', nombre: '  Angel   Armenta  ' }
  ]);

  assert.equal(
    getCanonicalMessageIdentity(' angel   armenta ', '', directory).key,
    'UID:uid-angel'
  );
  assert.equal(
    getCanonicalMessageIdentity(' ANGEL@EXAMPLE.COM ', '', directory).key,
    'UID:uid-angel'
  );
});

test('correos historico y actual del mismo UID conservan una identidad', () => {
  const directory = buildIdentityDirectory([
    { uid: 'uid-angel', email: 'anterior@example.com', nombre: 'Angel Armenta' },
    { uid: 'uid-angel', email: 'actual@example.com', nombre: 'Angel Armenta' }
  ]);

  assert.equal(
    getCanonicalMessageIdentity('anterior@example.com', '', directory).key,
    'UID:uid-angel'
  );
  assert.equal(
    getCanonicalMessageIdentity('actual@example.com', '', directory).key,
    'UID:uid-angel'
  );
});

test('detecta mensajes propios por UID, correo y alias de nombre', () => {
  const me = buildMyIdentity({
    uid: 'uid-me',
    email: 'yo@example.com',
    nombre: 'Leonardo Hernandez'
  });
  const directory = buildIdentityDirectory([
    { uid: 'uid-me', email: 'yo@example.com', nombre: 'Leonardo Hernandez' },
    { uid: 'uid-peer', email: 'peer@example.com', nombre: 'Angel Armenta' }
  ]);

  assert.equal(isMessageMine({
    remitente: 'otro valor', remitenteUid: 'uid-me', destinatario: 'peer@example.com'
  }, me, directory), true);
  assert.equal(isMessageMine({
    remitente: ' YO@EXAMPLE.COM ', destinatario: 'peer@example.com'
  }, me, directory), true);
  assert.equal(isMessageMine({
    remitente: ' Leonardo   Hernandez ', destinatario: 'peer@example.com'
  }, me, directory), true);
  assert.equal(isMessageMine({
    remitente: 'peer@example.com', destinatario: 'yo@example.com'
  }, me, directory), false);
});

test('migra archivos legacy y conserva la fecha mayor al colisionar', () => {
  const directory = buildIdentityDirectory([
    { uid: 'uid-angel', email: 'angel@example.com', nombre: 'Angel Armenta' }
  ]);
  const archived = canonicalizeArchivedConversations({
    'LEGACY:ANGEL ARMENTA': 100,
    'EMAIL:angel@example.com': 250,
    'LEGACY:SIN DIRECTORIO': 75
  }, directory);

  assert.deepEqual(archived, {
    'UID:uid-angel': 250,
    'LEGACY:SIN DIRECTORIO': 75
  });
});
