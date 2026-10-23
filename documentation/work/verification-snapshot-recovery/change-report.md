# Verification snapshot recovery

Date: 2026-10-22

## Problem and change

Fresh commands could exit successfully but remain unavailable forever when a
repository contained a protected filename or a regular file larger than 16 MiB.
Every retry repeated verification without establishing applicable success.

`captureTaskVerificationInputs` now streams ordinary files, retaining the
128 MiB aggregate and 50,000-entry bounds. It opens without following symlinks,
checks filesystem identity before and after reads, and closes handles on failure.
Protected names contribute metadata identities only: device, inode, mode, size,
mtime and ctime. Secret values are neither read nor hashed. Metadata is a drift
guard for fresh checks in the current round, not complete dependency proof.
Opaque inputs explicitly disable cross-round reuse, including with an opt-in
reuse policy. Symlinks, unreadable regular files, races and exhausted budgets
remain unavailable.

Successful physical commands with unavailable snapshots now explain the input
snapshot failure and the verification retry remedy. Existing null-snapshot
records remain immutable and cannot become success merely because the code was
upgraded: retry executes a new physical check. Implementation is not replayed.

## Scope and authority

This is the user-authorized correction to fresh verification and retry, under
accepted ADR-0015, ADR-0043 and ADR-0049. Existing execution authority, approved
obligations, origin integrity, failure precedence and complete-input reuse rules
remain intact. There is no schema migration, dependency change or new ADR.
The separate PHP runtime-isolation correction belongs to the consuming project.
No upstream requirements or plan was created for this quick fix.

Files: shared `task-verification-store.mjs`; task-verification and recovery
tests; current manifest, module reference and orchestrator guide; this report.
The earlier stale-lock recovery change remains a separate work item.

## Security and structural assessment

- Class 1: filesystem inputs remain bounded, non-following and checked for
  replacement or mutation; unsupported input cannot establish applicability.
- Class 2: direct immutable physical origins and current authority are still
  required. An old incomplete observation is not promoted; opaque observations
  cannot authorize cross-round reuse.
- Class 3: secret values are never read, hashed or persisted by observation.
  Only aggregated non-secret filesystem identities leave process memory.

Reuse search: `verification-evidence.mjs:readRegular` and
`project-files.mjs:readBytes` provide bounded whole-file reads for different
contracts. Neither provides streaming fresh observation. Retain observation in
the existing task-store owner; extract only its file-read lifecycle into
`observeFile` and the shared metadata identity into `fileIdentity`. This avoids
changing the stricter complete-dependency capture contract. File handles belong
to one call and close in `finally`; the existing in-memory entry map still owns
drift diagnostics. No cross-subsystem edge or new persistent owner is introduced.
The existing capture/applicability coordination stays in its owning module.
No material Engineering Quality deviations or skipped review findings.

## Verification

- The new large-file/protected-name regression failed before the source change
  because its observed digest was null, and passed after it.
- Targeted task verification and recovery suite: 31 tests passed before final
  negative-bound and lint cleanup; final suite below owns final-tree results.
- Regression coverage includes same-size edits with restored mtime, protected
  unreadable values, symlinks, over-budget inputs, immutable old null snapshots,
  tampered logs, cross-round reuse refusal and retry with one implementation.
- Initial full verification stopped at eight unnecessary-optional-chain test
  lint errors; those were corrected.
- Final `npm run verify`: passed, including typecheck, lint (zero errors,
  415 advisory warnings), all 1,782 tests, generated-source/distribution parity
  and CLI smoke checks. Local loopback permission was provided for the existing
  release-evidence fixtures.
- Distribution rebuilt; `npm run format:check` and `git diff --check` passed.

Final raw evidence is retained privately under
`.banzai/verification/verification-snapshot-recovery/`.

Assurance critique: tests assert externally meaningful evidence dispositions,
retained history and model-phase counts, rather than private traversal order.
Metadata does not prove secret contents or external-service stability; the
complete-dependency reuse gate remains closed for opaque inputs.

No commit, push, release or hosted-CI result is claimed.
