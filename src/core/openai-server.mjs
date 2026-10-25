import { createServer } from 'node:http';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readSSE } from './protocol.mjs';
import { ResponseAccumulator } from './response-accumulator.mjs';
import { chatPayload, chatResult, usage } from './openai-protocol.mjs';
const hash = s => createHash('sha256').update(String(s)).digest();
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
export function createGateway({ apiKey, client, request, listModels, autoLogin = true, installDir = '' }) {
  let login;
  let loginError;
  async function ensureSession(explicit = false) {
    if (!login) login = (async () => {
      const session = await client.getSession();
      if (session.sharing) return;
      if (!autoLogin && !explicit) throw Object.assign(new Error('请先在 Codex-Anywhere 桌面应用中登录。'), { status: 401, code: 'login_required' });
      if (!(await client.signIn()).sharing) throw Object.assign(new Error('ChatGPT sharing permission is required'), { status: 403 });
    })().finally(() => { login = undefined; });
    return login;
  }
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/health') return json(res, 200, { service: 'chatgpt-openai-gateway', status: 'ok' });
    const key = req.headers.authorization?.replace(/^Bearer /i, '') || req.headers['x-api-key'] || '';
    const currentKey = typeof apiKey === 'function' ? apiKey() : apiKey;
    if (!currentKey || !timingSafeEqual(hash(key), hash(currentKey))) return json(res, 401, { error: { message: 'Invalid API key', type: 'authentication_error', code: 'invalid_api_key', param: null } });
    if (path === '/admin/shutdown' && req.method === 'POST') {
      json(res, 202, { status: 'draining' });
      client.cancelSignIn?.();
      server.close(); server.closeIdleConnections();
      return;
    }
    if (path === '/admin/login' && req.method === 'POST') {
      loginError = undefined;
      ensureSession(true).catch(e => { loginError = e.code || 'login_failed'; });
      return json(res, 202, { status: 'connecting' });
    }
    if (path === '/admin/status' && req.method === 'GET') {
      try {
        const session = login ? { status: 'connecting', sharing: false } : await client.getSession();
        return json(res, 200, { status: session.status, sharing: session.sharing, loginError, installDir });
      } catch { return json(res, 503, { error: { message: 'Could not read login status' } }); }
    }
    const chat = path === '/v1/chat/completions';
    const isModels = req.method === 'GET' && path === '/v1/models';
    if (!isModels && !(req.method === 'POST' && (chat || path === '/v1/responses'))) return json(res, 404, { error: { message: 'Unknown endpoint', type: 'invalid_request_error', code: 'not_found' } });
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(600_000)]);
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    const write = async value => { signal.throwIfAborted(); if (!res.write(value)) await once(res, 'drain', { signal }); };
    try {
      let body, payload;
      if (!isModels) {
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 32 * 1024 * 1024) throw Object.assign(new Error('Request too large'), { status: 413 });
          chunks.push(chunk);
        }
        try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.model !== 'string' || !body.model.trim() || (body.stream !== undefined && typeof body.stream !== 'boolean')) throw Object.assign(new Error('A model and valid request object are required'), { status: 400 });
        payload = chat ? chatPayload(body) : { ...body };
        if (!chat && payload.input === undefined) throw Object.assign(new Error('input is required'), { status: 400 });
        payload.stream = true;
        payload.store = false;
      }
      // Desktop authorization is checked by withAccessToken below. Avoid a
      // redundant getSession/store read on every inference request.
      if (autoLogin || isModels) await ensureSession();
      signal.throwIfAborted();
      if (isModels) return json(res, 200, { object: 'list', data: (await listModels(signal)).map(m => ({ id: m.slug || m.id, object: 'model', created: 0, owned_by: 'openai' })) });
      await client.withAccessToken(async (token, authSignal) => {
        const upstream = await request(payload, token, authSignal);
        const accumulator = new ResponseAccumulator();
        const id = 'chatcmpl-' + randomUUID();
        const created = Math.floor(Date.now() / 1000);
        const calls = new Map();
        let completed;
        const chunk = (delta, finish_reason = null, extra = {}) => write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: body.model, choices: [{ index: 0, delta, finish_reason }], ...extra })}\n\n`);
        if (body.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
          if (chat) await chunk({ role: 'assistant', content: '' });
        }
        for await (const e of readSSE(upstream.body)) {
          accumulator.observe(e);
          if (['response.failed', 'error'].includes(e.type)) throw Object.assign(new Error('Upstream response failed'), { status: 502, code: e.response?.error?.code || e.error?.code || 'upstream_error' });
          if (['response.completed', 'response.incomplete'].includes(e.type)) { completed = accumulator.complete(e.response); e.response = completed; }
          if (body.stream) {
            if (!chat) await write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
            else if (e.type === 'response.output_text.delta') await chunk({ content: e.delta });
            else if (e.type === 'response.refusal.delta') await chunk({ refusal: e.delta });
            else if (e.type === 'response.output_item.added' && e.item.type === 'function_call') {
              const index = calls.size; calls.set(e.output_index, index);
              await chunk({ tool_calls: [{ index, id: e.item.call_id, type: 'function', function: { name: e.item.name, arguments: e.item.arguments || '' } }] });
            } else if (e.type === 'response.function_call_arguments.delta') {
              if (!calls.has(e.output_index)) throw new Error('Invalid tool stream');
              await chunk({ tool_calls: [{ index: calls.get(e.output_index), function: { arguments: e.delta } }] });
            }
          }
          if (completed) break;
        }
        if (!completed) throw Object.assign(new Error('Upstream stream ended before completion'), { status: 502, code: 'stream_interrupted' });
        if (!body.stream) return json(res, 200, chat ? chatResult(completed, body.model, id) : completed);
        if (chat) {
          await chunk({}, chatResult(completed, body.model, id).choices[0].finish_reason);
          if (body.stream_options?.include_usage) await chunk({}, null, { choices: [], usage: usage(completed.usage) });
          await write('data: [DONE]\n\n');
        }
        res.end();
      }, signal);
    } catch (e) {
      if (res.destroyed) return;
      const authStatus = { sign_in_required: 401, sharing_not_enabled: 403, connection_busy: 409 };
      const status = Object.hasOwn(authStatus, e.code) ? authStatus[e.code] : e.status >= 400 && e.status < 600 ? e.status : 502;
      const error = { message: status < 500 ? e.message : 'ChatGPT request failed. Check login, network, or retry.', type: status === 400 ? 'invalid_request_error' : 'api_error', code: e.code || 'gateway_error', param: null };
      if (res.headersSent) res.end(`${chat ? '' : 'event: error\n'}data: ${JSON.stringify({ error })}\n\n`);
      else json(res, status, { error });
    }
  });
  return server;
}
