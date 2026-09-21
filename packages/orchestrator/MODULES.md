# Orchestrator module reference

Detailed per-module behavior of `packages/orchestrator/src/` and
`packages/orchestrator/scripts/`. `PROJECT_MANIFEST.md` section 5 carries the
one-bullet-per-module summary and links here; read only the entries for the
modules a change touches. Source, tests (`test/<module>.test.ts`), and the
bound work artifacts (or historical `documentation/features/` reports) remain the evidence; this file
is a navigational reference and is updated with the module it describes.

## Source modules (`src/`)

- `artifact-storage.ts` — typed facade for canonical plugin ESM storage/adoption
  and archive operations. No runner configuration or CLI installation is needed
  by the standalone helper. Claims exclude overlapping standalone/runner phase
  writers for one work; explicit legacy registration preserves original roles. Workflow grants remain
  runner-owned. New state v8 holds private binding v2 bytes and SHA-256; workspace v2
  hashes the selected ignored work. Historical states/digests retain old meaning.

- `cancellation.ts` — closed observation v1 reasons, response/provenance table,
  pre-transition context and reconciliation; separate report v1 types (ADR-0035).
- `cancellation-evidence.ts` — bounded read-only state/event/attempt ingress,
  safe local paths, fingerprints and exact context references after stopping.
- `cancellation-cli.ts` — exact cancel flags, optional capability v1 declaration,
  fixed operation messages and report command adapter.
- `cancellation-report.ts` — direct read-only cohort collection, cutoff-aware
  resource subtotals, explicit missing/invalid coverage and report-local keys.
  It never constructs a runner, normalizes state through the operational store,
  repairs evidence, infers motivation or joins tasks by name/time.
- `cancellation-report-render.ts` — deterministic JSON and Markdown projections
  of one independently versioned report document, without evidence reads.
- `human-time.ts` — closed private timing codec, episode identities, replacement
  estimates and pure run-summary arithmetic (ADR-0034). Gate response elapsed
  never becomes active effort or a task total.
- `human-time-store.ts` — bounded canonical state/event/attempt projection and
  private `0600` run-local ledger; physical path checks, exclusive short writes,
  revision checks, atomic replacement and no repair on read.
- `interactive-human-time.ts` — interactive-only injected recorder, capture
  boundaries, process-local clock corroboration and optional cumulative
  single-engineer estimates. Runner hooks observe durable decisions before
  continuation; failures cannot authorize, replay or recover workflow work.
- `cli.ts` — command surface and non-TTY output. Exposes `banzai`,
  `interactive`, `doctor [--json]`, `model`, `init`, `run`, `status [--json]`,
  `control capabilities|status|start --slug|answer|recover` (with optional
  `capabilities --cancellation` discovery), `resume`, `retry`,
  `recover`,
  `eval export`, `eval kpi` (checkout and `--input` projection modes), and
  `eval context` (independent context-evidence projection), plus
  `eval cancellations [--json]` (independent cancellation report). Eval arguments are
  validated before Git discovery, the pure `--input` mode runs without
  repository discovery, and the context path constructs neither adapters nor
  `WorkflowRunner`. Also exposes guarded
  `compatibility live --confirm-live`, `approve adr|plan`, `triage`, and
  `cancel [--run <run-id>] [--reason <enum>]`, which never opens a reason prompt.
  Bare invocation without a TTY prints help instead of waiting for
  input, and the help heading derives the Banzai release-train version from the
  orchestrator package mirror under ADR-0033. Human status distinguishes a
  passing review from terminal completion by zero-accepted human triage;
  structured status JSON is unchanged. It traps
  `SIGINT` and `SIGTERM` for every run-bearing command, wiring
  `createInterruptHandler` to the progress reporter, `shutdownActiveProcesses`,
  `forceTerminateActiveProcesses`, and `releaseHeldRunnerLocksSync`, and
  restores the terminal an interrupted prompt left in raw mode with the cursor
  hidden.
- `version-cli.ts` — early, repository-independent `--version` / `-v` and
  `--plugin-version` / `-pv` commands, also accepting em-dash long aliases.
  Reads the package mirror or bounded local client inventories, including
  disabled installations and all distinct installed versions per client.
  Unknown inventories are unavailable; empty inventories are not installed.
  No known plugin version produces a nonzero exit; extra arguments fail before
  any inventory query. Never reads marketplace source versions or starts models.
- `agent-control-cli.ts` — exact non-TTY control grammar and stdin composition.
  Capability discovery runs before Git discovery or runner construction;
  status, start, answer, and recover reuse the current `WorkflowRunner`, and
  mutations emit a fresh authoritative status projection.
- `agent-control.ts` — closed current `banzai-agent-capabilities/v6`
  (declaring the completion publication protocol, stages, refusal codes and
  `pending_application` and task verification), `banzai-agent-status/v5` (bounded
  task applicability and completion publication state), and configuration `banzai-agent-answer/v3` contracts;
  preserved keyed consultation `banzai-agent-answer/v2`, `banzai-agent-request/v1`, ordered escalation
  `banzai-agent-answer/v1`, and `banzai-agent-recovery/v1` inputs; bounded
  privacy allow-list, semantic state/action projection, exact consultation
  identity binding, 64 KiB fail-before-mutation input decoding, and
  deterministic JSON rendering.
- `live-compatibility-cli.ts` — exact confirmation parser, canonical closed
  JSON rendering, and `pass | fail | unavailable` exit mapping for the live
  compatibility path.
- `live-compatibility.ts` — protected live-only candidate cloning,
  subscription-auth-root isolation, version/auth preflight, bounded reviewer
  scenarios, exact Codex write-probe events, Claude
  restricted host inventory, source/control snapshots, runner-rendered v2
  review artifacts, closed `banzai-live-compatibility/v2` evidence, process bounds, and cleanup.
- `project-adoption.ts` — facade over the canonical plugin prerequisite reader;
  filesystem-only, bounded regular-file inspection of
  instruction layout, ten populated manifest sections, the explicit scaffold
  marker and exact plugin/source-workspace identity. Shared by CLI, workflow
  and doctor; diagnostics contain fixed filenames/reasons, never raw contents.
- `project-setup.ts` — TTY setup menu, manual fallback, post-child reinspection
  and no automatic task submission. It reuses RunStore ownership with stale
  lock reclamation disabled and rejects unfinished/corrupt latest-run evidence.
- `setup-client.ts` — supported local client/plugin discovery and revalidation,
  selected subscription auth, existing Claude/MCP scope and explicit skill
  argv. It strips inherited workflow authority and API keys without weakening
  host nesting restrictions or client permission prompts.
- `foreground-client.ts` — inherited TTY child lifecycle with no captured
  transcript; direct argv, terminal restoration, owned-child signal handling
  and bounded shutdown.
  `test/setup-pty.test.ts` exercises the built CLI through the standard-library
  Python driver `test/pty-driver.py`; `python3` on `PATH` is required and
  missing Python fails the suite.
- `doctor-cli.ts` — exact doctor argument contract, injected stdout/stderr
  composition, canonical JSON serialization, and deterministic human
  projection for `banzai-doctor/v5`, including explicit unavailable project
  types when marker evidence cannot be read.
- `doctor.ts` — fixed-order project and task-verification diagnostics, with
  `project.guidance` immediately after `repository.git` and schema version 5. `claude.instructions` follows `claude.environment`
  and precedes `claude.permissions`; it compares the configured role union and
  preserves mismatch/bounded-failure/unverifiable precedence. Uses direct
  privacy-bounded config, active-pointer/state, and lock reads plus injected
  executable/liveness probes; resolves relative and empty `PATH` components
  against the discovered checkout, requires absolute canonical persisted
  repository identity, fails closed on unreadable marker evidence, and reports
  verified, explicitly ambient, safely degraded, and invalid Claude invocation
  environments through the filesystem-only `claude.environment` check without
  exposing plugin paths or resolution errors. Its `claude.permissions` check
  reports whether the settings a spawned Claude session loads still grant the
  tools its phases call, and is skipped whenever no configured role depends on
  those rules. It never constructs `RunStore`,
  vendor adapters, or `WorkflowRunner`. Its advisory
  `authentication.models` check explicitly separates executable availability
  from authentication readiness without calling a vendor.
- `claude-permissions.ts` — offline audit of the permission rules a spawned
  Claude session will honor. `claudePermissionDemand(config)` reads which roles
  actually depend on them: a Claude planner writes artifacts no runner
  authorization covers, a Claude planner or implementer runs shell commands, and
  a Claude reviewer depends on neither because it uses read-only tools and
  returns structured findings for runner-owned artifact rendering.
  `inspectClaudePermissions()` reads the
  exact sources the resolved scope loads, plus administrator policy settings and
  Claude Code's workspace trust record, which voids every repository-scoped
  allow rule of an untrusted checkout. A missing `Write` grant blocks; a
  refusing `deny` or unanswerable `ask` rule blocks; path-scoped, `Edit`, and
  `Bash` gaps are advisories. `claudePermissionRemediation()` owns the single
  remediation both the runner and doctor repeat.
- `evaluation-cli.ts` — strict parser and injected stdout/stderr composition for
  `banzai eval export`; the branch runs before adapters or `WorkflowRunner` are
  constructed.
- `evaluation.ts` — direct read-only adapters for raw state, canonical model and
  verification attempt, review, and event evidence; runner-owned Codex
  `*-result.json`, `*.terminal-checkpoint.json`, `*.review-snapshot.json`, `*.context.json`,
  review-candidate Markdown, candidate metadata, logs,
  commands, paths, and digests remain outside the evaluation input/output
  boundary. Supported verification ledgers own complete new-run history;
  absent markers retain legacy partial coverage. Owns opaque keys, source
  precedence, coverage-aware per-run metrics, and workflow/status aggregates
  for `banzai-evaluation-export/v1`. Only known JSON sidecars are excluded;
  other malformed or non-regular JSON candidates remain explicit gaps. Higher
  persisted model counters prevent incomplete leaf sets from claiming exact
  dependent metrics without reconstructing missing evidence. Counter gaps
  remain scoped to their kind, duration phase, and review-only projections;
  model-wide metrics absorb their sum without degrading unrelated kinds.
- `evaluation-render.ts` — pure canonical two-space JSON serialization and the
  deterministic compact Markdown projection of the same completed object.
- `evaluation-kpi.ts` — pure derived-KPI projection
  (`banzai-evaluation-kpi/v1`, ADR-0026) over complete evaluation-export
  objects: per-source KPI sets derived from per-run evidence only (never
  export aggregates), closed numerator/denominator/value/coverage values with
  `null` on a zero denominator, fail-closed planner/implementer/reviewer
  configuration signatures (`mixed`/`unknown`, an unattributable attempt voids
  the run's roles; an incomplete model-attempt set also voids all roles),
  model-only by-kind coverage and array parity before exact retry arithmetic,
  and fail-closed `INVALID_EVAL_INPUT` structural decoding
  of exported files. Imports only `types` and `errors`, so every KPI is
  testable from a hand-built export.
- `evaluation-kpi-render.ts` — canonical two-space JSON and the deterministic
  Markdown comparison projection of a completed KPI report: a sources table
  and one table per KPI measure with one column per source, union group rows,
  and the fixed `value (numerator/denominator; exact e, incomplete i)` cell
  grammar.
- `evaluation-kpi-cli.ts` — `eval kpi` grammar sharing the `eval export`
  cohort option codes plus repeatable `--input` (mutually exclusive with
  cohort selectors); checkout mode computes the export in memory as source
  `current`, input mode reads only the named files with ordinal-basename
  labels and needs no repository.
- `context-report.ts` — independent direct read-only collector for
  `banzai-context-report/v1`. It reads only bounded run
  identity/timestamp/route, canonical attempt identity/status/usage, and
  matching context ledgers; enforces strict identity, privacy, and usage
  consistency; treats historical absence as incomplete physical-attempt
  coverage; and aggregates fixed-order workflow/phase/role runner bytes,
  categories, budget results, vendor usage, and inventory without importing
  evaluation, adapters, store, or workflow.
- `context-report-render.ts` — pure canonical two-space JSON plus coverage-first
  deterministic Markdown from the same completed context report.
- `context-report-cli.ts` — composes direct collection and rendering through
  injected streams while reusing the exact `eval export` cohort parser.
- `cli-routing.ts` — `resolveCliMode` maps argv and TTY presence to
  `interactive | help | command | tty_required`.
- `interactive.ts` — the launch header and the state-driven decision interface
  behind `InteractiveIO`. The header opens with the brand mark, two
  block-element corners in vermilion beside the name and location rows, and
  names the package-derived Banzai release-train version, the
  repository with its branch, short commit, and carried-in change count, and one
  row per phase carrying vendor, model, effort, timeout, and a readiness marker;
  authentication spends lines only when it fails — once per blocked vendor,
  naming the phases it blocks, not once per role that shares it. Repository
  facts arrive
  through `RepositoryIdentityGateway` and degrade to the parts that resolved, so
  a detached HEAD or an unreadable index never stops a session starting. The run
  summary leads with the verdict, states the workflow reason, review execution,
  and pending rotation through `vocabulary.ts`, and always lists every finding
  with its id, severity, wrapped summary, and evidence path. Triage then lays
  each finding out for a decision rather than for scanning: a phase-banner rule
  carries the id, colour-toned severity, and `n of m` position, the summary
  repeats beneath it because the list has scrolled away by the second
  disposition, every evidence locator takes its own line in cyan with its
  detail wrapped under it, and `Resolved by` labels the remedy. Indentation
  carries the same hierarchy when colour is disabled. Attempt, session,
  and review counters are operator telemetry and are not shown there;
  `banzai status --metrics` and `--json` retain them.
  Offers only the actions valid for the persisted run status,
  labels a retryable invalid implementation ledger as plan-task completion
  evidence repair instead of a read-only attempt, and distinguishes an
  interrupted recovery from one completed prerequisite-blocked fix whose
  remaining accepted scope requires fresh operator authorization,
  derives the kebab-case feature slug via `generateFeatureSlug`, and keeps the
  session open when a phase returns a gate. It uses the shared review-completion
  projection so terminal triage is never displayed as reviewer pass.
- `inquirer-io.ts` — the `@inquirer/prompts` implementation of
  `InteractiveIO`; the only module bound to the prompt libraries. Its initial
  request input uses `@inquirer/core` to enable bracketed-paste mode, capture
  multiline content as opaque ordered blocks, render atomic
  `[Pasted text #N +M lines]` placeholders, show a sanitized preview on an
  immediate identical re-paste, expand exact content on submission, and disable
  bracketed-paste mode through prompt cleanup. Other inputs retain the standard
  one-line prompt.
- `terminal-attention.ts` — presentation-only macOS Dock attention, composed
  by `cli.ts` and injected into `interactive.ts`. Wraps automatic runner calls
  with a monotonic 30-second threshold and signals once when the returned state
  needs plan/ADR approval, human input, triage, or blocked-run action. Sends BEL
  to Terminal.app or a one-shot OSC 1337 request to iTerm2 on human TTY surfaces;
  suppresses control/JSON, CI, multiplexers, unsupported terminals, and
  `BANZAI_ATTENTION=off`. Stream errors are non-fatal. No workflow or persisted
  notification state is added; its only repository import is the run-state type.
- `workflow.ts` — `WorkflowRunner`, the core. Owns `start`, `resume`, `retry`,
  `recover`,
  `approvePlan`, `decideAdr`, `answerHumanDecision`, `triage`, `cancel`,
  and process-local `recordCancellationResponse`,
  `status`, and the private phase executors for selection, planning,
  implementation, verification, review, and fixes. Also owns preflight,
  including `assertClaudePermissions`, which ends a run before its first phase
  when the settings a Claude session loads deny a tool the phase must call and
  `--permission-mode dontAsk` leaves nothing able to approve it,
  approval-digest validation, base-commit validation, attempt reconciliation,
  compatible builder-session selection, bounded full/delta reviewer policy,
  and direct terminal completion after complete zero-accepted triage.
  For new strict implementation and fix attempts it owns the
  `banzai-completion-protocol/v1` lifecycle (ADR-0047): the v7 state
  transition with retained prior-state bytes, protocol-selected envelope
  decoding, `pending_application`, capture, claim validation, deterministic
  v2 region rendering, candidate persistence, publication, receipt, apply and
  once-only events, the closed `CompletionRefusal` routes (I/O resume, drift
  restore-then-resume, integrity cancel), stop results applied with retained
  diagnostics, linked `<kind>-repair-<hex>` successors via `retryOf`, and the
  read-only revalidation of published completion at every downstream boundary.
  Capture derives its baseline from the identities the v2 terminal checkpoint
  observed, refuses any second observation that differs and refuses a claim
  without that proof; it revalidates checkpoint configuration and session
  context before creating a missing capture. Identity-bearing capture/receipt
  time derives from terminal proof rather than retry time. Ordinary cursor
  state-write failures and follow-on refusal state/event persistence failures
  stay on the publication path without becoming model failures; resume appends
  a durable refusal event once before continuing. Publication authority includes
  the implementer configuration digest; and a completed protocol
  attempt interrupted before its summary, cursor and events finishes them
  idempotently from its receipt.
  `artifactWritePaths` supplies prompt grants and `checkArtifactPhaseScope`:
  strict implementation permits the bound `implementationReport` and
  `testReport`; strict fix additionally permits the existing bound
  `changeReport`, without requiring a report when its existing trigger does not
  apply. `hooks/spec-gate.cjs` mirrors these roles in `privateWrites`.
  Feature and quick-fix retain `work` and `changeReport` respectively;
  planning, selection and review grants remain separate. Planning also changes
  public `documentation/**` and the root `PROJECT_MANIFEST.md`, where accepting
  an ADR adds its `Planned` active-index row; source paths stay outside the
  planning scope.
  Cancellation captures pre-transition context before clearing the pending
  human decision; durable decision history and the terminal anchor are retained.
  Recovery source discovery distinguishes interrupted mutable work from one
  exact completed prerequisite-blocked strict fix. The latter derives the
  remaining accepted IDs from current review/triage and a validated blocked
  result, binds the source result and scope into authorization, preserves the
  source bytes, accepts fix-refreshed reports only when their canonical
  implementation ledger remains exact, removes prerequisite items tied only to
  out-of-scope findings, and creates or resumes one linked non-recursive fix
  attempt.
  Verification writes a started leaf before process activation, reconciles
  terminal leaves idempotently, links interrupted restarts, and retains only the
  latest round in state. Review captures the adapter result and redacted output
  before candidate validation, persists typed failure evidence, and publishes
  only validated candidate proof bytes into canonical review state. It refreshes
  Claude invocation scope filesystem verification on every resolution, while
  retaining the configuration-keyed MCP whitelist cache. Before each model
  attempt it rechecks applicable structural scope and instruction resource
  parity, and reports a degraded resolution once per run. It classifies every
  model failure into a closed
  cause set, preserves the reviewer session binding and the reviewed-workspace
  digest across integrity-neutral failures, records failed-attempt usage in run
  metrics without marking the attempt completed. New v2 reviews persist an
  immutable review snapshot before invocation and validate reviewer-owned scope
  acknowledgment against it. Both vendors return one result; the runner renders,
  validates and publishes the candidate with no formatting-only model repair.
  Matching v2 terminal proof can regenerate an absent candidate; canonical
  publication, JSON, events and state reconcile without repeated model calls or
  duplicate accounting. Historical v1 recovery retains its original rules.
  Its narrow context-invocation wrapper resolves the exact prompt and output
  contract, atomically checkpoints pre-call runner bytes, blocks only an
  enforcing runner-payload crossing before the adapter starts, and records
  explicit-availability post-call usage, inventory, and turn evidence. Historical review
  primary and artifact repair retain distinct invocation ordinals; current
  reviews use only primary. A context-budget
  failure is explicitly retryable because no vendor process or repository side
  effect began.
  Planning persists its vendor session identity before completion, captures the
  stopped workspace and invocation digests on failure, and explicitly retries
  supported transient/result-validation failures in the compatible saved
  session. Otherwise it uses an artifact-first fresh continuation. The source
  attempt stays intact and the descendant records its retry linkage. Valid
  planning terminal checkpoints reconcile before another model invocation,
  including strict-selection and plan-task validation; known terminal/session
  conflicts cannot be promoted. Rejected checkpoints on otherwise retryable
  failed planning attempts force a fresh continuation instead of a retry loop.
- `verification.ts` — root project-marker detection, exact repository-hygiene
  classification, explicit-profile readiness assessment, deterministic
  profile-major command descriptors and configuration digests, and flattening
  shared by doctor and workflow execution.
- `state-machine.ts` — `transitionState`, `blockState`, `requireState`; the only
  place `RunStatus` changes, so illegal transitions fail closed.
- `store.ts` — `RunStore`. Atomically replaces `state.json`, appends
  `events.jsonl`, writes model-attempt records and redacted output, atomically
  begins and finishes strict mode-0600 `<attempt-id>.context.json` ledgers while
  excluding them from canonical attempt enumeration, creates the
  deterministic attempt-owned review-candidate path, creates the
  schema-version-1 verification ledger marker, atomically owns one bounded leaf
  per physical verification attempt plus sequence-qualified log digests,
  enumerates canonical model-attempt leaves with path/identity validation while
  excluding checkpoint, candidate, raw-result and completion-protocol evidence,
  writes the immutable attempt-owned completion transition, original report,
  capture, candidate and publication records (`wx` temp plus link),
  appends deduplicated events through `appendEventOnce`, and enforces the
  single-active-run lock. Locks this process holds are tracked module-wide, so
  `releaseHeldRunnerLocksSync` can drop them from a signal handler, where the
  `try/finally` that normally releases never runs; a lock file whose token is
  no longer ours belongs to another runner and is left as found. It normalizes
  schema-version-1 run state
  to version 2 on read, discarding unbound legacy session IDs while preserving
  durable run position and human evidence.
  A separate `.state-write.lock` serializes state replacements and event appends.
  The private create path is distinct from ordinary updates; ordinary writes
  cannot recreate missing state or change terminal state/anchor. Acquisition is
  bounded to 1,000 ms with 10 ms retries; owned descriptor identity controls
  cleanup. It is excluded from signal-handler lock release and has no automatic
  orphan reclamation. `commitCancellation` checks the exact active identity,
  stops/captures the winning state and writes its immutable anchor. Event capture
  and receipt-bound first response use the guarded expected source fingerprint;
  scans, human prompts and model execution occur outside the short guard.
- `adapters.ts` — `createVendorAdapters` plus the argument builders
  (`buildCodexArguments`, `buildClaudeArguments`,
  `buildClaudeSelectionArguments`, `buildClaudePhaseArguments`) and the minimum
  CLI versions `MINIMUM_CODEX_VERSION = "0.145.0"` and
  `MINIMUM_CLAUDE_VERSION = "2.1.218"`. Adapter requests consume the exact
  prompt envelope and output-contract bytes already measured by the workflow;
  structured usage, turn count, and privacy-safe inventory evidence survive
  success, typed process failure, durable-observer failure, timeout, and
  post-close decoding failure when the vendor reported them. Codex checkpoints
  only the final agent message confirmed by `turn.completed`, rather than
  treating schema-valid progress JSON as another terminal result. Final-file
  parity and rejection of duplicate terminal events remain enforced. The optional
  live-only Claude seam
  loads the packaged plugin and hook-event projection; ordinary adapter callers
  omit it and retain their prior argv. An executable belonging to neither
  vendor fails with `UNSUPPORTED_VENDOR` before a process starts. When the
  invocation scope carries a resolved MCP whitelist, `claudeMcpConfig` emits it
  as `--mcp-config` beside `--strict-mcp-config` (ADR-0020's sanctioned
  extension: exactly the whitelist loads, nothing ambient) and
  `codexMcpServersOverride` emits one `-c mcp_servers={serena={…}}` override on
  fresh and resumed sessions alike, replacing the whole table so no other
  user-scope server leaks in; an absent whitelist keeps both argument vectors
  byte-identical to before. Loading a server only lists its tools: under
  `--permission-mode dontAsk` Claude denies every MCP tool no `--allowedTools`
  entry names, so `serenaAllowedTools()` travels beside `--mcp-config` and
  names Serena's non-mutating tools individually. Its writers stay ungranted in
  every role because the spec-gate hook matches
  `Edit|Write|MultiEdit|NotebookEdit|apply_patch` and never sees an MCP call,
  so a granted `replace_symbol_body` would edit the tree with approved-bundle
  enforcement blind to it. Codex applies no such permission gate and calls the
  whitelisted server directly. It also owns
  the Claude subprocess environment scope: `resolveClaudeInvocationScope`
  verifies a packaged plugin directory by reading its `.claude-plugin/plugin.json`,
  `AMBIENT_CLAUDE_SCOPE` reproduces the pre-ADR-0020 argument vector, and
  `claudeSessionInventory`, `claudeUsage`, `classifyClaudeFailure`,
  `classifyCodexFailure`, and `classifyModelFailure` derive session inventory,
  spent usage, and the typed failure cause from the vendor's structured stream
  rather than message text. `summarizeCommand` renders shell actions for
  progress display: it unwraps the `zsh -lc "<payload>"` shape both vendors
  report so the payload is shown instead of the shell name, drops leading
  environment assignments, and elides to `…` — never removes — any token that
  contains `=`, follows a long-form credential flag, is itself
  credential-shaped (`Authorization:`, `Bearer …`), or carries a Unicode bidi
  or invisible formatting control. Short flags are deliberately not treated as
  credential flags (`mkdir -p`, `sort -u`, `cp -p`), and non-ASCII text is
  retained, because both rules previously erased the one token worth showing.
  `truncateDetail` cuts by grapheme cluster at 56 columns, so a summary never
  ends in half a character. Only credential-shaped `key=value` forms and
  environment assignments are elided; ordinary long options such as
  `--porcelain=v1` keep their values. Tool paths, file-change paths, and path
  arguments inside commands are all reported relative to the checkout, fall
  back to a `~`-relative form outside it, and share the 56-column cap; a
  file-change event names the first two paths and counts the rest. Tokenizing
  strips a quote whose partner the 240-character detail cap already removed. `normalizedUsage` reconciles the two vendors' incompatible cache
  reporting: Codex's `cached_input_tokens` is already a subset of
  `input_tokens`, while Claude's `cache_read_input_tokens` and
  `cache_creation_input_tokens` are disjoint from it, so those are added to the
  total. `ModelUsage.inputTokens` therefore always means total input, of which
  `cachedInputTokens` is the part served from cache — cache reads only, since
  cache-creation tokens are premium-billed fresh input, not hits — without this
  a cross-vendor sum, and any cache ratio taken from it, is meaningless. The
  rendered cache percentage floors, so `100% cached` appears only when every
  input token was a cache read. The live line labels the reading `tokens:`,
  shows the fresh remainder beside the ratio, and carries the turn count from
  Claude's cumulative `result` event, so a run total that re-counts the
  conversation on every stateless request reads as a sum over turns rather
  than one prompt. A Codex exit that produced no protocol event at all
  never began a thread and classifies as `process_start`. Codex preflight first
  checks write access to the effective `CODEX_HOME` without mutating it, so an
  enclosing read-only sandbox fails as `CODEX_STATE_UNAVAILABLE_IN_SANDBOX`
  before a CLI or model attempt starts; ordinary state-directory permission
  failures remain distinct as `CODEX_STATE_NOT_WRITABLE`.
- `process.ts` — `runProcess`, `subscriptionOnlyEnvironment`,
  `redactSensitiveText`, `terminateProcessGroup`. Strips API-key environment
  variables and redacts secrets from retained output.
- `validation.ts` — runtime decoders (`parseWorkflowSelectionResult`,
  `parsePhaseResult`, `parseReviewResult`, `parseConfig`) that enforce the
  invariants JSON Schema cannot express: non-empty values, identifier patterns,
  positive integers, uniqueness, and cross-field agreement. Also the
  protocol-selected safe envelope (`parsePhaseResultEnvelope`, which validates
  everything except the ledger and retains the canonical original plus digest),
  attempt schema 3/4 rules (protocol fields required on v3/v4 and forbidden on
  v1/v2, result bound to the retained envelope original), terminal checkpoints
  v1-v3, and the closed readers for completion transition, capture, candidate,
  publication receipt, cursor, summary v2 and diagnostics.
- `prompt-envelope.ts` — in-memory ordered closed prompt components whose
  concatenation is the exact adapter prompt; it adds no implicit separator and
  persists no component text.
- `output-contract.ts` — one exact vendor-specific serializer for selection,
  phase, and review schemas. Claude keeps compact sanitized JSON; Codex keeps
  two-space JSON plus one newline, and the same bytes are measured and passed
  to the adapter.
- `context-accounting.ts` — pure exact UTF-8 measurement, closed v1 ledger
  decoding, selector precedence, and observe/enforce budget evaluation. Only
  exact pre-call `runner_payload_bytes` can enforce; post-call metrics remain
  advisory.
- `contracts.ts` — re-exports the plugin's contract JSON and
  `assertContractParity`, which fails with `CONTRACT_VERSION_MISMATCH` or
  `SCHEMA_VERSION_MISMATCH` when bundled schemas disagree with
  `CONTRACT_VERSION`; current review-result v2 and byte-preserved v1 resolve
  through distinct output-contract identities.
- `init-resources.ts` — generated local verification guide embedded in the
  standalone CLI. `init-resources-build.mjs` reads canonical
  `documentation/verification-examples.md` and resolves sibling product-guide
  links to the public repository; build generates and check-dist compares.
  CLI init creates the local guide under its initialization lock before prompts,
  using create-only writes and rejecting symlinks or non-regular paths.
- `config.ts` — `.banzai/config.json` location, `DEFAULT_CONFIG`,
  `loadConfig`, `initializeConfig`, and `applyModelUpdates`, which rewrites only
  requested `model`, `executable`, and `effort` JSON value tokens and preserves
  every unrelated byte. The optional context policy defaults to
  `{ mode: "observe", limits: [] }`; selector-specific limits may be observed,
  while enforcement is restricted to exact pre-call runner-payload bytes and
  ships with no universal numerical maximum.
- `models.ts` — hand-maintained catalog: `SELECTABLE_MODELS`, supported-model
  identity, model standings, `modelAdvisories`, `vendorFor`, `vendorUsage`, and
  role labels. It is the source of truth for supported identities and for the
  model and effort levels the menus offer. The Codex choices include
  `gpt-6-astra` with `low`, `medium`, `high`, `xhigh`, `max`, and `ultra` effort.
- `model-selection.ts` — `selectModelSettings`; the per-role model and effort
  dialog, filtered to the levels the chosen model accepts. Its implementation
  menu recommends the effective planning executable, model, and effort as one
  choice, including pending planning changes from the same dialog, then reports
  strict builder-session reuse eligibility or the fresh-artifact fallback in
  the before-and-after summary before model updates are written. When `init`
  creates the configuration, its `configCreated` result selects `Use default`
  wording, default markers, and an initial-setup summary. Repeated `init` and
  `banzai model` retain the saved-configuration wording, even when the saved
  values match the defaults.
- `git.ts` — repository discovery, `currentCommit`, `currentBranch` (display
  only; null on a detached HEAD), `digestArtifactBundle`,
  `repositoryBaseline`, `workspaceSnapshot`, `workspaceDigest`, and
  `workspaceChanges`. The dirty-path set is the deterministic union of staged,
  unstaged, and untracked evidence. Baseline entries keep pre-existing
  uncommitted work out of the reviewed set while it stays byte-identical;
  snapshot deltas identify the complete added, modified, and deleted surface
  for delta review. Git diagnostics use the C locale: missing repository
  discovery raises `GIT_REPOSITORY_REQUIRED`, and an unborn branch raises
  `GIT_INITIAL_COMMIT_REQUIRED` with a manual initial-commit command. Other
  failures retain `GIT_FAILED`. Interactive CLI entry checks Git before setup; unborn repositories may
  complete setup, then need a commit before task input or creation. Failures
  exit with code 1;
  doctor and cancellation reporting retain their bounded Git diagnostics.
- `phase-resources.ts` — generated committed exact resource text and SHA-256
  identities; imports nothing. `phase-instructions.ts` validates/selects that
  data and compares only declared resources inside a supplied verified plugin
  directory using bounded non-following reads. Its four outcomes distinguish
  confirmed mismatch from absent evidence. Workflow enforces before attempts;
  doctor only diagnoses. No runtime filesystem fallback loads instructions.
- `prompts.ts` — the phase prompt texts and `workflowPhases`, the supplied
  phase responsibilities per route. Planning, strict implementation, review and
  accepted-finding fix prompts inline canonical shared guidance and policy
  bodies and preserve the plan policy's authority
  convention: explicit obligations, labeled discretion only under applicable
  approved meaning, and required evidence despite report corrections. Legacy
  directives, approval bytes and completion contracts remain binding.
  Builder prompts expose ordered configured
  approved task obligations and separately validated candidates; reviewer
  prompts treat current runner evidence as default and require material
  risk/contract justification for missing-test findings. Review prompts also
  freeze ordinary findings/severity/verdict before Engineering Quality mapping,
  isolate incremental `EQ-SHADOW:` candidates in free-form deferred coverage,
  preserve all opaque shadow strings through runner rendering, and make full-after-fix and delta review
  closure-oriented under durable human triage. Strict implementation, fix and
  completion-repair prompts request structured claims plus report narrative
  under `banzai-completion-protocol/v1`: they define the runner-authorized
  changed surface, distinguish carried-in unchanged files from valid report
  evidence, state that the runner renders and publishes the **Plan Task
  Completion** section and that nothing inside it confers authority, and never
  ask for a model-authored table. Repair prompts also carry the persisted
  violation, exact rejected task ID and diagnostic, and route report-input
  violations to narrative-ownership repair.
- `review-snapshot.ts` — immutable `banzai-review-snapshot/v2` bound identity and historical v1 identity, exact
  approved-file hashes, full/delta lineage, recorded verification/completion and
  physically owned evidence paths; snapshot v5 additionally freezes the
  completion publication receipt, capture and candidate identities and admits
  summary schema 2. Storage is a private attempt sidecar,
  excluded from canonical model-attempt enumeration.
- `review-artifact.ts` — shared v2 deterministic rendering, complete lossless
  semantic values, required scope versus reviewer assertions, and original
  runner-evidence projection; snapshot v5 renders as `banzai-feature-review/v6`
  with a runner-owned completion publication section. Validates exact candidate bytes and publishes only
  the in-memory validation proof. Legacy v1 rendering, canonical fallback,
  independent prose rules and typed content diagnostics remain readable.
- `mcp.ts` — `resolveSerenaWhitelist`, the availability-gated Serena MCP
  whitelist. Gates: `.serena/project.yml` present, a vendor-own registration
  (project `.mcp.json` then user-scope `.claude.json` for Claude;
  `codex mcp get serena --json` for Codex), and the registered command
  resolvable on the sanitized PATH the child receives. Never throws — every
  failed gate becomes a note and an absent entry, so a missing Serena can never
  block a run. Exposed on `VendorAdapters` as the optional
  `resolveMcpWhitelist`, so test doubles that never touch MCP stay valid and
  workflow tests spawn no vendor CLI. The workflow resolves it once per run
  alongside the invocation scope, reports
  `MCP whitelist: serena -> claude, codex` (or `none` with the reasons) once,
  and appends an `mcp_whitelist.resolved` event. When the phase vendor's entry
  resolved, the planning, implementation, fix, and review prompts append
  `serenaGuidance` from `prompts.ts`, steering symbol lookup to Serena's
  read-only tools over shell line windows; without a resolved entry the
  prompts stay byte-identical to their pre-whitelist form.
- `interrupt.ts` — `createInterruptHandler` and the fixed interrupt
  vocabulary. A phase can hold the terminal for an hour, so Ctrl+C is the only
  control left and every step of it is visible and bounded: the first press
  erases the live line, restores the terminal, prints that it was received,
  then stops the vendor process groups within `INTERRUPT_GRACE_MS` (2s) before
  they are killed; the closing line states whether a vendor had to be killed
  and that the run is preserved. A second press abandons the wait and exits at
  once, `INTERRUPT_HARD_EXIT_MS` (6s) cuts off a shutdown that never settles,
  and a re-raised signal that nothing acts on falls back to an explicit exit
  after `INTERRUPT_RAISE_FALLBACK_MS` (250ms). Exit status follows the signal —
  130 for `SIGINT`, 143 for `SIGTERM`. Every dependency is injected, so the
  whole sequence is asserted without signals or real timers.
- `progress.ts` — `TerminalProgressReporter`, which writes the normalized
  progress vocabulary to stderr and keeps stdout machine-readable. Styling is
  injected, not detected: with no styler the output is byte-identical to the
  unstyled form, and with one it renders a model phase's `PhaseDescriptor` as a
  width-filling banner, follows it with the supplied phase responsibilities on their own line,
  and colours only failure. The chain is what distinguishes a lite route's
  single phase from a strict one: `feature` and `quick-fix` transition straight
  to `implementing` and receive one phase, so without it a lite run reads as an
  implementation that skipped planning. `resolveProgressLevel` picks
  `quiet | normal | verbose` from an explicit `--quiet`/`--verbose` flag, then
  `BANZAI_PROGRESS`, then the `normal` default; an unrecognized value is
  ignored rather than fatal. `verbose` reproduces the historical per-start and
  per-completion stream exactly; `normal` settles each action into one line
  carrying its duration — right-aligned in a five-character column so the verb
  after it stays scannable, dimmed below ten seconds and undimmed at or above
  so slow calls stand out — and closes a run of identical consecutive actions
  with `×N total`; `quiet` keeps phase boundaries, failures, and runner messages.
  The heartbeat names the actions still in flight — `action` and `skill` kinds
  only, since `model` turn/session openings never report a completion. Given a
  raw `write`, a live status line reports the running phase with the model and
  effort executing it, its elapsed time, what is in flight, and the settled
  action count — the banner scrolls away during a long phase, so the line that
  stays on screen names both the phase and what is running it, redrawn on a spinner tick and
  erased before every settled line and on close; it replaces the heartbeat while
  active and is disabled entirely under `verbose`, which exists to produce a
  faithful log.
- `vocabulary.ts` — plain-English renderings of the run's internal tokens for
  human output only: `runStatusText`, `reviewVerdictText`, `reviewExecutionText`
  (which turns `full/fresh (rotation=…)` into one sentence),
  `reviewSeverityText` (`should_fix` reads as `should fix` everywhere a person
  sees it), and `pendingRotationText`. `--json`, the agent-control surface, and every
  persisted artifact keep the exact tokens; nothing here is ever parsed back.
- `ansi.ts` — `Styler`, `createStyler`, `colorEnabled`, and `colorDepth`. A
  disabled styler is the identity function, so one decision about colour is
  made per surface and every caller is testable with styling forced off.
  `colorEnabled` honours `FORCE_COLOR`, then `NO_COLOR`, then `TERM=dumb`, then
  stream `isTTY`. `colorDepth` reads `FORCE_COLOR=3|2`, then `COLORTERM`, then
  `TERM` to choose 24-bit, 256-colour, or 16-colour codes; only the `brand`
  style depends on it, rendering Banzai vermilion `#FF5A3C` for the launch mark
  and degrading to index 203 and then bright red.
- `format.ts` — pure terminal presentation helpers shared by `cli.ts` and
  `interactive.ts`: `resolveWidth` clamps a reported column count to 40–96,
  `wrapText` wraps on word boundaries only and never splits a token longer than
  the width, `labeledLines` keeps `Label: body` on one line until it overflows,
  `hangingLines` aligns continuations under a prefix and gives the prefix its
  own line when hanging under it would leave the body less than half the width
  (floored at 24 columns), so a long evidence path no longer renders one
  sentence as seven ragged lines, and `formatTokenCount` /
  `formatUsage` render token consumption with the cache ratio, the
  fresh-input remainder, and an optional turn count. It reads no
  process state, so both surfaces are testable against an explicit width.
- `types.ts` — all shared types, `CONTRACT_VERSION = "1.0.0"`, phase-result
  schema v4 and state schema v8 with explicit historical readers, independent
  agent-control schema and `6.0.0` contract identities, independent
  `banzai-context-attempt/v1` and `banzai-context-report/v1` identities,
  model-attempt v4 and retained v1-v3 readers under
  `banzai-completion-protocol/v1`, terminal-checkpoint v1-v3, the completion
  capture/transition/candidate/publication record identities, completion
  summary v2, recovery contracts, and the pure role/model/effort
  session-binding matcher; no runtime imports.
- `errors.ts` — `BanzaiError` (stable `code`, `exitCode`), `ProcessExitError`
  (retains redacted stdout/stderr plus the typed `failureCause` and the usage
  the failed process had already spent, optional inventory, and turn count),
  `errorMessage`.

## Release scripts (`scripts/`)

- `check-release.mjs` validates the release policy, Node/CI/docs consistency,
  all plugin and marketplace JSON, canonical nine-way release-train parity
  against the sole root `package.json.version` authority,
  absence of retained `.banzai-version-set` state, hook,
  current phase-result/state/control identities, byte-preserved legacy
  phase-result schemas, the five existing gates and conditional runner
  configuration gate, decision-consultation and supervisor policy,
  privacy canaries, `orchestrate`, Test Assurance, Security Assurance, and
  Engineering Quality policy references/syntax/identity, the ADR-0050
  structural-assessment trigger heading, code-design method shape and budget,
  consumer anchors and audit exclusion, the versionless Claude
  marketplace, root version-script wiring, committed bundle mode, and required
  paths without mutating them. Before resource and distribution parity it
  rejects hook-runtime edits (`hooks/spec-gate.cjs`, `hooks/hooks.json`,
  `plugins/banzai/lib/`) made after the commit that set the current version
  without a pending working-tree bump, because installed plugin caches refresh
  only on a version change; it skips repositories without full Git history.
  Instruction-layout validation pins the exact
  shim, process sections, six policy files, required/conditional consumer
  matrix, scoped reference rules, migration approval and legacy-release literal.
  The
  Engineering Quality check extracts the exact canonical H2 section and asserts
  its ordered rule IDs, accepted future-blocker boundary, selected semantic
  fragments, short references without a complete skill copy, and
  shadow/resolution prompt wiring. Authority ordering is checked in its own
  section. These policy checks match whitespace-normalized text, so rewrapped
  portable guidance passes while a removal or relocated rule fails; retained
  skill skeletons and Orchestrated Mode blocks remain byte-frozen. These
  checks do not perform
  semantic analysis of target-project source.
- `smoke-committed.mjs` runs help, control capabilities, init, no-run control
  status, ready doctor JSON, evaluation JSON, context JSON over a historical
  incomplete attempt, and evaluation KPI JSON —
  checkout mode plus a non-repository `--input` round-trip over the captured
  export — repeatedly against the
  committed bundle in disposable repositories, asserting clean streams, fixed
  schema identities, deterministic bytes, no mutation, and unconditional
  cleanup. Help and capability release versions must match the candidate's
  package mirror; machine-contract identities remain separately pinned.
- `release-check.mjs` composes `verify`, `format:check`, release validation,
  actual publication checks and
  committed smoke with a vendor-free environment and tracked-tree mutation
  detection. Its default component list excludes version synchronization and
  recovery.
- `release-candidate-check.mjs` copies the enumerated checkout into a temporary
  candidate outside the repository, links installed dependencies read-only with
  workspace entries resolving to the candidate's own packages, indexes the
  candidate without committing, and runs the candidate's `release-check.mjs`
  fresh. It never stages, commits or writes in the real checkout and removes the
  candidate on success and failure.
- `release-version.mjs` owns canonical SemVer comparison, fixed policy and JSON
  pointer decoding, exact byte-span candidates, restrictive durable transaction
  state, an exact bounded cleanup guard that survives main-journal removal and
  its directory sync, authentication of any coexisting journal remnants before
  restoration and recursive cleanup, atomic per-file replacement, restoration,
  final reread, and bounded stale-owner recovery. New format-2 transactions
  group nine fields into seven physical files, including one lockfile candidate
  for its three version pointers. Retained format-1 evidence keeps its original
  six-file interpretation, independently of the current write policy. Explicit
  recovery verifies every current byte/mode snapshot against authenticated
  originals or candidates before any target write; drift preserves targets and
  recovery evidence. Its injected filesystem and signal seams are test-only.
- `version-set.mjs` derives the production checkout from its own location and
  accepts exactly one target; `version-recover.mjs` derives the same checkout
  and accepts no arguments. They expose no production root/path override and
  perform no unrelated command or delivery action.

Project adoption refusal (ADR-0040) is independent of a run failure. Workflow
checks complete guidance before new-run publication and layout only before
model-bearing continuation, retry and recovery attempt publication. A refused
check leaves the latest durable checkpoint and transition authority unchanged;
saved approvals/answers/triage remain saved. Read-only control/evaluation,
cancellation and restore retain their existing contracts.

## Artifact publication and offline preparation

`publication-check.mjs` inspects indexed or selected Git-tree bytes and actual tar
payloads using `publication-policy.json`. Exact historical exceptions are allowed
only in the declared transition mode; clean mode rejects them. npm has an exact
payload list; plugin/documentation resources need classification; source-map
identities and embedded source bytes are inspected. The release gate runs the
index check without mutating tracked files or refreshing historical exceptions.

The build ships existing `validation.ts` persisted readers as generated plugin
`lib/artifact-readers.mjs`, checked byte-for-byte by `build:check`. The plugin
archive library exports content-addressed regular-file bundles with
source identities, original modes, hashes and required dependency closure. A fresh
restoration publishes a verified directory atomically and never restores an active
pointer. Existing destinations support only identical inactive no-op verification.
Inventory selects `workPaths`/`runIds`; export validates fixed `inventoryFile`
bytes. `bundlePath` verification/restore preserve explicit pins and owner policy,
required Markdown authority closure and a private restored manifest receipt.
Managed work/run/control destination ancestry is rejected before staging.
Doctor's read-only active-state check admits state v8 and retained older shapes,
and validates binding identity without authorizing historical continuation.

## Runner instruction generation and parity

`phase-resources-build.mjs` owns the six-phase/nine-guidance/six-policy inventory
and hook reference identities. Artifact-reader generation resolves shared runtime
reader imports to canonical validation source, so generation never consumes its
previous output. `build.mjs` explicitly regenerates the committed
module; typecheck/lint/test never repair it. `check-dist.mjs` compares it and the
bundle/map. Extraction validation preserves the immutable pre-change root and exact
Orchestrated Mode blocks. The current baseline v1/pin contains the maintained
expectations plus replayable, Accepted-ADR-scoped transitions. Raw expectation
keys cover phases, policies and guidance authored directly rather than extracted
from a skill section, so such a resource enters through a first transition whose
`before` is `null`. The explicit
`instruction-baseline.mjs --describe` interface reports the exact pending scope;
`--authorization <file> --check` validates without writes and the authoring command
publishes the exact reviewed transition. Interrupted publication retains a journal
and requires the identical authorization and unchanged source to recover. Normal
build, parity and publication checks never regenerate a baseline or pin.
Publication checks inspect actual source/plugin archives, npm bytes and source-map
content against the same candidate; indexed/working instruction skew fails.

Prompts compose common instructions, phase/guidance/policies and exact work
roles/capabilities before request, human decisions, approved architecture,
verification, workspace, completion, triage and recovery evidence. Each following
block owns exactly two LF separator bytes; source-body newlines remain intact.
Selection is prompt-only. Every continuation resends the complete payload under
existing budgets. Review/selection write sets remain empty, strict implementation
keeps implementation/test reports and strict fix keeps those plus changeReport.
Standalone role readers, conditional report triggers and historical evidence
projections retain their existing behavior.

Structural scope verification is refreshed before instruction comparison.
`INSTRUCTION_RESOURCE_MISMATCH` bypasses failed-attempt/activity handling before
attempt publication, retaining durable decisions and recovery/retry authority.
Codex/ambient/unresolved scopes are unverifiable; bounded resource failures do not
claim match. Diagnostics offer rebuild, matching plugin update or explicit ambient
mode without performing any of them. Tool inventories and real Skill telemetry
remain available; progress names supplied phases rather than inferred skill loads.

## Task verification and versioned consumers

CLI and interactive status share the canonical task-outcome projection in
`verification-ui.ts`. Timeout, interruption, not-run and unavailable execution
remain distinct; verification-only retry retains completed implementation and
revalidates policy, authority and live-process protection before launch.

`verification-evidence.ts` exposes the shared builtin-only
`task-verification.mjs` and `task-verification-store.mjs` owners. Discovery reads
project metadata inertly and distinguishes absent/unavailable inputs and known
placeholders. Descriptors identify requirement references, executable/argv, cwd,
timeout, source hashes and permitted future materialization. Strict obligations
v2 bind the plan remainder; phase-result v4 supplements cannot replace them. A
supplement reusing an obligation ID that differs only in `sources` is a
restatement and leaves the approved descriptor in force; any other difference
fails selection. Plan-time `sources` of a required obligation are not a launch
precondition, so implementation may keep editing scripts; the captured task
inputs record what ran. Supplement sources must still match at launch.
Observed inputs follow Git ignore rules, so a check can pass only when its
generated output is ignored. A completed check that changes observed files stops
the round and names up to ten changed paths with the ignore remedy; input drift
between selection and launch names its paths the same way. The entry lists stay
in process memory and the persisted observation format is unchanged.
Lite checks derive authority from the user request and persisted workflow
selection, with inherited-local permissions. Optional schema-4 project policy
constrains checks; metadata never grants execution permission.

State 8 uses private binding 2 and ledger 3. The runner or standalone helper owns
immutable decision, physical start/finish, origin and applicability records.
Actual launch context, safe source paths and authority are checked before launch
and application. Unknown input captures cannot establish unchanged evidence.
Retries preserve failed identities. Owner recovery records interrupted outcomes
without inventing exit codes and repairs missing origins from retained physical
bytes; terminal success is not re-executed. Equivalent evidence requires complete
policy-declared inputs/toolchain/environment and a direct compatible successful
origin. Changes outside declared explanatory regions and release gates stay
fresh. Helper request v2 accepts bound task identities, not arbitrary argv, and
its inspect path writes nothing. Legacy helper v1 remains explicitly legacy.

Review snapshot 6/rendered review 7 freeze task checks, required/supplemental
status, physical evidence, applicability and completion publication. Review-result
2 is unchanged. The independent reviewer checks requirement coverage and
unjustified weakening; a command hash cannot certify semantic adequacy.
Frozen evaluation/KPI/context/archive formats do not reinterpret task evidence
as legacy profile passes: unsupported evidence remains partial, with no exact
completion/KPI claim. Archive restore requires full interpreted closure.
Human-time's bounded state/attempt projection accepts current versions while
keeping its report schema unchanged.

No historical-run migration or binding v3 is introduced. Start a new task;
retained artifacts keep their original identity. `doctor` v5 and control
capabilities v6/status v5 expose task verification without requiring profile
coverage. Current init emits schema 4 without a verification wizard. The test
driver's exact file selection, process groups and cleanup are unchanged.

## Legacy guided verification setup

These codecs and explicit profile utilities concern retained formats only. New
state-8 task runs never enter this prerequisite gate or init wizard.

- `plan-task-completion.ts` classifies task statements and normalized path
  references before plan offer and approval. Explicit file-change lists and
  write actions reject protected targets; read-only references and preservation
  constraints grant no writes. Wrapped list items retain context, while mixed
  clauses are checked separately. Unrecognized access fails with a clarification
  diagnostic. This bounded planning lint is not a general natural-language or
  shell parser; phase scope and hook write enforcement remain authoritative.
- `verification.ts` performs bounded static root inspection, existing-script
  suggestions, bootstrap-aware readiness and finite missing-script checks. It
  never executes discovery commands or infers a stack in an empty folder.
- `configuration-prerequisite.ts` owns the closed request, continuation, resolution,
  Skip and state-6 codecs. Normalized command changes (including name/timeout)
  replace schema-3 IDs; unchanged/reordered commands retain them.
- `verification-config.ts` publishes concrete token-preserving previews under
  repository and bound-work ownership. It pins config/source hashes, persists
  private confirmation and prepared/applied/finalized transaction evidence,
  reconciles durable before/after/drift states, and emits one applied event per
  operation. Current config and this run's retained ID lists define collisions.
- `verification-cli.ts` owns init's static wizard and verify add/edit/remove/list/
  check. Structured edits cannot change policy fields; explicit check reports all
  commands while workflow verification remains fail-fast. No configuration write
  runs concurrently with a model, check or waiting interactive owner.
- `verification-ui.ts` edits executable/argv fields and renders pending actions
  before the repair/resume alternative. It performs no project execution.
- `configuration-review.ts` freezes actual deltas, coverage and resolution/Skip
  references for snapshot v4/render v5; historical writers/readers remain bound
  to their original versions. Already-published changes survive source drift and
  are distinguishable from completed acceptance or whole-file authorship.
- `persisted-readers.ts` is the canonical generation entry for plugin-only
  validators. Archive dependency closure includes transaction/confirmation/run/
  work evidence; model grants still deny all runner control files.

`WorkflowRunner` rechecks prerequisites at the completed implementation/fix
checkpoint. The pending state is `needs_human_decision`; exact Accept continues
to verification without clearing approval. Edit produces a fresh proposal, Skip
is scoped to this run/types/config and preserves binding obligations, and Cancel
uses existing authority. External repair remains pending until resume revalidates
it, without inventing a human answer. Atomic config publication cannot infer any
model/process outcome. State 6 distinguishes ordered binding-v1 and policy
binding-v2 execution; frozen evaluation/human-time contracts retain their meanings.

Doctor v4 adds ordered per-check `fixes` and `roles`. Codex parity is
`not_applicable`; verified pinned Claude is quiet. Ambient/unresolved scope is
`unverifiable` with only an ambient remedy. Mismatch fails readiness, and only
mismatch/bounded failure receives rebuild/update remedies. Bootstrap changes
coverage only for confirmed markerless custom projects. Static preflight offers
configuration before model work; every failed verification-category check and
`executables.verification` supplies an exact fix command/document pointer.

The instruction baseline retains predecessor and original pins. ADR-0045 permits
its exact declared hook/planning/supervisor transition, including the supervisor
entry skeleton. For retained ADR-0043 authority, only a leading, indented ADR-0045
lifecycle annotation may be excluded for comparison; the original accepted body
and retained suffix must still match their recorded full-byte hash.
