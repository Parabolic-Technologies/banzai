# GitHub and npm Publication Procedure

Durable procedure for publishing a Banzai release to
[Parabolic-Technologies/banzai](https://github.com/Parabolic-Technologies/banzai)
and `@parabolic-technologies/banzai` on npm, followed by the verified
[delivery record](#delivery-record) per version. The
[release checklist](../release-checklist.md) owns candidate evidence and
authorization; this document owns the delivery order, the operator commands,
and the record of what was actually delivered.

Product owner: **Banzai International, Inc. d/b/a Parabolic ("Parabolic")**.
Author and contact: Alexander Torosh, `alexander@parabolic.io`. The root npm
workspace stays `private: true`; only the CLI workspace is published, with
`publishConfig.access: "public"` and the `https://registry.npmjs.org/` registry.

## Release notes never describe delivery state

`documentation/releases/<version>.md` describes what the release contains, its
requirements, installation commands, and migration consequences. It never
states that a tag, GitHub Release, or npm version is intended, pending, or not
yet claimed, and never says "after publication". Such statements are true only
until the release ships and then stay false in every published copy of the
notes. Verified delivery facts belong in the [delivery record](#delivery-record)
below, appended after publication; the notes link there instead.

The 2.2.0 and 2.2.1 notes originally carried pending-delivery text and were
corrected after both versions were published.

## Publication order

1. On `dev`, select the release target and run `npm run version:set -- <version>`
   once. Write `documentation/releases/<version>.md` under the rule above.
   Rebuild the committed distribution when source or embedded metadata
   changed, then run `npm ci` and `npm run release:check`.
2. Push `dev`, open the pull request to `main`, and wait for
   `release_check_node_22` and `release_check_node_24` on the exact candidate.
   Each required lane records the tree it verified as a
   `release-evidence-<lane>-attempt-<attempt>-tree-<tree>` artifact. Only the
   pull request starts a hosted run: pushing `dev` or merging to `main` does
   not, and a newer push to the pull request cancels its older run.
3. Merge to `main` with a merge commit, create tag `v<version>` on that merge
   commit, push the tag, and create the GitHub Release from the notes. A squash
   or rebase merge is allowed but cannot reuse the pull-request evidence.
4. Confirm the repository is public. The npm README loads its illustration and
   logos from `raw.githubusercontent.com` and links GitHub paths; both return
   404 while the repository is private.
5. Publishing the GitHub Release (not a draft, not a pre-release) triggers
   `.github/workflows/publish.yml`
   ([ADR-0053](../decisions/0053-single-pull-request-ci-gate-and-publish-evidence-reuse.md)).
   First, `release_evidence` checks whether the tag is bound to the
   pull-request evidence: a merge commit whose tree equals its second parent's,
   a successful `pull_request` run of `ci.yml` for that parent, and both
   required lanes of its latest attempt recording the tag's tree. Its summary
   says `Release evidence reused` with the CI run and attempt, or
   `Release evidence not bound` with the reason. When evidence is not bound,
   `release_check_node_22` and `release_check_node_24` run the complete
   `npm run release:check` on the tag in the exact supported images, and
   nothing is published unless both pass. Then `publish_npm` checks out the
   release tag, requires the tag to equal `v` plus the root `package.json`
   version, runs `npm ci`, `npm run release:validate` and
   `npm run publication:check`, skips a version already on the registry,
   publishes only the CLI workspace through npm trusted publishing (OIDC, no
   stored token), and records npm acceptance or the existing-version skip in
   the job summary. A failed `npm publish` fails the job. A successful
   job does not verify registry availability or `dist-tags.latest`:
   npm scans packages before making them available, so the job does not wait
   for registry processing. See [npm's publish-time scanning notice](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/).
   Publishing the Release is the explicit publication authorization; the `npm`
   GitHub environment can carry required reviewers as a second gate. See
   [ADR-0039](../decisions/0039-npm-trusted-publishing-on-github-release.md).
   The manual fallback below is for a registry or runner outage.

   One-time setup: on npmjs.com open the package, then Settings, then
   Trusted Publisher, and add GitHub Actions with organization
   `Parabolic-Technologies`, repository `banzai`, workflow `publish.yml`, and
   environment `npm`. Under Allowed actions, enable **Allow `npm publish`**:
   the default grants only `npm stage publish`, and the workflow's direct
   publish then fails with `403 OIDC permission denied for this action`
   after the release gate has already passed. On GitHub, Settings,
   then Environments, then `npm` can add required reviewers and restrict
   deployments to `v*` tags.

   Manual fallback, from a checkout of the tagged commit so the registry
   `gitHead` equals the tag:

   ```text
   git checkout v<version>
   npm ci
   npm publish --dry-run --ignore-scripts --workspace @parabolic-technologies/banzai --access public --registry https://registry.npmjs.org/
   npm publish --ignore-scripts --workspace @parabolic-technologies/banzai --access public --registry https://registry.npmjs.org/
   ```

   Inspect the dry-run output as well as the exit status: a workspace marked
   private can be skipped even when npm exits successfully. Registry
   authentication, organization permissions, and the 2FA challenge belong to
   the publishing operator; never put credentials in source.

6. Once npm processing completes, verify delivery separately from the workflow
   using the registry document and a fresh install:

   ```text
   curl -s https://registry.npmjs.org/@parabolic-technologies%2Fbanzai
   npx -y -p @parabolic-technologies/banzai@<version> banzai --help
   ```

   Record `versions`, `dist-tags.latest`, `time.<version>`, `dist.shasum`,
   `dist.integrity`, and `gitHead`. `npm view --prefer-online` also bypasses
   the local packument cache. Keep delivery evidence pending until these checks
   succeed; the job summary confirms acceptance or a skip, not these results.

7. Append the verified facts to the [delivery record](#delivery-record) in a
   follow-up commit on `dev`. Do not edit the release notes to announce
   delivery.

`version:set` requires a strictly greater target; never rerun it for a version
that already exists in source. Plugin and orchestrator delivery evidence stay
separate: a shared source version does not prove that both were installed or
published.

## Delivery record

Each entry records facts read from Git, the GitHub API, or the npm registry at
record time. "Not verified" means the recorder could not read the fact, not
that it is false.

### 2.2.2

- Source: tag `v2.2.2` at `2cc86bb12490d4087b426fa241b809e9b7ba46cc`
  (merge of `dev` into `main`, pull request #2); the tree is that of
  `6ccebc2`, the release-preparation commit on `dev`.
- GitHub Release: published by the release owner on 2026-09-09; the
  `Publish` workflow run was triggered by that release event. Unauthenticated
  verification still returned 404 because the repository was private.
- npm: `@parabolic-technologies/banzai@2.2.2` published 2026-09-09T20:54:53Z
  by `.github/workflows/publish.yml` through npm trusted publishing, the first
  workflow-driven publication. `dist-tags.latest` = `2.2.2`, shasum
  `23edb678544b01717aebfd0c081a8e9d3d1e7eb1`, integrity
  `sha512-2ROgzitRksLFI6O6Y6cj1t3cFiSC6k/uzdmQ2abXHYA/jsoI0jymZm19uMvfx0OylxHA85V6LY1iBo/fPsBEwA==`,
  `gitHead` `2cc86bb12490d4087b426fa241b809e9b7ba46cc`, equal to the tag. No
  provenance attestation: npm attaches provenance only for public
  repositories.
- Workflow evidence: the first run failed at `npm publish` with
  `403 OIDC permission denied` because the trusted publisher allowed only
  `npm stage publish`; after enabling Allow `npm publish` the re-run
  published, then its own verification step failed because the registry
  document had not yet propagated. At that time, verification was changed to
  wait for propagation; see [the change report](../historical-references.md).

### 2.2.1

- Source: tag `v2.2.1` at `063695f82a3b6b087ae513880a028a10ef0d86ce`
  (merge of `dev` into `main`, pull request #1); tree
  `420f9af7e64dca4978e72ca91db8b09057bab871`.
- GitHub Release: reported created by the release owner on 2026-09-09; not
  verified unauthenticated because the repository returned 404 at record time.
- npm: `@parabolic-technologies/banzai@2.2.1` published 2026-09-09T19:39:48Z,
  `dist-tags.latest` = `2.2.1`, shasum
  `1eaa906dea8bf1642860b3f27345dda552a6eb60`, integrity
  `sha512-A2HrwZuNA0cmcJu1mNXcmrKzpxB/l/WNVvToe88SJnVQcTX574bPklLm6A6Iy2RhtLjM3jIubi9OSrR+cCtkbQ==`.
  Registry `gitHead` is `e197ac7f18c9de1c4b0a47594a441549b6fe5605`, the `dev`
  tip whose tree equals the tag; the package was published from `dev`, which
  is why step 5 now publishes from the tagged commit.
- Repository visibility at record time: private (unauthenticated GitHub API
  and `raw.githubusercontent.com` asset URLs returned 404).

### 2.2.0

- Source: tag `v2.2.0` at `ae167e702fd845f3d0ac19f23df45e8668bd3f04`
  (`register the container workspace as a Git safe.directory`). The first
  public commit is `dfce8ddfe3a0fa2a70e5846a973a966a4d1f7a18`
  (`Initial Release 2.2.0`); its hosted `release_check_node_22` failed on
  container Git ownership and was fixed by the tagged commit, see
  [Private work history](../historical-references.md).
- GitHub Release: not verified.
- npm: `@parabolic-technologies/banzai@2.2.0` published 2026-09-09T14:37:55Z,
  shasum `3f92eab7dbaf47d41992c3f3f5b27025bfa2bad7`, integrity
  `sha512-3CE9QrwZDH6nTzs4kbfG+5PTND3ou3J2xr64E71c+rH5t/gD1Iem+mQ6sUqaWomy5M7HdBKec4xFTEFzmWULLQ==`,
  `gitHead` `ae167e702fd845f3d0ac19f23df45e8668bd3f04`, equal to the tag.

## Documentation and history boundary

The public working tree omits early POC work logs and iterative reports, plus
private sandbox project case studies, measurements, case inventories, and
capture instructions. Retained specifications and accepted decisions omit
private operational identifiers and machine-local paths; editorial
publication notes identify the ADR edits, whose decisions and lifecycle are
unchanged. The cleanup and verification are recorded in the
[Private work history](../historical-references.md) and the
[Private work history](../historical-references.md).

The public repository started from a fresh snapshot. Original documents remain
recoverable from the private development history, which was not pushed to the
public remote and must not be. A limited working-tree signature check cannot
certify that all secrets or confidential details are absent; review each
source snapshot before publication and keep private provenance separate from
public artifacts.
