import { translator, localizeDocument } from './i18n.js';
const locale = await window.bridge.invoke('getLanguage');
const t = translator(locale.language);
localizeDocument(document, t, locale.language);
const $ = (id) => document.getElementById(id);
let state = {}, busy = false, loginPending = false, page = 'connections', availableModels = [], noticeTimer, modelsSignature = '', connectionSignature = '';
const api = (method, args) => window.bridge.invoke(method, args);
function notice(message, error = false) { clearTimeout(noticeTimer); $('notice').textContent = message; $('notice').classList.toggle('error', error); $('notice').hidden = false; if (!error) noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6000); }
function errorText(error) { return t((error?.message || String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')); }
function navigate(target) { page = target; document.querySelectorAll('.page').forEach(el => { el.hidden = el.id !== `page-${target}`; }); document.querySelectorAll('.nav-item').forEach(el => { el.classList.toggle('active', el.dataset.page === target); if (el.dataset.page === target) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); }); $('breadcrumb').textContent = `${t('工作空间')} / ${{ connections: t('连接'), models: t('模型'), settings: t('设置'), guide: t('接入指南') }[target]}`; }
document.querySelectorAll('[data-page]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.page)));
document.querySelector('.brand').addEventListener('click', () => navigate('connections'));
function isLoggedIn() { const status = state.session?.status; return Boolean(state.session?.sharing) && ['authenticated', 'logged_in', 'ready', 'connected', 'logged-in'].includes(status); }
function render() {
  const signature = JSON.stringify([state.running, state.port, state.proxy]);
  if (signature !== connectionSignature) {
    $('quick-test-result').hidden = true;
    $('connection-result').hidden = true;
    connectionSignature = signature;
  }
  const loggedIn = isLoggedIn(), loggingIn = loginPending || ['connecting', 'pending', 'logging_in', 'authorizing', 'logging-in'].includes(state.session?.status);
  $('service-status').classList.toggle('stopped', !state.running); $('service-status').replaceChildren(Object.assign(document.createElement('i'), { ariaHidden: 'true' }), document.createTextNode(state.running ? t('服务运行中 · {port}', { port: state.port || t('本地') }) : t('服务已停止')));
  $('toggle-service').textContent = state.running ? t('停止服务') : t('启动服务'); $('toggle-service').disabled = busy;
  $('account-state').textContent = loggingIn ? t('请在浏览器中完成登录…') : loggedIn ? t('已登录，可以连接你的应用') : state.session?.status === 'reauth_required' ? t('登录已过期，请重新登录') : t('登录后开始使用 ChatGPT 订阅');
  $('login').hidden = loggedIn || loggingIn; $('cancel-login').hidden = !loggingIn; $('logout').hidden = !loggedIn;
  $('route-proxy').textContent = state.proxy ? t('通过已保存代理') : t('直连上游');
  $('base-url').value = state.baseURL || ''; $('anthropic-url').value = state.anthropicURL || ''; $('api-key').value = state.apiKey || '';
  $('current-model').textContent = loggedIn ? state.model || t('尚未选择') : t('登录后选择模型');
  const integration = state.integration; $('integration-state').textContent = typeof integration === 'string' && integration ? ({direct:t('已配置 Claude Code'),'cc-switch':t('已添加到 CC Switch'),none:t('尚未配置')}[integration] || integration) : integration?.mode ? t('已配置 {name}', { name: integration.mode === 'direct' ? 'Claude Code' : 'CC Switch' }) : t('尚未配置');
  if (document.activeElement !== $('proxy') && !$('proxy').dataset.dirty) $('proxy').value = state.proxy || '';
  $('launch-at-login').checked = Boolean(state.launchAtLogin); $('state-dir').textContent = state.stateDir || ''; $('version').textContent = state.version ? t('版本 {version}', { version: state.version }) : t('桌面版');
  if (Array.isArray(state.models)) availableModels = state.models;
  renderModels();
  renderExample();
}
function renderModels() {
  const signature = JSON.stringify([availableModels, state.model, busy, isLoggedIn()]);
  if (signature === modelsSignature) return;
  modelsSignature = signature;
  const list = $('model-list'); list.replaceChildren(); $('model-count').textContent = availableModels.length ? t('{count} 个模型', { count: availableModels.length }) : '';
  if (!availableModels.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = isLoggedIn() ? t('点击「刷新列表」获取账号可用的模型。') : t('登录 ChatGPT 后，刷新列表查看可用模型。'); list.append(empty); return; }
  availableModels.forEach(model => { const slug = typeof model === 'string' ? model : model.slug || model.id || model.name; if (!slug) return; const button = document.createElement('button'); button.type = 'button'; button.className = `model-option${state.model === slug ? ' selected' : ''}`; button.setAttribute('aria-pressed', String(state.model === slug)); button.disabled = busy; const copy = document.createElement('span'), title = document.createElement('strong'); title.textContent = typeof model === 'object' ? model.displayName || model.display_name || model.name || slug : slug; copy.append(title); if (typeof model === 'object' && model.description) { const description = document.createElement('small'); description.textContent = model.description; copy.append(description); } const check = document.createElement('span'); check.className = 'model-check'; check.textContent = state.model === slug ? t('✓ 当前模型') : t('选择'); button.append(copy, check); button.addEventListener('click', () => action(() => api('selectModel', slug), t('已切换模型'))); list.append(button); });
}
async function refresh() { const next = await api('status'); if (next) { state = next; render(); } }
async function action(work, success) { if (busy) return; busy = true; document.querySelectorAll('button:not(.nav-item):not([data-page])').forEach(el => { el.disabled = true; }); try { await work(); await refresh(); if (success) notice(success); } catch (error) { notice(errorText(error), true); } finally { busy = false; document.querySelectorAll('button').forEach(el => { el.disabled = false; }); render(); } }
function confirmAction(title, description, label) { return new Promise(resolve => { $('confirm-title').textContent = title; $('confirm-description').textContent = description; $('confirm-action').textContent = label; const dialog = $('confirm-dialog'); dialog.returnValue = 'cancel'; dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); dialog.showModal(); }); }
$('toggle-service').addEventListener('click', () => action(() => api(state.running ? 'stop' : 'start'), state.running ? t('服务已停止') : t('服务已启动')));
$('login').addEventListener('click', async () => { if (busy || loginPending) return; loginPending = true; render(); try { await api('login'); notice(t('登录流程已更新')); } catch (error) { notice(errorText(error), true); } finally { loginPending = false; await refresh().catch(() => {}); } });
$('cancel-login').addEventListener('click', () => action(() => api('cancelLogin'), t('已取消登录')));
$('logout').addEventListener('click', async () => { if (await confirmAction(t('退出 ChatGPT 账号？'), t('退出后，连接的应用将无法继续使用此账号。你可以随时重新登录。'), t('退出登录'))) action(() => api('logout'), t('已退出登录')); });
document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => { const value = $(button.dataset.copy).value; if (!value) return notice(t('地址或密钥尚未就绪，请先启动服务。'), true); try { await api('copy', value); notice(button.dataset.copy === 'api-key' ? t('已复制 API 密钥') : t('已复制连接地址')); } catch (error) { notice(errorText(error), true); } }));
$('reveal-key').addEventListener('click', () => { const show = $('api-key').type === 'password'; $('api-key').type = show ? 'text' : 'password'; $('reveal-key').textContent = show ? t('隐藏') : t('显示'); $('reveal-key').setAttribute('aria-label', show ? t('隐藏 API 密钥') : t('显示 API 密钥')); });
document.querySelectorAll('[data-integrate]').forEach(button => button.addEventListener('click', async () => { const mode = button.dataset.integrate, direct = mode === 'direct'; if (await confirmAction(direct ? t('配置 Claude Code') : t('添加到 CC Switch'), direct ? t('将备份现有 Claude Code 配置，并将连接地址、密钥和模型改为本地服务。你可以通过「恢复原配置」撤销。') : t('将备份 CC Switch 现有配置，并添加 Codex-Anywhere 连接。你可以通过「恢复原配置」撤销。'), t('备份并配置'))) action(() => api('integrate', mode), t('配置已更新')); }));
$('restore').addEventListener('click', async () => { if (await confirmAction(t('恢复原配置？'), t('仅恢复由 Codex-Anywhere 管理的配置项，并保留之后的其他修改。使用 CC Switch 时，请先退出 CC Switch 再恢复。'), t('恢复原配置'))) action(() => api('restore'), t('已恢复原配置')); });
$('refresh-models').addEventListener('click', () => action(async () => { const result = await api('models'); availableModels = Array.isArray(result) ? result : result?.models || []; }, t('模型列表已刷新')));
$('proxy').addEventListener('input', () => { $('proxy').dataset.dirty = 'true'; });
$('proxy-form').addEventListener('submit', event => { event.preventDefault(); action(async () => { await api('setProxy', $('proxy').value.trim()); delete $('proxy').dataset.dirty; }, t('代理设置已保存')); });
async function runConnectionTest(outputId) {
  await action(async () => {
    const output = $(outputId);
    output.hidden = false;
    output.classList.remove('error');
    output.textContent = t('正在使用已保存的代理设置检测连接…');
    $('test-connection').textContent = t('检测中…');
    $('quick-test').textContent = t('检测中…');
    try {
      const result = await api('testConnection');
      const connection = result?.connection;
      if (!connection || typeof connection.ok !== 'boolean') throw new Error(t('未收到连接检测结果，请重试。'));
      output.classList.toggle('error', !connection.ok);
      const lines = [connection.ok ? t('连接正常') : t('连接需要处理'), t(connection.message || '')];
      if (connection.localBridge) lines.push(t('本地服务：{result}', { result: connection.localBridge.ok ? t('连接正常') : t(connection.localBridge.message) }));
      for (const check of connection.checks || []) lines.push(check.host + ' · ' + (check.ok ? t('网络可达') : t('连接失败')) + (check.status ? ' (HTTP ' + check.status + ')' : '') );
      lines.push(t('未发送聊天内容；未验证模型生成、账号额度或模型权限。'));
      if ($('proxy').dataset.dirty) lines.push(t('代理地址尚未保存，本次使用的是已保存的设置。'));
      output.textContent = lines.filter(Boolean).join('\n');
    } catch (error) {
      output.classList.add('error');
      output.textContent = t('连接检测失败：{error}', { error: errorText(error) });
    } finally {
      $('test-connection').textContent = t('检测连接');
      $('quick-test').textContent = t('一键测试');
    }
  });
}
$('test-connection').addEventListener('click', () => runConnectionTest('connection-result'));
$('quick-test').addEventListener('click', () => runConnectionTest('quick-test-result'));
$('launch-at-login').addEventListener('change', () => action(() => api('setLaunchAtLogin', $('launch-at-login').checked), t('启动设置已保存')));
$('open-data').addEventListener('click', () => action(() => api('openDataFolder')));
refresh().catch(error => notice(t('无法读取服务状态：{error}', { error: errorText(error) }), true));
setInterval(() => { if (!busy && !$('confirm-dialog').open) refresh().catch(() => {}); }, 4000);

$('language').value = locale.preference;
$('language').addEventListener('change', async () => {
  const choice = $('language').value;
  $('language').value = locale.preference;
  if (busy || choice === locale.preference) return;
  if (await confirmAction(t('更换语言并重启？'), t('更换语言需要重启软件。本地服务将停止，正在进行的请求会中断。确认后将保存语言设置并自动重启。'), t('重启软件'))) {
    $('language').disabled = true;
    await action(() => api('setLanguage', choice));
    $('language').disabled = false;
  }
});

function renderExample() {
  const model = availableModels.find(m => (m.slug || m.id) === state.model) || availableModels[0];
  const slug = model?.slug || model?.id || state.model || 'gpt-6.1-sol';
  const effort = model?.efforts?.includes('high') ? 'high' : model?.efforts?.[0] || 'high';
  $('example-model').value = slug;
  $('example-efforts').textContent = model?.efforts?.length ? t('{model} 当前目录支持：{efforts}。', { model: slug, efforts: model.efforts.join(', ') }) : t('登录并刷新模型后，这里显示示例模型支持的强度。');
  $('python-example').textContent = `from openai import OpenAI, DefaultHttpxClient

client = OpenAI(
    base_url=${JSON.stringify(state.baseURL || 'http://127.0.0.1:17863/v1')},
    api_key=${JSON.stringify(t('粘贴上方本地 API 密钥'))},
    http_client=DefaultHttpxClient(trust_env=False, follow_redirects=False),
    max_retries=0,
)
reply = client.chat.completions.create(
    model=${JSON.stringify(slug)},
    messages=[{"role": "user", "content": "Hello"}],
    reasoning_effort=${JSON.stringify(effort)},
)
print(reply.choices[0].message.content)`;
}
