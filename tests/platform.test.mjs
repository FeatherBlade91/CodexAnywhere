import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createSystem, parseMacProxy } from '../src/platform/system.mjs';

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
