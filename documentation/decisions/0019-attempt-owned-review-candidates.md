# ADR 0019: Attempt-Owned Review Candidates

Publication note (2026-09-09): private operational identifiers were removed at
the project owner's request. The accepted decision and lifecycle are unchanged.

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-17
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-17

## Related Artifacts

- Feature description:
  `documentation/features/durable-review-candidate-evidence/description.md`
- Planned development plan:
  `documentation/development-plans/durable-review-candidate-evidence/plan.md`
- Repository authority: `AGENTS.md`
- Manifest: sections 3, 5, 6, 8, 9, and 10 of `PROJECT_MANIFEST.md`
- Related ADRs:
  - ADR 0002, Session affinity and bounded reviewer continuity
  - ADR 0003, Versioned evaluation export contract
  - ADR 0004, Privacy-minimized read-only evaluation boundary
  - ADR 0005, Traceable evaluation aggregation
  - ADR 0013, Risk-driven test assurance
  - ADR 0015, Durable verification attempt ledger
  - ADR 0017, Versioned plan task completion ledger

## Context and Decision Drivers

Review execution currently treats a successful vendor process and a validated
review artifact as one completion boundary. `executeReview()` obtains an
`AdapterResult`, allows Claude reviewer-write mode to write the future
canonical Markdown path or renders that path for Codex, validates the Markdown,
and only then calls `completeAttempt()`.

If validation throws before `completeAttempt()`, `failAttempt()` records the
attempt as failed but retains stdout and stderr only for `ProcessExitError`.
It persists a typed `failureCode` only for the special plan-task-completion
case. The returned structured review, session, usage, ordinary typed
`BanzaiError` code, and available process streams are therefore lost from the
canonical attempt record.

The sandbox project run
`[historical run identifier omitted]`
demonstrates the consequence. Attempt `review-2-f09d97a7` failed with
`INVALID_REVIEW_ARTIFACT` semantics, but its record has `result`,
`rawStdoutPath`, `rawStderrPath`, and `failureCode` set to `null`. Claude had
already written the future `review-1.md` path. Retry reused that unfinished
iteration and replaced the invalid candidate with a valid artifact, so the
failed candidate cannot now show whether the approved ADR path was absent or
only formatted differently.

The current missing-scope diagnostic comes from a generic literal-substring
helper and says the artifact is "missing approved artifact scope." That wording
can be read as a missing approved file rather than a missing listing inside the
candidate. The exact backtick-delimited substring check also makes harmless
Markdown presentation part of the fail-closed contract.

Current and target differ as follows:

- current reviewer output may occupy the future canonical Markdown path before
  validation; target keeps every unvalidated candidate under attempt ownership
  and publishes only after successful validation;
- current downstream validation can discard a successful adapter result and
  its outputs; target captures them before validation can fail;
- current ordinary typed validation errors lose their stable code; target
  persists every available `BanzaiError` code;
- current retry can overwrite the only invalid candidate; target assigns each
  retry a distinct evidence path while repeating the unfinished review
  iteration;
- current evaluation sees canonical attempt and review records but ignores raw
  result files; target preserves that precedence and also excludes candidate
  content and candidate-only metadata;
- current Claude reviewer-write and Codex runner-rendered modes produce the
  same artifact format through different write owners; target preserves both
  modes and reviewer-authored prose while adding a validated publication
  boundary.

Decision drivers:

- keep missing approved-scope coverage fail-closed;
- distinguish a non-canonical candidate from a canonical review artifact;
- retain enough redacted evidence to diagnose downstream validation failures;
- preserve typed error identity across process, validation, persistence, and
  status boundaries;
- keep retry idempotent with respect to prior attempt evidence;
- preserve reviewer independence, exact-path authorization, source-read-only
  enforcement, human triage, and immutable approved artifacts;
- preserve historical runs and the `banzai-evaluation-export/v1` privacy and
  canonical-evidence contract;
- reduce avoidable model-formatting failures without manufacturing reviewer
  scope attestation from runner-owned approval data;
- avoid a new dependency or broad persisted-state migration.

## Options Considered

### Option 1: Keep direct canonical-path writes and enrich failure metadata

Continue letting Claude write, and Codex rendering, the future canonical path.
Immediately after the adapter returns, copy the file and process outputs into
the attempt record. On validation failure, mark the copy non-canonical and
delete or restore the repository path.

Benefits:

- smallest change to prompts, hook expectations, and adapter inputs;
- preserves the literal current reviewer-write destination;
- can retain the typed code, streams, structured result, and a copied
  candidate.

Costs and rejection reason:

- an unvalidated file still occupies or replaces the canonical-looking path
  during execution;
- safe cleanup requires backup and restoration rules for existing bytes,
  interruption, cancellation, and retry;
- a crash between model write and snapshot can still leave candidate evidence
  without attempt ownership;
- file presence remains easy to confuse with canonical state even though the
  runner has not validated it.

Rejected because diagnostic copies do not create a clean validation and
publication boundary.

### Option 2: Stage one attempt-owned candidate and promote it after validation

Give every review attempt a distinct candidate evidence path in its run-owned
`attempts/` boundary. Claude reviewer-write mode may use only `Write` to that
exact designated candidate path; Codex remains source-read-only and the runner
renders its structured result to the same kind of attempt-owned path.

Persist the adapter result, redacted streams, session, usage, duration, and
candidate metadata before validation. Validate the candidate against the
structured result, intended canonical path, deterministic runner evidence, and
the complete approved scope. Scope validation accepts harmless Markdown
presentation around an exact path but no basename, substring, fuzzy, or
out-of-scope match.

On failure, keep the candidate and metadata with `canonical=false`, the exact
diagnostic, and the typed failure code. On success, atomically publish the
validated bytes to the normal `review-<iteration>.md` path and bind the
canonical review JSON and state only to that successful attempt. Retry creates
a new candidate path and never edits the failed attempt's evidence.

Benefits:

- creates an explicit candidate-to-canonical transition;
- preserves the two existing review modes, exact single-path write authority,
  and reviewer-authored prose;
- removes retry overwrite and backup/restore ambiguity;
- makes downstream validation evidence durable even when the vendor process
  itself succeeded;
- keeps invalid content out of canonical review state and evaluation while
  still allowing evaluation to count the failed attempt;
- supports additive metadata on schema-version-1 attempt records, so historical
  records need no migration.

Costs and risks:

- reviewer-write prompts, adapter context, the packaged hook, live
  compatibility probes, documentation, and tests must distinguish candidate
  and intended canonical paths;
- the runner owns a new atomic publication step and recovery ordering;
- Claude can still produce invalid Markdown, although semantic exact-path
  validation removes harmless quoting and bullet differences;
- attempt-owned candidates may contain sensitive model output and must follow
  the existing retention and redaction policy;
- an already lost historical candidate cannot be reconstructed.

### Option 3: Runner-render every canonical artifact from structured review

Remove model ownership of Markdown layout. Both vendors return only structured
`ReviewResult`; the runner renders all boilerplate, approved-scope metadata,
verification evidence, task-completion evidence, and reviewer prose into the
canonical artifact.

Benefits:

- eliminates Markdown-formatting failures for deterministic fields;
- unifies Claude and Codex publication behavior;
- simplifies canonical artifact validation because the runner creates the
  expected format;
- retains summary, findings, reproduction, acceptance, and deferred-coverage
  prose already authored in the structured result.

Costs and rejection reason for this change:

- removes the existing Claude reviewer-write contract and changes the live
  authorization capability being tested;
- the current structured result has no reviewer-authored list of reviewed
  approved paths;
- rendering `planApproval.paths` directly would prove only what the runner
  supplied, not what the reviewer explicitly listed, weakening the current
  fail-closed scope-attestation boundary;
- safely adopting this option requires a versioned structured reviewed-scope
  contract, historical compatibility rules, and a separate decision about the
  reviewer-write authorization surface;
- it would discard independently worded Markdown that the current validator
  deliberately permits beyond the structured result fields.

Runner rendering would remove the observed class of literal formatting error,
but adopting it now would either weaken approved-scope evidence or expand this
defect fix into a versioned review-contract replacement. Rejected for this
change; it remains a viable future decision after a structured reviewer-owned
scope field exists.

### Option 4: Retain only process streams and raw structured output

Keep the current write flow and treat redacted stdout, stderr, and vendor raw
result files as sufficient diagnostic evidence.

Benefits:

- no new candidate lifecycle or publication step;
- process evidence can explain many adapter and schema failures.

Costs and rejection reason:

- raw result files are deliberately non-canonical and Claude output may not
  preserve the exact Markdown bytes written through its tool;
- the observed defect specifically requires the invalid candidate to
  distinguish content absence from formatting;
- retry still overwrites the repository path;
- making raw result files canonical would violate existing evaluation rules.

Rejected because it neither preserves the decisive evidence nor separates
candidate from canonical state.

## Decision

Adopt Option 2.

Create one attempt-owned review candidate for every physical review attempt.
Keep Claude in reviewer-write mode with exact single-path `Write`
authorization, but bind that authorization to the active attempt's candidate
path. Keep Codex in runner-rendered mode under its read-only sandbox and render
its candidate from the authoritative structured result. Never let either model
write the intended canonical review path directly.

Treat the candidate path and the intended
`documentation/features/<slug>/review-<iteration>.md` path as distinct
identities. Validate candidate contents against the structured review,
deterministic evidence, intended canonical identity, and complete approved
scope. Recognize an exact approved path within the review-scope section across
harmless Markdown quoting and bullet presentation, but reject partial, fuzzy,
basename-only, or out-of-section matches. Use `INVALID_REVIEW_ARTIFACT` with
this message when that check fails:

```text
Review artifact does not list required approved-scope path: `<path>`.
```

Capture a returned adapter result and its redacted stdout and stderr under the
attempt before downstream artifact validation. Preserve the structured result,
session, usage, and timing as diagnostic source evidence even if validation
then fails. Persist every available `BanzaiError.code` in `failureCode` and the
exact message in `error`.

Add bounded optional review-candidate metadata to schema-version-1 attempt
records. It must identify source mode, evidence path, intended canonical path,
content digest, validation disposition and failure, and whether the candidate
is canonical. Historical records without this metadata remain valid and are
not migrated.

On validation failure, leave the candidate attempt-owned and explicitly
non-canonical. Do not create or update canonical review JSON, `latestReview`,
completed review state, or the canonical Markdown path. On validation success,
atomically publish the validated bytes to the intended canonical path and bind
review JSON and state to that successful attempt through the existing review
application path. Recovery must reconcile only validated publication evidence;
it must never infer success from candidate presence.

Keep candidate files, candidate-only metadata, vendor raw result files, exact
errors, and streams outside the `banzai-evaluation-export/v1` canonical review
input. Evaluation may continue to consume the schema-version-1 attempt's
`status=failed` outcome, but it must not consume that attempt's structured
verdict or findings as a canonical review. Raw result files remain
non-canonical completion evidence.

Do not replace reviewer-write mode with unified runner rendering in this
change. Preserve reviewer-authored Markdown prose and the current independent
reviewer role. A future unified renderer requires its own accepted decision and
a versioned reviewer-authored structured scope acknowledgment before it can
replace the current fail-closed listing requirement.

## Consequences

Positive consequences:

- every invalid review candidate remains auditable after retry;
- typed validation codes, exact diagnostics, process output, structured result,
  session, usage, timing, and candidate bytes survive the downstream failure;
- invalid candidates never occupy the canonical artifact path;
- distinct attempt paths make retry evidence immutable by construction;
- exact scope listing remains reviewer-authored and fail-closed while harmless
  Markdown presentation stops causing literal-substring failures;
- existing historical attempts and evaluation export semantics remain
  compatible without migration;
- Claude reviewer-write and Codex runner-rendered modes retain their different
  security owners and common canonical format.

Negative consequences and risks:

- candidate staging and atomic publication add lifecycle and recovery logic;
- the packaged authorization hook and live compatibility evidence must move
  from the final artifact path to the active attempt's candidate path without
  broadening write permission;
- attempt storage grows by one bounded Markdown candidate for each review
  attempt;
- reviewer-written Markdown can still fail meaningful structural or semantic
  validation;
- evidence missing from runs created before this decision remains
  unrecoverable;
- documentation must clearly explain that an attempt candidate is diagnostic
  evidence, not a canonical review or completion artifact.

Required follow-ups:

- implement attempt evidence capture before downstream validation and general
  typed `BanzaiError` code persistence;
- implement attempt-owned candidate paths, metadata, validation, atomic
  publication, and recovery rules;
- update reviewer-write prompt and exact-path hook behavior without granting
  source or runner-state writes;
- keep evaluation's fixed allow-list explicit about candidate exclusion;
- update status, README, manifest, live compatibility, and committed bundle
  facts;
- add the risk-oriented assurance required by the feature description.

## Compliance and Confirmation

Implementation and review must confirm all of the following:

1. a candidate missing an approved-scope path fails before canonical
   publication or workflow advancement;
2. the stable diagnostic names the review artifact's missing listing and exact
   required path without suggesting the approved file is absent;
3. an ordinary typed artifact-validation failure persists its exact
   `BanzaiError` code and message;
4. a successful adapter result followed by validation failure retains redacted
   stdout and stderr, structured result, session, usage, duration, candidate
   bytes or equivalent source evidence, digest, source mode, intended path,
   failed validation, and non-canonical disposition;
5. retry uses a distinct attempt-owned candidate, preserves failed evidence,
   repeats the unfinished iteration, and publishes only the validated
   replacement;
6. an invalid later candidate leaves any earlier canonical review artifact,
   review JSON, and `latestReview` unchanged;
7. evaluation counts the failed attempt when valid but excludes candidate
   content, failed structured verdict or findings, candidate-only metadata, and
   raw result files from canonical review evidence;
8. historical schema-version-1 records remain readable with no invented
   evidence or migration;
9. valid Claude reviewer-write and Codex runner-rendered flows still publish
   compatible `banzai-feature-review/v1` artifacts;
10. status continues to recommend `banzai retry` for this recoverable failure;
11. exact-path authorization, source-read-only enforcement, approval and
    workflow digests, workspace drift, independent review, immutable approved
    artifacts, human triage, and accepted-only fix scope remain fail-closed;
12. focused risk tests, the applicable manifest gates, committed distribution,
    documentation, and `git diff --check` all pass or are reported explicitly
    as failed, skipped, or unavailable.

## Lifecycle Links

- Supersedes: None
- Superseded by: None
- Amended by [ADR-0037](./0037-unified-runner-rendered-review-artifacts.md),
  accepted 2026-09-08: new attempts use independently versioned reviewer-owned
  scope acknowledgment and runner rendering instead of reviewer-write mode.
  Candidate isolation, publication integrity and historical semantics remain
  binding.
