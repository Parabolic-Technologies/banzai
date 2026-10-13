# Change Report: Artifact Declaration Cleanup

Date: 2026-10-13.
Authority: the owner requested the four identified corrections and explicitly
required historical documents and compatibility tests to remain unchanged.
Decision: [ADR-0054](../../decisions/0054-git-visible-work-artifacts.md).

## Changes and scope

- Checkout-local `.git/hooks/banzai-publication/README.md` describes the optional
  historical declaration and fixed tracked work paths, without requiring a
  declaration or layout validation.
- Checkout-local `test-pre-push.py` still refuses transition publication policy
  and now accepts an inert historical layout declaration, matching the installed
  guard. No guard executable or wrapper changed.
- `packages/orchestrator/test/helpers.ts` creates a declaration only when a
  historical `legacy` or `private` fixture is explicitly requested. Omission and
  explicit `null` create none; the existing option and compatibility callers are
  preserved.
- `documentation/orchestrator.md` describes new task binding v3 instead of
  private binding v2.

No finding was skipped. The only additional repository file is this report.
Existing ADRs, work records, prepared patch assets and repository compatibility
test files are preserved. SHA-256 comparison of the pre-fix document/test inventory
permits only the selected helper and current CLI guide to change. The project
manifest already describes binding v3 and the installed guard, so no manifest
change is needed.

## Security, design and assurance

No new or widened runtime security exposure: the guard executables, publication
controls, data paths and dependencies remain unchanged. Hook tests continue to
use disposable local Git remotes. Negative private-history, unsafe-ref and
publication-policy coverage remains present.

The existing helper owns fixture creation. Symbol reference discovery found its
callers across 28 test files; a full verification gate is appropriate for its
default change. No new helper, production responsibility or structural trigger
is introduced. No ADR lifecycle change or material Engineering Quality deviation
is required. Existing behavioral suites cover the correction; no duplicate
persistent tests were authored.

## Verification

- Manual check of the esbuild-bundled helper: default and explicit `null` produce
  no declaration; explicit `legacy` and `private` retain their exact declaration
  values. All four temporary repositories were disposed.
- Corrected local hook suite: 15/15 passed in the installed location. Its earlier
  layout-refusal assertion failed before the correction; no unrelated expectation
  or privacy check was removed.
- `prettier --check packages/orchestrator/test/helpers.ts`: passed.
- `npm run verify`: passed freshly, including typecheck, lint (0 errors and
  382 advisory warnings), all 1581 tests (0 failed, cancelled, skipped or todo),
  and committed build/resource parity.
- Scoped `git diff --check`: passed before report finalization.

Native logs are ignored beneath
`.banzai/verification/artifact-declaration-cleanup-13cf604c-1ac6-4d0d-8b75-bc97f712c6f6/`:
`verify.log` and `local-hook-tests.log`. These are manual execution records, not
helper applicability, runner approval or completion receipts. Earlier feature
release results remain historical; they are not substituted for this fix's gate.
No real remote push, installed-client/model validation or release publication is
claimed.
