import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { BanzaiError } from "../src/errors.js";
import { executeEvaluationExport } from "../src/evaluation-cli.js";
import {
  executeEvaluationKpiFromCheckout,
  executeEvaluationKpiFromInputs,
  parseEvaluationKpiArgs
} from "../src/evaluation-kpi-cli.js";
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

function collectIo(): {
  stdout: string[];
  stderr: string[];
  io: {
    stdout: (value: string) => void;
    stderr: (value: string) => void;
  };
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value)
    }
  };
}

async function exportedJson(
  root: string,
  args: string[] = ["--json"]
): Promise<string> {
  const { stdout, io } = collectIo();
  await executeEvaluationExport(root, args, io);
  return stdout.join("");
}

const CREATED_DATE = "2026-07-01T00:00:00Z";

test("parses the exact evaluation kpi option contract including repeatable inputs", () => {
  assert.deepEqual(parseEvaluationKpiArgs([]), {
    format: "markdown",
    from: null,
    to: null,
    runIds: [],
    inputs: []
  });
  assert.deepEqual(
    parseEvaluationKpiArgs([
      "--input",
      "b.json",
      "--input",
      "a.json",
      "--input",
      "b.json",
      "--json"
    ]),
    {
      format: "json",
      from: null,
      to: null,
      runIds: [],
      inputs: ["b.json", "a.json", "b.json"]
    }
  );
  assert.deepEqual(
    parseEvaluationKpiArgs([
      "--from",
      "2026-07-01T03:00:00+03:00",
      "--to",
      "2026-07-02T00:00:00Z",
      "--run",
      "z-run",
      "--run",
      "a-run"
    ]),
    {
      format: "markdown",
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-02T00:00:00.000Z",
      runIds: ["a-run", "z-run"],
      inputs: []
    }
  );
});

test("rejects shared grammar violations with the export error codes and input mixing fail-closed", () => {
  const cases: { args: string[]; code: string }[] = [
    { args: ["--json", "--json"], code: "INVALID_EVAL_OPTION" },
    {
      args: ["--from", CREATED_DATE, "--from", CREATED_DATE],
      code: "INVALID_EVAL_OPTION"
    },
    { args: ["--from"], code: "MISSING_EVAL_OPTION" },
    { args: ["--run"], code: "MISSING_EVAL_OPTION" },
    { args: ["--input"], code: "MISSING_EVAL_OPTION" },
    { args: ["--input", "--json"], code: "MISSING_EVAL_OPTION" },
    { args: ["--unknown"], code: "INVALID_EVAL_OPTION" },
    { args: ["positional"], code: "INVALID_EVAL_OPTION" },
    { args: ["--run", "../run"], code: "INVALID_EVAL_RUN_ID" },
    { args: ["--from", "2026-07-01"], code: "INVALID_EVAL_DATE" },
    {
      args: ["--from", "2026-07-02T00:00:00Z", "--to", "2026-07-02T00:00:00Z"],
      code: "INVALID_EVAL_RANGE"
    },
    {
      args: ["--input", "a.json", "--from", CREATED_DATE],
      code: "INVALID_EVAL_OPTION"
    },
    {
      args: ["--input", "a.json", "--to", CREATED_DATE],
      code: "INVALID_EVAL_OPTION"
    },
    {
      args: ["--input", "a.json", "--run", "some-run"],
      code: "INVALID_EVAL_OPTION"
    }
  ];
  for (const item of cases) {
    assert.throws(
      () => parseEvaluationKpiArgs(item.args),
      errorCode(item.code)
    );
  }
});

test("derives kpis from input files with ordinal basename labels outside any repository", async () => {
  const evaluationRoot = await createEvaluationRoot();
  const inputRoot = await mkdtemp(path.join(tmpdir(), "banzai-kpi-inputs-"));
  try {
    await writeEvaluationRun(evaluationRoot, "complete-run", {
      state: evaluationStateFixture({
        attempts: { implementation: 1 },
        usage: {
          inputTokens: 10,
          cachedInputTokens: 2,
          outputTokens: 3,
          costUsd: 0.25
        }
      }),
      attempts: [
        evaluationAttemptFixture({ id: "attempt-1", kind: "implementation" })
      ]
    });
    const exported = await exportedJson(evaluationRoot);
    const first = path.join(inputRoot, "a.json");
    const second = path.join(inputRoot, "b.json");
    await writeFile(first, exported, "utf8");
    await writeFile(second, exported, "utf8");

    const markdown = collectIo();
    await executeEvaluationKpiFromInputs(
      parseEvaluationKpiArgs(["--input", first, "--input", second]),
      markdown.io
    );
    assert.equal(markdown.stdout.length, 1);
    const rendered = markdown.stdout.join("");
    assert.match(rendered, /^# Banzai Evaluation KPIs/);
    assert.match(rendered, /\| 1 \| 1: a\.json \|/);
    assert.match(rendered, /\| 2 \| 2: b\.json \|/);
    assert.match(rendered, /\| Row \| 1: a\.json \| 2: b\.json \|/);
    assert.deepEqual(markdown.stderr, []);

    const repeat = collectIo();
    await executeEvaluationKpiFromInputs(
      parseEvaluationKpiArgs(["--input", first, "--input", second]),
      repeat.io
    );
    assert.equal(repeat.stdout.join(""), rendered);

    const json = collectIo();
    await executeEvaluationKpiFromInputs(
      parseEvaluationKpiArgs(["--input", first, "--json"]),
      json.io
    );
    const document = JSON.parse(json.stdout.join("")) as {
      schema: string;
      sources: { label: string }[];
    };
    assert.equal(document.schema, "banzai-evaluation-kpi/v1");
    assert.deepEqual(
      document.sources.map((source) => source.label),
      ["1: a.json"]
    );
  } finally {
    await rm(evaluationRoot, { recursive: true, force: true });
    await rm(inputRoot, { recursive: true, force: true });
  }
});

test("fails closed with INVALID_EVAL_INPUT and no output on unreadable, malformed, or foreign inputs", async () => {
  const inputRoot = await mkdtemp(path.join(tmpdir(), "banzai-kpi-inputs-"));
  try {
    const malformed = path.join(inputRoot, "malformed.json");
    await writeFile(malformed, "not json", "utf8");
    const foreign = path.join(inputRoot, "foreign.json");
    await writeFile(
      foreign,
      JSON.stringify({ schema: "banzai-doctor/v1", schemaVersion: 1 }),
      "utf8"
    );
    for (const file of [
      path.join(inputRoot, "missing.json"),
      malformed,
      foreign
    ]) {
      const { stdout, stderr, io } = collectIo();
      await assert.rejects(
        executeEvaluationKpiFromInputs(
          parseEvaluationKpiArgs(["--input", file]),
          io
        ),
        (error: unknown) => {
          assert.ok(error instanceof BanzaiError);
          assert.equal(error.code, "INVALID_EVAL_INPUT");
          assert.match(error.message, new RegExp(path.basename(file)));
          return true;
        }
      );
      assert.deepEqual(stdout, []);
      assert.deepEqual(stderr, []);
    }
  } finally {
    await rm(inputRoot, { recursive: true, force: true });
  }
});

test("checkout kpis derive in memory under the current label without mutating run state or export bytes", async () => {
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
        }
      }),
      attempts: [
        evaluationAttemptFixture({ id: "attempt-1", kind: "implementation" })
      ]
    });
    const runsRoot = path.join(root, ".banzai", "runs");
    const before = await snapshotTree(runsRoot);
    const exportBefore = await exportedJson(root);

    const markdown = collectIo();
    await executeEvaluationKpiFromCheckout(
      root,
      parseEvaluationKpiArgs([]),
      markdown.io
    );
    assert.equal(markdown.stdout.length, 1);
    const rendered = markdown.stdout.join("");
    assert.match(rendered, /\| 1 \| current \| 1 \|/);
    assert.match(rendered, /\| Row \| current \|/);
    assert.match(rendered, /## completion_rate \(rate\)/);
    assert.deepEqual(markdown.stderr, []);

    const repeat = collectIo();
    await executeEvaluationKpiFromCheckout(
      root,
      parseEvaluationKpiArgs([]),
      repeat.io
    );
    assert.equal(repeat.stdout.join(""), rendered);

    const json = collectIo();
    await executeEvaluationKpiFromCheckout(
      root,
      parseEvaluationKpiArgs(["--json"]),
      json.io
    );
    const document = JSON.parse(json.stdout.join("")) as {
      schema: string;
      sources: { label: string; includedRunCount: number }[];
    };
    assert.equal(document.schema, "banzai-evaluation-kpi/v1");
    assert.deepEqual(
      document.sources.map((source) => source.label),
      ["current"]
    );

    assert.deepEqual(await snapshotTree(runsRoot), before);
    assert.equal(await exportedJson(root), exportBefore);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
