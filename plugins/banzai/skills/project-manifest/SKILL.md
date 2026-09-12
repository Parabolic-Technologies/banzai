---
name: project-manifest
description: Create or maintain PROJECT_MANIFEST.md. Scaffolds workflow files, records current stack/tooling/architecture facts, and indexes active accepted ADRs. Explicit user invocation only. Run it only when the user runs this skill by name; when the manifest is missing or stale, ask the user to run it instead of selecting it.
user-invocable: true
disable-model-invocation: true
---

# project-manifest

Owns current facts in `PROJECT_MANIFEST.md`. Other skills read it before
code/test changes. Accepted ADRs own architectural rationale and history.

Apply the canonical Engineering Quality policy in the installed
`policies/engineering-quality.md`; this skill adds
only discovery-specific responsibilities and does not copy its rule set.

## Artifact Storage

Before artifact discovery or writing, read the installed
`../../policies/artifact-storage.md` and resolve the selected work through its
plugin-local helper. Use the returned role paths for internal work artifacts;
`documentation/` work paths below describe the explicit legacy layout only.
Keep ADRs, indexes, manifests and maintained product guidance at their existing
repository paths. Status/loading stays read-only, and orchestrated work follows
the persisted run binding and exact phase grants.

## Sources

- Process: the project root `AGENTS.md`. Read it unless the host already
  assembled it into this session. Before bootstrap or migration discovery,
  recognize the layout: target when `AGENTS.md` carries `## Authority` and
  `## Policies` with no line beginning with `@`, and the `CLAUDE.md` shim is
  absent or carries no policy heading; legacy layout when `CLAUDE.md` carries
  `## Engineering Quality` and `AGENTS.md` is absent or lacks `## Authority`.
  Policy headings for layout recognition are `## Decision Consultation`,
  `## Test Assurance`, `## Security Assurance`, `## Engineering Quality`,
  and `## Plan Task Completion Evidence`.
  Report the legacy diagnostic: "legacy Banzai layout: run `project-manifest` to migrate".
  On a legacy or partial layout apply the bootstrap source rule: take process
  text from the installed plugin's packaged `AGENTS.md` (`../../AGENTS.md`
  from this `SKILL.md`) and policies from `../../policies/`; project files
  are inputs to the migration diff only, legacy Banzai text is never an
  applicable policy, and approved decisions recorded there keep their authority.
  Stop if an installed source is unreadable. Report a partial layout as partial.
  Unadopted means neither file has `## Authority` or a policy heading; keep
  existing missing-manifest behavior. Every other combination, including an
  unreadable file, is partial. Skip this recognition rule in the plugin source
  repository only under the Source Repository Exception below. Never read a
  policy body from a project file.
- Policies, resolved as `../../policies/<name>.md` from this `SKILL.md`,
  never from the project working directory or a fixed plugin cache path.
  Stop before affected work if a required source is absent or unreadable;
  never substitute a project copy, a legacy inline policy or memory:
  - `test-assurance.md` when recording test-assurance facts or selecting a bootstrap test runner or command.
  - `security-assurance.md` when proposing an applicable bootstrap or configuration boundary change; reading never authorizes that change.
  - `engineering-quality.md` before discovery, design, implementation, fix or review judgment within this skill.
   - `artifact-storage.md` before resolving, reading or writing work artifacts.

## Scaffold

Plugin root is `../..` from this `SKILL.md`.

If missing, copy these into the project root:

- `CLAUDE.md` (scaffold shim)
- `AGENTS.md`
- `PROJECT_MANIFEST.md`
- `documentation/`
- `.claude/settings.json`

Copy no file from `policies/`; skills read policies from the installed plugin.

Never overwrite existing files. If `CLAUDE.md`, `AGENTS.md`, or
`.claude/settings.json` exists, propose a merge and apply only approved
changes.

Skip scaffolding only under the Source Repository Exception below.

## Source Repository Exception

Use one source identity predicate at the discovered Git root for both scaffold
skipping and instruction-layout recognition skipping. Either complete topology
qualifies:

- **Plugin root:** at least one of `.claude-plugin/plugin.json` and
  `.codex-plugin/plugin.json` exists; every present file is a readable JSON
  object with `name: "banzai"`. Conflicting metadata does not qualify.
- **Source workspace:** root `package.json` has
  `name: "banzai-spec-driven-dev"`, `private: true`, and an array `workspaces`
  containing `packages/*`; `.claude-plugin/marketplace.json` has exactly one
  plugin entry named `banzai` with `source: "./plugins/banzai"`; both
  `plugins/banzai/.claude-plugin/plugin.json` and
  `plugins/banzai/.codex-plugin/plugin.json` are readable JSON objects with
  `name: "banzai"`.

Inspect only these fixed metadata paths. Missing or nonmatching metadata grants
no exception; unsafe, unreadable or conflicting identity evidence needs
attention. A directory name, remote URL, external installed cache or marketplace
name alone never grants it. Packaged templates remain product source; runtime
readiness still requires a populated root `PROJECT_MANIFEST.md` and readable
root `AGENTS.md`. The exception also applies to layout-only continuation checks.

## Layout Migration

Recognize target, legacy, unadopted and partial layouts as described in Sources
and [the migration procedure](references/layout-migration.md). On legacy or
partial layouts, propose one concrete migration diff before writing: preserve
shared rules under `## Project Rules` in `AGENTS.md`, and keep only confirmed
host-specific content below `@AGENTS.md` in the `CLAUDE.md` shim. Classify every
non-Banzai line with the user and resolve conflicts and unclassified lines by
approval before applying. Apply only approved edits; silently dropping or
duplicating content is forbidden.

A declined migration leaves project files byte-identical and the updated plugin
installed; affected work remains stopped. An interrupted or partially applied
migration remains partial; explicitly invoked migration may complete or revert
it under one approved diff. The reference names the last legacy-compatible
release as information only, never authorization to install or downgrade it.

## Bootstrap

Before first feature, record decisions required to run the next implementation:

- language, runtime/target, versions;
- test runner and command;
- current test-assurance policy and any explicit approved coverage threshold, or
  `None`;
- linter and command;
- formatter and final-review-only command;
- package manager and lockfile;
- build/run/typecheck commands;
- repository topology when it changes manifest/artifact placement;
- current technical constraints and active accepted ADR links.

Rules:

- Ask the user for load-bearing choices.
- Do not choose language/framework/package manager without confirmation.
- Route an unmade ADR-eligible choice to `architecture-decision`; do not record
  a proposal as a current manifest fact.
- Mark unknowns `Open` with reason.
- When applying the approved bootstrap population, remove the complete line
  `<!-- banzai-scaffold: unfilled -->` from before the first manifest heading.
  Do not remove it merely because setup launched or the client exited.
- After tools are chosen, add command permissions to `.claude/settings.json`.
- Build skeleton directly or through the first `feature`; there is no separate
  scaffold skill.

## CLI Setup Context

`banzai init` and `banzai setup` may open this explicit skill in a fresh
interactive client. The launch action authorizes this skill's interaction;
it approves no merge, stack choice, dependency, application skeleton, command
permission, Git commit, ADR or plan. Keep the bootstrap and concrete merge
gates above. An empty project can record explained `Open` or `None` facts
without creating application code. Exit the client to return to Banzai, which
rereads structural guidance and starts no task automatically.

The CLI checks root guidance before a new run, and instruction layout before
new model-bearing continuations. A structural pass does not certify freshness,
load-bearing choices, installed policy access or host delivery. Keep this
skill's ordinary evidence checks and migration stops. During an unfinished run,
CLI setup refuses launch: manual explicit migration or repair follows existing
approval/digest checks, or the user explicitly cancels before setup.

## Adoption

For existing repos:

- Read build files, lockfiles, tool configs, CI, workspace config, and source
  tree.
- Record stack, commands, architecture, dependencies, and layout as found.
- Record missing tests/lint/formatter as gaps. Do not add tools automatically.
- Record the repository's actual test policy and explicit thresholds from
  configuration or confirmed guidance; do not invent a universal coverage
  target.
- Detect topology: single package, monorepo, multi-module, or polyrepo.
- Derive conventions only from dominant existing patterns.
- Record only load-bearing facts relevant to future changed surfaces: intended
  dependency direction; important boundaries and contracts; external ingress
  and trust points; error propagation; lifecycle-owned resources; generated
  code ownership; compatibility surfaces; established abstractions; and
  documented legacy seams.
- Mark a fact unknown when evidence is absent. Do not infer a domain-centric
  architecture, invent a boundary, or audit the entire legacy repository.
- Do not retrofit artifacts for pre-existing features.
- Link existing ADRs when their status and implementation can be verified.
- Do not invent retroactive ADRs. Create a baseline ADR only from repository
  evidence plus explicit user confirmation.

## Maintenance

Read and apply [Maintenance](../../guidance/manifest.md#maintenance)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

## Required Sections

Read and apply [Required Sections](../../guidance/manifest.md#required-sections)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

## Writing Rules

Read and apply [Writing Rules](../../guidance/manifest.md#writing-rules)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

## Checklist

Read and apply [Checklist](../../guidance/manifest.md#checklist)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

## Bootstrap Decision Gate

When run standalone, present scaffold changes and the manifest diff. Wait for
approval of load-bearing bootstrap choices before downstream work; they become
current facts every later phase reads. When another skill updates the manifest
as part of its own work, report the diff and continue.
