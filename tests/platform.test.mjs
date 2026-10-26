import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createSystem, parseMacProxy } from '../src/platform/system.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';

test('uninstall override applied after shell import is respected by core initialization', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'platform-late-state-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const selected = join(directory, 'selected');
  const platformModule = new URL('../src/platform/system.mjs', import.meta.url).href;
  const runtimeModule = new URL('../src/core/runtime.mjs', import.meta.url).href;
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    await import(${JSON.stringify(platformModule)});
    process.env.CHATGPT_BRIDGE_STATE_DIR = ${JSON.stringify(selected)};
    const { stateDir } = await import(${JSON.stringify(runtimeModule)});
    if (stateDir !== process.env.CHATGPT_BRIDGE_STATE_DIR) process.exit(1);
  `], { env: { ...process.env, CHATGPT_BRIDGE_STATE_DIR: join(directory, 'original'), HTTPS_PROXY: '', HTTP_PROXY: '' }, stdio: 'pipe' });
  await access(join(selected, 'bridge.json'));
  await assert.rejects(access(join(directory, 'original', 'bridge.json')), { code: 'ENOENT' });
});

test('platform paths work without Windows environment and honor isolation', () => {
  const mac = createSystem({ platform: 'darwin', env: {}, home: '/Users/test' });
  assert.equal(mac.stateDir, join('/Users/test', 'Library/Application Support/CodexAnywhere'));
  assert.equal(mac.ccPathsFile, join('/Users/test', 'Library/Application Support/com.ccswitch.desktop/app_paths.json'));
  const win = createSystem({ platform: 'win32', env: { LOCALAPPDATA: 'local', APPDATA: 'roaming' }, home: 'home' });
  assert.equal(win.stateDir, join('local', 'CodexAnywhere'));
  assert.equal(win.ccPathsFile, join('roaming', 'com.ccswitch.desktop', 'app_paths.json'));
  assert.equal(createSystem({ platform: 'darwin', env: { CHATGPT_BRIDGE_STATE_DIR: 'isolated' } }).stateDir, 'isolated');
});

test('macOS proxy discovery supports HTTPS, HTTP and IPv6, ignores disabled/PAC/SOCKS-only settings', () => {
  assert.equal(parseMacProxy(' HTTPSEnable : 1\n HTTPSProxy : ::1\n HTTPSPort : 7890\n'), 'http://[::1]:7890');
  assert.equal(parseMacProxy(' HTTPEnable : 1\n HTTPProxy : localhost\n HTTPPort : 8080\n'), 'http://localhost:8080');
  for (const value of ['HTTPEnable : 0\nHTTPProxy : localhost\nHTTPPort : 80', 'SOCKSEnable : 1', 'ProxyAutoConfigEnable : 1', 'HTTPEnable : 1\nHTTPProxy : evil/path\nHTTPPort : 80', 'HTTPEnable : 1\nHTTPProxy : localhost\nHTTPPort : 99999']) assert.equal(parseMacProxy(value), '');
});

test('explicit proxy wins and native discovery failure remains nonfatal', () => {
  assert.equal(createSystem({ env: { HTTPS_PROXY: 'http://explicit:80' }, run: () => assert.fail() }).detectProxy(), 'http://explicit:80');
  assert.equal(createSystem({ platform: 'darwin', env: {}, run: () => { throw Error('unavailable'); } }).detectProxy(), '');
});

test('CC Switch detection matches executable names and propagates inspection failure', () => {
  const mac = text => createSystem({ platform: 'darwin', run: () => text });
  assert.equal(mac('/Applications/CC Switch.app/Contents/MacOS/cc-switch\n/bin/ps').isCCSwitchRunning(), true);
  assert.equal(mac('/Applications/CC Switch.app/Contents/MacOS/CC Switch').isCCSwitchRunning(), true);
  assert.equal(mac('/Applications/cc-switch-backup\n/usr/bin/node').isCCSwitchRunning(), false);
  assert.throws(() => createSystem({ platform: 'darwin', run: () => { throw Error('denied'); } }).isCCSwitchRunning(), /denied/);
});


test('Linux paths and desktop proxy discovery honor XDG and lowercase proxy variables', () => {
  const linux = createSystem({ platform: 'linux', home: '/home/test', env: { XDG_DATA_HOME: '/data' } });
  assert.equal(linux.stateDir, join('/data', 'CodexAnywhere'));
  assert.equal(linux.ccPathsFile, join('/data', 'com.ccswitch.desktop', 'app_paths.json'));
  assert.equal(createSystem({ platform: 'linux', env: { https_proxy: 'http://proxy:80' } }).detectProxy(), 'http://proxy:80');
  const run = (_, args) => ({ mode: "'manual'", host: "'::1'", port: '7890' })[args[2]];
  assert.equal(createSystem({ platform: 'linux', env: {}, run }).detectProxy(), 'http://[::1]:7890');
  assert.equal(createSystem({ platform: 'linux', env: {}, run: () => { throw Error(); } }).detectProxy(), '');
});

test('Linux autostart persists safely and removes only its own desktop entry', async t => {
  const { createStartup } = await import('../src/platform/startup.mjs');
  const { readFile, writeFile, mkdir } = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'linux-startup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const startup = createStartup({}, { platform: 'linux', env: { XDG_CONFIG_HOME: directory, APPIMAGE: '/apps/My App%.AppImage' } });
  assert.equal(await startup.enabled(), false);
  await startup.set(true);
  assert.equal(await startup.enabled(), true);
  const entry = await readFile(join(directory, 'autostart/codex-anywhere.desktop'), 'utf8');
  assert.ok(entry.includes('Exec="/apps/My App%%.AppImage"'));
  await writeFile(join(directory, 'autostart/other.desktop'), 'other');
  await startup.set(false);
  assert.equal(await startup.enabled(), false);
  assert.equal(await readFile(join(directory, 'autostart/other.desktop'), 'utf8'), 'other');
  await assert.rejects(createStartup({}, { platform: 'linux', env: { XDG_CONFIG_HOME: directory, APPIMAGE: '/bad\nExec=other' } }).set(true), /Invalid application path/);
});
