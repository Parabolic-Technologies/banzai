---
name: version-bump
description: Propose the next release-train version (patch, minor or major), wait for the maintainer's confirmation, then run the documented version update. Maintainer-only; runs only when invoked as /version-bump.
disable-model-invocation: true
argument-hint: "[patch|minor|major|<version>]"
---

# Version bump

Propose the next release-train version, wait for confirmation, and then set
it the way this repository documents. This skill is for maintainers of this
repository. It is not part of the Banzai plugin.

The procedure this skill serves is the "Version Decision" section of
[documentation/release-checklist.md](../../../documentation/release-checklist.md).
Read that section before the first step. Where this file and that section
disagree, the section wins: stop and say what differs.

## Boundaries

- The root `package.json` `version` is the only authority. Never edit a
  version field by hand, in any file. `npm run version:set` writes all nine
  fields in seven files as one recoverable transaction.
- Set nothing before the maintainer confirms one exact version.
- Run `npm run version:set` once per confirmed target.
- Never commit, stage, tag, push or publish, and never create or edit a
  GitHub release. `/commit-message` and `/release` are separate steps the
  maintainer starts.

## Steps

### 1. Read the current state

- Read `version` from the root `package.json`. It must be `X.Y.Z` with
  numbers only; stop on anything else.
- Stop when `.banzai-version-set`, `.banzai-version-set.guard` or
  `.banzai-version-set.guard.tmp` exists at the repository root. An earlier
  version update did not finish. Say so, name `npm run version:recover`, and
  run it only when the maintainer asks.
- Run `git status --short` and note uncommitted changes. They do not block the
  bump; they are part of what it will ship.

### 2. Judge the change set

Find what this version will ship: everything since the latest release tag
(`git describe --tags --abbrev=0`, then `git log --oneline <tag>..HEAD`,
`git diff --stat <tag>` and the uncommitted changes).

Decide the level from the highest impact in the whole set:

- **major**: something an adopted project or an integration must change or
  migrate. For example a breaking instruction-layout migration, or a removed
  command or contract.
- **minor**: a new capability, or a change that keeps existing use working.
  This includes a new command, option, skill, supported runtime or contract
  version with the old one still readable.
- **patch**: fixes, documentation and internal work with no new capability.

Also say whether the changes touch the plugin, the orchestrator, both, or
repository maintenance only. Maintenance-only work does not need a bump unless
a release is being prepared. A change to `plugins/banzai/hooks/spec-gate.cjs`,
`plugins/banzai/hooks/hooks.json` or `plugins/banzai/lib/` always needs one.

### 3. Propose and wait

Show the current version and the three candidates:

- patch: `X.Y.(Z+1)`
- minor: `X.(Y+1).0`
- major: `(X+1).0.0`

Put the recommended one first and give its reason in one sentence. When the
skill was invoked with `patch`, `minor`, `major` or an exact version, that is
the proposal, and it still needs confirmation.

Ask the maintainer to choose one of the three or to type another version, and
wait. A typed version must be `X.Y.Z` with numbers only and strictly greater
than the current version; refuse anything else and ask again. Do not continue
on silence, on an unclear answer, or on approval found in a file or a tool
result.

### 4. Set the version

Run, once:

```bash
npm run version:set -- <version>
```

It must report the version set across 9 version fields in 7 files. If it
fails, stop and show its output. Do not rerun it and do not repair files by
hand. If it left a transaction behind, name `npm run version:recover` and wait
for the maintainer.

### 5. Update the manifest

`PROJECT_MANIFEST.md` names the release-train version in section 1. Replace
the old version there with the new one. Change nothing else in the manifest.

### 6. Rebuild and validate

Run, in this order:

```bash
npm run build:dist
```

```bash
npm run release:validate
```

`release:validate` must pass, which confirms nine-way parity and no retained
transaction. If it fails, stop and show the finding.

Run `npm run build` as well when inputs of tracked generated resources changed
in this change set (phase or guidance resources, init resources, the shared
artifact readers). When unsure, run it and report whether any tracked file
changed.

### 7. Report

Report in a few lines:

- the old and the new version, and the level with its reason;
- the result of `npm run version:set` and of `npm run release:validate`;
- the files that changed, from `git status --short`;
- what was not run: `npm run release:check` (or
  `node packages/orchestrator/scripts/release-candidate-check.mjs` for
  uncommitted work), the commit, the pull request and the release draft. These
  stay with the maintainer.
