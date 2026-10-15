# Your First Banzai Task

Use this guide to take an existing project from installation to a reviewable
first change. You supply the repository, its checks, and a bounded request;
Banzai selects the workflow and guides the decisions it needs.

For installation commands and supported client/runtime versions, start with
the [npm Quick start](../packages/orchestrator/README.md#quick-start). This
guide expands the project setup and first-task steps.

## Before you begin

- Use a Git repository on a supported macOS or Linux
  host. Review existing changes and choose a task branch using your normal
  Git workflow.
- Install the Banzai CLI and the separate plugin in both Codex and Claude
  Code. Both model clients need subscription authentication. Check each
  client's sign-in state in the environment where you will run Banzai.
- Install your project's dependencies and identify its actual deterministic
  test, lint, typecheck, or build commands. The CLI's Node.js runtime does not
  require your application to use JavaScript.
- Use a regular terminal. Interactive model selection and human decisions
  need a TTY.

For a new directory, start with `git init`, then `banzai init`. Guidance setup
works before the first commit and before an application skeleton exists. Banzai
explains a missing Git repository and exits before prompts; it never initializes
Git automatically. After reviewing the resulting guidance and configuration,
create your initial commit through your usual Git workflow. A task requires a
committed `HEAD`; an empty baseline is also possible:

```sh
git commit --allow-empty --only -m "Initial commit"
```

This leaves staged files uncommitted. Setup success and a first commit are
separate prerequisites.

Run these from your project root to check the local executables:

```sh
node --version
git --version
codex --version
claude --version
banzai --help
```

Version output and help establish executable availability, not authentication
or a successful model invocation.

## 1. Initialize and review project guidance

```sh
banzai init
```

This creates `.banzai/config.json` and `documentation/verification-examples.md`
when missing, adds local run-state entries to `.gitignore`, and offers the model
picker in an interactive terminal. Existing configuration and guide contents are
retained. The local guide is saved before any prompts, including in non-TTY mode;
rerunning `banzai init` restores a missing guide without replacing your edits.
No verification profiles or bootstrap setup is required.
Use `banzai model` later to change the
model and effort for each role.

If guidance is incomplete, init offers **Run project-manifest with Codex**,
**Run project-manifest with Claude Code**, **Show manual instructions**, and
**Exit**. The configured Planning vendor is recommended when available.
Selecting a client opens the explicit skill; answer its questions and exit the
client to return to Banzai. Banzai rereads guidance and starts no task automatically.
Use `banzai setup` later to continue without repeating the model picker.
Unavailable clients show a reason; install/enable the plugin separately or use
the manual route in the same project:

| Client      | Skill invocation           |
| ----------- | -------------------------- |
| Claude Code | `/banzai:project-manifest` |
| Codex       | `$banzai:project-manifest` |

Review the resulting `AGENTS.md`, `CLAUDE.md`, `PROJECT_MANIFEST.md`, and any
proposed settings changes. Preserve your project's existing instructions and
resolve proposed merges before continuing. The manifest should describe the
actual stack, conventions, and checks for this project.

## 2. Describe the result you need

Start with an ordinary task, including in an empty repository. Banzai identifies
relevant checks from the request and project evidence. It can create required
tests and tooling within the authorized scope. You do not maintain a separate
command catalogue.

Strict work presents mandatory checks in the plan for approval. Lite work uses
the delegated task and existing execution permissions, without a verification
setup gate. Optional project policy can require or forbid checks and limit their
execution. Missing unrelated scripts and npm placeholders do not become task
requirements. A failed required check prevents completion.

See [task verification](verification-examples.md) for the evidence and policy
model. Historical profile commands remain legacy configuration utilities; they
are not required to start new work.

## 3. Check readiness and save the reviewed setup

```sh
banzai doctor
```

Resolve every failed check and review the warnings. For structured diagnostic
output, use `banzai doctor --json`.

Doctor v5 checks structural project guidance, configuration, installed instruction
resource parity, task policy, executable paths, and
local state. It does not execute your verification commands or call either
model vendor. Its authentication advisory is expected: a ready report does
not prove that a subscription is authenticated or has capacity. Workflow
startup performs those preflight checks.

Review `git status --short`, then commit the intended configuration, guidance,
and `.gitignore` changes through your normal Git process. Keep credentials
and ignored local run state out of the commit. Start from a reviewed, clean
working tree so the task has a clear baseline.

## 4. Give Banzai one bounded request

```sh
banzai
```

Describe one observable change, the existing behavior it must preserve, and
the cases its tests should cover. For a project that already has a filtered
records view, a suitable request is:

> Add a CSV export for the currently filtered records. Preserve existing access
> rules and cover empty results and quoted values with tests.

Adapt the request to a feature your application actually has. For a first
task, choose a small change with a result you can inspect locally. Banzai
shows the selected route and reason; the request alone does not guarantee a
particular route.

| Selected route           | What to expect                                                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quick-fix` or `feature` | Implementation followed by configured verification; no independent reviewer phase. Escalated work returns for a human decision.                                                                |
| `strict`                 | Requirements and planning, any required architecture or clarification decisions, approval of the plan, implementation, verification, and independent review. You triage findings when present. |

For strict work, inspect the actual plan before approving it. Accepting a
review finding authorizes its scoped fix. Rejected or deferred findings do
not enter the fixer. A passing review can finish the run; a complete triage
with no accepted findings can also finish it while retaining the original
review verdict. See [workflow details](orchestrator.md#workflow-reference).

## 5. Inspect the outcome

```sh
banzai status
git status --short
git diff --stat
git diff
```

Use the reported run state and next action to determine whether the workflow
has finished. A model saying it is done, or a set of checked plan tasks, is
not sufficient evidence of workflow completion.

For your first completed task, check that:

- the run reports completion and its configured verification results are
  available;
- you have inspected the source diff and any new, untracked files (which
  `git diff` alone does not show);
- the requested behavior works in your application;
- any strict-workflow decisions and review results match the actions you
  approved.

New work documents live together under `documentation/work/<slug>/` and remain
visible in Git. Explicit existing work retains its known paths without migration. See [artifact storage](artifact-storage.md). Local run
state and retained verification evidence live under `.banzai/runs/<run-id>/`.
Follow the paths reported by your run; not every route creates the same files.
Use your project's normal review and commit process for the resulting change.

## Setup troubleshooting

| Symptom                                                         | Next step                                                                                                                                                                                                              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `banzai` is not found                                           | Confirm the global npm installation and that its executable directory is on this terminal's `PATH`. Reopen the terminal after changing Node installations.                                                             |
| Model picker or interactive prompts are unavailable             | Run in a regular terminal. For an external supervisor, use the separately documented [agent-control interface](orchestrator.md#agent-control).                                                                         |
| Missing configuration                                           | Run `banzai init` from the intended Git checkout, then configure its checks.                                                                                                                                           |
| `GIT_REPOSITORY_REQUIRED` | Run `git init` in the intended project directory and create an initial commit, then start Banzai again. |
| `GIT_INITIAL_COMMIT_REQUIRED` | Create the first commit on the current branch. For an empty baseline that leaves staged files uncommitted, run `git commit --allow-empty --only -m "Initial commit"`, then start Banzai again. |
| Missing project coverage or hygiene-only verification           | Add substantive commands for every root-detected project type using the [profile examples](verification-examples.md). Renaming `git diff --check` does not make it a test.                                             |
| Legacy configuration is not ready                               | Follow the manual [schema-version-1 migration](orchestrator.md#project-verification-readiness). Rerunning `init` does not migrate an existing configuration.                                                           |
| Doctor cannot find a verification executable                    | Check the command path and dependencies in the same terminal environment. For Python, use the interpreter from the project's environment.                                                                              |
| Doctor is ready, but startup rejects authentication or capacity | Resolve the reported client sign-in, subscription, or provider issue. Check `banzai status`; retry start checks only when the run offers that action.                                                                  |
| Claude environment or tool permissions fail                     | Follow the specific finding and [Claude environment guidance](orchestrator.md#spawned-claude-environment). Review proposed project settings rather than granting blanket permissions.                                  |
| A task is blocked or interrupted                                | Inspect `banzai status` and follow its available action. `retry`, `resume`, and `recover` have different eligibility rules; see [failure recovery](orchestrator.md#failure-recovery). Keep persisted run state intact. |

If setup still fails, report the OS, Node and client versions, the command,
the failing check identifier, and a minimal reproduction through
[GitHub Issues](https://github.com/Parabolic-Technologies/banzai/issues).
Review diagnostic excerpts before sharing them; omit credentials and private
project details. Report vulnerabilities through the [security policy](../SECURITY.md).

## Before-you-install FAQ

**Do I need both model clients?** The orchestrator setup uses both Codex and
Claude Code with subscription authentication. The plugin can be used by itself
in one supported client; see [standalone use](../README.md#using-the-plugin-without-the-orchestrator).

**Do I enter API keys into Banzai?** No. Banzai invokes the local model clients
and supports individual-subscription authentication. Model calls still use
those clients' remote services and limits. See the [runtime boundaries](orchestrator.md#boundaries).

**Does npm install everything?** It installs the orchestrator and its runtime
dependencies. Install the model clients and Banzai plugin separately; your
application also needs its own dependencies and checks.

**Does Banzai require a particular application framework?** No. Configure the
commands for your own stack. Project detection uses root markers, so nested
workspaces need an explicit repository-level verification strategy; see
[mixed and nested projects](verification-examples.md#mixed-and-nested-projects).

**What does a successful first task prove?** It demonstrates the recorded
workflow and checks for that task. Review the actual result before merging;
one run is not a general measure of correctness or productivity.

## Incomplete guidance during an existing run

Setup cannot run while a workflow or another setup holds ownership, or while
the latest run is unfinished, including paused/blocked states. Use `banzai status`
to inspect the existing action; finish or explicitly cancel it before CLI setup.
If a continuation refuses with `PROJECT_SETUP_REQUIRED`, manually repair or
explicitly migrate the instruction files, then follow the existing resume,
retry or recovery route. Saved decisions remain saved. The runner revalidates
approval and recovery identity; guidance repair is no automatic approval.

Non-TTY `banzai init` saves configuration and prints the setup next step.
`banzai setup` requires terminal input/output. Structural guidance readiness
covers supported files, layout and manifest sections; it does not certify
application checks, semantic accuracy, subscription availability or host delivery.

If a configuration decision is pending, `banzai status` shows its current actions.
You can instead exit the owning session, repair prerequisites with `banzai verify
add`, `edit` or `remove`, and run `banzai resume`. Resume rechecks the evidence and
continues from the completed implementation checkpoint. Another terminal cannot
change config while a model, a check, or a waiting interactive owner holds it.


## Rework and independent planning review

At a strict ADR or plan gate, request rework with written feedback or request an
independent review of the whole planning bundle or selected artifacts. The
reviewer and planner analysis run read-only. The runner writes a separate
`planning-review-<N>.md`; zero findings restore the gate. With findings, inspect
the analysis options and their consequences before its advisory recommendation,
then choose one option, write your own instruction or decline each finding.
Only recorded human dispositions reach the applying planner. Revisions return
to a normal planning gate and still require explicit approval or ADR acceptance.
Changed reviewed bytes close the episode as stale; explicit retry reviews the
current bytes under a new number. Existing artifacts are never overwritten.

```text
banzai approve plan --decision rework --note "Exact owner feedback"
banzai approve adr --id ADR-0001 --decision rework --note "Exact owner feedback"
banzai review planning
banzai review planning --artifact documentation/work/example/plan.md
```

`approve plan` accepts only its documented flags. Unknown, repeated, positional
and `--name=value` forms fail before approval. For agent supervisors, control
8.0.0 declares capabilities v8 and status v6. Send closed gate-decision v1
through `banzai control decide` and planning-triage answer v4 through `banzai
control answer` using direct stdin. Encode human text as raw UTF-8 JSON; on the
64 KiB limit, let the human shorten their own text or answer in a terminal.
Never infer a decision or truncate the text. Historical runs cannot acquire new
rework/review authority or resume through the v10 hook; preserve them and start
new work. This release does not migrate or install anything automatically.
