import { configureCredentialEncryption } from '../platform/credentials.mjs';
import { createCredentialClient, isCredentialMessage } from './credential-channel.mjs';
const port = process.parentPort;
if (!port) throw new Error('Desktop worker requires an Electron utility process.');
if (process.platform === 'darwin') configureCredentialEncryption(createCredentialClient(port));
// Register the port listener before yielding to module initialization. Otherwise
// an early status request can be lost while the dynamic import is still loading.
const ready = import('./service.mjs').then(({ createDesktopService }) => createDesktopService());
port.on('message', async ({ data }) => {
  if (isCredentialMessage(data)) return;
  const { id, method, args } = data || {};
  try { port.postMessage({ id, result: await (await ready).invoke(method, args) }); }
  catch (error) { port.postMessage({ id, error: error.message || 'Desktop operation failed.' }); }
});

const service = await ready;

// Check in the worker so rotation continues when the window is hidden or suspended.
let checkingRotation = false;
async function checkRotation() {
  if (checkingRotation) return;
  checkingRotation = true;
  try { await service.invoke('checkKeyRotation'); } catch { /* Retry on the next tick; never log keys. */ }
  finally { checkingRotation = false; }
}
await checkRotation();
setInterval(checkRotation, 30000).unref();
