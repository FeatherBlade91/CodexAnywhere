# AI request performance in v1.0.4

The changes target time before an inference request reaches the upstream API. Model IDs, reasoning effort, prompts, tool definitions and streamed output semantics are unchanged.

## Credential acquisition

The store retains one decrypted state, keyed by the exact encrypted ciphertext read from disk. Every access still checks encryption availability, obtains the interprocess lock, opens and validates the credential file, and compares its contents. It does not rely on file timestamps or a token TTL. Changed, missing or invalid files invalidate the cache; writes invalidate it before attempting persistence. Returned states are independent copies.

This avoids starting PowerShell for unchanged credentials after the first read. A process restart or changed credentials still requires DPAPI decryption. Credentials remain encrypted on disk. The in-memory cache is held only in the trusted backend, never sent to the renderer. Token expiry, rotation, profile switching and authorization remain enforced by the Devkit.

Local lock contenders use a cancellable FIFO queue. The filesystem lock remains in place for other processes. It is released before model generation, so concurrent generations are not serialized. Desktop OpenAI-compatible generation routes call the authenticated request path directly instead of first performing a duplicate session read. UI status reads use the same inexpensive store path without a stale authorization snapshot.

## Model discovery

The first lookup still waits for a successful model catalog. For the next 60 seconds the cache is fresh. An older successful catalog is returned immediately while one background refresh runs, up to a one-hour age limit. Failed background refreshes retain the previous catalog and back off for 10 seconds. Explicit refreshes and unknown model IDs await discovery and expose failures. Logout/login clears the cache, and results from older generations cannot overwrite the current catalog. Model HTTP discovery has a 15-second timeout. The UI's `models.json` snapshot is persisted atomically in a background queue; inference never waits for disk persistence, and disk errors do not fail generation.

## Reproducible offline measurement

Run `npm run build` then `node scripts/benchmark-credentials.mjs` on Windows. It uses a temporary directory, synthetic credentials and the real bundled DPAPI script. It neither reads a personal account nor contacts the model API.

Measured on the development machine on 2026-10-25:

| Credential acquisition | Samples | Mean | Range |
| --- | ---: | ---: | ---: |
| Cold store, including PowerShell/DPAPI | 3 | 1,288.14 ms | 1,260.16–1,319.69 ms |
| Warm store, with disk validation and locking | 30 | 2.82 ms | 2.16–3.56 ms |

Thirty concurrent warm reads completed in 74.70 ms total with zero further decryptions. These are component measurements, not end-to-end model latency or a guarantee for other machines. Upstream generation and network performance are not measured here.

Regression coverage includes concurrent reads, copy isolation, external credential rotation/logout, corruption/deletion, provider availability, failed writes/decryption, lock cancellation and exclusion, token expiry and refresh rotation, cancellation during rotation, model cache refresh/failure/invalidation, and text arriving at the client before generation completes. Existing protocol and tool-history tests verify that request and answer semantics remain intact.
