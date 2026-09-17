# ADR 0043: Proportionate Verification Evidence

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-09-12
- Owner: Banzai maintainers
- Decision makers: Project owner; explicitly accepted on 2026-09-12 after owner revisions.

## Related Artifacts

- Private strict work: `proportionate-verification-closure`; FR1-FR12 and
  FR16-FR18 define deterministic selection, truthful closure and measurement.
  Those requirements remain in the selected private work binding; the Context
  section below is their public architectural summary.
- Plan: not created; requires acceptance of this ADR and ADR-0044, followed by
  separate plan-bundle approval. Preparation authorizes no implementation.
- Authority: root `AGENTS.md`; `PROJECT_MANIFEST.md` sections 5, 6, 8 and 10;
  `packages/orchestrator/MODULES.md` verification, store, workflow and review.
- Related decisions: ADR-0003/0004/0006/0007/0013/0014/0015/0017/0023/0024/
  0025/0026/0028/0037/0038/0041/0042. ADR-0044 separately proposes
  instruction-baseline evolution.

## Context and Decision Drivers

Current profiles specify ordered commands. The runner executes them after a
phase; standalone guidance requires one final applicable suite. When runner
profiles omit a manifest obligation, the builder runs that suite. Reducing only
runner commands would leave this standalone and fallback cost unchanged.

Current verification ledger v1 records physical attempts. Its command digest
binds profile/command ordinals, executable, argv and timeout, but does not prove
unchanged source, dependencies or environment. The current result shape requires
execution timestamps, exit code and log paths. Neither can honestly represent
reuse as another successful execution. Completion validation proves ledger and
report consistency, not the semantic sufficiency of a test claim.

Decision question: How may Banzai discharge an explicitly reuse-permitted check
after an explanatory correction while preserving execution, approval and
completion meaning in both standalone and orchestrated use?

Choose a bounded local mechanism. Preserve conservative defaults, direct
execution, explicit project authority, physical provenance, independent review,
privacy and compatibility. A broad Markdown exemption or command-name heuristic
does not establish a dependency boundary.

## Options Considered

| Option | Benefits | Costs / disposition |
| --- | --- | --- |
| Keep executing all checks; improve prose only | No evidence-contract change | Does not eliminate redundant execution for eligible corrections; retain as fallback. |
| Let a skill label a change low risk, or exempt Markdown | Little machinery | Cannot enforce authority or distinguish executable instructions; reject. |
| Require a separate human exception for every closure | Exact human scope, low initial implementation cost | Repeated coordination and no reusable deterministic default; retain human decisions as authority, not the primary mechanism. |
| Shared local decision mechanism with opt-in policy and versioned evidence | Same rule in both paths; bounded provenance and reusable checks | Adds policy/ledger compatibility work; proposed choice. |
| General dependency graph, cross-run cache and remote results | Potentially broader reuse | Larger invalidation, trust and retention surface than demonstrated need; defer. |

## Decision

### 1. One owner and conservative policy

Adopt the shared local mechanism if accepted. Put the canonical builtin-only
decision and evidence logic in maintained plugin code with a typed orchestrator
facade, following the existing artifact-storage ownership pattern. The plugin
helper works without npm CLI installation; the runner calls the same rules.
Skills consume the result and never select an exemption themselves.

Introduce config schema 3 with an explicit opt-in verification policy alongside
the existing ordered profiles. Preserve profile-major and command-minor order,
direct executable plus argv, timeouts, redaction and stop-on-failure behavior.
The standalone entry reads the same versioned verification section; it need not
launch or configure a model. No config or no policy means existing checks.
Keep config v1/v2 readers and model-update byte preservation; no auto-migration.

Every check has a stable explicit identifier and defaults to `fresh`. Reuse is
available only for checks explicitly marked `equivalent_evidence`, with a
project-owned dependency boundary and explanatory-change rule. Identity binds
the policy schema/digest, full ordered profile descriptors, check ID, command
digest, input boundary and toolchain/environment evidence. No repository-specific
paths are built into reusable rules.

Represent new strict-plan verification obligations in one bounded versioned
inventory inside the approved plan bytes, `banzai-verification-obligations/v1`.
It references exact check identities and states `fresh` or
`equivalent_evidence`; it also records the approved completeness assertion.
The owner reviews that inventory with the plan. It does not replace binding
prose, accepted decisions or project rules. Ambiguity, omitted authority,
missing inventory or a prose/inventory contradiction denies reuse and follows
existing checks/escalation. Models cannot claim completeness after approval.
This narrowly amends ADR-0038's no-obligation-parser choice for new opt-in plans.

Strict approval binds the entire inventory with the normal bundle. Project
policy can require stronger checks; policy changes invalidate reuse even when
they leave existing approval hashes untouched. A human decision changing an
approved obligation requires ordinary reapproval, not an exception note. Lite
work uses the approved project policy without gaining a strict task ledger.
Historical plans retain all obligations and have no inferred reuse permission.

`release:check` remains an unconditional fresh composition. Neither a collection
of reused components nor an earlier release gate may be presented as a fresh
release gate. This package's final full release gate is mandatory.

### 2. Bounded eligibility and dependency evidence

Use an explicit inventory of explanatory whole files or delimited regions in
mixed documents. Region delimiters and the complement are protected inputs;
missing, duplicated, moved or changed boundaries deny eligibility. A declared
region must be informational, not a source of requirements, commands, schema,
prompts, grants or verification duties. Changed bytes outside declared regions
deny the explanatory exemption for the whole mixed change.

Human-reviewed project rules own that classification. Banzai verifies the exact
inventory, boundaries and delta; it does not prove prose is non-authoritative.
Skills, policies, phases, guidance, plans, prompts, release/publication rules,
import policies, extraction baselines, lockfiles, toolchain declarations,
tests, generated outputs and their inputs are protected. Mixed manifests need
explicitly separated explanatory regions; filename extension is irrelevant.
If a check reads changed explanatory content as an input, it executes unless
its approved dependency rule establishes an unchanged relevant projection.

Bound reuse to the same repository and selected work, with a directly referenced
successful physical origin captured under the supported policy. Do not import
old logs, reuse chains, other work, or historical success into eligibility.
Require all of the following:

- Exact check/command/policy/obligation identity, a supported complete terminal
  success, zero exit, no signal/failure, and intact referenced redacted logs.
  A later applicable failed or incomplete attempt prevents selecting an older
  success to hide the failure.
- A complete before/after inventory of relevant file bytes, kinds, modes and
  normalized paths. Include staged, unstaged and untracked inputs plus relevant
  ignored inputs explicitly covered by the project boundary. Compare additions,
  deletions and renames as path-set changes; do not trust rename similarity.
- An unchanged protected-input digest. Default to the entire source tree;
  narrower exclusions require project-owned dependency evidence. Bound reports
  may be excluded only where a check does not consume them; their authority and
  completion validity remain independently checked.
- Matching executable/toolchain identities and declared dependency closure,
  including installed dependencies when they can differ from lockfiles.
  A lockfile alone does not attest installed bytes. Sanitized process inputs
  and non-secret environment identities must be established. Network, clock,
  service, secret-dependent or other volatile inputs without sufficient stable
  evidence make the check non-reusable.
- Non-following, bounded filesystem reads. Reject escaping/unresolved symlinks,
  special files, unreadable or incompletely enumerated inputs. Symlinks within
  a proven closure require matching link and target identities; otherwise
  execute. Recheck for source drift before and after evidence capture and before
  reuse/application; unstable evidence cannot authorize success.

Record only bounded non-secret identities and allow-listed metadata. Never
record or hash secret values as an attempted substitute for dependency proof.
Unknown dependency completeness is a refusal, not a model-filled assumption.

### 3. Versioned decisions, physical attempts and storage

Introduce `banzai-verification-decision/v1` and verification ledger schema 2.
The decision binds work/round, current candidate, obligation/policy/input
identities and ordered `execute` or `reuse` actions with bounded reason codes.
An execution action is pending until a real process supplies terminal evidence;
a reuse action references an original physical attempt and its exact evidence
digest, never copied execution fields. A declined reuse can still lead to a
fresh successful check; malformed authority cannot silently become approval.

Extend the existing verification ledger with round decisions and applicability
records, retaining physical-attempt leaves and sequences separately. Use
`executed` and `reused` as applicability kinds; do not add `reused` to physical
attempt lifecycle. Attempt counts retain physical invocation attempts, including
failed process starts under their existing meaning; reuse contributes none.
Durations remain observed attempt evidence. Reuse records have a decision time,
no invented execution duration,
exit code, stdout/stderr or process identity. Original failure evidence remains.

The runner alone writes run-local evidence. For standalone use, extend the
artifact binding to `banzai-work-binding/v2` with one exact private
`verificationDirectory` role owned by the helper under the selected work.
Reuse the same ledger schema, validation and atomic-write primitives there;
acquire the existing exclusive work claim. Models have no arbitrary path grant
and never write run state. Preserve v1 bindings unchanged; reuse requires an
explicit new v2-capable work binding, not retrospective migration. This narrow
ADR-0041 extension is machine evidence, not a new prose-report trigger.

| Boundary | Proposed version / meaning |
| --- | --- |
| Configuration | Schema 3; opt-in policy and stable check identities; v1/v2 execution preserved. |
| Verification ledger | Schema 2; decisions/applicability plus physical leaves; v1 frozen. |
| Run state | Schema 5 for reuse-enabled new runs; separate current applicability, with physical metrics unchanged; old runs keep their path. |
| Work binding | v2 for explicitly enabled new standalone evidence; v1 preserved. |
| Review snapshot / rendered artifact | `banzai-review-snapshot/v3` and `banzai-feature-review/v4` carry executed/reused provenance; old snapshots/renderers remain version-bound. |
| Evaluation / KPI | Explicit opt-in `banzai-evaluation-export/v2` and `banzai-evaluation-kpi/v2` expose execution and reuse separately, with coverage. v1 defaults/fields/meanings remain; unsupported new evidence is partial under existing rules, never guessed success. |
| Context | Keep attempt/report v1: actual model invocations and bytes only. No new reuse metric or fabricated zero-byte invocation. |
| Phase/review result and completion | Preserve phase-result v3, review-result v2 and completion v1; applicability is runner evidence, not a model success field. |

Version selectors for new projections are explicit and fail closed; an old
consumer never silently decodes a new shape. The plan must inventory all exact
readers, schemas, rendering and archive/publication owners for these versions.

### 4. Enforcement, continuation and completion

| Existing owner | Required interaction |
| --- | --- |
| `verification.ts`, `config.ts`, `validation.ts` | Shared profile/policy ingress and deterministic decision validation; readiness remains advisory under ADR-0007. |
| `workflow.ts:executeVerification` | After existing approval/completion checks, resolve the decision under ownership before scheduling commands. Recheck applicability before review and terminal completion, including lite completion and zero-accepted triage. |
| `store.ts:beginVerificationAttempt`, `finishVerificationAttempt` | Allocate a physical identity only for execution; atomically persist decision/applicability records and preserve immutable origin links. |
| `workflow.ts:reconcileVerificationState`, retry/resume | Reconcile each decision/physical attempt once. Changed inputs invalidate applicability. Retry failure and interruption retain existing eligibility and real new-attempt links; they never become reuse. |
| `review-snapshot.ts`, `review-artifact.ts`, `prompts.ts` | Freeze complete applicable evidence into the versioned snapshot, render it truthfully and validate current identity at publication/application. Preserve independent review and full/delta rotation. |
| `plan-task-completion.ts`, `workflow.ts:revalidateTaskCompletion` | Keep exact approved task order/status, canonical projection and scope checks. Use the existing validated report-digest refresh when only report bytes change; a changed ledger still requires the complete ADR-0025 refresh. |
| Evaluation and KPI collectors/renderers; artifact readers | Read the versioned ledger directly through existing privacy boundaries; count physical attempts once and expose reuse only in the new projections. |
| Plugin helper and skills | Same decision code and bound storage; no runner impersonation. Missing capability/evidence retains existing final-suite duties. |

Persist decisions before acting and settle outcomes atomically. A crash before
process start yields no fabricated pass. A completed decision may be reconciled
without another process only after its origins and current dependencies still
validate. Never treat reuse as operator recovery authorization under
ADR-0023/0024 or as evidence that an interrupted mutable phase completed.

### 5. Small closures and focused context

Keep one compact closure record in the existing report owner: finding ID,
changed scope, decision reference, executed evidence, reused origin references
and limitations. Other required reports link to it and update affected claims.
Use explicit categories: current executed, current applicable reused,
historical, failed, unavailable and pending. Do not relabel unchanged historical
task sections as new execution or copy totals into every report.

Retain the complete report claim sweep as consistency inspection. Its outcome
can be an affected-claim correction or scoped historical reference; inspection
does not itself require a command. Preserve all report triggers, exact roles,
full canonical completion projection when required, and achievement escalation.
No ad hoc bulk relabeling is necessary for a bounded closure.

Resolution review receives the accepted finding, exact source/report delta,
current relevant authority, validated decision and origin evidence. Preserve
ADR-0014 triage and ADR-0037 acknowledgment/rotation; existing rediscovery cases
remain the only basis to reopen scope. A concrete unresolved concern or stale
evidence justifies extra reads or verification. Do not include builder transcripts.

Within the same work/session, check relevant identities before reusing established
context. Missing or changed content requires appropriate reads; unverified
summaries do not substitute. Preserve ADR-0042's complete runner payload on every
call and ADR-0028's byte accounting. Reduced evidence duplication is not claimed
as instruction elision or a proof of model understanding.

## Consequences

Eligible explanatory closures avoid checks whose assurance remains valid;
test changes and uncertain scopes retain their suites. Reporting changes can
benefit both cases even when no command is reusable. The cost is explicit
policy authoring, dependency evidence and dual contract readers. A declaration
can still be wrong; independent review assesses its material adequacy.

No new runtime dependency, service, cross-work cache or automatic upgrade is
required. Fresh checks remain a safe fallback. Execution savings may be small
where environmental closure cannot be established; do not relax evidence to
achieve a benchmark result.

## Compliance and Confirmation

Use a shared behavior matrix: eligible explanatory delta; executable Markdown,
test, obligation, generated-input, dependency and unknown/mixed negatives;
invalid origins and later failures; mandatory fresh checks; crash/retry/resume;
projection privacy/versions; unchanged legacy routes; bounded report delta and
independent accepted-finding handoff. Test observable guarantees, not prose.

Benchmark matched explanatory and one-unit-test closure shapes on disposable
copies. Pin source/toolchain/policy and seeded physical evidence independently
for each arm; count seeding separately. Legacy obligations remain fresh in both
arms. An opt-in-policy comparison must label the policy difference explicitly,
not claim that historical checks were unnecessary. Record invocation counts,
command sets, report line deltas, reviewer input bytes and observed command
time. Use shared fixtures/injected processes for deterministic scheduling
assertions and separately label any real command measurements. Never sum
concurrent test durations into gate time or infer reasoning/human time.

The one-unit-test case must execute the applicable suite; only its report and
handoff overhead is expected to shrink. No numeric test quota, universal report
line cap or wall-clock pass threshold is introduced. Final implementation uses
focused checks, explicit build and one valid full release gate on a coherent
disposable candidate, followed by independent review and human triage.

## Lifecycle Links

- Narrowly amended by [ADR-0047](./0047-runner-owned-completion-projection.md),
  accepted 2026-09-15, section 7: new-protocol report-digest refresh moves from
  section 4 revalidation to authorized publication; section 3 retains ledger v1
  with rendered v2 and versioned summary/provenance. Verification authority,
  applicability, legacy refresh and frozen evaluation semantics remain binding.

- Amended by [ADR-0045](./0045-guided-verification-setup.md), accepted
  2026-09-14: state-6 verification modes, guided command-ID replacement and
  explicit skipped-round coverage. Preserve historical evidence, policy and
  approved-obligation authority. Implementation of this amendment is Planned.

- Supersedes: None in full.
- Proposed amendments: ADR-0006 profiles/config; ADR-0015 ledger identities;
  ADR-0013 final-suite ownership only for explicitly eligible reuse;
  ADR-0038 opt-in obligation inventory; ADR-0037 snapshot/rendered evidence;
  ADR-0041 bound standalone machine evidence; ADR-0003 and ADR-0026 opt-in
  evaluation export and KPI v2 projections, with v1 meanings unchanged.
  Existing bodies stay immutable.
- Preserves ADR-0004 evaluation privacy boundary, ADR-0007 readiness, ADR-0014
  closure, ADR-0017/0025 completion, ADR-0023/0024 recovery, ADR-0028 context
  and ADR-0042 full instruction delivery.
- Superseded by: None. No lifecycle changes apply before explicit acceptance.
- Accepted on 2026-09-12 for further planning. The owner-revised proposal had
  SHA-256 `c4d1a221cc49a352dc2f1e675155d4d62053007dbac54c4ba1d5b2407f1f8c08`
  before this lifecycle update. This record supersedes proposal-stage
  pending-acceptance wording; the decision body is preserved. Implementation
  state: Planned. Separate approval of the resulting plan bundle is required.
