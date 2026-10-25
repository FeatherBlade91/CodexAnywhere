// Real installed Harness smoke test. Uses an isolated workspace and an overlay;
// never writes credentials or changes the user's default model.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const cliRoot = process.env.DSH_CLI_ROOT || join(process.env.APPDATA, 'npm/node_modules/@deepseek-ai/dsh');
const require = createRequire(join(cliRoot, 'package.json'));
const YAML = require('yaml');
const home = process.env.DSH_HOME || join(homedir(), '.dsh');
const state = process.env.CHATGPT_BRIDGE_STATE_DIR || join(process.env.LOCALAPPDATA, 'ChatGPTClaudeBridge');
const config = JSON.parse(await readFile(join(state, 'bridge.json'), 'utf8'));
const desktop = YAML.parse(await readFile(join(home, 'profiles/desktop/cordis.patch.yml'), 'utf8'));
const provider = desktop.find(r => r.id === 'llm-pi-ai').config.providers['codex-anywhere'];
const headless = YAML.parse(await readFile(join(home, 'profiles/headless/cordis.patch.yml'), 'utf8'));
assert.deepEqual(headless.find(r => r.id === 'llm-pi-ai').config.providers['codex-anywhere'], provider, 'Headless provider differs from desktop');
const cliCredentials = YAML.parse(await readFile(headless.find(r => r.id === 'credentials').config.path, 'utf8'));
assert.ok(cliCredentials[provider.apiKeyEnv] === config.localKey, 'CLI credential differs from bridge key');
assert.equal(provider.baseURL, `http://127.0.0.1:${config.port}/v1`, 'Harness URL differs from the running bridge');
const credentials = YAML.parse(await readFile(join(home, '.credentials.yaml'), 'utf8'));
assert.ok((credentials.refs?.[provider.apiKeyEnv] ?? credentials[provider.apiKeyEnv]) === config.localKey, 'Harness key differs from bridge key');
const response = await fetch(provider.baseURL + '/models', { headers: { Authorization: `Bearer ${config.localKey}` }, signal: AbortSignal.timeout(30000) });
assert.equal(response.status, 200);
const models = (await response.json()).data.map(m => m.id);
const workspace = await mkdtemp(join(tmpdir(), 'bridge-harness-'));
const report = { date: new Date().toISOString(), client: 'Installed dsh headless', baseURL: provider.baseURL, modelDiscovery: { status: 200, modelCount: models.length }, cases: [] };
try {
  const marker = `HARNESS_TOOL_${randomUUID()}`;
  await writeFile(join(workspace, 'marker.txt'), marker);
  for (const model of ['gpt-6.1-sol', 'gpt-6-astra']) {
    assert.ok(models.includes(model));
    const overlay = [
      { id: 'agent-default-model', config: { provider: 'codex-anywhere', model } },
      { id: 'session-persistence-jsonl', config: { root: join(workspace, 'sessions') } },
    ];
    const patch = join(workspace, 'test.patch.yml');
    await writeFile(patch, YAML.stringify(overlay));
    const started = Date.now();
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(cliRoot, 'lib/bin.js'), '--profile', 'headless', '--patch', patch,
        'Use the file reading tool to read marker.txt in the working directory. Reply with its exact contents only. Do not delegate, search the web, or modify any files.'],
      { cwd: workspace, windowsHide: true, env: { ...process.env, [provider.apiKeyEnv]: undefined, DSH_TELEMETRY_DISABLED: '1' } });
      let stdout = '', stderr = '';
      const timeout = setTimeout(() => { child.kill(); reject(new Error(`${model}: Harness exceeded 180 seconds`)); }, 180000);
      child.stdout.on('data', b => { stdout += b; });
      child.stderr.on('data', b => { stderr += b; });
      child.on('error', e => { clearTimeout(timeout); reject(e); });
      child.on('exit', code => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
    });
    // Only print sanitized synthetic results, never raw Harness config or logs.
    const passed = result.code === 0 && result.stdout.includes(marker);
    report.cases.push({ model, test: 'streaming tool read and follow-up response', exitCode: result.code, passed, elapsedMs: Date.now() - started });
    console.log(JSON.stringify(report.cases.at(-1)));
    if (!passed) {
      const safe = result.stderr.split(config.localKey).join('[REDACTED]');
      throw new Error(`Harness test failed: ${safe.slice(-3000)}`);
    }
  }
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/harness-live.json', JSON.stringify(report, null, 2));
  await rm(workspace, { recursive: true, force: true });
}
