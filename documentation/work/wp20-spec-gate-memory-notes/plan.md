# WP20 plan

Status: approved on 2026-11-06 with `Approve, Q1 (a)` · Requirements:
[requirements.md](requirements.md) · Authority:
[ADR-0062](../../decisions/0062-claude-memory-notes-in-the-manual-hook-gate.md)

WP20 is one change set with one report,
`documentation/work/wp20-spec-gate-memory-notes/implementation-report.md`. The
owner commits by hand.

The working tree already holds the ADR-0062 changes that come before this
plan: the ADR, its index, manifest and publication rows, `FIXTURE_PATHS`, and
the tracker entries. It also holds a one-line edit to the `initiative` skill
description that is not part of WP20; this plan does not touch it, and the
report names it as outside the change set.

## Approach

The hook stays one file. Two lexical predicates are added to it, and the
marker logic splits into a project path and a bookkeeping path:

- `isClaudeMemoryNote(target)` joins `isDocArtifact()` in the manual free
  check;
- `isBookkeeping(target)` decides which marker a write reads and writes.

Every write that is neither free nor bookkeeping-only reaches today's code
unchanged, including the reason strings and the `approved-<session>` name.

Tests come first and run against the unmodified hook. The hook bytes are then
fixed, the ADR's lifecycle metadata is made final, and only then is the
instruction transition published, because it pins both digests.

## Tasks

### T1 · Hook tests first (R1–R6, Acceptance)

- `packages/orchestrator/test/hook.test.ts`:
  - `runHook` gains optional `sessionId`, `scratchpadDir` and `toolInput`.
    The defaults keep today's payload, including the random session id, so
    existing tests do not change.
  - A sandbox helper creates `home/`, `tmp/`, `config/` and `scratch/` under
    one `mkdtemp` directory. It returns an env with `HOME`, `TMPDIR` and
    `CLAUDE_CONFIG_DIR` set, `PLUGIN_ROOT` and `CLAUDE_PLUGIN_ROOT` set to
    `undefined`, and a function that lists `tmp/banzai-spec-gate/`. Every
    path a test passes is built from the same sandbox string, so the
    lexical comparison never sees two spellings.
  - New tests, each in an adopted repository:
    1. A memory note under the sandbox `config/` gets no decision, and its
       PostToolUse writes no marker. In the same setup, `src/example.ts`'s
       PostToolUse writes `approved-<session>`.
    2. These still ask with the first-change reason:
       - `config/settings.json`;
       - `memory/../escape.md`, `memory/note.json`, `memory/sub/note.md` and
         `memory/.md`;
       - `projects/p/Memory/n.md`;
       - `src/example.ts`.
    3. `CLAUDE_CONFIG_DIR` variants:
       - a set value's note defers;
       - the same note under `$HOME/.claude` asks;
       - a trailing separator on the value still defers;
       - a relative value makes the note ask, and a note under
         `$HOME/.claude` also asks, so there is no fallback;
       - an empty value and an unset value (`undefined`) both fall back to
         `$HOME/.claude`, whose note defers.
    4. In one session id:
       1. a plan file asks with the bookkeeping reason and context;
       2. its PostToolUse writes only `bookkeeping-<session>`;
       3. a scratchpad file then gets `allow` with the bookkeeping reason;
       4. `src/example.ts` still asks with the first-change reason;
       5. after that write's PostToolUse, both write kinds get `allow`.
    5. A scratchpad write's PostToolUse writes only `bookkeeping-<session>`,
       and so does a write under `<config>/agent-memory/<name>/`.
    6. Mixed `apply_patch` writes:
       - a plan file and `src/example.ts` ask with the first-change reason,
         and the PostToolUse writes `approved-<session>`;
       - a plan file with a `documentation/` file, and a plan file with a
         memory note, are bookkeeping writes: each asks with the bookkeeping
         reason.
    7. These scratchpad targets are project writes, each in a fresh session:
       - with `TMPDIR` below the scratchpad, a target under the marker
         directory and any other scratchpad target;
       - with `CLAUDE_PLUGIN_ROOT` below the scratchpad, a target under the
         plugin root;
       - a target with a `Banzai-Spec-Gate` segment;
       - a target in a call whose `cwd` (an adopted repository created
         inside the scratchpad) lies below the scratchpad;
       - a target in a call with no `scratchpad_dir`, with a relative one, and
         with a non-string one; none of these crashes the hook;
       - on POSIX only, a case variant of the plans root.
    8. A pre-existing `approved-<session>` in the sandbox `tmp/` allows a
       plan file with today's reason.
    9. With only `bookkeeping-<session>` present, `config/settings.json`
       asks with the first-change reason.
    10. Runner mode: in a bound schema-11 implementing run (the fixture
        pattern of the existing `v${stateVersion}` test), an orchestrated
        write to a memory path gets `deny` with the unsafe-path reason.
    11. A manual `apply_patch` with a memory note and
        `.banzai/work/x/state.json` is denied, as today.
- Run `hook.test.ts` against the unmodified hook. These must fail:
  - test 1;
  - the deferring cases of test 3;
  - tests 4 and 5;
  - the bookkeeping cases of test 6.

  The rest must pass. The report records the failing list.

### T2 · Hook change (R1–R7)

- `plugins/banzai/hooks/spec-gate.cjs`:
  - header comment: one bullet for memory notes as a manual-only free path
    class, and one for the bookkeeping scope and its marker. The two pinned
    lines stay byte-identical, and no new line names `CLAUDE.md` unless it
    carries free-path wording;
  - helpers after `isDocArtifact()`, which stays unchanged:
    - `claudeConfigDir()`;
    - `isBelow(root, candidate, {orEqual})`, built on `path.relative`;
    - `isClaudeMemoryNote(target)`;
    - `bookkeepingRoots()`, which applies the `cwd`, marker-directory and
      plugin-root exclusions once per call;
    - `isBookkeeping(target)`;
  - the manual free check becomes
    `targets.every(t => isDocArtifact(t) || isClaudeMemoryNote(t))`;
  - after the runner branch:
    - `bookkeepingWrite` is true when no target is a project target, using
      the R4 definition;
    - PostToolUse writes `bookkeeping-<session>` for a bookkeeping write and
      `approved-<session>` otherwise;
    - PreToolUse applies the R5 order: project marker, then bookkeeping
      marker for a bookkeeping write, then the bookkeeping or first-change
      `ask`;
  - the marker directory is computed once, before the classification,
    because the exclusions need it;
  - no helper throws:
    - `scratchpad_dir` counts only when `typeof` is `'string'` and the path
      is absolute;
    - a throw while computing `<config>`, such as from `os.homedir()`, means
      no `<config>`;
    - the `banzai-spec-gate` segment test runs on the resolved target.
- `node --check` the hook and run `hook.test.ts` until green.
- `release:validate` stops before its layout scan, and `release-validation`
  fails on extraction until T5. So, for quick feedback, check every changed
  line that names `CLAUDE.md` against `INSTRUCTION_LAYOUT_ALLOWED_CONTEXTS`
  and `STALE_CLAUDE_REFERENCE_PATTERNS` by hand.

### T3 · Documentation (R8, R9)

- `plugins/banzai/hooks/README.md`: the R8 rows, paragraph, Product Notes
  line and Tuning bullet. No Prettier on `plugins/**`; keep the table aligned
  by hand.
- `plugins/banzai/AGENTS.md` Hook Gate:
  - the free-paths bullet adds Claude Code memory notes as manual-only. Its
    first line, which names `CLAUDE.md` beside "Free paths", stays
    byte-identical, and the new text follows `AGENTS.md`;
  - the Standalone bullet adds one sentence: approving a plan, subagent
    memory or scratchpad write allows only such writes, and the first code
    edit still asks.
- Copy the template byte for byte to
  `packages/orchestrator/test/fixtures/instruction-layouts/fresh-adoption/after/AGENTS.md`.
- In the README and the template, every new line that names `CLAUDE.md`
  carries free-path wording, and no phrase matches
  `STALE_CLAUDE_REFERENCE_PATTERNS`, such as "rules in `CLAUDE.md`" or "from
  CLAUDE.md".
- Run `instruction-layouts.test.ts` and `project-adoption.test.ts`.

### T4 · Lifecycle metadata and facts (R11)

- ADR-0062 status block, final text, which must not change after T5:

  ```text
  - Implementation state: Implemented in WP20: hook, tests, documentation and
    instruction transition; installed clients receive it with the 2.8 plugin
    release.
  ```

- `documentation/decisions/README.md` row: implementation Implemented.
- `PROJECT_MANIFEST.md`:
  - the ADR-0062 row becomes Implemented;
  - the `spec-gate.cjs` fact gains one sentence on the manual memory-note
    deferral and the separate bookkeeping approval scope.
- Tracker, under Q1 (a): the WP20 Gate 1 item gains the scratchpad step from
  requirements Q1.
- Prettier on the ADR, the manifest and the tracker only.

### T5 · Instruction transition (R10)

1. `npm run build`.
2. `node packages/orchestrator/scripts/instruction-baseline.mjs --describe`
   lists exactly `plugins/banzai/hooks/spec-gate.cjs`.
3. Write the authorization JSON in the session scratchpad:
   - the described predecessor and changes;
   - one authority: the ADR-0062 path, its current SHA-256, and this scope
     as one line:

     ```text
     Manual hook gate: Claude Code memory notes defer; host bookkeeping writes get their own approval scope
     ```

4. Run it with `--check`, then publish.
5. Save `git diff`, run `npm run build` again, and confirm that `git diff` is
   identical.

The report quotes the authorization.

### T6 · Close-out

- Run the final checks below and write the report:
  - R1–R12 with their evidence;
  - the T1 failing-first list;
  - a `git diff` of `spec-gate.cjs` showing no hunk inside `isDocArtifact()`
    or the pinned header line;
  - the ADR-0036 conclusion;
  - the Q1 host assumptions;
  - the follow-ups from the ADR;
  - the paths outside the change set.
- Set the tracker's WP20 row to `report ready`.

## Tests

| Requirement | Test                                                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| R1–R3       | `hook.test.ts` tests 1–3, 10, 11                                                                                                              |
| R4, R5      | `hook.test.ts` tests 4–9                                                                                                                      |
| R6          | existing `hook.test.ts` cases, unchanged                                                                                                      |
| R7, R9      | `release-validation.test.ts` layout checks after T5; `release-candidate-check.mjs`; `instruction-layouts.test.ts`; `project-adoption.test.ts` |
| R10         | `--describe` output; `release-validation.test.ts` baseline and extraction checks after T5                                                     |
| R11, R12    | `release-validation.test.ts` registration checks; `release:validate` stopping only at the deferred error                                      |

## Checks

- Focused, during work, through
  `node packages/orchestrator/scripts/test.mjs --file <name>.test.ts`:
  - `hook`;
  - `instruction-layouts`;
  - `project-adoption`;
  - `release-validation`.
- Final:
  - `npm run verify`;
  - `npm run format:check`;
  - `npx prettier --check` on the ADR, the manifest, the tracker and this
    work directory;
  - `release-validation.test.ts`, which runs the layout, hook and extraction
    checks on a fixture copy without Git history;
  - `npm run release:validate`, expected to stop only at the deferred
    `HOOK_CHANGED_WITHOUT_VERSION_BUMP`;
  - `node packages/orchestrator/scripts/release-candidate-check.mjs`, with
    the `node_modules` link workaround from WP19.

## Sequencing

T1 → T2 → T3 → T4 → T5 → T6.

- T5 needs final hook bytes (T2) and final ADR bytes (T4).
- A hook or ADR change after T5 means redoing T5 before close-out.

## Risks

- **An inherited environment changes test results.** If `CLAUDE_PLUGIN_ROOT`
  is set by the session that runs the tests, it triggers the exclusions or
  the plugin-source deferral. Mitigation: the sandbox env clears it, and
  test 7 sets it on purpose.
- **Path spellings differ on macOS.** `/var` and `/private/var` spell the same
  path differently. Mitigation: every test path comes from one sandbox
  string, and the hook compares lexically.
- **The layout scan rejects a new hook or template line.** `release:validate`
  stops before the scan, and the fixture-based tests can see it only after
  T5. Mitigation: the hand check in T2 and T3. If `release-validation.test.ts`
  still fails after T5, fix the line; a hook fix means redoing T5.
- **The ADR's digest drifts after the transition.** Mitigation: T4 fixes the
  lifecycle text before T5. Later status changes go to the index and the
  manifest only.
- **Host payload assumptions.** Covered by Q1.
