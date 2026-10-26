# Contributing

[README](../README.md) · [简体中文](#简体中文) · [繁體中文](#繁體中文)

## Before you start

Check existing issues for the same problem. For larger changes, describe the intended behavior and affected components before implementation. Issues and pull requests may use English, Simplified Chinese, or Traditional Chinese.

Keep changes focused. Preserve third-party notices and the project's noncommercial scope. Never commit credentials, authorization headers, local API keys, personal prompts, or machine-specific configuration.

## Development

Use Windows, macOS or Linux with Node.js 24:

```powershell
npm ci
npm start
```

`npm start` opens the Electron desktop app. The desktop service owns both the OpenAI-compatible and Anthropic-compatible routes. Keep configuration and account management in the desktop app; do not add separate end-user launchers or installers.

```powershell
npm test
npm run test:desktop
npm run dist
node tests/packaged.mjs
```

Run backend regression tests for protocol and integration changes, and desktop tests for UI or IPC changes. Inspect changed screens at the normal and minimum window sizes. `npm run dist` creates the Windows desktop installer; it does not publish it. `node tests/packaged.mjs` verifies archive integrity, encrypted credential storage and the packaged window. Do not edit application files while packaging: ASAR records file sizes before reading their contents. Desktop installers are the only supported release artifacts.

Generated JavaScript under `vendor/siwc/` is ignored. Edit TypeScript sources and rebuild. Do not commit dependency folders, installers, local state, or raw test output.

GitHub Actions templates are kept in `scripts/ci/`. To enable them, copy the YAML files into `.github/workflows/` using credentials with workflow permission.

## Test isolation

Repository layout: `src/core/` contains the service and integrations, `src/desktop/` contains Electron code, `scripts/` holds build helpers, `tests/` holds tests, and `docs/` holds guides, assets, and curated historical reports. The vendored Devkit remains in `vendor/siwc/`.

Offline tests must not use a personal account or modify real client configuration. Use `CHATGPT_BRIDGE_STATE_DIR`, `CHATGPT_BRIDGE_HOME`, and `CHATGPT_BRIDGE_CC_DIR` with temporary directories, following existing fixtures. Check backup and restore behavior when changing integration code.

Live tests require your own authorized account and consume subscription quota. Run them only when relevant, and sanitize reports before sharing them. Historical results are recorded in [VALIDATION.md](VALIDATION.md); packaging checks, offline tests, and live device tests support different conclusions.

## Pull requests

Explain the problem, resulting behavior, and checks run. Include reproduction steps for bugs and screenshots for visual changes. State any relevant checks you could not run.

Update all three README versions when setup or behavior changes. Keep commands, API routes, and configuration keys consistent across translations. Avoid claims about current account access based only on a historical model catalog.

## 简体中文

欢迎使用英语、简体中文或繁体中文提交 Issue 和 Pull Request。请先检查已有问题，较大改动先说明目标和影响范围。

环境为 Windows、Node.js 24 和 PowerShell。`npm start` 启动 Electron 桌面版，`npm test` 执行后端回归，`npm run test:desktop` 检查桌面界面，`npm run dist` 构建安装包。只维护一个桌面产品和发布入口。

使用临时目录隔离账号和客户端配置；在线测试会消耗订阅额度。不要提交凭据、个人配置、依赖目录、安装包或原始测试输出。保留许可和第三方声明。功能变化时同步三份 README，明确区分离线测试、打包检查和实机在线验证。

## 繁體中文

歡迎使用英語、簡體中文或繁體中文提交 Issue 和 Pull Request。請先確認已有問題，較大的修改先說明目標和影響範圍。

環境為 Windows、Node.js 24 和 PowerShell。`npm start` 啟動 Electron 桌面版，`npm test` 執行後端回歸，`npm run test:desktop` 檢查桌面介面，`npm run dist` 建置安裝程式。僅維護一個桌面產品和發布入口。

使用暫存目錄隔離帳號和用戶端設定；線上測試會消耗訂閱額度。不要提交憑證、個人設定、相依套件目錄、安裝程式或原始測試輸出。保留授權和第三方聲明。功能變更時同步三份 README，明確區分離線測試、封裝檢查和實機線上驗證。


## Platform boundaries

`src/platform/` owns native paths, system proxy discovery, process inspection and credential providers. Core services must not import Electron. `src/desktop/worker.mjs` injects the macOS credential provider before importing the service; only the trusted utility process can request Keychain operations from the main process. The renderer must never receive a general encryption/decryption IPC endpoint. Windows retains its existing DPAPI envelope ID.

Mac builds: `npm run dist:mac:preview -- --arm64` or `--x64`, then `node tests/packaged.mjs`. Run desktop tests in a logged-in graphical session with an unlocked login Keychain. The macOS credential test uses synthetic credentials and a temporary directory. See [MACOS.md](MACOS.md).

Linux builds and isolated native secret-store tests: see [LINUX.md](LINUX.md). The shared native credential test is `tests/native-credentials.e2e.mjs`.
