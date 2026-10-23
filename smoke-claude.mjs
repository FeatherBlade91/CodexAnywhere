import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config, stateDir } from './runtime.mjs';
const model = process.argv[4] || config.model;
const dir = join(stateDir, 'smoke', model + '-' + (process.argv[3] || 'default') + '-' + (process.argv[2] || 'text'));
await mkdir(dir, { recursive: true });
const mode = process.argv[2] || 'text';
const marker = 'TOOL_OK_' + randomBytes(8).toString('hex');
await writeFile(join(dir, 'probe.txt'), marker);
const env = { ...process.env };
delete env.ORCA_CLAUDE_PROFILE_POINTER;
for (const name of Object.keys(env)) if (/^(ANTHROPIC_|CLAUDE_CODE_OAUTH_TOKEN$|CLAUDECODE$)/.test(name)) delete env[name];
const settings = { env: {
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${config.port}`, ANTHROPIC_AUTH_TOKEN: config.localKey,
  ANTHROPIC_MODEL: model, ANTHROPIC_DEFAULT_SONNET_MODEL: model,
  ANTHROPIC_DEFAULT_OPUS_MODEL: model, ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
}};
const settingsPath = join(dir, 'settings.json');
await writeFile(settingsPath, JSON.stringify(settings));
const prompt = mode === 'tools' ? `Use the Read tool to read ${join(dir, 'probe.txt')}. Return only the exact file contents.` : 'Reply with exactly CLAUDE_SOL_OK';
const args = ['--print', '--safe-mode', '--setting-sources', '', '--settings', settingsPath, '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence', '--model', model, '--tools', mode === 'tools' ? 'Read' : mode === 'full' ? 'default' : '', '--permission-mode', 'dontAsk', '--system-prompt', 'You are a helpful assistant. Follow the user request.', '--', prompt];
if (process.argv[3]) args.unshift('--effort', process.argv[3]);
const child = spawn(join(process.env.USERPROFILE, '.local/bin/claude.exe'), args, { cwd: dir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => process.stderr.write(chunk));
const timer = setTimeout(() => child.kill(), 180_000);
child.on('exit', code => {
  clearTimeout(timer);
  console.log(output.trim());
  const expected = mode === 'tools' ? marker : 'CLAUDE_SOL_OK';
  if (code || !output.includes(expected)) { console.error('Claude end-to-end check failed'); process.exitCode = 1; }
  else console.log(`PASS: Claude Code ${mode} via ${model} using ChatGPT plan`);
});
