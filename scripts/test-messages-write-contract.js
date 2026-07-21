#!/usr/bin/env node

const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');

test('enviarMensajePrivado persiste identidad canonica y conserva metadata visible', async () => {
  let storedId = '';
  let storedPayload = null;
  const db = {
    collection(name) {
      assert.equal(name, 'mensajes');
      return {
        doc(id) {
          storedId = id;
          return {
            async set(payload) {
              storedPayload = payload;
            },
          };
        },
      };
    },
  };

  global.window = {
    _mex: {
      db,
      COL: { MENSAJES: 'mensajes' },
      firebase: {},
      _ts: () => 1721580000000,
      _now: () => '21/07/2026 12:00',
    },
    _mexParts: {},
  };

  const modulePath = path.join(__dirname, '..', 'api', 'alertas.js');
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);

  await window._mexParts.alertas.enviarMensajePrivado(
    'LEONARDO HERNANDEZ',
    'ANGEL ARMENTA',
    'Hola',
    null,
    null,
    null,
    {
      remitenteUid: 'uid-leonardo',
      remitenteEmail: ' Leonardo@Example.com ',
      remitenteNombre: 'LEONARDO HERNANDEZ',
      destinatarioUid: 'uid-angel',
      destinatarioEmail: ' Angel@Example.com ',
      destinatarioNombre: 'ANGEL ARMENTA',
    }
  );

  assert.match(storedId, /^msg_1721580000000_/);
  assert.equal(storedPayload.remitente, 'LEONARDO@EXAMPLE.COM');
  assert.equal(storedPayload.destinatario, 'ANGEL@EXAMPLE.COM');
  assert.equal(storedPayload.remitenteEmail, 'leonardo@example.com');
  assert.equal(storedPayload.destinatarioEmail, 'angel@example.com');
  assert.equal(storedPayload.remitenteNombre, 'LEONARDO HERNANDEZ');
  assert.equal(storedPayload.destinatarioNombre, 'ANGEL ARMENTA');
  assert.deepEqual(storedPayload.participantUids, ['uid-angel', 'uid-leonardo']);
  assert.deepEqual(storedPayload.participantEmails, ['angel@example.com', 'leonardo@example.com']);
  assert.equal(storedPayload.conversationId, 'UID:uid-angel:uid-leonardo');
});
