# Third-party notices

This is an independent personal project, not an official OpenAI or Anthropic application.

The Sign-in with ChatGPT Devkit is copyright 2026 OpenAI, distributed under its included **NONCOMMERCIAL LICENSE**, at `vendor/siwc/LICENSE`. Upstream: https://github.com/openai/sign-in-with-chatgpt-devkit commit `0a36fefeb913055c8c7a1a29b63d82b96b2e841a`.

Modifications dated 2026-10-23: TypeScript is stripped for runtime distribution; the index module exposes the existing authenticated callback as `withAccessToken`. These modifications are distributed under the same devkit license. Commercial use requires the permissions described there.

Node.js runtime licenses, including embedded dependencies, are included as NODE-LICENSE.txt and NODE22-LICENSE.txt. Runtime versions and official source hashes are included in runtime-manifest.json.

npm dependencies and their transitive dependencies retain their original license files under node_modules: openai (Apache-2.0), jose (MIT), undici (MIT), proper-lockfile (MIT), graceful-fs (ISC), retry (MIT), signal-exit (ISC). See each package's license for authoritative terms.

Installer built with Inno Setup: https://jrsoftware.org/isinfo.php. Inno Setup is not bundled as a compiler dependency of the installed application.
