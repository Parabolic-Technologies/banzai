# PROJECT_MANIFEST.md

Current implemented facts for the Banzai plugin source repository and
orchestrator workspace. [AGENTS.md](AGENTS.md), included by `CLAUDE.md`, owns
repository process; accepted ADRs own architectural intent and rationale.
Packaged guidance under `plugins/banzai/` is product source for end-user
projects. Detailed module behavior belongs in the
[module reference](packages/orchestrator/MODULES.md).

## 1. Project Overview

- Banzai provides reusable development skills for Claude Code and Codex and a
  local `banzai` CLI that coordinates planning, implementation, verification
  and independent review with human decisions.
- The plugin and CLI are independently usable and separately delivered. They
  share release-train version `2.7.3`, owned by root `package.json.version`.
- This repository maintains those products. Its root guidance and manifest
  describe the source workspace; packaged templates describe neither its
  process nor its current implementation.
- Project identity is `https://github.com/Parabolic-Technologies/banzai`.
  The owner is Banzai International, Inc. d/b/a Parabolic ("Parabolic"); the
  author is Alexander Torosh. Original material uses Apache-2.0, with scope
  and attribution in `LICENSE`, `NOTICE`, `TERMS_OF_USE.md`, `TRADEMARKS.md`
  and `THIRD_PARTY_NOTICES.md`.

## 2. Platform & Tooling

- Language: TypeScript `^5.9.0` for the orchestrator; builtin-only ESM modules
  and CommonJS hook/helper entry points for the plugin; Markdown guidance and
  JSON Schema contracts. No application framework is installed.
- Runtime: Node.js `>=22.20.0 <23 || >=24.11.1 <25` on macOS or Linux.
  [release-policy.json](release-policy.json) pins required Node `22.20.0` and
  `24.11.1` lanes and advisory Node `26.7.0`. esbuild targets `node22`, ESM and
  the Node platform.
- Package manager: npm workspaces, `workspaces: ["packages/*"]`, with root
  `package-lock.json` at `lockfileVersion: 3`.
- `npm run build` regenerates tracked `src/init-resources.ts`,
  `src/phase-resources.ts` and `plugins/banzai/lib/artifact-readers.mjs`, then
  builds the CLI. The `src/` paths are relative to `packages/orchestrator/`.
- `npm run build:dist` builds only ignored
  `packages/orchestrator/dist/banzai.mjs` and its source map. The executable has
  a Node shebang and mode `0755`; a fresh checkout needs this build before
  running the local CLI, standalone verification or bundle-dependent tests.
- `npm run build:check` compares generated sources without repair, rebuilds
  into temporary storage, checks distribution byte parity and smoke-runs the
  local executable. It removes temporary output on success and failure.
- `npm run typecheck` runs `tsc --project tsconfig.json --noEmit` in the
  orchestrator workspace.
- `npm run test` bundles TypeScript tests with esbuild, runs `node --test`
  with `max(2, os.availableParallelism() - 1)` file concurrency and removes
  `.test-dist/`. The driver
  `node packages/orchestrator/scripts/test.mjs --file <relative.test.ts>`
  selects exact test-root files; `--file` is repeatable and `--pattern <regex>`
  filters test names.
- `npm run lint` and `npm run lint:fix` run ESLint with the deterministic
  `packages/orchestrator/scripts/eslint-formatter.mjs` formatter.
- `npm run format:check` and `npm run format` run Prettier in
  `packages/orchestrator/`. Formatting is a final-review step; the package
  scripts do not check root documentation or plugin Markdown.
- `npm run verify` runs typecheck, lint, tests and `build:check` in that order.
- `npm run release:check` builds the distribution, runs `verify`, formatter,
  release validation, publication checks and disposable bundle smoke, and
  rejects tracked-byte or mode mutation. The release procedure is
  [documentation/release-checklist.md](documentation/release-checklist.md).
- `node packages/orchestrator/scripts/release-candidate-check.mjs` runs the
  release gate in a disposable copy of tracked and untracked non-ignored
  files, with installed dependencies linked read-only and a separate index.
- `npm run version:set -- <version>` synchronizes nine fields across seven
  files to a human-selected version. `npm run version:recover` restores
  authenticated transaction originals; retained transaction evidence blocks
  release validation.
- `npm run banzai` runs the local bundle. `npm run install:orchestrator`
  builds and links `@parabolic-technologies/banzai` for local CLI use.
- [.github/workflows/ci.yml](.github/workflows/ci.yml) runs the complete
  release gate on both supported Node lanes for pull requests and manual
  dispatch. The advisory forward lane runs on weekly schedule or dispatch;
  the live lane additionally requires explicit protected-runner authorization.
  Branch pushes alone start no workflow.
- [.github/workflows/publish.yml](.github/workflows/publish.yml) handles
  published stable GitHub Releases. It reuses tree-bound evidence from both
  required PR lanes when valid, otherwise runs both lanes on the release tag.
  The publishing job builds its own bundle and uses npm trusted publishing
  for the CLI workspace. Plugin installation and registry availability have
  separate delivery evidence in
  [documentation/releases/public-publication.md](documentation/releases/public-publication.md).

## 3. Architecture

- `plugins/banzai/` owns the standalone skills, policies, shared guidance,
  schemas, hook and project templates. `packages/orchestrator/` owns the
  local CLI; neither component installs or starts the other implicitly.
- `cli.ts` composes command entry points and `interactive.ts`; workflow
  mutations delegate to `workflow.ts` (`WorkflowRunner`). The runner uses
  vendor adapters, persistence, Git, validation and instruction owners;
  `adapters.ts` delegates child execution to `process.ts`.
- [import-boundaries.mjs](packages/orchestrator/import-boundaries.mjs)
  explicitly classifies every production TypeScript module and its runtime
  and additional type-only dependencies. ESLint rejects missing or stale
  entries, forbidden imports, alternate local loaders and inline overrides.
  Imports do not generate or broaden this policy.
- `src/workflow/` contains pure domain rules, a frozen collaborator context,
  per-instance mutable-state owners and capability slices. The runner retains
  phase executors, continuation, attempt reconciliation, result application
  and status projections.
- Domain modules are `state-machine.ts`, `workflow/ports.ts` and
  `workflow/domain/*.ts`. They depend at runtime only on other domain modules
  and `errors`, with additional type-only access to `types`. Lint excludes
  effectful built-ins, ambient clocks/randomness and restricted globals;
  `createHash` is the permitted crypto import.
- Workflow slice dependencies and the production module graph are acyclic.
  Slices never import `workflow.ts`; context collaborators and mutable-state
  operations keep ownership explicit. The exact permitted edges live in the
  import policy.
- Adoption inspection is a shared filesystem-only boundary used by CLI,
  doctor and workflow. Foreground setup and terminal ownership are composed
  only by the CLI. Diagnostic/report collectors retain their own read-only
  boundaries; context reporting imports no workflow, adapters, store or
  evaluation collector.
- Model phases invoke local `codex exec` or `claude -p` child processes using
  subscription authentication. There is no direct vendor API or API-key
  path. Vendor processes and verification commands have bounded lifetimes
  and process-group cleanup; verification commands run sequentially.
- External JSON is decoded at ingress. Schemas are embedded through
  `contracts.ts`; runtime validators enforce invariants beyond JSON Schema.
  `BanzaiError` supplies stable codes, and failed processes retain redacted
  diagnostics and spent usage without manufacturing successful evidence.

## 4. Project Structure

- Topology: npm-workspaces monorepo with one workspace,
  `@parabolic-technologies/banzai` at `packages/orchestrator/`; plugin files
  live outside that workspace.
- Root `AGENTS.md`, `CLAUDE.md`, `PROJECT_MANIFEST.md`, `README.md` and
  `CONTRIBUTING.md` provide repository guidance and product entry points.
  `documentation/` owns maintained guides, decision records, evaluation
  methods, release records and work documents.
- `packages/orchestrator/` contains `src/`, `test/`, `scripts/`, package and
  tool configuration, `MODULES.md`, and ignored generated `dist/`.
- `plugins/banzai/` contains `skills/`, `phases/`, `guidance/`, `policies/`,
  `contracts/`, `hooks/`, `lib/`, `scripts/`, client manifests and bootstrap
  templates. Its `.claude/settings.json` is packaged project configuration.
- `.claude-plugin/marketplace.json` is the versionless Claude marketplace;
  `marketplace.json` and `.agents/plugins/marketplace.json` are versioned
  Codex marketplace descriptors. `.github/workflows/` owns CI and publication.
- New human work documents share one flat Git-visible
  `documentation/work/<slug>/` directory. Existing private documents keep
  their known paths. No layout declaration, registration or authoring claim
  is required; see [Work Documents](documentation/artifact-storage.md).
- `.banzai/` holds ignored local configuration, historical work, runner
  records, verification evidence and execution locks. The legacy
  `documentation/features/`, `documentation/development-plans/` and
  `documentation/changes/` trees remain ignored. Local settings and credentials
  are excluded by [.gitignore](.gitignore).
- [publication-policy.json](publication-policy.json) selects `clean` mode.
  Source work documents are eligible for Git review and excluded from
  plugin/npm payloads; private execution evidence is excluded from public
  source and distributions. See the
  [Publication Boundary](documentation/publication-boundary.md).
- `assets/logo/` owns coordinated SVG and PNG brand assets.
  `.serena/project.yml` configures optional local TypeScript tooling.

## 5. Key Modules & Components

Paths in the following orchestrator bullets are relative to
`packages/orchestrator/src/`. The
[module reference](packages/orchestrator/MODULES.md) carries per-module
behavior and edge cases; source and tests own the executable evidence.

- `cli.ts`, `cli-routing.ts`, `version-cli.ts` — command composition, TTY
  routing and version inventory; standalone version/help paths do not require
  a configured run.
- `agent-control-cli.ts`, `agent-control.ts` — capability/status projections
  and closed stdin requests, including `control decide`; mutations validate
  before delegating to `WorkflowRunner` and return current status.
- `interactive.ts`, `inquirer-io.ts` — state-driven human decisions through
  `InteractiveIO`; only `inquirer-io.ts` imports `@inquirer/*`.
- `progress.ts`, `interrupt.ts`, `terminal-attention.ts`, `vocabulary.ts`,
  `ansi.ts`, `format.ts` — terminal presentation and bounded interruption;
  human rendering never becomes machine authority.
- `workflow.ts` — `WorkflowRunner` public lifecycle, decisions, planning
  review and phase orchestration; approved scope and retained evidence control
  every continuation.
- `workflow/context.ts`, `workflow/ports.ts` and the activity, cancellation,
  configuration-ownership and invocation-scope-cache modules — immutable
  collaborators plus owned per-runner state; capability code receives the
  context, never the facade.
- `workflow/domain/`, `state-machine.ts` — pure routing, eligibility,
  planning-review and state-transition rules; facts are gathered by effectful
  callers without widening reads or changing failure scope.
- `workflow/attempts/`, `workflow/checkpoints/`, `workflow/digest-evidence/`
  — physical attempt lifecycle, terminal proof and acceptance-time digest
  evidence; durable records preserve failed and interrupted attempts.
- `workflow/completion/`, `plan-task-completion.ts` — task claims, completion
  capture, deterministic projection, publication and revalidation; approved
  plan bytes and all report bytes outside the owned region remain protected.
- `workflow/verification/`, `workflow/preflight/`,
  `workflow/review/result-application.ts` — verification rounds, authority
  checks and result application validation; missing mandatory evidence blocks
  completion.
- `store.ts` — `RunStore` atomic state, append-only events, attempt records and
  exclusive run ownership; stale ownership is never reclaimed by elapsed time.
- `work-documents.ts`, `project-files.ts`, `project-adoption.ts` — typed
  projections of shared document binding, contained filesystem and adoption
  owners; historical readers grant no new execution authority.
- `adapters.ts`, `process.ts`, `mcp.ts`, `claude-permissions.ts` — vendor argv,
  auth, child lifetime, redaction and scoped tool access; unavailable optional
  Serena is advisory, while required permission failures stop execution.
- `project-setup.ts`, `setup-client.ts`, `foreground-client.ts` — explicit
  interactive `project-manifest` entry, client discovery and terminal cleanup;
  setup refuses unfinished runs and creates no task or approval.
- `config.ts`, `models.ts`, `model-selection.ts` — configuration loading,
  `DEFAULT_TASK_CONFIG`, source-maintained model metadata and role selection;
  model updates preserve unrelated configuration bytes.
- `verification-evidence.ts`, `verification.ts` — shared task evidence facade,
  inert project discovery and legacy diagnostics; discovered commands confer
  no execution permission.
- `configuration-prerequisite.ts`, `verification-config.ts`,
  `configuration-review.ts`, `verification-cli.ts`, `verification-ui.ts` —
  retained legacy configuration utilities and current verification display;
  legacy profile operations do not gate new tasks.
- `validation.ts`, `contracts.ts`, `types.ts`, `errors.ts` — runtime decoding,
  schema parity, shared types and stable failures; `types.ts` has no runtime
  imports.
- `prompts.ts`, `phase-instructions.ts`, `prompt-envelope.ts`,
  `output-contract.ts` — ordered instruction and schema delivery; the measured
  prompt bytes are the bytes supplied to the vendor adapter.
- `init-resources.ts`, `phase-resources.ts`, `persisted-readers.ts` — generated
  guidance/resources and the shared-reader facade; builds resolve reader
  source, and checks detect stale generated bytes without repair.
- `planning-review-state.ts`, `planning-review-artifact.ts` — bounded planning
  episodes and deterministic sibling review publication; stale scope cannot
  authorize planning changes.
- `review-snapshot.ts`, `review-artifact.ts` — frozen review inputs and
  deterministic `banzai-feature-review/v8` publication from snapshot v7;
  reviewers return structured results and the runner publishes validated bytes.
- `doctor-cli.ts`, `doctor.ts` — `banzai-doctor/v5` local readiness diagnostics;
  no configured commands, authentication, model calls or repair occur.
- `evaluation*.ts`, `evaluation-kpi*.ts` — privacy-minimized export and pure
  derived KPIs; frozen contracts retain explicit incomplete coverage.
- `context-accounting.ts`, `context-report*.ts` — exact runner-byte accounting
  and independent context reports; only pre-call `runner_payload_bytes` can
  enforce a budget.
- `cancellation*.ts`, `human-time*.ts`, `interactive-human-time.ts` —
  cancellation provenance, independent reports and private timing; elapsed
  gate time and estimates never become measured person-time totals.
- `git.ts` — repository baseline, approval bundles and workspace identities;
  staged, unstaged, untracked and selected-document evidence remain distinct.
- `live-compatibility*.ts` — explicitly authorized disposable vendor probes;
  closed summaries and cleanup isolate auth material and raw output.

Plugin and release owners:

- `plugins/banzai/skills/` — eleven standalone skills;
  `project-manifest` and `orchestrate` require explicit invocation in both
  clients. Other skills restrict automatic selection to adopted repositories
  or explicit Banzai/skill requests.
- `plugins/banzai/AGENTS.md`, `CLAUDE.md` and bootstrap templates — installed
  process, including the five existing decision gates; project-specific merges
  preserve approved user rules.
- `plugins/banzai/phases/`, `guidance/`, `policies/` — seven runner phase
  resources, ten shared guidance files and six policy owners; standalone
  skills load installed sources, and runners deliver applicable bodies inline.
- `plugins/banzai/lib/`, `scripts/verification.cjs` — shared work-document,
  filesystem, execution-ownership, adoption, review and verification contracts;
  ordinary document authoring allocates no execution records.
- `plugins/banzai/hooks/spec-gate.cjs`, `hooks/hooks.json` — host file-tool
  authorization; runner context fails closed and source-read-only reviewers
  receive no write grant. The hook is not a general shell sandbox.
- `packages/orchestrator/scripts/` — build, test, release/version,
  instruction-baseline and publication tools; explicit generation is separate
  from validation. See [Release scripts](packages/orchestrator/MODULES.md#release-scripts-scripts).

## 6. State & Data Flow

- `banzai init` writes config schema 4 with model settings and optional task
  verification policy. Defaults use Claude `claude-opus-5-5` for planning and
  implementation and Codex `gpt-6.1-sol` for review, all at `xhigh`; context
  defaults to `observe` with no limits and `maxFixCycles` is `3`.
- New runs use state schema 10, document binding v3 and workspace snapshot v3.
  One checkout has one active run; state is atomically replaced, events are
  appended and raw evidence remains under `.banzai/runs/<run-id>/`.
- Guidance is inspected before run creation/authentication and again under
  ownership. Continuations check instruction layout before model attempts;
  refusal preserves the last checkpoint, saved decision and retry/recovery
  authority.
- Every fresh, resumed, retry and recovery phase receives current bound
  phase/guidance/policy instructions. Workflow selection is prompt-only;
  explicit artifact roles and phase write sets constrain subsequent work.
- Workflow selection routes to `quick-fix`, `feature` or `strict`. Lite routes
  execute their scoped work and verification; strict work proceeds through
  planning, approval, implementation, verification and independent review.
- Human decisions use five existing workflow gates: conditional planning-only
  consultation, ADR approval, plan approval, escalation and review triage.
  Planning gates support feedback-based rework and explicitly requested
  read-only planning review with separate human triage.
- Approval digests bind exact requirements, accepted ADRs and plan bytes.
  Workflow digests bind lite selection; workspace identities detect drift.
  Plan checkboxes stay immutable in orchestrated work; operator recovery needs
  an exact current identity and explicit acknowledgment of possible side effects.
- Matching planner/implementer settings share builder lineage. Code review
  has a separate source-read-only lineage, fresh/full primary review and at
  most two consecutive resumed delta reviews; compatibility, approval and
  typed failure rules determine rotation.
- A passing review completes strict work. Human triage accepting zero findings
  can also complete it while retaining a `changes_requested` verdict. Accepted
  findings alone enter fixes, verification and bounded re-review.
- Strict plans supply approved task obligations v2; phase-result v4 can supply
  additional candidates. Direct executable/argv checks run under task and
  local permission authority. Immutable physical attempts and applicability
  records distinguish passed, failed, interrupted, unavailable and reused
  evidence; release checks require fresh execution.
- Strict completion uses `banzai-completion-protocol/v1`: the model returns
  claims and narrative, and the runner validates terminal proof, captures
  inputs, publishes the delimited completion region and receipt, then applies
  the result. Missing, contradictory or drifted evidence fails closed.
- Evaluation, KPI, context and cancellation reports read bounded evidence and
  preserve missing/invalid coverage. Human-time records stay private; reports
  do not expose prompts, credentials, raw transcripts or command content.
- Historical run formats remain readable evidence without migration or new
  continuation authority. Standalone continuation of explicitly selected
  historical work documents retains their existing paths.

## 7. Dependencies

- Runtime npm dependencies are `@inquirer/prompts` `^8.5.2` and
  `@inquirer/core` `^11.2.1`, isolated behind `InteractiveIO`.
- Workspace dev dependencies are `typescript` `^5.9.0`, `esbuild` `^0.25.0`,
  `@types/node` `^24.0.0`, `eslint` `^10.8.0`, `@eslint/js` `^10.0.1`,
  `typescript-eslint` `^8.65.0`, `globals` `^17.8.0`, `prettier` `^3.9.6` and
  `eslint-config-prettier` `^10.1.8`. The root declares no dependencies.
- External runtime tools are Git and the configured local vendor clients.
  Vendor-wide minimums are Codex `0.145.0` and Claude Code `2.1.218`; default
  models require Codex `0.159.1` and Claude Code `2.1.280`. Model-specific
  minimums are maintained in `packages/orchestrator/src/models.ts`.
- PTY tests require `python3` with its standard library on macOS/Linux.
  Python is a test prerequisite; the CLI runtime uses Node.
- New runtime or development dependencies require explicit user approval and
  a manifest update. Optional Serena is discovered locally and is not
  installed by npm.

## 8. Testing

- The Node built-in test runner and `node:assert/strict` execute bundled
  TypeScript tests under `packages/orchestrator/test/`. File names normally
  mirror source modules; shared fixtures and cross-module contract suites are
  explicit exceptions.
- Assurance priorities are public/persisted contracts, authorization,
  security/privacy, state transitions, recovery, instruction parity,
  publication boundaries and confirmed regressions. Test volume is not a
  completion target.
- Boundary fakes and injected `ProcessRunner`, clock and identifier sources
  preserve production contracts while isolating vendor/process behavior.
  Workflow tests use real temporary Git repositories; mocks of the unit under
  test and assertions that merely mirror private implementation are unsuitable.
- Required final suite: `npm run verify`, with all tests passing, clean
  typecheck, zero lint errors and distribution parity. Advisory lint warnings
  remain visible. Release work additionally requires fresh `npm run release:check`.
- Coverage threshold: `None`; no numeric coverage threshold or coverage gate
  is configured in the repository's test runner or CI.
- Final-suite ownership: orchestrated builders run affected checks; the runner
  executes supplied task checks. An applicable final suite omitted from those
  checks is run once by the builder and recorded as a verification gap.
  Standalone work owns its final applicable suite unless the enabled shared
  engine proves eligible equivalent evidence.
- `test/setup-pty.test.ts` and `test/pty-driver.py` exercise terminal lifecycle
  through the built CLI. Missing Python fails the suite rather than skipping
  those journeys.
- Deterministic release checks own local/CI evidence. Actual vendor delivery,
  hook and permission behavior require separately authorized live evidence;
  fixtures and local builds do not establish those outcomes. Per-change
  results belong in the selected work's reports.

## 9. Conventions

- Repository documents and UI/CLI copy are English. Markdown prose wraps at
  80 columns, with tables and link-heavy lines exempt.
- Files, directories, work slugs and skills use `kebab-case`; functions and
  variables use `camelCase`; types/classes use `PascalCase`; constants and
  error codes use `SCREAMING_SNAKE_CASE`. ADR paths use
  `documentation/decisions/NNNN-<short-kebab-case-title>.md`.
- TypeScript uses `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax` and NodeNext module
  resolution. Relative imports use `.js` and type-only imports are explicit.
- Prettier config sets `trailingComma: "none"` and `proseWrap: "preserve"`.
  ESLint uses `strictTypeChecked`, `stylisticTypeChecked` and the explicit
  import policy; production source disables inline lint configuration.
- ESLint `complexity` above `15` and `no-nested-ternary` are advisory warnings
  across production code, tests and linted ESM tools. Warning severity keeps
  diagnostics visible without failing the command.
- Human progress goes to stderr; stdout carries command results and JSON.
  Retained process output is redacted before persistence.
- Skills use `name`, `description` and `user-invocable` frontmatter.
  Explicit-only skills also use Claude's `disable-model-invocation: true` and
  Codex's `policy.allow_implicit_invocation: false`.
- Commits use `<type>(<slug-or-name>): <summary>` with `feat`, `fix`, `test`,
  `docs` or `chore`, and require an explicit engineer request.
- The root version is the sole release authority; all eight mirrors must
  match. Source version, installed client/plugin versions and publication
  evidence are distinct. Rebuild ignored `dist/` after source changes.
- `.serena/project.yml` selects TypeScript, ignores `assets/**` and disables
  memory/onboarding tools; durable project guidance belongs in repository docs.

## 10. Technical Constraints & Decision Index

- The umbrella contract is `1.0.0`; phase-result v4 is current and
  review-result v2 is current. `types.ts` declares phase-result schema v4 and
  state schema v10 with explicit historical readers. Startup rejects schema
  or umbrella mismatch; phase-result v1/v2/v3 remain byte-preserved legacy
  reader surfaces.
- Agent control uses control contract version `8.0.0`, capabilities v8 and
  status v6. Planning decisions use `banzai-agent-gate-decision/v1` and
  planning triage uses `banzai-agent-answer/v4`; consultation, escalation and
  recovery retain their declared contracts. Closed direct-stdin JSON is
  limited to 64 KiB and validated before mutation.
- Reporting contracts are independent: evaluation export and KPI default to
  v1 with explicit v2 support, context attempt/report use v2, cancellation
  report uses v1 and doctor uses v5. New run-state fields do not change frozen
  report semantics or privacy boundaries.
- Source schema, phase/guidance/policy and release-policy changes require a
  rebuild before local CLI execution. Explicit build owns generated sources;
  validation detects drift without repairing tracked files.
- Vendor authentication is subscription-only. Child environments strip API
  keys and preserve Claude's explicit subscription-token path. Inherited host
  sandbox restrictions remain effective; readiness cannot prove hidden
  credentials or widen permissions.
- Claude execution scopes MCP access and, when a verified plugin directory
  resolves, project settings plus that plugin. Deny/ask rules override hook
  write grants; shell permission is separate. Code reviewers have no write
  tools. The CLI never silently writes permission rules.
- Runner operations do not switch branches, create worktrees, stash, reset or
  commit. Start-time changes are recorded as baseline evidence. Explicit
  restore uses digest-verified approved bytes; recovery preserves failed
  attempt history and never proves an old attempt complete.
- Environment inputs include `BANZAI_PROGRESS`, `BANZAI_ATTENTION`, colour
  controls and client home/auth configuration. `BANZAI_RUN_ID`,
  `BANZAI_APPROVAL_DIGEST` and `BANZAI_WORKFLOW_DIGEST` carry runner-owned
  authorization, not project-authored permission. Exact CLI/configuration
  behavior is maintained in [the CLI reference](documentation/orchestrator.md).
- Engineering Quality's incremental findings remain shadow-only and cannot
  enter triage, fixer scope or completion gates. Structural assessment duties
  are active through installed policy/guidance; the broader staged tooling
  and capability-area architecture remain incomplete accepted targets.
- Existing adapter JSON coercions retain a scoped
  `@typescript-eslint/no-base-to-string` warning exception in
  `eslint.config.mjs`; changing that ingress behavior requires its own scoped
  change.

The table indexes active accepted ADRs. `Planned` can include implemented
source whose complete decision scope or required confirmation is outstanding.
The [decision log](documentation/decisions/README.md) retains superseded and
rejected records; [historical references](documentation/historical-references.md)
locate earlier work evidence. Implementation state does not certify hosted
delivery or installation.

| ID       | Title                                                              | Path                                                                                             | State       |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------- |
| ADR-0001 | Automatic workflow selection                                       | [Source](documentation/decisions/0001-automatic-workflow-selection.md)                           | Implemented |
| ADR-0002 | Session affinity and bounded reviewer continuity                   | [Source](documentation/decisions/0002-session-affinity-and-bounded-reviewer-continuity.md)       | Implemented |
| ADR-0003 | Versioned evaluation export contract                               | [Source](documentation/decisions/0003-versioned-evaluation-export-contract.md)                   | Implemented |
| ADR-0004 | Privacy-minimized read-only evaluation boundary                    | [Source](documentation/decisions/0004-privacy-minimized-read-only-evaluation-boundary.md)        | Implemented |
| ADR-0005 | Traceable evaluation aggregation                                   | [Source](documentation/decisions/0005-traceable-evaluation-aggregation.md)                       | Implemented |
| ADR-0006 | Versioned verification profiles                                    | [Source](documentation/decisions/0006-versioned-verification-profiles.md)                        | Implemented |
| ADR-0007 | Project-type verification readiness                                | [Source](documentation/decisions/0007-project-type-verification-readiness.md)                    | Implemented |
| ADR-0008 | Read-only doctor diagnostics                                       | [Source](documentation/decisions/0008-read-only-doctor-diagnostics.md)                           | Implemented |
| ADR-0009 | Supported Node release matrix                                      | [Source](documentation/decisions/0009-supported-node-release-matrix.md)                          | Implemented |
| ADR-0010 | Blocking and advisory release evidence                             | [Source](documentation/decisions/0010-blocking-and-advisory-release-evidence.md)                 | Implemented |
| ADR-0011 | Protected live vendor compatibility                                | [Source](documentation/decisions/0011-protected-live-vendor-compatibility.md)                    | Implemented |
| ADR-0013 | Risk-driven test assurance                                         | [Source](documentation/decisions/0013-risk-driven-test-assurance.md)                             | Implemented |
| ADR-0014 | Human-triaged review closure                                       | [Source](documentation/decisions/0014-human-triaged-review-closure.md)                           | Implemented |
| ADR-0015 | Durable verification attempt ledger                                | [Source](documentation/decisions/0015-durable-verification-attempt-ledger.md)                    | Implemented |
| ADR-0017 | Versioned plan task completion ledger                              | [Source](documentation/decisions/0017-versioned-plan-task-completion-ledger.md)                  | Implemented |
| ADR-0018 | Agent-supervised Banzai CLI control                                | [Source](documentation/decisions/0018-agent-supervised-banzai-cli-control.md)                    | Implemented |
| ADR-0019 | Attempt-owned review candidates                                    | [Source](documentation/decisions/0019-attempt-owned-review-candidates.md)                        | Implemented |
| ADR-0020 | Scoped Claude subprocess environment                               | [Source](documentation/decisions/0020-scoped-claude-subprocess-environment.md)                   | Implemented |
| ADR-0021 | Failure-classified reviewer continuity                             | [Source](documentation/decisions/0021-failure-classified-reviewer-continuity.md)                 | Implemented |
| ADR-0022 | Availability-gated Serena MCP whitelist                            | [Source](documentation/decisions/0022-availability-gated-serena-mcp-whitelist.md)                | Implemented |
| ADR-0023 | Durable terminal attempt checkpoints                               | [Source](documentation/decisions/0023-durable-terminal-attempt-checkpoints.md)                   | Implemented |
| ADR-0024 | Operator-authorized prerequisite-blocked fix recovery              | [Source](documentation/decisions/0024-operator-authorized-prerequisite-blocked-fix-recovery.md)  | Implemented |
| ADR-0025 | Fix-authored completion ledger refresh                             | [Source](documentation/decisions/0025-fix-authored-completion-ledger-refresh.md)                 | Implemented |
| ADR-0026 | Derived evaluation KPI projection contract                         | [Source](documentation/decisions/0026-derived-evaluation-kpi-projection-contract.md)             | Implemented |
| ADR-0027 | Exposure-driven security assurance                                 | [Source](documentation/decisions/0027-exposure-driven-security-assurance.md)                     | Implemented |
| ADR-0028 | Phase context accounting and budget policy                         | [Source](documentation/decisions/0028-phase-context-accounting-and-budget-policy.md)             | Implemented |
| ADR-0029 | ESLint-backed orchestrator import boundary policy                  | [Source](documentation/decisions/0029-eslint-backed-orchestrator-import-boundary-policy.md)      | Implemented |
| ADR-0030 | Vendor-neutral Engineering Quality policy                          | [Source](documentation/decisions/0030-vendor-neutral-engineering-quality-policy.md)              | Implemented |
| ADR-0031 | Interactive decision consultation                                  | [Source](documentation/decisions/0031-interactive-decision-consultation.md)                      | Implemented |
| ADR-0033 | Root package version authority                                     | [Source](documentation/decisions/0033-root-package-version-authority.md)                         | Implemented |
| ADR-0034 | Durable human-time observations                                    | [Source](documentation/decisions/0034-durable-human-time-observations.md)                        | Implemented |
| ADR-0035 | Cancellation observations and report                               | [Source](documentation/decisions/0035-cancellation-observations-and-report.md)                   | Implemented |
| ADR-0036 | Vendor-neutral policy files and instruction delivery               | [Source](documentation/decisions/0036-vendor-neutral-policy-files-and-instruction-delivery.md)   | Implemented |
| ADR-0037 | Unified runner-rendered review artifacts                           | [Source](documentation/decisions/0037-unified-runner-rendered-review-artifacts.md)               | Implemented |
| ADR-0038 | Explicit plan authority                                            | [Source](documentation/decisions/0038-explicit-plan-authority.md)                                | Implemented |
| ADR-0039 | npm trusted publishing on GitHub Release                           | [Source](documentation/decisions/0039-npm-trusted-publishing-on-github-release.md)               | Implemented |
| ADR-0040 | Project adoption preflight and interactive setup                   | [Source](documentation/decisions/0040-project-adoption-preflight-and-interactive-setup.md)       | Planned     |
| ADR-0041 | Artifact retention and publication boundary                        | [Source](documentation/decisions/0041-artifact-retention-and-publication-boundary.md)            | Planned     |
| ADR-0042 | Runner-delivered phase instructions                                | [Source](documentation/decisions/0042-runner-delivered-phase-instructions.md)                    | Planned     |
| ADR-0043 | Proportionate verification evidence                                | [Source](documentation/decisions/0043-proportionate-verification-evidence.md)                    | Implemented |
| ADR-0044 | Instruction baseline evolution                                     | [Source](documentation/decisions/0044-instruction-baseline-evolution.md)                         | Implemented |
| ADR-0045 | Guided verification setup and configuration prerequisite authority | [Source](documentation/decisions/0045-guided-verification-setup.md)                              | Implemented |
| ADR-0046 | Supervised live end-to-end first task                              | [Source](documentation/decisions/0046-supervised-live-e2e.md)                                    | Planned     |
| ADR-0047 | Runner-owned completion projection                                 | [Source](documentation/decisions/0047-runner-owned-completion-projection.md)                     | Implemented |
| ADR-0048 | Completion markup and viewer enrichment boundary                   | [Source](documentation/decisions/0048-completion-markup-and-viewer-enrichment-boundary.md)       | Implemented |
| ADR-0049 | Task-scoped verification authority                                 | [Source](documentation/decisions/0049-task-scoped-verification.md)                               | Implemented |
| ADR-0050 | Triggered code-design assessment                                   | [Source](documentation/decisions/0050-triggered-code-design-assessment.md)                       | Planned     |
| ADR-0051 | Acceptance-time validation of model-authored digests               | [Source](documentation/decisions/0051-acceptance-time-digest-validation.md)                      | Implemented |
| ADR-0052 | Capability-slice architecture and WorkflowRunner decomposition     | [Source](documentation/decisions/0052-orchestrator-capability-slice-architecture.md)             | Planned     |
| ADR-0053 | Single pull-request CI gate and publish-time evidence reuse        | [Source](documentation/decisions/0053-single-pull-request-ci-gate-and-publish-evidence-reuse.md) | Implemented |
| ADR-0054 | Git-visible work artifacts                                         | [Source](documentation/decisions/0054-git-visible-work-artifacts.md)                             | Implemented |
| ADR-0055 | Planning gate rework and independent planning review               | [Source](documentation/decisions/0055-planning-gate-rework-and-independent-planning-review.md)   | Implemented |
| ADR-0056 | CI-built orchestrator distribution                                 | [Source](documentation/decisions/0056-ci-built-orchestrator-distribution.md)                     | Implemented |
