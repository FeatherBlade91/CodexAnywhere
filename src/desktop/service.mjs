import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { modelMapping, validateModelMapping } from '../core/model-mapping.mjs';
import { t } from './localize.mjs';
﻿import { client, config, saveConfig, stateDir, applyProxy } from '../core/runtime.mjs';
import { models, clearModels } from '../core/catalog.mjs';
import { createBridgeServer } from '../core/server.mjs';
import { testConnection, explainConnectionError, inspectClaudeRoute, inspectLocalBridge } from './network.mjs';

export function createDesktopService(dependencies = {}) {
  const auth = dependencies.client || client;
  const settings = dependencies.config || config;
  const persist = dependencies.saveConfig || saveConfig;
  const discover = dependencies.models || models;
  const createServer = dependencies.createServer || createBridgeServer;
  let server, signingIn, loginController, catalog = [], queue = Promise.resolve();
  const now = dependencies.now || Date.now;
  let catalogLoaded = false, catalogRevision = 0;
  async function loadCatalog() {
    if (catalogLoaded) return;
    catalogLoaded = true;
    const revision = catalogRevision;
    try {
      const saved = JSON.parse(await readFile(join(dependencies.stateDir || stateDir, 'models.json'), 'utf8'));
      if (revision === catalogRevision && !catalog.length && Array.isArray(saved.models)) catalog = saved.models.filter(m => typeof m?.slug === 'string');
    } catch {}
  }
  async function rotateKey() {
    const previous = { localKey: settings.localKey, keyRotatedAt: settings.keyRotatedAt, integrationNeedsReconnect: settings.integrationNeedsReconnect };
    settings.localKey = randomBytes(32).toString('hex');
    settings.keyRotatedAt = now();
    settings.integrationNeedsReconnect = true;
    try { await persist(); }
    catch (error) { Object.assign(settings, previous); throw error; }
  }
  async function status() {
    await loadCatalog();
    const session = signingIn ? { status: 'connecting', sharing: false } : await auth.getSession();
    return { running: !!server?.listening, session: { status: session.status, sharing: !!session.sharing }, port: settings.port,
      baseURL: `http://127.0.0.1:${settings.port}/v1`, anthropicURL: `http://127.0.0.1:${settings.port}`,
      apiKey: settings.localKey, model: settings.model, modelMapping: modelMapping(settings), proxy: settings.proxy || '', integration: settings.integration || null,
      keyRotationHours: settings.keyRotationHours || 0,
      keyRotatedAt: settings.keyRotatedAt || null,
      keyNextRotationAt: settings.keyRotationHours && settings.keyRotatedAt != null ? settings.keyRotatedAt + settings.keyRotationHours * 3600000 : null,
      integrationNeedsReconnect: !!settings.integrationNeedsReconnect,
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
    if (method === 'rotateKey') await rotateKey();
    else if (method === 'setKeyRotation') {
      const hours = args.hours;
      if (![0, 1, 24, 168].includes(hours)) throw new Error(t('无效的自动刷新周期。'));
      const previous = { keyRotationHours: settings.keyRotationHours, keyRotatedAt: settings.keyRotatedAt };
      settings.keyRotationHours = hours;
      settings.keyRotatedAt = now();
      try { await persist(); } catch (error) { Object.assign(settings, previous); throw error; }
    } else if (method === 'checkKeyRotation') {
      if ([1, 24, 168].includes(settings.keyRotationHours) && settings.keyRotatedAt != null && now() >= settings.keyRotatedAt + settings.keyRotationHours * 3600000) await rotateKey();
    } else if (method === 'start') {
      if (!server?.listening) {
        const next = createServer();
        const listen = port => new Promise((resolve, reject) => {
          const failed = error => { next.removeListener('listening', ready); reject(error); };
          const ready = () => { next.removeListener('error', failed); resolve(); };
          next.once('error', failed); next.once('listening', ready);
          next.listen(port, '127.0.0.1');
        });
        try { await listen(settings.port); }
        catch (error) {
          if (error.code !== 'EADDRINUSE') throw error;
          await listen(0);
        }
        const previousPort = settings.port;
        settings.port = next.address().port;
        try {
          if (settings.port !== previousPort) {
            await persist();
            if (settings.integration) {
              const integration = dependencies.integration || await import('../core/integration.mjs');
              await integration.updatePort(previousPort);
            }
          }
        } catch (error) {
          await new Promise(resolve => next.close(resolve));
          settings.port = previousPort;
          await persist();
          throw error;
        }
        server = next;
      }
    } else if (method === 'stop') await stop();
    else if (method === 'logout') {
      await stop();
      try { await auth.disconnect(); }
      finally { catalogRevision++; catalogLoaded = true; catalog = []; (dependencies.clearModels || clearModels)(); }
    }
    else if (method === 'models') { catalogRevision++; catalog = await discover(true); }
    else if (method === 'setModelMapping') {
      const mapping = validateModelMapping(args);
      const available = settings.integration ? await discover() : catalog;
      const previous = settings.modelMapping;
      settings.modelMapping = mapping;
      try {
        if (settings.integration) {
          const integration = dependencies.integration || await import('../core/integration.mjs');
          await integration.syncModels(available);
        }
        await persist(); catalog = available;
      } catch (error) {
        if (previous === undefined) delete settings.modelMapping; else settings.modelMapping = previous;
        await persist(); throw error;
      }
    } else if (method === 'integrate') {
      const mode = typeof args === 'string' ? args : args.mode;
      if (!['direct', 'cc-switch'].includes(mode)) throw new Error(t('请选择 Claude Code 直连或 CC Switch。'));
      const available = await discover();
      const integration = dependencies.integration || await import('../core/integration.mjs');
      const previous = settings.integration;
      try { await integration.configure(mode); await integration.syncModels(available); settings.integrationNeedsReconnect = false; await persist(); catalog = available; }
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
      const previous = settings.proxy || '';
      const updateProxy = dependencies.applyProxy || applyProxy;
      updateProxy(proxy);
      settings.proxy = proxy;
      try { await persist(); }
      catch (error) {
        settings.proxy = previous;
        updateProxy(previous);
        throw error;
      }
    } else throw new Error(t('未知桌面操作。'));
    return status();
  }
  return {
    invoke(method, args) {
      if (method === 'status') return status();
      if (method === 'testConnection') return (dependencies.testConnection || testConnection)({ proxy: settings.proxy || '', inspectRoute: dependencies.inspectClaudeRoute || inspectClaudeRoute,
        inspectBridge: () => (dependencies.inspectLocalBridge || inspectLocalBridge)({ port: settings.port, running: !!server?.listening }),
      }).then(async connection => ({ ...await status(), connection }));
      if (method === 'cancelLogin') { loginController?.abort(); auth.cancelSignIn(); return Promise.resolve(signingIn).catch(() => {}).then(status); }
      if (method === 'login') {
        if (!signingIn) {
          loginController = new AbortController();
          const signal = loginController.signal;
          signingIn = queue.then(() => { signal.throwIfAborted(); return auth.signIn({ signal }); }).then(session => {
          if (!session.sharing) throw new Error(t('请允许共享 ChatGPT 订阅用量以完成连接。'));
          }).then(() => { catalogRevision++; catalog = []; (dependencies.clearModels || clearModels)(); }).finally(() => { signingIn = undefined; loginController = undefined; });
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
