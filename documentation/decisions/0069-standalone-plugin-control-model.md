# ADR 0069: Standalone Plugin Control Model

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-11-16
- Owner: Banzai maintainers
- Decision makers: Repository owner; explicitly accepted in chat on 2026-11-16
  with `Accept as recommended`.
- Acceptance date: 2026-11-16
- Accepted proposal SHA-256: `7d77588053dbbe132635774e48db72b9a6e6e8b8a831b1f0350a4f12084985c3`.
- Owner choices at acceptance: 1 (a) and 2 (a), the recommended options. An
  approved plan stays unchanged and standalone task completion is recorded
  in the implementation report; the entry names stay `feature`, `quick-fix`
  and `feature-review`.
- Lifecycle effect: the amendments in Lifecycle Links are accepted, the one
  to ADR-0038 by owner choice 1 (a), and their reciprocal links are recorded.
  The proposal-stage wording and the decision body are retained unchanged.
  Dependent planning is authorized; plan approval is still required before
  implementation.
- Owner choices given on 2026-11-16, before drafting, through three closed
  questions:
  - PR-1, shell writes before approval: "Detect, then gate (Recommended)";
  - PR-2, entry points: "Three explicit commands (Recommended)";
  - PR-3, clients: "Claude Code first. Discover if that's possible to achieve
    parity with Codex in behavior";
  - PR-3 follow-up, after the Codex desk research of the same day showed
    that a client-neutral core is possible: "Keep Claude first", with the
    note `Більшість команди працює на Claude` (most of the team works in
    Claude Code);
  - organisation enforcement, after the review: `Примусу не буде` (there
    will be no enforcement). The question is removed from this ADR.

  This ADR records them as written. Two further owner choices are open at
  acceptance; see [Owner choices at acceptance](#owner-choices-at-acceptance).

- Review: one independent read-only review on 2026-11-16, requested by the
  owner with `Review it first`. It raised six major and five minor findings.
  Each was checked against the sources and all are applied:
  - an approved bundle no longer contains files the standalone flow edits;
  - session approval and work approval have a stated precedence, and a
    session uses a work approval only after the human attaches it;
  - a work approval ends by a stated rule and never covers a path outside
    the repository;
  - shell detection compares one command's own window, failed commands
    included, and names what it does not see;
  - approval is recorded from the human's typed command, not from a script
    the host may hand to the model, and file tools cannot write the record;
  - runner sessions and Codex sessions are untouched by construction;
  - the amendments to ADR-0064 and ADR-0038 are declared, and ADR-0058 and
    ADR-0054 are preserved;
  - independent review and instruction text removal leave this ADR for their
    own decisions, because they answer different questions;
  - the security exposure is stated, and every decision section has a
    compliance item.
- Implementation state: Planned. See the work plan.
- Preparation authority: the owner's request of 2026-11-16 to draft the ADR
  and work plan for the plugin rework. Preparing this proposal is not
  acceptance.

## Related Artifacts

- Work plan:
  [plan.md](../work/261116-standalone-plugin-rework/plan.md).
- Replay comparison study:
  [plan.md](../work/261111-native-comparison-study/plan.md). Its first six
  counted runs are interim evidence: 6 of 36, no blind assessment yet.
- Skills audit of 2026-11-14, an owner document outside the repository. Its
  repository facts were re-checked on 2026-11-16 against `fa89da9`, and its
  Claude Code assumptions against the product documentation.
- Code, as of `fa89da9` (2.8.3):
  - `plugins/banzai/hooks/hooks.json`: PreToolUse and PostToolUse match
    `Edit|Write|MultiEdit|NotebookEdit|apply_patch` only. Both client
    manifests load this one file;
  - `plugins/banzai/hooks/spec-gate.cjs`: the manual-mode approval is one
    marker per session in the operating system's temporary directory; only
    runner mode denies writes to control paths;
  - `plugins/banzai/lib/task-verification.mjs`: the plan remainder digest
    covers every plan byte outside the inventory, task checkboxes included;
    `rewritePlanRemainderDigest` rewrites its value in place;
  - `plugins/banzai/skills/`: twelve skills, nine of them selectable by the
    model from their descriptions. Standalone `code-writing` marks completed
    tasks `[x]` in the plan.
- Accepted ADRs:
  - [ADR-0062](./0062-claude-memory-notes-in-the-manual-hook-gate.md)
    (pinned): free paths, memory notes, the bookkeeping approval scope and
    the per-session project marker. Amended by sections 1 to 4; every rule
    of its own is preserved.
  - [ADR-0064](./0064-runner-recorded-plan-remainder-digest.md) section 3:
    "Standalone `development-plan` sessions … keep computing the digest
    themselves." Amended by section 6. Its "Approval never rewrites a
    digest" is preserved.
  - [ADR-0038](./0038-explicit-plan-authority.md): the standalone completion
    fallback, plan checkboxes. Amended by section 5 under owner choice 1 (a).
  - [ADR-0058](./0058-human-plan-edits-rechecked-at-the-plan-gate.md)
    (pinned) section 5 and
    [ADR-0054](./0054-git-visible-work-artifacts.md) (pinned): preserved.
    Approval rewrites no digest, and Markdown editing gains no ceremony.
  - [ADR-0044](./0044-instruction-baseline-evolution.md): every changed
    instruction resource, the hook included, needs a recorded transition.
  - [ADR-0027](./0027-exposure-driven-security-assurance.md): the exposure
    classes used below.
  - [ADR-0068](./0068-runner-granted-commands-from-the-approved-plan.md)
    (Proposed, on hold): runner phases only; unaffected.
- Manifest sections 5 (plugin and hook owners), 6 (decision gates) and 10.

## Context and Decision Drivers

Decision question: in a standalone session, who holds the decision gates and
how does gated work start: the model, following prose, or the host?

Current state. A standalone session reads the gates as prose in `AGENTS.md`
and the skills. The hook adds one backstop: the first `Edit` or `Write` to a
non-free path in a session asks the human, and that answer unlocks every
later write of the session, inside and outside the repository. The approval
is not tied to a work item, a plan or any bytes, and a new session asks
again. Shell commands are not matched. Work starts when the model picks a
skill from its description.

What the replay study observed, with `claude-fable-5-2` at effort `high`:

- Prose gates did not hold. In two shake-down sessions the model treated the
  request itself as approval of a named escalation trigger. In the large
  counted run the session wrote code before it showed its plan, and its plan
  recorded that it "was not approved separately".
- The gates that held were the ones the host enforces: plan mode in the
  native arm, in every run, and the hook, when it fired.
- The hook fired late. In the large run four source files were changed
  through Python scripts in the shell before the first hook prompt.
- Skill selection failed where it matters most. In the large run the session
  invoked no skill in 161 tool calls and followed the task brief's own
  process. On the two small runs it selected `feature` and `quick-fix`.

Vendor guidance for these models points the same way: keep an own
confirmation step for risky actions and name approval rules narrowly.

Decision drivers:

1. A gate must not depend on the model choosing to stop.
2. An approval must name what was approved, stop covering it when it
   changes, and never reach a session the human did not point at it.
3. Starting the process must not depend on the model choosing a skill.
4. A developer learns few commands, and read-only work is never interrupted.
5. Markdown work documents stay ordinary files to edit (ADR-0054).
6. The hook stays an accident barrier. It is not a sandbox, and this ADR
   does not claim one.

### Security exposure

Judged by mechanism under the Security Assurance policy:

- Class 2, an access decision. This ADR changes who may authorize a source
  write. The enforcement point is the hook; the authority is a command the
  human types. Sections 2 and 3 state every way an authorization is created
  and used, and Risks states the ways around it that remain.
- Class 1, input reaching a resource path. The typed command names a work
  directory. It is resolved inside the repository, without following a
  symbolic link, before anything is read or recorded.
- Class 7, an overwrite. The helper's stamp of section 6 rewrites one value
  in a plan. It keeps the compare-and-replace rule of ADR-0058: every other
  byte unchanged, refused when the file changed since it was read.

No other class applies: no secret, personal data, cross-principal data or
outbound request is involved.

## Options Considered

### Option 1: Keep prose gates and the per-session first-edit prompt

No change and no risk of new prompts. Rejected: it is the state the study
observed failing on drivers 1, 2 and 3.

### Option 2: Trim instruction text only

Cheap, and it removes text that can misfire. Rejected as the answer to this
question: it changes neither who enforces a gate nor how work starts. It is
a separate decision of the work plan.

### Option 3: Use the host's plan mode as the gate

It held in every native run. Rejected as the plugin's gate: a plugin cannot
put a session into plan mode, plan mode forbids writing the specification
files the method needs, and its approval covers a session, not a work item.
It stays compatible: a developer may still plan in plan mode.

### Option 4: Ask before every shell command until approval

Nothing slips through. Rejected by the owner (PR-1): discovery, tests and
`git` would prompt constantly, and a run without a human could not start.

### Option 5: Deny source writes before approval

Stricter than asking. Rejected: an adopted repository also sees small ad hoc
edits, and a gate is a human decision point, not a prohibition.

### Option 6: Keep model-selected skills and add a routing line

No renaming and no new habit. Rejected by the owner (PR-2): the start of the
process would still depend on the model.

### Option 7: Enforce through the orchestrator

The runner already binds approvals to digests and isolates the reviewer.
Not selected here: both counted runner runs ended blocked by the runner
itself, and further runner work is decided with the study report.

### Option 8: Hook-held approval per work item with explicit entry (selected)

Sections 1 to 9. It moves enforcement to the host for drivers 1 to 3, reuses
digest code the plugin already has, and leaves read-only work and Markdown
editing unprompted. Its costs are more hook code in a pinned resource, one
new command to learn, and a typed command at the start of each session that
continues approved work.

### Option 9: A client-neutral core with Claude Code and Codex adapters

One hook core returns "a human decision is needed", which Claude Code shows
as a prompt and Codex as a denial with instructions. It would give Codex
sessions an enforced gate. Its costs are a stricter flow under Codex, a
second test matrix with live Codex probes, and dependence on a hook trust
step that Codex repeats after every plugin update. Rejected by the owner
(PR-3 follow-up): most of the team works in Claude Code.

### Option 10: Record approval from a script the approval command injects

The command's text would run a script before the model sees it. Rejected:
in the host's auto mode an injected command that needs approval is handed
to the model to run, so the model would record the approval, and a managed
setting can switch injection off for plugin skills.

### Option 11: Ask before every write to an approved bundle file

It would catch a changed plan at once. Rejected: ADR-0054 keeps Markdown
editing free of ceremony, and the digest rule of section 5 already surfaces
the change at the next source write.

### Option 12: One approval record valid for every session of the repository

No typed command in later sessions. Rejected: a record that outlives its
work would authorize unrelated work in any later session, with no prompt.

## Decision

### 1. Two approvals, each with one meaning

- A session approval is today's per-session marker. Its meaning, scope and
  storage are unchanged (ADR-0062).
- A work approval is a record for one strict work directory. It holds the
  work directory, the digest of its approval bundle and the time. The bundle
  is the description, the plan and the ADRs the plan cites. The record is
  local, ignored state under the repository's `.banzai/`; it is never a work
  document.
- Lite routes have no work approval. Their work document is also their
  report and changes while the work runs, so there are no stable bytes to
  bind. They keep the session approval.

### 2. Only the human's typed command creates an authorization

- The plugin ships one approval command. The host hook that runs when the
  human types a command writes the record. No tool call, skill text or
  injected script writes it, and the model cannot invoke the command.
- A session is attached to a work directory when the human types the
  approval command, or an entry command of section 7, naming it in that
  session. The same hook records the attachment as session state.
- The command also revokes a record.
- In manual mode a file-tool write to the record or to the hook's session
  state is denied, with or without a session approval.
- Consultation answers, skill reports and hook prompts never create a work
  approval.

### 3. When a file-tool write to a non-free path passes

In this order:

1. a session approval exists: it passes, as today;
2. the session is attached to a work directory, that directory's record is
   valid, and the target lies inside the repository: it passes without a
   prompt;
3. otherwise the hook asks, as today. The reason names the attached work
   directory and why its record does not apply, when there is one, and the
   approval command. The human's answer records a session approval, as
   today.

A record is valid while the bundle on disk has the recorded digest and the
record is not revoked. A work approval never authorizes a write outside the
repository.

### 4. A shell command that changes source is detected, then gated

- The hook compares the content of non-free repository paths before and
  after each shell command, whether the command succeeds or fails.
- A change with neither a session approval nor a valid attached record puts
  the session into an unapproved-change state and records the changed paths.
- In that state the next shell command or file-tool write to a non-free path
  asks, and the reason lists the paths. Read-only file tools and writes to
  free paths are not asked.
- The state ends when the human answers that prompt, which records a
  session approval, or when a valid attached record exists.
- Outside that state a shell command gets no decision from the hook.
- A bookkeeping approval of ADR-0062 never ends the state.

The comparison covers one command's own window. A change made by a
background command, by another process or by a tool that is neither a file
tool nor the shell is not attributed.

### 5. An approved bundle does not change

- The bundle digest covers the exact bytes of the bundle files. Any change
  to one of them ends the record's validity.
- The hook gives no decision on a write to a bundle file. Work documents
  stay free paths, as ADR-0062 and ADR-0054 decide. The changed file is
  named by the next prompt of section 3 or 4.
- Standalone work therefore records task completion outside the bundle,
  under owner choice 1.

### 6. Digests come from the helper, never from approval

- The installed verification helper gains a stamp operation that computes a
  plan's remainder digest and writes that one value, under the
  compare-and-replace rule. A standalone planning session calls it; it no
  longer computes the digest itself.
- Approval rewrites no digest. The approval command refuses a plan whose
  remainder digest does not match its bytes and names the stamp operation.
- The stamp authorizes nothing.

### 7. Work starts from three commands the developer types

- `feature`, the fix entry and the review entry are invoked by name. The
  model does not select them.
- The strict steps (requirements, architecture decision, plan, code, tests)
  are steps of `feature`, entered when an escalation trigger applies. They
  are not separate entry points. No skill file is removed.
- A request that reaches a source write without an entry meets section 3 or
  4, whose reason names the commands.

### 8. The session is told where it stands

In an adopted repository a session-start hook adds a short context on every
session source the host reports (start, resume, clear, compaction, fork):
the active work directories with their approval state, the session's
attachment, and the three commands. Elsewhere it adds nothing.

### 9. Runner sessions and Codex sessions are untouched

- Under runner context none of sections 1 to 8 acts. The hook decides runner
  mode first, as today, and the new hook events do nothing there.
- Under Codex none of sections 1 to 8 acts. The Codex manifest keeps
  loading today's hook events only. Codex sessions behave as before this
  decision: they rely on the prose gates, because the codex-cli 0.167.0
  binary reports a hook's `ask` decision as unsupported. The work plan
  records the desk research (package P9).

### 10. What does not change

The five decision gates and their meaning; ADR lifecycle rules; the free
paths, memory notes and bookkeeping scope of ADR-0062; the plugin-source
exemption; the `bypassPermissions` opt-out. Installing and enabling the
plugin stays each developer's and each project's choice: nothing in this
decision forces it on.

### Not decided here

Independent standalone review and the removal of instruction text answer
different questions. Each gets its own ADR when its package of the work plan
starts. Until then `feature-review` and every instruction resource other
than those sections 1 to 8 require keep their text.

## Owner choices at acceptance

1. Standalone task completion. (a) An approved plan stays unchanged, as in
   orchestrated mode, and completion is recorded in the implementation
   report (recommended: one rule in both modes, and the hook hashes plain
   file bytes); (b) the plan's checkboxes keep being ticked, and the bundle
   digest ignores completion marks and the inventory's own digest value.
2. Names. (a) Keep `feature`, `quick-fix` and `feature-review` as the three
   entry names (recommended: 97 pinned expectations, the guides and existing
   work documents use them); (b) rename the last two to `fix` and `review`.

## Consequences

Positive:

- A gate holds without the model's cooperation for file tools, and within
  one step for the shell.
- A work approval names its work, ends when the approved text changes, and
  reaches only sessions the human attached.
- An attached session of approved work is not asked again.
- Hand-computed digests leave the planning text.
- Markdown editing gains no prompt.

Negative:

- The hook, a pinned instruction resource, grows: a second approval kind,
  session state, a typed-command event and a shell comparison. Each release
  with a hook change needs a version bump and a baseline transition.
- A new session that continues approved work needs one typed command.
- After a shell command changes source without approval, the next shell
  command asks, even when it only reads.
- Under owner choice 1 (a) standalone progress is no longer visible as
  ticked boxes in the plan.
- A run without a human stops at the first source write, as today, and now
  also at the first shell command after an unapproved change: the host
  denies a hook's `ask` when nobody can answer.
- Codex sessions keep no enforced gate. The hook guide says today that the
  first edit asks; under Codex that is not so, and the guide must say it.
- ADR-0062 is pinned, so its lifecycle note needs an allow-list image.

Risks:

- The shell can still write the approval record or the session state, and a
  session approval still unlocks every later write of that session. The
  barrier stops accidents, not a determined agent.
- Section 4 does not see a background command, another process or a
  write-capable tool that is neither a file tool nor the shell, such as an
  editing MCP tool.
- Comparing content around every shell command costs time in a large
  repository. A formatter, a generator or a package installation that
  touches non-free paths starts the unapproved-change state.
- Whether the typed-command event fires for a plugin command in every way a
  human can start it, a run without a human included, is read from the
  host's documentation and must be probed.

Required follow-ups: the work plan's packages; manifest sections 5 and 6;
the hook and contract guides; lifecycle notes on ADR-0062, ADR-0064 and,
under owner choice 1 (a), ADR-0038 at acceptance.

## Compliance and Confirmation

1. In a session where the human typed the approval command for a strict
   work directory, a source write inside the repository passes without a
   prompt. In a new session it asks until the human attaches the session.
2. In an attached session with no session approval, changing one byte of a
   bundle file makes the next source write ask, and the reason names the
   file. A revoked record does the same.
3. A work approval never lets a write outside the repository pass.
4. A model call of the approval command creates no record and no
   attachment; the typed command creates both.
5. In manual mode a file-tool write to the record or to the session state
   is denied, before and after a session approval.
6. After a shell command that changes a source file with no approval,
   whether it exits with zero or not, the next shell command and the next
   source write ask and list the path. A file read and a write to a free
   path are not asked.
7. Answering that prompt records a session approval and ends the state; a
   bookkeeping approval does not.
8. In a session with no unapproved change, a shell command gets no hook
   decision.
9. A write to a bundle file, another free path, a memory note or a
   bookkeeping root behaves as ADR-0062 specifies, before and after
   approval.
10. A plan stamped by the helper passes the strict inventory parser with no
    hand-edited digest, and every other plan byte is unchanged. The approval
    command refuses a mismatched remainder and names the stamp.
11. A model call of an entry command is refused; the strict steps are
    reachable from `feature`; every skill file of 2.8.3 still exists.
12. In an adopted repository a session receives the context of section 8 on
    each of the five session sources; elsewhere it receives none.
13. Every runner-mode hook test passes unchanged, and under runner context
    the new events produce no output.
14. A Codex session loads the same hook events as in 2.8.3.
15. The `bypassPermissions` opt-out behaves as in 2.8.3.

## Lifecycle Links

None. On acceptance this ADR would amend ADR-0062 and ADR-0064 as stated
above, and ADR-0038 under owner choice 1 (a), with reciprocal lifecycle
notes.

- Amended by [ADR-0070](./0070-orchestrator-owned-instruction-copy.md), accepted
  2026-11-16: section 7's rule that no skill file is removed, and compliance
  item 11, no longer cover the `orchestrate` skill, which is removed. Baseline
  transitions for the hook configuration and the Codex manifest become
  possible. Implementation is Planned.
