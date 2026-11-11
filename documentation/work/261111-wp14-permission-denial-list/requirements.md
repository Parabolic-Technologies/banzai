# WP14 · Permission denials as a remediation list

Status: approved on 2026-11-11 with `Approve, all (a)` · Program:
[banzai 2.8–2.9](../release-2-8-2-9-program/tracker.md) · Source:
[brief, WP14](../release-2-8-2-9-program/brief.md#wp14--permission-denials-as-a-remediation-list)
· Authority: no new ADR (see [Authority](#authority))

## Problem

Every Claude phase runs with `--permission-mode dontAsk`. A tool call that no
loaded rule grants is denied, and nobody can approve it. Today:

- Banzai says before the run only that "every command a phase runs is denied"
  (`inspectClaudePermissions` in `claude-permissions.ts`). It never names the
  calls that were denied.
- The model is not told that nobody can approve, so it may retry denied calls
  and spend turns on them.
- A phase that could not run its commands reports a block in its own words.
  The human has to guess which rules to add.

Claude Code already reports each denied call in its output stream. Banzai
discards that information.

## Authority

- The brief expects no ADR, and none is needed:
  - ADR-0020, ADR-0022 and ADR-0063 fix the discovery arguments
    (`--strict-mcp-config`, `--mcp-config`, `--allowedTools`,
    `--setting-sources`, `--plugin-dir`), the stdin prompt and the
    run-stability variables. `--permission-prompts` is none of these, and
    ADR-0063 Compliance 7 stays true.
  - The package grants nothing. The flag only denies, and the proposed rules
    are printed text. The manifest rule "the CLI never silently writes
    permission rules" stays true.
- [ADR-0011](../../decisions/0011-protected-live-vendor-compatibility.md),
  [ADR-0046](../../decisions/0046-supervised-live-e2e.md) and ADR-0063 §6:
  the live summary, its check IDs and its two-invocation budget stay
  unchanged under Q2 (a).
- [ADR-0004](../../decisions/0004-privacy-minimized-read-only-evaluation-boundary.md):
  evaluation, KPI and context reports carry no command content.
- Tracker owner decisions of 2026-11-11: WP14 goes first in Stage 2, needs no
  version gate, and also proposes `permissions.allow` rules whose form these
  requirements settle (Q1).

No runner-delivered instruction text, skill, hook or `plugins/banzai/lib`
file changes, so WP14 needs no instruction-baseline transition and no
release-train version bump.

## Vendor facts

Read on 2026-11-11 from the installed Claude Code binaries 2.1.318, 2.1.319
and 2.1.322 (`claude --help` and the embedded stream schema). The brief dates
the flag to 2.1.259 from the changelog. Plan task T1 confirms the three names
in the 2.1.290 binary before any code relies on them.

- **`--permission-prompts <target>`**, with `-p` only. `host` is the default;
  with `none`, "anything that would prompt is denied automatically; the
  permission mode still decides everything else".
  - Allow rules, the permission mode and `PermissionRequest` hooks decide
    first. The flag only ever denies and allows nothing.
  - The model is told that the session has no approval surface, that the
    action was not performed, and not to retry it.
  - Claude's questions and plan-mode tools are not offered to the model.
  - It applies to subagents too.
- **`system` event, subtype `permission_denied`**: `tool_name`,
  `tool_use_id`, optional `agent_id` (set for a subagent's call), optional
  `decision_reason_type` (for example `mode`, `rule`, `classifier`,
  `asyncAgent`), optional `decision_reason`, and `message`. The schema calls
  it a best-effort advisory.
- **`result.permission_denials`**: an array of `tool_name`, `tool_use_id` and
  `tool_input`. The schema calls it the authoritative record.
- **Not covered by either:** a `PreToolUse` hook denial, a deny rule that
  overrides a hook's allow, and a file-tool call refused by a path-scoped
  deny rule. A write that the Banzai hook refuses therefore never appears in
  the list.

## Requirements

- **R1 · The flag.** `buildClaudeArguments`, `buildClaudeSelectionArguments`
  and `buildClaudePhaseArguments` emit `--permission-prompts none` directly
  after `--permission-mode dontAsk`.
  - This holds in scoped and ambient mode, fresh and resumed, with and
    without a Serena whitelist.
  - There is no version gate: the Claude Code minimum is 2.1.290.
  - Codex argv and the interactive `banzai setup` launch are unchanged.

- **R2 · The exact list.** A pure function in `adapters.ts` reads one Claude
  stream and returns its denied calls.
  - Entries come from the last `result` event's `permission_denials` and from
    every `permission_denied` event, merged by `tool_use_id` in order of first
    appearance. The result supplies the tool input; the event supplies the
    reason type and whether a subagent made the call.
  - A stream without a `result` event (a timeout or a crash) still yields the
    calls its events named, without input.
  - An entry has: the tool name, a one-line detail built by the existing
    progress rules (`summarizeCommand` for Bash, the repository-relative path
    for file tools, the tool name otherwise), the exact Bash command when
    there is one, the reason type or null, and a subagent flag.
  - Malformed entries are skipped. A stream without denials yields an empty
    list.
  - The function reads structured fields only. It never parses `message` or
    `decision_reason` prose.

- **R3 · Carried with the attempt.** `AdapterResult` and `ProcessExitError`
  carry the list beside `turnCount`, for all four Claude call sites and for a
  failed process. Codex results carry none.

- **R4 · Recorded.** When an attempt's list is not empty, the runner appends
  one run event `attempt.permission_denials` with the attempt ID and kind, the
  total count and the entries.
  - Text is passed through `redactSensitiveText` and each detail and command
    is bounded. At most 50 entries are stored; the count stays exact.
  - The event is written for completed and failed attempts.
  - `status --json`, agent status and capabilities, run state schemas, and the
    evaluation, KPI, context and cancellation reports are unchanged and carry
    none of this content.

- **R5 · Shown when the attempt ends.** After a Claude attempt with denials,
  the runner prints one block to stderr through the progress reporter:
  - a heading with the count and the phase, for example
    `Claude denied 3 tool calls during implementation:`;
  - one line per distinct call, with a repeat count when the model retried
    it, a `(subagent)` mark, and `refused by a deny or ask rule` for reason
    type `rule`;
  - the rule proposal of R7;
  - the line `Banzai never writes permission rules.`

  The block is a runner message, so every progress level shows it, `quiet`
  included. The list shows at most 20 distinct calls and then `and N more`.

- **R6 · Shown in status.** Human `banzai status` for a run that is blocked
  or failed repeats the block of R5 for the run's latest model attempt, read
  from the recorded event. `status --json` is unchanged.

- **R7 · Proposed allow rules (Q1).** For denied Bash calls the block
  proposes rules and names the file that the session actually loads.
  - Under Q1 (a) a rule is the exact command, `Bash(<command>)`. It is
    proposed only for a single-line command with no shell operator
    (`&&`, `||`, `;`, `|`, redirection, substitution, a subshell or a
    backgrounding `&`), no `(` or `)` and at most 200 characters. Other
    commands are listed with `needs a hand-written rule`.
  - Rules are printed as a ready `permissions.allow` JSON fragment, distinct
    and in first-seen order.
  - The target file comes from the same audit that `banzai doctor` uses:
    `.claude/settings.json` in scoped mode, with a note that it is tracked and
    shared; `.claude/settings.local.json` in ambient mode.
  - When the audit says that the checkout is untrusted, the existing trust
    step comes first.
  - A call refused by a deny or ask rule gets no proposed rule, because an
    allow rule does not override it.
  - Denied calls of other tools are listed without a rule.
  - Banzai writes nothing to any settings file.

- **R8 · Advisory only.** Denials never change an attempt's outcome, failure
  cause, retry or recovery eligibility, or session reuse. A phase without
  denials produces no event and no output, and its argv differs from today's
  only by R1.

- **R9 · Live evidence (Q2).** Under Q2 (a), a maintainer probe that the
  owner runs for Gate 2 on Claude Code 2.1.290 and on the current release
  confirms, with Banzai's own implementation-phase invocation:
  1. the client accepts the flag: one `result` event and exit status 0;
  2. a Bash command that no rule grants is denied, its sentinel file does not
     exist, and R2 returns exactly that command once;
  3. a Bash command that a project allow rule grants runs, and its sentinel
     exists;
  4. `AskUserQuestion` is absent from the `system/init` tool list.

  `compatibility:live`, its v2 summary and its two-invocation budget stay
  unchanged.

- **R10 · Documentation.** `PROJECT_MANIFEST.md`,
  `packages/orchestrator/MODULES.md` and the "Claude Tool Permissions" section
  of `documentation/orchestrator.md` describe the flag, the list, the proposed
  rules and their limits. `documentation/getting-started.md` is updated only
  if it describes denied commands.

## Acceptance

1. A fixture stream with three denied calls, one of them retried and one made
   by a subagent, yields the exact list of R2, and the block of R5 names each
   call once with its repeat count.
2. A fixture stream that ends without a `result` event yields the calls its
   `permission_denied` events named.
3. Every Claude argv that the adapter builds contains
   `--permission-prompts none` once, and no Codex argv contains it.
4. A workflow run whose implementation stream carries denials appends one
   `attempt.permission_denials` event and reports the block; the same run
   without denials appends none and prints nothing new.
5. A secret in a denied command is redacted in the event and in the output.
6. `status --json` and the agent-control projections are byte-identical for a
   run with and without the event.
7. A compound or multi-line denied command gets no proposed rule.
8. `npm run verify` and `npm run format:check` pass.
9. The R9 probe is built, covered by a fixture test of its verdict, and
   documented for the owner. Its live run is a Gate 2 item.

## Out of scope

- Granting commands from the approved plan with `--allowedTools` (WP22).
- A sandbox for builder phases (WP17).
- Writing permission rules, or any `banzai` command that edits settings.
- Denial data in machine-readable status, agent control or evaluation
  exports. WP17's decision can read the recorded events.
- Codex sandbox denials.

## Owner questions

- **Q1 · Form of a proposed allow rule.**
  - **(a) Recommended: exact commands only.** `Bash(npm run lint)`. A rule
    never grants more than the call that was denied. It helps less when a
    command's arguments change between runs; WP22 covers the plan's check
    commands.
  - (b) Prefix rules. `Bash(npm run:*)` from the first two words. Fewer
    repeat denials, but each rule grants commands nobody saw.
  - (c) Both: the exact rule, and the prefix rule as a marked alternative.

- **Q2 · Live evidence and its budget** (ADR-0063 §6 requires this decision).
  - **(a) Recommended: a Gate 2 maintainer probe**, built on the Gate 1 probe
    harness. One invocation per client version, run by the owner.
    `compatibility:live` is unchanged, and no ADR is needed.
  - (b) A third scenario in `compatibility:live`. It needs a new live summary
    version, a `release-policy.json` change and an ADR that amends ADR-0046,
    and every release then pays for a third invocation.

- **Q3 · Binary check of 2.1.290.** T1 downloads
  `@anthropic-ai/claude-code-darwin-arm64@2.1.290` from the npm registry into
  the session scratchpad (about 97 MB packed), never runs it, counts three
  names and deletes it, as WP7 and WP8 did.
  - **(a) Recommended: yes.** A missing flag on the minimum client would fail
    every Claude phase with an unknown option.
  - (b) No download. The flag rests on the brief's changelog reading until
    the Gate 2 probe runs on 2.1.290.
