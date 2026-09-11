# ADR 0012: Independent Product Versioning and Release Policy

## Status / Date / Owner / Decision Makers

- Status: Superseded
- Date: 2026-08-10
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-10

## Related Artifacts

- Feature description:
  `documentation/features/release-confidence-pipeline/description.md`
- Feature plan:
  `documentation/development-plans/release-confidence-pipeline/plan.md`
  (must not be created until this proposal is accepted)
- Repository authority: `AGENTS.md`
- Manifest: sections 1-4, 7, 9, and 10 of `PROJECT_MANIFEST.md`
- Related decisions accepted with this record:
  - ADR-0009 defines supported runtime evidence.
  - ADR-0010 defines required/advisory evidence and release consequences.
  - ADR-0011 defines live-vendor evidence and its availability boundary.
- Related accepted decision: ADR-0006 kept its config/readiness change
  independent from a plugin version bump but did not establish a general
  version authority or release policy.

## Context and Decision Drivers

The repository ships two independently usable products:

- the Banzai plugin, consumed by Claude Code and Codex from files under
  `plugins/banzai/`; and
- the private local `@banzai/orchestrator`, consumed from its package source or
  committed executable bundle.

The plugin version is currently `1.8.0` in four consumer-visible release
surfaces:

- `plugins/banzai/.claude-plugin/plugin.json`;
- `plugins/banzai/.codex-plugin/plugin.json`;
- `marketplace.json`; and
- `.agents/plugins/marketplace.json`.

`.claude-plugin/marketplace.json` has no version field. The orchestrator version
is `0.1.0` in `packages/orchestrator/package.json`; `package-lock.json` mirrors
that workspace package version and dependency metadata. The committed
`packages/orchestrator/dist/banzai.mjs` has no separate release version
authority and is byte-checked against source.

The current manifest requires plugin parity and same-change committed-dist
rebuilds but does not answer whether plugin and orchestrator versions move
together, which plugin file wins on mismatch, which source changes require a
bump, or what evidence must precede a release. Adding CI alone touches
repository maintenance behavior, not installed plugin behavior, so an
automatic plugin bump would create a release signal without a product change.

Current and target differ as follows:

- current product versions coexist without an explicit relationship; target
  must define independent or lockstep policy;
- current plugin mismatch has no named authority resolution; target must fail
  closed rather than silently choosing a consumer surface;
- current private package and lockfile versions are both present without an
  authority distinction; target must identify source authority and derived
  mirror;
- current release checks are informal; target must require a reproducible
  evidence bundle before and after any bump; and
- current CI feature could be mistaken for release work; target must state that
  it causes no bump or release by itself.

Decision question: How are plugin and orchestrator versions related, which files
own or mirror them, when is a bump required, and which evidence is mandatory
before a bump or release?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- reflect the two independently usable products accurately;
- keep every host-consumed plugin surface synchronized;
- avoid arbitrary silent repair when release metadata conflicts;
- preserve npm lockfile determinism without making it the editing authority;
- bump only for an intended released product change;
- bind release decisions to exact source, distribution, matrix, smoke, and
  optional live evidence;
- support plugin-only, orchestrator-only, and combined release scopes; and
- keep release execution and version changes explicitly human-authorized.

## Options Considered

### Option 1: Lock plugin and orchestrator to one shared version

Require every plugin and orchestrator release to use the same semantic version
and bump both whenever either product changes.

Benefits:

- one repository release number;
- simple association between plugin source and committed bundle.

Costs and rejection reason:

- the plugin installs and works without the orchestrator;
- CI-only, plugin-only, or orchestrator-only changes create meaningless bumps
  in the unchanged product;
- moving private orchestrator `0.1.0` to plugin `1.8.0` has no compatibility
  basis. Rejected because repository co-location is not a product-version
  contract.

### Option 2: Keep independent product versions with explicit authorities and evidence

Version plugin and orchestrator independently. Treat all four plugin surfaces
as mandatory consumer authorities that must agree; fail on mismatch rather than
choosing one. Treat the orchestrator package manifest as its authority and the
lockfile as a generated mirror. Define release scopes and bump rules by the
product actually shipped.

Benefits:

- versions represent real installed-product changes;
- plugin-only and orchestrator-only releases remain possible;
- no consumer host or marketplace copy can silently lag;
- lockfile regeneration follows npm conventions;
- CI-only work can improve confidence without manufacturing a product release.

Costs and risks:

- a combined repository release can carry two different versions;
- plugin parity requires coordinated manual edits or a safe release tool;
- release owners must declare scope and inspect both products;
- private orchestrator version can stagnate unless an actual distribution
  release is identified explicitly.

### Option 3: Add one new root repository release version

Introduce a root version that increments for every release while leaving plugin
and orchestrator versions independent underneath it.

Benefits:

- one taggable repository release identity;
- product versions remain separate.

Costs and rejection reason:

- adds a third version and synchronization policy without a current publication
  mechanism;
- does not remove the need to decide product bumps;
- this feature does not perform or design repository tagging. Rejected as
  unnecessary release machinery.

### Option 4: Treat one plugin manifest as canonical and auto-rewrite the other three

Choose either the Claude or Codex plugin manifest as the source version and
have validation repair marketplace/host copies automatically.

Benefits:

- one edit location;
- mismatches can be repaired mechanically.

Costs and rejection reason:

- both host manifests and both marketplaces are consumer-facing release data;
- auto-repair mutates tracked release source during a check;
- an accidental edit to the chosen file would overwrite three conflicting
  signals rather than fail for human review. Rejected because release checks
  must be non-mutating and fail closed.

## Decision

Adopt Option 2.

Version the plugin and private orchestrator independently. Every release or
candidate checklist must declare its scope as plugin-only, orchestrator-only,
combined, or repository-maintenance-only. A change in one product does not
automatically bump the other.

Treat the four plugin version-bearing files as co-authoritative consumer
surfaces. They must contain the exact same semantic version. On missing,
malformed, or mismatched values, validation fails and changes nothing; no file
wins automatically. `.claude-plugin/marketplace.json` remains outside version
parity because it has no plugin version field.

Treat `packages/orchestrator/package.json` as the private orchestrator version
authority. Treat the `packages/orchestrator` entry in `package-lock.json` as a
generated mirror that must agree after `npm install`-style lockfile maintenance.
The root `package.json` has no product version. The committed bundle and source
map are delivery artifacts governed by build parity and do not introduce a
third version value.

Require a plugin version bump when a release intentionally ships a changed
consumer-visible plugin payload or contract, including any changed plugin
skill, packaged project template/documentation, hook or hook declaration,
contract/schema, host plugin manifest field that affects behavior, or plugin
marketplace metadata. Use semantic-version intent:

- patch for backward-compatible corrections that do not add a new public
  capability;
- minor for a backward-compatible new plugin capability or workflow behavior;
- major for an incompatible installed-plugin or contract change.

A repository-maintenance-only change to GitLab CI, local release scripts,
tests, root maintenance documentation, or the release checklist does not by
itself require a plugin bump. A plugin version bump still requires separate
explicit approval; validation never bumps automatically.

Require an orchestrator version bump only when an orchestrator release is
explicitly prepared for distribution. Apply semantic-version intent relative
to its current pre-1.0 contract and update the lockfile mirror in the same
approved release change. Source or committed-bundle changes that remain
unreleased in repository development do not automatically authorize or perform
the bump.

This release-confidence feature is repository-maintenance-only for versioning
purposes. Preserve plugin `1.8.0` and private orchestrator `0.1.0` throughout
requirements, planning, implementation, and review unless the user separately
approves a release/bump change.

Before any product bump is applied, require a clean candidate worktree on the
intended branch/base and passing deterministic `npm run release:check` evidence
at the pre-bump candidate. After the approved version edits, require all of the
following again for the exact release candidate:

- every ADR-0009 supported Node lane passes the required release-confidence
  gate;
- formatter, plugin/marketplace parity, required references, hook syntax,
  contract parity, executable mode, and committed bundle/source-map parity
  pass;
- the disposable committed-bundle smoke passes without mutation;
- actual Codex and Claude CLI versions are recorded;
- the latest ADR-0011 live result is recorded as pass, fail, unavailable, or
  not run and interpreted under ADR-0010;
- documentation, manifest, feature reports, test reports, independent review,
  and accepted-finding triage are complete;
- for a plugin bump, both marketplace copies are checked and the existing
  install/cachebuster/reinstall workflow verifies the new version in both host
  surfaces; and
- rollback/recovery steps are reviewed before publication.

Passing evidence does not publish, tag, commit, push, merge, or otherwise
authorize a release. Those remain separate explicit human actions.

## Consequences

Positive:

- versions track the product actually released;
- both host manifests and marketplaces must agree before release;
- the lockfile remains deterministic without becoming a hand-edited authority;
- committed distribution parity stays independent from version text;
- CI-only confidence work does not create a spurious plugin release;
- plugin-only, orchestrator-only, and combined releases are all expressible;
- pre- and post-bump evidence binds version edits to verified source.

Negative:

- one repository state can contain two unrelated product versions;
- plugin bumps require synchronized edits to four files;
- orchestrator development can change without a version increment until an
  explicit distribution release is prepared;
- release evidence is intentionally more work than a manifest edit.

Risks and required follow-ups:

- forgotten mirror: validation must test each individual mismatch and the
  lockfile workspace mirror;
- ambiguous scope: the release checklist must name plugin-only,
  orchestrator-only, combined, or maintenance-only before bump decisions;
- accidental auto-bump: no deterministic check may rewrite a version or
  lockfile;
- SemVer disagreement: the human release proposal must state patch/minor/major
  rationale before edits;
- stale bundle: any orchestrator source change must still rebuild committed
  dist even when no orchestrator version bump is performed;
- misleading live evidence: unavailable/not-run must stay visible and a known
  live authorization failure follows ADR-0010.

## Compliance and Confirmation

Implementation and review must confirm:

1. plugin and orchestrator versions are never forced into lockstep;
2. all four plugin surfaces are parsed, agree exactly, and no one surface is
   auto-selected or rewritten on mismatch;
3. `.claude-plugin/marketplace.json` is validated for required structure but is
   not treated as version-bearing;
4. `packages/orchestrator/package.json` owns `0.1.0` and the lockfile workspace
   entry is an agreeing generated mirror;
5. committed dist carries no separate version authority and remains
   byte/mode-checked;
6. repository-maintenance-only CI/checklist work causes no product bump;
7. every plugin payload category named above requires a separately approved
   semantic-version decision when intentionally released;
8. pre-bump and post-bump evidence requirements appear in the release
   checklist;
9. plugin bumps include all four surfaces plus install/cachebuster/reinstall
   verification;
10. this feature leaves plugin `1.8.0`, orchestrator `0.1.0`, and lockfile
    versions unchanged;
11. no check commits, publishes, tags, pushes, merges, or mutates GitLab
    settings.

## Lifecycle Links

- Supersedes: None
- Superseded by: ADR-0032
