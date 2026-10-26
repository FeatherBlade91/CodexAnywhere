# Linux validation — 2026-10-26

Environment: local WSL2 Ubuntu 24.04.4, Linux x64, WSLg, Node.js 24.16.0,
Electron 45.0.0. Source checkout: `/home/featherblade/codex-anywhere-linux`.

## Results

| Check | Result |
| --- | --- |
| Linux backend regression | 90 passed (Python fixture dependencies installed in a private venv) |
| Windows backend regression | 90 passed |
| Linux source desktop suite | 4 passed |
| Linux unpacked package integrity and desktop suite | ASAR/source/license checks passed; 4 desktop tests passed |
| Installed DEB integrity and desktop suite | Installed with apt; ASAR/source/license checks passed; 4 desktop tests passed |
| AppImage executable | Desktop lifecycle and native credential restart tests: 2 passed |
| Layout | Normal and 800px layouts inspected; responsive overflow assertions passed |
| Whitespace | `git diff --check` passed |

Desktop tests cover local service startup/shutdown, API authentication boundaries,
settings, model mapping, key rotation, clipboard, close/reopen behavior, language
selection and actual relaunch. Linux packaged checks additionally toggle XDG
autostart in an isolated configuration directory. The native secret-store test
uses a disposable GNOME Keyring and verifies encrypted disk storage and recovery
after application restart. Playwright's insecure storage defaults are removed
by a test-only preload before Electron initializes; the application rejects
the `basic_text` backend.

The Python fixture originally skipped because the SDK was absent. Its independent
venv now contains `openai` and `httpx`; the complete suite passes without skips.

## Artifacts

- `dist/Codex-Anywhere-1.0.4-linux-amd64.deb`
  - SHA256: `c6c742ca70dd70b6563856cda91d6857069ba8cf7c8f14a7c4b96202efda7562`
- `dist/Codex-Anywhere-1.0.4-linux-x86_64.AppImage`
  - SHA256: `d8f6449853828f9d04599e531cf15bc5797eb77646b4358dd388ac74572570c3`
- `dist/SHA256SUMS-linux.txt`

The same artifacts are retained in the WSL checkout. DEB is installed at
`/opt/Codex-Anywhere`, with `/usr/bin/codex-anywhere` and a desktop launcher.

The first Electron download was interrupted by a WSL restart. The Linux runtime
was subsequently downloaded from the npm mirror and verified against the SHA256
in Electron's installed package (`22f6a10bd3f7fef987ddbb379d3375ce664ad0c98a9a50f80c89f1718a0c3e3a`).
Packaging reused that verified distribution with
`npm run dist:linux -- --config.electronDist=node_modules/electron/dist`.

## Scope

No real ChatGPT login, paid model requests or personal client configuration was
used. Live OAuth/account access remains for user verification. KWallet, other
Linux distributions, ARM64 and a full desktop panel were not tested. WSLg has
no system tray panel; reopening the application restores its hidden window.
macOS was not rerun on this Windows host. No GitHub release was published.

See [Linux instructions](../LINUX.md) for session/keyring setup and repeatable
test commands. CI templates remain in `scripts/ci/` as in the existing project.
