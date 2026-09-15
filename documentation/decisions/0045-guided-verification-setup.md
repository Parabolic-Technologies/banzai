# ADR 0045: Guided Verification Setup and Configuration Prerequisite Authority

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-09-14
- Owner: Banzai maintainers
- Decision makers: Project owner; explicitly accepted in chat on 2026-09-14.

## Related Artifacts

- Private strict work: `guided-verification-setup`. Its description contains
  phases A/B/C and the resolved product decisions; requirements relevant to
  public consumers are summarized below. Private workflow evidence is not a
  prerequisite for reading or validating this ADR.
- Plan: not created. Dependent planning requires acceptance of this ADR;
  implementation additionally requires the normal approved plan bundle.
- Authority: root `AGENTS.md`; `PROJECT_MANIFEST.md` sections 5, 6, 8 and 10;
  `packages/orchestrator/MODULES.md`; maintained getting-started and verification
  examples guides.
- Related decisions: ADR-0006/0007/0008/0013/0015/0017/0018/0019/0023/0024/
  0025/0027/0031/0037/0038/0040/0041/0042/0043/0044. Precise amendments and
  preserved authority appear in Lifecycle Links.

## Context and Decision Drivers

The inspected source at `42f3c48ee23d9158061c1b7e6047f5867a67f1fe`
initializes schema 2 with a repository hygiene profile only. Root detection in
`verification.ts` classifies confirmed marker absence as `custom`, and doctor
v3 requires substantive coverage for that type. An application-empty repository
therefore cannot satisfy coverage before its first implementation. Current
getting-started and verification examples tell the human to edit configuration.

`config.ts:applyModelUpdates` replaces selected model-value tokens losslessly;
it does not insert profiles. `workflow.ts:answerHumanDecision` records generic
escalation answers and returns to planning with approval cleared. It cannot
execute a model-proposed configuration remedy. The spec-gate correctly rejects
model writes to runner control files. These facts explain the owner-supplied
first-run failure scenario; this ADR does not claim a live reproduction.

`phase-instructions.ts` currently classifies Codex as unverifiable installed
Claude parity and attaches the same remedies to different causes. Doctor v3,
control contract 3.0.0 and the closed pending-decision union cannot silently
acquire the proposed semantics. Schema 3 already binds `name`, executable,
argv, timeout and evidence options into a command digest; its approved
obligation inventory matches the exact ordered configured check IDs.

Decision question: Which runner-owned configuration and continuation boundary
can make empty and existing projects ready through guided interaction, while
preserving model scope, approved work, truthful verification and old contracts?

Treat setup, prerequisite resolution and their diagnostic projection as one
coupled lifecycle decision. Phase C's parity correction shares the successor
doctor contract; it grants no separate configuration or model authority.

The following product choices are settled requirements, not alternatives for
this ADR to reopen:

- The wizard executes no project command. An empty root implies no stack;
  explicit `verification.bootstrap: true` permits deferred coverage.
- The human uses guided add/edit/remove and explicit check execution. Automatic
  acceptance adds a profile and clears bootstrap without overwriting an
  existing profile or clearing plan approval.
- Configuration waiting uses `needs_human_decision`. Pending decision actions
  lead status; external repair followed by explicit resume is an alternative.
- GVS-01 permits Skip only in the current run while relevant types and
  configuration stay unchanged. GVS-02 preserves an invalid old profile until
  its prerequisite is restored; GVS-03 additionally permits separately
  previewed and explicitly confirmed edit/removal. Skip remains available
  within its stated authority.
- Add, edit and remove obey the same ownership exclusion, including an
  interactive owner waiting for input. Changed schema-3 commands receive new
  stable IDs and cannot inherit the replaced command's evidence.
- Doctor stays offline and read-only. Required Fix lines cover verification
  checks and `executables.verification`, not every doctor category.
- `verify check` attempts all commands; ordinary workflow verification retains
  stop-on-first-failure behavior.

Prioritize explicit boundary validation, failure recovery, byte preservation,
small compatibility seams and identifiable assurance ownership (EQ-04/05/07/
08/09). Do not add a model phase, external service, dependency installer or
general configuration editor.

## Options Considered

| Option | Benefits | Costs and disposition |
| --- | --- | --- |
| Keep diagnostic hints and generic escalation only | Small surface; existing state readers suffice | Cannot perform the promised repair or preserve the first implementation checkpoint; reject. |
| Permit a model to edit control files after a prose answer | Flexible apparent repair | Broadens model authority, has no executable bounded proposal and undermines the hook; reject. |
| Cancel/restart after a separate setup tool | Reuses current setup exclusion | Discards useful continuation and leaves cancellation as the only configuration exit; reject. |
| Add a runner-owned proposal, narrow config transaction and typed continuation | Exact human choice, no model control-file grant, shared TTY/control behavior | Requires coordinated state, diagnostic and review evolution; select. |
| Add a general configuration language, shell editor or schema migration | Broad future flexibility | Unnecessary interpretation, mutation and compatibility surface; defer. |

For schema-3 identity, retaining IDs for display-name edits would reduce churn,
but would split editor identity from the current full command digest. Retaining
IDs for timeout edits would additionally hide an execution-policy change behind
the old identity. Select comparison of the normalized command definition,
including both fields. Reordering an unchanged definition retains its ID;
ordered configuration identity still changes and invalidates applicability.

For persistence, extending old state versions would conceal a new authorization
union. Requiring migration would burden existing work. Select a new-run state
version with explicit verification mode and unchanged historical readers.

## Decision

### 1. Shared static inspection and explicit bootstrap

Use one pure verification inspection/proposal model for init, verify commands,
runner preflight and checkpoint handling. Doctor may consume pure inspection
results but retains its separate direct-reader composition. It must not reach
the runner, mutable store, command executor or transaction writer.

Accept optional boolean `verification.bootstrap` in config schemas 2 and 3.
Absence and false disable it; reject other values. Keep config schema numbers,
`contractVersion: "1.0.0"`, default schema 2 and schema-1 legacy behavior.
Schema 3's shared closed parser must explicitly allow the field. Do not migrate
files. Preserve unknown fields where the existing schema permits them; invalid
schema-3 fields do not become valid through lossless editing.
When bootstrap is absent, preserve the existing normalized configuration and
digest representation; do not inject a new default field into historical
verification identities.

Retain root-only detection, lexical type ordering, exact hygiene classification
and mixed/nested-project meaning. Unreadable or invalid required marker evidence
is an inspection failure, never proof of absence. Apply this readiness table:

| Evidence | Coverage result |
| --- | --- |
| Bootstrap true, confirmed no markers, resulting `custom`, no substantive profile | Pass: `Bootstrap mode, coverage deferred.` Counts remain truthful. |
| Bootstrap true, detected type without substantive coverage | Fail with the exact `banzai verify add <type>` remedy for every uncovered type. |
| Bootstrap true and any substantive profile exists | Warn: `Bootstrap flag is stale.` Independently fail any uncovered type. |
| Bootstrap absent/false and an uncovered type, including `custom` | Fail with its setup remedy. |
| Bootstrap absent/false and every type covered | Ordinary coverage pass. |
| Required marker evidence unavailable/invalid | Fail `project.types`, expose no inferred types, skip dependent coverage checks. |

Other doctor prerequisites remain independent. Bootstrap does not prove command
execution, authentication, project quality or workflow completion.

For Node, suggest only valid existing root `package.json` scripts named `test`,
`lint`, `build`, `typecheck`, in that order. Resolve npm/pnpm/yarn/bun from project
evidence or an explicit human selection; conflicting evidence requires a choice.
Do not execute package managers to detect them. Non-Node suggestions are editable
maintained examples, visibly identified as examples. No usable suggestion means
command entry or Skip, never a placeholder passing command.

Static command-prerequisite recognition is deliberately finite: at minimum,
recognize supported package-manager script-invocation argv forms and an absent
named script in a readable root `package.json`. Do not parse arbitrary shell
programs or infer that a command fails from its display name. Ambiguous argv,
unreadable metadata and unknown command semantics remain distinguishable from
a proven absent prerequisite. Ordinary execution owns runtime failures.

### 2. One typed runner decision at an eligible checkpoint

After a completed eligible implementation or fix attempt, validate its existing
completion, scope and continuation authority, then inspect current project
types and configuration before the next verification round. A newly uncovered
type or a statically proven impossible configured command raises
`configuration_prerequisite` without a planner invocation. Detect all gaps and
present one proposal at a time in lexical project-type order.

This is a runner-raised decision, not a new model-result `gate` value. Models
cannot construct its authority. Retain the existing phase-result contract.
It adds one conditional human configuration gate; the five existing human
gates and separate operator-recovery authorization keep their meanings. It
does not introduce routine confirmation at other phase boundaries.
Persist a closed `banzai-configuration-prerequisite/v1` request with these fields:

| Field | Meaning |
| --- | --- |
| `schema`, `schemaVersion` | `banzai-configuration-prerequisite/v1`, `1`. |
| `kind` | Exactly `configuration_prerequisite`. |
| `runId`, `decisionId`, `proposalId` | Exact run identity; fresh UUID decision and proposal identities. A revised proposal gets a new proposal ID. |
| `requestedAt` | Runner-observed UTC time. |
| `reason` | `missing_profile` or `missing_script`. Additional operational errors are not encoded as guesses. |
| `proposal` | `{ projectType, profile: { id, commands }, source }`; profile type is the enclosing project type. |
| `options` | Exactly `["accept", "edit", "skip", "cancel"]` in that order. |
| `configSha256`, `sourceSha256` | Private exact config-byte identity and digest of the bounded proposal evidence snapshot. |
| `continuation` | Exact completed attempt ID/kind, intended next verification round, base/work binding and approval-or-lite-selection identities. |

`projectType` is an application taxonomy value, including `custom`, never
`repository`. The proposed profile ID is unused and kebab-case. Commands use
the config version's existing command fields. A draft may have zero commands
when human entry is necessary; Accept requires a nonempty valid substantive
profile. No duplicate/conflicting ID or impossible old command is hidden by
the new proposal. The UI keeps the fixed actions and explains why Accept is
currently unavailable when repair or entry is required.

Define `source` as a closed tagged union:

- `project_scripts`: `kind`, `path: "package.json"`, `packageManager` and
  ordered `scriptNames`. `packageManager` is `npm|pnpm|yarn|bun`, or null when
  human selection is required; null never authorizes an inferred executable.
  No script bodies are included.
- `documented_example`: `kind`,
  `document: "documentation/verification-examples.md"`, `section` (a maintained
  anchor identifier) and `projectType`.
- `human_edit`: `kind` and the preceding `proposalId`; the runner retains the
  original detection evidence for drift checks.

Keep snapshot hashes private; expose an opaque proposal ID to control clients.
Source identity covers the evidence actually used, including relevant root
markers, script entries, package-manager evidence and example-resource identity.
Never hash secret environment values as a substitute for dependency evidence.

### 3. Pending actions and resume authority

Keep the run in `needs_human_decision` until the following action is resolved:

| Action or observation | Required behavior |
| --- | --- |
| Accept | Recheck proposal, config/source identity, existing prerequisites and continuation authority under ownership; apply only the displayed addition and bootstrap removal; record the real human answer and continue toward verification. |
| Edit | Edit structured executable/argv/metadata, validate, issue a new proposal ID and display the complete result. Save no config and execute nothing; require a later explicit Accept. |
| Skip | Record the real human choice and its scope; continue with configured hygiene only, subject to independent binding obligations. |
| Cancel | Use the existing explicit cancellation lifecycle. |
| EOF, signal, pause or UI exit before submission | Retain the proposal and checkpoint, infer no answer, release owned resources through normal cleanup. |
| Explicit external add/edit/remove | Apply its separately confirmed config transaction; leave the pending decision pending. |
| Explicit resume after complete external repair | Reinspect config/source and original authority; record `satisfied_by_configuration`, resolve the obsolete proposal and continue to verification without a synthetic Accept or duplicate profile. |
| Resume after incomplete repair or changed evidence | Retain or refresh the actionable proposal without spending model tokens. |

Never clear plan approval or replay a completed implementation merely to resolve
this kind. After one accepted addition, inspect remaining gaps before scheduling
verification. An old invalid profile remains configured until its prerequisite
is restored or the human separately confirms edit/removal. A new addition alone
cannot repair that old command. Ordinary `escalation` and `decision_consultation`
answers keep their current planning semantics.

Pin Skip to the current run, sorted detected type set and normalized verification
configuration, including bootstrap, ordered profiles, commands and policy.
Unrelated model settings or JSON formatting do not change that configuration
identity; the exact file hash still protects every proposed write. A type or
verification-configuration change invalidates Skip. No later run inherits it.
Record omitted coverage in status and review; neither Skip nor bootstrap creates
a passing substantive result. Run only configured exact hygiene commands; when
none exist, report that absence instead of inventing an execution.

Skip does not waive an explicit binding plan obligation or mandatory project
policy. If those require omitted evidence, retain the actionable decision and
identify the existing approval/escalation route needed to change that authority.
Do not manufacture a successful completion, modify approved bytes, or infer that
the human approved a different plan by choosing Skip.

A skipped round has its own coverage disposition in state 6 and snapshot v4.
Execute selected hygiene commands fresh and retain their real physical leaves;
do not construct a normal all-configured-checks applicability success from that
subset, add a fake `reuse` action, or narrow the saved verification config.
In policy mode, the skip record plus current scope/authority and actual hygiene
outcomes governs this exceptional continuation. Ordinary rounds still require
ADR-0043's complete applicability checks. Retain earlier decisions/origins as
history; no current applicability pointer may present them as the skipped
round's coverage. Frozen projections unable to express the exception retain
their incomplete/unknown treatment. This introduces no new physical-attempt
or verification-decision action kind.

Configuration waiting alone never sets `blocked` or a configuration block reason.
Real operational failures and interrupted mutable attempts retain their existing
blocked/retry/recover eligibility. This decision does not reinterpret historical
model-written block prose as a configuration checkpoint.

### 4. Exclusive, lossless configuration transactions

Use the existing lossless token-editing foundation and extend it for bounded
profile insertion/replacement/removal and the bootstrap property. Reuse its
preservation guarantees, not a claim that `applyModelUpdates` already supports
those operations. Preserve every byte outside the confirmed changes, including
schema, unrelated profiles/models/timeouts and permitted unknown fields. Keep
profile and command order unless the preview explicitly changes that order.

All writers use one repository ownership boundary shared with model execution,
workflow verification, explicit `verify check` and other config writers. The
owning runner may apply a decision while it holds that ownership and no child
process is active. A second terminal may repair a paused pending run only after
the live owner releases ownership; an unfinished run alone is not a blanket
repair prohibition. Keep any required bound-work claim as well. Do not steal a
claim based on elapsed time or broaden the general `banzai setup` exception.

For a waiting interactive owner, refuse with:

> Configuration is owned by another Banzai session. Answer there, or pause/exit that session, rerun this command after ownership is released, then run banzai resume.

Require a regular config file and safe non-symlink ancestors, validate the entire
result before publication, recheck expected bytes/source immediately before
writing and inspect the published result. Reject unsafe targets, invalid config,
stale proposals and newly conflicting IDs before mutation. Drift produces a fresh
preview requiring confirmation. No blind overwrite or automatic rollback over
an unrelated later edit is permitted.

For a run-associated write, use a private runner-owned transaction record
`banzai-verification-config-transaction/v1` under that run's storage. Its closed
fields are `schema`, `schemaVersion: 1`, `operationId`, `runId`,
`operation: add|edit|remove`, `origin: configuration_decision|verify_command`,
`decisionId`, `proposalId`, `previewId`, `configBeforeSha256`,
`configAfterSha256`, `profileId`, `previousCommandIds`, `currentCommandIds`,
`sourceSha256`, `continuation`, `bootstrapCleared` and
`stage: prepared|applied|finalized`. The IDs reference the exact retained human
confirmation and preview; schema-2 command-ID lists are empty. A command repair
has null decision/proposal IDs and no configuration-decision answer reference;
its continuation identifies a pending checkpoint to preserve, or is null when
no such checkpoint exists. A config write cannot grant continuation to another
state or historical run. Keep raw unrelated config out of
the record and logs; temporary replacement bytes are private and cleaned up by
their owner after durable reconciliation.

Persist preparation before atomic config publication. Publish one
`config.verification.applied` event keyed by `operationId`. Its payload contains
only `operationId`, `operation`, `origin`, `decisionId`, `proposalId`,
`profileId`, `previousCommandIds`, `currentCommandIds`, `configBeforeSha256`,
`configAfterSha256` and `bootstrapCleared`, with the transaction's meanings.
Do not include raw commands or config. Finalize
the transaction and applicable state only after revalidation. Inactive init or
verify operations need atomic config publication but create no synthetic run,
run event or approval.

Reconcile interrupted publication from durable hashes and operation identity:
the before image means publication remains unapplied; the after image means
finalize once without another edit; a third image means drift and reinspection.
Never append a second logical applied event or infer a process outcome. Recheck
source and continuation authority before completing an interrupted accepted
operation. Existing stale-owner/operator recovery authorization remains required.
Config already published before later source drift is retained as a real change;
it does not authorize continuation on stale evidence.

### 5. Guided CLI and command identity

Interactive init orders its work as: create/retain config and required ignores;
model selection; static verification wizard; persist confirmed profile/bootstrap
choices; optional existing project-manifest client; final guidance/readiness
inspection. Client exit/failure preserves saved choices. No task starts
automatically. For a markerless root recommend `Enable bootstrap mode`, saving
true only on explicit confirmation. Non-TTY init does not infer confirmation
or hang; it gives the terminal init next step.

Expose these commands without requiring JSON editing for ordinary valid
schema-2/3 configuration:

| Command | Authority and result |
| --- | --- |
| `banzai verify add <type>` | Same proposal/editor, explicit acceptance, additive only. Unknown types or ID conflicts do not write. |
| `banzai verify edit <id>` | Exact existing profile, concrete before/after and coverage preview, explicit confirmation. Preserve the profile ID and unselected data. |
| `banzai verify remove <id>` | Preview that profile and coverage impact; remove only on confirmation. Refuse the final remaining profile because the schema requires a nonempty list. |
| `banzai verify list` | Read-only ordered profiles/commands, bootstrap and coverage; configured state is not execution evidence. |
| `banzai verify check` | Explicit direct execution of every configured command once in profile-major/command-minor order, with a result for each. |

Add/edit/remove perform no project execution. Missing input, decline, unknown
IDs or invalid edits leave configuration unchanged. Successful profile saves that establish substantive
configuration include bootstrap removal in their confirmed preview. Init may
offer the same explicit stale-flag cleanup; no-op profile definitions retain IDs.
Legacy schema 1 stays readable/executable; guided mutations explain its separately
documented migration and do not rewrite it. Headless configuration decisions use
the direct-data path below, not scripted keystrokes or command-line JSON.

The structured editor takes executable and each argv item separately. Text
examples must resolve to an explicit displayed vector; do not evaluate shell
syntax, expand variables/substitutions or silently split quoted prose. Display
commands as inert data. They may themselves invoke project tooling such as npm;
the setup wizard does not claim those tools or scripts are safe or successful.

For schema 3, compare the normalized definition excluding `id`:

| Change | ID and evidence consequence |
| --- | --- |
| `name`, `command`, any argv value/order, or `timeoutMs` changes | New unique stable command ID; old evidence cannot verify the replacement. Name-only and timeout-only changes both count. |
| `evidence` or `ignoreExplanatory` changes | New ID; independent policy/plan authority still applies. Ordinary setup preserves these policy-bearing options. |
| Omitted/default `evidence: fresh` or `ignoreExplanatory: false` with the same normalized value | Unchanged definition; retain ID. Do not rewrite untouched bytes merely to normalize them. |
| JSON formatting/key order, or moving an unchanged command/profile | Retain IDs; ordered configuration identity still governs evidence applicability. |
| Added command | Allocate a new ID before preview; persist that exact ID on confirmation. |
| Removed command | Retain its historical identity/evidence; do not reassign its ID to another definition. |

Use fresh UUID-derived kebab-case command IDs. Reject allocation/publication
collisions against the current config's command IDs and, for a run-associated
operation, `previousCommandIds` and `currentCommandIds` in that selected run's
configuration transaction records. These are the complete collision-evidence
sources; inactive operations inspect current config only, without scanning other
runs, work bindings or archives. Unreadable required transaction evidence fails
closed rather than being treated as an empty history. Allocate another fresh ID
before preview on collision; a collision discovered after confirmation requires
a new preview and confirmation. IDs are runner-assigned and read-only in
the editor; profile additions do not renumber existing commands. Preserve
historical logs and physical leaves. New/changed configuration invalidates prior
applicability even for retained IDs when the existing full configuration digest
changes. Config persistence is not an execution or reuse decision.

Keep schema-3 policy and approved obligation bytes unchanged. An additive profile
can make the exact ordered inventory cease to match: deny reuse and perform the
current configured checks fresh, while still satisfying every original binding
obligation. This follows ADR-0043's conservative fallback, not implicit inventory
reapproval. If edit/removal replaces a check named by an approved obligation,
report the conflict and use existing authority before claiming it discharged.
Changing an obligation requires ordinary reapproval. Do not silently retarget an
old obligation to a replacement ID.

For `verify check`, command-level failure, unavailable executable or timeout
does not stop later commands after process cleanup. Aggregate success requires
all commands to succeed. Interruption or a global ownership/setup failure stops
scheduling, cleans up children, returns nonzero and labels remaining commands
not run. Use existing no-shell execution, timeout and redaction boundaries.
Create no model invocation, workflow approval or synthetic work binding. Its
diagnostic results do not populate an active run's completion/reuse ledger.
Ordinary runner verification still stops on its first failure.

### 6. Closed control and persistence versions

Use the following explicit compatibility boundaries for the new behavior:

| Boundary | New identity and compatibility |
| --- | --- |
| Doctor | `banzai-doctor/v4`, schemaVersion 4, as defined below. Historical v1-v3 retain their meanings. |
| Agent control | Contract `4.0.0`; `banzai-agent-capabilities/v4`, `banzai-agent-status/v3`, `banzai-agent-answer/v3`. Preserve request v1, recovery v1 and the original escalation-answer v1 / consultation-answer v2 meanings. |
| New guided-capable run state | Schema 6, with `verificationMode: ordered|policy`, the typed pending request, real human records, separate evidence-based resolutions, skip scope and transaction references. |
| Binding / verification ledger | Ordered mode retains binding v1 and ledger v1; policy mode retains binding v2 and ledger v2. Binding identity and mode are immutable for that run. |
| Review | `banzai-review-snapshot/v4` and rendered `banzai-feature-review/v5` for state-6 review evidence, defined in section 8. Preserve old snapshots/renderers. |
| Preserved | Umbrella/config contract 1.0.0, phase-result v3, review-result v2, task-completion v1, physical-attempt leaves, terminal checkpoint/recovery contracts, evaluation/KPI v1 and v2, context v1. |

Create guided-capable state 6 for new schema-2/3 runs. Choose policy mode only
through the existing explicit schema-3 policy enablement; otherwise use ordered
mode. Historical states 1-5 and schema-1 execution retain their existing paths;
do not migrate or synthesize configuration decisions for them. New versions must
be recognized by store, hook, direct diagnostic readers, archive readers and
projections together. The hook's state-6 support selects the same exact grants,
never a broader control-file permission.

Capabilities v4 declares the new pending kind, fixed actions, status/answer
schemas and `approveVerification` operation in addition to the existing set.
It preserves supported existing binding declarations and truthfully advertises
v2 support where implemented. Status v3 adds
`nextAction: answer_configuration_prerequisite` and a matching pending union
member containing the current request's public fields, eligible checkpoint
summary and bounded repair commands. It omits private hashes, raw continuation
authority, completed decision history and transaction internals.

The same runner entry handles interactive answers and these non-TTY grammars:

```text
banzai control answer [--no-resume] [--by <actor>]
banzai approve verification [--no-resume] [--by <actor>]
```

Both consume exactly one UTF-8 JSON stdin document. Keep the existing `control
answer` flag spelling/order rules; the approve-verification alias shares that
parser and rejects additional positional/unknown/repeated options. No implicit
Accept is attached to the word `approve`. Only configuration-answer v3 is valid
for the alias. Other answer schemas remain valid solely for their original kind.

The closed v3 document contains `schema: "banzai-agent-answer/v3"`,
`schemaVersion: 3`, `kind: "configuration_prerequisite"`, `runId`, `decisionId`,
`proposalId`, and `action: accept|edit|skip|cancel`. Only Edit additionally
requires `profile: { id, commands }`; its ID must equal the current proposed
addition's ID. Edit returns a freshly validated proposal and never applies it.
Command input uses `name`, `command`, `args`, `timeoutMs` and, for schema 3,
an optional `id` referring to one current proposal command. New commands omit
that ID; an unknown or duplicate supplied ID is invalid. The runner compares
definitions and assigns replacement/new IDs before presenting the revision.
Preserve existing `evidence`/`ignoreExplanatory` options; new commands default
to fresh/false. This input cannot change those policy-bearing fields or supply
an arbitrary new ID. The resulting canonical proposal uses full config fields.
Accept/Skip/Cancel cannot carry replacement command fields. The submitting human
must match the exact current identities; reject stale, duplicate and replayed
submissions before mutation. `--by` is attribution, not authentication or a
substitute for the current human's answer.

Keep the existing 64-KiB stdin bound. Bound profiles to the current schema-3
limits (50 profiles, 200 commands per profile, 200 argv items per command,
80-character IDs, 200-character name, 500-character executable, 4096-character argument,
positive timeout at most 86,400,000 ms); also bound the entire active proposal
to 64 KiB. Apply these new-input bounds without retroactively rejecting readable
legacy config. An oversized existing profile needs an actionable bounded error,
not truncation followed by approval. Reject malformed UTF-8/JSON, unknown fields,
unsafe controls, invalid IDs and absent required fields before mutation.

`--no-resume` records/applies a valid choice but schedules no process: completed
resolution retains its ready verification checkpoint for explicit resume. Edit
or pre-submission interruption always remains pending. Supervisors must negotiate
the new contract before handling this kind and relay only the exact current
human response; old clients must fail negotiation, never downcast to escalation.

### 7. Doctor, status and planning surfaces

Doctor v4 keeps top-level order `schema`, `schemaVersion`, `ready`,
`projectTypes`, `summary`, `checks`, existing summary fields, check order and
status enum. Every check has ordered fields `id`, `category`, `status`,
`message`, `fixes`, `roles`. `fixes` is an ordered list of closed
`{ action, documentation }` strings; `roles` is empty except for
`claude.instructions`. Human rendering uses these same fields, prefixing each
remedy with `Fix:` and including its documentation pointer. JSON uses two-space
indentation and a final newline. No failures means ready/exit 0; otherwise exit 1.

Every failed verification-category check and `executables.verification` has an
actual remedy and documentation pointer. Missing profile/substantive coverage
names each exact `banzai verify add <type>` in lexical type order and
`documentation/verification-examples.md`. Legacy schema, unreadable evidence and
missing executables name their actual repair; adding a profile must not claim
to fix file access, install dependencies or migrate schema 1. No new Fix-line
requirement applies to other categories. Report the actual config schema number.
For schema 3, use `Configuration uses schema version 3 and the supported contract version.`

For `claude.instructions`, `roles` is in planner/implementer/reviewer order.
Each closed entry contains `role`, `vendor`, `state`, `resourceIds`, `mismatched`,
`unavailable`, `fixes`. Keep existing bounded resource identifiers and add the
following per-role interpretation without exposing installed absolute paths:

| Role evidence | State / severity / remedy |
| --- | --- |
| Codex | `not_applicable`; informational, no remedies and no installed-Claude parity claim. |
| Scoped Claude, all applicable bytes match | `verified`; no remedies. |
| Confirmed applicable mismatch | `mismatch`; fail and refuse the affected call before attempt creation. Offer cause-applicable rebuild/update or explicit ambient choice. |
| Safely bounded comparison failure | `bounded_failure`; warning, never verified. Offer relevant rebuild/update or explicit ambient choice. |
| Ambient or unresolved scope | `unverifiable`; warning, scope-specific guidance only. Never advise rebuild/update for this cause. Already selected ambient mode is a reported limitation, not an instruction to select it again. |

Aggregate mismatch wins over bounded failure, which wins over unverifiable.
Ignore not-applicable roles in that precedence; all not-applicable or a mix of
verified and not-applicable roles is pass with truthful applicability wording.
Unavailable configuration skips parity; structural scope/hook refusal retains
precedence and cannot be downgraded. Preserve complete embedded instruction
delivery and real per-call checks. Omit routine Codex warning/remedy lines;
message deduplication must never hide changed evidence or a real refusal.

Before a new schema-2/3 run creates a model attempt, apply substantive-coverage
preflight. Missing coverage prints `Substantive verification coverage is
missing.` and the actual setup command; interactive entry offers configuration.
Decline/EOF/non-TTY leaves an actionable not-started result. Recheck under
ownership before launch. Effective bootstrap emits exactly once per invocation:
`Bootstrap mode: substantive verification coverage is deferred until project markers are created.`
This does not enforce every doctor finding or change schema-1 execution.

Pending status leads with `Configuration decision pending.`, the proposal and
Accept/Edit/Skip actions; Cancel remains available. Only afterward show
`Fix prerequisites, then run banzai resume.` with the relevant add/edit command,
removal's coverage preview route and the preserved checkpoint. For a live waiting
owner, first give the answer-there or pause/exit route from section 4. Name the
actual repair command; do not imply that rerunning status writes configuration.

Planning instructions and the planning prompt classify missing verification
configuration under `Human prerequisites`, with supported runner actions rather
than model tasks. Display that section from the exact plan bytes during both
interactive and `banzai approve plan` approval. Display/approval does not execute
or waive prerequisites and adds no additional approval gate.

Validate task text deterministically before offering a plan and again against
the exact approval bytes. Reject a task naming a normalized path at or under
`.banzai/` unless it is an exact bound artifact role writable by the task's
intended phase. Use stable error `PLAN_RUNNER_CONTROL_TASK`, task ID, bounded
path and a Human-prerequisites remedy. Normalize separators, absolute paths
within the repository and dot segments without evaluating shell syntax; reject
ambiguous unsafe control-path targets. Another work item's role or an entire
work-directory prefix is never authority. Explanatory references in Human
prerequisites are permitted. Preserve the spec-gate and post-call scope checks
as independent enforcement; a text guard is not a sandbox for arbitrary tools.

### 8. Review provenance, privacy and instruction authority

Snapshot v4 binds the existing approved scope, workspace and review evidence plus
`verificationMode` and a `configurationSetup` object containing coverage disposition
(`configured|bootstrap_deferred|skipped`), detected/uncovered types, current
resolution/skip references and runner config transaction references. Ordered
mode carries no fabricated reuse evidence; policy mode retains the existing
executed/reused provenance. Include these fields in the snapshot digest and
runner-rendered review v5, with validators tied to the exact binding and mode.
The skipped-round case follows section 3 rather than inventing complete policy
applicability. Its missing substantive coverage remains explicit in review.

Attribute `.banzai/config.json` only through actual before/after transaction
evidence. Freeze the confirmed runner delta and its operation ID separately
from model-authored source and pre-existing user changes; mixed authorship must
remain visible. A path match or final hash alone cannot label an entire config
diff runner-authored. Drift after a transaction requires renewed candidate
validation. Keep config in the review candidate's inspected scope without
adding it to model write grants or rewriting approved artifacts. Independent
review and triage remain required under their existing rules.

Security Assurance applies to untrusted command/display ingress, changed human
and writer authority, and explicit config replacement/removal. Require these
observable boundaries:

- Treat script metadata, proposal fields and displayed plan sections as inert
  untrusted data. Escape/reject terminal controls; direct argv execution never
  interpolates them into a shell command.
- Validate exact human/proposal identity, ownership and safe paths before any
  write. No model may invoke configuration mutation as a control-file bypass.
- Narrowly allow current proposal commands and bounded fixed source references
  in status v3 because the human needs to inspect the proposed action. Do not
  expose raw config, arbitrary source, private paths, environment values or
  completed proposal history. Never approve a silently truncated/redacted
  command different from the executable proposal; if a faithful safe preview
  cannot be shown, refuse and direct the human to edit that proposal.
- Keep transaction/evidence storage private and owner-bound. Diagnostics and
  events expose only their allow-listed fields. Frozen evaluation/KPI/context
  projections gain no raw proposal data, new fields or reinterpreted counters;
  unsupported coverage is reported through existing incomplete/unknown rules.

For instruction changes, use ADR-0044's explicit reviewed transition from the
current baseline. The allowed semantic scope is planning control-file exclusion
and Human prerequisites, the runner-originated configuration decision boundary,
guided command/continuation guidance, and supervisor negotiation/answer handling.
The hook's bounded state-6 recognition is also in scope, with the existing exact
phase grants and control-file refusal preserved.
The phase-A process-authority changes below are in this bounded instruction
scope as well. Apply ADR-0044 transitions to the affected baseline-covered
resources and skill skeletons; do not silently regenerate preserved expectations.
Keep all other duties, exact role grants, complete per-call delivery and the
original extraction baseline intact. The approved implementation plan must name
the finite resource/section changes; this ADR is not a catch-all rebaseline grant.

## Consequences

Empty roots gain a truthful deferred-coverage start; existing projects gain
guided setup and repair; configuration decisions retain implemented work and
plan approval. The cost is coordinated versioned readers, mutation ownership,
crash reconciliation and richer candidate provenance. Command display-name
changes deliberately cause identity churn and can affect an approved obligation;
the preview must make that consequence visible before confirmation.

Static inspection still cannot prove a command's behavior or sufficient coverage.
Explicit check execution can have the same project-defined side effects as the
configured commands. Old clients require control-v4 support for the new kind;
historical runs gain no synthetic new continuation rights. Noncooperating manual
editors do not honor runner locks, so drift checks remain necessary and detected
conflicts must stop publication/continuation rather than overwrite blindly.

Keep the description's delivery phases: A owns config/bootstrap, doctor contract,
typed decision, state/control/candidate boundaries, planning guard and the
matching delivered process authority; B owns
the wizard and verify command family; C owns parity/remedies, preflight/status,
approval display and maintained guidance. Dependent planning requires this ADR
Accepted. Phase scheduling may be separate, but shipping a producer without its
required readers/validators is not a valid partial delivery.

Phase A must reconcile delivered process authority with the new conditional
gate in the same implementation scope:

- Update `plugins/banzai/AGENTS.md` under Decision Gates, Progress Reports and
  the hook explanation: retain the five existing gate identities, add the
  runner-only `configuration_prerequisite` as the sixth conditional human gate,
  and reconcile both the gate count and `Nothing else blocks.` Clarify that
  this kind is raised by the runner, not a model-result gate or a new standalone
  skill gate; other phase boundaries still continue without routine confirmation.
- Update the Plan Approval Gate text in
  `plugins/banzai/skills/development-plan/SKILL.md` and the ADR Decision Gate text
  in `plugins/banzai/skills/architecture-decision/SKILL.md`. Replace the stale
  five-gate references and qualify the unconditional no-further-confirmation
  wording for the runner's configuration prerequisite. Preserve exact-bundle
  approval, ADR acceptance, consultation and review-triage authority.
- Update the matching five-gate statement in `plugins/banzai/hooks/README.md`;
  the hook remains a backstop and never becomes a human decision gate. Update
  the source `PROJECT_MANIFEST.md` human-decision facts only when implementation
  is verified, preserving its current-state-only convention.
- Verify the scaffold and approved-merge/layout-migration paths in
  `plugins/banzai/skills/project-manifest/SKILL.md` and its
  `references/layout-migration.md` against the revised packaged process source.
  Newly scaffolded and explicitly updated project guidance must retain the new
  gate and preserve project-specific rules. `plugins/banzai/PROJECT_MANIFEST.md`
  currently contains no gate count; any regenerated template or generated
  project manifest must remain consistent with `AGENTS.md` rather than restore
  the five-gate claim. Updating the plugin does not authorize overwriting an
  existing project's guidance or inventing a new automatic migration.

This proposal names those follow-ups; it does not implement them or amend an
installed/end-user project's authority before normal acceptance and plan approval.

## Compliance and Confirmation

The plan and reports must map each leaf requirement to its evidence owner.
Use focused contract and lifecycle fixtures, including the following matrices;
these are future checks, not results of this proposal:

| Guarantee | Required observable confirmation |
| --- | --- |
| Empty first strict task | With other prerequisites satisfied, init confirms bootstrap and doctor is ready; the plan contains no runner-control task; implementation creates package scripts; Accept saves only the proposed profile/bootstrap change; verification and independent review proceed without reimplementation or plan reset (AC01). |
| Existing/mixed roots and init order | Only existing Node scripts are offered; other types are editable examples; saved choices survive project-manifest client exit; no project process is spawned by init/add/edit/remove (AC02/15/16/29). |
| Doctor v4 | Bootstrap/stale/unreadable/mixed table, exact schema text, Fix-line scope, default and all-Codex parity, true mismatch precedence, pure human/JSON projection, zero filesystem/network/vendor mutation (AC03/17/19/20/21). |
| Pending lifecycle | Accept/Edit/Skip/Cancel, pause/signals/EOF, complete/incomplete external repair, proposal drift, no synthetic Accept, repeat-round Skip scope and unrelated-kind compatibility (AC06-13/23). |
| Writer authority | Active model/check/writer/waiting-UI exclusion, exact refusal route, unsafe/symlink targets, before/after/third-hash crash cases, once-only event/continuation, preserved unrelated bytes (AC04/11/12/33). |
| Command identity and obligations | Name-only and timeout-only replacement IDs; retained IDs for unchanged/reordered commands; no inherited evidence; removed-ID history; conservative fresh fallback for additions; explicit conflict for removed/replaced approved obligations (AC27/28/32). |
| ID collision evidence | Inject collisions in current config and the selected run's transaction ID lists; verify fresh allocation before preview, renewed confirmation after late collision, and refusal on unreadable required evidence. Verify inactive allocation reads no run history and unrelated runs/archives are not consulted. |
| Human control | Same semantics across UI/control/approve alias; exact-current input, bounded malformed/stale/replayed negatives, old-client negotiation refusal, no supervisor-synthesized answers (AC14/24). |
| Planning | Rejection before offer and approval for normalized control paths, other-work/runner-evidence roles; permitted exact phase roles and prerequisite references; exact approved section display (AC05/30). |
| Delivered process authority | Packaged AGENTS/skills/hook guidance and newly scaffolded or explicitly merged guidance agree on the five preserved gates plus the conditional runner configuration gate. No stale count, unconditional no-further-confirmation claim or model/standalone configuration-gate authority is introduced; project rules and unapproved existing files stay intact (FR4/FR15.2/FR32). |
| Execution and review | Verify-check all-results and interruption matrix versus runner fail-fast; truthful bootstrap/skip coverage; runner delta distinguished from prior user changes; no changed frozen exports or historical rewrites (AC18/25/31). |

Current/target differences must be explicit in the plan and maintained docs.
Implementation requires appropriate focused checks, build/distribution parity
and the repository's normal final verification on a coherent candidate, followed
by independent review and human triage. Label deterministic fixture evidence,
real local execution and installed/live-vendor observations separately. This
ADR authorizes no release, installation, external execution or publication.

## Lifecycle Links

- Supersedes: None in full.
- Proposed amendments, effective only after explicit acceptance:
  - [ADR-0006](./0006-versioned-verification-profiles.md): optional bootstrap in
    schemas 2/3, guided profile mutation and explicit check-all diagnostics;
    schema-1 compatibility and runner execution order/failure behavior remain.
  - [ADR-0007](./0007-project-type-verification-readiness.md): explicit bootstrap
    readiness and new-run coverage preflight; taxonomy and hygiene meaning stay.
  - [ADR-0008](./0008-read-only-doctor-diagnostics.md), as amended by
    [ADR-0040](./0040-project-adoption-preflight-and-interactive-setup.md) and
    [ADR-0042](./0042-runner-delivered-phase-instructions.md): doctor v4,
    per-role parity and cause-specific remedies; offline/read-only remains.
  - [ADR-0018](./0018-agent-supervised-banzai-cli-control.md) and
    [ADR-0031](./0031-interactive-decision-consultation.md): separate
    runner-originated configuration authority, control v4 and bounded active
    proposal disclosure; other human decisions retain their original meaning.
  - [ADR-0019](./0019-attempt-owned-review-candidates.md) and
    [ADR-0037](./0037-unified-runner-rendered-review-artifacts.md): exact runner
    config authorship and configuration coverage in versioned review evidence.
  - [ADR-0040](./0040-project-adoption-preflight-and-interactive-setup.md): save
    verification before optional client setup; narrowly permit explicit verify
    repair of a paused pending run without lifting general setup exclusion.
  - [ADR-0041](./0041-artifact-retention-and-publication-boundary.md) and
    [ADR-0043](./0043-proportionate-verification-evidence.md): state-6/binding-mode
    compatibility, private transaction evidence and changed-command identity;
    preserve historical bindings, evidence and approved obligation authority.
- Preserve ADR-0015 physical evidence; ADR-0017/0025/0038 approval/completion;
  ADR-0023/0024 retry/recovery; ADR-0027 exposure controls; ADR-0042 complete
  instruction delivery; ADR-0044 original baseline and bounded evolution.
- Superseded by: None. No accepted ADR body or manifest implementation state is
  changed by this proposal.
- Required lifecycle decision: `Accept ADR-0045`, reject with a reason, or request
  rework. Preparing or reviewing this document is not acceptance or plan approval.
- Accepted on 2026-09-14 after the owner's explicit acceptance of the revised
  proposal, whose SHA-256 was
  `e2539b70c1cf567b152088bc6c319336d26a3a7e086a5910bee7205b025b8532`.
  This lifecycle record supersedes proposal-stage pending-acceptance wording;
  the decision body is preserved. The listed amendments are accepted target
  intent, with implementation state Planned. The resulting plan bundle requires
  separate human approval before implementation.
