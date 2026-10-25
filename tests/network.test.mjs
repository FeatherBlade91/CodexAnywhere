import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { networkCode, proxyTarget, testProxySocket, testConnection, explainConnectionError, inspectClaudeRoute, inspectLocalBridge } from '../src/desktop/network.mjs';

test('network codes survive nested fetch causes and aggregate IPv4/IPv6 failures', () => {
  assert.equal(networkCode({ cause: new AggregateError([Object.assign(new Error(), { code: 'ECONNREFUSED' })]) }), 'ECONNREFUSED');
  assert.equal(networkCode(new Error('private detail')), undefined);
});

test('proxy diagnostics exclude credentials, query parameters, and paths', async () => {
  const proxy = 'http://private-user:private-password@127.0.0.1:7897/secret?token=secret';
  assert.equal(proxyTarget(proxy).label, '127.0.0.1:7897');
  let fetchCalls = 0;
  const result = await testConnection({ proxy, probe: async () => { throw Object.assign(new Error('secret'), { code: 'ECONNREFUSED' }); }, fetcher: async () => { fetchCalls++; } });
  assert.equal(result.ok, false); assert.equal(result.code, 'ECONNREFUSED');
  assert.match(result.message, /127\.0\.0\.1:7897/);
  assert.doesNotMatch(JSON.stringify(result), /private|password|secret/);
  assert.equal(fetchCalls, 0, 'failed explicit proxy never falls back to direct connection');
});

test('reachability test accepts unauthenticated API response and checks both hosts', async () => {
  const calls = [];
  const result = await testConnection({ fetcher: async (url, init) => {
    calls.push(url); assert.equal(init.headers, undefined);
    assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
    assert.ok(['https://auth.openai.com/.well-known/openid-configuration', 'https://api.openai.com/v1/models'].includes(url));
    return new Response('', { status: url.includes('auth.openai.com') ? 200 : 401 });
  } });
  assert.equal(result.ok, true); assert.equal(calls.length, 2);
  assert.equal(result.generationTested, false);
  assert.equal(result.checks[1].status, 401);
  assert.equal(result.checks[1].authenticated, false);
  assert.equal(result.checks[1].scope, 'reachability');
  assert.match(result.message, /未验证账号权限/);
});

test('local health check uses only GET /health and rejects unrelated listeners', async t => {
  let valid = true;
  const calls = [];
  const server = createHttpServer((req, res) => {
    calls.push([req.method, req.url, req.headers.authorization]);
    res.end(JSON.stringify({ service: valid ? 'chatgpt-desktop' : 'other-app' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const state = { port: server.address().port, running: true };
  assert.equal((await inspectLocalBridge(state)).ok, true);
  valid = false;
  assert.equal((await inspectLocalBridge(state)).code, 'invalid_health');
  assert.deepEqual(calls, [['GET', '/health', undefined], ['GET', '/health', undefined]]);
  assert.equal((await inspectLocalBridge({ ...state, running: false })).code, 'service_stopped');
  assert.equal(calls.length, 2);
});

test('network success does not hide a stopped local bridge', async () => {
  const result = await testConnection({
    fetcher: async url => new Response('', { status: url.includes('auth.openai.com') ? 200 : 401 }),
    inspectBridge: () => inspectLocalBridge({ port: 17863, running: false }),
  });
  assert.equal(result.ok, false); assert.equal(result.networkOk, true);
  assert.equal(result.localBridge.code, 'service_stopped');
  assert.match(result.message, /启动/);
});

test('diagnostics pin their own dispatcher and close it after success or network failure', async () => {
  for (const proxy of ['', 'http://127.0.0.1:7890']) {
    for (const fail of [false, true]) {
      let closed = 0, requestedProxy;
      const dispatcher = { close: async () => { closed++; } };
      const result = await testConnection({ proxy, probe: async () => {},
        createDispatcher: value => { requestedProxy = value; return dispatcher; },
        fetcher: async (url, options) => {
          assert.equal(options.dispatcher, dispatcher);
          if (fail) throw Object.assign(new Error('offline'), { code: 'ECONNRESET' });
          return new Response('', { status: url.includes('auth.openai.com') ? 200 : 401 });
        },
      });
      assert.equal(requestedProxy, proxy);
      assert.equal(closed, 1);
      assert.equal(result.ok, !fail);
    }
  }
});

test('a reachable proxy with a blocked upstream reports the upstream host', async () => {
  const result = await testConnection({ proxy: 'http://127.0.0.1:7897', probe: async () => {}, fetcher: async () => new Response('', { status: 403 }) });
  assert.equal(result.ok, false); assert.match(result.message, /auth.openai.com/); assert.match(result.message, /403/);
});

test('real TCP probe detects an available proxy socket and then a refused connection', async () => {
  const server = createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const proxy = `http://127.0.0.1:${server.address().port}`;
  await testProxySocket(proxy);
  await new Promise(resolve => server.close(resolve));
  await assert.rejects(testProxySocket(proxy), { code: 'ECONNREFUSED' });
});

test('SDK-masked network error is diagnosed without changing unrelated errors', async () => {
  const original = Object.assign(new Error('hidden'), { code: 'network_error' });
  const explained = await explainConnectionError(original, 'http://user:password@localhost:1234', async () => { throw Object.assign(new Error(), { code: 'ECONNREFUSED' }); });
  assert.match(explained.message, /localhost:1234/); assert.doesNotMatch(explained.message, /password/);
  assert.equal(explained.code, 'ECONNREFUSED');
  const ordinary = new Error('Model unavailable'); assert.equal(await explainConnectionError(ordinary, ''), ordinary);
});

test('healthy ChatGPT network distinguishes a stopped CC Switch local route without exposing keys', async () => {
  const inspectRoute = () => inspectClaudeRoute({
    read: async () => JSON.stringify({ model: 'ccs-claude-openai--gpt-test', env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:15721', ANTHROPIC_AUTH_TOKEN: 'private-secret' } }),
    probe: async () => { throw Object.assign(new Error(), { code: 'ECONNREFUSED' }); },
  });
  const result = await testConnection({ inspectRoute, fetcher: async url => new Response('', { status: url.includes('auth.openai.com') ? 200 : 401 }) });
  assert.equal(result.networkOk, true); assert.equal(result.ok, false);
  assert.equal(result.localRoute.target, '127.0.0.1:15721');
  assert.match(result.message, /CC Switch/); assert.match(result.message, /直连/);
  assert.doesNotMatch(JSON.stringify(result), /private-secret/);
});

test('external Claude providers are identified without making a connection to them', async () => {
  let probes = 0;
  const result = await inspectClaudeRoute({ read: async () => JSON.stringify({env:{ANTHROPIC_BASE_URL:'https://secret:password@example.com/v1'}}), probe: async () => { probes++; } });
  assert.equal(result.local, false); assert.equal(probes, 0); assert.equal(result.target, 'example.com');
});
