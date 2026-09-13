import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { BanzaiError } from "../src/errors.js";
import {
  executeEvaluationExport,
  parseEvaluationExportArgs
} from "../src/evaluation-cli.js";
import {
  createEvaluationRoot,
  evaluationAttemptFixture,
  evaluationStateFixture,
  snapshotTree,
  writeEvaluationRun
} from "./helpers.js";

function errorCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof BanzaiError && error.code === code;
}

const CREATED_DATE = "2026-07-01T00:00:00Z";
const INVALID_ARGUMENT_CASES: { args: string[]; code: string }[] = [
  { args: ["--json", "--json"], code: "INVALID_EVAL_OPTION" },
  {
    args: ["--from", CREATED_DATE, "--from", CREATED_DATE],
    code: "INVALID_EVAL_OPTION"
  },
  {
    args: ["--to", CREATED_DATE, "--to", CREATED_DATE],
    code: "INVALID_EVAL_OPTION"
  },
  { args: ["--from"], code: "MISSING_EVAL_OPTION" },
  { args: ["--run"], code: "MISSING_EVAL_OPTION" },
  { args: ["--unknown"], code: "INVALID_EVAL_OPTION" },
  { args: ["positional"], code: "INVALID_EVAL_OPTION" },
  { args: ["--run", ""], code: "INVALID_EVAL_RUN_ID" },
  { args: ["--run", "../run"], code: "INVALID_EVAL_RUN_ID" },
  { args: ["--run", "."], code: "INVALID_EVAL_RUN_ID" },
  { args: ["--from", "2026-07-01"], code: "INVALID_EVAL_DATE" },
  { args: ["--from", "2026-02-30T00:00:00Z"], code: "INVALID_EVAL_DATE" },
  { args: ["--from", "2026-07-01T25:00:00Z"], code: "INVALID_EVAL_DATE" },
  {
    args: ["--from", "2026-07-02T00:00:00Z", "--to", "2026-07-02T00:00:00Z"],
    code: "INVALID_EVAL_RANGE"
  },
  {
    args: ["--from", "2026-07-03T00:00:00Z", "--to", "2026-07-02T00:00:00Z"],
    code: "INVALID_EVAL_RANGE"
  }
];

test("parses the exact evaluation export option contract and normalizes selectors", () => {
  assert.deepEqual(parseEvaluationExportArgs([]), {
    schemaVersion: 2,
    format: "markdown",
    from: null,
    to: null,
    runIds: []
  });
  assert.deepEqual(
    parseEvaluationExportArgs([
      "--json",
      "--from",
      "2026-07-01T03:00:00+03:00",
      "--to",
      "2026-07-02T00:00:00Z",
      "--run",
      "z-run",
      "--run",
      "a-run",
      "--run",
      "z-run"
    ]),
    {
      schemaVersion: 2,
      format: "json",
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-02T00:00:00.000Z",
      runIds: ["a-run", "z-run"]
    }
  );
});

test("rejects duplicate, missing, unknown, unsafe, invalid-date, and invalid-range arguments", () => {
  for (const item of INVALID_ARGUMENT_CASES) {
    assert.throws(
      () => parseEvaluationExportArgs(item.args),
      errorCode(item.code)
    );
  }
});

test("writes Markdown or authoritative JSON only to stdout for an empty cohort", async () => {
  const root = await createEvaluationRoot();
  try {
    const runsRoot = path.join(root, ".banzai", "runs");
    const before = await snapshotTree(runsRoot);
    const markdownOut: string[] = [];
    const markdownErr: string[] = [];
    await executeEvaluationExport(root, [], {
      stdout: (value) => markdownOut.push(value),
      stderr: (value) => markdownErr.push(value)
    });
    assert.equal(markdownOut.length, 1);
    assert.match(markdownOut[0] ?? "", /^# Banzai Evaluation Export/);
    assert.deepEqual(markdownErr, []);

    const jsonOut: string[] = [];
    const jsonErr: string[] = [];
    await executeEvaluationExport(root, ["--json"], {
      stdout: (value) => jsonOut.push(value),
      stderr: (value) => jsonErr.push(value)
    });
    assert.equal(jsonOut.length, 1);
    assert.doesNotThrow(() => JSON.parse(jsonOut[0] ?? ""));
    assert.equal(
      (JSON.parse(jsonOut[0] ?? "") as { schema: string }).schema,
      "banzai-evaluation-export/v2"
    );
    assert.deepEqual(jsonErr, []);
    assert.deepEqual(await snapshotTree(runsRoot), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writes a fixed privacy-safe partial warning to stderr after clean JSON stdout", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-eval-cli-test-"));
  const runDirectory = path.join(
    root,
    ".banzai",
    "runs",
    "FORBIDDEN-SECRET-SLUG"
  );
  try {
    await mkdir(runDirectory, { recursive: true });
    await writeFile(
      path.join(runDirectory, "state.json"),
      "{FORBIDDEN-RAW-CONTENT",
      "utf8"
    );
    const before = await snapshotTree(path.join(root, ".banzai", "runs"));
    const stdout: string[] = [];
    const stderr: string[] = [];
    await executeEvaluationExport(root, ["--json"], {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value)
    });
    assert.equal(stdout.length, 1);
    assert.doesNotThrow(() => JSON.parse(stdout[0] ?? ""));
    assert.equal(
      stderr.join(""),
      "[EVAL_PARTIAL] Export includes incomplete evidence; inspect the structured issues in the report.\n"
    );
    assert.doesNotMatch(stdout.join("") + stderr.join(""), /FORBIDDEN/);
    assert.deepEqual(
      await snapshotTree(path.join(root, ".banzai", "runs")),
      before
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fatal selector and argument errors occur before any injected report output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-eval-cli-test-"));
  try {
    const before = await snapshotTree(path.join(root, ".banzai", "runs"));
    const stdout: string[] = [];
    const stderr: string[] = [];
    await assert.rejects(
      executeEvaluationExport(root, ["--run", "missing-run"], {
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value)
      }),
      errorCode("EVAL_RUN_NOT_FOUND")
    );
    for (const item of INVALID_ARGUMENT_CASES) {
      await assert.rejects(
        executeEvaluationExport(root, item.args, {
          stdout: (value) => stdout.push(value),
          stderr: (value) => stderr.push(value)
        }),
        errorCode(item.code)
      );
    }
    assert.deepEqual(stdout, []);
    assert.deepEqual(stderr, []);
    assert.deepEqual(
      await snapshotTree(path.join(root, ".banzai", "runs")),
      before
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("complete and filtered CLI exports preserve every run-tree byte", async () => {
  const root = await createEvaluationRoot();
  try {
    await writeEvaluationRun(root, "complete-run", {
      state: evaluationStateFixture({
        attempts: { implementation: 1 },
        usage: {
          inputTokens: 10,
          cachedInputTokens: 2,
          outputTokens: 3,
          costUsd: 0.25
        },
        sessions: { fresh: 1, resumed: 0 }
      }),
      attempts: [
        evaluationAttemptFixture({
          id: "private-attempt",
          kind: "implementation"
        })
      ]
    });
    await writeEvaluationRun(root, "later-run", {
      state: evaluationStateFixture({
        createdAt: "2026-07-03T00:00:00.000Z",
        workflow: "feature"
      })
    });
    const runsRoot = path.join(root, ".banzai", "runs");
    const before = await snapshotTree(runsRoot);
    for (const args of [
      [] as string[],
      [
        "--json",
        "--from",
        "2026-07-01T00:00:00Z",
        "--to",
        "2026-07-02T00:00:00Z",
        "--run",
        "complete-run"
      ]
    ]) {
      const stdout: string[] = [];
      const stderr: string[] = [];
      await executeEvaluationExport(root, args, {
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value)
      });
      assert.equal(stdout.length, 1);
      assert.equal(stderr.length, 1);
      assert.match(stderr[0] ?? "", /EVAL_PARTIAL/);
      assert.deepEqual(await snapshotTree(runsRoot), before);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readable partial CLI export preserves every run-tree byte", async () => {
  const root = await createEvaluationRoot();
  try {
    const state = evaluationStateFixture();
    delete state.metrics;
    await writeEvaluationRun(root, "partial-run", { state });
    const runsRoot = path.join(root, ".banzai", "runs");
    const before = await snapshotTree(runsRoot);
    const stdout: string[] = [];
    const stderr: string[] = [];
    await executeEvaluationExport(root, ["--json"], {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value)
    });
    assert.equal(
      (JSON.parse(stdout.join("")) as { runs: { completeness: string }[] })
        .runs[0]?.completeness,
      "partial"
    );
    assert.equal(stderr.length, 1);
    assert.deepEqual(await snapshotTree(runsRoot), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit evaluation v2 remains read-only and never infers legacy origins", async () => {
  const root = await createEvaluationRoot();
  try {
    await writeEvaluationRun(root, "legacy", {
      state: evaluationStateFixture()
    });
    const before = await snapshotTree(root);
    const output: string[] = [];
    await executeEvaluationExport(root, ["--schema-version", "2", "--json"], {
      stdout: (text) => output.push(text),
      stderr: () => {}
    });
    const result = JSON.parse(output.join("")) as {
      schema: string;
      runs: { verificationEvidence: { coverage: string } }[];
    };
    assert.equal(result.schema, "banzai-evaluation-export/v2");
    assert.equal(result.runs[0]?.verificationEvidence.coverage, "incomplete");
    assert.deepEqual(await snapshotTree(root), before);
    assert.throws(() =>
      parseEvaluationExportArgs([
        "--schema-version",
        "2",
        "--schema-version",
        "1"
      ])
    );
    assert.throws(() => parseEvaluationExportArgs(["--schema-version", "3"]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
