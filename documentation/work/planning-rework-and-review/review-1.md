# Implementation Review: planning-rework-and-review

- Format: `banzai-feature-review/v1`
- Feature slug: `planning-rework-and-review`
- Review iteration: `1`
- Verdict: `changes_requested`
- Workspace digest: `not supplied`
- Review artifact: `documentation/work/planning-rework-and-review/review-1.md`

## Review Scope

Standalone planning-readiness review requested for
`documentation/work/planning-rework-and-review/plan.md`. This is not an
implementation-completion review or plan approval.

Reviewed the current description and complete plan, including FR1-FR42, the
12 acceptance stories, resolved assumptions, T001-T013, the structural
assessment, compatibility rules, instruction changes and verification inventory.
Checked accepted ADR-0055 and the decision index, applicable ADR-0022,
ADR-0030/0050 and ADR-0037 constraints, root repository instructions and manifest
facts, relevant module documentation, and the existing adapter, prompt,
phase-scope, contract and test surfaces used by the proposed changes.

Applied the invoked installed skill's artifact-storage, engineering-quality,
test-assurance, security-assurance and plan-task-completion policies and review
guidance. This is the plugin source repository, so target-project layout
recognition does not apply. Packaged project instructions were treated as
product source.

The review baseline was HEAD
`8a7ff64f578fe78f18e517bc7f9f110d7b937da3`, with pre-existing modifications to
the selected description and plan. Reviewed input identities:

| Input | SHA-256 |
| --- | --- |
| `description.md` | `cdf4fbcc00b77409241b1448b30e6b87342154d2f5e9f4a3b332a5e23b4ff0c5` |
| `plan.md` | `2c60ea07dfe0ed5b3c042bf030ad31481334bf3f2834a320160662c18ac54795` |
| `documentation/decisions/0055-planning-gate-rework-and-independent-planning-review.md` | `3dbdeaca1a070f0526efda31842c55a24c0cb4792f8311a81df611664bf92caa` |

A concurrent plan edit was incorporated before finalizing this review. It
withdrew the proposed Codex MCP isolation, recorded the owner's decision and
updated the inventory digest. The changed passages were inspected; reversing
only those identified edits in memory reproduced the complete original reviewed
plan's SHA-256, confirming that the rest of the assessed plan was unchanged.
The final findings below apply to the current identity in the table.

The installed verification helper's v3 `inspect` and `decide` operations used
the exact selected document and `workflow: strict`. Both returned
`supported: true`, `evidence: unavailable`, null decision/applicability and
`physicalAttempts: 0`. The helper accepted the remainder-bound v2 inventory;
the pinned release-candidate driver digest also matches its current file bytes
(`698a35eebd4a7d5abf992d3ddbbb973d0332d350119fd99e70df57adf33f7eeb`).
These are read-only inspection results, not passing implementation checks.
No tests, formatter, build, release gate or vendor/model invocation was run.

## Summary

Changes are requested before approving the implementation bundle. The plan
provides detailed requirement coverage and separates planning review from code
review, approval, retry and human triage. However, its newly recorded decision
not to isolate Codex MCP has not been reconciled with the unchanged universal
write-denial and byte-preservation requirements. Its new review instructions also contradict
the unchanged distinction between ordinary findings and EQ-only observations.

Both findings can be resolved through bounded plan corrections. This review
does not reopen the owner's accepted product choices or the recorded PR-D5
input-size exception.

## Findings

### F1 — Reconcile read-only guarantees with the recorded MCP scope decision

- Severity: `blocker`
- Category: `spec`
- Confidence: `high`
- Evidence: `documentation/work/planning-rework-and-review/plan.md:1954`
  now records that an author-run offline check found the Codex MCP override
  ineffective and that the owner chose not to pursue MCP isolation.
  `plan.md:548` and T005 at `plan.md:1261` accordingly retain the existing
  MCP construction unchanged. However,
  `documentation/work/planning-rework-and-review/description.md:135` still
  requires every project-file write attempt to be denied and the reviewed
  bytes to remain identical. FR18 and FR37 likewise promise no project
  changes and byte-identical bundle artifacts after a failed attempt.
  The new scope decision is not reflected in these requirements or their
  acceptance stories. T005 still maps to these unconditional guarantees and
  describes its fake-process evidence as proving the read-only invocation.
  The existing scope owner at
  `packages/orchestrator/src/workflow/attempts/result-scope.ts:104` checks a
  workspace snapshot after invocation; detecting an edit afterwards does not
  deny the edit or preserve the original bytes. The proposed adapter and hook
  controls cannot be reported as universal MCP isolation after the plan
  expressly declines that isolation.
- Violates: description FR14, FR18 and FR37; ADR-0055 Planning review episode
  3 and Compliance 4; the plan's requirement-coverage commitment.
  Primary Engineering Quality overlap: `EQ-01`.
- Reproduction: static comparison, not a vendor execution. Follow T005 with
  the current MCP construction unchanged, as the recorded owner decision
  requires, and compare the guarantees that its evidence must establish with
  FR14 and user story 8. Scope rejection after an MCP-originated edit is
  detection, while those requirements demand denial and unchanged bytes.
  The plan's own newly recorded limitation makes the acceptance mismatch
  explicit; the reported Codex 0.162.1 experiment was not independently rerun.
- Fix acceptance: preserve the recorded decision not to pursue MCP isolation;
  this finding does not ask to restore the withdrawn mechanism. Reconcile
  the description, affected acceptance stories, T005 and report obligations
  so that they name the actual supported tool/sandbox boundary and distinguish
  prevented writes from detected external-tool changes. Resolve any resulting
  conflict with accepted ADR-0055 through its normal clarification/amendment
  lifecycle, without rewriting its accepted body. The final approved bundle
  must contain one consistent guarantee and proportionate evidence for it,
  rather than promise universal write prevention while excluding a known
  write-capable surface.
- Deduplication identity:
  `EQ-01|FR14-FR18-FR37-acceptance|MCP-scope-decision|guarantee-mismatch`.
  This is the newly exposed requirements mismatch after the concurrent
  withdrawal, not a reopening of the withdrawn isolation proposal.

### F2 — Preserve the ordinary-finding threshold in planning-review instructions

- Severity: `should_fix`
- Category: `plan`
- Confidence: `high`
- Evidence: `documentation/work/planning-rework-and-review/plan.md:585`
  instructs the new phase to report Engineering Quality concerns only as
  ordinary findings because its contract lacks `deferredCoverage`. The same
  phase inlines the unchanged Engineering Quality policy at `plan.md:590`,
  and ADR-0030/0050 remain unchanged binding decisions at `plan.md:23`.
  `documentation/decisions/0030-vendor-neutral-engineering-quality-policy.md:356`
  permits EQ mapping only for a finding that already qualifies independently;
  lines 366-376 prohibit EQ-only candidates from entering findings, human
  triage or fixing. ADR-0050 explicitly preserves that rule at
  `documentation/decisions/0050-triggered-code-design-assessment.md:333`.
  The unqualified phase directive conflicts with the policy it delivers.
  This matters because every returned planning finding starts planner
  analysis and requires a human disposition, including a concern that would
  otherwise remain non-authoritative.
- Violates: unchanged ADR-0030 Shadow semantics and ADR-0050 section 4;
  the plan's own unchanged-authority commitment. This is an instruction
  consistency finding under existing authority, not an EQ-only candidate.
- Reproduction: compare the prescribed new phase instruction with the
  inlined policy for an EQ-only design observation that has no independent
  specification, contract, safety or established-invariant violation. One
  instruction routes EQ concerns into ordinary findings while the other
  prohibits this classification. No implementation or model trial was run.
- Fix acceptance: explicitly restrict ordinary planning findings to concerns
  that qualify independently of EQ. State that the absence of a shadow field
  never permits promotion of EQ-only observations into findings; with the
  current closed contract, omit such candidates rather than route them to
  triage. Carry this rule into T006's phase/prompt assurance. Retain an
  independently supported ordinary-finding example and an excluded EQ-only
  example without adding a new contract field or reopening the accepted ADR.

## Previously Accepted Findings

None. No previous `review-N.md` or human finding dispositions were present in
the selected work directory. The plan's account of an earlier five-lens review
is author-reported context, not independently inspected prior review evidence.

## Deferred Coverage

- Implementation has not started. The proposed state v10, output contracts,
  instruction transitions, recovery paths and UI/control changes have not been
  validated as implemented behavior. Existing source inspection cannot prove
  their future correctness.
- No fresh test, release, build, formatting, installation or live-provider
  evidence was produced. The plan's reported planning checks were not rerun;
  only the read-only verification inspection and stated file identities were
  independently established.
- F1 concerns consistency of the current requirements and recorded scope
  decision, not an observed unauthorized write or compromise on this machine.
  Effective installed-client behavior and the newly reported Codex 0.162.1
  experiment were not independently tested. Official
  [OpenAI MCP documentation](https://learn.chatgpt.com/docs/extend/mcp#plugin-provided-mcp-servers)
  was consulted during the initial adapter assessment; it also documents
  plugin-provided MCP servers as a separate configuration source. That
  observation is not a request to reopen the owner's isolation decision.
- The current repository package version is already committed at HEAD. The
  plan's conditional owner version-selection prerequisite must therefore be
  resolved before dependent hook/library changes; this review selects no
  version and grants no release authority.
- Ordinary findings and verdict were fixed before Engineering Quality overlap
  classification. No additional EQ-only shadow candidate was retained.

## Handoff

Human triage is required for F1 and F2: accept, reject or defer each finding.
This review makes no disposition and authorizes no implementation or repairs.
Only accepted findings may enter the subsequent correction scope. Correct the
selected plan and any affected requirements through their applicable authority,
refresh the remainder-bound verification inventory after plan edits, and obtain
approval of the final exact bundle before implementation. This reviewer made
no changes to source, requirements, plan, ADRs, configuration or runner state;
this review is the only repository file created by the reviewer.
