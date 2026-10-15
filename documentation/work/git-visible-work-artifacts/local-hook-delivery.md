# Local Pre-push Delivery

The source implementation does not update the installed `.git/hooks/` copy.
Apply this delivery only under an explicit owner instruction and host filesystem
permission. Preserve unrelated hooks and stop if any original hash differs.

- Patch: [assets/local-pre-push.patch](assets/local-pre-push.patch).
- Expected original hashes: [assets/local-pre-push-originals.json](assets/local-pre-push-originals.json).
- Disposable fixture suite: [assets/local-pre-push-tests.py](assets/local-pre-push-tests.py).

The patch changes only the publication guard and its trusted checker. It removes
the private declaration prerequisite, accepts new `documentation/work/<slug>/`
source documents without inventory entries, and excludes the new verification
and execution-lock namespaces. All outgoing commits still pass the original
raw-object history inspection; checkout code is never executed. The wrapper,
remote configuration and other hooks are unchanged.

From the repository root, after comparing the installed files with the expected
SHA-256 values, review and check the patch with:

```sh
patch --dry-run -p1 < documentation/work/git-visible-work-artifacts/assets/local-pre-push.patch
```

Under the owner's delivery authorization, apply it with:

```sh
patch -p1 < documentation/work/git-visible-work-artifacts/assets/local-pre-push.patch
```

Run the supplied fixture suite beside copies of the patched `pre-push.mjs`,
`publication-check.mjs` and original `pre-push` wrapper. The fixture pushes only
to disposable local bare repositories. It verifies clean updates, new work
without declarations, private evidence deleted from later trees, tags, merge
parents, force pushes, forged tracking refs, replacement objects, shallow
history and non-regular entries. No push to the real remote is part of this step.

## Current delivery status

Applied to this checkout on 2026-10-13 under the owner's explicit instruction
to install the prepared patch, delete `.banzai/artifacts.json` and synchronize
the manifest. All three expected original SHA-256 values matched before
application. The exact patch passed `--dry-run` and was applied to the two named
hook files. The original wrapper and installed legacy test file are unchanged.

The installed files match the tested patch bytes:

| File under `.git/hooks/banzai-publication/` | Installed SHA-256 |
| --- | --- |
| `pre-push.mjs` | `128e4b197886d21c228a2cc76ea7a117a2a07b617dc1b8f63c615cfc76b56777` |
| `publication-check.mjs` | `33dc09c42e2577f92837057e101361efd5dedf2f3d6a0e30f3386976d57abdc1` |

The supplied fixture suite passed all 17 tests against copies of the installed
hook files and original wrapper. It explicitly accepts new work after deleting
the declaration and continues to block private history, machine evidence,
unsafe refs, missing policy, replacement objects and incomplete inspection.
`node --check` passed for both installed modules; `sh -n` passed for the wrapper.

Actual suite command:
`python3 /private/tmp/banzai-local-hook-delivery-qyh74hrj/installed-fixture/test-pre-push.py`.
Native output is retained beneath ignored
`.banzai/verification/local-hook-delivery-a85a8edb-b446-44d8-9042-bd2987501b9d/fixture-tests.log`.
This is manual execution evidence, not a helper applicability record or runner
receipt. The older installed `test-pre-push.py` retains pre-patch expectations;
the supplied fixture suite is the assurance owner for this delivery.

The declaration is absent; its obsolete ignore exception and present-tense
root guidance were removed. Historical work, archives and run records remain
in place. No real remote push, installed-client/model smoke or external release
publication was performed. Those remain separate evidence owners. See the
[change report](change-report.md#owner-authorized-local-hook-delivery).
