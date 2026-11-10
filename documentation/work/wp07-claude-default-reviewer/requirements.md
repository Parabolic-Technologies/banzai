# WP7 · Claude as the default reviewer, with reviewer isolation

Status: approved on 2026-11-06 with `Approve, all (a)` · Program:
[banzai 2.8–2.9](../release-2-8-2-9-program/tracker.md) · Source:
[brief, WP7](../release-2-8-2-9-program/brief.md#wp7--claude-as-the-default-reviewer-with-reviewer-isolation)

## Problem

`DEFAULT_CONFIG` in `packages/orchestrator/src/config.ts` reviews with Codex
`gpt-6.1-sol`, so a developer with only Claude Code must edit the shared
configuration before the first run. `documentation/orchestrator.md` says that a
reviewer from a different vendor "is the point of the loop".

A Claude reviewer today is not isolated from builder context:

- every Claude invocation loads auto memory, so a reviewer reads what a
  builder saved;
- review and planning review receive `Read,Glob,Grep,Skill`
  (`buildClaudeArguments` in `adapters.ts`), so a reviewer can run another
  review flow through `Skill`;
- a request that the safety classifier flags can continue on another model.

## Authority

- [ADR-0059](../../decisions/0059-claude-default-reviewer-and-reviewer-isolation.md),
  accepted on 2026-10-31 with `Accept all three`, with the owner choices of
  its section 5: reviewer effort `xhigh`; builders keep `Skill`; auto memory
  off for review roles in every mode and for builders in `scoped` mode. The
  ADR text is authoritative wherever this document is shorter.
- ADR-0059 amends ADR-0042 §7, ADR-0037 ("Read authority and standalone
  behavior") and ADR-0002; the reciprocal links are already recorded. It
  preserves ADR-0020 and ADR-0055.
- [ADR-0008](../../decisions/0008-read-only-doctor-diagnostics.md): doctor
  may use file-system metadata and reads and executable access checks. It
  must not invoke model or authentication CLIs, access a network or write a
  file.
- [ADR-0011](../../decisions/0011-protected-live-vendor-compatibility.md) and
  ADR-0046: the live summary is closed, with fixed check IDs; changing the v2
  summary alters existing evidence.
- Tracker owner decisions:
  - 2026-10-31: the release-train version is bumped at the Gate 1 release, so
    `HOOK_CHANGED_WITHOUT_VERSION_BUMP` alone does not block a package. WP7
    triggers it again, because `plugins/banzai/lib/artifact-readers.mjs`
    bundles `DEFAULT_CONFIG`.
  - 2026-11-02: doctor JSON v6 stays open until Gate 1, so Stage 1 packages
    extend it without another version bump.
- Gate 1 item: "A Claude-only developer installs at local scope from the
  terminal, leaves `.banzai/config.json` untouched through
  `config.local.json`, and gets Claude as the default reviewer."

No runner-delivered instruction text changes: no phase instruction names the
`Skill` tool, so WP7 needs no instruction-baseline transition.

## Requirements

- **R1 · Default reviewer (ADR §1).** `DEFAULT_CONFIG.models.reviewer`, and
  through it `DEFAULT_TASK_CONFIG`, become `executable` `claude`, `model`
  `claude-opus-5-5`, `effort` `xhigh`, `timeoutMs` 30 minutes.
  - `banzai init` writes it.
  - The model picker offers it as the default.
  - `banzai init` and `banzai model` keep offering every catalog model,
    Codex included, for every role.
  - A configuration that names a reviewer keeps it. No migration rewrites a
    committed or local model.
- **R2 · Review tool set (ADR §2).** Every Claude invocation for review,
  routine re-review and planning review gets:
  - `--tools Read,Glob,Grep`;
  - `--disallowedTools Skill,Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch`.

  The Serena `--mcp-config` and `--allowedTools` arguments and every other
  argument stay as they are today.

- **R3 · Planner-role read-only invocations keep their tools (ADR §3;
  reading 1).**
  - Planning analysis (`planning_analysis`) shares the read-only invocation
    with planning review. It keeps `--tools Read,Glob,Grep,Skill` and today's
    disallowed list.
  - Workflow selection keeps its current tool list.
  - Planning, implementation and fix phases keep theirs.
- **R4 · Review environment (ADR §2).** The child environment of every
  Claude review, routine re-review and planning review carries:
  - `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`;
  - `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK=1`.

  Both are set at the Claude call sites after `subscriptionOnlyEnvironment`
  has built the environment. An inherited value, including `0`, never
  survives. Both hold in `scoped` and `ambient` mode.
  `subscriptionOnlyEnvironment` in `process.ts` stays a pure credential
  filter.

- **R5 · Planner-role and builder environment (ADR §3).**
  - Claude planning, implementation, fixes, workflow selection and planning
    analysis carry `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in `scoped` mode,
    overriding an inherited value.
  - In `ambient` mode, and when no scope is supplied, their environment is
    exactly today's.
  - Banzai never adds `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK` to them. An
    inherited value passes through as it does today.
  - The mode is read from the resolved `ClaudeInvocationScope`:
    - `strictMcpConfig: true` is `scoped`, including the degraded scoped
      scope without a plugin directory;
    - `AMBIENT_CLAUDE_SCOPE` (`strictMcpConfig: false`) is `ambient`.

    No field is added to `ClaudeInvocationScope`, so the planner retry
    digest that hashes it (`workflow.ts`) keeps its value. No environment
    variable decides the mode.
- **R6 · Codex unchanged (ADR §2).** Banzai never adds either variable to a
  Codex child, and Codex arguments and environments for every role are
  byte-identical to today. As today, an inherited value passes through
  `subscriptionOnlyEnvironment`.
- **R7 · Pre-isolation reviewer sessions rotate (ADR §2, ADR-0002,
  ADR-0021).**
  - The digest compared for a Claude reviewer (`invocationScopeDigest` in
    `workflow.ts`) also covers the review isolation contract: the R2 tool set
    and the two variable names.
  - A session whose recorded digest predates this change therefore rotates
    to a fresh full review, with the existing reason
    `session-inventory-changed`.
  - Bindings without a digest keep today's rule, which is to treat them as
    unknown and never as a mismatch. Two cases produce such bindings:
    - sessions recorded before ADR-0021;
    - a review attempt that started before the upgrade and is recovered after
      it, because the recovery path applies the result without a digest.

    The report records both as known limits.

  - Codex reviewer sessions are unaffected.
- **R8 · Version floor at run start and launch (ADR §2).** One named
  constant beside `MINIMUM_CLAUDE_VERSION` in `adapters.ts` holds the review
  isolation floor; Q1 sets its value. The vendor preflight applies it
  whenever the checked target reviews. It refuses a client below the floor
  with `CLI_TOO_OLD`, naming the installed version, the floor and the reason.
  - **Run start.** The check runs once per vendor and executable pair, and it
    counts as reviewing when any role that shares the pair is the reviewer.
    The all-Claude default is therefore refused before workflow selection
    when its client is below the floor. Today this check uses only the first
    role of the pair (`workflow.ts`).
  - **Phase preflights.** The planning review and code review preflights
    apply it, as they already pass the reviewer role.
  - **Interactive launch header.** The launch check of
    `checkAuthentication` in `interactive.ts` applies it when the vendor
    entry's roles include the reviewer. `banzai init` and `banzai model` run
    no launch check and gain none.
  - **Live seam.** The live harness preflights its Claude reviewer with the
    floor.
  - **Builders.** A target that only builds is not subject to the floor.
- **R9 · Version floor in doctor (ADR §2, ADR-0008; Q2).** Under Q2 (a), a
  new doctor check `claude.version` enforces the floor and is added to
  doctor JSON v6.
  - **Scope.** It applies only when the effective reviewer, committed plus
    local, has an executable whose base name is `claude` (`vendorFor`
    returns `claude`). A fallback vendor never qualifies, so the
    Node-executable smoke repository is skipped.
  - **Position.** It sits in the `executables` category immediately after
    `executables.models`.
  - **Reading.** Doctor reads the installed version from the file system
    only. It resolves the reviewer executable through the same `PATH`
    candidates as `executableAvailable`, then takes its `realpath`:
    - native installer: the resolved file sits in a `versions` directory and
      is named by the version, as in `~/.local/share/claude/versions/2.1.319`;
    - npm: walking up from the resolved file, the first `package.json` found
      has `name` `@anthropic-ai/claude-code` or a platform package name
      `@anthropic-ai/claude-code-<platform>`, and its `version` is used. The
      walk stops at that first `package.json`. T1 confirms the layout
      before T7.
  - **Validation.** A version must match `^\d+\.\d+\.\d+$`; anything else
    counts as unreadable.
  - **Outcomes:**
    - **pass** at or above the floor;
    - **fail** below it, naming the installed version and the floor;
    - **warning** when no layout yields a valid version, saying that the run
      start enforces the floor;
    - **skipped** when the reviewer does not qualify, the configuration or
      the local layer is unusable, or the executable is unavailable.
  - **Guarantees.** It never runs a process and prints no path. Its fix
    links the getting-started section "Install and sign in to model
    clients".
  - **Superseded wording.** The `authentication.models` advisory and the
    documentation that say doctor does not check CLI versions change to say
    that doctor reads the Claude reviewer's version offline and checks no
    other version.
- **R10 · Flagged review requests (ADR §2).**
  - A Claude review or planning review that ends without a structured result
    fails through the existing typed handling, whichever of these causes it:
    - a non-zero exit with an error result;
    - a success result without `structured_output`, seen by the durable
      terminal observer or by the decode after the process closes.
  - The attempt is recorded, its message is shown, it is retry-eligible, and
    no review result is fabricated.
  - Since Claude Code 2.1.312 the variable also stops the model switch for
    model names the client does not recognize, so such a reviewer fails a
    flagged request too. The model-configuration documentation says so.
- **R11 · Live scenario (ADR follow-up, Compliance 7; Q3).**
  - The Claude review scenario in `live-compatibility.ts` requires that the
    host `system/init` inventory contain `Read`, `Glob` and `Grep`, and
    nothing else except the optional `StructuredOutput`. `Skill` now fails
    it.
  - Its prompt names only those three tools.
  - Under Q3 (a), a separate isolation condition applies to
    `claude.read_only_inventory` only, with its own failure code. It holds
    when both of these are true:
    - the spawned Claude review process carried both variables set to `1`,
      as the harness's wrapped runner sees;
    - the resolved client binary contains both variable names.
  - The other Claude checks keep their present conditions.
  - The check ID list and the `banzai-live-compatibility/v2` summary are
    unchanged.
  - The scenario runs only with the owner's explicit go-ahead, at Gate 1.
- **R12 · Documentation (ADR §4).**
  - `documentation/orchestrator.md`:
    - the principle sentence becomes the ADR's wording;
    - the review tool inventory passages and the live inventory passage;
    - the default-model parity sentence, which today names a Codex reviewer;
    - the model-configuration examples that show defaults;
    - the version-floor passage after the CLI table;
    - the doctor passages;
    - "Available inventories remain unchanged" in the progress section;
    - the refusal-fallback note of R10.
  - `documentation/getting-started.md`, root `README.md` and
    `packages/orchestrator/README.md`:
    - Claude Code serves every role by default;
    - the reviewer needs the floor version;
    - the Codex CLI is needed only when a role uses it.
  - `plugins/banzai/AGENTS.md`, Roles section:
    - reviewer independence comes from a fresh session, no shared memory and
      a fixed read-only tool set;
    - "cross-model context" becomes "review context".

    The only fixture compared byte for byte with it,
    `packages/orchestrator/test/fixtures/instruction-layouts/fresh-adoption/after/AGENTS.md`,
    gets the same text.

  - `packages/orchestrator/MODULES.md`: the doctor passage and any statement
    of review tools or default models.
  - Unchanged, and the report says why:
    - `claude-permissions.ts`, because a Claude reviewer depends on no
      permission rules;
    - `banzai setup`, a builder-side client launch under ADR §3;
    - the fix prompt's "full cross-model context" in `prompts.ts`, which
      describes the artifact the fixer reads.
- **R13 · Facts and lifecycle.**
  - `PROJECT_MANIFEST.md`:
    - default models;
    - minimum client versions, including the floor;
    - review isolation;
    - the doctor check;
    - the ADR-0059 row.
  - ADR-0059's implementation state becomes Implemented.
  - The reciprocal ADR-0059 lines in ADR-0042, ADR-0037 and ADR-0002 change
    "Implementation is Planned" to Implemented; only lifecycle metadata
    changes. None of these ADRs is pinned.
  - The decision index row and the tracker are updated:
    - the WP20 row becomes `committed` with `ebfcd3e`;
    - WP7 becomes `in progress` and then `report ready`;
    - Q3 (a) adds a deviation entry.

## Implementation readings

These follow from the accepted ADRs and need no owner decision. They are
listed so that the approval settles them explicitly.

1. **Planning analysis is a planner-role invocation (R3, R5).**
   - For this reading:
     - ADR-0055 §3 runs `planning_analysis` "with the `planner` role";
     - ADR-0059 §2 names only "review, routine re-review and planning
       review";
     - ADR-0059 §3 keeps `Skill` for builders;
     - ADR-0042 §7 keeps `Skill` unless amended.
   - Against it:
     - ADR-0055 §3 enforces read-only execution for both kinds through "the
       read-only adapter invocation used for review today";
     - ADR-0059 says that ADR-0055 inherits the decision "through that
       invocation".
   - The plan takes the first reading, because ADR-0059 §2 lists the review
     roles explicitly. The read-only guarantee is unaffected: planning
     analysis keeps the same denied mutation tools, hook denial and scope
     check.
   - Workflow selection is a planner-role invocation in the same way.
2. **Pre-isolation reviewer sessions rotate (R7)** through the existing
   ADR-0021 digest and rotation reason. Without that, a run that started
   before the upgrade could resume a reviewer whose transcript already holds
   builder memory.
3. **Doctor JSON v6 grows by one check (R9).** Adding `claude.version`
   extends v6 without a version bump, under the owner decision of 2026-11-02.

## Owner decisions

Answer all three at plan approval, for example
`Approve, Q1 (a), Q2 (a), Q3 (a)`.

### Q1 · Which Claude Code version is the review isolation floor?

Neither the Claude Code changelog nor its documentation says when
`CLAUDE_CODE_DISABLE_AUTO_MEMORY` or `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK`
was introduced. On 2026-11-06 both names occur in the locally installed
2.1.300, 2.1.316, 2.1.318 and 2.1.319 binaries.

- A name in a binary shows that the client reads the variable, not exactly
  what it does. The fallback variable's coverage grew in 2.1.312, and its
  occurrence count differs between 2.1.300 and 2.1.319.
- WP8 raises Banzai's Claude minimum to 2.1.290 in the same release. Gate 1
  runs the live scenarios on 2.1.290 and on the current release.

Options:

- **(a) Recommended: 2.1.290, checked before code relies on it.** T1
  downloads the `@anthropic-ai/claude-code-darwin-arm64@2.1.290` package
  (about 233 MB unpacked) from `registry.npmjs.org` into the session
  scratchpad. It counts both names in the binary, never runs it, and deletes
  it. If either name is missing or the download fails, WP7 stops and
  reports.
- **(b) 2.1.300, already checked locally; no large download.** A Claude
  reviewer then needs 2.1.300 even after WP8. On the Gate 1 run with 2.1.290,
  the default reviewer and the live reviewer scenario are refused.
- **(c) 2.1.290 without a binary check.** The Gate 1 live run on 2.1.290 is
  the only evidence.

### Q2 · How does doctor enforce the floor?

ADR-0059 §2 says that `banzai doctor` enforces the floor for a Claude
reviewer. ADR-0008 forbids doctor to run `claude --version`. The brief's WP8
section assumes that doctor "stays offline and does not check versions".

- **(a) Recommended: doctor reads the version from the file system (R9).**
  This satisfies both ADRs as written.
  - It reads the client's install tree outside the repository, as the WP5
    `claude.plugin-scope` check reads Claude settings.
  - It costs two install-layout readers and their tests.
  - It changes the `authentication.models` advisory and the documentation
    that say doctor checks no CLI version.
  - Any other layout gives a warning, and the run-start check still refuses
    an old client.
- **(b) Run-start check only; doctor reports no version.** This is simpler,
  but it departs from ADR-0059 §2. WP7 planning would stop for a short
  amending ADR before this plan could rely on it.

### Q3 · What must the live scenario prove about isolation?

ADR-0059 Compliance 7 says that the owner-authorized live scenario "confirms
the Claude reviewer's tool list and isolation", and its Consequences rely on
"the version floor and the live scenario" to catch a renamed variable. The
host cannot show that it honours the variables:

- its `system/init` event carries tools, MCP servers, plugins, skills and the
  client version, but no auto memory or fallback state;
- a classifier flag cannot be triggered safely.

The live scenario can show the inventory without `Skill`. It can also show
that the real adapter path spawned the reviewer with both variables, and that
the client binary still contains both names.

- **(a) Recommended: inventory, spawn environment and binary names (R11).**
  A rename then fails the live run, but host behaviour is still taken from
  the vendor's documentation. The tracker records a deviation from
  Compliance 7, which is confirmed only to this extent.
- **(b) Also add a canary memory note.** The harness writes a canary
  auto-memory note for the disposable repository under the Claude
  configuration directory, then requires that the review result does not
  echo it.
  - It writes outside the disposable repository.
  - It rests on model behaviour, so a pass is weak evidence.
  - It still records the deviation.

## Acceptance

1. With a `PATH` that holds only a `claude` executable at or above the floor,
   in the native layout, `banzai init` writes a configuration that names
   `claude-opus-5-5` for every role, and `banzai doctor` reports no failed
   check.
2. Argument and environment tests cover each phase and each mode (`scoped`,
   degraded scoped, `ambient`, no scope). They assert:
   - the tool list and the disallowed tools;
   - the presence or absence of each variable;
   - that an inherited `0` is overridden where Banzai sets a variable.
3. A configuration with a Codex reviewer runs with unchanged Codex arguments
   and environment, and doctor skips `claude.version` for it.
4. A Claude reviewer binding whose recorded digest predates the change rotates
   with `session-inventory-changed`. A binding recorded after the change
   resumes as before.
5. The run-start preflight refuses a client below the floor when it reviews.
   - With the default configuration, the refusal comes before workflow
     selection.
   - A client below the floor that only builds is accepted.
   - The interactive launch header passes the reviewer role to its gateway.
6. Doctor's `claude.version` passes, fails, warns and skips in the cases of
   R9, with no process spawned and no path printed.
7. A refused Claude review or planning review fails as a typed,
   retry-eligible attempt with no fabricated result.
8. The documentation, the manifest and the packaged template no longer say
   that a second vendor is required.
9. After WP7, the owner-authorized live scenario confirms what Q3 selects. It
   runs at Gate 1 and is not part of WP7's own checks.

## Out of scope

- Removing `Skill` from builders, and turning off the refusal fallback for
  builders (ADR §3).
- WP8:
  - Banzai's vendor-wide Claude minimum of 2.1.290;
  - background tasks;
  - Bash timeouts;
  - the prompt over stdin.
- Environment filtering beyond the two variables, and the deferred security
  track (brief, Out of scope).
- The `feature-review` skill description's "cross-model triage" and the fix
  prompt's "full cross-model context", which describe who reads an artifact,
  not a vendor requirement.
- Doctor version checks for builder roles or for model minimums.
- Persisting the invocation digest on review attempt records to close the
  recovery limit of R7.
