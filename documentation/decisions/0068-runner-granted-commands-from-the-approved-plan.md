# ADR 0068: Runner-Granted Commands From the Approved Plan

## Status / Date / Owner / Decision Makers

- Status: Proposed
- Date: 2026-11-11
- Owner: Banzai maintainers
- Decision makers: Repository owner. Not yet decided.
- Owner choices given on 2026-11-11, before drafting, through two closed
  questions:
  - lite routes: "Strict only (Recommended)";
  - rule width: "Command plus arguments".

  This ADR records them as written. Three further owner choices are open at
  acceptance; see [Owner choices at acceptance](#owner-choices-at-acceptance).

- Review: one independent read-only review on 2026-11-11 before submission.
  Its findings are applied:
  - grants come from plan obligations only, not from project policy;
  - a check that project policy would refuse at launch gets no grant;
  - eligibility is an allow-list over raw argv words, and the launcher rule
    has a structure and a fail direction;
  - the probe covers trust, word boundaries, redirection, more operators, a
    companion rule and a resumed session;
  - ADR-0063 §4 is amended in both ambient choices, ADR-0059 §3 is named,
    and ADR-0024, ADR-0022 and ADR-0064 are addressed;
  - the consequences name what a granted script runner gives a builder.
- Hold: on 2026-11-16 the owner put WP22 on hold with
  `Keep Proposed, on hold`. The proposal is neither accepted nor rejected,
  and its text is unchanged. The decision follows the report of the replay
  comparison study recorded in the program tracker.
- Implementation state: none. No code may rely on this proposal.
- Preparation authority: the owner's `Усі чотири` of 2026-11-11, which added
  WP22 to Stage 2 of the 2.8–2.9 program, and the owner's request of the same
  day to continue with the tracker. Preparing this proposal is not acceptance.

## Related Artifacts

- Program tracker, WP22:
  [tracker.md](../work/release-2-8-2-9-program/tracker.md). WP22 is outside
  the frozen brief; the owner added it on 2026-11-11.
- Code, as of `fa89da9` (2.8.3):
  - `packages/orchestrator/src/adapters.ts`: `buildClaudePhaseArguments`,
    `claudeEnvironmentArguments`, `CLAUDE_NO_PERMISSION_PROMPTS`;
  - `packages/orchestrator/src/mcp.ts`: `serenaAllowedTools`, today the only
    source of an `--allowedTools` value;
  - `packages/orchestrator/src/claude-permissions.ts`: the permission audit,
    `proposedAllowRule` and the denied-call report;
  - `packages/orchestrator/src/workflow.ts`: `planVerificationInventory`
    and the phase runner;
  - `plugins/banzai/lib/task-verification.mjs`: descriptor parsing,
    `selectTaskVerification` and `authorizeTaskVerification`;
  - `packages/orchestrator/src/verification-ui.ts`: `planVerificationLines`,
    the plan gate's check list;
  - `packages/orchestrator/src/prompts.ts`:
    `builderVerificationInstructions`.
- Repository authority: [AGENTS.md](../../AGENTS.md),
  [PROJECT_MANIFEST.md](../../PROJECT_MANIFEST.md) sections 3, 5, 6 and 10,
  and the [decision lifecycle](./README.md#lifecycle).
- Accepted decisions amended here, narrowly (see Lifecycle Links):
  - [ADR-0020](./0020-scoped-claude-subprocess-environment.md). Its Decision
    ends: the spawned agent is guaranteed "the Banzai plugin, the target
    project's own instructions, the declared built-in tool set, and nothing
    else".
  - [ADR-0049](./0049-task-scoped-verification.md) §2, pinned as an
    instruction-transition authority: "Plan approval is not permission to
    exceed the actual execution boundary."
  - [ADR-0063](./0063-stable-headless-vendor-invocations.md) §4: "In ambient
    mode, and when no Serena whitelist resolves, argv is today's argv minus
    the prompt". A scoped builder without a whitelist gains command rules,
    so this changes under either answer to owner choice 1. Its Compliance
    item 7, "Ambient argv still omits ... `--allowedTools`", changes only
    under choice 1 (a).
  - [ADR-0059](./0059-claude-default-reviewer-and-reviewer-isolation.md) §3,
    under choice 1 (a) only: builders "In `ambient` mode ... keep the
    pre-existing invocation".
- Accepted decisions kept unchanged:
  - [ADR-0022](./0022-availability-gated-serena-mcp-whitelist.md): the Serena
    whitelist and its grant. Its no-whitelist promise, as ADR-0063 narrowed
    it, covers discovery arguments; a command rule is not one.
  - [ADR-0024](./0024-operator-authorized-prerequisite-blocked-fix-recovery.md):
    "Do not add broad `Bash` permission, load local settings, or
    auto-approve arbitrary prerequisite commands." The rules here name the
    checks a human approved at the plan gate. They are not broad, and they
    run no prerequisite. A recovery attempt is a fix attempt of the same
    approved run and receives them like any other.
  - [ADR-0038](./0038-explicit-plan-authority.md) and ADR-0049 §4: approved
    obligations stay immutable, and supplements cannot replace them.
  - [ADR-0041](./0041-artifact-retention-and-publication-boundary.md) and
    [ADR-0062](./0062-claude-memory-notes-in-the-manual-hook-gate.md): the
    hook authorizes file writes only and stays unchanged.
  - [ADR-0055](./0055-planning-gate-rework-and-independent-planning-review.md):
    the plan gate's decisions and the control contract.
  - ADR-0059 §2: review roles receive no shell tool.
  - ADR-0049 §3: lite verification authority, and "This decision grants no
    new filesystem/network/credential/publication capabilities" for runner
    verification.
- Related rejection:
  [ADR-0064](./0064-runner-recorded-plan-remainder-digest.md) Option 2
  rejected a planner `--allowedTools` Bash entry. It depended on a prefix
  rule matching an absolute command path and would have needed "live
  evidence on every supported version". This ADR grants the command text a
  builder writes for a project check, and section 7 probes the enforced
  minimum and the current release, as WP8 and WP14 did.

## Context and Decision Drivers

Current facts:

- Every Claude phase runs with `--permission-mode dontAsk` and
  `--permission-prompts none`. A shell command runs only when an allow rule
  names it. The Banzai hook grants file writes and never a shell command.
- In scoped mode (ADR-0020, the default) a phase loads project settings and
  managed settings only. A developer's `.claude/settings.local.json` is not
  loaded, so a Bash allow rule must live in the tracked, shared
  `.claude/settings.json`, and Claude Code honors it only after the checkout
  is trusted.
- A project without such rules gets every builder command denied. Since WP14
  the run lists the denied calls and proposes one exact rule per command, and
  a human pastes them into a settings file. The list changes with every plan.
- On the strict route the human already reads each mandatory check at the
  plan gate (WP3): its command, directory and timeout. Plan approval binds
  the exact plan bytes, and the runner then runs these commands itself at
  verification, in the operator's own process context.
- The builder prompt says "Run focused checks for implementation feedback."
  Without a grant the builder cannot run even the checks the human approved,
  so it learns of a failing check only from runner verification, after the
  phase.
- The runner's model phases are planning, implementation, fix and review.
  Planning, implementation and fix share one argv builder; implementation
  also serves the lite routes.
- A descriptor's `command` is one word without whitespace or a backslash;
  its arguments are free text without ASCII control characters.
  `selectTaskVerification` adds the committed policy's required checks to
  the plan's obligations. Policy denials and limits apply only at launch,
  in `authorizeTaskVerification`.
- Plan approval binds the artifact bundle. It does not bind
  `.banzai/config.json`, which holds project policy.
- The runner already passes one `--allowedTools` value, for the Serena
  whitelist. `--allowedTools` is not repository content.

Claude Code facts, read from the permissions documentation on 2026-11-11.
They are vendor behavior, so section 7 confirms them live:

- `Bash(npm run build)` matches that exact command. `Bash(npm run build *)`
  also matches the bare command and the command followed by any text, and
  the space before `*` is a word boundary.
- Claude Code splits a compound command at `&&`, `||`, `;`, `|`, `|&`, `&`
  and newlines. Each part needs its own allowance, so `Bash(safe-cmd *)` does
  not allow `safe-cmd && other-cmd`.
- A `cd` into the working directory tree is a read-only command, so
  `cd packages/api && <granted command>` runs when the second part is
  granted.
- An allow rule does not match past a leading assignment of a variable
  outside a built-in safe list.
- A deny or ask rule from any settings level wins over every allow rule,
  including `--allowedTools`. Managed settings can make themselves the only
  source of permission rules.
- A redirection target is checked against file rules, not against the Bash
  rule.
- A rule that contains `*` is always a pattern, never an exact command.
- Project allow rules need workspace trust; a command-line rule does not.

Decision drivers:

- a builder can run the checks its own run will be judged by, in a project
  that committed no Claude permission rules;
- a grant comes only from bytes a recorded human approval binds, never from
  model output alone or from a file that can change after the gate;
- existing protections stay: deny and ask rules, managed policy, the hook,
  reviewer isolation, and the rule that the CLI never silently writes
  permission rules;
- a human who approves a plan at the terminal can see what the approval
  grants;
- the eligibility rules fail closed;
- no new gate, control decision or dependency.

Security Assurance classes that apply:

- class 2, an access decision: plan approval becomes the source of a shell
  permission for a model process;
- class 1, untrusted input reaching an interpreter: plan bytes are
  model-authored, and a check's command text becomes part of a permission
  rule and of an argv value;
- classes 3 and 6, secrets and outbound requests: a granted script runner
  executes code the builder wrote, which can read what the phase process
  can read and can reach the network;
- class 7, a destructive effect: a granted program can be given arguments
  that write or delete, and a shell write bypasses the hook.

Sections 1, 2, 5 and 7 carry the controls, and Consequences names what
remains.

## Options Considered

### Option 1: Keep hand-written settings rules

The WP14 list stays the only remedy.

- Benefit: no new authority.
- Cost: every project commits Bash rules to a shared file and trusts the
  checkout before the first useful run; the rules drift from the plan.

Rejected: it leaves the cost WP22 exists to remove.

### Option 2: The runner writes the rules into a settings file

- Benefit: the rules are visible in one familiar place.
- Cost: breaks the manifest's rule that the CLI never silently writes
  permission rules; changes a tracked, shared file as a side effect of a
  run; still needs workspace trust; leaves stale rules behind.

Rejected.

### Option 3: The hook allows approved shell commands

The spec-gate hook would return `allow` for a `Bash` call that matches an
approved check.

- Benefit: one authorization owner for writes and commands.
- Cost: the hook is a pinned instruction resource and is documented as not a
  shell sandbox. It would have to parse compound commands, wrappers and
  redirections itself, which Claude Code's matcher already does. A parsing
  gap in the hook is an authorization bypass.

Rejected.

### Option 4: Exact-match grants

One `Bash(<command>)` rule per approved check, as WP14 proposes for a human.

- Benefit: the builder runs exactly what the gate showed.
- Cost: the builder cannot run one test file or one package through a
  granted command, so focused feedback during implementation stays denied.

Not selected: the owner chose command plus arguments.

### Option 5: Prefix grants, command plus arguments (selected)

One `Bash(<command> *)` rule per approved check.

- Benefit: the builder runs the approved check and focused variants of it.
- Cost: further arguments are not approved one by one. An argument can
  change what the program does: write files, read another configuration, or
  load other code. Section 5 names the boundary honestly.

### Option 6: Grant all of Bash to approved builder phases

- Benefit: no denied command at all.
- Cost: every program on the machine is allowed, not only the approved
  checks. For a check that runs builder-written code the practical gap to
  Option 5 is small; for every other project it is the whole shell. A
  sandbox that would make this safe is WP17, a Stage 3 candidate.

Rejected.

### Option 7: Grants on lite routes

Grant the committed policy's required checks, or the builder's own
candidates, on `feature` and `quick-fix`.

- Benefit: lite work would get the same relief.
- Cost: a lite route has no gate where a human reads commands, and
  ADR-0049 §3 says lite authority "does not claim that the human reviewed
  each proposed command". A builder candidate would authorize itself.

Not selected: the owner chose strict only.

### Option 8: Also grant policy-required checks on the strict route

The plan gate lists them beside the plan's obligations.

- Benefit: the grant set equals the gate's list.
- Cost: approval does not bind `.banzai/config.json`. A policy that changes
  after the gate, through a pull or a command the builder ran, would add a
  rule no human saw at a gate. Binding it would need a policy digest in run
  state.

Rejected for this decision. An owner who wants a policy check granted names
it in a plan obligation or in a settings rule.

### Option 9: Load local settings in scoped mode

- Benefit: each developer's own rules would apply.
- Cost: reverses ADR-0020's isolation, makes runs differ by machine, loads
  local hooks and environment into phases, and still needs hand-written
  rules.

Rejected.

## Decision

### 1. The grant set

On a strict run with task verification, derive the grant set from the
mandatory obligations of the approved plan, read from the plan bytes that the
current plan approval binds. The derivation validates that approval itself.

Grant nothing from any other source. Project-policy checks, supplemental
candidates, lite checks, discovery results, model output and other project
files never add a grant.

A plan obligation that launch authorization would refuse under committed
project policy, because policy denies it or it exceeds a policy limit, gets
no grant.

Derive the set again for each attempt. An approval that is void, replaced,
not yet given, or no longer matches the plan bytes grants nothing.

### 2. The rule

For each eligible obligation, build one rule, `Bash(<command text> *)`. The
command text is the obligation's raw executable and arguments joined by
single spaces. The rule allows the command alone and the command followed by
further arguments.

An obligation is eligible only when all of these hold:

- its first word is an executable name or path, not an assignment;
- every word is non-empty and consists only of characters from a closed
  printable-ASCII set that needs no shell quoting and has no meaning in
  Claude Code's rule or rule-list syntax. The set excludes at least
  whitespace, quotes, the comma, parentheses, `*`, `$`, the backtick, the
  backslash and every shell operator and redirection character;
- the joined text stays within a bounded length;
- when the first word is a shell, an interpreter or a command launcher, a
  fixed program, script or target word remains after that launcher's own
  subcommands and options. A launcher option the rule set does not know
  makes the obligation ineligible;
- the first word is not a launcher that hands its arguments to another
  shell, such as a remote shell client.

The last two rules exist because, without a fixed word, the further
arguments and not the approved text would choose the program. They do not
claim that an eligible command cannot be redirected by its arguments;
section 5 states that.

An ineligible obligation gets no grant and no wider, quoted or rewritten
rule. The requirements own the character set, the launcher list and the
bound. They may narrow the set and never widen it past this section.

The rule does not bind the working directory, the environment or the
timeout of the check. Those stay properties of runner verification.

### 3. Delivery

Pass the rules to Claude with `--allowedTools`, in the invocation of every
strict implementation and fix attempt that runs under a current plan
approval, including repair, retry and recovery attempts. Keep the Serena
grant beside them, in a form in which the client can neither split nor merge
rule texts.

Pass no command rule to workflow selection, planning, planning rework,
planning review, planning-review analysis, code review, or a lite
implementation or fix. Codex invocations do not change.

Apply the grant in scoped and in ambient mode. The grant is an authorization
from the approved plan, not a discovery argument (owner choice 1).

Write no permission rule to any file. The grant exists only in the argv of
the attempts it covers.

A builder session that began in planning continues into implementation with
the rules added, and a resumed attempt receives the same rules as a fresh
one. The grant is no reason to rotate a session.

### 4. Precedence

The grant is an allow rule and nothing stronger. A deny or ask rule in any
settings file the session loads, and any managed policy, still refuses a
granted command. Banzai does not detect or work around such a refusal: the
call is denied and appears in the WP14 denied-call list as refused by a
rule.

The hook, the tool sets of every role and the two permission flags stay as
they are.

### 5. What plan approval now means

Plan approval, in addition to its existing effects, lets the Claude
implementation and fix attempts of the same run execute each granted
command, in any project directory and with further arguments, without a
prompt. This is the one new consequence of approval.

State the boundary truthfully in the product text:

- the grant is a convenience boundary, not a sandbox. A granted program
  accepts arguments that the gate did not show;
- a granted check that runs project code runs code the builder wrote, during
  the phase and with the phase's own process rights;
- the runner runs the same check itself after the phase. The grant adds the
  moment and the arguments, not a new principal.

When the run's effective implementer runs on Claude, the plan gate's check
list must say, before the decision, that Claude phases may run each granted
command with further arguments, and must mark each obligation that gets no
grant. With another implementer the gate says nothing about grants.

A human who does not want a command granted refuses the plan, edits the
check, or adds a deny rule. In scoped mode that deny rule belongs in the
tracked `.claude/settings.json` or in managed settings, because user and
local settings are not loaded. Owner choice 3 decides whether project
configuration also gets a switch.

The plan gate's decisions and the control contract do not change. Status
JSON, agent control and the reporting contracts carry no grant content. A
supervisor that approves through `banzai control` therefore sees neither the
check commands nor the grant, as it sees no check commands today. This
decision accepts that as a known exception to the disclosure rule above.

### 6. What the phase and the record say

Tell each covered attempt, in its prompt, the exact granted command texts,
that they are for focused runs while the runner still owns the final run,
and that any other command may be denied. Where that text is a pinned
instruction resource, this ADR is its transition authority under ADR-0044.

Record the rules granted to an attempt as bounded run evidence, and show
them in human status. The denied-call list proposes no rule for a command
the run already grants.

The permission audit and its doctor message describe the grant: Bash without
a settings rule stays an advisory for planning and for lite routes, and no
longer says that every command of a strict builder phase is denied.

### 7. Evidence

Deterministic tests own the grant set, the rule text, eligibility, the argv
of every invocation kind and the gate text.

The matcher is vendor behavior. Confirm it with an owner-authorized live
probe on Claude Code 2.1.290 and on the current release (owner choice 2).
The scratch repository has no Bash allow rule and is not trusted in Claude
Code. On each client version the probe makes three invocations of one
session: a first one without command rules, a resumed one with them, and a
resumed one without them again. It passes when all of these hold:

1. in the first invocation the command is denied;
2. in the second, a granted command of two or more words runs alone and
   with one further argument;
3. a granted command runs after `cd` into a subdirectory;
4. a command that is not granted is denied and listed;
5. a command that continues a granted text inside the same word, such as
   `npm run test:e2e` for the granted `npm run test`, is denied;
6. a granted command joined to an ungranted one with `&&`, `;`, `|` or a
   newline is denied, and so is a granted command that carries an ungranted
   command substitution, in `$()` or backticks, as an argument;
7. a granted command with an output redirection into the working tree is
   denied;
8. a granted command behind a leading assignment of a variable outside
   Claude Code's safe list is denied;
9. a granted command that a project deny rule names is denied, and so is
   one that a project ask rule names;
10. a second rule of another tool, passed beside the command rules in the
    form the runner uses for the Serena grant, still takes effect;
11. a file write that the Banzai hook allows succeeds;
12. in the third invocation the command is denied again;
13. each stream has exactly one `result` event and exit status 0.

Item 11 closes the evidence that the WP14 probe left open.

## Owner choices at acceptance

1. **Ambient mode.** (a) Recommended: grant in scoped and ambient mode. An
   ambient user has the same `dontAsk` denials, and the grant discovers
   nothing. This also amends ADR-0063 Compliance item 7 and ADR-0059 §3.
   (b) Scoped mode only: ambient runs keep the WP14 list as their only
   remedy. ADR-0063 §4 is amended either way.
2. **Live evidence.** (a) Recommended: a Gate 2 maintainer probe with three
   short invocations per client version, outside `compatibility:live`, in
   the manner of WP14 Q2 (a). The suite keeps its v2 summary and its
   two-invocation budget. (b) A new scenario in `compatibility:live`, which
   changes the suite's budget and summary under ADR-0011 and ADR-0046.
3. **Project switch.** (a) Recommended: an optional key in
   `.banzai/config.json` that turns the grant off for the project; the grant
   is on without it. This follows ADR-0020's driver of an explicit operator
   override, and it works in scoped mode without a tracked Claude settings
   edit. (b) No switch: refusing the plan and a deny rule are the only
   controls. (c) Off unless the project turns it on.

Sections 3, 5 and 7 are written for (a) in choices 1 and 2. Choice 3 adds
one sentence to section 5 and one compliance item.

## Consequences

Positive:

- a strict run in a project with no Claude permission rules lets its builder
  run the approved checks and focused variants of them;
- the grant follows the approved plan: a new plan brings new rules, and
  nothing stale stays in a settings file;
- no workspace trust step and no shared-file edit is needed for these
  commands;
- the human sees at the terminal gate what approval grants.

Negative and risks:

- plan approval carries more authority than before. A human who approves
  without reading the check list grants commands unread;
- a project that had no Bash rule gave its builder no shell at all. With a
  granted script runner, such as `npm run <script>`, `make <target>` or a
  project script, the builder can run code it wrote during the phase. That
  code can reach the network, which the phase's tool set otherwise
  withholds, can read what the phase process can read, and can write to the
  approved bundle and `.banzai/` without the hook seeing it. ADR-0049 §2
  even lets a plan approve a check whose tooling the builder creates;
- further arguments are unapproved. A flag can make a checker rewrite files
  or load other configuration;
- an agent that supervises the gate through `banzai control` sees no grant
  content;
- Claude Code's matching rules can change between releases. The probe covers
  the minimum and the current release only, and a change can widen a rule as
  well as disable it;
- lite routes, planning, policy-required checks and Codex builders gain
  nothing;
- an obligation whose words need quoting or shell syntax gets no grant, so
  such checks keep the WP14 list;
- a managed policy that owns all permission rules makes the grant inert.

Required follow-ups:

- WP22 requirements and plan under this ADR, including the character set,
  the launcher list, the bound and the probe;
- on acceptance, the reciprocal lifecycle links on ADR-0020, ADR-0049,
  ADR-0063 and, under choice 1 (a), ADR-0059. ADR-0049 is pinned: its link
  needs an exact before and after image in `phase-resources-build.mjs`,
  keyed by this ADR and chained after the ADR-0054 image, and this ADR joins
  `FIXTURE_PATHS` in `release-validation.test.ts`. WP9 will amend ADR-0049
  too, so its image chains after this one;
- `PROJECT_MANIFEST.md`, `documentation/orchestrator.md` and
  `documentation/getting-started.md` when the behavior ships;
- the Gate 2 item for WP22 in the program tracker.

## Compliance and Confirmation

1. **Grant set.** For a fixture plan, the rules passed to a strict
   implementation attempt equal the plan obligations that the gate marks as
   granted, each as its raw words joined by single spaces with the trailing
   ` *`.
2. **No other source.** A policy-required check, a supplemental candidate, a
   lite run and a discovered script produce no rule. A plan obligation that
   policy denies or that exceeds a policy limit produces none.
3. **Eligibility.** An obligation with a word outside the closed character
   set, an empty word, a leading assignment, an over-long text, a launcher
   without a fixed word, an unknown launcher option or a remote shell
   launcher produces no rule, and the gate marks it as not granted.
4. **Rule integrity.** No rule text holds a quote, a comma, a parenthesis or
   `*` other than the wrapper and the trailing wildcard, and one obligation
   yields at most one rule.
5. **Invocation kinds.** Selection, planning, planning rework, planning
   review, analysis, code review and lite builder argv carry no command
   rule. Codex argv is unchanged.
6. **Approval lifetime.** Grant derivation validates the approval digest
   against the current plan bytes. A recovery attempt over changed plan
   bytes carries no rule.
7. **Modes.** Under choice 1 (a), scoped and ambient builder argv carry the
   same command rules, and ambient argv still omits the discovery arguments
   and the Serena grant.
8. **Serena.** With a whitelist, the Serena grant and the command rules are
   both present; without one, only the command rules.
9. **No file writes.** A run with grants changes no settings file.
10. **Gate text.** With a Claude implementer, human status at the plan gate
    states the grant and marks ungranted obligations; with another
    implementer it does not mention grants. The control contract version,
    status JSON and the reporting contracts are unchanged.
11. **Phase text and record.** A covered attempt's prompt lists the granted
    command texts; the attempt's run evidence holds the same rules, bounded;
    the denied-call list proposes no rule the run already grants.
12. **Live probe.** The owner's probe meets section 7 on Claude Code 2.1.290
    and on the current release.
13. **Verify.** `npm run verify` passes.

## Lifecycle Links

- Amends [ADR-0020](./0020-scoped-claude-subprocess-environment.md): the
  invocation contract of its Decision gains one item. A strict Claude
  implementation or fix attempt under a current plan approval also receives
  the command rules of sections 1–3.
- Amends [ADR-0049](./0049-task-scoped-verification.md) §2: plan approval
  additionally lets the run's Claude implementation and fix attempts execute
  the approved plan obligations' commands with further arguments
  (section 5). The runner's own execution boundary, §3 and §4 are unchanged.
- Amends [ADR-0063](./0063-stable-headless-vendor-invocations.md) §4: a
  builder argv without a Serena whitelist may carry command rules. Under
  owner choice 1 (a) it also amends Compliance item 7: the `--allowedTools`
  value that ambient argv omits is the Serena grant.
- Under owner choice 1 (a), amends
  [ADR-0059](./0059-claude-default-reviewer-and-reviewer-isolation.md) §3:
  ambient builders also receive the command rules.
- Supersedes: None
- Superseded by: None
