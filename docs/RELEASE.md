## macOS preview (unreleased)

- Shared Windows/macOS desktop implementation with platform-specific paths, system proxy discovery and CC Switch process checks.
- macOS Keychain credential encryption through a private main/utility-process channel; Windows DPAPI credentials remain compatible.
- Native menu-bar icon, application menu, Dock reopening and DMG build targets for arm64/x64.
- Native Keychain round-trip/restart checks and cross-platform packaged-app validation.
- Mac CI jobs upload build artifacts; public Mac release publication remains manual until signing and notarization are configured.

# Codex-Anywhere 1.0.4

本次更新重点优化 AI 调用的本地前置开销：

- 未变化的加密凭据复用内存解密结果，每次仍在跨进程锁内验证磁盘文件。避免每轮请求反复启动 PowerShell，同时保留凭据轮换、退出登录和外部修改检测。
- OpenAI 兼容推理请求取消重复会话读取；同进程凭据操作使用可取消队列，减少并发调用的锁竞争。
- 模型列表过期时使用已有列表并后台刷新，减少 Claude Code 工具调用轮次中的等待；主动刷新仍等待最新结果。
- 不改变模型、推理强度、上下文、工具定义或回答内容处理。补充凭据并发、轮换、取消、损坏文件、模型缓存及提前流式输出测试。
- Windows 隔离测试中，凭据冷读取平均 1,288 ms，缓存有效时平均 2.82 ms；这是本地组件测量，并非模型生成或端到端速度承诺。复现方法见 `docs/PERFORMANCE.md`。

一个独立的 Electron 桌面应用，统一原来的 Plan Bridge 和 API Gateway。

- 登录一次，共享模型、密钥与服务开关。
- 同一端口提供 OpenAI Chat Completions、Responses 和 Anthropic Messages 接口。
- 复制地址与密钥即可接入其他应用；也可配置 Claude Code 或 CC Switch。
- 支持模型选择、代理、开机启动和配置恢复。
- 界面支持简体中文、繁體中文和 English，首次启动自动匹配系统首选语言（其他语言使用英语）。可在设置中切换或选择“跟随系统”；确认后保存并自动重启，取消则保留原设置。重启会停止本地服务并中断正在进行的请求。
- 本地端口被占用时自动选择并保存空闲端口，同步更新由本应用管理的客户端地址。手动接入的应用请复制界面中的最新地址；已运行的客户端需重启以加载配置。
- 首页新增“一键测试”：检查本地服务、已保存代理、登录/API 网络和 Claude Code 本地路由。仅使用非生成 GET 和 TCP 检查，不发送聊天内容或上游凭据，不消耗模型生成额度；网络可达不代表账号权限或模型可用。
- 点击窗口叉子后隐藏到系统托盘，本地服务继续运行。点击托盘图标或重新打开软件可恢复窗口；右键托盘选择“退出”才会停止服务并关闭应用。
- 主页改为紧凑的模块化连接控制台；应用配置、Python 示例、思考强度和代理排查移到独立的可折叠接入指南。
- 修复 Python 示例继承环境代理导致本地连接 502 的隐患：显式直连、禁用重定向和自动重试。聊天示例会使用额度，一键测试不会调用模型生成。
- 代理或服务状态变化时清除旧检测结果，避免误报。
- 安装包内置运行环境。

下载 `Codex-Anywhere-Setup-1.0.4-x64.exe`，适用于 Windows 10/11 x64。账户权限和额度由上游决定。

安装包尚未代码签名，可使用附带的 SHA-256 校验文件核对。卸载保留本地授权与配置；若需撤销 Claude Code 接入，请先在应用中点击“恢复原配置”。

应用数据存储在 `%LOCALAPPDATA%\CodexAnywhere`。

如果 Claude Code 报 `ECONNREFUSED 127.0.0.1:15721`，请启动 CC Switch 及其代理，或主动配置 Claude Code 直连。该错误与 Bridge 的 `17863` 服务是否正常是两个独立检查项。

