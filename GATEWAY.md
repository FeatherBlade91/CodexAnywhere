# ChatGPT API Gateway

独立的本地 OpenAI 兼容中间层。只负责把已授权的 ChatGPT 订阅调用转换为 URL + API Key，不修改 Claude Code、CC Switch 或其他软件配置。

## 启动（Windows，Node.js 24）

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
