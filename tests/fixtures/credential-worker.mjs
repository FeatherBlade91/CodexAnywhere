import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
const base = process.env.BRIDGE_SOURCE_ROOT;
const { createCredentialClient } = await import(pathToFileURL(join(base, 'src/desktop/credential-channel.mjs')));
const { ConnectionStore } = await import(pathToFileURL(join(base, 'vendor/siwc/storage.js')));
const encryption = createCredentialClient(process.parentPort);
try {
  const directory = process.env.BRIDGE_CREDENTIAL_FIXTURE;
  const store = new ConnectionStore(directory, encryption);
  if (process.env.BRIDGE_CREDENTIAL_WRITE === '1') await store.withLock(() => store.write({
    version: 2, activeProfileId: 'synthetic', pendingRegistrations: [], profiles: [{
      version: 1, id: 'synthetic', label: 'Test', clientId: 'test', status: 'connected', scopes: ['chatgpt.tokens.use.direct'],
      savedAt: new Date().toISOString(), credentials: { accessToken: 'mac-keychain-synthetic-test-token', expiresAt: Date.now() + 3600000 },
    }],
  }));
  const state = await store.withLock(() => store.read());
  const disk = await readFile(join(directory, 'chatgpt-auth.json'), 'utf8');
  process.parentPort.postMessage({ done: true, roundTrip: state.profiles[0].credentials.accessToken === 'mac-keychain-synthetic-test-token', encrypted: !disk.includes('mac-keychain-synthetic-test-token'), provider: JSON.parse(disk).provider });
} catch { process.parentPort.postMessage({ done: true, error: 'Native credential fixture failed' }); }
finally { encryption.dispose(); }
