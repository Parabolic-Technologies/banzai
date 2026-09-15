# ADR 0008: Read-Only Doctor Diagnostics

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-04
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-04

## Related Artifacts

- Feature description:
  `documentation/features/project-verification-readiness/description.md`
- Feature plan:
  `documentation/development-plans/project-verification-readiness/plan.md`
  (created after acceptance and required to conform to this decision)
- Manifest: sections 3, 5, 6, 9, and 10 of `PROJECT_MANIFEST.md`
- Related decisions: ADR-0006, Versioned Verification Profiles; ADR-0007,
  Project-Type Verification Readiness.
- Related accepted decision: ADR-0004, Privacy-Minimized Read-Only Evaluation
  Boundary.

## Context and Decision Drivers

The current CLI creates vendor adapters and `WorkflowRunner` for normal
commands. `WorkflowRunner` owns preflight model authentication and a `RunStore`.
`RunStore.acquireLock()` creates the runs directory, acquires a lock, and
deletes a stale lock; recovery paths can normalize and later persist legacy run
state. Those are correct mutation semantics for workflow commands but are
incompatible with a strictly read-only doctor.

The evaluation exporter establishes a useful precedent: branch before adapter
and runner construction, use direct privacy-minimized readers, keep structured
stdout clean, and degrade per-item evidence without mutating state. Doctor has a
different contract: it inspects current configuration, executable availability,
project markers, active pointer/state consistency, and lock liveness. It must
report operational evidence without copying request, path, token, digest, raw
output, source, or environment content.

Decision drivers:

- make read-only behavior structural rather than conventional;
- collect independent findings instead of failing on the first expected issue;
- provide deterministic human and machine contracts;
- keep stdout pure and exit status automation-friendly;
- distinguish healthy active/terminal state from corrupt or stale evidence;
- inspect process liveness without modifying or signalling the process;
- preserve hook authorization and manual approval markers exactly.

## Options Considered

### Option 1: Reuse `WorkflowRunner` and `RunStore`

Construct the normal composition root, call config/preflight/status helpers, and
render their results.

Benefits:

- minimal new reading code;
- shares current runner error messages.

Costs and rejection reason:

- adapter construction and preflight can invoke vendor authentication;
- lock acquisition creates directories and can remove stale locks;
- status/recovery semantics are fail-fast and not coverage-oriented;
- typed state normalization can hide malformed raw evidence;
- the boundary is easy to regress into mutation. Rejected because read-only
  safety must not depend on remembering which runner methods are safe.

### Option 2: Run existing commands in dry-run mode

Add a dry-run flag to normal preflight, store, verification, and vendor paths.

Benefits:

- maximizes code reuse;
- exercises close to production behavior.

Costs and rejection reason:

- dry-run branches spread through authorization and persistence code;
- verification and authentication subprocesses can still have side effects;
- a missed write branch violates the core guarantee;
- normal control flow becomes more complex. Rejected in favor of a small
  read-only composition.

### Option 3: Use a dedicated direct reader and versioned diagnostic object

Route `doctor` before adapter and `WorkflowRunner` construction. Read only the
needed config, root markers, `.banzai/active-run.json`, referenced `state.json`,
and `.banzai/runner.lock`. Check executable availability through filesystem
access and lock liveness through signal `0`. Never acquire a lock, call
`RunStore`, execute configured commands, authenticate, or recover.

Build one `banzai-doctor/v1` object in fixed check order. Serialize canonical
JSON or render the human report as a pure projection. Put expected pass,
warning, fail, and skipped findings in that object; reserve stderr for an
unexpected fatal CLI failure. Exit 0 only when no check fails.

Benefits:

- small auditable read-only boundary;
- complete, deterministic and automation-friendly report;
- raw invalid state remains visible as bounded structural evidence;
- no adapter, model, authentication, verification, network, or hook side
  effect;
- privacy policy can be enforced with an allow-list.

Costs and risks:

- some validation logic is intentionally separate from mutable store behavior;
- process liveness is only a point-in-time observation;
- direct readers require their own malformed, symlink, and race coverage;
- a versioned JSON contract creates compatibility obligations.

### Option 4: Emit human prose only

Print an unversioned checklist and use exit status for automation.

Benefits:

- smallest public surface;
- no JSON schema commitment.

Costs and rejection reason:

- downstream automation must scrape prose;
- human and machine diagnoses can drift;
- deterministic regression tests cannot compare one authoritative object.
  Rejected because readiness is expected to support local automation.

## Decision

Adopt Option 3.

Add a dedicated doctor composition that runs immediately after Git repository
discovery and before vendor adapters, `WorkflowRunner`, progress reporting, or
interactive composition. It may use filesystem metadata and reads, executable
access checks, the current Node/platform values, contract-parity validation,
and process signal `0` for liveness. It must not construct or call `RunStore`,
acquire/release a lock, delete stale evidence, reconcile state, execute a
verification command, invoke model or authentication CLIs, access a network,
or write a file.

Define JSON identity `banzai-doctor/v1` with `schemaVersion: 1`. Its canonical
field order and exact fields are those in the feature description. Build the
entire object in fixed check order, derive `ready` from absence of failed
checks, and derive summary counts from the same checks. JSON is authoritative;
the default human report is a pure projection. Use two-space JSON plus a final
newline. Exit 0 for ready and 1 for not ready. Keep expected findings in stdout
and unexpected fatal diagnostics in stderr.

Read active-run and lock evidence directly. A missing pointer is healthy. A
readable matching non-terminal state is an active warning; `done` or
`cancelled` is a valid terminal latest-run pointer. Unsafe IDs, missing or
mismatched referenced state, unsupported/malformed evidence, and repository
root mismatch fail. A missing lock passes; a structurally valid live or stale
lock warns; malformed or unsupported lock evidence fails. Never expose the run
ID, request, slug, absolute repository path, PID, lock token, digests,
environment values, raw config/state content, command output, or source
contents.

Keep the hook unchanged. Doctor receives no `BANZAI_*` authorization context,
does not invoke the hook, does not create a manual approval marker, and never
treats a readiness result as approval or workflow authorization.

## Consequences

Positive:

- read-only behavior is enforced by composition and testable by tree snapshots;
- one stable object drives both humans and automation;
- malformed config and control state can be reported together;
- active, terminal, stale, and corrupt cases remain distinct;
- privacy exposure is smaller than normal status output.

Negative:

- doctor duplicates a bounded subset of pointer, lock, executable, and runtime
  checks instead of reusing mutating paths;
- the JSON field set and status semantics require versioning for incompatible
  change;
- liveness may change immediately after inspection;
- doctor cannot prove vendor authentication or command success because doing so
  would cross the boundary.

Risks and required follow-ups:

- race conditions: report a point-in-time result and never attempt repair;
- reader drift: share pure validators where possible but keep store mutation
  unreachable;
- privacy regression: use allow-listed messages and canary tests for forbidden
  persisted/config content;
- output drift: canonical serialization and renderer parity tests are required;
- any future `--fix`, authentication probe, or command execution mode requires
  a new explicit decision rather than weakening this command.

## Compliance and Confirmation

Implementation and review must confirm:

1. the doctor CLI branch executes before adapter and runner construction;
2. success, warning, expected failure, invalid argument, and fatal paths keep
   stdout/stderr separated and use the specified exit status;
3. JSON and human rendering are deterministic projections of one object;
4. config, project marker, executable, active pointer/state, and lock checks do
   not short-circuit one another after expected failures;
5. absent, active, terminal, stale, malformed, unsafe, missing, and mismatch
   fixtures receive the specified classifications;
6. whole-repository and `.banzai` snapshots remain byte-identical in every
   doctor scenario;
7. no model, vendor authentication, verification, recovery, lock mutation,
   external write, or network call occurs;
8. forbidden request, slug, path, PID, token, digest, environment, raw output,
   source, and credential canaries do not appear in output;
9. existing hook tests pass unchanged and no authorization field or digest is
   modified;
10. docs, manifest, tests, smoke checks, and committed dist parity are current.

## Lifecycle Links

- Amended by [ADR-0045](./0045-guided-verification-setup.md), accepted
  2026-09-14: doctor v4, per-role parity and cause-specific remedies. Preserve
  offline/read-only behavior and historical diagnostic meanings.
  Implementation of this amendment is Planned.

- Amended by [ADR-0042](./0042-runner-delivered-phase-instructions.md), accepted
  2026-09-11: new doctor reports use v3 with `claude.instructions` in category
  `config` after `claude.environment` and before `claude.permissions`.
  Preserve read-only/privacy rules, derived readiness and historical v1/v2
  meaning. Implementation of this amendment is Planned.
- Amended by [ADR-0040](./0040-project-adoption-preflight-and-interactive-setup.md),
  accepted 2026-09-10: newly emitted doctor reports use v2 with the shared
  project-guidance readiness check. The offline, read-only, privacy and
  deterministic-projection boundaries remain binding; historical v1 artifacts
  retain their meaning. Implementation of the amendment is Planned.
- Supersedes: None
- Superseded by: None
