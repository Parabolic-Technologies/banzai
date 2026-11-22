# Change report: fixes for review 1 of P11

- Date: 2026-11-16
- Feature: [Orchestrator-owned instruction copy (P11)](./description.md)
- Reviews: [review-1.md](./review-1.md), verdict `changes_requested`;
  [review-2.md](./review-2.md), resolution review, verdict
  `changes_requested` for the remainder of F2 (R2-F1)
- Decision:
  [ADR-0070](../../decisions/0070-orchestrator-owned-instruction-copy.md)
- Triage: the owner accepted F1, F2 and F3 in chat on 2026-11-16 with
  `Accept all three`. No finding was declined or deferred.

## What changed and why

### F1 — the successor baseline's first generation is anchored

- Changed scope: `packages/orchestrator/scripts/successor-baseline.mjs`
  (constant `FIRST_GENERATION_PIN` and its check in `replay`),
  `packages/orchestrator/scripts/check-release.mjs` (diagnostic detail
  text), `packages/orchestrator/test/release-validation.test.ts`.
- Decision: the identity of `{ predecessorBaselineSha256, origin }` of the
  committed baseline is fixed by a digest constant in tracked script code,
  as the v1 root and the three closed files are. Replay refuses a file whose
  first generation differs, so release validation, `--describe`,
  `--authorization` and `--initialize` are all anchored. No flag,
  environment variable, file or parameter overrides the constant.
- The tool's initializing form now writes only the anchored first
  generation. When the first generation it would write differs, it exits 1
  with "first generation differs from its pinned identity; record a
  transition instead" and writes nothing; `--check` gives the same refusal.
  It is still refused while a transition is published or pending.
- Why: before the fix, release validation accepted a first generation
  written again over a changed pinned resource, with no transition
  recorded. ADR-0070 sections 1 and 3 require a transition that cites an
  Accepted ADR.
- Evidence executed in this fix:
  - `release validation rejects a first generation written again over a
changed text entry while the chain is empty` (new);
  - `release validation rejects a first generation written after a recorded
chain was dropped` (new);
  - `successor baseline admits a hook configuration and manifest transition
only under an Accepted authority` (adapted: the tail that asserted a
    re-initialized first generation validates now asserts the refusal);
  - both reproductions of the review replayed on a copy outside the
    repository: each now fails release validation;
  - mutation on a copy: with the anchor check removed, exactly these three
    tests fail.
- Limits: the committed baseline file and its sibling digest did not change
  (`9bb5fc69…2fbd`). A later lifecycle note on ADR-0070 needs an entry in
  the retained-authority allow-list, as for any pinned authority.

### F2 — the parity tests no longer read the plugin's text files

- Changed scope: `packages/orchestrator/test/phase-instruction-fixtures.ts`.
- Decision: the shared installed-plugin fixture copies the plugin, removes
  the copied `phases/`, `guidance/` and `policies/` directories and writes
  the runner's frozen text entries in their place. The fixture is then an
  installed plugin with the text of release 2.8.3, whatever the plugin's
  own text files hold. No test file needed a change: the tests still edit,
  add and delete installed text and still skew a hook file.
- Why: with `plugins/banzai/phases/` removed, eighteen tests of
  `phase-instructions`, `doctor` and `workflow-project` failed with
  `ENOENT`, although ADR-0070 section 2 makes that removal a text change
  like any other.
- Evidence executed in this fix: on a copy of the tree outside the
  repository the three test files pass (142 tests, 0 failed) with
  `plugins/banzai/phases/` removed, and again with `guidance/` and
  `policies/` removed as well. On the working tree they pass with the
  directories present.
- Limits: `workflow-skills.test.ts` reads plugin guidance and policies on
  purpose; it tests the plugin's own text. After this step one test of
  `release-validation.test.ts` still needed the plugin's `phases/`
  directory; review 2 found it, see R2-F1 below.

### R2-F1 — the last test that needed the plugin's phase directory

- Changed scope: `packages/orchestrator/test/release-validation.test.ts`,
  the test `frozen phase resources follow the hook files only and reject a
stale digest or a missing module without repair`.
- Decision: the test creates the fixture's `phases/`, `guidance/` and
  `policies/` directories before it changes, adds and removes plugin text,
  and removes the policy with `force`. Its assertions did not change: plugin
  text that is changed, added or missing leaves the module bytes unchanged.
- Why: review 2 ran the whole suite on a copy without
  `plugins/banzai/phases/` and one test failed with `ENOENT`. The first
  version of this report said the manifest sentence on the phase documents
  held for tests as well; that was false until this change.
- Triage: R2-F1 is the unresolved part of F2, which the owner accepted. It
  was fixed under that acceptance; review 2 lists it for triage as a new
  finding, and the owner has not answered that separately.
- Evidence executed in this fix: the whole suite on a copy of the tree
  without `plugins/banzai/phases/`: 2183 tests, 0 failed. The manifest
  sentence that the seven phase documents are read by no skill, build or
  check now holds for the orchestrator's tests as well.
- Limits: the suite was not run without `guidance/` and `policies/` in the
  plugin; `workflow-skills.test.ts` needs them by design.

### F3 — direct runs of the mandatory checks are recorded as a deviation

- Changed scope: `implementation-report.md`, deviation 7.
- Decision: the fix acceptance offers two ways; the direct runs are
  recorded as a deviation with their results. The checks were not run
  through the verification helper.
- Limits: the helper still reports no machine evidence for the plan's
  inventory.

## Security exposure

Integrity of release controls: the fix narrows who can change a pinned
resource without a recorded decision. It adds no new control class; it
enforces the control ADR-0070 section 3 already establishes. No other
class applies.

## Files changed

- Production scripts: `packages/orchestrator/scripts/successor-baseline.mjs`,
  `packages/orchestrator/scripts/check-release.mjs`.
- Tests: `packages/orchestrator/test/release-validation.test.ts`,
  `packages/orchestrator/test/phase-instruction-fixtures.ts`.
- Documents: `PROJECT_MANIFEST.md`, `documentation/engineering-quality.md`,
  `packages/orchestrator/MODULES.md`, and in this work directory
  `implementation-report.md`, `test-report.md` and this report.

## Skipped review findings

None. The `EQ-SHADOW` record of the review is not a finding and was not
acted on.

## Documentation sync

- `PROJECT_MANIFEST.md`: the successor baseline's first generation is fixed
  by a digest constant, so a pinned resource changes only through a
  transition that cites an Accepted ADR.
- `documentation/engineering-quality.md`: the refusal rule of
  `--initialize`, the anchor, and that writing the first generation again
  does not authorize a change.
- `packages/orchestrator/MODULES.md`: the constant and the refusal.
- `test-report.md`: the overstated sentence on the successor baseline is
  now backed by the anchor and names its tests.

## ADR conformance

ADR-0070 sections 1 and 3 and compliance item 3 are now enforced for the
first generation as well as for the chain. Section 2 holds for the phase
documents in tests after R2-F1. No
ADR byte changed in this fix; ADR-0070 keeps the digest the baseline's
origin cites.

## Engineering Quality deviations

None.

## Verification

Focused, on the working tree after the fixes for F1 and F2:

| Command                                                                                              | Outcome             |
| ---------------------------------------------------------------------------------------------------- | ------------------- |
| `test.mjs --file phase-instructions --file workflow-project --file doctor --file release-validation` | 342 tests, 0 failed |
| the three parity files on a copy without `plugins/banzai/phases/`                                    | 142 tests, 0 failed |
| the same on a copy without `phases/`, `guidance/` and `policies/`                                    | 142 tests, 0 failed |
| `release-validation`, `publication`, `phase-instructions` after F1 alone (fixing agent)              | 214 tests, 0 failed |

Final, run once on the final tree after the fix for R2-F1:

| Check id                                               | Command                    | Outcome                                                              |
| ------------------------------------------------------ | -------------------------- | -------------------------------------------------------------------- |
| `build-dist`                                           | `npm run build:dist`       | passed                                                               |
| `verify`                                               | `npm run verify`           | passed: typecheck; lint 0 errors, 424 warnings; 2183 tests, 0 failed |
| `format-check`                                         | `npm run format:check`     | passed                                                               |
| `release-validate`                                     | `npm run release:validate` | passed                                                               |
| whole suite on a copy without `plugins/banzai/phases/` | `node scripts/test.mjs`    | 2183 tests, 0 failed                                                 |

Historical, before the fix for R2-F1: the same four checks passed with 2183
tests on the tree review 2 read, after `npm run build`, which changed no
tracked file. On a copy without `plugins/banzai/phases/` review 2 measured
2182 passed and 1 failed.

The checks were run directly, not through the verification helper (F3).
`npm run release:check` was not run. Hosted CI has not run on this tree.

## Assurance critique

One pass over the two new tests, the adapted test and the fixture.

- Both new tests go through the real validator on a copied tree and assert
  the diagnostic and the unchanged bytes, not only an exit code.
- The mutation run shows the tests fail without the anchor.
- The fixture change adds no assertion; its guarantee is shown by the two
  runs without the plugin's text directories. No permanent test removes
  those directories, so a later test that reads plugin text outside the
  fixture would bring the dependency back unnoticed until the directories
  are removed. Review 2 found exactly such a test; the suite run on a copy
  without `phases/` is the check that shows none is left.

## Structural assessment

No trigger: the fix adds a constant and one comparison to the existing
successor module and changes one test fixture. Reuse search: the existing
`identity` helper of the generator module computes the anchored digest.
