# Standalone plugin rework: work plan

Status: active · 2026-11-16 ·
[ADR-0069](../../decisions/0069-standalone-plugin-control-model.md) accepted
on 2026-11-16, ADR-0070 and ADR-0071 accepted on 2026-11-16 · no package
started

This is a package-level plan, not a strict development plan. It carries no
verification inventory and authorizes no code. Each package gets its own
requirements and plan in its own work directory, named when it starts.
Packages P5 and P6 also start with their own ADR.

## Goal

One centrally delivered plugin that developers start with three commands,
where specification files stay the working contract, decision gates are held
by hooks, review is independent, and instruction text is sized for Fable 5.2
and Opus 5.5.

## Inputs

- ADR-0069 (Accepted) with the owner's answers PR-1, PR-2 and PR-3 and
  owner choices 1 (a) and 2 (a).
- The replay comparison study,
  [plan.md](../261111-native-comparison-study/plan.md): six counted runs so
  far. Its harness, task cards and rubrics are reused in package P10.
- The skills audit of 2026-11-14 (owner document), re-checked on 2026-11-16.
  Its repository facts hold. Six of its Claude Code assumptions are wrong or
  undocumented; P0 settles the ones this plan depends on.

## Packages

| ID  | Package                             | Depends on | Authority                               | Kind                |
| --- | ----------------------------------- | ---------- | --------------------------------------- | ------------------- |
| P0  | Host behaviour probe                | —          | owner go-ahead for live runs            | probe, no product   |
| P1  | Work approval, typed command, stamp | P0, P11    | ADR-0069 §1–§3, §5, §6                  | hook, skill, helper |
| P2  | Detect-then-gate for shell writes   | P1         | ADR-0069 §4                             | hook                |
| P3  | Session context hook                | P0         | ADR-0069 §8                             | hook                |
| P4  | Three explicit entry commands       | P1, P3     | ADR-0069 §7                             | skills              |
| P5  | Independent standalone review       | P0         | its own ADR, written at start           | skill, agent        |
| P6  | Instruction text removal            | P3, P4     | its own ADR, written at start; ADR-0044 | skills, policies    |
| P7  | Slim `AGENTS.md` template           | P3, P6     | WP12 of the 2.8–2.9 program             | template            |
| P8  | Central distribution guide          | —          | none expected                           | documentation       |
| P9  | Codex parity discovery              | —          | owner answer PR-3                       | desk research done  |
| P10 | Measurement on the replay harness   | P2, P5     | owner go-ahead for live runs            | evidence            |
| P11 | Orchestrator-owned instruction copy | —          | ADR-0070                                | build, baseline     |
| P12 | Path-scoped verification gate       | P11        | ADR-0071                                | scripts, workflow   |

Order: P11 and P12 first, because they make every later package cheaper to
check. Then P0, P1, P2, P3, P4, P5, then P10
(first measurement), P6, P7, then P10 again. P8 can run at any time. P9's desk
research is done and no parity package follows it. The order puts gate
enforcement first because it changes outcomes, and text removal after the
measurement that can show its effect.

### P0 · Host behaviour probe

Settle, on the pinned Claude Code version and on the current one, what the
documentation leaves open:

1. the typed-command event fires for a plugin command the human types,
   carries its arguments, and does not fire when the model calls the same
   command; and what it does when a run without a human starts with that
   command;
2. hooks before and after a shell command, the failed-command event
   included, can keep a session state that a later hook call reads;
3. the cost of comparing content around a shell command on this repository;
4. session-start context arrives on each of the five session sources;
5. the model's own call of a user-only command is refused;
6. a forked skill that names a plugin-scoped agent runs that agent (for P5).

Documented and therefore not probed: a hook's `ask` in a run without a
human is denied and the model reads the reason; a hook that follows a tool
runs only after success, and a separate event covers failures; in auto mode
an injected command that needs approval is handed to the model.

Done when each item has an observed answer with the client version, and the
probe risk of ADR-0069 is resolved or turned into a design constraint. A
failed item changes the design of the package that needs it before that
package starts.

### P1 · Work approval, typed command, stamp

Done when ADR-0069 compliance items 1 to 5, 9, 10, 13, 14 and 15 pass. By
owner choice 1 (a) an approved plan stays unchanged, so the package also
moves standalone task completion from the plan's checkboxes to the
implementation report, in the skills, the plan policy and the status
reader. The hook is a pinned resource: the package ends with one ADR-0044
transition and follows the release rule for a changed hook. The Codex
manifest gets its own hook file with today's events, so new events never
reach a Codex session.

### P2 · Detect-then-gate for shell writes

Done when compliance items 6, 7 and 8 pass and the comparison stays within
an agreed time on this repository, the largest one in use. The package
records how ignored files, generated files, formatters and package
installation are treated, and lists the write-capable tools the comparison
does not see.

### P3 · Session context hook

Done when compliance item 12 passes and the context names the active work
directories with their approval state, the session's attachment and the
entry commands in no more than a fixed, small number of lines.

### P4 · Three explicit entry commands

Done when compliance item 11 passes, hook reasons name the commands, and
the guides teach three commands. By owner choice 2 (a) the entry names stay
`feature`, `quick-fix` and `feature-review`.

### P5 · Independent standalone review

Starts with its own ADR, because it answers a different question from
ADR-0069. Inputs for that ADR: the review runs without the builder's
context and without a shell; the invoking session writes the returned text
to the review artifact unchanged, so a builder cannot drop a finding before
triage; the review takes its work path as an argument and defaults to the
uncommitted change; a review states in its artifact when it had no fresh
context; whether the reviewer inherits the session's model or uses a named
one is that ADR's owner choice. Until it is accepted `feature-review` keeps
its text.

### P6 · Instruction text removal

Needs no baseline transition and no ADR of its own once ADR-0070 is
accepted: that decision makes plugin text ordinary source and ends
ADR-0042's transitional exception for the skills' `Orchestrated Mode`
sections. Without ADR-0070 the package starts with its own ADR instead.
Candidate scope, from the audit's
rows 1 to 9: those eight sections (2,058 words), the layout bullet in eleven
skills, the storage preamble in ten, the stop-on-missing-file clauses and
runner-only passages. Constraints the independent review of ADR-0069 found:

- the runner build parses each policy's `- Runner consumers:` header, and
  the runner embeds guidance and policies, so those are excluded or the
  build changes in the same package;
- the runner checks that eleven skill files exist and that the hook matcher
  lists five tools, so no skill file is removed and the matcher only grows;
- each gate stays stated once, because Codex sessions rely on that text.

Done when the baseline validation still passes and the lite `feature` route
loads no more than an agreed word count.
Merging the numbered workflows (audit row 10) is excluded until P10 has
compared it on both models.

### P7 · Slim `AGENTS.md` template

This is WP12 of the 2.8–2.9 program, which already plans its own ADR
amending ADR-0036. This plan adds one input: the sections that P3 and the
hook now state themselves (routing, hook gate) leave the template. No second
package is created.

### P8 · Central distribution guide

A maintained guide: the marketplace entry, how an update reaches every
developer, and how a stale installed hook is detected. The plugin stays
optional. The owner decided on 2026-11-16 that it is not forced on, so the
guide describes no managed enforcement.

### P9 · Codex parity discovery

Done on 2026-11-16 as desk research on codex-cli 0.167.0, with no live
session. Sources: strings of the local binary, the client's help output, its
source at tag `rust-v0.167.0` and its documentation; the web pages were read
through a summarizing fetcher, so their wording is second-hand.

| Mechanism of ADR-0069                   | Codex 0.167.0                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| Hook asks the human before a write      | No. The binary reports `permissionDecision:ask` as unsupported; `deny` works    |
| Hook after a shell command              | Yes, for the shell and `apply_patch`, with a message back to the model          |
| Session-start context                   | Yes, on `startup`, `resume`, `clear`, `compact` and `fork`                      |
| Command only the user can invoke        | Partly. Implicit invocation can be switched off; no script runs before the text |
| Approval from the user's own prompt     | Possible in principle: a hook on the user's prompt exists in both clients       |
| Forked reviewer with a restricted agent | No. Agents are not shipped by plugins and take no tool list                     |
| Stop hook that blocks once              | Yes                                                                             |

Two facts matter beyond the table. The manual gate's first-edit prompt is
not a gate under Codex today, because the client does not honour `ask`. And
Codex skips a plugin's hooks until the user trusts them, again after every
plugin update.

Not observed in a session: whether an unsupported `ask` lets the call
proceed (read from the client's source), whether the hook fires for edits
and shell commands in `codex exec`, and whether hooks fire inside subagents.

Outcome: a client-neutral core with two adapters is possible, with a
stricter deny-until-approved flow under Codex. The owner decided on
2026-11-16 to keep Claude Code first (ADR-0069, option 9). No parity package
follows.

### P10 · Measurement on the replay harness

A new arm of the existing harness: the reworked plugin on tasks T1, T4 and
T7, two trials each, with `claude-fable-5-2` at `high` and with
`claude-opus-5-5` at `xhigh`. Measures, per run: whether a source write
preceded approval, gates held, operator prompts and their wait, review
findings by kind, the repository's own checks, tokens. The baseline is the
current plugin's arm on the same tasks. Twelve runs per measurement; T4 on
this repository cost about 40 million input tokens in the native arm, so the
budget is agreed before the first run.

### P11 · Orchestrator-owned instruction copy

Implements [ADR-0070](../../decisions/0070-orchestrator-owned-instruction-copy.md),
accepted on 2026-11-16. The tracked generated module becomes the
orchestrator's frozen instruction set and is no longer generated from plugin
files. The current baseline is closed and kept as a record; a successor
baseline pins the frozen module, the hook files and the plugin manifests,
and allows the hook configuration and a manifest to change through a
transition. The runner's parity check keeps the hook and drops the text.
Checks that pin plugin text move to the frozen module, stay as ordinary
plugin tests, or end. By the owner's choice the `orchestrate` skill and its
protocol reference are removed from the plugin, and the runner's structural
check and the setup check stop requiring it. Done when ADR-0070's compliance
items pass.

P1 depends on this package: today no baseline transition may change
`hooks.json` or a plugin manifest, and ADR-0069 needs both changed.

### P12 · Path-scoped verification gate

Implements [ADR-0071](../../decisions/0071-path-scoped-verification-gate.md),
accepted on 2026-11-16, after P11. Three scopes by listed roots (documents,
plugin, full), suites whose membership a test enforces, one local command,
the three CI lanes running the scope's checks with the base revision's
rules, release evidence only from the literal complete check, and the
release validator updated for the new workflow layout. Done when ADR-0071's
compliance items pass.

What it saves, and what it does not: documents, skills, policies, guidance
and templates leave the full suite. The hook, the library, the contracts and
the plugin manifests stay full scope, so P1, P2 and P3 gain nothing for
their hook changes; P4, P5, P6, P7 and every document change gain most.

## Out of scope

- The orchestrator: its hold, its blockers and ADR-0068 are decided with the
  study report.
- Runner phases, contracts and the hook's runner branches.
- Removing Codex support.
- Any change to the five decision gates' meaning or to ADR lifecycle rules.

## Open items for the owner

- Published CLI 2.8.x with a configured plugin directory, or linked from
  source, refuses a plugin whose hook or instruction text differs from its
  own. Decide what such setups are told before the first plugin change of
  this plan is released.
- Whether this plan joins the 2.8–2.9 program tracker or becomes an
  initiative with its own brief and tracker. It is outside the frozen brief.
- The go-ahead and budget for the live sessions of P0 and P10.
- Whether the hook guide and the template say now, before the rework, that
  the manual gate does not prompt under Codex.
