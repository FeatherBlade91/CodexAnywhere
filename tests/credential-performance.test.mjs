import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConnectionStore } from '../vendor/siwc/storage.js';
import { createChatGPT } from '../vendor/siwc/index.js';

const state = (token = 'synthetic-a') => ({ version: 2, activeProfileId: 'a', pendingRegistrations: [], profiles: [{
  version: 1, id: 'a', label: 'Test', clientId: 'test-client', status: 'connected', scopes: ['chatgpt.tokens.use.direct'],
  savedAt: new Date().toISOString(), credentials: { accessToken: token, expiresAt: Date.now() + 3600_000 },
}] });
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'credential-perf-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let decrypts = 0, available = true, fails = false;
  // Deliberately synthetic provider: never reads or writes personal credentials.
  const encryption = { id: 'test-provider', isAvailable: () => available,
    encrypt: async text => Buffer.from(text), decrypt: async bytes => { decrypts++; if (fails) throw Error('test'); return Buffer.from(bytes).toString(); } };
  const store = new ConnectionStore(directory, encryption);
  await store.withLock(() => store.write(state()));
  return { directory, encryption, store, read: () => store.withLock(() => store.read()), count: () => decrypts,
    available: value => { available = value; }, fails: value => { fails = value; } };
}
test('concurrent reads decrypt once; returned objects never mutate cached credentials', async t => {
  const f = await fixture(t);
  const values = await Promise.all(Array.from({ length: 40 }, () => f.read()));
  assert.equal(f.count(), 1);
  values[0].profiles[0].credentials.accessToken = 'mutated';
  assert.equal((await f.read()).profiles[0].credentials.accessToken, 'synthetic-a');
  assert.equal(f.count(), 1);
});
test('external token rotation and logout are visible on the very next read', async t => {
  const f = await fixture(t); await f.read();
  const other = new ConnectionStore(f.directory, f.encryption);
  await other.withLock(() => other.write(state('synthetic-b')));
  assert.equal((await f.read()).profiles[0].credentials.accessToken, 'synthetic-b');
  assert.equal(f.count(), 2);
  await other.withLock(() => other.write({ version: 2, profiles: [], pendingRegistrations: [] }));
  assert.equal((await f.read()).profiles.length, 0);
});
test('deletion, corrupt envelopes and provider mismatch cannot fall back to cached state', async t => {
  const f = await fixture(t); await f.read();
  const file = join(f.directory, 'chatgpt-auth.json'), original = await readFile(file, 'utf8');
  for (const contents of ['{', JSON.stringify({ version: 3, provider: 'other', ciphertext: 'eA==' }), JSON.stringify({ version: 3, provider: 'test-provider', ciphertext: 'invalid' })]) {
    await writeFile(file, contents);
    await assert.rejects(f.read());
    await writeFile(file, original); assert.equal((await f.read()).profiles.length, 1);
  }
  await rm(file); assert.equal(await f.read(), undefined);
});
test('encryption availability and failed decryption are not bypassed or cached', async t => {
  const f = await fixture(t); await f.read(); f.available(false);
  await assert.rejects(f.read(), { code: 'storage_encryption_unavailable' });
  f.available(true);
  const other = new ConnectionStore(f.directory, f.encryption);
  await other.withLock(() => other.write(state('synthetic-b')));
  f.fails(true); await assert.rejects(f.read(), { code: 'storage_decryption_failed' });
  f.fails(false); assert.equal((await f.read()).profiles[0].credentials.accessToken, 'synthetic-b');
});
test('local lock queue is FIFO, releases after errors and cancels promptly without overtaking', async t => {
  const f = await fixture(t);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const order = [];
  const first = f.store.withLock(async () => { order.push(1); entered.resolve(); await release.promise; });
  await entered.promise;
  const controller = new AbortController();
  const cancelled = f.store.withLock(async () => assert.fail('cancelled operation ran'), controller.signal);
  const rejected = assert.rejects(cancelled, { code: 'cancelled' }); controller.abort();
  await rejected;
  const second = f.store.withLock(async () => { order.push(2); throw Error('synthetic'); });
  const failure = assert.rejects(second, { code: 'storage_error' });
  const third = f.store.withLock(async () => { order.push(3); });
  assert.deepEqual(order, [1]); release.resolve();
  await Promise.all([first, failure, third]); assert.deepEqual(order, [1, 2, 3]);
});

test('independent store instances still respect the filesystem lock', async t => {
  const f = await fixture(t), other = new ConnectionStore(f.directory, f.encryption);
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); let otherEntered = false;
  const first = f.store.withLock(async () => { entered.resolve(); await release.promise; await f.store.write(state('updated-under-lock')); });
  await entered.promise;
  const second = other.withLock(async () => { otherEntered = true; return other.read(); });
  await new Promise(resolve => setTimeout(resolve, 150)); assert.equal(otherEntered, false);
  release.resolve(); await first;
  assert.equal((await second).profiles[0].credentials.accessToken, 'updated-under-lock');
});
test('SDK requests remain concurrent after credential acquisition and observe external logout', async t => {
  const f = await fixture(t);
  const client = createChatGPT({ appName: 'Test', appId: 'test', redirectPort: 0, storageDir: f.directory, credentialEncryption: f.encryption });
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const first = client.withAccessToken(async token => { assert.equal(token, 'synthetic-a'); entered.resolve(); await release.promise; });
  await entered.promise;
  assert.equal(await client.withAccessToken(async token => token), 'synthetic-a');
  assert.equal(f.count(), 1); release.resolve(); await first;
  await f.store.withLock(() => f.store.write({ version: 2, profiles: [], pendingRegistrations: [] }));
  await assert.rejects(client.withAccessToken(() => assert.fail('request sent after logout')), { code: 'sign_in_required' });
});

test('warm cache still checks token expiry and prevents use before allowed refresh', async t => {
  const f = await fixture(t);
  const expired = state();
  expired.profiles[0].credentials.expiresAt = Date.now() - 1000;
  expired.profiles[0].credentials.earliestRefreshAt = (Date.now() + 3600_000) / 1000;
  await f.store.withLock(() => f.store.write(expired));
  const client = createChatGPT({ appName: 'Test', appId: 'test', redirectPort: 0, storageDir: f.directory, credentialEncryption: f.encryption });
  await client.getSession(); const count = f.count();
  await assert.rejects(client.withAccessToken(() => assert.fail('expired token used')), { code: 'refresh_not_ready' });
  assert.equal(f.count(), count);
});

test('failed writes do not cache uncommitted state or poison the lock queue', async t => {
  const f = await fixture(t); await f.read();
  const encrypt = f.encryption.encrypt;
  f.encryption.encrypt = () => { throw Error('synthetic encryption failure'); };
  await assert.rejects(f.store.withLock(() => f.store.write(state('uncommitted'))), { code: 'storage_encryption_failed' });
  f.encryption.encrypt = encrypt;
  assert.equal((await f.read()).profiles[0].credentials.accessToken, 'synthetic-a');
});

test('concurrent expired requests rotate once; a cancelled caller does not discard rotation', async t => {
  const f = await fixture(t), expired = state();
  expired.profiles[0].credentials = { accessToken: 'old', refreshToken: 'synthetic-refresh', expiresAt: Date.now() - 1000 };
  await f.store.withLock(() => f.store.write(expired));
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); let refreshes = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).endsWith('/.well-known/openid-configuration')) return Response.json({ issuer: 'https://auth.openai.com', authorization_endpoint: 'https://auth.openai.com/authorize', token_endpoint: 'https://auth.openai.com/token', jwks_uri: 'https://auth.openai.com/keys' });
    assert.equal(String(url), 'https://auth.openai.com/token');
    assert.equal(options.body.get('refresh_token'), 'synthetic-refresh');
    refreshes++; entered.resolve(); await release.promise;
    return Response.json({ access_token: 'rotated', refresh_token: 'rotated-refresh', token_type: 'Bearer', expires_in: 3600 });
  });
  const client = createChatGPT({ appName: 'Test', appId: 'test', redirectPort: 0, storageDir: f.directory, credentialEncryption: f.encryption });
  const controller = new AbortController();
  const first = client.withAccessToken(() => assert.fail('cancelled request sent'), controller.signal);
  const cancelled = assert.rejects(first, { code: 'cancelled' });
  await entered.promise; controller.abort();
  const others = Array.from({ length: 10 }, () => client.withAccessToken(async token => token));
  release.resolve(); await cancelled;
  assert.deepEqual(await Promise.all(others), Array(10).fill('rotated'));
  assert.equal(refreshes, 1);
  assert.equal((await f.read()).profiles[0].credentials.refreshToken, 'rotated-refresh');
});
