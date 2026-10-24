import { app, BrowserWindow, ipcMain, clipboard, shell, utilityProcess, dialog, Tray, Menu } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { loadLanguage, saveLanguage } from './language.mjs';
import { translator } from './renderer/i18n.js';

const here = dirname(fileURLToPath(import.meta.url));
const page = pathToFileURL(join(here, 'renderer/index.html')).href;
let window, worker, tray, quitting = false, workerError;
let locale, languagePath, restarting = false;
let t = translator('en');
let sequence = 0;
const pending = new Map();
const allowed = new Set(['status', 'start', 'stop', 'login', 'cancelLogin', 'logout', 'models', 'selectModel', 'integrate', 'restore', 'setProxy', 'testConnection']);

function request(method, args) {
  if (!worker || workerError) return Promise.reject(new Error(workerError || t('服务尚未就绪，请重新打开应用。')));
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(t('操作超时，请重试。'))); }, method === 'login' ? 600_000 : 90_000);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, method, args });
  });
}

function startWorker() {
  const local = process.env.LOCALAPPDATA || app.getPath('userData');
  let stateDir = process.env.CHATGPT_BRIDGE_STATE_DIR;
  let appId = 'chatgpt-bridge';
  let appName = 'Codex-Anywhere';
  // Keep legacy auth IDs and storage paths so existing grants and settings remain usable.
  if (!stateDir) {
    if (existsSync(join(local, 'ChatGPTClaudeBridge', 'bridge.json'))) {
      stateDir = join(local, 'ChatGPTClaudeBridge');
      appId = 'chatgpt-claude-bridge'; appName = 'Codex-Anywhere';
    } else if (existsSync(join(local, 'ChatGPTGateway', 'bridge.json'))) {
      stateDir = join(local, 'ChatGPTGateway');
      appId = 'chatgpt-api-gateway'; appName = 'Codex-Anywhere';
    } else stateDir = join(local, 'ChatGPTBridge');
  }
  worker = utilityProcess.fork(join(here, 'worker.mjs'), [], {
    serviceName: 'Codex-Anywhere service', stdio: 'pipe',
    env: { ...process.env, CHATGPT_BRIDGE_STATE_DIR: stateDir, CHATGPT_BRIDGE_APP_ID: appId, CHATGPT_BRIDGE_APP_NAME: appName, CHATGPT_BRIDGE_LANGUAGE: locale.language },
  });
  // Never forward backend logs or credentials into the renderer console.
  worker.stdout?.resume(); worker.stderr?.resume();
  worker.on('message', message => {
    const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer); pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error)); else item.resolve(message.result);
  });
  worker.on('exit', () => {
    workerError = t('后台服务已退出，请重新打开应用。');
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(workerError)); }
    pending.clear(); worker = undefined;
  });
}

function showWindow() {
  if (quitting || !app.isReady()) return;
  if (!window || window.isDestroyed()) createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function createTray() {
  tray = new Tray(join(here, 'assets/icon.ico'));
  tray.setToolTip(t('Codex-Anywhere — 后台运行'));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('打开 Codex-Anywhere'), click: showWindow },
    { type: 'separator' },
    { label: t('退出'), click: () => app.quit() },
  ]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

function createWindow() {
  window = new BrowserWindow({
    title: 'Codex-Anywhere', width: 1120, height: 800, minWidth: 800, minHeight: 640, icon: join(here, 'assets/icon.png'),
    backgroundColor: '#F3F6FA', autoHideMenuBar: true,
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== page) event.preventDefault(); });
  window.on('close', event => {
    if (quitting || !tray || tray.isDestroyed()) return;
    event.preventDefault();
    window.hide();
  });
  window.on('closed', () => { window = undefined; });
  window.loadURL(page);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.whenReady().then(async () => {
    languagePath = join(process.env.CHATGPT_BRIDGE_STATE_DIR || app.getPath('userData'), 'desktop-settings.json');
    locale = await loadLanguage(languagePath, app.getPreferredSystemLanguages());
    t = translator(locale.language);
    startWorker();
    ipcMain.handle('bridge:invoke', async (event, method, args) => {
      if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== page) throw new Error(t('拒绝未知窗口的请求。'));
      if (method === 'getLanguage') return locale;
      if (method === 'setLanguage') {
        if (restarting) return false;
        restarting = true;
        try { await saveLanguage(languagePath, args); }
        catch (error) { restarting = false; throw new Error(t(error.message)); }
        app.relaunch();
        app.quit();
        return true;
      }
      if (method === 'copy') {
        if (typeof args !== 'string' || args.length > 8192) throw new Error(t('无效的复制内容。'));
        clipboard.writeText(args); return true;
      }
      if (method === 'setLaunchAtLogin') {
        if (typeof args !== 'boolean') throw new Error(t('无效的启动设置。'));
        if (!app.isPackaged) throw new Error(t('开机启动仅在安装版中可用。'));
        app.setLoginItemSettings({ openAtLogin: args }); return args;
      }
      if (method === 'openDataFolder') {
        const state = await request('status');
        const error = await shell.openPath(state.stateDir);
        if (error) throw new Error(error);
        return true;
      }
      if (!allowed.has(method)) throw new Error(t('未知操作。'));
      const result = await request(method, args);
      if (method === 'status') return { ...result, version: app.getVersion(), launchAtLogin: app.isPackaged && app.getLoginItemSettings().openAtLogin };
      return result;
    });
    createTray();
    createWindow();
  }).catch(error => { dialog.showErrorBox(t('无法启动 Codex-Anywhere'), error.message); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting) return;
    quitting = true;
    if (!worker) return;
    event.preventDefault();
    const timeout = setTimeout(() => { worker?.kill(); app.exit(0); }, 6000);
    request('cancelLogin').catch(() => {});
    request('stop').catch(() => {}).finally(() => { clearTimeout(timeout); worker?.kill(); app.exit(0); });
  });
}
