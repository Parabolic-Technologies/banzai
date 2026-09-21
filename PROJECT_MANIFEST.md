# PROJECT_MANIFEST.md

Source of truth for current implemented project facts. Other skills must read
this file before code or test changes.

`AGENTS.md` (included by root `CLAUDE.md`) wins on process for this repository.
Accepted ADRs own architectural intent and rationale. If this manifest differs
from accepted ADR intent, record the current/target difference and reconcile it
through an approved plan.

Scope note: this file describes **this repository**, the source of the Banzai
plugin. The copies of `AGENTS.md`, `CLAUDE.md`, and `PROJECT_MANIFEST.md` under
`plugins/` are packaged templates for end-user projects; `policies/` carries
installed policy source. These files describe nothing here.

## 1. Project Overview

- Purpose: source repository for Banzai spec-driven development, shipped under
  one root-owned release-train version as two independently usable and
  separately deliverable parts — a plugin of workflow skills for Claude Code
  and Codex, and a local orchestrator CLI (`banzai`) that delivers phase instructions
  across a planner, an implementer, and an independent reviewer.
- Primary users: engineers who install the plugin in Claude Code and Codex and
  run the `banzai` CLI inside their own repositories. Work in this repository
  maintains the plugin and the orchestrator; it is not an end-user project
  configured by them.
- Public project identity: `https://github.com/Parabolic-Technologies/banzai`.
  Product owner: Banzai International, Inc. d/b/a Parabolic, Inc. ("Parabolic").
  Author: Alexander Torosh (`https://github.com/alexander-torosh`,
  `alexander@parabolic.io`). Original project material uses Apache-2.0; root
  `LICENSE`, `NOTICE`, `TERMS_OF_USE.md`, `TRADEMARKS.md`, and
  `THIRD_PARTY_NOTICES.md` define the documented licensing scope and attribution.
- Load-bearing constraint: the orchestrator invokes the locally installed
  `codex` and `claude` executables under individual-subscription
  authentication. It never calls a vendor API and never accepts an API key, so
  model capabilities, model currency, and reasoning levels are hand-maintained
  source facts rather than discovered at run time.

## 2. Platform & Tooling

- **Language:** TypeScript `^5.9.0` for the orchestrator; CommonJS entry points for the plugin hook and artifact helper, with shared
  builtin-only ESM storage, archive, adoption and verification modules under `plugins/banzai/lib/`. Skills and
  artifacts are Markdown; machine contracts are JSON Schema.
- **Runtime / target:** Node.js `>=22.20.0 <23 || >=24.11.1 <25`
  (`engines.node` in both package manifests and both lockfile mirrors);
  supported release lanes are exact Node 22.20.0 and 24.11.1, with exact Node
  26.7.0 as advisory forward-compatibility evidence. esbuild remains
  `target: "node22"`, `format: "esm"`, `platform: "node"`. Supported hosts:
  macOS or Linux.
- **Frameworks:** None. Runtime dependencies are `@inquirer/prompts` for the
  standard interactive terminal UI and `@inquirer/core` for the custom
  collapsed bracketed-paste request prompt.
- **Package manager:** `npm` with `package-lock.json` (`lockfileVersion: 3`) and
  `workspaces: ["packages/*"]`.
- **Build:** `npm run build` — explicitly regenerates committed initialization-guide, phase-resource
  and artifact-reader modules, then bundles `packages/orchestrator/src/cli.ts` into
  the committed `packages/orchestrator/dist/banzai.mjs` (plus `.map`) with a
  `#!/usr/bin/env node` banner and mode `0755`.
- **Build check:** `npm run build:check` — compares generated initialization-guide and phase-resource
  bytes without repair, then rebuilds into a temp directory,
  compares bytes against the committed `dist/`, then smoke-runs the committed
  executable and asserts its non-TTY help output. Temporary output is removed
  on success and failure.
- **Typecheck:** `npm run typecheck` — `tsc --project tsconfig.json --noEmit`.
- **Test runner:** `npm run test` — esbuild bundles selected `test/**/*.test.ts`
  into `.test-dist/`, runs `node --test`, then removes the directory.
  `node packages/orchestrator/scripts/test.mjs --pattern <regex>` provides the
  same cleanup boundary for focused local evidence. Repeatable `--file <relative.test.ts>`
  selects exact test-root files before bundling; omission selects the complete suite.
- **Full gate:** `npm run verify` — `typecheck`, then `lint`, then `test`, then
  `build:check`. The formatter is deliberately not part of this gate.
- **Release-confidence gate:** `npm run release:check` — preserves `verify`
  semantics, then adds formatter, nine-field release-train validation, actual
  source/plugin/npm publication checks, and a
  disposable committed-bundle smoke. It snapshots tracked bytes and modes,
  fails if a component mutates them, and never invokes version synchronization
  or recovery.
- **Disposable release candidate:** `node packages/orchestrator/scripts/release-candidate-check.mjs`
  — copies the checkout's tracked and untracked non-ignored files into a
  temporary candidate outside the repository, links installed dependencies
  read-only, gives the candidate its own history-free index, and runs the
  candidate's `release:check` fresh. The real checkout is never staged,
  committed or written, and the candidate is removed on success and failure.
- **Version synchronization:** `npm run version:set -- <version>` applies one
  explicit canonical forward SemVer target to nine fields in seven fixed files.
  A same-version bootstrap from six `1.19.0` values and three absent root fields
  creates the root authority and its two lockfile mirrors;
  `npm run version:recover` restores exact originals only from retained
  `.banzai-version-set` transaction or fixed cleanup-guard evidence. Neither
  command selects a version, runs implicitly, or performs build, validation,
  installation, publication, or Git delivery.
- **Install for local use:** `npm run install:orchestrator` — builds and
  `npm link`s `@parabolic-technologies/banzai`, exposing `banzai` from this
  checkout.
  `npm run banzai` runs the committed bundle without linking.
- **npm distribution:** `@parabolic-technologies/banzai` is publishable with
  `publishConfig.access: "public"` and
  `publishConfig.registry: "https://registry.npmjs.org/"`. It exposes the
  `banzai` command and includes the bundle, source map, license, and notice.
  The npm landing page is `packages/orchestrator/README.md`; the full CLI
  reference is `documentation/orchestrator.md`, including the release-policy
  documentation checked by the release validator. The plugin installs
  separately in both clients. Verified registry facts for each published
  version live in `documentation/releases/public-publication.md`.
- **Lint:** `npm run lint` and `npm run lint:fix` run ESLint through the
  repository-relative deterministic formatter at
  `packages/orchestrator/scripts/eslint-formatter.mjs`. The flat config at
  `packages/orchestrator/eslint.config.mjs` validates and projects the complete
  production import policy from `packages/orchestrator/import-boundaries.mjs`;
  `plugins/`, `documentation/`, and the packaged hook are not linted.
- **Formatter:** `npm run format:check` (`prettier --check .`) and
  `npm run format` (`prettier --write .`), configured by
  `packages/orchestrator/.prettierrc.json` and `.prettierignore`. Run these only
  after code stabilizes, during final review, and never through `rtk`.
- **CI:** `.github/workflows/ci.yml` runs the complete repository-owned
  `release:check` after `npm ci` on pushes to `main`, on pull requests, and on
  manual dispatch; a push to `dev` or any other branch starts no hosted run.
  Required exact Node 22.20.0 and 24.11.1 lanes and advisory exact Node 26.7.0
  use official Git-capable Bookworm containers on `ubuntu-24.04`, with
  `git --version` and a Git `safe.directory` entry for `$GITHUB_WORKSPACE`
  before installation: the container runs as root while the runner-created
  workspace belongs to another user, and `actions/checkout` keeps its own
  `safe.directory` entry only in a temporary HOME that it removes after the
  step. The workflow grants `contents: read`
  and disables persisted checkout credentials. The separate advisory
  `live_vendor_compatibility` job requires a manual dispatch with the boolean
  `live_compatibility` input, `github.ref_protected`, repository variable
  `BANZAI_LIVE_COMPATIBILITY=1`, and a dedicated self-hosted Linux runner labeled
  `banzai-live`. It disables automatic npm caching and retains no artifact.
  `.github/workflows/publish.yml` (ADR-0039) runs on published,
  non-draft, non-prerelease GitHub Releases in the `npm` environment: it
  checks out the release tag, requires the tag to equal `v` plus the root
  version and npm 11.5.1+, runs `npm ci` and `release:check`, skips versions
  already on the registry, publishes only the CLI workspace through npm
  trusted publishing with `id-token: write` and no stored registry token,
  then records npm acceptance or the existing-version skip in the job summary.
  It does not wait for registry processing or verify availability;
  registry metadata and install checks are separate delivery evidence in the
  release checklist.
  The release validator checks the owned workflow layout and rejects the old
  `.gitlab-ci.yml`; unrelated GitHub metadata is permitted. Hosted runs,
  branch protection, and protected runner provisioning require separate evidence.
- **Development remote:** `git@github.com:Parabolic-Technologies/banzai.git`;
  default branch `main`, with `dev` retained as the documented development
  convention. Public package/plugin metadata and installation docs target
  `https://github.com/Parabolic-Technologies/banzai`.

## 3. Architecture

Project adoption inspection is a shared read-only lower boundary. Workflow and
doctor consume it without launching setup. CLI alone composes the explicit
foreground setup coordinator, local client discovery and terminal lifecycle;
setup reuses the existing runner lock without stale ownership reclamation.

- Two independently usable parts in one repository. They share one
  release-train identity and meet at explicit runtime contract boundaries, but
  retain separate installation/publication evidence:
  1. **Plugin** (`plugins/banzai/`) — declarative product source: Markdown
     skills, JSON Schema contracts, one Node hook, and packaged project
     templates. It installs and runs without the orchestrator.
  2. **Orchestrator** (`packages/orchestrator/`) — a TypeScript CLI bundled to
     one ESM file. It neither installs nor starts with the plugin.
- Orchestrator layering, outermost first: `cli.ts` (command composition), the
  public `agent-control-cli.ts` / `agent-control.ts` control projection, the
  read-only `doctor-cli.ts` / `doctor.ts` diagnostic path, and the read-only
  `evaluation-cli.ts` / `evaluation-render.ts` export path with its
  `evaluation-kpi-cli.ts` / `evaluation-kpi.ts` / `evaluation-kpi-render.ts`
  derived-KPI projection plus the independent read-only
  `context-report-cli.ts` / `context-report.ts` /
  `context-report-render.ts` projection → `interactive.ts`
  (TTY state-driven decision interface) →
  `workflow.ts` (`WorkflowRunner`: run lifecycle, phase execution, enforcement)
  → `adapters.ts` (vendor argument shapes and result decoding) → `process.ts`
  (child-process spawn, timeout, redaction).
- Allowed dependency direction is strictly inward: `cli` and `interactive`
  depend on `workflow`; `workflow` depends on `adapters`, `store`, `git`,
  `validation`, `prompts`, `review-artifact`, `review-snapshot`, `state-machine`, `config`,
  `contracts`, `prompt-envelope`, `output-contract`, and `context-accounting`;
  context reporting reads evidence directly and never imports workflow,
  adapters, store, or evaluation collectors; every layer may depend on `types`
  and `errors`. `types.ts`
  imports nothing at runtime. No inward layer imports an outward one.
- ADR-0029 makes every direct local production edge mechanical. The explicit
  policy classifies every `src/**/*.ts` module exactly once, carries separate
  runtime and additional type-only permissions with manifest/accepted-ADR
  authority, and is projected into built-in ESLint import and syntax rules.
  Missing/stale modules, forbidden static edges, alternate local loaders, and
  inline-disable attempts fail `npm run lint`; test and tool files remain
  outside the production layer map.
- Concurrency: one Node process using `async`/`await`. Each model phase and each
  verification command is a child process with its own timeout and
  process-group termination; verification commands run sequentially, while the
  per-vendor subscription-authentication checks at startup run concurrently.
- Cross-process mechanisms:
  - Model phases run as `codex exec` or `claude -p` child processes. The
    argument shape is chosen from the configured `executable`, not from the
    phase, so any phase can run on either vendor; writing phases receive edit
    and shell tools or `workspace-write`, review receives a read-only tool set
    or `--sandbox read-only`.
  - Every Banzai-spawned `claude` process is scoped by ADR 0020: it always
    receives `--strict-mcp-config`, and additionally `--setting-sources project`
    with one
    `--plugin-dir` naming the verified packaged Banzai plugin. Under ADR 0022
    it also receives `--mcp-config` naming the resolved Serena whitelist when
    one resolves, and no `--mcp-config` otherwise, so it loads exactly the
    whitelist or zero MCP servers. Setting-source
    scoping is applied only together with a verified plugin directory, so an
    unresolvable directory degrades to MCP-only isolation rather than disabling
    Banzai skills or hook enforcement. `--bare`, `--safe-mode`, and
    `--disable-slash-commands` are never used: the first is incompatible with
    subscription-only authentication and the others disable the enforcement
    hook.
  - Structured hand-off uses the JSON Schemas in
    `plugins/banzai/contracts/`, with current phase-result v4 and review-result
    v2, passed to Codex as a schema file and to Claude inline.
  - The plugin hook runs as a separate Node process per file-mutating tool call,
    reading the host's JSON payload on stdin and reading authorization from
    `BANZAI_RUN_ID`, `BANZAI_APPROVAL_DIGEST` and `BANZAI_WORKFLOW_DIGEST`.
    Review child environments remove inherited review/workflow write grants;
    the hook denies writes during reviewing or any active review attempt.
  - Agent-control start requests, escalation answers, and recovery authority
    use closed versioned JSON documents on direct process stdin. The CLI
    validates the complete document before invoking the existing
    `WorkflowRunner` mutation.
- Generated and committed code: `packages/orchestrator/dist/banzai.mjs` and its
  source map are build outputs kept under version control and byte-verified by
  `build:check`. `src/contracts.ts` imports the plugin's contract JSON through
  `resolveJsonModule`, so the schemas are embedded in that bundle and a schema
  edit requires a rebuild.

## 4. Project Structure

- Topology: npm-workspaces monorepo with a single workspace,
  `@parabolic-technologies/banzai` at `packages/orchestrator`. All plugin content
  is plain files outside the workspace.
- This manifest and the authoritative `documentation/` tree live at the
  repository root.
- Top-level layout:
  - `AGENTS.md` — repository authority; `CLAUDE.md` is a one-line
    `@AGENTS.md` include.
  - `README.md` — product documentation.
  - `CONTRIBUTING.md` — public issue and pull-request guidance, contribution
    licensing, development and release gates, canonical Node policy block,
    release-train version parity, and conventions.
  - `LICENSE`, `NOTICE` — Apache-2.0 text and project attribution, also copied
    into `plugins/banzai/` and `packages/orchestrator/` for separate delivery.
    Both npm manifests declare Apache-2.0. The root retains `private: true`;
    the orchestrator sets `private: false` and includes its license and notice.
  - `TERMS_OF_USE.md`, `TRADEMARKS.md`, `THIRD_PARTY_NOTICES.md` — software and
    template license scope, external-provider responsibilities, names/logos,
    dependency licensing, and voluntary font-artwork attribution.
  - `SECURITY.md`, `CODE_OF_CONDUCT.md` — private vulnerability and conduct
    reporting through the author email and community participation rules.
  - `documentation/releases/` — per-version release notes, which describe
    content and never delivery state, plus the publication procedure and the
    verified delivery record in `public-publication.md`.
  - `marketplace.json` and `.agents/plugins/marketplace.json` — versioned
    Codex-shaped marketplace descriptors.
  - `release-policy.json` — machine-readable Node and release-train policy,
    with root `package.json.version` as the sole authority and eight mirrors
    (nine fields across seven files), plus fixed version-transaction,
    distribution, documentation, CI, and live-compatibility policy consumed
    by repository checks.
  - `.github/workflows/ci.yml` — GitHub Actions required supported-Node lanes
    plus advisory forward and protected manual live lanes.
  - `.claude-plugin/marketplace.json` — Claude Code marketplace descriptor; it
    carries no version field.
  - `documentation/` — `getting-started.md` (first-task setup and troubleshooting),
    `verification-examples.md` (adaptable project checks),
    `orchestrator.md` (full CLI reference),
    `decisions/`, `evaluation/` (KPI definitions, derivations, the
    baseline procedure, Engineering Quality shadow sampling, and committed
    `<yyyy-mm>-baseline.md` documents, and the
    [reviewer calibration foundation](documentation/evaluation/reviewer-calibration/README.md)),
    `context/` (context contracts, privacy, policy, reporting, and the 15–30
    completed-run baseline procedure),
    `engineering-quality.md` (vendor-neutral policy delivery, projection, and
    evolution guidance),
    `security-assurance.md` (maintainer notes on the ADR-0027 policy and its
    evolution rule), and
    the version-controlled `release-checklist.md` runbook.
  - `packages/orchestrator/` — `src/`, `test/`, `scripts/`, committed `dist/`,
    `import-boundaries.mjs` plus its `.d.mts` declaration,
    `eslint.config.mjs`, `tsconfig.json`, `README.md` (npm landing page),
    and `MODULES.md` (per-module maintainer reference linked from section 5).
  - `plugins/banzai/` — `skills/<name>/SKILL.md`,
    `skills/project-manifest/references/layout-migration.md`, `policies/`, `phases/`, `guidance/`, `contracts/`, `hooks/`,
    `documentation/` (placeholder template tree), `.claude-plugin/plugin.json`,
    `.codex-plugin/plugin.json`, `.claude/settings.json`, packaged
    `AGENTS.md` / `CLAUDE.md` / `PROJECT_MANIFEST.md` templates.
  - `assets/` — project logo under `assets/logo/` (SVG mark and lockups,
    PNG avatar and social-preview exports, `README.md` usage notes).
  - `.serena/project.yml` — tracked Serena project configuration.
  - `.banzai/artifacts.json` — shared declaration selecting the private layout.
  - `.banzai/work/<uuid>/` — local, ignored internal work artifacts.
  - `.banzai/runs/` — local, ignored orchestrator run state.
- Source/test layout: `src/` is flat, one module per responsibility;
  `test/<module>.test.ts` normally mirrors `src/<module>.ts`. Cross-module
  contract tests such as `test/review-result-v2.test.ts` and shared fixture
  modules such as `test/helpers.ts` and `test/review-fixtures.ts` are supported
  layout exceptions. `test/hook.test.ts` covers the plugin hook outside the
  workspace.
- `.gitignore` ignores `dist/` globally and then re-includes exactly
  `packages/orchestrator/dist/banzai.mjs` and `.../banzai.mjs.map`; it also
  ignores `.claude/settings.local.json`,
  `plugins/*/.claude/settings.local.json`, local run/active-run/runner-lock
  evidence, environment files except example/sample files, private-key and
  certificate containers, and the fixed checkout-local
  `.banzai-version-set/` transaction boundary plus its `.guard` and `.guard.tmp`
  cleanup evidence.
- `.gitignore` excludes local `.banzai` contents while keeping
  `.banzai/artifacts.json` eligible for tracking. Legacy workflow directories
  `documentation/features/`, `documentation/development-plans/` and
  `documentation/changes/` are also ignored. `publication-policy.json` selects
  `clean` mode with no historical exposure exceptions; publication checks
  reject excluded evidence even when force-added.

## 5. Key Modules & Components

One bullet per unit: role, contract, and the load-bearing invariant. Detailed
per-module behavior lives in `packages/orchestrator/MODULES.md`; read the
entries for the modules a change touches, then the source and
`test/<module>.test.ts`.

Orchestrator (`packages/orchestrator/src/`):

- `artifact-storage.ts` — typed facade over the plugin's canonical builtin-only
  storage, archive and adoption implementation. The build also generates plugin
  `lib/artifact-readers.mjs` from the existing persisted readers; `build:check`
  enforces exact generated parity. The plugin helper and CLI share
  declaration/binding rules, first-use exclusions, claims and offline requests.
  Private work is `.banzai/work/<uuid>/`; explicit legacy bindings retain earlier
  documentation paths. Read-only discovery does not initialize storage. Recognized
  unbound standalone legacy work uses content-bound explicit registration; selected
  effective ignores and exclusive runner/standalone work claims guard writes.

- `cli.ts` — command surface and non-TTY output: `banzai`, `interactive`,
  `doctor [--json]`, `model`, `init`, `run`, `status [--json|--metrics]`,
  `control capabilities|status|start|answer|recover`, `resume`, `retry`,
  `recover`, `restore`, `cancel [--run] [--reason]`, `approve adr|plan`,
  `triage`, `compatibility live --confirm-live`, and
  `eval export|kpi|context|cancellations`. Traps `SIGINT`/`SIGTERM` for every
  run-bearing command; the help heading derives the release-train version from
  the package mirror (ADR-0033).
- `cli-routing.ts` — `resolveCliMode`: argv plus TTY presence →
  `interactive | help | command | tty_required`.
- `version-cli.ts` — `--version` / `-v` prints the running package version;
  `--plugin-version` / `-pv` reports installed versions separately for Codex
  and Claude Code through bounded local inventory commands. Em-dash long
  aliases are accepted. Neither path requires Git or project configuration;
  absent or unreadable plugin versions are explicit, never source-version guesses.
- `agent-control-cli.ts` / `agent-control.ts` — non-TTY control grammar over
  closed direct-stdin JSON (64 KiB, validated before mutation); current
  `banzai-agent-capabilities/v6`, `banzai-agent-status/v5`,
  configuration `banzai-agent-answer/v3`; preserved consultation
  `banzai-agent-answer/v2`, `banzai-agent-request/v1`, escalation
  `banzai-agent-answer/v1`, `banzai-agent-recovery/v1`. Every mutation
  delegates to `WorkflowRunner` and returns a fresh status projection.
- `interactive.ts` — TTY state-driven decision interface behind `InteractiveIO`:
  launch header, run summary, and triage layout. Offers only the actions valid
  for the persisted status and never displays terminal triage as reviewer pass.
- `inquirer-io.ts` — the only module bound to `@inquirer/*`; bracketed-paste
  request input rendered as `[Pasted text #N +M lines]` placeholders.
- `terminal-attention.ts` — presentation-only macOS Dock attention (BEL or
  OSC 1337) when a human gate is reached; no persisted state;
  `BANZAI_ATTENTION=off` disables it.
- `interrupt.ts` — `createInterruptHandler`: the bounded Ctrl+C sequence
  (`INTERRUPT_GRACE_MS` 2s, `INTERRUPT_HARD_EXIT_MS` 6s, exit 130/143), fully
  injected for tests.
- `progress.ts` — `TerminalProgressReporter` on stderr; `quiet | normal |
verbose` from `--quiet`/`--verbose`, then `BANZAI_PROGRESS`; stdout stays
  machine-readable.
- `vocabulary.ts`, `ansi.ts`, `format.ts` — human-only renderings of internal
  tokens, colour detection (`FORCE_COLOR`, `NO_COLOR`, `TERM`), and pure
  width/wrap/usage formatting. Nothing rendered here is parsed back.
- `workflow.ts` — `WorkflowRunner`, the core: `start`, `resume`, `retry`,
  `recover`, `approvePlan`, `decideAdr`, `answerHumanDecision`, `triage`,
  `cancel`, `recordCancellationResponse`, `status`, and the private phase executors (selection, planning,
  implementation, verification, review, fixes). Owns preflight including
  `assertClaudePermissions`, approval-digest and base-commit validation, attempt
  reconciliation, builder-session selection, full/delta reviewer policy,
  snapshot-v6-bound rendered-review-v7 publication without formatting-only model calls,
  and recovery source discovery.
- `state-machine.ts` — `transitionState`, `blockState`, `requireState`; the
  only place `RunStatus` changes, so illegal transitions fail closed.
- `store.ts` — `RunStore`: atomic `state.json`, append-only `events.jsonl`,
  model-attempt records with redacted output, mode-0600 context ledgers,
  attempt-owned review candidates and immutable private review snapshots,
  verification-ledger leaves, and the
  single-active-run lock (`releaseHeldRunnerLocksSync` for signal handlers).
  A separate owned short guard serializes state/events and rejects stale terminal
  changes; it is never released by the signal handler or reclaimed automatically.
  Normalizes state schema 1 to 2 on read.
- `plan-task-completion.ts` — approved `TNNN` parsing, the legacy
  `banzai-plan-task-completion/v1` projection renderer/decoder, ledger shape
  validation, `validatePlanTaskCompletion` for historical v1 checkpoints, and
  the runner-owned `banzai-plan-task-completion/v2` region: fence-aware section
  scanner, deterministic numeric-character-reference renderer, single-decode
  parser, `validateCompletionClaims` against approval, changed-surface scope,
  required reports and unique preserved gap headings, and
  `composeCompletionCandidate`, which replaces exactly one existing section or
  appends while preserving every other byte (ADR-0017/0025/0047/0048). Fails
  closed as `PLAN_TASK_COMPLETION_INVALID`.
  Its planning guard rejects runner-control write targets and ambiguous access
  as `PLAN_RUNNER_CONTROL_TASK`, allowing read-only references, preservation
  constraints and exact bound report writes (ADR-0045).
- `adapters.ts` — `createVendorAdapters` and the Codex/Claude argument
  builders; `MINIMUM_CODEX_VERSION = "0.145.0"`,
  `MINIMUM_CLAUDE_VERSION = "2.1.218"`. Decodes vendor streams into typed
  results, usage, session inventory, and closed failure causes;
  `normalizedUsage` reconciles vendor cache accounting; `summarizeCommand`
  elides credential-shaped tokens for progress display; owns
  `resolveClaudeInvocationScope` and the MCP whitelist argument shapes.
- `process.ts` — `runProcess`, `subscriptionOnlyEnvironment`,
  `redactSensitiveText`, `terminateProcessGroup`; strips API-key variables and
  redacts secrets from retained output.
- `mcp.ts` — `resolveSerenaWhitelist`: availability-gated and never throws; a
  missing Serena becomes a note, never a blocked run.
- `verification-evidence.ts` — typed facade over the canonical plugin decision and
  evidence-storage owners for task descriptors, inert discovery, execution authority,
  immutable physical provenance and current applicability; runner and standalone
  helper use the same rules.
- `verification.ts` — root project-marker detection, hygiene classification,
  explicit legacy-profile diagnostics and command descriptors. Task discovery and
  policy live in the shared task owner.
- `claude-permissions.ts` — offline audit of the permission rules a spawned
  Claude session honors: a missing or refused `Write` blocks; `Edit`, `Bash`,
  and path-scoped gaps are advisories.
- `project-adoption.ts` — bounded read-only instruction-layout, manifest and
  exact plugin/source-workspace identity inspection shared by CLI, doctor and
  workflow. It imports no mutable or vendor boundary.
- `project-setup.ts` — explicit setup menu, reinspection and shared no-reclaim
  runner ownership; unfinished or corrupt runs cannot launch setup.
- `setup-client.ts` / `foreground-client.ts` — locally verified explicit
  project-manifest invocation, selected subscription authentication, filtered
  environment, foreground terminal ownership and bounded child cleanup.
- `doctor-cli.ts` / `doctor.ts` — read-only fixed-order `banzai-doctor/v5`
  readiness checks; constructs no `RunStore`, adapters, or `WorkflowRunner`.
- `live-compatibility-cli.ts` / `live-compatibility.ts` — the protected,
  explicitly confirmed live vendor probe producing closed
  `banzai-live-compatibility/v2` evidence with unconditional cleanup.
- `evaluation-cli.ts` / `evaluation.ts` / `evaluation-render.ts` — read-only
  privacy-minimized default `banzai-evaluation-export/v1` and explicit v2 collector and deterministic
  JSON/Markdown projection; runner-owned sidecars stay outside the boundary.
- `evaluation-kpi-cli.ts` / `evaluation-kpi.ts` / `evaluation-kpi-render.ts` —
  pure default `banzai-evaluation-kpi/v1` and explicit v2 projections over matching exports (ADR-0026/0043)
  in checkout and fail-closed `--input` modes; imports only `types` and
  `errors`.
- `context-report-cli.ts` / `context-report.ts` / `context-report-render.ts` —
  independent `banzai-context-report/v1` collector over context ledgers; never
  imports evaluation, adapters, store, or workflow.
- `context-accounting.ts` — exact UTF-8 measurement, ledger decoding, and
  observe/enforce budget evaluation; only pre-call `runner_payload_bytes` can
  enforce.
- `prompt-envelope.ts` / `output-contract.ts` — ordered closed prompt
  components and the exact vendor-specific schema serialization; the measured
  bytes are the bytes the adapter receives.
- `cancellation.ts`, `cancellation-evidence.ts`, `cancellation-cli.ts`,
  `cancellation-report.ts`, `cancellation-report-render.ts` — observation v1
  reasons and provenance, bounded read-only evidence ingress, exact cancel
  flags, and the independent `banzai-cancellation-report/v1` report
  (ADR-0035). Report reads never repair or backfill history.
- `human-time.ts`, `human-time-store.ts`, `interactive-human-time.ts` — the
  private mode-0600 run-local timing ledger and interactive-only recorder
  (ADR-0034); gate elapsed never becomes active effort, and recorder failures
  cannot authorize or replay workflow work.
- `validation.ts` — runtime decoders (`parseWorkflowSelectionResult`,
  `parsePhaseResult`, `parseReviewResult`, `parseConfig`) enforcing the
  invariants JSON Schema cannot express.
- `contracts.ts` — re-exports the plugin contract JSON; `assertContractParity`
  fails startup on `CONTRACT_VERSION_MISMATCH` or `SCHEMA_VERSION_MISMATCH`.
- `configuration-prerequisite.ts` — bounded closed configuration decisions,
  state-6 envelope validation and runner-assigned command identity rules.
- `verification-config.ts` — exclusive, byte-pinned lossless previews and atomic
  config transactions; selected-run history supplies command collision evidence.
- `configuration-review.ts` — freezes real runner deltas and coverage disposition
  without attributing carried-in or later user config changes to the runner.
- `verification-cli.ts` — explicit legacy profile CRUD/list and
  explicit all-command check execution under repository ownership.
- `verification-ui.ts` — shared task-verification outcome lines for CLI and
  interactive status, plus the retained structured command editor and legacy decision guidance;
  no shell parsing, model invocation or config write.
- `persisted-readers.ts` — canonical exports for generated plugin readers;
  the build resolves those imports to source, never stale generated output.
- `config.ts` — `.banzai/config.json` location, `DEFAULT_CONFIG`, `loadConfig`,
  `initializeConfig`, and byte-preserving `applyModelUpdates`; context policy
  defaults to `{ mode: "observe", limits: [] }`.
- `models.ts` / `model-selection.ts` — the hand-maintained model catalog
  (`SELECTABLE_MODELS`, standings, advisories, effort levels) and the per-role
  model/effort dialog. Fresh initialization labels presets as `Use default`;
  existing configurations retain `Keep`.
- `git.ts` — repository discovery, commit/branch, `digestArtifactBundle`,
  `repositoryBaseline`, and `workspaceSnapshot`/`workspaceDigest`/
  `workspaceChanges` over staged, unstaged, and untracked evidence.
- `init-resources.ts` — generated verification examples embedded in the CLI from
  `documentation/verification-examples.md`, with links to other product guides
  resolved to the public repository. Init creates the local guide only when absent,
  under initialization ownership and regular-file/no-symlink checks.
- `phase-resources.ts` — committed generated raw UTF-8 bodies and SHA-256
  identities for six phases, ten guidance files, six policies and two hook
  references. Explicit build generates; check-dist only compares.
- `phase-instructions.ts` — ordered resource delivery and bounded installed
  identity comparison. Only prompts, workflow and doctor consume it. It imports
  phase-resources/errors at runtime and types only for declarations; generated
  resources import nothing. No adapter resource edge exists.
- `prompts.ts` — phase prompt texts, `workflowPhases` (the supplied phase responsibilities
  per route), and `serenaGuidance`. Strict planning, implementation, review and
  accepted-finding fixes inline the applicable shared guidance and policies while preserving
  approved scope, legacy directives and required evidence.
- `review-artifact.ts` — deterministic `banzai-feature-review/v7` rendering for
  task snapshots, retaining historical renderers,
  exact snapshot/result validation and atomic publication of validated bytes;
  legacy v1 rendering and diagnostics remain readable.
- `review-snapshot.ts` — `banzai-review-snapshot/v6` frozen task checks, physical origins and completion identities
  with historical readers,
  full/delta anchors, recorded evidence, digest validation and owned paths.
- `types.ts` — all shared types, `CONTRACT_VERSION = "1.0.0"`, phase-result
  schema v4 and state schema v8 with explicit historical readers, attempt
  schema v4 under `banzai-completion-protocol/v1`, terminal checkpoint v3, the
  completion capture/transition/candidate/publication record identities, and the independent
  agent-control, context, and checkpoint/recovery contract identities; no
  runtime imports.
- `errors.ts` — `BanzaiError` (stable `code`, `exitCode`), `ProcessExitError`
  (redacted streams, typed `failureCause`, spent usage), `errorMessage`.

Repository release scripts (`packages/orchestrator/scripts/`):

- `check-release.mjs` — read-only release validation: policy, Node/CI/docs
  consistency, plugin and marketplace JSON, nine-way version parity, hook and
  contract identities, whitespace-normalized policy-section drift checks,
  instruction-layout structure and consumer-matrix validation, scoped
  references and migration/legacy-release pins,
  committed bundle mode and parity, and a hook-runtime version rule:
  `hooks/spec-gate.cjs`, `hooks/hooks.json` and `plugins/banzai/lib/` must
  match the commit that set the current version unless the working tree
  carries a pending bump (`HOOK_CHANGED_WITHOUT_VERSION_BUMP`). The rule is
  skipped without full Git history (release fixtures, shallow CI clones).
- `smoke-committed.mjs` — runs the committed bundle in disposable repositories
  and asserts clean streams, fixed schema identities, deterministic bytes, no
  mutation, and unconditional cleanup.
- `release-check.mjs` — composes `verify`, `format:check`, release validation,
  and committed smoke with tracked-tree mutation detection; never runs version
  synchronization or recovery.
- `release-version.mjs`, `version-set.mjs`, `version-recover.mjs` — the
  explicit nine-field/seven-file version transaction with durable journal,
  cleanup guard, authenticated restoration, and legacy format-1 recovery.
- `phase-resources-build.mjs` — one exact resource inventory, immutable
  normalized extraction evidence, generated-source parity and actual
  source/plugin/npm/source-map comparison; rejects indexed/working skew.
- `instruction-baseline.mjs` — explicit authoring/check interface for current
  instruction expectations and ADR-scoped transitions; preserves the original
  extraction root. Builds and validators never generate baseline transitions.
- `build.mjs`, `check-dist.mjs`, `test.mjs`, `eslint-formatter.mjs` — the
  esbuild bundle, dist parity check, `.test-dist/` test runner, and
  deterministic lint output.

Plugin (`plugins/banzai/`):

- `phases/` and `guidance/` — six runner processes and ten shared portable
  guidance files outside skill discovery. `code-design.md` is authored directly
  rather than extracted from a skill section. Standalone skill consumers read
  guidance relatively; retained Orchestrated Mode sections are transitional
  source and are not consumed by the runner.

- `skills/<name>/SKILL.md` — eleven skills, each with `name`, `description`, and
  `user-invocable` frontmatter: `architecture-decision`, `code-writing`,
  `development-plan`, `feature`, `feature-description`, `feature-review`,
  `feature-status`, `orchestrate`, `project-manifest`, `quick-fix`,
  `test-writing`. Only `orchestrate` uses the optional CLI integration and its
  single `references/control-protocol.md` state/action reference. `orchestrate`
  and `project-manifest` add `disable-model-invocation: true`, so they are
  reachable only through explicit user invocation in Claude Code; each carries
  a Codex-specific `agents/openai.yaml` that independently sets
  `policy.allow_implicit_invocation: false`, preserving the same boundary for
  `$banzai:orchestrate` and `$banzai:project-manifest`. Every other skill's
  description ends with the adoption gate sentence restricting automatic
  selection to Banzai-adopted repositories (root `PROJECT_MANIFEST.md` or
  `.banzai/` present) or an explicit user mention of Banzai or the skill.
- `AGENTS.md` — the installed workflow process: authority order,
  execution modes, roles, routing, explicit outer orchestration and recursion
  guards, escalation triggers, ADR eligibility, the five existing decision gates, and
  the hook contract, with a policy index. `CLAUDE.md` is the `@AGENTS.md` shim.
- `policies/` — six owner files for Decision Consultation, Test Assurance,
  Security Assurance, Engineering Quality, Plan Authority/Task Completion and
  Artifact Storage. Runner phases inline their ordered applicable union;
  inclusion preserves conditional applicability.
  `plan-task-completion.md` owns ADR-0038's explicit approved-plan convention
  separately from ADR-0017/0025's completion section. Only plans establishing
  the convention gain its labeled discretion; legacy approved meanings remain.
  Ten consuming skills explicitly read their required or conditional policies
  relative to the installed `SKILL.md`, stopping on absent or unreadable sources.
  Planner/implementer read the plan policy; assurance, review, status and accepted
  fixes read it conditionally for strict plan interpretation or completion.
  The supervisor only relays existing stops; no policy body is copied into a project.
- `skills/project-manifest/references/layout-migration.md` — structural target,
  legacy, unadopted and partial recognition, exact legacy diagnostic and a single
  approved migration diff preserving shared rules and confirmed host notes.
  Ordinary skills stop before affected work on legacy/partial layouts. Only
  explicit `project-manifest` migration and read-only `feature-status` reporting
  can use the installed process as a bootstrap source. No migration runtime or
  new gate exists. Effective delivery on each host requires separate evidence.
- `contracts/contract.json`, `contracts/v1/*.schema.json`,
  `contracts/v2/phase-result.schema.json`, `contracts/v2/review-result.schema.json`, and
  `contracts/v4/phase-result.schema.json` — umbrella contract version `1.0.0`;
  workflow selection remains v1, orchestrated review-result v2 is current, and
  phase-result v4 is current with the planning-only consultation request and task verification candidates.
  `contracts/v1/review-result.schema.json` is byte-preserved for legacy reads
  and standalone review; phase-result v1/v2/v3 remain byte-preserved legacy reader surfaces.
- `hooks/spec-gate.cjs` and `hooks/hooks.json` — the `PreToolUse` /
  `PostToolUse` gate on `Edit|Write|MultiEdit|NotebookEdit|apply_patch`. It
  defers to the host permission flow on an unparseable payload, gates the first
  code edit of a manual session behind a human approval it records itself, and
  fails closed in runner context. A bound run state newer than the hook's
  `NEWEST_RUN_STATE_SCHEMA` is denied as installed-plugin skew with an update
  remedy instead of as a legacy run. Manual-session gating applies only in
  Banzai-adopted projects — `.banzai/config.json` or a root
  `PROJECT_MANIFEST.md` in the session directory or a parent — and the hook
  stays silent in repositories without that evidence.
- `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` — plugin manifests,
  currently version `2.6.2`. The Codex manifest additionally declares the hook
  and the store interface metadata.
- `PROJECT_MANIFEST.md`, `AGENTS.md`, `CLAUDE.md`, and the placeholder
  `documentation/` tree (`README.md`, `decisions/README.md`, `.gitkeep` files) —
  bootstrap templates copied into end-user projects; policy files stay in the
  installed plugin and are not copied.

## 6. State & Data Flow

- The runner supplies phase/guidance/policy instructions directly on every
  fresh, resumed, retry and recovery call; selection is prompt-only. Bound
  roles and existing phase write sets precede mutable request/evidence blocks.
  Report duties, conditional changeReport triggers, approval immutability,
  standalone role readers and runner-only review rendering remain unchanged.

New runs use state v8 with task verification and immutable private binding v2,
including projects whose stored layout default is legacy. No profile/bootstrap
readiness gate runs. Strict implementation grants the bound implementation and
test reports; strict fix also grants the bound change report. Lite routes retain
their existing work/change-report grants. Workspace v2 binds the selected ignored
work. Historical runs are not migration or continuation targets for ADR-0049;
retained readers preserve their original meanings. Archive v1 can retain new
bytes but reports unsupported task evidence as incomplete and refuses restore.
Doctor v5 checks bound state v8 read-only. External client installation remains
separate delivery evidence.

Project guidance is inspected before new-run creation and authentication, then
rechecked under ownership. Continuations inspect instruction layout before
model-attempt publication. A setup refusal publishes no failure or usage and
leaves the last durable checkpoint and saved decision intact. The existing
resume/retry/recover action remains authoritative after manual repair. CLI
setup is unavailable while that run remains unfinished; setup creates no run,
attempt, approval marker or transcript.

- Configuration: `banzai init` creates schema 4 with model settings,
  `contractVersion`, optional `claudeEnvironment`, and `maxFixCycles`. There is no
  mandatory verification section. Optional `verification.policy` can require or
  deny checks and constrain timeout/cwd/context. Profiles and bootstrap are
  rejected in schema 4; explicit legacy profile utilities remain scoped to old
  config formats and do not control new tasks. `DEFAULT_TASK_CONFIG` selects
  Codex `gpt-5.6-sol` for planning/implementation and Claude `claude-opus-5` for
  review, with `xhigh` effort. Each workflow action reloads configuration.
- Task verification: inert project discovery supplies evidence, never permission.
  Strict plans carry self-contained remainder-bound obligations v2 inside the
  approved bundle; phase-result v4 supplies separate additional candidates.
  Lite selection remains under the user request and inherited local execution
  permissions. A project script cannot confer new permissions. The shared task
  owner validates descriptors, source/materialization paths, policy and actual
  context before direct executable/argv invocation. Missing optional tooling
  creates no configuration gate; mandatory failure prevents completion.
- Physical task evidence: binding v2 reserves a private verification directory.
  Ledger 3 retains immutable decision v2, physical start/finish v2, origin v2 and
  applicability v2 records. Direct command descriptors, cwd, actual context and
  observed inputs remain linked by hashes; hashes establish identity, not test
  quality. Explicit retries retain failures, interrupted starts require owner
  recovery, and retained terminal results are reconciled without duplicate
  execution. Equivalent evidence requires declared complete dependencies and
  matching direct origins; release checks stay fresh. Standalone helper request
  v2 uses bound task documents and exclusive work ownership; inspect is read-only.
- Run state: `.banzai/runs/<run-id>/state.json` is atomically replaced;
  `events.jsonl` is an append-only summary without transcripts; `attempts/`
  holds current task-mode model-attempt v4 records, structured results, redacted CLI output,
  immutable mode-0600 terminal checkpoints, one mode-0600 review candidate
  and an immutable mode-0600 review snapshot per new physical review attempt. Historical model-attempt v1-v3 readers retain their original semantics, including
  interrupted lifecycle evidence and recovery linkage where present.
  Optional `planningContext` on planning attempts holds bounded invocation and
  stopped-workspace digests, artifact paths, and `retryOf`; it is cache evidence,
  never a completion or authorization record. Optional
  `metrics.usageAccountedAttemptIds` prevents failed usage from being counted
  again when terminal completion is reconciled. Historical records remain
  readable without either field.
  `recovery-authorizations/` holds closed immutable current-human decisions for
  exact workspace identities. Run-state schema 3 adds tagged pending
  consultation plus exact keyed decision history while preserving v1/v2
  normalization, and optionally links a pending or started recovery, including
  `source_preserved` while a completed blocked source remains immutable. It
  binds resumable sessions to role, executable, model, and effort;
  reviewer bindings additionally retain the approval digest, successful
  snapshot, full-review anchor, delta count and output-contract identity.
  New review attempts bind their snapshot digest through `reviewContext`;
  absent/v1 reviewer identities rotate fresh/full as
  `output-contract-not-reusable`, which frozen evaluation v1 retains as
  unsupported present evidence rather than adding an enum value. It also keeps cumulative
  triage and pending rotation evidence. A lock permits one active run per
  checkout. `RunStatus` moves
  through `created`, `selecting`,
  `planning`, `needs_adr_approval`, `needs_plan_approval`,
  `needs_human_decision`, `plan_approved`, `implementing`, `verifying`,
  `reviewing`, `needs_triage`, `fixing`, to `done`, `blocked`, or `cancelled`.
- Run lifecycle: request → generated slug → start confirmation → persisted
  request → preflight and repository baseline → read-only structured workflow
  selection → route. `quick-fix` and `feature` execute their runner-delivered
  lite phase instructions and deterministic verification, then finish. `strict`
  runs planning, the ADR and
  plan-approval gates, implementation, verification, independent review, then
  either completes directly when triage accepts no finding or runs accepted-only
  fixes, verification, and re-review. Matching planner and implementer settings
  share one builder lineage. The primary review is fresh and full in a separate
  source-read-only lineage; routine re-reviews resume it in delta mode for at
  most two consecutive deltas before automatic fresh full rotation. Missing or
  incompatible bindings, changed approval, unreliable or blocked review, and
  accepted blocker or security findings also rotate it. In Engineering Quality
  shadow mode, ordinary review findings/severities/verdict freeze before one-rule
  overlap mapping; incremental candidates remain non-authoritative
  `deferredCoverage` strings and never reach triage, fixer scope, completion, or
  a gate. Runner rendering preserves every structured shadow string as inert
  content; runtime validation does not interpret it. Resolution review verifies accepted IDs
  first; reviewer rotation does not reopen rejected or deferred concerns against
  unchanged evidence and authority.
- Current review-result v2 carries reviewer-owned scope acknowledgment v1:
  exact approved paths and snapshot digest, `reviewed` or `not_reviewed` with
  reasons. Missing/duplicate/contradictory/out-of-scope assertions fail. Required
  unreviewed scope forces `blocked`, including truthful zero-coverage layout
  blockers. Full and delta semantics are defined in ADR-0037; acknowledgment
  is an assertion, not proof of reading. `reviewNotes` preserves additional
  meaningful prose. Markdown separates required scope from acknowledged
  coverage and projects verification/completion only from the frozen snapshot.
  Standalone review owns durable v1 Markdown; legacy records gain no assertion.
- Human decisions: five existing workflow gates — conditional planning-only
  decision consultation, `adr_approval`, `plan_approval`, `escalation`, and
  review triage. Task verification adds no configuration prerequisite gate.
  No other phase boundary asks for confirmation; every other
  model boundary emits a report and continues. Operator recovery is a separate
  explicit risk authorization, distinct from workflow gates, retry, approval, or
  completion claim.
- Authorization data: a plan-approval digest binds the exact description,
  accepted ADRs, and plan; a workflow digest binds a persisted lite selection; a
  workspace digest detects source drift during review. Baseline-identical paths
  and the intended canonical review artifact are excluded from that digest.
  Recovery binds either the active interrupted mutable attempt or one exact
  completed prerequisite-blocked fix, the current workspace snapshot, base,
  approval/workflow, accepted-finding scope, and implementer configuration into
  one opaque identity. The blocked-source form additionally binds its validated
  result plus resolved and remaining IDs. Execution rechecks every component
  under the runner lock. The closed authorization acknowledges uncertainty or
  addressed prerequisites but never proves an old attempt complete and never
  authorizes Banzai to run a prerequisite command.
  Both orchestrated reviewers have read-only access to approved artifacts,
  source, policies, verification logs and completion evidence. Claude exposes
  Read, Glob, Grep and Skill and explicitly denies mutation tools. Stale
  inherited candidate/workflow grants cannot restore write authority.
- Progress: phase events are normalized from Codex `--json` and Claude
  `--output-format stream-json` into one vocabulary and written to stderr, with
  a 30-second heartbeat. Prompts, reasoning, assistant prose, command arguments,
  and tool results are never streamed. Attempts, events, status, and metrics
  expose fresh/resumed sessions, full/delta reviews, and closed rotation reasons
  without adding transcripts. stdout stays reserved for machine output such as
  `banzai status --json`.
- Agent control: `banzai control capabilities` is offline and can run outside a
  Git checkout; it declares the exact independently versioned non-TTY operation
  set under control contract `6.0.0`, including keyed consultation answers and
  explicit `recover` with the
  closed `banzai-agent-recovery/v1` input. `banzai control status` exposes one
  bounded public projection derived from runner state rather than human
  `nextAction` prose and excludes requests, prompts, transcripts, environment,
  digests, commands, logs, and raw control paths. Terminal `done` and
  `cancelled` projections remain available for evidence; only a non-terminal
  projection blocks an explicitly requested new run. A current consultation
  projects its bounded cards; completed consultation history is excluded.
  `control start`, `control answer`, and `control recover` accept only closed
  UTF-8 JSON stdin documents no larger than 64 KiB, validate before mutation,
  preserve request, keyed preference, and ordered escalation strings exactly,
  require the exact current consultation or recovery
  identity plus explicit side-effect acknowledgment, delegate to the existing
  runner/store, and then return current status. Other decision, resume, retry, and cancel
  operations remain the existing runner-owned commands.
- Evaluation export: raw `.banzai/runs/` evidence is read through a fixed
  privacy allow-list without `RunStore`, configuration, locks, recovery,
  verification, adapters, or model calls. JSON is authoritative; Markdown is a
  pure projection. Unreadable and legacy runs remain visible through opaque
  ordinals, bounded issues, and explicit numeric coverage. Root runs discovery
  errors are fatal, while per-run state, attempt, review, and event read errors
  degrade only that run. Attempt schemas 1 and 2 are supported; missing schema
  evidence is legacy-absent, and unsupported or malformed evidence is invalid. Active
  attempts are matched internally by exact identity, which is never exported.
  Model-attempt v2 `interrupted` maps to the existing public incomplete/started
  bucket so export v1 adds no enum or key.
  Terminal-checkpoint and recovery-authorization content is never exported.
  Supported historical runs have an explicit verification-ledger marker and stable physical
  attempt leaves; unique valid leaves own attempt/outcome/duration history while
  cumulative and retained state are consistency checks. A missing marker means
  legacy evidence, so genuinely lost outcomes remain partial with
  `VERIFICATION_HISTORY_INCOMPLETE`. Malformed ledger evidence has dedicated
  bounded issues and never falls back to invented exact outcomes. A failed
  review-candidate attempt contributes only its supported failed-attempt
  classification; candidate Markdown, private metadata, structured result, raw
  output paths, and raw result files never create a verdict, finding, or
  completion signal.
- Evaluation KPIs: `banzai eval kpi` projects complete
  `banzai-evaluation-export/v1` objects into the independent
  `banzai-evaluation-kpi/v1` contract (ADR-0026). Checkout mode computes the
  export in memory under the same cohort rules without writing a file or
  reading new run evidence; `--input` mode decodes previously exported files
  fail-closed (`INVALID_EVAL_INPUT`) and needs no repository. Every KPI is
  derived from per-run evidence only, carries numerator, denominator, `null`
  value on a zero denominator, and exact-versus-incomplete run coverage, and
  is grouped overall, by workflow for completion rate, and by fail-closed
  configuration signature. Markdown comparison tables and canonical JSON are
  deterministic projections of one derived document.
  Retry and configuration attribution require a complete model-attempt set;
  verification or cost gaps alone do not invalidate that set. Missing,
  conflicting, or excluded evidence never becomes a confirmed empty array.
- Cancellation observation v1 stores one optional operator reason, provenance,
  immutable terminal anchor and pre-transition context in existing state/events.
  The winning cancellation clears the pending human decision after context
  capture and preserves decision history, leaving a readable terminal run.
  Confirmation and stopping precede optional first-response collection; a
  process-local receipt binds the answer to the exact cancelled run. Missing,
  legacy, skipped and malformed evidence remain distinct; analytics cannot undo
  cancellation (ADR-0035).
- `banzai eval cancellations` projects report v1 from run-creation cohorts with
  all known cancelled runs in reason denominators. Pre-cancel resource subtotals
  and current single-engineer estimates retain cutoff/coverage limits. Elapsed
  and estimates are never person-time totals. Superseded is intent; confirmed
  continuation has no supported task-link source. Frozen reports remain unchanged.
- Practical effectiveness research defines a proposed task-level method under
  `documentation/evaluation/effectiveness-study.md`, with empty task/run and
  human-time templates. Private case-study reports and capture instructions
  are excluded from public source. Interactive summaries separate gate elapsed
  from optional active-time estimates and preserve incomplete coverage. Private
  ledgers do not enter frozen reports. Task-wide/native-workflow collection and
  acceptance/quality observations remain follow-ups; implemented collection is
  not evidence of effectiveness. Reviewer calibration docs retain a generic
  comparison method without a private dataset dependency.
- Explicit export/KPI `--schema-version 2` separates physical attempt counts from
  executed/reused terminal round/check dispositions. Opaque ordinals retain direct
  origins without private command/path/digest data. Only exact coverage contributes
  to the reuse ratio; a zero denominator yields null. v1 remains the default and
  reports new verification evidence as incomplete rather than changing its meaning.
- Engineering Quality shadow evaluation is a sampled maintainer procedure over
  existing evaluation exports, KPIs, and applied canonical review artifacts. It
  selects completed strict runs whose first independent review used the shadow
  policy across the approved repository/stack, change-type, and reviewer
  diversity; classifies overlap, useful incremental candidates, duplicates,
  no-material concerns, false positives, and reviewer disagreement; and reports
  the approved artifact/worksheet coverage, raw candidate yield, all-record
  shape completeness, `triage_deferred`, isolation, and resolution metrics. No
  runtime parser, persisted state, export/KPI field, or mandatory triage action
  depends on an `EQ-SHADOW:` string.
- Context evidence: immediately before each actual model invocation, the runner
  writes exact prompt/output-contract UTF-8 counts, closed categories,
  authority counts, and explicit-unavailable post-call surfaces to the physical
  attempt's `banzai-context-attempt/v1` ledger. `observe` is behavior-neutral;
  `enforce` can block only exact pre-call runner bytes without weakening the
  prompt. `banzai eval context` reads those leaves directly under the export
  cohort grammar and emits independent `banzai-context-report/v1` JSON or its
  Markdown projection. Missing historical leaves are incomplete, while present
  malformed, content-bearing, or conflicting evidence aborts as
  `INVALID_CONTEXT_EVIDENCE`. The ledger/report allow-list excludes prompts,
  requests, paths, source, transcripts, model/tool content, names and
  arguments, environment, credentials, personal data, and error prose.
- Doctor: exact doctor syntax is validated before Git-root discovery so invalid
  arguments have one stable diagnostic in every working directory. Valid
  `banzai doctor` invocations then discover the checkout with a bounded
  doctor-only Git diagnostic before progress, adapters, or `WorkflowRunner`.
  Ordinary runner Git errors retain their existing behavior. Doctor detects
  root project markers without imposing profile coverage, reports optional
  task-policy requirements, and never treats marker permission/I/O
  failure as confirmed `custom` absence. Unreadable marker evidence fails
  `project.types` and exports an empty project-type list. Doctor checks executable access relative to the checkout and
  reads only the active pointer/referenced state and runner lock through direct
  bounded readers. It also reads the Claude permission rules and workspace trust
  record a spawned session would honor, and fails readiness when the tools a
  Claude planning phase must call are ungranted or refused. Persisted repository roots must be absolute and compare
  through canonical identity. Its `banzai-doctor/v5` JSON is authoritative and
  the human report is a deterministic projection. It executes no configured
  command, authentication, model, recovery, or network path and writes no state,
  source, config, lock, approval marker, or report file. A fixed advisory says
  authentication was not checked and executable availability is not proof;
  startup preflight remains authoritative. Readiness exit status is advisory;
  workflow commands independently enforce the shared project-guidance prerequisite.
- Release confidence: `release-policy.json` is the single machine policy read
  by validation and live compatibility. Required CI and local gates remain
  deterministic, non-TTY, credential-free, and vendor-free. Live compatibility
  is a separate explicitly confirmed path that clones the exact clean candidate
  twice, copies bounded out-of-repository subscription auth into disposable
  client roots, performs at most one reviewer call per vendor, retains only a
  closed summary, and removes candidate, raw, and auth material. Codex denial
  evidence requires a failed exact runner-owned write-probe command event using
  either the direct command or a fully anchored supported `sh`/`bash`/`zsh`
  `-lc` wrapper; prefixes, suffixes, operators, and trailing arguments fail
  closed.
  Claude evidence requires a typed host init inventory containing required
  read tools and no mutation or unknown capabilities. This proves capability
  exclusion, not an attempted-write denial. Both scenarios validate v2 scope
  and runner publication. Model prose, requested arguments and unchanged files
  alone cannot satisfy permission evidence. Missing auth is `unavailable`, not pass; a confirmed
  permission failure remains a release blocker by policy even though the
  GitHub Actions job is mechanically advisory.
- Error propagation: failures raise `BanzaiError` with a stable code, which
  `cli.ts` turns into a message and exit code. A phase failure records
  `blockReason` and `blockedFrom`, the typed `failureCause`, the usage the
  failed process had already spent, and its redacted streams, and preserves the
  failed attempt. Failed usage is added to `state.metrics.usage` but never to
  `completedAttemptIds`, so consumption is truthful while no verdict, review, or
  finding metric can be derived from a failed attempt. Failed
  selection, planning, and review attempts are explicitly retryable.
  Downstream review validation retains the already captured result, redacted
  stdout/stderr, candidate bytes/digest, exact validation error, and typed
  failure code while leaving canonical review JSON and `latestReview`
  unchanged. New review rendering/validation failures invoke no formatting
  repair model. Historical repair invocations and their usage remain readable
  without replay or double accounting. Matching immutable terminal proof and
  snapshot can regenerate an absent candidate and reconcile canonical JSON,
  event and state once after publication/application interruption.
  Interrupted selection and source-read-only review attempts are also
  explicitly retryable; failed, interrupted, stale, malformed, or blocked
  review evidence forces the repeated unfinished iteration to use a fresh full
  reviewer.
  Interrupted planning and mutable attempts (implementation, fix) remain
  non-retryable because their repository side effects may be partial.

## 7. Dependencies

- Core toolchain (section 2): Node.js
  `>=22.20.0 <23 || >=24.11.1 <25`, npm workspaces, TypeScript `^5.9.0`,
  esbuild `^0.25.0`.
- Runtime dependencies: `@inquirer/prompts` `^8.5.2` for the standard
  interactive terminal UI and `@inquirer/core` `^11.2.1` for the collapsed
  bracketed-paste request input; both are isolated behind `InteractiveIO` in
  `inquirer-io.ts`.
- Dev dependencies: `esbuild` `^0.25.0` (build, dist check, and test bundling),
  `typescript` `^5.9.0` (typecheck only), `@types/node` `^24.0.0`,
  `eslint` `^10.8.0`, `@eslint/js` `^10.0.1`, `typescript-eslint` `^8.65.0`,
  `globals` `^17.8.0`, `prettier` `^3.9.6`, `eslint-config-prettier` `^10.1.8`.
  All of them are declared on `@parabolic-technologies/banzai`, not on the root
  package.
- Everything else uses Node built-ins. The test runner is `node --test`; no test
  framework is installed.
- External executables required at run time, not installed by npm: `codex`
  `0.145.0+`, `claude` `2.1.218+`, and `git`.
- Policy: any new runtime or dev dependency requires explicit user approval and
  a manifest update. Pre-existing dependencies need no retroactive approval.

## 8. Testing

- Instruction assurance covers exact raw embedding and normalized extraction,
  phase/category byte accounting, per-call parity refusal and preserved
  continuation authority, doctor v5, standalone binding readers, and actual
  archive/bundle/map identity and privacy boundaries. Deterministic fixtures do
  not establish installed-client compatibility or model compliance.

- Framework: the Node.js built-in test runner (`node --test`) with
  `node:assert/strict`. Tests are written in TypeScript and bundled by esbuild
  into `.test-dist/` before execution while the two Inquirer packages remain
  external for their native ESM/CJS boundary; that directory is removed
  afterwards.
- Layout: `packages/orchestrator/test/<module>.test.ts` normally mirrors a
  `src` module. Cross-module contract tests and shared fixture modules are
  supported exceptions: `review-result-v2.test.ts` covers the v2 result,
  snapshot, renderer and store boundary with `review-fixtures.ts`;
  `test/helpers.ts` supplies temp git repositories, config fixtures,
  `commitAll` and byte-level tree snapshots. `test/hook.test.ts` covers
  `plugins/banzai/hooks/spec-gate.cjs`; script-level integration tests cover
  release transactions, validation, the gate and committed smoke.
- Import pattern: production code is imported with NodeNext ESM specifiers —
  `import { … } from "../src/<module>.js"` — and type-only imports are marked
  `type` because `verbatimModuleSyntax` is on.
- Naming: files are `<module>.test.ts`; test names are lowercase behavioral
  sentences describing the guarantee, for example `retry rejects failed mutable
attempts without another model call`.
- Isolation: vendor and verification processes are injected through the
  `ProcessRunner` interface and stubbed, so end-to-end workflow tests run in
  process against real temporary git repositories without invoking `codex` or
  `claude`. Filesystem-failure tests inject the failing root reader or use a
  self-referential marker symlink; they do not assume Unix mode bits deny a
  privileged CI user.
- Release-version assurance: `version-set.test.ts` and
  `release-validation.test.ts` exercise the version transaction in bounded
  temporary checkouts with injected filesystem/signal failures, child
  `SIGKILL`, frozen format-1 journals, and format-2 bootstrap/forward/refusal
  cases; `release-check.test.ts` proves the ordinary gate excludes both
  mutators. Detailed case inventories live in the feature test reports.
- Assurance policy: tests protect material observable guarantees and plausible
  regressions, prioritizing business rules, public or persisted contracts,
  authorization/security/privacy invariants, state and recovery behavior,
  decision tables, and confirmed defects. Test count, coverage percentage,
  private helpers, and syntactic branches are not completion targets unless an
  explicit approved project threshold says otherwise. Boundary fakes are valid
  when they preserve the production contract; implementation-mirroring mocks,
  hollow assertions, and duplicate evidence are not.
- Evidence level: use the smallest realistic level that protects the guarantee.
  One behavioral test may cover several requirements, existing or non-unit
  evidence may be sufficient, and a truthful recorded no-test or consolidation
  outcome is valid when added automation is not proportionate. Missing
  load-bearing contract or safety evidence remains actionable.
- Required suite: `npm run test` must pass completely; typecheck must be
  clean, lint must report 0 errors (7 known warnings, section 10), and
  `npm run build:check` must confirm committed `dist/` parity.
  Per-change test counts and covered guarantees are recorded in each feature's
  `test-report.md` / `implementation-report.md`, not here.
- PTY prerequisites: `test/setup-pty.test.ts` uses `test/pty-driver.py` and
  requires `python3` on `PATH` with its standard library only (`os.openpty`,
  `fcntl` and `termios` on the supported macOS/Linux hosts). Missing Python fails the
  suite with a prerequisite diagnostic; these journeys never skip. Each
  deterministic GitHub Actions lane checks `python3 --version` before the
  release gate. Python is a test dependency, not a CLI runtime dependency.
- Integration/e2e owner: deterministic release evidence runs locally and in
  GitHub Actions supported lanes. Actual vendor permission evidence is owned
  only by the protected manual live job or an explicitly authorized local live run;
  unit/integration evidence is never labeled as proof of hosted permission
  behavior.
- Final verification ownership: during orchestrated work, builders use focused
  affected tests and do not repeat supplied full-scope commands; the runner
  executes task-scoped checks after the phase. If supplied checks omit the
  manifest's applicable final suite, the builder runs it once and records the
  verification gap. Standalone skills own one final applicable suite unless the
  explicitly enabled shared engine proves equivalent evidence for an eligible check.
  Required release gates remain fresh. Review uses
  current runner results and reruns a complete command only for a concrete
  reproduction or missing/stale/inconsistent/material evidence reason.

## 9. Conventions

- Naming: `kebab-case` for files, directories, feature slugs, and skill names;
  `camelCase` for functions and variables; `PascalCase` for types and classes;
  `SCREAMING_SNAKE_CASE` for module constants and error codes. ADR files are
  `documentation/decisions/NNNN-<short-kebab-case-title>.md`.
- Formatting and linting: Prettier owns formatting for
  `packages/orchestrator/**` with `trailingComma: "none"` and
  `proseWrap: "preserve"`; everything else is Prettier's default, including
  `printWidth: 80`, double quotes, and semicolons. ESLint runs
  `typescript-eslint` `strictTypeChecked` plus `stylisticTypeChecked` with type
  information from `tsconfig.json`, and `eslint-config-prettier` last so no rule
  contests formatting. `scripts/**/*.mjs` and the import-policy ESM get
  syntax-level rules only, because they sit outside the TypeScript project.
  Production local dependencies use the exact runtime/additional-type-only
  policy projected by `eslint.config.mjs`; inline lint configuration is disabled
  for production source. Rule deviations belong in the flat config rather than
  scattered `eslint-disable` comments.
- TypeScript idioms enforced by `tsconfig.json`: `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, `forceConsistentCasingInFileNames`, `module` and
  `moduleResolution` `NodeNext`. Relative imports carry the `.js` extension;
  type-only imports are explicit.
- File/module organization: one responsibility per `src` module, flat, no
  barrel files. Shared types live only in `types.ts`; every `RunStatus` change
  goes through `state-machine.ts`; the prompt library is confined to
  `inquirer-io.ts`.
- Error handling: throw `BanzaiError` (or `ProcessExitError`) with a stable
  upper-snake-case code and a message that names the resolution. Decode all
  external JSON through `validation.ts` before use. Fail closed on
  authorization; the hook fails open only for an unrecognized payload in manual
  mode.
- Logging: no logging framework. Human progress goes to stderr via
  `TerminalProgressReporter`; stdout carries only command results and JSON.
  Retained evidence is redacted before it reaches disk.
- Localization: none. English only.
- Documentation: Markdown prose wraps at 80 columns (tables and link-heavy
  lines are exempt). Skills are terse and imperative with `name`,
  `description`, and `user-invocable` frontmatter, plus
  `disable-model-invocation` on Claude user-invocation-only skills. Codex
  invocation policy lives in `skills/<name>/agents/openai.yaml`; explicit-only
  skills set `policy.allow_implicit_invocation: false`. Feature, plan, decision,
  and change artifacts follow the layout in section 4.
- Commits: `<type>(<slug-or-name>): <summary>` with `type` in `feat`, `fix`,
  `test`, `docs`, `chore`. Commit only when the engineer asks.
- Release hygiene: root `package.json.version` is the sole authority for one
  canonical Banzai release-train version. Its eight mirrors must agree: the
  four plugin/marketplace fields, `packages/orchestrator/package.json`, and
  the top-level, root-package, and workspace-package version fields in
  `package-lock.json` (nine fields across seven files).
  `.claude-plugin/marketplace.json` stays versionless. Use only the explicit
  `version:set` transaction after human target selection; read-only validation
  fails on drift or any retained `.banzai-version-set`, cleanup guard, or guard
  temporary. Recovery authenticates any coexisting journal remnant against the
  cleanup guard before restoration or recursive cleanup. Record plugin and
  orchestrator delivery/installed state separately, use explicit contracts for compatibility, and rebuild and commit
  `packages/orchestrator/dist/` in the same change as any `src` edit.
- Agent tooling: `.serena/project.yml` sets the TypeScript language server,
  ignores `assets/**`, and disables Serena memory and
  onboarding tools on purpose — durable guidance belongs in committed
  repository documentation.

Additional established conventions for this repository:

- English only in committed artifacts.
- Prefer direct control flow and clear names.
- Keep functions/modules small and single-purpose.
- Use standard language/toolchain features before custom machinery.
- Introduce an abstraction only after repeated real need or an approved
  testability seam.
- Avoid speculative options, unused extension points, framework-within-framework
  code, and clever one-liners.
- Comments explain why: constraints, trade-offs, invariants, side effects,
  temporary workarounds.
- Do not write comments that restate names, types, or steps visible in the
  code.
- Doc comments belong on public/exported APIs only when they add contract,
  units, ranges, side effects, failure modes, examples, or migration notes.
- TODO format: `TODO(scope): action` with ticket when one exists.

## 10. Technical Constraints & Decision Index

Current constraints:

- Minimum versions and platforms: supported Node.js 22 from 22.20.0 and Node.js
  24 from 24.11.1, excluding Node 23 and 25; macOS or Linux; `codex` `0.145.0+`;
  `claude` `2.1.218+`. Node 26.7.0 is advisory forward evidence only. A lower
  live CLI version produces unavailable evidence before a model call.
- Authentication: individual subscription only. API keys and third-party
  provider authentication are rejected, and API-key environment variables are
  stripped from every child process. `CLAUDE_CODE_OAUTH_TOKEN` remains available
  as Claude Code's explicit subscription-token path. When Claude reports logged
  out under `CODEX_SANDBOX`, preflight emits
  `CLAUDE_AUTH_UNAVAILABLE_IN_SANDBOX` because the parent sandbox can hide the
  credential store, including macOS Keychain, while explicitly treating
  credential existence as unproven; it does not retry login or attempt to escape
  the sandbox. Invalid structured auth output and non-zero auth-status
  invocation have distinct safe classifications. Consequence: `claude auth
status` reports only whether credentials are visible and stored, so a
  present-but-unrefreshable session passes the startup check and fails when a
  phase calls the model.
- Claude tool permissions: Claude phases run with `--permission-mode dontAsk`,
  so only three surfaces can grant a call — the spec-gate hook's approved
  bundle, an `--allowedTools` entry, and the permission rules of the loaded
  settings sources. Planning phases carry no runner identity by design, so their
  artifact writes depend on the third surface alone, and shell commands are
  never hook-granted in any phase. Startup preflight audits exactly the sources
  the resolved scope loads, honors administrator policy settings, and treats an
  untrusted checkout as having no repository rules at all. A missing or refused
  `Write` grant ends the run before its first phase with one remediation;
  `Edit`, `Bash`, and path-scoped gaps are reported and the run continues.
- Codex host state: every Codex preflight requires non-mutating write-access
  evidence for the effective `CODEX_HOME` before spawning the CLI. A denied
  directory under `CODEX_SANDBOX` is a host-permission prerequisite, not proof
  of SQLite contention, corruption, or logout, and is reported before an
  attempt can become mutable. The supported recovery is the same Banzai action
  in a regular terminal or through explicit host approval outside the parent
  sandbox; Codex's model-facing sandbox setting cannot widen inherited host
  permissions.
- Model currency is a source fact in `packages/orchestrator/src/models.ts`,
  updated by hand when a model ships, is deprecated, or is retired. An
  unrecognized identifier is never reported as stale.
- Interactive setup: `banzai setup` requires a TTY and existing config. TTY
  `init` offers setup after model selection, and new-task entry offers it before
  task input. Both TTY and non-TTY `init` create
  `documentation/verification-examples.md` when missing before any
  client launch, preserve existing guide bytes, and report Created/Kept.
  Non-TTY `init` creates configuration and renders manual next steps;
  bare non-TTY entry prints help. A fresh foreground Codex or Claude session
  receives only the explicit project-manifest invocation, without workflow
  grants or headless phase permission settings. Client exit triggers bounded
  reinspection and never submits a task. Guidance readiness is distinct from
  application verification readiness.
- Runner safety boundary: one active run per checkout; no worktrees, branch
  switching, stash, reset, commit, or external writes. Uncommitted changes
  present at start are recorded and excluded from the reviewed set. Plan
  approval snapshots the exact approved artifact bytes under
  `.banzai/runs/<run-id>/approval/`; the operator-invoked `banzai restore`
  rewrites the approved paths with those digest-verified bytes when the bundle
  was externally mutated, and pre-attempt implementation/fix check failures
  caused by an invalidated approval are retryable like review checks. Both
  reviewers return one structured review-result v2 and cannot write repository
  paths. The runner owns the attempt candidate and atomically publishes only
  validated proof bytes to the exact bound review path only on success
  (the historical documentation path remains the legacy layout).
- Project adoption (ADR-0040): new starts inspect complete guidance before
  authentication/run creation and again under ownership. Model-bearing
  continuations check instruction layout before attempts; a
  `PROJECT_SETUP_REQUIRED` refusal leaves the last durable checkpoint, saved
  decisions, prior failures, retry/recovery authority and usage unchanged.
  Run-authored manifest changes do not stop continuation. Status, cancellation,
  restoration and evidence remain available. Repair layout manually for an
  unfinished run, or explicitly cancel before CLI setup.
- Git startup prerequisites: interactive entry requires a readable Git checkout.
  An unborn branch can complete `init` and `setup`; a committed `HEAD` is required
  before collecting or starting a new task. Missing initialization reports
  `GIT_REPOSITORY_REQUIRED`; an unborn branch reports
  `GIT_INITIAL_COMMIT_REQUIRED`. Both name the manual remedy and exit with code
  1. Run creation also enforces the committed baseline.
- Recovery eligibility (ADR-0023/0024): without a terminal checkpoint, an
  interrupted mutable attempt or a typed `capacity`, `timeout`, or `transport`
  failure may be recovered through an exact current-workspace recovery identity
  plus a closed human side-effect acknowledgment into one linked new attempt;
  `process_start` and `unclassified` failures stay fail-closed. When completion
  validation already rejected a checkpointed result with
  `PLAN_TASK_COMPLETION_INVALID`, the bounded evidence-repair retry takes
  precedence over checkpoint reconciliation on every surface, and repeated
  resume is a no-op rather than a replay of invalid evidence.
- Strict plan completion: persisted orchestrator status and `nextAction` own
  lifecycle; approved plan checkboxes remain immutable; phase-result v4 owns
  exact `TNNN` completion through one versioned structured ledger (schema 1).
  New strict implementation and fix attempts run under
  `banzai-completion-protocol/v1` (ADR-0047): the task-mode attempt record is schema 4
  with the persisted protocol marker and nullable `retryOf`, both vendor
  adapters decode the result through the protocol-selected safe envelope
  (exact keys, versions, phase, outcome/gate pairing, artifacts, questions and
  finding identities validated while `taskCompletion` stays a bounded
  unaccepted value until the ledger parser succeeds), terminal proof is
  `banzai-terminal-attempt-checkpoint/v3`, and the model returns claims plus
  report narrative without authoring the **Plan Task Completion** table. A
  completed result becomes `pending_application`; the runner then captures the
  report and workspace identities the v3 terminal checkpoint recorded when the
  vendor returned into immutable attempt-owned evidence, accepting current
  bytes only while they still equal that proof and refusing a claim with no
  durable terminal observation, validates the claims, renders the report section as the delimited
  `banzai-plan-task-completion/v2` region (every ASCII punctuation code point
  of the JSON cells encoded as a decimal numeric character reference, decoded
  exactly once, all bytes outside the region preserved, exactly one existing
  legacy or v2 section replaced), persists the candidate, publishes it,
  records a `banzai-completion-publication/v1` receipt naming the ledger
  author and the publisher, and only then applies the result, writes the
  summary (schema 2 with `completionProtocol`, `publisherAttemptId` and
  receipt identity) and emits `completion.publication_applied`. Stop results
  keep their gate with retained completion diagnostics and publish nothing.
  Invalid completed claims and structurally ambiguous report input fail the
  attempt with `PLAN_TASK_COMPLETION_INVALID` and `completion.input_rejected`;
  publication I/O, drift and integrity failures leave the attempt
  `pending_application` with the closed refusal codes
  `COMPLETION_PUBLICATION_IO` (resume retries the deterministic publication),
  `COMPLETION_PUBLICATION_DRIFT` (cancel until the exact recorded input or
  proven output and authority are restored, then resume) and
  `COMPLETION_PUBLICATION_INTEGRITY` (cancel), evented once as
  `completion.publication_refused`. Publication authority covers the base
  commit, approval, plan tasks, attempt scope, work binding and the implementer
  configuration and session context, which are compared with the terminal
  checkpoint before a missing capture is created and with the capture on later
  continuation because `.banzai/config.json` may be absent from the non-report
  workspace digest. Capture and receipt identity-bearing timestamps derive from
  the durable terminal observation rather than retry time. Ordinary cursor
  state-write failures and follow-on refusal state/event persistence failures
  remain on the publication path instead of rewriting the model attempt as
  failed; a durable refusal event is appended once on resume before publication
  continues. A completed protocol attempt interrupted before its durable
  summary, cursor and events stays on the protocol path and finishes those
  writes idempotently from its retained receipt. Downstream boundaries revalidate a
  published completion strictly read-only against the receipt, the final report
  hashes, the ledger author and the published region; a changed report byte is
  `summary_mismatch`. Historical runs keep their model-authored
  `banzai-plan-task-completion/v1` projection and summary schema 1 with the
  original decoders, including the single-backtick-pair and single-rejoin
  compatibility rules. Missing, malformed, duplicate, unknown, out-of-order,
  out-of-scope, or contradictory evidence fails closed before verification and
  review. Per ADR-0025, an accepted-finding fix whose changes made the recorded
  evidence stale may return a complete refreshed ledger — same approved task
  set and order, statuses unchanged, validated by the identical fail-closed
  pipeline, republished by the runner, summarized with
  `sourceAttemptKind: "fix"` (absent means implementation) and evented as
  `plan_task_completion.refreshed`; a null-ledger fix republishes the retained
  canonical ledger with a new publisher receipt and the original ledger author.
  A fix never edits the published region (an edit inside it confers no
  authority and is replaced at publication), and a status downgrade is never a
  refresh — it still escalates. When revalidation or fix-ledger validation
  rejects the evidence, retry offers the completion-evidence repair from the
  blocked state as one linked `<kind>-repair-<hex>` successor with `retryOf`
  (a fresh implementation attempt, or a fresh fix rerun when the rejected
  ledger came from a fix). The repair corrects the claims or the ambiguous
  report ownership and returns a corrected ledger with `gate=escalation` when
  an accepted review finding showed a record was overstated. A failed implementation attempt whose
  `failureCode` is `PLAN_TASK_COMPLETION_INVALID` is repair-eligible even when
  its result failed decoding (for example a completion field over the
  500-character single-line bound) and no result was stored; the repair prompt
  includes the persisted failure diagnostic, and writing prompts state the
  ledger field bounds up front. The canonical Implementation Tasks grammar is
  validated before a plan result may raise the approval gate and again at
  `approvePlan` against the exact bytes being approved, so a malformed heading
  fails a retryable plan attempt instead of surfacing post-approval. When an
  invalid completion checkpoint nonetheless carries a plan-bundle violation
  (`approved_plan_invalid`, `approval_invalid`), retry reruns planning —
  voiding the recorded approval and clearing the stale checkpoint for a fresh
  plan-approval gate — because a new implementation attempt can never repair a
  defect in the immutable approved plan. Strict implementation and fix prompts carry the
  run's recorded human decisions — as selection, planning, and lite
  implementation prompts already did — with the rule that a recorded answer is
  authoritative and a question it covers is never re-raised as a new
  escalation. After a fix changes tests, verification commands, or their
  results, the fix prompt and shipped `quick-fix` skill require a complete
  test-count and command-result claim sweep across the current
  `test-report.md`, `implementation-report.md`, and the fix change report.
  Every claim must be updated from evidence actually run in the fix or scoped
  explicitly as `historical/pre-fix`; runner-owned final evidence remains
  `pending at fix handoff`, with durable runner evidence owning the eventual
  result, and the three artifacts must not carry contradictory current totals. Historical
  runs remain read-only evidence with legacy/unknown completion where applicable;
  their readers do not authorize continuation or migration. Standalone work without
  external evidence still uses mutable plan checkboxes.
- Current bootstrap: every new route begins at state 8 with private binding 2
  and a nullable completion cursor. Strict completion uses the existing protocol
  directly, without a legacy state-transition record. Snapshot 6/rendered review
  7 freeze task verification and completion receipt identities. Independent
  review assesses requirement coverage and unjustified weakening of checks.
  Historical snapshot/phase/result readers retain their original semantics.
- Agent-control schemas are independently identified as current
  `banzai-agent-capabilities/v6`, `banzai-agent-status/v5`, and
  `banzai-agent-answer/v3` for configuration, plus preserved consultation
  `banzai-agent-answer/v2`, `banzai-agent-request/v1`,
  escalation `banzai-agent-answer/v1`, and `banzai-agent-recovery/v1`, with
  control contract version `6.0.0`. Capabilities v6 declare task verification and the completion
  publication protocol, stages, refusal codes and the `pending_application`
  attempt status; status v5 includes bounded task dispositions and completion publication state.
  Compatibility is the exact capability declaration, not the
  package version. The optional `orchestrate` skill is invocable only by an
  explicit user invocation: Claude Code uses
  `disable-model-invocation: true`, while Codex uses
  `policy.allow_implicit_invocation: false`. It must fail closed on mismatch or
  runner-owned recursion and preserve all existing human-decision, retry,
  authentication, and completion-evidence authorities.
- Contract version `1.0.0`. Schemas passed to model CLIs must stay inside the
  OpenAI Structured Outputs subset: closed objects, all properties required,
  explicit types on `enum` and `const`, no schema-only uniqueness keywords.
  Remaining invariants are enforced by the runtime validators.
  `assertContractParity()` fails at startup on any mismatch.
- Strict session policy: compatible planning, implementation, and accepted
  fixes share a builder lineage; review never receives builder context. Primary
  review is fresh/full, routine re-review is resumed/delta, and any required
  rotation is automatic. A failed review attempt rotates only when its typed
  cause is not integrity-neutral: `capacity`, `timeout`, `process_start`, and
  `transport` preserve the reviewer session and its reviewed-workspace digest so
  the retry stays resumed/delta, while `unclassified` and every existing
  contract, artifact, drift, and approval condition still force fresh/full. A
  recorded session invocation digest that no longer matches rotates as
  `session-inventory-changed` before a process starts; an observed inventory
  mismatch on a resumed session emits `review.inventory_changed` and rotates the
  next review. Bindings written before this evidence existed are unknown and
  never rotate on that basis. Session memory is disposable; approved artifacts,
  current source, verification, digests, and human decisions remain
  authoritative.
- Engineering Quality policy: ADR-0030 is implemented by the single
  vendor-neutral policy in `plugins/banzai/policies/engineering-quality.md` and short projections
  through existing discovery, planning, implementation, review, fix, report,
  and evaluation surfaces. The current release is shadow-only for EQ-native
  concerns: an ordinary finding may receive one primary mapping only after its
  severity/verdict freezes, while an additional candidate remains free-form
  deferred coverage with no triage, acceptance, fixer, completion, gate, or
  blocker effect. Runner rendering preserves each structured shadow string
  without parsing it; standalone reviewer-owned Markdown retains the same
  opaque content. The policy carries the
  approved threshold for any separately authorized future blocker proposal.
  Release validation protects the exact canonical section and convergence
  language, and additionally the single `### Structural Assessment Triggers`
  heading, the ordered four-section `plugins/banzai/guidance/code-design.md`
  method within its 2,400-byte budget, the five consumer skills' anchors, and
  its absence from review guidance, `feature-review` and `test-writing`
  (ADR-0050 stages 1 and 2a). Semantic quality remains reviewer judgment measured by sampled
  evaluation. No runtime contract, validation, state, hook, phase, gate,
  dependency, configuration, analyzer, skill, or test-selection owner changed.
- Strict completion policy: a passing latest review completes normally. A
  complete triage with zero accepted findings also completes, without a fixer,
  verification, or unchanged-source reviewer call; the persisted latest verdict
  remains `changes_requested`, and human output labels the distinct triage basis.
  Any accepted finding retains the existing accepted-only fix, final
  verification, bounded re-review, rotation, and maximum-cycle behavior.
- The committed `packages/orchestrator/dist/banzai.mjs` and `.map` must match a
  fresh build byte-for-byte; `npm run build:check` is part of `npm run verify`.
- Evaluation export contract `banzai-evaluation-export/v1` is independent of
  run-state and model-result schema versions. Its CLI is stdout-only, offline,
  read-only, privacy-minimized, deterministic, and coverage-aware; incompatible
  field, privacy, or aggregation changes require a new evaluation version. Its
  `humanMinutes` metric remains unavailable in v1 (ADR-0034 keeps human-time
  evidence in the private run-local ledger).
- Derived-KPI contract `banzai-evaluation-kpi/v1` is a pure function of
  complete export v1 objects and of nothing else (ADR-0026): per-run evidence
  only, per-source independence, fail-closed input decoding and configuration
  attribution, and deterministic output. KPI semantic changes require a new
  KPI version; the export version never moves for a KPI change.
- Context contracts `banzai-context-attempt/v1` and
  `banzai-context-report/v1` are runner-owned and independent of the umbrella,
  evaluation-export, and KPI contracts. Context-report semantic or privacy
  changes require a new context-report version; no context field may be added
  to either frozen evaluation contract.
- Doctor contract `banzai-doctor/v5` is an independent fixed-order local
  diagnostic (`schemaVersion: 5`), with JSON-authoritative checks carrying
  `id`, `category`, `status`, `message`, `fixes`, and `roles`. Verification
  failures include actionable remedies. Codex roles are informational
  `not_applicable`; pinned Claude parity can verify or fail on mismatch.
  Ambient/unresolved scopes are unverifiable; their only remedy is ambient.
  Rebuild/update remedies apply only to mismatch/bounded failure. Doctor runs
  no configured command, vendor path, network, or write. Exit 0 means no failed
  check; warnings do not fail readiness. Historical v1-v4 reports retain their
  identities. Workflow preflight independently enforces guidance and confirmed
  instruction mismatch before model attempts; current task mode does not require
  configured profile coverage.
- Doctor inspects root Node, PHP, Python, Go, Rust, Ruby, JVM and .NET markers,
  or reports `custom` when no known marker is present. Unreadable or invalid
  marker evidence is a bounded diagnostic failure. Current task verification
  requires no project-type profile, bootstrap flag or configured substantive
  coverage. Missing tests/tooling are valid initial states; task obligations and
  optional project policy determine what must be satisfied before completion.
  Doctor checks executables declared by required task policy without running
  them. Retained legacy profile inspection utilities keep their historical
  matching and hygiene semantics; those utilities do not gate new tasks or
  authorize old-run continuation.
- Build-time coupling: `src/contracts.ts` imports JSON from
  `plugins/banzai/contracts/`, outside the workspace. A contract edit is not
  live until the orchestrator is rebuilt. The same explicit-build rule applies
  to phase, guidance and policy resource bodies; all repeated prompt bytes are
  measured under existing context categories, with output contracts separate. `src/live-compatibility.ts` also
  embeds root `release-policy.json`; policy edits require the same rebuild.
- Required GitHub Actions jobs run the complete deterministic release gate on
  each supported Node lane. Forward and live jobs are advisory; unavailable forward
  or live evidence is never pass, and automation never authorizes a release.
- Lint and formatting still cover `packages/orchestrator/**` only. The explicit
  release validator separately covers plugin skills, contracts, packaged hook,
  marketplace copies, policy docs, hook syntax, release metadata, and fresh
  byte parity for the committed bundle and source map. Its parity-only internal
  reuse of `check-dist.mjs` omits that script's dependency-requiring CLI smoke;
  ordinary `npm run build:check` and `npm run smoke:committed` retain their full
  smoke semantics.
- Lint debt: 7 `@typescript-eslint/no-base-to-string` warnings in
  `src/adapters.ts`, where `String(<unknown> ?? "")` coerces untrusted vendor
  JSON before comparing it to a literal. The rule is set to `warn` so the count
  stays visible without blocking `verify`. Behaviour is correct today — a
  non-string field simply fails the comparison. Removal condition: replace the
  coercions with a `typeof`-guarded helper, which changes adapter behaviour at a
  trust boundary and therefore needs its own approved change.
- No `.banzai/config.json` and no tracked `.claude/settings.json` exist at this
  repository root: the orchestrator is not configured to run against its own
  source, and the only root Claude settings file is the ignored
  `.claude/settings.local.json`. `plugins/banzai/.claude/settings.json` is
  packaged plugin content, not this repository's configuration.
- Current Banzai release-train version is `2.6.2`, owned solely by root
  `package.json.version` and mirrored by four plugin/marketplace fields, the
  orchestrator package, and three `package-lock.json` fields (top-level, root
  package, and workspace package). All nine fields across seven files agree.
  The root remains private; `.claude-plugin/marketplace.json` stays versionless.
  The two components remain independently usable and separately deliverable,
  while source-version skew is invalid.

Decision index:

The canonical decision log, including rejected and superseded decisions, is
`documentation/decisions/README.md`. This index lists only active accepted
ADRs with their implementation state. ADR rationale, consequences, and
implementation history stay in the ADR bodies and private work records;
see `documentation/historical-references.md` for archived references. Do not
restate them here. Paths are relative to `documentation/decisions/`.

| ID       | Title                                                              | Path                                                            | State       |
| -------- | ------------------------------------------------------------------ | --------------------------------------------------------------- | ----------- |
| ADR-0001 | Automatic workflow selection                                       | `0001-automatic-workflow-selection.md`                          | Implemented |
| ADR-0002 | Session affinity and bounded reviewer continuity                   | `0002-session-affinity-and-bounded-reviewer-continuity.md`      | Implemented |
| ADR-0003 | Versioned evaluation export contract                               | `0003-versioned-evaluation-export-contract.md`                  | Implemented |
| ADR-0004 | Privacy-minimized read-only evaluation boundary                    | `0004-privacy-minimized-read-only-evaluation-boundary.md`       | Implemented |
| ADR-0005 | Traceable evaluation aggregation                                   | `0005-traceable-evaluation-aggregation.md`                      | Implemented |
| ADR-0006 | Versioned verification profiles                                    | `0006-versioned-verification-profiles.md`                       | Implemented |
| ADR-0007 | Project-type verification readiness                                | `0007-project-type-verification-readiness.md`                   | Implemented |
| ADR-0008 | Read-only doctor diagnostics                                       | `0008-read-only-doctor-diagnostics.md`                          | Implemented |
| ADR-0009 | Supported Node release matrix                                      | `0009-supported-node-release-matrix.md`                         | Implemented |
| ADR-0010 | Blocking and advisory release evidence                             | `0010-blocking-and-advisory-release-evidence.md`                | Implemented |
| ADR-0011 | Protected live vendor compatibility                                | `0011-protected-live-vendor-compatibility.md`                   | Implemented |
| ADR-0013 | Risk-driven test assurance                                         | `0013-risk-driven-test-assurance.md`                            | Implemented |
| ADR-0014 | Human-triaged review closure                                       | `0014-human-triaged-review-closure.md`                          | Implemented |
| ADR-0015 | Durable verification attempt ledger                                | `0015-durable-verification-attempt-ledger.md`                   | Implemented |
| ADR-0017 | Versioned plan task completion ledger                              | `0017-versioned-plan-task-completion-ledger.md`                 | Implemented |
| ADR-0018 | Agent-supervised Banzai CLI control                                | `0018-agent-supervised-banzai-cli-control.md`                   | Implemented |
| ADR-0019 | Attempt-owned review candidates                                    | `0019-attempt-owned-review-candidates.md`                       | Implemented |
| ADR-0020 | Scoped Claude subprocess environment                               | `0020-scoped-claude-subprocess-environment.md`                  | Implemented |
| ADR-0021 | Failure-classified reviewer continuity                             | `0021-failure-classified-reviewer-continuity.md`                | Implemented |
| ADR-0022 | Availability-gated Serena MCP whitelist                            | `0022-availability-gated-serena-mcp-whitelist.md`               | Implemented |
| ADR-0023 | Durable terminal attempt checkpoints                               | `0023-durable-terminal-attempt-checkpoints.md`                  | Implemented |
| ADR-0024 | Operator-authorized prerequisite-blocked fix recovery              | `0024-operator-authorized-prerequisite-blocked-fix-recovery.md` | Implemented |
| ADR-0025 | Fix-authored completion ledger refresh                             | `0025-fix-authored-completion-ledger-refresh.md`                | Implemented |
| ADR-0026 | Derived evaluation KPI projection contract                         | `0026-derived-evaluation-kpi-projection-contract.md`            | Implemented |
| ADR-0027 | Exposure-driven security assurance                                 | `0027-exposure-driven-security-assurance.md`                    | Implemented |
| ADR-0028 | Phase context accounting and budget policy                         | `0028-phase-context-accounting-and-budget-policy.md`            | Implemented |
| ADR-0029 | ESLint-backed orchestrator import boundary policy                  | `0029-eslint-backed-orchestrator-import-boundary-policy.md`     | Implemented |
| ADR-0030 | Vendor-neutral Engineering Quality policy                          | `0030-vendor-neutral-engineering-quality-policy.md`             | Implemented |
| ADR-0031 | Interactive decision consultation                                  | `0031-interactive-decision-consultation.md`                     | Implemented |
| ADR-0033 | Root package version authority                                     | `0033-root-package-version-authority.md`                        | Implemented |
| ADR-0034 | Durable human-time observations                                    | `0034-durable-human-time-observations.md`                       | Implemented |
| ADR-0035 | Cancellation observations and report                               | `0035-cancellation-observations-and-report.md`                  | Implemented |
| ADR-0036 | Vendor-neutral policy files and instruction delivery               | `0036-vendor-neutral-policy-files-and-instruction-delivery.md`  | Implemented |
| ADR-0037 | Unified runner-rendered review artifacts                           | `0037-unified-runner-rendered-review-artifacts.md`              | Implemented |
| ADR-0038 | Explicit plan authority                                            | `0038-explicit-plan-authority.md`                               | Implemented |
| ADR-0039 | npm trusted publishing on GitHub Release                           | `0039-npm-trusted-publishing-on-github-release.md`              | Implemented |
| ADR-0040 | Project adoption preflight and interactive setup                   | `0040-project-adoption-preflight-and-interactive-setup.md`      | Planned     |
| ADR-0041 | Artifact retention and publication boundary                        | `0041-artifact-retention-and-publication-boundary.md`           | Planned     |
| ADR-0042 | Runner-delivered phase instructions                                | `0042-runner-delivered-phase-instructions.md`                   | Planned     |
| ADR-0043 | Proportionate verification evidence                                | `0043-proportionate-verification-evidence.md`                   | Implemented |
| ADR-0044 | Instruction baseline evolution                                     | `0044-instruction-baseline-evolution.md`                        | Implemented |
| ADR-0045 | Guided verification setup and configuration prerequisite authority | `0045-guided-verification-setup.md`                             | Implemented |
| ADR-0046 | Supervised live end-to-end first task                              | `0046-supervised-live-e2e.md`                                   | Planned     |
| ADR-0047 | Runner-owned completion projection                                 | `0047-runner-owned-completion-projection.md`                    | Implemented |
| ADR-0048 | Completion markup and viewer enrichment boundary                   | `0048-completion-markup-and-viewer-enrichment-boundary.md`      | Implemented |
| ADR-0049 | Task-scoped verification authority                                 | `0049-task-scoped-verification.md`                              | Implemented     |
| ADR-0050 | Triggered code-design assessment                                   | `0050-triggered-code-design-assessment.md`                      | Planned     |
