# Change Report: Live Harness Codex Fixture

- Date: 2026-11-10
- Found by: Gate 1 item 4 of the
  [2.8–2.9 program](../release-2-8-2-9-program/tracker.md). The owner approved
  this quick-fix in chat on 2026-11-10 (`Ок, давай quick-fix`).
- Upstream feature artifacts: none. The live suite comes from
  [ADR-0046](../../decisions/0046-supervised-live-e2e.md).

## What changed

1. `prepareScenario` in `packages/orchestrator/src/live-compatibility.ts` now
   creates the source canary's parent directory, `src/`, in each disposable
   candidate clone.
2. `writeCodexContract` in `packages/orchestrator/src/adapters.ts` now creates
   `<runDirectory>/attempts/`. Every Codex invocation writes its `-o` result
   file there.
3. The fake Codex in `packages/orchestrator/test/live-compatibility.test.ts`
   now behaves like the real CLI in two ways:
   - its write probe reports `ENOENT` when the target's parent directory is
     missing, and `EPERM` otherwise;
   - it writes `-o` only into an existing directory. Otherwise it reports the
     failure on stderr and still exits 0.

## Why

The first `npm run compatibility:live -- --confirm-live` on `fa79c8b` (2.8.1)
used Codex 0.166.0 and Claude Code 2.1.322. Every Claude check passed, and two
Codex checks failed:

- **`codex.source_denied`: `DENIAL_NOT_OBSERVED`.** The candidate is a clone of
  this repository, which has no root `src/`. The probe's write to
  `src/live-source-canary.txt` failed with `ENOENT` before the sandbox decided.
  The observer correctly accepts only `EACCES`, `EPERM` or `EROFS` as denial
  evidence. `codex sandbox -P :read-only` reproduced this without a model call:
  without `src/` the probe reports `ENOENT`, and with `src/` it reports `EPERM`.
- **`codex.structured_result`: `MODEL_INVOCATION_FAILED`.** A diagnostic
  wrapper around `runLiveCompatibility` kept every child process's output. It
  showed that Codex completed the review, returned a valid `pass` result and
  exited 0. However, it logged
  `Failed to write last message file ".../raw/codex/attempts/review-1-result.json": No such file or directory`.
  The live raw root has no `attempts/`, so `readCodexResult` threw
  `CODEX_RESULT_MISSING`.

Both defects date from `0e140ae` (v2.3.0). The old fake Codex hid both: it
created the `-o` directory itself and reported `EPERM` without looking at the
file system. Ordinary runs were unaffected, because their run directory already
has `attempts/`. The Codex 0.166.0 event stream matched what the adapter
expects.

## Security exposure

None applies. The change creates two directories in runner-owned or disposable
locations from fixed path constants. The read-only denial checks and the
`ENOENT` exclusion stay as they were.

## Files changed

- Production: `packages/orchestrator/src/adapters.ts`,
  `packages/orchestrator/src/live-compatibility.ts`.
- Tests: `packages/orchestrator/test/live-compatibility.test.ts`.
- Docs: this report.

## Documentation sync

No maintained document describes the canary path or the Codex `-o` location,
and `PROJECT_MANIFEST.md` facts are unchanged.

## ADR conformance

ADR-0046 is unchanged. The suite still requires an observed read-only denial
for both canaries. The fix only lets the source write reach the sandbox.

## Engineering Quality deviations

None. Reuse search: the `mkdir(..., { recursive: true })` calls already in
`writeCodexContract` and `prepareScenario` were extended, and no helper was
added. No structural assessment trigger applies.

## Verification

- Before the production change, the stricter fake made 7 of the tests in
  `live-compatibility.test.ts` fail. They reported the live failure exactly:
  `codex.source_denied` `DENIAL_NOT_OBSERVED` and `codex.structured_result`
  `MODEL_INVOCATION_FAILED`.
- After the change, focused run with
  `node scripts/test.mjs --file live-compatibility.test.ts --file adapters.test.ts --file planning-review-adapters.test.ts`:
  124 of 124 pass.
- `npx prettier --check` on the three changed source and test files passes.
- `node packages/orchestrator/scripts/release-candidate-check.mjs` exits 0.
  Its full `npm run verify` passes typecheck, lint, 2170 of 2170 tests and
  `build:check`. `release:validate`, the publication check and the committed
  smoke also pass. The check builds in an isolated copy, so it does not refresh
  the untracked local `packages/orchestrator/dist/banzai.mjs` that
  `npm run compatibility:live` runs.
- Live suite on `b8b6d1b`, after `npm run build:dist`, Codex 0.166.0: status
  `pass` with Claude Code 2.1.322 and again with 2.1.290. All 17 checks pass,
  with 2 model invocations per run. A rerun on the stale bundle reproduced
  both original failures.

## Assurance critique

The existing pass-path tests protect both guarantees, because their fake now
reproduces the observed vendor behavior. No new test case duplicates them. The
live suite confirms both fixes against the real vendor CLIs.
