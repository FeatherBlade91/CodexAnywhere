import { createDesktopService } from './service.mjs';
const service = createDesktopService();
const port = process.parentPort;
if (!port) throw new Error('Desktop worker requires an Electron utility process.');
port.on('message', async ({ data }) => {
  const { id, method, args } = data || {};
  try { port.postMessage({ id, result: await service.invoke(method, args) }); }
  catch (error) { port.postMessage({ id, error: error.message || 'Desktop operation failed.' }); }
});
