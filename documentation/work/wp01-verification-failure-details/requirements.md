# WP1 · Verification failure details and retry warning

Status: in progress · Program:
[banzai 2.8–2.9](../release-2-8-2-9-program/tracker.md) · Source:
[brief, WP1](../release-2-8-2-9-program/brief.md#wp1--verification-failure-details-and-retry-warning)

## Problem

A run blocked in task verification lists each check's outcome but not why it
failed. The human-readable status shows no argv, exit code, stderr or log path,
and the block reason is one generic sentence. Retry re-runs the same command on
the same files without saying it will fail the same way.

## Authority

No new ADR. This is presentation over existing records: ADR-0015 (durable
attempt ledger) and ADR-0049 §5–§6 and §8 (physical attempt facts, truthful
outcome distinctions, redacted untrusted display input). No instruction text
changes.

## Requirements

- **R1 · Failure details.** For every check whose latest physical attempt did
  not succeed (failed, timed out, interrupted, unavailable, or without a
  terminal record), `banzai status` and the interactive status show: argv,
  repository-relative working directory, the outcome as exit code or signal,
  the failure category, duration, the timeout, the last 20 lines of stderr
  (stdout when stderr is empty), and repository-relative log paths.
- **R2 · Outcome labels.** Each label is derived from status, failure category
  and signal together:
  - `failed` + `command_exit`: the exit code;
  - `interrupted` + `timeout`: timed out after the descriptor timeout, with the
    stop signal;
  - `interrupted` + `command_exit` with a signal (Ctrl-C, manual or
    out-of-memory kill): the signal, and that the recorded exit code is
    synthetic;
  - `failed` + `process_start`: the executable could not be started; the
    placeholder stderr is not shown as command output;
  - `interrupted` + `output_limit`: the output limit was exceeded;
  - `runner_failure`: the runner stopped or lost the result before the check
    finished;
  - `started` without a terminal record: no result was recorded.
- **R3 · Block reason.** The block reason names each incomplete check with its
  required or supplemental marker and its outcome label, and points to the
  verification details. It never carries command output.
- **R4 · Retry warning.** When the blocked-run menu is shown for a task
  verification block whose retry target failed with a non-zero command exit,
  the runner compares that attempt's descriptor and observed input digest with
  the current ones. When both are unchanged, the retry choice reads
  "Retry anyway (same command, same files; expected to fail again)" and its
  confirmation explains why. Any other outcome, an unknown digest, or an
  unreadable record keeps the existing label. The comparison runs only when the
  menu is shown, never in `status()`.
- **R5 · Safe display.** Displayed output is redacted, stripped of ANSI
  sequences, terminal-escaped and bounded per line. Log reads are bounded to the
  file tail, contained in the repository and refuse symlinks; a missing or
  unreadable log is reported, not fatal.
- **R6 · JSON unchanged.** `banzai status --json` output keeps its current shape;
  no new projection is added in this package.
- **R7 · Shared fixture.** A reusable test fixture reproduces the phpcs case: a
  required lint check with a wrong config flag that fails with stderr, a second
  required check and a supplemental check. Later packages (WP2, WP3, WP9, WP10)
  and Gate 1 reuse it.

## Acceptance

- A fixture run with a failing required check shows every R1 field in the
  blocked interactive summary and in `banzai status`.
- Labels are correct for every R2 combination.
- The retry label changes only for an unchanged command exit (R4), and changes
  back when the command or the observed files change.
- Output stays redacted and terminal-escaped (R5).
- `npm run verify` and `npm run format:check` pass.

## Out of scope

- Running every required check in one pass (WP2) and correcting a command
  (WP9). After WP9, "Correct a verification command" joins the retry choice.
- A documented `banzai status --json` or `banzai control` projection of
  failure details (R6 records why).
