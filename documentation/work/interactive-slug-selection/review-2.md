# Implementation Review: interactive-slug-selection

- Format: `banzai-feature-review/v1`
- Feature slug: `interactive-slug-selection`
- Review iteration: `2`
- Verdict: `changes_requested`
- Workspace digest: `not supplied`
- Review artifact: `documentation/work/interactive-slug-selection/review-2.md`

## Review Scope

This is a standalone resolution review of the findings the owner accepted from
[review-1.md](review-1.md) (F1-F6, chat triage on 2026-11-10: "Fix F1–F6").
It is closure-oriented: it checks each accepted finding against its
review-1 fix acceptance, plus the delta those fixes introduced. EQ-S1 was a
shadow record that was not accepted; it is not reopened.

Changed surface re-read since review-1:

- `plugins/banzai/lib/work-documents.mjs` (`occupied()`)
- `packages/orchestrator/test/run-identity.test.ts`, `interactive.test.ts`,
  `work-documents.test.ts`, `agent-control-cli.test.ts`, `cli-routing.test.ts`
- `packages/orchestrator/MODULES.md`, `packages/orchestrator/src/cli.ts`
  (`run` help)
- `documentation/work/interactive-slug-selection/implementation-report.md`,
  `test-report.md`, new `change-report.md`

Deterministic evidence:

- Helper `decide` for round `7f514c57-0b11-4e01-aaaa-a7e7d7c2dd12` (read-only,
  reviewer context) reports both required checks `unavailable`. This is
  expected: the reports changed after the round, and this reviewer runs in a
  different context. The physical records are attempts
  `verification-c7b3c48b-…` (`npm run verify`, exit 0, 2169 of 2169 tests,
  `build:check`) and `verification-70c948cd-…` (`git diff --check`, exit 0).
  All changed source, tests and `dist/banzai.mjs` predate the attempt start
  (11:40:16Z). The log contains passing runs of the four new tests.
- Focused reproductions, rerun because helper evidence is unavailable from
  this context:

  | Test file | Pattern | Passed |
  | --- | --- | --- |
  | `run-identity` | none | 4/4 |
  | `work-documents` | none | 17/17 |
  | `agent-control-cli` | none | 12/12 |
  | `interactive` | `slug step` | 4/4 |
  | `cli-routing` | `committed run prefixes` | 1/1 |

  The output root `packages/orchestrator/.dist-check-review` was removed
  afterwards. `git diff --check` exits 0.
- Node v24.11.1 check: switching `process.env.TZ` at runtime makes
  local-getter and UTC-getter prefixes differ for the new F1 instants
  (Tokyo: local `261111-`, UTC `261110-`; Los Angeles: local `261110-`, UTC
  `261111-`). Restoring the original zone works.
- Scratch reproduction with the installed `@inquirer/input` 5.1.2, which
  `@inquirer/prompts` re-exports: a rejecting async `validate` produces an
  `unhandledRejection`, and the prompt promise never settles. See R2-F1.

## Summary

All six accepted findings meet their review-1 fix acceptance. The F3 fix
introduces one new should-fix defect. The conflict query now throws
`ARTIFACT_UNSAFE_PATH` for a symlinked root or for a non-directory entry with
the full name. The interactive slug step awaits that query inside the inquirer
`validate` callback without handling the rejection, so in those
configurations the interactive session ends with an unhandled promise
rejection. Before the fix, a non-directory entry produced the FR7
"already exists" message; now it crashes the session.

## Findings

### R2-F1 — A conflict-query refusal inside the slug prompt becomes an unhandled rejection

- Severity: `should_fix`
- Category: `correctness`
- Confidence: `high`
- Evidence: `plugins/banzai/lib/work-documents.mjs:69-76`. Since the F3 fix,
  `occupied()` calls `safePath(…, { missing: true, directory: true })`, which
  throws `ARTIFACT_UNSAFE_PATH` in two cases:
  - a symlinked `documentation/`, `documentation/work/` or
    `documentation/initiatives/` component;
  - a regular file or symlink at `documentation/work/<slug>` or
    `documentation/initiatives/<slug>`.

  Before the fix, the second case was reported as a conflict.
  `packages/orchestrator/src/cli.ts:1355` passes that query as the interactive
  gateway. `packages/orchestrator/src/interactive.ts:974` awaits it inside
  `validate` with no handling. `@inquirer/core` runs keypress handlers as
  `void signal.current(event, rl)`
  (`node_modules/@inquirer/core/dist/lib/use-keypress.js:12`), so the
  rejection never reaches `io.input` or `main().catch`. Under Node's default
  `--unhandled-rejections=throw`, the process exits with a raw stack trace,
  not the CLI's `[CODE] message` refusal. `banzai run` and `control start`
  refuse cleanly; only the interactive step is affected. No test lets the
  gateway reject.
- Violates: FR7 (the prompt stays open with a message for an existing name);
  the CLI's established error presentation (`cli.ts` `main().catch`
  renders `[CODE] message`); review-1 F3 fix acceptance ("refused with
  `ARTIFACT_UNSAFE_PATH`", which the interactive path does not render as a
  refusal). Introduced by the F3 fix. EQ-05.
- Reproduction:
  1. In a scratch script, call `input({ message, validate: async () => {
     throw Object.assign(new Error("unsafe"), { code: "ARTIFACT_UNSAFE_PATH" })
     } }, { input, output })` with `PassThrough` streams.
  2. Write `x` and Enter. The process emits `unhandledRejection` with
     `ARTIFACT_UNSAFE_PATH`, and the prompt promise stays pending.
  3. In the product, the same path is reached by creating a regular file
     `documentation/work/<today>-login-fix` and typing `login-fix` at the slug
     prompt.
- Fix acceptance: a rejection from the slug-step conflict gateway does not
  escape the prompt. The step either keeps the prompt open with a bounded
  message or ends the session through the normal `[CODE] message` path. An
  interactive test with a rejecting fake gateway shows that `validate`
  resolves (or the session reports the code) and that `runner.start` is not
  called. FR7 messages for directories stay unchanged.

## Previously Accepted Findings

- F1 — verified. `run-identity.test.ts:29-46` fixes `TZ` to Asia/Tokyo and
  America/Los_Angeles for instants whose local and UTC dates differ, and
  restores the zone. A UTC-getter implementation fails it in both zones
  (confirmed numerically). The report claims (`implementation-report.md:171-175`,
  `test-report.md:96`) are now accurate.
- F2 — verified. `interactive.test.ts:1402-1437` covers three two-check
  inputs: `A`x94 (format and length, expects format), `Login_Fix` that also
  exists (expects format), and `b`x94 that also exists (expects length).
  `run-identity.test.ts:72-76` adds format over length. Any reordering fails,
  so the order claim is now true.
- F3 — verified against its fix acceptance. `occupied()` resolves through
  `safePath`. The test at `work-documents.test.ts:452-484` shows a symlinked
  `documentation/initiatives` is refused with `ARTIFACT_UNSAFE_PATH` by both
  the query and the binding, with no work directory created. The reuse-search
  line is recorded (`implementation-report.md:221-223`). Follow-on defect:
  R2-F1.
- F4 — verified.
  - `agent-control-cli.test.ts` "control start with a real runner…" shows
    `261110-agent-task` in the projected status, the run ID, the state and
    `documentation/work/261110-agent-task/`.
  - `cli-routing.test.ts` "committed run prefixes --slug…" spawns
    `dist/banzai.mjs run --slug fix-login` against an existing
    `documentation/initiatives/<prefix>fix-login/`, covering a midnight
    crossing. It asserts exit 1, `ARTIFACT_WORK_CONFLICT` naming that path, no
    work directory, and `NO_ACTIVE_RUN`.
  - The report maps all seven ADR-0066 compliance items, with the residual
    risk stated (`implementation-report.md:75-102`).
- F5 — verified. `MODULES.md` now describes the conflict query, the slug step
  with its `clock` and `workSlugs` options, and the run-identity prefix rule,
  each with an ADR-0066 reference. No entry contradicts the code.
- F6 — verified. `banzai help run` (`cli.ts:310-312`) states the prefix rule
  and the `261110-fix-login` example and points to `banzai status`.

## Deferred Coverage

- `npm run verify` was not rerun. The helper's `checked`/`passed` claim for
  round `7f514c57` is not reproducible from this context, so I relied on the
  physical logs above. This is not treated as false.
- The fixer's reverted mutation checks for F1 and F2 could not be observed. F1
  and F2 closure rests on the test inputs and the numeric TZ check, not on
  those claims.
- The `cli-routing` test would spawn real vendor preflight only if `run`
  stopped prefixing. That is acceptable regression behavior; the test was
  observed only in its passing form.
- `change-report.md` was read as closure evidence. Its creation trigger was
  not audited.
- `release:check`, the version bump and `format:check` were not run.
- EQ-S1 remains deferred and was not reassessed.

## Handoff

Human triage is required for R2-F1 only. F1-F6 are closed. If R2-F1 is
accepted, the fix belongs in `quick-fix`, scoped to error handling in the
interactive slug step and a test with a rejecting gateway. If it is rejected or
deferred, the run is finished by triage, not by a `pass` verdict. This review
changed no source, test, plan, ADR or report.
