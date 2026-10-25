# OpenAI 兼容应用实例

在主页登录并启动服务，复制 API 地址（默认 `http://127.0.0.1:17863/v1`）和本地 API 密钥。密钥是本软件生成的本地访问凭据。

`model` 必须填写 `/v1/models` 返回的准确 ID，例如 `gpt-6.1-sol`。OpenAI 路径原样转发 ID，不解析显示名称、Claude 别名或 `[1M]` 后缀，也不使用主页的 Claude Code 默认模型替换它。

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:17863/v1",
    api_key="粘贴主页的本地 API 密钥",
)
reply = client.chat.completions.create(
    model="gpt-6.1-sol",
    messages=[{"role": "user", "content": "你好"}],
    reasoning_effort="high",
)
print(reply.choices[0].message.content)
```

先安装依赖：`pip install openai`。主页示例会随实际服务地址、模型与支持档位更新。

## 思考强度

| 客户端值 | 上游值 | 中文含义 |
| --- | --- | --- |
| low | low | 低 |
| medium | medium | 中 |
| high | high | 高 |
| xhigh | xhigh | 超高 |
| max | max | 最高 |

Chat Completions 的 `reasoning_effort` 转为 Responses 的 `reasoning.effort`，值原样保留；直接调用 Responses 时使用 `reasoning={"effort": "high"}`。顶层 `effort` 不是这两个协议的参数。

五档是本应用模型目录展示的范围，支持范围以当前账号和模型为准。OpenAI 路径不会静默降级，也不会在省略参数时添加默认值：由上游验证或选择默认强度。其他值也会原样交给上游验证。

Claude Code 的 Anthropic 路径不同：`output_config.effort` 在本地按模型支持列表校验这五档，省略时优先 `high`，否则取支持列表第一项。

## DeepSeek Harness

在模型设置中新建提供商 `codex-anywhere`，使用 `openai-completions` 协议，上述 Base URL 和 API Key，添加准确模型 ID。思考格式选 `openai` 并启用 reasoning effort。

先从运行中的桌面服务复制实际 Base URL。`17863` 只是默认端口，保存的端口或端口冲突可能使服务使用其他端口。

使用 profile 的 Harness 在 `~/.dsh/profiles/desktop/cordis.patch.yml` 中配置桌面端，在 `profiles/headless/cordis.patch.yml` 中配置 CLI。配置是数组，下面是 `llm-pi-ai` 项的示例；编辑已有项时保留其他提供商，勿重复添加同一 id：

```yaml
- id: llm-pi-ai
  config:
    providers:
      codex-anywhere:
        displayName: Codex-Anywhere
        api: openai-completions
        baseURL: http://127.0.0.1:17863/v1 # 替换为桌面服务的实际地址
        apiKeyEnv: CODEX_ANYWHERE_API_KEY
        compat:
          thinkingFormat: openai
          supportsReasoningEffort: true
        models:
          - id: gpt-6.1-sol
            name: GPT-6.1-Sol (Codex-Anywhere)
            reasoningEfforts:
              low: low
              medium: medium
              high: high
              xhigh: xhigh
              max: max
```

通过 Harness 的凭据设置保存 `CODEX_ANYWHERE_API_KEY`。各版本凭据文件格式不同，不要直接覆盖现有文件。选择新提供商与模型即可聊天，原有默认模型可以保留。

本机 CLI `0.1.0-rc.6` 要求凭据文件是引用名称到字符串的平面映射，而桌面凭据使用 `version/refs/records`。两者共存时，在 CLI profile 的 `credentials` 项中将 `config.path` 指向单独的 CLI 凭据文件，并在该文件中保存同一密钥；保留桌面凭据原结构。CLI 的 `agent-default-model` 项通过 `config.provider` 和 `config.model` 选择模型。旧版本使用 `settings.yaml`；若该文件已迁移为 `settings.yaml.imported`，应修改对应 profile。

本项目提供 `node scripts/live/harness.mjs` 实机检查：使用已保存的桌面与 headless 配置及凭据，在临时目录生成随机文件，让 Harness 用工具读取并返回内容，覆盖流式工具调用与后续模型请求。结果保存为 `test-results/harness-live.json`。需要运行中的桌面服务、有效登录和已安装的 Harness，会消耗订阅额度。脚本不更改默认模型或凭据。

2026-10-25 复测：修正本机 profile 中过期的端口和 CLI 凭据路径后，`gpt-6.1-sol` 与 `gpt-6-astra` 均通过上述工具调用测试，退出码均为 0；使用持久化凭据，没有临时注入 API Key。详见 [实机报告](reports/harness-tools-live.json)。这不代表所有思考档位、长上下文或桌面 GUI 聊天均已验证。

`reasoningEfforts` 的键是 Harness 显示档位，值是线上的参数值。上面的同名映射会发送 `reasoning_effort="low"` 等值；若配置为 `high: xhigh`，Harness 的 high 档实际会发送 xhigh，代理仍原样转发。只配置模型实际支持的档位。

2026-10-24 本机验证：通过已安装的 DeepSeek Harness headless CLI，使用新增的 `codex-anywhere` 提供商、`gpt-6.1-sol` 和 low 档，经过本地 OpenAI Chat Completions 代理得到 `CODEX_ANYWHERE_HARNESS_OK`，进程退出码 0。该验证证明此模型与档位真实可用，不代表每个模型或每档均已调用验证。
