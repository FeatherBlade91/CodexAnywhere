import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const root = await mkdtemp(join(tmpdir(), 'gateway-install-'));
const dest = join(root, '独立安装 with spaces');
const state = join(root, 'state');
const probe = createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(r => probe.close(r));
const env = { ...process.env, CHATGPT_GATEWAY_STATE_DIR: state, CHATGPT_GATEWAY_PORT: String(port), CHATGPT_GATEWAY_TEST_INSTANCE: 'test-' + randomUUID(), CHATGPT_GATEWAY_AUTO_LOGIN: '0', NODE_NO_WARNINGS: '1' };
delete env.CHATGPT_GATEWAY_API_KEY;
const exe = resolve('dist/ChatGPT-API-Gateway-Setup-1.0.0-x64.exe');
const report = { platform: process.platform, arch: process.arch, date: new Date().toISOString(), sha256: createHash('sha256').update(await readFile(exe)).digest('hex'), cases: [] };
function run(binary, args, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env, windowsHide: true }); let output = '';
    child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
    const timer = setTimeout(() => { child.kill(); reject(new Error('Process timed out')); }, timeout);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('exit', code => { clearTimeout(timer); resolve({ code, output }); });
  });
}
const ps = (script, ...args) => run('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', join(dest, script), ...args]);
const setup = () => run(exe, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOICONS', '/TASKS=!startup,!desktopicon', `/DIR=${dest}`]);
const pass = name => { report.cases.push({ name, passed: true }); console.log('PASS: ' + name); };
let installed = false;
try {
  let r = await setup(); assert.equal(r.code, 0, r.output); installed = true;
  pass('silent install to a Unicode path without Node or Claude prerequisites');
  for (const f of ['server.mjs','manager.ps1','integration.mjs','cli.mjs']) await assert.rejects(access(join(dest, f)));
  pass('package excludes Claude Code integration');
  r = await run(join(dest, 'runtime/node.exe'), [join(dest, 'gateway.mjs'), 'config']); assert.equal(r.code, 0, r.output);
  const config = JSON.parse(r.output);
  assert.match(config.apiKey, /^[a-f0-9]{64}$/);
  const headers = { Authorization: `Bearer ${config.apiKey}` };
  const base = `http://127.0.0.1:${port}`;
  r = await ps('gateway-manager.ps1', '-SmokeTest'); assert.equal(r.code, 0, r.output);
  assert.equal((await (await fetch(base + '/health')).json()).service, 'chatgpt-openai-gateway');
  pass('native manager opens and starts bundled gateway');
  assert.equal((await fetch(base + '/admin/status')).status, 401);
  assert.equal((await fetch(base + '/admin/shutdown', { method: 'POST' })).status, 401);
  assert.equal((await fetch(base + '/v1/models', { headers })).status, 401);
  const status = await (await fetch(base + '/admin/status', { headers })).json();
  assert.equal(status.installDir.toLowerCase(), dest.toLowerCase());
  pass('management endpoints require local key; disabled auto-login opens no browser');
  r = await ps('gateway-control.ps1', 'start'); assert.equal(r.code, 0, r.output);
  pass('starting an already running installation is idempotent');
  r = await setup(); assert.equal(r.code, 0, r.output);
  await assert.rejects(fetch(base + '/health'));
  assert.equal(JSON.parse(await readFile(join(state, 'bridge.json'), 'utf8')).localKey, config.apiKey);
  pass('upgrade stops service and preserves API key');
  r = await ps('gateway-control.ps1', 'start'); assert.equal(r.code, 0, r.output);
  r = await run(join(dest, 'unins000.exe'), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART']); assert.equal(r.code, 0, r.output); installed = false;
  await assert.rejects(fetch(base + '/health'));
  assert.equal(JSON.parse(await readFile(join(state, 'bridge.json'), 'utf8')).localKey, config.apiKey);
  pass('uninstall stops service and retains user data');
  await mkdir('reports', { recursive: true });
  await writeFile('reports/gateway-installer.json', JSON.stringify(report, null, 2) + '\n');
} finally {
  if (installed) {
    await ps('gateway-control.ps1', 'stop').catch(() => {});
    await run(join(dest, 'unins000.exe'), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART']).catch(() => {});
  }
}
