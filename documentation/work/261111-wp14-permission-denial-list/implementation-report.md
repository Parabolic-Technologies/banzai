# WP14 implementation report

Slug: `261111-wp14-permission-denial-list` · Requirements:
[requirements.md](requirements.md) · Plan: [plan.md](plan.md) · Authority: no
new ADR · Plan approved on 2026-11-11 with `Approve, all (a)`: Q1 (a) exact
commands only, Q2 (a) a Gate 2 maintainer probe, Q3 (a) the 2.1.290 binary
check.

WP14 is one change set. Nothing is staged or committed. The implementation
made no live vendor run; the owner then ran the Gate 2 probe on both client
versions, and the change set carries the 2.8.3 version bump (see
[Release train 2.8.3](#release-train-283)).

## What changed

- **The flag** (`adapters.ts`). `buildClaudeArguments`,
  `buildClaudeSelectionArguments` and `buildClaudePhaseArguments` emit
  `--permission-prompts none` directly after `--permission-mode dontAsk`, in
  every scope, fresh and resumed. There is no version gate. Codex argv and the
  `banzai setup` launch are unchanged.
- **The stream reader** (`adapters.ts`, `types.ts`, `errors.ts`).
  - `claudePermissionDenials(stdout, repoRoot)` returns the denied calls of
    one Claude stream. The last `result` event's `permission_denials`
    supplies each call's input. The `permission_denied` system events supply
    the reason type and the subagent mark, and are all that a stream without
    a result has. Entries merge by `tool_use_id`.
  - A `PermissionDenial` has the tool name, a display detail built with the
    existing progress rules, the exact Bash command or null, the reason type
    or null, and a subagent flag.
  - The list travels on `AdapterResult.permissionDenials` from the four
    Claude call sites and on `ProcessExitError.permissionDenials` for a
    failed process. Codex results carry none.
- **The rule proposal and the block** (`claude-permissions.ts`).
  - `proposedAllowRule(command)` returns `Bash(<command>)` for one plain
    command and null otherwise.
  - `claudePermissionDenialReport()` renders the block of R5 and R7.
  - `permissionDenialRecord()` and `parsePermissionDenialRecord()` write and
    read the event payload.
- **Record and report** (`workflow.ts`, `store.ts`).
  - After every model attempt, completed or failed, `invokeWithContext`
    passes the list to `reportPermissionDenials`. A non-empty list is appended
    as one `attempt.permission_denials` event and printed as runner messages.
  - `RunStore.readLatestEventDetails(runId, type)` returns the newest event
    of one type and tolerates a missing ledger and a damaged line.
  - `WorkflowRunner.permissionDenialReport(state)` returns the block for a
    blocked run whose newest attempt record matches the newest such event.
- **Status** (`cli.ts`, `interactive.ts`). Human `banzai status` and the
  interactive status print the block after the block reason. `status --json`
  and agent control are unchanged.
- **Gate 2 probe.** WP14 built a launcher script, a pure verdict module, an
  entry point and a fixture test for the probe. The owner ran it on both
  client versions, and on the owner's decision all four files were then
  removed, together with the Gate 1 probe's (see
  [Probe removal](#probe-removal)). The recipe that was run is
  [gate-2-probe.md](gate-2-probe.md).
- **Documentation.** `PROJECT_MANIFEST.md` (sections 5, 6 and 10),
  `packages/orchestrator/MODULES.md` (claude-permissions, store, adapters,
  the runner note and the probe script), `documentation/orchestrator.md`
  (a new "Denied tool calls" subsection and the live-suite passage) and one
  troubleshooting row in `documentation/getting-started.md`.

No state schema, control contract, report contract, instruction text, skill,
hook or `plugins/banzai/lib` file changed. `npm run build` changed no tracked
generated file.

## Requirement trace

| Requirement | Evidence                                                                                                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1          | `adapters.test.ts` "every Claude argv tells the client that nobody answers permission prompts" (four scopes, fresh and resumed, all three builders), "no Codex argv carries the Claude permission-prompt flag", the updated exact-argv test; `planning-review-adapters.test.ts` exact argv.            |
| R2          | `adapters.test.ts` "a Claude stream yields the exact list of denied calls", "a stream that ends without a result still names the denied calls", "the result is authoritative, malformed entries are skipped and a clean stream is empty", "a denied command with a secret or an unbounded shape…".     |
| R3          | `adapters.test.ts` "a successful Claude phase and a failed Claude process both carry the denied calls", including the empty Codex failure.                                                                                                                                                             |
| R4          | `permission-denials.test.ts` "an attempt with denied calls records one event…", "a secret never reaches the denial event or the report", "machine-readable status is identical with and without the denial event"; `claude-permissions.test.ts` "the denial record keeps an exact count…".             |
| R5          | `claude-permissions.test.ts` "the denial report names each call once…", "…caps distinct calls and renders nothing for an empty list"; `permission-denials.test.ts` first and third tests.                                                                                                              |
| R6          | `permission-denials.test.ts` "a failed attempt with denied calls is recorded, reported and shown in status…", "status ignores a denial event of an earlier attempt and a damaged events file", "the built CLI shows the denied calls in human status and never in JSON status"; `interactive.test.ts`. |
| R7          | `claude-permissions.test.ts` "an allow rule is proposed only for one plain command, verbatim", "the denial report follows the settings the session loads and the trust state", "a deny-or-ask refusal and an unknown command get no proposed rule".                                                    |
| R8          | `permission-denials.test.ts` "an attempt without denied calls records no event and reports nothing new", and the retry and recovery comparison in the failed-attempt test.                                                                                                                             |
| R9          | The owner's probe runs on Claude Code 2.1.290 and 2.1.322, both `pass`, recorded in the tracker. The probe's fixture test (three tests) passed before the probe code was removed.                                                                                                                      |
| R10         | The documentation list above.                                                                                                                                                                                                                                                                          |

## T1 · Vendor evidence

- `npm pack @anthropic-ai/claude-code-darwin-arm64@2.1.290 --ignore-scripts`
  into the session scratchpad: 97.2 MB, sha256
  `dda3ec516629b0a3b9f682b503e8db68f21f5babfb572e7c77ebf302b515a5f6`. It was
  unpacked, never executed, and deleted after the counts.
- `grep -c -a -F` counts in the 2.1.290 binary and in the local client:

  | Name                          | 2.1.290 | 2.1.322 |
  | ----------------------------- | ------- | ------- |
  | `--permission-prompts`        | 10      | 12      |
  | `permission_denials`          | 13      | 14      |
  | `subtype:"permission_denied"` | 2       | 2       |

  The plan quoted 5 for the flag on 2.1.322. That count was taken with a
  leading quote character; the table uses the plan's exact strings.

- The 2.1.290 binary carries the same help text for `none` ("anything that
  would prompt is denied automatically; the permission mode still decides
  everything else"), the same `permission_denied` event fields (`tool_name`,
  `tool_use_id`, `agent_id`, `decision_reason_type`, `decision_reason_code`,
  `decision_reason`, `message`) and the same `permission_denials` entry
  (`tool_name`, `tool_use_id`, `tool_input`).

## Tests

### T2 · Fail-first

Run against stubs that returned empty values. These 17 new tests failed
first:

- `adapters.test.ts` (6): the flag in every Claude argv, the exact list, the
  stream without a result, the authoritative result, the secret and unbounded
  commands, and the list on success and on failure.
- `claude-permissions.test.ts` (7): rule eligibility, the block, the target
  file and trust, the deny-or-ask and unknown-command cases, the cap, the
  record round trip and the damaged record.
- `permission-denials.test.ts` (4): the recorded and reported attempt, the
  failed attempt with status, the identical machine status, and the secret.

Two existing exact-argv tests failed after their expectation gained the flag
and passed with the change: "ambient and no-whitelist argv is today's argv
without the prompt" and the four Claude subtests of "planning invocations
preserve read-only argv, exact schema and environment for both vendors".

Guards that passed before and after: no Codex flag, an attempt without
denials, and status ignoring an earlier attempt's or a damaged event.

Added after the implementation, so not fail-first: the built-CLI status test,
the interactive status test and the three probe tests. The probe tests were
later removed with the probe.

### Focused results

Run alone on the final bytes: `permission-denials` 7 of 7,
`gate-2-permission-probe` 3 of 3, and `adapters`, `claude-permissions` and
`planning-review-adapters` 113 of 113 together. The whole suite is in Checks.

## Checks

All on 2026-11-11, on the final bytes.

| Check                                                     | Result                                                                                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run build`                                           | Pass, with no tracked output change.                                                                                                                                                 |
| `npm run format:check`                                    | Pass.                                                                                                                                                                                |
| `npx prettier --check` on the changed documentation       | Pass for the manifest, `MODULES.md`, `orchestrator.md`, `getting-started.md`, the tracker and this directory.                                                                        |
| `npm run verify`                                          | Pass: typecheck, lint with 0 errors and 427 advisory warnings, 2197 of 2197 tests, and `build:check`. After the probe removal: 2189 of 2189 tests, the eight probe tests being gone. |
| `npm run release:validate`                                | Pass. No `plugins/banzai/lib` or hook file changed, so no version bump is due.                                                                                                       |
| `release-candidate-check.mjs` and `npm run release:check` | Not run. No release, version or instruction-layout file changed. The new script and tests sit beside the Gate 1 probe files, which need no entry.                                    |
| Live vendor run                                           | Not run. The Gate 2 probe needs the owner's go-ahead.                                                                                                                                |

An earlier `verify` run was stopped on purpose, because the built-CLI status
test was added after it started. The result above is from the rerun.

## Probe removal

After both Gate 2 probe runs passed, the owner removed the probe sources
under `packages/orchestrator/test/probes/` and chose `Remove probes fully`.
The change set therefore also:

- deletes `test/gate-1-probe.test.ts` and `scripts/gate-1-probe.mjs` (WP8),
  and the WP14 probe test and launcher, which were never committed;
- deletes the tracked `test/probes/gate-1-probe.ts` and
  `test/probes/gate-1-probe-main.ts`; an untracked
  `test/probes/.gitignore` that ignores the directory's contents is the
  owner's and is left as it is;
- removes the two probe entries from `packages/orchestrator/MODULES.md` and
  rewrites the live-suite passage of `documentation/orchestrator.md`;
- removes the ignored `.dist-check-gate-1-probe/` and
  `.dist-check-gate-2-permission-probe/` build outputs.

The WP8 work documents keep their original text. Requirement R9 and
Acceptance 9 asked for a probe that stays built and tested; after this
decision the evidence is the two recorded runs instead.

## Release train 2.8.3

On 2026-11-11 the owner asked to release this change as v2.8.3, after both
Gate 2 probe runs passed. This is an owner-requested bump: no hook or
`plugins/banzai/lib` file changed, so `release:validate` did not require one.

- `npm run version:set -- 2.8.3`: passed, nine fields across seven files
  (`package.json`, `package-lock.json` with three fields,
  `packages/orchestrator/package.json`, `marketplace.json`,
  `.agents/plugins/marketplace.json` and both `plugin.json` files).
- `PROJECT_MANIFEST.md` names release-train version `2.8.3`.
- `npm run build`: passed, with no other tracked output change.
- `npm run release:validate`: passed, with nine-way parity and no retained
  version transaction.
- `node packages/orchestrator/scripts/release-candidate-check.mjs`: passed in
  a disposable copy with its own index: verify with 2197 of 2197 tests,
  formatter, release validation, publication checks, committed smoke and the
  release check. `node_modules/.bin/banzai` and the dangling
  `node_modules/node_modules` link were set aside for the run and restored to
  their exact targets.
- After the probe removal and the maintainer skills below, in place:
  `npm run format:check`, `npm run verify` with 2189 of 2189 tests,
  `npm run release:validate` and
  `publication-check.mjs --tree working` (660 files) all pass.
  CANDIDATE_RERUN_PLACEHOLDER
- Each candidate check ran before the last edits to this report and the
  tracker. Work documents are outside the plugin and npm payloads.
- The same change set carries three maintainer-only Claude Code skills under
  `.claude/skills/`, which the owner requested the same day: `/version-bump`,
  `/commit-message` and `/release`. They are outside WP14's requirements.
  Each has a `maintainer` entry in `publication-policy.json`, and
  `PROJECT_MANIFEST.md` and `documentation/releases/public-publication.md`
  name them.
- Live evidence on this change set: the Gate 2 permission probe passed on
  Claude Code 2.1.290 and 2.1.322. `npm run compatibility:live` was not run.

Not done here, and left to the owner: the commit, the pull request to `main`
with its three required CI lanes, the GitHub draft release notes for
`v2.8.3`, the tag and publication.

## Deviations from the plan and the requirements

1. **A credential-shaped command is never kept verbatim.** R2 and R4 ask for
   the exact command, redacted. Redaction alone would persist a command whose
   secret has no recognizable shape, for example `deploy --token <value>`. The
   reader keeps the exact command only when it is one line of at most 200
   characters with no credential flag, credential assignment, environment
   assignment or authorization value. Any other command keeps its sanitized
   display detail and gets `needs a hand-written rule`.
2. **`*` also disqualifies a rule.** R7 lists the shell operators. Claude Code
   reads `*` in a rule as a wildcard, so `Bash(ls *.ts)` would grant more than
   the denied call.
3. **Status shows the block for a blocked run.** R6 says "blocked or failed".
   A run has no failed status: a failed attempt leaves the run `blocked`. The
   block appears when the newest attempt record is the attempt of the newest
   denial event.
4. **The workflow tests live in a new file**, `permission-denials.test.ts`,
   not in `workflow.test.ts`, and the machine-status guard is there too. It
   compares the same run before and after the event is appended.
5. **The failure path takes the checkout from the spawn.**
   `withModelFailureEvidence` records the child's `cwd`, which is the
   repository root at every model call site, instead of a new parameter that
   would have re-indented four call sites.
6. **The probe makes no file write** and runs without runner identity, like
   the Gate 1 probe. It does not show that a hook-allowed write succeeds under
   the flag; see Follow-ups.

## Unchanged, by design

- Attempt outcomes, failure causes, retry and recovery eligibility, and
  session reuse.
- `status --json`, agent status v7, capabilities v9 and the run state schemas.
- Evaluation, KPI, context and cancellation reports. The evaluation reader
  maps the new event type to `other`.
- `compatibility:live`, its v2 summary and its two-invocation budget.
- Codex argv and environments, and the `banzai setup` launch.
- No settings file is written anywhere.

## Follow-ups

- **Gate 2 probe.** Done on 2026-11-11: the owner's runs on Claude Code
  2.1.290 and 2.1.322 both returned `pass` with `reasonType` `mode`. The
  tracker has both entries. The Gate 2 item stays unticked until the Gate 2
  report, by the owner's decision.
- **Hook-allowed writes under the flag.** No test or probe in this package
  proves that a write the Banzai hook allows still succeeds with
  `--permission-prompts none`. The vendor text says the flag only denies what
  would prompt, and the hook's allow removes the prompt. The first real run on
  this change, or the WP22 probe, confirms it. A failure would show as every
  planning or implementation write denied.
- **Fixture shapes.** The fixtures follow the 2.1.322 embedded schema, with
  reason type `mode` for a call that no rule grants. Both probe runs confirmed
  that value. The code depends only on `rule`.
- **WP17 input.** `attempt.permission_denials` events are the data for the
  sandbox decision. Nothing aggregates them yet.

## Plan Task Completion

Format: `banzai-plan-task-completion/v1`

| Task | Status    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1   | completed | [{"path":"documentation/work/261111-wp14-permission-denial-list/implementation-report.md","detail":"T1 section: 2.1.290 darwin-arm64 binary inspected without execution and deleted; all three names present."}]                                                                                                                                                                                                         |
| T2   | completed | [{"path":"packages/orchestrator/test/adapters.test.ts","detail":"Seven new tests and one updated exact-argv test; six failed first."},{"path":"packages/orchestrator/test/claude-permissions.test.ts","detail":"Seven new tests; all failed first."},{"path":"packages/orchestrator/test/permission-denials.test.ts","detail":"Seven workflow and status tests; four failed first."}]                                    |
| T3   | completed | [{"path":"packages/orchestrator/src/adapters.ts","detail":"--permission-prompts none in three builders; claudePermissionDenials; the list on four Claude results and on failures."},{"path":"packages/orchestrator/src/types.ts","detail":"PermissionDenial and AdapterResult.permissionDenials."},{"path":"packages/orchestrator/src/errors.ts","detail":"ProcessExitError.permissionDenials."}]                        |
| T4   | completed | [{"path":"packages/orchestrator/src/claude-permissions.ts","detail":"proposedAllowRule, claudePermissionDenialReport, permissionDenialRecord and parsePermissionDenialRecord."}]                                                                                                                                                                                                                                         |
| T5   | completed | [{"path":"packages/orchestrator/src/workflow.ts","detail":"reportPermissionDenials after every attempt; permissionDenialReport for status."},{"path":"packages/orchestrator/src/store.ts","detail":"readLatestEventDetails."},{"path":"packages/orchestrator/src/cli.ts","detail":"Human status prints the block."},{"path":"packages/orchestrator/src/interactive.ts","detail":"Interactive status prints the block."}] |
| T6   | completed | [{"path":"documentation/orchestrator.md","detail":"Denied tool calls subsection and the live-suite passage."},{"path":"packages/orchestrator/MODULES.md","detail":"claude-permissions, store, adapters, runner note and probe script."},{"path":"PROJECT_MANIFEST.md","detail":"Sections 5, 6 and 10."},{"path":"documentation/getting-started.md","detail":"One troubleshooting row."}]                                 |
| T7   | completed | [{"path":"documentation/work/261111-wp14-permission-denial-list/gate-2-probe.md","detail":"Owner recipe and the record of both passing runs; the probe sources, test and launcher were built, run and then removed on the owner's decision."}]                                                                                                                                                                           |
| T8   | completed | [{"path":"documentation/work/261111-wp14-permission-denial-list/implementation-report.md","detail":"Checks section: format check and verify results."},{"path":"documentation/work/release-2-8-2-9-program/tracker.md","detail":"WP14 row, owner decisions and the settled live-budget question."}]                                                                                                                      |
