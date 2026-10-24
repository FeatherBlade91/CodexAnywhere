import { createConnection } from 'node:net';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const networkCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);

export function networkCode(error) {
  if (!error || typeof error !== 'object') return undefined;
  if (networkCodes.has(error.code)) return error.code;
  if (error.name === 'TimeoutError') return 'ETIMEDOUT';
  return networkCode(error.cause) || error.errors?.map(networkCode).find(Boolean);
}

export function proxyTarget(proxy) {
  if (!proxy) return null;
  const url = new URL(proxy);
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)), label: `${url.hostname}:${url.port || (url.protocol === 'https:' ? 443 : 80)}` };
}

export function testProxySocket(proxy, timeoutMs = 3000) {
  if (!proxy) return Promise.resolve();
  const target = proxyTarget(proxy);
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: target.host, port: target.port });
    const finish = error => { socket.destroy(); error ? reject(error) : resolve(); };
    socket.once('connect', () => finish());
    socket.once('error', finish);
    socket.setTimeout(timeoutMs, () => finish(Object.assign(new Error('Connection timed out'), { code: 'ETIMEDOUT' })));
  });
}

export function connectionMessage(error, { proxy = '', proxyFailed = false, host = 'ChatGPT' } = {}) {
  const code = networkCode(error) || 'network_error';
  const target = proxy ? proxyTarget(proxy).label : null;
  if (proxyFailed) return `无法连接代理 ${target}（${code}）。请启动代理软件，或在设置中修正代理地址后保存。`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `无法解析 ${host} 的地址（${code}），请检查 DNS 或代理设置。`;
  if (['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code)) return `${host} 的安全证书验证失败（${code}），请检查系统时间或代理的证书配置。`;
  return `无法${target ? `通过代理 ${target}` : '直接'}连接 ${host}（${code}）。请检查代理规则、网络和防火墙后重试。`;
}

export async function inspectClaudeRoute({ home = process.env.CHATGPT_BRIDGE_HOME || homedir(), read = readFile, probe = testProxySocket } = {}) {
  let settings;
  try { settings = JSON.parse((await read(join(home, '.claude', 'settings.json'), 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) {
    if (error.code === 'ENOENT') return { configured: false };
    return { configured: false, message: '无法读取 Claude Code 设置，请检查 settings.json 格式。' };
  }
  const address = settings.env?.ANTHROPIC_BASE_URL;
  if (!address) return { configured: false };
  let endpoint;
  try { endpoint = new URL(address); } catch { return { configured: true, ok: false, message: 'Claude Code 的 API 地址格式无效，请在连接页重新配置。' }; }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
  if (!local) return { configured: true, local: false, target: endpoint.host };
  if (!['http:', 'https:'].includes(endpoint.protocol)) return { configured: true, local: true, ok: false, message: 'Claude Code 的本地 API 地址必须使用 HTTP 或 HTTPS。' };
  const target = proxyTarget(endpoint.href).label;
  try { await probe(endpoint.href); return { configured: true, local: true, ok: true, target }; }
  catch (error) {
    const switchRoute = endpoint.port === '15721' || String(settings.model || '').startsWith('ccs-claude-');
    return { configured: true, local: true, ok: false, target, code: networkCode(error) || 'network_error',
      message: switchRoute
        ? `Claude Code 正在连接 ${target}，但 CC Switch 的本地服务未运行。请启动 CC Switch 并开启代理，或在连接页配置 Claude Code 直连。`
        : `Claude Code 正在连接 ${target}，但该地址没有可用服务。请启动本地服务，或在连接页重新配置 Claude Code 直连。` };
  }
}

export async function testConnection({ proxy = '', fetcher = fetch, probe = testProxySocket, inspectRoute } = {}) {
  if (proxy) {
    try { await probe(proxy); }
    catch (error) { return { ok: false, message: connectionMessage(error, { proxy, proxyFailed: true }), target: proxyTarget(proxy).label, code: networkCode(error) || 'network_error' }; }
  }
  const targets = ['https://auth.openai.com/.well-known/openid-configuration', 'https://api.openai.com/v1/models'];
  const checks = await Promise.all(targets.map(async url => {
    const host = new URL(url).hostname;
    try {
      const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
      await response.body?.cancel();
      // The models endpoint deliberately receives no credentials: HTTP 401 proves reachability.
      if (response.status === 200 || (host === 'api.openai.com' && response.status === 401)) return { ok: true, host, status: response.status };
      return { ok: false, host, status: response.status, message: `${host} 返回 HTTP ${response.status}，请检查代理出口和访问规则。` };
    } catch (error) { return { ok: false, host, code: networkCode(error) || 'network_error', message: connectionMessage(error, { proxy, host }) }; }
  }));
  const failed = checks.find(check => !check.ok);
  const localRoute = inspectRoute ? await inspectRoute() : undefined;
  const networkOk = !failed;
  const message = failed?.message || (localRoute?.ok === false
    ? `ChatGPT 登录和 API 地址均可连接。${localRoute.message}`
    : 'ChatGPT 登录和 API 地址均可连接。');
  return { ok: networkOk && localRoute?.ok !== false, networkOk, message, target: proxy ? proxyTarget(proxy).label : 'direct', checks, ...(localRoute ? { localRoute } : {}) };
}

export async function explainConnectionError(error, proxy, probe = testProxySocket) {
  if (!networkCode(error) && !['network_error', 'connection_error'].includes(error.code)) return error;
  let proxyFailed = false;
  let cause = error;
  if (proxy) {
    try { await probe(proxy); }
    catch (failure) { proxyFailed = true; cause = failure; }
  }
  return Object.assign(new Error(connectionMessage(cause, { proxy, proxyFailed })), { code: networkCode(cause) || error.code });
}
