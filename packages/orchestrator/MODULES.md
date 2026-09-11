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
  runner-owned. New run state v4 holds binding bytes and SHA-256; workspace v2
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
- `agent-control-cli.ts` — exact non-TTY control grammar and stdin composition.
  Capability discovery runs before Git discovery or runner construction;
  status, start, answer, and recover reuse the current `WorkflowRunner`, and
  mutations emit a fresh authoritative status projection.
- `agent-control.ts` — closed current `banzai-agent-capabilities/v3`,
  `banzai-agent-status/v2`, and keyed `banzai-agent-answer/v2` contracts;
  preserved `banzai-agent-request/v1`, ordered escalation
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
  projection for `banzai-doctor/v2`, including explicit unavailable project
  types when marker evidence cannot be read.
- `doctor.ts` — fixed-order Project Verification Readiness checks, with
  `project.guidance` immediately after `repository.git` and schema version 2. Uses direct
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
  `artifactWritePaths` supplies prompt grants and `checkArtifactPhaseScope`:
  strict implementation permits the bound `implementationReport` and
  `testReport`; strict fix additionally permits the existing bound
  `changeReport`, without requiring a report when its existing trigger does not
  apply. `hooks/spec-gate.cjs` mirrors these roles in `privateWrites`.
  Feature and quick-fix retain `work` and `changeReport` respectively;
  planning, selection and review grants remain separate.
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
  only validated candidate proof bytes into canonical review state. It resolves
  and memoizes the Claude invocation scope per configuration and reports a
  degraded resolution once per run, classifies every model failure into a closed
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
  excluding checkpoint, candidate, and raw-result evidence, and enforces the
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
  positive integers, uniqueness, and cross-field agreement.
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
- `prompts.ts` — the phase prompt texts and `workflowSkills`, the required
  Banzai skill chain per route. Planning, strict implementation, review and
  accepted-finding fix prompts project the installed plan policy's authority
  convention: explicit obligations, labeled discretion only under applicable
  approved meaning, and required evidence despite report corrections. Legacy
  directives, approval bytes and completion contracts remain binding.
  Builder prompts expose ordered configured
  verification profiles without executing model-selected commands; reviewer
  prompts treat current runner evidence as default and require material
  risk/contract justification for missing-test findings. Review prompts also
  freeze ordinary findings/severity/verdict before Engineering Quality mapping,
  isolate incremental `EQ-SHADOW:` candidates in free-form deferred coverage,
  preserve all opaque shadow strings through runner rendering, and make full-after-fix and delta review
  closure-oriented under durable human triage. Strict implementation and
  completion-repair prompts define the runner-authorized changed surface,
  distinguish carried-in unchanged files from valid report evidence, require
  the model to reread the report table, and return JSON-identical task records
  without rewording evidence details. Repair prompts also carry the persisted
  violation and exact rejected task ID.
- `review-snapshot.ts` — immutable `banzai-review-snapshot/v2` bound identity and historical v1 identity, exact
  approved-file hashes, full/delta lineage, recorded verification/completion and
  physically owned evidence paths. Storage is a private attempt sidecar,
  excluded from canonical model-attempt enumeration.
- `review-artifact.ts` — shared v2 deterministic rendering, complete lossless
  semantic values, required scope versus reviewer assertions, and original
  runner-evidence projection. Validates exact candidate bytes and publishes only
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
  width-filling banner, follows it with the phase's skill chain on its own line,
  and colours only failure. The chain is what distinguishes a lite route's
  single phase from a strict one: `feature` and `quick-fix` transition straight
  to `implementing` and run one skill, so without it a lite run reads as an
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
  schema v3 and state schema v4 with explicit v1/v2/v3 legacy readers, independent
  agent-control schema and `3.0.0` contract identities, independent
  `banzai-context-attempt/v1` and `banzai-context-report/v1` identities,
  model-attempt v2,
  terminal-checkpoint/recovery contracts, and the pure role/model/effort
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
  phase-result schemas, five-gate decision-consultation and supervisor policy,
  privacy canaries, `orchestrate`, Test Assurance, Security Assurance, and
  Engineering Quality policy references/syntax/identity, the versionless Claude
  marketplace, root version-script wiring, committed bundle mode, and required
  paths without mutating them. Instruction-layout validation pins the exact
  shim, process sections, six policy files, required/conditional consumer
  matrix, scoped reference rules, migration approval and legacy-release literal.
  The
  Engineering Quality check extracts the exact canonical H2 section and asserts
  its ordered rule IDs, accepted future-blocker boundary, selected semantic
  fragments, short references without a complete skill copy, and
  shadow/resolution prompt wiring. Authority ordering is checked in its own
  section. These policy checks match whitespace-normalized text, so rewrapped
  Markdown passes while a removal or relocated rule fails. Neither performs
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
- `release-check.mjs` composes `verify`, `format:check`, release validation, and
  committed smoke with a vendor-free environment and tracked-tree mutation
  detection. Its default component list excludes version synchronization and
  recovery.
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
Doctor's read-only active-state check supports v4 and validates binding identity.
