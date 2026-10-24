import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import electronPath from 'electron';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

test('confirmed language change actually relaunches the app and stops its service', { timeout: 60000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-restart-'));
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const servicePort = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  await writeFile(join(dir, 'bridge.json'), JSON.stringify({ port: servicePort, localKey: 'restart-test-only', proxy: '' }));
  await writeFile(join(dir, 'desktop-settings.json'), JSON.stringify({ language: 'en' }));
  const env = { ...process.env, CHATGPT_BRIDGE_STATE_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = process.env.BRIDGE_TEST_EXE ? [] : [resolve('.')];
  args.push(`--user-data-dir=${join(dir, 'profile')}`, `--remote-debugging-port=${port}`);
  const child = spawn(process.env.BRIDGE_TEST_EXE || electronPath, args, { env, windowsHide: true, stdio: 'ignore' });
  const exited = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  const endpoint = `http://127.0.0.1:${port}`;
  let browser;
  async function connect() {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      try { return await chromium.connectOverCDP(endpoint, { timeout: 1000 }); }
      catch { await delay(100); }
    }
    throw new Error('Restarted app did not expose its browser');
  }
  async function appPage() {
    const context = browser.contexts()[0];
    context.setDefaultTimeout(10000);
    const page = context.pages()[0] || await context.waitForEvent('page');
    await page.locator('#toggle-service:not([disabled])').waitFor();
    return page;
  }
  try {
    browser = await connect();
    let page = await appPage();
    await page.locator('#toggle-service').click();
    await page.locator('#toggle-service').filter({ hasText: 'Stop service' }).waitFor();
    assert.equal((await fetch(`http://127.0.0.1:${servicePort}/health`)).status, 200);
    await page.locator('.nav-item[data-page="settings"]').click();
    await page.locator('#language').selectOption('zh-TW');
    await page.locator('#confirm-action').click();
    await exited;
    await browser.close(); browser = undefined;
    browser = await connect(); page = await appPage();
    assert.equal(await page.locator('html').getAttribute('lang'), 'zh-TW');
    assert.equal(await page.locator('#toggle-service').textContent(), '啟動服務');
    await assert.rejects(fetch(`http://127.0.0.1:${servicePort}/health`, { signal: AbortSignal.timeout(2000) }));
    await page.locator('.nav-item[data-page="settings"]').click();
    assert.equal(await page.locator('#language').inputValue(), 'zh-TW');
  } finally {
    if (browser) {
      const session = await browser.newBrowserCDPSession();
      const { processInfo } = await session.send('SystemInfo.getProcessInfo');
      const browserPid = processInfo.find(item => item.type === 'browser')?.id;
      await Promise.race([session.send('Browser.close').catch(() => {}), delay(3000)]);
      await browser.close();
      // Closing a window now hides the app in the tray. Stop only this test instance.
      if (browserPid) { try { process.kill(browserPid); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    }
    if (child.exitCode === null) child.kill();
    // Chromium may still be releasing its profile after closing the last window.
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
