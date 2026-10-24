import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { networkCode, proxyTarget, testProxySocket, testConnection, explainConnectionError, inspectClaudeRoute } from '../src/desktop/network.mjs';

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
    return new Response('', { status: url.includes('auth.openai.com') ? 200 : 401 });
  } });
  assert.equal(result.ok, true); assert.equal(calls.length, 2);
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
