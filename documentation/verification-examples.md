# Verification Profile Examples

Banzai runs the commands you configure in `.banzai/config.json`. Start with
checks your project already owns, then adapt one of these examples. Return to
[Your first Banzai task](getting-started.md#2-configure-checks-that-exercise-your-project)
after configuring them.

## How to use these snippets

For an empty repository, `banzai init` can enable bootstrap only when no
substantive profiles exist. Profiles for currently undetected stacks also prevent
bootstrap. The wizard names these profiles and leaves configuration unchanged
instead of offering an ineffective flag. To keep the profiles, restore their
project files and checks, or configure substantive checks for `custom`. For a
bootstrap-only start, use the displayed `banzai verify remove <id>` commands,
review and confirm each removal, keep the remaining hygiene profile, then rerun
`banzai init` and confirm bootstrap. The final profile cannot be removed.

Use `banzai verify add <type>` for guided setup, `banzai verify edit <id>` for
repair, and `banzai verify remove <id>` for a confirmed removal. The editor asks
for an executable and individual arguments, shows a preview, and preserves
unselected configuration. Node suggestions use existing scripts only; no wizard
executes project commands. Run `banzai verify check` when you explicitly want to
execute all configured checks and inspect each result.

The JSON blocks below document the schema-version-2 representation and are
reference examples, not instructions to replace your whole config. Schemas 2
and 3 support optional `verification.bootstrap: true`; markerless bootstrap needs
explicit confirmation during init. Schema 1 remains readable and requires the
[documented legacy migration](orchestrator.md#project-verification-readiness)
before guided configuration.

- Keep profile IDs unique and use the documented `projectType` values.
- Commands execute from the repository root in profile and command order.
- `command` is the executable; every item in `args` is a separate argument.
  Banzai spawns them directly without a shell. Use separate command entries
  instead of shell syntax such as `npm test && npm run lint`.
- Choose commands that terminate with an exit code. Set `timeoutMs` in
  milliseconds to a realistic limit for that check.
- A `repository` profile with `git diff --check` supplies whitespace hygiene.
  It does not satisfy application verification, even if moved to another
  profile or given a different name.
- Explicitly run `banzai verify check`, then run `banzai doctor`. Doctor checks declared
  coverage and executable availability; it neither runs tests nor evaluates
  their quality.

These are configuration examples, not recorded runs or measured test results.

## Node.js and TypeScript

Use this when root `package.json` defines `test`, `typecheck`, and `lint`
scripts. Adapt the script names and package manager to your project. If a
script is absent, replace it with the actual check rather than a placeholder
that exits successfully. `test` must run once rather than enter watch mode.

```json
{
  "verification": {
    "profiles": [
      {
        "id": "node",
        "projectType": "node",
        "commands": [
          {
            "name": "tests",
            "command": "npm",
            "args": ["test"],
            "timeoutMs": 600000
          },
          {
            "name": "typecheck",
            "command": "npm",
            "args": ["run", "typecheck"],
            "timeoutMs": 300000
          },
          {
            "name": "lint",
            "command": "npm",
            "args": ["run", "lint"],
            "timeoutMs": 300000
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

For an npm workspace, put the appropriate `--workspace` argument in `args`
or use a root script that runs the required workspace checks. A successful
root command must actually cover the packages affected by the task.

## Python with pytest

Use this when the root contains `pyproject.toml`, `setup.py`, or
`requirements.txt`, and the project already has a `.venv` environment with
pytest and its dependencies installed. The relative executable path selects
that environment without depending on shell activation.

```json
{
  "verification": {
    "profiles": [
      {
        "id": "python",
        "projectType": "python",
        "commands": [
          {
            "name": "pytest",
            "command": ".venv/bin/python",
            "args": ["-m", "pytest"],
            "timeoutMs": 600000
          }
        ]
      }
    ]
  }
}
```

Adapt the executable if your project uses a different environment manager.
The command uses pytest's documented [Python module invocation](https://docs.pytest.org/en/stable/how-to/usage.html#calling-pytest-through-python-m-pytest).
Add your existing lint, typecheck, and repository hygiene commands as needed.

## Go

Use this for a module rooted at `go.mod`, with Go available on `PATH` and the
project dependencies prepared. Keep any additional project-specific build
tags or test arguments in `args`.

```json
{
  "verification": {
    "profiles": [
      {
        "id": "go",
        "projectType": "go",
        "commands": [
          {
            "name": "go tests",
            "command": "go",
            "args": ["test", "./..."],
            "timeoutMs": 600000
          }
        ]
      }
    ]
  }
}
```

See the [Go testing tutorial](https://go.dev/doc/tutorial/add-a-test) for the
language's test convention. Configure any additional project checks separately.

## Mixed and nested projects

When multiple project markers exist at the root, include a matching profile
for each detected type. The reference includes a complete
[Node and PHP verification fragment](orchestrator.md#project-verification-readiness).
Combine only the profile objects you need, retaining unique IDs and the
intended execution order.

Detection is root-only. A nested application is not automatically discovered
or given its own working directory. Use root scripts or your test tool's
documented path/workspace options to cover it. When the root has no recognized
marker, declare a `custom` profile with a real repository-owned check, even
if the nested application uses a recognized language.

The reference lists all supported [root markers and profile types](orchestrator.md#project-verification-readiness).
Do not add a marker just to make doctor ready; configure checks that actually
cover the repository. A ready report describes the declared setup, not whether
the selected tests provide sufficient assurance.

## Explicit equivalent evidence (config 3)

Config 1 and 2 keep their existing execution behavior. To opt a project into
ADR-0043, explicitly set the full configuration's `schemaVersion` to 3, give
every command a globally unique kebab-case `id`, and add a verification `policy`.
Preserve models, contractVersion and the other existing configuration fields.
New checks default to `evidence: "fresh"`; `release:check` always executes afresh.

A policy has this shape (replace every example boundary with reviewed project
facts; this is not a ready-to-run configuration):

```json
{
  "schema": "banzai-verification-policy/v1",
  "schemaVersion": 1,
  "explanatory": [
    {
      "path": "docs/overview.md",
      "regions": [
        { "start": "<!-- explanation start -->", "end": "<!-- explanation end -->" }
      ]
    }
  ],
  "dependencies": {
    "complete": false,
    "exclude": [],
    "toolchain": ["/absolute/canonical/path/to/node"],
    "environment": { "LANG": "C", "TZ": "UTC" },
    "volatile": []
  }
}
```

An eligible command adds `evidence: "equivalent_evidence"` and
`ignoreExplanatory: true`. Its command, ordered profile, policy, authority,
protected inputs and environment must match a direct successful physical origin
from the same repository and work. A command that consumes the explanatory text
keeps `ignoreExplanatory: false`. An empty `regions` array declares a whole
explanatory Markdown file. Boundaries and all complementary text remain protected;
code fences and executable embeds invalidate an explanatory declaration. Mixed
`PROJECT_MANIFEST.md` and `MODULES.md` declarations require regions; they cannot
be exempted as whole files. Runner evidence excludes its own run directory and
transient runner lock; helper claims are transient ownership metadata.

`complete` is the project's reviewed dependency assertion. Keep it false when
closure is unknown. Capture includes staged, working, untracked and ignored files,
including actual installed dependency bytes; a lockfile alone is insufficient.
Exclusions are explicit project-owned dependency boundaries. Excluding a report
is valid only if the check does not consume it; approval and completion authority
remain independently enforced. Links, special files, unreadable or unstable
inputs conservatively deny reuse. Limits are 50,000 files and 512 MiB per capture.
When capture is unavailable, a configured process can still execute and its
physical result remains recorded, but current applicability stays pending and
runner completion is blocked. Resolve the unavailable input boundary before
applying that result; two null capture digests do not establish unchanged inputs.

Toolchain entries are canonical absolute regular-file paths and must include
the resolved executable and every external dependency needed for stable evidence.
The helper captures their actual bytes. Config-3 policy execution passes only the
explicit non-secret `PATH`, `LANG`, `LC_ALL` and `TZ` environment values. No ambient
secret is hashed to establish equivalence. Network, clock, service, secret or
other external dependencies without stable evidence belong in `volatile` and
remain non-reusable. This is a declared project boundary, not automatic semantic
dependency analysis; a declaration cannot substitute for missing evidence.

New strict plans additionally need the owner-approved
`banzai-verification-obligations/v1` fenced inventory described in the supplied
Plan Authority policy. Missing, ambiguous or stale inventories retain fresh
checks. Existing approved plans are not silently upgraded.

For standalone work, explicitly create a new private binding with an artifact
create request using `banzai-artifact-request/v2` and `schemaVersion: 2`. Existing
v1 bindings remain unchanged. The installed `scripts/verification.cjs` accepts
`inspect`, `decide` and `execute` with `--json <private-request-file>`:

```json
{
  "schema": "banzai-verification-request/v1",
  "schemaVersion": 1,
  "repoRoot": "/absolute/project/root",
  "workPath": ".banzai/work/11111111-1111-4111-8111-111111111111/work.json",
  "roundId": "22222222-2222-4222-8222-222222222222",
  "checkId": "unit"
}
```

`checkId` is supplied only to execute, which selects that configured check. Use
one round ID for the ordered checks of one candidate. A failed attempt requires
its exact `retryOf`; an unresolved start requires owner recovery. Requests never
supply arbitrary commands or output paths. Inspect/decide do not write evidence.
A reuse disposition preserves its original attempt/round/digest; it creates no
new process, exit code, log or duration. Unsupported policy/binding/helper paths
retain the existing applicable final verification workflow.

## Command identities and repair

Schema-3 command IDs are assigned by the runner. Changes to `name`, executable,
arguments, `timeoutMs`, or evidence options change command identity; unchanged
commands and pure reordering preserve IDs. The preview shows replacement IDs.
Evidence for an old ID cannot satisfy its replacement. A removed check named in
an approved obligation still requires the existing reapproval route; editing a
profile never rewrites that obligation or the verification policy.

Automatic proposals only add profiles. If an existing command names a removed
script, restore that script or explicitly edit/remove the old profile. Accepting
another profile cannot bypass the broken prerequisite. Skip remains subject to
binding obligations. All config edits require released repository ownership;
answer in the owning session, or exit it before repair and `banzai resume`.
