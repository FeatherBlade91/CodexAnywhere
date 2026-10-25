// Offline benchmark: synthetic credentials in a temporary directory only.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { ConnectionStore } from '../vendor/siwc/storage.js';
if (process.platform !== 'win32') throw Error('This benchmark requires Windows DPAPI.');
const directory = await mkdtemp(join(tmpdir(), 'codex-credential-benchmark-'));
const script = fileURLToPath(new URL('../src/core/dpapi.ps1', import.meta.url));
let decrypts = 0;
function dpapi(operation, bytes) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, operation], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.resume();
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve(Buffer.from(output.trim(), 'base64')) : reject(Error('Synthetic DPAPI benchmark failed')));
    child.stdin.end(Buffer.from(bytes).toString('base64'));
  });
}
const encryption = { id: 'windows-dpapi-current-user-v1', isAvailable: () => true,
  encrypt: text => dpapi('encrypt', Buffer.from(text)), decrypt: async bytes => { decrypts++; return (await dpapi('decrypt', bytes)).toString(); } };
const read = store => store.withLock(() => store.read());
const summary = samples => ({ count: samples.length, meanMs: +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2), minMs: +Math.min(...samples).toFixed(2), maxMs: +Math.max(...samples).toFixed(2) });
async function measure(fn, count) { const samples = []; for (let i = 0; i < count; i++) { const start = performance.now(); await fn(); samples.push(performance.now() - start); } return summary(samples); }
try {
  const store = new ConnectionStore(directory, encryption);
  await store.withLock(() => store.write({ version: 2, activeProfileId: 'test', pendingRegistrations: [], profiles: [{ version: 1, id: 'test', label: 'Synthetic benchmark', clientId: 'synthetic', status: 'connected', scopes: ['chatgpt.tokens.use.direct'], savedAt: new Date().toISOString(), credentials: { accessToken: 'synthetic-' + 'x'.repeat(4096), expiresAt: Date.now() + 3600_000 } }] }));
  const cold = await measure(() => read(new ConnectionStore(directory, encryption)), 3);
  await read(store); const before = decrypts;
  const warm = await measure(() => read(store), 30);
  const start = performance.now(); await Promise.all(Array.from({ length: 30 }, () => read(store)));
  console.log(JSON.stringify({ scope: 'Offline synthetic Windows credential acquisition; not end-to-end model latency', cold, warm, concurrent30Ms: +(performance.now() - start).toFixed(2), warmDecryptions: decrypts - before }, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
