import assert from "node:assert/strict";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  available,
  emptyContextInventory,
  emptyContextVendorUsage,
  measureRunnerPayload
} from "../src/context-accounting.js";
import { collectContextReport } from "../src/context-report.js";
import { collectEvaluationExport } from "../src/evaluation.js";
import { executeEvaluationExport } from "../src/evaluation-cli.js";
import {
  executeEvaluationKpiFromCheckout,
  executeEvaluationKpiFromInputs,
  parseEvaluationKpiArgs
} from "../src/evaluation-kpi-cli.js";
import {
  deriveEvaluationKpiReport,
  deriveEvaluationKpiSource,
  deriveRunSignature
} from "../src/evaluation-kpi.js";
import {
  renderEvaluationKpiJson,
  renderEvaluationKpiMarkdown
} from "../src/evaluation-kpi-render.js";
import {
  renderEvaluationJson,
  renderEvaluationMarkdown
} from "../src/evaluation-render.js";
import { resolveOutputContract } from "../src/output-contract.js";
import { createPromptEnvelope } from "../src/prompt-envelope.js";
import type {
  AttemptReference,
  ContextAttemptLedger,
  EvaluationExport,
  EvaluationExportOptions,
  EvaluationKpiReport
} from "../src/types.js";
import {
  createEvaluationRoot,
  evaluationAttemptFixture,
  evaluationStateFixture,
  snapshotTree,
  writeEvaluationRun
} from "./helpers.js";

const OPTIONS: EvaluationExportOptions = {
  format: "json",
  from: null,
  to: null,
  runIds: []
};
const RUN_ID = "evidence-run";
const MODEL_KINDS = [
  "selection",
  "plan",
  "implementation",
  "fix",
  "review"
] as const;

function kpis(report: EvaluationExport): EvaluationKpiReport {
  return deriveEvaluationKpiReport([{ label: "current", report }]);
}

function retries(report: EvaluationExport) {
  const source = deriveEvaluationKpiSource(1, "current", report);
  assert.ok(source);
  return source.kpis.filter((entry) => entry.kpi === "attempt_retry_ratio");
}

function firstRun(report: EvaluationExport) {
  const run = report.runs[0];
  assert.ok(run);
  return run;
}

function retryValue(report: EvaluationExport, kind: string) {
  const entry = retries(report).find((item) => item.measure === kind);
  assert.ok(entry);
  return entry.overall;
}

async function fixture(root: string, attempts: Record<string, unknown>[]) {
  const counts = Object.fromEntries(
    MODEL_KINDS.map((kind) => [
      kind,
      attempts.filter(
        (item) => (item.attempt as AttemptReference).kind === kind
      ).length
    ])
  );
  await writeEvaluationRun(root, RUN_ID, {
    state: evaluationStateFixture({
      attempts: counts,
      sessions: { fresh: attempts.length, resumed: 0 },
      usage: {
        inputTokens: attempts.length * 10,
        cachedInputTokens: attempts.length * 2,
        outputTokens: attempts.length * 3,
        costUsd: attempts.length * 0.25
      },
      extra: { runId: RUN_ID }
    })
  });
  const directory = path.join(root, ".banzai", "runs", RUN_ID);
  for (const item of attempts) {
    const ref = item.attempt as AttemptReference;
    await writeFile(
      path.join(directory, "attempts", `${ref.id}-${ref.kind}.json`),
      JSON.stringify(item)
    );
  }
  return directory;
}

function implementation(
  id: string,
  status: "completed" | "failed" = "completed"
) {
  return evaluationAttemptFixture({ id, kind: "implementation", status });
}

for (const scenario of [
  {
    name: "implementation gap beside confirmed empty kinds",
    retained: ["implementation"],
    missing: ["implementation"]
  },
  {
    name: "planning gap beside observed kinds",
    retained: MODEL_KINDS,
    missing: ["plan"]
  },
  {
    name: "multiple planning and review gaps",
    retained: MODEL_KINDS,
    missing: ["plan", "review", "review"]
  }
] as const) {
  test(`attempt evidence counter gaps isolate ${scenario.name}`, async () => {
    const root = await createEvaluationRoot();
    try {
      const allKinds = [...scenario.retained, ...scenario.missing];
      const attempts = allKinds.map((kind, index) =>
        evaluationAttemptFixture({ id: `attempt-${index}`, kind })
      );
      const directory = await fixture(root, attempts);
      const statePath = path.join(directory, "state.json");
      const state = JSON.parse(await readFile(statePath, "utf8")) as {
        metrics: { reviews: { full: number } };
      };
      state.metrics.reviews.full = allKinds.filter(
        (kind) => kind === "review"
      ).length;
      await writeFile(statePath, JSON.stringify(state));
      const complete = await collectEvaluationExport(root, OPTIONS);
      assert.deepEqual(complete.issues, []);
      for (const [index, kind] of allKinds.entries()) {
        if (index >= scenario.retained.length) {
          await rm(
            path.join(directory, "attempts", `attempt-${index}-${kind}.json`)
          );
        }
      }

      const report = await collectEvaluationExport(root, OPTIONS);
      const run = firstRun(report);
      const baseline = firstRun(complete).metrics;
      assert.deepEqual(run.issueCodes, ["METRIC_MISMATCH"]);
      assert.equal(run.attempts.length, scenario.retained.length);
      const phases = {
        selection: "selection",
        plan: "planning",
        implementation: "implementation",
        fix: "fixing",
        review: "review"
      } as const;
      for (const kind of MODEL_KINDS) {
        const retained = scenario.retained.filter(
          (item) => item === kind
        ).length;
        const missing = scenario.missing.filter((item) => item === kind).length;
        assert.deepEqual(run.metrics.attempts.byKind[kind], {
          value: missing === 0 ? retained : null,
          observedSubtotal: retained,
          observedCount: retained,
          unknownCount: missing,
          invalidCount: 0,
          availability: missing === 0 ? "complete" : "partial"
        });
        assert.deepEqual(run.metrics.durationsMs[phases[kind]], {
          value: missing === 0 ? retained * 1_000 : null,
          observedSubtotal: retained * 1_000,
          observedCount: retained,
          unknownCount: missing,
          invalidCount: 0,
          availability: missing === 0 ? "complete" : "partial"
        });
      }
      const reviewGaps = scenario.missing.filter(
        (kind) => kind === "review"
      ).length;
      for (const metric of [
        ...Object.values(run.metrics.reviews.attempts),
        run.metrics.reviews.rotations.total,
        ...Object.values(run.metrics.reviews.rotations.byReason)
      ]) {
        assert.equal(metric.unknownCount, reviewGaps);
        assert.equal(metric.invalidCount, 0);
        assert.equal(
          metric.availability,
          reviewGaps === 0 ? "complete" : "partial"
        );
      }
      if (reviewGaps === 0) {
        assert.deepEqual(run.metrics.reviews, baseline.reviews);
      } else {
        assert.equal(run.metrics.reviews.attempts.full.observedSubtotal, 1);
        assert.equal(run.metrics.reviews.attempts.full.value, null);
      }
      for (const metric of [
        run.metrics.attempts.total,
        ...Object.values(run.metrics.sessions),
        ...Object.values(run.metrics.usage),
        run.metrics.failures.model_attempt,
        run.metrics.failures.interrupted_attempt
      ]) {
        assert.equal(metric.unknownCount, scenario.missing.length);
        assert.equal(metric.value, null);
        assert.equal(metric.availability, "partial");
      }
      for (const outcome of ["completed", "failed", "started"] as const) {
        assert.equal(
          run.metrics.attempts.byOutcome[outcome].unknownCount,
          baseline.attempts.byOutcome[outcome].unknownCount +
            scenario.missing.length
        );
      }
      assert.equal(
        run.metrics.attempts.total.observedSubtotal,
        scenario.retained.length
      );
      assert.equal(
        run.metrics.usage.inputTokens.observedSubtotal,
        scenario.retained.length * 10
      );
      assert.deepEqual(
        run.metrics.attempts.byKind.verification,
        baseline.attempts.byKind.verification
      );
      assert.deepEqual(
        run.metrics.durationsMs.verification,
        baseline.durationsMs.verification
      );
      assert.deepEqual(run.metrics.verification, baseline.verification);
      for (const entry of retries(report)) {
        assert.deepEqual(entry.overall, {
          numerator: 0,
          denominator: 0,
          value: null,
          coverage: { exact: 0, incomplete: 1 }
        });
      }
      assert.deepEqual(deriveRunSignature(run), {
        planner: "unknown",
        implementer: "unknown",
        reviewer: "unknown",
        key: "planner=unknown implementer=unknown reviewer=unknown"
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("attempt evidence context sidecars leave export and derived kpi bytes unchanged", async () => {
  const root = await createEvaluationRoot();
  try {
    const canonical = implementation("implementation-one");
    const directory = await fixture(root, [canonical]);
    const before = await collectEvaluationExport(root, OPTIONS);
    assert.equal(before.issues.length, 0);
    assert.deepEqual((await collectContextReport(root, OPTIONS)).coverage, {
      exact: 0,
      incomplete: 1
    });
    const ledger: ContextAttemptLedger = {
      schema: "banzai-context-attempt/v1",
      schemaVersion: 1,
      runId: RUN_ID,
      attempt: canonical.attempt as AttemptReference,
      invocations: [
        {
          ordinal: 1,
          kind: "primary",
          workflow: "strict",
          phase: "implementation",
          role: "implementer",
          vendor: "codex",
          sessionMode: "fresh",
          measuredAt: "2026-07-01T00:01:00.000Z",
          completedAt: "2026-07-01T00:01:01.000Z",
          outcome: "completed",
          runnerPayload: measureRunnerPayload(
            createPromptEnvelope([
              { category: "phase_instructions", text: "fixture" }
            ]),
            resolveOutputContract("codex", "phase-result/v3")
          ),
          authority: [],
          sessionInventory: emptyContextInventory(),
          vendorUsage: {
            ...emptyContextVendorUsage(),
            inputTokens: available(10),
            cachedInputTokens: available(2),
            outputTokens: available(3),
            costUsd: available(0.25)
          },
          budgets: []
        }
      ]
    };
    const sidecar = path.join(
      directory,
      "attempts",
      "implementation-one.context.json"
    );
    await writeFile(sidecar, JSON.stringify(ledger));
    // Unreadable excluded leaves prove the exporter never decodes private content.
    for (const name of [
      "implementation-one-result.json",
      "implementation-one.terminal-checkpoint.json"
    ]) {
      await symlink(name, path.join(directory, "attempts", name));
    }
    assert.deepEqual((await collectContextReport(root, OPTIONS)).coverage, {
      exact: 1,
      incomplete: 0
    });
    const after = await collectEvaluationExport(root, OPTIONS);
    assert.deepEqual(after, before);
    assert.equal(firstRun(after).attempts.length, 1);
    assert.equal(firstRun(after).attempts[0]?.status.value, "completed");
    assert.equal(firstRun(after).metrics.usage.inputTokens.value, 10);
    assert.equal(
      deriveRunSignature(firstRun(after)).implementer,
      "codex/gpt-evaluation-model/high"
    );
    assert.equal(renderEvaluationJson(after), renderEvaluationJson(before));
    assert.equal(
      renderEvaluationMarkdown(after),
      renderEvaluationMarkdown(before)
    );
    assert.equal(
      renderEvaluationKpiJson(kpis(after)),
      renderEvaluationKpiJson(kpis(before))
    );
    assert.equal(
      renderEvaluationKpiMarkdown(kpis(after)),
      renderEvaluationKpiMarkdown(kpis(before))
    );
    await writeFile(sidecar, "{FORBIDDEN-CONTEXT-CONTENT");
    assert.deepEqual(await collectEvaluationExport(root, OPTIONS), before);
    await assert.rejects(collectContextReport(root, OPTIONS), {
      code: "INVALID_CONTEXT_EVIDENCE"
    });
    assert.doesNotMatch(
      renderEvaluationJson(after) + renderEvaluationKpiJson(kpis(after)),
      /FORBIDDEN|evidence-run|implementation-one/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const LOSS_CASES = [
  "missing-directory",
  "unreadable-directory",
  "unreadable-state",
  "unreadable-leaf",
  "malformed-json",
  "unknown-json",
  "unsupported-schema",
  "absent-schema",
  "identity-conflict",
  "missing-active",
  "missing-terminal-leaf",
  "unknown-status",
  "invalid-status"
] as const;

for (const loss of LOSS_CASES) {
  test(`attempt evidence ${loss} never becomes exact retry coverage`, async () => {
    const root = await createEvaluationRoot();
    try {
      const first = implementation("implementation-one", "failed");
      const second = implementation("implementation-two");
      const directory = await fixture(root, [first, second]);
      const attemptDir = path.join(directory, "attempts");
      if (loss === "missing-directory" || loss === "unreadable-directory") {
        await rm(attemptDir, { recursive: true });
        if (loss === "unreadable-directory")
          await symlink("attempts", attemptDir);
      } else if (loss === "unreadable-state") {
        await writeFile(path.join(directory, "state.json"), "{FORBIDDEN");
      } else if (loss === "unreadable-leaf") {
        await symlink(
          "unreadable-implementation.json",
          path.join(attemptDir, "unreadable-implementation.json")
        );
      } else if (loss === "malformed-json" || loss === "unknown-json") {
        await writeFile(
          path.join(attemptDir, "unrecognized-record.json"),
          loss === "malformed-json"
            ? "{FORBIDDEN"
            : JSON.stringify({ unknown: "FORBIDDEN" })
        );
      } else if (loss === "identity-conflict") {
        await writeFile(
          path.join(attemptDir, "historical-copy.json"),
          JSON.stringify({ ...first, status: "completed" })
        );
      } else if (loss === "missing-active") {
        const statePath = path.join(directory, "state.json");
        const state = JSON.parse(await readFile(statePath, "utf8")) as Record<
          string,
          unknown
        >;
        state.activeAttempt = {
          id: "missing",
          kind: "implementation",
          mutable: true
        };
        await writeFile(statePath, JSON.stringify(state));
      } else if (loss === "missing-terminal-leaf") {
        await rm(
          path.join(attemptDir, "implementation-one-implementation.json")
        );
      } else {
        const extra = implementation("additional");
        if (loss === "unsupported-schema") extra.schemaVersion = 999;
        if (loss === "absent-schema") delete extra.schemaVersion;
        if (loss === "unknown-status") delete extra.status;
        if (loss === "invalid-status") extra.status = "FORBIDDEN";
        await writeFile(
          path.join(attemptDir, "additional-implementation.json"),
          JSON.stringify(extra)
        );
      }
      if (loss === "unsupported-schema" || loss === "absent-schema") {
        const before = await snapshotTree(root);
        await assert.rejects(collectEvaluationExport(root, OPTIONS), {
          code: "RESOURCE_VERSION_UNSUPPORTED"
        });
        assert.deepEqual(await snapshotTree(root), before);
        return;
      }
      const report = await collectEvaluationExport(root, OPTIONS);
      assert.ok(report.issues.length > 0);
      const run = firstRun(report);
      if (
        ["unreadable-leaf", "malformed-json", "unknown-json"].includes(loss)
      ) {
        assert.ok(run.issueCodes.includes("ATTEMPT_MALFORMED"));
        assert.equal(run.attempts.length, 2);
        for (const kind of MODEL_KINDS) {
          assert.equal(run.metrics.attempts.byKind[kind].invalidCount, 1);
        }
      }
      if (loss === "missing-terminal-leaf") {
        assert.ok(run.issueCodes.includes("METRIC_MISMATCH"));
        assert.equal(run.attempts.length, 1);
        assert.equal(run.metrics.attempts.byKind.implementation.value, null);
        assert.equal(run.metrics.usage.inputTokens.value, null);
        assert.equal(run.metrics.usage.inputTokens.observedSubtotal, 10);
      }
      for (const entry of retries(report)) {
        assert.deepEqual(entry.overall, {
          numerator: 0,
          denominator: 0,
          value: null,
          coverage: { exact: 0, incomplete: 1 }
        });
      }
      if (!loss.endsWith("status")) {
        assert.deepEqual(deriveRunSignature(firstRun(report)), {
          planner: "unknown",
          implementer: "unknown",
          reviewer: "unknown",
          key: "planner=unknown implementer=unknown reviewer=unknown"
        });
      }
      assert.doesNotMatch(
        renderEvaluationJson(report) + renderEvaluationKpiJson(kpis(report)),
        /FORBIDDEN|historical-copy|unrecognized-record/
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("attempt evidence duplicate and historical records retain exact retries despite unrelated gaps", async () => {
  const root = await createEvaluationRoot();
  try {
    const failed = implementation("implementation-one", "failed");
    const completed = implementation("implementation-two");
    // Historical schema one and current schema two retain their status semantics.
    completed.schemaVersion = 2;
    const directory = await fixture(root, [failed, completed]);
    await writeFile(
      path.join(directory, "attempts", "historical-copy.json"),
      JSON.stringify(failed)
    );
    const statePath = path.join(directory, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      metrics: { attempts: { verification: number } };
    };
    state.metrics.attempts.verification = 2;
    await writeFile(statePath, JSON.stringify(state));
    completed.usage = {
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 3,
      costUsd: null
    };
    await writeFile(
      path.join(
        directory,
        "attempts",
        "implementation-two-implementation.json"
      ),
      JSON.stringify(completed)
    );
    const report = await collectEvaluationExport(root, OPTIONS);
    const run = firstRun(report);
    assert.equal(run.completeness, "partial");
    assert.ok(run.issueCodes.includes("ATTEMPT_DUPLICATE"));
    assert.ok(run.issueCodes.includes("METRIC_MISMATCH"));
    assert.equal(
      run.metrics.attempts.byOutcome.completed.availability,
      "partial"
    );
    assert.equal(run.metrics.usage.costUsd.value, null);
    assert.equal(run.attempts.length, 2);
    assert.deepEqual(retryValue(report, "implementation"), {
      numerator: 1,
      denominator: 2,
      value: 0.5,
      coverage: { exact: 1, incomplete: 0 }
    });
    assert.equal(
      deriveRunSignature(run).implementer,
      "codex/gpt-evaluation-model/high"
    );
    const ledgerDir = path.join(directory, "verification-attempts");
    await mkdir(ledgerDir, { recursive: true });
    await writeFile(
      path.join(ledgerDir, "ledger.json"),
      JSON.stringify({ schemaVersion: 999 })
    );
    const beforeUnsupported = await snapshotTree(root);
    await assert.rejects(collectEvaluationExport(root, OPTIONS), {
      code: "RESOURCE_VERSION_UNSUPPORTED"
    });
    assert.deepEqual(await snapshotTree(root), beforeUnsupported);
    await rm(ledgerDir, { recursive: true });
    await rm(path.join(directory, "attempts"), { recursive: true });
    await fixture(root, []);
    const empty = await collectEvaluationExport(root, OPTIONS);
    for (const entry of retries(empty)) {
      assert.deepEqual(entry.overall, {
        numerator: 0,
        denominator: 0,
        value: null,
        coverage: { exact: 1, incomplete: 0 }
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("attempt evidence checkout and input kpis agree over partial exports without writes or disclosure", async () => {
  const root = await createEvaluationRoot();
  const inputRoot = await createEvaluationRoot();
  try {
    const canonical = implementation("implementation-one", "failed");
    const directory = await fixture(root, [
      canonical,
      implementation("implementation-two")
    ]);
    await writeFile(
      path.join(directory, "attempts", "conflict.json"),
      JSON.stringify({ ...canonical, status: "completed" })
    );
    await writeEvaluationRun(root, "healthy-run", {
      state: evaluationStateFixture({ attempts: { implementation: 2 } }),
      attempts: [
        implementation("healthy-one", "failed"),
        implementation("healthy-two")
      ]
    });
    const before = await snapshotTree(root);
    const json: string[] = [];
    const diagnostics: string[] = [];
    await executeEvaluationExport(root, ["--json"], {
      stdout: (value) => json.push(value),
      stderr: (value) => diagnostics.push(value)
    });
    const input = path.join(inputRoot, "export.json");
    await writeFile(input, json.join(""));
    for (const format of [[], ["--json"]]) {
      const checkout: string[] = [],
        files: string[] = [],
        repeat: string[] = [];
      const stderr = (value: string) => diagnostics.push(value);
      await executeEvaluationKpiFromCheckout(
        root,
        parseEvaluationKpiArgs(format),
        { stdout: (value) => checkout.push(value), stderr }
      );
      await executeEvaluationKpiFromInputs(
        parseEvaluationKpiArgs([...format, "--input", input]),
        { stdout: (value) => files.push(value), stderr }
      );
      await executeEvaluationKpiFromCheckout(
        root,
        parseEvaluationKpiArgs(format),
        { stdout: (value) => repeat.push(value), stderr }
      );
      assert.equal(checkout.join(""), repeat.join(""));
      assert.equal(
        files.join("").replaceAll("1: export.json", "current"),
        checkout.join("")
      );
      assert.doesNotMatch(
        checkout.join("") + files.join(""),
        /FORBIDDEN|evidence-run|implementation-one/
      );
    }
    assert.deepEqual(await snapshotTree(root), before);
    assert.deepEqual(diagnostics, [
      "[EVAL_PARTIAL] Export includes incomplete evidence; inspect the structured issues in the report.\n"
    ]);
    const report = JSON.parse(json.join("")) as EvaluationExport;
    assert.deepEqual(retryValue(report, "implementation"), {
      numerator: 1,
      denominator: 2,
      value: 0.5,
      coverage: { exact: 1, incomplete: 1 }
    });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(inputRoot, { recursive: true, force: true });
  }
});

test("attempt evidence omitted identities cannot attribute surviving models to a configuration", async () => {
  const root = await createEvaluationRoot();
  try {
    const first = implementation("implementation-one");
    const directory = await fixture(root, [
      first,
      implementation("implementation-two")
    ]);
    await writeFile(
      path.join(directory, "attempts", "conflict.json"),
      JSON.stringify({ ...first, status: "failed" })
    );
    const report = await collectEvaluationExport(root, OPTIONS);
    assert.equal(firstRun(report).attempts.length, 1);
    assert.ok(firstRun(report).issueCodes.includes("ATTEMPT_CONFLICT"));
    assert.equal(deriveRunSignature(firstRun(report)).implementer, "unknown");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("attempt evidence interrupted status keeps the historical export and retry interpretation", async () => {
  const root = await createEvaluationRoot();
  try {
    const interrupted = evaluationAttemptFixture({
      id: "interrupted",
      kind: "implementation",
      status: "started",
      durationMs: null
    });
    interrupted.schemaVersion = 2;
    interrupted.status = "interrupted";
    interrupted.interruptedAt = "2026-07-01T00:02:00.000Z";
    interrupted.recoveryOf = null;
    interrupted.recoveryAuthorizationId = null;
    await fixture(root, [implementation("failed", "failed"), interrupted]);
    const report = await collectEvaluationExport(root, OPTIONS);
    assert.deepEqual(
      firstRun(report).attempts.find((item) => item.status.value === "started")
        ?.status,
      { value: "started", evidence: "derived" }
    );
    assert.deepEqual(retryValue(report, "implementation"), {
      numerator: 1,
      denominator: 2,
      value: 0.5,
      coverage: { exact: 1, incomplete: 0 }
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
