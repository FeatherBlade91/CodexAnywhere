# Codex-Anywhere 2.0

一个独立的 Electron 桌面应用，统一原来的 Plan Bridge 和 API Gateway。

- 登录一次，共享模型、密钥与服务开关。
- 同一端口提供 OpenAI Chat Completions、Responses 和 Anthropic Messages 接口。
- 复制地址与密钥即可接入其他应用；也可配置 Claude Code 或 CC Switch。
- 支持模型选择、代理、开机启动和配置恢复。
- 设置中的“检测连接”检查已保存的代理、授权/API 和 Claude Code 当前本地路由，不发送模型提示词或显示凭据。
- 安装包内置运行环境；关闭应用时停止本地服务。

下载 `Codex-Anywhere-Setup-2.0.0-x64.exe`，适用于 Windows 10/11 x64。先退出旧版 Bridge/Gateway，以免占用端口。旧 Bridge 配置优先沿用，其次沿用 Gateway 配置；若两者都存在，使用 Bridge 的授权。账户权限和额度由上游决定。

安装包尚未代码签名，可使用附带的 SHA-256 校验文件核对。卸载保留本地授权与配置；若需撤销 Claude Code 接入，请先在应用中点击“恢复原配置”。

旧数据保留原目录，依次选用 `%LOCALAPPDATA%\ChatGPTClaudeBridge`、`%LOCALAPPDATA%\ChatGPTGateway`；全新安装使用 `%LOCALAPPDATA%\ChatGPTBridge`。不会复制或合并两套凭据。

如果 Claude Code 报 `ECONNREFUSED 127.0.0.1:15721`，请启动 CC Switch 及其代理，或主动配置 Claude Code 直连。该错误与 Bridge 的 `17863` 服务是否正常是两个独立检查项。
