# ADR 0036: Vendor-Neutral Policy Files and Agent-Neutral Instruction Delivery

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-09-07
- Owner: Banzai maintainers
- Decision makers: user, explicitly accepted in chat on 2026-09-07 after
  rework 3 (English translation: `I accept ADR-0036`).
- Lifecycle provenance: proposed on 2026-09-06, accepted in chat on 2026-09-07,
  then explicitly reopened by the user on 2026-09-07 after review. The user
  directed a forced status change and the necessary corrections. This is a
  one-off authorization to return this ADR to Proposed and revise its body,
  overriding accepted-body immutability for this record only. It does not
  accept the revised text or change the general lifecycle policy. Revised a
  second time on 2026-09-07 at the user's direction: the Engineering Quality
  read scope and the legacy-layout route changed; see
  [rework 2](../features/vendor-neutral-policy-files-and-instruction-delivery/rework-2.md).
  Revised a third time on 2026-09-07 after Review 2, at the user's direction:
  the migration stop, the migrator's sources, shared local rules and the
  declined-migration state were made consistent with existing contracts; see
  [rework 3](../features/vendor-neutral-policy-files-and-instruction-delivery/rework-3.md).
  Accepted by the user on 2026-09-07 after rework 3; the body is immutable
  from that acceptance and only lifecycle metadata changes afterwards.

## Related Artifacts

- Repository authority: [AGENTS.md](../../AGENTS.md)
- Packaged instruction files:
  [plugins/banzai/CLAUDE.md](../../plugins/banzai/CLAUDE.md) and
  [plugins/banzai/AGENTS.md](../../plugins/banzai/AGENTS.md)
- Packaged template and scaffold owner:
  [plugins/banzai/PROJECT_MANIFEST.md](../../plugins/banzai/PROJECT_MANIFEST.md)
  and [project-manifest](../../plugins/banzai/skills/project-manifest/SKILL.md)
- Release gate:
  [check-release.mjs](../../packages/orchestrator/scripts/check-release.mjs),
  `packages/orchestrator/test/release-validation.test.ts`,
  `packages/orchestrator/test/workflow-skills.test.ts`,
  `packages/orchestrator/test/hook.test.ts`
- Runner prompt reference: `packages/orchestrator/src/prompts.ts` review
  prompt, "canonical vendor-neutral Engineering Quality policy from the
  installed CLAUDE.md"
- Result contracts the migration stop reuses:
  `plugins/banzai/contracts/v3/phase-result.schema.json` (`gate=escalation`)
  and `plugins/banzai/contracts/v1/review-result.schema.json` (`blocked`
  verdict, no gate field); their application in
  `packages/orchestrator/src/workflow.ts` (`answerHumanDecision`, review
  application, `retry` eligibility)
- Decision whose follow-up this resolves:
  [ADR-0030](./0030-vendor-neutral-engineering-quality-policy.md), which named
  `CLAUDE.md` as the current storage surface, reserved relocation for a later
  vendor-delivery decision, and forbade a new loader solely to rename it
- Policies affected but not changed in substance:
  [ADR-0013](./0013-risk-driven-test-assurance.md) Test Assurance,
  [ADR-0027](./0027-exposure-driven-security-assurance.md) Security Assurance,
  [ADR-0025](./0025-fix-authored-completion-ledger-refresh.md) ledger refresh
- External evidence: [Codex issue #17401](https://github.com/openai/codex/issues/17401)
  is an include-composition feature request, not a supported-version delivery
  test result.
- [Review 1](../features/vendor-neutral-policy-files-and-instruction-delivery/review-1.md),
  [rework 1](../features/vendor-neutral-policy-files-and-instruction-delivery/rework-1.md),
  [rework 2](../features/vendor-neutral-policy-files-and-instruction-delivery/rework-2.md),
  [Review 2](../features/vendor-neutral-policy-files-and-instruction-delivery/review-2.md),
  [rework 3](../features/vendor-neutral-policy-files-and-instruction-delivery/rework-3.md),
  and [historical Accepted snapshot](../features/vendor-neutral-policy-files-and-instruction-delivery/adr-0036-accepted-snapshot.txt).
  The snapshot preserves the reviewed bytes; it is not an active decision.
- Feature description and plan: none yet. This is a standalone proposal from
  the 2026-09-06 context-engineering review of the packaged plugin files;
  implementation requires acceptance of the revised proposal and an approved
  plan.

## Context and Decision Drivers

The current skills reference `CLAUDE.md` as a process input or policy source.
The packaged file is 608 lines in the 2026-09-07 source inventory. Its sections
divide into two kinds, counting headings and separating blanks:

- Process, needed by every phase: Authority, Execution Modes, Roles, Routing,
  Hard Rules, Escalation Triggers, ADR Eligibility, Verification, Decision
  Gates, Progress Reports, Hook Gate, Git, Dependencies — 298 remaining lines.
- Policy: Decision Consultation (22), Test Assurance (27), Security Assurance
  (43), Engineering Quality (178), and Plan Task Completion Evidence (40) —
  310 lines. Consumers include lite work, ordinary fixes, requirements, ADRs,
  implementation, assurance, review, discovery and completion reporting;
  the complete read matrix below preserves their responsibilities.

Skills already reference these sections instead of copying them ("Apply the
canonical Engineering Quality policy in `CLAUDE.md`; this skill adds only …").
The reference target can therefore move without changing any rule.

Delivery facts:

- Automatic instruction assembly: `plugins/banzai/AGENTS.md` contains a heading
  and `@./CLAUDE.md`. Whether a host expands that directive depends on its
  supported client version/configuration. The cited Codex issue alone does not
  establish compatibility or effective instruction delivery.
- Explicit reads: `feature-description` instructs reading `CLAUDE.md`, and
  `planningPrompt` invokes that installed skill. The runner's `COMMON` prompt
  also supplies workflow/gate restrictions directly. An automatic-include gap
  does not prove that the agent never reads the file or receives no rules.
- Effective delivery: no supported Codex/Claude runtime smoke is recorded for
  this proposal. A filename, include or read instruction alone does not prove
  which text a session received or applied. Both automatic ingress and explicit
  policy access require separately identified evidence.
- This repository's own root already uses the inverse layout: `CLAUDE.md`
  contains `@AGENTS.md` and `AGENTS.md` carries the text. This is a layout
  precedent, not a host-runtime test. Packaged files are product templates,
  not instructions for work in this repository.
- The scaffold copies `CLAUDE.md` and `AGENTS.md` into the project root once and
  never overwrites them. Policy text inside those copies is frozen at adoption
  time; later plugin releases that change a policy reach an adopted project
  only through a manual merge. Skills, contracts, and hooks, by contrast, are
  read from the installed plugin and update with it.
- The release gate pins policy fragments at `plugins/banzai/CLAUDE.md` and
  reference wording in skills. The template, documentation, hook prompt and
  runner prompts also reference this source. `hooks/spec-gate.cjs` treats both
  `CLAUDE.md` and `AGENTS.md` as free paths.

Decision question: where should the five phase-scoped policies live, and which
packaged file should carry the primary instruction text, so that both supported
hosts have explicit access to the same Banzai semantics, with a defined upgrade
route and policy reads at the responsibility that needs them?

Drivers, in priority order:

1. Preserve Banzai semantics and local authority (ADR-0030); distinguish
   instructed access from verified delivery.
2. Target automatically assembled text is process only; a policy is explicitly
   read by the phases that apply it.
3. One authoritative source per rule in the selected layout; no mixing of old
   local policies and relocated replacements, new loader or delivery subsystem.
4. The release gate keeps pinning every policy fragment it pins today.
5. Existing adopted projects keep user-owned files; an unmigrated project
   fails visibly with a named migration step instead of silently mixing
   sources.

## Options Considered

### Option 1: Keep the current layout

- Change nothing; retain existing explicit skill reads.
- Benefits: no churn; no gate re-pinning.
- Costs: automatic AGENTS ingress still depends on include behavior;
  full-text reads include every policy and adopted copies stay frozen.
  Rejected because delivery and update boundaries remain unresolved.

### Option 2: Flip delivery only — `AGENTS.md` primary, `CLAUDE.md` include shim

- Move the full text into `plugins/banzai/AGENTS.md`; make
  `plugins/banzai/CLAUDE.md` exactly `# CLAUDE.md` plus `@AGENTS.md`.
- Benefits: removes the target AGENTS include dependency and mirrors the root
  layout; explicit reads remain available where auto-loading is unverified.
- Costs: policies remain project copies, and the adoption contract below is
  still required. Acceptable as a delivery milestone; insufficient alone.

### Option 3: Relocate policies only, keep `CLAUDE.md` primary

- Move the five policies to plugin-relative files; leave `AGENTS.md` as an
  include of `CLAUDE.md`.
- Benefits: policies can update independently of project scaffold copies.
- Costs: automatic AGENTS ingress still depends on an include, and legacy
  adoption still needs layout recognition. Rejected as incomplete.

### Option 4: Flip delivery and relocate policies to plugin-relative files

- Option 2 plus: the five policies move without semantic changes to
  `plugins/banzai/policies/<name>.md`, read from the installed plugin like
  `contracts/` and `skills/` are today; `AGENTS.md` keeps a short policy index
  naming each file and its consuming phases.
- Benefits: new and migrated projects receive policy updates with the plugin;
  an unmigrated project is recognized and stopped with a named migration step.
- Costs: one mechanical reference sweep across skills, template, hook, prompt,
  gate, and tests; agents must read a policy file when a phase requires it,
  the same obligation they already carry for `contracts/`. The shipping
  release requires one explicit migration per adopted project. Selected with
  the adoption contract below.

Two routes for an unmigrated legacy layout were weighed. A compatibility route
— every skill selects between the legacy full-text `CLAUDE.md` and the
relocated policies before each responsibility, and keeps working on the legacy
copy when migration is declined — avoids interrupting work, but it places
permanent source-selection prose in every skill on both hosts and relies on
instruction rather than structure to keep old and new policy bodies from
mixing. Required migration with a stop diagnostic reuses the existing
missing-or-stale-manifest pattern, costs one interruption per project, and
makes mixing structurally impossible. Required migration is selected.

## Decision

Adopt Option 4 under the following contracts. The approved implementation plan
owns the mechanical edits and sequencing.

### Process and policy sources

Packaged `AGENTS.md` carries the primary process text. Packaged `CLAUDE.md`
becomes exactly a heading and `@AGENTS.md`; AGENTS contains no `@` include line.
Each skill resolves the project process source before its policy reads and
reads it explicitly unless the host has already assembled that file into the
session context; a second read of an already loaded file adds nothing. An
absent or unreadable required source is reported before the affected work
proceeds. The bootstrap source rule under "Adoption and migration" is the only
exception to the project process source.

Keep five canonical files under `plugins/banzai/policies/`:
`decision-consultation.md`, `test-assurance.md`, `security-assurance.md`,
`engineering-quality.md`, and `plan-task-completion.md`. Resolve each as
`../../policies/<name>.md` relative to the installed `SKILL.md`, never relative
to the project cwd or a fixed plugin cache path. Do not copy them into projects.

Preserve existing bodies and pinned fragments under whitespace normalization,
except for explicitly enumerated storage/cross-reference edits: the EQ delivery
paragraph names its new source, and references to the authority order or
escalation triggers "above" name the resolved process source. Headers and the
process policy index identify scope and consumers without duplicating bodies.
No rule, EQ identifier, finding/shadow semantics, completion contract,
enforcement boundary or approval changes.

The matrix below is the required read inventory for the relocated layout.
`Read` means read before the relevant responsibility; `Conditional` means read
when the condition below applies; `—` means no independent policy duty. The
same responsibilities apply in standalone and orchestrated work unless limited
below. A file already read in the current phase need not be read again unchanged.

| Skill                 | Decision Consultation | Test Assurance | Security Assurance | Engineering Quality | Plan Task Completion |
| --------------------- | --------------------- | -------------- | ------------------ | ------------------- | -------------------- |
| feature-description   | Conditional           | —              | Read               | Read                | —                    |
| architecture-decision | Conditional           | —              | Conditional        | Read                | —                    |
| development-plan      | Conditional           | Read           | Read               | Read                | Read                 |
| code-writing          | —                     | Read           | Conditional        | Read                | Read                 |
| test-writing          | —                     | Read           | Conditional        | —                   | Conditional          |
| feature-review        | —                     | Read           | Read               | Read                | Conditional          |
| feature-status        | —                     | —              | —                  | —                   | Conditional          |
| feature               | —                     | Read           | Read               | Read                | —                    |
| quick-fix             | —                     | Read           | Read               | Read                | Conditional          |
| project-manifest      | —                     | Conditional    | Conditional        | Read                | —                    |
| orchestrate           | —                     | —              | —                  | —                   | —                    |

- Decision Consultation: the three strict planning skills read before framing a
  material unresolved human-owned choice. The existing process trigger remains
  visible before that read. No lite/fix consultation is added.
- Test Assurance: planning reads before choosing evidence, writers before test
  selection/change, and review before auditing assurance. Ordinary quick fixes
  retain the obligation alongside accepted-finding fixes. Manifest work reads
  when bootstrap choices or recorded test-policy facts require interpretation;
  transcribing verified commands alone needs no new assurance audit.
- Security Assurance: requirements, plans, lite work, fixes and review read
  before assessing changed exposure, including the existing one-line no-exposure
  outcome. ADR work reads when weighing an applicable mechanism or boundary.
  Code/test work reads when implementing or assuring a security requirement or
  discovering a new exposure; existing escalation rules govern scope changes.
  Manifest work reads when proposing an applicable bootstrap/configuration
  boundary change. A policy read does not authorize that change.
- Engineering Quality: the eight skills that already reference the policy read
  it before their discovery, design, implementation, fix, or review judgment;
  each keeps its existing phase-specific projection. `test-writing`,
  `feature-status`, and `orchestrate` have no independent read: the two
  always-active rules, `EQ-01` and `EQ-07`, restate the process file's
  Authority order and approved-scope Hard Rules that every skill already
  receives, and the contextual rules apply only to a design or review judgment
  those three skills do not make. The Hard Rules bullet keeps its
  cross-cutting reference and names the policy path. Reading EQ never adds an
  audit, broadens discovery, or promotes shadow candidates.
- Plan Task Completion: planning reads before defining tasks/immutability;
  implementation before recording completion; test-writing when working with
  strict task evidence; review/status when interpreting plan completion;
  quick-fix when an accepted finding touches strict completion evidence. Keep
  standalone checkbox semantics, orchestrated immutable plans, unknown/legacy
  coverage and the single runner-owned ledger distinct. Lite backfill creates
  no strict ledger. `orchestrate` only relays validated completion through its
  existing control protocol; it never reconstructs or evaluates a ledger.

Policy headers, index, skill instructions, prompt references and tests must agree
with this matrix. A material policy responsibility discovered during approved
work still requires reading its applicable policy; the table never authorizes
bypassing existing semantics.

### Adoption and migration

Layout recognition is a skill precondition, not a new runtime loader or machine
gate. It applies on both hosts before the first affected responsibility, even
when `project-manifest` has not run after a plugin update. Hook free paths and
never-overwrite scaffolding remain unchanged.

| Project layout                                                                                                                                                                                                                | Required behavior on both hosts                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target: project `AGENTS.md` carries the process text, the policy index and every shared project rule; `CLAUDE.md` is the shim, optionally followed by host-specific content, and carries no shared rule or Banzai policy body | Read `AGENTS.md` and the matrix-selected installed policies. The Claude shim is additional ingress, not the sole route.                                                                                                                                                                                                    |
| Legacy: project `CLAUDE.md` still carries the full Banzai process text with inline policy sections, and `AGENTS.md` is absent or an include stub                                                                              | Stop before the affected work with the diagnostic "legacy Banzai layout: run `project-manifest` to migrate". Read neither the legacy policy copies nor the relocated policies as applicable rules. `feature-status` and `project-manifest` still run under the bootstrap source rule below.                                |
| Partial migration, conflicting full sources, missing required sections, or an unreadable source                                                                                                                               | Report the exact ambiguity and stop the affected work under existing conflict and escalation handling; do not guess precedence, reconstruct rules, or overwrite files. Explicitly invoked `project-manifest` may complete or revert the migration under the same rule; `feature-status` reports the partial state as such. |

The stop follows the existing missing-or-stale-manifest rule: say so, ask the
user to run the explicit-only skill, and never scaffold or migrate another way.
A filename alone does not establish the target layout; the recognition rule
names the section set the shipped process file and policy index carry.

Orchestrated runs raise the stop through the result each phase already
returns. No contract, gate, state or command is added:

- Workflow selection is read-only and applies no policy; it is not affected
  work. The first affected phase raises the stop.
- Planning, implementation and fix phases return `gate=escalation`
  (`phase-result/v3`) before any source change, with the diagnostic as the
  summary and the migration step as the question. `outcome=blocked` is not
  used: a completed attempt with that outcome is not retryable. The human
  migrates, then answers through the existing decision command. The answer
  keeps its existing effect: it clears plan approval and returns a strict run
  to planning and a lite run to workflow selection; the plan is approved again
  through the existing gate. Raising the stop before source changes keeps the
  lite escalation valid.
- The review phase returns the existing `blocked` verdict (`review-result/v1`,
  which has no gate field) with the diagnostic as the summary and no findings.
  The run is blocked from `reviewing`; after migration the human runs
  `banzai retry`, already eligible from that state, and the runner rotates to
  a fresh reviewer under its existing previous-review-blocked rule. Approval,
  triage and completion state are untouched.
- The `orchestrate` supervisor runs read-only: it relays the escalation
  question or the blocked/retry state through its existing control protocol
  and sends only the current user's exact answer or retry decision; it never
  migrates or decides for the user.

Cancellation, a new run, `retry`, `recover` and an escalation answer never
imply migration authority. The next affected phase checks the layout again,
and an unmigrated project stops again with the same diagnostic.

Bootstrap source rule. The legacy and partial rows exempt exactly two skills,
both explicitly invoked or read-only: `project-manifest` migrating the project
and `feature-status` reporting. On those layouts each takes its process text
from the installed plugin's packaged `AGENTS.md` and its matrix-selected
policies from the installed `policies/` files: Engineering Quality for the
migrator's discovery judgment, Test or Security Assurance when the migrator's
matrix conditions apply, and Plan Task Completion when the status report
interprets completion evidence. Existing project files are inputs to the
migration diff and the status report only: legacy Banzai text is merge
evidence and never an applicable policy, while approved user and project
decisions recorded in those files keep their existing higher authority. An
absent or unreadable installed source stops these skills too. No other skill
or phase receives this exemption, it adds no loader, and the migration remains
a human-approved merge.

When explicitly invoked on a legacy layout, `project-manifest` proposes one
concrete migration diff: write the process text and policy index to
`AGENTS.md`, remove the Banzai policy bodies from `CLAUDE.md`, and classify
every remaining non-Banzai line with the user. A shared project rule — one
that applies to any agent, such as an approval requirement before a public
schema changes — moves into a preserved project-rules section of `AGENTS.md`,
the primary process source, under its existing authority. Only content the
user confirms as host-specific, such as Claude tool or permission notes, may
stay in `CLAUDE.md` below the `@AGENTS.md` include; `CLAUDE.md` is then the
shim plus that content, never a second process source. Unclassified lines and
any conflict between a retained rule and the shipped process text are
reported and resolved by approval before the diff applies; nothing is dropped
or duplicated silently. Apply only approved edits. An interrupted or partial
application is the third row above, not a completed migration.

Declining the migration changes nothing: every project file stays
byte-identical, the updated plugin stays installed, and affected work stays
stopped with the same diagnostic until a later migration. This decision pins,
installs, or downgrades no plugin release. A user who wants to keep working
unmigrated either stays on the last release before this change instead of
upgrading or performs an explicit, user-managed rollback after upgrading. The
diagnostic names that release as information only. Missing installed policy
access after migration is an availability failure, never permission to use an
obsolete local copy.

The release that ships this change is breaking for adopted projects and says
so in its release notes; version selection follows the existing release
policy. Runner prompts reference installed policy paths only. No prompt inlines
a policy and no adapter gains a loader. The project process file remains copied
and user-owned; policy updates arrive through the installed plugin.

### Reference checks and delivery milestones

Move existing path/wording pins without dropping rule coverage. Ban stale
normative references to CLAUDE as the default process or canonical relocated
policy source. Permit the legacy-layout recognition rule and its diagnostic,
shim information, file inventory, scaffold and migration instructions,
historical references and hook free-path entries. Use scoped patterns, explicit
exceptions and negative fixtures; neither a blanket filename ban nor an
unchecked whole-file exemption satisfies this rule.

Delivery-only Option 2 may land as a coherent milestone under an approved plan:
migrated AGENTS still owns inline policies, reads and pins target those
sections, and a legacy layout stops with the same diagnostic. Relocation, if
deferred, later changes reads and pins together to installed files and removes
inline copies only through the approved migration diff. Do not reference
unshipped files or leave a partially converted matrix. The full decision is
implemented only after both contracts are verified; reports must identify an
interim layout accurately.

ADR-0030 remains Accepted. This proposal resolves its recorded relocation
follow-up without changing EQ semantics or adding a delivery subsystem. Its
storage clause is amended only upon explicit acceptance of this revised ADR.

### Source-size estimate

The current process baseline is 298 lines before adding the policy index and
the layout-recognition rule. Applying the matrix gives:

| Skill                 | Baseline source lines before new index/reference text |
| --------------------- | ----------------------------------------------------: |
| feature-description   |                                               519–541 |
| architecture-decision |                                               476–541 |
| development-plan      |                                               586–608 |
| code-writing          |                                               543–586 |
| test-writing          |                                               325–408 |
| feature-review        |                                               546–586 |
| feature-status        |                                               298–338 |
| feature               |                                                   546 |
| quick-fix             |                                               546–586 |
| project-manifest      |                                               476–546 |
| orchestrate           |               298, plus its existing control protocol |

Ranges include conditional policy reads from the matrix. These estimates count
each section once and exclude skills, contracts, prompts, local additions and
host assembly. The eight Engineering Quality consumers stay within roughly
480–610 lines, close to today's 608; the saving concentrates in the
always-assembled process text and in `test-writing`, `feature-status`, and
`orchestrate`. A delivery-only layout retains inline policies. This does not
measure tokens, cost or agent performance.

## Consequences

Positive:

- Both hosts have a primary process source and explicit policy read routes;
  actual delivery still requires supported-version evidence.
- Target automatic context is smaller; broad EQ applicability limits savings
  in actual phase reads.
- Policy updates reach every migrated project through the plugin; no frozen
  policy copy stays in use, because an unmigrated project stops instead of
  running on one.
- Single source per rule is preserved; pinned fragments move without
  duplicating rule bodies, and old and new policy bodies never apply together.

Costs and risks:

- Each delivery milestone requires a coherent reference/check update under an
  approved plan; this proposal does not implement either milestone.
- The shipping release is breaking for adopted projects: each needs one
  explicit `project-manifest` migration before affected work continues.
  Conflicting or partial layouts stop affected work visibly. Declining the
  migration leaves the updated plugin installed and affected work stopped;
  staying unmigrated is a release choice the user makes, not a state this
  decision restores.
- A run interrupted by the stop pays the existing cost of its route: an
  escalation answer discards plan approval and returns to planning or
  selection, and a blocked review is retried with a fresh reviewer. Updating
  the plugin between phases of an unmigrated run is therefore not free.
- The migrator and the status skill read installed sources on a legacy
  layout; that bounded exemption is one more rule to pin and test.
- An agent can skip a referenced policy. Explicit phase-start reads, source
  fixtures and supported-host smoke mitigate this risk; no runtime policy check
  or stronger performance claim is added. Existing workflow routing,
  verification, independent review and triage remain unchanged.

## Compliance and Confirmation

Implementation and review must establish:

1. Target AGENTS contains every retained process section with no `@` include;
   CLAUDE has the exact shim shape. Test a delivery-only milestone against its
   inline-policy contract, not the relocated target.
2. Policy bodies and existing normalized pins survive extraction, with an
   explicit diff inventory of permitted cross-reference/storage changes.
3. Headers, index, all skill reads and runner references agree with the complete
   matrix. Negative fixtures catch omitted lite/fix/ADR/implementation consumers
   and an added read in `test-writing`, `feature-status`, or `orchestrate`;
   retain standalone, orchestrated, strict, backfill and supervisor boundaries.
   The bootstrap source rule appears only in `project-manifest` and
   `feature-status`; a fixture rejects it in any other skill or prompt.
4. Scoped checks reject obsolete default CLAUDE rules-source references while
   preserving the legacy-recognition rule, bootstrap source rule, scaffold,
   migration, inventory, history and hook exceptions. Necessary filename
   mentions are not violations.
5. Synthetic fresh adoption, approved migration, plugin update without
   migration (legacy stop with the named diagnostic), absent-AGENTS legacy
   migration, legacy completion status, interrupted migration resumed by the
   migrator, declined migration, custom-content migration, custom conflict,
   and missing-policy fixtures establish layout recognition. The
   custom-content fixture carries one synthetic shared restriction and one
   host-specific note in legacy `CLAUDE.md` and verifies that the restriction
   is delivered on both hosts from `AGENTS.md`, the note stays below the
   include, and no Banzai policy body remains in the project. Existing project
   files remain byte-identical on update; a declined migration changes neither
   project files nor plugin installation state. No ordinary skill migrates,
   mixes policy sources, or continues affected work on a legacy layout.
6. Orchestrated fixtures with a stubbed vendor cover a plugin update before
   planning, before implementation, before a fix, before review and before a
   review retry. Each continues only through the route above: `escalation`
   clears plan approval and returns to planning or selection; the review
   `blocked` verdict is followed by an eligible `retry` with reviewer rotation;
   `review-result/v1` stays closed; cancellation, a new run, `retry`, `recover`
   and an answer grant no migration authority.
7. `check-release.mjs`, `release-validation`, `workflow-skills`, `hook`, and
   committed-bundle smoke pass after implementation/re-pinning. Source fixtures
   prove instructions/contracts, not model compliance.
8. The implementation test-report owner records supported Codex and Claude
   client versions/configuration and effective-delivery evidence for fresh and
   migrated layouts, a migrated custom-content layout, and the legacy stop
   diagnostic, including explicit policy access. Separate automatic ingress,
   tool reads and application evidence. Live execution needs separate
   authorization; absent evidence is `unverified` with a named manual owner,
   never inferred from filenames or the Codex issue. Do not claim a host
   delivery guarantee as verified while its evidence remains missing.

## Lifecycle Links

- Amended by [ADR-0042](./0042-runner-delivered-phase-instructions.md), accepted
  2026-09-11: runner phases receive the stated six-policy duty union inline
  from embedded canonical resources. Retain substantive/conditional duties,
  standalone relative loading and adoption ownership; required runner resource
  availability becomes a build guarantee. Implementation is Planned.
- Amended by [ADR-0040](./0040-project-adoption-preflight-and-interactive-setup.md),
  accepted 2026-09-10: add shared CLI adoption preflight, explicit foreground
  setup, a common source-repository exception and the scaffold-marker contract.
  Full guidance checks apply to new runs; continuations recheck instruction
  layout with the source exception. Installed policy ownership, human migration
  authority and ordinary skill stops remain binding. Implementation of the
  amendment is Planned.
- Amended by [ADR-0038](./0038-explicit-plan-authority.md), accepted 2026-09-08:
  `plan-task-completion.md` gains a separately owned Plan Authority section and
  expanded conditional triggers for strict plan interpretation. The same
  Read/Conditional membership, completion body, five-policy layout, relative
  resolution and source-availability rules remain binding.
- Amended by [ADR-0037](./0037-unified-runner-rendered-review-artifacts.md),
  accepted 2026-09-08: new review attempts bind layout stops and the closed-result
  confirmation to `review-result/v2`. Blocked/no-gate/no-findings behavior,
  diagnostic summary, retry/rotation, policy reads and human authority remain
  binding; historical stops retain v1 semantics.
- Resolves the relocation follow-up of
  [ADR-0030](./0030-vendor-neutral-engineering-quality-policy.md); ADR-0030
  remains Accepted and unchanged.
- Supersedes: None
- Superseded by: None
- Accepted on 2026-09-07 by the user's explicit lifecycle decision after
  rework 3. The body retains its proposal-stage wording; this lifecycle record
  supersedes the body's pending-acceptance statements. The earlier acceptance
  preserved in the linked snapshot and Review 1 remains historical.
- Feature description:
  [vendor-neutral-policy-files-and-instruction-delivery](../features/vendor-neutral-policy-files-and-instruction-delivery/description.md).
- Implementation state: Implemented under the approved
  [development plan](../development-plans/vendor-neutral-policy-files-and-instruction-delivery/plan.md).
  See the [implementation report](../features/vendor-neutral-policy-files-and-instruction-delivery/implementation-report.md)
  for the separately authorized cancellation prerequisite and
  [test report](../features/vendor-neutral-policy-files-and-instruction-delivery/test-report.md)
  for verification and unverified host-delivery evidence.
- [ADR-0045](./0045-major-bounded-compatibility-window.md) bounds retained versions to the release-train major that introduced them; later majors may remove those readers.
