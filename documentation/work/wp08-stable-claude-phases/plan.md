# WP8 plan

Status: approved on 2026-11-06 with `Approve, all (a)` · Requirements: [requirements.md](requirements.md) ·
Authority:
[ADR-0063](../../decisions/0063-stable-headless-vendor-invocations.md)

WP8 is one change set with one report,
`documentation/work/wp08-stable-claude-phases/implementation-report.md`. The
owner commits by hand. At `d0785db` (WP7), the working tree held only the
ADR-0063 lifecycle edits and these documents.

An independent read-only review of the first draft found five major and
eleven minor issues. This revision addresses them:

- Q1 offers two fixed reserves, uses a 2-minute floor that matches the vendor
  ceiling, and names the departure from Compliance 4 that the floor causes;
- the Gate 1 probe is owner question Q3, with a runnable design and exact
  pass checks;
- the fail-first labels are corrected, and the existing tests that must
  change are listed;
- the mismatch check, the live timeout, partial doctor availability,
  workflow selection's timeout and the settings load sets are corrected.

## Approach

The change stays inside the boundaries that already own each concern:

- **Process runner.** `ProcessSpec` gains an optional stdin text, and
  `runProcess` writes and closes it. Every other spawn keeps an ignored stdin.
- **Vendor adapter.** The adapter already builds every vendor argv. Prompt
  transport changes there: Claude emits `-p` with no prompt, and Codex emits
  `-`. Each of the eight spawn sites passes the prompt as stdin.
- **Claude environment.** WP7's `isolatedClaudeEnvironment` already runs at
  the four Claude call sites. It gains the enforced timeout and adds the R2
  settings after the isolation variables. One pure function,
  `claudeBashMaxTimeoutMs`, computes the maximum.
- **One minimum.** `MINIMUM_CLAUDE_VERSION` takes the WP7 floor's value. The
  floor constant, the `reviews` flag and their carriers are removed. Doctor
  reuses one minimum check.

Tests come first and run against today's code. No runner-delivered
instruction text changes, so there is no baseline transition. The rebuilt
plugin lib makes `release:validate` report the deferred
`HOOK_CHANGED_WITHOUT_VERSION_BUMP` again.

## Tasks

### T1 · Vendor evidence

This task runs first after approval, before any argv or environment change.
Everything downloaded goes into the session scratchpad, is never executed,
and is deleted after the counts are recorded.

- Fetch `@anthropic-ai/claude-code-darwin-arm64@2.1.290` from the npm
  registry. It unpacks to about 233 MB. Use
  `npm pack <spec> --pack-destination <dir> --ignore-scripts`, unpack it, and
  count each of these names in its binary with `grep -c -a`:
  - `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`;
  - `BASH_MAX_TIMEOUT_MS`;
  - `BASH_DEFAULT_TIMEOUT_MS`.
- Record the same counts for the locally installed client and its version.
- Record that `codex exec --help` and `codex exec resume --help` from the
  installed Codex show `-` as reading the prompt from stdin.
- If a count on 2.1.290 is zero, the download fails, or Codex help does not
  show `-`, stop before T4 and report.

### T2 · Tests first (R1–R7, Acceptance)

Add or update these tests and run them against today's code.

- Tests marked "new behaviour" must fail first, and the report lists them.
  Tests marked "guard" pass today and must keep passing.
- A test that imports a symbol not yet exported fails its whole bundled file.
  Keep such tests in a separate block and add the export as a stub, or record
  in the report that the file failed as a whole and why. This is the WP7 rule.

New tests:

- `process.test.ts`, with real spawns of Node stubs in a temporary directory:
  1. A 200,000-byte stdin text arrives whole. The stub reports the byte length
     and SHA-256 it read, and no argv element carries the text (new
     behaviour).
  2. A stub that reports whether fd 0 is a FIFO and exits with status 3
     without reading, given a 4 MiB stdin text, reports a FIFO and resolves
     with exit status 3. No uncaught error reaches the test process (new
     behaviour).
  3. Without stdin text, the stub's fd 0 is not a FIFO and reads end-of-file
     at once (guard).
  4. A missing executable with stdin text rejects with `PROCESS_START_FAILED`
     (guard).
  5. A stub that never reads stdin, given a 4 MiB stdin text and a short
     timeout, ends as a timeout (guard).
- `adapters.test.ts`, with an injected runner that records each spec:
  1. For all eight spawn sites, no argv element equals or contains the
     prompt, and `spec.stdin` equals the prompt (new behaviour). The cases
     cover:
     - scoped mode, ambient mode and no scope;
     - fresh and, where the site resumes, resumed invocations;
     - with and without a Serena whitelist.
  2. Exact argv arrays (new behaviour):
     - Claude review, selection and phase in ambient mode and without a
       whitelist: today's arrays without the prompt, with `-p` kept;
     - Codex exec and exec resume: today's arrays with `-` as the last
       element.
  3. For the four Claude call sites, in scoped mode, ambient mode and no scope
     (new behaviour):
     - `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` is `1`, overriding an inherited
       `0`;
     - `BASH_MAX_TIMEOUT_MS` follows Q1 for timeouts of 60, 30, 7, 5 and 2
       minutes, overriding an inherited `9999999`;
     - an inherited `BASH_DEFAULT_TIMEOUT_MS` is absent;
     - the WP7 isolation variables are unchanged.
  4. Codex spawns built from a source environment without the three variables
     carry none of them. An inherited value passes through unchanged (guard).
  5. The vendor preflight with a fake runner that reports 2.1.289 fails with
     `CLI_TOO_OLD` for a building target and for a reviewing target. The
     message names the version, the minimum and the reason. 2.1.290 passes
     (new behaviour).
  6. The `--version`, authentication and login probe specs carry no stdin
     (guard).
- `planning-review-adapters.test.ts`:
  - planning analysis and planning review carry the stdin prompt and the R2
    environment (new behaviour);
  - their tools and isolation variables are unchanged (guard).
- `workflow.test.ts` and `interactive.test.ts`: the recorded preflight
  targets and gateway calls carry no reviewing marker (new behaviour). The
  version refusal itself is proven by adapters test 5 and the setup tests,
  which use the real `createVendorAdapters`.
- `setup-client.test.ts` and `setup-pty.test.ts`:
  - the fake client versions move to 2.1.290;
  - a 2.1.289 fake is refused by `banzai setup` (new behaviour).
- `doctor.test.ts`, through injected readers, spawning nothing and printing
  no path. New behaviour:
  - a Claude builder on 2.1.289 with a Codex reviewer fails;
  - a Claude planner whose version cannot be read warns;
  - two Claude executables are each read once, and the worse result wins;
  - an unavailable Claude executable beside an available one: the available
    one decides, and the message names the other's roles as not checked;
  - an all-Codex configuration is skipped with the new message;
  - the reworded `authentication.models` advisory.

  Guards:
  - every role on 2.1.290 passes;
  - an invalid configuration, a failed local layer and no available Claude
    executable are skipped;
  - the check list and order are unchanged.

- `live-compatibility.test.ts`:
  - `minimumCliVersions.claude` equals `MINIMUM_CLAUDE_VERSION` (new
    behaviour);
  - a 2.1.289 live preflight records `preflight.claude` as `unavailable` with
    `CLI_TOO_OLD` and the new message (new behaviour);
  - the live Claude review spawn has `timeoutMs` equal to
    `perInvocationTimeoutMs`, and `BASH_MAX_TIMEOUT_MS` equal to
    `claudeBashMaxTimeoutMs(timeoutMs)` (new behaviour);
  - `CHECK_IDS`, the v2 summary and `maxInvocations` 2 are unchanged (guard).
- Under Q3 (a), `gate-1-probe.test.ts` covers the probe's line
  classification and verdict on recorded stream lines (new behaviour). The
  cases are:
  - one result, with the sentinel present;
  - two results;
  - a `run_in_background` tool use;
  - a backgrounded tool result;
  - a background `system` event;
  - a permission denial;
  - a missing sentinel.

Existing tests that change with the code, without weakening what they prove:

- `adapters.test.ts`:
  - lines 1113, 1229, 1250 and 1275 fake Claude `2.1.218` and move to
    `2.1.290`;
  - the model-minimum test at lines 1290–1364 is rewritten with a Claude
    model minimum above 2.1.290, because its present fixture can no longer
    occur;
  - the floor import at line 19 and the `reviews` targets at lines 1366–1428
    become tests of the one minimum;
  - the builder-level `PROMPT_ENVELOPE_MISMATCH` test at lines 842–856 stays
    as it is.
- `planning-review-adapters.test.ts:66-69`: the exact argv loses the prompt.
- `live-compatibility.test.ts`:
  - `promptFrom` (lines 105–108) and the `args.at(-1)` read (line 186) take
    the prompt from `spec.stdin`;
  - the messages at lines 259–260 and 937–945 change.
- `workflow.test.ts:3221-3255`: "run start leaves a Claude pair that only
  builds without the review floor" is removed, because the one minimum
  replaces it. `workflow.test.ts:3167` takes the new message.
- `interactive.test.ts:852-887`: the gateway fakes lose the reviewing
  argument.
- `doctor.test.ts:2380-2530`: the messages and skip texts change.
- `models.test.ts:129`: the test title is corrected.

### T3 · One minimum (R1)

- In `adapters.ts`:
  - `MINIMUM_CLAUDE_VERSION` becomes `2.1.290`;
  - remove `REVIEW_ISOLATION_MINIMUM_CLAUDE_VERSION` and the `reviews`
    branch of `requireVersion`;
  - the Claude `CLI_TOO_OLD` message names the version, the minimum and the
    reason.
- Remove `VendorPreflightTarget.reviews` from `types.ts`, together with every
  place that only carries it:
  - the `reviews` parameter of `preflightVendor` in `workflow.ts`, and the
    reviewing pair of the run-start preflight, so each pair is checked once
    without a marker;
  - `AuthenticationGateway.check` in `interactive.ts` and the gateway in
    `cli.ts`;
  - `{ ...settings, reviews: true }` in `live-compatibility.ts`.
- Rename `meetsReviewIsolationMinimum` to a general minimum check that doctor
  imports.
- `release-policy.json`: `live.minimumCliVersions.claude` becomes `2.1.290`.
  `validateLiveCompatibilityPolicy` is unchanged.
- In `models.ts`, keep the minimums and correct the comment at lines 29–32.

### T4 · Stdin in the runner (R3)

- `types.ts`: `ProcessSpec` gains an optional `stdin?: string`, with a comment
  that it is written whole and then closed.
- `process.ts`:
  - spawn with `stdio[0]` set to `"pipe"` only when `spec.stdin` is defined;
  - attach an `error` listener to `child.stdin` that consumes the error,
    before writing;
  - write the text with `child.stdin.end(text, "utf8")` right after the spawn
    call, and do not wait for `onStart`.
- Exit, signal, timeout, output limit, durable-observer and spawn-error
  handling are unchanged, so a stdin error never decides the outcome.

### T5 · Prompt on stdin in the adapter (R3, R4)

- `buildClaudeArguments`, `buildClaudeSelectionArguments` and
  `buildClaudePhaseArguments` keep calling `invocationPrompt(request)` for
  its check, stop appending the result, and keep `-p`.
- `buildCodexArguments` keeps the same call and emits `-` as its last
  argument, for `exec` and for `exec resume <id>`.
- Each of the eight spawn sites sets `stdin: invocationPrompt(request)`:
  - Claude planning, selection, phase and review;
  - Codex planning, selection, phase and review.
- The preflight, authentication, login, plugin and `resolveMcpWhitelist`
  spawns, and `setup-client.ts`, are not touched.
- The reviewer invocation digest in `workflow.ts` is not changed.

### T6 · Run-stability environment (R2, Q1)

- In `adapters.ts`:
  - export the Q1 reserve and the 120,000 ms floor as named constants;
  - export a pure `claudeBashMaxTimeoutMs(timeoutMs)`, which returns the
    larger of `timeoutMs − reserve` and the floor;
  - extend `isolatedClaudeEnvironment` with the enforced `timeoutMs`. After
    the WP7 isolation variables, it sets
    `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` and `BASH_MAX_TIMEOUT_MS`, and
    deletes `BASH_DEFAULT_TIMEOUT_MS`. This applies in every mode, for
    reviews and without a scope.
- Pass `request.settings.timeoutMs` at the four Claude call sites.
  `subscriptionOnlyEnvironment` and the Codex spawns are not touched.
- `live-compatibility.ts` needs no environment change. Its Claude review
  settings already use `perInvocationTimeoutMs`, so `wrapRunner`'s lower
  bound never changes that timeout. The T2 live test pins this.

### T7 · Doctor `claude.version` (R5)

- In `doctor.ts`:
  - collect the roles whose executable `vendorFor` maps to Claude;
  - group them by executable;
  - check each executable's availability, then read each available
    executable's version once with the existing offline reader.
- The status, skip and partial-availability rules follow R5. Messages name
  roles and versions. The fix names the minimum and links "Install and sign
  in to model clients".
- Reword the `authentication.models` advisory per R5.
- Keep `banzai-doctor/v6`, the check list and the order.

### T8 · Gate 1 probe (R7, Q3)

Under Q3 (a):

- **Files.**
  - `packages/orchestrator/test/probes/gate-1-probe.ts` holds the line
    classification and the verdict as pure functions.
  - `packages/orchestrator/test/probes/gate-1-probe-main.ts` runs the probe.
  - `packages/orchestrator/scripts/gate-1-probe.mjs` bundles the entry with
    esbuild into a `.dist-check-*` output root and runs it, the way
    `scripts/test.mjs` does.
  - None of them is in the npm `files` list.
  - If `release:check` reports `PUBLICATION_UNCLASSIFIED`, classify them as
    `maintainer`.
- **Run.**
  - Arguments: `--repository <scratch>` is required, and
    `--executable <claude>` is optional. Without `--repository` the script
    prints usage and exits.
  - It refuses to start when `CLAUDECODE` is set, so it runs from a plain
    terminal.
- **Phase.** The probe builds the request the way the workflow does for an
  implementation phase:
  - the `DEFAULT_CONFIG` implementer model, effort and 60-minute timeout;
  - the scoped `claudeEnvironment` resolved by `resolveClaudeInvocationScope`,
    with this checkout's `plugins/banzai` as the plugin directory;
  - the implementation output contract, and a prompt that asks for one
    foreground Bash call of `sh ./probe.sh` with a 900,000 ms timeout and
    then a completed result.

  `createVendorAdapters(wrappedRunner).runPhase` runs it, with
  `wrappedRunner` wrapping the real `runProcess`.

- **Resume.** A second `runPhase` with the first session's id and a short
  prompt.
- **Observation.** The wrapped runner classifies each stdout line:
  - `result` events, with their `permission_denials`;
  - background-task events, which are any of:
    - a `tool_use` block whose input sets `run_in_background`;
    - a `tool_result` block whose text says that a command runs in the
      background;
    - a `system` event whose `subtype` matches `/task|background/i`.

  When the first `result` line arrives, the wrapper checks that
  `probe-sentinel.txt` exists.

- **Verdict.** The probe applies the R7 pass rules and prints one JSON object:
  client version, per-invocation counts, exit statuses, error code if any,
  and `pass` or `fail`. A structured-output schema failure prints
  `inconclusive`. No stream is written to disk.

`documentation/work/wp08-stable-claude-phases/gate-1-probe.md` gives the
owner:

- **Scratch repository setup:**
  - `git init`, with no commit needed;
  - `probe.sh` containing `sleep 660 && date > probe-sentinel.txt`;
  - `.claude/settings.json` allowing exactly `Bash(sh ./probe.sh)`;
  - one interactive `claude` start in that directory to accept the trust
    prompt, because the phase runs with `--permission-mode dontAsk`.
- **Installing 2.1.290 beside the current release** with
  `npm install --prefix <dir> @anthropic-ai/claude-code@2.1.290`.
- **The two probe commands**, one per client.
- **What to record in the tracker.**

Under Q3 (b), T8 writes only `gate-1-probe.md` with the same setup. It adds
the argv from `buildClaudePhaseArguments` and the R2 environment written out,
`jq` counts over a saved stream, and an ordering check that the Bash
`tool_result` line precedes the `result` line. The stream is deleted after
counting.

WP8 does not run the probe.

### T9 · Documentation (R6, R8)

Update these files per R6 and R8:

- `documentation/orchestrator.md`;
- `documentation/getting-started.md`;
- root `README.md`;
- `packages/orchestrator/README.md`;
- `packages/orchestrator/MODULES.md`.

Do not run prettier on `plugins/**` or `documentation/decisions/README.md`.

### T10 · Lifecycle, facts, build and close-out (R9)

- Lifecycle metadata only:
  - ADR-0063's Implementation state becomes Implemented, naming WP8 and the
    2.8 release;
  - the reciprocal lines in ADR-0020, ADR-0022 and ADR-0059 change
    "Implementation is Planned" to Implemented.
- Update the decision index row and the R9 manifest facts.
- Run `npm run build`, then `npm run build:check`.
- Run the final checks and write the report with:
  - R1–R9 and their evidence;
  - the T1 counts;
  - the T2 fail-first list;
  - the readings and how they were applied;
  - deviations, including the Q1 floor;
  - the Gate 1 probe item.
- Tracker:
  - the WP8 row becomes `report ready`;
  - add the owner-decision entries;
  - add the Q1 floor deviation;
  - the Gate 1 item names the probe command.

## Tests

| Requirement | Evidence                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| R1          | `adapters.test.ts` test 5; setup tests; `workflow.test.ts`; `interactive.test.ts`; `live-compatibility.test.ts` |
| R2          | `adapters.test.ts` tests 3–4; `planning-review-adapters.test.ts`; `live-compatibility.test.ts`                  |
| R3          | `process.test.ts` tests 1–5; `adapters.test.ts` tests 1 and 6; the kept mismatch test                           |
| R4          | `adapters.test.ts` test 2; the reviewer digest tests in `workflow-review.test.ts`, unchanged                    |
| R5          | `doctor.test.ts`                                                                                                |
| R6, R8      | review of the diff; `release-validation.test.ts`; `release-candidate-check.mjs`                                 |
| R7          | `gate-1-probe.test.ts` under Q3 (a); `live-compatibility.test.ts`; the Gate 1 probe with the owner's go-ahead   |
| R9          | `release-validation.test.ts` registration checks; review of the diff                                            |

## Checks

- Focused, during work, through
  `node packages/orchestrator/scripts/test.mjs --file <name>.test.ts --output-root packages/orchestrator/.dist-check-wp08`:
  - `process`;
  - `adapters`;
  - `planning-review-adapters`;
  - `workflow`;
  - `workflow-review`;
  - `interactive`;
  - `setup-client`;
  - `setup-pty`;
  - `doctor`;
  - `live-compatibility`;
  - `models`;
  - `gate-1-probe` under Q3 (a).
- Final:
  - `npm run verify`;
  - `npm run format:check`;
  - `npx prettier --check` on the manifest, the tracker, the changed
    documentation and this work directory;
  - `release-validation.test.ts`;
  - `npm run release:validate`, expected to stop only at the deferred
    `HOOK_CHANGED_WITHOUT_VERSION_BUMP`;
  - `node packages/orchestrator/scripts/release-candidate-check.mjs`, with
    the `node_modules` link workaround from WP19 and WP20.
- No live vendor run. The Gate 1 probe and `npm run compatibility:live` wait
  for the owner's go-ahead.

## Sequencing

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10.

- T1 must pass before T4 changes any spawn.
- T5 needs the `ProcessSpec.stdin` field from T4.
- T7 imports the minimum check from T3.
- T8 runs the phase that T5 and T6 build.
- T10's build comes after every source change.

## Risks

- **A client stops reading stdin within 3 seconds.** The runner writes at
  spawn, so a slow start delays only reading, not writing. A client that
  misses stdin answers an empty prompt, and the run fails visibly. Gate 1
  covers both pinned clients.
- **A child that exits early raises `EPIPE`.** The consumed stream error and
  process test 2 cover it.
- **A settings `env` block re-enables background tasks.** Q2 decides how this
  is handled. A second result still fails the run safely.
- **Raising the minimum refuses existing installs.** Every role now needs
  2.1.290. The message names the reason, and doctor reports it offline before
  a run.
- **Short timeouts keep the 2-minute ceiling.** Below `reserve + 2 minutes`
  the closing-turn reserve shrinks. No default role is affected, and the
  report and tracker record the departure.
- **The probe needs a trusted scratch directory.** Without trust, the Bash
  allow rule is ignored and the probe reports a permission denial instead of
  a verdict on background tasks. `gate-1-probe.md` makes trust the first
  step.
- **The deferred version error masks later `release:validate` checks.**
  Mitigation: evidence comes from `release-validation.test.ts` and the
  candidate check, as in WP20.
