# ADR 0070: Orchestrator-Owned Instruction Copy

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-11-16
- Owner: Banzai maintainers
- Decision makers: Repository owner; explicitly accepted in chat on 2026-11-16
  with `Accept both` (ADR-0070 and ADR-0071).
- Acceptance date: 2026-11-16
- Accepted proposal SHA-256: `6899c1c128be694c3f1455e1afd28acc9ebfdf937d43c4c08b6359c078b77e85`.
- Owner choice at acceptance: (c), in the owner's words
  `Видаляємо скіл orchestrate, він непотрібен` (we remove the orchestrate
  skill; it is not needed). Option (c) and the text that carries it, in
  sections 3, 4, 7 and 8, the risks and compliance item 12, were added to
  the proposal from that answer before the status changed.
- Lifecycle effect: the amendments in Lifecycle Links are accepted and their
  reciprocal links are recorded. The proposal-stage wording and the decision
  body are retained unchanged. Dependent planning is authorized; plan
  approval is still required before implementation.
- Owner choices given on 2026-11-16, before drafting:
  - whether the orchestrator's instruction texts are separated from the
    plugin's: "Yes, decouple";
  - DC-1, which plugin files keep the baseline transition rule:
    "Hook only (Recommended)".

  This ADR records them as written. One further owner choice is open at
  acceptance; see [Owner choice at acceptance](#owner-choice-at-acceptance).

- Review: one independent read-only review on 2026-11-16, requested by the
  owner with `Review them first`. It raised five major and five minor
  findings. Each was checked against the sources and all are applied:
  - the runner's installed-resource parity check is decided, and what a
    published CLI does with a newer plugin is stated as it is;
  - the baseline is closed and succeeded, not re-pointed, and the amendment
    to ADR-0044 names the sections it changes;
  - the rule that no transition may change the hook configuration or a
    plugin manifest is lifted, because ADR-0069 needs both changed;
  - the release validator's and the tests' pins on plugin text are covered;
  - every control that ends is listed under security exposure;
  - the shape published CLIs check is complete;
  - the hook is stated to stay coupled to the orchestrator's sources;
  - the frozen copy is the tracked generated module, an option the first
    draft did not consider, and the contracts are classified.
- Implementation state: Planned. See the work plan.
- Preparation authority: the owner's question of 2026-11-16, asked in place
  of an answer to a consultation card on shared text: whether plugin policies
  and skill text can be decoupled from the orchestrator. Preparing this
  proposal is not acceptance.

## Related Artifacts

- Work plan:
  [plan.md](../work/261116-standalone-plugin-rework/plan.md), package P11.
- [ADR-0071](./0071-path-scoped-verification-gate.md) (Proposed) depends on
  this decision.
- Code, as of 2.8.3 with ADR-0069 accepted; no plugin file has changed since
  2.8.3:
  - `packages/orchestrator/scripts/phase-resources-build.mjs` reads the
    plugin's phase documents, guidance, policies, skills and hook files. It
    generates the tracked `src/phase-resources.ts` (about 104 KB), which
    holds the embedded text and the digests of the hook script and hook
    configuration;
  - `npm run build:check`, part of `npm run verify`, fails when that
    generated source is stale;
  - `packages/orchestrator/phase-guidance-current.json` holds 97 pinned
    expectations: 48 on skills, 32 on guidance, 7 on phases, 6 on policies,
    2 on the hook files and 2 on the plugin manifests. Its validation
    replays 21 transitions from a pinned root against the plugin's files. No
    transition may change `hooks.json` or a plugin manifest, and
    `orchestrate/SKILL.md` changes only under four named ADRs;
  - `src/phase-instructions.ts` compares the phase documents, guidance,
    policies and hook files of a resolved plugin directory with the embedded
    digests, and `src/workflow.ts` refuses the call on a mismatch. A CLI
    installed from npm resolves no plugin directory and reports parity as
    unverifiable;
  - `packages/orchestrator/scripts/check-release.mjs` and several tests pin
    fragments of plugin skills, policies, guidance and templates;
  - `src/adapters.ts` and `src/setup-client.ts` accept an installed plugin
    only with its manifest name, its skills path, eleven named skill files
    that are not empty, `orchestrate` among them, and
    one hook group, before and after tool use, whose matcher holds five
    named tools and whose command contains the literal
    `${CLAUDE_PLUGIN_ROOT}/hooks/spec-gate.cjs`;
  - orchestrator source imports `plugins/banzai/lib/*.mjs` and
    `plugins/banzai/contracts/**/*.json` directly.
- Accepted ADRs:
  - [ADR-0042](./0042-runner-delivered-phase-instructions.md): the plugin's
    guidance is "the single canonical source", the skills'
    `Orchestrated Mode` sections stay byte-unchanged as a transitional
    exception, and section 6 adds the installed-resource parity check.
    Amended by sections 1, 2 and 4.
  - [ADR-0036](./0036-vendor-neutral-policy-files-and-instruction-delivery.md):
    the canonical policy files live in the plugin, and runners deliver their
    bodies inline. Amended by section 1.
  - [ADR-0044](./0044-instruction-baseline-evolution.md) (pinned): section 1
    keeps one current baseline with an ordered chain, and section 3 items 4
    and 5 keep drift detection against the plugin's files. Amended by
    section 3.
  - [ADR-0069](./0069-standalone-plugin-control-model.md): its packages
    change the hook configuration and the Codex manifest, which no
    transition can express today. Section 3 makes that possible. Its
    section 7 says no skill file is removed; amended by section 7 here under
    owner choice (c).
  - [ADR-0018](./0018-agent-supervised-banzai-cli-control.md): adds the
    optional `orchestrate` skill as the supervisor of the CLI's control
    contract. Amended by section 7 under owner choice (c); the control
    contract itself is unchanged.
  - [ADR-0020](./0020-scoped-claude-subprocess-environment.md): the
    structural check of an installed plugin names eleven skills. Amended by
    section 7 under owner choice (c).
  - [ADR-0033](./0033-root-package-version-authority.md): unchanged.
- Manifest sections 2, 3, 4, 5, 8 and 10.

## Context and Decision Drivers

Decision question: while the plugin is reworked and the orchestrator is
frozen, what is the orchestrator's instruction set, and what protects it?

Current state. One set of files under `plugins/banzai/` serves two
consumers. Standalone skills read policies and guidance from the installed
plugin. The orchestrator's build embeds the same files, with the phase
documents, into its bundle. The instruction baseline pins all of it, the
skills included, and every change needs a recorded transition that cites an
Accepted ADR.

What follows from that today:

- any edit to a policy, a guidance file or a pinned skill section makes a
  generated orchestrator source stale, so the orchestrator must be rebuilt
  and its prompt tests rerun for a change that concerns standalone work;
- the plugin rework rewrites this text for standalone use on current models.
  A later orchestrator build would embed text that no runner phase was ever
  run with;
- each text edit of the rework needs a transition and an ADR authority,
  though the runner does not read skill text at all (ADR-0042);
- the accepted ADR-0069 needs new hook events and a separate hook file for
  Codex, and the baseline forbids every transition that names
  `hooks.json` or a plugin manifest.

The owner has put orchestrator work on hold until the comparison study
reports, and froze its publication. Nothing in this ADR decides its future.

Decision drivers:

1. A change to standalone text must not touch the orchestrator's build or
   tests.
2. The frozen orchestrator keeps exactly the instruction text it was
   validated with.
3. Code that both products execute stays one copy and stays tested.
4. The control on instruction drift stays where a wrong byte changes what a
   runner phase or the gate does.
5. A CLI installed from npm keeps running with a newer installed plugin.

### Security exposure

Judged by mechanism under the Security Assurance policy: no exposure class
applies at run time. No access decision, input path, secret, personal data
or outbound request changes; the hook, which makes the access decision,
stays pinned.

Governance controls that end, each replaced by pull-request review:

- the transition rule for the plugin's policy text, the Security Assurance
  policy included;
- the same rule for plugin guidance, which holds the ADR lifecycle rules,
  and for skill text, which states the decision gates;
- the whole-file pin on `feature-status`;
- the check that the plugin's archived text equals the embedded text;
- under owner choice (b), the pin on the `orchestrate` skill, which holds
  the supervisor's rules for the CLI; under owner choice (c), those rules
  themselves, so an agent that drives the CLI has no packaged instructions.

## Options Considered

### Option 1: Keep one source for both consumers

No duplication. Rejected: it is the coupling drivers 1 and 2 describe.

### Option 2: Keep one source and run every test when shared text changes

Keeps the frozen CLI releasable at every merge. Rejected by the owner's
"Yes, decouple": the text packages of the rework would stay slow, and the
runner would still receive text written for another purpose.

### Option 3: Build the orchestrator from the plugin at a release tag

No second copy in the tree. Rejected: every build, test run and shallow CI
checkout would need the tag's objects.

### Option 4: Split the repository

The strongest separation. Rejected for now: the hook, the library and the
contracts are used by both products and would need a shared package, and
the orchestrator's future is decided with the study report.

### Option 5: Remove the orchestrator from the build

Nothing to keep in step. Rejected: it removes the tests that protect the
shared hook and library, and the ability to release the CLI at all.

### Option 6: A directory of instruction files in the orchestrator package

The generator keeps working, reading other paths. Rejected: the text would
exist three times (plugin, copy, generated module), the copy must be exact
to the byte at the moment of the split, and the baseline's keys, which name
plugin paths, cannot be re-pointed without changing its mechanism anyway.

### Option 7: Keep the plugin's policies, or all of its text, pinned

The alternatives of DC-1. Rejected by the owner: every text edit of the
rework would still need a transition and an ADR authority.

### Option 8: Freeze the tracked generated module, pin the hook (selected)

Sections 1 to 7. The embedded text already exists as a tracked source of
the orchestrator; freezing it needs no copy and no exact split.

## Decision

### 1. The tracked generated module is the orchestrator's instruction set

- `src/phase-resources.ts`, as tracked when this decision is implemented,
  is the orchestrator's own copy of the phase documents, guidance and
  policies. It is no longer generated from plugin files.
- The orchestrator's build, its bundle and its tests take runner
  instruction text only from that module.
- No build or check compares it with the plugin's files.
- Its instruction entries change only through the successor baseline of
  section 3.

### 2. The plugin's text is ordinary source

- The plugin's skills, policies, guidance and templates are changed by pull
  request and review. They need no baseline transition and no ADR per edit.
- ADR eligibility is unchanged: a change of a gate's meaning, of an
  authorization or of another architectural commitment still needs its ADR.
- ADR-0042's transitional exception for the skills' `Orchestrated Mode`
  sections ends. They are plugin text.
- The plugin's phase documents are read by nothing after this decision.
  Removing them is a text change like any other.
- Standalone skills keep reading policies and guidance from the installed
  plugin.

### 3. The baseline is closed and succeeded

- The current baseline, its preserved root and its chain of transitions
  are kept unchanged as a record. The release validator pins them by digest.
  They are no longer replayed against the plugin's files.
- A successor baseline with its own identity pins what a runner phase or
  the gate executes: the instruction entries of the frozen module, the hook
  script, the hook configuration, both plugin manifests and, under owner
  choice (a) only, the `orchestrate` skill with its protocol reference.
- A pinned resource changes only through a transition in the successor
  baseline that cites an Accepted ADR. The hook configuration and the plugin
  manifests may change that way; the rule that forbade it ends.

### 4. Installed-resource parity covers the hook only

- The runner compares the hook script and the hook configuration of a
  resolved plugin directory with the digests it was built with, and refuses
  on a mismatch, as today.
- It no longer compares phase documents, guidance or policies. Runner
  phases receive that text from the frozen module.
- This and section 7, under owner choice (c), are the only changes to
  runner behaviour in this decision.

### 5. Shared code stays shared, and stays coupled

- The hook, `plugins/banzai/lib` and `plugins/banzai/contracts` remain one
  copy, used by both products.
- A change to the hook script or the hook configuration updates the digests
  in the frozen module, so it is also a change to an orchestrator source.

### 6. Checks that pin plugin text follow the text's owner

- A check of the release validator or of a test that describes runner
  instruction text reads the frozen module.
- A check that describes standalone text stays on the plugin's files. It is
  an ordinary test, changed in the same pull request as the text.
- A check that only tied the two copies together ends.

### 7. The `orchestrate` skill, by the owner's choice

- Under owner choice (a) or (b) the skill and its protocol reference stay
  in the plugin, pinned or not.
- Under owner choice (c) they are removed from the plugin. The CLI's control
  contract stays in the frozen CLI, with no packaged supervisor. The
  runner's structural check of an installed plugin and the setup check stop
  requiring that skill. The template and the guides stop naming it.

### 8. The plugin keeps the shape published CLIs check

Until a CLI release changes its own check, the plugin keeps:

- its manifest name and skills path;
- the skill files that check names, each not empty: all eleven under owner
  choice (a) or (b), the other ten under owner choice (c);
- one hook group, before and after tool use, whose matcher holds the five
  tools that check names and whose command contains the literal path of the
  hook script;
- a project template whose `AGENTS.md` carries the `Authority` and
  `Policies` headings the adoption check looks for.

New hook events and wider matchers are added beside that group, not in
place of it.

### 9. The copies diverge on purpose

No build or tool updates the frozen module from the plugin. Bringing the
two together again, in either direction, is a decision taken when
orchestrator work resumes.

### What does not change

The release-train version (ADR-0033); the structural check of an installed
plugin (ADR-0020) apart from section 7; release validation of plugin
manifests, of the control contract's identities and of the manifest's
pinned fragments; the standalone verification helper; every other runner
behaviour.

## Owner choice at acceptance

The `orchestrate` skill and its protocol reference. (a) They stay pinned in
the successor baseline (recommended: they are the supervisor's rules for the
frozen CLI, and the release validator already pins the identities they
name); (b) they become ordinary plugin text like the other skills; (c) they
are removed from the plugin. Option (c) was added by the owner's answer at
acceptance.

## Consequences

Positive:

- A change to a skill, a policy or a guidance file leaves the orchestrator's
  build and tests untouched.
- The frozen CLI keeps the text its prompts were tested with.
- The rework's text packages need no transition and no ADR authority.
- ADR-0069's hook packages become expressible: the hook configuration and
  the Codex manifest can change through a transition.
- The baseline shrinks to what a runner phase or the gate executes.

Negative:

- The frozen text lives inside a TypeScript module, which is harder to read
  and to review than Markdown files.
- Two sets of policy and guidance text exist and drift apart. A project
  that uses both a CLI and a newer plugin gets runner phases and standalone
  skills that follow different text.
- A rule change in a plugin policy no longer leaves a transition record.
- Every hook change still touches an orchestrator source and still needs a
  transition and, by the release validator's rule, a version change.
- ADR-0044 is pinned, so its lifecycle note needs an allow-list image.
- Resuming orchestrator work starts with reconciling the two copies.

Risks:

- A CLI already published compares text as well as the hook. With a
  configured plugin directory, or linked from source, CLI 2.8.x refuses a
  plugin whose policies, guidance, phase documents or hook differ from its
  own. Those setups must keep the plugin they were released with, or use
  ambient mode. This follows from changing the plugin at all, with or
  without this decision.
- A plugin change that breaks the shape of section 8 makes published CLIs
  reject the installed plugin.
- Under owner choice (c) every CLI already published still names the
  `orchestrate` skill in its checks. Where such a CLI inspects the plugin,
  it reports the plugin as incomplete.
- Text that only the frozen module still carries can be mistaken for the
  current rule by a reader of the repository.

Required follow-ups: the work plan's package P11; manifest sections 2, 3,
4, 5, 8 and 10; the contributor guide; lifecycle notes on ADR-0042, ADR-0036
and ADR-0044 at acceptance.

## Compliance and Confirmation

1. The instruction entries of `src/phase-resources.ts` are byte-identical
   before and after the implementation, and equal the plugin's files of
   2.8.3.
2. Changing a byte of a plugin skill, policy, guidance file or template
   leaves `npm run build:check` and the baseline validation passing and no
   tracked orchestrator file stale.
3. Changing an instruction entry of the frozen module, the hook script, the
   hook configuration or a plugin manifest without a recorded transition
   fails the validation of the successor baseline.
4. A transition in the successor baseline that changes the hook
   configuration or a plugin manifest and cites an Accepted ADR validates.
5. The closed baseline file and its root keep their pinned digests.
6. With a resolved plugin directory whose policy text differs and whose
   hook is unchanged, the runner reports parity as verified; with a changed
   hook it refuses.
7. Prompt and phase-instruction tests of the runner pass with no changed
   expectation.
8. A standalone skill resolves its policies and guidance from the installed
   plugin, as before.
9. A test fails when the plugin loses a required skill file, the manifest
   name, the skills path, the hook group of section 8 or a required heading
   of the project template.
10. Orchestrator source still imports the plugin's library and contracts,
    and their tests pass.
11. No script or build step reads plugin text to write an orchestrator
    source.
12. Under owner choice (c) the plugin holds no `orchestrate` skill and no
    plugin document offers it, and the runner's structural check and the
    setup check accept the plugin without it.

## Lifecycle Links

None. On acceptance this ADR would amend ADR-0042, ADR-0036 and ADR-0044 as
stated above and, under owner choice (c), ADR-0018, ADR-0020 and ADR-0069,
with reciprocal lifecycle notes.
