import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';

test('worker retains a status request delivered during slow service initialization', async () => {
  const port = new EventEmitter();
  const replies = [];
  port.postMessage = message => replies.push(message);
  process.parentPort = port;
  const serviceURL = new URL('../src/desktop/service.mjs', import.meta.url).href;
  const hook = registerHooks({ load(url, context, nextLoad) {
    if (url !== serviceURL) return nextLoad(url, context);
    queueMicrotask(() => port.emit('message', { data: { id: 73, method: 'status' } }));
    return { format: 'module', shortCircuit: true, source: `
      await new Promise(resolve => setTimeout(resolve, 30));
      export function createDesktopService() { return { async invoke(method) { return { method }; } }; }
    ` };
  } });
  try {
    await import('../src/desktop/worker.mjs');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(replies.find(message => message.id === 73), { id: 73, result: { method: 'status' } });
  } finally { hook.deregister(); port.removeAllListeners(); delete process.parentPort; }
});
