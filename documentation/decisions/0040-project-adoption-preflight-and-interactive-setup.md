# ADR 0040: Project Adoption Preflight and Interactive Setup

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-09-10
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-09-10
  (English translation: `Accept ADR-0040`).
- Preparation authorization: the user requested an ADR and plan for the
  preceding adoption/setup UX proposal. That request does not accept this ADR
  or authorize implementation.
- Rework 1: revised on 2026-09-10 at the user's request after the independent
  [review](../features/project-adoption-setup/review-1.md); see the
  [rework record](../changes/project-adoption-setup-review-1.md). Status at that rework:
  Proposed; this is not a recorded ADR acceptance or runtime triage decision.
- Rework 2: revised on 2026-09-10 at the user's request after the independent
  [review 2](../features/project-adoption-setup/review-2.md), whose finding
  R2-F1 the user accepted in chat; see the
  [rework record](../changes/project-adoption-setup-review-2.md). Status at that rework:
  Proposed.
- Rework 3: revised on 2026-09-10 at the user's request after the reviewer's
  critique of the mid-run manifest recheck and of placeholder version skew
  between the CLI and the packaged template; see the
  [rework record](../changes/project-adoption-setup-rework-3.md). Status at that
  rework: Proposed.
- Rework 4: revised on 2026-09-10 at the user's request after the same-session
  [review 3](../features/project-adoption-setup/review-3.md), whose findings
  R3-F1, R3-F2 and R3-F3 the user accepted in chat; see the
  [rework record](../changes/project-adoption-setup-review-3.md). Status at that
  rework: Proposed.

## Related Artifacts

- [Feature description](../features/project-adoption-setup/description.md)
- [Development plan](../development-plans/project-adoption-setup/plan.md)
- [Repository authority](../../AGENTS.md) and
  [manifest](../../PROJECT_MANIFEST.md), sections 3, 5, 6 and 10
- [ADR-0036](./0036-vendor-neutral-policy-files-and-instruction-delivery.md):
  supported instruction layouts, installed policy delivery and explicit migration
- [ADR-0008](./0008-read-only-doctor-diagnostics.md): diagnostic contract and
  read-only/privacy constraints
- [ADR-0018](./0018-agent-supervised-banzai-cli-control.md): machine control
- [ADR-0020](./0020-scoped-claude-subprocess-environment.md) and
  [ADR-0022](./0022-availability-gated-serena-mcp-whitelist.md): vendor scoping
- [ADR-0029](./0029-eslint-backed-orchestrator-import-boundary-policy.md):
  mechanically enforced dependency direction
- [ADR-0023](./0023-durable-terminal-attempt-checkpoints.md) and
  [ADR-0024](./0024-operator-authorized-prerequisite-blocked-fix-recovery.md):
  attempt reconciliation and exact recovery authority
- [ADR-0038](./0038-explicit-plan-authority.md): approved plan authority
- Current implementation: `packages/orchestrator/src/cli.ts`, `workflow.ts`,
  `doctor.ts`, `process.ts`, `adapters.ts`, `store.ts` and `import-boundaries.mjs`
- Product source: `plugins/banzai/skills/project-manifest/SKILL.md`, its
  `references/layout-migration.md`, and `agents/openai.yaml`
- Existing local fixes: [Git prerequisites](../changes/git-startup-prerequisites.md)
  and [first-init model wording](../changes/model-picker-initial-defaults.md)

## Context and Decision Drivers

Current `init` initializes configuration and offers model selection; it does
not establish adoption. Interactive startup checks committed HEAD before setup
or task input. Workflow startup creates run state before vendor preflight.
Missing guidance can therefore surface only after the user has entered a task
and a model has begun affected work.

ADR-0036 states: "Layout recognition is a skill precondition, not a new runtime
loader or machine gate." Its legacy/partial stops and explicit migration remain
essential safeguards, but do not provide the requested early CLI experience.
Doctor currently emits `banzai-doctor/v1` without an adoption check. Adding a
failure that changes `ready` must use a new diagnostic version under ADR-0008.

The headless process helper uses ignored stdin and captured stdout/stderr.
Project-manifest requires human bootstrap choices and merge approval. A normal
planning phase cannot substitute for an interactive session: the skill is
explicit-only on both hosts and setup must precede run creation and approval.

Decision question: how should the CLI enforce project guidance readiness and
offer explicit project-manifest setup while preserving human authority, client
interaction and existing workflow contracts?

Drivers:

1. Stop missing/unsupported guidance before paid workflow work and explain the
   exact next action.
2. Make fresh Git repositories usable for setup without first creating an
   application or a meaningless workflow run.
3. Share deterministic structural evidence across entry points; never claim
   that structural recognition proves semantic correctness or approval.
4. Preserve explicit skill invocation, user-owned files, subscription-only
   authentication, vendor scoping and terminal lifecycle ownership.
5. Retain offline diagnostics, machine output compatibility and access to
   existing run evidence when adoption is incomplete.
6. Bound this feature to adoption; retain existing dependencies and workflow
   state/result/approval formats.

## Options Considered

| Option                                                                               | Benefits                                                                        | Costs and risks                                                                                                                     | Outcome                                                    |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Keep skill-only checks and print a setup hint after init                             | Smallest change; preserves every runtime contract                               | Missing guidance still consumes workflow work; inconsistent entry points; no mandatory preflight                                    | Rejected: does not satisfy the requested early enforcement |
| Add mandatory checks and manual instructions only                                    | Deterministic, simple lifecycle; no interactive subprocess                      | User must leave Banzai and reconstruct setup context; init has no direct continuation                                               | Retain as fallback, not the primary UX                     |
| Add mandatory checks and an explicit foreground project-manifest session             | Direct onboarding; real human questions and merge approval; reusable inspection | New process/terminal boundary, mutual exclusion and vendor compatibility evidence                                                   | Selected                                                   |
| Run project-manifest headlessly as a workflow phase, or generate guidance in the CLI | Apparently automatic onboarding                                                 | Misrepresents explicit-only invocation, lacks normal interactive decisions, mixes setup with run grants, duplicates skill ownership | Rejected                                                   |

## Decision

Adopt the explicit foreground option with the following constraints. All are
proposed target intent until this ADR is accepted.

### D1. Shared structural inspection, with bounded claims

Introduce a read-only adoption inspector used by CLI setup, doctor and workflow
preflight. It reads only fixed root guidance paths and bounded metadata needed
for the plugin-source exception. It invokes no client, creates no state, loads
no policy body as executable authority, and expands no includes.

Keep internal classifications `ready`, `setup_required`, `migration_required`,
and `needs_attention`, rendered using FR1's exact English labels. Report all
observed gaps, with unreadable/unsafe/partial evidence taking precedence over
legacy, then missing/unadopted evidence. A ready result requires both the
manifest and the supported instruction layout.

Follow the shipped target/legacy/unadopted/partial layout predicates in
`project-manifest/references/layout-migration.md`; preserve the legacy
diagnostic and the optional CLAUDE shim. Replace its source-repository exception
and the skill's scaffold exception with the single predicate below. Pin shared
recognition examples so skill instructions and runtime classification cannot
drift silently. The CLI does not audit arbitrary rule prose or certify policy
delivery on a host.

The manifest requires its ten named second-level sections in order, allowing
the existing numeric prefixes. Ignore comments and fenced examples when
recognizing headings and require visible content in each section. The runtime
carries no template placeholder vocabulary: it rejects neither angle-bracket
expressions nor `Open`, `None`, `Recommended (not yet present)` or any other
wording, because the CLI and the plugin install independently and such a list
would drift from the packaged template in either direction.

Detect an unfilled scaffold through one stable marker instead. The packaged
template carries the complete line `<!-- banzai-scaffold: unfilled -->` beside
its existing banner comment, which already asks the author to delete the banner
once the sections are filled, and the explicit skill removes the marker line
only when it applies the approved bootstrap population. A manifest containing
that complete line before its first ATX heading, matched on raw bytes within
D8's bounds, is `setup_required` regardless of its other content, with the
fixed reason `scaffold marker present` naming the line to delete. The marker
is not matched after the first heading, so a populated manifest that documents
the marker cannot be misclassified. A scaffold from a plugin release that
predates the marker passes the structural check on heading set and visible
content alone; its unfilled placeholders remain skill-owned evidence, as every
stale fact already is. No skew direction produces a false refusal: a
marker-free populated manifest always passes on structure. Skills still own
stale-fact detection and unresolved load-bearing choices.

Use one source identity predicate with two supported topologies, evaluated at
the discovered Git root:

- **Plugin root:** at least one of `.claude-plugin/plugin.json` and
  `.codex-plugin/plugin.json` exists; every present one is a readable JSON
  object with `name` equal to `banzai`. This retains the standalone plugin-root
  topology supported by the old skill text; conflicting metadata is not exempt.
- **Source workspace:** root `package.json` has
  `name: "banzai-spec-driven-dev"`, `private: true`, and an array `workspaces`
  containing `packages/*`; `.claude-plugin/marketplace.json` has exactly one
  plugin entry named `banzai`, with `source: "./plugins/banzai"`; both
  `plugins/banzai/.claude-plugin/plugin.json` and
  `plugins/banzai/.codex-plugin/plugin.json` are readable JSON objects named
  `banzai`.

Read only these fixed metadata paths under D8's bounds. Either complete
topology proves the exception; missing/nonmatching metadata does not, and
unsafe/unreadable or conflicting identity evidence requires attention. A
directory name, remote URL, installed external cache, or marketplace name alone
never grants the exception. This is structural compatibility, not an
authentication boundary against a malicious local repository.

Apply this same predicate to the skill's scaffold-skip and recognition-skip
conditions, its migration reference, and the runtime inspector. The plan
assigns ownership of the runtime/fixture definition and of product-source
alignment to its tasks. Exempt only the source repository's instruction
layout/scaffolding: runtime readiness still requires a populated root manifest
and readable root AGENTS. Nested packaged templates do not become root project
guidance.

### D2. Gate workflow work without creating another approval gate

Reject an insufficiently adapted new run as `PROJECT_SETUP_REQUIRED`, exit 1,
before creating a run/attempt or invoking vendor/authentication commands.
Perform an initial read before acquiring a mutating runner lock and recheck
under the existing exclusive boundary before publishing a run. A failed
recheck may release its own temporary lock, but publishes no run or attempt.

Use the same readiness requirement at model-bearing continuation entry points
and at the last pre-attempt boundary for each new physical invocation. A
readiness refusal is a non-mutating `BanzaiError` with code
`PROJECT_SETUP_REQUIRED`, not a model failure or a persisted blocked result.
No new `blockReason`, `blockedFrom`, attempt, `failureCode`, `failureCause`,
process reference, terminal checkpoint, invocation ledger, usage, failed-attempt
counter or event is written for that refusal. Existing values remain unchanged;
in particular, do not assign `process_start` or `unclassified` to a process
that was never attempted.

Scope the two checks differently. A new run, both at the initial read and at
the under-lock recheck before publication, requires the complete D1 result:
manifest structure, scaffold marker and instruction layout. Every continuation
entry point and pre-attempt recheck of an already published run evaluates the
D1 instruction-layout classification only: root `AGENTS.md` and `CLAUDE.md`
under their D8 readability bounds, together with the D1 source identity
exception and its fixed metadata reads, so the Banzai source workspace itself
is never refused on continuation. It skips only manifest structure and marker
validation. Workflow phases legitimately rewrite `PROJECT_MANIFEST.md` during a
run; a structural slip there is evidence for a strict run's independent review
or, on any route, a start-time refusal for the next run, not a mid-run stop.

Place the final check before allocating/publishing the next attempt and before
consuming its retry/recovery transition. Do not put it inside
`invokeWithContext` after `beginAttempt`, where an error would create false
interruption evidence. Preserve already durable decisions, completed attempts
and next-phase checkpoints; do not roll back prior successful work. If an
active attempt needs reconciliation, retain ADR-0023/0024 handling and check
readiness only before the resulting new invocation. Missing guidance never
relabels a prior failed/interrupted/completed attempt.

The persisted and continuation contract is:

| Refusal point                                                                                                   | Persisted effect, including blockedFrom/failureCause                                                                                                                                       | Next action after guidance is repaired                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New start before run publication, including under-lock recheck                                                  | No run, attempt or event; no blockedFrom or failureCause exists for this request                                                                                                           | Submit the start request again                                                                                                                                                 |
| Start has already published a run, but its first selection has not begun                                        | Keep the existing created/selecting checkpoint and all existing fields exactly; no attempt or failure is added                                                                             | Explicit resume follows the existing checkpoint                                                                                                                                |
| Resume at selecting/planning/plan_approved/implementing/verifying/reviewing/fixing with no unreconciled attempt | Preserve that checkpoint; blockedFrom/blockReason and all prior evidence remain byte-identical                                                                                             | Explicit resume; an otherwise required gate/validation still applies                                                                                                           |
| Automatic continuation after a durable ADR/plan decision or human answer                                        | Keep the already-saved decision and the resulting planning/selecting/plan_approved checkpoint; no second decision or invocation record                                                     | Status reveals the saved decision; resume continues without submitting it twice                                                                                                |
| Triage-to-fix or a completed phase's next invocation                                                            | Keep saved triage or reconciled completion and the next planning/implementing/verifying/reviewing/fixing checkpoint; no failed-attempt attribution                                         | Resume continues the existing accepted scope; zero-finding completion needs no model check                                                                                     |
| Retry, including a repaired-completion retry                                                                    | Refuse before clearing the prior attempt, changing blockedFrom or recording attempt.retry_requested; preserve the original blocked state, failureCause and retry evidence                  | Retry remains governed by its original eligibility; invoke retry again after repair                                                                                            |
| Recover or control recover                                                                                      | Refuse before authorizing/consuming a new recovery or publishing its linked attempt; preserve the original source, blockedFrom, failureCause and any already durable pending authorization | Reinspect the existing recovery identity; recover only with required current authority, or resume an already-authorized pending recovery if its exact identity still validates |

Perform the final refusal before the associated transition and record writes;
the table is not permission to create an attempt and then erase it. Any
already-durable decision or recovery authorization predating the refusal stays
durable. Revalidate the exact workspace/base/approval/scope before future work;
guidance repair may invalidate recovery or approval and requires the existing
human route. Command-entry refusal is byte-identical to entry; a mid-chain
refusal is byte-identical to the latest successfully persisted checkpoint, not
to the beginning of the whole command. Hold/release only the normal owned lock.

A mid-run refusal names the instruction file at fault and its classification,
then exactly two routes: repair or migrate the instruction files outside CLI
setup, through a direct edit or the manual explicit-skill instructions in the
user's own client, and then `resume`; or cancel the run and use CLI setup. The
diagnostic offers no `banzai setup` for an unfinished run and does not describe
the refusal as a failed attempt.

Read-only status exposes the existing checkpoint/nextAction, not an invented
blocked run. Retry is not newly enabled by this error; recover gains no new
eligible source class. Evaluation and cancellation exports continue to classify
the persisted state and actual earlier attempts only: no new failed attempt,
usage or technical failure row is attributed to setup, and no cancellation
reason is inferred. A refusal has no durable report entry of its own. Its
bounded CLI diagnostic and fresh doctor check own that information; a durable
refusal history would require a separate contract decision.

Status, capability discovery, cancellation, restoration, doctor, and evidence
exports remain reachable. A required initial commit stays a task prerequisite;
move the current early interactive HEAD check behind the setup opportunity,
but before task collection or execution. Git discovery still precedes setup.
Unrelated vendor, verification and approval checks keep their authority.

This is a prerequisite, not a sixth workflow decision gate. Do not add an
adoption bypass, accepted-adoption flag, cached readiness certificate, or
adoption assertion to phase-result, review-result or run-state schemas.

### D3. Reusable terminal UX and explicit authority

Offer setup after interactive init's model picker and before bare/interactive
new-task collection. Add `banzai setup` as an interactive-only resumable entry;
require existing valid configuration and do not rerun the picker. Already-ready
setup reports readiness and exits without a client. A task entry with an
existing run presents the existing run actions, retaining status/cancel access.

Provide four actions: launch the named project-manifest skill with Codex,
launch it with Claude Code, show manual instructions, and exit. The feature
description's **UX Copy** section owns exact labels, screen examples and
messages; this ADR binds their behavior and explicit authorization semantics,
not punctuation, line layout or reversible wording.

Recommend the configured Planning vendor when its launch is available; keep
unavailable actions visible with reasons and recommend the available alternative
when appropriate. Recommendation chooses a client, not a new phase model.
Setup uses that client's normal interactive model settings and does not rewrite
the three configured phase models.

Selecting the named action authorizes that invocation. Do not add a second
generic confirmation and do not start it merely because a choice is highlighted.
Manual instructions give the repository context, installed-plugin prerequisite,
and exact explicit skill syntax: `$banzai:project-manifest` for Codex or
`/banzai:project-manifest` for Claude Code. Do not install anything automatically.

Non-TTY init keeps configuration-only exit 0 and a setup next-step message.
Non-TTY setup returns `TTY_REQUIRED`, exit 1, without a child. Bare non-TTY
Banzai keeps help behavior. Other command errors keep their existing stream
rules; control commands do not gain interactive setup or a new status envelope.

### D4. A fresh foreground session outside workflow execution

Launch a fresh interactive client in the discovered checkout with the literal
explicit skill invocation as initial input. Pass executable and argv directly,
without a shell and without embedding project-file contents in launch text.
Do not use headless adapters, a structured phase schema, an existing builder
session, workflow usage accounting, or a durable run transcript.

Before transfer, identify the selected client and explain that the user must
exit it to return to Banzai; the description owns the exact message.
Suspend parent prompts/progress and restore
the terminal from prompt-owned raw/paste/cursor modes before transferring
stdin/stdout/stderr. After the child closes, restore parent terminal/signal
ownership before rendering again. User time answering questions is not a
headless-phase timeout. Bound startup/shutdown and clean up owned resources
on spawn failure, child failure, interrupt and termination.

After normal child exit, reread files. Exit 0 is neither a setup certificate nor
a request to start a task. Failed or interrupted setup preserves partial edits,
reports them and requires a fresh explicit action for retry. Normal `Exit`
returns 0 with an incomplete-setup notice; SIGINT/SIGTERM retain conventional
130/143 exits. A parent interruption never triggers an automatic relaunch.

Verify supported client/plugin availability through bounded local documented
discovery or a validated configured plugin source. The npm CLI must not assume
a sibling plugin checkout or parse undocumented cache internals. Unverifiable
explicit invocation disables automatic launch and retains manual instructions.
Never substitute a generic prompt that merely asks a model to imitate the skill.

### D5. Preserve vendor and user authority at the new boundary

Use existing subscription-only environment filtering and selected-client auth
preflight without a paid probe. Remove inherited `BANZAI_RUN_ID`,
`BANZAI_APPROVAL_DIGEST`, `BANZAI_WORKFLOW_DIGEST` and
`BANZAI_REVIEW_ARTIFACT`. Refuse an orchestrated/nested setup launch where the
parent context already identifies a Banzai run; do not erase vendor nesting
markers to evade client restrictions.

Carry ADR-0020/0022's applicable configured scoping into this new invocation:
verified Banzai plugin plus project settings, strict Claude MCP scoping,
existing explicit ambient opt-in or safe degradation, and only the resolved
Serena whitelist where available. If degradation cannot establish skill
availability, disable launch and show manual guidance. Do not invent an MCP
registration or broaden MCP write grants. Preserve hooks and ordinary
interactive permission prompts; do not use unattended permission modes or
dangerous approval-bypass options as an onboarding shortcut.

The launcher itself writes no guidance, app code, dependency or verification
profile. The existing explicit skill owns scaffolding and approved merges.
Launching it does not approve a merge, bootstrap architecture, new dependency,
application skeleton, Git commit, workflow ADR or plan. Banzai retains no child
transcript; normal client-owned session storage remains the client's behavior.

### D6. Exclusive setup lifecycle and unfinished runs

Serialize setup with workflow execution using the existing checkout-exclusive
runner lock identity and ownership rules; do not create a disconnected lock
that workflow commands ignore. Recheck active pointer/state under that boundary
before launching. Setup must refuse any unfinished run, including paused and
blocked states; only absent, valid `done`, or valid `cancelled` state is eligible.
Corrupt/unknown evidence also refuses launch with an existing diagnostic route.

Setup never cancels a run, clears a pointer, reclaims stale/corrupt ownership, or
edits historical approval/evidence as a convenience. Explain that the user must
finish or explicitly cancel an unfinished run before CLI setup. Existing manual
migration and existing approval/digest recovery rules remain available; CLI
setup does not promise automatic continuation of an old run after migration.
A continuation refused on instruction layout follows D2's manual repair route
or an explicit cancel; setup opens no side door for an unfinished run.

Hold only owned exclusive process resources during the interactive child and
release them on every parent exit path. Child environment conveys no runner
grant merely because setup holds a coordination lock.

### D7. Doctor v2 with the existing read-only boundary

Emit `banzai-doctor/v2`, `schemaVersion: 2`, for new doctor reports. Preserve
the existing top-level field order and field set otherwise. Insert exactly one
`project.guidance` check in category `repository` immediately after
`repository.git`, before `runtime.node`; pass for ready and fail for each
insufficient classification. Derive `ready` and summary counts as before.
Use fixed classification/reason vocabulary and root filenames in its message,
never raw Markdown, arbitrary headings, absolute paths or filesystem errors.

Keep syntax `doctor [--json]`, deterministic JSON/text projection, 0/1 exit
semantics, no short-circuiting of independent expected findings, and no mutation,
authentication, configured-command or model path. No v1 report gains the new
meaning silently. Document the intentional default schema transition for
consumers and update shipped examples/validators/smokes; preserve historical v1
artifacts. No legacy-output flag or unrelated contract version bump is added.

### D8. Filesystem interpretation is bounded data processing

Read fixed root files with explicit size/type bounds; a link may resolve only
to a regular file within the same discovered repository. Reject escaping or
dangling links, special files, oversize/unreadable files and detected unstable
read identities as `needs_attention`. Do not expand Markdown references,
execute includes, or print file content. This check reduces predictable startup
failure; it is not a sandbox against a malicious repository or proof against
arbitrary concurrent external editing.

## Consequences

Positive: first-use setup becomes discoverable; all workflow entry points share
the same prerequisite; user choices stay in the actual skill interaction;
unborn repositories can prepare guidance; doctor keeps one authoritative
read-only projection.

Costs: custom/legacy projects may now stop earlier; schema-v1 doctor consumers
must recognize v2; foreground clients add terminal and cancellation complexity;
setup cannot edit guidance while an unfinished run owns the checkout; the
packaged template and the explicit skill gain one scaffold-marker contract.

Risks: structurally plausible prose can still be stale, and an unfilled
scaffold from a template without the marker passes the structural check;
installed-client skill invocation differs by host/version; terminal behavior
requires real PTY evidence; external editors remain outside the runner lock; a
manifest broken by a run's own phase surfaces only at review or at the next
start. Mitigate through bounded claims, preserved skill checks, shared
fixtures, negative process/environment tests, and explicitly recorded
supported-client smoke evidence.

Required follow-up: accept/rework/reject this ADR, then recheck and approve the
exact description/ADR/plan bundle before implementation. Keep this manifest
current-state only until verified behavior changes. Add no dependency, release
version, install or publication as part of this decision.

## Compliance and Confirmation

| ID  | Observable confirmation                                                                                                                                                                                                                                               | Decision clauses |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| C1  | One fixture matrix produces the same structural classification for setup, doctor and workflow; includes fresh/target/legacy/partial, source-repo exception, marker-bearing and marker-free scaffolds, and explained bootstrap gaps.                                   | D1, D8           |
| C2  | Built CLI and workflow-boundary evidence show no new run/attempt/vendor call on a failed initial check; continuations stop new model work and retain evidence/diagnostic/cancel access.                                                                               | D2               |
| C3  | PTY evidence covers init, direct setup, task entry, explicit selection, manual exit, child close/failure, terminal restoration and interruption; non-TTY calls cannot launch clients.                                                                                 | D3, D4           |
| C4  | Subprocess/environment and concurrent-process evidence prove direct argv, selected-client scoping, no inherited grants, no transcript, exclusive ownership, and safe refusal of unfinished/corrupt run state.                                                         | D5, D6, D8       |
| C5  | Doctor v2 order, field identity, readiness, renderer parity, privacy canaries and unchanged-tree evidence pass; historical v1 artifacts and unrelated schemas retain their identity.                                                                                  | D7               |
| C6  | Product-source checks preserve explicit-only skill metadata, bootstrap questions, approved merges, no copied policies and legacy/partial stops, and pin the scaffold marker with its removal rule; consumer docs distinguish structural readiness from host delivery. | D1, D5           |
| C7  | Supported Codex and Claude manual smokes record actual explicit skill entry, interactive decisions and return after exit. Stubbed argv or exit 0 alone is not host-delivery evidence.                                                                                 | D4, D5           |

Live vendor execution requires separate authorization. C7 is a
post-implementation host-delivery confirmation, not an in-run implementation
task. The plan's confirmation-preparation task completes by preparing the
disposable smoke procedure and a fixed, named section of the feature's
`test-report.md` whose heading the plan defines: one row per client, status
`unverified`/`pass`/`fail`, version/configuration, evidence reference and owner,
plus an explicit statement that stubs do not prove host delivery. Unavailable
live authorization leaves those rows `unverified`, without blocking completion
of that preparation task or a normally verified/reviewed orchestrated
implementation run.

The maintainer owns the later authorized confirmation and its evidence update.
Until both client rows pass, host delivery remains unverified, the ADR's
manifest row remains `Planned`, and reports distinguish completed implementation
work from pending C7. After actual confirmation, the maintainer may update the
live record and move the row to `Implemented` in the separately authorized
follow-up. Neither an implementation run reaching `done` nor completion of the
preparation task satisfies C7 or reopens the immutable implementation task
ledger.

## Lifecycle Links

- Amended by [ADR-0054](./0054-git-visible-work-artifacts.md), accepted
  2026-10-13: new-work initialization uses the fixed tracked document convention
  without artifact-layout setup. Existing project guidance prerequisites and
  read-only behavior remain. Implementation is Planned.

- Amended by [ADR-0045](./0045-guided-verification-setup.md), accepted
  2026-09-14: save guided verification before optional client setup, permit
  bounded verify repair of a paused pending run, and emit doctor v4. General
  setup exclusion and existing recovery authority remain. Implementation is Planned.

- Amended by [ADR-0042](./0042-runner-delivered-phase-instructions.md), accepted
  2026-09-11: newly emitted doctor v3 replaces D7's v2 default and adds the exact
  `claude.instructions` readiness check. Historical v1/v2 meaning, adoption,
  setup and the read-only/privacy boundary remain binding. Implementation of
  this amendment is Planned.
- Supersedes: None.
- Superseded by: None.
- Amends [ADR-0036](./0036-vendor-neutral-policy-files-and-instruction-delivery.md):
  add the CLI runtime preflight and foreground
  invocation boundary. Preserve layout/migration semantics, installed policy
  ownership and the ordinary skill stops as defense after preflight.
- Amends [ADR-0008](./0008-read-only-doctor-diagnostics.md):
  replace newly emitted doctor v1 identity with
  v2 and add the specified readiness check; preserve its read-only/privacy rules.
- Accepted on 2026-09-10 by the user's explicit lifecycle decision after
  Rework 4. The accepted body retains its proposal-stage wording; this record
  supersedes its pending-acceptance statements. The decision body is immutable
  from this acceptance.
- Reciprocal amendment links are recorded in ADR-0036 and ADR-0008 lifecycle
  metadata; both remain Accepted and neither is superseded as a whole.
- Implementation state: `Planned`. The description and development plan await
  explicit plan-bundle approval. ADR acceptance authorizes no implementation,
  live vendor execution or delivery action.
