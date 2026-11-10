# Implementation Report: Interactive Slug Selection and Date-Prefixed Work Directories

- Slug: `interactive-slug-selection`
- Description: [description.md](description.md)
- Plan: [plan.md](plan.md)
- Decision: [ADR-0066](../../decisions/0066-date-prefixed-work-and-initiative-slugs.md)
- Mode: standalone strict

## Changed Files

Created:

- `documentation/decisions/0066-date-prefixed-work-and-initiative-slugs.md`
- `documentation/work/interactive-slug-selection/` (description, plan, this
  report, test report)
- `packages/orchestrator/test/run-identity.test.ts`

Modified:

- Decision records: `documentation/decisions/0054-git-visible-work-artifacts.md`
  (lifecycle line only), `documentation/decisions/0061-initiative-skill-and-documents.md`
  (lifecycle line only), `documentation/decisions/README.md`.
- Source: `packages/orchestrator/src/workflow/domain/run-identity.ts`,
  `packages/orchestrator/src/interactive.ts`, `packages/orchestrator/src/cli.ts`,
  `packages/orchestrator/src/agent-control-cli.ts`,
  `packages/orchestrator/src/work-documents.ts`,
  `packages/orchestrator/import-boundaries.mjs`,
  `plugins/banzai/lib/work-documents.mjs`,
  `plugins/banzai/lib/work-documents.d.mts`.
- Guidance and baseline: `plugins/banzai/policies/artifact-storage.md`,
  `plugins/banzai/skills/initiative/SKILL.md`,
  `packages/orchestrator/phase-guidance-current.json`,
  `packages/orchestrator/phase-guidance-current.sha256`, generated
  `packages/orchestrator/src/phase-resources.ts`,
  `packages/orchestrator/scripts/phase-resources-build.mjs`.
- Tests: `packages/orchestrator/test/interactive.test.ts`,
  `packages/orchestrator/test/agent-control-cli.test.ts`,
  `packages/orchestrator/test/work-documents.test.ts`,
  `packages/orchestrator/test/workflow.test.ts`,
  `packages/orchestrator/test/cli-routing.test.ts`,
  `packages/orchestrator/test/phase-instructions.test.ts`,
  `packages/orchestrator/test/release-validation.test.ts`.
- Documents: `documentation/artifact-storage.md`,
  `documentation/orchestrator.md`, `PROJECT_MANIFEST.md`,
  `packages/orchestrator/MODULES.md`, `publication-policy.json`.
- Review fixes: [change-report.md](change-report.md) records the closure of
  [review-1.md](review-1.md) findings F1-F6.

No file was deleted. No new module or folder was added to `src/`.

## Requirement Trace

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| FR1 | `workSlugDatePrefix` reads the supplied instant's local date | `run-identity.test.ts` |
| FR2 | `finalizeWorkSlug` keeps only the current prefix | `run-identity.test.ts`, slug-step tests |
| FR3 | `workSlugProblem`; `workDirectory` keeps its 100-character kebab-case rule | `run-identity.test.ts`, slug-step validation test |
| FR4 | `workSlugConflict` checks `documentation/work/` then `documentation/initiatives/` by full name | `work-documents.test.ts` |
| FR5-FR6 | `startRun` prints `Generated slug:` and asks one input; `selectWorkSlug` maps Enter, `y`, `Y` | "the slug step accepts the generated slug with Enter, y or Y" |
| FR7 | Async validation: format, then length, then conflict, with the exact messages; a refused check keeps the prompt open with its reason | "the slug step keeps its prompt open for invalid, long or existing names" |
| FR8 | `Slug:` and `Request:` lines, then the unchanged confirmation; the validated slug is reused | Enter/y/Y test; midnight test |
| FR9 | Prompt errors propagate as for the request prompt; no start call | "declining or interrupting the slug step starts no run" |
| FR10 | `cli.ts` `run` and `agent-control-cli.ts` `start` finalize `--slug`; `banzai help run` states the prefix | agent-control start tests (fake and real runner); spawned `banzai run` test in `cli-routing.test.ts` |
| FR11 | `createExecutionBinding` refuses either root, resolved through `safePath`, before creating the directory; it runs before `store.createRun` | `work-documents.test.ts`; runner refusal test in `workflow.test.ts`; spawned `banzai run` refusal test |
| FR12 | `WorkflowRunner.start` and resume paths do not re-date | existing runner and recovery tests, unchanged |
| FR13, FR16 | Installed artifact-storage policy | `phase-instructions.test.ts` policy assertion |
| FR14-FR15 | Initiative skill `start`, `next`, `record`, cell validation | inspection against FR14-FR15 |
| FR17 | Policy, initiative skill, `documentation/artifact-storage.md`, `documentation/orchestrator.md` | policy assertion; inspection |

Acceptance criteria AC1-AC16 map to tests and inspections in
[test-report.md](test-report.md).

## ADR Conformance

ADR-0066 Compliance and Confirmation items:

1. Finalizer cases (`261110-login-fix` from both forms,
   `261110-251001-login-fix`, `270105-`): `run-identity.test.ts`, which also
   fixes the process time zone to show the local, not UTC, calendar date.
2. Interactive accept, typed, invalid, conflict and date-change cases:
   `interactive.test.ts` slug-step tests.
3. `banzai run --slug` and `banzai control start --slug`:
   - `agent-control-cli.test.ts` starts a real `WorkflowRunner` (fake model
     adapters) through `control start --slug agent-task` on 2026-11-10 and
     shows `261110-agent-task` in run state, run ID, the projected status and
     `documentation/work/261110-agent-task/`.
   - `cli-routing.test.ts` spawns the built `banzai run --slug fix-login`
     against an existing `documentation/initiatives/<today>-fix-login/` and
     shows the refusal naming that path, no work directory and
     `NO_ACTIVE_RUN`.
   - Residual: a successful `banzai run --slug` is not spawned, because the
     run would continue into real vendor preflight; its finalization is the
     same single `finalizeWorkSlug` call the refusal test exercises.
4. Run start refusing an initiative-root conflict at library level:
   `work-documents.test.ts`.
5. Every production `WorkflowRunner.start` call passes a finalized slug: the
   three calls are in `cli.ts`, `interactive.ts` and `agent-control-cli.ts`; a
   search of `packages/orchestrator/src` found no other.
6. Installed policy and initiative skill: `phase-instructions.test.ts` pins the
   policy; the skill is checked by inspection.
7. Undated runs still resume: existing runner and recovery tests, which start
   and resume undated slugs, pass unchanged.

ADR-0066 decisions are also honored structurally: `run-identity.ts` stays a
pure domain module importing only `errors`; `interactive.ts` uses
`InteractiveIO` only, with the import policy granting
`./workflow/domain/run-identity.js` under `ADR-0066`; no schema, contract
version or agent-control request field changed; the policy change was
published as an instruction-baseline transition authorized by ADR-0066, and
the ADR-0054 lifecycle line is admitted by the exact image map in
`phase-resources-build.mjs`.

## Gaps and Scope

No functional gap and no scope expansion.

## Deviations From Plan

- T004: `inquirer-io.ts` was not changed; both prompts already accept an
  asynchronous `validate`.
- T006: the initiative tracker template was not changed. Its
  `<package-slug>` cell placeholder is the planned subject the skill now
  documents.
- T008: Prettier rewrote `src/interactive.ts`,
  `src/workflow/domain/run-identity.ts` and `test/interactive.test.ts` before
  the final suite ran, so the suite covers the formatted files.

## Final Verification

Current tree (after the review-2 fix R2-F1): `npm run format:check` (Prettier rewrote
`test/interactive.test.ts`), `npm run build`, `npm run typecheck` and
`npm run lint` (0 errors, existing warnings only), then the plan's v2
inventory through the standalone helper, workflow `strict`.

| Round | Check | Command | Outcome |
| --- | --- | --- | --- |
| `67b3fa38` | `final-verify` | `npm run verify` | Passed: typecheck, lint, 2170 of 2170 tests, `build:check`. |
| `67b3fa38` | `final-diff-whitespace` | `git diff --check` | Passed. |

The helper's applicability for round `67b3fa38` is `checked`, with both
required checks `passed` from direct physical attempts. Only this report, the
test report and the change report changed after that round.

Historical, after the review-1 fixes and before R2-F1: the plan's v2 inventory ran through
the standalone helper (`plugins/banzai/scripts/verification.cjs execute`,
workflow `strict`) after `npm run format:check` (Prettier rewrote two test
files), `npm run build`, `npm run typecheck` and `npm run lint` (0 errors,
existing warnings only).

| Round | Check | Command | Outcome |
| --- | --- | --- | --- |
| `7f514c57` | `final-verify` | `npm run verify` | Passed: typecheck, lint, 2169 of 2169 tests, `build:check`. |
| `7f514c57` | `final-diff-whitespace` | `git diff --check` | Passed. |

The helper's applicability for round `7f514c57` was `checked`, with both
required checks `passed` from direct physical attempts.

Historical/pre-fix rounds, before the review-1 fixes changed source and tests.
Order: `npm run build`, `npm run format:check` in `packages/orchestrator`
(Prettier rewrote three files), `npm run build` again, then the plan's v2
inventory through the installed standalone helper
(`plugins/banzai/scripts/verification.cjs execute`, workflow `strict`).

| Round | Check | Command | Outcome |
| --- | --- | --- | --- |
| `6d60f84a` | `final-verify` | `npm run verify` | Failed, exit 1: 2164 of 2165 tests passed. `publication.test.ts` "actual source/plugin/npm archive resources and source-map bytes must describe one candidate" reported `INSTRUCTION_PAYLOAD_MISMATCH`, because the source map was built before Prettier rewrote `src/`. The helper returned `VERIFICATION_EVIDENCE_INVALID` for this round. |
| `a6180f65` | `final-verify` | `npm run verify` | Passed after the rebuild: typecheck, lint, 2165 of 2165 tests, `build:check`. |
| `a6180f65` | `final-diff-whitespace` | `git diff --check` | Passed. |

The helper's applicability for round `a6180f65` is `checked`, with both
required checks `passed` from direct physical attempts. Before the full suite,
`npm run lint` reported 0 errors and only existing warnings.

After the suite passed, only these documents changed: the ADR-0066 rows in
`PROJECT_MANIFEST.md` and `documentation/decisions/README.md` moved to
Implemented, and this report and the test report were completed.
`release-validation.test.ts`, which reads the manifest and decision log, was
rerun after the row changes: 210 of 210 passed; `git diff --check` passed.

## Assurance Evidence

Added:

- `run-identity.test.ts` fails if the prefix uses UTC or unpadded fields
  (it fixes the process time zone to Asia/Tokyo and America/Los_Angeles for
  instants whose local and UTC dates differ), if another date's prefix is
  treated as present, if the length bound excludes the prefix, or if length is
  classified before format.
- Slug-step tests in `interactive.test.ts` fail if Enter, `y` or `Y` stop
  selecting the default, if a typed slug gains a second prefix, if a validation
  message or its order changes, if a conflicting default passes, if the slug
  is recomputed after midnight, if declining or interrupting reaches
  `runner.start`, or if a refused existence check rejects the validation
  instead of keeping the prompt open.
- The agent-control start tests fail if `control start` passes an undated
  slug, or if the real runner's state, run ID, status or work directory do
  not carry the prefixed slug.
- The spawned `banzai run` test in `cli-routing.test.ts` fails if `run` does
  not prefix `--slug`, or if an initiative conflict starts a run or creates a
  work directory.
- The work-documents conflict test fails if a conflict is checked by subject
  instead of full name, if the initiative root is ignored, if a refused
  binding leaves a work directory, if the query uses an unvalidated slug
  as a path, or if a symlinked root is followed instead of refused with
  `ARTIFACT_UNSAFE_PATH`.
- The runner refusal test in `workflow.test.ts` fails if a start with a taken
  initiative name creates a work directory or leaves an active run.
- The phase-instructions test fails if the delivered policy loses the
  `yymmdd-` rule or regains "without required dates".
- The release-validation test fails if any edit other than the exact ADR-0054
  annotation is admitted, or if ADR-0066 is not Accepted.

Reused: existing runner, recovery and status tests show that undated slugs of
earlier runs still resume and report unchanged (FR12).

Deferred: none.

## Engineering Quality Deviations

None.

## Notes for Assurance

- A successful `banzai run --slug` is not spawned (it would reach real vendor
  preflight); the spawned refusal test exercises the same finalization.
- FR13-FR15 change agent guidance only; they are checked by inspection.
- Delivery: `plugins/banzai/lib/` is a hook runtime path, so the change needs
  a release-train bump. At the owner's request, `npm run version:set -- 2.8.1`
  set version 2.8.1 in seven files, and the manifest's release-train version
  was updated. After `npm run build`, `npm run release:validate` passed, as did
  `release-validation`, `version-cli` and `version-set` tests.

## Structural Assessment

None. The change adds functions to existing owners (`run-identity.ts`,
`interactive.ts`, `work-documents.mjs`) and no new module, layer or boundary.
Reuse search for the conflict check: `safePath` in
`plugins/banzai/lib/project-files.mjs` already owns contained, symlink-free
path resolution, and `occupied()` uses it.

## Plan Task Completion

Format: `banzai-plan-task-completion/v1`

| Task | Status | Evidence | Gap or deviation |
| --- | --- | --- | --- |
| T001 | completed | [{"path":"documentation/decisions/0054-git-visible-work-artifacts.md","detail":"Partial supersession lifecycle line for ADR-0066."},{"path":"packages/orchestrator/scripts/phase-resources-build.mjs","detail":"Exact ADR-0054 image admission under ADR-0066."},{"path":"packages/orchestrator/test/release-validation.test.ts","detail":"Admits only the exact annotation while ADR-0066 is Accepted."}] | null |
| T002 | completed | [{"path":"packages/orchestrator/src/workflow/domain/run-identity.ts","detail":"Local-date prefix, finalization and final-slug classification."},{"path":"packages/orchestrator/test/run-identity.test.ts","detail":"Prefix, finalization, format and length cases."}] | null |
| T003 | completed | [{"path":"plugins/banzai/lib/work-documents.mjs","detail":"Full-name conflict query and binding refusal in both roots."},{"path":"packages/orchestrator/test/work-documents.test.ts","detail":"Both roots, refused binding, untrusted slug and symlinked root."}] | null |
| T004 | completed | [{"path":"packages/orchestrator/src/interactive.ts","detail":"Slug step with exact prompts and ordered validation."},{"path":"packages/orchestrator/test/interactive.test.ts","detail":"Accept, typed, validation, midnight and decline cases."}] | null |
| T005 | completed | [{"path":"packages/orchestrator/src/agent-control-cli.ts","detail":"control start finalizes --slug with an injectable clock."},{"path":"packages/orchestrator/src/cli.ts","detail":"run finalizes --slug; interactive conflict gateway."},{"path":"packages/orchestrator/test/agent-control-cli.test.ts","detail":"start --slug agent-task gives 261110-agent-task in state and status."},{"path":"packages/orchestrator/test/cli-routing.test.ts","detail":"Spawned run --slug refuses an existing initiative."}] | null |
| T006 | completed | [{"path":"plugins/banzai/policies/artifact-storage.md","detail":"yymmdd- rule replaces the no-date rule."},{"path":"plugins/banzai/skills/initiative/SKILL.md","detail":"Dated start, planned cells, next resolution and record."},{"path":"packages/orchestrator/phase-guidance-current.json","detail":"Baseline transition authorized by ADR-0066."}] | null |
| T007 | completed | [{"path":"documentation/artifact-storage.md","detail":"Prefix rule in place of the no-date rule."},{"path":"documentation/orchestrator.md","detail":"Slug step prompts and prefixed --slug example."},{"path":"PROJECT_MANIFEST.md","detail":"Sections 5, 9 and the ADR-0066 index row."}] | null |
| T008 | completed | [{"path":"documentation/work/interactive-slug-selection/implementation-report.md","detail":"Final verification results and trace."},{"path":"documentation/work/interactive-slug-selection/test-report.md","detail":"FR and AC evidence map."}] | null |
