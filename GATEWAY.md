# ChatGPT API Gateway

独立的本地 OpenAI 兼容中间层。只负责把已授权的 ChatGPT 订阅调用转换为 URL + API Key，不修改 Claude Code、CC Switch 或其他软件配置。

## Windows 安装包

从 [Gateway Releases](https://github.com/NamelessDDDoge/chatgpt-plan-bridge/releases/tag/gateway-v1.0.0) 下载与你电脑匹配的安装包：普通 Intel / AMD 电脑选 `x64`，Windows 11 ARM 电脑选 `arm64`。双击安装后打开 ChatGPT API Gateway，复制地址和密钥，填入其他软件的 OpenAI 兼容接口设置。

安装包内置 Node.js，不需要另装运行环境、Claude Code 或 CC Switch。窗口提供登录、查看模型、启动和停止服务按钮。关闭窗口后服务继续运行；需要退出时点击“停止服务”。安装向导可选开机启动，默认关闭。

升级时先关闭管理窗口，安装程序会停止后台服务。卸载会停止服务，保留 `%LOCALAPPDATA%\ChatGPTGateway` 中的密钥和授权，下次安装可继续使用。安装包未做商业代码签名，下载后可与同一 Release 的 `.sha256` 文件核对。

x64 安装包在 Windows x64 上验证安装、窗口启动、服务启停、升级和卸载；ARM64 仅验证打包，尚未在 ARM 设备上运行。真实账户授权和模型调用仍需验证。

## 从源码启动（Windows，Node.js 24）

```powershell
npm ci
npm run build
npm run gateway
```

在另一个终端显示连接配置：

```powershell
node gateway.mjs config
```

把输出填入软件的 OpenAI / OpenAI Compatible 提供商设置：

- Base URL：`http://127.0.0.1:17864/v1`
- API Key：上述命令输出的 `apiKey`（首次运行随机生成，重启保持不变）
- 模型：通过软件“获取模型”功能选择，或调用 `GET /v1/models` 查看实际授权模型 ID。

要求完整接口地址的软件使用 `http://127.0.0.1:17864/v1/chat/completions`。

首次携带正确 API Key 的有效请求会自动打开官方 ChatGPT 登录页面；授权完成后继续请求。客户端可能在登录期间超时，完成登录后重试即可。也可以先运行 `node gateway.mjs login`，再启动软件。并发请求只触发一次登录。浏览器必须能在运行中间层的电脑上打开。

## 接口

| 接口 | 支持 |
| --- | --- |
| `GET /v1/models` | 动态获取账户可用模型 |
| `POST /v1/chat/completions` | 普通 JSON、SSE、多轮消息、图片输入、函数工具及工具结果、结构化输出、usage |
| `POST /v1/responses` | Responses 请求、普通 JSON、原生事件流 |
| `GET /health` | 无密钥存活检查 |

所有 `/v1` 接口接受 `Authorization: Bearer <API Key>`，也接受 `x-api-key`。上游始终使用 OAuth 凭据，凭据不会返回客户端。上游使用 `store:false`，客户端应传入完整历史，不依赖服务端保存会话。

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:17864/v1", api_key="填入本地 API Key")
model = client.models.list().data[0].id
result = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": "你好"}],
)
print(result.choices[0].message.content)
```

`node gateway.mjs status` 查看登录状态；`node gateway.mjs logout` 撤销本地连接。Ctrl+C 停止服务。

## 配置

| 环境变量 | 默认值 |
| --- | --- |
| `CHATGPT_GATEWAY_PORT` | `17864` |
| `CHATGPT_GATEWAY_API_KEY` | 自动生成的持久化密钥 |
| `CHATGPT_GATEWAY_STATE_DIR` | `%LOCALAPPDATA%\ChatGPTGateway` |
| `CHATGPT_GATEWAY_AUTO_LOGIN` | `1`，设为 `0` 禁用自动登录 |

监听地址固定为 `127.0.0.1`。客户端须运行于同一电脑；容器和远程客户端不能直接使用其自身的 localhost。独立目录保存配置和 Windows DPAPI 加密的授权。首次初始化读取环境代理或 Windows 系统代理，之后可在该目录 `bridge.json` 的 `proxy` 字段调整并重启。

这是协议兼容中间层，实际模型、参数、共享额度和权限仍由账户及上游决定。不会把订阅变成无限额 Platform API。未实现 embeddings、音频、图像生成、文件管理、旧版 `/v1/completions` 和 Responses 会话存储接口。Chat Completions 仅支持 `n=1`；不支持的 stop、logprobs 等参数返回 400。温度、输出长度、结构化输出等参数传给上游，由模型判断是否支持。

运行 `npm run test:gateway` 验证标准 OpenAI SDK、JSON/SSE、工具调用和错误处理；测试使用模拟上游，不消耗订阅额度。真实账户授权和实际软件兼容性需要在目标环境验证。沿用仓库及 SIWC 的许可要求，见 `THIRD-PARTY-NOTICES.md`。

## 构建安装包

使用 Node.js 24 和 Inno Setup 7.1。`node build-assets.mjs` 准备运行时及校验清单；将 Inno Setup 安装到 `.tools/inno` 后运行：

```powershell
npm ci
npm run build:gateway
powershell -NoProfile -ExecutionPolicy Bypass -File build-gateway.ps1 -Architecture arm64
npm run test:gateway-installer
```

也可通过 `-ToolsDirectory` 指定已有工具目录。构建脚本检查编译器签名和运行时 SHA-256，每个安装包只带一种架构的运行时。安装包及校验文件输出到 `dist`；安装测试使用隔离目录和卸载注册项，不使用真实登录凭据。
