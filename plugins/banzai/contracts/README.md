# Orchestrator Contracts

These versioned JSON contracts are part of the Banzai plugin source. Manual
skill behavior remains authoritative; the optional orchestrator constrains
machine hand-offs with these schemas.

- `contract.json` identifies the active contract version.
- `v1/planning-review-result.schema.json` is the closed
  `banzai-planning-review-result/v1` result: an exact review-number and scope
  digest echo and zero to twenty planning findings. It carries no verdict or
  approval. The runner renders `banzai-planning-review/v1` artifacts.
- `v1/planning-review-analysis.schema.json` is the closed
  `banzai-planning-review-analysis/v1` analysis: one ordered entry per finding,
  bound to the review's canonical result digest, with one to three options and
  an optional recommendation naming a listed option. Recommendations are
  advisory; dispositions remain human decisions. These additive families keep
  umbrella contract `1.0.0` and existing result contracts unchanged.
- `v1/workflow-selection.schema.json` constrains the planner's read-only route
  selection before workflow execution.
- `v1/phase-result.schema.json` is the preserved legacy planner, implementer,
  and fixer hand-off. Existing persisted attempts remain readable but are not
  upgraded or treated as complete task evidence.
- `v2/phase-result.schema.json` is the preserved legacy task-completion
  hand-off. Existing persisted attempts remain readable but are not emitted by
  new model calls.
- `v3/phase-result.schema.json` preserves the historical consultation-aware hand-off.
- `v4/phase-result.schema.json` is the current hand-off. It carries task verification
  candidates within existing execution authority and retains the
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

New runs use state schema 10. Historical formats remain readable; old-run
continuation and migration are not supported. The runner freezes
`banzai-review-snapshot/v7` evidence before invocation,
retains the result and diagnostics, validates scope, renders one attempt-owned
`banzai-feature-review/v8` candidate, validates it and current integrity, then
atomically publishes its exact bytes. Required scope and reviewer coverage are
separate. Lossless fenced JSON values preserve multiline prose and opaque
`EQ-SHADOW:` entries; recorded verification and completion come only from the
snapshot. No formatting/parity model repair occurs. Standalone skill review
still writes its own durable v1 Markdown; historical v1 prose and validation
rules remain intact. Neither artifact format broadens human triage or fixer
scope. A malformed current response is never downgraded to v1.

The current snapshot binds task obligations and permitted supplemental checks,
physical execution origins, current applicability and completion publication
identities. It does not turn absent, failed or unavailable checks into passed
coverage. Historical snapshot and rendered-review formats retain their original
readers; recognizing them does not enable old-run continuation or migration.

New task verification has no configuration prerequisite gate. Agent control
8.0.0 declares capabilities v8 and status v6, including bounded task verification
outcomes and the retained runner-owned completion publication protocol. Its
stages, closed refusal codes and `pending_application` attempt status keep their
meaning. Planning gates use gate-decision v1 and planning-triage answer v4.
Existing escalation/consultation answer v1/v2 inputs retain their
semantics. The retained configuration-answer v3 and `banzai approve verification`
utilities apply only to legacy configuration surfaces; adding a profile does
not authorize current task execution or old-run continuation. See the maintained
[control protocol](../skills/orchestrate/references/control-protocol.md) for
negotiation, human provenance and bounded disclosure.

For new strict orchestrated implementation and fix attempts, the structured
`taskCompletion` ledger (schema 1) in the phase-result v4 hand-off is the sole
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
verification, review, and terminal success. A historical attempt without the
ledger is reported as legacy or unknown and does not gain current completion authority;
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

New work binding v3 records fixed `documentation/work/<slug>/` roles in runner
state without a layout selector or registered work file. Workspace v3 includes
exact selected documents as well as Git changes. Capabilities v7 expose the
`workDocuments` directory pattern, binding-v3/workspace-v3 support and verification
request v3. Standalone request v3 selects `documentPath` and `workflow`; its
response envelope remains v2. Retained binding-v1/v2 decoders preserve history
without authorizing execution. Existing documents and archives are not migrated.

Planning-review and planning-analysis attempts are read-only, with no artifact
write grant. The runner alone publishes planning-review-N.md beside the exact
bound work documents. The current hook executes state v10 only and retains its
newer-schema update diagnostic. Binding v3 gains no role. Both structured output
contracts remain v1 under umbrella 1.0.0; human planning triage is answer v4 in
control 8.0.0, and never grants plan approval or ADR acceptance.
