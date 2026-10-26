import { MAC_CREDENTIAL_PROVIDER, LINUX_CREDENTIAL_PROVIDER } from '../platform/credentials.mjs';

const channel = 'credential-storage';
const maxSize = 8 * 1024 * 1024;

// This channel exists only between the trusted worker and main process. It is
// deliberately absent from the renderer IPC allowlist and preload API.
export function createCredentialClient(port, { timeout = 120000, platform = process.platform } = {}) {
  let sequence = 0;
  const pending = new Map();
  const receive = ({ data }) => {
    if (data?.channel !== channel) return;
    const item = pending.get(data.id);
    if (!item) return;
    pending.delete(data.id); clearTimeout(item.timer);
    if (data.error) item.reject(new Error('System credential storage unavailable'));
    else item.resolve(data.result);
  };
  port.on('message', receive);
  function request(operation, value) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('System credential storage timed out')); }, timeout);
      pending.set(id, { resolve, reject, timer });
      try { port.postMessage({ channel, id, operation, value }); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }
  return {
    id: platform === 'linux' ? LINUX_CREDENTIAL_PROVIDER : MAC_CREDENTIAL_PROVIDER,
    isAvailable: () => request('available'),
    encrypt: async text => Buffer.from(await request('encrypt', text)),
    decrypt: bytes => request('decrypt', Uint8Array.from(bytes)),
    dispose() {
      port.removeListener('message', receive);
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Credential channel closed')); }
      pending.clear();
    },
  };
}

export function isCredentialMessage(message) { return message?.channel === channel; }
export async function handleCredentialMessage(message, safeStorage, reply) {
  const { id, operation, value } = message;
  try {
    let result;
    const available = await safeStorage.isAsyncEncryptionAvailable() &&
      (!safeStorage.getSelectedStorageBackend || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend()));
    if (operation === 'available') result = available;
    else {
      if (!available) throw new Error('Unavailable');
      if (operation === 'encrypt' && typeof value === 'string' && Buffer.byteLength(value) <= maxSize) result = await safeStorage.encryptStringAsync(value);
      else if (operation === 'decrypt' && value instanceof Uint8Array && value.byteLength <= maxSize) result = (await safeStorage.decryptStringAsync(Buffer.from(value))).result;
      else throw new Error('Invalid credential request');
    }
    reply({ channel, id, result });
  } catch { reply({ channel, id, error: 'System credential storage unavailable' }); }
}
