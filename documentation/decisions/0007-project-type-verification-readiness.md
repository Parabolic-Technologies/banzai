# ADR 0007: Project-Type Verification Readiness

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-04
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-04

## Related Artifacts

- Feature description:
  `documentation/features/project-verification-readiness/description.md`
- Feature plan:
  `documentation/development-plans/project-verification-readiness/plan.md`
  (created after acceptance and required to conform to this decision)
- Manifest: sections 3, 5, 6, 9, and 10 of `PROJECT_MANIFEST.md`
- Related decision: ADR-0006, Versioned Verification Profiles.
- Related accepted decisions: ADR-0001, Automatic Workflow Selection; ADR-0002,
  Session Affinity and Bounded Reviewer Continuity.

## Context and Decision Drivers

The current runner structurally requires at least one verification command but
does not assess its relevance. Its default and every fresh project's generated
config contain only `git diff --check`. That check is valuable repository
hygiene but provides no test, compile, type, lint, or other project-specific
evidence. Current documentation asks engineers to add real commands, but the
product cannot distinguish compliance from omission.

The target must produce a deterministic readiness result without executing
commands or guessing semantics from arbitrary command names. It must handle
common single-stack and polyglot roots, unrecognized project types, legacy
config, and checkout-wide hygiene. It must also decide whether this first
iteration changes normal runner enforcement or exposes an explicit diagnostic
that teams can adopt before a later gate.

Decision drivers:

- never report `git diff --check` alone as meaningful verification;
- tie readiness to deterministic project evidence rather than user prose;
- support polyglot roots without recursive discovery;
- produce actionable, stable results without running project code;
- avoid brittle inference from script names or command output;
- preserve current runner compatibility and exactly four human decision gates;
- make stronger enforcement possible through a separately evaluated follow-up.

## Options Considered

### Option 1: Infer meaningfulness from executable and argument strings

Recognize patterns such as `npm test`, `pytest`, `composer test`, `cargo test`,
or `go test` and treat matching commands as substantive.

Benefits:

- no new profile metadata;
- familiar commands can be classified automatically.

Costs and rejection reason:

- custom scripts, wrappers, workspaces, and renamed tasks are misclassified;
- maintaining ecosystem command grammars becomes open-ended;
- a plausible command string says nothing about whether the referenced script
  exists;
- inference can create false readiness. Rejected because explicit config is a
  safer authority than heuristic parsing.

### Option 2: Detect root project types and require explicit matching profiles

Detect a fixed set of root markers. Require at least one matching profile with
a command other than exact `git diff --check` for every detected type. Use
`custom` when no marker is recognized and never let a `repository` profile
satisfy project coverage. Report version-1 config as legacy and not ready.

Expose this as the authoritative `banzai doctor` readiness result and non-zero
exit code, while leaving ordinary `run`, `resume`, and `retry` execution
compatibility unchanged in the first iteration.

Benefits:

- deterministic and testable without command execution;
- explicit project ownership works for custom commands and polyglot roots;
- `git diff --check` retains its hygiene role without overstating assurance;
- existing runner workflows are not unexpectedly blocked on upgrade;
- teams can make doctor an external prerequisite immediately.

Costs and risks:

- an engineer can mislabel an ineffective command under a matching profile;
- root-only markers do not discover nested projects without a root marker;
- readiness is opt-in until normal runner enforcement is separately approved;
- a fixed taxonomy needs maintenance as supported project types expand.

### Option 3: Enforce readiness in every runner preflight immediately

Use Option 2's rules, but block `run`, `resume`, `retry`, and verification when
doctor would report not ready.

Benefits:

- no Banzai run can complete with a known hygiene-only profile;
- one readiness policy governs diagnosis and execution.

Costs and rejection reason:

- every existing schema-version-1 checkout becomes blocked despite retained
  compatibility decoding;
- interrupted active runs may become unrecoverable until tracked config is
  migrated;
- this introduces a new downstream hard prerequisite without migration usage
  evidence. Rejected for this iteration; enforcement requires a separate
  proposal after doctor adoption and migration evidence.

### Option 4: Execute configured commands in doctor and classify observed results

Run verification and use successful execution as proof of readiness.

Benefits:

- checks executable behavior rather than declarations;
- can expose missing scripts and runtime failures.

Costs and rejection reason:

- violates the requested diagnostic-only boundary;
- project commands can write, use network, consume credentials, or take a long
  time;
- success still does not prove relevance. Rejected on safety and correctness.

## Decision

Adopt Option 2.

Detect project types only from root-level markers: `package.json` for `node`,
`composer.json` for `php`, `pyproject.toml`, `setup.py`, or `requirements.txt`
for `python`, `go.mod` for `go`, `Cargo.toml` for `rust`, `Gemfile` for `ruby`,
`pom.xml`, `build.gradle`, or `build.gradle.kts` for `jvm`, and a root `.sln`,
`.csproj`, or `.fsproj` file for `dotnet`. Report every detected type in lexical
order. When none is detected, require `custom`.

Require every detected type to have at least one matching explicit profile with
at least one substantive command. Treat only exact `command: "git"` plus
`args: ["diff", "--check"]` as the known repository-hygiene command that never
counts toward substantive coverage. A `repository` profile never satisfies a
project type. Extra profiles are visible warnings but do not fail readiness.

Treat a schema-version-1 flat command list as legacy implicit evidence. It can
remain runner-compatible under ADR-0006, but doctor must report that
project-type coverage is unavailable and set readiness false until explicit
profiles are adopted.

Make doctor the only enforcement surface in this iteration: its failed checks
produce `ready: false` and exit code 1. Do not change normal `run`, `resume`,
`retry`, or verification state transitions based on readiness, and do not add a
human gate. Reconsider fail-closed runner enforcement only through a later ADR
after downstream migration and false-result evidence exists.

## Consequences

Positive:

- whitespace hygiene is no longer presented as sufficient readiness;
- common project types and polyglot roots receive deterministic coverage;
- custom scripts remain valid because the profile, not a command grammar,
  declares their project type;
- doctor is safe to run repeatedly and adopt in external automation;
- existing and interrupted workflows keep their execution path.

Negative:

- ordinary Banzai runs can still proceed when doctor is not ready;
- explicit metadata can overstate a command's real value;
- nested-only projects require an explicit `custom` profile or a recognized
  root marker;
- new project ecosystems require taxonomy maintenance.

Risks and required follow-ups:

- false declarations: documentation must state that doctor validates declared
  coverage, not test quality or actual execution;
- taxonomy drift: additions must be backward-compatible and tested without
  recursive scanning;
- insufficient adoption: collect doctor and migration evidence before
  proposing runner enforcement;
- command availability is a separate structural check and cannot prove that
  its arguments are valid without execution.

## Compliance and Confirmation

Implementation and review must confirm:

1. every listed marker maps to the exact project type and results are sorted;
2. Node-only, PHP-only, custom, and Node-plus-PHP fixtures implement the
   coverage rules;
3. exact `git diff --check` never counts as substantive, regardless of name or
   profile;
4. every detected type requires a matching non-hygiene command;
5. legacy implicit config is readable but never ready;
6. extra or live-state warnings do not change readiness by themselves;
7. doctor never executes a configured command;
8. normal workflow routing, transitions, verification execution, retries, and
   four human gates remain unchanged;
9. no automatic migration, dependency, or plugin-version change occurs.

## Lifecycle Links

- Amended by [ADR-0045](./0045-guided-verification-setup.md), accepted
  2026-09-14: explicit bootstrap readiness and new-run substantive-coverage
  preflight, with taxonomy and hygiene meaning preserved. Implementation of
  this amendment is Planned.

- Supersedes: None
- Superseded by: None
