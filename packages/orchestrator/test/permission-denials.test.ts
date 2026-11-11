import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { projectAgentControlStatus } from "../src/agent-control.js";
import { ProcessExitError } from "../src/errors.js";
import type { RunEvent } from "../src/store.js";
import type {
  PermissionDenial,
  ProcessResult,
  ProgressEvent
} from "../src/types.js";
import { WorkflowRunner } from "../src/workflow.js";
import { createTestRepository } from "./helpers.js";
import { FakeAdapters, selectionResult } from "./workflow-fixtures.js";

const exec = promisify(execFile);
const SECRET = "sk-ant-abcdefghijklmnopqrstuvwxyz";

const DENIALS: PermissionDenial[] = [
  {
    tool: "Bash",
    detail: "npm run lint",
    command: "npm run lint",
    reasonType: "mode",
    subagent: false
  },
  {
    tool: "Bash",
    detail: "npm run lint",
    command: "npm run lint",
    reasonType: "mode",
    subagent: false
  },
  {
    tool: "Bash",
    detail: "deploy --token …",
    command: null,
    reasonType: "mode",
    subagent: true
  }
];

const FAILED_PROCESS: ProcessResult = {
  exitCode: 1,
  signal: null,
  stdout: "",
  stderr: "",
  startedAt: "2026-01-01T00:00:00.000Z",
  completedAt: "2026-01-01T00:00:01.000Z"
};

async function runEvents(
  runner: WorkflowRunner,
  runId: string
): Promise<RunEvent[]> {
  const contents = await readFile(
    path.join(runner.store.runDirectory(runId), "events.jsonl"),
    "utf8"
  );
  return contents
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RunEvent);
}

function infoMessages(progress: readonly ProgressEvent[]): string[] {
  return progress.flatMap((event) =>
    event.kind === "info" ? [event.message] : []
  );
}

/** A quick-fix run whose implementation attempt reports `denials`. */
async function quickFixRun(denials: PermissionDenial[] | null) {
  const repository = await createTestRepository();
  const adapters = new FakeAdapters();
  adapters.selectionResults.push(
    selectionResult({
      recommendedWorkflow: "quick-fix",
      reason: "This corrects existing behavior."
    })
  );
  if (denials !== null) {
    const runPhase = adapters.runPhase.bind(adapters);
    adapters.runPhase = async (request) => ({
      ...(await runPhase(request)),
      permissionDenials: denials
    });
  }
  const progress: ProgressEvent[] = [];
  const runner = new WorkflowRunner(
    repository.root,
    adapters,
    undefined,
    (event) => progress.push(event)
  );
  const state = await runner.start({
    slug: "small-fix",
    request: "Fix the existing label."
  });
  return { repository, runner, state, progress };
}

test("an attempt with denied calls records one event and reports the list without changing its outcome", async () => {
  const { repository, runner, state, progress } = await quickFixRun(DENIALS);
  try {
    assert.equal(state.status, "done", state.blockReason ?? "");
    const events = (await runEvents(runner, state.runId)).filter(
      (event) => event.type === "attempt.permission_denials"
    );
    assert.equal(events.length, 1);
    const attempts = await runner.store.readRunAttempts(state.runId);
    const implementation = attempts.find(
      (record) => record.attempt.kind === "implementation"
    );
    assert.ok(implementation);
    assert.deepEqual(events[0]?.details, {
      attemptId: implementation.attempt.id,
      kind: "implementation",
      count: 3,
      denials: DENIALS
    });
    const messages = infoMessages(progress);
    const heading = messages.indexOf(
      "Claude denied 3 tool calls during implementation:"
    );
    assert.notEqual(heading, -1, messages.join("\n"));
    assert.deepEqual(messages.slice(heading + 1, heading + 3), [
      "  - Bash: npm run lint (2 times)",
      "  - Bash: deploy --token … (subagent; needs a hand-written rule)"
    ]);
    assert.ok(messages.includes('        "Bash(npm run lint)"'));
    assert.ok(messages.includes("Banzai never writes permission rules."));
    // A finished run has nothing left to remediate.
    assert.deepEqual(await runner.permissionDenialReport(state), []);
  } finally {
    await repository.dispose();
  }
});

test("an attempt without denied calls records no event and reports nothing new", async () => {
  for (const denials of [null, []]) {
    const { repository, runner, state, progress } = await quickFixRun(denials);
    try {
      assert.equal(state.status, "done", state.blockReason ?? "");
      assert.equal(
        (await runEvents(runner, state.runId)).some(
          (event) => event.type === "attempt.permission_denials"
        ),
        false
      );
      assert.equal(
        infoMessages(progress).some((message) => /denied/i.test(message)),
        false
      );
    } finally {
      await repository.dispose();
    }
  }
});

/** A strict run blocked by a failed implementation process. */
async function blockedRun(denials: PermissionDenial[]) {
  const repository = await createTestRepository();
  const adapters = new FakeAdapters();
  adapters.implementationErrors.push(
    new ProcessExitError(
      "CLAUDE_PHASE_FAILED",
      "Claude exited 1: no diagnostic",
      FAILED_PROCESS,
      { failureCause: "unclassified", permissionDenials: denials }
    )
  );
  const progress: ProgressEvent[] = [];
  const runner = new WorkflowRunner(
    repository.root,
    adapters,
    undefined,
    (event) => progress.push(event)
  );
  await runner.start({ slug: "example", request: "Implement it." });
  const blocked = await runner.approvePlan("human");
  assert.equal(blocked.status, "blocked");
  return { repository, runner, blocked, progress };
}

test("a failed attempt with denied calls is recorded, reported and shown in status, with unchanged retry authority", async () => {
  const withDenials = await blockedRun(DENIALS);
  const without = await blockedRun([]);
  try {
    const { runner, blocked, progress } = withDenials;
    const events = (await runEvents(runner, blocked.runId)).filter(
      (event) => event.type === "attempt.permission_denials"
    );
    assert.equal(events.length, 1);
    const [event] = events;
    assert.ok(event);
    assert.ok(blocked.activeAttempt);
    assert.equal(event.details.kind, "implementation");
    assert.equal(event.details.attemptId, blocked.activeAttempt.id);
    assert.ok(
      infoMessages(progress).includes(
        "Claude denied 3 tool calls during implementation:"
      )
    );

    const report = await runner.permissionDenialReport(blocked);
    assert.equal(
      report[0],
      "Claude denied 3 tool calls during implementation:"
    );
    assert.equal(report.at(-1), "Banzai never writes permission rules.");

    // The same failure without denials blocks, retries and recovers alike.
    const status = await runner.status();
    const control = await without.runner.status();
    assert.equal(blocked.blockReason, without.blocked.blockReason);
    assert.equal(blocked.blockedFrom, without.blocked.blockedFrom);
    assert.equal(status.retry.eligible, control.retry.eligible);
    assert.equal(status.retry.reason, control.retry.reason);
    assert.equal(status.recovery.eligible, control.recovery.eligible);
    assert.deepEqual(
      await without.runner.permissionDenialReport(without.blocked),
      []
    );
  } finally {
    await withDenials.repository.dispose();
    await without.repository.dispose();
  }
});

test("machine-readable status is identical with and without the denial event", async () => {
  const { repository, runner, blocked } = await blockedRun([]);
  try {
    const project = async () => {
      const status = await runner.status();
      return JSON.stringify({
        status,
        control: projectAgentControlStatus(status)
      });
    };
    const before = await project();
    await runner.store.appendEvent(
      blocked.runId,
      "attempt.permission_denials",
      {
        attemptId: blocked.activeAttempt?.id,
        kind: "implementation",
        count: 1,
        denials: [
          {
            tool: "Bash",
            detail: "npm run only-in-the-event",
            command: "npm run only-in-the-event",
            reasonType: "mode",
            subagent: false
          }
        ]
      }
    );
    const after = await project();
    assert.equal(after, before);
    assert.equal(after.includes("only-in-the-event"), false);
    assert.equal(
      (await runner.permissionDenialReport(blocked))[1],
      "  - Bash: npm run only-in-the-event"
    );
  } finally {
    await repository.dispose();
  }
});

test("status ignores a denial event of an earlier attempt and a damaged events file", async () => {
  const { repository, runner, blocked } = await blockedRun([]);
  try {
    await runner.store.appendEvent(
      blocked.runId,
      "attempt.permission_denials",
      {
        attemptId: "plan-1-00000000",
        kind: "plan",
        count: 1,
        denials: DENIALS.slice(0, 1)
      }
    );
    assert.deepEqual(await runner.permissionDenialReport(blocked), []);
    await runner.store.appendEvent(
      blocked.runId,
      "attempt.permission_denials",
      {
        attemptId: blocked.activeAttempt?.id,
        kind: "implementation",
        count: "damaged"
      }
    );
    assert.deepEqual(await runner.permissionDenialReport(blocked), []);
  } finally {
    await repository.dispose();
  }
});

test("a secret never reaches the denial event or the report", async () => {
  // The adapter already drops credential-shaped commands; the runner still
  // redacts whatever a caller hands it before persisting or printing.
  const { repository, runner, state, progress } = await quickFixRun([
    {
      tool: "Bash",
      detail: `echo ${SECRET}`,
      command: `echo ${SECRET}`,
      reasonType: "mode",
      subagent: false
    }
  ]);
  try {
    const events = await readFile(
      path.join(runner.store.runDirectory(state.runId), "events.jsonl"),
      "utf8"
    );
    assert.equal(events.includes(SECRET), false);
    assert.equal(infoMessages(progress).join("\n").includes(SECRET), false);
    assert.ok(
      infoMessages(progress).includes(
        "Claude denied 1 tool call during implementation:"
      )
    );
  } finally {
    await repository.dispose();
  }
});

test("the built CLI shows the denied calls in human status and never in JSON status", async () => {
  const { repository, runner, blocked } = await blockedRun(DENIALS);
  try {
    const report = await runner.permissionDenialReport(blocked);
    assert.ok(report.length > 0);
    const cli = async (...args: string[]): Promise<string> =>
      (
        await exec(
          process.execPath,
          [path.resolve("dist/banzai.mjs"), ...args],
          {
            cwd: repository.root
          }
        )
      ).stdout;
    const human = await cli("status");
    for (const line of report) {
      assert.ok(human.includes(line), `${line}\n${human}`);
    }
    assert.ok(human.indexOf("Blocked") < human.indexOf(report[0] ?? ""));
    const json = await cli("status", "--json");
    assert.deepEqual(
      Object.keys(JSON.parse(json) as Record<string, unknown>),
      Object.keys(await runner.status())
    );
    for (const text of ["Claude denied", "npm run lint", "permissions"]) {
      assert.equal(json.includes(text), false, text);
    }
  } finally {
    await repository.dispose();
  }
});
