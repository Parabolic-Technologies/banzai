# WP8 · Stable headless vendor invocations

Status: approved on 2026-11-06 with `Approve, all (a)` · Program:
[banzai 2.8–2.9](../release-2-8-2-9-program/tracker.md) · Source:
[brief, WP8](../release-2-8-2-9-program/brief.md#wp8--stable-claude-phases-minimum-21290-no-background-tasks-prompt-over-stdin)
· Authority:
[ADR-0063](../../decisions/0063-stable-headless-vendor-invocations.md)

## Problem

Banzai runs every model phase as a headless vendor process. Today three
behaviors can fail a phase that did its work:

- The rendered prompt is one argv element (`buildClaude*Arguments` and
  `buildCodexArguments` in `packages/orchestrator/src/adapters.ts`). On Linux
  one argument is limited to 131,072 bytes. The prompt is also visible in
  process listings.
- Claude Code before 2.1.290 could exit non-zero with `is_error: true` on a
  delivered `--json-schema` success. Banzai's minimum is 2.1.218; only a
  Claude reviewer needs 2.1.290 today (WP7).
- Since 2.1.292, `claude -p` waits for background commands and then gives
  Claude another turn. The second `result` event fails the run with
  `TERMINAL_RESULT_CONFLICT` after the first success was checkpointed. A
  foreground command that reaches its timeout moves to the background and
  triggers the same failure. That timeout is 2 minutes by default and at most
  10 minutes.

## Authority

- [ADR-0063](../../decisions/0063-stable-headless-vendor-invocations.md),
  accepted on 2026-11-06 with `Accept`. Before drafting, the owner chose:
  every `claudeEnvironment` mode, a Gate 1 manual probe, doctor for every
  Claude role, and the Codex prompt on stdin with `-`. The ADR text is
  authoritative wherever this document is shorter.
- ADR-0063 narrowly amends:
  - ADR-0020: the ambient opt-out restores discovery arguments only;
  - ADR-0022: the no-whitelist argv stays identical in its discovery
    arguments only;
  - ADR-0059: the review floor folds into one minimum, doctor covers every
    Claude role, Codex review arguments change only in prompt transport, and
    ambient builders gain the run-stability environment and the stdin prompt.

  The reciprocal links are already recorded.

- [ADR-0008](../../decisions/0008-read-only-doctor-diagnostics.md): doctor
  reads files and metadata only and runs no vendor CLI.
- [ADR-0011](../../decisions/0011-protected-live-vendor-compatibility.md) and
  [ADR-0046](../../decisions/0046-supervised-live-e2e.md): the live summary,
  its check IDs and its two-invocation release budget stay unchanged.
- [ADR-0040](../../decisions/0040-project-adoption-preflight-and-interactive-setup.md)
  D4: the interactive `banzai setup` launch keeps its argv skill invocation.
- Tracker owner decisions:
  - 2026-10-31: the release-train version is bumped at the Gate 1 release, so
    `HOOK_CHANGED_WITHOUT_VERSION_BUMP` alone does not block a package;
  - 2026-11-02: doctor JSON v6 stays open until Gate 1.

No runner-delivered instruction text changes. No phase instruction, skill or
contract mentions background commands or Bash timeouts, so WP8 needs no
instruction-baseline transition.

## Vendor facts

These were read on 2026-11-06. ADR-0063 asks the plan to confirm the three
variable names in the 2.1.290 binary, which is plan task T1.

- **Claude Code changelog:**
  - 2.1.290 fixed headless `--json-schema` runs that exited non-zero on a
    delivered `success`;
  - 2.1.292 made `-p` runs wait for background commands;
  - 2.1.4 added `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`;
  - 0.2.108 added both Bash timeout variables.
- **`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`** removes `run_in_background` and
  stops automatic backgrounding: a timed-out foreground command is stopped.
  MCP tasks and the Monitor tool are not affected.
- **Bash timeouts.** `BASH_MAX_TIMEOUT_MS` caps any requested timeout, and no
  upper bound is documented.
  - The effective ceiling is the larger of the two Bash variables.
  - With `BASH_DEFAULT_TIMEOUT_MS` unset, the default is 120,000 ms, so the
    ceiling is never below 2 minutes.
- **Claude stdin prompt.** `claude -p` with no prompt argument reads a non-TTY
  stdin as the whole prompt.
  - Stdin is capped at 10 MB of characters.
  - If no data arrives within 3 seconds, the client continues without stdin.
  - Stdin is read before `--resume` and `--json-schema` apply.
- **Codex stdin prompt.** `codex exec -` and `codex exec resume <id> -` read
  the prompt from stdin, from 0.145.0 to 0.166.0. Codex caps input at
  1,048,576 characters.
- **Settings `env` blocks.** Claude Code writes each `env` entry of a loaded
  settings file into its process environment, "replacing the value inherited
  from the shell" (environment-variable reference, "In settings files").
  Precedence is managed, then project local, then shared project, then user.
  - Scoped mode with the packaged plugin passes `--setting-sources project`,
    so shared project and managed settings load.
  - Degraded scoped mode (no packaged plugin) and ambient mode pass no
    `--setting-sources`, so user, project, local and managed settings load.
  - Any of these blocks can therefore re-set the three variables.

## Requirements

- **R1 · One Claude Code minimum (ADR §1).**
  - `MINIMUM_CLAUDE_VERSION` becomes `2.1.290`.
  - `REVIEW_ISOLATION_MINIMUM_CLAUDE_VERSION`, the `reviews` field of
    `VendorPreflightTarget` and the code that only carries it are removed:
    - the reviewing pair of the run-start preflight;
    - the `reviews` argument of `AuthenticationGateway.check` and the CLI
      gateway;
    - the live harness's `reviews: true`.
  - `meetsReviewIsolationMinimum` becomes a general Claude minimum check that
    doctor uses.
  - The Claude `CLI_TOO_OLD` message names the installed version, the minimum
    and the reason: headless structured results are reported reliably from
    2.1.290. The Codex message is unchanged.
  - The minimum applies wherever `requireVersion` runs: run start, phase
    preflights, the launch check and `banzai setup`.
  - `release-policy.json` `live.minimumCliVersions.claude` becomes `2.1.290`,
    and `validateLiveCompatibilityPolicy` keeps requiring equality with the
    code constant. A live preflight below it records `preflight.claude` as
    `unavailable` with `CLI_TOO_OLD`.
  - Model minimums in `models.ts` stay as recorded. The comment there and the
    `models.test.ts` test title that call them newer than the vendor-wide
    minimum are corrected.
- **R2 · Run-stability environment (ADR §2; Q1).**
  - `isolatedClaudeEnvironment` builds the environment of every headless
    Claude invocation: planning analysis, planning review, workflow
    selection, phases and review. It starts from the
    `subscriptionOnlyEnvironment` result, keeps the WP7 isolation variables,
    and then:
    - sets `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`;
    - sets `BASH_MAX_TIMEOUT_MS` to `claudeBashMaxTimeoutMs(timeoutMs)`, a
      decimal string of milliseconds per Q1;
    - deletes `BASH_DEFAULT_TIMEOUT_MS`.
  - Inherited values never survive, in both `claudeEnvironment` modes and
    without a scope.
  - `timeoutMs` is the timeout the runner enforces. The live Claude review is
    built with the live per-invocation bound, so the wrapper's lower bound
    never changes its timeout. A test pins that equality.
  - Codex children receive none of the three variables from Banzai. An
    inherited value passes through as today.
- **R3 · Prompt on stdin (ADR §3).**
  - `ProcessSpec` gains an optional stdin text. When `runProcess` receives
    one, it spawns with a piped stdin, writes the whole text and closes
    stdin. Without one, stdin stays `"ignore"`.
  - An `error` on the child's stdin stream, such as `EPIPE` from a child that
    exits before reading, is consumed. The process outcome decides the
    result: exit, signal, timeout, output limit, observer failure, or
    `PROCESS_START_FAILED` when the spawn itself fails.
  - Claude: `buildClaudeArguments`, `buildClaudeSelectionArguments` and
    `buildClaudePhaseArguments` emit `-p` with no prompt argument.
  - Codex: `buildCodexArguments` emits `-` as its last argument where the
    prompt was, for `exec` and for `exec resume`.
  - The builders still call `invocationPrompt(request)`, so
    `PROMPT_ENVELOPE_MISMATCH` still fires while argv is built, before any
    spawn. They no longer append its result.
  - Each of the eight vendor spawn sites passes `invocationPrompt(request)`
    as stdin. The prompt bytes are unchanged.
  - Preflight, authentication, login, plugin and whitelist probes keep stdin
    ignored. The `banzai setup` client launch is unchanged.
- **R4 · Ambient and no-whitelist argv (ADR §4).**
  - Ambient argv still omits `--strict-mcp-config`, `--mcp-config`,
    `--allowedTools`, `--setting-sources` and `--plugin-dir`.
  - Without a Serena whitelist, in any mode, no MCP argument is emitted for
    either vendor.
  - In both cases, argv equals today's argv without the prompt, plus the
    Codex `-`.
  - ADR-0059's auto-memory and review-isolation rules are unchanged, and the
    reviewer invocation digest is unchanged.
- **R5 · Doctor (ADR §5).**
  - `claude.version` evaluates every role whose effective configuration runs
    on Claude. It groups the roles by executable and reads each available
    executable's version once, offline, with the existing reader.
  - The status follows the worst result over the read executables:
    - `fail` when any read version is below the minimum;
    - otherwise `warning` when any read yields no version;
    - otherwise `pass`.
  - An unavailable executable is not read. `executables.models` already fails
    it, and the message names its roles as not checked.
  - It is `skipped` in these cases:
    - the configuration is invalid;
    - `config.local` fails;
    - no role runs on Claude;
    - no Claude executable is available.
  - Messages name roles and versions, never paths, and the fix names the
    minimum.
  - The `authentication.models` advisory says that doctor reads only Claude
    Code's version, offline.
  - Doctor stays `banzai-doctor/v6`, and its check list and order are
    unchanged.
- **R6 · Settings `env` overrides (Q2).** Under Q2 (a), `orchestrator.md`
  covers:
  - that a Claude settings `env` block can replace the three values;
  - which settings files load in each mode;
  - that Banzai does not inspect or override such a block.
- **R7 · Gate 1 probe (ADR §6; Q3).**
  - Under Q3 (a), an unshipped maintainer probe runs Banzai's own
    implementation phase. It calls `runPhase` through `createVendorAdapters`
    and the real `runProcess`, then a resumed `runPhase` of the same session.
    It runs in a scratch repository.
  - The phase runs one foreground Bash command with a requested timeout of
    900,000 ms. The command sleeps 660 seconds and then writes a sentinel
    file.
  - It passes when all of these hold:
    - the sentinel exists when the first `result` line arrives;
    - no background-task event occurs, as defined in the plan;
    - each invocation emits exactly one `result` event, reports no permission
      denial, exits with status 0 and resolves without an error;
    - the first invocation does not fail with `TERMINAL_RESULT_CONFLICT`.
  - It prints only the client version, the event counts, the exit statuses
    and the verdict, and writes no stream to disk.
  - `gate-1-probe.md` in this directory tells the owner how to run it on
    Claude Code 2.1.290 and on the current release.
  - `compatibility:live`, its `CHECK_IDS`, its v2 summary and
    `maxInvocations` 2 are unchanged.
- **R8 · Documentation.**
  - `documentation/orchestrator.md`:
    - the client version boundaries and the version passage after the model
      table, where the WP7 reviewer paragraph becomes the one minimum;
    - the Claude environment and isolation passages: the run-stability
      variables, the stdin prompt and R6;
    - the doctor passages;
    - the live compatibility passage, which names the Gate 1 probe.
  - `documentation/getting-started.md`, root `README.md` and
    `packages/orchestrator/README.md`: Claude Code 2.1.290+ for every role.
  - `packages/orchestrator/MODULES.md`: adapters, process, doctor and live
    compatibility.
- **R9 · Facts and lifecycle.**
  - `PROJECT_MANIFEST.md` is updated:
    - minimum client versions;
    - the process runner's stdin;
    - the Claude child environment;
    - the doctor check;
    - the ADR-0063 row becomes Implemented.
  - ADR-0063's implementation state becomes Implemented, and the reciprocal
    lines in ADR-0020, ADR-0022 and ADR-0059 change "Implementation is
    Planned" to Implemented. Only lifecycle metadata changes.
  - The decision index row and the tracker are updated.

## Implementation readings

These follow from ADR-0063 and need no owner decision.

1. **The review floor plumbing goes (R1).** ADR §1 folds the floor into one
   minimum. A second constant, and a flag that no longer changes any outcome,
   would be dead code. The WP7 tests of the review floor become tests of the
   one minimum.
2. **No reviewer rotation (R4).** The stdin prompt and the run-stability
   environment change neither what a reviewer reads nor its tools. The
   reviewer invocation digest stays as WP7 left it, so a reviewer session
   recorded before WP8 resumes normally.
3. **Uniform environment (R2).** Review, planning and selection invocations
   have no Bash tool, but they receive the same three settings. ADR §2 names
   every headless Claude invocation, and a single rule is easier to verify.
4. **The prompt is written at spawn (R3).** The runner writes stdin right
   after spawn and closes it, well inside the client's 3-second wait.
5. **Workflow selection runs on the planner's settings** (`workflow.ts`,
   selection request), so its Bash maximum follows the planner timeout.
   Selection is never resumed, so "fresh and resumed" covers the other six
   spawn sites.
6. **The 2.1.290 binary check runs as plan task T1.** ADR-0063 says the plan
   confirms the three names in the 2.1.290 binary. T1 runs it after approval
   and before any argv or environment change, and the report records the
   counts.

## Owner decisions

Answer all three at plan approval, for example
`Approve, Q1 (a), Q2 (a), Q3 (a)`.

### Q1 · How much time does `BASH_MAX_TIMEOUT_MS` reserve for the closing turn?

ADR §2 sets the maximum to the effective timeout minus a fixed reserve, which
the plan sets. The default timeouts are 30 minutes for the planner and
reviewer, and 60 minutes for the implementer. Workflow selection uses the
planner's timeout, and the live review runs for 5 minutes.

With `BASH_DEFAULT_TIMEOUT_MS` removed, the real ceiling is never below the
vendor's 2-minute default. Each option therefore uses a floor of 120,000 ms,
so the variable never reads lower than the ceiling that applies. This makes
`claudeBashMaxTimeoutMs(t)` the larger of `t − reserve` and 120,000.

Below `reserve + 2 minutes`, this departs from ADR Compliance 4, which asks
for exactly the timeout minus the reserve:

- a command that runs to the 2-minute ceiling leaves less than the reserve
  for the closing turn;
- at 2 minutes or less, it can outlive the runner.

No default role is affected. The live review is, but it has no Bash tool. The
tracker records the departure as a deviation.

- **(a) Recommended: a 5-minute reserve.** The planner and reviewer get 25
  minutes, and the implementer 55 minutes. The floor applies below 7 minutes,
  including the live review.
- **(b) A 10-minute reserve.** The planner and reviewer get 20 minutes, and
  the implementer 50 minutes. The closing turn has more slack, and long test
  commands have less room. The floor applies below 12 minutes.

### Q2 · What does Banzai do about a settings `env` block that re-sets the variables?

A Claude settings `env` block replaces values from the process environment.
The project's shared settings load in every mode. Managed settings also load
in every mode. The operator's user settings and the local project settings
load in ambient and degraded scoped mode. Any of these can turn background
tasks back on or change the Bash maximum.

`--settings` cannot outrank them, because ADR §4 forbids new argv in ambient
mode and without a whitelist.

- **(a) Recommended: document it.** `orchestrator.md` says that such a block
  wins and why. Banzai treats it as the project's or the operator's explicit
  choice. A second result still fails safely with `TERMINAL_RESULT_CONFLICT`.
- **(b) Also warn in doctor.** A new advisory check reads the user, project
  and local settings files and warns when an `env` block sets one of the
  three variables. That adds a check to doctor v6 and changes R5's fixed check
  list, and it needs more settings parsing.

### Q3 · What form does the Gate 1 probe take?

ADR §6 says the probe "runs a Banzai implementation phase with the WP8
invocation". A full `banzai` run would need planning gates and commits that
add nothing to the probe.

- **(a) Recommended: a maintainer probe script.** The script lives at
  `packages/orchestrator/scripts/gate-1-probe.mjs`, with its entry under
  `packages/orchestrator/test/probes/`. It runs Banzai's own `runPhase` for
  the implementer, with the real runner and terminal observer, so a second
  result shows up as `TERMINAL_RESULT_CONFLICT`.
  - It refuses to run without an explicit scratch-repository argument.
  - npm does not ship it.
  - Its event classification and verdict logic have unit tests on recorded
    stream lines.
- **(b) A manual `claude -p` recipe.** `gate-1-probe.md` lists Banzai's argv
  and environment for the owner to type. This adds no code, but it does not
  run Banzai's runner or observer. It reads ADR §6 as "Banzai's invocation"
  rather than "a Banzai phase".

## Acceptance

1. With an injected runner, all of the following hold for the eight vendor
   spawns:
   - no argv element equals or contains the prompt;
   - `spec.stdin` equals the prompt;
   - Claude argv has `-p` and no prompt argument;
   - Codex argv's last element is `-`.

   This holds in scoped mode, ambient mode and without a scope, and with and
   without a Serena whitelist. It holds for fresh and resumed invocations
   wherever the site resumes.

2. In ambient mode and without a whitelist, each argv equals today's argv
   without the prompt, plus the Codex `-` (ADR Compliance 7).
3. A real `runProcess` spawn of a Node stub receives a prompt larger than
   131,072 bytes on stdin, with no argv element carrying it.
4. A real stub that exits without reading stdin yields its own exit outcome,
   with no uncaught stdin error. A spawn without stdin text still has stdin
   ignored. A missing executable with stdin text still fails with
   `PROCESS_START_FAILED`. Metadata probes carry no stdin text.
5. Every headless Claude spawn has these environment settings, overriding
   inherited `0`, other values and a large inherited default:
   - `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`;
   - `BASH_MAX_TIMEOUT_MS` per Q1;
   - no `BASH_DEFAULT_TIMEOUT_MS`.

   Codex spawns carry none of them from Banzai.

6. Claude Code 2.1.289 is refused with `CLI_TOO_OLD` by the vendor preflight
   for any role, with the reason in the message. `banzai setup` refuses it
   too. 2.1.290 passes.
7. Doctor `claude.version` covers every Claude role:
   - it fails for a builder on 2.1.289;
   - it warns when a version cannot be read;
   - it passes on 2.1.290;
   - it names the roles of an unavailable executable as not checked;
   - it is skipped for an all-Codex configuration;
   - it reads each distinct executable once and prints no path;
   - it spawns nothing.
8. The live policy test: `minimumCliVersions.claude` equals
   `MINIMUM_CLAUDE_VERSION`, and `CHECK_IDS`, the v2 summary and
   `maxInvocations` 2 are unchanged.
9. `npm run verify` passes.
10. At Gate 1, with the owner's go-ahead, the probe passes on 2.1.290 and on
    the current release.

## Out of scope

- The live-suite budget decision before WP13 and WP14 (ADR §6).
- The Codex minimum, and Codex-specific environment variables.
- A pre-spawn prompt size check. A prompt over a vendor cap fails as a vendor
  process failure.
- Monitor and MCP background tasks in ambient mode (ADR Consequences).
- A minimum role timeout. Short user-configured timeouts keep the Q1 floor.
- The `banzai setup` argv, and Windows (manifest §2: macOS and Linux only).
- A doctor JSON version bump.
