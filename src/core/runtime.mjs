import { spawn, execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { Agent, ProxyAgent, setGlobalDispatcher } from 'undici';
import { createChatGPT } from '../../vendor/siwc/index.js';

export const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const stateDir = process.env.CHATGPT_BRIDGE_STATE_DIR || join(process.env.LOCALAPPDATA || join(homedir(), '.local', 'share'), 'ChatGPTClaudeBridge');
await mkdir(stateDir, { recursive: true });
export const configPath = join(stateDir, 'bridge.json');
let config;
try { config = JSON.parse(await readFile(configPath, 'utf8')); }
catch (e) {
  if (e.code !== 'ENOENT') throw e;
  let proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
  if (!proxy && process.platform === 'win32') {
    try {
      const settings = JSON.parse(execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command', 'Get-ItemProperty "HKCU:/Software/Microsoft/Windows/CurrentVersion/Internet Settings" | Select-Object ProxyEnable,ProxyServer | ConvertTo-Json -Compress'], { windowsHide: true, encoding: 'utf8' }));
      if (settings.ProxyEnable && typeof settings.ProxyServer === 'string') {
        const address = settings.ProxyServer.includes('=') ? settings.ProxyServer.split(';').find(p=>p.startsWith('https='))?.slice(6) : settings.ProxyServer;
        if (address) proxy = address.includes('://') ? address : 'http://' + address;
      }
    } catch {}
  }
  config = { port: 17863, localKey: randomBytes(32).toString('hex'), model: 'gpt-6.1-sol', proxy };
  await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}
export { config };
export async function saveConfig() { await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 }); }
let dispatcher;
export function applyProxy(proxy) {
  const next = proxy ? new ProxyAgent(proxy) : new Agent();
  const previous = dispatcher;
  setGlobalDispatcher(next); dispatcher = next;
  previous?.close().catch(() => {});
}
// Apply saved direct mode too: an inherited dispatcher must not override the user's setting.
applyProxy(config.proxy || '');

function dpapi(operation, input) {
  return new Promise((resolve, reject) => {
    const scriptRoot = root.replace(/app\.asar(?=([\\/]|$))/, 'app.asar.unpacked');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(scriptRoot, 'src', 'core', 'dpapi.ps1'), operation], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', b => { output += b; });
    child.stderr.resume();
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(Buffer.from(output.trim(), 'base64')) : reject(new Error('Windows credential encryption failed')));
    child.stdin.end(Buffer.from(input).toString('base64'));
  });
}
export const client = createChatGPT({
  appName: process.env.CHATGPT_BRIDGE_APP_NAME || 'ChatGPT Claude Bridge', appId: process.env.CHATGPT_BRIDGE_APP_ID || 'chatgpt-claude-bridge', sendHostId: true,
  redirectPort: 0, storageDir: join(stateDir, 'auth'),
  credentialEncryption: {
    id: 'windows-dpapi-current-user-v1', isAvailable: () => process.platform === 'win32',
    encrypt: text => dpapi('encrypt', Buffer.from(text, 'utf8')),
    decrypt: async bytes => (await dpapi('decrypt', bytes)).toString('utf8'),
  },
});
