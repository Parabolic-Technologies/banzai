# Development Plan: Planning Gate Rework and Independent Planning Review

Slug: `planning-rework-and-review`

Status: Prepared for owner approval; implementation has not started.

- Requirements: [description.md](description.md), FR1-FR42, user stories 1-12
  and Resolved Assumptions 1-20. Resolved Assumption 20 records the owner's
  decision PR-D5 = A (a named exception to PR-D3 parity for escape-inflated
  control documents). The description is approved only as part of this bundle;
  approval binds these exact requirement bytes.
- Governing decision: accepted
  [ADR-0055](../../decisions/0055-planning-gate-rework-and-independent-planning-review.md).
- Amended binding decisions, each as amended by ADR-0055: ADR-0018 (major
  control revision), ADR-0028 (context-ledger attempt vocabulary), ADR-0031
  (`planning_review_triage` pending kind and inert-text conventions), ADR-0034
  (human-time anchor and responses), ADR-0037 and ADR-0054 (second
  runner-rendered numbered review family in the flat work directory) and
  ADR-0042 (`planning-review` instruction phase).
- Unchanged binding decisions: ADR-0002/0021 (code-review reviewer
  continuity), ADR-0013/0014 (assurance and human-triaged closure), ADR-0022
  (Serena MCP whitelist), ADR-0023 (durable terminal attempt checkpoints),
  ADR-0027 (security), ADR-0029 (import boundaries), ADR-0030/0050 (quality
  and triggered design assessment), ADR-0033 (release identity), ADR-0035
  (cancellation observation v1), ADR-0038 (plan authority), ADR-0043
  (equivalent verification evidence), ADR-0044 (instruction baseline
  evolution), ADR-0047 (runner-owned completion projection), ADR-0049
  (task-scoped verification), ADR-0051 (acceptance-time digest validation) and
  ADR-0052 (pure domain rules and capability slices). Their accepted records are linked from the
  [decision log](../../decisions/README.md).
- Current facts: [PROJECT_MANIFEST.md](../../../PROJECT_MANIFEST.md), sections
  2-6, 8 and 10; [MODULES.md](../../../packages/orchestrator/MODULES.md),
  entries for `workflow.ts`, the `workflow/` domain, attempt, checkpoint and
  verification modules, `store.ts`, `state-machine.ts`, `types.ts`,
  `validation.ts`, `contracts.ts`, `output-contract.ts`, `review-artifact.ts`,
  `work-documents.ts`, `adapters.ts`, `prompts.ts`, `phase-instructions.ts`,
  context accounting, human time, cancellation, `interactive.ts`,
  `inquirer-io.ts`, `cli.ts`, agent control and the release scripts; root
  [AGENTS.md](../../../AGENTS.md).
- Inspected source baseline: `ead9f32` plus the then-uncommitted ADR-0054
  working tree. That work has since been committed as v2.7.0 (`8a7ff64`), which
  is not tagged or published. Revalidate owners against the implementation
  checkout before edits.

## Plan Authority

Applicable approved requirements, accepted ADR constraints, public and persisted
contracts, security and authorization boundaries, transaction and lifecycle
guarantees, compatibility, scope, and required verification evidence are binding.
Exact internal details remain binding when required by applicable authority or
concrete constraints; unlabelled explicit directives remain binding.

Only paragraphs or list items prefixed `Optional implementation guidance:` are
non-binding suggestions. A label covers that paragraph or list item, including
its nested content, and ends before the next sibling block. A different compliant
implementation within approved scope needs no reapproval, finding or deviation
report merely for differing from this guidance.

Guidance never overrides binding authority or expands scope. Resolve conflicts
and ambiguous commitments before dependent work; missing or ambiguous optionality
does not waive an explicit commitment.

## Technical Breakdown

### Current behavior and target

| Current implementation                                                                                                                                                                              | Accepted target                                                                                                                                                                                                                | Task owner                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `needs_plan_approval` leads only to `plan_approved`, `cancelled` or `blocked`; the plan gate offers approval, cancellation and exit                                                                 | Approval, rework with mandatory feedback, independent planning review and cancellation; rework returns to planning without approval                                                                                            | T004, T008, T011, T012       |
| ADR rework exists with an optional note; `decideAdr` replaces an earlier decision for the same ADR, so an earlier rework note is lost                                                               | Non-empty, inert rework feedback on every surface; state v10 also keeps an `adr_rework` history record                                                                                                                         | T002, T003, T008, T011, T012 |
| No planning review; code review requires plan approval and a sealed snapshot                                                                                                                        | Optional, human-initiated planning-review loop inside the ADR and plan gates: read-only reviewer, runner-rendered `planning-review-<N>.md`, read-only planner analysis, human triage, then exact application or a gate restore | T002-T005, T009, T010        |
| Unreleased state v9, control `7.0.0` (capabilities v7, status v5), context ledger and report v1, six instruction phases; `v2.6.6`, the latest published release, ships state v8 and control `6.0.0` | State v10, control `8.0.0` (capabilities v8, status v6) with two new stdin documents, context v2 and seven instruction phases                                                                                                  | T003, T006, T012             |
| ADR-0054's reciprocal ADR-0055 lifecycle link was deferred because the pinned ADR-0054 authority image would fail `release:validate`                                                                | The exact accepted annotation image is admitted only while ADR-0055 is Accepted                                                                                                                                                | T001                         |

ADR-0055 is the authority for every transition below. The plan neither repeats
its option analysis nor reopens its rejected options.

### Versions and identities

| Surface           | Fixed identity                                                                                                                                                                                                                                                                | Rule                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Run state         | `RUN_STATE_SCHEMA_VERSION` 10; schemas 1-9 stay readable                                                                                                                                                                                                                      | New runs start at 10. Continuing a run below 10 is outside this transition, following the existing precedent; no state is promoted in place.                                                                                                                                                                                                     |
| Attempt kinds     | `planning_review`, `planning_analysis`                                                                                                                                                                                                                                        | Both are created with `mutable: false`. Attempt ids are `planning-review-<N>-<8 hex>` and `planning-analysis-<N>-<8 hex>`, where `<N>` is the episode's review number. Attempt record files use the same hyphenated tokens: `<attempt id>-planning-review.json` and `<attempt id>-planning-analysis.json`. Attempt record schema 4 is unchanged. |
| Reviewer result   | `banzai-planning-review-result/v1`, schemaVersion 1, file `plugins/banzai/contracts/v1/planning-review-result.schema.json`, manifest key `planningReviewResult`, output identity `planning-review-result/v1`                                                                  | Closed schema with `contractVersion`, `schema` and `schemaVersion` identity constants.                                                                                                                                                                                                                                                           |
| Planner analysis  | `banzai-planning-review-analysis/v1`, schemaVersion 1, file `plugins/banzai/contracts/v1/planning-review-analysis.schema.json`, manifest key `planningReviewAnalysis`, output identity `planning-review-analysis/v1`                                                          | As above.                                                                                                                                                                                                                                                                                                                                        |
| Umbrella contract | `contractVersion` `1.0.0`                                                                                                                                                                                                                                                     | Unchanged; the two families are additive, following the ADR-0031 precedent. Phase-result v4, review-result v1/v2, workflow selection and the decision-consultation subschema stay byte-identical.                                                                                                                                                |
| Rendered artifact | `banzai-planning-review/v1`; file `planning-review-<N>.md` in the bound work directory                                                                                                                                                                                        | Runner-rendered and create-only; never part of an approval bundle.                                                                                                                                                                                                                                                                               |
| Decision state    | pending kind `planning_review_triage`; record kinds `plan_rework`, `adr_rework`, `planning_review_triage`                                                                                                                                                                     | State v10 only.                                                                                                                                                                                                                                                                                                                                  |
| Human time        | anchor kind `planning_review_triage`; ledger identity unchanged                                                                                                                                                                                                               | ADR-0034 amendment; vocabulary widening only.                                                                                                                                                                                                                                                                                                    |
| Context           | `banzai-context-attempt/v2`, `banzai-context-report/v2`                                                                                                                                                                                                                       | v1 ledgers and their semantics stay readable.                                                                                                                                                                                                                                                                                                    |
| Instruction phase | `planning-review`, resource `plugins/banzai/phases/planning-review.md`                                                                                                                                                                                                        | Seventh runner phase (ADR-0042 amendment).                                                                                                                                                                                                                                                                                                       |
| Agent control     | contract `8.0.0`; `banzai-agent-capabilities/v8` (schemaVersion 8); `banzai-agent-status/v6` (schemaVersion 6); `banzai-agent-gate-decision/v1` read by `banzai control decide` (capability operation `decideGate`); `banzai-agent-answer/v4` read by `banzai control answer` | Request v1, answers v1-v3 and recovery v1 keep their meanings. Only the current capabilities and status documents are served.                                                                                                                                                                                                                    |
| Release train     | the pending working-tree version                                                                                                                                                                                                                                              | Never chosen by implementation (see Human prerequisites).                                                                                                                                                                                                                                                                                        |

### Run state, planning-review episodes and lifecycle

State v10 is a strict superset of v9 plus one required field, `planningReview`,
which is absent on every earlier schema. Its value is
`{ "active": <episode> | null, "closed": [<episode>, ...] }`. Closed episodes
stay in run order for the life of the run. The name is distinct from human-time
"episodes". An episode records:

- `episodeId`: an opaque `planning-episode-<8 lowercase hex>` identifier,
  unique in the run and never equal to an attempt id;
- `reviewNumber` (`<N>`), a safe integer from 1 to 1,000,000;
- `originGate`: `adr_approval` or `plan_approval`;
- `scope`: a non-empty list of `{ "path", "sha256" }` in gate artifact-set
  order with unique paths;
- `requestedAt` and `decidedBy`;
- `reviewer`: `{ "executable", "model", "effort" }`, null until the first
  `planning_review` attempt is created. The state write that creates each
  `planning_review` attempt, including a same-episode retry, sets it to the
  currently configured `reviewer` role settings, where `executable` is the
  basename of the configured executable. It changes only while the review is
  unpublished and never after publication. It therefore always names the
  settings of the attempt whose result is published;
- `step` (active only): `reviewing`, `analyzing`, `awaiting_triage` or
  `applying`;
- `reviewAttemptId`, `reviewSessionId` and `analysisAttemptId`, null until
  known;
- `applyingAttemptId`: null until the first applying `plan` attempt is created;
  it is set in the same state write that creates that attempt, and later
  applying attempts never change it. Store validation allows a non-null value
  only at step `applying` or for the outcomes `applied` and `cancelled`;
- `resultDigest`, `findingCount`, `artifact` (`{ "path", "sha256" }`) and
  `analysisDigest`, null until established;
- `outcome` and `closedAt` (closed only), where `outcome` is
  `restored_no_findings`, `restored_no_action`, `applied`, `stale` or
  `cancelled`.

The pending `planning_review_triage` request carries `runId`, `episodeId`,
`reviewNumber`, `originGate`, `artifactPath`, `artifactSha256`, `resultDigest`,
`analysisDigest`, the validated `findings`, the validated `analysis` entries and
`requestedAt`. The new history records are:

- `plan_rework`: `feedback`, `bundleDigest`, `decidedBy`, `decidedAt`;
- `adr_rework`: `adrId`, `feedback`, `decidedBy`, `decidedAt`;
- `planning_review_triage`: `runId`, `episodeId`, `reviewNumber`,
  `analysisDigest`, `dispositions` (one per finding, in review order:
  `findingId`, `kind` = `option` | `instruction` | `decline`, `optionId`,
  `instruction`), `additionalInstruction`, `decidedBy`, `decidedAt`.

Finding and analysis text lives in state only while the triage is pending; the
recorded triage keeps identities, dispositions and human text. `adrDecisions`
keeps its replace-by-id current decision and its note; each ADR rework also
appends an `adr_rework` record, and the planner receives both. Historical ADR
decisions with a null rework note stay readable and are never rewritten.

Store validation of v10 state is a closed switch over pending and record kinds:

- the pending triage exists exactly when the status is `needs_human_decision`
  and the active episode is at `awaiting_triage` with the same episode id,
  review number, artifact and digests;
- an active episode at `reviewing` or `analyzing` accompanies `planning` or
  `blocked`; `applying` accompanies `planning`, `blocked` or an escalation at
  `needs_human_decision`; `done` and `cancelled` have no active episode;
- episode ids and review numbers are unique across active and closed
  episodes; a triage record references a known episode, matches its analysis
  digest and finding count, uses finding ids of that review number and appears
  at most once per episode;
- human text in records passes the shared free-text rule; the reviewer
  executable is a basename; scope entries are canonical and unique.

On schemas 1-9 the new field, pending kind, records and attempt kinds are
rejected, and nothing is fabricated. A v10 state never reaches the legacy v1
normalizer. Existing pending kinds and records keep their exact validation.

Transitions. `needs_plan_approval → planning` becomes an ordinary transition.
`needs_human_decision → needs_adr_approval | needs_plan_approval` is permitted
only through a structural guard over persisted state: the state is v10; the
active episode is at `awaiting_triage`; the newest history record is a
non-actionable `planning_review_triage` record for that episode and analysis
digest; the target equals the episode's `originGate`; no attempt or process is
active; and the pending decision is the matching triage or already cleared. The
byte check stays outside the state machine, in the pure gate-restore rule below.
Every other transition and the configuration-continuation guard are unchanged.
A review request at the ADR gate and a zero-findings restore use the existing
`needs_adr_approval → planning` and `planning → needs_*_approval` edges.

An episode closes:

- as `restored_no_findings` when a zero-findings review restores its gate;
- as `restored_no_action` when a non-actionable triage restores its gate;
- as `applied` when the applying `plan` attempt's result is applied at
  `adr_approval`, `plan_approval` or `decision_consultation`; an escalation or
  a blocked result leaves it at `applying`, so the continuing `plan` attempt
  still receives the recorded dispositions;
- as `stale` on a stale block;
- as `cancelled` when the run is cancelled.

The new pure ADR-0052 domain module `src/workflow/domain/planning-review.ts`
owns, over facts the runner gathers (time and digests are inputs):

- gate-action availability per gate and state version;
- scope membership: a non-empty, duplicate-free subset of the gate artifact
  set, compared by exact path string and returned in set order;
- the next review number: 1 + the larger of the highest number in the run's
  episodes and the highest valid `planning-review-<k>.md` in the work
  directory, failing closed beyond the bound;
- episode-step dispatch for resume, retry and reconciliation;
- episode advance and close values;
- the actionable classification: at least one `option` or `instruction`
  disposition, or a non-empty additional instruction;
- the stale verdict (recorded versus gathered digests, with changed paths);
- gate-restore eligibility: non-actionable triage, unchanged digests and a
  target equal to the origin gate.

The gate artifact set has one owner, `src/workflow/domain/artifact-scope.ts`.
At the plan gate it is the description, every `planArtifacts.adrs` path and the
plan, in approval-bundle order. At the ADR gate it is the description when it is
non-null plus every `planArtifacts.adrs` path, the same ADR set agent control
projects today; a null description never throws there.

| Persisted facts                                                                          | Resume                                                                                                                         | Retry                                                                                                                                                                                                                                                                                | Reconcile                                                     |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `planning` (`blocked` for retry), active step `reviewing`, no `artifact` recorded        | review step                                                                                                                    | review step of the same episode and scope                                                                                                                                                                                                                                            | revalidate the result, rehash, publish idempotently, continue |
| `planning` or `blocked`, active step `reviewing`, `artifact` recorded, no active attempt | no model call: continue from the post-publication point (zero findings: restore rehash and restore; otherwise set `analyzing`) | same as resume                                                                                                                                                                                                                                                                       | same as resume                                                |
| `planning` (`blocked` for retry), active step `analyzing`                                | analysis step                                                                                                                  | analysis step of the same episode                                                                                                                                                                                                                                                    | revalidate, rehash, open the triage gate                      |
| `needs_human_decision`, step `awaiting_triage`                                           | no model call                                                                                                                  | not applicable                                                                                                                                                                                                                                                                       | not applicable                                                |
| `planning` or `blocked`, step `applying`                                                 | ordinary `plan` attempt with the triage evidence                                                                               | ordinary planning retry rules                                                                                                                                                                                                                                                        | ordinary plan reconciliation                                  |
| `blocked` from `planning`, no active episode, latest closed outcome `stale`              | not applicable                                                                                                                 | new episode on the same paths at current bytes, next `<N>`, same origin gate; if a recorded path cannot be read by the contained rule below, no episode is created and the run stays blocked with exactly `Planning review cannot restart: <path> is missing or not a regular file.` | not applicable                                                |
| any other combination of episode step and attempt kind                                   | block as inconsistent                                                                                                          | block as inconsistent                                                                                                                                                                                                                                                                | block as inconsistent                                         |

Dispatch never falls through to ordinary planning for `reviewing`, `analyzing`
or `awaiting_triage`. A step blocked before its attempt exists, for example by
an instruction-parity or vendor preflight refusal, stays retry-eligible as a
repeat of the same step.

Staleness. The runner rehashes the recorded scope with plain SHA-256:

- immediately before every `planning_review` or `planning_analysis` attempt,
  including retries, so a stale scope never costs a model call;
- before publishing the review;
- before opening the triage gate;
- when it receives a triage answer, before recording it;
- immediately before creating an applying `plan` attempt while the episode's
  `applyingAttemptId` is null (once an applying attempt exists, ordinary
  planning retry rules apply, because that attempt legitimately edits the
  bundle; an escalation answered during `applying` therefore never produces a
  stale block);
- before restoring a gate.

Every rehash point and the stale-retry episode creation use the same contained,
`O_NOFOLLOW`, regular-file-only read as the review request. A member that is
missing, is not a regular file or is reached through a symlink produces a stale
verdict at that point, with its path in `changedPaths`.

On a mismatch nothing is published, no answer is recorded and no model is
invoked. Any completed attempt keeps its record but its result is not applied.
The run moves to `blocked` with `blockedFrom: planning` and exactly the reason
`Planning review is stale: reviewed artifacts changed.`; a stale answer at the
triage gate moves `needs_human_decision → planning → blocked` in one write and
clears the pending decision. The episode closes as `stale`. Artifacts that were
already published stay. A retry from that block opens a new episode as in the
dispatch table; this is the no-failed-attempt retry branch. The new episode
keeps the stale episode's paths, origin gate and `decidedBy`; its digests and
`requestedAt` are taken at the retry, and its reviewer settings are recorded
when its first `planning_review` attempt is created.

Retry and interruption. Failed and interrupted `planning_review` and
`planning_analysis` attempts are retry-eligible read-only attempts mapped to
`blockedFrom: planning` in both retry-eligibility chains. A retry repeats the
failed step of the same episode with the same scope and keeps the same `<N>`
while the review is unpublished. A retried review step resolves the reviewer
from the current `reviewer` role configuration and records those settings on
the episode when it creates the attempt. An owner who changes the reviewer
model after a failure therefore gets a review by the new model, and an artifact
that names it. A publication conflict (different bytes already
at the destination) fails the review attempt with code
`PLANNING_REVIEW_PUBLICATION_CONFLICT` and reason `Planning review publication
conflict: <artifact path> exists with different content.`; its retry
re-reserves `<N>` by the numbering rule before invoking the reviewer, updating
the active episode's review number while its id stays unchanged. Mutable
recovery and digest-rejected recovery keep excluding both kinds. Interrupted
ordinary `plan` attempts stay non-retryable.

Attempts, sessions and metrics. `newAttempt` never reads `reviewIteration` for
the new kinds. One shared kind-to-file-token mapping names attempt record files
and is used by every reader that enumerates or reconstructs them. Any reader
that gains a runtime import of that mapping records the exact
`import-boundaries.mjs` runtime permission, citing ADR-0055, in the task that
changes the reader. Legacy file names are unchanged, and a planning attempt file
is never classified as a `review` attempt even though its name ends in
`-review.json`. A `planning_review` attempt always starts a fresh session with
the reviewer settings recorded on the episode when it was created. Its session
id is recorded only on the episode. It never reads or
writes `sessions.reviewer`, `reviewIteration`, `latestReview`,
`pendingReviewRotationReason`, review metrics, `reviewFindingCount`,
`review-<N>.md` or `R<N>-F<M>` identities. A `planning_analysis` attempt
resumes a compatible planner session in a read-only invocation, or else starts
fresh with the durable episode records; on success it rebinds
`sessions.planner` to its session, so the applying `plan` attempt resumes the
analysis context. `metrics.attempts` gains optional `planning_review` and
`planning_analysis` counters, absent until first use. Attempt policies for the
new kinds carry no review mode, so `metrics.reviews` never changes.

Optional implementation guidance: keep the kind-to-file-token mapping as one
runtime constant beside the attempt-kind type in `types.ts`.

Availability. On state v10, at a strict run's gate with no active episode, the
ADR gate offers `accept`, `reject`, `rework` and `review`, and the plan gate
offers `approve`, `rework` and `review`. `review` additionally requires a
non-empty gate artifact set. On a readable state below v10, plan rework and
planning review are unavailable on every surface and are refused before
mutation with a historical-run diagnostic. ADR rework there keeps its legacy
record shape, with the note now mandatory, and writes no v10 record.

### Contracts, bounds and the rendered artifact

The reviewer result `banzai-planning-review-result/v1` carries exactly:

- `contractVersion` (`1.0.0`), `schema`, `schemaVersion` (1);
- `reviewNumber`, echoing the runner-supplied `<N>`;
- `scope`, an exact echo of the persisted `[{path, sha256}]` in order, at most
  128 entries;
- `findings`, 0-20 entries in review order, each with:
  - `id` matching `^P[1-9][0-9]*-F[1-9][0-9]*$`, at most 128 characters, whose
    `P` number equals `<N>` and whose `F` numbers are unique;
  - `severity`: `blocker`, `should_fix` or `nit` (the code-review severity
    type);
  - `category`: `requirements`, `acceptance`, `architecture`, `plan`,
    `consistency`, `security`, `testing`, `scope`, `compatibility` or
    `documentation`;
  - `summary` (1-1000);
  - `evidence`, 1-8 items of `path` (canonical repository-relative, 1-300),
    `line` (integer of at least 1, or null) and `detail` (1-500);
  - `suggestedResolution` (1-1200);
  - `confidence`: `high`, `medium` or `low`.

The result has no verdict, summary, snapshot digest, task checks or completion
data. More than 20 findings is invalid reviewer output.

The planner analysis `banzai-planning-review-analysis/v1` carries the identity
fields, `reviewNumber`, `resultDigest` (64 lowercase hex) and `entries`, exactly
one per finding in review order, each with:

- `findingId`;
- `assessment`: `agree`, `partially_agree` or `disagree`;
- `rationale` (1-1200);
- `options`, 1-3 items, each with an `optionId` (canonical identifier, at most
  128), a `label` (1-160) and `consequences` (1-8 strings of 1-500); option ids
  and labels are unique within an entry;
- `recommendation`: null or `{ "optionId", "rationale" (1-1000) }` naming a
  listed option.

Both schemas use the structured-output subset already enforced for shared
schemas: every object is closed and requires all of its properties, enum and
const nodes are typed, and uniqueness is checked by the runtime decoders. The
runtime decoders reuse the consultation-card conventions in `validation.ts`:
exact keys, canonical identifiers and paths, and the shared control and bidi
rejection. Layout whitespace in prose collapses before validation. Every valid
string is therefore single-line and projectable by agent-control status.
Lengths count characters, as for consultation cards.

Digests. Scope, artifact and reviewed-path digests are plain SHA-256 of the file
bytes, lowercase hex, labeled `sha256`; they are not the domain-separated
artifact-bundle hash. `resultDigest` and `analysisDigest` are the existing
`digestCanonicalJson` over the validated document. The plan-rework
`bundleDigest` uses the existing approval-bundle digest owner over the plan
gate's bundle paths, exactly as approval does.

Human free text. One shared validator exported by `validation.ts` owns the rules
for plan and ADR rework feedback, own instructions and the additional
instruction. It records the value trimmed and rejects:

- a required value that is empty after trimming;
- a lone surrogate (a JSON escape such as `\ud800`);
- U+0000-U+0008, U+000B-U+001F (NUL, CR and the other C0 controls except TAB
  and LF) and U+007F-U+009F;
- U+061C, U+200E, U+200F, U+202A-U+202E and U+2066-U+2069;
- more than 8000 UTF-8 bytes for rework feedback and the additional
  instruction, or more than 2000 UTF-8 bytes for an own instruction.

Each surface maps a rejection to its error class (`INVALID_DECISION` for the
runner and the CLI, `INVALID_CONTROL_INPUT` for control documents,
`STATE_READ_FAILED` for persisted records). Rejection happens before any state,
event or model change. The existing consultation, control-answer and decision
text validators keep their frozen meanings.

A triage answer is valid only when:

- it carries exactly one disposition per finding of the pending analysis, in
  any order (recorded in review order);
- an `option` disposition names an option of that finding and has a null
  `instruction`;
- an `instruction` disposition carries valid text and a null `optionId`;
- a `decline` carries neither;
- `additionalInstruction` is null or valid non-empty text;
- its run id, episode id, review number and analysis digest equal the pending
  triage's.

Missing, duplicate, unknown, stale and replayed identities are rejected
atomically. At the FR33 limits an answer carries at most 48,000 bytes of human
text. Encoded as raw UTF-8 JSON (FR30, Resolved Assumption 20), it fits the
64 KiB control limit unless JSON escaping of quotes, backslashes, TABs and LFs
adds roughly 15 KB or more. Such a document fails with `CONTROL_INPUT_TOO_LARGE`
before any mutation or runner call, and the terminal route stays available.
This is the owner's named PR-D3 parity exception (PR-D5 = A). `\u` escaping of
non-ASCII text is outside the supervisor protocol. Neither limit changes.

Rendered artifact. The runner alone renders `planning-review-<N>.md`, only from
a validated result and persisted episode inputs, including the reviewer
settings recorded for the attempt whose result it publishes. It never reads the
current configuration, so rendering, candidate validation and reconciliation
reproduce identical bytes even after a later configuration change. It contains:

- the format marker `banzai-planning-review/v1`, the review number, the origin
  gate and `requestedAt`;
- the reviewer executable basename, model and effort;
- every reviewed path with its `sha256`;
- the result digest and the finding count;
- every finding rendered losslessly with the ADR-0037 fenced-JSON value
  escaping, or an explicit no-findings line.

It contains no run id, repository root, absolute path, session id, prompt or
implementation-review section. Publication is create-only through one primitive
extracted from the code-review publisher. That primitive writes an attempt-owned
ignored temporary file, checks destination visibility and execution ignore,
links into place and verifies again. Identical bytes already at the destination
are an idempotent success, and different bytes are refused. The
ignored-destination helper `publishNew` is not used. Work-document ownership and
inventory recognize `^planning-review-[1-9][0-9]*\.md$`, and binding v3 gains
no role. Creating the file never changes an approval digest, approval snapshot
or `artifactPaths`. Task-verification source exclusions stay limited to
`review-<N>.md`. The attempt-owned candidate uses the suffix
`.planning-review-candidate.md` beside other attempt evidence in the run
directory, never in the code-review results area that evaluation scans.

### Runner flows

Gate commands. The two new `WorkflowRunner` commands and the hardened
`decideAdr` validate free text, `decidedBy` and input shape before taking the
workflow lock. Under the lock the new commands require the gate status, a strict
route, state v10 and no active episode, attempt or process. Each command then
records the request, transitions state, writes state, appends its event and
records the `decision_recorded` human-time boundary; with auto-resume it
continues into the next step. None of them sets `planApproval`, records ADR
acceptance, authorizes implementation or permits an external side effect.
`approvePlan` stays the only transition to `plan_approved`, and an ADR `accept`
decision stays the only acceptance. The commands are:

- Plan rework (for example `reworkPlan`) records `plan_rework` and moves
  `needs_plan_approval → planning`; the next ordinary `plan` attempt resumes a
  compatible planner session, or else starts fresh, with every earlier rework,
  ADR decision and human-decision record. A later approval binds only the bytes
  current at that approval.
- `decideAdr` rejects `rework` without valid feedback with `INVALID_DECISION`
  and the surface-neutral message `ADR rework requires non-empty feedback.`
  before any state or event change. Only rework feedback uses the shared
  free-text validator. Accept and reject notes keep their current, unvalidated
  handling, so no third compatibility break is introduced. On v10 a rework also
  appends `adr_rework`. The `approval.adr` event keeps carrying no note.
- A planning-review request (for example `requestPlanningReview`) accepts the
  whole gate artifact set or an explicit path list. It rejects any path that is
  not an exact member (absolute, `..`, alias or other) and any duplicate with
  `INVALID_DECISION` before mutation, without echoing the raw path. It
  hashes each path with the existing contained, symlink-refusing reads, so a
  member resolved through a symlink fails closed. It reserves `<N>`, creates
  the episode at `reviewing` and moves the gate to `planning`. Reviewer
  settings are recorded when the review attempt is created, not at the
  request.

Review step. Under runner work ownership the executor rehashes. In one state
write it creates the `planning_review` attempt and records the current reviewer
settings on the episode. It runs vendor preflight inside the attempt, so a
check failure is a failed, retry-eligible attempt. It then invokes the
read-only reviewer adapter with exactly this environment: `BANZAI_RUN_ID` set to
the run id, and `BANZAI_APPROVAL_DIGEST`, `BANZAI_WORKFLOW_DIGEST` and
`BANZAI_REVIEW_ARTIFACT` empty or removed, as for planning. The hook therefore
always evaluates the bound run in runner mode and never as a manual session.
The analysis step uses the same environment. The result is validated against
the episode. After the
rehash before publishing, the runner renders and publishes the artifact. It
records the artifact, digests and finding count, and appends the publication
event once. With zero findings, after the restore rehash, it restores the origin
gate through the existing `planning` edges, closes the episode as
`restored_no_findings`, appends the gate-restored event and records the
`gate_pending` human-time boundary. Otherwise it sets `analyzing` and continues.
A cancelled attempt publishes and applies nothing.

Analysis step and triage gate. The executor rehashes, then resumes or starts the
planner as specified, with read-only invocation, the `planning` instruction
phase and early session persistence. It validates the analysis against the
review number, the result digest and the finding set. After the rehash before
triage, it builds the pending triage, sets `awaiting_triage`, moves `planning →
needs_human_decision`, appends the triage-pending event and records the
`gate_pending` boundary. The runner emits no `attempt.applied` event for either
new kind.

Triage answer, application and restore. The runner validates the whole answer
before the lock and revalidates it under the lock against the pending decision
and history. It rehashes, records the triage, clears the pending decision,
appends the triaged event and records the `decision_recorded` boundary.

- An actionable answer sets `applying` and moves `needs_human_decision →
planning`. After the before-apply rehash, an ordinary `plan` attempt receives
  the artifact path, the validated analysis (re-read from the analysis attempt
  record and checked against the episode digest) and the exact recorded
  dispositions through `review_triage_evidence`.
- A non-actionable answer passes the restore check on the same digests, takes
  the guarded transition to the origin gate, closes the episode as
  `restored_no_action`, appends the gate-restored event, records the
  `gate_pending` boundary and calls no model.

`executePlan` refuses to run while the active step is `reviewing`, `analyzing`
or `awaiting_triage`. `applyPhaseResult` closes an `applying` episode as
specified, and it and the reconciliation fallthrough refuse attempt kinds other
than `plan`, `implementation` and `fix`. `answerHumanDecision` reports a precise
`INVALID_DECISION` when the pending kind is `planning_review_triage`.
Cancellation through the existing command closes an active episode as
`cancelled` and keeps it in history.

Status. `WorkflowStatus` gains an optional `planningReview` projection, built
from the shared owners and also emitted by `banzai status --json`:

- `decisions` and `reviewPaths` at the ADR and plan gates;
- `active`: episode id, review number, origin gate, step, artifact path and
  finding count, or null;
- `latest`: the latest closed episode's review number, origin gate, outcome,
  artifact path and finding count, or null.

FR17 and FR41 read this projection.

| Event                            | Detail fields (identities, counts, paths and `decidedBy` only)                                                                                              | Human-time role                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `decision.plan_rework`           | `bundleDigest`, `decidedBy`                                                                                                                                 | response closing the pending `plan_approval` episode      |
| `planning_review.requested`      | `episodeId`, `reviewNumber`, `gate`, `paths`, `decidedBy`                                                                                                   | response closing the pending episode of `gate`            |
| `planning_review.published`      | `episodeId`, `reviewNumber`, `attemptId`, `artifactPath`, `artifactSha256`, `findingCount`                                                                  | none                                                      |
| `planning_review.triage_pending` | `episodeId`, `reviewNumber`, `attemptId`, `findingCount`, `gate`                                                                                            | opens `planning_review_triage`                            |
| `planning_review.triaged`        | `episodeId`, `reviewNumber`, `analysisDigest`, `optionCount`, `instructionCount`, `declineCount`, `additionalInstructionPresent`, `actionable`, `decidedBy` | response closing `planning_review_triage`                 |
| `planning_review.gate_restored`  | `episodeId`, `reviewNumber`, `gate`, `outcome`                                                                                                              | opens a new episode of `gate`                             |
| `planning_review.stale`          | `episodeId`, `reviewNumber`, `point`, `changedPaths`                                                                                                        | supersedes a pending `planning_review_triage`; opens none |

`point` is `before_attempt`, `before_publish`, `before_triage`,
`triage_answer`, `before_apply` or `before_restore`. Publication and restore
events that a reconciliation could repeat use `appendEventOnce`; the
once-per-review allow-list of `appendEvent` is not widened. Feedback, finding,
rationale and option text never enter events. ADR rework keeps the existing
`approval.adr` event. Runs that never use these actions emit no new event and
write no new state field beyond the initialized `planningReview`, so the
existing characterization traces stay unchanged.

### Read-only execution at three layers

1. Adapter invocation (`adapters.ts`). Both kinds use a read-only structured
   invocation parametrized by output identity. Claude receives exactly
   `Read,Glob,Grep,Skill`, the review denial list, the new `--json-schema`
   bytes and, for a resumed analysis, `--resume <id>`. Codex runs with
   `--sandbox read-only` when fresh and `-c sandbox_mode="read-only"` when
   resumed, with the new output schema files. MCP whitelist arguments for both
   vendors follow the existing ADR-0022 construction unchanged. The argv of
   `runReview`, `runSelection` and `runPhase` stays byte-identical.
2. Hook (`plugins/banzai/hooks/spec-gate.cjs`). It denies every write while the
   bound run's active attempt kind is `planning_review` or `planning_analysis`,
   including writes to the work directory. The runner always spawns both kinds
   with `BANZAI_RUN_ID` set (see the review step), so the hook is in runner
   mode for them. Model writes to
   `planning-review-<N>.md` stay denied in every phase by the existing exact
   work-document grant rule. The hook accepts state 10 as the only executable
   version and keeps its newer-schema skew diagnostic.
3. Phase scope (`workflow/attempts/result-scope.ts`). Both kinds prohibit every
   workspace change, and `artifactWritePaths` returns `[]` for them explicitly.
   Recovery after publication excludes only the just-published artifact path.

Rework and triage never widen planning: `plan` attempts keep their exact
existing write grants at the hook and phase-scope layers. Accepted ADR bodies
are protected by planning instructions, independent review and inspection
evidence, not by a new runtime mechanism. The applying attempt is an ordinary
`plan` attempt that may write documentation, and the reports state this
limitation truthfully.

### Instructions, prompts and context accounting

`plugins/banzai/phases/planning-review.md` holds runner process only. It
requires:

- an independent, fresh, read-only assessment of the supplied scope, with each
  artifact inspected directly at its exact path (a path or digest does not
  prove assessment);
- the inlined guidance and policies as assessment criteria only, with no
  authoring or write authority;
- no relitigation of recorded owner decisions or Accepted ADR bodies against
  unchanged evidence; a needed change to an accepted decision is a finding
  recommending a new or revised Proposed ADR;
- concrete, independently supported findings; a difference from optional plan
  guidance is not a finding;
- an ordinary finding only for a concern that qualifies independently of
  Engineering Quality: a violated requirement, accepted decision, contract,
  safety rule or established invariant. Such a finding may name its EQ rule as
  supporting context. An EQ-only observation is never a finding. The contract
  has no `deferredCoverage` shadow channel, so such a candidate is omitted
  rather than routed to analysis and human triage (ADR-0030, ADR-0050). The
  phase document gives one example of each: an independently supported
  finding, and an excluded EQ-only observation;
- structured evidence only, with no verdict, approval or gate, and no file
  writes.

Its definition uses guidance `requirements`, `architecture` and `planning` and
policies `test-assurance`, `security-assurance`, `engineering-quality` and
`plan-task-completion`, with `plan-task-completion` conditional (its Plan
Authority section applies when the plan is in scope). It excludes code-design
and the code-review guidance. The entry is appended after `quick-fix`.
`instructionPhasesForRole` returns `review` and `planning-review` for the
reviewer on strict and unselected routes. Planner analysis and triage
application use the `planning` phase. `phases/planning.md` gains three
sections:

- honoring rework feedback and ADR rework notes as inert owner evidence,
  revising the bundle in place and ending at a normal planning gate;
- read-only analysis under the dedicated contract, explicitly overriding the
  phase's write-duty sentence for that step. It requires exactly one entry per
  finding, one to three options with their consequences, and a recommendation
  only when repository evidence supports one (otherwise null). The
  recommendation is stated as advisory, and the planner never selects a
  disposition (FR18; ADR-0055 recommendation-anchoring risk);
- applying exactly the recorded dispositions and additional instruction,
  leaving declined findings unchanged and never requesting another review.

All of them keep Accepted ADR bodies immutable. The retained Orchestrated Mode
sections of `architecture-decision` and `development-plan` only describe these
gate actions. The `artifact-storage` policy names the runner-rendered
`planning-review-<N>.md` siblings. These resource changes go through ADR-0044
transitions authorized by ADR-0055. Each transition's scope equals exactly the
changed keys reported by the generator. The original root, earlier transitions
and their pins are never rewritten. A later accepted-finding fix that changes an
instruction key appends another exact-scope transition.

Prompts. The planning-review envelope uses `REVIEW_COMMON` unchanged. The
analysis envelope uses the planning resources with a dedicated non-gate common
preamble selected by an explicit override; `COMMON` and `REVIEW_COMMON` bytes
stay unchanged. Analysis retries use their own recovery text, not the planning
retry text; a review retry repeats the same fresh prompt. No prompt category is
added:

- review scope paths, digests, the review number and the origin gate go in
  `user_request_scope`;
- validated findings, analysis entries and recorded dispositions go in
  `review_triage_evidence`;
- rework and triage records go in `human_decisions`;
- ADR decisions go in `approved_requirements_architecture`.

`plan_rework`, `adr_rework` and `planning_review_triage` records reach only
planning-family prompts (`plan`, `planning_review`, `planning_analysis`). They
are excluded from selection, implementation, fix, lite and code-review prompts,
whose authority counts reflect exactly the delivered records. Artifact
instructions state an empty model write set for both new kinds and no longer
name a fixed state version. Context authority counts the episode scope and adds
`review_artifact` for analysis and application. Route phases and the persisted
`workflow.selected` payload are unchanged.

Context accounting. Ledger v2 adds `planning_review` (reviewer, non-mutable)
and `planning_analysis` (planner, non-mutable) to the attempt, invocation and
budget-selector phase vocabulary. One decoder holds a per-version vocabulary,
and v1 rejects the new kinds. The decoded identity is echoed so that finishing
an invocation never downgrades v2. The store writes v2 for every new ledger.
Report v2 adds both phases in a fixed group order with their roles and
enumerates their attempt files through the shared file-token mapping. Repair
invocations stay review-only. The config `context.limits[].phase` vocabulary is
unchanged and no config schema changes. Phase-specific limits for `review` or
`plan` therefore never apply to the new kinds, while role-only and unqualified
limits keep their ADR-0028 applicability.

### Human time, cancellation and evaluation

The anchor `planning_review_triage` carries the analysis `attemptId`, the
`episodeId` and the `reviewNumber`, so its episode key is unique per episode.
The restored-gate anchor reuses the existing `plan_approval` or `adr_approval`
anchor shape; its `attemptId` field carries the episode id (the plan anchor's
bundle digest stays null), giving one key per episode and gate kind without
changing the existing anchor shapes. The human-time event vocabulary gains the
six events of the table that have a human-time role. Openers and responses are
one closed table in the existing reader:

- a review-request response closes the episode named by its `gate`;
- a triage response must match the pending review number and corroborate
  exactly one recorded triage;
- the expected status for a pending triage is `needs_human_decision` with the
  matching pending identity;
- the new attempt kinds never reach the phase-result attempt projection.

Machine time in review or analysis is never gate time, and gate elapsed time
never becomes active effort.

Cancellation observation v1 keeps its reasons and gate vocabulary. A pending
triage records its `originGate` as an available gate. The triage decision, and
an active `planning_review` or `planning_analysis` attempt, use the existing
`unsupported` availability. The cancellation report excludes planning attempt
files from its v1 model inventory by exact token. It keeps reporting state v8
and later as unreadable lifecycle, so Compliance 11 is confirmed at the
observation level (events and state).

Evaluation export and KPI gain nothing. `EvaluationAttemptKind` is pinned to the
literal union `selection | plan | implementation | fix | review |
verification`, and state v10 stays `STATE_SCHEMA_UNSUPPORTED` without
fabrication. No existing KPI observes this feature; it is guard-only, and the
implementation report states so as CONTRIBUTING requires.

### Terminal and human CLI

The terminal implements the FR1, FR2, FR3, FR7 and FR10-FR21 strings exactly:

- `Plan decision` choices in FR1 order;
- `Decision for <ADR-ID>` with `Request independent review` after `Request
rework`;
- `Rework feedback for the planner` (required) and `Decision note (optional)`
  for accept and reject;
- `Review scope` with `Whole planning bundle` and `Choose artifacts`; the
  multi-select (message `Artifacts to review`) offers exactly the
  runner-projected paths, and an empty submission shows `Choose at least one
artifact.`;
- the confirmations with default No;
- `Independent review found no issues: <artifact path>`;
- the `Disposition for <finding-id>` menu, `Your instruction for
<finding-id>`, `Additional instruction for the planner (optional)`, the
  `Planning-review triage: options=<n>, own=<n>, declined=<n>` summary and its
  confirmation.

Each triage card shows the finding id, severity, category, summary, evidence and
suggested resolution, then the assessment, rationale and every option with its
consequences, then the recommendation. The recommendation is marked
` (recommended)` by option id, never by label. Every model-authored or echoed
human string goes through `escapeTerminalText`, in output lines and in choice
names. `Review scope` and the multi-select use the base IO without human-time
items. Human-time items are inserted before the last `Exit` or `Pause` choice,
so a model label cannot move them. Blocked-run labels are `Retry planning
review` for a failed or interrupted review step and for a stale block, and
`Retry planning analysis` for a failed or interrupted analysis step. Ctrl+C,
EOF, `Exit and decide later` and a declined confirmation record nothing, and a
pending triage is presented again the next time `banzai` opens. The
multi-select uses `checkbox` from `@inquirer/prompts`, the existing dependency,
through `inquirer-io.ts` with a `validate` callback; no dependency is added.

CLI grammar:

- `banzai approve plan [--decision approve|rework] [--note <text>] [--by
<name>] [--no-resume]`. `approve` is the default. `--note` is accepted only
  with `rework`; otherwise the command fails with `INVALID_DECISION` and `--note
is accepted only with --decision rework.` An unknown value fails with `Plan
decision must be approve or rework.`. Rework with a missing, dangling, empty
  or whitespace-only note fails with `INVALID_DECISION` and `Plan rework
requires a non-empty --note.`.
- `banzai approve plan` uses an exact parser, like `banzai review planning`.
  After the target, every argument must be `--decision <value>`,
  `--note <value>`, `--by <value>` or `--no-resume`, each at most once; the
  global progress flags are already stripped. `--name=value` forms, unknown or
  misspelled options, repeated options and stray positionals fail with
  `INVALID_COMMAND` before the prerequisite display, any runner call or any
  approval. A mistyped rework request can therefore never become a plan
  approval (FR26). `banzai approve adr` keeps its current parsing, because its
  required `--decision` cannot fall back to acceptance.
- `banzai approve adr ... --decision rework` with a missing, dangling, empty or
  whitespace-only `--note` fails before any runner call with `INVALID_DECISION`
  and exactly `ADR rework requires a non-empty --note.`. Accept and reject keep
  an optional note.
- `banzai review planning [--artifact <path>]... [--by <name>] [--no-resume]`
  uses an exact parser that rejects unknown options and collects every
  `--artifact`. Omitting it selects the whole gate artifact set. Raw strings go
  to the runner, which owns containment; a duplicate path fails with
  `INVALID_DECISION`.
- Argument validation precedes state checks; a request outside its gate fails
  with the existing `INVALID_STATE`, and state is unchanged. Rework and review
  commands run under the existing terminal attention wrapper and print the
  runner state like other gate commands; `banzai review planning` also prints
  the zero-findings line.

`banzai status` shows the triage gate, the artifact path and the finding count,
with a Next line naming `banzai` in a terminal or a `banzai-agent-answer/v4`
document for `banzai control answer`, never argv. HELP adds the new lines and
one sentence describing the loop inside the ADR and plan gates. It keeps every
pinned fragment, including `Five existing human decision gates remain distinct`,
`banzai-agent-answer/v2`, `banzai-agent-answer/v1` and the evaluation lines.

### Agent control and supervisor

Capabilities v8 add operation `decideGate` (input
`banzai-agent-gate-decision/v1`) immediately after `approvePlan` and order
`answer.inputSchemas` as `banzai-agent-answer/v4`, `/v3`, `/v2`, `/v1`. They
also add a `planningGates` declaration naming:

- the gate-decision schema;
- the decisions per gate (`adr_approval`: `accept`, `reject`, `rework`,
  `review`; `plan_approval`: `approve`, `rework`, `review`);
- the triage pending kind, answer schema and disposition kinds;
- the limits (feedback 8000 bytes, own instruction 2000 bytes, additional
  instruction 8000 bytes, 20 findings, 128 review paths);
- the status schema.

Existing blocks keep their content, and their `statusSchema` follows status v6.

Status v6 changes only the projection:

- `adr_approval` and `plan_approval` pending gates add `decisions` and
  `reviewPaths` from the shared owners, so a run below state v10 never
  advertises plan rework or review;
- a distinct next action `answer_planning_review_triage` and pending gate
  `planning_review_triage` carry the run id, episode id, review number, origin
  gate, artifact path and SHA-256, analysis digest, every finding and every
  analysis entry with its options before the recommendation;
- pending-kind dispatch is exhaustive, so the new kind is never projected as
  escalation or consultation;
- projection bounds accept every contract-valid value;
- completed rework, triage history, feedback and `decidedBy` are never
  projected, and `review` stays bound to code review.

The gate-decision document is closed:
`schema`, `schemaVersion` (1), `runId`, `gate` (`adr_approval` or
`plan_approval`), `decision` (`rework` or `review`), `adrId`, `feedback` and
`paths`.

- Rework requires feedback, and `adrId` is required at the ADR gate and null at
  the plan gate.
- Review takes null `paths` (whole set) or a non-empty, duplicate-free list of
  canonical repository-relative paths.
- `feedback` is non-null only for `rework`; `paths` is null for `rework`;
  `adrId` is null for `review` and for plan-gate `rework`. Any other
  combination fails with `INVALID_CONTROL_INPUT` before any runner call.
- It binds the run id and gate kind, plus the ADR id for ADR rework, as argv
  approvals do.

The triage answer document is `schema`, `schemaVersion` (4), `runId`,
`episodeId`, `reviewNumber`, `analysisDigest`, `dispositions` and
`additionalInstruction`. Both documents use direct stdin within the existing
64 KiB bound, fatal UTF-8 decoding, duplicate-key rejection and the shared
free-text rule, and are decoded completely before any runner call. The triage
branch is dispatched by schema before the v2 fallthrough.

Control prechecks the status, the run id, the ADR id against the projected ADR
ids, scope membership and the triage identities. Any mismatch fails with
`INVALID_CONTROL_INPUT` before any runner call. A v1 answer at the triage gate
fails with `CONTROL_SCHEMA_UNSUPPORTED`. Under its lock the runner revalidates
the gate status, the free text, scope membership and, for triage answers, the
run, episode, review-number and analysis-digest identities. ADR ids keep the
existing `decideAdr` semantics. Approve, accept and reject keep their argv
commands. FR31 holds
through the supervisor's exact capability pin and `CONTROL_SCHEMA_UNSUPPORTED`
for unsupported input documents; existing documents keep their meaning.

The `orchestrate` skill pins the exact v8 declaration. The control protocol
documents both documents with closed examples, the rewritten `approve_adr` and
`approve_plan` rows, a triage row and the rule that the supervisor shows exact
artifacts, findings and options and waits for the user's explicit decision. The
supervisor never chooses, infers or rewrites a disposition, recommendation or
feedback. The protocol and the pinned skill fragments also require the
supervisor to encode both documents as raw UTF-8 JSON and never `\u`-escape
non-ASCII text (FR30, Resolved Assumption 20). On `CONTROL_INPUT_TOO_LARGE` the
supervisor reports the error and never truncates, summarizes or rewrites the
user's text. It asks the user to shorten their own text or to answer in
`banzai` in a terminal. The skill file is an instruction-baseline key, and its
change goes through an ADR-0055 transition. New `types.ts` constant names must not end with
an existing release-pinned constant name, because the release checker matches
names unanchored.

### Ownership and structural assessment

The change adds state transitions, two execution phases, a mutable-state owner,
an independent responsibility and cross-subsystem dependencies, so the
Engineering Quality structural triggers apply. Use invariants, not layouts; the
assessment below is the planning record that implementation revalidates against
source.

| Trigger                           | Owner, collaborators and disposition                                                                                                                                                                                                                                                                                                                                                                                                                      | Invariants and verification                                                                                                                                                               | Reuse search                                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| New transitions                   | `state-machine.ts` reused; guard follows the configuration-continuation precedent and reads the domain classifier                                                                                                                                                                                                                                                                                                                                         | Persisted facts only; never hashes; legacy transitions unchanged; `state-machine.test.ts`                                                                                                 | Searched `transitionState` guards and `requireState`; configuration continuation is the only guard precedent.                                  |
| Two execution phases              | Generic attempt lifecycle reused; executors retained in `WorkflowRunner`, because they need the workflow lock, store, adapters, attempt lifecycle and the apply and reconcile paths that the runner owns (ADR-0052 keeps executors there), and moving them would mean passing the whole coordinator, which the code-design method forbids, while effectful helpers may move to a slice; code-review policy and application not reused (ADR-0055 Option 1) | No code-review continuity read or written; `lifecycle.test.ts`, planning-review workflow tests                                                                                            | Searched `executeReview`, `reviewExecutionPolicy`, `applyReviewResult`, `invokeWithContext`, `beforeModelAttempt`, `terminalCheckpointWriter`. |
| New mutable-state owner           | `store.ts` validation with `validation.ts` shape decoders retained, because `store.ts` stays the single persisted-state validator, so the closed pending- and record-kind switch has exactly one owner; episode values computed by the domain module                                                                                                                                                                                                      | Mutations only under the workflow lock; v10 only; no fabrication; `store.test.ts`                                                                                                         | Searched consultation uniqueness sets and configuration-prerequisite parsers; replay pattern reused.                                           |
| Independent planning-review rules | New `src/workflow/domain/planning-review.ts` (extracted, ADR-0052 domain) plus the gate set in `artifact-scope.ts` (reused owner)                                                                                                                                                                                                                                                                                                                         | Pure; runner gathers digests and time; `planning-review.test.ts`, `artifact-scope.test.ts`                                                                                                | `restore-eligibility.ts` (approval-snapshot restore) and `artifactPaths` (plan gate only) are not reusable as-is.                              |
| Duplicate free-text validators    | New shared validator in `validation.ts` (extracted); three existing copies retained because consultation answer v2, control v1-v3 and decision identifiers keep frozen semantics. Divergence risk: a future change to the shared character set must not alter those frozen meanings                                                                                                                                                                       | Byte bounds, well-formedness and the specified character set; injection cases in contracts tests; the frozen meanings are guarded by the unchanged consultation and control decoder tests | `consultationAnswerString`, agent-control `inertText`, `decisionText`, `configurationText`.                                                    |
| Duplicate gate path sets          | `artifact-scope.ts` rule consumed by runner, status, terminal, CLI and control; control's ADR-gate path derivation replaced                                                                                                                                                                                                                                                                                                                               | Null ADR-gate description tolerated; plan gate equals bundle order; domain and control tests                                                                                              | `artifactPaths`, `approvalArtifacts`, `pendingGate`, interactive ADR derivation.                                                               |
| Duplicate create-only publication | One primitive extracted from `publishReviewArtifact`; `publishNew` not used                                                                                                                                                                                                                                                                                                                                                                               | Code-review publication unchanged, including its snapshot-less rename branch; `review-artifact.test.ts`, `review-result-v2.test.ts`                                                       | `publishReviewArtifact`, `publishNew`, `verifyDocumentVisibility`, `verifyExecutionIgnore`.                                                    |
| Lossless Markdown values          | Existing `reviewValue` exported unchanged (reused)                                                                                                                                                                                                                                                                                                                                                                                                        | Code-review bytes unchanged; `review-result-v2.test.ts`                                                                                                                                   | Only `review-artifact.ts` owns Markdown escaping.                                                                                              |
| Second review family              | New `src/planning-review-artifact.ts` (extracted)                                                                                                                                                                                                                                                                                                                                                                                                         | Validated input and persisted inputs only; deterministic; `planning-review-artifact.test.ts`                                                                                              | Extending the 837-line code-review renderer considered and rejected for byte stability.                                                        |
| Read-only invocation              | Existing read-only construction parametrized by output identity (reused)                                                                                                                                                                                                                                                                                                                                                                                  | Legacy argv byte-identical; `adapters.test.ts`                                                                                                                                            | `runReview`, `runSelection`, builders, `requestOutputContract`, `writeCodexContract`.                                                          |
| Triage validation                 | New parser in `validation.ts`; code-review `validateTriage` not extended (different vocabulary)                                                                                                                                                                                                                                                                                                                                                           | Atomic rejection; identity binding; contracts tests                                                                                                                                       | `validateTriage`, `parseDecisionConsultationAnswers`.                                                                                          |
| Context v2                        | One per-version decoder; store sole writer; report sole aggregator (reused owners)                                                                                                                                                                                                                                                                                                                                                                        | v1 unchanged; identity echo; context tests                                                                                                                                                | `decodeContextAttemptLedger`, `roleForPhase`, file regexes.                                                                                    |
| Human-time derivation             | Existing reader and codec (reused), with one closed opener and response table                                                                                                                                                                                                                                                                                                                                                                             | No ambiguity on supported paths; human-time tests                                                                                                                                         | One owner; consumers `workflow.ts`, `context.ts`, terminal labels.                                                                             |
| State-schema consumers            | Atomic v10 bump in T003 across every version list                                                                                                                                                                                                                                                                                                                                                                                                         | No silent legacy normalization; hook, readers, doctor and human time accept v10; release validation                                                                                       | 26 version-literal sites in 12 files.                                                                                                          |
| Instruction authority             | Existing finite image maps and allow-lists (reused)                                                                                                                                                                                                                                                                                                                                                                                                       | Images gated on ADR-0055 Accepted; history untouched; `release-validation.test.ts`                                                                                                        | Maps for 0045, 0047, 0049, 0054; ADR-0049 self-image precedent.                                                                                |
| Idempotent events                 | `appendEventOnce` reused                                                                                                                                                                                                                                                                                                                                                                                                                                  | One event after reconciliation; workflow tests                                                                                                                                            | `appendEvent` once-per-review allow-list.                                                                                                      |
| Multi-select capability           | `InteractiveIO` port with `inquirer-io.ts` as sole binding (reused)                                                                                                                                                                                                                                                                                                                                                                                       | Required port method; exact validation message; interactive tests                                                                                                                         | `@inquirer/prompts` 8.5.2 exports `checkbox`; sequential confirms unsuitable.                                                                  |
| Repeatable CLI option             | Exact parser on the existing CLI precedent                                                                                                                                                                                                                                                                                                                                                                                                                | Unknown options rejected; all occurrences kept; CLI tests                                                                                                                                 | `option()` returns the first match; cancellation and evaluation parsers.                                                                       |
| Card presentation                 | Interactive finding, evidence, option and recommendation helpers generalized to structural inputs with escaping at shared render points                                                                                                                                                                                                                                                                                                                   | Existing valid outputs unchanged; interactive tests                                                                                                                                       | `renderConsultationCard`, `findingDisposition`, `findingRule`, `severityTone`, `writeLabeled`.                                                 |
| Status lines                      | One shared pure lines helper for terminal status and `printState`                                                                                                                                                                                                                                                                                                                                                                                         | Same facts on both surfaces                                                                                                                                                               | Existing shared verification and review lines helpers.                                                                                         |
| Fallthrough dispatch              | Every touched dispatch over attempt or pending kinds becomes exhaustive                                                                                                                                                                                                                                                                                                                                                                                   | An unlisted kind fails at compile time or by closed rejection                                                                                                                             | Six kind fallthroughs and three control or terminal pending fallthroughs found.                                                                |
| Numeric trigger                   | ESLint `complexity` 15 and `no-nested-ternary` warnings (adopted)                                                                                                                                                                                                                                                                                                                                                                                         | Each new or increased warning in changed code is assessed and recorded; dispatch growth delegates to the domain rule                                                                      | `eslint.config.mjs`.                                                                                                                           |

Authority: every row is within the scope of accepted ADR-0055 and this plan.
Remaining debt: `workflow.ts` keeps growing with the two executors; their
effectful helpers may move to a capability slice (guidance below). The three
retained free-text validators stay separate owners because of their frozen
contract semantics.

New modules need exact `import-boundaries.mjs` entries citing ADR-0052 and a new
`ADR_0055` authority in `POLICY_ADR_AUTHORITIES`. Terminal and control code
reach new rules through existing `workflow.ts` or `validation.ts` exports unless
a new permission is recorded. No new dependency, service, registry, background
job or generic architecture is authorized.

Optional implementation guidance: effectful planning-review helpers (scope
rehashing, the directory number scan, publication orchestration and record
construction) may live in a new `src/workflow/planning-review/` capability slice
taking `RunnerContext`, while executors stay in `WorkflowRunner`.

### Security enforcement points

Class 1 (untrusted input reaching a resource path or terminal renderer):

- human free text is enforced by the shared validator at the runner commands,
  the CLI pre-checks, the control decoders, terminal validation callbacks and
  persisted-record validation in `store.ts`;
- model-authored text is enforced by the contract decoders in `validation.ts`,
  by `escapeTerminalText` at the shared terminal render points, by the
  lossless fenced-JSON artifact renderer and by bounded status projection;
- review scope paths are enforced by the exact membership rule in the domain
  module, canonical path decoding in `agent-control.ts`, and contained,
  symlink-refusing digest reads in the runner before any model invocation.

Class 2 (capability decision for the new attempt kinds):

- read-only execution is enforced at the adapter invocation, the hook and
  phase scope;
- the state machine and the runner commands never record approval or
  acceptance;
- prompt reach is limited to planning-family prompts, while `plan` attempts
  keep their exact existing write grants.

The change reuses the create-only publication control for its new Git-visible
file and keeps local paths out of it (basename-only executable, no run id or
repository root).

### Compatibility and legacy readers

- Intentional breaks, named in the release notes: `banzai approve adr
--decision rework` without a non-empty `--note`, and the major control
  revision. Older CLIs ignore unknown `approve plan` flags, so the release notes
  warn that `banzai approve plan --decision rework` on an older CLI approves.
  They also state that `approve plan` now rejects argument forms outside its
  documented grammar; every documented invocation is unchanged. This is stricter
  parsing, not a third ADR-0055 contract break. Accept and reject notes keep
  their existing handling.
- Generated resources: `npm run build` regenerates `src/init-resources.ts`,
  `src/phase-resources.ts`, `plugins/banzai/lib/artifact-readers.mjs` and
  `dist/` together. Every task that edits a generator input rebuilds before its
  focused checks and lists the changed outputs as affected units. Generator
  inputs are the instruction resources or the hook, persisted-reader sources
  reachable from `src/persisted-readers.ts` such as `validation.ts`, and
  bundled sources including `plugins/banzai/lib/*`.
- States v1-v9, attempt records, context ledgers v1, checkpoints, ADR decisions
  with a null rework note and consultation history decode unchanged. The hook
  executes only v10; an older installed hook refuses v10 with its skew
  diagnostic.
- Evaluation export v1/v2, KPI v1, cancellation observation v1, cancellation
  report v1 and doctor v5 keep their shapes.
- Phase-result v4, review-result v2, code-review rendering and numbering, review
  snapshots, triage, re-review and task-verification exclusions are unchanged.
- The plugin and CLI ship together under one release-train version: hook,
  plugin library, contracts, generated readers and the committed bundle change
  together.

### ADR-0054 reciprocal lifecycle link

T001 inserts exactly these lines immediately before `- Superseded by: None.` in
ADR-0054's Lifecycle Links:

```markdown
- Amended by
  [ADR-0055](./0055-planning-gate-rework-and-independent-planning-review.md),
  accepted 2026-10-13: the flat work directory also holds runner-rendered
  `planning-review-<N>.md` siblings, recognized by name pattern. Binding v3
  gains no role. Implementation is Planned.
```

Reciprocal annotations in other ADRs keep their accepted wording; following the
existing precedent, they are not updated when implementation completes.

### Current facts that become stale

- `PROJECT_MANIFEST.md`:
  - section 2: generated resources and the phase count;
  - section 4: module and contract inventories;
  - section 5: the `cli.ts`, `interactive.ts`, `inquirer-io.ts`, agent
    control, `WorkflowRunner` method and executor list, `prompts.ts`,
    `phase-resources.ts`, `review-artifact.ts`, `work-documents.ts`,
    `validation.ts`, `contracts.ts`, context, human time and cancellation
    entries;
  - section 6: "New runs use state v9", decision history, the strict
    lifecycle, the five-gate bullet (kept, loop added), read-only reviewers,
    retry policy, sessions and agent control;
  - section 8: assurance owners;
  - section 10: contract, context and control identities, the ADR-0055 state
    and the recorded release-train version, which already differs from package
    metadata.
- `packages/orchestrator/MODULES.md`: the state v9 and inventory sentences, the
  domain, attempt, checkpoint, routing and retry entries, `adapters.ts`,
  `validation.ts`, `output-contract.ts`, `contracts.ts`, `review-artifact.ts`,
  `work-documents.ts`, `prompts.ts`, context, human time, cancellation, the
  terminal, CLI and control entries, smoke and release-script descriptions, and
  the retained-authority paragraph; new module entries.
- `documentation/orchestrator.md`: commands, interactive actions, Ctrl+C,
  attention, agent control, the review artifact (new planning-review section),
  instruction inventory, context identities, human time, cancellation, retry
  policy, hook behavior and the pinned state-10 sentences.
- `README.md`: the gate table, scriptable equivalents, retry eligibility, the
  control contract version and current release notes;
  `documentation/README.md`: current release notes;
  `documentation/getting-started.md`: strict route guidance;
  `documentation/context/README.md`: ledger and report identities.
- `CONTRIBUTING.md`: the context-report identity; `plugins/banzai/AGENTS.md`:
  decision gates and roles (FR42); `plugins/banzai/hooks/README.md`;
  `plugins/banzai/contracts/README.md`; `plugins/banzai/documentation/README.md`
  (packaged template); `documentation/decisions/README.md`: the ADR-0055 row.

## Human prerequisites

One owner input is outstanding for the release identity. Nothing else is
needed to approve or implement this bundle locally.

- Release-train version selection (active). v2.7.0 is already committed at
  `8a7ff64`, so this work's hook, plugin-library and contract changes need a
  new release-train version (`HOOK_CHANGED_WITHOUT_VERSION_BUMP`). The owner
  names the exact target version, either at approval or when T013 asks.
  Implementation applies it with `npm run version:set -- <owner version>` and
  rebuilds. Implementation never chooses a version.
- Separate delivery actions. Installed-client validation, a live vendor
  compatibility trial for the new schemas, plugin or CLI installation and
  release delivery (tags, pushes, publication) need their existing owner
  decisions. This plan does not authorize them. Source acceptance uses
  deterministic local evidence and does not claim installed-client behavior.

## Implementation Tasks

- [ ] **T001 - Admit ADR-0055 instruction authority and record the deferred ADR-0054 link**

  Extend the existing instruction-authority validator before any
  ADR-0055-authorized transition:
  - Add the ADR-0055 decision path to the authorities allowed to change
    `#orchestrated` keys and `plugins/banzai/skills/orchestrate/SKILL.md`.
    Protected manifest keys stay untouchable.
  - Append one finite image map, guarded by ADR-0055 being Accepted, after the
    ADR-0054 entry in `RETAINED_AUTHORITY_AMENDMENTS`. Its entry maps ADR-0054's
    pinned image
    `6ea561ebbd90f390155520129e7cddd4ae417eb00ae069eca091e782be824664` to the
    digest of ADR-0054 after the link, computed from the final ADR-0054 bytes.
  - Insert the exact reciprocal lifecycle link given in the Technical
    Breakdown and change nothing else in ADR-0054.
  - Add the ADR-0055 decision file to the release-validation fixture paths.

  The image must be unreachable while ADR-0055 is not Accepted. Arbitrary
  wording, other metadata and decision-body edits must still fail. The original
  root, the earlier transitions, the existing image maps and every accepted
  decision body stay unchanged.

  Affected units: `packages/orchestrator/scripts/phase-resources-build.mjs`;
  `documentation/decisions/0054-git-visible-work-artifacts.md` (Lifecycle
  Links only); `packages/orchestrator/test/release-validation.test.ts`.
  Dependencies: none. Mapping: FR16, FR42; ADR-0055 Lifecycle Links and
  Evidence, accounting and instructions 6; Compliance 13.
  Assurance owner: `release-validation.test.ts`, mirroring the existing
  retained-authority cases. It covers the image being admitted only while
  ADR-0055 is Accepted, arbitrary wording being rejected, ADR-0055 being
  accepted for the two protected key families, and another unlisted authority
  being rejected.
  Completion evidence: focused results, an ADR-0054 diff limited to the
  inserted lines, and a guidance-extraction validation of the working tree
  with no instruction drift. Review batch: A.

- [ ] **T002 - Define planning-review contracts and shared free-text validation**

  Add the reviewer-result and analysis schemas with the identities, fields and
  bounds of the Technical Breakdown. List them in `contract.json` under
  `planningReviewResult` and `planningReviewAnalysis`, keep the umbrella at
  `1.0.0`, and satisfy the existing structured-output subset. In `types.ts`,
  add the schema identities and versions, `PLANNING_REVIEW_ARTIFACT_FORMAT`
  (`banzai-planning-review/v1`), the two output-contract identities and the
  result, analysis, disposition and triage-answer types; severity reuses the
  code-review severity type. Embed and parity-check both schemas in
  `contracts.ts`. Serialize both in `output-contract.ts` and make its identity
  dispatch exhaustive, so an unmapped identity never serializes review-result
  v2. Existing vendor bytes stay unchanged.

  In `validation.ts`, add:
  - shape decoders reusing the consultation primitives;
  - binding validators for the result (review number, `P<N>` prefix, unique
    `F<M>`, exact scope echo) and for the analysis (review number, result
    digest, one entry per finding in order, unique option ids and labels, a
    listed or null recommendation);
  - the atomic triage-answer parser;
  - the exported shared human free-text validator, with per-field byte bounds
    and a surface-mapped error class.

  Existing consultation, control and decision-text validators keep their
  behavior.

  Add the `ADR_0055` policy authority to `import-boundaries.mjs` and the
  permissions for the new schema imports. Add a separate
  `contracts.planningReview` release-policy entry (both current paths, schema
  identities and versions, and the artifact format), leaving
  `contracts.reviewResult` untouched. Add both schema paths to
  `plugin.requiredPaths` and `plugin.jsonDocuments`. Pin them in
  `check-release.mjs`: the policy entry, the manifest keys and loop, each
  schema's `$id`, `schema`, `schemaVersion` and `contractVersion` constants,
  and the new `types.ts` constant names. Classify both schemas as `product` in
  `publication-policy.json`. Document both contracts in the contracts README
  while keeping its pinned fragments.

  Affected units: the two new schema files and `contract.json` under
  `plugins/banzai/contracts/`, its `README.md`;
  `packages/orchestrator/src/types.ts`, `contracts.ts`, `output-contract.ts`,
  `validation.ts`; `packages/orchestrator/import-boundaries.mjs`;
  `release-policy.json`; `packages/orchestrator/scripts/check-release.mjs`;
  `publication-policy.json`; generated
  `plugins/banzai/lib/artifact-readers.mjs` and `packages/orchestrator/dist/`
  when their bytes change; affected tests.
  Constraints: phase-result v4, review-result v1/v2, workflow selection, the
  decision-consultation subschema and byte-pinned legacy contracts stay
  byte-identical. New constant names must not end with an existing
  release-pinned constant name. A regenerated plugin reader library follows
  the release-train version rule in Human prerequisites.
  Dependencies: none. Mapping: FR15, FR16, FR18, FR20, FR22, FR30, FR33;
  US 2, 9; ADR-0055 Rework 1, Contracts and artifact 1-3, Planning-review
  triage 2; Compliance 2, 8, 13.
  Assurance owner: `validation.test.ts` (structured-output subset and parity),
  a focused planning-review contracts test, the golden output-contract byte
  tests in `prompts.test.ts` (plus the argv fixtures in `adapters.test.ts`),
  `release-validation.test.ts`, `import-boundaries.test.ts` and the lint check.
  The contracts test covers zero and 20 findings, 21 rejected, hostile text,
  bounds, malformed and foreign ids, digest binding, every triage-answer
  rejection, and free-text cases including lone surrogates, U+200E, CR and
  multi-byte byte limits.
  Completion evidence: focused results, with existing consultation and control
  decoder tests unchanged and passing. Review batch: A.

- [ ] **T003 - Introduce run state v10, planning attempt kinds and decision records**

  Atomically move new runs to state 10 with the `planningReview` field, the
  pending kind, the records, the two attempt kinds, the attempt id and
  file-token rules, the optional metrics counters and the store validation of
  the Technical Breakdown:
  - Pin `EvaluationAttemptKind` to the legacy literal union in the same change.
  - `newAttempt` never reads `reviewIteration` for the new kinds, and counters
    are absent-safe.
  - `normalizeRunState` admits 10 at every version-keyed branch: the allow-list,
    the completion cursor, the required binding, task verification with
    binding v3 for every version from 9, and the v3+ return path. A v10 state
    must never reach legacy normalization.
  - `validateDecisionState` becomes an explicit closed kind switch.
  - The raw mutation reader admits 10, and attempt enumeration uses the shared
    file-token mapping with canonical-name equality.

  Update every version-keyed site so v10 behaves as v9 wherever no new meaning
  applies:
  - new-run creation (constant, empty `planningReview`);
  - the review snapshot mapping (v10 to `banzai-review-snapshot/v7`, schema 7)
    and the artifact-instruction text, which no longer names a version;
  - task-verification binding and saved workspace evidence (version 3 from
    state 9);
  - the configuration-prerequisite envelope and the regenerated plugin readers;
  - both doctor lists and both human-time state-version lists;
  - the evidence-attempt kind list.

  Hook: newest state 10, the bound-run list includes 10, and 10 is the only
  executable version. It denies every write while either new kind is active,
  including writes to the work directory; `planning-review-<N>.md` stays denied
  to every model phase. Record the hook change through one ADR-0055 transition
  whose scope is exactly the changed key.

  Release identity:
  - `release-policy.json` state current 10, legacy [1..9];
  - the `check-release.mjs` state policy, the `RunState` union pattern and
    message, and the pinned documentation fragments;
  - in lockstep, the pinned sentences in `documentation/orchestrator.md`
    (`New runs start at schema version 10 ...`, `State 10 carries the
completion publication cursor from creation.`) and the manifest fragment
    `state schema v10`.

  Tests that hard-code 9 for new runs move to the constant. The release
  checker's store fragments and pattern stay matchable.

  Affected units: `packages/orchestrator/src/types.ts`, `store.ts`,
  `workflow/attempts/lifecycle.ts`, `workflow.ts` (creation, snapshot mapping
  and instruction text only), `workflow/verification/evidence.ts`,
  `workflow/attempts/result-scope.ts` (version mapping only),
  `configuration-prerequisite.ts`, `doctor.ts`, `human-time-store.ts` (version
  lists only), `validation.ts` (evidence kinds);
  `plugins/banzai/hooks/spec-gate.cjs`; generated
  `plugins/banzai/lib/artifact-readers.mjs`; generated
  `packages/orchestrator/src/phase-resources.ts` (the embedded
  `hooks/spec-gate.cjs` digest) and `packages/orchestrator/dist/`, both
  regenerated through the build;
  `packages/orchestrator/phase-guidance-current.json` and its `.sha256` pin
  through `scripts/instruction-baseline.mjs`; `release-policy.json`;
  `scripts/check-release.mjs`; the pinned sentences in
  `documentation/orchestrator.md` and `PROJECT_MANIFEST.md`; affected tests.
  Constraints: no new `RunStatus`; the human-time phase-result attempt
  projection stays closed; evaluation export and KPI shapes, the result-digest
  kind list, `ATTEMPT_KINDS` and config phase vocabulary are unchanged;
  characterization traces stay unchanged; the release-train version rule
  applies.
  Dependencies: T001, T002. Mapping: FR4, FR13, FR14, FR22, FR26, FR33, FR37,
  FR41;
  US 8; ADR-0055 Planning review episode 2-4, Evidence, accounting and
  instructions 1 and 5; Compliance 4, 5, 11, 12.
  Assurance owner: `store.test.ts` (v10 round trip, v1-v9 reads, new shapes
  rejected on older schemas, replay and identity rejections, no legacy
  normalization), `workflow/attempts/lifecycle.test.ts`, `hook.test.ts` (v10
  roles, v11 skew denial, the planning artifact denied to `plan` and both
  kinds; it runs with the runner environment shape, with `BANZAI_RUN_ID` set
  and the three grants empty, and asserts denial while either kind is active
  for hook-fixture targets in the work directory, the decisions directory and
  the source tree),
  `doctor.test.ts`, `human-time-store.test.ts`, `evaluation.test.ts`,
  `release-validation.test.ts`, the snapshot, evidence and result-scope tests,
  and the characterization traces in `workflow.test.ts` and
  `workflow-eligibility.test.ts`.
  Completion evidence: persisted fixtures, focused results, a transition scope
  equal to the hook key, and `src/phase-resources.ts` equal to
  `phaseResourceBytes` (the `checkPhaseResourceBytes` check passes). Review
  batch: B.

- [ ] **T004 - Encode planning-gate rules, transitions and retry eligibility**

  Add the pure domain module `src/workflow/domain/planning-review.ts` with gate
  availability, scope membership, numbering, step dispatch, episode values,
  actionable classification, the stale verdict and gate-restore eligibility as
  specified. Add the gate artifact-set rule to `artifact-scope.ts`. Add the
  ordinary `needs_plan_approval → planning` transition and the guarded restore
  transition to `state-machine.ts`; all other transitions stay unchanged. Make
  interrupted `planning_review` and `planning_analysis` attempts retryable
  while ordinary `plan` stays excluded. Map both kinds to `blockedFrom:
planning` in the context-budget and failed or interrupted retry chains. Add
  the no-attempt stale branch keyed on the latest closed episode outcome and
  the step-repeat branch for an active `reviewing` or `analyzing` episode
  without an attempt; neither branch keys on reason text. Recovery and
  digest-rejected recovery keep excluding both kinds. `humanDecisionQuestions`
  handles the new pending kind explicitly.

  Affected units: the new domain module, `workflow/domain/artifact-scope.ts`,
  `state-machine.ts`, `workflow/domain/failure-classes.ts`,
  `workflow/domain/retry-eligibility.ts`, `workflow/domain/human-decisions.ts`
  under `packages/orchestrator/src/`;
  `packages/orchestrator/import-boundaries.mjs` (the new domain module entry,
  and the `src/workflow.ts` runtime permission for
  `./workflow/domain/planning-review.js` citing ADR-0052); affected tests.
  Constraints: domain modules import only `errors` at runtime and `types` as
  types, plus recorded domain-to-domain permissions; the state machine never
  hashes; next-action behavior is unchanged.
  Dependencies: T003. Mapping: FR11, FR16, FR17, FR23, FR25, FR26, FR35, FR37;
  US 5, 7, 10, 12; ADR-0055 Planning review episode 1-2 and 5-7,
  Planning-review triage 3, Compatibility (ADR-0052 layering); Compliance 1,
  3, 7, 8, 9.
  Assurance owner: a new `test/workflow/domain/planning-review.test.ts` (pure
  fact tables for dispatch, numbering with gaps, unsafe numbers and
  non-matching names, scope rejection of non-members, absolute, `..`, alias
  strings, duplicates and empty selection, actionable classification, stale
  verdicts including missing, non-regular and symlinked members supplied as
  gathered facts, and restore eligibility), `state-machine.test.ts`,
  `retry-eligibility.test.ts`, `failure-classes.test.ts`,
  `recovery-eligibility.test.ts`, `digest-rejected-recovery.test.ts`,
  `artifact-scope.test.ts`, `human-decisions.test.ts` and
  `import-boundaries.test.ts`.
  Completion evidence: focused results with the legacy transition and
  eligibility baselines unchanged. Review batch: B.

- [ ] **T005 - Enforce read-only planning invocations, phase scope and checkpoints**

  Add read-only structured adapter invocation for the two output identities as
  specified for Claude and Codex, fresh and resumed. Analysis supports early
  session announcement. For both kinds the spawned environment sets
  `BANZAI_RUN_ID` to the run id and leaves `BANZAI_APPROVAL_DIGEST`,
  `BANZAI_WORKFLOW_DIGEST` and `BANZAI_REVIEW_ARTIFACT` empty or removed. MCP
  whitelist arguments follow the existing ADR-0022 construction unchanged. In
  `types.ts`, declare the request types and the
  `VendorAdapters` method or methods, and add the two result types and
  contracts to `TerminalCheckpointResult`, `TerminalResultContract` and the
  attempt-record result unions; the lifecycle result generics accept them.
  Update every adapter test double. `runReview`, `runSelection` and `runPhase`
  argv stay byte-identical.

  In `result-scope.ts`, both kinds prohibit every workspace change,
  `artifactWritePaths` returns `[]` for them explicitly, and recovery after
  publication excludes only the just-published planning artifact. In
  `terminal-checkpoints.ts`, the new kinds use the strict-selection check, are
  validated by re-running the T002 binding validators against the persisted
  episode, map to the `reviewer` and `planner` checkpoint roles, and never
  establish phase-result source identities. In `routing.ts`,
  `terminalResultContract` maps both kinds exhaustively. In `validation.ts`,
  checkpoint result parsing and expected-contract selection accept only each
  kind's own contract. The attempt-record key set changes only if an
  attempt-level planning context is persisted; any such key is validated only
  for these kinds, and `reviewContext` stays review-only.

  Affected units: `packages/orchestrator/src/adapters.ts`, `types.ts`,
  `workflow/attempts/lifecycle.ts` (result generics),
  `workflow/attempts/result-scope.ts`,
  `workflow/checkpoints/terminal-checkpoints.ts`, `workflow/domain/routing.ts`,
  `validation.ts`; generated plugin readers; `test/workflow-fixtures.ts` and
  the other adapter doubles; affected tests.
  Constraints: no live vendor invocation; the release-train version rule
  applies to regenerated readers.
  Dependencies: T002, T003, T004. Mapping: FR13, FR14, FR18, FR36, FR37;
  US 8, 10; ADR-0055 Planning review episode 3-4; Compliance 4, 9.
  Assurance owner: `adapters.test.ts` (argv fixtures for both vendors, fresh
  and resumed; the exact environment as the fake process runner receives it
  for both kinds), `result-scope.test.ts` (changes to
  `plan.md`, a documentation path and a source path rejected for both kinds),
  `terminal-checkpoints.test.ts`, `routing.test.ts` and `validation.test.ts`.
  Completion evidence: focused results proving the read-only invocation for
  Codex and Claude. Review batch: B.

- [ ] **T006 - Deliver planning-review instructions, prompts and context accounting**

  Add `plugins/banzai/phases/planning-review.md` and its phase definition,
  extend `InstructionPhase` and regenerate `src/phase-resources.ts`. Return
  `review` and `planning-review` for the reviewer from
  `instructionPhasesForRole`. Update the `Runner consumers` line of the four
  inlined policies, the `artifact-storage` naming sentence, the three
  `phases/planning.md` sections and scoping, and the `architecture-decision`
  and `development-plan` Orchestrated Mode text, all as specified. Keep the
  release-pinned fragments of those skills and of `prompts.ts`.

  Implement the prompt builders, the explicit common-text override, the
  analysis retry text, the applying input of `planningPromptEnvelope`, the
  planning-family filter for the new record kinds, artifact instructions,
  context authority and progress labels. Route phases stay unchanged. Implement
  ledger v2 and report v2: the per-version decoder, role and mutability tables,
  identity echo, the store writer and report enumeration through the shared
  file-token mapping. Update the smoke context-report identity pin. Add the new
  phase file to `plugin.requiredPaths` and classify it as `product`.

  Append one ADR-0055-authorized transition whose scope is exactly the changed
  instruction keys reported by `--describe`, after a passing `--check`. Assert
  that the expectations then contain the new phase key. Never hand-edit
  digests.

  Optional implementation guidance: add the new phase file to the release
  checker's code-design exclusion list.

  Affected units: `plugins/banzai/phases/planning-review.md`,
  `plugins/banzai/phases/planning.md`, the four policies and
  `plugins/banzai/policies/artifact-storage.md`, the two skill files under
  `plugins/banzai/skills/`;
  `packages/orchestrator/scripts/phase-resources-build.mjs`
  (`PHASE_DEFINITIONS`); generated
  `packages/orchestrator/src/phase-resources.ts`;
  `src/types.ts`, `phase-instructions.ts`, `prompts.ts`, `workflow.ts`
  (instruction, authority and label helpers), `context-accounting.ts`,
  `context-report.ts`, `store.ts` (ledger writer);
  `packages/orchestrator/phase-guidance-current.json` and its `.sha256` pin;
  `release-policy.json`; `publication-policy.json`;
  `scripts/smoke-committed.mjs`; `packages/orchestrator/test/committed-smoke.test.ts`
  (the fake-bundle context-report identity); `scripts/check-release.mjs` only
  for the optional exclusion above; `packages/orchestrator/import-boundaries.mjs`
  when `context-report.ts` gains a runtime import of the shared file-token
  mapping (citing ADR-0055); generated `packages/orchestrator/dist/`; affected
  tests.
  Constraints: no new prompt category, guidance section or `##` heading in
  `guidance/` files; `COMMON` and `REVIEW_COMMON` bytes are unchanged; the
  config phase vocabulary is unchanged.
  Dependencies: T001-T003. Mapping: FR4, FR5, FR9, FR13, FR18, FR23, FR24,
  FR25, FR36, FR42; US 1, 4; ADR-0055 Rework 3, Planning review episode 3-4,
  Evidence, accounting and instructions 4 and 6; Compliance 12, 13.
  Assurance owner: `phase-instructions.test.ts` (including that the
  planning-review phase text delivers the ordinary-finding threshold, the
  EQ-only exclusion and both examples), `prompts.test.ts` (envelopes,
  categories, filter, applying evidence), `context-accounting.test.ts`,
  `context-report.test.ts` with its CLI and render siblings, `store.test.ts`,
  `publication.test.ts` (25 resources), `release-validation.test.ts`
  (transition), `doctor.test.ts` (reviewer union), `workflow-skills.test.ts`,
  `committed-smoke.test.ts`, `import-boundaries.test.ts` and the instruction
  preflight cases in `workflow-project.test.ts`.
  Completion evidence: focused results, the recorded transition and exact
  resource bytes. Review batch: C.

- [ ] **T007 - Record planning-review human time, cancellation context and events**

  Add the `planning_review_triage` anchor and decoder case, and the six
  human-time event types from the event table. Implement the closed opener and
  response table, the restored-gate anchor identity, triage corroboration and
  the expected pending status in the existing reader, and keep the new attempt
  kinds out of the phase-result attempt projection. Add the terminal label
  `Planning-review triage`. Boundaries carry the analysis attempt id for the
  triage-pending event and the episode id for the gate-restored event.
  Cancellation capture records a pending triage's origin gate and reports the
  triage decision and an active planning attempt with `unsupported`
  availability. The cancellation report excludes planning attempt files from
  its v1 model inventory by exact token.

  Affected units: `packages/orchestrator/src/human-time.ts`,
  `human-time-store.ts`, `interactive.ts` (label only),
  `workflow/context.ts`, `cancellation.ts`, `cancellation-report.ts`;
  `packages/orchestrator/import-boundaries.mjs` (a runtime `./types.js`
  permission for `src/cancellation-report.ts`, citing ADR-0055, unless the
  shared file-token mapping lives in a module it already imports at runtime);
  affected tests.
  Constraints: the human-time ledger identity, cancellation reasons and gate
  vocabulary are unchanged; an unhandled shape must never invalidate a run's
  human-time evidence on a supported path.
  Dependencies: T003. Mapping: FR39, FR40, FR41; ADR-0055 Evidence,
  accounting and instructions 1-3; Compliance 11.
  Assurance owner: `human-time.test.ts` (closed ingress and forged anchors),
  `human-time-store.test.ts` (fixture journeys: gate opened, review requested,
  triage pending, triage recorded, gate restored, approved; plan rework; stale
  supersession; machine time excluded), `cancellation.test.ts`, the
  cancellation-report tests and `import-boundaries.test.ts`.
  Completion evidence: focused results with no ambiguity issue on the
  journeys. Review batch: C.

- [ ] **T008 - Record plan rework and mandatory ADR rework feedback**

  Add the plan-rework runner command and harden `decideAdr` exactly as
  specified in Runner flows. Both emit identity-only events, record
  `decision_recorded` human-time boundaries and continue planning with
  auto-resume. A rework never records approval or acceptance. Below state 10,
  plan rework is refused with the historical-run diagnostic and ADR rework
  keeps its legacy record shape. Update the existing test that sends ADR rework
  without a note so it supplies feedback; do not weaken it.

  Affected units: `packages/orchestrator/src/workflow.ts`; affected tests and a
  new planning-review workflow test file.
  Dependencies: T002-T004, T006, T007. Mapping: FR1, FR2, FR3, FR4, FR5, FR6,
  FR8, FR9, FR26, FR33, FR36, FR40; US 1, 2, 3; ADR-0055 Authority boundaries
  1, Rework 1-4; Compliance 1, 2, 12.
  Assurance owner: the new planning-review workflow test (with FakeAdapters:
  the exact feedback and earlier records reach the next plan prompt, the event
  omits feedback, a revised bundle needs a new approval, and invalid feedback
  leaves `state.json` and `events.jsonl` byte-identical with no adapter call),
  `workflow-review.test.ts` (ADR decisions, including accept with no note and
  accept with a note containing CR, both still succeeding) and the human-time
  cases in `workflow.test.ts`.
  Completion evidence: focused results. Review batch: D.

- [ ] **T009 - Run requested planning reviews and publish their artifacts**

  In `work-documents.mjs` and its typed projections, recognize the planning
  artifact name in ownership and inventory and add the bounded scanner of
  existing numbers; binding v3 is unchanged. In `review-artifact.ts`, export the
  lossless value renderer unchanged and extract the create-only publication
  primitive while keeping code-review publication behavior. Add
  `src/planning-review-artifact.ts` for the path, deterministic rendering,
  candidate validation by re-render and publication, with the content and
  privacy rules specified. Add the attempt-owned candidate path to `store.ts`.

  In `WorkflowRunner`, add the review-request command, the review executor,
  resume, retry and reconciliation dispatch for the review step, publication
  conflict re-reservation and the stale handling for the attempt, publish and
  zero-findings restore points. Cancellation closes the active episode.
  `applyPhaseResult` and the reconciliation fallthrough refuse kinds other than
  `plan`, `implementation` and `fix`. No review starts without a human request.
  `executePlan` refuses to run while the active step is `reviewing`,
  `analyzing` or `awaiting_triage`. Until T010 adds the analysis executor, a
  review with findings stops at `planning` with step `analyzing` and invokes no
  model. The review-step dispatch row with a recorded artifact continues from
  the post-publication point without a model call.

  Affected units: `plugins/banzai/lib/work-documents.mjs` and `.d.mts`;
  `packages/orchestrator/src/work-documents.ts`, `review-artifact.ts`, the new
  `planning-review-artifact.ts`, `store.ts`, `workflow.ts`, any new slice
  module; `packages/orchestrator/import-boundaries.mjs`; generated
  `packages/orchestrator/dist/` (the bundle includes `work-documents.mjs`
  through `src/work-documents.ts`); affected tests.
  Constraints: code-review rendering, numbering, publication and continuity
  stay unchanged; the release-train version rule applies to the plugin
  library.
  Dependencies: T002-T007. Mapping: FR10, FR11, FR12, FR13, FR14, FR15, FR16,
  FR17, FR25, FR26, FR27, FR35, FR37, FR39; US 4, 6, 7, 8, 10, 12; ADR-0055
  Planning review episode 1-7, Contracts and artifact 4-5; Compliance 3-7, 9.
  Assurance owner: a new `test/planning-review-artifact.test.ts` (determinism,
  hostile text round trip, required content, no private content, create-only,
  idempotent identical bytes, refused different bytes, ignore and visibility
  conflicts, symlinked destination), `work-documents.test.ts`, unchanged
  passing `review-artifact.test.ts` and `review-result-v2.test.ts`, and the
  planning-review workflow test. That test covers:
  - reviewer settings, the fresh session and the exact spawned environment;
  - a failed review retried after the reviewer model changes: the adapter
    receives the new model, the artifact names it, and reconciliation after a
    further configuration change re-renders identical bytes;
  - unchanged code-review state, with the next code review fresh and primary
    (`review-1.md`, `R1-F*`);
  - a writing reviewer rejected by scope and retry-eligible;
  - numbering past existing files;
  - reconciliation with one event, including a crash after the artifact is
    recorded that resumes with no adapter call and a single publication event;
  - zero findings without analysis, and no ordinary `plan` attempt while the
    active step is `reviewing`, `analyzing` or `awaiting_triage`;
  - after publication, an unchanged approval-bundle digest and approval
    snapshot, and `planning-review-<N>.md` absent from the run's artifact paths
    (FR27);
  - scope rejection before any adapter call;
  - stale points, including a symlink swap and a deleted member, and the exact
    `Planning review cannot restart: <path> is missing or not a regular file.`
    block;
  - cancellation.

  `workflow-recovery.test.ts` covers interrupted and failed review retries by
  step. `import-boundaries.test.ts` and the lint check cover the new modules.
  Completion evidence: focused results, unchanged characterization traces and
  unchanged code-review artifact bytes. Review batch: D.

- [ ] **T010 - Analyze findings, gate planning-review triage and apply or restore**

  Add the analysis executor and the triage-answer command, plus the
  applying-step `executePlan` input and the `applyPhaseResult`, resume, retry
  and reconciliation behavior for the analysis and applying steps, replacing
  T009's analyzing stop with the analysis executor, exactly as specified:
  - session resume or fresh start with rebinding on success;
  - the triage pending gate;
  - atomic answer validation and replay rejection;
  - stale handling at the triage, answer, apply and restore points, with the
    before-apply rehash only while `applyingAttemptId` is null, and
    `applyingAttemptId` set in the state write that creates the first applying
    attempt;
  - actionable application through `review_triage_evidence` from immutable
    evidence;
  - the non-actionable guarded restore without a model call;
  - episode closure;
  - the precise `answerHumanDecision` error.

  Add the `planningReview` projection to `WorkflowStatus`.

  Affected units: `packages/orchestrator/src/workflow.ts` and any slice module
  added in T009; affected tests.
  Dependencies: T009. Mapping: FR18, FR19, FR22, FR23, FR24, FR25, FR26, FR29,
  FR37, FR38, FR39, FR40, FR41; US 4, 5, 9, 12; ADR-0055 Planning review
  episode 2-5, Planning-review triage 1-4; Compliance 7, 8, 9, 11.
  Assurance owner: the planning-review workflow test. It covers:
  - the description's primary flow with three findings answered by option, own
    instruction and decline: the applying attempt receives exactly those
    dispositions and returns to a gate without approval;
  - all-declined triage with no model call;
  - stale, replayed, unknown, missing and duplicate answers rejected with no
    mutation or model call;
  - interrupted analysis retry and session rebinding;
  - an applying attempt that edits `plan.md` and returns an escalation: after
    the answer, the next `plan` attempt receives the triage evidence and no
    stale block occurs;
  - a failed applying attempt retried with no before-apply rehash;
  - `banzai cancel` at the triage gate: it clears the pending triage, closes
    the episode as `cancelled`, records the origin gate in cancellation
    observation v1 and leaves a valid v10 state;
  - status projection cases;
  - events free of feedback, finding and option canaries.

  Assurance also uses `workflow-recovery.test.ts` and the real-HumanTimeStore
  journey in `workflow.test.ts`.
  Completion evidence: focused results. Review batch: D.

- [ ] **T011 - Offer rework, review and triage in the terminal and human CLI**

  Implement the terminal behavior and CLI grammar of the Technical Breakdown:
  - plan and ADR menus;
  - required feedback prompts and confirmations;
  - the review scope selection and multi-select port method;
  - generalized, escaped finding and triage cards;
  - the zero-findings message;
  - retry labels;
  - status rendering through one shared lines helper;
  - human-time insertion anchored on the last exit choice;
  - `approve plan --decision`, the `approve adr` rework pre-check and
    `banzai review planning`;
  - `printState` triage output with optional counters defaulting to zero;
  - HELP lines;
  - the `InteractiveRunner` port methods;
  - every terminal IO and runner double.

  Optional implementation guidance: route `review` through the exact-contract
  CLI mode list so `banzai review planning --help` reaches its parser, and add
  plain-English assessment text beside the severity vocabulary.

  The CLI pre-checks and terminal validation callbacks reach the shared
  free-text validator in exactly one of two ways. Either `import-boundaries.mjs`
  records runtime `./validation.js` permissions for `src/cli.ts` and
  `src/interactive.ts`, citing ADR-0055, or `workflow.ts` re-exports only that
  validator.

  Affected units: `packages/orchestrator/src/interactive.ts`, `inquirer-io.ts`,
  `cli.ts`, `cli-routing.ts`, `vocabulary.ts`, any presentation module with its
  boundary entry; `packages/orchestrator/import-boundaries.mjs` or
  `workflow.ts` (re-export only), whichever the chosen route changes; affected
  tests and doubles.
  Constraints: `@inquirer/prompts` stays the only prompt dependency; the
  pinned HELP fragments and the five-gate sentence stay; the code-review
  triage and consultation flows keep their behavior.
  Dependencies: T008-T010. Mapping: FR1, FR2, FR3, FR6, FR7, FR8, FR10, FR11,
  FR12, FR17, FR19, FR20, FR21, FR28, FR33, FR34, FR35, FR37, FR38, FR41;
  US 1-7, 10; ADR-0055 Human CLI grammar 1-4, Planning-review triage 5;
  Compliance 2, 3.
  Assurance owner: `interactive.test.ts` (the FakeIO confirm double records
  the default to assert No; exact order with and without human time; escaping
  of C0, C1 and bidi text in lines and choice names; Ctrl+C at every new
  prompt; a model label starting with `Exit`), `inquirer-io.test.ts`,
  `cli-routing.test.ts` against the rebuilt committed bundle, the committed
  smoke help check, `import-boundaries.test.ts` and the lint check.
  `cli-routing.test.ts` covers:
  - byte-identical `state.json` and `events.jsonl` on every rejection;
  - accept with no note, and with a note containing CR, still succeeding;
  - the exact `approve plan` parser: `approve plan --decision=rework --note=x`,
    `approve plan --decison rework --note x`,
    `approve plan --decision rework --decision approve --note x` and
    `approve plan rework` fail, `planApproval` stays null and state and events
    stay byte-identical;
  - `approve plan` and `approve plan --by X --no-resume --verbose` still
    approve.
    Completion evidence: focused results after rebuilding the committed bundle.
    Review batch: E.

- [ ] **T012 - Publish agent control 8.0.0 and the supervisor protocol**

  Implement the control identities, capabilities, status projection, the two
  documents, `banzai control decide`, the prechecks and refusals, and the
  `AgentControlRunner` port methods exactly as specified, with the specified
  runner revalidation under its lock. Update `release-policy.json`
  `agentControl` and the release checker: expected identities, constant names
  and numeric versions, the documentation, smoke and test fragments, and the
  orchestrate skill fragments including the new row, both schema identities
  and the supervisor non-inference rule. In lockstep, update the pinned
  control-version sentences in `README.md`, `documentation/orchestrator.md`
  and `PROJECT_MANIFEST.md`, the committed smoke, the committed-smoke fake
  bundle and the supervisor assertions; the protocol has six decoded JSON
  examples. Rewrite `orchestrate/SKILL.md` and
  `references/control-protocol.md`, and record the skill change through one
  ADR-0055 transition with exactly that key. The protocol and the pinned skill
  fragments include the raw UTF-8 JSON rule (no `\u` escaping of non-ASCII
  text) and the `CONTROL_INPUT_TOO_LARGE` handling, under which the supervisor
  never truncates, summarizes or rewrites user text.

  Affected units: `packages/orchestrator/src/types.ts`, `agent-control.ts`,
  `agent-control-cli.ts`, `cli.ts` (control wiring and HELP);
  `release-policy.json`; `packages/orchestrator/scripts/check-release.mjs` and
  `smoke-committed.mjs`; the orchestrate skill and its control protocol under
  `plugins/banzai/skills/orchestrate/`; the pinned sentences in `README.md`,
  `documentation/orchestrator.md` and `PROJECT_MANIFEST.md`;
  `packages/orchestrator/phase-guidance-current.json` and its `.sha256` pin;
  generated `packages/orchestrator/dist/`; affected tests.
  Constraints: the five-gate fragments stay; no earlier capabilities or status
  document is served; control stays decode, precheck, delegate and project;
  the control-protocol fragments pinned by `project-adoption.test.ts`
  (including the exact line break) and by `workflow-skills.test.ts` stay.
  Dependencies: T001, T002, T006, T008-T010. Mapping: FR8, FR22, FR28, FR29,
  FR30, FR31, FR32, FR33, FR35, FR42; Resolved Assumption 20; US 9, 11;
  ADR-0055 Agent control 1-3, Compatibility and release; Compliance 2, 3, 8, 10.
  Assurance owner: `agent-control.test.ts` (v8 capabilities and order, v6
  gate decisions and paths with a null ADR-gate description, the triage
  projection with no downcast, every contract-valid value projectable,
  privacy canaries, closed and bounded documents including every forbidden
  `feedback`, `paths` and `adrId` combination), `agent-control-cli.test.ts`
  (grammar, prechecks and v1 refusal with no runner call; a maximum-bound
  triage answer in raw UTF-8 Cyrillic accepted, and the same answer with
  ASCII-only escaping failing with `CONTROL_INPUT_TOO_LARGE` with no mutation
  and no runner call; exactly two real-runner scenarios: plan rework by
  document, and non-actionable triage by document with no model call),
  `workflow-skills.test.ts`, `project-adoption.test.ts`,
  `release-validation.test.ts`, and the committed smoke and its test.
  Completion evidence: focused results after rebuilding the committed bundle
  with `npm run build`, and the recorded transition. Review batch: E.

- [ ] **T013 - Document current behavior, resolve release identity and verify the final candidate**

  First check the D24 release-train precondition, before writing release notes
  or the manifest release-version fact. Determine whether the pending
  working-tree version appears in the first-parent committed history of
  `package.json` (the `HOOK_CHANGED_WITHOUT_VERSION_BUMP` condition) or has been
  released. If it has (as v2.7.0 already is at `8a7ff64`), use the exact
  target version the owner named, or stop and ask for it (Human
  prerequisites). Then apply `npm run version:set -- <owner version>`. Never
  choose a version.

  Update the maintained documents listed in the Technical Breakdown so they
  describe the implemented behavior (FR42):
  - `plugins/banzai/AGENTS.md` keeps `There are five existing gates:`, adds no
    `##` heading, leaves its Policies section untouched and describes the loop
    under `adr_approval` and `plan_approval`;
  - no document says "four gates";
  - the manifest and module reference record current facts only, including
    the release-version fact, without choosing a version.

  Mark ADR-0055 Implemented in the decision log and the manifest index. Update
  only ADR-0055's implementation-state metadata line, and register its exact
  before and after images in the ADR-0055 map so the pinned transition
  authority stays valid. Reciprocal annotations stay unchanged. Write the
  release notes for the resolved version, naming both intentional breaks,
  their migration, the stricter `approve plan` parsing and the older-CLI
  warning. Create the file if absent, limit it to this change's content and
  classify it `maintainer`. Update the current release-notes links and the
  manifest facts, regenerate committed resources and the bundle with `npm run
build`, and write this work's implementation and test reports. Only then run
  the mandatory fresh checks below on the final candidate, so the publication
  check also scans the final reports.

  In the reports, record evidence, command results, deviations, the assessment
  records, the guard-only KPI statement and the accepted-ADR protection
  limitation. When implemented standalone, use the existing author-owned
  `banzai-plan-task-completion/v1` projection. In an orchestrated run, return
  structured completion claims and report narrative only, and let the runner
  publish the v2 region. Inspection evidence must show that no Accepted ADR
  decision body changed. Create no runner receipts or control records, and
  leave the approved plan tasks unchecked.

  Affected units: `PROJECT_MANIFEST.md`, `packages/orchestrator/MODULES.md`,
  `documentation/orchestrator.md`, `README.md`, `documentation/README.md`,
  `documentation/getting-started.md`, `documentation/context/README.md`,
  `CONTRIBUTING.md`, `plugins/banzai/AGENTS.md`,
  `plugins/banzai/hooks/README.md`, `plugins/banzai/contracts/README.md`,
  `plugins/banzai/documentation/README.md`,
  `documentation/decisions/README.md`, the ADR-0055 metadata line,
  `packages/orchestrator/scripts/phase-resources-build.mjs` (ADR-0055 image),
  `documentation/releases/<version>.md`, `publication-policy.json`, generated
  `packages/orchestrator/dist/` and reader resources, and this work's required
  reports.
  Dependencies: T001-T012. Mapping: FR24, FR42 and every FR; US 1-12; every
  ADR-0055 Decision subsection and Compliance 1-13.
  Assurance owner: the repository release gate, release-validation fragment
  pins and evidence-linked report review.
  Completion evidence: the fresh final candidate gate, the whitespace check,
  traceability in the reports and decision-body digests of the accepted ADRs.
  Review batch: F, followed by independent review of the complete bundle.

## Verification Obligations

The final source acceptance check uses the existing disposable release-candidate
driver. It copies tracked and untracked non-ignored files, gives the candidate
its own index and runs the complete `release:check` there. That covers tests,
type and lint checks, generated-resource and bundle parity, formatting, release
metadata, instruction-baseline validation, actual publication payloads and the
committed smoke, without staging the real checkout. Run it after the build, the
instruction transitions, the ADR-0055 lifecycle image and the documentation
updates stabilize. Record the exact source baseline and the final candidate
result. A failed or unavailable required check is not a pass. A sandbox
restriction may require the same authorized check in an appropriate host
environment, never a weakened replacement.

The two descriptors below are mandatory final checks. Focused tests within tasks
are permitted supplemental checks, selected from the named owners. The
behavioral assertions and inspections described above are binding coverage
requirements; this command inventory does not substitute for them. No live
vendor invocation, installation, push or publication is authorized by these
descriptors. Equivalent evidence does not replace these fresh checks.

```banzai-verification-obligations/v2
{
  "schema": "banzai-verification-obligations/v2",
  "schemaVersion": 2,
  "complete": true,
  "planRemainderSha256": "e1980f5860c64b2508b943332e84e8a9eada980e9ff83c8f5f92f86013f60255",
  "checks": [
    {
      "id": "final-release-candidate",
      "name": "Complete release gate on the final disposable candidate",
      "requirementRefs": [
        "T013",
        "FR1",
        "FR2",
        "FR4",
        "FR5",
        "FR6",
        "FR8",
        "FR11",
        "FR13",
        "FR14",
        "FR15",
        "FR16",
        "FR17",
        "FR18",
        "FR22",
        "FR23",
        "FR26",
        "FR27",
        "FR29",
        "FR30",
        "FR31",
        "FR33",
        "FR34",
        "FR35",
        "FR37",
        "FR40",
        "FR41",
        "FR42"
      ],
      "command": "node",
      "args": [
        "packages/orchestrator/scripts/release-candidate-check.mjs"
      ],
      "cwd": ".",
      "timeoutMs": 2700000,
      "evidence": "fresh",
      "sources": [
        {
          "path": "packages/orchestrator/scripts/release-candidate-check.mjs",
          "sha256": "698a35eebd4a7d5abf992d3ddbbb973d0332d350119fd99e70df57adf33f7eeb"
        }
      ],
      "materialization": null
    },
    {
      "id": "final-diff-whitespace",
      "name": "Final source diff whitespace validation",
      "requirementRefs": [
        "T013",
        "FR42"
      ],
      "command": "git",
      "args": [
        "diff",
        "--check"
      ],
      "cwd": ".",
      "timeoutMs": 30000,
      "evidence": "fresh",
      "sources": [],
      "materialization": null
    }
  ],
  "absenceReason": null
}
```

## Consistency Check

| Requirement coverage                                                         | Implementation tasks               | User stories |
| ---------------------------------------------------------------------------- | ---------------------------------- | ------------ |
| FR1-FR3: plan rework in the terminal                                         | T008, T011                         | 1, 2         |
| FR4, FR5: rework record, planner reach and in-place revision                 | T003, T006, T008                   | 1            |
| FR6: non-interactive plan rework                                             | T008, T011                         | 2            |
| FR7, FR8: mandatory ADR rework feedback                                      | T008, T011, T012                   | 2, 3         |
| FR9: ADR rework feedback reaches planning                                    | T006, T008                         | —            |
| FR10-FR12: review request, scope and confirmation                            | T004, T009, T011                   | 4, 6         |
| FR13, FR14: configured reviewer, fresh session, read-only                    | T003, T005, T006, T009             | 4, 8         |
| FR15, FR16: result contract, numbering and artifact                          | T001, T002, T004, T009             | 4            |
| FR17: zero findings restore the gate                                         | T004, T009, T011                   | 6            |
| FR18: read-only planner analysis                                             | T002, T005, T006, T010             | 4            |
| FR19-FR21: triage presentation and confirmation                              | T002, T010, T011                   | 4, 5         |
| FR22: complete, bound and durable triage record                              | T002, T003, T010, T012             | 4, 9         |
| FR23-FR25: exact application, Accepted ADR immutability, no automatic review | T004, T006, T009, T010, T013       | 4, 5, 12     |
| FR26, FR27: authority invariants and approval-bundle isolation               | T003, T004, T008, T009, T010       | 1, 4         |
| FR28: CLI operations at their gates                                          | T011, T012                         | 2, 3, 7      |
| FR29-FR32: agent control and supervisor protocol                             | T002, T010, T012                   | 9, 11        |
| FR33: free-text rules on every surface                                       | T002, T003, T008, T011, T012       | 2            |
| FR34: terminal neutralization                                                | T011                               | —            |
| FR35: scope containment                                                      | T004, T009, T011, T012             | 7            |
| FR36: recorded data never widens write scope                                 | T005, T006, T008                   | 1, 4         |
| FR37: failure, interruption and staleness                                    | T003, T004, T005, T009, T010, T011 | 10           |
| FR38: Ctrl+C and gate redisplay                                              | T010, T011                         | —            |
| FR39: cancellation at the triage gate                                        | T007, T009, T010                   | —            |
| FR40: human-time episodes                                                    | T007, T008, T010                   | —            |
| FR41: status and event history                                               | T003, T007, T010, T011             | —            |
| FR42: orchestrator and installed-process documentation                       | T001, T006, T012, T013             | —            |

Every user story maps to at least one row; a dash marks a requirement that no
user story exercises directly. Its acceptance evidence is the task's named
assurance owner. Each row lists exactly the tasks whose Mapping line names one
of its requirements. T013 additionally verifies every requirement through the
final candidate gate. FR30's raw UTF-8 rule and Resolved Assumption 20 (the
PR-D5 = A parity exception) are delivered by T012.

ADR-0055 Compliance and Confirmation items map as follows:

- 1 (rework without approval): T003, T004, T006, T008;
- 2 (feedback rejection on every surface): T002, T008, T011, T012;
- 3 (scope rejection): T004, T009, T011, T012;
- 4 (three-layer read-only execution and unchanged hashes): T003, T005, T009;
- 5 (code-review continuity untouched): T003, T009;
- 6 (create-only artifact): T009;
- 7 (zero-findings, non-actionable and actionable routes): T004, T009, T010;
- 8 (identity and byte failures before mutation): T002, T004, T010, T012;
- 9 (retry by episode step): T004, T005, T009, T010;
- 10 (control projection and negotiation): T012;
- 11 (human time, cancellation and evaluation): T003, T007, T009, T010;
- 12 (legacy readers and Accepted ADR bodies): T003, T006, T008, T013;
- 13 (focused and final verification): every task's assurance owner and T013.

The Decision subsections map as follows:

- Authority boundaries: T004, T008, T009, T010, T012;
- Rework: T002, T003, T006, T008;
- Planning review episode: T003, T004, T005, T009, T010;
- Contracts and artifact: T002, T009;
- Planning-review triage: T002, T010, T011;
- Human CLI grammar: T011;
- Agent control: T012;
- Evidence, accounting and instructions: T003 (state, events and the
  evaluation pin), T006 (context and instructions) and T007 (human time and
  cancellation);
- Compatibility and release: T003, T012, T013;
- Lifecycle Links: T001, with no other annotation change in T013.

The amended ADR-0018/0028/0031/0034/0037/0042/0054 constraints are carried by
those owners. ADR-0002/0021 continuity is preserved by T003 and T009. ADR-0038
bundle authority is preserved by T006, T008 and T010. ADR-0044 transitions are
recorded in T003, T006 and T012, with authority admitted in T001. ADR-0052
purity and layering are kept by T004 and T009. ADR-0022 whitelist handling is
reused unchanged by T005. ADR-0023 checkpoint durability is
preserved by T005. ADR-0035 cancellation observation v1 is preserved by T007.
ADR-0047's completion projection is preserved by T013. ADR-0043/0049 are
honored by the v2 inventory and T013. No prerequisite ADR is Proposed:
ADR-0055 and every amended decision are Accepted.

Required manifest transitions: the state-10 and control-8.0.0 pinned fragments
move in lockstep with their release pins in T003 and T012. The remaining
section 2, 4, 5, 6, 8 and 10 facts, the module reference and the ADR-0055
implementation state are updated in T013 from implemented behavior only.

Security enforcement owners: class 1 (untrusted input reaching a resource path
or terminal renderer) at the shared free-text validator and contract decoders
(T002), the scope membership rule and contained digest reads (T004, T009), the
control decoders (T012) and terminal escaping (T011). Class 2 (capability
decision for the new attempt kinds) at the adapter invocation (T005), the hook
(T003), phase scope (T005), the state machine and runner commands (T004,
T008-T010) and planning-family prompt reach (T006). The planning work itself
writes only this plan; it invokes no executor, migration or publication.

Material Engineering Quality constraints:

- EQ-02 and EQ-03: the pure domain module, the renderer module and exact
  import boundaries (T002, T004, T006, T007, T009, T011; owner
  `import-boundaries.test.ts` and the lint check).
- EQ-04: validation at the first trusted boundary (T002, T009, T011, T012).
- EQ-05: stale, conflict, interruption and cancellation semantics (T004, T009,
  T010).
- EQ-06: reuse of publication, adapter, lifecycle, decoder and timing owners
  without a new dependency (T005, T009).
- EQ-07: code review, consultation answer v2, accept and reject notes and the
  existing validators stay out of scope (T002, T008, T009; evidence: unchanged
  passing `review-artifact.test.ts`, `review-result-v2.test.ts`, the existing
  consultation and control decoder tests, and the accept-note cases).
- EQ-09: named breaks, legacy readers and pinned versions (T003, T012, T013).

Consistency result: every FR and user story has an implementing owner. Accepted
ADR-0055 constraints are separated from current source facts. Task order follows
the vocabulary, rule, invocation, artifact, instruction, evidence, runner,
surface and documentation dependencies. Every closed vocabulary, version pin,
generated resource, baseline transition and legacy reader has a task owner. The
one known limit on PR-D3 parity is the owner's recorded exception PR-D5 = A
(Resolved Assumption 20): an escape-inflated triage answer above 64 KiB fails
before mutation, and the terminal route remains. No other product choice is
unresolved. This is planning consistency, not independent review or
implementation verification.

## Planning Validation

- The repository's plan parsers (`parseApprovedPlanTaskIds`,
  `validatePlanRunnerControlTasks` and `planHumanPrerequisites` in
  `packages/orchestrator/src/plan-task-completion.ts`) accepted the 13 ordered
  task headings T001-T013, found no task write target on a runner control path
  and returned the Human prerequisites section. The runner-control guard first
  rejected a T003 test description that named the work directory by path; that
  text was rephrased without changing the obligation.
- The canonical v2 obligation parser (`parseTaskVerificationObligations` in
  `plugins/banzai/lib/task-verification.mjs`) validates the complete inventory
  and both descriptors with no remainder-digest mismatch. The pinned driver
  source digest matches `packages/orchestrator/scripts/release-candidate-check.mjs`.
- Relative links in the plan, the description and ADR-0055 resolve; the ADR-0054
  link example inside the fenced block resolves from ADR-0054's directory. No
  line has trailing whitespace, and the Prettier check passes for the three
  documents.
- Release validation (`node packages/orchestrator/scripts/check-release.mjs`)
  passed on the working tree after ADR-0055's acceptance. The ADR-0054
  reciprocal link stays deferred to T001.
- The working-tree source publication check
  (`publication-check.mjs --tree working`) reported a clean, classified public
  surface. No file was staged.
- An independent planning review in five lenses (requirements coverage, source
  accuracy, planning policy, safety and executability), each with adversarial
  verification, reported 45 findings. 34 were confirmed and 11 were refuted.
  33 confirmed findings were applied to this plan. The parity question they
  raised was answered by the owner as PR-D5 = A and recorded in the
  description. The remaining one, a Codex MCP-server override for the new
  attempt kinds, was withdrawn. An offline check on codex-cli 0.162.1 showed
  that `-c mcp_servers={...}` merges with the user's configuration and isolates
  nothing, and the owner chose not to pursue Codex MCP isolation. ADR-0022
  whitelist handling is therefore reused unchanged.
- A separate standalone review,
  [review-1.md](review-1.md) (`changes_requested`), reported two findings
  against the previous plan bytes.
  - The owner rejected F1, which asked to reconcile the read-only guarantees
    with the Codex MCP decision. The requirements and ADR-0055 text stay
    unchanged, and so does the decision not to pursue MCP isolation.
  - F2 asked that EQ-only observations never become planning-review findings.
    It is resolved in the planning-review phase instructions and in T006's
    assurance.
- The full release gate (`release:check`, including the test suite and the
  committed-bundle smoke), the implementation tests and installed-client checks
  were not run during planning. They remain the mandatory obligations above.

## Approval and Handoff

Approve this exact `description.md`, this `plan.md` (including its verification
inventory) and the accepted ADR-0055 constraints, together with the amended and
unchanged binding ADRs named above, as one implementation bundle. Approval
includes the owner's recorded PR-D3 parity exception PR-D5 = A (Resolved
Assumption 20). Approval is pending. Later edits to binding requirements, task obligations or mandatory
verification need the normal bundle approval path; routine internal choices
within these constraints do not. Task write targets exclude existing project
work documents and runner control paths.

After implementation and its required verification, run independent review into
the next `review-N.md` in this directory and stop at human finding triage when
required. Independent review is a separate workflow phase, not a task claimed
complete before the implementation evidence can be validated.
