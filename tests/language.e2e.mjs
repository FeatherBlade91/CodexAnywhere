import test from 'node:test';
import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { resolveLanguage } from '../src/desktop/renderer/i18n.js';

test('desktop language detection, cancellation, persistence and restart request', { timeout: 90000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-language-ui-'));
  const env = { ...process.env, CHATGPT_BRIDGE_STATE_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const options = process.env.BRIDGE_TEST_EXE ? { executablePath: resolve(process.env.BRIDGE_TEST_EXE), args: [] } : { args: [resolve('.')] };
  options.args.push(`--user-data-dir=${join(dir, 'electron-profile')}`);
  const launch = () => electron.launch({ ...options, env });
  let desktop;
  try {
    desktop = await launch();
    let page = await desktop.firstWindow();
    await page.locator('#toggle-service:not([disabled])').waitFor();
    const system = await desktop.evaluate(({ app }) => app.getPreferredSystemLanguages());
    assert.equal(await page.locator('html').getAttribute('lang'), resolveLanguage('system', system));
    await desktop.close(); desktop = undefined;
    for (const [language, heading, next] of [['en', 'Settings', 'zh-TW'], ['zh-TW', '設定', 'zh-CN'], ['zh-CN', '设置', 'en']]) {
      await writeFile(join(dir, 'desktop-settings.json'), JSON.stringify({ language }));
      desktop = await launch(); page = await desktop.firstWindow();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.locator('#toggle-service:not([disabled])').waitFor();
      assert.equal(await page.locator('html').getAttribute('lang'), language);
      await page.locator('.nav-item[data-page="settings"]').click();
      assert.equal(await page.locator('#page-settings h1').textContent(), heading);
      assert.equal(await page.locator('#language').count(), 1);
      await page.locator('#language').selectOption(next);
      await page.locator('#confirm-dialog button[value="cancel"]').click();
      assert.equal(await page.locator('#language').inputValue(), language);
      assert.equal(JSON.parse(await readFile(join(dir, 'desktop-settings.json'), 'utf8')).language, language);
      await page.locator('#proxy').fill('socks5://localhost:9');
      await page.locator('#proxy-form button[type="submit"]').click();
      await page.locator('#notice.error').waitFor();
      if (language === 'en') {
        assert.match(await page.locator('#notice').textContent(), /must start with/);
        const visibleText = await page.locator('body').innerText();
        assert.equal(/[\u4e00-\u9fff]/.test(visibleText.replace('简体中文', '').replace('繁體中文', '')), false);
        for (const name of ['connections', 'guide']) {
          await page.locator(`.nav-item[data-page="${name}"]`).click();
          if (name === 'guide') await page.locator('#page-guide details').evaluateAll(items => items.forEach(item => { item.open = true; }));
          assert.equal(/[\u4e00-\u9fff]/.test(await page.locator('body').innerText()), false, `${name} must be fully translated`);
        }
        await page.locator('.nav-item[data-page="settings"]').click();
      }
      await page.setViewportSize({ width: 800, height: 640 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      // Observe the real IPC save path without spawning an untracked replacement process.
      await desktop.evaluate(({ app }) => { globalThis.languageRestart = []; app.relaunch = () => globalThis.languageRestart.push('relaunch'); app.quit = () => globalThis.languageRestart.push('quit'); });
      await page.locator('#language').selectOption(next);
      await page.locator('#confirm-action').click();
      await page.waitForFunction(() => !document.querySelector('#language').disabled);
      assert.deepEqual(await desktop.evaluate(() => globalThis.languageRestart), ['relaunch', 'quit']);
      assert.equal(JSON.parse(await readFile(join(dir, 'desktop-settings.json'), 'utf8')).language, next);
      assert.deepEqual(errors, []);
      await desktop.evaluate(({ app }) => app.exit(0)); desktop = undefined;
      desktop = await launch(); page = await desktop.firstWindow();
      await page.locator('#toggle-service:not([disabled])').waitFor();
      assert.equal(await page.locator('html').getAttribute('lang'), next);
      await desktop.close(); desktop = undefined;
    }
  } finally { if (desktop) await desktop.close(); await rm(dir, { recursive: true, force: true }); }
});
