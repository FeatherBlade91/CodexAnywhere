# 验证记录

验证日期：2026-10-23。执行环境为 Windows 11 x64；以下结论只覆盖列出的测试。测试使用隔离状态目录或明确的测试请求，没有提交账户凭据、用户提示词或本机配置。

## 离线回归

`npm test` 包含 24 项测试，在 x64 Node 和 x86 Node（Windows 11 的 WOW64 环境）下均通过。

覆盖范围：

- Claude effort 五档透传、工具历史、命名空间、指定工具选择、上游错误状态和代码、SSE 分块与 UTF-8。
- ToolSearch 的 `tool_reference` 内容及 deferred tool 定义。
- 上游 `response.completed.output` 为空时，从输出事件重建文本、工具参数和加密 reasoning；避免重复输出，保留 usage 和 stop reason。
- CC Switch 检测、供应商注册、配置备份恢复，以及卸载时保留其他供应商、聚合成员和用户后续修改。
- 临时端口上的服务生命周期：健康检查、拒绝无凭据和错误凭据的关闭请求、正确凭据返回 202 并自然退出；`stop.ps1` 优雅关闭测试进程。

测试入口见 `package.json` 的 `test` 脚本。x86 结果验证的是 WOW64 下的运行情况，不代表已经在 32 位 Windows 上完成实机测试。

## 真实请求与模型兼容性

`test-results/e2e.json` 记录 18 项真实 Claude Code CLI 测试全部通过：

- 7 个账户可用模型分别完成文本回复和 Read 工具往返，共 14 项：GPT-6.1-Sol、GPT-6-Astra、GPT-6-Sol、GPT-6-Luna、GPT-5.6-Sol、GPT-5.6-Terra、GPT-5.6-Luna。
- GPT-6.1-Sol 另外验证 medium、high、xhigh、max；结合前述 low，共五档均有上游返回的 effort 确认。

上述 18 项是在多模型基础实现阶段运行；后续修复另有以下针对性验证，并不表示每次修改后都重新执行了全部 18 项。

| 报告 | 验证结果 |
| --- | --- |
| `test-results/model-compat.json` | 实时账户目录中各模型的支持档位；`[1m]` / `[1M]` 均转换为正确上游模型 ID；不支持的 effort 和未知模型被拒绝。 |
| `test-results/tool-search.json` | 真实 CLI 调用 ToolSearch，观察到 `tool_reference`，随后调用发现的 deferred MCP 工具并返回验证标记；使用 `gpt-6.1-sol[1M]`。 |
| `test-results/stack-live.json` | 请求经过本机 CC Switch 聚合代理，`ccs-claude-openai--gpt-6-luna[1M]` 实际到达 `gpt-6-luna`，返回 `STACK_LUNA_OK`，上游确认 low；没有被供应商默认模型覆盖。 |
| `test-results/response-upstream-live.json` | 真实上游终止事件的 `output` 为空时，正确恢复文本和工具调用；指定工具选择通过；验证错误保留 HTTP 400 和 `unknown_parameter`。 |

这些运行报告保存在本地忽略目录，本文记录其结果；仓库保留可复跑的测试代码。不同模型同名 effort 不表示计算量或延迟相同，只表示所请求的档位被正确传递。

最终安装目录中的服务另通过非流式文本和指定工具调用两项测试、CC Switch Luna 聚合路由、Sol `[1M]` 的 max effort / Read 工具往返，以及三轮 ToolSearch → tool_reference → deferred MCP 工具完整链路。脱敏报告位于 `reports/`。

`node tests/model-compat.test.mjs` 是需要已登录账户的在线测试，独立于离线 `npm test` 执行。

## 上下文限制

`[1M]` 是 Claude Code 的客户端窗口选择标记，不会自动扩大 OpenAI 上游容量。实时账户目录报告：

- GPT-6.1-Sol 的 `context_window` 为 500000，其他六个模型为 272000。
- 七个模型的 `max_context_window` 都为 872000。
- `supports_experimental_context` 对 GPT-6-Astra、GPT-6-Sol、GPT-6-Luna、GPT-5.6-Sol 为 true，对其余三个为 false。

没有发送百万 token 请求，也没有验证超出上述默认窗口时各模型的实际接受范围。不得把客户端 `[1M]` 标记解释为已验证上游支持一百万 token。

## 安装包和平台范围

最终发布 EXE 已通过 8 项隔离安装/卸载测试，包括中文空格路径、缺少 CC Switch 拦截、直接模式覆盖同意、内置运行时、配置恢复和仅移除自有供应商。该 EXE 已成功安装到本机正式目录，健康检查确认服务从安装目录运行。

SHA-256：f7583fd79c82f59f9732d90f971b28c0c785ea65889761094f35c531a003bf11。

Windows 11 x64 已完成实际运行验证；ARM64 目前仅完成打包层面的校验，没有 ARM64 实机运行结果。未逐一验证所有 Windows 版本、所有安全软件和系统策略，不能保证“任何 Windows 系统”均可运行。
