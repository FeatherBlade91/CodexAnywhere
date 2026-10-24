import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadLanguage, saveLanguage } from '../src/desktop/language.mjs';
import { resolveLanguage, translator } from '../src/desktop/renderer/i18n.js';
import { translations } from '../src/desktop/renderer/translations.js';

test('system language resolves Chinese scripts, regions, English and fallback', () => {
  for (const locale of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-CN', 'zh_HK']) assert.equal(resolveLanguage('system', [locale]), 'zh-TW');
  for (const locale of ['zh', 'zh-CN', 'zh-SG', 'zh-Hans', 'zh-Hans-HK']) assert.equal(resolveLanguage('system', [locale]), 'zh-CN');
  for (const locale of ['en-US', 'en-GB', 'ja-JP', 'de-DE', '']) assert.equal(resolveLanguage('system', [locale]), 'en');
  assert.equal(resolveLanguage('zh-TW', ['en-US']), 'zh-TW');
  assert.equal(resolveLanguage('en', ['zh-CN']), 'en');
  assert.equal(resolveLanguage('system', ['en-US', 'zh-TW']), 'en');
});

test('language preference persists independently and rejects invalid values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-language-'));
  const path = join(dir, 'desktop-settings.json');
  try {
    assert.deepEqual(await loadLanguage(path, ['zh-HK']), { preference: 'system', language: 'zh-TW' });
    await saveLanguage(path, 'en');
    assert.deepEqual(await loadLanguage(path, ['zh-CN']), { preference: 'en', language: 'en' });
    for (const invalid of ['fr', null, {}, '__proto__']) await assert.rejects(saveLanguage(path, invalid));
    assert.equal((await loadLanguage(path, ['zh-CN'])).language, 'en');
    await saveLanguage(path, 'system');
    assert.equal((await loadLanguage(path, ['zh-CN'])).language, 'zh-CN');
    await writeFile(path, '{broken');
    assert.equal((await loadLanguage(path, ['en-US'])).language, 'en');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('translations preserve placeholders and cover desktop source strings', async () => {
  const placeholders = value => [...value.matchAll(/\{\w+\}/g)].map(m => m[0]).sort();
  for (const [source, variants] of Object.entries(translations)) {
    for (const language of ['zh-TW', 'en']) {
      assert.ok(variants[language], source);
      assert.deepEqual(placeholders(variants[language]), placeholders(source), source);
    }
  }
  for (const name of ['renderer/app.js', 'main.mjs', 'service.mjs', 'network.mjs']) {
    const source = await readFile(new URL(`../src/desktop/${name}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/\bt\('([^']+)'/g)) assert.ok(translations[match[1]], `${name}: ${match[1]}`);
  }
  assert.equal(translator('en')('服务运行中 · {port}', { port: 17863 }), 'Service running · 17863');
  assert.equal(translator('en')('upstream diagnostic'), 'upstream diagnostic');
  const html = await readFile(new URL('../src/desktop/renderer/index.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/>([^<>]+)</g)) {
    const source = match[1].trim();
    if (/[\u4e00-\u9fff]/.test(source) && !['简体中文', '繁體中文'].includes(source)) assert.ok(translations[source], `Untranslated markup: ${source}`);
  }
});
