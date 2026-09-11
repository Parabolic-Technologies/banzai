# Verification Profile Examples

Banzai runs the commands you configure in `.banzai/config.json`. Start with
checks your project already owns, then adapt one of these examples. Return to
[Your first Banzai task](getting-started.md#2-configure-checks-that-exercise-your-project)
after configuring them.

## How to use these snippets

Each JSON block below contains only the `verification` section. In an existing
**schema-version-2** configuration, replace that section or merge the selected
profiles into its `profiles` array. Preserve the other fields, especially
`models`, `contractVersion`, and `schemaVersion`; a snippet is not a complete
configuration file. Existing schema-version-1 configurations need the
[documented migration](orchestrator.md#project-verification-readiness) first.

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
- Run the commands yourself, then run `banzai doctor`. Doctor checks declared
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
