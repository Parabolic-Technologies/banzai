# Change Report: ADR-0054 Review Closure and Local Hook Delivery

Date: 2026-10-13. Work: [description.md](description.md), [plan.md](plan.md).
Decision: [ADR-0054](../../decisions/0054-git-visible-work-artifacts.md).
Review: [review-1.md](review-1.md). The owner explicitly accepted F1, F2 and F3
in chat. No finding was skipped. The F1-F3 closure sections below retain
historical/pre-delivery source evidence; the separately authorized local-hook
delivery is recorded in the final section.

## Accepted findings

| ID | Changed scope and decision | Evidence and limitations |
| --- | --- | --- |
| F1 | Enforce effective Git exclusion on concrete verification leaves, existing evidence selected for execution, identity and claim files, and their actual temporary destinations. Apply the same owner to runner evidence writes and private review/completion publication temporaries. Refuse nested exceptions and tracked machine evidence with a narrow-ignore diagnostic before writing exposed bytes. Preserve immutable publication, truthful failed/retried/interrupted evidence and own-claim cleanup. | Six focused regressions failed against the pre-fix implementation; the corrected final gate passed all 1581 tests and every default component. Read-only historical decoding retains its original meaning; no older evidence is moved, repaired or unignored. |
| F2 | Remove the unused `legacyCandidates`, `legacyEvidence`, `readHeader` and `directories` closure from `work-binding-history.mjs`. Retain only historical v1/v2 binding decoding and the roles/constants it actually needs. | Reference-aware deletion confirmed no live consumer. Existing historical decoder and old-execution refusal coverage is retained; no discovery or registration API is added. |
| F3 | Correct the maintained Agent Control paragraph to capabilities schema version 7. | Checked against `AGENT_CAPABILITIES_SCHEMA_VERSION = 7`, `banzai-agent-capabilities/v7` and control contract `7.0.0`. No contract bump is needed. |

## Security and design assessment

Security classes 1 and 4: generated paths and raw subprocess records reach the
filesystem. Existing contained-path validation and one shared effective-ignore
check refuse publication of private bytes into Git-visible destinations. The
index is respected for machine evidence; an ignore rule cannot hide an already
tracked identity. Private raw output stays local. No migration, deletion,
force-add, broad unignore or external publication is performed.

Structural trigger: the same filesystem/privacy rule is needed by multiple
existing execution owners. Reuse search considered `work-documents.ignored`,
`execution-ownership.verifyExecutionIgnore`, `project-files.publishNew`, task and
policy verification publishers, `RunStore` writers and the two canonical report
publishers. The rule is extracted into the lower-level `project-files.mjs` owner;
existing exports remain thin projections. Writers retain their own lifecycle,
record schemas, atomic replacement or create-only semantics and cleanup. This
avoids a dependency from filesystem primitives back into execution coordination
and avoids several alternate ignore-rule implementations. `init` and setup establish
the narrow execution ignores before acquiring their bootstrap lock, so the new
boundary protects first use as well as subsequent executions. No generalized storage
service or new subsystem is introduced. The active-run pointer's temporary file
uses the already ignored runs directory because its exact pointer ignore does
not exclude sibling temporaries. The rename remains atomic or fails as I/O.

Disposition: reused/extracted within the accepted findings and approved T002,
T004 and T007. Historical parser meaning and approved authority are unchanged.
Material Engineering Quality deviations: None. Remaining delivery limits are
unchanged.

## Changed files and documentation sync

Production owners: `plugins/banzai/lib/project-files.mjs` and its declaration,
`work-documents.mjs`, `execution-ownership.mjs`, `verification-helper.mjs`,
`task-verification-store.mjs`, `verification-store.mjs`,
`work-binding-history.mjs`; the TypeScript filesystem projection, `store.ts`,
`workflow.ts`, `cli.ts`, `project-setup.ts`, `review-artifact.ts` and completion publication. The explicit
import-boundary map names their lower-level filesystem dependency under ADR-0054.
Generated build
resources follow their existing build owner.

Assurance: `work-documents.test.ts`, `task-verification.test.ts` and
`review-artifact.test.ts`, `review-result-v2.test.ts`, and cancellation and
verification CLI/config fixtures. Direct-executor, cancellation and retained
verification utility fixtures now provide a real Git repository with explicit private
ignores; their launch, mutation, retry, interruption and cancellation assertions
are preserved.

Documentation: `documentation/orchestrator.md`, `packages/orchestrator/MODULES.md`
and this work's implementation,
test and change reports. Manifest facts already describe the same fixed paths,
contracts and private evidence boundary; no new current-state fact is needed.
Accepted ADR/description/plan bytes and review-1 are preserved. ADR conformance:
the fixes satisfy the existing private-evidence and removal requirements, with
no lifecycle or architecture decision change.

## F1-F3 verification and assurance critique (historical/pre-delivery)

The unchanged mandatory release-candidate gate passed freshly: 1581 tests,
zero failed/cancelled/skipped/todo; typecheck, lint (0 errors, 382 advisory
warnings), build/resources, formatting, release/version/instruction checks,
actual source/plugin/npm payloads and committed CLI smoke all passed.
`git diff --check` passed. Supplemental actual batches passed 114, 59 and 45
cases respectively, with overlap; see [test-report.md](test-report.md) for their
exact scope and private native origins. The initial fix gate failed lint; the
next failed legacy Git fixtures/bootstrap. Both failures were resolved before
the fresh final run and remain labeled as failed historical origins.

Final candidate SHA-256:
`10644445cefcee4a25efefdf8d32aa80c196488965ac43b2c57b91486452b8ce`.
Post-gate inputs matched that capture before finalizing the three work reports.
Pre-delivery source-fix native gate output:
`.banzai/verification/74816e2fd54e15645a1278e9a160ccd3d00e927149bff2ce185b7586ea78171c/manual-release-f1-f3-10644445cefcee4a.log`.
It is manual execution evidence, not helper applicability or runner authority.
Earlier 1572-test evidence is historical/pre-fix. The existing v1 completion table
is refreshed with the same eight ordered task records and completed statuses.

The new cases protect the reproduced nested log/record exceptions, exposed
temporary outputs, changed ignores with an existing identity, tracked identity,
and runner private writes. Existing tests continue to own ordinary success,
failure, explicit retry, interruption, recovery, immutable origin chains and
canonical report publication. No test quota, provider simulation or substitute
release command is introduced. Independent resolution review follows fresh
verification and receives only accepted IDs, current authority and bounded
evidence, without builder transcripts.

## Owner-authorized local-hook delivery

Date: 2026-10-13. Authority: explicit owner instruction to apply the prepared
patch, delete `.banzai/artifacts.json` and update the manifest. This is the
separate local delivery required by approved T006, not a new finding, ADR
amendment, plan edit or source-release acceptance.

Applied the exact hash-checked patch to checkout-local
`.git/hooks/banzai-publication/pre-push.mjs` and `publication-check.mjs`.
Removed the obsolete declaration and its `.gitignore` exception; corrected
`AGENTS.md` and `PROJECT_MANIFEST.md` to describe current facts. The delivery,
implementation and test reports now distinguish applied local delivery from
earlier source gates. The original hook wrapper, installed legacy test file,
accepted ADR/description/plan bytes, historical work and remote configuration
remain unchanged. No review finding was skipped or reopened.

Security class 1: the existing trusted installed checker continues inspecting
untrusted raw Git objects without executing pushed checkout code. Class 4:
private data and machine evidence remain excluded, including deleted-later
history, verification records and execution locks. Class 7: deletion is limited
to the explicitly selected obsolete declaration; hook fixtures push only to
disposable local bare repositories. No real remote publication occurred.

Design disposition: reused the approved T006 installed-guard boundary and exact
prepared patch; the frozen installed checker remains separate from untrusted
checkout code. No new owner, dependency or lifecycle was introduced. Material
Engineering Quality deviations: None. ADR-0054 conformance and existing
historical evidence custody remain unchanged apart from the expressly authorized
declaration removal.

Verification: all three original hashes matched, patch dry-run passed, installed
bytes match the tested patch, both modules passed `node --check`, and the
unchanged wrapper passed `sh -n`. The supplied fixture suite passed 17/17 tests
against copies of the installed files. Assurance critique: existing real-Git
fixtures cover both no-declaration success and retained privacy/history refusal;
no duplicate tests were authored. Exact command, hashes and native origin are in
[local-hook-delivery.md](local-hook-delivery.md#current-delivery-status).
The earlier 1581-test source gate is historical/pre-delivery evidence for its
recorded source snapshot and was not rerun for this bounded local delivery.
Installed-client/model acceptance and external publication remain unverified.
