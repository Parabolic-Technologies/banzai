# Feature: Interactive Slug Selection and Date-Prefixed Work Directories

Slug: `interactive-slug-selection`

Requirements authority: the owner's request of 2026-11-10 and the owner's
answers in chat on 2026-11-10 to the route, scope and uniqueness questions and
to decision cards C1 and C2. This description is approved only as part of the
plan bundle at the plan approval gate.

Evidence of the current behavior:

- `packages/orchestrator/src/interactive.ts:922-945`: `startRun` asks
  `What should Banzai implement?`, prints `Generated slug: <slug>` and
  `Request: <request>`, then asks
  `Start this task with automatic workflow selection?`. The engineer cannot
  change the generated slug.
- `packages/orchestrator/src/interactive.ts:347`: `generateFeatureSlug`
  derives a deterministic kebab-case slug of at most 64 characters.
- `packages/orchestrator/src/workflow/domain/run-identity.ts:3-15`: run IDs
  embed a UTC timestamp and the slug; `requireSlug` accepts any lowercase
  kebab-case slug.
- `plugins/banzai/lib/work-documents.mjs:17-21,67-81`: a work slug is at most
  100 characters; starting a run refuses with `ARTIFACT_WORK_CONFLICT` when
  `documentation/work/<slug>/` exists, and does not look at
  `documentation/initiatives/`.
- `documentation/decisions/0054-git-visible-work-artifacts.md:127-129` and
  `documentation/decisions/0061-initiative-skill-and-documents.md:119-120`:
  dates must not be required name prefixes of work or initiative directories.
- `plugins/banzai/skills/initiative/SKILL.md:45-47,85`: initiative slugs carry
  no date; `start` refuses only an existing initiative directory.

## Overview

Every new work directory and every new initiative directory is named
`<prefix><subject-slug>`, where `<prefix>` is the local creation date as
`yymmdd-`. The prefix is part of the final slug, so the run slug, the work
directory and the run ID all carry it. No entry point lets the engineer remove
or replace it.

In the interactive session, the request prompt is followed by one slug step.
The session offers the prefixed generated slug; the engineer accepts it with
Enter or `y`, or types an own slug. The prefix is added to a typed slug, and the
result is checked for format, length and uniqueness against existing directory
names before the existing start confirmation.

Primary flow on 2026-11-10: the engineer types `Fix the login error`. The
session prints `Generated slug: 261110-fix-the-login-error` and asks
`Press Enter or y to accept it, or type your own slug:`. The engineer types
`login-fix`. `documentation/work/261110-login-fix/` does not exist, so the
session prints `Slug: 261110-login-fix` and `Request: Fix the login error`,
then asks `Start this task with automatic workflow selection?`. On confirmation
the run starts with slug `261110-login-fix` and work directory
`documentation/work/261110-login-fix/`.

Key constraint: the prefix is mandatory and always records the local date on
which the slug is finalized.

Non-goals:

- No renaming or migration of existing undated work or initiative directories.
- No change to ADR file names, run ID format or the deterministic generator.
- No automatic suffix or alternative on a name conflict.
- No slug change after a run has started.
- No uniqueness check against the ignored legacy trees
  `documentation/features/`, `documentation/development-plans/` and
  `documentation/changes/`.

## Functional Requirements

Prefix:

- **FR1.** The creation-date prefix is `yymmdd-`: the last two digits of the
  year, the zero-padded two-digit month and the zero-padded two-digit day of
  the local calendar date of the machine at the moment the slug is finalized,
  followed by `-`. On 2026-11-10 the prefix is `261110-`.
- **FR2.** A candidate slug that begins with the current prefix is used as is.
  Any other candidate receives the current prefix. Leading digits for another
  date are part of the subject slug: on 2026-11-10, `251001-login-fix` becomes
  `261110-251001-login-fix`.
- **FR3.** A final slug is valid when it is lowercase kebab-case
  (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), begins with the current prefix and has at
  most 100 characters including the prefix.
- **FR4.** A final slug is unique when neither `documentation/work/<slug>/`
  nor `documentation/initiatives/<slug>/` exists. The comparison uses the full
  directory name, so `261110-login-fix` does not conflict with an existing
  `login-fix` or `261001-login-fix`.

Interactive session:

- **FR5.** After a non-empty request is submitted at
  `What should Banzai implement?`, the session prints
  `Generated slug: <default>`, where `<default>` applies FR2 to the slug that
  the existing generator derives from the request.
- **FR6.** The session then shows exactly one input prompt,
  `Press Enter or y to accept it, or type your own slug:`. After surrounding
  whitespace is trimmed, empty input, `y` and `Y` select `<default>`. Any other
  input is a candidate that receives FR2 and no other normalization.
- **FR7.** The prompt validates the selected slug, including an accepted
  `<default>`, and keeps the prompt open with one of these messages until the
  slug is valid and unique:
  - not lowercase kebab-case:
    `Use lowercase letters, digits and single hyphens, for example login-fix.`
  - longer than 100 characters:
    `Use at most 100 characters, including the <prefix> prefix.`, for example
    `Use at most 100 characters, including the 261110- prefix.`
  - an existing directory: `<path> already exists. Type a different slug.`,
    where `<path>` is the repository-relative directory, for example
    `documentation/work/261110-login-fix already exists. Type a different slug.`
- **FR8.** After a valid selection the session prints `Slug: <final>` and
  `Request: <request>`, then asks the existing confirmation
  `Start this task with automatic workflow selection?` with default yes.
  Confirming starts the run with `<final>` unchanged, even when the local date
  changed after the slug step. Declining starts no run and creates no
  directory.
- **FR9.** Interrupting the slug step or the confirmation ends the session as
  interrupting the request prompt does today. No run starts and no directory is
  created.

Scripted entry points and the runner:

- **FR10.** `banzai run --slug <value>` and
  `banzai control start --slug <value>` apply FR2 to `<value>` when the command
  starts the run. The run's `slug`, its run ID, its work directory
  `documentation/work/<final>/`, human status and agent-control status all use
  the final slug.
- **FR11.** Every run start refuses an invalid final slug (FR3) or a final slug
  that is not unique (FR4). A refusal names the reason or the existing path,
  creates no work directory and leaves no active run.
- **FR12.** Runs started before this change keep their recorded undated slugs
  and continue to resume, retry, recover, cancel and report as before.
  Historical bindings remain readable.

Standalone skills and initiatives:

- **FR13.** A standalone skill that starts new work names its directory
  `documentation/work/<final>/` under FR1-FR4. When the full name exists under
  either root, it uses a different subject slug and never reuses the existing
  directory.
- **FR14.** `initiative start <slug>` creates
  `documentation/initiatives/<final>/` under FR1-FR4 and refuses when the full
  name exists under either root.
- **FR15.** A package work directory created for an initiative follows FR13.
  The initiative's tracker, `next` handoff and drift checks identify that
  package by the full name of the directory that was created.
- **FR16.** Existing undated directories under `documentation/work/` and
  `documentation/initiatives/` keep their names. Explicit continuation of them
  uses their existing paths and adds no prefix.
- **FR17.** The installed artifact-storage policy, the initiative skill,
  `documentation/artifact-storage.md` and the CLI reference state the prefix
  rule in place of the current no-date rule, and the CLI reference's
  `--slug` examples show the resulting prefixed slug.

## User Stories & Acceptance Criteria

- **AC1 (FR1, FR5, FR6, FR8).** Given the local date 2026-11-10 and the
  request `Fix the login error`, when the engineer presses Enter at the slug
  prompt and confirms, then the session printed
  `Generated slug: 261110-fix-the-login-error` and
  `Slug: 261110-fix-the-login-error`, and the run starts with that slug.
- **AC2 (FR6).** Given the same request, when the engineer types `Y`, then the
  generated default is selected.
- **AC3 (FR2, FR6, FR8).** Given the local date 2026-11-10, when the engineer
  types `login-fix`, then the final slug is `261110-login-fix`; when the
  engineer types `261110-login-fix`, the final slug is also `261110-login-fix`.
- **AC4 (FR2).** Given the local date 2026-11-10, when the engineer types
  `251001-login-fix`, then the final slug is `261110-251001-login-fix`.
- **AC5 (FR3, FR7).** When the engineer types `Login_Fix`, then the prompt
  shows `Use lowercase letters, digits and single hyphens, for example login-fix.`
  and stays open; a typed slug whose final form exceeds 100 characters shows
  `Use at most 100 characters, including the 261110- prefix.`.
- **AC6 (FR4, FR7).** Given an existing `documentation/work/261110-login-fix/`,
  when the engineer types `login-fix`, then the prompt shows
  `documentation/work/261110-login-fix already exists. Type a different slug.`
  and stays open. Given an existing `documentation/initiatives/261110-login-fix/`,
  the message names that path.
- **AC7 (FR4, FR7).** Given an existing directory named like the generated
  default, when the engineer presses Enter, then the conflict message is shown
  and no run starts until a unique slug is selected.
- **AC8 (FR4).** Given an existing `documentation/work/login-fix/` and no
  `documentation/work/261110-login-fix/`, when the engineer types `login-fix`
  on 2026-11-10, then `261110-login-fix` is accepted.
- **AC9 (FR8).** Given a slug accepted at 23:59 local time on 2026-11-10, when
  the engineer confirms after midnight, then the run starts with the accepted
  `261110-` slug.
- **AC10 (FR8, FR9).** When the engineer declines the confirmation or interrupts
  the slug step, then no run state is active and no work directory was created.
- **AC11 (FR10).** Given the local date 2026-11-10, when
  `banzai run --slug fix-login --request "Fix the login error"` starts a run,
  then its slug is `261110-fix-login`, its run ID contains `261110-fix-login`,
  `documentation/work/261110-fix-login/` exists, and status reports
  `261110-fix-login`. The same holds for `banzai control start --slug fix-login`
  and its returned status.
- **AC12 (FR11).** Given an existing `documentation/initiatives/261110-fix-login/`,
  when `banzai run --slug fix-login` starts on 2026-11-10, then it refuses
  naming that path, creates no work directory and leaves no active run.
- **AC13 (FR12).** Given a run started before this change with slug
  `login-fix`, when the engineer resumes it, then it continues with
  `documentation/work/login-fix/`.
- **AC14 (FR13, FR16).** Given a standalone `feature` request on 2026-11-10,
  when the skill starts new work, then it writes
  `documentation/work/261110-<subject>/work.md`; when the engineer explicitly
  continues `documentation/work/login-fix/`, the skill writes there.
- **AC15 (FR14, FR15).** Given `initiative start release-program` on
  2026-11-10, then `documentation/initiatives/261110-release-program/` holds
  `brief.md` and `tracker.md`; a later package started on 2026-11-12 creates a
  `documentation/work/261112-<package>/` directory, and `next` identifies the
  package by that full name.
- **AC16 (FR17).** The listed guidance and documents state the prefix rule and
  no longer state that work or initiative slugs carry no date.

## Platform Specifics

- Interactive copy is English. Only `inquirer-io.ts` imports `@inquirer/*`;
  interactive decisions use `InteractiveIO`.
- Human progress goes to stderr; stdout carries command results and JSON.
- Node.js on macOS or Linux; the local calendar date follows the process's
  configured time zone.
- Generated sources and the plugin library are rebuilt by `npm run build`; a
  source schema, phase, guidance or policy change requires a rebuild before
  local CLI execution.
- Agent control uses contract version `9.0.0` with closed stdin requests.

## Security Exposure

- Class 1, untrusted input reaches a filesystem path: a typed slug or a
  `--slug` value becomes a directory name under `documentation/work/` or
  `documentation/initiatives/`; FR3, FR7, FR11, FR13 and FR14 require
  validation before any path use.
- Class 7, overwrite: reusing an existing directory could overwrite existing
  documents; FR4, FR7, FR11, FR13 and FR14 refuse an existing full name.

## Architecture Decision Needs

- **AD1. Mandatory creation-date prefix for work and initiative directories.**
  Decision question: how the prefix rule replaces the no-date naming rule of
  ADR-0054 and ADR-0061 §1, including which boundary applies and enforces the
  prefix and uniqueness for each entry point, how an interactive slug
  finalized before a date change reaches the runner unchanged while scripted
  input is prefixed, how the local date is obtained and made deterministic in
  tests, how callers of `banzai run` and agent control learn a final slug that
  differs from `--slug`, how initiative trackers record package directories,
  and how undated historical runs and bindings stay valid. Drivers: FR1-FR17,
  compatibility of public CLI and agent-control behavior, consistency across
  entry points and standalone skills, deterministic testability. Relevant
  ADRs: ADR-0054, ADR-0061, ADR-0018.

## Resolved Assumptions

1. The work takes the strict route, and a new ADR supersedes the no-date slug
   rule of ADR-0054 and ADR-0061. `User-confirmed` (chat, 2026-11-10).
2. The prefix applies to every new work and initiative directory: interactive
   mode, `banzai run --slug`, `banzai control start --slug`, standalone skills
   and the initiative skill. `User-confirmed` (chat, 2026-11-10).
3. Uniqueness compares the full directory name. `User-confirmed` (chat,
   2026-11-10).
4. The prefix uses the local calendar date. `User-confirmed` (card C1,
   2026-11-10).
5. Only the current date's prefix counts as already present. `User-confirmed`
   (card C2, 2026-11-10).
6. `y` accepts the generated slug. `User-confirmed` (request). Enter and `Y`
   also accept it because the generated slug is the default. `Sensible default`.
7. The slug step follows submission of the request prompt and precedes the
   existing start confirmation, so the confirmation covers the final slug.
   `Sensible default`: the request places the step after the prompt, and the
   existing confirmation remains the start decision.
8. A typed slug is trimmed and otherwise not normalized; an invalid value is
   rejected. `Manifest convention`: work slugs are lowercase kebab-case.
9. The final slug, prefix included, has at most 100 characters.
   `Manifest convention`: the existing work-directory and initiative bounds.
10. Uniqueness covers `documentation/work/` and `documentation/initiatives/`
    only. `Manifest convention`: ADR-0061 requires initiative slugs unused in
    both roots; the legacy trees are ignored historical evidence.
11. Existing undated directories are not renamed. `Manifest convention`:
    no-migration rule of ADR-0054.
12. This work's own directory follows the currently accepted no-date rule until
    the superseding ADR is accepted. `Manifest convention`.

## Open Questions & Risks

None outstanding.
