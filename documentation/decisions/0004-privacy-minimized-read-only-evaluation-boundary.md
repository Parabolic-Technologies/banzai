# ADR 0004: Privacy-Minimized Read-Only Evaluation Boundary

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-02
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-02

## Related Artifacts

- Feature description:
  `documentation/features/evidence-driven-evaluation-export/description.md`
- Feature plan:
  `documentation/development-plans/evidence-driven-evaluation-export/plan.md`
- Manifest: sections 3, 5-6, and 9-10 of `PROJECT_MANIFEST.md`
- Related ADRs:
  - ADR-0001 keeps workflow selection structured and read-only; no conflict.
  - ADR-0002 requires evaluation observability without prompts or transcripts
    and keeps reviewer/builder boundaries intact; this ADR narrows what may be
    projected from that persisted evidence.

## Context and Decision Drivers

Persisted Banzai runs are local and ignored, but they contain identifying and
sensitive material: the original request, a slug embedded in the run-directory
name, repository and artifact paths, human decision records, session IDs,
structured model prose, finding evidence, command definitions, and retained
redacted output. Redaction reduces secret exposure in stored output but does not
make that output suitable for an evaluation export.

The dataset still needs enough dimensions to compare workflow routes, model
profiles, session reuse, review policy, usage, quality yield, and fix cycles.
Exact run IDs are not needed for those comparisons, and hashing them is weak
minimization because current run IDs contain timestamps and feature slugs.

The command must also be stronger than operational status reads: it may inspect
incomplete state, but must never acquire a runner lock, normalize state through a
write, recover an attempt, update an active pointer, invoke authentication,
spawn a model or verification process, or create the missing runs directory.

Decision question: What is the default disclosure and execution boundary for a
useful local evaluation export?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- least disclosure from a store containing user, repository, and model data;
- useful per-run linkage inside one export without exposing slug-bearing IDs;
- deterministic output with no secret key or state mutation;
- offline and strictly read-only behavior, including error paths;
- no weakening of authorization, isolation, human gates, or fail-closed rules;
- no new dependency, telemetry service, opt-out burden, or external write.

## Options Considered

### Option 1: Fixed allow-list with export-local opaque ordinals

Export only enumerated scalar metrics, closed enums, source schema identities,
normalized model/vendor profile, timestamps needed for cohort selection, and
structured completeness. Assign deterministic ordinal keys from the complete
sorted candidate set. Provide no flag that widens disclosure in v1.

Benefits:

- sensitive fields are excluded structurally instead of relying on redaction;
- opaque keys support joins within one document without reproducing the run ID;
- no salt, mapping file, configuration, or mutation is required;
- the same allow-list governs JSON, Markdown, and stderr diagnostics;
- tests can inject forbidden canaries and assert they never leave the boundary.

Costs and risks:

- ordinals are not durable identities if old run directories are removed,
  renamed, or inserted;
- exact timestamps and model IDs remain potentially linkable evaluation
  dimensions;
- a maintainer cannot map an opaque key back from the report alone without
  rerunning locally against the same candidate set;
- adding a useful field requires explicit privacy review.

### Option 2: Export exact local run and attempt IDs

Retain directory names and attempt IDs for straightforward traceability.

Benefits:

- direct mapping to persisted files;
- identifiers remain stable across filtered exports.

Costs and rejection reason:

- current run IDs include feature slugs and timestamps;
- identifiers can disclose request context and enable cross-report linkage;
- traceability does not require exact IDs when the command is local. Rejected
  because it violates the safe default requested for identifying data.

### Option 3: Hash exact identifiers

Emit a deterministic SHA-256-derived run and attempt key.

Benefits:

- stable across filters and candidate-set changes;
- compact local joins are easy.

Costs and rejection reason:

- an unsalted hash remains linkable across exports;
- slug-bearing, time-structured run IDs can be guessed and verified;
- a private salt would require configuration, environment handling, or a new
  persisted secret, which conflicts with deterministic read-only defaults.
  Rejected because hashing would imply stronger protection than it provides.

### Option 4: Add `--include-identifiers` or `--include-details`

Use the minimal default but let callers opt into exact IDs, paths, commands, or
prose.

Benefits:

- maximizes local debugging and traceability;
- users explicitly choose the disclosure.

Costs and rejection reason:

- creates a second high-risk contract that needs redaction and combinations of
  sensitive fields;
- exported files can outlive the local context in which consent was given;
- it is unnecessary for the first cohort dataset. Rejected for v1; a later
  feature requires a separate privacy decision.

## Decision

Adopt Option 1.

Implement a fixed allow-list. The export may contain only:

- the evaluation contract identity and normalized cohort arguments;
- export-local run and attempt keys;
- upstream schema and contract version values;
- closed workflow route, run status, attempt kind/status, session mode, review
  mode, rotation reason, finding severity, triage disposition, failure category,
  completeness, and availability enums;
- creation/update and attempt/verification timestamps where the contract needs
  date selection, ordering, or persisted duration evidence;
- booleans, ordinals, counts, milliseconds, token counts, exit codes, signal
  presence, and vendor-reported USD cost;
- normalized vendor (`codex`, `claude`, or `unknown`), persisted model ID, and
  effort as necessary evaluation variables;
- stable bounded issue codes and field/source locations defined by the
  evaluation contract.

Model IDs and exact persisted timestamps are deliberate privacy trade-offs:
they are necessary for model-profile and date cohort analysis, but can make a
small local cohort linkable to other knowledge. Document that limitation in the
CLI docs and Markdown data-quality/privacy note. Never export the configured
executable string; derive only the closed vendor value when safe, otherwise use
`unknown`.

Assign `run-000001`, `run-000002`, and so on from the lexically sorted complete
candidate run-directory set before filters. Assign `attempt-001`,
`attempt-002`, and so on within a run using the contract ordering. These keys
are deterministic minimization labels, not anonymized identities and not stable
when pre-existing candidate directories are inserted, removed, or renamed.

Never export or echo:

- exact run-directory or attempt IDs, request text, feature slug, repository
  root, base commit, workspace digest, workflow-selection reason, escalation
  text, artifact/source/result/log paths, or source content;
- prompts, reasoning, transcripts, raw stdout/stderr, raw model/assistant
  output, structured summary prose, finding summaries/evidence/reproduction/fix
  text, or deferred-coverage prose;
- command name, executable, arguments, command output, environment key/value,
  credential, session ID, PID, lock token, or active-run pointer;
- approver/decision-maker identity, question/answer, note, block reason, error
  message, triage note, or other free-form human text.

Do not treat retained redaction as permission to export a field. Use projection
from parsed allow-listed values; never serialize a source object and delete
known forbidden keys afterwards.

Limit diagnostics to stable error/issue codes, opaque keys, bounded source
types, numeric counts, and fixed remediation text. Do not copy parser messages,
JSON fragments, filenames, run IDs, or raw persisted content to stdout or
stderr. JSON carries structured safe issues; stderr gives a fixed summary that
partial evidence exists.

Implement export through direct read operations over `.banzai/runs/`. It must
not call `RunStore.initialize`, `createRun`, `writeState`, `appendEvent`,
`writeRunAttempt`, `writeText`, `acquireLock`, workflow status/recovery, config
initialization, adapters, authentication, or a process runner. Absence of the
runs directory is an empty input, not a reason to create it. Repository-root
discovery may use the existing read-only Git discovery, but export performs no
Git mutation and no vendor, model, verification, telemetry, upload, or network
call.

Do not add a v1 disclosure-widening option. Explicit `--run` values may be used
as local input selectors but are never reproduced in output or diagnostics.

## Consequences

Positive:

- raw persisted data stays behind a narrow structural boundary;
- JSON, Markdown, and stderr share the same privacy policy;
- a report remains useful for route/model/session/quality cohort analysis;
- the command cannot contend with or advance an active workflow;
- no key store, salt, telemetry endpoint, or dependency is introduced.

Negative:

- opaque keys do not provide direct standalone file traceability;
- exact model IDs and timestamps retain some linkability;
- deterministic ordinals can shift after candidate-set surgery;
- future useful dimensions need deliberate allow-list and contract review;
- fixed diagnostics provide less local debugging detail than raw parser errors.

Risks and required follow-ups:

- accidental whole-object serialization: use typed constructors and privacy
  canary tests for every forbidden source category;
- stderr leak on parse failure: translate exceptions to fixed codes before
  rendering;
- read-side mutation through reused workflow helpers: use a dedicated reader
  and snapshot the runs tree before/after CLI tests;
- apparent anonymity: state explicitly that opaque keys minimize exposure but
  do not anonymize timing/model data;
- future identifier demand: require a new explicit privacy decision rather than
  silently widening v1.

## Compliance and Confirmation

Implementation and independent review must confirm:

1. request, slug, run ID, repository, artifact, source, result, and log canaries
   do not appear in JSON, Markdown, or stderr;
2. prompt, reasoning, transcript, raw model output, command, environment,
   credential, review prose, human identity, answer, note, and session canaries
   do not appear in either format or diagnostics;
3. only normalized vendor, model ID, effort, timing, enum, numeric, coverage,
   and bounded issue fields cross the allow-list;
4. run and attempt labels use deterministic ordinals and never hashes or exact
   persisted identifiers;
5. explicit `--run` input is not echoed on success or failure;
6. a missing runs directory remains absent after export;
7. byte snapshots of `.banzai/runs/` are unchanged after empty, complete,
   partial, malformed, filtered, and invalid invocations;
8. no lock, active-run pointer, config, state, event, attempt, report, or
   temporary file is created or changed;
9. no adapter, authentication, vendor/model CLI, verification command, network,
   upload, or external write is invoked;
10. current authorization, reviewer isolation, human gates, retry, and
    fail-closed tests remain unchanged and passing;
11. no disclosure-widening flag, dependency, plugin bump, or model/default
    change is introduced.

## Lifecycle Links

- Supersedes: None
- Superseded by: None
