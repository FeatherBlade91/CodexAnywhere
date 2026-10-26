import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createCredentialClient, handleCredentialMessage } from '../src/desktop/credential-channel.mjs';

test('trusted credential channel correlates concurrent requests and converts cloned buffers', async () => {
  const port = new EventEmitter();
  const storage = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async value => Buffer.from('encrypted:' + value),
    decryptStringAsync: async value => ({ result: value.toString().slice(10) }),
  };
  port.postMessage = data => { void handleCredentialMessage(structuredClone(data), storage, reply => port.emit('message', { data: structuredClone(reply) })); };
  const client = createCredentialClient(port);
  try {
    assert.equal(await client.isAvailable(), true);
    const results = await Promise.all(['first', 'second', 'third'].map(async text => client.decrypt(await client.encrypt(text))));
    assert.deepEqual(results, ['first', 'second', 'third']);
  } finally { client.dispose(); }
});

test('unavailable storage and invalid operations fail closed without echoing credentials', async () => {
  let reply;
  await handleCredentialMessage({ id: 1, operation: 'encrypt', value: 'secret' }, { isAsyncEncryptionAvailable: async () => false }, value => reply = value);
  assert.equal(reply.result, undefined); assert.ok(reply.error); assert.ok(!JSON.stringify(reply).includes('secret'));
  await handleCredentialMessage({ id: 2, operation: 'arbitrary' }, { isAsyncEncryptionAvailable: async () => true }, value => reply = value);
  assert.ok(reply.error);
});

test('lost replies time out and disposing rejects pending operations', async () => {
  const port = new EventEmitter(); port.postMessage = () => {};
  const client = createCredentialClient(port, { timeout: 10 });
  await assert.rejects(client.isAvailable(), /timed out/);
  const pending = client.encrypt('synthetic'); client.dispose();
  await assert.rejects(pending, /closed/);
  assert.equal(port.listenerCount('message'), 0);
});


test('Linux refuses plaintext fallback even when Electron reports encryption available', async () => {
  for (const backend of ['basic_text', 'unknown']) {
    let reply;
    const storage = { isAsyncEncryptionAvailable: async () => true, getSelectedStorageBackend: () => backend,
      encryptStringAsync: () => assert.fail('must not encrypt with fallback') };
    await handleCredentialMessage({ id: 1, operation: 'available' }, storage, value => reply = value);
    assert.equal(reply.result, false);
    await handleCredentialMessage({ id: 2, operation: 'encrypt', value: 'secret' }, storage, value => reply = value);
    assert.ok(reply.error);
  }
});
