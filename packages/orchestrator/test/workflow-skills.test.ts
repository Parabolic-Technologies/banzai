import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  decodeAgentControlAnswer,
  decodeAgentControlRecovery,
  decodeAgentControlRequest
} from "../src/agent-control.js";

const REPOSITORY_ROOT = path.resolve(process.cwd(), "../..");

async function productSource(relativePath: string): Promise<string> {
  return await readFile(path.join(REPOSITORY_ROOT, relativePath), "utf8");
}

const ENGINEERING_QUALITY_SKILLS = [
  "plugins/banzai/skills/project-manifest/SKILL.md",
  "plugins/banzai/skills/feature-description/SKILL.md",
  "plugins/banzai/skills/architecture-decision/SKILL.md",
  "plugins/banzai/skills/development-plan/SKILL.md",
  "plugins/banzai/skills/code-writing/SKILL.md",
  "plugins/banzai/skills/feature/SKILL.md",
  "plugins/banzai/skills/quick-fix/SKILL.md",
  "plugins/banzai/skills/feature-review/SKILL.md"
] as const;

test("Engineering Quality has one canonical policy and short phase projections", async () => {
  const [workflow, processRules, testWriting, ...skills] = await Promise.all([
    productSource("plugins/banzai/policies/engineering-quality.md"),
    productSource("plugins/banzai/AGENTS.md"),
    productSource("plugins/banzai/skills/test-writing/SKILL.md"),
    ...ENGINEERING_QUALITY_SKILLS.map(productSource)
  ]);
  const headings = [...workflow.matchAll(/^### (EQ-\d{2}) — /gm)].map(
    (match) => match[1]
  );

  assert.equal(
    workflow.split("\n").filter((line) => line === "## Engineering Quality")
      .length,
    1
  );
  assert.deepEqual(
    headings,
    Array.from(
      { length: 10 },
      (_, index) => `EQ-${String(index + 1).padStart(2, "0")}`
    )
  );
  assert.match(workflow, /policy is vendor-neutral/i);
  assert.match(workflow, /only its current storage and\s+delivery surface/i);
  assert.match(processRules, /legacy test does not automatically override/i);
  assert.match(
    workflow,
    /Any later blocker-eligibility proposal must require high confidence/i
  );
  assert.match(
    workflow,
    /Meeting this\s+threshold does not\s+authorize hard enforcement/i
  );
  for (const source of skills) {
    assert.match(
      source,
      /canonical Engineering Quality policy in the installed\s+`policies\/engineering-quality\.md`/i
    );
    assert.ok(new Set(source.match(/\bEQ-\d{2}\b/g) ?? []).size < 10);
  }
  assert.doesNotMatch(testWriting, /canonical Engineering Quality policy/i);
});

test("Engineering Quality discovery stays repository-specific and review shadow stays isolated", async () => {
  const [manifest, discovery, planning, review, quickFix] = await Promise.all([
    productSource("plugins/banzai/PROJECT_MANIFEST.md"),
    productSource("plugins/banzai/skills/project-manifest/SKILL.md"),
    productSource("plugins/banzai/skills/development-plan/SKILL.md"),
    productSource("plugins/banzai/skills/feature-review/SKILL.md"),
    productSource("plugins/banzai/skills/quick-fix/SKILL.md")
  ]);

  assert.doesNotMatch(manifest, /Always apply these cross-project rules/);
  assert.doesNotMatch(manifest, /Keep functions\/modules small/);
  assert.match(discovery, /only load-bearing facts relevant/i);
  assert.match(discovery, /Do not infer a domain-centric\s+architecture/i);
  assert.match(planning, /material claim.*evidence owner/is);
  assert.match(planning, /do\s+not\s+add a ten-row checklist/i);
  assert.match(
    review,
    /Freeze the\s+ordinary findings, severities, and verdict/i
  );
  assert.match(
    review,
    /only as one `EQ-SHADOW:`\s+string.*`deferredCoverage`/is
  );
  assert.match(
    review,
    /cannot affect ordinary findings,\s+severity, verdict, mandatory human triage, accepted scope, fixing,\s+completion, or a gate/i
  );
  assert.match(review, /closure-oriented, not discovery-oriented/i);
  assert.match(review, /Do not reopen rejected or deferred concerns/i);
  assert.match(review, /No EQ-specific field is mandatory/i);
  assert.match(
    review,
    /Preserve every `EQ-SHADOW:` entry as\s+opaque deferred content/is
  );
  assert.match(quickFix, /`EQ-SHADOW:`.*never enter fixer scope/is);
});

test("Engineering Quality shadow evaluation preserves the approved cohort and metric denominators", async () => {
  const evaluation = await productSource(
    "documentation/evaluation/engineering-quality-shadow.md"
  );

  assert.match(
    evaluation,
    /completed strict runs whose first independent review used the\s+shadow policy/i
  );
  assert.match(
    evaluation,
    /more than one repository or materially different stack/i
  );
  assert.match(evaluation, /more than one change type/i);
  assert.match(
    evaluation,
    /reviews with an available applied canonical artifact and completed worksheet \/ sampled reviewed runs/i
  );
  assert.match(
    evaluation,
    /unique shadow candidate identities and runs containing at least one unique candidate \/ sampled reviewed runs/i
  );
  assert.match(
    evaluation,
    /records containing every semantic field \/ all mapped ordinary findings and shadow candidates/i
  );
  assert.match(evaluation, /`triage_deferred`/);
});

test("plan policy delivers the approved convention and preserves the completion section", async () => {
  const policy = await productSource(
    "plugins/banzai/policies/plan-task-completion.md"
  );
  const fixture = await readFile(
    path.join(process.cwd(), "test/fixtures/plan-authority/opted-in-plan.md"),
    "utf8"
  );
  const convention = policy.slice(
    policy.indexOf("## Plan Authority\n"),
    policy.indexOf("### Applying the convention")
  );
  assert.equal(
    fixture.slice(
      fixture.indexOf("## Plan Authority\n"),
      fixture.indexOf("## Implementation Tasks")
    ),
    convention
  );
  const completion = policy.slice(
    policy.indexOf("## Plan Task Completion Evidence\n")
  );
  // ADR-0038 adds authority interpretation; it does not amend completion prose.
  assert.equal(
    createHash("sha256").update(completion).digest("hex"),
    "5b0e9ef93c9a5a0f6d45e32528d32069d6b0bbe618d51039e14fa9cfe8abc87e"
  );
});

test("shipped strict workflow keeps approved tasks immutable and uses one structured ledger", async () => {
  const [workflow, planning, writing, testing] = await Promise.all([
    productSource("plugins/banzai/policies/plan-task-completion.md"),
    productSource("plugins/banzai/skills/development-plan/SKILL.md"),
    productSource("plugins/banzai/skills/code-writing/SKILL.md"),
    productSource("plugins/banzai/skills/test-writing/SKILL.md")
  ]);

  for (const source of [workflow, planning, writing]) {
    assert.match(source, /immutable/i);
  }
  assert.match(workflow, /implementation report/i);
  assert.match(writing, /implementation report/i);
  assert.match(planning, /structured completion ledger/i);
  assert.match(workflow, /unchecked plan boxes define the approved work set/i);
  assert.match(workflow, /sole source of truth/i);
  assert.match(workflow, /PLAN_TASK_COMPLETION_INVALID/);
  assert.match(planning, /- \[ \] \*\*T001 - Title\*\*/);
  assert.match(writing, /canonical evidence/i);
  assert.match(writing, /exactly one row per approved\s+`TNNN` task/i);
  assert.match(writing, /completed`, `incomplete`,\s+or `blocked`/i);
  assert.match(writing, /never update approved plan checkboxes/i);
  assert.match(writing, /created or modified relative to\s+the run baseline/i);
  assert.match(writing, /carried-in\s+unchanged source and test files/i);
  assert.match(writing, /cite the report instead/i);
  assert.match(testing, /not implementation-task\s+completion/i);
  assert.match(testing, /do not promote an incomplete or blocked/i);
});

test("feature status keeps orchestrator lifecycle authoritative and exposes completion provenance", async () => {
  const status = await productSource(
    "plugins/banzai/skills/feature-status/SKILL.md"
  );

  assert.match(status, /persisted state owns the next action/i);
  assert.match(status, /never replace persisted `nextAction: null`/i);
  assert.match(status, /N\/N externally completed/i);
  assert.match(status, /active.*remains active/is);
  assert.match(status, /plan checkbox.*standalone/is);
  assert.match(status, /legacy` or `unknown`/i);
  assert.match(status, /artifact\/evidence audit/i);
  for (const provenance of [
    "plan checkbox",
    "structured completion evidence",
    "legacy"
  ]) {
    assert.match(status, new RegExp(provenance.replace("+", "\\+"), "i"));
  }
});

test("feature review ignores immutable unchecked syntax alone but retains real inconsistency findings", async () => {
  const review = await productSource(
    "plugins/banzai/skills/feature-review/SKILL.md"
  );

  assert.match(
    review,
    /unchecked immutable boxes.*not a finding by themselves/is
  );
  assert.match(review, /material contradiction or gap/i);
  assert.match(review, /primary enforcement boundary/i);
  assert.match(review, /must not\s+return `pass`/i);
  assert.match(review, /never merely to\s+request checkbox mutation/i);
  assert.match(review, /approval digest, state, and source/is);
});

test("standalone mutable plans continue to use checkbox completion", async () => {
  const [writing, status] = await Promise.all([
    productSource("plugins/banzai/skills/code-writing/SKILL.md"),
    productSource("plugins/banzai/skills/feature-status/SKILL.md")
  ]);

  assert.match(
    writing,
    /Outside orchestrated mode, mark only completed\s+tasks `\[x\]`/i
  );
  assert.match(
    status,
    /plan checkbox` for standalone or non-approved mutable work/i
  );
  assert.match(
    status,
    /unchecked tasks and no external evidence remains\s+in `code-writing`/i
  );
});

test("quick fix reconciles verification claims after changing tests", async () => {
  const quickFix = await productSource(
    "plugins/banzai/skills/quick-fix/SKILL.md"
  );

  assert.match(quickFix, /after changing tests or verification commands/i);
  assert.match(quickFix, /complete current `test-report\.md`/i);
  assert.match(quickFix, /`implementation-report\.md`/i);
  assert.match(quickFix, /fix's change report/i);
  assert.match(quickFix, /every test-count and\s+command-result claim/i);
  assert.match(quickFix, /explicitly `historical\/pre-fix`/i);
  assert.match(
    quickFix,
    /pending at fix handoff;\s+durable runner evidence owns the eventual result/i
  );
});

test("shipped workflow and supervisor preserve the five-gate consultation contract", async () => {
  const [
    workflow,
    consultation,
    description,
    architecture,
    planning,
    codeWriting,
    testWriting,
    feature,
    quickFix,
    supervisor,
    protocol
  ] = await Promise.all([
    productSource("plugins/banzai/AGENTS.md"),
    productSource("plugins/banzai/policies/decision-consultation.md"),
    productSource("plugins/banzai/skills/feature-description/SKILL.md"),
    productSource("plugins/banzai/skills/architecture-decision/SKILL.md"),
    productSource("plugins/banzai/skills/development-plan/SKILL.md"),
    productSource("plugins/banzai/skills/code-writing/SKILL.md"),
    productSource("plugins/banzai/skills/test-writing/SKILL.md"),
    productSource("plugins/banzai/skills/feature/SKILL.md"),
    productSource("plugins/banzai/skills/quick-fix/SKILL.md"),
    productSource("plugins/banzai/skills/orchestrate/SKILL.md"),
    productSource(
      "plugins/banzai/skills/orchestrate/references/control-protocol.md"
    )
  ]);

  assert.match(workflow, /There are exactly five/);
  assert.match(workflow, /decision_consultation/);
  assert.match(workflow, /conditional gate, not a\s+route or mandatory phase/i);
  assert.match(workflow, /first analyzes.*repository evidence/is);
  assert.match(consultation, /Consultation is not approval or permission/i);
  for (const source of [description, architecture, planning]) {
    assert.match(source, /repository(?:-relative)? evidence/i);
    assert.match(
      source,
      /material\s+human-owned|human-owned product or architecture/i
    );
    assert.match(source, /decision_consultation/);
    assert.match(source, /Do not.*Proposed ADR|Do not create a Proposed ADR/is);
    assert.match(source, /Never select|Do not infer|Never self-answer/i);
  }
  assert.match(planning, /contracts\/v3\/phase-result\.schema\.json/);
  assert.match(architecture, /separate non-authorizing prerequisite/i);
  for (const source of [codeWriting, testWriting, feature, quickFix]) {
    assert.match(source, /contracts\/v3\/phase-result\.schema\.json/);
    assert.match(source, /decisionConsultation: null/);
  }
  assert.match(feature, /cannot use the planning-only consultation gate/);

  const assertSupervisorSafety = (source: string): void => {
    assert.match(source, /exact supported v3 declaration/i);
    assert.match(source, /answer_consultation/);
    assert.match(
      source,
      /Decision.*Why this matters.*Repository evidence.*Options.*Recommendation/is
    );
    assert.match(source, /Never select, infer, rewrite/is);
    assert.match(source, /never accepts an\s+ADR, approves a plan/is);
  };
  assertSupervisorSafety(supervisor);
  assert.throws(() => {
    assertSupervisorSafety(
      supervisor.replace(
        "Never select, infer, rewrite",
        "May choose and rewrite"
      )
    );
  });

  assert.match(protocol, /banzai-agent-capabilities\/v3/);
  assert.match(protocol, /controlContractVersion: "3\.0\.0"/);
  assert.match(protocol, /banzai-agent-status\/v2/);
  assert.match(protocol, /answer_escalation/);
  assert.match(protocol, /answer_consultation/);
  const documents = [...protocol.matchAll(/```json\n([\s\S]*?)\n```/gu)].map(
    (match) => JSON.parse(match[1] ?? "") as { schema: string }
  );
  assert.equal(documents.length, 4);
  for (const document of documents) {
    const encoded = Buffer.from(JSON.stringify(document));
    if (document.schema === "banzai-agent-request/v1") {
      decodeAgentControlRequest(encoded);
    } else if (
      document.schema === "banzai-agent-answer/v1" ||
      document.schema === "banzai-agent-answer/v2"
    ) {
      decodeAgentControlAnswer(encoded);
    } else if (document.schema === "banzai-agent-recovery/v1") {
      decodeAgentControlRecovery(encoded);
    } else {
      assert.fail(`Unexpected protocol schema ${document.schema}.`);
    }
  }
});

const EXPECTED_POLICY_READS = {
  "feature-description": {
    "decision-consultation": "C",
    "test-assurance": "-",
    "security-assurance": "R",
    "engineering-quality": "R",
    "plan-task-completion": "-"
  },
  "architecture-decision": {
    "decision-consultation": "C",
    "test-assurance": "-",
    "security-assurance": "C",
    "engineering-quality": "R",
    "plan-task-completion": "-"
  },
  "development-plan": {
    "decision-consultation": "C",
    "test-assurance": "R",
    "security-assurance": "R",
    "engineering-quality": "R",
    "plan-task-completion": "R"
  },
  "code-writing": {
    "decision-consultation": "-",
    "test-assurance": "R",
    "security-assurance": "C",
    "engineering-quality": "R",
    "plan-task-completion": "R"
  },
  "test-writing": {
    "decision-consultation": "-",
    "test-assurance": "R",
    "security-assurance": "C",
    "engineering-quality": "-",
    "plan-task-completion": "C"
  },
  "feature-review": {
    "decision-consultation": "-",
    "test-assurance": "R",
    "security-assurance": "R",
    "engineering-quality": "R",
    "plan-task-completion": "C"
  },
  "feature-status": {
    "decision-consultation": "-",
    "test-assurance": "-",
    "security-assurance": "-",
    "engineering-quality": "-",
    "plan-task-completion": "C"
  },
  feature: {
    "decision-consultation": "-",
    "test-assurance": "R",
    "security-assurance": "R",
    "engineering-quality": "R",
    "plan-task-completion": "-"
  },
  "quick-fix": {
    "decision-consultation": "-",
    "test-assurance": "R",
    "security-assurance": "R",
    "engineering-quality": "R",
    "plan-task-completion": "C"
  },
  "project-manifest": {
    "decision-consultation": "-",
    "test-assurance": "C",
    "security-assurance": "C",
    "engineering-quality": "R",
    "plan-task-completion": "-"
  },
  orchestrate: {
    "decision-consultation": "-",
    "test-assurance": "-",
    "security-assurance": "-",
    "engineering-quality": "-",
    "plan-task-completion": "-"
  }
} as const;

test("skills read the matrix policies and stop on a legacy layout", async () => {
  for (const [skill, legacyRow] of Object.entries(EXPECTED_POLICY_READS)) {
    const row = {
      ...legacyRow,
      "artifact-storage": skill === "orchestrate" ? "-" : "R"
    };
    const source = await productSource(
      `plugins/banzai/skills/${skill}/SKILL.md`
    );
    if (skill === "orchestrate") {
      assert.doesNotMatch(source, /^## Sources$/m);
      assert.match(
        source,
        /Relay a summary beginning with `legacy Banzai layout:` verbatim/
      );
    } else {
      const sources = /^## Sources\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(
        source
      )?.[1];
      assert.ok(sources, skill);
      const actual = [
        ...sources.matchAll(/^\s+- `([a-z-]+)\.md` (before|when) /gm)
      ].map((match) => [match[1], match[2]]);
      const expected = Object.entries(row).flatMap(([name, mode]) =>
        mode === "-" ? [] : [[name, mode === "R" ? "before" : "when"]]
      );
      assert.deepEqual(actual, expected, skill);
      assert.ok(
        source
          .replace(/\s+/g, " ")
          .includes("legacy Banzai layout: run `project-manifest` to migrate"),
        skill
      );
      assert.match(sources, /the project root `AGENTS.md`/);
      assert.match(sources, /unreadable/);
      const bootstrap = ["project-manifest", "feature-status"].includes(skill);
      assert.equal(sources.includes("bootstrap source rule"), bootstrap, skill);
      if (skill === "feature-review")
        assert.match(source, /`verdict=blocked`[\s\S]*?no findings/);
      else if (!bootstrap)
        assert.match(
          source,
          /`outcome=needs_human_decision`,\s+`gate=escalation`/
        );
    }
    if (["test-writing", "feature-status", "orchestrate"].includes(skill))
      assert.doesNotMatch(source, /engineering-quality\.md/);
  }
  const protocol = await productSource(
    "plugins/banzai/skills/orchestrate/references/control-protocol.md"
  );
  assert.doesNotMatch(
    protocol,
    /engineering-quality\.md|bootstrap source rule/
  );
});

test("standalone review keeps durable Markdown while orchestration returns only v2", async () => {
  const review = await productSource(
    "plugins/banzai/skills/feature-review/SKILL.md"
  );
  assert.match(review, /Standalone.*Markdown/is);
  assert.match(review, /review-result\/v2/);
  assert.match(review, /reviewNotes/);
  assert.match(review, /not independent proof/);
});
