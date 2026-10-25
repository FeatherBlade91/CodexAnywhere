import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { runInNewContext } from 'node:vm';

function python(code, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON || 'python', ['-c', code], { env });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

test('rendered Python example bypasses environment proxies, blocks redirects, and never retries 502', { timeout: 60000 }, async t => {
  const installed = await python('from openai import OpenAI, DefaultHttpxClient', process.env).catch(() => null);
  if (!installed || installed.code !== 0) return t.skip('Requires Python with the openai package installed');
  let proxyCalls = 0, localCalls = 0;
  const proxy = createServer((req, res) => { proxyCalls++; res.writeHead(502); res.end('Blocked by test proxy'); });
  const local = createServer(async (req, res) => {
    localCalls++;
    let body = ''; for await (const chunk of req) body += chunk;
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer fixture-key');
    assert.equal(JSON.parse(body).model, 'fixture-model');
    if (localCalls === 2) {
      res.writeHead(307, { location: `http://127.0.0.1:${proxy.address().port}/redirected` });
      res.end(); return;
    }
    if (localCalls >= 3) { res.writeHead(502); res.end('Fixture upstream error'); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'fixture', object: 'chat.completion', created: 0, model: 'fixture-model', choices: [{ index: 0, message: { role: 'assistant', content: 'LOCAL_OK' }, finish_reason: 'stop' }] }));
  });
  await Promise.all([new Promise(r => proxy.listen(0, '127.0.0.1', r)), new Promise(r => local.listen(0, '127.0.0.1', r))]);
  t.after(() => { proxy.close(); local.close(); });
  const proxyURL = `http://127.0.0.1:${proxy.address().port}`;
  const baseURL = `http://127.0.0.1:${local.address().port}/v1`;
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(http_proxy|https_proxy|all_proxy|no_proxy)$/i.test(key)) delete env[key];
  Object.assign(env, { HTTP_PROXY: proxyURL, HTTPS_PROXY: proxyURL, ALL_PROXY: proxyURL, NO_PROXY: '' });
  const control = await python(`import httpx\nprint(httpx.get(${JSON.stringify(baseURL)}).status_code)`, env);
  assert.equal(control.code, 0, control.stderr);
  assert.equal(control.stdout.trim(), '502');
  assert.equal(proxyCalls, 1, 'environment proxy is active in the control request');
  const source = await readFile(new URL('../src/desktop/renderer/app.js', import.meta.url), 'utf8');
  const renderSource = source.match(/function renderExample\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(renderSource, 'renderer exposes the example generator');
  const fields = {};
  runInNewContext(`${renderSource}\nrenderExample();`, {
    availableModels: [{ slug: 'fixture-model', efforts: ['high'] }],
    state: { model: 'fixture-model', baseURL },
    $: id => fields[id] ||= {},
    t: value => value === '粘贴上方本地 API 密钥' ? 'fixture-key' : value,
  });
  const result = await python(fields['python-example'].textContent + `
from openai import APIStatusError
for expected_status in [307, 502]:
    try:
        client.chat.completions.create(model="fixture-model", messages=[{"role": "user", "content": "offline fixture"}])
        raise AssertionError("Expected an HTTP error")
    except APIStatusError as error:
        assert error.status_code == expected_status, error.status_code
client.close()
`, env);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'LOCAL_OK');
  assert.equal(localCalls, 3, 'one success, one redirect error and one 502 without retry');
  assert.equal(proxyCalls, 1, 'example never reaches either the environment proxy or redirect destination');
});
