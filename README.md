# ChatGPT Plan Bridge

把 ChatGPT 订阅接入支持 OpenAI 兼容接口的软件，或在 Claude Code 中使用账户可调用的模型。两种方式都通过官方 Sign in with ChatGPT 登录，实际模型和额度由账户权限决定。

## URL + API Key 中间层

在 Windows 上安装 Node.js 24，然后在仓库目录运行：

```powershell
npm ci
npm run build
npm run gateway
```

另开一个终端，查看连接地址和密钥：

```powershell
node gateway.mjs config
```

在软件中选择 OpenAI 兼容提供商，填入以下配置：

| 配置项 | 填写内容 |
| --- | --- |
| Base URL | `http://127.0.0.1:17864/v1` |
| API Key | 上述命令输出的 `apiKey` |
| 模型 | 通过软件获取模型列表，或调用 `GET /v1/models` 查看 |

首次运行会生成随机 API Key，保存在本地，重启后继续使用。这个 Key 用于连接中间层；ChatGPT 的 OAuth 凭据由中间层单独保存。

第一次携带正确 Key 的有效请求会自动打开 ChatGPT 登录页面，授权后继续执行。如果软件在登录期间超时，登录完成后重试即可。也可以先运行 `node gateway.mjs login`。

支持 `/v1/chat/completions`、`/v1/responses` 和 `/v1/models`，包括普通响应、SSE 流式输出及函数工具调用。中间层使用独立目录 `%LOCALAPPDATA%\ChatGPTGateway`，无需安装 Claude Code 或 CC Switch，也不会修改它们的配置。

目前通过源码启动；下方的 Windows 安装包用于 Claude Code 集成。配置项、Python 示例和接口限制见 [GATEWAY.md](GATEWAY.md)。新增接口已通过模拟上游的 OpenAI SDK 测试，真实账户授权和调用尚未实测。

## Claude Code 集成

通过官方 **Sign in with ChatGPT** 授权，让 Claude Code CLI 使用 ChatGPT 订阅允许调用的模型。本地服务将 Anthropic Messages 转换为 OpenAI Responses；不运行 Codex CLI、不嵌套 coding agent、不使用网页 Cookie。

## 安装

从本私有仓库 Releases 下载 `ChatGPT-Plan-Bridge-Setup-1.0.0.exe`，双击运行。无需另装 Node.js、Python 或管理员权限。

1. 默认使用 CC Switch；未安装时向导提供官方下载入口。安装后请先启动一次。
2. 也可跳过 CC Switch；向导明确警告将覆盖 Claude Code 的模型和 API 连接设置。执行前自动备份，其他设置保留。
3. 在 Bridge Manager 登录，在官方浏览器页面授权订阅调用。登录成功后同步模型并启动服务。
4. CC Switch 模式：刷新或重启 CC Switch，在 **Claude Code** 页面使用唯一的“ChatGPT 订阅”供应商，切换到“聚合”模式。所有模型出现在 Claude Code 的 `/model` 中。直接模式：重启 Claude Code，使用写入的模型选择列表。

可选择安装位置、桌面快捷方式和登录 Windows 时自动启动。授权凭据由当前 Windows 用户的 DPAPI 加密，保存在 `%LOCALAPPDATA%\ChatGPTClaudeBridge`，不随安装包分发。代理首次读取环境或系统代理，可在管理器调整。

## 模型与 effort

从账号官方 `/v1/models` 动态获取模型，刷新后更新一个 CC Switch 供应商的原生 `stackModels` 列表，不为每个模型创建卡片。升级时合并旧卡片并保留当前供应商 ID。2026-10-23 测试账号返回：gpt-6.1-sol、gpt-6-astra、gpt-6-sol、gpt-6-luna、gpt-5.6-sol、gpt-5.6-terra、gpt-5.6-luna。

模型设置包含 `[1M]` 客户端标记。它改变 Claude Code 的窗口设置，**不扩展服务端额度或硬限制**。测试账号目录中 `context_window` 为 Sol 500,000、其他 272,000，`max_context_window` 均为 872,000；没有用百万 token 实测。超过服务端限制仍会失败。

账号权限决定实际可用范围；新模型可以动态发现，但仍需要兼容的 Responses/工具协议。程序不能解锁账号没有权限的模型。

在 Claude Code 使用 `/effort low|medium|high|xhigh|max`，或 `claude --effort max`。`output_config.effort` 原样映射为 `reasoning.effort`，日志记录上游确认值。不支持的显式档位返回错误，不静默降档；未指定时优先 high。同名档位不代表跨模型相同计算量。不把 ultra 的任务委派语义伪装成普通 effort。

## Windows 范围与限制

安装包内置 x64、ARM64、x86 运行时并自动选择，目标为 Windows 10/11 及兼容的 Windows Server 桌面环境。**不支持 Windows 7/8，不能承诺任何 Windows 都可用**。Claude Code 自身也必须支持目标系统。需完整 GUI、系统 PowerShell/.NET；实测范围见 `VALIDATION.md`。

接口仅监听 `127.0.0.1:17863`，需要本机随机密钥。端口冲突会报错，不接管其他服务。Token 计数为本地估算。文本、工具历史、SSE、ToolSearch 引用及 deferred MCP 工具完整链路已测试；图像/PDF 转换已实现，但未完整在线验证。加密推理缓存仅存于进程内存。不支持的输入块返回明确的 400 错误。

卸载可选择恢复配置和移除本程序添加的卡片，保留授权与备份。只恢复仍属于本程序的设置，保留用户后续修改。安装包未做商业代码签名。CC Switch 显示的美元费用是其估算，实际订阅用量以 ChatGPT 为准。

## 开发

```powershell
npm ci
npm run build
npm test
node build-assets.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File build-installer.ps1
```

构建需要 Node 24 和 Inno Setup 7.1（放在 `.tools/inno`）。下载脚本从官方源获取运行时并核对 SHA256；执行下载的构建器前检查 Authenticode 签名。代理可设置 `HTTPS_PROXY`。

`npm run test:e2e` 使用真实已授权账号和 Claude Code，执行全模型文本/Read 工具测试及 Sol 五档 effort 测试，会消耗少量订阅额度。结果在忽略的 `test-results`；发布报告不含凭据和个人路径。

`CHATGPT_BRIDGE_STATE_DIR`、`CHATGPT_BRIDGE_HOME`、`CHATGPT_BRIDGE_CC_DIR` 支持隔离测试和定制目录。静默直接安装必须显式指定 `/MODE=direct /ACCEPTCONFIGOVERWRITE=1`；静默卸载需 `/RESTORE=1` 才执行配置恢复。

官方参考：[SIWC cookbook](https://learn.chatgpt.com/cookbook/articles/sign-in-with-chatgpt)、[Devkit](https://github.com/openai/sign-in-with-chatgpt-devkit)、[Claude Code effort](https://code.claude.com/docs/en/model-config)、[CC Switch](https://ccswitch.io)。

## 许可

个人非商业实验。OpenAI Devkit 及其修改受 `vendor/siwc/LICENSE` 非商业许可约束；其他依赖保留各自许可。见 `THIRD-PARTY-NOTICES.md`。本项目不是 OpenAI、Anthropic 或 CC Switch 官方产品。
