# ChatGPT API Gateway 1.0.0

独立的 Windows 中间层，把 ChatGPT 订阅调用提供为 OpenAI 兼容的 URL + API Key。安装后打开管理窗口，复制连接配置，填入支持自定义 OpenAI 接口的软件。

- 普通 Intel / AMD 电脑下载 `ChatGPT-API-Gateway-Setup-1.0.0-x64.exe`。
- Windows 11 ARM 电脑下载 `ChatGPT-API-Gateway-Setup-1.0.0-arm64.exe`。
- 安装包内置运行时，无需另装 Node.js、Claude Code 或 CC Switch。
- API Key 首次生成后保存在本地；首次有效请求会打开 ChatGPT 登录，也可在窗口中提前登录。
- 支持 Chat Completions、Responses、模型列表、流式输出和函数工具调用。
- 可选开机启动。关闭窗口后服务继续运行，点击“停止服务”可退出；升级和卸载会停止后台服务，保留用户密钥和授权。

默认 Base URL 为 `http://127.0.0.1:17864/v1`，客户端须运行于同一电脑。实际模型和额度以账户授权为准。配置与限制见仓库的 `GATEWAY.md`。

Windows x64 已通过隔离安装、中文路径、窗口启动、鉴权、升级和卸载测试；协议测试使用模拟上游。ARM64 已构建并校验所带运行时，尚未在 ARM 设备上运行。新中间层的真实账户授权和模型调用尚未实测。

安装包未做商业代码签名。每个安装包附带 `.sha256` 校验文件。沿用仓库和 SIWC 的非商业许可要求。
