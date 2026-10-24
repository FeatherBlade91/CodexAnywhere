'use strict';
const $ = (id) => document.getElementById(id);
let state = {}, busy = false, loginPending = false, page = 'connections', availableModels = [], noticeTimer, modelsSignature = '';
const api = (method, args) => window.bridge.invoke(method, args);
function notice(message, error = false) { clearTimeout(noticeTimer); $('notice').textContent = message; $('notice').classList.toggle('error', error); $('notice').hidden = false; if (!error) noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6000); }
function errorText(error) { return error?.message || String(error); }
function navigate(target) { page = target; document.querySelectorAll('.page').forEach(el => { el.hidden = el.id !== `page-${target}`; }); document.querySelectorAll('.nav-item').forEach(el => { el.classList.toggle('active', el.dataset.page === target); if (el.dataset.page === target) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); }); $('breadcrumb').textContent = `工作空间 / ${{ connections: '连接', models: '模型', settings: '设置' }[target]}`; }
document.querySelectorAll('[data-page]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.page)));
document.querySelector('.brand').addEventListener('click', () => navigate('connections'));
function isLoggedIn() { const status = state.session?.status; return Boolean(state.session?.sharing) && ['authenticated', 'logged_in', 'ready', 'connected', 'logged-in'].includes(status); }
function render() {
  const loggedIn = isLoggedIn(), loggingIn = loginPending || ['connecting', 'pending', 'logging_in', 'authorizing', 'logging-in'].includes(state.session?.status);
  $('service-status').classList.toggle('stopped', !state.running); $('service-status').replaceChildren(Object.assign(document.createElement('i'), { ariaHidden: 'true' }), document.createTextNode(state.running ? `服务运行中 · ${state.port || '本地'}` : '服务已停止'));
  $('toggle-service').textContent = state.running ? '停止服务' : '启动服务'; $('toggle-service').disabled = busy;
  $('account-state').textContent = loggingIn ? '请在浏览器中完成登录…' : loggedIn ? '已登录，可以连接你的应用' : state.session?.status === 'reauth_required' ? '登录已过期，请重新登录' : '登录后开始使用 ChatGPT 订阅';
  $('login').hidden = loggedIn || loggingIn; $('cancel-login').hidden = !loggingIn; $('logout').hidden = !loggedIn;
  $('base-url').value = state.baseURL || ''; $('anthropic-url').value = state.anthropicURL || ''; $('api-key').value = state.apiKey || '';
  $('current-model').textContent = loggedIn ? state.model || '尚未选择' : '登录后选择模型';
  const integration = state.integration; $('integration-state').textContent = typeof integration === 'string' && integration ? ({direct:'已配置 Claude Code','cc-switch':'已添加到 CC Switch',none:'尚未配置'}[integration] || integration) : integration?.mode ? `已配置 ${integration.mode === 'direct' ? 'Claude Code' : 'CC Switch'}` : '尚未配置';
  if (document.activeElement !== $('proxy') && !$('proxy').dataset.dirty) $('proxy').value = state.proxy || '';
  $('launch-at-login').checked = Boolean(state.launchAtLogin); $('state-dir').textContent = state.stateDir || ''; $('version').textContent = state.version ? `版本 ${state.version}` : '桌面版';
  if (Array.isArray(state.models)) availableModels = state.models;
  renderModels();
}
function renderModels() {
  const signature = JSON.stringify([availableModels, state.model, busy, isLoggedIn()]);
  if (signature === modelsSignature) return;
  modelsSignature = signature;
  const list = $('model-list'); list.replaceChildren(); $('model-count').textContent = availableModels.length ? `${availableModels.length} 个模型` : '';
  if (!availableModels.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = isLoggedIn() ? '点击「刷新列表」获取账号可用的模型。' : '登录 ChatGPT 后，刷新列表查看可用模型。'; list.append(empty); return; }
  availableModels.forEach(model => { const slug = typeof model === 'string' ? model : model.slug || model.id || model.name; if (!slug) return; const button = document.createElement('button'); button.type = 'button'; button.className = `model-option${state.model === slug ? ' selected' : ''}`; button.setAttribute('aria-pressed', String(state.model === slug)); button.disabled = busy; const copy = document.createElement('span'), title = document.createElement('strong'); title.textContent = typeof model === 'object' ? model.displayName || model.display_name || model.name || slug : slug; copy.append(title); if (typeof model === 'object' && model.description) { const description = document.createElement('small'); description.textContent = model.description; copy.append(description); } const check = document.createElement('span'); check.className = 'model-check'; check.textContent = state.model === slug ? '✓ 当前模型' : '选择'; button.append(copy, check); button.addEventListener('click', () => action(() => api('selectModel', slug), '已切换模型')); list.append(button); });
}
async function refresh() { const next = await api('status'); if (next) { state = next; render(); } }
async function action(work, success) { if (busy) return; busy = true; document.querySelectorAll('button:not(.nav-item):not([data-page])').forEach(el => { el.disabled = true; }); try { await work(); await refresh(); if (success) notice(success); } catch (error) { notice(errorText(error), true); } finally { busy = false; document.querySelectorAll('button').forEach(el => { el.disabled = false; }); render(); } }
function confirmAction(title, description, label) { return new Promise(resolve => { $('confirm-title').textContent = title; $('confirm-description').textContent = description; $('confirm-action').textContent = label; const dialog = $('confirm-dialog'); dialog.returnValue = 'cancel'; dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); dialog.showModal(); }); }
$('toggle-service').addEventListener('click', () => action(() => api(state.running ? 'stop' : 'start'), state.running ? '服务已停止' : '服务已启动'));
$('login').addEventListener('click', async () => { if (busy || loginPending) return; loginPending = true; render(); try { await api('login'); notice('登录流程已更新'); } catch (error) { notice(errorText(error), true); } finally { loginPending = false; await refresh().catch(() => {}); } });
$('cancel-login').addEventListener('click', () => action(() => api('cancelLogin'), '已取消登录'));
$('logout').addEventListener('click', async () => { if (await confirmAction('退出 ChatGPT 账号？', '退出后，连接的应用将无法继续使用此账号。你可以随时重新登录。', '退出登录')) action(() => api('logout'), '已退出登录'); });
document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => { const value = $(button.dataset.copy).value; if (!value) return notice('地址或密钥尚未就绪，请先启动服务。', true); try { await api('copy', value); notice(button.dataset.copy === 'api-key' ? '已复制 API 密钥' : '已复制连接地址'); } catch (error) { notice(errorText(error), true); } }));
$('reveal-key').addEventListener('click', () => { const show = $('api-key').type === 'password'; $('api-key').type = show ? 'text' : 'password'; $('reveal-key').textContent = show ? '隐藏' : '显示'; $('reveal-key').setAttribute('aria-label', show ? '隐藏 API 密钥' : '显示 API 密钥'); });
document.querySelectorAll('[data-integrate]').forEach(button => button.addEventListener('click', async () => { const mode = button.dataset.integrate, direct = mode === 'direct'; if (await confirmAction(direct ? '配置 Claude Code' : '添加到 CC Switch', direct ? '将备份现有 Claude Code 配置，并将连接地址、密钥和模型改为本地服务。你可以通过「恢复原配置」撤销。' : '将备份 CC Switch 现有配置，并添加 ChatGPT Bridge 连接。你可以通过「恢复原配置」撤销。', '备份并配置')) action(() => api('integrate', mode), '配置已更新'); }));
$('restore').addEventListener('click', async () => { if (await confirmAction('恢复原配置？', '仅恢复由 ChatGPT Bridge 管理的配置项，并保留之后的其他修改。使用 CC Switch 时，请先退出 CC Switch 再恢复。', '恢复原配置')) action(() => api('restore'), '已恢复原配置'); });
$('refresh-models').addEventListener('click', () => action(async () => { const result = await api('models'); availableModels = Array.isArray(result) ? result : result?.models || []; }, '模型列表已刷新'));
$('proxy').addEventListener('input', () => { $('proxy').dataset.dirty = 'true'; });
$('proxy-form').addEventListener('submit', event => { event.preventDefault(); action(async () => { await api('setProxy', $('proxy').value.trim()); delete $('proxy').dataset.dirty; }, '代理设置已保存'); });
$('test-connection').addEventListener('click', () => action(async () => {
  const output = $('connection-result');
  output.hidden = false;
  output.classList.remove('error');
  output.textContent = '正在使用已保存的代理设置检测连接…';
  $('test-connection').textContent = '检测中…';
  try {
    const result = await api('testConnection');
    const connection = result?.connection;
    if (!connection || typeof connection.ok !== 'boolean') throw new Error('未收到连接检测结果，请重试。');
    output.classList.toggle('error', !connection.ok);
    output.textContent = `${connection.ok ? '连接正常' : '连接失败'}：${connection.message || (connection.ok ? '可以连接服务。' : '请检查代理地址及代理软件是否正在运行。')}${connection.target ? `\n检测目标：${connection.target}` : ''}`;
  } catch (error) {
    output.classList.add('error');
    output.textContent = `连接检测失败：${errorText(error)}`;
  } finally { $('test-connection').textContent = '检测连接'; }
}));
$('launch-at-login').addEventListener('change', () => action(() => api('setLaunchAtLogin', $('launch-at-login').checked), '启动设置已保存'));
$('open-data').addEventListener('click', () => action(() => api('openDataFolder')));
refresh().catch(error => notice(`无法读取服务状态：${errorText(error)}`, true));
setInterval(() => { if (!busy && !$('confirm-dialog').open) refresh().catch(() => {}); }, 4000);
