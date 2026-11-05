import assert from "node:assert/strict";
import test from "node:test";
import { BanzaiError } from "../src/errors.js";
import {
  executeDoctor,
  parseDoctorArgs,
  renderDoctorJson,
  renderDoctorText
} from "../src/doctor-cli.js";
import type { DoctorReport } from "../src/doctor.js";

function report(options?: {
  ready?: boolean;
  warning?: boolean;
  models?: DoctorReport["models"];
}): DoctorReport {
  const warning = options?.warning ?? false;
  const ready = options?.ready ?? true;
  const checks: DoctorReport["checks"] = [
    {
      id: "repository.git",
      category: "repository",
      status: ready ? "pass" : "fail",
      message: ready ? "Git is ready." : "Git is unavailable.",
      fixes: [],
      roles: []
    }
  ];
  if (warning) {
    checks.push({
      id: "run.lock",
      category: "run-state",
      status: "warning",
      message: "A stale lock is present.",
      fixes: [],
      roles: []
    });
  }
  return {
    schema: "banzai-doctor/v6",
    schemaVersion: 6,
    ready,
    projectTypes: ["node"],
    models: options?.models ?? [
      {
        role: "planner",
        vendor: "codex",
        model: "gpt-5.5",
        effort: "xhigh",
        source: "committed"
      },
      {
        role: "implementer",
        vendor: "codex",
        model: "gpt-5.5",
        effort: "high",
        source: "committed"
      },
      {
        role: "reviewer",
        vendor: "claude",
        model: "claude-opus-5-5",
        effort: "xhigh",
        source: "local"
      }
    ],
    summary: {
      passed: ready ? 1 : 0,
      warnings: warning ? 1 : 0,
      failed: ready ? 0 : 1,
      skipped: 0
    },
    checks
  };
}

test("parses the exact doctor option contract", () => {
  assert.deepEqual(parseDoctorArgs([]), { format: "text" });
  assert.deepEqual(parseDoctorArgs(["--json"]), { format: "json" });
  for (const args of [
    ["--json", "--json"],
    ["--help"],
    ["--json", "--help"],
    ["--json=value"],
    ["--unknown"],
    ["positional"]
  ]) {
    assert.throws(
      () => parseDoctorArgs(args),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "INVALID_DOCTOR_OPTION"
    );
  }
});

test("renders canonical JSON and deterministic text from one report", () => {
  const value = report({ warning: true });
  const json = renderDoctorJson(value);
  assert.equal(json, `${JSON.stringify(value, null, 2)}\n`);
  assert.equal(renderDoctorJson(value), json);
  assert.deepEqual(Object.keys(JSON.parse(json) as object), [
    "schema",
    "schemaVersion",
    "ready",
    "projectTypes",
    "models",
    "summary",
    "checks"
  ]);
  for (const model of (JSON.parse(json) as DoctorReport).models) {
    assert.deepEqual(Object.keys(model), [
      "role",
      "vendor",
      "model",
      "effort",
      "source"
    ]);
  }

  const text = renderDoctorText(value);
  assert.match(
    text,
    /^Banzai doctor: READY\nProject types: node\nModels:\n {2}planner: codex gpt-5\.5 effort=xhigh \(committed\)\n {2}implementer: codex gpt-5\.5 effort=high \(committed\)\n {2}reviewer: claude claude-opus-5-5 effort=xhigh \(local\)\nChecks:\n/
  );
  assert.match(text, /\[PASS\] repository\.git \(repository\): Git is ready\./);
  assert.match(
    text,
    /\[WARNING\] run\.lock \(run-state\): A stale lock is present\./
  );
  assert.match(text, /Summary: passed=1, warnings=1, failed=0, skipped=0\n$/);
  assert.equal(renderDoctorText(value), text);
});

test("writes one clean report and returns readiness as the exit code", async () => {
  for (const item of [
    { args: [] as string[], value: report({ warning: true }), exitCode: 0 },
    { args: ["--json"], value: report({ ready: false }), exitCode: 1 }
  ]) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await executeDoctor(
      "/repository",
      item.args,
      {
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value)
      },
      async () => item.value
    );
    assert.equal(exitCode, item.exitCode);
    assert.equal(stdout.length, 1);
    assert.deepEqual(stderr, []);
    if (item.args.includes("--json")) {
      assert.deepEqual(JSON.parse(stdout[0] ?? ""), item.value);
    }
  }
});

test("rejects arguments before inspection or output", async () => {
  let inspected = false;
  const stdout: string[] = [];
  const stderr: string[] = [];
  await assert.rejects(
    executeDoctor(
      "/repository",
      ["--unknown"],
      {
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value)
      },
      async () => {
        inspected = true;
        return report();
      }
    ),
    (error: unknown) =>
      error instanceof BanzaiError && error.code === "INVALID_DOCTOR_OPTION"
  );
  assert.equal(inspected, false);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, []);
});

test("prints other, unlisted and unavailable models and escapes every model value", () => {
  const hostile = "evil\u001b[31m\tmodel\nnext\u202e";
  const text = renderDoctorText(
    report({
      models: [
        {
          role: "planner",
          vendor: null,
          model: null,
          effort: "medium",
          source: "committed"
        },
        {
          role: "implementer",
          vendor: "codex",
          model: hostile,
          effort: "high",
          source: "local"
        },
        {
          role: "reviewer",
          vendor: "claude",
          model: "claude-opus-5-5",
          effort: "xhigh",
          source: "committed"
        }
      ]
    })
  );
  const lines = text.split("\n");
  const start = lines.indexOf("Models:");
  assert.equal(lines[start - 1], "Project types: node");
  assert.deepEqual(lines.slice(start, start + 5), [
    "Models:",
    "  planner: other unlisted effort=medium (committed)",
    "  implementer: codex evil\\u001b[31m\\u0009model\\u000anext\\u202e effort=high (local)",
    "  reviewer: claude claude-opus-5-5 effort=xhigh (committed)",
    "Checks:"
  ]);
  assert.doesNotMatch(text, /\u001b|\t|\u202e/);
  assert.equal(text.includes("model\nnext"), false);

  const unavailable = renderDoctorText(report({ models: [] }));
  assert.match(
    unavailable,
    /\nProject types: node\nModels: unavailable\nChecks:\n/
  );
  assert.deepEqual(
    (JSON.parse(renderDoctorJson(report({ models: [] }))) as DoctorReport)
      .models,
    []
  );
});

test("escapes terminal controls in check messages and fixes", () => {
  const value = report();
  value.checks.push({
    id: "claude.plugin-scope",
    category: "config",
    status: "warning",
    message: "Settings at /home/\u001b]0;title\u0007user enable Banzai.",
    fixes: [
      {
        action: "Run \u009b2Jcleanup.",
        documentation: "documentation/getting-started.md"
      }
    ],
    roles: []
  });
  const text = renderDoctorText(value);
  assert.doesNotMatch(text, /[\u0007\u001b\u009b]/);
  assert.match(text, /Settings at \/home\/\\u001b\]0;title\\u0007user/);
  assert.match(text, /Fix: Run \\u009b2Jcleanup\./);
});
