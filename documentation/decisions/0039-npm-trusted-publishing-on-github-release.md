# ADR 0039: npm Trusted Publishing on GitHub Release

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-09-09
- Owner: Banzai maintainers
- Decision makers: user, explicitly accepted in chat on 2026-09-09 (English
  translation: `I accept ADR-0039`). The workflow file was prepared at the
  user's request the same day so the proposal could be reviewed as concrete
  source; the body is immutable from acceptance and only lifecycle metadata
  changes afterwards.

## Related Artifacts

- Publication procedure: `documentation/releases/public-publication.md`
- Release checklist: `documentation/release-checklist.md`
- Workflow: `.github/workflows/publish.yml`
- Change report: `documentation/changes/npm-publish-workflow.md`
- Repository authority: `AGENTS.md`
- Manifest: sections 2 and 10 of `PROJECT_MANIFEST.md`
- Related accepted decisions:
  - ADR-0009 pins the supported Node lanes; the publish job uses the supported
    Node 24.11.1 on a hosted runner.
  - ADR-0010 makes `release:check` the deterministic release gate; the publish
    job runs that gate on the exact release tag before publishing.
  - ADR-0011 keeps default CI credential-free and vendor-free; the publish job
    stores no registry credential and invokes no model client.
  - ADR-0033 makes root `package.json.version` the release-train authority;
    the publish job requires the release tag to equal `v` plus that version.

## Context and Decision Drivers

Versions 2.2.0 and 2.2.1 were published to npm by the release owner from a
local checkout with an interactive 2FA challenge. That path works but has
three weaknesses observed during those releases: the registry `gitHead` can
differ from the release tag when the operator publishes from a branch tip; the
published artifact carries no provenance linking it to the repository, commit,
and workflow; and the human steps between the GitHub Release and the npm
release are undocumented operator memory.

The repository's release policy requires that publication remain an explicit
human authorization, that default CI keep `contents: read` and store no
credential, and that the deterministic gate run on the exact candidate.

## Options Considered

1. **Keep manual publication** from an operator machine. No repository
   change; keeps interactive 2FA. Retains the `gitHead` drift risk, produces
   no provenance, and depends on operator memory for the command sequence.
2. **GitHub Actions with a long-lived npm granular access token** stored as a
   repository secret. Automates the sequence but introduces a stored
   credential that must be rotated, can leak through workflow changes, and
   contradicts the credential-free CI stance.
3. **GitHub Actions with npm trusted publishing (OIDC)**, triggered by
   publishing a GitHub Release. No stored credential: npm exchanges the
   workflow's short-lived OIDC token for publish rights bound to the
   organization, repository, workflow filename, and optional environment.
   npm generates provenance attestations automatically. Requires npm CLI
   11.5.1+, Node 22.14+, a hosted runner, and a one-time trusted-publisher
   configuration on npmjs.com for the existing package.
4. **GitHub Packages npm registry** instead of npmjs.com. A different
   registry: consumers would need a token and scope configuration even for
   public packages, and the package would not be installable by the documented
   `npm install --global` command.

## Decision

Adopt option 3.

- `.github/workflows/publish.yml` runs only on the `release` event with type
  `published`, and only for releases that are neither drafts nor
  pre-releases. Publishing the GitHub Release is the explicit publication
  authorization. The job runs in the `npm` GitHub environment so that required
  reviewers can be added there as a second human gate without changing the
  workflow.
- The job checks out the release tag with `persist-credentials: false`,
  installs Node 24.11.1 with `actions/setup-node`, and fails unless the tag
  equals `v` plus the root `package.json` version and the npm CLI is at least
  11.5.1.
- The job runs `git --version`, `npm ci`, and `npm run release:check` on the
  tag before any registry call. Deterministic evidence therefore exists for the
  exact published tree.
- The job skips the publish step when the version already exists on the
  registry, so a re-run after a partial failure is safe and never overwrites a
  release.
- The job publishes only the CLI workspace with `--ignore-scripts`,
  `--access public`, and the explicit `https://registry.npmjs.org/` registry.
  Its token permissions are `contents: read` and `id-token: write`; the
  workflow stores and reads no registry token.
- The job reads the registry document after publishing, fails unless the
  version exists and `dist-tags.latest` equals it, and writes the publish
  time, shasum, integrity, and `gitHead` to the job summary for the delivery
  record.
- The manual command sequence remains documented as a fallback for a registry
  or runner outage; it must publish from the tagged commit.

## Consequences

Positive:

- No long-lived npm credential exists anywhere; publish rights are bound to
  this repository's workflow and environment on npmjs.com.
- Every published version carries provenance and a `gitHead` equal to the tag.
- The command sequence lives in source and is reviewed like any other change.
- A published version can never be replaced by a re-run.

Negative:

- The package must already exist on npmjs.com and its trusted publisher must be
  configured by an npm organization owner before the workflow can publish; a
  misconfiguration fails at publish time, after `release:check` has run.
- A GitHub Release published by mistake starts a publication; the `npm`
  environment's optional required reviewers are the safeguard.
- Trusted publishing does not run on self-hosted runners, so the publish job
  can never share the live-compatibility runner.
- The release validator does not yet enforce the publish workflow's layout;
  that enforcement is a possible follow-up, not part of this decision.

## Compliance and Confirmation

- `actionlint` passes on `.github/workflows/publish.yml`.
- `npm run release:validate` still passes: the validator's owned layout is
  `ci.yml` and unrelated GitHub metadata is permitted.
- The first release after acceptance confirms, from the workflow summary and
  the registry document, that the published `gitHead` equals the tag, that
  provenance is present on npmjs.com, and that `dist-tags.latest` moved.
- The delivery record in `documentation/releases/public-publication.md` gains
  an entry per release from the job summary.

## Lifecycle Links

- Supersedes: none.
- Superseded by: none.
