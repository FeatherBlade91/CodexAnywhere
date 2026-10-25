import test from 'node:test';
import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('macOS Keychain encrypts on disk and decrypts in a fresh utility process', { skip: process.platform !== 'darwin', timeout: 180000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-keychain-'));
  const env = { ...process.env, CHATGPT_BRIDGE_STATE_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const options = process.env.BRIDGE_TEST_EXE ? { executablePath: resolve(process.env.BRIDGE_TEST_EXE), args: [] } : { args: [resolve('.')] };
  options.args.push(`--user-data-dir=${join(dir, 'profile')}`);
  let desktop;
  try {
    desktop = await electron.launch({ ...options, env });
    await (await desktop.firstWindow()).locator('#toggle-service:not([disabled])').waitFor();
    for (const write of [true, false]) {
      const result = await desktop.evaluate(async ({ app, utilityProcess, safeStorage }, { fixture, directory, write }) => {
        const { createRequire } = process.getBuiltinModule('node:module');
        const { join } = process.getBuiltinModule('node:path');
        const { isCredentialMessage, handleCredentialMessage } = createRequire(join(app.getAppPath(), 'package.json'))(join(app.getAppPath(), 'src/desktop/credential-channel.mjs'));
        return new Promise((resolve, reject) => {
          const child = utilityProcess.fork(fixture, [], { stdio: 'ignore', env: { ...process.env, BRIDGE_SOURCE_ROOT: app.getAppPath(), BRIDGE_CREDENTIAL_FIXTURE: directory, BRIDGE_CREDENTIAL_WRITE: write ? '1' : '0' } });
          const timer = setTimeout(() => { child.kill(); reject(Error('Keychain test timed out')); }, 60000);
          child.on('message', message => {
            if (isCredentialMessage(message)) void handleCredentialMessage(message, safeStorage, reply => child.postMessage(reply));
            else if (message.done) { clearTimeout(timer); child.kill(); resolve(message); }
          });
          child.on('exit', () => { clearTimeout(timer); reject(Error('Credential worker exited')); });
        });
      }, { fixture: resolve('tests/fixtures/credential-worker.mjs'), directory: join(dir, 'synthetic-auth'), write });
      assert.equal(result.error, undefined);
      assert.equal(result.roundTrip, true); assert.equal(result.encrypted, true);
      assert.equal(result.provider, 'macos-keychain-electron-async-v1');
    }
  } finally { if (desktop) await desktop.close(); await rm(dir, { recursive: true, force: true }); }
});
