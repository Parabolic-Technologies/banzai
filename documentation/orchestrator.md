# Banzai Orchestrator Reference

Operational reference for the local `banzai` CLI. For installation and your
first task, start with the [Quick start](../packages/orchestrator/README.md#quick-start).
For other guides, see the [documentation index](README.md).

## Contents

- [Workflow Reference](#workflow-reference)
- [Boundaries](#boundaries)
- [Setup](#setup)
- [Interactive Human Time](#interactive-human-time)
- [Test Assurance And Verification Ownership](#test-assurance-and-verification-ownership)
- [Engineering Quality Shadow Review](#engineering-quality-shadow-review)
- [Repository Release Confidence](#repository-release-confidence)
- [Cancellation observations](#cancellation-observations)
- [Commands](#commands)
- [Agent Control](#agent-control)
- [Project Verification Readiness](#project-verification-readiness)
- [Context Accounting and Budgets](#context-accounting-and-budgets)
- [Evaluation Export](#evaluation-export)
- [Evaluation KPIs](#evaluation-kpis)
- [Interactive Mode](#interactive-mode)
- [Review Artifact](#review-artifact)
- [Choosing Models](#choosing-models)
- [Model Configuration](#model-configuration)
- [Spawned Claude Environment](#spawned-claude-environment)
- [Live Progress](#live-progress)
- [Failure Recovery](#failure-recovery)
- [Local State](#local-state)

## Workflow Reference

The `banzai` CLI. It first uses the configured planning model to select a
workflow through a read-only structured contract:

1. `quick-fix`: implementer runs `quick-fix`, deterministic verification, done;
2. `feature`: implementer runs `feature`, deterministic verification, done;
3. `strict`: planner runs `feature-description`, conditional
   `architecture-decision`, and `development-plan`; after explicit decisions,
   a compatible builder lineage runs `code-writing`, `test-writing`, and
   accepted fixes; deterministic verification runs, and an independent reviewer
   runs `feature-review`.

Strict review findings are triaged by the human; only accepted findings reach
the fixer. If none are accepted, the complete triage closes the run directly
without a fixer, verification, or unchanged-source reviewer call; status keeps
the latest `changes_requested` verdict and labels completion as human triage,
not review pass. Accepted findings retain deterministic verification and bounded
re-review. Primary review is fresh; routine re-review resumes the reviewer for
at most two deltas before a fresh full audit. Automatic selection is the default,
and uncertain or escalated work falls back to strict.

New strict plans carry the installed plan policy's explicit **Plan Authority**
convention: binding behavior, scope, necessary constraints and evidence, with
useful optional guidance labeled separately. Role prompts refer to that same
policy. A compliant alternative within approved discretion needs no reapproval
or deviation report merely for differing; legacy directives retain their approved
meaning and required checks remain mandatory. Editing any approved plan text,
including guidance, still invalidates approval. Task parsing, completion and
review-result v2 contracts are unchanged by this document convention.

This package, `@parabolic-technologies/banzai`, is a separate npm workspace:
it neither installs nor starts with the plugin, and the plugin remains usable
on its own. Its package version is a mandatory mirror of root
`package.json.version`, the sole Banzai release-train authority; shared source
metadata does not imply shared installation or publication.

## Boundaries

- macOS or Linux with Node.js 22.20.0+ within major 22 or Node.js 24.11.1+
  within major 24;
- local `codex` 0.145.0+ and `claude` 2.1.218+ executables;
- individual-subscription authentication only;
- one active run in the current checkout;
- no API keys, direct vendor APIs, worktrees, branch switching, stash, reset,
  commits, or external writes.

## Setup

The [Quick start](../packages/orchestrator/README.md#quick-start) covers installation from npm. For development,
run the following from a source checkout instead:

```sh
npm ci
npm run install:orchestrator
```

The development command rebuilds the executable and exposes `banzai` through
npm's global link. The link points to that checkout; rerun `npm run build`
after changing orchestrator source. Then follow the project configuration
steps in the Quick start.

## Interactive Human Time

The interactive run summary includes `Human time — this run`. `Gate response
elapsed` is the known subtotal from a pending decision to its recorded response,
before any following model work. It includes passive waiting and does not
measure active effort. Open, cancelled, superseded and incomplete gates, recovery
waiting, and capture or clock gaps remain separate in the summary and details.

At an existing human stop or blocked/terminal summary, select
`Update my active time` to enter **your cumulative active minutes for this run
so far**. Include preparation, approvals, review, active checks, debugging,
manual repair and recovery, including work outside the CLI. Exclude passive
waiting, minutes already allocated to another run or task, other contributors,
and study-recording overhead. No identity question or additional post-gate
prompt is added. The editor returns to the same decision; mid-triage selections
are retained.

An entry is always `estimated`, with an `as of` timestamp. Entering 15 after 12
replaces the total with 15. Blank input or cancelling keeps the earlier value;
explicit zero saves zero. Nothing is inferred from gate elapsed. The label
`single-engineer estimate; identity not verified` identifies the collection
scope. Later work does not refresh a saved estimate. Contributor coverage and
a complete engineering-task total remain unestablished. Use
`Show human-time details` to inspect episode outcomes and clock continuity.

The interactive path stores bounded local metadata in
`.banzai/runs/<run-id>/human-time.json` as a private `0600` file. It retains
observations and replacement history with the run, including cancelled work;
deleting the run removes this evidence. The run directory is not a research
archive. Historical completed gates are not backfilled when first opening an
old run. Reopening preserves captured episodes, but intervals closed outside
the process have unverified wall-clock continuity. No activity monitoring,
personal names, answers, prompts, transcripts or arbitrary notes are collected.

`Time was not saved` means the write did not succeed; reopen the editor against
the current evidence before retrying. Stale edits and concurrent writers cannot
silently overwrite a newer total. A hard crash may leave `human-time.lock` or a
temporary file. Reads still use the last valid ledger. An ambiguous guard is
never reclaimed automatically: cleanup requires a separate explicit offline
maintenance action with writers stopped. Timing cannot authorize or replay a
workflow decision or invoke recovery.

Existing evaluation/KPI/context/control and status JSON contracts ignore this
private ledger; evaluation v1 `humanMinutes` remains unavailable. The separate
cancellation report has the narrow estimate disclosure described below. Task-wide
collection, equivalent native-workflow collection, acceptance/quality evidence
and the effectiveness comparison remain follow-up work. See
[feature specification](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/features/interactive-human-time/description.md)
and [ADR-0034](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/decisions/0034-durable-human-time-observations.md).

## Test Assurance And Verification Ownership

Banzai selects tests by the observable guarantee and plausible regression they
protect. Business rules, public and persisted contracts, authorization,
security, privacy, state transitions, recovery, decision tables, and confirmed
defects take priority. Coverage percentage and test count are diagnostics, not
completion targets, unless the target project's manifest records an explicit
policy threshold. Boundary fakes are valid when assertions exercise the real
contract; tests that mirror private call order or duplicate existing evidence
are not useful assurance.

Implementation and fix prompts contain the configured profiles in exact profile
and command order, including argv and timeout. Builders run focused affected
tests and leave supplied full-scope commands to the runner's post-phase gate. If
the manifest's applicable final suite is absent from the supplied profiles, the
builder runs it once and records the readiness gap. A structured
`requestedVerification` entry never authorizes an unconfigured command.

Independent review treats successful current runner evidence as authoritative
by default. It may run a focused reproduction or repeat missing, stale,
inconsistent, or directly material evidence, recording the reason; it does not
rerun the complete suite or formatter by habit. A missing-test finding must name
the material guarantee, plausible regression, evidence gap, and proportionate
observable test level.

## Engineering Quality Shadow Review

The installed plugin carries one vendor-neutral Engineering Quality policy in
`policies/engineering-quality.md`. Standalone consuming skills explicitly read that file
relative to their installed `SKILL.md`; runner phases receive the same body inline. Planning and implementation skills
apply only properties material to the changed repository surface; Test
Assurance continues to own test selection, while configured checks, contract
verification, Security Assurance, or justified inspection may own other
material claims.

Strict review completes and freezes its ordinary findings, severities, and
verdict before EQ classification. An already-actionable finding may add one
primary `EQ-NN` entry to `violates` without changing ordinary review semantics.
A genuinely incremental candidate may appear only as an `EQ-SHADOW:` string in
the existing free-form `deferredCoverage` collection. Shadow entries never enter
`findings`, human triage, accepted-finding payloads, fixer scope, verdict or
completion logic, and are not parsed by runtime validation.

New orchestrated reviews retain opaque `EQ-SHADOW:` strings exactly through
runner rendering, including multiline content. Historical reviewer-written
Markdown remains intact; standalone review owns its durable Markdown separately.
No runtime interpretation or gate is added.

After a fix, review is closure-oriented: it verifies the immediately preceding
accepted IDs first. A new concern requires evidence that the fix introduced or
newly exposed it, directly regressed an approved contract/invariant, or made a
previously unobservable critical correctness, security, or lifecycle issue
visible. Reviewer rotation does not reopen rejected or deferred advice against
unchanged evidence and authority. The sampled evaluation procedure is
[`documentation/evaluation/engineering-quality-shadow.md`](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/evaluation/engineering-quality-shadow.md).

## Repository Release Confidence

Repository maintenance uses the committed bundle without requiring the global
link:

```text
npm run release:validate
npm run smoke:committed
npm run release:check
```

For an explicitly approved product release, a maintainer first selects one
canonical SemVer target from the highest impact across all included plugin and
orchestrator changes, then synchronizes the fixed metadata set:

```text
npm run version:set -- <version>
```

The operation changes root `package.json.version` and eight mirrors in seven
files: four plugin fields, the orchestrator package, and the lockfile's
`version`, `packages[""].version`, and `packages["packages/orchestrator"].version`.
It prepares one candidate per physical file, including all three lockfile edits.
Normal updates require nine equal current values and a greater target. The
bootstrap exception accepts the six-field `1.19.0` state with the three new
fields absent and inserts them at target `1.19.0`; partial bootstrap or root-only
editing is invalid. It accepts no path override, selects no
version, and does not build, validate, install, publish, or perform Git work.
Before deleting `.banzai-version-set`, final cleanup durably writes the fixed
`.banzai-version-set.guard` with the same exact originals and candidates. The
guard remains validator-visible until the main journal removal is synced. If an
interrupted operation retains the transaction directory, cleanup guard, or
guard temporary, `npm run version:recover` restores its exact originals. Before
changing targets or recursively cleaning a journal that coexists with the
guard, recovery authenticates every retained entry as an expected remnant of
that same transaction. It is not an interface for selecting a release rollback
target. Before restoring any target, explicit recovery checks every current
metadata file against the authenticated original/candidate bytes and recorded
mode. Later edits or mode drift cause refusal and preserve recovery evidence.
Recovery uses the retained format's fixed targets: six-file journal/guard
format 1 and grouped seven-file format 2 are both supported, independently of
the current write policy. Restoring an old independent-version candidate
requires its matching historical tooling before another migration. The
standalone CLI keeps its embedded package mirror and needs no root package file
at runtime. Rebuild the bundle after release-policy changes because
`live-compatibility.ts` embeds that configuration.

`release:validate` is read-only. It checks canonical nine-way release-train
parity against root `package.json.version`, rejects any retained version
transaction or cleanup-guard state, keeps the Claude marketplace versionless,
and validates required skills/hooks/contracts/entry files, hook syntax,
package/lockfile policy, canonical Test Assurance, Security Assurance,
and Engineering Quality policy wiring, committed bundle mode, CI policy, and
documentation policy. Instruction-layout validation pins the exact shim,
process sections, six policy owners, complete required/conditional read matrix,
scoped reference rules, migration approval text and last legacy-compatible
release. The Engineering Quality check protects rule/reference
and shadow-boundary text; it does not analyze target-project architecture.
`smoke:committed` creates a disposable Git repository and runs the committed
bundle's non-TTY help, init, agent-control capabilities/status, doctor JSON, and
evaluation JSON paths twice. Capabilities also run outside Git. The smoke
requires the v1 identities, clean stderr, deterministic bytes, no source,
configuration, Git, or `.banzai` mutation, and complete cleanup. Help and
capability versions must match the current package mirror independently of
the pinned machine-contract versions.
`release:check` adds both checks and direct formatting to the unchanged
`verify` gate, rejects tracked byte or mode mutation, and never invokes
`version:set` or `version:recover`.

<!-- release-policy:start -->

Engines: `>=22.20.0 <23 || >=24.11.1 <25`

Version authority: `package.json#/version`; 9 fields in 7 files.

| Evidence              | Node    | Image                   | GitHub Actions job              | Policy   |
| --------------------- | ------- | ----------------------- | ------------------------------- | -------- |
| Supported (blocking)  | 22.20.0 | `node:22.20.0-bookworm` | `release_check_node_22`         | required |
| Supported (blocking)  | 24.11.1 | `node:24.11.1-bookworm` | `release_check_node_24`         | required |
| Forward compatibility | 26.7.0  | `node:26.7.0-bookworm`  | `forward_compatibility_node_26` | advisory |

<!-- release-policy:end -->

The supported lanes are blocking and each runs `npm ci` plus the full local
gate. Node 26 is advisory forward compatibility. A required environment
failure remains missing evidence rather than becoming a product pass.
The images are the Git-capable official Bookworm variants. Each lane runs
`git --version` and registers `$GITHUB_WORKSPACE` as a Git `safe.directory`
before installation: the gate verifies tracked-file immutability with Git,
and the container runs as root while the runner owns the checkout directory,
which Git otherwise rejects as dubious ownership.

The workflow is [`.github/workflows/ci.yml`](https://github.com/Parabolic-Technologies/banzai/blob/main/.github/workflows/ci.yml).
Configure branch protection or rulesets to require `release_check_node_22` and
`release_check_node_24` after GitHub has reported those checks. Workflow YAML
does not configure repository merge rules. Validate workflow syntax locally
with `actionlint`; `.github/actionlint.yaml` declares the custom runner label.

To enable the manual live job, provision an isolated Linux runner labeled
`banzai-live` with supported Codex/Claude CLIs and the subscription-auth roots
described below. Restrict its runner group to this repository and this workflow
at explicitly trusted protected refs using GitHub's
[workflow access policy](https://docs.github.com/en/enterprise-cloud%40latest/actions/how-tos/manage-runners/self-hosted-runners/manage-access).
The runner label and job condition do not restrict other workflows' access to
that machine. Keep the live job disabled if that protected runner boundary is
unavailable. Once provisioned, set repository variable
`BANZAI_LIVE_COMPATIBILITY` to `1`, select **Run workflow** on a protected ref,
and enable the `live_compatibility` input. The job requires all three conditions
and is skipped on push and pull request events. Node setup disables automatic
npm caching, checkout disables persisted credentials, and no artifact upload
is configured. GitHub runner provisioning and authenticated live execution
require their own evidence.

The separate live command is deliberately absent from `release:check`:

```text
npm run compatibility:live -- --confirm-live
```

It requires dedicated out-of-band subscription state through
`BANZAI_LIVE_CODEX_AUTH_ROOT` and `BANZAI_LIVE_CLAUDE_AUTH_ROOT`. API-key
and third-party-provider paths are rejected. The command clones the exact
committed candidate into disposable Codex and Claude checkouts, copies bounded
auth state to restrictive temporary roots, verifies minimum CLI versions and
subscription auth, and then performs at most one model call per vendor.

Codex must execute the two exact runner-owned write-probe commands under its
read-only sandbox. Only failed `item.completed` `command_execution` events with
the direct command or a fully anchored `sh`/`bash`/`zsh -lc` wrapper, exact
payload, target, bounded probe result, and non-zero denial count as evidence.
Arbitrary prefixes, suffixes, operators, and trailing arguments are rejected;
the runner renders both vendors' candidates from review-result/v2 and their
frozen fixture snapshots. Claude uses the same read-only arguments as normal
review. A typed host `system/init` inventory must include Read, Glob, Grep and
Skill and exclude every other capability except StructuredOutput. This proves
source/control/candidate writing is unavailable through exposed tools; it does
not claim an attempted write was denied. Missing, duplicate, unknown or writable
tools fail the authenticated scenario. Model prose and requested argv alone do
not establish this evidence. Offline hook tests are separate from live evidence.

Each invocation is limited to five minutes, the complete command to fifteen
minutes, and the total to two model calls. The only stdout is
`banzai-live-compatibility/v2` JSON with closed status/check/version/duration
fields. Raw prompts, reasoning, transcripts, tool/model/auth output, source,
paths, credentials, and private model output are never retained or emitted.
Exit 0 means pass, 1 fail, and 2 unavailable. Missing auth is unavailable before
any model call. The manual GitHub Actions job retains no artifact.

Implementing and unit-testing this boundary does not prove current live vendor
behavior. An authenticated run requires explicit human authorization and safe
protected runner provisioning.

## Cancellation observations

Interactive cancellation keeps the existing
`Cancel this run? The persisted run becomes terminal.` confirmation,
with refusal as the default. Once confirmed, the runner requests process stop
and persists cancellation before showing one optional reason selection. `Skip`
is first; no meaningful reason is preselected. Leaving the confirmation causes
no cancellation. Leaving the reason prompt exits the interaction with the run
already cancelled; an interrupted response is recorded best effort. A hard
crash can leave an unanswered observation. This prompt uses the base IO, so it
adds no human-time episode or estimate edit.

The CLI opens no reason prompt, including without a TTY:

```sh
banzai cancel --run run-000014 --reason plan_unsuitable
banzai cancel
banzai eval cancellations --from 2026-09-06T00:00:00Z
banzai eval cancellations --run run-000014 --json
banzai control capabilities --cancellation
```

The eight values are `intent_changed`, `adr_rejected`, `plan_unsuitable`,
`workflow_unsuitable`, `execution_blocked`, `superseded`, `other`, and
`unspecified`. `other` means a known reason outside the list; `unspecified`
means no reason was supplied. CLI omission and interactive Skip retain distinct
provenance. An explicit reason describes operator motivation, not a verified
root cause. ADR rejection alone returns to planning; a failure or a rejected
ADR never selects a reason automatically. `--run` binds the action to that
still-current run. Invalid arguments fail before mutation.

A repeated cancellation preserves the original event and reason. Completed
runs receive no cancellation observation. Only the original interactive call
can submit its first response after cancellation, using its process-local
receipt; there is no late-edit, backfill or historical reason command. Reporting
and repeated cancellation never repair missing evidence.

`Run cancelled. Cancellation observation was not saved.` means terminal state
was saved but analytics was not. A stop signal is a request, not confirmation
that the process exited. `Cancellation could not be confirmed` means terminal
persistence is unresolved. A hard crash may leave a short `.state-write.lock`;
it is never reclaimed automatically or during reporting. An offline maintenance
action with writers stopped is outside this feature.

`banzai eval cancellations` emits Markdown by default or JSON with `--json`.
Both render the same deterministic `banzai-cancellation-report/v1` document
(schema version 1). It uses run **creation** timestamps: `--from` inclusive,
`--to` exclusive, intersected with repeatable `--run` selectors. No selectors
means all local candidates. Explicitly missing IDs fail. Missing/malformed state
remains visible as unknown lifecycle or unresolved date membership. Known
cancelled runs remain in every reason denominator even without observations.
Every ratio includes numerator and denominator; zero denominator yields `null`
in JSON and `unavailable` in Markdown.

The report separates meaningful reported-reason coverage, response coverage
(including Skip, omission and unspecified), and observation availability.
Legacy bare cancellation events are `legacy_absent`; absent evidence is
`missing`; interrupted/unanswered, malformed, unsupported and conflicting
evidence remain separate. Historical runs receive no invented reasons. Workflow
and pre-cancellation phase/gate retain availability and provenance.

Technical rows use report-local references and existing bounded failure fields.
No raw logs, prompts, error prose, exact private IDs or source paths are exported.
Usage and duration are covered subtotals from canonical attempts ending before
cancellation; open/straddling attempts and inventory gaps prevent exact totals.
Elapsed time is UTC wall time with unverified continuity. The existing current
single-engineer active-time estimate is disclosed only if its `asOf` is on or
before cancellation; it remains estimated with unknown contributor/later-work
coverage. Superseded revisions are never resurrected. Neither elapsed spans nor
estimates are summed into person-time or task totals. Report-local keys do not
establish task identity; `superseded` records continuation intent and confirmed
continuation remains unavailable without a supported exact source.

Observation and optional discovery use `banzai-cancellation-observation/v1` and
`banzai-cancellation-capabilities/v1`, independently of frozen evaluation/KPI v1,
control 2.0.0 and state schema 3. The implementation candidate dated 2026-09-06
enables new collection. Actual study collection starts with the first real v1
observation after adoption; that start is not established by synthetic tests.
The extra optional cancellation interaction is an instrumentation change.
Coverage improvement is not evidence of improved agent performance, and a lower
cancellation fraction is not itself the objective. See
[feature specification](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/features/cancellation-observations/description.md).

## Commands

```text
banzai
banzai interactive
banzai doctor [--json]
banzai control capabilities [--cancellation]
banzai control status
banzai control start --slug <slug>
banzai control answer [--by <name>] [--no-resume]
banzai control recover [--by <name>] [--no-resume]
banzai model
banzai run --slug <slug> --request <text>
banzai status [--json]
banzai eval export [--json] [--from <RFC3339>] [--to <RFC3339>] [--run <run-id>]...
banzai eval kpi [--json] [--from <RFC3339>] [--to <RFC3339>] [--run <run-id>]...
banzai eval kpi --input <export.json> [--input <export.json>]... [--json]
banzai eval context [--json] [--from <RFC3339>] [--to <RFC3339>] [--run <run-id>]...
banzai eval cancellations [--json] [--from <RFC3339>] [--to <RFC3339>] [--run <run-id>]...
banzai compatibility live --confirm-live
banzai resume
banzai retry
banzai recover
banzai approve adr --id <id> --decision accept|reject|rework
banzai approve plan [--no-resume]
banzai triage --accept R1-F1 --reject R1-F2 --defer ""
banzai cancel [--run <run-id>] [--reason <enum>]
```

Approval and triage commands resume automatically unless `--no-resume` is
present.

## Agent Control

The optional `orchestrate` plugin skill supervises this CLI through a narrow
versioned control boundary. It is an outer operator only, reachable solely
through an explicit user invocation. Claude Code enforces that boundary with
`disable-model-invocation: true`; Codex uses `agents/openai.yaml` with
`policy.allow_implicit_invocation: false`. The skill is never selected from
prompt wording, and the runner's planner, implementer, fixer, selector, and
reviewer phases never invoke it.

`banzai control capabilities` is valid outside a Git repository and performs no
repository discovery, adapter construction, vendor/authentication call, lock,
recovery, or write. It emits canonical `banzai-agent-capabilities/v3` JSON with
schema version 3, control contract `3.0.0`, the package-derived Banzai
release-train version, umbrella contract, the exact supported non-TTY operation
set, and an ordered `inputSchemas` list per operation. Capability and doctor
output prove neither subscription authentication nor sandbox credential
visibility. Compatibility still follows these explicit contract and operation
identities, never the shared release-train value alone.

`banzai control status` emits canonical `banzai-agent-status/v2` JSON. With no
persisted run, `activeRun` is `null`. Otherwise the allow-list projection
contains run identity/lifecycle, route, semantic next action, retry and bounded
recovery eligibility, the pending human gate, approval validity,
task-completion evidence, bounded verification outcomes, review verdict, and
review-pass or human-triage completion basis. A terminal `done` or `cancelled`
projection remains available for evidence but does not block an explicitly
requested new run; only a non-terminal projection does. The status excludes the
original request, prompts, transcripts, raw model output, environment values,
secrets, approval digests, raw commands, arguments/logs, absolute repository
paths, raw `.banzai` paths, and completed consultation history. A current
`decision_consultation` gate is the only public surface that includes its
bounded one-to-three-card request because the supervisor needs it for the next
action.

Start, escalation answer, keyed consultation answer, and recovery accept one
closed JSON document of at most 64 KiB through direct process stdin. Request
and recovery stay on v1; the ordered v1 answer remains the legacy/current
escalation input, while consultation requires the keyed v2 answer:

```json
{
  "schema": "banzai-agent-request/v1",
  "schemaVersion": 1,
  "request": "complete task request"
}
```

```json
{
  "schema": "banzai-agent-answer/v1",
  "schemaVersion": 1,
  "answers": ["first ordered answer", "second ordered answer"]
}
```

```json
{
  "schema": "banzai-agent-answer/v2",
  "schemaVersion": 2,
  "runId": "run-from-current-status",
  "requestId": "request-from-current-status",
  "roundId": "round-from-current-status",
  "answers": [
    {
      "decisionId": "decision-from-current-status",
      "response": {
        "kind": "option",
        "optionId": "option-from-current-status",
        "text": null
      },
      "note": null
    }
  ]
}
```

Recovery is a separate current-human decision, not a retry or approval. After
showing the latest bounded workspace counts and exact identity, status either
warns about partial/duplicated side effects for an interruption or names the
resolved and remaining accepted findings plus a prerequisite count for a
completed blocked fix. In the latter case the supervisor presents those bounded
facts but does not execute raw prerequisite commands or widen permissions.
Send:

```json
{
  "schema": "banzai-agent-recovery/v1",
  "schemaVersion": 1,
  "attemptId": "implementation-1-abcd1234",
  "recoveryIdentity": "exact 64-character identity from current status",
  "unknownSideEffectsAccepted": true
}
```

Input is decoded completely before mutation. Invalid UTF-8/JSON, unknown or
missing properties, unsupported versions, blank text, stale run/request/round
identities, missing or duplicate decision IDs, unknown option IDs, oversized
documents, and wrong answer counts fail closed. A v1 answer cannot answer a
consultation. Request/answer whitespace, newlines, Unicode, quotes, backticks,
dollar syntax, and shell operators are preserved as data.
`WorkflowRunner` still owns one-active-run enforcement, state transitions,
decision persistence, resume, retry, recovery, and completion. Progress remains
on stderr; successful control output is one JSON document on stdout.

Existing approval, triage, resume, retry, cancel, human status, interactive,
and `status --json` commands retain their behavior. A supervisor refreshes
control status after those commands instead of parsing their human prose.

## Runner instruction delivery

The runner embeds six phase resources (`planning`, `implementation`, `review`,
`fix`, `feature`, `quick-fix`), nine shared guidance resources and their ordered
six-policy unions from the plugin. Standalone skills load the shared guidance
relatively. Selection remains prompt-only. Every fresh or resumed call, retry
and authorized recovery receives the complete applicable payload, exact bound
artifact roles and existing write capabilities. Review and selection have no
model artifact writes; the runner alone renders review artifacts. Existing
implementation/fix grants, report triggers, completion evidence and human gates
remain unchanged. Required bytes count against existing context budgets.

Structural plugin verification still requires all eleven skills and the two
hook events/script. Separately, preflight compares the applicable route union
and each call rechecks its actual phase against the supplied verified directory.
Matching raw identities are verified; a readable mismatch refuses the call with
`INSTRUCTION_RESOURCE_MISMATCH` before creating an attempt. Saved decisions,
checkpoints, prior failures and retry/recovery authority remain intact. Missing,
unreadable or unsafe resources are bounded failures; Codex, ambient mode and an
unresolved directory are unverifiable. Evidence limitations alone do not block,
and structural invalid-directory refusal takes precedence. These checks do not
prove full transitive plugin integrity, model compliance or resource immutability
during a running session.

The three remedies are to rebuild the orchestrator bundle from current source,
update the installed plugin to the matching release, or explicitly select
ambient mode (reported as unverifiable). Banzai performs none automatically.
After remediation, use the existing status-directed resume, retry or recovery
operation; do not resubmit a saved human decision.

Explicit `npm run build` refreshes committed `src/phase-resources.ts` and the
bundle/map. Typecheck, lint and tests never generate it. `build:check` compares
source/generated/bundle bytes without repair. Publication checks compare the
same candidate across actual indexed source/plugin archives, npm payload and
source map, rejecting staged/working instruction skew.

## Project Verification Readiness

For ready-to-adapt snippets and setup guidance, see
[Verification profile examples](verification-examples.md) and
[Your first Banzai task](getting-started.md).

`banzai doctor` inspects the current Git checkout and writes a deterministic
human report to stdout. `banzai doctor --json` writes the authoritative
`banzai-doctor/v3` object instead. It exits 0 exactly when no check failed and
exits 1 when the checkout is not ready. Warnings, including a live or stale
valid runner lock, remain visible without changing readiness.

Doctor checks Git, structural project guidance, the supported Node/platform and contract versions, config
presence and structure, the Claude invocation environment and its tool
permissions, detected project types, explicit profile coverage, substantive
commands, configured executable availability, the active-run pointer and
referenced state, and the runner lock. The report's fixed check
order, sorted project types, two-space JSON, and final newline are stable for
automation. Expected readiness findings stay in the selected stdout report;
unexpected CLI failures go to stderr.

Doctor v3 uses `schemaVersion: 3`. It retains `project.guidance` after
`repository.git` and inserts `claude.instructions` in category `config`, after
`claude.environment` and before `claude.permissions`. This checks the applicable
instruction and hook resource union for configured roles. A confirmed mismatch
is a failure; unverifiable or bounded-failure evidence is a warning. A mismatch
wins mixed evidence, then bounded failure, then unverifiable. Configuration and
structural-plugin failures remain independent. Historical v1/v2 reports retain
their identities; consumers must recognize v3. There is no legacy-output flag.
The check is offline, read-only and does not execute a vendor or repair files.

Doctor also emits an `authentication.models` advisory: it does not invoke a
vendor, so authentication readiness is not checked and executable availability
is not authentication proof. This warning leaves `ready` and exit semantics
unchanged. Startup and phase preflight remain authoritative.

Project detection is root-only and uses these markers:

| Project type | Root marker                                         |
| ------------ | --------------------------------------------------- |
| `node`       | `package.json`                                      |
| `php`        | `composer.json`                                     |
| `python`     | `pyproject.toml`, `setup.py`, or `requirements.txt` |
| `go`         | `go.mod`                                            |
| `rust`       | `Cargo.toml`                                        |
| `ruby`       | `Gemfile`                                           |
| `jvm`        | `pom.xml`, `build.gradle`, or `build.gradle.kts`    |
| `dotnet`     | any root `.sln`, `.csproj`, or `.fsproj` file       |
| `custom`     | no recognized marker                                |

The `custom` fallback requires confirmed absence of every recognized marker.
If marker metadata or root enumeration fails because of permissions or I/O,
`project.types` fails, the human projection reports project types as
unavailable, and dependent profile checks are skipped. Doctor never converts
unreadable evidence into a ready custom project.

Every detected type in a polyglot root needs at least one matching explicit
profile with a substantive command. A `repository` profile is reserved for
checkout-wide hygiene and cannot satisfy a detected project type. The exact
`git` command with `args: ["diff", "--check"]` never counts as substantive,
regardless of its name or profile. Doctor validates the declared coverage and
executable paths; it does not claim that a command is a good test and never
executes it.

A schema-version-2 verification section is an ordered profile list. Profiles
execute in list order and commands execute in their listed order. Each command
is always spawned directly from `command` plus `args`, without a shell:

```json
{
  "schemaVersion": 2,
  "verification": {
    "profiles": [
      {
        "id": "node",
        "projectType": "node",
        "commands": [
          {
            "name": "unit tests",
            "command": "npm",
            "args": ["test"],
            "timeoutMs": 600000
          }
        ]
      },
      {
        "id": "repository",
        "projectType": "repository",
        "commands": [
          {
            "name": "git diff check",
            "command": "git",
            "args": ["diff", "--check"],
            "timeoutMs": 120000
          }
        ]
      }
    ]
  }
}
```

For a root containing both `package.json` and `composer.json`, declare both
types explicitly; repository hygiene can remain a third profile:

```json
{
  "verification": {
    "profiles": [
      {
        "id": "node",
        "projectType": "node",
        "commands": [
          {
            "name": "node tests",
            "command": "npm",
            "args": ["test"],
            "timeoutMs": 600000
          }
        ]
      },
      {
        "id": "php",
        "projectType": "php",
        "commands": [
          {
            "name": "php tests",
            "command": "composer",
            "args": ["test"],
            "timeoutMs": 600000
          }
        ]
      }
    ]
  }
}
```

Existing schema-version-1 files remain runner-compatible and retain their flat
command order, but doctor reports their project coverage as legacy and not
ready. Migration is manual: change `schemaVersion` to 2 and wrap the former
flat `verification` array in `verification.profiles[0].commands`, adding a
unique kebab-case `id` and the correct `projectType`. Split commands into
multiple profiles when the checkout has multiple detected types; keep
repository-only hygiene in a `repository` profile. Neither config loading,
`banzai init` on an existing project, `banzai model`, nor doctor performs this
migration.

Model selection preserves this tracked representation byte-for-byte outside
the exact requested `model`, `executable`, and `effort` JSON value tokens,
including schema-version-1 formatting and unknown fields.

Doctor is offline and structurally read-only. It runs before vendor adapters or
`WorkflowRunner`, never authenticates, invokes a model, executes verification,
recovers or resumes a run, acquires or removes a lock, calls a network service,
or writes configuration, state, approval markers, source, or report files.
Normal `run`, `resume`, and `retry` behavior remains compatible in this
iteration; readiness is advisory outside the doctor's exit status.

## Context Accounting and Budgets

Every model attempt has an adjacent `banzai-context-attempt/v1` ledger. The
runner checkpoints the exact rendered prompt and vendor-specific output-schema
UTF-8 byte counts immediately before each adapter call, divided into closed
semantic categories. Referenced authority is recorded separately as artifact
class counts; vendor-reported tokens/cost/turns and session inventory have
independent per-metric availability. New reviews have only the primary
invocation; deterministic rendering adds none. Historical primary and repair
invocations remain separately readable and are counted once each.

The persisted privacy allow-list contains only identities already owned by the
run, closed enums, timestamps, counts, budget outcomes, and the existing
inventory digest. Prompt/request/artifact text and paths, source, transcripts,
reasoning, model/tool output, tool names and arguments, commands, environment,
credentials, and error prose are excluded. A present malformed or
content-bearing ledger fails closed as `INVALID_CONTEXT_EVIDENCE`; an older
attempt with no ledger is incomplete coverage.

Configuration defaults to observation with no universal numerical limit:

```json
{
  "context": {
    "mode": "observe",
    "limits": []
  }
}
```

Optional limits select a metric and may select `phase`, `role`, or both.
Phase-plus-role outranks either single selector, which outranks the default;
the smaller maximum wins a specificity tie. `observe` never changes execution.
In `enforce`, only exact pre-call `runner_payload_bytes` can stop an invocation,
before the adapter starts, as `CONTEXT_BUDGET_EXCEEDED`. Required context is
never truncated or summarized, and vendor-token, cost, turn, and inventory
crossings remain post-call advisory observations.

The offline read-only report uses the export cohort grammar:

```text
banzai eval context
banzai eval context --json --from 2026-08-01T00:00:00Z --to 2026-09-01T00:00:00Z
banzai eval context --run 20260801-example --run 20260815-other
```

Its independent identity is `banzai-context-report/v1`. Coverage is shown
before values; runner bytes, vendor tokens/cost/turns, and inventory are never
folded together. JSON is canonical and Markdown derives from the same object.
The command constructs neither adapters nor `WorkflowRunner` and creates no
config, lock, run, active pointer, or report file. See the
[context governance guide](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/context/README.md) for the full
privacy allow-list, config examples, and the required 15–30 completed-run
baseline before optimization or enforcement.

## Evaluation Export

`banzai eval export` reads all directories under `.banzai/runs/` in the current
checkout and writes a compact Markdown report to stdout. It needs neither
`.banzai/config.json` nor a TTY or active run. Use `--json` for the authoritative
versioned dataset:

```text
banzai eval export --json
banzai eval export --from 2026-07-01T00:00:00Z --to 2026-08-01T00:00:00Z
banzai eval export --run 20260701-example --run 20260715-other
```

The JSON identity is `banzai-evaluation-export/v1` with `schemaVersion: 1`.
Every field is present, arrays and enum breakdowns have stable ordering, JSON
uses two-space indentation and one trailing newline, and repeated exports over
unchanged evidence and arguments are byte-for-byte deterministic. Markdown is
rendered only from that completed object; it is not a second data contract.

`--from` includes a run created exactly at the RFC3339 boundary; `--to`
excludes one created exactly at its boundary. Both require `Z` or an explicit
offset. Repeatable `--run` selectors are deduplicated, path-safe local inputs
and are never reproduced in output. Date and run selectors use intersection
semantics. Missing selected runs and invalid, duplicate, missing, positional,
or unknown options fail before stdout is written.

The default cohort retains done, blocked, cancelled, active, legacy,
incomplete, and malformed runs. Unreadable creation time remains an unresolved
cohort member under date filters. One damaged record produces bounded issue
codes and partial coverage rather than failing every healthy run. Root
`.banzai/runs/` discovery errors remain fatal; state, attempt, review, and event
read errors inside one run degrade only that run. Numeric
metrics use `value` only for exact totals; otherwise `observedSubtotal`,
`observedCount`, `unknownCount`, `invalidCount`, and `availability` explain the
coverage. Zero therefore differs from unknown. Vendor-reported cost is never
invented. Human minutes and true false-positive rate are unavailable under the
current persistence contract, and rejected findings are named only as rejected
triage.

The export path uses direct Node read operations only. It never initializes or
normalizes state through `RunStore`, writes a report file, acquires a lock,
reconciles an attempt, resumes a workflow, runs verification, creates vendor
adapters, invokes a model, or performs a network call. Warnings are emitted to
stderr after the complete report, keeping JSON stdout clean.

Privacy is a fixed v1 allow-list. Exact run IDs, attempt IDs, feature slugs,
requests, repository/artifact/source/result/log paths, prompts, reasoning,
transcripts, raw or structured model prose, findings prose, commands and their
output, source contents, credentials, environment values, session IDs, human
identities, notes, and block/error text are excluded. Runs and attempts receive
deterministic export-local ordinal keys instead. Active attempt identity is used
only for an exact internal leaf join and is never exported. Exact persisted timestamps and
model IDs remain useful cohort variables and may still be linkable; the opaque
keys are minimization labels, not anonymized durable identities.

### Evaluation source precedence

The JSON contract assigns each metric to exactly one persisted evidence owner:

| Evidence owner                                      | Authoritative evaluation fields                                                                                                                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Raw `state.json`                                    | State/contract schema provenance, status, route, run timestamps, cumulative verification count, cumulative triage, and fix cycles.                                                                                                                                 |
| Unique supported `attempts/*.json` records          | Schema version 1 owns model-attempt count/outcome, phase duration, session and review mode, rotation evidence, normalized model profile, tokens, and reported cost. Missing schema is legacy-absent; unsupported or malformed schema contributes invalid coverage. |
| Retained `state.verification` entries               | Available command outcomes and derivable verification duration; the state counter represents cumulative command attempts.                                                                                                                                          |
| Review files proven applied by `state.latestReview` | Review verdicts and findings by severity. Files beyond the applied iteration are bounded incomplete evidence and contribute no yield.                                                                                                                              |
| Recognized `events.jsonl` event types               | Explicit attempt/start/review retries and bounded start/review failure categories.                                                                                                                                                                                 |

Overlapping state usage, session, review, and finding metrics are consistency
checks only. They create safe mismatch issues but are not summed with their
owning leaf evidence. Raw logs, command output, and source content are never
read.

## Evaluation KPIs

`banzai eval kpi` derives outcome KPIs from evaluation-export data under the
independent contract `banzai-evaluation-kpi/v1` (`schemaVersion: 1`). Without
`--input` it computes the export for the current checkout in memory under the
same cohort options, rules, and error codes as `eval export` — nothing new is
read from `.banzai/runs/` and no export file is written — and renders one
source labeled `current`:

```text
banzai eval kpi
banzai eval kpi --json --from 2026-07-01T00:00:00Z --to 2026-08-01T00:00:00Z
```

With repeatable `--input` it instead derives one source per previously
exported JSON file, labeled `<ordinal>: <basename>` in argument order, and
renders one comparison table per KPI whose columns are the sources. `--input`
cannot be combined with `--from`, `--to`, or `--run`, needs no Git checkout,
and reads only the named files:

```text
banzai eval kpi --input a.json --input b.json
```

Each input is validated before use: a file that is unreadable, not JSON, not
schema `banzai-evaluation-export/v1`, not `schemaVersion` 1, or structurally
missing the fields the derivation reads fails closed with the stable code
`INVALID_EVAL_INPUT`, names the file on stderr, and writes nothing to stdout.

The KPI set — completion rate, first-review pass rate and mean findings,
first-review acceptance rate, reviewer precision with separately reported
deferred triage, zero-accepted review rate, fix cycles per
completed run, attempt retry ratios by kind, and per-completed-run usage with
independent token and cost coverage — plus the fail-closed
planner/implementer/reviewer configuration-signature grouping is documented
with exact derivations in
[`documentation/evaluation/README.md`](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/evaluation/README.md).
Every KPI value carries its numerator, denominator, value (`null` on a zero
denominator), and exact-versus-incomplete run coverage; only exact-evidence
runs contribute. KPIs derive from per-run evidence only, never from export
`aggregates`, and identical inputs produce byte-identical Markdown and JSON.

## Interactive Mode

Run the short command from an initialized project:

```text
cd /path/to/project
banzai
```

With terminal input and output attached, the runner opens a minimal
state-driven interface. When no run exists, it collects the task request,
derives a deterministic kebab-case slug, and shows that slug before the start
confirmation. The planner then selects and displays `quick-fix`, `feature`, or
`strict` with its reason and phase responsibilities.

The request prompt enables terminal bracketed-paste mode. A multiline paste is
captured through its closing marker and rendered as
`[Pasted text #1 +N lines]`, so Markdown newlines do not submit the prompt.
Typed text and multiple pasted blocks retain their order, while Enter submits
the complete expanded request rather than placeholder text. Pasting the same
block again shows a terminal-safe preview without duplicating it; Backspace at
the placeholder boundary removes the complete block. The prompt disables
bracketed-paste mode on success, cancellation, and errors, while a recoverable
validation failure keeps the same prompt active. Single-line input and every
other interactive prompt retain their existing behavior.

The interface otherwise offers only actions valid for the current persisted
state:

- sequential decision cards for a material unresolved strict-planning choice;
- arrow-key ADR accept, reject, or rework;
- exact plan-bundle approval;
- accept, reject, or defer for every review finding;
- eligible retry, including explicit plan-task completion-evidence repair;
- resume, confirmed cancellation, or exit.

These are the workflow's five decision gates: conditional planning-only decision
consultation, ADR acceptance, plan approval, review triage, and escalation. The
interface is the only place they are answered, and no other phase boundary asks
for confirmation.

When a model requests a recognized human gate, the model process returns
control to the orchestrator but the interactive session does not exit. Banzai
immediately displays the exact current decision needed to continue.

For `decision_consultation`, the interface presents one to three cards in order:
`Decision`, `Why this matters`, `Repository evidence`, `Options`, and
`Recommendation` when present. The engineer may use the recommendation, choose
another listed option, provide an exact free preference, inspect details, or
pause without mutating the run. Answers are keyed to the current run, request,
round, and decision identities. They record provenance only and never accept an
ADR, approve a plan, authorize implementation, triage, recovery, release, or an
external side effect. Planning analyzes the answers again before it may produce
a dependent ADR or plan; those artifacts retain their separate later gates.

For an escalation raised during planning, implementation, or fixing, the
interface displays the model's questions and collects a non-empty answer for
each one. A lite route invalidates its workflow authorization and selects again
with the recorded answers. A strict route invalidates previous plan approval,
returns to planning, and requires approval of the revised artifact bundle
before code execution resumes.

The interface shows artifact paths, findings, blocked reasons, and retry
eligibility before asking for decisions. `Ctrl+C` while a prompt is open exits
the interface without changing the run. `banzai interactive` is an explicit
alias.

### macOS Dock Attention

After an automatic operation takes at least 30 seconds, Banzai requests one
Dock bounce when the result needs plan or ADR approval, human input (including
consultation), review triage, or action on a blocked run. This applies to
interactive mode and the human `run`, `resume`, `retry`, `recover`, `approve`,
and `triage` commands. Time spent reading or answering prompts does not count.
Opening an existing pending decision, revisiting menus, and completed or
cancelled runs do not trigger attention; each new automatic operation has its
own threshold.

- **Terminal.app:** select the active profile under **Settings → Profiles →
  Advanced → Bell**, then enable **Bounce the app icon when in the background**.
  Banzai sends BEL; the profile controls sound, badge, and whether bouncing
  continues until the application returns to the foreground. Disable
  **Audible bell** if you want a visual signal only.
- **iTerm2:** Banzai sends `OSC 1337;RequestAttention=once` to request a single
  bounce. The terminal handles attention without Banzai changing window focus.

Disable this feature for a command or shell session with
`BANZAI_ATTENTION=off`. It requires macOS and TTY stdin, stdout, and stderr.
Control commands, JSON output, CI, `TERM=dumb`, unsupported terminals, and
tmux/screen sessions stay quiet. Notification failures never change the run
result. The actual animation depends on the terminal and macOS settings.

Protocol references: [Apple Terminal profiles](https://support.apple.com/guide/terminal/change-profiles-advanced-settings-trmladvn/mac)
and [iTerm2 attention requests](https://iterm2.com/documentation-escape-codes.html).

## Review Artifact

Every successful review iteration publishes exactly one durable canonical
Markdown artifact:

```text
<bound reviewDirectory>/review-<iteration>.md
```

Private bindings use `.banzai/work/<work-id>/` as `reviewDirectory`. Legacy
bindings and runs without a binding retain `documentation/features/<slug>/`.

Each physical attempt owns
`.banzai/runs/<run-id>/attempts/<attempt-id>.review-candidate.md` and a private,
immutable `.review-snapshot.json` sidecar. Codex and Claude are read-only and
return `review-result/v2`; the runner owns rendering, validation and publication.
Claude exposes Read, Glob, Grep and Skill, with Write and other mutation tools
explicitly denied. Stale inherited review/workflow authorization is removed.

The reviewer acknowledges the exact approved artifact paths and snapshot digest
with scope acknowledgment version 1. Full reviews cover the complete approved
change surface; delta reviews require compatible full-review lineage and a new
explicit assertion for every approved artifact against the current changed
surface and accepted findings. Any required `not_reviewed` entry requires a
reason and `blocked`; it cannot pass. The assertion is not independent proof
that a file was read or substantively assessed. Layout and authority blockers
can produce a truthful blocked artifact with zero findings or coverage.

The self-contained `banzai-feature-review/v3` document for bound runs (v2 for historical snapshots) distinguishes required
scope from acknowledged coverage. Fenced JSON values retain every semantic
string, including multiline summary, evidence details, reproduction, fix
acceptance, reviewed finding IDs, `reviewNotes` and opaque deferred content.
Verification and completion are projected from the original snapshot; later
checks cannot enter an earlier review. Equal inputs produce equal bytes.

After retaining structured output and diagnostics, the runner validates scope,
renders the candidate, validates bytes and current authority/workspace, and
atomically publishes validated proof bytes. Failures retain attempt evidence
and leave earlier canonical reviews intact. No model call repairs formatting
or JSON/Markdown parity. Human triage still owns finding dispositions; only
accepted IDs authorize fixing.

Historical v1 records, Markdown prose, repair usage and terminal checkpoints
keep their original meanings and validation. They are never given synthetic
scope acknowledgment. New attempts enforce v2; absent/v1 reviewer session
identities rotate fresh/full with `output-contract-not-reusable`. Frozen
evaluation v1 treats that unsupported present rotation cause as invalid
evidence, leaving affected rotation statistics incomplete without changing its
enum or KPI semantics.

Recovery uses the original snapshot and matching immutable terminal proof. An
absent candidate can be rendered without a model call; conflicting or explicitly
failed evidence cannot be promoted. Interrupted publication/application reconciles
canonical JSON, event, counters and state once. Missing proof requires the
existing explicit retry flow. Standalone `$banzai:feature-review` remains usable
without the runner and writes its own next `review-N.md` in v1 format.

## Choosing Models

`banzai model` walks planning, implementation, and review, asking for a model and
then an effort level for each. The planning model also performs read-only
workflow selection:

```text
Planning: codex gpt-5.6-sol effort=xhigh
? Planning model
    Keep gpt-5.6-sol (effort=xhigh)
    Claude Opus 5 (claude-opus-5)      Complex agentic coding and long-horizon work.
    Claude Fable 5.1 (claude-fable-5-1)  Most capable model for demanding long-horizon agentic work.
    Claude Fable 5 (claude-fable-5)    Previous-generation Fable for demanding agentic work.
    Claude Sonnet 5 (claude-sonnet-5)  Near-Opus coding quality at lower cost and latency.
    Claude Opus 4.8 (claude-opus-4-8)  Previous-generation Opus for complex agentic work.
    Claude Sonnet 4.6 (claude-sonnet-4-6)  Previous-generation Sonnet balancing intelligence and speed.
    GPT-6-Astra (gpt-6-astra)          Most capable model for complex, demanding work.
  > GPT-5.6-Sol (gpt-5.6-sol)          Reliable agentic workhorse for everyday tasks.
    GPT-5.6-Terra (gpt-5.6-terra)      Balanced agentic coding model for everyday work.
    GPT-5.6-Luna (gpt-5.6-luna)        Fast and affordable agentic coding model.
    GPT-5.5 (gpt-5.5)                  Previous-generation frontier model for complex coding and research.
```

Every phase runs on either vendor, so each menu lists both Claude and GPT models.
GPT-6-Astra supports `low`, `medium`, `high`, `xhigh`, `max`, and `ultra` effort.
The adapter picks its argument shape from the configured executable: `codex exec`
with a schema file and a sandbox, or `claude -p` with an inline schema and a tool
allow-list. A phase that writes gets edit and shell tools or `workspace-write`;
review gets a read-only tool set or `--sandbox read-only`, whichever vendor runs
it. An executable belonging to neither vendor fails with `UNSUPPORTED_VENDOR`
before a process starts.

For implementation, the first choice recommends matching the effective planning
selection exactly, including executable, model, and effort. A planning change
made earlier in the same dialog is used immediately:

```text
Implementation: codex gpt-5.6-sol effort=xhigh
Planning selection: claude claude-fable-5-1 effort=max
? Implementation model
  > Match Planning: Claude Fable 5.1 (claude-fable-5-1), effort=max - recommended
```

An existing exact match is marked on **Keep** instead. Exact matching makes a
strict Planning -> Implementation builder session eligible for reuse when a
valid saved planning session exists; it does not guarantee a resume. Choosing a
different executable, model, or effort remains allowed, and the summary says
that implementation will start fresh from approved artifacts. Lite routes do
not inherit the planner session, and the reviewer remains independent.

The picker offers the current generation plus deliberate previous-generation
choices: Claude Fable 5, Claude Opus 4.8, Claude Sonnet 4.6, and GPT-5.5. Older
identifiers still load from a hand-edited config but are not presented as
choices.

The effort menu is filtered to the levels the chosen model accepts. For
implementation, the planning effort is recommended when the executable and
model match; otherwise the picker preselects the phase's current level when the
model supports it, or `xhigh`. Codex's `ultra` tier appears for GPT-5.6-Sol and
GPT-5.6-Terra, which support it, and not for GPT-5.6-Luna or any Claude model,
which do not. GPT-5.5 offers `low`, `medium`, `high`, and `xhigh`.

Nothing is written until the dialog shows a before-and-after summary and the
change is confirmed. Only `executable`, `model`, and `effort` are rewritten;
timeouts, verification commands, and unrecognized fields are left alone.

Mixing vendors is supported in any combination: GPT planning with a Claude
reviewer, Claude implementation with a GPT reviewer, or one vendor throughout.
Keeping the reviewer on a different vendor than the implementer is the point of
the loop. Compatible planning, implementation, and fixes share a builder
lineage; the primary reviewer starts fresh with no builder transcript. Routine
re-review may resume only that independent source-read-only reviewer.

`banzai init` runs the same dialog once the configuration exists, so a new project
picks its models immediately. When `init` creates the configuration, the preset
choice reads `Use default: <model> (effort=<level>)`, with matching default labels
and help text. Repeated `init` and `banzai model` use `Keep` for the saved settings,
including saved settings that still match the defaults.
Outside a terminal, `init` prints a pointer to
`banzai model` instead, and `banzai model` itself exits with `TTY_REQUIRED`.

`banzai model` refuses while a run is active, for the same reason the startup
currency check defers: phases read model settings fresh, so a mid-run change
would swap the model executing the rest of an approved plan.

The Claude entries come from the published Claude model catalog; the GPT entries
and their reasoning levels come from the Codex CLI's model metadata and official
model documentation. Both are source facts maintained in
[`src/models.ts`](../packages/orchestrator/src/models.ts) — see the note on catalog maintenance below.

## Model Configuration

Interactive startup names the Banzai release-train version and the checkout,
then prints one row per phase — vendor, model, effort, timeout — and checks
subscription authentication for every vendor the configuration actually uses:

```text
▄▟    banzai v1.19.1   spec-driven run orchestrator
  ▛▀  my-project · main · @ 90d9fb2 · 3 carried-in changes

    plan    codex  gpt-5.6-sol    xhigh · 30m  ✓
    impl    codex  gpt-5.6-sol    xhigh · 60m  ✓
    review  claude claude-opus-5  xhigh · 30m  ✓

No configured model needs a known update.
```

The check is driven by the `executable` each role configures, not by the role, so
Claude is checked whenever any of planning, implementation, or review runs it —
and each vendor is checked once even when several roles share it. Checks run
concurrently and add roughly a second to startup.

A ready launch spends no lines on authentication. An unavailable vendor marks
every phase row it blocks and is named once, with the reason and the phases it
would have run:

```text
    plan    codex  gpt-5.6-sol    xhigh · 30m  ✓
    impl    codex  gpt-5.6-sol    xhigh · 60m  ✓
    review  claude claude-opus-5  xhigh · 30m  ✗

│ claude (Review): Claude subscription authentication is unavailable. Run
│ `claude auth login`; API-key and third-party provider authentication are not
│ accepted.
│ Every phase re-checks this; resolve it before starting a run.
```

When Claude reports `loggedIn: false` and Banzai itself has inherited a Codex
sandbox, preflight classifies it as `CLAUDE_AUTH_UNAVAILABLE_IN_SANDBOX` and
interactive startup shows sandbox-specific guidance instead of asking for
another login. Authentication visibility is unproven: on macOS the sandbox can
hide a Claude Code entry in Keychain from every child process, but the result
does not prove an entry exists. An absolute executable path, shell wrapper, or
pseudo-terminal cannot repair access. Run `banzai` in a regular terminal to
check or restore login. For unattended execution, run `claude setup-token`
outside the sandbox and supply that subscription token through
`CLAUDE_CODE_OAUTH_TOKEN`; Banzai preserves this variable while still removing
API-key and third-party-provider overrides. Neither route lets Banzai escape a
parent network or filesystem sandbox.

Codex has a separate host-readiness requirement: its effective `CODEX_HOME`
must be writable so the CLI can maintain SQLite-backed runtime state, session
state, and its app-server client. Banzai checks directory write access without
creating a probe file and before spawning `codex --version`, `codex login
status`, or a model attempt. An enclosing Codex sandbox that makes the directory
read-only produces `CODEX_STATE_UNAVAILABLE_IN_SANDBOX`; another permissions
failure produces `CODEX_STATE_NOT_WRITABLE`. Neither is evidence of SQLite
corruption, lock contention, or lost authentication. Run the eligible Banzai
action from a regular terminal or, for agent supervision, grant normal host
approval for that action to execute outside the parent sandbox. Do not change
the model-facing `--sandbox` setting: it cannot widen the host permissions the
Banzai process inherited.

The report is informational — it does not stop the session, and every phase still
re-checks its own vendor and fails closed. Its purpose is to surface an expired
session at launch rather than after planning and implementation have already run.

It shares one limit with the phase checks, because it runs the same command:
`claude auth status` reports whether credentials are stored, not whether they can
still be refreshed. A session that is present but no longer refreshable reports
`ready` here and fails when a phase calls the model. There is no expiry field to
read, so detecting that would require a real model call at every launch.

It then checks each configured model against a catalog of known model
identifiers. When a newer or supported model replaces one, Banzai names the
replacement and offers to write it to `.banzai/config.json`:

```text
Newer models are available:
  Review: claude-opus-4-7 is superseded by claude-opus-5.
```

The dialog offers updating every reported model, choosing them one at a time, or
keeping the configuration. Nothing is written without an explicit confirmation.
The rewrite replaces only the `model` fields it was asked to change; executables,
efforts, timeouts, verification commands, and unrecognized fields are preserved
byte-for-byte, and a configuration the runner would refuse to load is never
written. The result is a tracked file — review and commit it.

Three cases produce no offer:

- an unrecognized model identifier, so a model newer than this catalog is never
  reported as stale;
- a supported previous-generation choice from `banzai model`;
- a Claude Code tier alias such as `opus` or `sonnet`, which already resolves to
  the current model of its tier;
- an active run. Banzai reports the models and the available updates, then defers
  the change until the run is done or cancelled, so a run's phases cannot switch
  models midway.

The catalog is a source fact maintained by hand and shipped with a release. The
runner authenticates through individual subscriptions and never calls a vendor
API, so currency is not discovered at run time. Codex identifiers are tracked
only as far as this repository can state them, which is why an unlisted Codex
model raises nothing. Update the catalog in
[`src/models.ts`](../packages/orchestrator/src/models.ts) when a model ships, is deprecated, or is
retired.

`banzai init` and non-interactive commands do not run this check.

Bare `banzai` in a non-TTY environment prints help instead of waiting for
input. Existing subcommands remain the authoritative non-interactive interface
for scripts, CI, direct recovery, and explicit slug overrides:

```text
banzai run --slug my-explicit-slug --request "Implement the task"
```

## Project guidance setup

Run `git init` before Banzai in a new directory. Interactive `banzai init` saves
configuration, offers model selection, then offers setup if root guidance is
incomplete. `banzai setup` requires existing valid configuration and a terminal;
it skips model selection. Bare/interactive entry offers setup before collecting
a new task when no unfinished run exists. Setup works on an unborn HEAD and
without application tooling; a new task still requires an initial commit.

The menu offers `Run project-manifest with Codex`, `Run project-manifest with
Claude Code`, `Show manual instructions`, and `Exit`. Planning's available
vendor is recommended; unavailable choices retain a disabled reason. Selecting
a client launches the explicit skill in a fresh foreground session with normal
permission prompts. It retains the client's own interactive model settings.
Exit the client to return to Banzai. The parent rereads files; exit 0 alone is
not readiness. Partial changes are preserved. Retry requires another explicit
selection; no task starts automatically. `Exit` returns 0 with an incomplete
notice, while SIGINT/SIGTERM return 130/143. Non-TTY init remains configuration
only; non-TTY setup returns `TTY_REQUIRED` and manual guidance.

Guidance labels are `Project guidance ready`, `Project setup required`,
`Project migration required`, and `Project guidance needs attention`. Readiness
requires ten populated manifest sections and the supported AGENTS/optional
CLAUDE layout. The complete raw line `<!-- banzai-scaffold: unfilled -->` before
the first heading marks an unfilled scaffold. Words such as `Open` and `None`
are allowed. This checks structure, not semantic accuracy or application tests.

Setup holds the ordinary runner lock without reclaiming existing ownership.
It refuses unfinished/corrupt run evidence; use status and finish or explicitly
cancel the run first. A new run checks full guidance before run/attempt or auth
work. Published runs recheck only instruction layout, including the Banzai
source exception. `PROJECT_SETUP_REQUIRED` preserves the last durable checkpoint,
decisions, triage and original failure evidence without a synthetic attempt,
event or usage. Manually repair/migrate instructions, inspect status and follow
the existing resume/retry/recovery route, or explicitly cancel before CLI setup.
Never repeat an already-saved decision. Approval and exact recovery identity
checks still apply after repair.

Setup discovers installed plugins through documented local client interfaces
or the existing validated Claude plugin-directory setting. It never installs
a plugin or assumes one beside the npm CLI. Codex discovery uses marketplace
list and explicitly filtered plugin-list calls; Claude uses installed plugin
list. Unsupported/unverifiable discovery leaves manual instructions. Selected
client auth uses the existing subscription preflight. Foreground arguments carry
no workflow grants, result schemas, resumed sessions or unattended permissions.
Banzai retains no child transcript; client-owned session storage remains normal.
Claude keeps strict MCP scoping and applicable project-settings/plugin scope;
Serena uses the existing whitelist. Actual client delivery is separately tracked
in the feature's [Private work history](historical-references.md).

## Spawned Claude Environment

Banzai scopes the environment of every `claude` process it spawns. Each one
loads only the whitelisted MCP servers (below), the Banzai plugin it ships
with, and your project's own `CLAUDE.md` shim to `AGENTS.md` — not your installed MCP servers,
plugins, skills, or slash commands. Those tool schemas sit at the head of the
cached prompt prefix and are resent on every API round-trip, so an unscoped
reviewer pays for them repeatedly even though it cannot call them; in one
measured project the turn-1 prefix fell from 42,201 to 19,799 tokens under
scoping.

Process instructions live in project `AGENTS.md`; policies stay in the installed
plugin and consuming skills read them explicitly. A legacy project stops before
affected work with **legacy Banzai layout: run `project-manifest` to migrate**.
Only an explicit `project-manifest` invocation proposes a migration diff for
approval. Cancellation, a new run, retry, recovery and answering a gate grant
no migration authority. The CLI refuses insufficient guidance before a new model attempt. If an
affected skill discovers a further policy or migration problem, writing phases
still use their existing escalation route and review uses its blocked-result route.
See [layout migration](https://github.com/Parabolic-Technologies/banzai/blob/main/plugins/banzai/skills/project-manifest/references/layout-migration.md).
Client versions, fixture tests and environment scoping do not prove effective
instruction delivery; automatic ingress, tool reads and application require
separate host evidence.

The optional `claudeEnvironment` section of `.banzai/config.json` controls
this:

```json
{
  "claudeEnvironment": {
    "mode": "scoped",
    "pluginDirectory": null
  }
}
```

- `mode: "scoped"` (the default, also used when the section is absent) isolates
  MCP unconditionally and scopes setting sources only when it can verify a
  Banzai plugin directory to re-supply. If it cannot, it keeps ambient setting
  sources rather than disabling Banzai skills and the enforcement hook, and says
  so in the run's progress output and events.
- `pluginDirectory` names an explicit plugin directory instead of the one
  shipped beside the orchestrator. The directory must identify the Banzai
  plugin and contain its required skills and enforcement hook; a configured
  directory that fails verification stops the run rather than degrading
  silently.
- `mode: "ambient"` restores the previous behaviour and lets spawned sessions
  discover your whole Claude Code installation.

`banzai doctor` reports this state as `claude.environment`: verified scoping
passes, explicit ambient mode and automatic MCP-only degradation warn, and an
invalid explicit plugin directory fails readiness. The check is filesystem-only
and does not invoke Claude.

### Claude Tool Permissions

Every Claude phase is spawned with `--permission-mode dontAsk`, which answers a
permission prompt with a denial instead of a human. Three surfaces can still
grant a call, and only three: the enforcement hook, which allows exactly the
approved bundle while a phase carries runner identity; an `--allowedTools`
entry, which a run spends on the Serena whitelist alone; and the permission
rules of the settings files the session loads.

Planning phases carry no runner identity — that is what stops a planner from
writing code — so the hook defers their documentation writes to the ordinary
permission flow, and under `dontAsk` that flow is the third surface or nothing.
A checkout that never granted `Write` therefore denies the description, plan,
and decision artifacts the phase exists to produce, after the model has already
been paid for. Shell commands are never hook-granted in any phase, so a Claude
planner or implementer runs only the commands a rule already names.

Startup preflight audits this before the first phase and ends the run with one
remediation when a `Write` grant is missing or refused. `banzai doctor` reports
the same audit as `claude.permissions`; both skip it when no configured role
depends on those rules — a Claude reviewer does not: it uses read-only tools
and returns structured findings. The runner renders and publishes the review
artifact; the reviewer receives neither write nor shell tools.

What the audit reads is exactly what the session will honor:

- the settings sources the resolved scope passes. Scoped mode loads `project`
  only, so grants belong in the tracked `.claude/settings.json`;
  `.claude/settings.local.json` is never loaded for a scoped run;
- administrator policy settings, which apply whatever `--setting-sources` names;
- Claude Code's workspace trust record. An untrusted checkout has its repository
  permission rules ignored with a warning rather than an error, so it looks
  exactly like a checkout whose rules were never written. Run `claude` once in
  the checkout and accept the trust prompt.

A minimal grant for a repository whose planner or implementer runs Claude:

```json
{
  "permissions": {
    "allow": ["Write", "Edit", "Bash(mkdir:*)", "Bash(git status:*)"]
  }
}
```

`Edit`, `Bash`, and path-scoped grants are reported as advisories rather than
blocks: the run continues, and the phase keeps only what the rules named.

### Serena MCP Whitelist

Scoped isolation exists to keep unusable tool schemas out of the cached prompt
prefix, not to deny the phases semantic tooling. Serena is the one MCP server
worth its schema budget here, so when it is genuinely available it is
re-admitted explicitly — through `--mcp-config` beside `--strict-mcp-config`
for Claude, and a `-c mcp_servers=...` override for Codex that replaces the
whole table, so no other user-scope server leaks into a run.

Availability is checked once per run and every gate that fails downgrades to
"no whitelist" with a reason, never a blocked run:

- the checkout is onboarded (`.serena/project.yml` exists);
- the vendor has serena registered — the project's `.mcp.json` or the
  user-scope `.claude.json` for Claude, `codex mcp get serena --json` for
  Codex, so each vendor runs its own registration verbatim;
- the registered command resolves on the sanitized PATH the child receives.

The result is reported once per run —
`MCP whitelist: serena -> claude, codex` or `MCP whitelist: none (…reasons)` —
and recorded as an `mcp_whitelist.resolved` event.

Phases reach Serena for navigation only — symbol lookup, references,
diagnostics, memories. Its editing tools are never granted, in any role:
Banzai's spec gate enforces the approved bundle by intercepting
`Edit`/`Write`/`apply_patch` and never sees an MCP call, so a phase editing
through `replace_symbol_body` would bypass that enforcement. Phases already
hold `Edit` and `Write`; what they lacked was navigation.

Shipping the schemas alone did not change behavior: real runs showed every
phase still navigating by `grep`/`sed` line windows while a connected Serena
went unused. When the phase vendor's whitelist entry resolved, the planning,
implementation, fix, and review prompts therefore append one guidance line
steering symbol lookup to Serena's read-only tools; runs without Serena keep
byte-identical prompts.

## Live Progress

Commands that advance a workflow report progress to stderr. By default each
action settles into one line carrying its duration, and a run of identical
consecutive actions is closed with its count:

```text
[banzai] Preparing run sc-12345-example-task in /path/to/project
[banzai] START Preflight - Node, contracts, executables, verification commands, and subscription authentication
[banzai] DONE Preflight (2.1s)
── Planning ──────────── codex · gpt-5.6-sol · xhigh · fresh · 30m cap ──
[banzai] · banzai:feature-description
[banzai] ·  0.3s command: git diff --stat
[banzai] ·  0.2s command: rg -n "resolveScope" src
[banzai]   ×4 total
[banzai] ✗  0.4s command: npm run lint --silent
[banzai] · tokens: 24.8K in (248 fresh · 99% cached) · 122 out
[banzai] DONE Planning (48s)
[banzai] Produced a description, 2 ADRs, a plan
```

The phase banner and colour appear only on a terminal; piped and redirected
output stays plain. On a terminal a live status line also reports the running
phase, its elapsed time, what is in flight, and how many actions have settled,
and is erased before every settled line and when the phase ends.

Three verbosity levels are available on any command that runs a phase:

| Level   | Flag        | Shows                                                       |
| ------- | ----------- | ----------------------------------------------------------- |
| quiet   | `--quiet`   | Phase boundaries, failures, and runner messages             |
| normal  | default     | Plus one settled line per finished action, and token usage  |
| verbose | `--verbose` | Every model action, started and finished, with no live line |

`BANZAI_PROGRESS=quiet\|normal\|verbose` sets the same levels; an explicit flag
wins over it, and an unrecognized value falls back to `normal` rather than
failing the run. `--metrics` additionally prints attempt, session, and review
counters, which are otherwise reserved for `banzai status --json`.

The runner reports preflight and repository checks, workflow selection,
planning when strict, implementation, each configured verification command,
review when strict, and accepted-finding fixes, and names what each phase
produced when it completes. Without a live line, a heartbeat is printed every 30
seconds naming the actions still running.
Codex `--json` and Claude `--output-format stream-json` events are normalized
into the same model, action, skill, and usage lines. The supplied phase responsibilities appear in each start line; observable
Claude `Skill` calls and supported Codex skill events are reported only when
they occur. Available inventories remain unchanged. Fewer Skill events prove
neither model compliance nor lower cost. Because
implementation, verification, and review advance without a gate, this progress
stream is how an approved run reports itself until the next decision.

Progress is deliberately separate from stdout, so `banzai status --json`
remains machine-readable. Progress exposes safe tool identity and file paths,
not raw prompts, reasoning, assistant prose, command arguments, search queries,
command output, or tool results. Redacted result and failure evidence continues
to be stored in the run directory.

`status` reports a `nextAction` plus separate retry and recovery eligibility.
Use `resume` for a paused phase or to reconcile a durable terminal checkpoint.
Use `retry` only
after resolving the external cause of a retryable startup check, review check,
or failed selection/planning/review attempt.

## Failure Recovery

If initial preflight or the repository check fails, the confirmed request
is preserved as a blocked run. Resolve the reported prerequisite and choose
`Retry start checks` in interactive mode, or run:

```text
banzai retry
```

The retry reruns preflight and the repository check, refreshes the base commit,
and begins workflow selection under the same run ID. It does not ask for the
request again.

For a failed selection, planning, or review process:

```text
banzai status
# Resolve the reported authentication, CLI, MCP, or provider problem.
banzai retry
```

Retry reruns preflight, preserves the failed attempt, and creates a distinct
attempt. Selection and source-read-only review are also retryable after
interruption. A review retry reuses the latest unfinished iteration and
canonical `review-<iteration>.md` identity instead of skipping an artifact
number, but allocates a new candidate path. Adapter success followed by review
validation failure retains the structured result, redacted stdout/stderr,
candidate bytes and digest, exact validation error, and typed failure code in
the failed attempt. These remain diagnostic rather than canonical. Non-zero
vendor exits likewise retain redacted stdout and stderr under the run's
`attempts/` directory, while the state and event log contain only a concise
error.

Planning retries preserve the vendor session ID as soon as Codex announces its
thread or Claude sends its initialization event. After a supported capacity,
timeout, transport, result-format, or plan-validation failure, the new attempt
resumes that session only when the planner settings, planning instructions,
tool scope, and stopped workspace still match. Its prompt names the failure and
existing planning artifacts and asks it to finish the remaining work. Missing
or legacy context, changed inputs, and unclassified or integrity failures use a
fresh session with an artifact-first continuation prompt. The failed attempt
stays intact; the new attempt records `planningContext.retryOf` and its actual
fresh/resumed mode. No private vendor transcript is imported or treated as
completion evidence. Interrupted planning without a proven terminal result
retains its existing non-retryable policy.

The interactive action is `Continue the failed planning attempt`. A valid saved
planning terminal checkpoint is reconciled without another model call, with
the ordinary plan validation and human approval gate. A rejected plan artifact
requires repair; conflicting terminal or session evidence cannot promote an
earlier checkpoint. If checkpoint validation rejects an otherwise retryable
failed planner, an explicit retry creates a fresh session and includes the
rejection diagnostic. Consumption is accounted once across failure and terminal
reconciliation.

Codex progress JSON is provisional: the final agent message confirmed by
`turn.completed` owns the terminal checkpoint, and the post-close result file
must agree. Subsequent tool work invalidates a provisional message; duplicate
terminal events, work after an explicit final message, and conflicting final
results remain errors. Observer failures, timeouts, and post-close decoding
failures retain captured redacted output and any vendor-reported usage.

If review checks fail before Claude starts, no model attempt exists yet. After
fixing Claude authentication or another reported prerequisite, interactive mode
offers `Retry review checks`; the scriptable equivalent is `banzai retry`.
The runner then rechecks the base commit, approved artifact digest, Claude
authentication, and workspace snapshot before invoking Claude.

Retry never bypasses approval integrity. `banzai approve plan` stores the
exact bytes of every approved artifact beside the run evidence
(`.banzai/runs/<run-id>/approval/`), because the bundle paths are typically
uncommitted and would otherwise leave no recoverable approved form. If an
approved description, plan, or ADR later changes — an editor, a formatter, or
a parallel agent session touching the checkout — the next phase's checks block
the run, and `banzai restore` (or the interactive
`Restore the approved planning artifacts` action) rewrites the approved paths
with the snapshot bytes after verifying them against the recorded approval
digest; `banzai retry` then re-enters the blocked phase, since
implementation-checks and fix-checks failures are retryable exactly like
review checks. Runs recorded before snapshots exist report that restoration
must be manual. Alternatively cancel the run and start a new one so the
revised bundle can receive explicit approval. Orchestrated
implementation and fix prompts keep approved planning artifacts immutable and
record progress in reports instead of plan checkboxes. New strict
implementation results carry a versioned canonical task-completion ledger in
approved `TNNN` order. The **Plan Task Completion** report table and persisted
summary are deterministic projections validated against approval, repository
scope, required reports, and each other. Inside the table's Evidence and Gap
JSON cells the canonical grammar HTML-escapes `&`, `|`, `<`, and `>`
(`&amp;`, `&#124;`, `&lt;`, `&gt;`) and emits raw JSON rather than Markdown code
spans. As a narrow compatibility rule for model-authored reports, the decoder
accepts exactly one complete outer backtick pair around a whole Evidence or Gap
JSON cell before the normal shape and exact-parity checks; partial and repeated
wrappers remain invalid. It additionally recovers a row whose JSON cells
contain a raw unescaped `|` when exactly one rejoin boundary decodes both cells
to their required shapes, and otherwise fails closed with the offending task
named in the diagnostic. Implementation and fix-refresh prompts and skills show
the canonical raw-JSON row and prohibit authoring code-spanned cells. Persisted
state separately owns lifecycle and `nextAction`; legacy runs without the
ledger retain that lifecycle but report completion as legacy/unknown rather
than fabricated `N/N`.
Evidence paths must name files created or modified relative to the run baseline,
or the exact required implementation/test reports. A carried-in unchanged source
or test file is not direct completion evidence even when the task confirms it
read-only; that confirmation belongs in a required report, and the ledger cites
the report. Evidence-repair prompts include the persisted violation and exact
task ID so the replacement does not preserve a known-invalid row.

Implementation, fix, and interrupted planning attempts may have partial
repository side effects, so they cannot normally be retried. An implementation
result rejected with `PLAN_TASK_COMPLETION_INVALID` is the narrow exception,
whether ledger validation rejected a decoded result or the result failed
decoding on a completion field — for example a gap detail over the 500
character single-line bound: the runner classified both as completion-evidence
failures when it wrote the invalid checkpoint, retains what decoded, and may
request one replacement result without duplicating the attempt or task ledger.
The repair prompt carries the rejected attempt's persisted diagnostic so the
replacement names the exact offending field, and the writing prompts state the
ledger field bounds (500-character single-line strings, at most 16 evidence
entries) so first-pass records are composed to fit. Strict implementation and
fix prompts also carry the run's recorded human decisions, with the rule that a
recorded answer is authoritative and a question it covers is never re-raised as
a new escalation — so a decision made at any earlier gate stays visible to
every later writing phase instead of being re-asked.

After a fix changes tests, verification commands, or their expected or observed
results, the fix prompt and shipped `quick-fix` skill require a complete sweep
of test-count and command-result claims in the current `test-report.md`,
`implementation-report.md`, and the fix change report. Each current claim must
come from a command actually run in that fix; older evidence must be scoped
explicitly as `historical/pre-fix`. In orchestrated mode, runner-owned final
verification is recorded only as `pending at fix handoff`, with durable runner
evidence owning the eventual result, rather than predicted from an earlier
total. All three artifacts must remain mutually consistent.

Per ADR 0025, an accepted-finding fix whose changes made the recorded
completion evidence stale may return a complete refreshed `taskCompletion`
ledger with a regenerated report projection, validated by the identical
fail-closed pipeline; the checkpoint then records the fix attempt as the
canonical source (`sourceAttemptKind: "fix"`, absent means implementation) and
the runner emits `plan_task_completion.refreshed`. Statuses cannot regress
through a refresh — a completed fix outcome still requires every task
completed, and a genuine downgrade still escalates. A rejected refresh fails
the fix attempt with the invalid checkpoint and offers the same
`Repair plan-task completion evidence` retry, which reruns the fix with the
persisted diagnostic and unchanged triage scope.

The canonical Implementation Tasks heading grammar
(`- [ ] **TNNN - Title**`, one line, ending at the closing `**`, unchecked
even in a revised plan) is validated twice before it can bind anything: a plan
result with a malformed heading fails its attempt before the approval gate is
raised, and `approvePlan` re-checks the exact bytes it is about to bind so an
on-disk edit after the gate cannot smuggle one in. If a run nonetheless holds
an invalid completion checkpoint whose violation lives in the plan bundle
(`approved_plan_invalid`, `approval_invalid`), retry does not loop the
evidence repair — the interactive action reads
`Rerun planning to correct the approved plan`, the recorded approval is
voided, the stale checkpoint is cleared, and planning reruns toward a fresh
plan-approval gate. Interactive mode labels that action
`Repair plan-task completion evidence`, distinct from a source-read-only
retry. If the rejected result also has a terminal checkpoint, the repair action
takes precedence over reconciliation: `resume` leaves the run unchanged rather
than replaying the already-rejected evidence. The same repair applies when the
pre-verification revalidation after a completed fix rejects the evidence — for
example when the fix edited the frozen Plan Task Completion projection — even
though no attempt failed: the retry starts a fresh completion-repair
implementation attempt from the invalid checkpoint. That repair restores the
projection when the ledger records are correct; when the divergence reflects an
accepted review finding that a record was overstated, it returns the corrected
ledger and matching projection with `gate=escalation` instead of restoring the
false claim. Fix prompts state the projection is frozen: a fix never edits that
section, and an accepted finding it cannot truthfully resolve escalates rather
than rewriting completion evidence. Interrupted selection and review
are explicitly retryable because their model phases cannot change production
source; review retains only its bounded attempt-owned candidate evidence.
When a supported vendor emits a valid terminal success, Banzai atomically
persists an attempt-owned checkpoint before waiting for process closure. If the
parent is then interrupted, status reports `resume`; reconciliation validates
the same attempt, base commit, approval/workflow, scope, model/session context,
and structured result before applying it exactly once. Raw result files,
terminal prose, and successful tests are not terminal checkpoints.

A mutable implementation or fix with no checkpoint remains ineligible for
ordinary retry when it was interrupted or failed after the model started with a
typed `capacity`, `timeout`, or `transport` cause and no terminal result. If the
process is dead and every current base, approval/workflow, scope, model
configuration, attempt, and workspace check is valid, status instead offers
`banzai recover` with bounded change counts, an exact identity, and a warning
that repository or external effects may be partial or duplicated. Process-start
and unclassified failures remain fail-closed. Interactive recovery has a
negative-default confirmation. Non-TTY callers use the closed
`banzai-agent-recovery/v1` document. Recovery preserves the old attempt as
`interrupted`, creates one new linked physical attempt, and routes the fresh
result through normal completion, verification, independent review, and triage
gates. It never infers completion from existing source or reports.

A completed strict fix result is separately eligible only when it is the unique
current canonical source, has `outcome: blocked`, proves a non-empty proper
subset of accepted findings resolved, and records at least one question or
requested verification prerequisite. The run has no active attempt or live
process, current review and triage agree, and no recovery descendant exists.
Status keeps retry unavailable and presents the resolved IDs, remaining IDs,
and prerequisite actions with a negative-default confirmation. After the
operator addresses them, the same closed recovery document authorizes one
linked fix attempt containing only the remaining accepted findings. The source
record remains completed and byte-stable; a new descendant cannot seed another
prerequisite recovery chain.

The source result, exact checkout, approval, configuration, and remaining scope
are rebound before and after implementer preflight. Drift invalidates the
authorization before a model call. Banzai never executes the recorded
prerequisites, adds a broad Bash allowance, loads local Claude settings, or
weakens project-scoped `dontAsk`; those are operator-owned actions outside the
recovery mutation.

If the workspace changes after authorization, recovery fails before another
model call and requires a new inspection and decision. Other interrupted or
non-recoverable blocked states fail closed. Inspect the checkout and logs, then
run `banzai cancel` when appropriate. Do not edit or delete `.banzai` state to
recover.

## Local State

`.banzai/runs/<run-id>/state.json` is atomically replaced. `events.jsonl` is an
append-only summary without full transcripts. New runs create
`verification-attempts/ledger.json` plus one atomic sequence-ordered leaf per
physical verification attempt; `state.verification` remains the latest
operational round. Attempts, structured results, attempt-owned review
candidates, redacted CLI output, verification evidence, and review results
remain local under the ignored run directory. Evaluation counts supported
failed attempt records but does not treat candidate Markdown, raw result files,
terminal checkpoints, recovery authorizations, or failed structured results as
review verdicts or completion evidence.
New model attempts use schema version 2 so an interrupted source and its linked
recovery attempt remain distinct. New run state uses schema version 4 to add an
immutable artifact binding. It retains v3's tagged pending consultation, exact
keyed decision history and additive `source_preserved` stage; legacy state v1–v3
remains readable under its original storage semantics, without fabricated
consultation or binding evidence. The `source_preserved` stage keeps a completed
blocked source immutable while one linked attempt is prepared. Checkpoints and recovery
authorizations are immutable atomic mode-`0600` evidence; users and supervisors
must never edit them manually.

The model hand-off uses phase-result v3. It adds the planning-only
`decision_consultation` gate and required nullable `decisionConsultation`
payload; phase-result v1 and v2 remain read-only legacy inputs and cannot be
returned by a new attempt. Evaluation export and KPI stay on their independent
privacy-minimized v1 contracts. Consultation events retain only card counts,
answer-mode counts, timing, and completion state, never request/card/option IDs,
questions, recommendations, answers, evidence detail, decision-maker labels,
or raw paths.
Evaluation never exports commands, candidate/error metadata, log references/
digests, raw output, or credential material from the ledger.

State binds resumable sessions to role, executable, model, and effort. Status,
events, attempts, and metrics distinguish fresh/resumed sessions and full/delta
reviews, including rotation reasons, without persisting prompts or transcripts.
The reviewer rotates fresh when its binding or approved bundle changes, a
review fails, is interrupted, or blocks, a blocker/security finding is
accepted, or two delta reviews complete. Every resume reapplies the current
Codex sandbox or Claude tool restrictions.

One refinement to "a review fails": retries preserve the same reviewer session
and delta context when the failure is structurally classified as capacity,
timeout, process-start, or transport. Unclassified failures, invalid contracts
or artifacts, workspace or approval drift, and other integrity-sensitive
conditions rotate to a fresh full review, as does a changed invocation scope or
reported tool inventory (`session-inventory-changed`).

Failed model attempts retain their redacted stdout/stderr and any structured
usage already spent. That usage counts toward run totals, but the attempt is
excluded from completed-attempt, verdict, review, and finding metrics. Runs
persisted before failed-turn capture did not record every failed turn, so
historical and new-run totals are comparable only with their evidence coverage
in mind. New reviews make no formatting-only model calls. Deterministic
rendering, validation or publication failure is explicit and retains available
result, candidate, diagnostics, immutable terminal proof and usage. Historical
formatting-repair records and combined usage remain readable without being
replayed or double-counted.

Schema-version-1 run state remains readable. Its unbound string session IDs are
not reused; Banzai preserves artifacts and human decisions, normalizes the state
to version 2 on the next write, and safely starts the next eligible model phase
fresh.

If a completed model attempt was persisted before its state transition, then
`resume` reconciles it without repeating the model phase. An interrupted attempt
is never silently retried; eligible interrupted selection and review attempts
require an explicit `banzai retry`.

Selection exports only `BANZAI_RUN_ID`, which denies writes. Strict code phases
add `BANZAI_APPROVAL_DIGEST`; lite code adds `BANZAI_WORKFLOW_DIGEST`. Review
supplies run and approval identity for reads while removing inherited
`BANZAI_REVIEW_ARTIFACT` and `BANZAI_WORKFLOW_DIGEST`. The hook denies every
mutation while reviewing or while a review attempt is active, before workflow
write grants. Standalone session behavior remains separate when runner variables
are absent.

## Artifact storage commands

`banzai artifacts` and the plugin-only helper share the [artifact storage](artifact-storage.md) request/result contract. [Offline archive operations](artifact-archive.md) preserve original evidence. The [publication boundary](publication-boundary.md) governs indexed and distribution bytes.

## Proportionate verification and focused closure

Projects can explicitly opt into config 3 as described in
[verification examples](verification-examples.md#explicit-equivalent-evidence-config-3).
Only new enabled runs use state 5, binding v2 and verification ledger 2; existing
runs retain their versions. Decisions and applicability records are separate from
v1 physical leaves. The runner decides under work ownership after approval and
completion checks, and revalidates source, authority and origins before review,
pass application, zero-accepted triage and lite completion. Failures and interrupted
attempts retain existing explicit retry/recovery boundaries.

Review snapshot v3 and runner-rendered `banzai-feature-review/v4` freeze current
executed/reused/pending evidence and direct physical origins. Historical formats
keep their decoders/rendering. Review-result v2 and task-completion v1 remain
unchanged. Offline archive v1 retains the binding, decisions, applicability,
physical origins and logs through required dependency closure. A restored copy
retains historical proof; it does not gain same-repository reuse authority.

For an accepted-finding closure, keep unaffected report text and add one bounded
record: accepted ID, changed scope, decision, executed/reused/historical/pending
references and limitations. Inspect current claims for contradictions and correct
only affected claims. A consistency sweep does not execute commands. Resolution
review receives the accepted IDs, delta, current authority and evidence, preserving
independent review and human triage. Runner instruction and policy bodies remain
complete on every model call.
