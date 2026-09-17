import assert from "node:assert/strict";
import { mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { digestArtifactBundle } from "../src/git.js";
import {
  COMPLETION_REGION_END,
  COMPLETION_REGION_START,
  composeCompletionCandidate,
  decodeCompletionCell,
  parseApprovedPlanTaskIds,
  parseCompletionRegion,
  parsePublishedCompletionRegion,
  validatePlanRunnerControlTasks,
  parsePlanTaskCompletionProjection,
  PlanTaskCompletionError,
  renderCompletionRegion,
  renderPlanTaskCompletionProjection,
  scanCompletionRegion,
  validateCompletionClaims,
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

test("plan control guard normalizes task paths, permits exact report roles and keeps prerequisites explanatory", () => {
  const root = "/project";
  const report =
    ".banzai/work/11111111-1111-4111-8111-111111111111/implementation-report.md";
  const plan = (body: string) =>
    `# Plan\n\n## Human prerequisites\n\nConfigure .banzai/config.json with banzai verify add node.\n\n## Implementation Tasks\n\n- [ ] **T001 - Work**\n\n${body}\n`;
  validatePlanRunnerControlTasks(plan(`Write ${report}.`), root, [report]);
  for (const target of [
    ".banzai/config.json",
    "**.banzai/config.json**",
    "./.banzai/config.json",
    "src/../.banzai/config.json",
    "/project/.banzai/config.json",
    String.raw` .banzai\config.json`,
    ".banzai/work/other/test-report.md",
    ".banzai/runs/current/state.json"
  ])
    assert.throws(
      () => {
        validatePlanRunnerControlTasks(plan(`Update \`${target}\`.`), root, [
          report
        ]);
      },
      {
        code: "PLAN_RUNNER_CONTROL_TASK",
        message: /T001.*runner control path/u
      }
    );
});

test("guided plan guard resolves root aliases and denies ambiguous control-directory case", () => {
  const plan = (target: string) =>
    `## Implementation Tasks\n\n- [ ] **T001 - Change source**\n  Write \`${target}\`.\n`;
  const report = ".banzai/work/work-id/implementation-report.md";
  for (const target of [
    ".banzai/config.json",
    ".Banzai/config.json",
    "../example/.banzai/config.json",
    "/tmp/example/../example/.BANZAI/config.json",
    "..\\example\\.banzai\\config.json",
    ".Banzai/work/work-id/implementation-report.md"
  ])
    assert.throws(
      () => {
        validatePlanRunnerControlTasks(plan(target), "/tmp/example", [report]);
      },
      { code: "PLAN_RUNNER_CONTROL_TASK" }
    );
  for (const target of [report, `../example/${report}`, "src/app.ts"])
    assert.doesNotThrow(() => {
      validatePlanRunnerControlTasks(plan(target), "/tmp/example", [report]);
    });
});

const controlPlan = (body: string) =>
  `## Implementation Tasks\n\n- [ ] **T002 - Synchronize manifest facts**\n\n${body}\n`;

test("plan guard accepts wrapped manifest constraints and read-only fact checking", () => {
  const body = `  - Update the affected current-state and verification facts in
    \`PROJECT_MANIFEST.md\` to describe the generated root manifest.
  - Do not add scripts, dependencies, verification commands, application
    architecture, or any \`.banzai/\` change.
  - Assurance and completion evidence: review the updated statements against
    \`package.json\` and \`.banzai/config.json\`; the runner executes configured
    \`git-diff-check\` as repository hygiene.`;
  assert.doesNotThrow(() => {
    validatePlanRunnerControlTasks(controlPlan(body), "/project", []);
  });
});

test("plan guard distinguishes path roles without interpreting surrounding prose language", () => {
  for (const body of [
    "Read-only references: `.banzai/config.json`",
    "Unchanged paths:\n  - `.banzai/`",
    "Files to change: `PROJECT_MANIFEST.md`\nRead-only references:\n  - `.banzai/config.json`\nNotes: Звірити поточні факти.",
    "**Read-only references:**\n  - [configuration](./.banzai/config.json)"
  ])
    assert.doesNotThrow(() => {
      validatePlanRunnerControlTasks(controlPlan(body), "/project", []);
    }, body);
  for (const body of [
    "Files to change: `.banzai/config.json`\nNotes: Актуалізувати налаштування.",
    "**Affected files:**\n  - `.banzai/config.json`",
    "Files:\n  - `.banzai/runs/current/state.json`"
  ])
    assert.throws(
      () => {
        validatePlanRunnerControlTasks(controlPlan(body), "/project", []);
      },
      { code: "PLAN_RUNNER_CONTROL_TASK", message: /T002.*write target/u },
      body
    );
});

test("plan guard keeps prohibitions and reads local to each instruction", () => {
  for (const body of [
    "Never modify `.banzai/config.json`.",
    "  Do not change `.banzai/`.",
    "Constraints: Do not modify `.banzai/config.json`.",
    "Preserve `.banzai/config.json` unchanged.",
    "Do not change `.banzai/`; update `PROJECT_MANIFEST.md`.",
    "Read `.banzai/config.json` and update `PROJECT_MANIFEST.md`.",
    "Inspect [configuration](.banzai/config.json) to confirm the facts.",
    "`cat .banzai/config.json`",
    "`cat .banzai/config.json > config-snapshot.json`",
    "Compare `PROJECT_MANIFEST.md` with `.banzai/config.json`."
  ])
    assert.doesNotThrow(() => {
      validatePlanRunnerControlTasks(controlPlan(body), "/project", []);
    }, body);
  for (const body of [
    "Do not edit `package.json`; update `.banzai/config.json`.",
    "Do not edit `package.json`;write `.banzai/config.json`.",
    "Do not modify `package.json`, but ensure `.banzai/config.json` is updated.",
    "Do not modify `package.json` && write `.banzai/config.json`.",
    "Read `.banzai/config.json&&rm .banzai/config.json`.",
    "Read `.banzai/config.json` and then update `.banzai/config.json`.",
    "Never modify `.banzai/config.json`, but delete `.banzai/runs/current/state.json`.",
    "Do not edit `.banzai/config.json`.\nWrite `.banzai/config.json`.",
    "Read-only references: `.banzai/config.json`; overwrite `.banzai/config.json`.",
    "Update `.banzai/config.json` and do not edit `package.json`.",
    "Read `.banzai/config.json` and then overwrite it.",
    "Read `.banzai/config.json` and make changes to it.",
    "Read `.banzai/config.json`, which should be modified.",
    "Do not edit `package.json` and make changes to `.banzai/config.json`.",
    "- Read `.banzai/config.json`.\n- Then overwrite it.",
    "**Unchanged paths:** `.banzai/config.json`\n**Files to change:** `.banzai/config.json`",
    "`printf '{}' > .banzai/config.json`",
    "`cp template.json .banzai/config.json`",
    "`rm .banzai/config.json`",
    "`rm .banzai/config.json > output.log`"
  ])
    assert.throws(
      () => {
        validatePlanRunnerControlTasks(controlPlan(body), "/project", []);
      },
      { code: "PLAN_RUNNER_CONTROL_TASK" },
      body
    );
});

test("plan guard does not carry access declarations or implicit targets into another task", () => {
  const prefix = controlPlan(
    "Read-only references:\n  - `.banzai/config.json`"
  );
  assert.throws(
    () => {
      validatePlanRunnerControlTasks(
        `${prefix}\n- [ ] **T003 - Update configuration**\n\nFiles: .banzai/config.json\n`,
        "/project",
        []
      );
    },
    { code: "PLAN_RUNNER_CONTROL_TASK", message: /T003.*write target/u }
  );
  assert.doesNotThrow(() => {
    validatePlanRunnerControlTasks(
      `${prefix}\n- [ ] **T003 - Change the manifest**\n\nInspect PROJECT_MANIFEST.md and then update it.\n`,
      "/project",
      []
    );
  });
});

test("plan guard diagnoses unresolved access without claiming a configuration write", () => {
  assert.throws(
    () => {
      validatePlanRunnerControlTasks(
        controlPlan(
          "Update `.banzai/config.json` and invalidate cached settings."
        ),
        "/project",
        []
      );
    },
    { code: "PLAN_RUNNER_CONTROL_TASK", message: /T002.*write target/u }
  );
  assert.throws(
    () => {
      validatePlanRunnerControlTasks(
        controlPlan("Consider `.banzai/config.json`."),
        "/project",
        []
      );
    },
    {
      code: "PLAN_RUNNER_CONTROL_TASK",
      message: /T002.*ambiguous.*Read-only references/u
    }
  );
});

test("plan guard applies normalized path identity equally to reads, writes and exact reports", () => {
  const report = ".banzai/work/current/test-report.md";
  for (const target of [
    "./.banzai/config.json:12:3",
    "src/../.BANZAI/config.json",
    "/project/./.banzai/config.json",
    String.raw`.banzai\config.json`,
    "../project/.banzai/config.json"
  ]) {
    assert.doesNotThrow(() => {
      validatePlanRunnerControlTasks(
        controlPlan(`Read \`${target}\`.`),
        "/project",
        [report]
      );
    }, target);
    assert.throws(
      () => {
        validatePlanRunnerControlTasks(
          controlPlan(`Write \`${target}\`.`),
          "/project",
          [report]
        );
      },
      { code: "PLAN_RUNNER_CONTROL_TASK" },
      target
    );
  }
  for (const target of [report, `./${report}`, `/project/${report}`])
    assert.doesNotThrow(() => {
      validatePlanRunnerControlTasks(
        controlPlan(`Write \`${target}\`.`),
        "/project",
        [report]
      );
    });
  for (const target of [
    `${report}.bak`,
    `${report}/../state.json`,
    ".banzai/work/other/test-report.md"
  ])
    assert.throws(
      () => {
        validatePlanRunnerControlTasks(
          controlPlan(`Write \`${target}\`.`),
          "/project",
          [report]
        );
      },
      { code: "PLAN_RUNNER_CONTROL_TASK" }
    );
});

// ---------------------------------------------------------------------------
// Runner-owned completion region v2 (ADR-0047 / ADR-0048)
// ---------------------------------------------------------------------------

const ASCII_PUNCTUATION = [
  ...Array.from({ length: 0x7f - 0x21 }, (_, index) =>
    String.fromCodePoint(0x21 + index)
  )
]
  .filter((character) => !/[0-9A-Za-z]/u.test(character))
  .join("");

function specialLedger(): PlanTaskCompletionLedger {
  const base = ledger();
  firstEvidence(task(base, 0)).detail =
    `All punctuation ${ASCII_PUNCTUATION} end`;
  firstEvidence(task(base, 1)).detail =
    "Unicode Кирилиця 日本語 ✓ 🚀 and a literal entity &#38; &amp; &#124; stays literal";
  firstEvidence(task(base, 2)).detail =
    "[link](https://example.com/target) *emphasis* _under_ `code` <b>html</b> ![image](https://example.com/i.png)";
  firstEvidence(task(base, 3)).detail =
    "Plain https://example.com/x then www.example.com then user@example.com";
  firstEvidence(task(base, 4)).path = "src/t005 (copy).txt";
  const blocked = task(base, 5);
  blocked.status = "blocked";
  blocked.gap = {
    reportPath: testReport,
    section: "Remaining | pipes & <angles>",
    detail: "Table breakout attempt | --- | still inert \\ backslash"
  };
  return base;
}

function rawPayloadCells(region: string): string[][] {
  return region
    .split("\n")
    .slice(5, -1)
    .map((row) => row.slice(2, -2).split(" | "));
}

test("v2 region encoding is deterministic, decodes once and leaves no raw model punctuation", () => {
  const candidate = specialLedger();
  const first = renderCompletionRegion(candidate);
  const second = renderCompletionRegion(structuredClone(candidate));
  assert.equal(first, second, "equal ledgers must render identical bytes");
  assert.deepEqual(parseCompletionRegion(first), candidate);
  const rows = rawPayloadCells(first);
  assert.equal(rows.length, candidate.tasks.length);
  for (const [index, cells] of rows.entries()) {
    const record = task(candidate, index);
    assert.equal(cells.length, 4);
    const expected = [
      record.taskId,
      record.status,
      record.evidence,
      record.gap
    ];
    for (const [cellIndex, cell] of cells.entries()) {
      // Byte-level property (ADR-0048 section 3.1): every serialized ASCII
      // punctuation code point is exactly one generated decimal reference.
      const residual = cell.replaceAll(/&#[0-9]{2,3};/gu, "");
      assert.doesNotMatch(
        residual,
        /[!-/:-@[-`{-~]/u,
        `row ${index} cell ${cellIndex} leaks raw punctuation`
      );
      for (const reference of cell.matchAll(/&#([0-9]+);/gu)) {
        const code = Number(reference[1]);
        assert.ok(
          (code >= 0x21 && code <= 0x2f) ||
            (code >= 0x3a && code <= 0x40) ||
            (code >= 0x5b && code <= 0x60) ||
            (code >= 0x7b && code <= 0x7e),
          `unexpected reference ${reference[0]}`
        );
        assert.equal(reference[0], `&#${code};`, "no leading zeroes");
      }
      const decoded = decodeCompletionCell(cell);
      assert.equal(decoded, JSON.stringify(expected[cellIndex]));
      // A single decode returns the admitted value; a literal entity string
      // supplied by the model survives as itself instead of being expanded.
      assert.deepEqual(JSON.parse(decoded), expected[cellIndex]);
    }
  }
  // Negative control in the exact generated cell and row context: an unsafe
  // encoder that leaves markup delimiters raw is detected by the property.
  const unsafeEncoder = (value: unknown) =>
    JSON.stringify(value).replaceAll(/[!-/:-@[-`{-~]/gu, (character) =>
      "|*[]()<>`_!".includes(character)
        ? character
        : `&#${character.codePointAt(0)};`
    );
  const unsafeRecord = task(candidate, 2);
  const unsafeRow = `| ${unsafeEncoder(unsafeRecord.taskId)} | ${unsafeEncoder(unsafeRecord.status)} | ${unsafeEncoder(unsafeRecord.evidence)} | ${unsafeEncoder(unsafeRecord.gap)} |`;
  const unsafeRegion = first.replace(first.split("\n")[5 + 2] ?? "", unsafeRow);
  const leaking = rawPayloadCells(unsafeRegion)[2] ?? [];
  assert.ok(
    leaking.some((cell) =>
      /[!-/:-@[-`{-~]/u.test(cell.replaceAll(/&#[0-9]{2,3};/gu, ""))
    ),
    "the property must detect an unsafe encoder"
  );
  assert.throws(
    () => parseCompletionRegion(unsafeRegion),
    (error: unknown) =>
      error instanceof PlanTaskCompletionError &&
      error.violation === "report_projection_invalid"
  );
});

test("candidate composition appends, replaces legacy or v2 regions and preserves every other byte", () => {
  const candidate = ledger();
  const region = renderCompletionRegion(candidate);
  for (const [input, expected] of [
    ["", `${region}\n`],
    ["# Report", `# Report\n\n${region}\n`],
    ["# Report\n", `# Report\n\n${region}\n`],
    ["# Report\n\n", `# Report\n\n${region}\n`],
    ["# Report\r\nIntro\r\n", `# Report\r\nIntro\r\n\n${region}\n`]
  ] as const) {
    const composed = composeCompletionCandidate(Buffer.from(input), candidate);
    assert.equal(
      composed.bytes.toString("utf8"),
      expected,
      JSON.stringify(input)
    );
    assert.equal(composed.region.action, "appended");
    assert.equal(composed.region.start, Buffer.byteLength(input));
  }
  const legacy = `# Report\r\n\r\nNarrative stays.\r\n\r\n${renderPlanTaskCompletionProjection(candidate)}\n\nTrailing legacy prose.\n\n## Assurance Gap\n\nKept.\n`;
  const replacedLegacy = composeCompletionCandidate(
    Buffer.from(legacy),
    candidate
  );
  assert.equal(
    replacedLegacy.bytes.toString("utf8"),
    `# Report\r\n\r\nNarrative stays.\r\n\r\n${region}\n\n## Assurance Gap\n\nKept.\n`
  );
  assert.equal(replacedLegacy.region.action, "replaced");
  const legacyAtEnd = `# Report\n\n${renderPlanTaskCompletionProjection(candidate)}\n`;
  assert.equal(
    composeCompletionCandidate(
      Buffer.from(legacyAtEnd),
      candidate
    ).bytes.toString("utf8"),
    `# Report\n\n${region}\n`
  );
  const stale = structuredClone(candidate);
  firstEvidence(task(stale, 0)).detail = "Stale published claim.";
  const published = `# Report\n\nBefore.\n\n${renderCompletionRegion(stale)}\n\n## After\n\nAfter.\n`;
  const replacedV2 = composeCompletionCandidate(
    Buffer.from(published),
    candidate
  );
  assert.equal(
    replacedV2.bytes.toString("utf8"),
    `# Report\n\nBefore.\n\n${region}\n\n## After\n\nAfter.\n`
  );
  assert.deepEqual(parsePublishedCompletionRegion(replacedV2.bytes), candidate);
  // A fenced example of the region or heading is never structural.
  const fenced = `# Report\n\n\`\`\`text\n${region}\n## Plan Task Completion\n\`\`\`\n`;
  assert.equal(scanCompletionRegion(fenced).kind, "none");
  assert.equal(
    composeCompletionCandidate(Buffer.from(fenced), candidate).bytes.toString(
      "utf8"
    ),
    `${fenced}\n${region}\n`
  );
});

test("ambiguous completion region ownership fails before any overwrite", () => {
  const candidate = ledger();
  const region = renderCompletionRegion(candidate);
  const legacy = renderPlanTaskCompletionProjection(candidate);
  for (const [label, input] of [
    ["duplicate legacy sections", `${legacy}\n\n${legacy}\n`],
    ["legacy section outside a v2 pair", `${region}\n\n${legacy}\n`],
    ["repeated start delimiter", `${region}\n\n${COMPLETION_REGION_START}\n`],
    [
      "end before start",
      `${COMPLETION_REGION_END}\n## Plan Task Completion\n${COMPLETION_REGION_START}\n`
    ],
    ["unclosed fence", `# Report\n\n\`\`\`\n${legacy}\n`],
    [
      "malformed delimiter",
      `<!-- banzai-plan-task-completion/v2:begin -->\n## Plan Task Completion\n${COMPLETION_REGION_END}\n`
    ],
    [
      "second top-level section inside the pair",
      `${COMPLETION_REGION_START}\n## Plan Task Completion\n\n## Other\n${COMPLETION_REGION_END}\n`
    ],
    ["invalid UTF-8", Buffer.from([0x23, 0x20, 0xff, 0xfe])]
  ] as const) {
    assert.throws(
      () =>
        composeCompletionCandidate(
          typeof input === "string" ? Buffer.from(input) : input,
          candidate
        ),
      (error: unknown) =>
        error instanceof PlanTaskCompletionError &&
        error.violation === "report_region_invalid",
      label
    );
  }
  assert.throws(
    () => parsePublishedCompletionRegion(Buffer.from(`${legacy}\n`)),
    (error: unknown) =>
      error instanceof PlanTaskCompletionError &&
      error.violation === "report_projection_invalid"
  );
  assert.throws(
    () => parsePublishedCompletionRegion(Buffer.from("# Report\n")),
    (error: unknown) =>
      error instanceof PlanTaskCompletionError &&
      error.violation === "report_projection_missing"
  );
});

test("claim validation keeps evidence, scope, approval and report-role checks and requires preserved unique gap headings", async () => {
  const current = await fixture();
  const approval = {
    kind: "plan" as const,
    digest: current.approval.digest,
    approvedAt: "2026-09-16T00:00:00.000Z",
    approvedBy: "test",
    paths: current.approval.paths
  };
  const validate = (
    candidate: PlanTaskCompletionLedger | null,
    outcome: PhaseResult["outcome"] = "completed"
  ) =>
    validateCompletionClaims({
      repoRoot: current.root,
      ledger: candidate,
      outcome,
      artifacts: { implementationReport, testReport },
      planPath,
      approval
    });
  try {
    // Narrative-only report: no completion section is required as input.
    await writeFile(
      path.join(current.root, implementationReport),
      "# Implementation Report\n\nNarrative only.\n\n## Remaining Work\n\nNone.\n",
      "utf8"
    );
    const validated = await validate(current.canonical);
    assert.equal(validated.counts.completed, 6);
    assert.equal(validated.implementationReport.region.kind, "none");
    assert.equal(validated.ledgerDigest.length, 64);

    await expectViolation(validate(null), "missing_ledger");
    const carriedIn = ledger();
    firstEvidence(task(carriedIn, 0)).path = "base.txt";
    await expectViolation(validate(carriedIn), "evidence_scope_violation");
    const missing = ledger();
    firstEvidence(task(missing, 0)).path = "src/missing.txt";
    await expectViolation(validate(missing), "missing_evidence_path");
    const control = ledger();
    firstEvidence(task(control, 0)).path = ".banzai/config.json";
    await expectViolation(validate(control), "evidence_scope_violation");

    const gapped = ledger();
    const gap = task(gapped, 5);
    gap.status = "blocked";
    // A heading inside the replaced legacy region is never eligible.
    await writeFile(
      path.join(current.root, implementationReport),
      `# Implementation Report\n\n${renderPlanTaskCompletionProjection(gapped)}\n\n### Nested Gap\n\nInside the replaced region.\n\n## Preserved Gap\n\nOutside.\n\n## Preserved Gap\n\nDuplicate.\n\n\`\`\`\n## Fenced Gap\n\`\`\`\n\n## Unique Gap\n\nEligible.\n`,
      "utf8"
    );
    for (const section of ["Nested Gap", "Preserved Gap", "Fenced Gap"]) {
      gap.gap = { reportPath: implementationReport, section, detail: "Gap." };
      await expectViolation(
        validate(gapped, "needs_human_decision"),
        "invalid_gap_reference"
      );
    }
    gap.gap = {
      reportPath: implementationReport,
      section: "Unique Gap",
      detail: "Gap."
    };
    const blocked = await validate(gapped, "needs_human_decision");
    assert.equal(blocked.counts.blocked, 1);
    assert.equal(blocked.implementationReport.region.kind, "legacy");
    gap.gap = {
      reportPath: testReport,
      section: "Assurance Gap",
      detail: "Gap."
    };
    await writeFile(
      path.join(current.root, testReport),
      "# Test Report\n\n## Assurance Gap\n\nRequired work remains.\n",
      "utf8"
    );
    assert.equal((await validate(gapped, "blocked")).counts.blocked, 1);
    await expectViolation(validate(gapped), "task_status_conflict");

    await writeFile(
      path.join(current.root, descriptionPath),
      "# Description\n\nFR1 was changed after approval.\n",
      "utf8"
    );
    await expectViolation(validate(current.canonical), "approval_invalid");
  } finally {
    await current.dispose();
  }
});

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
}

function descendants(node: MarkdownNode): MarkdownNode[] {
  return [node, ...(node.children ?? []).flatMap(descendants)];
}

test("Prettier AST oracle: generated cells parse as literal text while raw controls create real syntax nodes", async (t) => {
  const prettier = (await import("prettier")) as unknown as {
    version: string;
    __debug: {
      parse(
        text: string,
        options: { parser: string }
      ): Promise<{ ast: MarkdownNode }>;
    };
  };
  const locked = JSON.parse(
    await readFile(
      path.join(process.cwd(), "../../node_modules/prettier/package.json"),
      "utf8"
    )
  ) as { version: string };
  assert.equal(
    prettier.version,
    locked.version,
    "oracle must be the lockfile-resolved Prettier"
  );
  t.diagnostic(`Prettier AST oracle version ${prettier.version}`);
  const candidate = specialLedger();
  const region = renderCompletionRegion(candidate);
  const { ast } = await prettier.__debug.parse(`${region}\n`, {
    parser: "markdown"
  });
  const table = ast.children?.find((node) => node.type === "table");
  assert.ok(table, "the region must parse as one table");
  assert.deepEqual(
    (ast.children ?? []).map((node) => node.type),
    ["html", "heading", "table", "html"],
    "delimiters, heading and one table; no extra rows or sections"
  );
  const rows = table.children ?? [];
  assert.equal(rows.length, candidate.tasks.length + 1);
  for (const [index, row] of rows.slice(1).entries()) {
    const record = task(candidate, index);
    const expected = [
      record.taskId,
      record.status,
      record.evidence,
      record.gap
    ];
    const cells = row.children ?? [];
    assert.equal(cells.length, 4);
    for (const [cellIndex, cell] of cells.entries()) {
      const nodes = descendants(cell).filter((node) => node !== cell);
      // Attribution rule (ADR-0048 section 3): any non-text node inside a
      // generated cell would originate from raw payload characters and is a
      // guarantee violation; the encoded fixtures include explicit link/image
      // syntax with separate targets, HTML, emphasis, code, table breakout and
      // URL/www/email strings.
      assert.deepEqual(
        nodes.map((node) => node.type),
        ["text"],
        `row ${index} cell ${cellIndex} must contain exactly one text node`
      );
      assert.equal(nodes[0]?.value, JSON.stringify(expected[cellIndex]));
    }
  }
  // Positive controls in the exact cell and row context: raw syntax in the
  // same table must produce the corresponding syntax nodes, so a control
  // asserted out of context cannot pass vacuously.
  const controlRow =
    "| T009 | control | [link](https://example.com/target) *emphasis* <b>html</b> `code` ![image](https://example.com/i.png) | www.example.com user@example.com https://example.com/x |";
  const controlRegion = region.replace(
    COMPLETION_REGION_END,
    `${controlRow}\n${COMPLETION_REGION_END}`
  );
  const controlAst = await prettier.__debug.parse(`${controlRegion}\n`, {
    parser: "markdown"
  });
  const controlTable = controlAst.ast.children?.find(
    (node) => node.type === "table"
  );
  const controlCells =
    controlTable?.children?.at(-1)?.children ?? ([] as MarkdownNode[]);
  const syntaxCell = controlCells[2];
  const autolinkCell = controlCells[3];
  assert.ok(syntaxCell && autolinkCell);
  const syntaxTypes = new Set(descendants(syntaxCell).map((node) => node.type));
  for (const type of ["link", "emphasis", "html", "inlineCode", "image"]) {
    assert.ok(syntaxTypes.has(type), `raw control must create a ${type} node`);
  }
  // Raw URL/www/email text is autolinked by the same parser; the encoded
  // fixtures above stayed literal text, which is the protected boundary.
  const autolinks = descendants(autolinkCell).filter(
    (node) => node.type === "link"
  );
  assert.equal(autolinks.length, 3, "raw autolink literals must link");
});
