# Banzai Release Checklist

This runbook records evidence for a later explicitly authorized release. It
does not commit, tag, push, merge, publish, change GitHub settings, or authorize
those actions.

## Candidate and Scope

- [ ] Record the exact candidate commit.
- [ ] Confirm the worktree and index are clean.
- [ ] Confirm the intended branch and base (`dev` for development, `main` as
      the default release base unless the release proposal says otherwise).
- [ ] Declare the complete included-change scope: plugin-only,
      orchestrator-only, combined, or repository-maintenance-only.
- [ ] Record intended plugin and orchestrator delivery scope separately; a
      shared source version does not imply that both components will be
      installed or published.
- [ ] Confirm every required GitHub Actions result belongs to the exact candidate.
- [ ] Confirm `documentation/releases/<version>.md` describes content,
      requirements, installation, and migration only. It must not call a tag,
      GitHub Release, or npm version intended, pending, or not yet claimed, and
      must not say "after publication". Verified delivery facts are appended to
      the [delivery record](releases/public-publication.md#delivery-record)
      after publication, never predicted in the notes.

## Runtime Policy

<!-- release-policy:start -->

Engines: `>=22.20.0 <23 || >=24.11.1 <25`

Version authority: `package.json#/version`; 9 fields in 7 files.

| Evidence              | Node    | Image                   | GitHub Actions job              | Policy   |
| --------------------- | ------- | ----------------------- | ------------------------------- | -------- |
| Supported (blocking)  | 22.20.0 | `node:22.20.0-bookworm` | `release_check_node_22`         | required |
| Supported (blocking)  | 24.11.1 | `node:24.11.1-bookworm` | `release_check_node_24`         | required |
| Forward compatibility | 26.7.0  | `node:26.7.0-bookworm`  | `forward_compatibility_node_26` | advisory |

<!-- release-policy:end -->

- [ ] Recheck the exact pins against maintained Node releases.
- [ ] Confirm each deterministic image provides Git and its job passes the
      `git --version` preflight and registers the workspace as a Git
      `safe.directory` before `npm ci`.
- [ ] Confirm Node 23 and Node 25 are neither supported nor run.
- [ ] Treat a required runner/image/registry/setup failure as unsatisfied
      evidence; classify and retry it without calling it pass.
- [ ] Record an advisory Node 26 failure and its follow-up disposition; it does
      not by itself block the current supported release.

Adding or removing a supported major requires a new ADR. Advancing a patch
floor within an accepted major requires an explicit release-plan change,
updated engines/pins/documentation, and passing evidence at the new floor.

## Deterministic Evidence

- [ ] Run `npm ci`.
- [ ] Run `npm run release:check` without a TTY.
- [ ] Record direct `npm run format:check`.
- [ ] Record direct `node --check plugins/banzai/hooks/spec-gate.cjs`.
- [ ] Confirm plugin JSON and required fields are valid.
- [ ] Confirm root `package.json.version` is the sole release-train authority
      and all nine fields in seven files agree:
  - [ ] `package.json#/version`;
  - [ ] `plugins/banzai/.claude-plugin/plugin.json`;
  - [ ] `plugins/banzai/.codex-plugin/plugin.json`;
  - [ ] `marketplace.json`; and
  - [ ] `.agents/plugins/marketplace.json`;
  - [ ] `packages/orchestrator/package.json`; and
  - [ ] `package-lock.json#/version`;
  - [ ] `package-lock.json#/packages//version`; and
  - [ ] `package-lock.json#/packages/packages~1orchestrator/version`.
- [ ] Confirm `.claude-plugin/marketplace.json` structure; it has no version.
- [ ] Confirm `.banzai-version-set`, `.banzai-version-set.guard`, and
      `.banzai-version-set.guard.tmp` are absent. Any retained transaction,
      durable cleanup guard, or incomplete guard temporary blocks validation
      even if all nine values agree.
- [ ] Confirm required hook, skill, contract/schema, and entry paths.
- [ ] Confirm plugin/runner contract parity through the full tests and doctor
      smoke.
- [ ] Confirm `packages/orchestrator/dist/banzai.mjs` mode is `0755`.
- [ ] Confirm bundle and source map match a fresh build byte-for-byte.
- [ ] Record `npm run smoke:committed` with
      help/init/agent-control/doctor/eval identities, deterministic repeated
      output, no mutation, and cleanup.
- [ ] Confirm no `.test-dist`, `.dist-check-*`, scratch checkout, live auth
      root, or unexpected root `.banzai` remains.
- [ ] Record `git diff --check`.
- [ ] Record GitHub Actions syntax validation (`actionlint`) as pass, fail, or
      unavailable; local validation does not prove a hosted workflow run.

## npm CLI Distribution

Apply this section when the release includes npm distribution of
`@parabolic-technologies/banzai`; plugin delivery remains separate.

- [ ] Keep the root workspace `private: true`; confirm only the CLI package is
      publishable, with `publishConfig.access: "public"` and the intended
      `https://registry.npmjs.org/` registry.
- [ ] Confirm the CLI version and embedded metadata match the approved source
      candidate and its GitHub release; rebuild and revalidate changed inputs.
- [ ] Pack only `@parabolic-technologies/banzai` and inspect the actual tarball:
      package metadata, README, LICENSE, NOTICE, bundle, and source map; confirm
      the `banzai` executable mode and absence of credentials or local run data.
- [ ] Install that tarball into an isolated consumer and run the existing
      committed smoke against the installed bundle on the supported runtimes.
      Do not substitute a source-checkout link for package-install evidence.
- [ ] Verify npm authentication, organization publishing rights, the intended
      version's availability, and any required operator authentication step.
- [ ] Run `npm publish --dry-run --ignore-scripts --workspace @parabolic-technologies/banzai --access public --registry https://registry.npmjs.org/`
      and confirm the output does not skip a private workspace; exit 0 alone
      is insufficient.
- [ ] Confirm the GitHub repository is public. The npm README loads assets
      from `raw.githubusercontent.com` and links GitHub paths that return 404
      while the repository is private.
- [ ] Confirm the npm trusted publisher for `publish.yml` (organization
      `Parabolic-Technologies`, repository `banzai`, environment `npm`) exists
      on the package with **Allow `npm publish`** enabled; `npm stage publish`
      alone makes the workflow fail with `OIDC permission denied`. For the
      manual fallback,
      publish from a checkout of the tagged commit (`git checkout v<version>`)
      so the registry `gitHead` equals the tag; a branch tip with an identical
      tree records a different commit.
- [ ] Publishing the GitHub Release is the explicit publication authorization:
      `publish.yml` publishes only the CLI workspace after `release:check` on
      the tag. Record the job summary's registry metadata, artifact integrity,
      and a fresh registry-install smoke as separate post-publication evidence.
- [ ] Verify the published version from the registry document itself
      (`curl -s https://registry.npmjs.org/@parabolic-technologies%2Fbanzai`)
      rather than a possibly cached `npm view`: `versions`, `dist-tags.latest`,
      `time`, `dist.shasum`, `dist.integrity`, and `gitHead`. Do not infer
      publication from pack, dry run, tests, or matching source versions.
- [ ] Append the verified facts to the
      [delivery record](releases/public-publication.md#delivery-record) in a
      follow-up commit. No other document carries pending-delivery text.

See the [GitHub and npm publication procedure](releases/public-publication.md)
for the initial release order and operator commands.

## Required and Advisory CI

- [ ] Configure branch protection or rulesets to require the two supported
      GitHub checks after their first hosted run; YAML alone does not enforce
      merge protection.
- [ ] `release_check_node_22` passed at Node 22.20.0.
- [ ] `release_check_node_24` passed at Node 24.11.1.
- [ ] Required product failures are fixed and rerun.
- [ ] Required environment failures are classified and rerun; evidence remains
      unsatisfied until pass.
- [ ] Record `forward_compatibility_node_26` as pass or fail.
- [ ] Confirm no default/fork job invoked Codex, Claude, auth, or a paid model.

Repository policy permits merge only with both required supported-lane passes.
The advisory lanes are not dependencies of required jobs.

## Live Compatibility Evidence

- [ ] Before enabling `BANZAI_LIVE_COMPATIBILITY=1`, verify the dedicated
      runner group's access is restricted to this repository's workflow at
      trusted protected refs. A label alone is not an access control. If that
      boundary is unavailable, retain live evidence as `not run`.
- [ ] Record actual Codex CLI version or `unavailable/not run`.
- [ ] Record actual Claude CLI version or `unavailable/not run`.
- [ ] Record the latest `banzai-live-compatibility/v2` overall state:
      `pass`, `fail`, `unavailable`, or `not run`.
- [ ] If run, confirm protected ref, explicit enable input, manual action,
      protected subscription-only auth roots, two-call/five-minute/fifteen-
      minute bounds, no retained artifact, closed summary, and cleanup.
- [ ] If run, confirm Codex denial evidence came from the exact runner-owned
      write-probe command events using either the direct command or one fully
      anchored supported shell wrapper, without extra prefixes, suffixes,
      operators, or arguments. Confirm Claude evidence correlated exact
      `Write`, packaged `PreToolUse` hook, and tool-result events. Do not accept
      assistant prose, untyped JSON, or fabricated command output as permission
      evidence.
- [ ] Do not cite unit/fake-hook tests as proof of actual vendor permissions.
- [ ] If unavailable or not run, record that real permission behavior was not
      proven; this does not by itself block source completion or release.
- [ ] If a live environment failure persists after bounded retry, record it as
      unavailable evidence, not pass.
- [ ] If a live product/authorization check failed, stop release unless a
      separate explicit human release-risk acceptance identifies the exact
      failed check and rationale.

## Version Decision

Current release-train identity:

- sole authority: root `package.json#/version`;
- mandatory mirrors: the four plugin/marketplace fields, the orchestrator
  package version, and all three lockfile version fields listed above;
- committed dist: delivery evidence, not a version authority.

- [ ] State whether the included changes affect the plugin, orchestrator, both,
      or repository maintenance only.
- [ ] Select one explicit canonical SemVer target and record patch/minor/major
      rationale from the highest impact across the complete included plugin and
      orchestrator change set.
- [ ] Obtain explicit release-owner approval for the target, which must be
      strictly greater than the current nine-way release-train value.
- [ ] Confirm repository-maintenance-only CI/scripts/tests/root docs/checklist
      work did not manufacture a release-train bump unless an explicit Banzai
      release is being prepared.
- [ ] Run `npm run version:set -- <version>` once for the approved target and
      record its successful nine-field/seven-file result. The command does not build,
      validate, test, install, publish, or perform Git delivery.
- [ ] Run `npm run release:validate` after synchronization and confirm both
      nine-way parity and absence of unresolved transaction state.
- [ ] Rebuild the committed distribution after source or embedded release-policy
      changes, then rerun all deterministic and
      supported-lane evidence for the exact candidate.
- [ ] Record observed plugin install/publication and orchestrator
      install/publication states independently as `pass`, `fail`,
      `not applicable`, `not run`, or `unavailable`; never infer them from
      matching source metadata.
- [ ] Record the explicit capability/contract evidence used for runtime
      compatibility. The release-train version is not a machine-contract
      compatibility signal.

## Major boundary

For every `X.0.0` release:

- [ ] Confirm `release-policy.json.compatibility` declares exactly one supported
      version per resource family for the target major.
- [ ] Confirm removed readers, producers, schemas, fixtures, migration procedures
      and maintained-documentation claims are gone; retained ADR and original
      extraction evidence stays unchanged except authorized lifecycle metadata.
- [ ] Confirm the release note has `## Removed compatibility`, lists every removed
      family/version and states the required operator actions.
- [ ] Confirm the rollback target is the last release of the previous major,
      with its complete source/tooling and separately recorded delivery evidence.

## Workflow and Human Authorization

- [ ] Confirm description, accepted ADRs, approved plan, implementation report,
      and test report agree.
- [ ] Confirm committed dist was rebuilt after source changes.
- [ ] Confirm independent source-read-only feature review is complete.
- [ ] Confirm every finding has human triage and only accepted IDs were fixed.
- [ ] Confirm all five Banzai human decision gates and exact-path hook boundary
      remain intact.
- [ ] Record the human release owner and explicit release authorization.

Passing automation is evidence only. It is never release authorization.

## Rollback and Recovery

Before publication:

- [ ] Identify the complete last-known-good candidate and commit; restore all
      nine release-train fields together using that candidate and its tooling.
- [ ] If local synchronization is incomplete, stop and run
      `npm run version:recover` to restore the transaction's exact originals.
      The fixed cleanup guard preserves those originals while the main journal
      removal is being synced. Recovery must authenticate any coexisting
      journal remnants against that guard before target restoration or
      recursive cleanup. Recovery accepts only grouped seven-file format 2;
      it checks all original/candidate bytes and modes before any restoration.
      Unsupported journal versions and later edits cause refusal while preserving
      targets and evidence. This command does not select a release rollback target.
- [ ] Preserve the last known-good install/reinstall instructions and
      marketplace references.
- [ ] Define how to stop publication before retrying a partial operation.
- [ ] Define how to restore the complete known-good source candidate, rebuild
      the orchestrator bundle, and revalidate all applicable release values before any
      renewed install or publication attempt.
- [ ] Define component-specific recovery for plugin marketplace/cache state and
      orchestrator distribution/install state; record what was actually
      restored instead of inferring it from the shared source version.
- [ ] Re-run deterministic and supported-lane checks after recovery.
- [ ] Record the failure, recovery action, and whether live evidence is now
      pass, fail, unavailable, or not run.

The future 15-30-task evaluation cohort and team pilot are a separate activity
and are not a release-confidence implementation gate.
