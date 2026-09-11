# Retained version transaction format 1

These fixtures were captured before the ADR-0033 policy/writer changes, using
the actual six-file writer and SIGKILL after its first replacement (`ready`)
or removal of the journal directory (`guard`). Both independent migration and
six-way forward update are represented. No new-format writer generates them.

Generating source: `packages/orchestrator/scripts/release-version.mjs`
SHA-256: `49ab987cce9b69dfb4209c61fa49e3e58d8f59ce2cca32601a8aa19092f00c7f`.
The source was an uncommitted reviewed implementation, not a released Git ref.
Node: `24.11.1`. Capture date: `2026-09-05`.

```sh
node packages/orchestrator/test/fixtures/version-recovery-v1/capture.mjs packages/orchestrator/scripts/release-version.mjs release-policy.json
```

Reproduction requires the preserved source and policy from before migration;
the current writer is deliberately rejected by the capture script. `ownerPid`
was explicitly supplied as `424242` for deterministic evidence; recovery tests
inject the owner-liveness boundary rather than assume that PID is dead.
Metadata and retained files contain exact base64 bytes and modes. Fixture
assembly must create private recovery directories and preserve recorded modes.
