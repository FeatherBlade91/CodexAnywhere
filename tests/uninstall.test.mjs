import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareUninstall } from '../src/core/uninstall.mjs';
async function fixture(t, integration) {
  const stateDir = await realpath(await mkdtemp(join(tmpdir(), 'uninstall-test-')));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  await writeFile(join(stateDir, 'bridge.json'), JSON.stringify({ integration }));
  return stateDir;
}
test('uninstall restores owned client settings before disabling startup; helper never deletes data', async t => {
  for (const integration of ['direct', 'cc-switch']) {
    const stateDir = await fixture(t, integration), order = [];
    await writeFile(join(stateDir, integration === 'direct' ? 'direct-restore.json' : 'cc-restore.json'), '{}');
    await prepareUninstall({ stateDir, restore: async () => order.push('restore'), disableStartup: () => order.push('startup') });
    assert.deepEqual(order, ['restore', 'startup']);
    assert.equal(JSON.parse(await readFile(join(stateDir, 'bridge.json'))).integration, integration);
  }
});
test('failed restore, missing backup and malformed settings preserve recovery data', async t => {
  const stateDir = await fixture(t, 'direct');
  const options = { stateDir, restore: () => { throw Error('busy client'); }, disableStartup: () => assert.fail('startup changed after failure') };
  await assert.rejects(prepareUninstall(options), /backup is missing/);
  await writeFile(join(stateDir, 'direct-restore.json'), '{}');
  await assert.rejects(prepareUninstall(options), /busy client/);
  assert.equal(await readFile(join(stateDir, 'direct-restore.json'), 'utf8'), '{}');
  await writeFile(join(stateDir, 'bridge.json'), '{');
  await assert.rejects(prepareUninstall(options), /could not be read/);
});
test('unconfigured installations do not inspect or modify other clients', async t => {
  const stateDir = await fixture(t); let disabled = 0;
  const options = { stateDir, restore: () => assert.fail('unrelated client accessed'), disableStartup: () => { disabled++; } };
  await prepareUninstall(options);
  await rm(join(stateDir, 'bridge.json'));
  await prepareUninstall(options);
  assert.equal(disabled, 2);
});
