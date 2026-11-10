# Orchestrator module reference

Detailed per-module behavior of `packages/orchestrator/src/` and
`packages/orchestrator/scripts/`. `PROJECT_MANIFEST.md` section 5 carries the
one-bullet-per-module summary and links here; read only the entries for the
modules a change touches. Source, tests (`test/<module>.test.ts`), and the
bound work artifacts (or historical `documentation/features/` reports) remain the evidence; this file
is a navigational reference and is updated with the module it describes.

## Source modules (`src/`)

- `work-documents.ts` — typed projection of fixed tracked document roles and
  binding-v3 validation. Runner state v10 persists the execution binding directly;
  workspace v3 inventories selected documents once, including unchanged approved
  bytes. `lib/work-binding-history.mjs` decodes retained v1/v2 evidence read-only;
  `isHistoricalWork` is the shared predicate status, home and doctor use for it.
  `workSlugConflict` is the read-only ADR-0066 query for a final slug: it
  returns the existing `documentation/work/<slug>` or
  `documentation/initiatives/<slug>` through contained-path resolution, and
  execution-binding creation refuses either with `ARTIFACT_WORK_CONFLICT`
  before creating the work directory.
  `lib/execution-ownership.mjs` coordinates actual runner/verification execution
  by the selected document directory; ordinary Markdown editing has no claims.
  Its recovery-only option requires repository ownership, exact bound-work
  identity and an OS `ESRCH` result for a valid owner PID. It retains the old
  claim with create-only publication, rechecks liveness, bytes and inode, then
  uses normal exclusive acquisition. The runner validates current recovery
  authority before reclamation and again under work ownership before execution.
  Normal runner phases and standalone verification cannot reclaim stale claims.
- `project-files.ts` — typed projection of the shared contained-filesystem owner,
  preserving bounded regular reads, ancestor-symlink rejection and atomic/create-only
  writes. Its shared Git exclusion check protects concrete private evidence leaves
  and temporaries and respects already tracked files. Adoption and review decoding
  use their dedicated shared modules.

- `cancellation.ts` — closed observation v1 reasons, response/provenance table,
  pre-transition context and reconciliation; separate report v1 types (ADR-0035).
  Planning triage retains its origin gate; triage and active planning-review
  attempts report unsupported availability in the existing v1 vocabulary.
- `cancellation-evidence.ts` — bounded read-only state/event/attempt ingress,
  safe local paths, fingerprints and exact context references after stopping.
- `cancellation-cli.ts` — exact cancel flags, optional capability v1 declaration,
  fixed operation messages and report command adapter.
- `cancellation-report.ts` — direct read-only cohort collection, cutoff-aware
  resource subtotals, explicit missing/invalid coverage and report-local keys.
  It never constructs a runner, normalizes state through the operational store,
  repairs evidence, infers motivation or joins tasks by name/time.
  Its v1 model inventory excludes the exact planning-review and
  planning-analysis attempt file tokens.
- `cancellation-report-render.ts` — deterministic JSON and Markdown projections
  of one independently versioned report document, without evidence reads.
- `human-time.ts` — closed private timing codec, episode identities, replacement
  estimates and pure run-summary arithmetic (ADR-0034). Gate response elapsed
  never becomes active effort or a task total.
- `human-time-store.ts` — bounded canonical state/event/attempt projection and
  private `0600` run-local ledger; physical path checks, exclusive short writes,
  revision checks, atomic replacement and no repair on read.
  Planning triage and restored gate anchors require corroborated episode and
  event identities; a request anchor survives same-episode renumbering.
- `interactive-human-time.ts` — interactive-only injected recorder, capture
  boundaries, process-local clock corroboration and optional cumulative
  single-engineer estimates. Runner hooks observe durable decisions before
  continuation; failures cannot authorize, replay or recover workflow work.
- `cli.ts` — command surface and non-TTY output. Exposes `banzai`,
  `interactive`, `doctor [--json]`, `model`, `init`, `run`, `status [--json]`,
  `control capabilities|status|start --slug|answer|decide|recover` (with optional
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
  `approve plan` and `review planning` use exact flag parsing; rework requires
  validated feedback, and `--decision recheck` takes no note and ignores
  `--no-resume`. At a re-check-capable plan gate status prints the CLI waiting
  copy and the latest re-check summary. Planning-triage status prints one answer-v4 Next line.
  Bare invocation without a TTY prints help instead of waiting for
  input, and the help heading derives the Banzai release-train version from the
  orchestrator package mirror under ADR-0033. `--help` and `help` show a compact
  command overview; `help <command>` supplies command syntax and relevant notes,
  and `help progress` describes progress options. These help paths work outside
  a repository without configuration or model execution. Human status
  distinguishes a passing review from terminal completion by zero-accepted
  human triage;
  structured status JSON includes the bounded planning-review projection. It traps
  `SIGINT` and `SIGTERM` for every run-bearing command, wiring
  `createInterruptHandler` to the progress reporter, `shutdownActiveProcesses`,
  `forceTerminateActiveProcesses`, and `releaseHeldRunnerLocksSync`, and
  restores the terminal an interrupted prompt left in raw mode with the cursor
  hidden. `init` and a completed `setup` end with the blocking reasons and
  remediation of the shared Claude permission audit, and write no grant.
  `model` takes no argument, `--local`, or `--help` alone (`parseModelArgs`,
  `INVALID_MODEL_OPTION`), checked before the terminal check and repository
  discovery. In a terminal it runs `executeModelPicker` with `runner.status`
  for the blocked-run exception; `init` runs the picker on the committed file
  only. Outside a run, `init`, `setup`, `run` and the interactive entry read
  the effective `loadConfig` with a fresh Git visibility answer, so a tracked,
  unignored or invalid `.banzai/config.local.json` refuses with its
  `LOCAL_CONFIG_*` code before any vendor executable starts. The launch
  gateway reads through `loadLaunchModels` and writes advisory updates through
  `applyLaunchModelUpdates`. Human `status` prints the `Models:` or
  `Current models:` block from `runner.modelStatus` before the `Next:` line and
  passes the status through `humanStatusView`, which makes retry and recovery
  ineligible and recommends `banzai cancel` for an invalid run model record;
  `status --json` stays as `status()` derives it. `recover` checks the same
  view with `requireRecoverable`. `retry` passes
  `terminal: stdin and stdout are TTYs` to `runner.retry`.
- `version-cli.ts` — early, repository-independent `--version` / `-v` and
  `--plugin-version` / `-pv` commands, also accepting em-dash long aliases.
  Reads the package mirror or bounded local client inventories, including
  disabled installations and all distinct installed versions per client.
  Unknown inventories are unavailable; empty inventories are not installed.
  No known plugin version produces a nonzero exit; extra arguments fail before
  any inventory query. Never reads marketplace source versions or starts models.
- `agent-control-cli.ts` — exact non-TTY control grammar and stdin composition.
  Capability discovery runs before Git discovery or runner construction;
  status, start, answer, decideGate and recover reuse the current `WorkflowRunner`, and
  mutations emit a fresh authoritative status projection.
- `agent-control.ts` — closed current `banzai-agent-capabilities/v9`
  (declaring the completion publication protocol, stages, refusal codes and
  `pending_application`, task verification, planning gates with the plan
  `recheck` decision, and verification requests v4/v3), `banzai-agent-status/v7` (bounded
  task applicability, completion publication state, planning review/triage and
  the plan gate's latest re-check summary under a 32 KiB guard),
  planning `banzai-agent-gate-decision/v1` and `banzai-agent-answer/v4`, and configuration `banzai-agent-answer/v3` contracts;
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
  restricted host inventory (Read, Glob, Grep, optional StructuredOutput) with
  review isolation evidence for `claude.read_only_inventory` — both variables
  on the review spawn and both names in the resolved client binary, which is
  searched and never run — the one Claude minimum in the Claude preflight,
  the adapters' stdin prompt and run-stability environment (the five-minute
  bound gives `BASH_MAX_TIMEOUT_MS` its 120,000 ms floor),
  source/control snapshots, runner-rendered v2
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
  host nesting restrictions or client permission prompts. Its launch passes no
  model, so preflight applies only the vendor-wide CLI minimum.
- `foreground-client.ts` — inherited TTY child lifecycle with no captured
  transcript; direct argv, terminal restoration, owned-child signal handling
  and bounded shutdown.
  `test/setup-pty.test.ts` exercises the built CLI through the standard-library
  Python driver `test/pty-driver.py`; `python3` on `PATH` is required and
  missing Python fails the suite.
- `doctor-cli.ts` — exact doctor argument contract, injected stdout/stderr
  composition, canonical JSON serialization, and deterministic human
  projection for `banzai-doctor/v6`, including explicit unavailable project
  types when marker evidence cannot be read. `doctorInspection` injects the
  local model file's Git probe. The text report prints, between
  `Project types:` and `Checks:`, a `Models:` block of escaped
  `  <role>: <vendor> <model> effort=<effort> (<source>)` lines, with `other`
  for an unknown vendor and `unlisted` for an undisclosed model, or
  `Models: unavailable` for an empty array.
- `doctor.ts` — fixed-order project and task-verification diagnostics, with
  `project.guidance` immediately after `repository.git` and schema version 6. `claude.instructions` follows `claude.environment`
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
  tools its phases call, carries the shared remediation as its fix, and is
  skipped whenever no configured role depends on those rules. The advisory
  `claude.plugin-scope` check that follows warns, never fails, when Claude user
  settings enable Banzai, and passes for local or project installs. It never constructs `RunStore`,
  vendor adapters, or `WorkflowRunner`. `claude.version`, after
  `executables.models`, groups the effective Claude roles by executable
  (`vendorUsage`) and reads each available executable's installed version
  once from the file system only (`readInstalledClaudeVersion`, injectable as
  `installedClaudeVersion`): the native installer's `versions/<version>` file
  or the first `package.json` above an npm install. It fails when any version
  is below `MINIMUM_CLAUDE_VERSION` (`meetsClaudeMinimum`), warns when no
  layout yields a version, otherwise passes, and names the roles behind each
  version and any role whose executable is unavailable. It prints versions
  and role names only, and is skipped when no role runs on an available
  Claude executable. Its advisory `authentication.models` check explicitly
  separates executable availability from authentication readiness and from
  every CLI version but Claude Code's, without calling a vendor. `config.local` follows `config.version` (ADR-0060): presence,
  safety and validity come from the local file reader, and the injected
  `localConfigGitState` probe runs `git ls-files --error-unmatch --` and
  `git check-ignore -q --` at the repository root with `LC_ALL=C` only when
  the file exists. Each cause (tracked, not ignored, unsafe, unreadable,
  invalid at a schema path, invalid file, refused key, Git unavailable) has
  fixed text and a fix linking `documentation/orchestrator.md#model-configuration`;
  a symbolic link at `.banzai/` fails even without a file. The report's
  top-level `models`, between `projectTypes` and `summary`, lists each role's
  `vendor` (`claude`, `codex` or null), its `model` only when it matches
  `MODEL_IDENTIFIER_PATTERN`, `effort` and `source`, and is empty while
  `config.local` fails or the committed configuration is unavailable.
  `claude.instructions`, `claude.permissions`, `executables.models` and
  `claude.version` evaluate the effective configuration and are skipped while
  `config.local` fails; `claude.environment` and verification checks keep committed values.
- `claude-permissions.ts` — offline audit of the permission rules a spawned
  Claude session will honor. `claudePermissionDemand(config)` reads which roles
  actually depend on them: a Claude planner or implementer writes files the
  spec-gate hook grants (ADR-0041) and runs shell commands, and a Claude
  reviewer depends on neither because it uses read-only tools and returns
  structured findings for runner-owned artifact rendering.
  `inspectClaudeUserPluginScope(env)` reads only the user settings file and
  reports the enabled `banzai@<marketplace>` keys, without Claude's plugin cache
  or CLI.
  `inspectClaudePermissions()` reads the
  exact sources the resolved scope loads, plus administrator policy settings and
  Claude Code's workspace trust record, which voids every repository-scoped
  allow rule of an untrusted checkout but none of its deny or ask rules. A
  refusing `deny` or unanswerable `ask` rule naming `Write` or `Edit` blocks,
  because no hook allow overrides it; a missing `Write` or `Edit` grant does
  not. `Bash` gaps and ignored repository allow rules
  (`repositoryRulesIgnored`) are advisories. `claudePermissionRemediation()` owns the single
  remediation the runner, doctor, `init` and `setup` repeat.
  `inspectConfiguredClaudePermissions()` composes demand, the injected scope
  resolution and the audit for doctor and the CLI; an unresolvable scope is
  `unresolved`, not a permission finding.
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
  `banzai-context-report/v2`. It reads only bounded run
  identity/timestamp/route, canonical attempt identity/status/usage, and
  matching context ledgers; enforces strict identity, privacy, and usage
  consistency; treats historical absence as incomplete physical-attempt
  coverage; and aggregates fixed-order workflow/phase/role runner bytes,
  categories, budget results, vendor usage, and inventory without importing
  evaluation, adapters, store, or workflow.
  V2 includes both read-only planning kinds through the shared file-token map;
  historical ledgers retain their version-specific meanings.
- `context-report-render.ts` — pure canonical two-space JSON plus coverage-first
  deterministic Markdown from the same completed context report.
- `context-report-cli.ts` — composes direct collection and rendering through
  injected streams while reusing the exact `eval export` cohort parser.
- `cli-routing.ts` — `resolveCliMode` maps argv and TTY presence to
  `interactive | help | command | tty_required`. `model` is one of the
  exact-contract commands, so `banzai model --help` and argument errors reach
  its parser instead of the global help shortcut.
- `interactive.ts` — the launch header and the state-driven decision interface
  behind `InteractiveIO`. The compact text-only header opens with the Banzai
  name in brand vermilion and the package-derived release-train version, with
  no tagline. The
  repository row shares the title's left edge and shows its branch, short
  commit, and carried-in change count. Phase rows use a two-column indent and
  carry vendor, model, effort, timeout, and a readiness marker in aligned
  columns, including when effort labels or timeouts differ;
  authentication spends lines only when it fails — once per blocked vendor,
  naming the phases it blocks, not once per role that shares it. Model-update
  notices appear only when an advisory exists. Repository
  facts arrive
  through `RepositoryIdentityGateway` and degrade to the parts that resolved, so
  a detached HEAD or an unreadable index never stops a session starting. The run
  summary separates logical sections with one blank line, a bold heading, and
  two-space body indentation. Run action menus follow a dim horizontal divider
  with a blank line on either side, including after time details. Planning
  review shows its artifact path once, alongside the independent-review outcome.
  The summary leads with the verdict, states the workflow reason, review execution,
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
  remaining accepted scope requires fresh operator authorization and from a
  digest-rejected result whose authorized repair outranks replaying its terminal
  checkpoint,
  derives the kebab-case feature slug via `generateFeatureSlug`, and keeps the
  session open when a phase returns a gate. Before the start confirmation, the
  slug step prints `Generated slug:` with the date-prefixed default and asks one
  input: Enter, `y` or `Y` keep it, other text is finalized with today's prefix.
  Its validation keeps the prompt open for format, then length, then an
  existing directory reported by the optional `workSlugs` gateway. A gateway
  refusal or failure keeps the prompt open with `Could not check <slug>:` and
  its reason, because the prompt library drops a rejected validation. The
  session starts the run with the slug that passed validation, read from the
  optional `clock` (ADR-0066). It uses the shared review-completion
  projection so terminal triage is never displayed as reviewer pass.
  Planning gates offer rework and explicit review with default-No confirmations.
  A strict task-verification plan gate first prints the waiting copy with the
  bundle paths and the latest re-check summary, and offers "Re-check my edits"
  between approve and rework without a confirmation; a refusal is printed and
  the gate is shown again.
  Planning triage escapes model text and presents each finding/analysis card
  immediately before its keyed disposition menu; human-time insertion retains
  the final exit-choice anchor.
  `Time for this run` places an optional self-reported active estimate before
  recorded decision waiting, with timed-response coverage and plain-English
  availability issues. `View time details` opens a dedicated episode list,
  subtotal, separate recovery waits, recording/attribution notes and secondary
  diagnostic codes. Duration display rounds original milliseconds, preserving
  zero and positive subsecond values; subtotals retain source arithmetic.
  Estimate actions refresh from current evidence and return to the same menu.
  The header takes one layered read from `ModelConfigurationGateway.load()`
  (ADR-0060). With a non-terminal run it shows, and checks authentication
  for, the run-effective configuration (the committed file with the run's
  recorded local layer) and adds a notice with the drift block or the invalid
  record lines; otherwise it shows the current effective configuration. A
  role from the local file carries `(local)` in its timeout cell, so rows
  from the committed file alone stay byte-identical, and every model value is
  escaped. A `LocalConfigError` from the gateway ends the launch before the
  authentication check; other configuration errors keep the
  `Model configuration unavailable` report. The update advisory evaluates the
  current effective configuration, names every file it would change in its
  options and confirmation, sends each update to the file that supplies its
  role, prints one result line per changed file, and keeps its deferral text
  during any active run. Interactive retry passes `terminal: true`.
- `inquirer-io.ts` — the `@inquirer/prompts` implementation of
  `InteractiveIO`; the only module bound to the prompt libraries. Its initial
  request input uses `@inquirer/core` to enable bracketed-paste mode, capture
  multiline content as opaque ordered blocks, render atomic
  `[Pasted text #N +M lines]` placeholders, show a sanitized preview on an
  immediate identical re-paste, expand exact content on submission, and disable
  bracketed-paste mode through prompt cleanup. Other inputs retain the standard
  one-line prompt. The existing checkbox prompt implements selected review
  scope and validates its selected values before submission.
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
  `approvePlan`, `recheckPlan`, `decideAdr`, `reworkPlan`, `requestPlanningReview`,
  `answerPlanningReview`, `answerHumanDecision`, `triage`, `cancel`,
  and process-local `recordCancellationResponse`,
  `status`, and the private phase executors for selection, planning,
  implementation, verification, review, and fixes. Also owns preflight,
  including `assertClaudePermissions`, which ends a run before its first phase
  when the settings a Claude session loads deny a tool the phase must call and
  `--permission-mode dontAsk` leaves nothing able to approve it,
  attempt reconciliation,
  compatible builder-session selection, bounded full/delta reviewer policy,
  and direct terminal completion after complete zero-accepted triage.
  It serializes planning-review request, read-only review/analysis, triage,
  applying, stale retry and reconciliation under the existing owners. Applying
  receives immutable analysis and exact human dispositions; planning retries
  preserve the independent code-review namespace and sessions.
  Each strict task-verification entry into `needs_plan_approval` (planning
  result, planning-review restore, triage restore) retains a gate-entry
  snapshot. `recheckPlan` (ADR-0058), under the workflow lock at an idle plan
  gate, validates the edited plan as approval does except for the remainder
  digest, rewrites only `planRemainderSha256` through the compare-and-replace
  write, appends a `plan_recheck` record (moving v10 to v11 in the same state
  write) and a `plan.recheck` event that carries identities, digests, counts and
  paths and is not a human-time decision boundary. A refusal writes nothing.
  `approvePlan` never rewrites a digest; a remainder mismatch on v10+ names the
  re-check, and on v11 the approval's `recheckId` links the latest re-check of
  the current gate entry whose bundle digest it approves. `status` exposes that
  entry's latest record as `planRecheck`.
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
  Every timestamp, duration and identifier the runner generates derives from
  the optional trailing `sources` constructor argument, whose defaults are the
  system clock and `randomUUID`. Each identifier keeps its baseline
  derivation:
  - the run identifier and attempt identifiers take the first 8 UUID
    characters;
  - legacy verification rounds keep their `verification-round-<attempt id>-`
    prefix;
  - every other identity takes the full UUID.

  `WorkflowRunner` remains the facade while ADR-0052 moves its internals;
  every name it exports stays importable from `workflow.js`.

  Retry, recovery and restore eligibility run as shells over the staged rules
  in `workflow/domain/`. Each shell loops until its rule decides, gathering
  only the evidence the rule names, in the pre-decomposition order. Around each
  read it keeps that source's original error scope:
  - interrupted-source preconditions fail as one unvalidated precondition;
  - digest-rejected and prerequisite-blocked preconditions rethrow terminal-run,
    project-setup and instruction-mismatch errors;
  - a prerequisite-blocked failure otherwise reports a Banzai error's own
    message.

  The shell computes every digest a rule asks for, including the recovery
  identity the rule assembles, and performs the approval check's block and
  event and completion revalidation's refresh at their existing points.

  The constructor builds one frozen `RunnerContext` from its arguments and
  sources; the context shares the public `store` and `adapters` instances, so
  a patch on either reaches capability code. The runner keeps its mutable
  state in four per-instance owners and calls capability modules for
  approval, base-commit and selection validation, the attempt lifecycle,
  terminal checkpoints, digest evidence, completion capture, refusal,
  publication and revalidation, verification evidence and rounds, and
  preflight check-failure recording. It keeps attempt reconciliation, every
  application of a phase result to the run, the task-completion and
  completion-publication status projections, and the phase executors,
  including verification execution and applicability, calling the moved
  operations from there. Only `now()` remains as a runner-side helper over the
  context.

  The ADR-0060 run guard lives here. Every public command except status and
  cancel starts with a fresh guard holder and Git visibility answer. Runner
  resolutions merge the current committed configuration with the run's model
  record, read once per command through the store and held, and never with
  the current local file; the module imports `loadCommittedConfig` and the
  layer helpers, never the effective `loadConfig`. `start` takes its one
  layered read under the start lock and passes the local layer to
  `createRun`. `compareModelRecord` runs at the entry of each state-changing
  command, where a tracked or unignored local file refuses with
  `LOCAL_CONFIG_NOT_IGNORED`, and before each model attempt and pending
  transition. It compares the record on disk and the current local layer with
  the held record and refuses with `LOCAL_MODEL_OVERRIDE_CHANGED` (escaped
  drift lines and the fixed advice) or `LOCAL_MODEL_OVERRIDE_RECORD_INVALID`,
  writing no block reason, event or rotation reason. Resume of a `created` or
  `selecting` run without a model attempt, `retry({ terminal })`, and
  `retryPlanningReview` record again instead: `readLayerForRecording` reads
  the local file, the record and the terminal rule under the command's lock,
  and refuses a different layer without a terminal once the run has a model
  attempt; `recordModelLayer` prints the changed roles, replaces the record
  and appends `model_override.recorded` with role sources only.
  `modelStatus(state | null)` returns the `ModelStatus` that human status
  prints, reading a fresh local layer and the record without
  filling the guard holder, comparing or failing on a defect; `status()` and
  its `WorkflowStatus` are unchanged, and status evaluates retry, recovery and
  `nextAction` on the run-effective configuration.

- `workflow/ports.ts` — type-only ADR-0052 process-boundary ports: `Clock`
  (`() => Date`), `IdSource` (RFC 4122 version 4 UUID text) and
  `RunnerSources`. It is a domain module and `workflow.ts` re-exports it.
- `workflow/context.ts` — `RunnerContext`, the frozen record of the runner's
  immutable collaborators (repository root, store, adapters, process runner,
  progress reporter, optional human-time observer, clock, identifier source);
  `timestamp`, the ISO-8601 UTC text of one clock reading; and
  `observeHumanTime`, which never lets an observer failure change a decision.
  It imports its collaborator types only.
- `workflow/activity-sequence.ts` — `ActivitySequence`, the per-runner
  `activity-<n>` identifiers, starting at 1 for each runner.
- `workflow/cancellation-receipts.ts` — `CancellationReceipts`, the weakly held
  first-response observation behind each receipt a runner issued.
- `workflow/configuration/ownership.ts` — `ConfigurationOwnership`, the
  async-local marker of work inside an owned configuration action; a workflow
  lock requested there inherits the held lock.
- `workflow/preflight/invocation-scope-cache.ts` — `InvocationScopeCache`, the
  resolved scope record per Claude environment key: a key change replaces it
  with a freshly resolved MCP whitelist and re-arms both reports, a fresh
  resolution merges into it, and the degradation and whitelist reports are
  each claimed once per key.
- `workflow/preflight/approval.ts` — `validateApproval` (blocks, persists and
  appends `approval.invalidated` when the approved bundle changed),
  `validateBaseCommit` (blocks and persists when HEAD moved),
  `validateWorkflowSelection` and `workflowAuthorizationDigest`, which
  `workflow.ts` re-exports.
- `workflow/review/result-application.ts` — `validateReviewResultForApplication`:
  finding identifiers of the current iteration and a complete re-review of the
  previously accepted findings.
- `workflow/digest-evidence/records.ts` — records result-digest evidence and
  rejects a result whose authored digest disagrees, reads the accepted
  baseline, and derives the digest rejection reason text.
- `workflow/completion/inputs.ts` — observes the implementation and test report
  identities and the workspace that completion capture and terminal proof
  record, and compares two observations exactly (`sameObservedInputs`).
- `workflow/completion/plan-tasks.ts` — the approved plan path and task
  identifiers, runner control-task and planning-result validation, and
  implementation-completion validation. For a strict task-verification result
  that requests plan approval, `validatePlanningResult` also records the plan
  remainder digest (ADR-0064): it refuses and validates the plan, records the
  evidence, then rewrites only the value through the compare-and-replace write.
  Live acceptance and terminal-checkpoint reconciliation share this path, so a
  repeated pass writes nothing new. A plan that changed since the read fails as
  `PLAN_TASK_COMPLETION_INVALID` with its path named.
- `workflow/completion/refusal.ts` — `CompletionRefusal`, the ADR-0047
  publication refusal whose closed code and stage are persisted with operator
  guidance; rejecting a captured completion input with its repair checkpoint
  (`plan_task_completion.validation_failed`, `completion.input_rejected`); and
  refusing a publication with its `completion.publication_refused` event.
- `workflow/completion/capture.ts` — the transition into the runner-owned
  completion state (`COMPLETION_STATE_UNSUPPORTED` for an older run state), the
  implementer-configuration digest and checkpoint-configuration check,
  completion input capture, and the repair diagnostic and retry predecessor of
  a completion attempt.
- `workflow/completion/publication.ts` — publication continuation (capture,
  then rejection, refusal or publication), candidate publication through the
  completion cursor, ledger derivation and recording, the publication and
  checkpoint authority checks, the application of a publication to its attempt
  record, and reading a frozen publication. It ends where the runner applies
  the phase result to the run. It depends on attempts and on the other
  completion modules.
- `workflow/completion/revalidation.ts` — revalidation of task completion and
  of a published completion region, and the block a completion failure
  records.
- `workflow/verification/required-checks.ts` — the required task-check
  identifiers of the approved inventory and the task verification policy.
- `workflow/verification/evidence.ts` — verification and task-verification
  evidence storage, the verification authority digest, verification input
  capture, decision preparation and the task execution context.
- `workflow/verification/rounds.ts` — verification round identity
  (`VERIFICATION_ATTEMPT_CONFLICT`) and reconciliation of the run's retained
  verification results (`VERIFICATION_CONFIGURATION_CHANGED` when an open
  round's commands changed).
- `workflow/preflight/check-failures.ts` — records a failed start, review check
  or verification-retry preflight as a block, with `run.start_failed`,
  `review.checks_failed` or `verification.retry_preflight_failed`.
- `workflow/attempts/lifecycle.ts` — `AttemptPolicy`, attempt, recovery and
  completion-repair identities, attempt scope digests, starting, completing and
  failing attempts, recovery attempts, process start, adapter-result and
  redacted output persistence, usage accounting and result-envelope helpers.
- `workflow/attempts/result-scope.ts` — a result's artifact role references,
  the saved artifact workspace evidence and the phase write scope.
- `workflow/checkpoints/terminal-checkpoints.ts` — terminal checkpoint writing
  (including completion-protocol proof), finalization, promotion and result
  validation, checkpoint model settings and result-source identity evidence.
  It depends on attempts, completion, verification, review, preflight and
  digest evidence.
  Planning review and analysis use their dedicated episode binding validators
  and reviewer/planner settings without establishing phase-result digests.
- `workflow/domain/failure-classes.ts` — ADR-0052 domain module holding the
  model-failure cause and failure-code sets, the `[RESULT_DIGEST_UNRESOLVED]`
  block-reason prefix and the read-only-attempt retry predicate that retry,
  recovery and reconciliation read. It also derives the block reason of a
  failed start, review or retry check (`checkFailureReason`), keeping a Banzai
  error's code. It imports `errors` at runtime and `types` type-only.
- `workflow/domain/sessions.ts` — `sessionContext` and `sessionBinding`, the
  configured identity a model session binds to.
- `workflow/domain/human-decisions.ts` — `humanDecisionQuestions`, which
  `workflow.ts` re-exports, and the `decisionText` and `decisionIdentifier`
  validators for human-decision input (`INVALID_DECISION`).
- `workflow/domain/run-identity.ts` — `runId`, the run identifier derived from
  the slug, creation time and UUID, and `requireSlug` (`INVALID_SLUG`). It also
  owns the ADR-0066 slug rule for new work: `workSlugDatePrefix` gives the
  `yymmdd-` prefix of a supplied instant's local calendar date,
  `finalizeWorkSlug` adds it unless the candidate already starts with that
  date's prefix, and `workSlugProblem` classifies a final slug as wrong
  `format` (not kebab-case or not prefixed) before too `length` (over
  `MAX_WORK_SLUG_LENGTH`, 100, prefix included). Callers own the clock.
- `workflow/domain/artifact-scope.ts` — `artifactPaths`, the approved planning
  bundle in description, ADR, plan order (`INCOMPLETE_PLAN`), and
  `isDocumentationPath`. `gateArtifactPaths` supplies exact gate membership,
  including an ADR gate whose description is null. Planning review artifacts
  remain outside approval paths and snapshots.
- `workflow/domain/planning-review.ts` — pure planning-gate availability,
  exact subset scope, bounded numbering, dispatch, stale facts, actionable
  triage and guarded restore decisions under ADR-0052 domain restrictions.
  `planningGateActions` offers `recheck` after approve only at a strict
  task-verification plan gate on state v10 or later.
- `workflow/domain/plan-recheck.ts` — `planRecheckSummary`, the pure ADR-0058
  comparison of the current planning bundle with the planner's version retained
  at gate entry: changed, added and removed files; Markdown sections by ATX
  heading outside fences, keyed by level, text and occurrence; check changes by
  identity with the changed field names from `PLAN_RECHECK_CHECK_FIELDS`; a
  changed absence rationale; and accepted bundle ADRs whose bytes changed. The
  runner-owned remainder digest is masked before comparison. Headings are
  sanitized and capped, and `PLAN_RECHECK_LIMITS` bounds files, a shared heading
  budget and checks with omitted counts. It returns paths, headings, ids and
  field names only.
- `workflow/plan-gate/recheck.ts` — the re-check's I/O shell: refusal errors
  (`PLAN_RECHECK_REFUSED`, which always says nothing was written), bundle reads
  that refuse missing, symlinked and non-regular files, exact UTF-8 decoding,
  the compare-and-replace plan write (`PLAN_RECHECK_CHANGED` when the plan
  changed after the read; mode preserved) and gate-entry snapshot entries
  verified against their digests. The read, decode and write helpers take the
  caller's failure, because planning-result acceptance reuses them with its own.
- `workflow/domain/verification-attempts.ts` — `verificationFailureCategory`,
  which maps process errors to a persisted failure category, and
  `verificationCommandMatches`, which matches a record to its exact command
  descriptor.
- `workflow/domain/routing.ts` — `effectiveWorkflow`, the route a selection
  result authorizes, and `terminalResultContract`, the result contract a
  terminal checkpoint records for an attempt kind.
- `workflow/domain/completion-checkpoint.ts` — `completionInvalidCheckpoint`,
  the persisted `planTaskCompletion` record that marks a completion claim
  invalid (`PLAN_TASK_COMPLETION_INVALID`). It takes explicit facts: the source
  attempt identifier and kind, the violation, the task and the recording time.
  The attempt lifecycle and completion revalidation read the clock and pass
  the time, and the record keeps its persisted field order.
- `workflow/domain/retry-eligibility.ts` — ADR-0052 domain rule `decideRetry`.
  It stages retry eligibility over task-verification attempts, the legacy
  ledger and attempt records, and names the evidence it needs next. Task
  verification reads the latest attempt of every check in the latest round
  (ADR-0057): a started one asks for reconciliation, and otherwise the latest
  unsuccessful one names the retry, whose reason counts the checks it reruns.
  A planning block (ADR-0065) asks for the run's latest attempt by `startedAt`:
  a completed plan attempt whose result reported `outcome=blocked` with the
  run's block reason as its summary names the retry. `plannerBlockSummary`
  (`failure-classes.ts`) reads that result, and `executePlan` uses it to allow
  session reuse and choose the "Continue blocked planning" prompt component.
  `RetryEligibility` moves here and `workflow.ts` re-exports it.
- `workflow/domain/next-action.ts` — `nextAction`, the next-action text for a
  status from its retry, recovery and publication outcomes. It reads no
  evidence.
- `workflow/domain/restore-eligibility.ts` — `decideRestore` over the approval
  snapshot facts (presence, digests, content match and paths) and the current
  bundle.
- `workflow/domain/recovery-eligibility.ts` — `decideRecovery`, which consults
  the digest-rejected source, then the prerequisite-blocked fix source, then
  the interrupted-attempt rule. It also defines:
  - `RecoveryEligibility`, which `workflow.ts` re-exports, and
    `recoveryIneligible`;
  - the shared precondition steps (HEAD, configuration by role, approval or
    selection check, completion revalidation, attempt scope digest);
  - `decideRecoveryWorkspace`, the shared tail: the workspace snapshot and base
    commit, change counts with the recovery identity, then any persisted
    authorization.
- `workflow/domain/digest-rejected-recovery.ts` — `decideDigestRejected`, the
  ADR-0051 source. It decides null when the source does not apply, and
  otherwise stages the digest-evidence read, liveness, terminal checkpoint,
  supersession, HEAD, configuration, selection or approval check, scope and
  evidence digests, then the shared tail.
- `workflow/domain/prerequisite-blocked-fix.ts` — three rules:
  - `decidePrerequisiteScope` derives the exact remaining accepted scope and
    concrete prerequisites of one completed blocked fix. Source selection,
    recovery execution and fix execution all use it.
  - `decidePrerequisiteSource` selects the single exact candidate and rejects
    started descendants, mismatched recovery state and conflicting terminal
    checkpoints.
  - `decidePrerequisiteBlockedFix` decides the source's eligibility.

  Rejections carry the baseline error code and message for the shell to throw.

- `verification.ts` — root project-marker detection, exact repository-hygiene
  classification, explicit-profile readiness assessment, deterministic
  profile-major command descriptors and configuration digests, and flattening
  shared by doctor and workflow execution.
- `state-machine.ts` — `transitionState`, `blockState`, `requireState`; the only
  place `RunStatus` changes, so illegal transitions fail closed. It is
  classified in place as an ADR-0052 domain module: it imports `errors` at
  runtime and `types` type-only, and lint rejects effects in it.
- `store.ts` — `RunStore`. Atomically replaces `state.json`, appends
  `events.jsonl`, writes model-attempt records and redacted output, atomically
  begins and finishes strict mode-0600 `<attempt-id>.context.json` ledgers while
  excluding them from canonical attempt enumeration, creates the
  deterministic attempt-owned code-review and planning-review candidate paths, creates the
  schema-version-1 verification ledger marker, atomically owns one bounded leaf
  per physical verification attempt plus sequence-qualified log digests,
  enumerates canonical model-attempt leaves with path/identity validation while
  excluding checkpoint, candidate, raw-result and completion-protocol evidence,
  writes the immutable attempt-owned completion transition, original report,
  capture, candidate and publication records (`wx` temp plus link),
  appends deduplicated events through `appendEventOnce`, and enforces the
  single-active-run lock. It writes numbered, create-only plan-gate entry
  snapshots under `plan-gate/<NNN>/` (private files, manifest `bundle.json`
  last) and reads the latest one; an unreadable latest entry is
  `PLAN_GATE_SNAPSHOT_INVALID`, never replaced by an older one. State v11 is
  read with the v10 rules. Private writes validate each actual destination and
  temporary against effective Git exclusions; the active pointer's temporary
  lives in the ignored runs directory. Locks this process holds are tracked module-wide, so
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
  `createRun(state, localModels)` writes the create-only `model-override.json`
  (`banzai-run-model-override/v1`, roles in fixed order, mode `0600`) as the
  first file in the new run directory, before `state.json` and the active
  pointer. `readModelOverrideRecord` reads it through the contained reader
  and never throws for a defect: `absent` only once the run directory is
  confirmed, otherwise `recorded` or a `LOCAL_MODEL_OVERRIDE_RECORD_INVALID`
  defect with fixed text that names the record and says to cancel.
  `replaceModelOverrideRecord`, called only when a command records again,
  publishes a new record through a temporary file renamed over it, or
  create-only for a run without one, and never writes through a link.
- `planning-review-state.ts` — closed state-v10/v11 episode, pending-triage and
  history validation for the store. Active and closed slots have distinct
  shapes; historical states reject v10 fields without migration. Only v11 holds
  exact, bounded `plan_recheck` records (unique ids, consistent gate entry,
  planner and written digests, sanitized headings) and a plan approval's
  `recheckId`, which must name one of them. The store
  remains the only persisted-state owner.
- `adapters.ts` — `createVendorAdapters` plus the argument builders
  (`buildCodexArguments`, `buildClaudeArguments`,
  `buildClaudeSelectionArguments`, `buildClaudePhaseArguments`) and the minimum
  CLI versions `MINIMUM_CODEX_VERSION = "0.145.0"` and
  `MINIMUM_CLAUDE_VERSION = "2.1.290"`, the one Claude minimum for every role
  (ADR-0063), with `meetsClaudeMinimum` for doctor. Preflight takes a
  `VendorPreflightTarget` (`executable`, `model`) and, after the vendor-wide
  minimum, applies `modelCliMinimum()` for the target's model (`null` skips
  it), failing with `CLI_TOO_OLD` before authentication; the Claude message
  names the reason. Every builder renders the prompt check through
  `invocationPrompt` but keeps the prompt out of argv: Claude runs `-p` with no
  prompt argument and Codex ends with `-`, and every spawn passes the prompt as
  `ProcessSpec.stdin`. Claude review, routine re-review and planning review
  receive `--tools Read,Glob,Grep` with `Skill` first in the disallowed list,
  and run with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` and
  `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK=1` set after
  `subscriptionOnlyEnvironment` in every scope (ADR-0059). Planning analysis
  keeps `Read,Glob,Grep,Skill`; it, the phases and selection gain only the
  memory variable, and only under a `strictMcpConfig` scope.
  `isolatedClaudeEnvironment` then sets, for every Claude spawn in every scope,
  `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` and `BASH_MAX_TIMEOUT_MS` from
  `claudeBashMaxTimeoutMs(settings.timeoutMs)` — the timeout minus
  `CLAUDE_BASH_TIMEOUT_RESERVE_MS` (5 minutes), floored at
  `CLAUDE_BASH_TIMEOUT_FLOOR_MS` (2 minutes) — and deletes
  `BASH_DEFAULT_TIMEOUT_MS`. Codex environments are unchanged.
  `CLAUDE_REVIEW_ISOLATION` is the contract the workflow's reviewer invocation
  digest covers. Adapter requests consume the exact
  prompt envelope and output-contract bytes already measured by the workflow;
  the existing read-only construction accepts both planning contracts. Their
  environment carries the run identity with empty approval, workflow and
  review-artifact grants; hook and workspace scope checks deny model writes.
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
  variables and redacts secrets from retained output. A `ProcessSpec.stdin`
  string is written to a piped stdin in full at spawn, which is then closed;
  a stdin write or close error is swallowed so the process outcome decides.
  Without it, stdin stays ignored.
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
  Dedicated planning-review result and analysis parsers preserve closed objects,
  safe prose, exact scope echoes and digest-bound finding order. Triage parses
  all dispositions before returning them in review order. The shared
  `validateHumanFreeText` applies the new UTF-8 byte bounds and rejects controls,
  bidi formatting and lone surrogates without changing legacy text contracts.
- `prompt-envelope.ts` — in-memory ordered closed prompt components whose
  concatenation is the exact adapter prompt; it adds no implicit separator and
  persists no component text.
- `output-contract.ts` — one exact vendor-specific serializer for selection,
  phase, code-review and both planning-review schemas, with exhaustive identity
  dispatch. Claude keeps compact sanitized JSON; Codex keeps
  two-space JSON plus one newline, and the same bytes are measured and passed
  to the adapter.
- `context-accounting.ts` — pure exact UTF-8 measurement, closed per-version v1/v2 ledger
  decoding, selector precedence, and observe/enforce budget evaluation. Only
  exact pre-call `runner_payload_bytes` can enforce; post-call metrics remain
  advisory.
- `contracts.ts` — re-exports the plugin's contract JSON and
  `assertContractParity`, which fails with `CONTRACT_VERSION_MISMATCH` or
  `SCHEMA_VERSION_MISMATCH` when bundled schemas disagree with
  `CONTRACT_VERSION`; current review-result v2 and byte-preserved v1 resolve
  through distinct output-contract identities.
  Additive `banzai-planning-review-result/v1` and
  `banzai-planning-review-analysis/v1` retain umbrella `1.0.0` and have separate
  output identities and manifest references.
- `init-resources.ts` — generated local verification guide embedded in the
  standalone CLI. `init-resources-build.mjs` reads canonical
  `documentation/verification-examples.md` and resolves sibling product-guide
  links to the public repository; build generates and check-dist compares.
  CLI init creates the local guide under its initialization lock before prompts,
  using create-only writes and rejecting symlinks or non-regular paths.
- `config.ts` — `.banzai/config.json` location, `DEFAULT_CONFIG` (Claude
  `claude-opus-5-5` for every role, ADR-0059),
  `loadCommittedConfig`, `initializeConfig`, and `applyModelUpdates`, which
  rewrites only requested `model`, `executable`, and `effort` JSON value tokens
  and preserves every unrelated byte. `loadCommittedConfig` reads the
  committed file alone; committed-only readers and the layered reader of
  `local-config.ts` use it, and the effective `loadConfig` lives there.
  `initializeConfig` appends the exact `.banzai/config.local.json` line with
  the run-state entries when `.gitignore` lacks it. The optional context policy defaults to
  `{ mode: "observe", limits: [] }`; selector-specific limits may be observed,
  while enforcement is restricted to exact pre-call runner-payload bytes and
  ships with no universal numerical maximum.
- `models.ts` — hand-maintained catalog: `SELECTABLE_MODELS`, supported-model
  identity, model standings, `modelAdvisories`, `modelCliMinimum` (the first
  CLI release that serves a model newer than the vendor-wide minimum),
  `vendorFor`, `vendorUsage`, and role labels. It is the source of truth for supported identities and for the
  model and effort levels the menus offer. The Codex choices `gpt-6.1-sol`,
  `gpt-6-astra`, `gpt-6.1-terra`, and `gpt-6-sol` offer `low`, `medium`, `high`,
  `xhigh`, `max`, and `ultra` effort; `claude-sonnet-4-6` offers no `xhigh`.
- `model-selection.ts` — `selectModelSettings`; the per-role model and effort
  dialog, filtered to the levels the chosen model accepts. Its implementation
  menu recommends the effective planning executable, model, and effort as one
  choice, including pending planning changes from the same dialog, then reports
  strict builder-session reuse eligibility or the fresh-artifact fallback in
  the before-and-after summary before model updates are written. When `init`
  creates the configuration, its `configCreated` result selects `Use default`
  wording, default markers, and an initial-setup summary. Repeated `init` and
  `banzai model` retain the saved-configuration wording, even when the saved
  values match the defaults. `selectModelDestination` asks where to save,
  with "This machine only" first; `chooseModelSettings` runs the dialog for
  the chosen destination, and `selectModelSettings` remains the committed
  dialog without a local layer. The committed dialog starts from and compares
  with the committed triples, tags them `(committed)` and shows the local
  triple while a local layer exists, copies the pending committed planner
  triple for "Match Planning", and names the roles this machine keeps from
  the local file; its builder-session line uses the effective settings. The
  local dialog starts from each role's effective triple with its source,
  returns only triples that differ, removes an entry for
  "Use shared setting: <triple>" or for the committed triple itself, offers
  "Match Planning" only for a bare `claude` or `codex` planner, and announces
  deletion when no entry remains.
- `local-config.ts` — the ADR-0060 local model layer. `parseLocalModelFile`
  and `parseLocalModelLayer` validate `.banzai/config.local.json`: exactly
  `schemaVersion: 1` and `models`, roles with exactly a bare `claude` or
  `codex` executable, a model matching `MODEL_IDENTIFIER_PATTERN` and a
  committed effort, as a UTF-8 JSON object of at most 64 KiB. Defects are
  `LOCAL_CONFIG_KEY_REFUSED` or `LOCAL_CONFIG_INVALID`; messages name only
  plain-identifier field paths and never echo a value or parser text.
  `createLocalConfigVisibility` asks Git once per command, index first, then
  ignore. `readLocalModelLayer` checks `.banzai/` and the file with `lstat`,
  asks Git only about an existing file, then reads through the contained
  reader; it returns a defect instead of throwing, while a Git failure
  propagates. `readLayeredConfig` returns the committed configuration
  (`loadCommittedConfig`), the local status and the effective configuration,
  null for a defective file; `mergeModelLayer` replaces whole triples and
  records each role's source. `loadEffectiveConfig` and `loadConfig` refuse a
  defect with `LocalConfigError` and serve only reads outside a run.
  `sameModelLayer` is the order-independent comparison value, and
  `localModelDriftLines` builds the escaped
  `<Role>: recorded <triple|shared>, now <triple|shared>` lines or one line
  naming an unusable file; `LOCAL_MODEL_DRIFT_HEADING` and
  `LOCAL_MODEL_DRIFT_ADVICE` hold the fixed text. `ensureLocalConfigExcluded`
  is the writers' exclude step: a path in the index refuses with the tracked
  message even without a file, an ignored path needs nothing, otherwise it
  appends the exact line to the clone's exclude file and refuses a
  `.gitignore` negation that keeps the path visible. `writeLocalModelLayer`
  validates the layer, requires `.banzai/`, refuses a tracked or unignored
  path and any symbolic link, writes the canonical `renderLocalModelFile`
  text through a `wx` mode-`0600` temporary renamed over the target, and
  deletes the file for an empty layer. Nothing here edits `.gitignore`.
- `model-cli.ts` — `banzai model [--local]` and the launch model I/O.
  `parseModelArgs` is the exact grammar; `MODEL_PHASE_VARIABLES` make every
  writer refuse inside a model phase with `CONFIGURATION_MODEL_WRITE_DENIED`.
  `executeModelPicker` runs, in order, that refusal, `ensureLocalConfigExcluded`
  outside the lock, the runner lock without stale reclaim (`RUNNER_LOCKED`
  with model-specific text), the active-run gate, the layered read (a
  defective local file stops before any menu), the destination and one write
  to the chosen file. The gate passes no run or a done or cancelled one; a
  blocked run whose status recommends `banzai retry` and whose model record
  is readable gets the local destination only and `MODEL_RETRY_LINE`; any
  other run refuses with `RUN_IN_PROGRESS` naming `banzai cancel`. `init`
  writes the committed file; `--local` and the exception write the local
  file; otherwise the destination question is asked when a local file exists
  or `.banzai/config.json` is in the Git index. `loadLaunchModels` is the
  launch gateway's one layered read with a fresh Git check, plus the active
  run's run-effective models and drift lines or its invalid record.
  `applyLaunchModelUpdates` writes advisory updates under the lock to each
  role's source file, the local file first, refusing during any active run
  and with `MODEL_CONFIGURATION_CHANGED` when a role's source or model changed
  since the launch showed it.
- `model-status.ts` — human text for `WorkflowRunner.modelStatus`.
  `modelStatusLines` renders `Models:` for a non-terminal run or
  `Current models:` otherwise, with escaped
  `  <Label>: <executable> <model> <effort> (<source>)` lines, the drift block
  of `modelDriftBlock` (shared with the launch header), a single unusable
  local file line, `<heading>: unavailable (<code>)`, or the invalid-record
  lines of `recordInvalidLines`. `humanStatusView` marks retry and recovery
  ineligible with a reason naming the record and recommends `banzai cancel`
  for an invalid record; `requireRecoverable` is the `recover` pre-check on
  that view. `status --json` and agent status never pass through it.
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
  `isPathInIndex` (`git ls-files --error-unmatch --`) and `isPathIgnored`
  (`git check-ignore -q --`) answer by exit status 0 or 1 and raise any other
  result as a Git failure, never as "no". `cloneExcludePath` resolves
  `git rev-parse --git-path info/exclude` against the repository root, so
  linked worktrees share the common directory's file. `appendCloneExcludeLine`
  creates `info/` when missing, refuses a link or non-regular file there with
  `GIT_EXCLUDE_UNSAFE`, opens without following links and appends a missing
  line once.
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
  with a runner-owned completion publication section. Current snapshot v7
  renders as `banzai-feature-review/v8`. Validates exact candidate bytes and publishes only
  the in-memory validation proof. Legacy v1 rendering, canonical fallback,
  independent prose rules and typed content diagnostics remain readable.
- `planning-review-artifact.ts` — deterministic planning-review v1 rendering
  from validated scope/findings and persisted reviewer settings. It shares the
  lossless value renderer and atomic create-only publication primitive without
  changing code-review bytes. Idempotency compares exact bytes.
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
  faithful log. The banner's executable name, model and effort and the live
  line's model and effort pass through `escapeTerminalField`, because they
  may come from a developer's local model file.
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
  style depends on it, rendering Banzai vermilion `#FF5A3C` for the launch title
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
  `escapeTerminalText` escapes terminal controls in printed text;
  `escapeTerminalField` also escapes TAB and LF, so a configuration value
  printed inside a line, such as a model from either model file, cannot move
  the cursor or start a line. Escaping an escaped value changes nothing.
- `types.ts` — all shared types, `CONTRACT_VERSION = "1.0.0"`, phase-result
  schema v4 and state schema v10 with explicit historical readers, independent
  agent-control schema and `9.0.0` contract identities, independent
  `banzai-context-attempt/v2` and `banzai-context-report/v2` identities,
  model-attempt v4 and retained v1-v3 readers under
  `banzai-completion-protocol/v1`, terminal-checkpoint v1-v3, the completion
  capture/transition/candidate/publication record identities, completion
  summary v2, recovery contracts, and the pure role/model/effort
  session-binding matcher and shared attempt file tokens; no runtime imports.
- `errors.ts` — `BanzaiError` (stable `code`, `exitCode`), `ProcessExitError`
  (retains redacted stdout/stderr plus the typed `failureCause` and the usage
  the failed process had already spent, optional inventory, and turn count),
  `errorMessage`. `LocalConfigError` carries a local model file defect
  (`LOCAL_CONFIG_INVALID`, `LOCAL_CONFIG_KEY_REFUSED` or
  `LOCAL_CONFIG_NOT_IGNORED`). `LocalModelOverrideRefusalError` is the run
  guard refusal (`LOCAL_MODEL_OVERRIDE_CHANGED` or
  `LOCAL_MODEL_OVERRIDE_RECORD_INVALID`), which preserves the last durable
  checkpoint and every retry and recovery authority.
  `passesThroughRunCatches` names the errors every catch between a check point
  and a command boundary rethrows unchanged: a terminal transition, the
  project-setup and instruction-resource refusals, and the run guard
  refusals.

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
  marketplace, root version-script wiring, built bundle mode, and required
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
- `smoke-committed.mjs` runs help, control capabilities, init (which must add
  the exact `.banzai/config.local.json` line to `.gitignore` once), no-run
  control status, ready doctor JSON (whose `models` array must sit between
  `projectTypes` and `summary` and match the smoke configuration's committed
  roles), evaluation JSON, context JSON over a historical
  incomplete attempt, and evaluation KPI JSON —
  checkout mode plus a non-repository `--input` round-trip over the captured
  export — repeatedly against the
  locally built bundle in disposable repositories, asserting clean streams, fixed
  schema identities, deterministic bytes, no mutation, and unconditional
  cleanup. Help and capability release versions must match the candidate's
  package mirror; machine-contract identities remain separately pinned.
- `release-check.mjs` composes `build:dist`, `verify`, `format:check`, release validation,
  actual publication checks and
  built-bundle smoke with a vendor-free environment and tracked-tree mutation
  detection. Its default component list excludes version synchronization and
  recovery.
- `build.mjs` regenerates tracked resource modules for explicit `build` calls.
  Its `--distribution-only` mode (`build:dist`) writes only ignored `dist/`
  output for CI, release checks and publication. `check-dist.mjs` still checks
  tracked resources without repair and compares bundle/map bytes with a fresh
  build before CLI smoke.
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
- `gate-1-probe.mjs` is the owner-run Gate 1 probe of ADR-0063 §6 and is not
  part of any check. It bundles `test/probes/gate-1-probe-main.ts` into
  `.dist-check-gate-1-probe/` and runs it against a scratch repository and a
  chosen `claude` executable. The probe runs one implementation phase through
  `createVendorAdapters` and the real `runProcess`, then a resumed invocation,
  classifies stream lines with the pure `test/probes/gate-1-probe.ts`, and
  prints only `banzai-gate-1-probe/v1` counts, exit statuses and a verdict. It
  refuses to start inside Claude Code.

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
payload list; other plugin/documentation resources need classification; the fixed source
work subtree is eligible without per-file entries and excluded from packages; source-map
identities and embedded source bytes are inspected. The release gate runs the
index check without mutating tracked files or refreshing historical exceptions.

The build ships existing persisted readers as generated plugin
`lib/artifact-readers.mjs`, checked byte-for-byte by `build:check`. The hook and
shared review/configuration readers still consume them. Generic artifact
initialization, registration, writing and archive operations are retired. Their
complete historical tool source remains in Git; existing archive bytes and
references are preserved without migration. Doctor's read-only active-state check
admits state v10 and inspects binding v1/v2 runs as read-only history without
repair: terminal ones pass and unfinished ones warn with a `banzai cancel`
remedy. Status skips their review revalidation, reports completion as legacy and
recommends only `banzai cancel`; the interactive home offers only cancellation.

## Runner instruction generation and parity

`phase-resources-build.mjs` owns the seven-phase/ten-guidance/six-policy inventory
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

For every check whose latest attempt did not succeed, the projection adds the
descriptor's argv, cwd and timeout and the attempt's outcome, failure category,
duration and log paths. `verification-outcome.ts` owns the pure outcome labels,
keyed on status, failure category and signal together, and the block-reason
summary, which never carries output. `verification-output.ts` reads at most the
last 64 KiB of each log through contained, no-follow paths and returns 20
redacted, ANSI-stripped, escaped and length-bounded lines; only the CLI and
interactive renderers call it, so `status()` and `status --json` read no logs.
`WorkflowRunner.verificationRetryOutlook()` compares a failed `command_exit`
attempt's descriptor and observed-input digest with the current selection and
capture. The interactive blocked menu alone calls it, to label a retry that is
expected to fail again; any read failure yields no outlook, and the outlook
never gates retry.

At `needs_plan_approval`, `WorkflowRunner.planVerificationInventory(state)`
parses the plan's v2 inventory and merges project policy through
`selectTaskVerification`, the path verification takes, and returns the ordered
checks or the error approval would raise. Only the CLI and interactive
renderers call it; `planVerificationLines` keeps each command on a
detail-indented line that renderers never rewrap.

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
`taskVerificationDigestRole` is the single implementation of that role rule, and
both the acceptance comparison and `authorizeTaskVerification` classify through
`comparableTaskVerificationSources`. A model-authored digest is established when
its artifact is accepted: `workflow.ts` compares each effective supplement
source and records the outcome through `store.ts` as
`banzai-result-digest-evidence/v2`, written once per attempt and never restated.
`validation.ts` also reads v1 records, whose comparisons read as `recorded: false`.
`validatePlanningResult` records the plan remainder with `recorded: true` when it
writes it, which never rejects the result (ADR-0064). A rejection carries the
field, path, declared and observed digests only; the size rejection stays a
separate typed cause. The launch comparison
keeps its authority unchanged and states a causal history only from a recorded
baseline, reporting unknown when none exists.
Observed inputs follow Git ignore rules, so a check can pass only when its
generated output is ignored. A check that changes observed files, whether it
passed or failed, stops the round and names up to ten changed paths with the
ignore remedy; input drift between selection and launch names its paths the
same way. Under ADR-0057, `taskVerificationContinues` lets a round schedule its
next check after a non-zero exit, a start failure, a timeout or the output
limit, reading status, category and signal together because the helper and
the runner record timeouts differently; a signal, a runner failure or a
cancellation stops it. `executeTaskVerification` accepts a `retrySet` that must
equal `unsuccessfulRoundAttempts` for the round, and a lone `retryOf` only
while it names the round's one unsuccessful check, so neither launches anything
before a refusal. The standalone helper maps request v4's `retryOf` array to
that set; v3 keeps its single identity. The entry lists stay
in process memory and the persisted observation format is unchanged.
Ordinary files are streamed within a 128 MiB aggregate budget, without a 16 MiB
per-file cutoff. Protected filenames contribute filesystem identity metadata
only (device, inode, mode, size, modification and change times); their contents
are never read or hashed. These observations support fresh checks in the current
round but disable cross-round reuse even with an opt-in policy. Symlinks,
unreadable files, unstable captures and exhausted budgets remain unavailable.
Successful commands with unavailable snapshots retain their physical success
and receive an explicit snapshot diagnostic; retry creates fresh evidence.
Lite checks derive authority from the user request and persisted workflow
selection, with inherited-local permissions. Optional schema-4 project policy
constrains checks; metadata never grants execution permission.

State 9 uses tracked-document binding 3 and private ledger 3. The runner or standalone helper owns
immutable decision, physical start/finish, origin and applicability records.
Actual launch context, safe source paths and authority are checked before launch
and application. Unknown input captures cannot establish unchanged evidence.
Retries preserve failed identities. Owner recovery records interrupted outcomes
without inventing exit codes and repairs missing origins from retained physical
bytes; terminal success is not re-executed. Equivalent evidence requires complete
policy-declared inputs/toolchain/environment and a direct compatible successful
origin. Changes outside declared explanatory regions and release gates stay
fresh. Helper request v4 (and the retained v3) accepts exact document/workflow
selection, never arbitrary argv; a v4 `retryOf` is the round's exact
unsuccessful attempt set. Inspect/decide allocate nothing; execute keeps metadata under ignored
`.banzai/verification/`. Legacy executable requests are refused.

Review snapshot 7/rendered review 8 freeze task checks, required/supplemental
status, physical evidence, applicability and completion publication. Review-result
2 is unchanged. The independent reviewer checks requirement coverage and
unjustified weakening; a command hash cannot certify semantic adequacy.
Frozen evaluation/KPI/context/archive formats do not reinterpret task evidence
as legacy profile passes: unsupported evidence remains partial, with no exact
completion/KPI claim. Historical archive tooling remains in its original Git revision.
Human-time's bounded state/attempt projection accepts current versions while
keeping its report schema unchanged.

No historical-run migration is introduced. New binding v3 has explicit new
semantics; retained v1/v2 artifacts keep their original identity. `doctor` v5 and control
capabilities v9/status v7 expose task verification without requiring profile
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
  commands, and task verification rounds continue after command-level
  failures (ADR-0057). No configuration write
  runs concurrently with a model, check or waiting interactive owner.
- `verification-ui.ts` edits executable/argv fields and renders pending actions
  before the repair/resume alternative. It performs no project execution and
  no I/O; verification output tails and the plan gate's inventory arrive from
  its callers.
- `plan-gate-ui.ts` renders the plan gate's waiting copy with the bundle paths
  (the terminal names the "Re-check my edits" choice; the CLI names
  `banzai approve plan --decision recheck`) and the escaped re-check summary,
  and lists the refusal codes after which the interactive gate is shown again.
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
ADR-0055 admits the exact ADR-0054 reciprocal lifecycle annotation through a
finite image map guarded by its Accepted status. It also authorizes retained
`#orchestrated` and supervisor skill keys; protected manifest keys remain denied.
