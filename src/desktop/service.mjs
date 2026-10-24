import { t } from './localize.mjs';
﻿import { client, config, saveConfig, stateDir, applyProxy } from '../core/runtime.mjs';
import { models, clearModels } from '../core/catalog.mjs';
import { createBridgeServer } from '../core/server.mjs';
import { testConnection, explainConnectionError, inspectClaudeRoute } from './network.mjs';

export function createDesktopService(dependencies = {}) {
  const auth = dependencies.client || client;
  const settings = dependencies.config || config;
  const persist = dependencies.saveConfig || saveConfig;
  const discover = dependencies.models || models;
  const createServer = dependencies.createServer || createBridgeServer;
  let server, signingIn, loginController, catalog = [], queue = Promise.resolve();
  async function status() {
    const session = signingIn ? { status: 'connecting', sharing: false } : await auth.getSession();
    return { running: !!server?.listening, session: { status: session.status, sharing: !!session.sharing }, port: settings.port,
      baseURL: `http://127.0.0.1:${settings.port}/v1`, anthropicURL: `http://127.0.0.1:${settings.port}`,
      apiKey: settings.localKey, model: settings.model, proxy: settings.proxy || '', integration: settings.integration || null,
      models: catalog, stateDir: dependencies.stateDir || stateDir };
  }
  async function stop() {
    loginController?.abort();
    auth.cancelSignIn();
    if (signingIn) await signingIn.catch(() => {});
    if (server) {
      const active = server;
      await new Promise(resolve => {
        const timeout = setTimeout(() => { active.closeAllConnections(); resolve(); }, 1500);
        active.close(() => { clearTimeout(timeout); resolve(); });
        active.closeIdleConnections();
      });
      server = undefined;
    }
  }
  async function execute(method, args = {}) {
    if (method === 'start') {
      if (!server?.listening) {
        const next = createServer();
        await new Promise((resolve, reject) => {
          next.once('error', error => {
            const failure = new Error(error.code === 'EADDRINUSE' ? t('端口 {port} 已被占用，请关闭旧版 Bridge 或 Gateway 后重试。', { port: settings.port }) : t('无法启动本地服务（{code}）。', { code: error.code || t('未知错误') }));
            failure.code = error.code; reject(failure);
          });
          next.listen(settings.port, '127.0.0.1', () => { next.removeListener('error', reject); resolve(); });
        });
        server = next;
      }
    } else if (method === 'stop') await stop();
    else if (method === 'logout') {
      await stop();
      try { await auth.disconnect(); }
      finally { catalog = []; (dependencies.clearModels || clearModels)(); }
    }
    else if (method === 'models') { catalog = await discover(true); }
    else if (method === 'selectModel') {
      const slug = typeof args === 'string' ? args : args.model || args.slug;
      const available = await discover();
      if (!available.some(model => model.slug === slug)) throw new Error(t('此模型暂不可用，请刷新模型后重新选择。'));
      const previous = settings.model;
      settings.model = slug;
      try {
        if (settings.integration) {
          const integration = dependencies.integration || await import('../core/integration.mjs');
          await integration.syncModels(available);
        }
        await persist(); catalog = available;
      } catch (error) { settings.model = previous; await persist(); throw error; }
    } else if (method === 'integrate') {
      const mode = typeof args === 'string' ? args : args.mode;
      if (!['direct', 'cc-switch'].includes(mode)) throw new Error(t('请选择 Claude Code 直连或 CC Switch。'));
      const available = await discover();
      const integration = dependencies.integration || await import('../core/integration.mjs');
      const previous = settings.integration;
      try { await integration.configure(mode); await integration.syncModels(available); catalog = available; }
      catch (error) {
        if (previous === undefined) delete settings.integration; else settings.integration = previous;
        await persist(); throw error;
      }
    } else if (method === 'restore') {
      const integration = dependencies.integration || await import('../core/integration.mjs');
      await integration.restoreIntegration();
      delete settings.integration; await persist();
    } else if (method === 'setProxy') {
      const proxy = (typeof args === 'string' ? args : args.proxy || '').trim();
      if (proxy) {
        let url; try { url = new URL(proxy); } catch { throw new Error(t('请输入有效的 HTTP 或 HTTPS 代理地址。')); }
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error(t('代理地址必须以 http:// 或 https:// 开头。'));
      }
      (dependencies.applyProxy || applyProxy)(proxy);
      settings.proxy = proxy; await persist();
    } else throw new Error(t('未知桌面操作。'));
    return status();
  }
  return {
    invoke(method, args) {
      if (method === 'status') return status();
      if (method === 'testConnection') return (dependencies.testConnection || testConnection)({ proxy: settings.proxy || '', inspectRoute: dependencies.inspectClaudeRoute || inspectClaudeRoute }).then(async connection => ({ ...await status(), connection }));
      if (method === 'cancelLogin') { loginController?.abort(); auth.cancelSignIn(); return Promise.resolve(signingIn).catch(() => {}).then(status); }
      if (method === 'login') {
        if (!signingIn) {
          loginController = new AbortController();
          const signal = loginController.signal;
          signingIn = queue.then(() => { signal.throwIfAborted(); return auth.signIn({ signal }); }).then(session => {
          if (!session.sharing) throw new Error(t('请允许共享 ChatGPT 订阅用量以完成连接。'));
          }).then(() => { catalog = []; (dependencies.clearModels || clearModels)(); }).finally(() => { signingIn = undefined; loginController = undefined; });
          queue = signingIn.catch(() => {});
        }
        return signingIn.then(status).catch(async error => { throw await explainConnectionError(error, settings.proxy || '', dependencies.testProxySocket); });
      }
      if (['stop', 'logout'].includes(method)) { loginController?.abort(); auth.cancelSignIn(); }
      const result = queue.then(() => execute(method, args));
      queue = result.catch(() => {});
      return result.catch(async error => { throw await explainConnectionError(error, settings.proxy || '', dependencies.testProxySocket); });
    },
  };
}
