<div align="center">

# Codex-Anywhere

[简体中文](../README.md) · [繁體中文](README.zh-TW.md) · [English](README.en.md)

**通过本地 API Key 使用 ChatGPT 订阅额度**

[下载 Windows 桌面版](https://github.com/FeatherBlade91/CodexAnywhere/releases/latest) · [使用指南](USER-GUIDE.txt) · [参与开发](CONTRIBUTING.md)

![Windows x64](https://img.shields.io/badge/Windows-x64-36665D?style=flat-square)
![Electron desktop](https://img.shields.io/badge/Electron-desktop-506479?style=flat-square)
[![非商业许可](https://img.shields.io/badge/license-noncommercial-737B82?style=flat-square)](../LICENSE)

</div>

![Codex-Anywhere 桌面界面，包含 ChatGPT 登录、OpenAI 应用和 Claude Code 连接设置](assets/desktop.png)

登录，启动本地服务，即可利用 API Key 格式调用 ChatGPT 订阅额度。

完全官方，无违规风险。没有 Codex 附加的多余上下文，与纯净的按量付费 Key 效果一致，却直接使用 ChatGPT 订阅额度。

软件使用 OpenAI 的 Sign in with ChatGPT Devkit，通过 [官方文档介绍的授权方式](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)，让符合条件的账号使用自己的 ChatGPT 套餐额度。不反代 ChatGPT 网页，不复用浏览器 Cookie，只建立本地服务转换客户端请求。



## 开始使用

1. 从[最新 Release](https://github.com/FeatherBlade91/CodexAnywhere/releases/latest) 下载 Windows x64 安装包，安装并打开 **Codex-Anywhere**。安装包包含运行环境，无须另装 Node.js。
2. 在浏览器中完成 ChatGPT 登录，再刷新可用模型。
3. 启动本地服务。将地址和本地 API Key 复制到应用，或使用界面中的 Claude Code 接入功能。

Claude Code 和 CC Switch 是可选客户端，需要单独安装。使用 OpenAI 兼容应用时不需要它们。

点击窗口叉子会隐藏到系统托盘，本地服务继续运行。点击托盘图标或重新打开软件可恢复窗口；彻底退出请右键托盘图标，选择“退出”。

## 一个窗口管理连接

| 想做什么 | 在 Codex-Anywhere 中操作 |
| --- | --- |
| 连接 OpenAI 兼容应用 | 复制 Base URL 和 API Key；通过 `/v1/models` 获取模型 ID。 |
| 连接 Claude Code | 应用直连配置，或添加 CC Switch 供应商。 |
| 选择模型 | 刷新账号模型列表，从可用模型中选择。 |
| 管理服务 | 启动、停止、查看状态。 |
| 调整运行方式 | 设置代理或登录电脑时启动。 |
| 撤销客户端配置 | 通过接入设置恢复备份。 |

修改客户端配置需要主动操作，并会备份原设置；恢复时尽量保留无关修改。默认模型映射为 Haiku → `gpt-6-luna`、Sonnet → `gpt-6-sol`、Opus → `gpt-6.1-sol`、Fable → `gpt-6-astra`，可在设置中修改。更改连接或映射后重启 Claude Code。使用 CC Switch 时，在 CC Switch 中选择已配置的供应商。

桌面界面支持简体中文、繁體中文和 English。首次打开时按系统首选语言选择（其他语言使用英语）；可在“设置 → 界面语言”中切换或选择“跟随系统”。确认重启后保存并自动重新打开软件，取消则保留原设置。重启会停止本地服务并中断正在进行的请求。

### 接入 OpenAI 兼容应用

```text
Base URL   http://127.0.0.1:17863/v1
API Key    从桌面应用复制
Model      使用 GET /v1/models 返回的模型 ID
```

本地 API Key 用于应用连接桥接服务，与 ChatGPT 登录授权分开，请勿分享。

| 接口 | 用途 |
| --- | --- |
| `GET /v1/models` | 获取可用模型。 |
| `POST /v1/chat/completions` | OpenAI Chat Completions，支持流式输出及工具调用。 |
| `POST /v1/responses` | OpenAI Responses。 |
| `POST /v1/messages` | Claude Code 使用的 Anthropic Messages。 |

这些接口共用一个本地服务和一套凭据。默认只监听本机地址；旧版网关的 `17864` 不再是默认端口。

## 升级与排查

应用数据存储在 `%LOCALAPPDATA%\CodexAnywhere`。

Claude Code 出现 `ECONNREFUSED` 时，先看报错中的地址。CC Switch 可能让 Claude Code 连接 `127.0.0.1:15721`；即使 Bridge 的 `17863` 服务正常，这个代理也可能没有启动。打开 CC Switch 并启动代理，或在桌面应用中主动选择“配置 Claude Code”使用直连。

在“设置”中先保存代理，再点击“检测连接”。检测会检查已保存的代理、授权/API 连通性以及 Claude Code 当前使用的本地地址，不发送模型提示词，也不显示凭据。

Python 示例已显式绕过环境代理，避免本机 `127.0.0.1` 请求被 `HTTP_PROXY` / `ALL_PROXY` 转发而出现 502。软件连接 ChatGPT 的上游代理仍需在设置中配置；其他客户端可设置 `NO_PROXY=127.0.0.1,localhost`。详见[代理与 502 排查](OPENAI-EXAMPLES.md#代理与-502-排查)。聊天示例会消耗额度，仅检查网络请使用连接测试。

## 使用范围

- **账号权限：** 模型、额度和服务端限制取决于你的订阅；软件不会增加权限。可用模型可能变化。
- **推理强度：** 显式指定的受支持等级原样传给上游；不支持的等级返回错误。同名等级不代表各模型使用相同算力。
- **上下文：** 客户端的 `[1M]` 设置不会增加服务端限制。Token 统计和客户端费用显示属于估算。
- **平台：** 已发布版本面向 Windows x64；本分支新增 macOS 测试版构建，见下文。
- **隐私：** 授权保存在本机。Issue 中不要上传凭据、API Key 或私人提示词；安装包不包含个人配置。
- **验证：** [VALIDATION.md](VALIDATION.md) 和 [reports/](reports/) 保留历史协议测试记录，不代表所有桌面操作或当前账号模型都已完成在线验证。

> [!IMPORTANT]
> 仅供个人、非商业实验。内置 OpenAI Devkit 使用非商业许可。本项目并非 OpenAI、Anthropic 或 CC Switch 官方产品。

## 开发

环境：Windows 或 macOS、Node.js 24。

`src/core/` 存放接口与接入逻辑，`src/desktop/` 存放 Electron 桌面代码；构建辅助脚本位于 `scripts/`，测试位于 `tests/`，指南和历史报告位于 `docs/`。

```powershell
npm ci
npm start
```

```powershell
npm test                 # 后端离线回归
npm run test:desktop     # 桌面界面测试
npm run dist             # 构建 Windows 桌面安装包
```

安装包名称为 `Codex-Anywhere-Setup-1.0.5-x64.exe`。本地构建不会自动发布 Release。在线测试需要自己的授权账号并消耗订阅额度，分享结果前请脱敏。

开发约定和测试隔离见 [CONTRIBUTING.md](CONTRIBUTING.md)。请保留[第三方声明](THIRD-PARTY-NOTICES.md)、[项目许可](../LICENSE)及 [OpenAI Devkit 许可](../vendor/siwc/LICENSE)。


## macOS 测试版

本分支支持 macOS 桌面构建，与 Windows 共用界面和业务逻辑。在 Mac 上使用 Node.js 24：

```sh
npm ci
npm test
npm run test:desktop
npm run dist:mac:preview -- --arm64  # Apple Silicon；Intel 使用 --x64
node tests/packaged.mjs
```

打开生成的 DMG，将应用拖入 Applications 后启动。数据保存在 `~/Library/Application Support/CodexAnywhere`；登录凭据由系统钥匙串保护。关闭窗口后服务继续在菜单栏运行，点击 Dock 图标可重新打开，Cmd+Q 完全退出。

Mac 仍为内测版，下载 [Mac 内测 Release](https://github.com/FeatherBlade91/CodexAnywhere/releases/tag/v1.0.5)。分发签名、公证及测试范围见 [macOS 开发说明](MACOS.md)。
### OpenAI examples

The home page includes a live model ID, a minimal Python chat example, and reasoning-effort mappings. See [OpenAI / DeepSeek Harness examples](OPENAI-EXAMPLES.md).

DeepSeek Harness 请使用桌面服务显示的实际端口；profile 版的桌面与 headless 配置分别保存，CLI 与桌面凭据格式也可能不同。上述指南包含配置方法和 `node scripts/live/harness.mjs` 实机工具调用检查。

## Linux 桌面版

Linux 与 Windows、macOS 共用完整界面和业务逻辑，提供 x64 的 `.deb` 和 `.AppImage` 安装包。在 Ubuntu / WSLg 中使用 Node.js 24 构建：

```sh
npm ci
npm test
npm run dist:linux
bash scripts/test-linux.sh
bash scripts/test-linux.sh node tests/packaged.mjs
```

Ubuntu 可安装 `dist/Codex-Anywhere-1.0.5-linux-amd64.deb`；AppImage 需赋予执行权限。登录需要已解锁的 GNOME Keyring 或 KWallet，数据默认存放在 `~/.local/share/CodexAnywhere`。WSL 需要 WSLg 和 D-Bus/密钥环会话。安装依赖、启动与测试范围见 [Linux 使用说明](LINUX.md)。
