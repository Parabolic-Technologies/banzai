# ADR 0044: Instruction Baseline Evolution

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-09-12
- Owner: Banzai maintainers
- Decision makers: Project owner; explicitly accepted on 2026-09-12 after owner revisions.

## Related Artifacts

- Private strict work: `proportionate-verification-closure`, FR14-FR15.
- Plan: not created; depends on acceptance and separate plan-bundle approval.
- Authority: root `AGENTS.md`, `PROJECT_MANIFEST.md` sections 5, 8 and 10,
  `packages/orchestrator/MODULES.md` instruction generation/parity.
- Related ADRs: [0042](./0042-runner-delivered-phase-instructions.md),
  [0043](./0043-proportionate-verification-evidence.md), ADR-0038 and ADR-0041.

## Context and Decision Drivers

ADR-0042 captured a one-time transition from portable skill sections to shared
guidance. `packages/orchestrator/phase-guidance-baseline.json` retains original
section hashes, transformations, resulting guidance/consumer hashes, skill
skeletons, retained Orchestrated Mode blocks and preserved boundaries.
`scripts/phase-resources-build.mjs:validateGuidanceExtraction` pins its canonical
JSON digest and compares current resources against those expectations.

That is useful transition evidence, but it also rejects later intentional
guidance or consumer changes. Changing both current text and its expected hash
without retained provenance would no longer demonstrate the original guarantee.
No shipped rebaseline generator exists. A raw-byte build or publication check
proves distribution parity; it cannot prove preservation of an approved duty.

Decision question: How can maintainers authorize later instruction changes
without rewriting the original extraction evidence or disguising drift?

The decision is independent of verification reuse. Preserve exact embedding,
public-clone reproducibility, explicit owner authority, small reviewable
transitions and checks that never repair their own inputs.

## Options Considered

| Option | Benefits | Costs / disposition |
| --- | --- | --- |
| Freeze current instructions permanently | Strong original comparison | Prevents approved product evolution; reject. |
| Replace all hashes and the pin from current files | Simple | Erases the distinction between original extraction and later duties; reject. |
| Drop normalized checks and retain build parity only | Fewer checks | Current copies can agree while an obligation silently disappears; reject. |
| Preserve the original root and add reviewed current-baseline transitions | Separates historical proof, current drift and approval; public-clone validation | Adds a bounded baseline format and generator; proposed choice. |

## Decision

### 1. Preserve the original evidence; version ongoing expectations

If accepted, retain `phase-guidance-baseline.json` byte-for-byte and keep its
existing canonical digest pin
`77230bb56083c58962d45e113f262010d3969f9e595cae1d06e80e70f9c79361`.
It remains the historical ADR-0042 extraction root. Do not regenerate it from
current text, replace its original hashes, reopen that work package or require
access to private historical artifacts to build a public clone.

The preserved root carries no schema identity and is recognized only by that
pinned digest; do not add one to it. Add an ongoing `phase-guidance-current.json`
with explicit `banzai-instruction-baseline/v1` identity, the first versioned
baseline format, original-root digest, current normalized section and consumer
expectations, raw skeleton/preserved-file identities and an ordered transition
chain. The first generation derives its predecessor expectations from the
preserved root; later generations derive them from the previous accepted current
baseline. This is the rebaseline operation for future changes; the original file
and pin deliberately never move.

Each transition records predecessor/successor expectation digests, exact changed
resource/section identities and old/new digests, plus public accepted ADR and
authorization-scope references. Preserve old expectations through the chain;
do not replace history with the latest snapshot. Keep the inventory finite and
deterministic, with no private work paths, local timestamps or installed paths.

Current-baseline identity is separately pinned by the validator. Regenerating
the current baseline and its pin is an explicit reviewed source mutation; it
never occurs during normal build, `build:check`, tests or release validation.
Original transition proof, current normalized drift detection, structural
consumer validation and exact raw-byte embedding remain distinct checks.

### 2. Authorize scope; generate a reviewable candidate

Authority remains the owner-accepted ADR and approved plan for the instruction
change, followed by normal independent review and human triage. Approval of this
ADR authorizes the mechanism; it is not approval of arbitrary future text.
An ordinary compatible guidance correction can use its existing authorized work
scope; changed assurance, grant or other architectural meaning needs the
applicable new ADR. Add no approval dialog to each routine generator invocation.

Ship an explicit repository-local generator with `--check` and generation modes,
a closed input schema and a documented procedure. Inputs identify the prior
baseline/pin and an authorization manifest containing accepted public authority,
bounded allowed resource/section changes and preserved guarantees. Private plan
approval is reviewed in its existing workflow; public validation must not read
private evidence or accept a model-authored approval flag as proof.

The generator validates predecessor identity and the exact current resource
inventory, computes the complete old/new difference, and refuses changes
outside authorized scope. It produces the current baseline, transition record,
updated current pin and a bounded diff for review. Preserve the original pin.
No catch-all resource permission, implicit rebaseline, hand-edited digest-only
repair or fallback to a different installed version is allowed.

Use the established section parser/normalization and exact-byte preserved-file
rules, including the separately authorized release-version-only normalization.
Keep generated transitions deterministic and idempotent. Reject malformed,
duplicate, missing, unsafe-path, mismatched predecessor or contradictory scope
inputs before output publication. Prepare all outputs before replacing owned
files; a partial failure must remain detectable and recoverable without claiming
a coherent baseline. An ordinary build then regenerates exact embedded resources
and bundle/map from maintained source through explicit `npm run build`.

### 3. Release enforcement and its limits

`validateGuidanceExtraction` and `check-release.mjs` must verify:

1. The unchanged historical root and its fixed digest.
2. Supported current-baseline identity and its separately pinned digest.
3. Complete predecessor/successor linkage, consistent changed-scope inventory,
   required accepted public authority references and no unexplained difference.
4. Current guidance sections, consumer references, skill skeletons, retained
   blocks, hooks and manifests against current approved expectations.
5. Existing resource inventory, policy consumer/delivery and duty-specific
   structural assertions, independently of regenerated hashes.

An edited guidance file alone still fails as `INSTRUCTION_RESOURCE_DRIFT`.
Updating current expected hashes without a valid matching transition/pin fails;
so do changed scope, stale predecessor and malformed authorization records.
An authorized transition passes only when every affected expectation and
preserved guarantee validates. The generator is never called to repair a check.

This distinguishes a recorded, structurally conforming authorized transition
from unexplained drift. It does not cryptographically prove that a human approved
it: an actor who can rewrite the validator, pins and authorization record can
forge a consistent tree. Existing owner approval, independent review and normal
repository controls own that trust boundary. Do not claim a hash authenticates
human intent or that string checks prove semantic equivalence.

Preserve `checkPhaseResourceBytes`, exact bundle/source-map comparisons and
`checkInstructionPayloads` over actual source/plugin/npm archives. No normalized
comparison excuses raw-byte skew. Final `release:check` runs on a coherent
disposable candidate whose index and working tree agree, without staging or
committing in the real checkout. Publication exclusion remains unchanged.

## Consequences

Approved instruction changes become possible without erasing the original
transition evidence. The cost is one versioned current baseline and a bounded
transition record per authorized change. Maintainers must review the semantic
delta and authorization scope, not only generated hashes. Raw parity and drift
checks retain distinct claims and fail independently.

This package's guidance updates use the new path only after both ADR acceptance
and plan approval. ADR-0042's existing Accepted / Planned state and separate
installed-client confirmation remain unchanged. No historical run or work
artifact is modified or reverified by this decision.

## Compliance and Confirmation

Use shared disposable fixtures to confirm deterministic/idempotent generation;
authorized changed scope; refusal of unauthorized guidance/consumer/hook/manifest
edits, altered pins, stale or missing predecessors, malformed inputs and unsafe
paths; failure cleanup/coherence; and preservation of original baseline bytes.
Keep existing section/duty, generated-resource, raw embedding, source-map and
actual publication negative cases. Test observable guarantees without pinning
incidental prose. A normal build or release check must never mutate a baseline.

Document the exact command procedure and required approval/review provenance.
Report local deterministic evidence separately from independent acceptance,
installed-client confirmation and external delivery. The preserved historical
root is retained evidence, not a reason to rerun its closed package.

## Lifecycle Links

- Supersedes: None in full.
- Proposed amendment to ADR-0042 sections 1-3: its extraction root stays fixed;
  subsequent authorized instruction expectations use the versioned current
  baseline. Exact delivery, parity, grants and evidence semantics stay binding.
- ADR-0043 depends on this path for its guidance changes, but the decisions may
  be accepted or reworked independently.
- Superseded by: None. Existing accepted ADR bodies/lifecycle are unchanged.
- Accepted on 2026-09-12 for further planning. The owner-revised proposal had
  SHA-256 `02fcfacce42b2f9d105ade190f4d871383368e3feb84382599deed244b18ddb5`
  before this lifecycle update. This record supersedes proposal-stage
  pending-acceptance wording; the decision body is preserved. Implementation
  state: Planned. Separate approval of the resulting plan bundle is required.
