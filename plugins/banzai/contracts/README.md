# Orchestrator Contracts

These versioned JSON contracts are part of the Banzai plugin source. Manual
skill behavior remains authoritative; the optional orchestrator constrains
machine hand-offs with these schemas.

- `contract.json` identifies the active contract version.
- `v1/workflow-selection.schema.json` constrains the planner's read-only route
  selection before workflow execution.
- `v3/phase-result.schema.json` is the current hand-off. It adds the
  planning-only `decision_consultation` gate and the required nullable
  `banzai-decision-consultation/v1` request. Its implementation result carries
  the canonical `taskCompletion` ledger; planning and lite
  results use `taskCompletion: null`. A fix result uses `taskCompletion: null`
  unless its accepted findings made the recorded evidence stale, in which case
  it may carry a complete refreshed ledger that the runner validates with the
  identical fail-closed pipeline (ADR 0025).
- `v2/review-result.schema.json` is required for every new orchestrated review
  from either vendor (`schemaVersion: 2`, umbrella `contractVersion: "1.0.0"`).
  The reviewer owns findings, evidence, reproduction, fix acceptance, reviewed
  finding IDs, summary, deferred coverage and additional `reviewNotes` prose.

The separately versioned `scopeAcknowledgment` has `schemaVersion: 1`, the
runner's exact `snapshotDigest`, and one `{path, status, reason}` per approved
artifact. `reviewed` requires a null reason; `not_reviewed` requires a nonempty
reason and verdict `blocked`. Missing, duplicate, contradictory, unsafe and
out-of-scope entries fail. A full review asserts assessment against the complete
approved change surface. A delta review requires a compatible full-review
anchor and explicitly assesses every approved artifact against the current
change surface and accepted findings; remembered coverage never fills an entry.
Acknowledgment is a reviewer assertion, not independent proof of reading or
substantive assessment. Blocked reviews may truthfully report partial or zero
coverage and partial accepted-ID assessment without findings or a gate.

The runner freezes `banzai-review-snapshot/v3` evidence before invocation,
retains the result and diagnostics, validates scope, renders one attempt-owned
`banzai-feature-review/v4` candidate, validates it and current integrity, then
atomically publishes its exact bytes. Required scope and reviewer coverage are
separate. Lossless fenced JSON values preserve multiline prose and opaque
`EQ-SHADOW:` entries; recorded verification and completion come only from the
snapshot. No formatting/parity model repair occurs. Standalone skill review
writes `banzai-standalone-review/v1` under the selected private review role.
Neither artifact format broadens human triage or fixer scope. Unsupported
versions fail closed without conversion.

For new strict orchestrated implementation attempts, the phase-result v3 structured ledger
is the sole task-completion source of truth. The implementation report contains
a deterministic `banzai-plan-task-completion/v1` Markdown projection and runner
state contains a validated summary. The runner checks both projections against
the canonical ledger before verification, review, and terminal success. A
missing ledger reports unknown completion; immutable plan boxes are not a
fallback completion source.

`release-policy.json.compatibility` declares each supported resource family.
At each release-train major boundary exactly one version remains per family.
Within a major, new versions are additive and existing versions remain readable
until the next major boundary (ADR-0045). Version numbers are not reset.

Schemas passed to model CLIs stay within the OpenAI Structured Outputs subset:
enum and const nodes declare an explicit type, every object is closed and
requires all properties, and unsupported schema-only uniqueness keywords are
omitted. The orchestrator's runtime validators continue to enforce non-empty
values, identifier patterns, positive integers, uniqueness, and
cross-field invariants after decoding.
