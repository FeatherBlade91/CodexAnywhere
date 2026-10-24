import { pathToFileURL } from 'node:url';
import { createGateway } from './openai-server.mjs';
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { client, config, root } from './runtime.mjs';
import { MODEL, toResponses, toMessage, readSSE } from './protocol.mjs';
import { models, selectModel } from './catalog.mjs';
import { ResponseAccumulator } from './response-accumulator.mjs';
import { apiError, ChatGPTError, fetchRemote } from '../../vendor/siwc/errors.js';

export function createBridgeServer() {
const reasoningCache = new Map();
const gateway = createGateway({ apiKey: config.localKey, client, autoLogin: false, listModels: () => models(), request: async (payload, token, signal) => {
  const response = await fetchRemote('https://api.openai.com/v1/responses', { method: 'POST', redirect: 'error', signal, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(payload) }, 600_000);
  if (!response.ok) throw apiError(await response.json().catch(() => ({})), response.status, response.headers.get('x-request-id'));
  return response;
} });
const hash = value => createHash('sha256').update(value).digest();
const send = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
const event = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/v1/chat/completions' || path === '/v1/responses') return gateway.emit('request', req, res);
  if (req.method === 'GET' && path === '/health') return send(res, 200, { service: 'chatgpt-desktop', version: '2.0.0', installDir: root, model: config.model, effortMapping: 'identity-v2', effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] });
  const key = req.headers.authorization?.replace(/^Bearer /i, '') || req.headers['x-api-key'] || '';
  if (!timingSafeEqual(hash(String(key)), hash(config.localKey))) return send(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'Invalid local bridge key' } });
  if (req.method === 'GET' && path === '/v1/models') {
    try { return send(res, 200, { object: 'list', data: (await models()).map(m=>({id:m.slug,object:'model',owned_by:'openai',display_name:m.displayName})), has_more: false }); }
    catch { return send(res, 503, { error: { message: 'Sign in with ChatGPT and refresh models in the desktop app.' } }); }
  }
  if (req.method !== 'POST' || !['/v1/messages', '/v1/messages/count_tokens'].includes(path)) return send(res, 404, { error: { message: 'Unknown endpoint' } });
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(600_000)]);
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  let timer;
  const started = Date.now();
  try {
    const chunks = []; let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 32 * 1024 * 1024) throw new Error('Request too large');
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (path.endsWith('/count_tokens')) {
      // Local conservative approximation, not OpenAI's billing tokenizer.
      return send(res, 200, { input_tokens: Math.ceil(Buffer.byteLength(JSON.stringify({ system: body.system, messages: body.messages, tools: body.tools })) / 3) });
    }
    const selected = await selectModel(body.model);
    const payload = toResponses(body, reasoningCache, selected);
    let completed;
    await client.withAccessToken(async (accessToken, authSignal) => {
      try {
      const upstream = await fetchRemote('https://api.openai.com/v1/responses', {
        method: 'POST', redirect: 'error', signal: authSignal,
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(payload),
      }, 600_000);
      if (!upstream.ok) {
        const detail = await upstream.json().catch(() => ({}));
        throw apiError(detail, upstream.status, upstream.headers.get('x-request-id'));
      }
      const blocks = new Map();
      const accumulated = new ResponseAccumulator();
      let nextIndex = 0;
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        event(res, 'message_start', { message: { id: 'msg_' + crypto.randomUUID().replaceAll('-', ''), type: 'message', role: 'assistant', model: selected.slug, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
        timer = setInterval(() => event(res, 'ping', {}), 10000);
      }
      const startBlock = (key, block) => {
        if (!blocks.has(key)) {
          blocks.set(key, { index: nextIndex++, closed: false });
          if (body.stream) event(res, 'content_block_start', { index: blocks.get(key).index, content_block: block });
        }
        return blocks.get(key);
      };
      const stopBlock = key => {
        const block = blocks.get(key);
        if (block && !block.closed) {
          block.closed = true;
          if (body.stream) event(res, 'content_block_stop', { index: block.index });
        }
      };
      for await (const e of readSSE(upstream.body)) {
        accumulated.observe(e);
        if (e.type === 'response.output_item.added' && e.item.type === 'function_call') startBlock(`tool:${e.output_index}`, { type: 'tool_use', id: e.item.call_id, name: e.item.name, input: {} });
        if (e.type === 'response.output_text.delta' || e.type === 'response.refusal.delta') {
          const block = startBlock(`text:${e.output_index}:${e.content_index}`, { type: 'text', text: '' });
          if (body.stream) event(res, 'content_block_delta', { index: block.index, delta: { type: 'text_delta', text: e.delta } });
        }
        if (e.type === 'response.function_call_arguments.delta') {
          const block = blocks.get(`tool:${e.output_index}`);
          if (!block) throw new ChatGPTError('invalid_stream', 'The tool stream was missing its output item. Try again.', true, 502);
          if (body.stream) event(res, 'content_block_delta', { index: block.index, delta: { type: 'input_json_delta', partial_json: e.delta } });
        }
        if (e.type === 'response.output_text.done' || e.type === 'response.refusal.done') stopBlock(`text:${e.output_index}:${e.content_index}`);
        if (e.type === 'response.function_call_arguments.done') stopBlock(`tool:${e.output_index}`);
        if (e.type === 'response.incomplete') throw new ChatGPTError('response_incomplete', 'ChatGPT stopped before completing the response. Try again.', true, 502);
        if (['response.failed', 'error'].includes(e.type)) {
          const detail = e.response?.error || e.error || e;
          throw apiError(detail, Number.isInteger(e.status) && e.status >= 400 && e.status < 600 ? e.status : 502, e.request_id || upstream.headers.get('x-request-id'));
        }
        if (e.type === 'response.completed') { completed = accumulated.complete(e.response); break; }
      }
      if (!completed) throw new ChatGPTError('stream_interrupted', 'The response stream ended before completion. Try again.', true, 502);
      const reasoning = (completed.output || []).filter(i => i.type === 'reasoning' && i.encrypted_content);
      const calls = (completed.output || []).filter(i => i.type === 'function_call');
      if (reasoning.length && calls.length) reasoningCache.set(calls[0].call_id, reasoning);
      while (reasoningCache.size > 256) reasoningCache.delete(reasoningCache.keys().next().value);
      const message = toMessage(completed, selected.slug);
      if (body.stream) {
        for (const key of blocks.keys()) stopBlock(key);
        event(res, 'message_delta', { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: message.usage });
        event(res, 'message_stop', {});
        res.end();
      } else send(res, 200, message);
      } catch (error) {
        // The SDK deliberately masks ordinary Errors as connection_error.
        // Preserve typed safe API failures and classify malformed/interrupted
        // streams here, without exposing upstream body text or submitted input.
        if (error instanceof ChatGPTError) throw error;
        if (authSignal.aborted) throw new ChatGPTError('cancelled', 'The request was cancelled.');
        if (error instanceof SyntaxError) throw new ChatGPTError('invalid_stream', 'ChatGPT returned an invalid response event. Try again.', true, 502);
        throw new ChatGPTError('stream_interrupted', 'The response stream was interrupted. Try again.', true, 502);
      }
    }, signal);
    console.log(JSON.stringify({ time: new Date().toISOString(), model: selected.slug, result: 'completed', requestedEffort: body.output_config?.effort ?? null, reasoningEffort: payload.reasoning.effort, confirmedEffort: completed.reasoning?.effort ?? null, ms: Date.now() - started, input: completed.usage?.input_tokens, output: completed.usage?.output_tokens }));
  } catch (e) {
    // Do not log submitted prompts, headers, credentials or full upstream bodies.
    const code = e.code || 'bridge_error';
    console.error(JSON.stringify({ time: new Date().toISOString(), code, status: e.status, ms: Date.now() - started }));
    const error = { type: 'api_error', message: `${code}: ${e.message}` };
    if (!res.destroyed) {
      if (res.headersSent) { event(res, 'error', { error }); res.end(); }
      else send(res, e.status >= 400 && e.status < 600 ? e.status : 502, { type: 'error', error });
    }
  } finally { clearInterval(timer); }
});
return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createBridgeServer();
  server.listen(config.port, '127.0.0.1', () => console.log(`ChatGPT Desktop listening on http://127.0.0.1:${config.port}; model=${MODEL}`));
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => { server.close(); server.closeAllConnections(); });
}
