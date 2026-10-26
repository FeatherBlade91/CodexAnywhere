# Linux desktop and WSL

Linux uses the same renderer, OAuth flow, model selection, OpenAI/Anthropic
routes, streaming/tool adapters, proxy settings, key rotation, Claude Code and
CC Switch integration/restore as the Windows and macOS applications.

## Build and install

Use Node.js 24 on Linux. On Ubuntu 24.04:

```sh
sudo apt-get update
sudo apt-get install -y libgtk-3-0t64 libnss3 libasound2t64 libgbm1 \
  libsecret-1-0 gnome-keyring dbus-x11 libfuse2t64
npm ci
npm run dist:linux
sudo apt install ./dist/Codex-Anywhere-1.0.4-linux-amd64.deb
codex-anywhere
```

Alternatively, `chmod +x dist/*.AppImage` and run the AppImage. Keep it in a
stable location before enabling login startup. In WSL without working FUSE,
run it with `--appimage-extract-and-run`. The packages contain Electron/Node;
end users do not need to install Node.js. Builds never publish automatically.

## Linux behavior

- Data: `$XDG_DATA_HOME/CodexAnywhere`, default `~/.local/share/CodexAnywhere`.
- Credentials: Electron async safeStorage with GNOME Keyring/KWallet over the
  private main/worker channel. The application rejects `basic_text` fallback.
  A missing or locked secret store does not permit plaintext credential writes.
  Sign in separately on each OS; Windows DPAPI and macOS credentials cannot be
  copied into Linux. See [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).
- Login startup: `$XDG_CONFIG_HOME/autostart/codex-anywhere.desktop`, default
  `~/.config/autostart/codex-anywhere.desktop`. This starts the app on graphical
  desktop login, not when a headless WSL distribution boots.
- Close hides the window and keeps the service running. Tray display depends on
  desktop support for StatusNotifier/AppIndicator. WSLg alone has no full panel;
  launch the app again to restore its window. Stop the service before closing
  when you do not want it to continue running.
- Proxy discovery: upper/lowercase HTTP(S) environment variables, then GNOME
  manual proxy settings. Other desktops can use the explicit proxy field.
  PAC and SOCKS proxies are not converted.
- CC Switch: `$XDG_DATA_HOME/com.ccswitch.desktop/app_paths.json`, otherwise
  the normal `~/.cc-switch` data directory. Claude Code uses Linux home paths.

## WSLg session

Use Ubuntu with WSLg (`DISPLAY` must be set). A normal Linux desktop unlocks its
keyring at login. WSL may need a D-Bus session and an unlocked keyring:

```sh
dbus-run-session -- bash
export XDG_CURRENT_DESKTOP=GNOME
read -rsp 'Keyring password: ' keyring_password; echo
printf '%s' "$keyring_password" | gnome-keyring-daemon --unlock --components=secrets
unset keyring_password
codex-anywhere
```

Use your own keyring password; do not put it in scripts or shell history.
Do not disable the Chromium sandbox for normal application use.

## Verification

```sh
npm test
bash scripts/test-linux.sh
bash scripts/test-linux.sh node tests/packaged.mjs
```

The Linux runner creates disposable XDG directories and a private D-Bus/keyring
session using synthetic credentials. It never unlocks your personal keyring.
On headless CI, prefix the runner with `xvfb-run -a` (install `xvfb`).
Desktop checks cover service lifecycle, settings, multilingual UI and relaunch,
credential encryption on disk and decryption after restart. Packaged checks
also verify ASAR hashes, source inclusion and licenses.

These tests do not perform real ChatGPT login or consume subscription quota.
Live account access and browser OAuth require a separate user login.
