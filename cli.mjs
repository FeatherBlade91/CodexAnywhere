import { client, config, saveConfig } from './runtime.mjs';
import { models } from './catalog.mjs';
import { configure, syncModels, restoreIntegration, assertRestoreReady } from './integration.mjs';
const command = process.argv[2] || 'status';
try {
  if (command === 'login') {
    console.log('Opening official ChatGPT sign-in. Approve plan usage for ChatGPT Claude Bridge.');
    const s = await client.signIn();
    console.log(JSON.stringify({ status: s.status, sharing: s.sharing }));
    if (!s.sharing) throw new Error('ChatGPT plan usage was not granted.');
  }
  if (command === 'models') console.log(JSON.stringify(await models(true)));
  if (command === 'login') console.log(JSON.stringify(await syncModels(await models(true))));
  if (command === 'sync') console.log(JSON.stringify(await syncModels(await models(true))));
  if (command === 'configure') { await configure(process.argv[3]); console.log('Integration configured.'); }
  if (command === 'select-model') {
    const slug=process.argv[3]; const catalog=await models();
    if(!catalog.some(m=>m.slug===slug)) throw new Error('Model not available.');
    config.model=slug; await saveConfig(); console.log(JSON.stringify(await syncModels(catalog)));
  }
  if (command === 'set-proxy') { const proxy=process.argv[3]||''; if(proxy && !/^https?:\/\//.test(proxy)) throw new Error('Proxy must start with http:// or https://'); config.proxy=proxy; await saveConfig(); console.log('Proxy saved. Restart bridge.'); }
  if (command === 'restore') console.log(JSON.stringify(await restoreIntegration()));
  if (command === 'restore-check') console.log(JSON.stringify(await assertRestoreReady()));
  if (command === 'status') { const s = await client.getSession(); console.log(JSON.stringify({ status: s.status, sharing: s.sharing, model: config.model, mode: config.integration||'cc-switch', proxy: config.proxy, error: s.error })); }
  if (command === 'logout') await client.disconnect();
  if (command === 'smoke') {
    const models = await client.listModels();
    if (!models.some(m => m.slug === config.model)) throw new Error('Requested model is unavailable on this account.');
    const result = await client.streamResponse({ model: config.model, input: 'Reply with exactly: SOL_BRIDGE_OK' });
    console.log(result.text);
  }
} catch (e) { console.error(e.code || 'error', e.message); process.exitCode = 1; }
