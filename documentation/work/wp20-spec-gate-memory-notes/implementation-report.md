# WP20 implementation report

Slug: `wp20-spec-gate-memory-notes` · Requirements:
[requirements.md](requirements.md) · Plan: [plan.md](plan.md) · Authority:
[ADR-0062](../../decisions/0062-claude-memory-notes-in-the-manual-hook-gate.md)
(accepted 2026-11-05, choice 1 B) · Plan approved on 2026-11-06 with
`Approve, Q1 (a)`.

WP20 is one change set. Nothing is staged or committed.

## What changed

- `plugins/banzai/hooks/spec-gate.cjs`:
  - two header-comment bullets;
  - `claudeConfigDir()`, `segmentsBelow()`, `isClaudeMemoryNote()`,
    `bookkeepingRoots()` and `isBookkeeping()` after `isDocArtifact()`;
  - the manual free check also accepts memory notes;
  - the marker block now classifies the write, writes `approved-<session>` or
    `bookkeeping-<session>`, and adds the bookkeeping `allow` and `ask`
    branches before today's first-change `ask`.
- `packages/orchestrator/test/hook.test.ts`:
  - `runHook` takes an optional session id, `scratchpad_dir` and tool input,
    and returns `additionalContext`;
  - a sandbox helper and eleven new tests;
  - a memory-path assertion in the existing v10 and v11 bound-run test.
- `plugins/banzai/hooks/README.md`:
  - four decision-table rows;
  - the approval-marker paragraph;
  - a Product Notes bullet;
  - the Tuning bullet.
- `plugins/banzai/AGENTS.md` Hook Gate and its byte-identical copy
  `packages/orchestrator/test/fixtures/instruction-layouts/fresh-adoption/after/AGENTS.md`.
- Instruction transition: `packages/orchestrator/phase-guidance-current.json`,
  `phase-guidance-current.sha256` and the generated `src/phase-resources.ts`.
- ADR-0062 and its registration:
  - the ADR itself;
  - `documentation/decisions/README.md`;
  - `publication-policy.json`;
  - `FIXTURE_PATHS` in `release-validation.test.ts`;
  - `PROJECT_MANIFEST.md`: the ADR row and the hook fact.
- `documentation/work/release-2-8-2-9-program/tracker.md`:
  - the WP20 row and the reservation;
  - the owner decisions;
  - the WP20 Gate 1 item, with the Q1 (a) scratchpad step.

Outside this change set: the one-line description edit in
`plugins/banzai/skills/initiative/SKILL.md`, which predates WP20 and was not
made in this session.

## Requirement trace

| Requirement             | Implementation                                         | Evidence                                                                                                                                 |
| ----------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| R1 `<config>`           | `claudeConfigDir()`                                    | Tests "only an exact memory-note path defers…" (relative value, no fallback) and "CLAUDE_CONFIG_DIR selects the memory root…"            |
| R2 memory note          | `isClaudeMemoryNote()`                                 | Same two tests: exact shape, `..`, `.json`, nested, `.md`, case variant                                                                  |
| R3 deferral             | manual free check                                      | "a manual memory-note write defers…"; "a memory note beside a non-historical .banzai/work target is still denied"                        |
| R4 bookkeeping target   | `bookkeepingRoots()`, `isBookkeeping()`                | "scratchpad and subagent-memory writes…"; "bookkeeping roots fail closed…" (marker dir, plugin root, segment, `cwd`, payload, case)      |
| R5 decisions            | marker block                                           | "a bookkeeping approval allows only bookkeeping writes…"; both patch tests; "an existing project marker…"; "a bookkeeping marker alone…" |
| R6 unchanged            | no change to runner, adoption, deferrals, parsing      | Existing hook tests pass unchanged; bound-run memory path `deny`; `hooks.json` has no diff                                               |
| R7 hook text            | header bullets; pinned lines untouched                 | No changed line names `CLAUDE.md`; `isDocArtifact()` body hash equal to `HEAD`; layout checks in `release-validation.test.ts`            |
| R8 README               | rows, paragraph, notes, tuning                         | Review of the diff; layout checks                                                                                                        |
| R9 template             | Hook Gate bullets; fixture copy                        | `cmp` identical; `instruction-layouts` 2 of 2; `project-adoption` 37 of 37                                                               |
| R10 transition          | one transition, scope `spec-gate.cjs`                  | `--describe`, `--check`, publish and rebuild below                                                                                       |
| R11 lifecycle and facts | ADR implementation state, index, manifest, Gate 1 item | `release-validation` registration checks                                                                                                 |
| R12 release train       | no version change                                      | `release:validate` stops only at the deferred error                                                                                      |

## Tests

Run against the unmodified hook first. Five new tests failed, as planned:

- "a manual memory-note write defers and writes no marker, while a code write
  still does";
- "CLAUDE_CONFIG_DIR selects the memory root, with $HOME/.claude when unset or
  empty";
- "a bookkeeping approval allows only bookkeeping writes until a code write is
  approved";
- "scratchpad and subagent-memory writes record only the bookkeeping marker";
- "bookkeeping beside free paths or memory notes is a bookkeeping write".

The other 22 hook tests passed, including the six new fail-closed tests and the
bound-run memory-path assertion. After the hook change, all 27 passed except
"the real hook denies both planning kinds…". That test failed with
`INSTRUCTION_RESOURCE_MISMATCH` until the transition was published, and then
passed.

Each new test protects one guarantee:

- the memory-note deferral and its missing marker;
- exact-match rejection;
- config-root selection;
- bookkeeping scope separation;
- marker choice;
- the project-target rule for mixed patches;
- the fail-closed exclusions;
- compatibility with an existing `approved-<session>`;
- the bookkeeping marker never allowing a project write;
- the unchanged `.banzai/work/` denial.

The tests set `HOME`, `TMPDIR` and `CLAUDE_CONFIG_DIR`, clear `PLUGIN_ROOT`
and `CLAUDE_PLUGIN_ROOT`, and never touch the real `~/.claude` or marker
directory.

## Instruction transition

`instruction-baseline.mjs --describe` listed exactly one change:
`plugins/banzai/hooks/spec-gate.cjs`, `93659be2…` to `fab91f12…`, from
predecessor `c84d822c…`. The authorization, kept in the session scratchpad,
was:

```json
{
  "schema": "banzai-instruction-authorization/v1",
  "schemaVersion": 1,
  "predecessorSha256": "c84d822c0b06001cd9ff60790fc55d065db090b308aa9adae434e6fa8be9ff12",
  "authorities": [
    {
      "path": "documentation/decisions/0062-claude-memory-notes-in-the-manual-hook-gate.md",
      "sha256": "e28a014f67d2ddc4d0142f1789f7531cff3085448fd07ca3277bdfae471012ef",
      "scope": "Manual hook gate: Claude Code memory notes defer; host bookkeeping writes get their own approval scope"
    }
  ],
  "scope": ["plugins/banzai/hooks/spec-gate.cjs"]
}
```

`--check` and the publication both returned successor `1def0308…`. A second
`npm run build` left `git diff` and `git status` byte-identical. The ADR's
implementation state was final before the authorization was written; any
later edit to the ADR breaks this authority.

## ADR-0062 conformance

| Compliance row     | Evidence                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Memory notes defer | Test 1, written first and failing against the unmodified hook                                                                        |
| Exact match        | Tests 2 and 3, including the trailing separator, empty and unset values, and a relative value without fallback                       |
| Bookkeeping (B)    | Tests 4–9; marker directory and plugin root placed below the scratchpad; `Banzai-Spec-Gate` segment; `cwd` below; POSIX case variant |
| Runner mode        | Bound v10 and v11 runs deny a memory path                                                                                            |
| Shared check       | `isDocArtifact()` unchanged; pinned lines untouched; fixture identical; layout checks pass                                           |
| Transition         | Above                                                                                                                                |
| Registration       | Index, `publication-policy.json`, manifest index and `FIXTURE_PATHS`                                                                 |

ADR-0036: its free paths are unchanged, and memory notes are a separate
manual-only class, so ADR-0036 is neither amended nor the authority.

## Checks

All run on 2026-11-06 after the transition. The candidate check ran before
this section and the tracker close-out were written;
`release-validation.test.ts` and `release:validate` were rerun after them.

| Command                                                                  | Result                                                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `hook.test.ts`                                                           | 27 of 27.                                                                                                          |
| `instruction-layouts.test.ts`, `project-adoption.test.ts`                | 2 of 2; 37 of 37.                                                                                                  |
| `release-validation.test.ts`                                             | 208 of 208.                                                                                                        |
| `npm run verify`                                                         | Pass: typecheck clean; lint 0 errors (426 warnings, as before); 2054 of 2054 tests; `build:check`.                 |
| `npm run format:check`; `prettier --check` on the changed root documents | Pass.                                                                                                              |
| `npm run release:validate`                                               | Stops only at the deferred `HOOK_CHANGED_WITHOUT_VERSION_BUMP`, which it checks before the layout and hook checks. |
| `node packages/orchestrator/scripts/release-candidate-check.mjs`         | Pass: 2054 of 2054 tests, release check, publication (620 source files) and committed smoke; WP19 link workaround. |

The candidate check ran with the two local links (`node_modules/.bin/banzai`
and the dangling `node_modules/node_modules`) set aside. Both were restored to
their exact targets afterwards, as in WP19.

## Structural assessment

- Trigger: a new approval state (the bookkeeping marker) in the manual gate,
  and new lexical path classification.
- Container: `plugins/banzai/hooks/spec-gate.cjs`, the manual branch.
- Reuse search:
  - `isDocArtifact()` is shared with runner planning, so ADR-0062 rules it
    out;
  - `repositoryPath()` is a runner-only `startsWith` check that throws;
  - `safePath()` in `plugins/banzai/lib/project-files.mjs` reads the file
    system, is asynchronous and accepts only paths inside the repository.

  None fits a lexical test against host directories.

- Disposition: retained in the hook. It is a single pinned CommonJS file whose
  manual branch already owns the marker. Importing `lib/` for these checks
  would add a dynamic-import dependency on the hot path, and `lib/` changes
  need a version bump.
- Invariants:
  - every mismatch is a project write;
  - only PostToolUse writes markers;
  - the project-write strings and marker name are unchanged.
- Verification: the hook tests above.
- Authority: within scope.

## Deviations from the plan

- Test 10 is an assertion inside the existing v10 and v11 bound-run test
  instead of a separate test, because that test already builds the bound
  fixture.
- The planned `isBelow(root, candidate, {orEqual})` helper is
  `segmentsBelow()` plus an inline equality check. `isClaudeMemoryNote()`
  needs the segments, and only `bookkeepingRoots()` needs "at or below".
- The first final run found a typecheck error under
  `exactOptionalPropertyTypes` in the new test helper. It was fixed, and the
  checks were rerun.

No functional gap and no scope expansion. Engineering Quality deviations:
none.

## Notes for assurance

- Q1 (a) host assumptions, not provable by tests:
  - `scratchpad_dir` is present in both events of a call;
  - the plans directory follows `CLAUDE_CONFIG_DIR`.

  The WP20 Gate 1 item now checks the first with the installed 2.8 plugin.
  If the second fails, plan files stay project writes.

- Windows: `path.relative` compares case-insensitively, as ADR-0062 states;
  CI runs on Ubuntu only, and the case-variant test is POSIX-only.
- Installed clients receive the change only after the 2.8 version bump.

## Follow-ups

- From ADR-0062: whether `<config>/settings.json` and installed plugins should
  prompt on every write; support for custom memory and plan directories.
- WP12 keeps the Hook Gate free-path wording when it slims the template.

## Plan Task Completion

Format: `banzai-plan-task-completion/v1`

| Task | Status    | Evidence                                                                                                                                                                                                                                     | Gap or deviation |
| ---- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| T1   | completed | [{"path":"packages/orchestrator/test/hook.test.ts","detail":"Sandbox helper, eleven new tests and the bound-run memory-path assertion; five failed first as planned."}]                                                                      | null             |
| T2   | completed | [{"path":"plugins/banzai/hooks/spec-gate.cjs","detail":"Memory-note deferral, bookkeeping roots and the separate bookkeeping marker; pinned lines unchanged."}]                                                                              | null             |
| T3   | completed | [{"path":"plugins/banzai/hooks/README.md","detail":"Decision rows, marker paragraph, Product Notes and Tuning."},{"path":"plugins/banzai/AGENTS.md","detail":"Hook Gate memory notes and bookkeeping scope; fixture copied byte for byte."}] | null             |
| T4   | completed | [{"path":"documentation/decisions/0062-claude-memory-notes-in-the-manual-hook-gate.md","detail":"Final implementation state before the transition."},{"path":"PROJECT_MANIFEST.md","detail":"ADR-0062 Implemented and the hook fact."}]      | null             |
| T5   | completed | [{"path":"packages/orchestrator/phase-guidance-current.json","detail":"One transition citing ADR-0062 for spec-gate.cjs only."}]                                                                                                             | null             |
| T6   | completed | [{"path":"documentation/work/wp20-spec-gate-memory-notes/implementation-report.md","detail":"Final checks, trace and assessment."}]                                                                                                          | null             |
