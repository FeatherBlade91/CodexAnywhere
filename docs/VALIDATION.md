# Validation record

[Back to README](../README.md)

## v1.0.4 — 2026-10-25

All 78 backend tests passed, including credential caching/rotation/cancellation, model refresh/persistence, local API key rotation, and uninstall preparation. All three packaged Electron tests passed. Packaged source equality (including new icons, the credential store and uninstall helper), ASAR integrity, and Windows DPAPI checks passed.

The final installer successfully upgraded this machine from 1.0.3 to 1.0.4. Hashes confirmed that existing `bridge.json` and encrypted credentials were preserved, and the installed ASAR matched the tested package. The application was reopened. Uninstall preparation was tested with isolated fixtures, including failure preservation; a destructive full uninstall of the personal installation was not performed. The NSIS hook and installer compiled successfully. No live model-generation requests were made for this release.

Credential acquisition measurements and reproduction steps are in [PERFORMANCE.md](PERFORMANCE.md). They measure local overhead, not upstream generation speed.

Artifact: `Codex-Anywhere-Setup-1.0.4-x64.exe` (124,888,768 bytes). SHA-256: `ae82b26042398ac5685da38fa5a0b553ea025d4c5281e6597ba927fcb0ea8a6e`.

## Desktop consolidation — 2026-10-24

The unified Electron desktop replaces the separate Plan Bridge and API Gateway release formats. During consolidation, all 43 backend regression tests passed. These include shared protocol/service behavior and desktop service controls; this count does not imply 43 live subscription requests.

A local connection failure was traced to Claude Code targeting the CC Switch proxy at `127.0.0.1:15721` while that route was unavailable, rather than a failure of the Bridge service at `127.0.0.1:17863`. The local route was corrected. The desktop connection check now distinguishes the saved proxy, authorization/API connectivity, and Claude Code's configured local route without sending a model prompt or exposing credentials.

The real Electron source-app end-to-end test passed, including isolated IPC access, authentication on the three API routes, service start and exit, settings validation, configuration dialogs, and compact-width layout. SQLite integration now uses the Node runtime. The README screenshot was captured from the real Electron window with isolated test data before account sign-in; it is not evidence of a live model response.

The packaged application also passed its Electron end-to-end test. SHA-256 archive integrity checks and Windows DPAPI credential encryption checks passed. The final NSIS installer was installed into an isolated temporary directory; the installed application passed the same archive, encryption and Electron checks. Silent uninstall exited successfully and removed the application executable. Tests used Windows 11 x64. New live subscription/model requests were not part of these desktop packaging checks.

Final artifact: `ChatGPT-Bridge-Setup-2.0.0-x64.exe` (123,404,086 bytes). SHA-256: `0c1e8cdad16d2fd24e51cd6f244ecdb10d5abf19d3f70b93d2da5707be7d1fd8`.

The older installer checksum and architecture results below belong to the previous release and do not validate the new desktop installer.

## Historical validation — 2026-10-23

Validation date: 2026-10-23. The host was Windows 11 x64. These results cover only the tests listed here. Runs used isolated state directories or explicit test requests; account credentials, user prompts, and local configuration were not committed.

## Offline regression

All 24 tests in `npm test` passed under x64 Node and x86 Node running in Windows 11's WOW64 environment.

Coverage includes:

- All five Claude effort levels, tool history, namespaces, forced tool choice, upstream error statuses and codes, SSE chunks, and UTF-8.
- ToolSearch `tool_reference` content and deferred tool definitions.
- Reconstruction of text, tool arguments, and encrypted reasoning from output events when `response.completed.output` is empty, without duplicate output and with usage and stop reason preserved.
- CC Switch detection, provider registration, configuration backup and restoration, and preservation of other providers, aggregate members, and later user changes during uninstall.
- Service lifecycle on a temporary port: health checks, rejection of shutdown requests with missing or incorrect credentials, HTTP 202 and natural exit with valid credentials, and graceful shutdown of a test process through `stop.ps1`.

See the `test` script in `package.json`. The x86 results cover WOW64; they do not establish that the application was tested on a 32-bit Windows installation.

## Live requests and model compatibility

The local `test-results/e2e.json` recorded 18 successful Claude Code CLI tests:

- Text and Read tool round trips for seven account models, totaling 14 tests: GPT-6.1-Sol, GPT-6-Astra, GPT-6-Sol, GPT-6-Luna, GPT-5.6-Sol, GPT-5.6-Terra, and GPT-5.6-Luna.
- Four further GPT-6.1-Sol tests for medium, high, xhigh, and max. Together with the earlier low test, all five levels had upstream effort confirmation.

These 18 tests ran during the initial multi-model implementation. Later fixes had the targeted checks below; the full set was not rerun after every change.

| Local report | Result |
| --- | --- |
| `test-results/model-compat.json` | Checked supported effort levels in the live account catalog. Both `[1m]` and `[1M]` mapped to the correct upstream model ID. Unsupported effort and unknown models were rejected. |
| `test-results/tool-search.json` | A real CLI call used ToolSearch, returned `tool_reference`, then called the discovered deferred MCP tool and received the validation marker with `gpt-6.1-sol[1M]`. |
| `test-results/stack-live.json` | A request through local CC Switch aggregation routed `ccs-claude-openai--gpt-6-luna[1M]` to `gpt-6-luna`, returned `STACK_LUNA_OK`, and confirmed low effort upstream. The provider default did not override the requested model. |
| `test-results/response-upstream-live.json` | Text and tool calls were recovered when the real upstream terminal event had empty `output`. Forced tool choice passed. Error handling preserved HTTP 400 and `unknown_parameter`. |

These local reports are in an ignored directory. The repository includes the test code. Matching effort names across models establish that the requested level was passed through, not equal compute or latency.

The service in the final installation directory also passed non-streaming text and forced tool-call tests, CC Switch Luna aggregate routing, a Sol `[1M]` max-effort / Read round trip, and three complete ToolSearch → tool_reference → deferred MCP tool cycles. Sanitized reports are in [reports/](reports/).

`node tests/model-compat.test.mjs` requires a signed-in account and runs separately from offline `npm test`.

## Context limits

`[1M]` selects a Claude Code client window; it does not expand upstream capacity. The live account catalog reported:

- `context_window` of 500000 for GPT-6.1-Sol and 272000 for the other six models.
- `max_context_window` of 872000 for all seven.
- `supports_experimental_context` set to true for GPT-6-Astra, GPT-6-Sol, GPT-6-Luna, and GPT-5.6-Sol, and false for the remaining three.

No million-token request was sent. Acceptance beyond the default windows was not tested. The client marker does not establish upstream support for one million tokens.

## Installer and platform scope

The final release EXE passed eight isolated installation and uninstallation tests. They covered a path containing Chinese characters and spaces, blocking installation when CC Switch was missing, direct-mode overwrite consent, bundled runtimes, configuration restoration, and removal of only bridge-owned providers.

The EXE was also installed in the normal local installation directory. A health check confirmed that the service was running from that directory.

SHA-256: `f7583fd79c82f59f9732d90f971b28c0c785ea65889761094f35c531a003bf11`.

Windows 11 x64 was tested on the host. ARM64 received packaging checks only, with no ARM64 device run. Other Windows versions, security software, and system policies were not all tested.

