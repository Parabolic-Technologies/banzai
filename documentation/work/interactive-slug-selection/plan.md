# Development Plan: Interactive Slug Selection and Date-Prefixed Work Directories

Slug: `interactive-slug-selection`

- Requirements: [description.md](description.md), FR1-FR17 and AC1-AC16.
- Accepted ADRs:
  [ADR-0066](../../decisions/0066-date-prefixed-work-and-initiative-slugs.md)
  (Decisions 1-6), with the partially superseded
  [ADR-0054](../../decisions/0054-git-visible-work-artifacts.md) and
  [ADR-0061](../../decisions/0061-initiative-skill-and-documents.md) §1.
  Unchanged: [ADR-0018](../../decisions/0018-agent-supervised-banzai-cli-control.md),
  [ADR-0029](../../decisions/0029-eslint-backed-orchestrator-import-boundary-policy.md),
  [ADR-0044](../../decisions/0044-instruction-baseline-evolution.md).
- Manifest facts used: section 2 (`npm run build`, `npm run verify`, test
  driver `--file`), section 3 (import policy, pure domain modules), section 5
  (`interactive.ts`, `inquirer-io.ts`, `work-documents.ts`), section 8
  (required final suite `npm run verify`), section 9 (kebab-case slugs).

## Plan Authority

Applicable approved requirements, accepted ADR constraints, public and persisted
contracts, security and authorization boundaries, transaction and lifecycle
guarantees, compatibility, scope, and required verification evidence are binding.
Exact internal details remain binding when required by applicable authority or
concrete constraints; unlabelled explicit directives remain binding.

Only paragraphs or list items prefixed `Optional implementation guidance:` are
non-binding suggestions. A label covers that paragraph or list item, including
its nested content, and ends before the next sibling block. A different compliant
implementation within approved scope needs no reapproval, finding or deviation
report merely for differing from this guidance.

Guidance never overrides binding authority or expands scope. Resolve conflicts
and ambiguous commitments before dependent work; missing or ambiguous optionality
does not waive an explicit commitment.

## Human prerequisites

None for implementation or verification.

Delivery note, outside this plan's scope: T003 changes
`plugins/banzai/lib/`, a hook runtime path. `npm run release:check` and the PR
CI gate refuse with `HOOK_CHANGED_WITHOUT_VERSION_BUMP` until the owner selects
the next version with `npm run version:set -- <version>`. This plan does not
change the version.

## Technical Breakdown

1. **Pinned authority annotation.** ADR-0054 is an instruction-baseline
   authority. Its reciprocal ADR-0066 lifecycle line changes its bytes, so the
   exact before and after images must be admitted in
   `packages/orchestrator/scripts/phase-resources-build.mjs`, conditional on
   ADR-0066 being Accepted, in the same change as the line itself.
2. **Slug rule, pure domain.** `src/workflow/domain/run-identity.ts` owns the
   prefix rule (ADR-0066 Decision 3). It derives `yymmdd-` from local getters of
   a supplied `Date` instant, applies FR2 recognition, and classifies a final
   slug as valid, wrong format or too long (FR3). It never reads the ambient
   clock; callers pass the instant. `runId` and `requireSlug` keep their
   behavior; `WorkflowRunner.start` does not re-date its input.
3. **Name conflicts, shared library.** `plugins/banzai/lib/work-documents.mjs`
   owns the conflict rule (ADR-0066 Decision 4): a final slug conflicts when
   `documentation/work/<slug>/` or `documentation/initiatives/<slug>/` exists,
   compared by full name. A read-only query returns the conflicting
   repository-relative directory or none. `createExecutionBinding` refuses
   either conflict with the existing `ARTIFACT_WORK_CONFLICT` code and a
   message naming the path, before it creates any directory. Because run start
   calls it before `RunStore.createRun`, a refusal leaves no active run (FR11).
   Security enforcement point for classes 1 and 7: the existing slug pattern
   and contained-path checks in this module stay unchanged and run before any
   path use.
4. **Entry points.** Every production caller of `WorkflowRunner.start` passes
   a finalized slug (ADR-0066 Decision 3):
   - interactive `startRun` finalizes at slug-step submission;
   - `banzai run` finalizes the `--slug` value when the command starts;
   - `banzai control start` finalizes `--slug` when the command starts.
   The interactive session reads conflicts through a gateway composed in
   `cli.ts`, as it does for repository, model and authentication facts.
5. **Guidance.** The installed artifact-storage policy and the initiative skill
   state the rule for standalone work (ADR-0066 Decision 5). The policy is a
   pinned instruction resource, recorded as a baseline transition with ADR-0066
   as authority. After that transition, ADR-0066's bytes must not change.
6. **Compatibility.** Binding v3, state schema, run-ID format, agent-control
   contract 9.0.0, capabilities v9, status v7 and `directoryPattern` stay
   unchanged (ADR-0066 Decision 6). Existing undated directories, runs and
   bindings stay valid (FR12, FR16).

Manifest facts that become stale: section 9 naming convention; section 5
interactive bullet; section 10 ADR-0066 row state.

## Implementation Tasks

- [ ] **T001 - Record the ADR-0054 reciprocal link with pinned-image admission**

  Behavior: ADR-0054's Lifecycle Links gain one line, in the style of its
  existing "Amended by" entries, stating that ADR-0066 (accepted 2026-11-10)
  partially supersedes only its rule that a date does not become a required
  name prefix, for new work directories. Nothing else in ADR-0054 changes.

  Files: `documentation/decisions/0054-git-visible-work-artifacts.md`,
  `packages/orchestrator/scripts/phase-resources-build.mjs`,
  `packages/orchestrator/test/release-validation.test.ts`.

  Constraints:
  - Add one new image map with exactly the before and after SHA-256 of
    ADR-0054 (`resourceDigest` of its bytes), and append
    `{ decision: "documentation/decisions/0066-date-prefixed-work-and-initiative-slugs.md", images }`
    at the end of `RETAINED_AUTHORITY_AMENDMENTS`.
  - Add ADR-0066 to the test's `FIXTURE_PATHS` and add a test in the style of
    "ADR-0061 admits only its exact accepted ADR-0054 lifecycle annotation":
    the exact annotation is admitted while ADR-0066 is Accepted, and a
    different edit or a non-Accepted ADR-0066 is refused.
  - Do not run Prettier on ADR files.

  Mapping: ADR-0066 Lifecycle Links and Follow-ups.
  Evidence: the new release-validation test; `npm run build:check` within
  `npm run verify`.
  Review batch: A.

- [ ] **T002 - Add the date-prefix slug rule to the run-identity domain**

  Behavior:
  - Prefix from a supplied instant's local calendar date: two-digit year,
    zero-padded month and day, then `-` (FR1).
  - Finalization trims nothing and applies FR2: a candidate already starting
    with the current prefix is returned unchanged; any other candidate gets
    the prefix.
  - Classification of a final slug: lowercase kebab-case per
    `^[a-z0-9]+(?:-[a-z0-9]+)*$`, starting with the current prefix, at most
    100 characters (FR3). The result distinguishes wrong format from too long.

  Files: `packages/orchestrator/src/workflow/domain/run-identity.ts`, new
  `packages/orchestrator/test/run-identity.test.ts`.

  Constraints: the module stays a pure domain module. It reads only the
  supplied `Date`'s local getters and adds no imports beyond `errors`.
  Existing `runId` and `requireSlug` behavior does not change.

  Mapping: FR1-FR3; ADR-0066 Decisions 2-3 and Compliance item 1.
  Evidence: unit tests with instants built by the local `Date` constructor at
  local noon, so results do not depend on the machine time zone:
  2026-11-10 gives `261110-`; `login-fix` and `261110-login-fix` both give
  `261110-login-fix`; `251001-login-fix` gives `261110-251001-login-fix`;
  2027-01-05 gives `270105-`; `Login_Fix` is the wrong format; a 101-character
  final slug is too long.
  Review batch: A.

- [ ] **T003 - Check name conflicts in both roots in the shared library**

  Behavior:
  - A read-only query, given a repository root and a final slug, returns
    `documentation/work/<slug>` or `documentation/initiatives/<slug>` when
    that directory exists, otherwise none. The work root is checked first.
  - `createExecutionBinding` refuses either conflict with
    `ARTIFACT_WORK_CONFLICT` and a message beginning with the conflicting
    repository-relative path, before creating the work directory (FR4, FR11).

  Files: `plugins/banzai/lib/work-documents.mjs`,
  `plugins/banzai/lib/work-documents.d.mts`,
  `packages/orchestrator/src/work-documents.ts`,
  `packages/orchestrator/test/work-documents.test.ts`.

  Constraints:
  - Validate the slug with the existing `workDirectory` rule before any path
    use. Resolve paths only through the existing contained-path helpers.
  - The query creates nothing.
  - Keep the error code. Message wording may change.
  - Run `npm run build`, because `artifact-readers.mjs` and generated sources
    are rebuilt from these owners.

  Mapping: FR4, FR11; ADR-0066 Decision 4 and Compliance item 4; security
  classes 1 and 7.
  Evidence: work-documents tests. The query reports a work conflict, an
  initiative conflict and none for `login-fix` beside `261110-login-fix`
  (AC8). `createExecutionBinding` refuses an existing
  `documentation/initiatives/<slug>/` and creates no work directory (AC12).
  Review batch: B.

- [ ] **T004 - Add the interactive slug step**

  Behavior: the flow follows FR5-FR9 with the exact strings from the
  description:
  1. After the request prompt, print `Generated slug: <default>`, where
     `<default>` is the generator's slug finalized with the current instant.
  2. Ask one input, `Press Enter or y to accept it, or type your own slug:`.
     After trimming, empty input, `y` or `Y` select the generator's slug;
     other input is the engineer's candidate.
  3. On submission, finalize the selection with the instant read at
     submission. Validate inside the prompt and keep it open with exactly
     one FR7 message: format, then length, then conflict.
  4. Print `Slug: <final>` and `Request: <request>`, then the unchanged
     confirmation `Start this task with automatic workflow selection?`
     (default yes).
  5. Confirming calls `runner.start` with exactly that final slug, with no
     recomputation. Declining or interrupting starts nothing.

  Accepting after a date change selects the generator's slug with the new
  date, not the displayed default with a second prefix.

  Files: `packages/orchestrator/src/interactive.ts`,
  `packages/orchestrator/src/inquirer-io.ts` only if typing requires it,
  `packages/orchestrator/src/cli.ts`,
  `packages/orchestrator/import-boundaries.mjs`,
  `packages/orchestrator/test/interactive.test.ts`, and other test files whose
  scripted start flows gain the slug input.

  Constraints:
  - `InteractiveOptions` gains an optional clock (`() => Date`, default
    system time) and an optional conflict gateway. `cli.ts` composes the
    gateway from T003's query for the interactive session. Without a gateway
    the step skips only the conflict check, and run start's refusal remains
    authoritative.
  - `InteractiveInput.validate` may return a `Promise`, which both existing
    inquirer prompts already accept. Keep `interactive.ts` free of
    `@inquirer/*` imports.
  - Add an `ADR_0066` authority and the
    `interactive.ts -> ./workflow/domain/run-identity.js` runtime edge to the
    import policy.
  - The existing generator and its tests are unchanged.

  Optional implementation guidance: keep the final slug that passed
  validation in the step's closure and use it after the prompt resolves. A
  fake IO that bypasses `validate` should then compute the same value from
  the injected clock.

  Mapping: FR1, FR2, FR5-FR9; AC1-AC10; ADR-0066 Decisions 2-3 and
  Compliance item 2.
  Evidence: interactive tests with an injected clock and conflict gateway.
  - Enter and `Y` accept the default (AC1, AC2).
  - Typed `login-fix` and `261110-login-fix` give the same result (AC3);
    `251001-login-fix` gets the prefix (AC4).
  - The validate callback returns each exact FR7 message, including for an
    accepted conflicting default (AC5-AC7). AC8 is covered by T003's query.
  - A clock that moves past midnight between submission and confirmation
    still starts with the submitted slug (AC9).
  - Declining or an `ExitPromptError` at the slug step makes no
    `runner.start` call (AC10).
  Review batch: C.

- [ ] **T005 - Finalize `--slug` in `banzai run` and `banzai control start`**

  Behavior: both commands call `WorkflowRunner.start` with the `--slug` value
  finalized at the instant the command starts (FR10). Run state, run ID, work
  directory and status carry the final slug through the unchanged runner.
  Conflicts and invalid slugs are refused by run start (FR11).

  Files: `packages/orchestrator/src/cli.ts`,
  `packages/orchestrator/src/agent-control-cli.ts`,
  `packages/orchestrator/import-boundaries.mjs`,
  `packages/orchestrator/test/agent-control-cli.test.ts`.

  Constraints:
  - `executeAgentControlCommand` gains an optional trailing clock parameter
    defaulting to system time. Existing call sites and argument parsing stay
    unchanged.
  - Add `ADR_0066` runtime edges from `cli.ts` and `agent-control-cli.ts` to
    `./workflow/domain/run-identity.js`.
  - After this task, every production `WorkflowRunner.start` call in `src/`
    receives a finalized slug.

  Mapping: FR10, FR11; AC11, AC12; ADR-0066 Decisions 3 and 6, Compliance
  items 3 and 5.
  Evidence:
  - An agent-control CLI test with a fake runner and fixed clock shows that
    `start --slug fix-login` calls the runner with `261110-fix-login`.
  - Run-start refusal is covered by T003.
  - The `banzai run` wiring is checked by inspection: it is a single call of
    the T002 rule, and no test harness drives `cli.ts` `run`.
  - A search confirms that no other production `.start({` call exists.
  Review batch: C.

- [ ] **T006 - State the rule in the installed policy and the initiative skill**

  Behavior:
  - `plugins/banzai/policies/artifact-storage.md` replaces "without required
    dates" with the ADR-0066 rule: new work and initiative directories use
    `yymmdd-<subject>` from the local date, only today's prefix counts as
    present, the full name must be unused under both roots, and existing
    undated directories keep their names for explicit continuation (FR13,
    FR16). The CLI entry points finalize runner slugs themselves.
  - `plugins/banzai/skills/initiative/SKILL.md` applies the same rule:
    - the Documents slug bullet and `start <slug>`: finalize, then refuse a
      full name that exists under either root (FR14);
    - a package's Work directory cell holds the planned subject slug until the
      package starts;
    - `next` hands off the dated name for the current date and resolves a
      planned cell to the single existing `documentation/work/<6 digits>-<subject>/`
      directory, listing several matches and asking which one;
    - the follow-on `record` writes the full created name into that cell;
    - cell validation accepts both forms (FR15).
  - Edit the tracker template only if its placeholder text would contradict
    this.

  Files: `plugins/banzai/policies/artifact-storage.md`,
  `plugins/banzai/skills/initiative/SKILL.md`, possibly
  `plugins/banzai/skills/initiative/references/tracker-template.md`,
  `packages/orchestrator/phase-guidance-current.json`,
  `packages/orchestrator/phase-guidance-current.sha256`, generated
  `packages/orchestrator/src/phase-resources.ts`, and one pinning assertion in
  an existing instruction test.

  Constraints:
  - Run `npm run build` first. Then record the policy change with
    `node packages/orchestrator/scripts/instruction-baseline.mjs`: use
    `--describe`, write the authorization, run `--check`, then publish. The
    only authority is ADR-0066 at its current SHA-256, with a scope matching
    `^[A-Za-z0-9 ,.:;-]{1,160}$`.
  - Do not edit ADR-0066 after this transition.
  - Do not run Prettier on plugin policies or skills.
  - Do not edit `skills/orchestrate/`, `phases/`, the hook or other skills.

  Mapping: FR13-FR17; AC14-AC16; ADR-0066 Decision 5 and Compliance item 6.
  Evidence:
  - One assertion that the delivered artifact-storage policy states the
    `yymmdd-` rule and no longer contains "without required dates".
  - `npm run build:check` within `npm run verify` checks the baseline and
    generated parity.
  - The initiative skill wording is checked by inspection against FR14-FR15.
  Review batch: D.

- [ ] **T007 - Update maintained documents and the manifest**

  Behavior:
  - `documentation/artifact-storage.md` states the prefix rule in place of
    "without required dates".
  - `documentation/orchestrator.md` describes the interactive slug step with
    its exact prompts. Its `banzai run --slug` and `banzai control start --slug`
    text says that the run slug is the prefixed value, for example
    `my-explicit-slug` starting run `261110-my-explicit-slug` on 2026-11-10.
  - `PROJECT_MANIFEST.md` section 9 records the date-prefixed new-directory
    convention; section 5's interactive bullet mentions the slug step.
  - The ADR-0066 row moves to `Implemented` only after T008 passes. The
    decision-log row records the implementation state.
  - ADR-0066's own file is not edited.

  Files: `documentation/artifact-storage.md`, `documentation/orchestrator.md`,
  `PROJECT_MANIFEST.md`, `documentation/decisions/README.md`.

  Constraints: change only the manifest facts this work makes stale, under
  the `project-manifest` writing rules. Keep Markdown wrapped at 80 columns.

  Mapping: FR17, AC16; ADR-0066 Follow-ups.
  Evidence: inspection, plus `npm run verify`, whose release-validation
  fixtures read the manifest.
  Review batch: D.

- [ ] **T008 - Verify and report**

  Behavior:
  - Run `npm run build`, then the inventory checks below once the work has
    stabilized.
  - Run `npm run format:check` in `packages/orchestrator`. If it rewrites
    files, rerun affected checks.
  - Write `implementation-report.md` and `test-report.md` in this directory,
    mapping FR1-FR17 and AC1-AC16 to evidence.
  - Record the delivery note about the version bump as a follow-up.

  Mapping: all FRs; manifest section 8 required final suite.
  Evidence: the inventory below.
  Review batch: E.

## Consistency Check

- FR coverage:

  | FR | Tasks |
  | --- | --- |
  | FR1-FR3 | T002, used by T004, T005 |
  | FR4 | T003, T004 |
  | FR5-FR9 | T004 |
  | FR10 | T005 |
  | FR11 | T003, T005 |
  | FR12 | Runner and binding unchanged; existing resume tests in `npm run verify` |
  | FR13-FR16 | T006 |
  | FR17 | T006, T007 |

- AC coverage:

  | AC | Tasks |
  | --- | --- |
  | AC1-AC7, AC9, AC10 | T004 |
  | AC8, AC12 | T003 |
  | AC11 | T005 |
  | AC13 | Existing behavior, unchanged code path |
  | AC14, AC15 | T006, by inspection |
  | AC16 | T006, T007 |

- ADR-0066 decisions:

  | Decision | Tasks |
  | --- | --- |
  | 1 | T002-T007 |
  | 2 | T002 |
  | 3 | T002, T004, T005 |
  | 4 | T003 |
  | 5 | T006 |
  | 6 | No contract edits; T005 search; existing tests |

  Every Compliance item maps to T002-T006 evidence. Lifecycle Links:
  ADR-0061 is already recorded; ADR-0054 is recorded by T001.
- No Proposed ADR is open. ADR-0066 is Accepted.
- Manifest transitions: section 5, section 9 and the section 10 row (T007).
- Plan security exposure: the plan uses the existing slug pattern and
  contained-path checks for classes 1 and 7 (T003). It adds no trust boundary,
  permission, secret or network path.
- Engineering Quality:
  - EQ-03: new domain imports are declared in the import policy (T004, T005).
  - EQ-04: slugs are validated before path use (T003).
  - EQ-07: no orchestrate, hook, contract or schema edits (T006).
  - EQ-09: compatibility per ADR-0066 Decision 6.

```banzai-verification-obligations/v2
{
  "schema": "banzai-verification-obligations/v2",
  "schemaVersion": 2,
  "complete": true,
  "planRemainderSha256": "a0e954f1329515fa9c4454163153b096d8179324e1b68312d50e864b79cad754",
  "checks": [
    {
      "id": "final-verify",
      "name": "Required final suite: typecheck, lint, tests and build parity",
      "requirementRefs": [
        "T001",
        "T002",
        "T003",
        "T004",
        "T005",
        "T006",
        "T007",
        "T008",
        "FR1",
        "FR2",
        "FR3",
        "FR4",
        "FR5",
        "FR6",
        "FR7",
        "FR8",
        "FR9",
        "FR10",
        "FR11",
        "FR12",
        "FR17"
      ],
      "command": "npm",
      "args": [
        "run",
        "verify"
      ],
      "cwd": ".",
      "timeoutMs": 2700000,
      "evidence": "fresh",
      "sources": [
        {
          "path": "package.json",
          "sha256": "9034233f55a05f90f062a3f1a15d1a848bf95b6dff92f8935bf9d53d5f1ddb22"
        }
      ],
      "materialization": null
    },
    {
      "id": "final-diff-whitespace",
      "name": "Final source diff whitespace validation",
      "requirementRefs": [
        "T008"
      ],
      "command": "git",
      "args": [
        "diff",
        "--check"
      ],
      "cwd": ".",
      "timeoutMs": 30000,
      "evidence": "fresh",
      "sources": [],
      "materialization": null
    }
  ],
  "absenceReason": null
}
```
