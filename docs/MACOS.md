# macOS development and distribution

The desktop app shares its renderer, protocol adapters, local server, model cache,
key rotation and integration/restore logic with Windows. Native behavior is kept
in `src/platform/`, with Electron-only capabilities composed in `src/desktop/`.

## Build

Use Node.js 24 on a Mac, then run:

```sh
npm ci
npm test
npm run test:desktop
npm run dist:mac:preview -- --arm64
node tests/packaged.mjs
```

For Intel, use `--x64`. The default build targets the host architecture. The DMG
is `dist/Codex-Anywhere-1.0.5-mac-beta-arm64.dmg` (or `x64`). To check a custom app
location, set `BRIDGE_PACKAGE_DIR` to the `.app` directory. The packaging check
verifies ASAR integrity and sources, then exercises the packaged GUI and Keychain.
Build each architecture on a matching runner for native validation.

## Native behavior

- State: `~/Library/Application Support/CodexAnywhere`; isolated test runs can
  override `CHATGPT_BRIDGE_STATE_DIR`. Windows paths and stored DPAPI credentials
  retain their existing behavior.
- Credentials: the worker requests encryption over a private process channel.
  Main uses Electron's async `safeStorage` API backed by macOS Keychain. No
  encryption endpoint is exposed to the renderer. Missing or locked secure
  storage fails closed, without writing plaintext credentials. Windows and Mac
  credential files are not portable; sign in separately on each machine.
- Tray: a monochrome template image supports light/dark menu bars. Window close
  hides the app; Dock activation reopens it. The native app menu supports Cmd+Q
  and standard editing shortcuts. Login startup uses Electron's native API.
- Proxy: on first configuration, environment settings win; otherwise `scutil`
  supplies enabled HTTP/HTTPS proxies. PAC and SOCKS-only settings are not
  converted. Users can configure an explicit HTTP/HTTPS proxy in Settings.
- CC Switch: reads `Library/Application Support/com.ccswitch.desktop/app_paths.json`
  for the custom data-directory override, otherwise `~/.cc-switch`. Restore checks
  for the running executable before modifying its database. Tests use temporary
  client directories and never modify personal Claude/CC Switch configuration.

## Signing and release

The `dist:mac:preview` command uses an ad-hoc signature and does not require publishing credentials. Use `dist:mac` with a Developer ID identity for public distribution. A build without
a Developer ID identity is a preview, not a notarized public distribution.
For distribution, supply the electron-builder signing configuration (`CSC_LINK`
and `CSC_KEY_PASSWORD`) and Apple notarization credentials using environment or
CI secrets. Never put them in the repository. Hardened runtime and JIT
entitlements are configured for the app and its helpers.

Use a consistent signing identity across updates to preserve Keychain trust.
Run desktop tests in a logged-in graphical session with an unlocked login
Keychain; SSH alone does not guarantee either. A Keychain access prompt may
require interaction on the Mac. The native credential test uses synthetic data;
it does not sign in to ChatGPT or consume subscription quota.

References: [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage),
[electron-builder macOS configuration](https://www.electron.build/mac/).

### SSH test sessions

On macOS, an SSH session can have different Keychain access from the logged-in
desktop. Unlock the login Keychain interactively with `security unlock-keychain`
and run `node tests/packaged.mjs` in that same SSH session. Opening another SSH
connection can require unlocking again. Do not save the Keychain password in
scripts, logs, CI configuration, or the repository. Availability checks alone
are insufficient: the native test verifies real encryption and decryption.

Unlocking a Keychain does not grant a newly signed build access to an existing
item. An ad-hoc rebuild may require the user to approve access to
`Codex-Anywhere Safe Storage` on the Mac desktop. Error `-25308`
(`errSecInteractionNotAllowed`) from an SSH test is not a passing credential
check. Run the native test in an unlocked graphical session and complete the
system authorization. The test removes Playwright's mock-Keychain switches
before invoking secure storage; keep that check enabled for release validation.
