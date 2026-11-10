# WP4 · Re-check human edits at the plan gate

Status: report ready · Program:
[banzai 2.8–2.9](../release-2-8-2-9-program/tracker.md) · Source:
[brief, WP4](../release-2-8-2-9-program/brief.md#wp4--re-check-human-edits-at-the-plan-gate)

## Problem

A strict plan's `banzai-verification-obligations/v2` inventory carries
`planRemainderSha256`, the SHA-256 of every plan byte outside the inventory.
After any edit to plan.md prose, `approvePlan` fails with
`TASK_VERIFICATION_DIGEST_MISMATCH` and prints the observed digest; the
practical way out is to paste it into the JSON block by hand. Request rework
costs a model round and may drop the edits. The gate never says that the run
waits and that its files may be edited.

## Authority

- [ADR-0058](../../decisions/0058-human-plan-edits-rechecked-at-the-plan-gate.md),
  accepted 2026-10-31. It amends ADR-0051 (runner-established remainder digest
  on an explicit human re-check) and ADR-0055 (pinned: the `recheck` plan gate
  decision, its CLI grammar and its agent-control surface under a new major
  revision). It preserves ADR-0017, ADR-0038, ADR-0049 §2 and ADR-0034.
- [ADR-0057](../../decisions/0057-complete-task-verification-rounds.md) §2 for
  publishing helper request v4, carried over from WP2 by the owner's decision
  of 2026-10-31.

## Requirements

- **R1 · Gate-entry snapshot.** Each time a planning attempt brings the run to
  `needs_plan_approval`, and each time a planning review restores that gate,
  the runner retains a private snapshot of the bundle bytes (description,
  bundle ADRs, plan) beside the run evidence, as it does for the approval
  snapshot. Snapshots are numbered per run and never overwritten. The latest
  one is the planner's version for the re-check. A run without one (it reached
  the gate before this change) has no planner's version.
- **R2 · Re-check action.** A strict task-verification run waiting idle at
  `needs_plan_approval` offers **Re-check my edits**. It never approves and
  never starts a phase. Under the workflow lock the runner:
  1. re-reads the bundle paths recorded for the gate and refuses a missing,
     symlinked or non-regular file;
  2. validates the current plan as approval does, except for the remainder
     digest: exactly one well-formed v2 inventory with valid descriptors, the
     task heading grammar, the runner-control task rule and the fresh-evidence
     rule;
  3. recomputes `planRemainderSha256` over the plan bytes outside the
     inventory;
  4. when the declared value differs, replaces only its 64 hexadecimal
     characters inside the inventory, every other byte unchanged, through an
     atomic replacement that fails when the plan changed after step 1;
  5. records the re-check (R4) and returns to the gate with a summary (R3).

  A refused re-check writes no file, state, event or snapshot, names the exact
  problem (field, check identity, task heading or path) and leaves the run
  waiting. When the declared digest already matches, no file is written and the
  summary still reports the changed files.

- **R3 · Summary.** The re-check summary compares the current bundle with the
  planner's version:
  - each changed, added or removed bundle file, with added, removed and changed
    sections by heading for each changed Markdown file;
  - added, removed and changed verification checks by identity, with the names
    of the changed fields (argv, cwd, timeout, evidence, sources,
    materialization, requirement references, name), and a changed absence
    rationale;
  - whether the remainder digest was rewritten;
  - a prominent notice for each bundle ADR whose status is Accepted and whose
    bytes changed: the runner cannot tell lifecycle metadata from body text,
    and accepted ADR bodies are immutable;
  - "The planner's version is unavailable" when no snapshot exists; the summary
    then lists only the current inventory's checks.

  It carries no file contents beyond headings, check identities and field
  names, and it is bounded. The interactive gate, `banzai status` and agent
  status show the latest summary until the run leaves the gate; a later gate
  entry does not show an earlier entry's summary.

- **R4 · Audit record and approval link.** A re-check appends a `plan_recheck`
  record to `humanDecisions` with: a record id, `decidedBy`, `decidedAt`, the
  gate-entry snapshot number (or null), the planner's bundle digest and
  declared remainder digest (null when unavailable), the observed remainder
  digest, the written remainder digest (null when nothing was written), the
  resulting bundle digest, the changed paths and the R3 summary. The approval
  record references the latest re-check whose resulting bundle digest equals
  the approved digest, so the approval shows a human-edited plan. The planner's
  digest stays in the record for audit. Run state moves to the next schema for
  these fields (Q1). Earlier state versions stay readable, and no record is
  fabricated for them. A `plan.recheck` event carries identities, digests,
  counts and paths, never text.
- **R5 · Approval and model results unchanged.**
  - Approval never rewrites a digest. Approval over a mismatched remainder
    still fails with `TASK_VERIFICATION_DIGEST_MISMATCH`, and its message
    names the re-check action for the terminal (Re-check my edits) and for the
    CLI and agent control (`banzai approve plan --decision recheck`).
  - A planning result whose remainder digest does not match its own bytes is
    still rejected at acceptance and follows ADR-0051's digest-rejected repair
    route. Re-check is never offered for a rejected planning attempt.
  - Rework and planning review keep their meaning and see the current bytes.
  - Re-check does not close the gate's human-time episode (ADR-0034): neither
    its event nor its record is a decision boundary.
- **R6 · Scope.** Re-check is offered only on strict task-verification runs on
  state v10 or later. Historical states (v9 and earlier) keep today's
  behaviour, as for rework and planning review. Legacy profile-mode plans and
  ADR gates are out of scope.
- **R7 · Gate copy.** At the plan gate, before the decision, the terminal and
  `banzai status` print, with full repository-relative paths: "The run is
  waiting. Edit these files in any editor, then choose Re-check my edits. Exit
  and decide later keeps the run." The CLI form names
  `banzai approve plan --decision recheck` instead of the menu choice. The
  terminal choice sits between approve and rework.
- **R8 · CLI.** `banzai approve plan --decision recheck` re-checks without a
  note; `--note` with `recheck` fails before anything changes. `--by` is
  accepted; `--no-resume` is accepted and has no effect. Unknown, repeated and
  positional arguments fail as today. After a re-check the command prints the
  summary and the gate again.
- **R9 · Agent control major revision.** Publish control `9.0.0` with
  capabilities `banzai-agent-capabilities/v9` and status
  `banzai-agent-status/v7`:
  - `planningGates.decisions.plan_approval` lists
    `approve`, `recheck`, `rework` and `review`;
  - `pendingGate` for `plan_approval` carries the latest re-check summary of the
    current gate entry, or null;
  - the operation carries no free text and needs no new input document;
  - `workDocuments.verificationRequestSchemas` lists
    `banzai-verification-request/v4` and `banzai-verification-request/v3`;
  - every other field keeps its meaning; older control documents (request v1,
    answers v1–v4, recovery v1, gate decision v1) are unchanged.

  The `orchestrate` skill and `control-protocol.md` pin the new declaration. A
  supervisor relays a re-check only on the current human's explicit request and
  never edits planning files on its own initiative.

- **R10 · Helper v4 publication (from WP2).** `policies/artifact-storage.md`
  documents request v4 as current, with `retryOf` as the round's exact
  unsuccessful attempt set, and keeps v3 as retained. The skills that name the
  helper request name v4 (Q2). Runtime diagnostics in `verification-helper.mjs`
  and `scripts/verification.cjs` that tell users which request to use name v4.
- **R11 · Instruction transitions.** Every changed instruction resource
  (policy, skills, `orchestrate` skill, hook) is recorded through
  `scripts/instruction-baseline.mjs` with an authorization that cites ADR-0057
  §2 and ADR-0058 at their final bytes. ADR-0058's implementation state changes
  before the transition pins it.
- **R12 · Documentation.**
  - `documentation/orchestrator.md`: plan gate, CLI grammar, control
    revision and helper request text.
  - `documentation/getting-started.md`: the strict route's plan gate.
  - `packages/orchestrator/MODULES.md`, `PROJECT_MANIFEST.md` (current facts,
    ADR-0058 row), README and plugin README files that name the control
    revision.
  - ADR-0058 implementation state and the decisions index row.
  - The tracker row and the report.

## Owner decisions

The owner approved this package on 2026-10-31 with `Both recommended`,
after the WP2 commit `da624a4`:

- Q1: new runs still start at state v10; a run moves to v11 in the same atomic
  state write as its first re-check record.
- Q2: all seven skills that name the helper request name v4.

The questions as asked follow.

1. **Q1 · Which runs move to state v11.** ADR-0058 §4 puts the re-check record
   and the approval link in "the next run-state schema". Run state v10 must stay
   executable either way, because runs waiting at the gate today are v10.
   - **Recommendation:** new runs still start at v10; a run moves to v11 in the
     same atomic state write as its first re-check record. This follows the
     existing precedent for v7, keeps every run that never re-checks readable
     by a 2.7.x hook, and gives v10 runs at the gate the action (ADR-0058
     compliance 8).
   - **Alternative:** new runs start at v11, and v10 runs move to v11 on their
     first re-check. One current version for new work, but a stale 2.7.x
     plugin hook then refuses every new run.
2. **Q2 · Which skills name helper v4.** The 2026-10-31 decision names "the
   executing skills". Seven skills name the v3 request: `code-writing`,
   `feature`, `quick-fix` and `test-writing` (execute), and
   `development-plan`, `feature-review` and `feature-status` (inspect and
   decide). v3 stays supported, so either choice is correct.
   - **Recommendation:** all seven name v4, so one request revision is current
     in every instruction.
   - **Alternative:** only the four executing skills move; the three read-only
     skills keep v3.

## Acceptance

1. A prose edit to plan.md at the gate is re-checked; the remainder digest is
   rewritten with every other byte unchanged; approval then succeeds without
   manual hashing, and the approval record references the re-check.
2. Each of these edits is refused with a precise message, and no file, state,
   event or snapshot changes: a missing or duplicated inventory block,
   malformed JSON, an invalid descriptor, a broken task heading, a broken
   runner-control task rule, an equivalent-evidence check against a fresh
   commitment, and a missing or symlinked bundle file.
3. A planning result with a mismatched remainder digest is still rejected at
   acceptance and offered ADR-0051's repair route, not re-check.
4. A plan changed between the re-check's read and its write is refused without
   writing.
5. The summary lists changed files, sections and checks against the planner's
   version, flags a changed accepted ADR and contains no file contents beyond
   headings, identities and field names. A re-check with a matching digest
   writes nothing and still reports changed files.
6. Approval over a mismatched digest fails and names the re-check action in
   the terminal, the CLI and agent control.
7. The terminal, the CLI and agent control offer the action; capabilities v9
   and status v7 carry it; older control documents keep their meaning.
8. A run that reached the gate without a snapshot re-checks and says the
   planner's version is unavailable.
9. A re-check does not end the gate's human-time episode; approval after it
   still does.
10. A historical (v9) task run at the gate offers no re-check, and its approval
    mismatch message is unchanged.
11. `npm run verify` and `npm run format:check` pass. `npm run
release:validate` reports nothing but `HOOK_CHANGED_WITHOUT_VERSION_BUMP`,
    which the owner deferred to Gate 1.

## Out of scope

- Re-check at the ADR gate or for legacy profile-mode plans.
- Rewriting verification source digests (`sources[].sha256`) or any field
  other than `planRemainderSha256`.
- Standalone skill approval in chat; standalone plans are not runner-gated.
- Bundling the WP9, WP10 and WP11 control actions into this revision.
- Changes to the end-user `AGENTS.md` template.
