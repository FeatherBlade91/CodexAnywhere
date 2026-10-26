import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MAC_CREDENTIAL_PROVIDER = 'macos-keychain-electron-async-v1';
export const LINUX_CREDENTIAL_PROVIDER = 'linux-secret-store-electron-async-v1';
let configured;

// The desktop composition root supplies its privileged provider before loading core.
export function configureCredentialEncryption(provider) { configured = provider; }
export function getCredentialEncryption() {
  if (configured) return configured;
  return {
    id: 'windows-dpapi-current-user-v1',
    isAvailable: () => process.platform === 'win32',
    encrypt: text => dpapi('encrypt', Buffer.from(text, 'utf8')),
    decrypt: async bytes => (await dpapi('decrypt', bytes)).toString('utf8'),
  };
}

function dpapi(operation, input) {
  return new Promise((resolve, reject) => {
    const script = fileURLToPath(new URL('../core/dpapi.ps1', import.meta.url)).replace(/app\.asar(?=([\\/]|$))/, 'app.asar.unpacked');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, operation], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Credential encryption timed out')); }, 30000);
    child.stdout.on('data', b => { output += b; });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.from(output.trim(), 'base64'));
      else reject(new Error('Windows credential encryption failed'));
    });
    child.stdin.end(Buffer.from(input).toString('base64'));
  });
}
