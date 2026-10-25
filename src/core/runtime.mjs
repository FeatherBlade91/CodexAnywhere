import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Agent, ProxyAgent, setGlobalDispatcher } from 'undici';
import { createSystem } from '../platform/system.mjs';
import { getCredentialEncryption } from '../platform/credentials.mjs';
import { createChatGPT } from '../../vendor/siwc/index.js';

export const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
// Resolve at core initialization: the uninstall entry point may set isolation
// after the desktop shell has imported the platform module.
const system = createSystem();
export const stateDir = system.stateDir;
await mkdir(stateDir, { recursive: true });
export const configPath = join(stateDir, 'bridge.json');
let config;
try { config = JSON.parse(await readFile(configPath, 'utf8')); }
catch (e) {
  if (e.code !== 'ENOENT') throw e;
  const proxy = system.detectProxy();
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

export const client = createChatGPT({
  appName: process.env.CHATGPT_BRIDGE_APP_NAME || 'Codex-Anywhere', appId: process.env.CHATGPT_BRIDGE_APP_ID || 'chatgpt-claude-bridge', sendHostId: true,
  redirectPort: 0, storageDir: join(stateDir, 'auth'),
  credentialEncryption: getCredentialEncryption(),
});
