# Implementation Review: git-visible-work-artifacts

- Format: `banzai-feature-review/v1`
- Feature slug: `git-visible-work-artifacts`
- Review iteration: `1`
- Verdict: `changes_requested`
- Workspace digest: `not supplied`
- Review artifact: `documentation/work/git-visible-work-artifacts/review-1.md`

## Review Scope

Independent full review of the ADR-0054 implementation in the Banzai plugin
source repository. Source baseline HEAD was
`ead9f328719822d4f630d89f3df5c9af3dc7cb5f`. Reviewed authorities were the selected
`description.md`, `plan.md`, `implementation-report.md`, `test-report.md`, accepted
ADR-0054, its reciprocal amendments, the root `AGENTS.md` and
`PROJECT_MANIFEST.md`, relevant `MODULES.md` facts and installed review, artifact
storage, plan authority, test, security and Engineering Quality policies.
Packaged project instructions were assessed as product source.

The exact plan SHA-256 independently matched the supplied approved identity:
`0fbde5a43214d319c6abc90a272ca95690fc5427b712dc4330c5d12f0cf3f084`.
Proposal-era approval text and unchecked boxes are immutable historical bytes;
they are not findings or requests to edit the approved plan. The owner-selected
release version is `2.7.0`. The reports' v1 task table is an author claim, not a
runner completion receipt.

Assessment covered tracked changes and relevant untracked additions for T001-T008:

| Boundary | Assessed implementation and assurance |
| --- | --- |
| Document naming and filesystem safety | Fixed role mapper, binding-v3 parser/schema and typed projections; extracted contained reads/create-only writes; collision, visibility, preservation and unsafe-path cases |
| Standalone execution | Request-v3 selection, directory identity, execution ownership, private evidence store, success/failure/retry/authority cases and read-only inspection |
| Runner authority | State 9, capabilities 7/control 7.0.0, startup/setup, old-binding refusal, workspace 3, exact result scope and hook grants |
| Review and completion | Snapshot 7, rendered review 8, historical decoding, private candidates, canonical publication, completion receipts and relevant regression changes |
| Instructions and history | Skill/policy/template changes, explicit instruction transitions, retained-authority images, generated-resource evidence, historical custody and removal inventory |
| Publication and delivery | Source subtree classification, content/private-path checks, actual package evidence, prepared local-hook patch, original hashes and fixture assertions |

The unrelated ADR-0055 proposal and its separate work description were not
reviewed for substantive acceptance. Their presence grants no ADR-0054 scope or
execution authority.

Verification evidence inspected:

- Native private gate log at
  `.banzai/verification/74816e2fd54e15645a1278e9a160ccd3d00e927149bff2ce185b7586ea78171c/manual-release-cac03acb6d48832f.log`:
  all default release components passed; 1572 tests passed with zero failures,
  cancellations, skips or todo; build/resource parity, formatting, release
  validation, actual source/plugin/npm payloads and committed smoke passed.
- The original release-candidate driver independently matched its plan pin
  `698a35eebd4a7d5abf992d3ddbbb973d0332d350119fd99e70df57adf33f7eeb`.
  The read-only diagnostic wrapper at `/private/tmp/adr0054-final-candidate.py`
  uses that unchanged driver in a disposable source mirror and retains the real
  dependencies. Its omission of deleted real-index paths and the extraneous
  dangling dependency link agrees with the reported limitation. The logged
  candidate input tree identity is
  `cac03acb6d48832f1c71482abcaaaf33ccec2307463aaa915ca5f4531457e06f`.
- Installed helper-v3 `inspect` against this exact plan returned supported
  standalone authority with `evidence: unavailable`, no decision/applicability
  and zero physical attempts. This correctly distinguishes manual gate output
  from helper-owned evidence; it does not contradict the manual gate pass.
- Independent comparison confirmed unchanged accepted decision bodies before
  `Lifecycle Links` in the seven amended ADRs, unchanged original instruction
  root identity and all eleven prior transition records, with the three new
  transitions naming ADR-0054.
- The real local-hook files still match the three recorded original hashes.
  Application remains pending and was not performed. `git diff --check` passed.
- One focused disposable reproduction was run because the new evidence writer's
  effective-ignore enforcement was materially uncertain. It confirmed F1.
  It used synthetic output and a local Node child, removed its temporary fixture
  and did not modify source, reports, runner state or the real Git index/hooks.

The full suite was not rerun. The passing recorded gate is valid execution
evidence, but its assertions do not cover the privacy defect below.

## Summary

Changes are requested. A nested Git ignore exception allows standalone
verification to publish raw logs into ordinary Git status and still return
complete success. The explicitly required subsystem removal is also incomplete:
the newly shipped historical decoder contains an uncalled legacy discovery and
registration-candidate implementation. One maintained CLI reference states the
wrong current capabilities schema version.

The fixed document convention, successor contract identities, exact phase
grants, immutable authority checks and separate delivery limitations otherwise
agree with the assessed scope. No additional migration, live-vendor or installed
client success is inferred from local evidence.

## Findings

### F1 — Verify effective ignores for actual machine-evidence destinations

- Severity: `blocker`
- Category: `security`
- Confidence: `high`
- Evidence: `plugins/banzai/lib/verification-helper.mjs:84` checks the effective
  ignore of `identity.json` only when that file is first allocated.
  `plugins/banzai/lib/task-verification-store.mjs:40` publishes arbitrary
  evidence suffixes without an effective-ignore check, including raw stdout and
  stderr at `plugins/banzai/lib/task-verification-store.mjs:285`.
  `plugins/banzai/lib/execution-ownership.mjs:13` checks namespace probes and the
  executor claim, which does not establish that nested log destinations are
  ignored. A specific exception can therefore expose logs while both the probe
  and identity remain ignored.
- Violates: description FR8 and AC07; plan T002 at `plan.md:254` requires private
  evidence and effective ignores; ADR-0054, Preserve verification and authority
  independently of document storage; installed Security Assurance class 4 and
  primary `EQ-04`. The exposure is reachable generated subprocess output entering
  Git-visible files. Output redaction and later source-publication checks do not
  satisfy the requirement that raw execution records remain ignored locally.
- Reproduction: In a disposable Git repository, select
  `documentation/work/ignore-probe/plan.md` with a valid v2 inventory containing
  one harmless Node command that prints a synthetic private-output sentinel.
  Its directory key is
  `3b4656cebb3becc5dcbe9e3b5bd952204cd1c3b1dc076d9892fda12963a7f2d9`.
  Use the following `.gitignore`, replacing `<K>` with that key:

  ```gitignore
  .banzai/runs/
  .banzai/execution-locks/
  .banzai/verification/
  !.banzai/verification/
  .banzai/verification/*
  !.banzai/verification/<K>/
  .banzai/verification/<K>/*
  !.banzai/verification/<K>/logs/
  ```

  Invoke helper-v3 `execute` with the fixture root, that exact document,
  `workflow: strict` and a new round UUID. The independently observed result was
  `identity ignored: true`, `log ignored: false` and verification
  `applicability.complete: true`; ordinary
  `git status --porcelain --untracked-files=all` listed both generated
  `.banzai/verification/<K>/logs/verification-<uuid>.stdout.log` and
  `.stderr.log`. No force-add was used.
- Fix acceptance: Before publishing private machine bytes, enforce effective
  Git exclusion on each actual destination, including nested records, logs and
  temporary outputs. Revalidate the boundary for later executions that reuse an
  existing identity. A hiding/negating conflict must fail with an actionable
  narrow-ignore diagnostic before the exposed private destination is written;
  do not force-add, broadly unignore or alter existing work. Add proportionate
  cases for nested exceptions exposing logs/records and for a changed ignore
  after identity creation. Normal success/failure/retry behavior must retain
  private evidence and release only the executor's own ownership. Update the
  affected assurance/completion claims against the corrected evidence.

### F2 — Remove the uncalled legacy discovery implementation from the decoder

- Severity: `blocker`
- Category: `plan`
- Confidence: `high`
- Evidence: `plugins/banzai/lib/work-binding-history.mjs:93` through the end of
  the file retains `directories`, `readHeader`, `legacyEvidence` and
  `legacyCandidates`. The discovery at `work-binding-history.mjs:132` crawls old
  document and run roots; the candidate builder at
  `work-binding-history.mjs:219` derives a registration `creationId`, work path
  and originals. None is called by the sole exported `parseHistoricalBinding`,
  which returns at line 90, or by another module. Reference inspection found no
  supported consumer. These orphaned functions also reference removed imports
  and constants such as `safePath`, `readdir` and `DISCOVERY_LIMIT`. The file is
  classified as shipped product content in `publication-policy.json`.
- Violates: description FR14 at `description.md:80` explicitly requires unused
  implementation removal and a supported consumer for retained readers; plan
  T007 at `plan.md:383`; ADR-0054, Remove layout management from ordinary
  authoring; primary `EQ-06`. This is an incomplete binding removal requirement,
  independent of a stylistic preference. T007's completed claim and the report's
  decoder-only inventory do not account for this retained subsystem.
- Reproduction: Inspect the module's exports and the call closure of
  `parseHistoricalBinding`, then search current plugin/orchestrator source for
  `legacyEvidence` and `legacyCandidates`. The only matches are their uncalled
  definitions. No runtime failure of the supported decoder is asserted.
- Fix acceptance: Remove the uncalled discovery/candidate functions and their
  private helper closure. Retain the v1/v2 parser, fixed historical role
  validation and the constants it actually needs, without adding exports or a
  new discovery consumer. Existing historical binding/review/state evidence must
  retain its original decoding and execution refusal. Confirm the remaining
  reference inventory and affected report claim match the resulting supported
  decoder.

### F3 — Correct the documented capabilities schema version

- Severity: `should_fix`
- Category: `documentation`
- Confidence: `high`
- Evidence: `documentation/orchestrator.md:534` describes
  `banzai-agent-capabilities/v7` with “schema version 6”. The actual current
  constant is 7 at `packages/orchestrator/src/types.ts:107`; the orchestrate
  protocol and committed smoke likewise require 7.
- Violates: plan T008's current-behavior documentation obligation and the
  versioned capabilities contract specified under Document execution and storage
  contracts. A consumer following this reference would reject current output or
  validate the wrong version.
- Reproduction: Compare the Agent Control paragraph with the capabilities
  constant or read-only `banzai control capabilities` output.
- Fix acceptance: State schema version 7 in the maintained Agent Control
  reference and check that its schema, schemaVersion and control contract agree
  with the current declared contract. No new test framework or contract bump is
  needed for this correction.

## Previously Accepted Findings

None. This is the initial independent review.

## Deferred Coverage

- Real local-hook application, installed-client/model smoke, hosted CI and
  external publication remain the separate delivery steps specified by the
  approved plan. Their absence is not presented as a source-implementation pass
  or as an additional finding.
- Engineer IDE inspection was not performed. Git visibility was assessed from
  source, existing disposable test assertions and the focused reproduction.
- The reported post-gate rehash and evidence-only finalization are distinguished
  from the independently inspected native log and pinned driver. No helper
  applicability or runner receipt was reconstructed from report prose.
- Engineering Quality shadow assessment followed the frozen ordinary findings
  and verdict. No incremental `EQ-SHADOW:` candidate was identified.

## Handoff

Human triage is required for F1, F2 and F3. Only explicitly accepted finding IDs
may enter a fix phase; rejected/deferred findings remain outside it. This review
authorizes no fixes, approved-artifact edits, migration, hook application, staging,
commit, push, installation or publication. A subsequent reviewer should verify
accepted findings and regressions against the corrected source and current
evidence while preserving the approved plan and prior review bytes.
