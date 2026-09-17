# Orchestrator Contracts

These versioned JSON contracts are part of the Banzai plugin source. Manual
skill behavior remains authoritative; the optional orchestrator constrains
machine hand-offs with these schemas.

- `contract.json` identifies the active contract version.
- `v1/workflow-selection.schema.json` constrains the planner's read-only route
  selection before workflow execution.
- `v1/phase-result.schema.json` is the preserved legacy planner, implementer,
  and fixer hand-off. Existing persisted attempts remain readable but are not
  upgraded or treated as complete task evidence.
- `v2/phase-result.schema.json` is the preserved legacy task-completion
  hand-off. Existing persisted attempts remain readable but are not emitted by
  new model calls.
- `v3/phase-result.schema.json` is the current hand-off. It adds the
  planning-only `decision_consultation` gate and the required nullable
  `banzai-decision-consultation/v1` request. Its implementation result carries
  the canonical `taskCompletion` ledger; planning and lite
  results use `taskCompletion: null`. A fix result uses `taskCompletion: null`
  unless its accepted findings made the recorded evidence stale, in which case
  it may carry a complete refreshed ledger that the runner validates with the
  identical fail-closed pipeline (ADR 0025).
- `v1/review-result.schema.json` is preserved for historical records and
  standalone review artifacts. It carries no scope acknowledgment.
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

New schema-2/3 configuration runs use state schema 6. The runner freezes
`banzai-review-snapshot/v4` evidence before invocation,
retains the result and diagnostics, validates scope, renders one attempt-owned
`banzai-feature-review/v5` candidate, validates it and current integrity, then
atomically publishes its exact bytes. Required scope and reviewer coverage are
separate. Lossless fenced JSON values preserve multiline prose and opaque
`EQ-SHADOW:` entries; recorded verification and completion come only from the
snapshot. No formatting/parity model repair occurs. Standalone skill review
still writes its own durable v1 Markdown; historical v1 prose and validation
rules remain intact. Neither artifact format broadens human triage or fixer
scope. A malformed current response is never downgraded to v1.

The current snapshot records configured, deferred or explicitly skipped coverage
and exact confirmed runner configuration deltas. It never claims whole-file
authorship or invents verification applicability for a skipped round. Historical
state 1-5, snapshot 1-3 and rendered review 1-4 retain their original validation
and rendering contracts; configuration schema 1 remains legacy.

The runner alone raises `configuration_prerequisite` after an eligible completed
implementation or fix checkpoint. It is not an additional model phase-result
field. Agent control 5.0.0 declares capabilities v5, status v4 and the closed
configuration-answer v3 input, while existing escalation/consultation answer
v1/v2 inputs keep their meaning. Capabilities v5 also declare the runner-owned
completion publication protocol, its stages, closed refusal codes and the
`pending_application` attempt status; status v4 adds the bounded publication
state of the active run. `banzai approve verification` accepts the same
exact-current v3 answer as `banzai control answer`. See the maintained
[control protocol](../skills/orchestrate/references/control-protocol.md) for
negotiation, human provenance, bounded proposal disclosure and no-resume rules.

For new strict orchestrated implementation and fix attempts, the structured
`taskCompletion` ledger (schema 1) in the phase-result v3 hand-off is the sole
task-completion source of truth, and the model returns it with report
narrative only. Under `banzai-completion-protocol/v1` (ADR-0047) the runner
validates the claims, renders the implementation report's **Plan Task
Completion** section as the delimited `banzai-plan-task-completion/v2` region,
persists an immutable candidate and publication receipt, and only then applies
the completion; runner state holds the validated summary (schema 2) with the
publisher identity and receipt digest. The v2 region encodes every ASCII
punctuation code point of its JSON cells as a decimal numeric character
reference and is decoded exactly once; nothing inside it confers authority.
Historical runs keep their model-authored `banzai-plan-task-completion/v1`
projection and summary schema 1 with the original decoders. The runner checks
the published bytes, receipt and summary against the canonical ledger before
verification, review, and terminal success. A legacy attempt without the
ledger retains its lifecycle but reports task completion as legacy or unknown;
unchecked immutable plan boxes are not a fallback completion source.

Schema changes are backward-compatible within a major contract directory.
Breaking changes require a new directory and an orchestrator compatibility
update.

Schemas passed to model CLIs stay within the OpenAI Structured Outputs subset:
enum and const nodes declare an explicit type, every object is closed and
requires all properties, and unsupported schema-only uniqueness keywords are
omitted. The orchestrator's runtime validators continue to enforce non-empty
values, identifier patterns, positive integers, uniqueness, and
cross-field invariants after decoding.
