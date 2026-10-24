import test from 'node:test';
import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';

test('Electron desktop: isolated IPC, unified service, settings, confirmation and exit', { timeout: 90000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-desktop-'));
  const probe = createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise(r => probe.close(r));
  await writeFile(join(dir, 'bridge.json'), JSON.stringify({ port, localKey: 'isolated-desktop-test-key', proxy: '', model: 'test-model' }));
  const env = { ...process.env, CHATGPT_BRIDGE_STATE_DIR: dir };
  await writeFile(join(dir, 'desktop-settings.json'), JSON.stringify({ language: 'zh-CN' }));
  delete env.ELECTRON_RUN_AS_NODE;
  const options = process.env.BRIDGE_TEST_EXE ? { executablePath: resolve(process.env.BRIDGE_TEST_EXE), args: [] } : { args: [resolve('.')] };
  options.args.push(`--user-data-dir=${join(dir, 'electron-profile')}`);
  const desktop = await electron.launch({ ...options, env });
  let closed = false;
  try {
    const page = await desktop.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    assert.equal(await desktop.evaluate(async () => {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
      const db = new DatabaseSync(':memory:');
      const value = db.prepare('SELECT 1 AS ok').get().ok; db.close(); return value;
    }), 1);
    await page.locator('#toggle-service').filter({ hasText: '启动服务' }).waitFor();
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await page.locator('#api-key').getAttribute('type'), 'password');
    assert.equal(await page.locator('#base-url').inputValue(), `http://127.0.0.1:${port}/v1`);
    await page.locator('#toggle-service').click();
    await page.locator('#toggle-service').filter({ hasText: '停止服务' }).waitFor();
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    for (const path of ['/v1/messages', '/v1/chat/completions', '/v1/responses']) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', body: '{}' });
      assert.equal(response.status, 401, path);
    }
    await page.locator('[data-integrate="direct"]').click();
    await page.locator('#confirm-dialog').waitFor({ state: 'visible' });
    await page.locator('#confirm-dialog button[value="cancel"]').click();
    await page.locator('.nav-item[data-page="settings"]').click();
    await page.locator('#proxy').fill('socks5://127.0.0.1:9');
    await page.locator('#proxy-form button[type="submit"]').click();
    await page.locator('#notice.error').waitFor({ state: 'visible' });
    await page.locator('#proxy').fill('http://127.0.0.1:7890');
    await page.locator('#proxy-form button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('已保存'));
    await page.locator('#proxy').fill('');
    await page.locator('#proxy-form button[type="submit"]').click();
    await page.waitForFunction(() => !document.querySelector('#proxy').dataset.dirty);
    await page.locator('.nav-item[data-page="connections"]').click();
    await page.locator('#notice').waitFor({ state: 'hidden' });
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/desktop-connections.png', fullPage: true });
    await page.setViewportSize({ width: 800, height: 640 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: 'test-results/desktop-compact.png', fullPage: true });
    assert.deepEqual(errors, []);
    await desktop.close(); closed = true;
    await assert.rejects(fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) }));
  } finally { if (!closed) await desktop.close(); }
});
