# ADR 0047: Runner-Owned Completion Projection

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-09-15
- Owner: Banzai maintainers
- Decision makers: Repository owner, explicit `Accept ADR-0047` on 2026-09-15.
- Rework: 2026-09-15, following independent proposal review and the owner's
  request to address its findings. Independent resolution review passed on
  2026-09-15, resolving R1-F1 through R1-F7 without new findings.
- Accepted proposal SHA-256:
  `fc4d3a54e63c7b3931fb5da8b6f247abc425a0fa10baaf698765115d979cd31a`.
- Lifecycle note: proposal-era pending wording below is retained as reviewed
  history. This metadata records its acceptance and completed resolution review.
  Implementation is Planned and still requires the separate plan-bundle gate.

## Related Artifacts

- Private strict work: `runner-owned-completion-projection`; requirements and
  read-only diagnosis remain in its selected work binding. No dependent plan yet.
- [Project manifest](../../PROJECT_MANIFEST.md), sections 5, 6, 8 and 10;
  [module reference](../../packages/orchestrator/MODULES.md).
- [ADR-0017](./0017-versioned-plan-task-completion-ledger.md),
  [ADR-0025](./0025-fix-authored-completion-ledger-refresh.md): canonical ledger,
  projection parity and fix refresh.
- [ADR-0023](./0023-durable-terminal-attempt-checkpoints.md),
  [ADR-0024](./0024-operator-authorized-prerequisite-blocked-fix-recovery.md):
  terminal proof and explicit partial-work recovery.
- [ADR-0037](./0037-unified-runner-rendered-review-artifacts.md),
  [ADR-0038](./0038-explicit-plan-authority.md): independent frozen review and
  exact approved obligations.
- [ADR-0041](./0041-artifact-retention-and-publication-boundary.md), section 4;
  [ADR-0042](./0042-runner-delivered-phase-instructions.md): structured evidence
  ownership and the explicitly deferred completion-rendering follow-up.
- [ADR-0043](./0043-proportionate-verification-evidence.md),
  [ADR-0044](./0044-instruction-baseline-evolution.md),
  [ADR-0045](./0045-guided-verification-setup.md): verification, instruction
  evolution and configuration prerequisites. Section 7 explicitly narrows
  ADR-0043's report-digest refresh placement; verification authority remains.

## Context and Decision Drivers

Decision question: how should the runner publish the completion projection from
validated model assertions without depending on model-authored Markdown, while
preserving report integrity, historical semantics and recovery authority?

In current 2.5.0 source, taskCompletion is canonical but the model also writes
its Markdown table. validatePlanTaskCompletion parses that table and compares
records before validating evidence files. A normally returned implementation can
therefore fail as PLAN_TASK_COMPLETION_INVALID solely because its table header
differs from the exact grammar. Prompts already request exact copies, escaping
and a final reread. More instructions cannot remove this second authorship
boundary. An existing deterministic renderer is used for expected projections
and fixtures, but does not publish the model's report.

ADR-0017 explicitly makes missing/non-equivalent model projection fatal;
ADR-0025 explicitly says the runner never writes report bytes. ADR-0042 retained
those rules. Moving ownership is an architectural amendment, not a parser fix.

Current terminal checkpoints preserve the vendor result before completeAttempt.
Live implementation, fix refresh and terminal reconciliation each invoke
completion validation. Revalidation also protects verification, review, pass,
triage, status and recovery. Inserting a write into the shared validator would
make read-only consumers mutate evidence and obscure crash windows.

Drivers: deterministic formal structure, one canonical assertion, independent
substantive verification, bounded file ownership, immutable provenance, explicit
compatibility and no extra formatting-only model calls.

## Options Considered

| Option | Benefit | Cost / disposition |
| --- | --- | --- |
| More prompt text, repair calls or accepted header aliases | Small local change | Retains duplicate authorship and model-dependent formatting; rejected as the solution. |
| Remove the completion section and use ledger JSON only | Removes table dependency and publication writes | Changes the durable report/standalone-reader contract and loses the requested readable section; rejected for this scope. |
| Runner generates the entire implementation and test reports | Gives the runner all document structure | Requires structured narrative, assurance and deviation contracts beyond completion; defer. |
| Runner validates claims and publishes only the completion region | Retains readable reports and current engineering roles; removes duplicate machine-data authorship | Requires explicit region ownership, publication provenance and recovery routing; proposed choice. |
| Runner publishes a separate rendered completion artifact referenced by the narrative report | Keeps readable structured evidence in one runner-owned file; avoids scanning/replacing a model-owned region and its gap-target overlap | Requires a new artifact role/binding contract, retention and archive closure, standalone-reader discovery and review-snapshot inputs. Guaranteeing a reference in the report still needs a runner-owned insertion or a changed report contract. Reject for this scope: the requested canonical section stays in the implementation report, with the bounded ownership and refusal routes below. |

## Decision

### 1. Keep claims separate from runner facts

Adopt runner publication of the report's completion region if accepted. The
separate rendered artifact is a viable alternative, not equivalent to JSON-only
output; its different report/role contract is deliberately not selected here.
The model owns the structured task claims,
evidence descriptions, gaps, narrative implementation/test reports and scoped
engineering changes. The runner owns structural and authority validation,
completion encoding, publication and lifecycle. Actual verification results and
independent reviewer conclusions retain their existing owners.

Keep the ledger's approved task coverage/order, statuses, field bounds, evidence
and gap meanings. Schema validity and file existence are necessary evidence
checks, not proof that a requirement was implemented. Report-only evidence
remains admissible only under the existing exact-report exception; do not
silently tighten or broaden that rule here.

### 2. Separate acceptance from read-only validation

Use one explicit mutable acceptance/publication path for strict implementation
and accepted-finding fixes, shared by live execution and authorized terminal
reconciliation. Keep completion revalidation read-only. Preserve the existing
schedule before verification, review, pass and zero-accepted triage completion.

For a result claiming successful phase completion (`outcome=completed` and
`gate=null`), the required ordering is:

1. **Capture:** retain the original decoded result, vendor terminal evidence,
   report input bytes and current workspace/authority identities. This records
   what the model returned; it is not completion acceptance.
2. **Validate:** check phase/result contracts, task coverage/order/status/gaps,
   exact approved bundle and plan, base, work binding, required safe report
   files, actual changed surface, phase grants and accepted-finding scope.
   Resolve the owned region first. Any gap reference must target a heading in
   the exact narrative bytes preserved outside that region, as defined in
   section 3. Reject before any canonical report replacement.
3. **Render:** deterministically compose the completion region from the
   validated ledger and preserved narrative. Serialize JSON and encode literal
   Markdown/HTML metacharacters as numeric character references in raw table
   cells using the new grammar defined in section 3. Validate the round trip
   and exact projection identity using the same admitted ledger values.
4. **Publish:** persist immutable candidate/provenance, recheck authority and
   expected report/workspace bytes under runner/work ownership, conditionally
   replace only the exact implementation-report destination atomically, then
   record its published identity. Hashes bind the final report bytes.
5. **Apply:** persist the canonical source summary and completion accounting
   once, then permit the existing verification prerequisite and verification
   path. Independent review follows actual required verification.

#### Outcome and gate routing

Apply these routes to live results, retries and terminal reconciliation alike.
A safely decoded stop result is evidence of a model-reported stop, not an
assertion of successful completion. Completion checks cannot replace that stop
with a report-repair gate. Invalid phase identity, unparseable result envelopes,
unauthorized writes and invalid authority retain their existing safety failures;
this rule grants no authority from an untrusted gate string.
Decode the stop envelope independently of completion-payload checks: malformed
taskCompletion fields are retained as unaccepted diagnostics when the phase,
outcome, gate and required decision/finding identities are safely established.
They must not cause a valid stop envelope to be discarded as a missing result.

| Result | Capture and validation | Render / publish | Apply and canonical source |
| --- | --- | --- | --- |
| Strict implementation: completed, no gate | Capture required inputs; run every completion, evidence, report, authority and scope check above. | Required after validation. | Complete the attempt and update the canonical summary only after publication; proceed to the verification prerequisite. |
| Accepted-finding fix: completed, no gate, non-null ledger | Same full validation plus exact accepted scope, resolved finding IDs and all tasks completed. | Required for the replacement ledger. | Update the canonical ledger source to this fix only after publication; verify and re-review. |
| Accepted-finding fix: completed, no gate, null ledger | Validate the prior canonical assertion and current evidence against the unchanged approved tasks, plus current report inputs and accepted scope. | Required from that retained ledger. | Update publication/report identities; retain the original ledger author. Verify and re-review. |
| Strict implementation: blocked, no gate | Capture result/terminal proof and safely available report inputs, recording absent/unsafe reports without following unsafe paths. Check the result envelope, authority and phase scope. Check ledger shape as a diagnostic, not completion acceptance. | Neither runs. Missing reports, table ambiguity or inadmissible completion claims are retained diagnostics and never substitute another stop. | Record the model attempt as completed with its blocked result; run stays blocked from implementing. Do not replace the canonical source or summary. |
| Implementation or fix: needs_human_decision, gate=escalation | Same stop-result capture and authority/scope checks; retain structured completion and gap diagnostics. For fix, validate finding identities against triage. | Neither runs, even if complete reports happen to exist. | Record the completed model attempt and apply the existing escalation decision, including its approval invalidation/replanning semantics. Do not promote a completion source. |
| Accepted-finding fix: blocked, no gate, with or without resolvedFindingIds | Same stop-result capture. Validate result/finding identities and remaining accepted scope; ledger/report problems are diagnostic only. | Neither runs; no implicit refresh from a blocked fix. | Record a completed blocked fix and its partial accepted progress; retain the prior canonical source. Preserve ADR-0024 recovery only when its normal eligibility checks hold. No verification or re-review starts. |

An incomplete/blocked task in an outcome=completed result remains a fatal
completion contradiction; it does not acquire the stop-result exception. On
valid blocked/escalating envelopes, missing reports or completion diagnostics
never suppress, replace or downgrade the original blocked/escalation decision.
Persist that decision independently of optional report capture; inability to
persist any durable result still fails closed as a storage failure, never as
invented completion.

Reports left by stop results are retained model output, not newly published
completion evidence. A missing region stays missing; an old or model-written
region cannot be reported as currently valid without its matching publication
proof. Keep the prior canonical record as historical evidence, while current
completion is pending/invalid if its report or workspace no longer matches.
Neither status nor recovery inspection rewrites it. A later authorized successful
attempt must publish its own validated projection. This deliberately removes
implicit canonical refresh on non-completed fix results under the amendment to
ADR-0025 in section 7.

Blocked implementation retains the existing cancellation route. A blocked fix
exposes recover only if ADR-0024's source, prerequisite, current completion,
approval and scope checks hold; missing current report evidence can make that
route unavailable without changing the stored blocked result. Status explains
that prerequisite and retains cancel. Escalation exposes the existing human
answer/replanning route. There is no automatic retry of any model-reported stop.
Model-attempt completion accounting for these rows means the model returned and
its stop was applied, never that approved tasks or verification succeeded.

Candidate publication and state/events are not a multi-file atomic transaction.
Their durable identities and reconciliation rules, rather than write order
alone, must make every interruption safe. A successful render is never a valid
completion checkpoint by itself.

### 3. Own a bounded region, not arbitrary prose

The input report may omit the completion region. No placeholder or table is a
model prerequisite. Preserve bytes outside the selected region; use a bounded,
fence-aware section scanner to identify top-level report sections without
parsing model table cells. Ignore headings inside code fences.

When no region exists, append the generated section with runner-owned delimiters.
When exactly one unambiguous Plan Task Completion section exists, replace only
that section. Its old header, JSON, statuses or details confer no authority and
need not parse. Duplicate/overlapping regions, malformed delimiters or an
unclosed fence that prevents safe ownership must fail completion input validation
before overwrite. For a result claiming completed work, this is the structural
input refusal routed to evidence-repair retry in section 4. It is not a request
for the model to format runner-generated JSON. Stop results follow section 2
without replacing their blocked/escalation decision. Do not guess where narrative
ends.

Define gap targets over exactly the report bytes that publication preserves:
outside the completion region in the implementation report, or in the unchanged
test-report input. Require a unique level 2-6 narrative heading outside fences;
headings inside the removed region, inside fenced examples or created by the
renderer are not eligible. Validate before replacement and recheck against the
final candidate. A gap aimed at a nested heading in the replaced completion
section is invalid even if the input's heading search would find it. Route it
as an invalid-gap completion rejection for a completion candidate; for a stop
result retain the invalid-gap diagnostic without suppressing its gate. Never
move or recreate the heading to make a false reference valid. This rule also
governs diagnostic validation of non-completed ledgers, which are not published.

New generated regions use a new grammar, banzai-plan-task-completion/v2, with
runner-owned delimiters. Keep the legacy v1 renderer/parser and its interpretation
for historical evidence. Retaining v1 encoding behind a new ownership marker is
not compliant with this decision.

Use raw JSON table cells, not Markdown code spans, code fences or HTML containers.
The runner serializes JSON first, then represents every ASCII punctuation
character in the JSON cells, including ampersands, quotes, backslashes, brackets,
pipes, angle brackets, asterisks, underscores and backticks, as a numeric character
reference. Spaces, letters, digits and allowed Unicode retain their literal
values. Generated table syntax remains outside those encoded cells. Decode
references exactly once before JSON parsing; never recursively expand an entity
string supplied by the model. The dependent plan pins the canonical reference
spelling and delimiters, with tests for the selected Markdown renderer.

This encoding must make cell text inert when rendered, not merely round-trip
through the machine decoder: model text cannot create links, emphasis, code,
images or HTML nodes. Preserve literal entity strings and all admitted field
values. Retain field-bound failures instead of normalizing invalid input.

Models may still physically write their granted report files. Region ownership
is enforced by runner publication and later integrity checks, not a claim that
the tool sandbox prevents every byte edit. Read-only status/review never removes
or repairs a changed region.

### 4. Make publication attempt-owned and recoverable

Persist an explicit versioned publication protocol identity before every new
strict implementation or accepted-finding fix invocation, including retry and
recovery descendants. Bind it to terminal evidence and record the
exact run, attempt, kind, result/ledger digest, approved bundle/task set, work
binding, accepted scope, report input hashes, non-report workspace identity,
candidate bytes/hash and canonical destination. Keep immutable original report
input, including the required test report, and result evidence. Stop results
retain available inputs and explicit absence as section 2 specifies. Retain the
previous canonical source when a new candidate is rejected, without presenting
its historical validation as current validity after drift.

The publication receipt distinguishes the attempt writing a report from the
attempt that authored its canonical ledger. Persisted summary/provenance readers
must not conflate these identities, particularly for null-ledger fixes.

Under unchanged authority, reconciliation accepts exactly these states:

| Durable evidence and destination | Permitted result |
| --- | --- |
| Valid terminal/input evidence; no candidate yet; input hashes still match | Validate and derive the same candidate; continue publication without another model call. |
| Valid prepared candidate; destination still equals recorded input | Revalidate non-report inputs and conditionally publish that candidate. |
| Valid prepared candidate; destination already equals its exact output | Complete receipt/state/events once; do not write or invoke the model again. |
| Applied receipt and matching source/summary | Read-only revalidation; no duplicate accounting. |
| Missing authority, conflicting candidate/result, unexpected destination or unrelated workspace drift | Block; never infer ownership from matching section text alone. |

The recorded pre/post report identities explain only the runner's bounded write.
They cannot mask model edits outside scope or later user/source changes. Capture
terminal inputs durably before publication so a crash before candidate creation
does not invite inference from a now-changed workspace. Keep cancellation and
terminal-state ownership checks around publication/application.

#### Refusal, persistence and operator exits

For a completion-claim result with durable terminal proof, introduce the explicit
model-attempt lifecycle status pending_application in versioned persistence.
It means the vendor has returned but the runner has not accepted/applied that
result. A captured terminal result whose candidate or receipt is not yet durable
also reconciles into this state, not into unknown partial model work. It becomes
completed only after verified publication and application, or failed on a final
input rejection. Stop results use section 2 instead of this publication state.

| Refusal class | Persisted attempt and run state | Status/control next action and recovery rule |
| --- | --- | --- |
| Missing/invalid completion evidence or structurally ambiguous model report input | Attempt failed, with PLAN_TASK_COMPLETION_INVALID and a bounded violation; run blocked from implementing or fixing. Retain rejected result, input and prior canonical source. | retry creates one linked evidence-repair successor under the unchanged approved/triaged scope. It may repair ambiguous narrative ownership or evidence, but never needs to author the generated table. Existing plan-bundle violations reroute to planning and a new approval. Resume never promotes the rejected attempt. |
| Transient runner capture/candidate/rename/receipt/application I/O failure with durable terminal proof | Attempt pending_application, run blocked from implementing or fixing, with a distinct publication-I/O diagnostic and last durable stage. | resume revalidates inputs and retries only deterministic publication/application for the same attempt. No model call, new attempt or operator partial-work recovery; cancel remains available. |
| Report/workspace/base/configuration/approval drift during publication or reconciliation | Attempt pending_application, run blocked from implementing or fixing, with a distinct publication-drift diagnostic. No claim is promoted. | Status/control expose cancel while drift persists, and identify the manual prerequisite: restore the exact recorded input or proven output and matching authority, then resume. Use existing banzai restore only for the approved bundle it owns; other restoration is operator-managed from retained evidence. Once read-only inspection confirms a match, next action becomes resume. Never accept a changed baseline via resume or recover. |
| Corrupt, conflicting or irretrievably missing publication/terminal evidence; deterministic runner rendering defect | Attempt pending_application, run blocked from implementing or fixing, with a bounded publication-integrity diagnostic; preserve all surviving proof. | cancel is the legal exit while integrity cannot be established. A runner fix may permit resume only when intact retained proof can be revalidated and deterministically reproduced. Do not ask a model to repair runner output or allow edited machine evidence to count as repair. |

No arbitrary current file bytes may replace the recorded input in the drift
route. If the operator cannot safely restore those exact identities, cancellation
and a separately authorized new run are the exit; manual state editing is never
required or a supported remedy. Missing terminal proof retains the existing
ADR-0023 recovery eligibility checks, including refusal of conflicting proof,
and never falls back to mutable replay. A storage failure that prevents updating
state leaves the prior durable stage; resumed inspection derives the same bounded
route from intact terminal/publication evidence instead of assuming success.
The resumable I/O route requires retained proof of the relevant input identities:
an uncaptured hash or original is unknown, not an unchanged input. If a failed
capture leaves those identities irretrievably unavailable, use the integrity
route rather than reconstructing them from whatever files exist on resume.

Persist model usage/duration once per physical attempt as soon as it is captured.
pending_application has no completed-attempt increment and contributes no task,
verification or review success. A final input rejection contributes one failed
attempt; successful application contributes one completed attempt. Record typed
input-rejection or publication-refusal events and a publication-applied event,
keyed by attempt, stage and proof identity. Repeated inspection/resume of the
same durable refusal adds no duplicate event, usage or completion. Preserve prior
refusal events after successful reconciliation; do not relabel them model
process failures or erase them from history. Frozen evaluation exposes unsupported
pending evidence as partial/unknown, never as failed or completed by guesswork;
readers that support it count the physical invocation and known usage once.

Reuse existing CLI resume, retry, restore, cancel and explicitly authorized
recover operations. The closed control operation set does not change: control
status must project the same semantic next action/eligibility as the CLI; it
does not turn resume/retry into new control mutations. Version any changed
status/capability payload semantics before release and update its declared
consumers. Exact schema numbers and closed diagnostic/event fields belong in
the plan; the lifecycle, accounting and allowed exits above are decided here.

### 5. Preserve fix, retry and recovery authority

For a completed, ungated accepted-finding fix with a non-null ledger, validate
the complete replacement against the same approved task set/order and allowed
surface. A completed fix
still requires every task completed. Publish its generated section before
updating canonical sourceAttemptKind to fix and before verification/re-review.
Blocked/escalating fixes use section 2's separate stop route. Their non-null
ledgers remain unpromoted model claims; no report publication is required to
preserve their stop, resolved IDs or prerequisite scope.

For a completed, ungated fix with taskCompletion=null, retain the previous
canonical ledger and source attempt. Revalidate that source against the current
authorized tree and reports, and project it into the fix's current report
narrative through a new publication
receipt. An absent table or malformed cells within an unambiguous region cannot
require a model retry; structural ownership ambiguity uses the explicit input
repair route. Source/approval drift and invalid evidence still block. Narrative
changes may refresh report hashes only under this authorized fix publication,
never by a read-only consumer or by silent status repair.

A status downgrade is not a refresh of achievement. Retain the existing rule:
complete missing work only within accepted-finding scope; otherwise record the
contradiction, leave the canonical achievement claim unpromoted, exclude the
finding from resolvedFindingIds and escalate. Independent review checks
semantic staleness even when the structured values remain mechanically valid.

Evidence-invalid implementation/fix retries create a unique successor with a
durable retryOf predecessor link to the exact rejected attempt and the same
approved/triaged authority. This adds persisted lineage beyond today's repair
prompt reference; prompt text alone does not satisfy it. Bind the link before
invocation, validate predecessor kind/run/authority and deduplicate interrupted
successor creation. Retain the failed source. Existing planning rerouting for
approval/task-set failures remains. Historical format-invalid attempts stay
invalid; every explicitly requested new successor uses the new publication
protocol. Repeated resume must not retroactively repair the source.

Operator-authorized partial-work recovery and completed prerequisite-blocked
fix recovery keep their exact authorization identities, no-recursive-chain
rules and remaining accepted scope. Never use publication proof to declare
unknown partial model work complete or to execute prerequisite commands.

### 6. Route compatibility by evidence, not installed version

Every strict implementation and accepted-finding fix attempt newly created by
the implementation of this decision records the new protocol before invocation.
This includes ordinary fixes, evidence-repair retries and both recovery classes
inside runs whose ancestors are legacy. There is no legacy/new selector for
new attempts. Planning, selection, review and lite attempts retain their own
protocols; they do not manufacture strict completion ownership.

An absent marker on an already persisted old attempt means legacy ownership,
not a default opt-in. Existing in-flight or terminal old attempts reconcile under
their recorded legacy contract; only a legitimately created successor crosses
the boundary. Select reading/revalidation/reconciliation by persisted identity,
not the currently installed CLI version or report appearance. Unsupported or
malformed markers fail closed; a missing required marker on a new attempt is
malformed evidence, not permission for legacy fallback. Preserve ancestors,
approved bundles and prior review snapshots. Recovery descendants retain their
existing recoveryOf/authorization links; evidence-repair successors gain the
retryOf link above, including when the predecessor has no new protocol marker.

Keep existing structured task ledger values and the phase-result payload when
its assertion semantics are unchanged. Introduce versioned runner persistence
for changed attempt/publication/checkpoint/summary semantics, and version any
consumer snapshot that cannot represent that provenance truthfully. The plan
must inventory every affected reader, including generated artifact readers,
archive/restore closure, standalone feature-status and feature-review readers of
runner-produced reports, status, review, evaluation and recovery, and pin concrete
schemas before implementation. Referenced input/candidate bytes are required
authority closure under ADR-0041 retention; they are not unreferenced disposable
diagnostics. Older CLIs need not execute new protocols; they must not mistake
them for old success evidence.

Preserve frozen evaluation/KPI/context field and privacy meanings. Equivalent
old inputs retain equivalent output; unsupported new evidence is explicitly
partial/unknown where a frozen consumer cannot describe it. Do not add private
candidate/report content to public diagnostics or exports. Keep standalone
plugin report/checkbox semantics and lite workflows unchanged.

### 7. Amend instructions and authority narrowly

Apply these narrow amendments only to the new protocol. Keep accepted bodies
immutable and their legacy meanings intact. On acceptance, add reciprocal
lifecycle metadata to every ADR in this table; none is superseded in full.

| Accepted decision and narrowed clause | New-protocol amendment | Preserved authority |
| --- | --- | --- |
| ADR-0017: model-authored report parity, gap targets and completion-only repair retry | Runner publishes v2 completion after validation. Gap targets must be unique preserved narrative headings outside fences and the replaced region. Structural report-input ambiguity joins completion-input repair eligibility. Safely decoded blocked/escalating envelopes retain their stop even when completion diagnostics fail. Implementation/fix retries gain durable predecessor links. | Approved task coverage/order, evidence-file admissibility, completed-outcome enforcement, immutable approval and historical attempts, revalidation schedule and substantive review. |
| ADR-0025: regenerated model projection, runner-never-writes rule and non-null fix refresh | Runner owns publication. Only completed ungated fixes promote refreshed completion; blocked/escalating ledgers remain unpromoted. Null-ledger completed fixes publish with separate ledger-author and report-publisher identities. | Same approved task set/order, accepted scope, no achievement downgrade disguised as refresh, one canonical ledger and escalation truth channel. |
| ADR-0023: recovery result must return ledger and report projection; terminal promotion directly to completed | New strict recovery returns claims and narrative; runner generates the projection. Proven model completion can remain pending_application until publication succeeds; deterministic resume uses the explicit refusal routes and once-only accounting in section 4. | Durable terminal proof, exact authority checks, no mutable replay, explicit operator authorization for unknown partial work, source preservation and downstream verification/review. |
| ADR-0042 section 7 artifact-format equivalence and section 8 preserved completion ledger/projection duties | Implement its expressly deferred completion follow-up (Consequences). New runner reports use v2 regions; update runner instructions and version-aware standalone readers without requiring standalone authors to emit them. | Deterministic phase delivery, role/path grants, standalone workflow duties, historical resource evidence and vendor independence. |
| ADR-0043 section 4 completion interaction and section 3 completion-v1 preservation | For new completion publication only, move report-digest refresh out of verification-start revalidation into authorized publication/application. Keep structured ledger v1 but use rendered grammar v2 and versioned publication/summary provenance. | Verification policy, fresh/reused physical evidence, applicability, current-source checks, original legacy report refresh and frozen evaluation semantics. |

ADR-0024 source/remaining-scope eligibility and ADR-0037 independent review remain
unchanged. A blocked result's retained partial progress is not a publication
receipt, cannot bypass recovery prerequisites and cannot become a reviewed pass.

Update implementation/fix/retry/recovery prompts and applicable embedded
phase/guidance/policy text together: the model returns claims once and writes
narrative reports, while the runner supplies their completion region. Preserve
standalone responsibilities explicitly. Remove conflicting duplication duties
from the new runner path instead of relying on prompt precedence.

Use ADR-0044's reviewed baseline transition for changed instruction obligations;
preserve the original extraction root. Generate phase resources, artifact readers
where changed, CLI bundle and source map explicitly before read-only gates.
Maintain documentation and publication classification without publishing private
diagnostics or changing release-train versions.

## Consequences

Positive: model table formatting no longer controls valid new phase transitions;
completion data has one model author; readable reports and strict downstream
checks remain; publication interruptions need no formatting model call.

Costs: immutable report inputs/candidates add local storage; mixed historical
protocols need deliberate reader routing; canonical report publication becomes
a lifecycle responsibility and adds pending_application evidence; structural
report ambiguity can still require a scoped narrative-input retry, although exact
table headers/JSON no longer do. Blocked/escalating results retain their stop
without a new projection; missing current reports can keep a blocked fix outside
normal recovery eligibility. Corrupt proof cannot be salvaged by model repair.

Limits: deterministic rendering proves representation, not achievement or test
adequacy. Full narrative generation, eliminating all Markdown structure, legacy
run repair, vendor permission expansion and release delivery are outside scope.

## Compliance and Confirmation

The dependent plan must map requirements to these observable checks:

1. Narrative-only implementation reports plus valid ledger reach verification
   with exactly one generated section and no formatting model call.
2. Invalid task coverage/order/status, incomplete completed outcomes, unsafe or
   missing evidence, invalid gaps, approval drift, wrong roles and scope escape
   block before canonical publication. Rejected results remain inspectable.
3. Special-character round trips and deterministic byte output; malformed model
   table replacement; absent-region insertion; fenced fake headings; duplicate
   region refusal; exact preservation of unrelated narrative and eligible gap
   headings. Render v2 cells through the selected Markdown renderer and assert
   literal displayed text with no model-created emphasis, links, code, images or
   HTML for asterisks, underscores, brackets, backticks, entity strings and angle
   brackets. Decoder round trips alone are insufficient. Preserve v1 fixtures.
4. Fresh fix ledger, null-ledger fix, truthful escalation, invalid-ledger retry
   and prerequisite-blocked recovery preserve canonical authorship, accepted
   scope, all ancestor evidence and original review conclusions.
5. Fault injection at every capture/candidate/rename/receipt/attempt/state/event
   boundary reconciles once or blocks on drift; no false done, double usage,
   repeated model invocation, duplicate verification or lost source report.
   Assert each section 4 refusal class exposes its specified attempt status,
   blocked phase, CLI/control next action and accounting. Unchanged I/O failure
   resumes without a model; ambiguous input retries with a linked successor;
   drift requires exact restoration or cancel; corrupt proof exposes cancel.
   Every non-terminal refusal has a legal exit without editing control files.
6. Mixed old/new fixtures preserve legacy parsing/retry behavior, absent-marker
   meaning, read-only status, archive closure and frozen consumer/privacy rules.
   Assert all newly created strict implementation/fix/retry/recovery attempts,
   including those in old runs, use the new protocol with no selector; retries
   carry exact durable retryOf and recoveries keep recoveryOf/authorization.
   Reviewer pass and zero-accepted triage still revalidate and reject tampering.
7. Source tests cover both private and legacy report layouts, both verification
   modes, both vendor prompts, independent review, instruction-baseline evolution
   and generated-source/distribution parity. Synthetic fixtures must be
   self-contained and contain no copied client/private operational material.
8. After implementation: focused suites, typecheck/lint, complete test suite,
   explicit build, read-only build/release checks, formatting and diff checks.
   Report exact evidence and limitations; local deterministic checks do not prove
   hosted CI, installed-client compatibility or live vendor behavior.
9. Exercise every section 2 outcome/gate row, including blocked implementation,
   escalation and a blocked fix with resolvedFindingIds, with partial/missing
   reports and malformed completion payloads. Preserve the original stop, phase
   and valid finding identities; render/publish neither; retain old canonical
   evidence without claiming current validity or triggering verification. Stop
   results remain completed model attempts, not successful task completion.
10. A blocked task pointing to a nested gap heading inside the replaced region
    gets an invalid-gap diagnostic and retains its stop. Candidate validation
    rejects that same target before any publication; a unique preserved heading
    outside the region remains eligible. Final-candidate checking cannot accept
    dangling, generated or fenced gap targets.
11. Check every section 7 amendment against the named accepted clause, and on
    lifecycle acceptance require reciprocal links for ADR-0017, ADR-0023,
    ADR-0025, ADR-0042 and ADR-0043. Retain existing standalone authored reports
    while their readers recognize versioned runner-produced evidence.

Independent proposal review requested the clarifications incorporated here.
Resolution review of this rework and implementation evidence remain pending.

## Lifecycle Links

- Amended by [ADR-0054](./0054-git-visible-work-artifacts.md), accepted
  2026-10-13: new human-facing completion reports use the tracked work directory.
  Runner-owned publication, receipts and completion authority remain.
  Implementation is Planned.

- Supersedes: None in full.
- Accepted narrow amendments: ADR-0017, ADR-0023, ADR-0025, ADR-0042 and ADR-0043,
  with narrowed clauses and preserved authority in section 7. Reciprocal
  lifecycle links recorded on 2026-09-15; accepted bodies remain unchanged.
- ADR-0024 recovery eligibility and ADR-0037 independent review remain binding;
  new persistence must preserve them rather than reinterpret old checkpoints.
- Narrowly amended by
  [ADR-0048](./0048-completion-markup-and-viewer-enrichment-boundary.md),
  accepted 2026-09-16: section 3's rendered-inertness claim and its dependent-plan
  renderer-test obligation, with confirmation 3's selected-renderer requirement,
  become protection of Markdown/HTML syntax created from model characters,
  evidenced by a byte-level punctuation property and the existing Prettier parse
  oracle. Viewer enrichment of decoded plain text is explicit residual risk.
  Encoding, region/gap ownership, validation, publication, recovery, evidence and
  independent-review authority remain binding.
- Superseded by: None.
- Accepted on 2026-09-15 by the repository owner's explicit `Accept ADR-0047`.
- Next: prepare the dependent development plan and obtain approval of its exact
  bundle. ADR acceptance does not authorize code execution or delivery.
