# Sandbox-compatible release-evidence tests

- Date: 2026-10-23
- Scope: the recurring `listen EPERM` failure in release-evidence tests.
- Related decision:
  [ADR-0053](../../decisions/0053-single-pull-request-ci-gate-and-publish-evidence-reuse.md).
- No upstream feature work document was selected. This is a standalone fix
  requested from a screenshot of the sandbox failure.

## Cause and change

The release-evidence suite started a loopback HTTP server for every verification
scenario. A network-restricted sandbox refuses that listener before the release
script runs. Rerunning outside the sandbox does not remove the next run's need
for a port, so the failure recurs.

The suite now preloads a test-only `fetch` replacement into the child that runs
the unchanged release script. The fixture uses native `Request` and `Response`
objects, records requests in the existing temporary directory, and returns the
scenario's HTTP status and body or rejects the fetch. It never delegates to the
real network. Temporary files remain under the suite's existing `finally`
cleanup.

Existing cases still exercise real Git repositories, the real script, output
files, response parsing, evidence binding and fallback. Request assertions also
cover the method, API headers, redirect rejection and pagination. Failure cases
are named for the rejected fetch they now demonstrate, without claiming to
exercise OS socket behavior. No tests are skipped.

## Files and documentation

- Tests: `packages/orchestrator/test/release-evidence.test.ts` replaces listener
  setup with the child preload and reads the recorded requests.
- Test fixture: `packages/orchestrator/test/fixtures/release-evidence-api.mjs`
  owns simulated API responses and request recording.
- Tooling: `packages/orchestrator/eslint.config.mjs` includes the fixture in
  the existing syntax-level ESM lint rules.
- Documentation: `PROJECT_MANIFEST.md` records the network-free test boundary;
  this report records the defect and verification.
- Production code: no changes. Existing unrelated working-tree changes are
  outside this fix.

## Security and compatibility

No security exposure class is introduced or widened: only the test harness and
its temporary fixture files change. Sandbox settings and production credentials,
HTTP behavior, evidence rules and release permissions retain their owners.

ADR-0053's producer identity, two-lane binding and fail-closed fallback remain
covered by the existing cases. No accepted ADR changes or escalation triggers
are needed. No review findings were accepted or skipped in this task.

## Structural assessment

- Trigger and baseline: the API fixture moves across a test-process boundary;
  the former server callback also exceeded the configured complexity limit
  (23 versus 15) and had two nested-ternary warnings.
- Reuse search: `packages/orchestrator/test/` had no existing `fetch` fixture.
  The `--import` child-preload pattern in `cli-routing.test.ts` was considered
  and reused. The original `startApi` implementation is removed.
- Owner and direction: the test suite owns scenario data and temporary files;
  the fixture owns API routing, request recording and response simulation;
  Node's native response parser and the real release script own their existing
  behavior. Production does not import test code or read the fixture variable.
- Disposition: extract the fixture into plain ESM so the real CLI child can
  preload it without a production injection hook, build-driver change or new
  dependency. Keep route selection separate from the fetch boundary to retain
  simple control flow under the existing lint limits.
- Invariants: no listener or real network request, no skipped cases, fresh
  scenario state per child, cleanup on success and failure, and unchanged
  production evidence decisions. Existing positive and negative cases plus
  lint own verification. Real network stack behavior is outside this fixture's
  assurance claim.
- Authority: within the requested defect fix. Material Engineering Quality
  deviations and remaining structural debt: None.

## Verification

Runtime: Node `v24.11.1`, inside the existing network-restricted workspace
sandbox. No elevated test run was used.

- Historical/pre-fix reproduction:
  `node packages/orchestrator/scripts/test.mjs --file release-evidence.test.ts --pattern 'verify binds a tag' --output-root .banzai/sandbox-release-evidence-baseline`
  failed with `listen EPERM` on `127.0.0.1`: 1 failed test.
- `node packages/orchestrator/scripts/test.mjs --file release-evidence.test.ts --output-root .banzai/sandbox-release-evidence-focused`:
  passed all 62 tests, with zero failures, cancellations or skips.
- Workspace-local ESLint over the changed test, fixture and configuration:
  passed with zero errors and zero warnings. The baseline had three warnings.
- `node --check packages/orchestrator/test/fixtures/release-evidence-api.mjs`:
  passed.
- `npm run verify`: passed after formatting. Typecheck passed; lint reported
  zero errors and 412 advisory warnings elsewhere in the workspace; all 1,792
  tests passed with zero failures, cancellations or skips; `build:check`
  passed. The private execution log is
  `.banzai/sandbox-release-evidence/verify.log`.
- Prettier over all five changed files and `git diff --check`: passed.

Assurance critique: the existing suite protects the reported regression and
release decisions; a new test duplicating those cases would add no material
guarantee. The successful sandbox run replaces the demonstrated setup failure
without a skip, weakened expected outcome or test-only production bypass.
