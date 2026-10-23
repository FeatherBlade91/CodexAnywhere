import { join } from 'node:path';
import { homedir } from 'node:os';
// Separate credentials/configuration; never configure Claude Code or CC Switch.
process.env.CHATGPT_BRIDGE_STATE_DIR = process.env.CHATGPT_GATEWAY_STATE_DIR || join(process.env.LOCALAPPDATA || join(homedir(), '.local', 'share'), 'ChatGPTGateway');
process.env.CHATGPT_BRIDGE_APP_NAME = 'ChatGPT API Gateway';
process.env.CHATGPT_BRIDGE_APP_ID = 'chatgpt-api-gateway';
const { client, config } = await import('./runtime.mjs');
const { createGateway } = await import('./openai-server.mjs');
const { fetchRemote, apiError } = await import('./vendor/siwc/errors.js');
const port = Number(process.env.CHATGPT_GATEWAY_PORT || 17864);
const apiKey = process.env.CHATGPT_GATEWAY_API_KEY || config.localKey;
const command = process.argv[2] || 'serve';
if (command === 'config') console.log(JSON.stringify({ baseURL: `http://127.0.0.1:${port}/v1`, apiKey }, null, 2));
else if (command === 'login') console.log(JSON.stringify(await client.signIn()));
else if (command === 'logout') await client.disconnect();
else if (command === 'status') console.log(JSON.stringify(await client.getSession()));
else if (command === 'serve') {
  const server = createGateway({
    apiKey, client, autoLogin: process.env.CHATGPT_GATEWAY_AUTO_LOGIN !== '0',
    listModels: () => client.listModels(),
    request: async (payload, token, signal) => {
      const response = await fetchRemote('https://api.openai.com/v1/responses', { method: 'POST', redirect: 'error', signal, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(payload) }, 600_000);
      if (!response.ok) throw apiError(await response.json().catch(() => ({})), response.status, response.headers.get('x-request-id'));
      return response;
    },
  });
  server.on('error', e => { console.error(`Gateway could not listen: ${e.code}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`ChatGPT API Gateway: http://127.0.0.1:${port}/v1\nRun node gateway.mjs config to display your API key.`));
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => { server.close(); server.closeIdleConnections(); });
} else { console.error('Usage: node gateway.mjs [serve|config|login|logout|status]'); process.exitCode = 1; }
