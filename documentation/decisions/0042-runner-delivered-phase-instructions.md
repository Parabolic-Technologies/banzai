# ADR 0042: Runner-Delivered Phase Instructions

## Status / Date / Owner / Decision Makers

- Status: Proposed
- Date: 2026-09-11
- Owner: Banzai maintainers
- Decision makers: Repository owner
- Rework 1: revised on 2026-09-11 at the owner's request after independent
  proposal review. The changes address diagnostic versioning, review-guidance
  extraction, generated-source tracking and document structure. This revision
  records neither ADR acceptance nor independent confirmation of closure.

## Related Artifacts

- Private strict work: `runner-phase-instructions`. Its requirements remain in
  the selected private work binding; this public decision is self-contained.
  No dependent development plan exists yet.
- [Project manifest](../../PROJECT_MANIFEST.md), sections 3, 5, 6 and 10;
  [orchestrator module boundaries](../../packages/orchestrator/MODULES.md).
- [Artifact-policy migration](../artifact-policy-migration.md), Phase 3;
  [publication boundary](../publication-boundary.md).
- [ADR-0002](./0002-session-affinity-and-bounded-reviewer-continuity.md),
  [ADR-0008](./0008-read-only-doctor-diagnostics.md),
  [ADR-0011](./0011-protected-live-vendor-compatibility.md),
  [ADR-0017](./0017-versioned-plan-task-completion-ledger.md),
  [ADR-0020](./0020-scoped-claude-subprocess-environment.md),
  [ADR-0028](./0028-phase-context-accounting-and-budget-policy.md),
  [ADR-0029](./0029-eslint-backed-orchestrator-import-boundary-policy.md),
  [ADR-0036](./0036-vendor-neutral-policy-files-and-instruction-delivery.md),
  [ADR-0037](./0037-unified-runner-rendered-review-artifacts.md),
  [ADR-0040](./0040-project-adoption-preflight-and-interactive-setup.md) and
  [ADR-0041](./0041-artifact-retention-and-publication-boundary.md).

## Context and Decision Drivers

The runner currently asks models to load and chain installed chat skills.
That makes required instruction delivery depend on host-specific invocation and
model actions. Standalone chat skills remain a supported product, but their
discovery, layout recognition and helper choreography are unnecessary inside a
runner that already owns adoption, work binding, claims and phase authority.

The runner already embeds contracts and shares the plugin artifact runtime.
It supplies binding/grant text to writing phases, while review receives selected
evidence fields without the complete readable role surface. Prompt rendering
preserves component order; context accounting independently aggregates bytes by
category. Plugin-directory verification checks the eleven skills and enforcement
hooks structurally, without comparing instruction content identities.

A separate local prerequisite fix permits the existing bound `changeReport`
during strict accepted-finding fixes in both runner and hook. This proposal
preserves that boundary and the current report trigger. It neither completes the
whole artifact-policy migration nor establishes broader legacy hook parity.

Decision question: how should Banzai own complete, deterministic phase instruction
delivery across vendors while retaining standalone support and existing
authority, artifact and evidence contracts?

The main drivers are reproducible delivery, single ownership of shared guidance,
vendor independence, explicit compatibility evidence, bounded resource access,
and preserving human decisions and review independence. Repeated inline text has
a context cost; the design must measure that cost rather than assume savings.

## Options Considered

| Option | Benefits | Costs and risks | Disposition |
| --- | --- | --- | --- |
| Keep loading chat skills through the host Skill tool | Uses today's product and requires little migration; preserves observed host events. | Required delivery still depends on a model action, skill availability and host behavior; standalone and runner process remain entangled. | Reject for runner phases; retain standalone support. |
| Hide host skills with `disable-model-invocation` and request a slash command inside the `-p` prompt | Could retain a host-managed instruction entry point while reducing unsolicited discovery. | Headless slash behavior is unverified; foreground setup does not prove it, and Codex would need a different mechanism. Adds host-specific delivery without established compatibility evidence. | Reject; do not treat an unrun live experiment as confirmation. |
| Embed non-skill phase documents and shared resources in the runner, then inline them in each prompt | Delivers the same instruction bytes on both vendors, works without cache reads, and makes availability and composition deterministic. | Adds a generated-resource boundary, consumer/drift checks, installed-resource skew handling and repeated prompt bytes. | Proposed choice. |

Keep phase sources in the plugin product rather than only in the orchestrator
package: the plugin already owns reusable policies and standalone guidance, and
its distribution provides a declared source for compatibility comparison.
Runner code owns composition and schemas. A package-only source would simplify
runner-local packaging but split this product resource inventory or require a
second copy for installed-plugin comparison.

## Decision

### 1. Separate process, guidance and contracts

Store six phase documents outside the manifest's `./skills/` discovery root:

| Resource under `plugins/banzai/phases/` | Runner responsibility | Shared guidance, in order |
| --- | --- | --- |
| `planning.md` | Strict requirements, conditional ADR, then development planning under accepted authority | requirements, architecture, planning |
| `implementation.md` | Strict implementation and assurance | implementation, assurance, manifest |
| `review.md` | Independent read-only review | review |
| `fix.md` | Strict accepted-finding fixes | fix, manifest |
| `feature.md` | Lite feature work | feature, manifest |
| `quick-fix.md` | Lite original-task fixes | fix, manifest |

Selection remains read-only and prompt-only. Foreground project-manifest setup,
standalone feature-status and the orchestrate supervisor are not new phases.
Keep both plugin manifests and the eleven-skill discovery inventory unchanged.

Phase documents contain runner-specific process. Keep machine contract grammar,
structured-result fields, gates, ledger/snapshot mechanics and rendering authority
in runner prompt code and schemas. Do not copy entire skills under phase names.
Do not put layout recognition or adoption in phase documents; ADR-0040 preflight
owns those operations.

Use `plugins/banzai/guidance/<name>.md` as the single canonical source for the
following portable engineering guidance. Standalone skills read it relatively;
the runner embeds it. The extraction boundary includes substantive duties within
the named sections, not their host invocation or structured-result mechanics.

| Guidance resource | Existing skill and source sections | Retained substantive duty |
| --- | --- | --- |
| `requirements.md` | feature-description: Clarification Loop, Document, Rules | Precise requirements, assumptions, risk and acceptance coverage. |
| `architecture.md` | architecture-decision: Proposal, ADR Document, Lifecycle, Apply The Decision | Eligibility, options, decision content and immutable accepted intent. |
| `planning.md` | development-plan: Document, Rules | Executable, consistent tasks and verification under accepted authority. |
| `implementation.md` | code-writing: Implementation Rules, Deviations, Final Verification, Implementation Report | Scoped implementation, explicit deviations and implementation evidence. |
| `assurance.md` | test-writing: Rules, What To Test, Suite Runs, Critique Loop, Test Report | Proportionate assurance, critique, valid suite evidence and report contents. |
| `review.md` | feature-review: Read, Audit (including its finding-field rules), Engineering Quality Shadow Procedure | Evidence-backed audit, finding quality, accepted-finding closure and shadow assessment. |
| `feature.md` | feature: Workflow, work.md, Rules | Lite work description, implementation, verification and work-record content. |
| `fix.md` | quick-fix: Report Rule, Workflow, Change Report | Bounded fixes, unchanged conditional reporting and report content. |
| `manifest.md` | project-manifest: Maintenance, Required Sections, Writing Rules, Checklist | Current-state factual maintenance and document quality. |

Keep standalone entry, missing-source handling, layout/helper ownership and
host-specific final reporting in the skills. Existing Orchestrated Mode sections
remain byte-unchanged and unused by runner phases; they are the explicit
transitional duplication exception. Feature-status and orchestrate remain
byte-unchanged. Other skill edits are limited to the enumerated extraction and
relative consumer references, with no standalone semantic change. Record the
exact extracted clauses and immutable baseline comparison evidence so normalized
drift checks cannot certify themselves from two newly edited copies.

For review, explicitly exclude `## Review Artifact`, its fenced standalone v1
template (including the apparent Review Scope, Findings, Previously Accepted
Findings and Deferred Coverage headings), and `## Chat / Structured Result`
from extraction. These are not portable section sources. Keep existing runner
review-field, closure and rendering mechanics in runner prompts/schemas under
ADR-0037; the shared guidance does not make the reviewer author Markdown.

### 2. Inline the existing policy duty union

Amend ADR-0036's runner delivery and consumer matrix as follows. Keep all six
canonical files under `plugins/banzai/policies/`, their substantive meanings and
the standalone consumer matrix. An included policy retains its conditional
applicability; inclusion alone does not activate a conditional duty.

| Phase | Policy duty union |
| --- | --- |
| Planning | Decision Consultation (conditional), Test Assurance, Security Assurance, Engineering Quality, Plan Task Completion, Artifact Storage |
| Implementation | Test Assurance, Security Assurance (conditional), Engineering Quality, Plan Task Completion, Artifact Storage |
| Review | Test Assurance, Security Assurance, Engineering Quality, Plan Task Completion (conditional), Artifact Storage |
| Fix | Test Assurance, Security Assurance, Engineering Quality, Plan Task Completion (conditional), Artifact Storage |
| Lite feature | Test Assurance, Security Assurance, Engineering Quality, Artifact Storage |
| Lite quick-fix | Test Assurance, Security Assurance, Engineering Quality, Plan Task Completion (conditional), Artifact Storage |

Inline each applicable policy body once per invocation, in the table's canonical
policy order. Do not ask a runner model to resolve a policy or helper relative
to SKILL.md. Missing, empty, unreadable or invalid required source bytes fail
build/release validation. Preserve standalone missing-policy stops. Malformed
embedded data must fail explicitly, never fall back to host skill loading.

Enumerated policy edits are consumer/delivery metadata and explicit context for
the Artifact Storage policy's existing loading/helper procedure: standalone
callers resolve the installed policy and helper; runner phases use supplied
binding/grants while the runner owns helper operations. Preserve that procedure,
its conditions and storage/claim rules. Do not inline an unconditional instruction
to discover or acquire work and rely on a later prompt contradiction to cancel it.

### 3. Embed exact resources through one build inventory

Use one bounded build inventory for the six phase documents, nine guidance
documents, six policies and reference identities for `hooks/hooks.json` and
`hooks/spec-gate.cjs`. Hooks remain installed-plugin enforcement resources;
embedding their identities neither executes them nor replaces plugin loading.

Generate a deterministic typed resource module at
`packages/orchestrator/src/phase-resources.ts` and track it in Git alongside the
canonical resource changes, as with committed `dist/` and
`plugins/banzai/lib/artifact-readers.mjs`. It contains exact decoded UTF-8
instruction text and raw-byte SHA-256 identities, with no timestamps, checkout
paths or private work. It is a generated copy, not another normative source.
Use build-time generation integrated with the existing esbuild pipeline, rather
than runtime Markdown imports or runtime instruction reads from a plugin cache.
The shipped CLI remains usable for instruction delivery without source files.

The build and checks share that same inventory and generation logic. An explicit
normal build generates resources before bundling. A clean clone already contains
the generated module, so preserve the manifest's `npm run verify` order:
typecheck, lint, test, then build:check. Typecheck, lint and test never generate or
repair production resources; tests may exercise generation in disposable fixtures.
Keep existing generated artifact readers and contract parity responsibilities.

`build:check` compares the expected generated module bytes and bundle/source-map
bytes without repairing them. A missing or stale module fails with a bounded
diagnostic naming `src/phase-resources.ts` and the explicit `npm run build`
remedy. A missing module may also fail an earlier typecheck/import-map check;
that does not authorize generation there. A syntactically valid but stale module
must still fail byte parity even when those earlier checks pass.

`release:check` reaches this same comparison through verify and retains its
tracked-byte/mode snapshot and mutation detection. It must not run a regenerating
build to make the gate pass: generation or repair of the tracked module by any
gate component is a mutation failure. Deliberate generation occurs before the
gate, with the generated module and bundle reviewed as part of the future
implementation change. No generation or commit is authorized by this proposal.

Classify every new phase and guidance file explicitly as `product` in the
publication inventory. Validate actual source, plugin and npm distributions,
including embedded resources and source maps; preserve the current npm payload
boundary. Exact embedding comparison is byte-sensitive. Whitespace-normalized
shared-guidance extraction comparison is a separate check and cannot excuse a
stale bundle. Publication validation must exercise the applicable content-parity
checks as well as classification; mere path existence is insufficient.

Under ADR-0029, authorize only these additional production-module edges when this
ADR is accepted; preserve the rest of the explicit import map:

| Importer | Additional permission |
| --- | --- |
| `src/phase-resources.ts` | New generated resource boundary with no project-module imports. |
| `src/phase-instructions.ts` | Runtime imports of `./phase-resources.js` and `./errors.js`; type-only `./types.js`. |
| `src/prompts.ts` | Runtime import of `./phase-instructions.js`. |
| `src/workflow.ts` | Runtime import of `./phase-instructions.js`. |
| `src/doctor.ts` | Runtime import of `./phase-instructions.js`. |

The new instruction boundary selects embedded resources and evaluates parity
against a supplied verified directory. Scope resolution stays in its existing
owner; doctor already consumes that resolver. Use existing Node built-in rules.
Do not add a wildcard plugin import, a new arbitrary Markdown import permission
or a dynamic project-module escape hatch. Build-time resource reads are limited
to the declared inventory and do not widen runtime import authority.

### 4. Deliver complete authority without changing grants

The runner supplies its exact work identity, bound role paths, phase write set,
approvals and required evidence paths. A listed readable role is not a grant.
Keep claim acquisition, work creation, binding and layout decisions with the
runner. The model must still inspect required evidence; delivery of a digest or
path is not proof of assessment.

| Consumer | Work-artifact write roles retained | Required delivery closure |
| --- | --- | --- |
| Strict planning | description, plan | Replace skill/helper discovery and the fixed documentation-only contradiction with exact runner-resolved authority; retain separate public ADR handling. |
| Strict implementation | implementationReport, testReport | Inline implementation/assurance, report and manifest guidance; retain approved scope, profiles and completion duties. |
| Strict fix | implementationReport, testReport, changeReport | Retain accepted-finding scope, authoritative triage, completion refresh and the existing report trigger. |
| Lite feature | work | Deliver route duties and the existing work record without inventing a strict ledger. |
| Lite quick-fix | changeReport | Preserve conditional reporting; a grant alone does not require a report. |
| Review | none | Add full applicable read roles and an explicit empty model-write set alongside snapshot, verification, completion and triage evidence. |
| Selection | none | Retain its current prompt-only scope. |

This table governs the work-artifact surface, not every source/document write
permitted by an existing phase. It does not add ADR paths to a work binding or
alter existing ADR approval semantics. Canonical review destinations and
attempt-owned candidates do not become model-writable; ADR-0037 rendering stays
runner-owned. Legacy runs retain their original resolved surface and historical
identity without a synthetic v4 binding or relocation.

Enforcement remains at `workflow.ts` phase write selection and post-call scope
validation, `spec-gate.cjs` pre-tool checks with run/binding digests, artifact
claims and structured-result/review validation. Change instruction delivery,
not those permission boundaries. Do not broaden implementation, planning,
review or selection grants, modify hook behavior, or waive report obligations.

### 5. Make composition and repeated cost explicit

Compose components in this order, omitting only inapplicable components:

1. Common runner mechanics (`common_instructions`).
2. Selected phase process, ordered shared guidance, deduplicated policies, exact
   work-role/grant text and applicable capability guidance (`phase_instructions`).
3. Request scope (`user_request_scope`).
4. Human decisions (`human_decisions`).
5. Approved requirements and architecture (`approved_requirements_architecture`).
6. Verification, workspace and completion evidence, in that order, under their
   existing evidence categories.
7. Review/triage evidence (`review_triage_evidence`).
8. Recovery instructions (`recovery_instructions`).

Use explicit component construction, not boundary searches in untrusted text.
Between nonempty logical blocks add exactly two LF bytes owned by the following
component; there is no leading separator. Preserve each source body's bytes,
including any existing terminal newline. Stable resource-ID headings, if used,
belong to the same component as their body and have deterministic serialization.
Count every rendered UTF-8 byte once. Accounting aggregation order must not
reorder rendering. Transported schemas remain separately counted as
`output_contract`, not copied into instruction resources.

For identical phase, route and authoritative inputs, the instruction, guidance
and policy text is byte-identical across Claude and Codex. Vendor transport,
schema serialization and separately attributed capability/evidence data keep
their existing roles; they do not weaken the shared-text parity assertion.

Resend the complete payload on every fresh or resumed call, continuation, retry
and authorized recovery. Apply ADR-0028 budgets to all repeated bytes, retain
`CONTEXT_BUDGET_EXCEEDED`, and never truncate or silently summarize required
instructions. Existing invocation-consistency checks include the dispatched
text. Preserve ADR-0002 recovery and rotation semantics: no new rotation reason,
no fabricated `session-inventory-changed`, and no reliance on session memory as
authority. Measure growth per call; fewer Skill events do not prove lower cost.

### 6. Separate installed-resource parity from plugin integrity

Retain ADR-0020 structural verification: the named Banzai manifest, `./skills/`
root, all eleven nonempty SKILL.md files, required PreToolUse/PostToolUse hook
configuration and hook script. Scoped Claude invocation still needs the verified
directory and `--plugin-dir` for enforcement. Preserve explicit invalid-directory
errors, explicit ambient mode, automatic MCP-only degradation and authentication.

Add a content-parity check against the applicable embedded phase, guidance and
policy identities and the two embedded hook reference identities. Do not compare
chat SKILL.md content, which runner phases no longer consume. A release version
alone proves no content parity.

Check at runner preflight and immediately before each model call. Preflight uses
the applicable workflow resource union, or the possible route union while
selection is pending; the call check uses the actual phase/route. Selection has
no phase document; hook identity remains applicable when a verified directory is
used. Resolve only exact inventory paths within that verified directory, reject
escaping paths, and never search guessed caches.

Owner decision RPI-02 selects the following behavior; it is a product preference,
not acceptance of this ADR:

| State | Evidence | Behavior |
| --- | --- | --- |
| verified | Every required readable resource has the expected raw-byte identity. | Proceed under existing checks; report the verified resource scope. |
| mismatch | A safely read applicable resource has a different identity. | Refuse the affected call with stable code `INSTRUCTION_RESOURCE_MISMATCH` before creating an attempt. |
| unverifiable | No applicable verified directory, including Codex, explicit ambient mode or unresolved-directory scope. | Report the limitation; do not block solely for absent parity evidence. |
| bounded failure | A compared resource is missing, unreadable or cannot be safely compared inside an otherwise verified directory. | Report a distinct bounded failure, neither match nor mismatch; do not block solely for absent parity evidence. |

A confirmed mismatch is decisive even if another resource is unreadable; with no
mismatch, any bounded failure prevents a verified result. Existing structural
plugin/hook refusal takes precedence. For example, a missing hook that invalidates
the verified directory cannot be converted into a nonblocking parity warning.
Parity never automatically changes the resolved invocation scope.

Follow the ADR-0040 `PROJECT_SETUP_REQUIRED` refusal pattern with the new code:
create no synthetic failed attempt or usage; retain the last durable checkpoint,
saved decisions, prior failures and retry/recovery authority. Name exactly three
remedies: rebuild the orchestrator bundle from current source, update the installed
plugin to the matching release, or explicitly select ambient mode, which is then
reported as unverifiable. Existing resume, retry and recover actions remain
authoritative after remediation. Do not install, rebuild, change scope or replace
embedded instructions automatically as a consequence of the diagnostic.

Expose these states in doctor and run progress. A new failed check changes
doctor readiness; ADR-0008 as amended by ADR-0040 D7 and the manifest section 10
therefore require a new diagnostic identity. Emit `banzai-doctor/v3`,
`schemaVersion: 3`, for new doctor reports. Preserve the other top-level fields
and their order (`ready`, `projectTypes`, `summary`, `checks`), the check shape,
and the existing status enum. Insert exactly one check, `runtime.instructions`
in category `runtime`, immediately after `claude.environment` and before
`claude.permissions`; preserve all other check order.

Assess the applicable resource union for configured model roles without running
a workflow or vendor. The check reports pass only when the whole applicable
comparison is verified, fail on any confirmed mismatch, and warning for
unverifiable or bounded-failure evidence. In mixed cases a confirmed mismatch
wins; without one, bounded failure takes precedence over unverifiable, and any
evidence limitation prevents pass. Codex/ambient/unresolved-directory roles are
explicitly unverifiable; missing or invalid configuration cannot yield a verified
result. Existing configuration and structural-plugin checks retain their own
failures and never become warnings because this check lacks evidence.

Derive `ready` and summary counts from checks as before: any fail means
`ready: false` and exit 1; warnings alone retain `ready: true` and exit 0.
Collect independent expected findings without short-circuiting. Keep
`doctor [--json]`, canonical JSON and its human projection, offline read-only
inspection and no model/authentication/command/repair path. Doctor reports
readiness; the separate runner pre-call check owns enforcement.

Document the intentional v2-to-v3 consumer transition and update shipped doctor
examples, validators and smoke expectations during implementation. Historical
v1/v2 reports retain their identity and meaning; add no legacy-output flag.
This narrow diagnostic version change does not change evaluation, KPI, context,
phase-result, review-result or persisted run/work contracts. Diagnostics identify
bounded product resource IDs and remedies, never arbitrary contents or private
paths. Do not retrofit parity fields into historical attempts or frozen exports.

This is evidence about the declared instruction resources and hook references,
not a claim of full transitive plugin integrity or immutability during a running
vendor session. Keep that limit explicit.

### 7. Preserve tool and evidence contracts

Keep current phase tool inventories, including Skill where already granted and
its existing prohibition during selection. Review retains its read-only tools,
sandbox and Serena boundary. No tool removal, inventory schema change or live
compatibility assumption follows from removing Banzai Skill-load instructions.

Replace advertised Banzai skill chains with truthful phase/route progress.
Continue recording real vendor skill events if they occur, but never synthesize
events or report zero available skills because no load was requested. Delivery
proves supplied instructions, not successful model compliance.

Artifacts remain equivalent in role, format, binding and evidence authority,
independent of producer. Standalone status/review use work.json roles and existing
readers without producer-specific discovery. This does not promise identical
generated prose or conflate standalone review v1 with bound runner review v3.
Preserve phase-result/review-result versions, approved artifact immutability and
all five human gates.

Preserve historical readability, original attempts and checkpoints, usage,
subscription-only authentication, vendor independence and private evidence.
Equivalent evidence retains identical evaluation/KPI/context v1 projections;
actual new prompt bytes remain accurately different. No frozen schema, field,
enum or privacy allow-list changes are authorized here.

### 8. Amend delivery obligations, retain their authority

| Existing decision | Narrow amendment proposed here | Preserved authority |
| --- | --- | --- |
| ADR-0008, as amended by ADR-0040 D7 | New doctor reports use v3 and add exactly the readiness-changing runtime.instructions check specified in section 6. | Read-only/offline and privacy boundaries, deterministic field/check order outside the stated insertion, status meanings, derived readiness/exit behavior and historical v1/v2 meaning. |
| ADR-0036, as amended by 0040/0041 | Runner consumers receive the phase union inline from embedded canonical resources; source availability becomes a build guarantee. | Six-policy meanings, conditional duties, standalone relative loading and adoption ownership. |
| ADR-0017, as amended by 0025/0041 | Replace the actual skill-load requirement for runner implementation/assurance with deterministic delivery of their complete obligations. | Approved tasks, completion ledger/projection, report duties and fix refresh. |
| ADR-0020, as amended by 0022 | Replace phase-level successful skill-call confirmation with delivery/authority checks and independently reported installed-resource parity. Retain eleven-skill structural verification. | Setting-source scoping, verified plugin directory, hooks, explicit failure/degradation and truthful confirmation scope. |
| ADR-0029 | Permit the exact module edges in section 3 under this accepted ADR's authority. | Explicit import map, no inferred permission from source imports, no wildcard resource exception. |

ADR-0002 and ADR-0028 govern unchanged session/context semantics. ADR-0011 and
ADR-0037 govern separately authorized installed-client compatibility and tool
evidence. ADR-0040 and ADR-0041 continue to govern adoption, bindings and private
evidence. None of their bodies is rewritten by this proposal.

## Consequences

Instruction delivery becomes deterministic and testable without relying on a
model to invoke another instruction entry point. Shared engineering guidance has
one maintained source, and source-to-distribution drift becomes an explicit
failure. Standalone skills remain available with their original responsibilities.

The cost is a larger repeated runner payload, more build/consumer validation, and
an operational refusal when readable installed resources demonstrably disagree.
Doctor consumers must recognize v3; retaining v2 with the new fail would silently
change readiness semantics, while a warning-only projection would conceal that
the runner refuses a confirmed mismatch. The proposed version change preserves
that failure behavior and follows the existing diagnostic compatibility rule.
Unverifiable and bounded-failure cases leave an explicitly reported evidence gap;
they must never be presented as compatibility proof. A resource check cannot
prove vendor compliance, full plugin integrity or freedom from concurrent changes.

Keep these separate follow-ups out of this feature: slimming retained Orchestrated
Mode sections; the reduced report rule and runner-rendered completion projection
from ADR-0041 section 4; structured plan/ADR artifacts; grant or hook changes;
tool-inventory reduction; and any standalone support change. Each has different
authority or compatibility consequences.

## Compliance and Confirmation

The changed security surfaces have the following enforcement and evidence owners;
established authentication and hook controls are retained, not redesigned:

| Exposure | Reachable mechanism and required control | Confirmation boundary |
| --- | --- | --- |
| 1: resource paths | Installed-resource comparison reads only exact declared resources inside the supplied verified directory; reject escaping paths. | New instruction-resource boundary; unsafe-path and bounded-failure fixtures. |
| 2: access decision | The new mismatch refusal controls whether a call starts; supplied role text must not widen artifact grants. | Workflow pre-call/refusal boundary, existing runner scope validator and hook; no-attempt and exact-grant fixtures. |
| 4/5: private data and cross-work access | New binding/diagnostic text must not select unrelated work or expose private paths/content in public diagnostics or frozen projections. | Runner binding delivery and diagnostic construction; unrelated-work and projection fixtures. |
| 7: publication | New embedded text and source maps extend the distributable resource surface; private evidence must remain excluded. | Publication inventory and actual-payload scanner; classified-resource and leakage fixtures. |

| Boundary | Required observable evidence |
| --- | --- |
| Phase delivery | Deterministic fixtures cover all six mappings, vendor text parity, no Skill/slash/explicit-mention choreography, full role delivery and prompt-only selection. |
| Source ownership | Enumerated extraction/reference edits only; all retained Orchestrated Mode blocks and both untouched skills byte-unchanged; review's standalone artifact template and Chat / Structured Result section stay outside shared guidance; normalized baseline comparisons preserve duties and report triggers. |
| Build and publication | One inventory covers every phase/guidance/policy; a clean clone verifies without prior generation; missing/invalid/stale fixtures fail without repairing tracked bytes; generated text, bundle and source maps retain exact bytes; actual distributions pass classified resource and embedded-content checks. |
| Context and sessions | Composition/separator tests count every byte once under existing categories; fresh/resumed/retry/recovery fixtures resend complete payloads and preserve budget refusals and rotation meanings. |
| Plugin integrity and parity | Eleven-skill/hook structure checks remain; fixtures exercise all four parity states, hook skew, mixed mismatch/unreadable results, structural refusal precedence, preflight and per-call checks, doctor/progress and all three remedies. |
| Doctor contract | v3 identity/schemaVersion, exact runtime.instructions position/category/status semantics, mixed evidence, canonical JSON/human projection and derived readiness/exit counts; missing/invalid config and independent failures; historical v1/v2 unchanged; no filesystem mutation or vendor/configured-command invocation. |
| Refusal lifecycle | Mismatch before initial or resumed attempts leaves attempt count, usage, durable checkpoint, decisions and prior failure/recovery authority unchanged; no automatic remediation occurs. |
| Artifact and permission authority | Strict implementation/fix, both lite routes, read-only review and selection preserve grants, report triggers, binding/claim ownership and legacy surfaces; chat-consumer fixtures read runner-produced bound work. |
| Frozen evidence | Equivalent persisted evidence produces unchanged evaluation/KPI/context projections; no fabricated Skill events, historical retrofit or private-resource leakage. |
| Installed-client compatibility | Separately authorized Claude and Codex evidence confirms actual delivery, hooks/scoping, standalone consumers and tool inventory under ADR-0011/0037. Deterministic fixtures alone do not establish this. |

Update README standalone/orchestrated guidance, orchestrator documentation,
MODULES.md and the manifest only to reflect verified current state as implementation
lands. Add an accepted ADR to the manifest as Planned, not Implemented; this
decision remains Planned until required installed-client evidence exists.

Explicit owner acceptance of this Proposed ADR is required before the dependent
development plan. Plan approval remains a separate gate before implementation.
No live workflow, installed-tool change, commit, push or publication is authorized
by preparing this decision.

## Lifecycle Links

- Supersedes: None in full.
- Superseded by: None.
- Proposes the narrow amendments to ADR-0008 (including ADR-0040 D7), ADR-0017,
  ADR-0020, ADR-0029 and ADR-0036 described in section 8. Their accepted bodies
  remain unchanged during this rework.
- Upon explicit acceptance, add reciprocal amendment links only in the relevant
  accepted ADR lifecycle metadata, including ADR-0008 and ADR-0040 for the newly
  emitted doctor v3 identity. Preserve their Accepted status and historical
  diagnostic decisions; none is superseded in full. Do not add those links as
  accepted authority while this proposal is still Proposed.
- Implementation state: `Planned`; not implemented or confirmed in installed
  clients. Remain Planned until the required installed-client evidence exists.
