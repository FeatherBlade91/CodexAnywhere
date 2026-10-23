import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import OpenAI from 'openai';
import { createGateway } from '../openai-server.mjs';
import { chatPayload } from '../openai-protocol.mjs';

async function fixture(t, { tool = false, broken = false } = {}) {
  let logins = 0, requests = 0, payload;
  const client = {
    getSession: async () => ({ sharing: logins > 0 }),
    signIn: async () => { logins++; await new Promise(r => setTimeout(r, 20)); return { sharing: true }; },
    withAccessToken: (fn, signal) => fn('oauth-secret', signal),
  };
  const server = createGateway({ apiKey: 'local-key', client, listModels: async () => [{ slug: 'test-model' }], request: async p => {
    payload = p; requests++;
    const events = tool ? [
      { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', call_id: 'call_1', name: 'weather', arguments: '' } },
      { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"city":"Tokyo"}' },
    ] : [{ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'Hello' }];
    if (!broken) events.push({ type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [], usage: { input_tokens: 3, output_tokens: 2 } } });
    return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
  return { sdk: new OpenAI({ apiKey: 'local-key', baseURL, maxRetries: 0 }), baseURL, state: () => ({ logins, requests, payload }) };
}
test('standard SDK: authentication, models, concurrent login and chat completion', async t => {
  const f = await fixture(t);
  const denied = await fetch(f.baseURL + '/models');
  assert.equal(denied.status, 401); assert.equal(f.state().logins, 0);
  const [models, result] = await Promise.all([f.sdk.models.list(), f.sdk.chat.completions.create({ model: 'test-model', messages: [{ role: 'user', content: 'Hi' }] })]);
  assert.equal(models.data[0].id, 'test-model');
  assert.equal(result.choices[0].message.content, 'Hello');
  assert.equal(result.usage.total_tokens, 5); assert.equal(f.state().logins, 1);
  assert.equal(f.state().payload.store, false);
});
test('SDK tool stream uses contiguous indexes, usage and terminal finish reason', async t => {
  const f = await fixture(t, { tool: true });
  const stream = await f.sdk.chat.completions.create({ model: 'test-model', messages: [{ role: 'user', content: 'Weather?' }], stream: true, stream_options: { include_usage: true } });
  const events = []; for await (const e of stream) events.push(e);
  assert.equal(events[1].choices[0].delta.tool_calls[0].index, 0);
  assert.equal(events[2].choices[0].delta.tool_calls[0].function.arguments, '{"city":"Tokyo"}');
  assert.equal(events.at(-2).choices[0].finish_reason, 'tool_calls');
  assert.equal(events.at(-1).usage.total_tokens, 5);
});
test('Responses API supports JSON and SSE with reconstructed output', async t => {
  const f = await fixture(t);
  const response = await f.sdk.responses.create({ model: 'test-model', input: 'Hi' });
  assert.equal(response.output[0].content[0].text, 'Hello');
  const stream = await f.sdk.responses.create({ model: 'test-model', input: 'Hi', stream: true });
  const events = []; for await (const e of stream) events.push(e);
  assert.equal(events.at(-1).response.output[0].content[0].text, 'Hello');
});
test('invalid requests do not launch login; interrupted streams fail', async t => {
  const f = await fixture(t, { broken: true });
  await assert.rejects(f.sdk.chat.completions.create({ model: 'test-model', messages: [], n: 2 }), e => e.status === 400);
  assert.equal(f.state().logins, 0);
  await assert.rejects(f.sdk.chat.completions.create({ model: 'test-model', messages: [{ role: 'user', content: 'Hi' }] }), e => e.status === 502);
  const malformed = await fetch(f.baseURL + '/responses', { method: 'POST', headers: { authorization: 'Bearer local-key' }, body: '{' });
  assert.equal(malformed.status, 400);
});
test('chat history, images, tool results and structured output mapping', () => {
  const p = chatPayload({ model: 'm', messages: [{ role: 'system', content: 'help' }, { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }, { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'f', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'c', content: 'ok' }], response_format: { type: 'json_schema', json_schema: { name: 'answer', schema: { type: 'object' }, strict: true } } });
  assert.equal(p.input[0].role, 'developer'); assert.equal(p.input[1].content[0].type, 'input_image');
  assert.equal(p.input[2].type, 'function_call'); assert.equal(p.input[3].call_id, 'c');
  assert.equal(p.text.format.name, 'answer');
});
