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
}): DoctorReport {
  const warning = options?.warning ?? false;
  const ready = options?.ready ?? true;
  const checks: DoctorReport["checks"] = [
    {
      id: "repository.git",
      category: "repository",
      status: ready ? "pass" : "fail",
      message: ready ? "Git is ready." : "Git is unavailable."
    }
  ];
  if (warning) {
    checks.push({
      id: "run.lock",
      category: "run-state",
      status: "warning",
      message: "A stale lock is present."
    });
  }
  return {
    schema: "banzai-doctor/v2",
    schemaVersion: 2,
    ready,
    projectTypes: ["node"],
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
    "summary",
    "checks"
  ]);

  const text = renderDoctorText(value);
  assert.match(text, /^Banzai doctor: READY\nProject types: node\nChecks:/);
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
