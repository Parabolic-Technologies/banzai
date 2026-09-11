import assert from "node:assert/strict";
import { mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { digestArtifactBundle } from "../src/git.js";
import {
  parseApprovedPlanTaskIds,
  parsePlanTaskCompletionProjection,
  PlanTaskCompletionError,
  renderPlanTaskCompletionProjection,
  validatePlanTaskCompletionLedgerShape,
  validatePlanTaskCompletion
} from "../src/plan-task-completion.js";
import {
  CONTRACT_VERSION,
  PHASE_RESULT_SCHEMA_VERSION,
  PLAN_TASK_COMPLETION_SCHEMA_VERSION,
  type PhaseResult,
  type PlanTaskCompletionLedger,
  type PlanTaskCompletionRecord
} from "../src/types.js";
import { commitAll, createTestRepository } from "./helpers.js";

const descriptionPath = "documentation/features/completion/description.md";
const planPath = "documentation/development-plans/completion/plan.md";
const implementationReport =
  "documentation/features/completion/implementation-report.md";
const testReport = "documentation/features/completion/test-report.md";
const taskIds = ["T001", "T002", "T003", "T004", "T005", "T006"];

function ledger(): PlanTaskCompletionLedger {
  return {
    schemaVersion: PLAN_TASK_COMPLETION_SCHEMA_VERSION,
    tasks: taskIds.map((taskId) => ({
      taskId,
      status: "completed",
      evidence: [
        {
          path: `src/${taskId.toLowerCase()}.txt`,
          detail: `Observable implementation for ${taskId}.`
        }
      ],
      gap: null
    }))
  };
}

function rawProjection(candidate: PlanTaskCompletionLedger): string {
  const rows = candidate.tasks.map(
    (record) =>
      `| ${record.taskId} | ${record.status} | ${JSON.stringify(record.evidence)} | ${JSON.stringify(record.gap)} |`
  );
  return `## Plan Task Completion\n\nFormat: \`banzai-plan-task-completion/v1\`\n\n| Task | Status | Evidence | Gap or deviation |\n| --- | --- | --- | --- |\n${rows.join("\n")}`;
}

function codeSpanProjection(candidate: PlanTaskCompletionLedger): string {
  const rows = candidate.tasks.map(
    (record) =>
      `| ${record.taskId} | ${record.status} | \`${JSON.stringify(record.evidence)}\` | \`${JSON.stringify(record.gap)}\` |`
  );
  return `## Plan Task Completion\n\nFormat: \`banzai-plan-task-completion/v1\`\n\n| Task | Status | Evidence | Gap or deviation |\n| --- | --- | --- | --- |\n${rows.join("\n")}`;
}

function task(
  candidate: PlanTaskCompletionLedger,
  index: number
): PlanTaskCompletionRecord {
  const record = candidate.tasks[index];
  assert.ok(record);
  return record;
}

function firstEvidence(record: PlanTaskCompletionRecord) {
  const evidence = record.evidence[0];
  assert.ok(evidence);
  return evidence;
}

function result(taskCompletion: PlanTaskCompletionLedger | null): PhaseResult {
  return {
    schemaVersion: PHASE_RESULT_SCHEMA_VERSION,
    contractVersion: CONTRACT_VERSION,
    phase: "implementation",
    outcome: "completed",
    gate: null,
    summary: "Implementation complete.",
    artifacts: {
      description: descriptionPath,
      plan: planPath,
      adrs: [],
      implementationReport,
      testReport
    },
    taskCompletion,
    touchedPaths: [],
    questions: [],
    decisionConsultation: null,
    resolvedFindingIds: [],
    requestedVerification: []
  };
}

async function fixture() {
  const repository = await createTestRepository();
  await mkdir(path.join(repository.root, path.dirname(descriptionPath)), {
    recursive: true
  });
  await mkdir(path.join(repository.root, path.dirname(planPath)), {
    recursive: true
  });
  await writeFile(
    path.join(repository.root, descriptionPath),
    "# Description\n\nFR1. Completion is deterministic.\n",
    "utf8"
  );
  await writeFile(
    path.join(repository.root, planPath),
    `# Plan\n\n## Implementation Tasks\n\n${taskIds
      .map((taskId) => `- [ ] **${taskId} - Implement ${taskId}**`)
      .join("\n")}\n\n## Consistency Check\n\nComplete.\n`,
    "utf8"
  );
  await commitAll(repository.root, "approve plan fixture");
  const approval = await digestArtifactBundle(repository.root, [
    descriptionPath,
    planPath
  ]);
  await mkdir(path.join(repository.root, "src"), { recursive: true });
  for (const taskId of taskIds) {
    await writeFile(
      path.join(repository.root, `src/${taskId.toLowerCase()}.txt`),
      `${taskId}\n`,
      "utf8"
    );
  }
  const canonical = ledger();
  await writeFile(
    path.join(repository.root, implementationReport),
    `# Implementation Report\n\n${renderPlanTaskCompletionProjection(canonical)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(repository.root, testReport),
    "# Test Report\n\nAll material checks passed.\n",
    "utf8"
  );
  return { ...repository, approval, canonical };
}

async function expectViolation(
  promise: Promise<unknown>,
  violation: PlanTaskCompletionError["violation"]
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PlanTaskCompletionError);
    assert.equal(error.code, "PLAN_TASK_COMPLETION_INVALID");
    assert.equal(error.violation, violation);
    return true;
  });
}

test("valid six-task completion validates one canonical ledger and projection", async () => {
  const current = await fixture();
  try {
    const validated = await validatePlanTaskCompletion({
      repoRoot: current.root,
      sourceAttemptId: "implementation-1",
      result: result(current.canonical),
      planPath,
      approval: {
        kind: "plan",
        digest: current.approval.digest,
        approvedAt: "2026-08-14T00:00:00.000Z",
        approvedBy: "test",
        paths: current.approval.paths
      },
      validatedAt: "2026-08-14T00:00:00.000Z"
    });
    assert.deepEqual(
      parseApprovedPlanTaskIds(
        await readFile(path.join(current.root, planPath), "utf8")
      ),
      taskIds
    );
    assert.equal(validated.summary.counts.completed, 6);
    assert.equal(validated.summary.counts.total, 6);
    assert.deepEqual(validated.tasks, current.canonical.tasks);
    assert.deepEqual(
      parsePlanTaskCompletionProjection(
        `# Report\n\n${renderPlanTaskCompletionProjection(current.canonical)}\n`
      ),
      current.canonical
    );
    assert.equal(
      (await digestArtifactBundle(current.root, [descriptionPath, planPath]))
        .digest,
      current.approval.digest
    );
  } finally {
    await current.dispose();
  }
});

test("approved-plan and report grammars reject ambiguous declarations", () => {
  assert.throws(
    () =>
      parseApprovedPlanTaskIds(
        "## Implementation Tasks\n\n- [ ] **T001 - Valid**\n  - [ ] **T002 - Nested**\n"
      ),
    /checked or malformed task heading/
  );

  const rendered = renderPlanTaskCompletionProjection(ledger());
  assert.throws(
    () =>
      parsePlanTaskCompletionProjection(
        rendered.replace(
          "Format: `banzai-plan-task-completion/v1`",
          "Format: `banzai-plan-task-completion/v1`\nFormat: `banzai-plan-task-completion/v1`"
        )
      ),
    /must declare banzai-plan-task-completion\/v1/
  );
});

test("plan authority prose preserves task extraction and does not relax task grammar", async () => {
  const optedIn = await readFile(
    path.join(process.cwd(), "test/fixtures/plan-authority/opted-in-plan.md"),
    "utf8"
  );
  const legacy = optedIn.replace(
    /## Plan Authority\n[\s\S]*?(?=## Implementation Tasks)/u,
    ""
  );
  assert.deepEqual(parseApprovedPlanTaskIds(optedIn), ["T001"]);
  assert.deepEqual(parseApprovedPlanTaskIds(legacy), ["T001"]);
  const heading = "- [ ] **T001 - Implement the fixture**";
  const ordered = optedIn.replace(
    heading,
    `${heading}\n\n- [ ] **T002 - Verify the fixture**`
  );
  assert.deepEqual(parseApprovedPlanTaskIds(ordered), ["T001", "T002"]);
  for (const invalid of [
    optedIn.replace(heading, heading.replace("[ ]", "[x]")),
    optedIn.replace(heading, `${heading} (annotation)`),
    optedIn.replace(heading, `${heading}\n  - [ ] **T002 - Nested task**`),
    optedIn.replace(heading, `${heading}\n\n${heading}`)
  ]) {
    assert.throws(
      () => parseApprovedPlanTaskIds(invalid),
      PlanTaskCompletionError
    );
  }
});

test("raw unescaped pipes inside projection JSON cells decode to canonical records", () => {
  const piped = ledger();
  firstEvidence(task(piped, 0)).detail =
    "Widened the route pattern to {[1-9][0-9]*-[a-f0-9]{32}|[a-zA-Z0-9]{32}} so legacy > 32-char values & bare links still resolve.";
  const gapTask = task(piped, 1);
  gapTask.status = "incomplete";
  gapTask.gap = {
    reportPath: testReport,
    section: "Gap | Remaining",
    detail: "Remaining work."
  };
  const bothTask = task(piped, 2);
  firstEvidence(bothTask).detail = "Pattern a|b verified.";
  bothTask.status = "blocked";
  bothTask.gap = {
    reportPath: testReport,
    section: "Blocked | Detail",
    detail: "Blocked work."
  };

  const parsedRaw = parsePlanTaskCompletionProjection(
    `# Report\n\n${rawProjection(piped)}\n`
  );
  assert.deepEqual(parsedRaw, piped);

  const parsedCanonical = parsePlanTaskCompletionProjection(
    `# Report\n\n${renderPlanTaskCompletionProjection(piped)}\n`
  );
  assert.deepEqual(parsedCanonical, piped);

  const parsedCodeSpannedRaw = parsePlanTaskCompletionProjection(
    `# Report\n\n${codeSpanProjection(piped)}\n`
  );
  assert.deepEqual(parsedCodeSpannedRaw, piped);
});

test("one outer Markdown code span around projection JSON decodes to canonical records", () => {
  const candidate = ledger();
  const rendered = renderPlanTaskCompletionProjection(candidate);
  assert.doesNotMatch(
    rendered,
    /^\| T001 \| completed \| `\[/mu,
    "the canonical renderer must keep emitting raw escaped JSON cells"
  );

  assert.deepEqual(
    parsePlanTaskCompletionProjection(
      `# Report\n\n${codeSpanProjection(candidate)}\n`
    ),
    candidate
  );
});

test("partial or repeated projection JSON code spans still fail closed naming the task", () => {
  const projected = codeSpanProjection(ledger());
  for (const malformed of [
    projected.replace("| `[{", "| [{"),
    projected.replace("| `[{", "| ``[{").replace("}]` |", "}]`` |")
  ]) {
    assert.throws(
      () => parsePlanTaskCompletionProjection(`# Report\n\n${malformed}\n`),
      (error: unknown) => {
        assert.ok(error instanceof PlanTaskCompletionError);
        assert.equal(error.violation, "report_projection_invalid");
        assert.equal(error.taskId, "T001");
        return true;
      }
    );
  }
});

test("unrecoverable projection rows still fail closed naming the task", () => {
  const header =
    "## Plan Task Completion\n\nFormat: `banzai-plan-task-completion/v1`\n\n| Task | Status | Evidence | Gap or deviation |\n| --- | --- | --- | --- |\n";
  assert.throws(
    () =>
      parsePlanTaskCompletionProjection(
        `${header}| T001 | completed | not-json | broken | null |\n`
      ),
    (error: unknown) => {
      assert.ok(error instanceof PlanTaskCompletionError);
      assert.equal(error.violation, "report_projection_invalid");
      assert.equal(error.taskId, "T001");
      assert.match(error.message, /exactly four cells/);
      assert.match(error.message, /&#124;/);
      return true;
    }
  );
  assert.throws(
    () =>
      parsePlanTaskCompletionProjection(`${header}| T001 | completed | [] |\n`),
    /exactly four cells/
  );
});

test("a hand-authored report with a raw pipe in evidence detail validates end to end", async () => {
  const current = await fixture();
  try {
    const piped = ledger();
    firstEvidence(task(piped, 4)).detail =
      "Widened the route pattern to {[1-9][0-9]*-[a-f0-9]{32}|[a-zA-Z0-9]{32}} so legacy bare links still resolve.";
    await writeFile(
      path.join(current.root, implementationReport),
      `# Implementation Report\n\n${rawProjection(piped)}\n`,
      "utf8"
    );
    const validated = await validatePlanTaskCompletion({
      repoRoot: current.root,
      sourceAttemptId: "implementation-pipe",
      result: result(piped),
      planPath,
      approval: {
        kind: "plan",
        digest: current.approval.digest,
        approvedAt: "2026-08-20T00:00:00.000Z",
        approvedBy: "test",
        paths: current.approval.paths
      },
      validatedAt: "2026-08-20T00:00:00.000Z"
    });
    assert.equal(validated.summary.counts.completed, 6);
    assert.equal(validated.summary.counts.total, 6);
  } finally {
    await current.dispose();
  }
});

test("a hand-authored report with code-spanned JSON cells validates end to end", async () => {
  const current = await fixture();
  try {
    await writeFile(
      path.join(current.root, implementationReport),
      `# Implementation Report\n\n${codeSpanProjection(current.canonical)}\n`,
      "utf8"
    );
    const validated = await validatePlanTaskCompletion({
      repoRoot: current.root,
      sourceAttemptId: "implementation-code-span",
      result: result(current.canonical),
      planPath,
      approval: {
        kind: "plan",
        digest: current.approval.digest,
        approvedAt: "2026-08-23T00:00:00.000Z",
        approvedBy: "test",
        paths: current.approval.paths
      },
      validatedAt: "2026-08-23T00:00:00.000Z"
    });
    assert.deepEqual(validated.tasks, current.canonical.tasks);
  } finally {
    await current.dispose();
  }
});

test("non-terminal strict results still require exact structural coverage", () => {
  const missing = ledger();
  missing.tasks.pop();
  assert.throws(() => {
    validatePlanTaskCompletionLedgerShape(
      taskIds,
      missing,
      "needs_human_decision"
    );
  }, /missing T006/);
});

test("coverage, order, status, and completed-outcome contradictions fail closed", async () => {
  const current = await fixture();
  const approval = {
    kind: "plan" as const,
    digest: current.approval.digest,
    approvedAt: "2026-08-14T00:00:00.000Z",
    approvedBy: "test",
    paths: current.approval.paths
  };
  const validate = async (candidate: PlanTaskCompletionLedger | null) => {
    if (candidate !== null) {
      await writeFile(
        path.join(current.root, implementationReport),
        `# Report\n\n${renderPlanTaskCompletionProjection(candidate)}\n`,
        "utf8"
      );
    }
    return await validatePlanTaskCompletion({
      repoRoot: current.root,
      sourceAttemptId: "implementation-invalid",
      result: result(candidate),
      planPath,
      approval
    });
  };
  try {
    await expectViolation(validate(null), "missing_ledger");

    const missing = ledger();
    missing.tasks.pop();
    await expectViolation(validate(missing), "missing_task");

    const duplicate = ledger();
    duplicate.tasks[1] = structuredClone(task(duplicate, 0));
    await expectViolation(validate(duplicate), "duplicate_task");

    const unknown = ledger();
    task(unknown, 5).taskId = "T999";
    await expectViolation(validate(unknown), "unknown_task");

    const unordered = ledger();
    const first = task(unordered, 0);
    const second = task(unordered, 1);
    [unordered.tasks[0], unordered.tasks[1]] = [second, first];
    await expectViolation(validate(unordered), "task_order_mismatch");

    const invalid = ledger() as unknown as {
      schemaVersion: 1;
      tasks: Record<string, unknown>[];
    };
    const invalidTask = invalid.tasks[0];
    assert.ok(invalidTask);
    invalidTask.status = "done";
    await expectViolation(
      validate(invalid as unknown as PlanTaskCompletionLedger),
      "invalid_task_status"
    );

    for (const status of ["incomplete", "blocked"] as const) {
      const contradictory = ledger();
      const firstTask = task(contradictory, 0);
      firstTask.status = status;
      firstTask.gap = {
        reportPath: testReport,
        section: "Assurance Gap",
        detail: "Required work remains."
      };
      await writeFile(
        path.join(current.root, testReport),
        "# Test Report\n\n## Assurance Gap\n\nRequired work remains.\n",
        "utf8"
      );
      await expectViolation(validate(contradictory), "task_status_conflict");
    }
  } finally {
    await current.dispose();
  }
});

test("unsafe evidence paths and report contradictions fail closed", async () => {
  const current = await fixture();
  const approval = {
    kind: "plan" as const,
    digest: current.approval.digest,
    approvedAt: "2026-08-14T00:00:00.000Z",
    approvedBy: "test",
    paths: current.approval.paths
  };
  const validate = (candidate: PlanTaskCompletionLedger) =>
    validatePlanTaskCompletion({
      repoRoot: current.root,
      sourceAttemptId: "implementation-path",
      result: result(candidate),
      planPath,
      approval
    });
  try {
    for (const unsafe of [
      "/tmp/absolute.txt",
      "../outside.txt",
      "src/control\ttab.txt",
      ".banzai/state.json",
      "src/missing.txt"
    ]) {
      const candidate = ledger();
      firstEvidence(task(candidate, 0)).path = unsafe;
      await writeFile(
        path.join(current.root, implementationReport),
        `# Report\n\n${renderPlanTaskCompletionProjection(candidate)}\n`,
        "utf8"
      );
      await assert.rejects(validate(candidate), {
        name: "PlanTaskCompletionError"
      });
    }

    const symlinked = ledger();
    await symlink("/etc/hosts", path.join(current.root, "src/symlink.txt"));
    firstEvidence(task(symlinked, 0)).path = "src/symlink.txt";
    await writeFile(
      path.join(current.root, implementationReport),
      `# Report\n\n${renderPlanTaskCompletionProjection(symlinked)}\n`,
      "utf8"
    );
    await expectViolation(validate(symlinked), "invalid_evidence_path");

    await writeFile(
      path.join(current.root, implementationReport),
      `# Report\n\n${renderPlanTaskCompletionProjection(ledger()).replace("T006", "T099")}\n`,
      "utf8"
    );
    await expectViolation(validate(ledger()), "report_projection_mismatch");

    await writeFile(
      path.join(current.root, implementationReport),
      "# Legacy Implementation Report\n\nNo completion table.\n",
      "utf8"
    );
    await expectViolation(validate(ledger()), "report_projection_missing");
  } finally {
    await current.dispose();
  }
});

test("approval and both required reports are part of completion validation", async () => {
  const current = await fixture();
  const approval = {
    kind: "plan" as const,
    digest: current.approval.digest,
    approvedAt: "2026-08-14T00:00:00.000Z",
    approvedBy: "test",
    paths: current.approval.paths
  };
  const validate = () =>
    validatePlanTaskCompletion({
      repoRoot: current.root,
      sourceAttemptId: "implementation-required-artifacts",
      result: result(current.canonical),
      planPath,
      approval
    });
  try {
    await unlink(path.join(current.root, testReport));
    await expectViolation(validate(), "test_report_missing");
    await writeFile(
      path.join(current.root, testReport),
      "# Test Report\n\nAll material checks passed.\n",
      "utf8"
    );

    await unlink(path.join(current.root, implementationReport));
    await expectViolation(validate(), "implementation_report_missing");
    await writeFile(
      path.join(current.root, implementationReport),
      `# Implementation Report\n\n${renderPlanTaskCompletionProjection(current.canonical)}\n`,
      "utf8"
    );

    await writeFile(
      path.join(current.root, descriptionPath),
      "# Description\n\nFR1 was changed after approval.\n",
      "utf8"
    );
    await expectViolation(validate(), "approval_invalid");
  } finally {
    await current.dispose();
  }
});
