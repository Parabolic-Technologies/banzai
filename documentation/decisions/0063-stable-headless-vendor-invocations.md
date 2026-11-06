# ADR 0063: Stable Headless Vendor Invocations

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-11-06
- Owner: Banzai maintainers
- Decision makers: Repository owner; explicitly accepted in chat on 2026-11-06
  with `Accept`.
- Acceptance date: 2026-11-06
- Accepted proposal SHA-256: `22fa60e718f1b606a9865be171f5e1ceb7ddda1f2f2222a75676a9c0189baaa5`.
- Lifecycle effect: the decision is accepted; the proposal-stage wording and
  the decision body are retained unchanged. Dependent planning is authorized;
  plan approval is still required before implementation.
- Owner choices: given on 2026-11-06, before drafting, through four closed
  questions with these answers:
  - ambient mode: "New ADR, every mode";
  - live evidence: "Gate 1 manual probe";
  - doctor: "Every Claude role";
  - Codex: "Yes, with `-`".

  This ADR records them as written. Section 6 sharpens the probe's pass
  condition so that it exercises the raised Bash maximum. No owner choice is
  open.

- Review: one independent read-only review on 2026-11-06 before submission.
  Its findings are applied: the full set of amended text, the scope of
  "headless model invocation", the Bash timeout rules, stdin failures, the
  live and probe criteria, and the doctor contract.
- Implementation state: Implemented on 2026-11-06 by WP8 of the 2.8–2.9
  program, for the 2.8 release; the Gate 1 probe (section 6) awaits the owner.
- Preparation authority: the owner's 2.8–2.9 brief of 2026-10-30 (WP8) and
  `WP8 next` of 2026-11-06. Preparing this proposal is not acceptance; no code
  may rely on it.

## Related Artifacts

- Program brief, WP8 section, and tracker:
  [brief.md](../work/release-2-8-2-9-program/brief.md#wp8--stable-claude-phases-minimum-21290-no-background-tasks-prompt-over-stdin),
  [tracker.md](../work/release-2-8-2-9-program/tracker.md).
- Code:
  - `packages/orchestrator/src/adapters.ts`: `MINIMUM_CLAUDE_VERSION`,
    `REVIEW_ISOLATION_MINIMUM_CLAUDE_VERSION`, `requireVersion`,
    `buildClaude*Arguments`, `buildCodexArguments`,
    `isolatedClaudeEnvironment`, the vendor call sites and the terminal-result
    observers;
  - `packages/orchestrator/src/process.ts`: `runProcess` spawns with
    `stdio: ["ignore", "pipe", "pipe"]`;
  - `packages/orchestrator/src/doctor.ts`: `claude.version`;
  - `packages/orchestrator/src/setup-client.ts`: the setup launch preflight;
  - `release-policy.json`: the `live` section.
- Repository authority: [AGENTS.md](../../AGENTS.md),
  [PROJECT_MANIFEST.md](../../PROJECT_MANIFEST.md) sections 3, 6, 7 and 10,
  and the [decision lifecycle](./README.md#lifecycle).
- Accepted decisions amended here, narrowly (see Lifecycle Links):
  - [ADR-0020](./0020-scoped-claude-subprocess-environment.md), scoped Claude
    subprocess environment. Its Decision offers "an explicit opt-out that
    restores the pre-change ambient invocation", and Compliance item 8 says
    the opt-out "reproduces the pre-change argument vector exactly".
  - [ADR-0022](./0022-availability-gated-serena-mcp-whitelist.md),
    availability-gated Serena whitelist. Without a whitelist, "both vendors'
    argument vectors stay byte-identical to their pre-change form"; its
    Compliance items 9 and 11 repeat it.
  - [ADR-0059](./0059-claude-default-reviewer-and-reviewer-isolation.md),
    Claude default reviewer and reviewer isolation. It is amended in three
    places:
    - §2 sets the review isolation floor and has doctor enforce it for a
      Claude reviewer;
    - §2 and its Compliance item 5 say Codex review invocations and arguments
      are unchanged;
    - §3 says builders in ambient mode "keep the pre-existing invocation".
- Accepted decisions kept unchanged:
  - [ADR-0008](./0008-read-only-doctor-diagnostics.md): doctor may read files
    and metadata and runs no vendor CLI.
  - [ADR-0011](./0011-protected-live-vendor-compatibility.md): the live probe
    caps a run at four model invocations and keeps a closed summary.
  - [ADR-0046](./0046-supervised-live-e2e.md): keeps that probe intact.
    `release-policy.json` limits it to two invocations under the v2 summary.
  - [ADR-0040](./0040-project-adoption-preflight-and-interactive-setup.md)
    D4: the interactive `banzai setup` session passes the skill invocation as
    its initial argv input.

## Context and Decision Drivers

A **headless model invocation** is a Banzai-spawned vendor process that runs a
model on a rendered prompt and returns a structured result:

- Claude, through `claude -p --output-format stream-json --json-schema …`:
  - workflow selection;
  - planning, implementation and fix phases;
  - planning analysis;
  - planning review;
  - review and routine re-review;
  - the live-compatibility review seam.
- Codex, through `codex exec` or `codex exec resume`, with
  `--json --output-schema …`, for the same roles.

Two kinds of process are not headless model invocations:

- the version, authentication, login and plugin metadata probes, which take
  no prompt;
- the interactive `banzai setup` client launch.

Current behavior:

- The rendered prompt is one argv element of every headless model invocation.
  - On Linux one argument is limited to `MAX_ARG_STRLEN`, 131,072 bytes with
    4 KiB pages (`execve(2)`, "Limits on size of arguments and environment").
    A longer one fails the spawn with `E2BIG`.
  - The brief measured 34–53 KiB of embedded phase instructions and up to
    64 KiB for a `banzai control` request.
  - macOS limits only the total, at 1 MiB.
  - A prompt in argv is also visible in process listings.
- The Claude Code minimum is 2.1.218 (2.1.280 for the default models). A
  Claude reviewer needs 2.1.290 (ADR-0059). Before 2.1.290, a headless
  `--json-schema` run could exit non-zero with `is_error: true` on a `success`
  result when the connection dropped after the structured output was
  delivered. Every headless Claude invocation uses `--json-schema`, so on an
  older client a successful phase can count as failed.
- Since 2.1.292, a one-shot `claude -p` run waits for background commands
  that the main conversation started, then gives Claude one more turn with
  their outcome (headless documentation, "Background tasks at exit"). The
  Agent SDK reference says that such a follow-up turn produces its own result
  message.
  - In orchestrated runs, Banzai's terminal observer accepts exactly one
    `result` event. It fails a second one with `TERMINAL_RESULT_CONFLICT`.
  - Its durable observer checkpoints the first success, so a later turn could
    change the workspace after Banzai recorded the result.
  - The live seam has no such observer and reads the last result.
- Since 2.0.19, a foreground command that reaches its timeout moves to the
  background. The default Bash timeout is 2 minutes and the maximum 10 minutes
  (`BASH_DEFAULT_TIMEOUT_MS`, `BASH_MAX_TIMEOUT_MS`). An implementation phase
  may run for 60 minutes, and a test suite can need more than 10.
- `subscriptionOnlyEnvironment` passes every non-credential variable through,
  including an inherited `BASH_DEFAULT_TIMEOUT_MS`.
- The runner kills a child at its effective timeout. The live wrapper lowers
  that timeout to its per-invocation bound.

Claude Code facts used here, from its documentation and changelog read on
2026-11-06:

- `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` (2.1.4):
  - removes `run_in_background` from the Bash, PowerShell and subagent tools;
  - stops automatic backgrounding, so a foreground command that reaches its
    timeout is stopped, not moved;
  - does not disable MCP tasks or the Monitor tool.

  In scoped mode, Banzai grants neither of these: phases list their tools,
  and the only MCP server is the Serena whitelist. In ambient mode, MCP
  servers configured by the operator load, and their allow rules apply.

- `BASH_MAX_TIMEOUT_MS` caps any timeout that Claude requests. The effective
  ceiling is the larger of the two Bash variables, and the documentation sets
  no upper bound. All three variable names occur in the 2.1.316–2.1.319
  binaries; the plan confirms them in the 2.1.290 binary.
- `claude -p` reads a non-TTY stdin as the prompt. With no prompt argument,
  the stdin text is the whole prompt.
  - Piped stdin is capped at 10 MB, counted in characters.
  - If no data arrives within 3 seconds, the client continues without it.
  - Stdin is read before `--resume` and `--json-schema` take effect.
- `codex exec -` and `codex exec resume <id> -` read the prompt from stdin in
  every version from Banzai's minimum 0.145.0 to 0.166.0. Codex rejects input
  over 1,048,576 characters, from argv or from stdin.

Decision drivers:

- one terminal result per phase, matching Banzai's observer and checkpoint
  contract;
- no phase failure caused by argument length, a dropped connection after a
  delivered result, or a command that outlives the vendor's Bash limit;
- the same invocation contract in `scoped` and `ambient` mode. Ambient mode
  exists to restore plugin, MCP and settings discovery (ADR-0020), not to keep
  failure modes;
- doctor reports, offline, what run start would refuse;
- live evidence on Claude Code 2.1.290 and on the current release, without
  changing existing live evidence or its budget;
- no prompt in process listings.

## Options Considered

### Option 1: Apply the changes in scoped mode only

Ambient mode keeps today's argv and environment exactly, so ADR-0020, ADR-0022
and ADR-0059 §3 need no amendment.

Rejected (owner choice). Ambient runs would keep three defects: the
argument-length failure, the second-result conflict and the stopped long
command. These are run-stability defects, and ambient mode was not chosen to
keep them.

### Option 2: Apply the changes in every mode (selected)

Every headless model invocation gets the stdin prompt, and every headless
Claude invocation gets the run-stability variables. Ambient mode still
restores discovery.

Costs: narrow amendments to three accepted ADRs, and a one-time change to
every argv.

### Option 3: Keep background tasks and treat the last result as final

Banzai would accept several `result` events and wait for the last one.

Rejected:

- a background command could keep editing after Banzai checkpointed a
  success;
- the extra turns run outside the phase's single structured contract;
- the stream-json behavior is inferred from the SDK documentation and is not
  documented for `claude -p`.

### Option 4: Send the prompt as a stream-json user message, or through a file

`--input-format stream-json` turns stdin into a message protocol. A prompt
file would need a model-visible path, a lifecycle and a read instruction.

Rejected: plain stdin text keeps the prompt byte-identical to today's and needs
no new protocol or file.

### Option 5: Raise the Bash default timeout as well

A higher `BASH_DEFAULT_TIMEOUT_MS` would let an untimed long command finish
without a rerun.

Rejected: a hung command without a stated timeout would then consume the phase
budget. With the maximum raised, Claude can request a longer timeout when it
expects one.

### Option 6: Add the long-command scenario to `compatibility:live`

Rejected (owner choice):

- it changes the closed v2 summary and the two-invocation release budget,
  which ADR-0046 keeps intact;
- WP13 and WP14 also need live scenarios, and ADR-0011 caps a run at four
  invocations, so the live budget needs its own decision.

### Option 7: Keep doctor's version check for the reviewer only, or drop it

WP7 has doctor check only a Claude reviewer. The brief, written before WP7,
says that doctor checks no versions.

Rejected (owner choice): with one Claude minimum for every role, run start
would refuse a builder client that doctor reported as ready.

### Option 8: Move only the Claude prompt to stdin

Codex would keep its prompt in argv.

Rejected (owner choice): Codex has the same per-argument limit, and its stdin
support covers every supported version.

## Decision

### 1. One Claude Code minimum

Raise `MINIMUM_CLAUDE_VERSION` to 2.1.290, so that no `--json-schema` run
counts a delivered success as failed. Every surface that checks the Claude
minimum applies it:

- run start;
- phase preflights;
- the launch check;
- `banzai setup`;
- the live preflight, through the policy's minimum.

The `CLI_TOO_OLD` message names the reason.

The review isolation floor of ADR-0059 §2 is the same version and folds into
this minimum. Model minimums at or below it no longer bind, and they stay
recorded.

### 2. Run-stability environment for headless Claude invocations

Every headless Claude invocation runs, in both `claudeEnvironment` modes,
with:

- `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`;
- `BASH_MAX_TIMEOUT_MS` set to the invocation's effective runner timeout minus
  a fixed reserve for the closing turn. The plan sets the reserve. A command
  started with the maximum then ends before the runner stops the phase;
- no `BASH_DEFAULT_TIMEOUT_MS`. Banzai removes an inherited value, so the
  vendor's 2-minute default applies and the raised maximum stays the ceiling.

Banzai sets these values after `subscriptionOnlyEnvironment`, so an inherited
value never survives. `subscriptionOnlyEnvironment` stays a pure credential
filter. Banzai adds none of these variables to a Codex child.

### 3. Prompt on stdin

Every headless model invocation receives its rendered prompt on stdin, and its
argv carries only flags and identifiers:

- Claude: `-p` with no prompt argument;
- Codex: `-` as the prompt argument of `exec` and of `exec resume`.

The rules for stdin:

- The prompt bytes do not change. The runner writes them in full at spawn and
  then closes stdin.
- A write or close failure on stdin, such as a child that exits before it
  reads, never escapes the runner. The process outcome decides the
  invocation.
- Metadata probes and other processes that take no prompt keep stdin ignored.
- The interactive `banzai setup` launch keeps its argv skill invocation
  (ADR-0040 D4).

### 4. Ambient mode and the no-whitelist argv

ADR-0020's ambient opt-out restores pre-ADR-0020 discovery. Ambient argv
omits these discovery arguments:

- `--strict-mcp-config`;
- `--mcp-config` and its Serena `--allowedTools` grant;
- `--setting-sources`;
- `--plugin-dir`.

The opt-out does not keep the prompt in argv and does not omit the section 2
variables.

The pre-change identity that ADR-0020 and ADR-0022 promise now means identical
discovery arguments. In ambient mode, and when no Serena whitelist resolves,
argv is today's argv minus the prompt, with the Codex `-` prompt argument
added. ADR-0059's Codex review arguments change the same way, and nothing
else in them changes.

ADR-0059 §3's ambient builders keep their discovery and auto-memory behavior,
and gain sections 2 and 3.

### 5. Doctor

`claude.version`, which ADR-0059 §2 added for a Claude reviewer, now covers
every role whose effective configuration runs on Claude:

- it applies the one minimum of section 1 to each distinct Claude executable
  those roles name;
- it keeps its offline file read, so doctor runs no vendor CLI (ADR-0008);
- doctor stays `banzai-doctor/v6`, which no release has shipped yet, and this
  change extends it before its first release, as ADR-0060 did.

### 6. Evidence

The host behavior is confirmed by a probe that the owner runs at Gate 1, on
Claude Code 2.1.290 and on the current release. It runs a Banzai
implementation phase with the WP8 invocation in a scratch repository.

- The phase runs one foreground command with a requested timeout above
  600,000 ms. The command runs longer than 10 minutes and writes a sentinel
  file when it completes.
- A resumed invocation of the same session follows.

The probe passes when all of these hold:

- the sentinel exists before the phase's result;
- no background-task event occurs;
- each invocation emits exactly one `result` event and exits with status 0.

The probe keeps only the client version, the event counts and the exit status.
The implementation documents it.

`compatibility:live`, its v2 summary, its check IDs and its two-invocation
budget are unchanged. The live suite still covers the Codex and Claude review
invocations, which run with sections 1–3. A live-suite budget decision comes
before WP13 and WP14 add scenarios.

## Consequences

Positive:

- prompts no longer depend on per-argument limits and no longer appear in
  process listings;
- in scoped mode, a phase ends with one terminal result and no background
  command runs after it;
- a delivered `--json-schema` success is no longer reported as failed;
- long foreground commands run within the phase timeout;
- doctor, setup and run start agree on one Claude minimum.

Negative and risks:

- Users of Claude Code 2.1.218–2.1.289 must update before any Claude role or
  `banzai setup` runs. Doctor and the `CLI_TOO_OLD` message name the version.
- A command that reaches the 2-minute default without a stated timeout is now
  stopped instead of backgrounded. Claude sees the partial output and can
  rerun the command with a longer timeout.
- In ambient mode, an operator-configured MCP server can still start a
  background task. A second `result` event then still fails the orchestrated
  run with `TERMINAL_RESULT_CONFLICT`, after the first success has been
  checkpointed.
- Prompts are still bounded by the vendors: 10 MB of characters for Claude
  and 1,048,576 characters for Codex. A larger prompt fails as a vendor
  process failure.
- Every vendor argv changes once, and tests that read the prompt from argv
  change with it.
- Live evidence for the host behavior is a manual Gate 1 probe, not a
  repeatable live-suite check.

Required follow-ups:

- implementation under an approved WP8 plan. The plan sets the timeout
  reserve and confirms whether a settings-file `env` block can re-set any of
  the three variables in either mode;
- the binary check of the three Claude variable names in 2.1.290, recorded by
  the plan;
- the Gate 1 probe on both versions;
- a live-suite budget decision before WP13 and WP14;
- updates to the manifest, `documentation/orchestrator.md`,
  `documentation/getting-started.md` and the READMEs.

## Compliance and Confirmation

1. **Stdin prompt.** No headless model invocation has an argv element equal
   to or containing the rendered prompt, and its stdin receives exactly the
   prompt bytes. This holds in scoped and ambient mode, fresh and resumed,
   with and without a Serena whitelist.
2. **Prompt size.** A real `runProcess` spawn of a stub executable receives a
   prompt larger than 131,072 bytes on stdin, and no argv element carries it.
3. **Stdin failures.** A child that exits without reading stdin produces its
   normal process outcome, and the stdin failure neither escapes nor crashes
   Banzai. Metadata probes still spawn with stdin ignored.
4. **Run-stability variables.** Every headless Claude invocation has:
   - `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`;
   - `BASH_MAX_TIMEOUT_MS` equal to its effective timeout minus the plan's
     reserve;
   - no `BASH_DEFAULT_TIMEOUT_MS`.

   This holds in both modes, and inherited values are overridden or removed.
   Banzai adds none of the three variables to a Codex child.

5. **Claude minimum.** Run start, phase preflights, the launch check and
   `banzai setup` refuse Claude Code below 2.1.290 for every role, with a
   message that names the reason. The live run records `preflight.claude` as
   `unavailable` with the code `CLI_TOO_OLD`.
6. **Doctor.** `claude.version` fails below 2.1.290 for any Claude executable
   that a role uses, and warns when no layout yields a version. It runs no
   vendor CLI, is skipped when no role runs on Claude, and stays in
   `banzai-doctor/v6`.
7. **Discovery arguments.** Ambient argv still omits `--strict-mcp-config`,
   `--mcp-config`, `--allowedTools`, `--setting-sources` and `--plugin-dir`.
   A run without a Serena whitelist emits no MCP arguments. ADR-0059's
   auto-memory rules are unchanged.
8. **Live suite.** `compatibility:live` keeps the v2 summary, its check IDs
   and its two-invocation budget.
9. **Gate 1 probe.** On 2.1.290 and on the current release, the owner's probe
   meets section 6: the sentinel exists before the result, no background-task
   event occurs, and one `result` event and exit status 0 are recorded for
   both the fresh and the resumed invocation.
10. **Verify.** `npm run verify` passes.

## Lifecycle Links

- Amends [ADR-0020](./0020-scoped-claude-subprocess-environment.md): the
  ambient opt-out of its Decision and Compliance item 8 restores discovery
  arguments, not the prompt's argv position or the run-stability environment
  (section 4).
- Amends [ADR-0022](./0022-availability-gated-serena-mcp-whitelist.md): the
  no-whitelist argv stays identical in its discovery arguments only
  (Decision, Compliance items 9 and 11; section 4).
- Amends [ADR-0059](./0059-claude-default-reviewer-and-reviewer-isolation.md):
  - §2: the review isolation floor folds into the one Claude minimum, and
    doctor covers every Claude role;
  - §2 and Compliance item 5: Codex review arguments change only in prompt
    transport;
  - §3: ambient builders gain sections 2 and 3.
- Supersedes: None
- Superseded by: None
