# WP14 plan

Status: approved on 2026-11-11 with `Approve, all (a)` · Requirements:
[requirements.md](requirements.md) · Authority: no new ADR

WP14 is one change set with one report,
`documentation/work/261111-wp14-permission-denial-list/implementation-report.md`.
The owner commits by hand. At `ef34b98` the working tree holds only the
tracker's Stage 2 replanning edits and these documents.

The plan assumes the recommended answers: Q1 (a), Q2 (a) and Q3 (a). Another
answer changes T1, T5 or T7 as noted there.

Size: about 2–3 days. The brief's "about 1 day" covered the flag and the
list; the owner added the rule proposal on 2026-11-11, and R6 adds the status
view.

## Approach

The change stays inside the modules that already own each concern:

- **Vendor adapter (`adapters.ts`).** It builds every Claude argv and decodes
  every Claude stream. It gains the flag and one pure stream reader,
  `claudePermissionDenials`, beside `claudeTurnCount`. Text is redacted and
  bounded there, with the rules the progress observer already uses.
- **Permission module (`claude-permissions.ts`).** It owns the audit and its
  remediation text. It gains two pure functions: one decides whether a denied
  command gets a proposed rule, one renders the block from a list and an
  audit. Its imports stay `models` and `types`.
- **Runner (`workflow.ts`).** `withContextAccounting`'s `finish` already
  receives each attempt's usage, inventory and turn count for completed and
  failed attempts. The list travels the same way; the runner appends the event
  and prints the block.
- **Store (`store.ts`) and human status (`cli.ts`, `interactive.ts`).** One
  reader returns the latest `attempt.permission_denials` event of an attempt.
  Human status calls it for a blocked or failed run.

No state schema, control contract, report contract, instruction text or
plugin file changes. Tests come first and run against today's code.

## Tasks

### T1 · Vendor evidence (Q3)

Runs first after approval, before any argv change. Everything downloaded goes
into the session scratchpad, is never executed, and is deleted after the
counts are recorded.

- Fetch `@anthropic-ai/claude-code-darwin-arm64@2.1.290` with
  `npm pack <spec> --pack-destination <dir> --ignore-scripts`, unpack it, and
  count in its binary with `grep -c -a`:
  - `--permission-prompts`;
  - `permission_denials`;
  - `subtype:"permission_denied"`.
- Record the same counts for the installed client and its version.
- If a count on 2.1.290 is zero or the download fails, stop before T3 and
  report. A missing flag means a version gate or a higher minimum, which is
  the owner's decision.
- Under Q3 (b) this task records only the installed client's counts.

### T2 · Tests first

Add these tests and run them against today's code. Tests marked "new
behaviour" must fail first, and the report lists them. A test that imports a
symbol not yet exported fails its whole bundled file; add the export as a stub
first, as in WP7 and WP8.

- `adapters.test.ts`:
  1. Each of the three Claude argv builders emits `--permission-prompts none`
     once, directly after `--permission-mode dontAsk`, fresh and resumed,
     scoped and ambient (new behaviour). Existing exact-argv assertions are
     updated in the same step and listed in the report.
  2. No Codex argv contains the flag (guard).
  3. `claudePermissionDenials` on a fixture stream with three denied calls,
     one retried and one from a subagent, returns the R2 list in first-seen
     order with reason types and subagent flags (new behaviour).
  4. A stream with `permission_denied` events and no `result` returns those
     calls without input (new behaviour).
  5. A `result` entry with no matching event, a malformed entry, and a stream
     without denials (new behaviour).
  6. A secret in a denied command is redacted, and a long command is bounded
     (new behaviour).
  7. A failed process (`ProcessExitError`) carries the list (new behaviour).
- `claude-permissions.test.ts`:
  1. Rule eligibility: a plain command gets `Bash(<command>)`; a compound,
     piped, redirected, substituted, multi-line, parenthesised or over-long
     command gets none (new behaviour).
  2. The block: heading, repeat counts, the subagent mark, the deny-or-ask
     mark, the 20-call cap, distinct rules as a JSON fragment, and the closing
     line (new behaviour).
  3. The target file follows the audit: scoped, ambient, and an untrusted
     checkout with the trust step first (new behaviour).
  4. An empty list renders nothing (new behaviour).
- `workflow.test.ts`, with a fake adapter that returns a list:
  1. An implementation attempt with denials appends one
     `attempt.permission_denials` event and reports the block (new
     behaviour).
  2. A failed attempt with denials does the same, and its failure cause and
     retry eligibility are unchanged (new behaviour).
  3. An attempt without denials appends no such event and reports nothing new
     (guard).
- `agent-control.test.ts` or the existing status projection test: the JSON
  status, agent status and capabilities are byte-identical for a run with and
  without the event (guard).
- The human status test that covers a blocked run: the block appears for the
  latest attempt and is absent from `--json` (new behaviour).

Fixture streams use the field names and shapes of the 2.1.322 stream schema
recorded in the requirements. The report says that no recorded live stream
backs them until the R9 probe runs.

### T3 · Flag and stream reader (R1–R3)

- Add `--permission-prompts none` to the three builders.
- Add `PermissionDenial` to `types.ts` and `permissionDenials` to
  `AdapterResult` and to `ProcessExitError`'s evidence.
- Add `claudePermissionDenials(stdout, repoRoot)` and call it at the four
  Claude return sites, in `processExitError` and in
  `withModelFailureEvidence`.

### T4 · Rule proposal and block (R5, R7)

- Add `proposedAllowRule(command)` and
  `claudePermissionDenialReport(denials, audit, phase)` to
  `claude-permissions.ts`. The second returns lines; it prints nothing.
- Under Q1 (b) or (c), `proposedAllowRule` also returns the prefix rule and
  the block marks it as broader.

### T5 · Record, report and status (R4–R6, R8)

- `finish` in `withContextAccounting` takes the list. When it is not empty,
  the runner appends the event, runs the audit for the resolved scope and
  prints the block with `this.info`. A failed audit prints the list without
  the target file.
- Add a `RunStore` reader for the latest `attempt.permission_denials` event of
  an attempt, tolerant of a missing or damaged events file.
- Human status for a blocked or failed run prints the block for the latest
  model attempt.
- Check that evaluation, KPI, context and cancellation readers ignore the new
  event type; add a guard test if one of them enumerates event types.

### T6 · Documentation (R10)

- `PROJECT_MANIFEST.md`: the `adapters.ts` and `claude-permissions.ts` bullet
  and the Claude execution constraint.
- `packages/orchestrator/MODULES.md`: adapters, claude-permissions, workflow
  and store entries.
- `documentation/orchestrator.md`, "Claude Tool Permissions": the flag, a
  sample block, the limits (hook denials are not listed; exact rules only) and
  the statement that Banzai writes no rule.
- `import-boundaries.mjs` only if a new import edge appears.

### T7 · Gate 2 probe (R9, Q2)

- Add `test/probes/gate-2-permission-probe.ts` (pure verdict) and
  `gate-2-permission-probe-main.ts`, on the Gate 1 probe's harness, and
  `scripts/gate-2-permission-probe.mjs`.
- The scratch repository's `.claude/settings.json` allows exactly one command.
  The prompt asks for two commands: the allowed one and one that no rule
  grants. Each would create its own sentinel file.
- Verdict: pass when the four R9 checks hold; fail when the flag is rejected,
  the denied command ran, the allowed command did not, or the list is not
  exactly the denied command; inconclusive when the model ran neither command.
- `test/gate-2-permission-probe.test.ts` covers the verdict with fixture
  lines.
- `gate-2-probe.md` in this directory gives the owner the recipe for both
  client versions.
- Under Q2 (b) this task is replaced by an ADR draft that amends ADR-0046,
  and the package stops for its acceptance.

### T8 · Verify and report

- `npm run format`, then `npm run build`, then `npm run verify` and
  `npm run format:check`.
- `node packages/orchestrator/scripts/release-candidate-check.mjs` is not
  required: no release, version or instruction-layout file changes. The report
  says so.
- Write the implementation report: what changed and where, the fail-first
  list, the T1 counts, deviations from the brief, and open questions.
- Update the tracker row, the Gate 2 item's wording if the probe's name
  matters, and the settled open question about the live budget.

## Risks

- **The flag on 2.1.290.** T1 settles it before code relies on it.
- **Hook-granted writes under the flag.** The flag denies only what would
  prompt, and the hook's allow removes the prompt. Tests cannot prove the
  client's behaviour; the Gate 1 live scenarios did, without the flag. The
  owner's next real run or the WP22 probe covers a write. If the owner wants
  it in the R9 probe, T7 needs a bound run instead of a bare phase, about half
  a day more.
- **Fixture shapes.** They follow the embedded schema, not a recorded stream.
  The R9 probe is the first live confirmation.
- **Session inventory.** If the flag removes a tool from `system/init`, a
  Claude reviewer session created before the upgrade rotates once on its next
  resume (`session-inventory-changed`). This is the existing rule and needs no
  code.
- **Exact rules and Claude Code's matching.** A proposed rule is the denied
  command verbatim. Whether Claude Code matches it on the next run is the
  vendor's rule syntax; the documentation says to check the rule in a manual
  session.
