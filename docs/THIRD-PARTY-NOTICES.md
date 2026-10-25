# Third-party notices

Codex-Anywhere is an independent personal project. It is not an official OpenAI or Anthropic application.

## OpenAI Sign in with ChatGPT Devkit

Copyright 2026 OpenAI. The Devkit is distributed under the included NONCOMMERCIAL LICENSE at `vendor/siwc/LICENSE`.

Upstream: https://github.com/openai/sign-in-with-chatgpt-devkit

Commit: `0a36fefeb913055c8c7a1a29b63d82b96b2e841a`.

Modifications dated 2026-10-23: TypeScript is stripped for runtime distribution, and the index module exposes the existing authenticated callback as `withAccessToken`. These modifications follow the same Devkit license. Commercial use requires the permissions described in that license.

## npm dependencies

Modifications dated 2026-10-25: credential storage serializes in-process lock contenders and caches one decrypted state keyed by the exact on-disk ciphertext. Every access still validates the provider and reads the file under the interprocess lock; callers receive independent copies. The cache is invalidated on writes or changed/invalid storage. These modifications follow the same Devkit license.

Dependencies retain their original license files under `node_modules`. The included packages use these licenses:

| Package | License |
| --- | --- |
| openai | Apache-2.0 |
| jose | MIT |
| undici | MIT |
| proper-lockfile | MIT |
| graceful-fs | ISC |
| retry | MIT |
| signal-exit | ISC |

Each package's license file contains the authoritative terms.

## Installer tooling

The desktop installer is built with Electron Builder and NSIS. These build tools are not bundled with the installed application.

## Desktop runtime

The desktop application uses Electron (MIT); its packaged distribution includes Chromium and Node.js notices. Electron and Chromium license files are shipped alongside the executable. Application dependencies retain their license files in the packaged resources. Electron Builder and Playwright are development tools and are not included as application dependencies.
