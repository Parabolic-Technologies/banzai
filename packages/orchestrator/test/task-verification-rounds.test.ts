/**
 * ADR-0057: a task verification round runs every check after command-level
 * failures, stops on everything else, and one retry action reruns the whole
 * round's unsuccessful checks.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runProcess, subscriptionOnlyEnvironment } from "../src/process.js";
import {
  evidenceDigest,
  executeTaskVerification,
  readTaskVerificationAttempts,
  selectTaskVerification
} from "../src/verification-evidence.js";
import type {
  TaskVerificationAttempt,
  TaskVerificationAuthority,
  TaskVerificationContext,
  TaskVerificationDescriptor
} from "../src/verification-evidence.js";
import { createTestRepository, createTestWork } from "./helpers.js";

type Outcome = Pick<
  TaskVerificationAttempt,
  "status" | "failureCategory" | "signal" | "exitCode"
>;

const PASS: Outcome = {
  status: "completed",
  failureCategory: null,
  signal: null,
  exitCode: 0
};
const EXIT: Outcome = {
  status: "failed",
  failureCategory: "command_exit",
  signal: null,
  exitCode: 1
};

const context: TaskVerificationContext = {
  kind: "inherited-local",
  invocationDigest: evidenceDigest("authorized local invocation"),
  restrictions: []
};

function descriptor(id: string): TaskVerificationDescriptor {
  return {
    id,
    name: `Check ${id}`,
    requirementRefs: ["FR1"],
    command: process.execPath,
    args: ["-e", "0"],
    cwd: ".",
    timeoutMs: 1000,
    evidence: "fresh",
    sources: [],
    materialization: null
  };
}

/**
 * Three required checks whose outcomes the test sets per check; invoke
 * records each launch instead of starting a process.
 */
async function round(ids: readonly string[] = ["a", "b", "c"]) {
  const { root } = await createTestRepository({ artifactLayout: null });
  const workId = randomUUID();
  const storage = {
    repoRoot: root,
    directory: `.banzai/work/${workId}/verification`,
    workId
  };
  const authority: TaskVerificationAuthority = {
    workId,
    sourceAttemptId: "implementation-1",
    workflow: "feature",
    taskDigest: evidenceDigest("Add checks"),
    selectionDigest: evidenceDigest("feature selection"),
    approvalDigest: null,
    contextDigest: evidenceDigest(context)
  };
  const outcomes = new Map<string, Outcome>(ids.map((id) => [id, PASS]));
  const launches: string[] = [];
  const effects = new Map<string, () => Promise<void>>();
  const input = {
    ...storage,
    roundId: randomUUID(),
    selection: selectTaskVerification({
      required: ids.map(descriptor),
      candidates: null
    }),
    authority,
    context,
    policy: null,
    revalidate: async () => {},
    invoke: async (check: TaskVerificationDescriptor) => {
      launches.push(check.id);
      await effects.get(check.id)?.();
      const outcome = outcomes.get(check.id) ?? PASS;
      return {
        ...outcome,
        status: outcome.status as "completed" | "failed" | "interrupted",
        stdout: "",
        stderr: outcome.status === "completed" ? "" : `${check.id} failed`,
        completedAt: new Date().toISOString()
      };
    }
  };
  return {
    root,
    storage,
    input,
    outcomes,
    launches,
    effects,
    dispose: () => rm(root, { recursive: true, force: true })
  };
}

const kinds = (
  publication: Awaited<ReturnType<typeof executeTaskVerification>>
) => publication.applicability.dispositions.map((item) => item.kind);

test("three required checks all run when the first one exits non-zero", async () => {
  const r = await round();
  try {
    r.outcomes.set("a", EXIT);
    const result = await executeTaskVerification(r.input);
    assert.deepEqual(r.launches, ["a", "b", "c"]);
    assert.deepEqual(kinds(result), ["failed", "passed", "passed"]);
    assert.equal(result.applicability.complete, false);
    assert.equal(result.attempts.length, 3);
  } finally {
    await r.dispose();
  }
});

test("command-level outcomes continue the round in runner and helper shapes", async () => {
  const continuing: [string, Outcome][] = [
    ["non-zero exit", EXIT],
    [
      "unavailable executable",
      {
        status: "failed",
        failureCategory: "process_start",
        signal: null,
        exitCode: null
      }
    ],
    [
      "helper timeout",
      {
        status: "failed",
        failureCategory: "timeout",
        signal: "SIGTERM",
        exitCode: null
      }
    ],
    [
      "runner timeout",
      {
        status: "interrupted",
        failureCategory: "timeout",
        signal: "SIGTERM",
        exitCode: 1
      }
    ],
    [
      "helper output limit",
      {
        status: "failed",
        failureCategory: "output_limit",
        signal: "SIGTERM",
        exitCode: null
      }
    ],
    [
      "runner output limit",
      {
        status: "interrupted",
        failureCategory: "output_limit",
        signal: "SIGTERM",
        exitCode: 1
      }
    ]
  ];
  for (const [label, outcome] of continuing) {
    const r = await round(["a", "b"]);
    try {
      r.outcomes.set("a", outcome);
      await executeTaskVerification(r.input);
      assert.deepEqual(r.launches, ["a", "b"], label);
    } finally {
      await r.dispose();
    }
  }
});

test("a signal, a runner failure or a cancellation stops the round", async () => {
  const stopping: [string, Outcome][] = [
    [
      "runner signal",
      {
        status: "interrupted",
        failureCategory: "command_exit",
        signal: "SIGINT",
        exitCode: 1
      }
    ],
    [
      "helper signal",
      {
        status: "failed",
        failureCategory: "command_exit",
        signal: "SIGKILL",
        exitCode: null
      }
    ],
    [
      "runner failure",
      {
        status: "interrupted",
        failureCategory: "runner_failure",
        signal: null,
        exitCode: null
      }
    ],
    [
      "cancellation at launch",
      {
        status: "interrupted",
        failureCategory: "process_start",
        signal: null,
        exitCode: null
      }
    ]
  ];
  for (const [label, outcome] of stopping) {
    const r = await round(["a", "b"]);
    try {
      r.outcomes.set("a", outcome);
      const result = await executeTaskVerification(r.input);
      assert.deepEqual(r.launches, ["a"], label);
      assert.equal(kinds(result)[1], "not_run", label);
    } finally {
      await r.dispose();
    }
  }
});

test("a fail-closed revalidation failure still stops before the next launch", async () => {
  const r = await round(["a", "b"]);
  try {
    r.outcomes.set("a", EXIT);
    let calls = 0;
    await assert.rejects(
      executeTaskVerification({
        ...r.input,
        // The opening revalidation and the first launch pass; the second fails.
        revalidate: async () => {
          if (++calls === 3) throw new Error("authority changed");
        }
      }),
      /authority changed/
    );
    assert.deepEqual(r.launches, ["a"]);
  } finally {
    await r.dispose();
  }
});

test("a failing check that writes a tracked file is named and stops the round", async () => {
  const r = await round(["a", "b"]);
  try {
    await runProcess({
      command: "git",
      args: ["init", "-q"],
      cwd: r.root,
      timeoutMs: 30000,
      env: subscriptionOnlyEnvironment()
    });
    await writeFile(path.join(r.root, "index.js"), "source");
    r.outcomes.set("a", EXIT);
    r.effects.set("a", () =>
      writeFile(path.join(r.root, "index.js"), "rewritten")
    );
    await assert.rejects(
      executeTaskVerification(r.input),
      /Check "a" changed observed project files: "index\.js" \(modified\)\. Keep generated output Git-ignored/
    );
    assert.deepEqual(r.launches, ["a"]);
  } finally {
    await r.dispose();
  }
});

test("one retry set reruns every failed check, links each to its predecessor and keeps passed evidence", async () => {
  const r = await round();
  try {
    r.outcomes.set("a", EXIT);
    r.outcomes.set("b", EXIT);
    const failed = await executeTaskVerification(r.input);
    assert.deepEqual(kinds(failed), ["failed", "failed", "passed"]);
    const [a, b] = failed.attempts;
    assert.ok(a && b);

    // A partial set, an extra identity and a lone retryOf launch nothing.
    for (const partial of [
      { retrySet: [a.id] },
      { retrySet: [a.id, b.id, `verification-${randomUUID()}`] },
      { retryOf: a.id }
    ]) {
      await assert.rejects(
        executeTaskVerification({ ...r.input, ...partial }),
        /every unsuccessful check of this exact task round/
      );
    }
    assert.deepEqual(r.launches, ["a", "b", "c"]);

    r.outcomes.set("a", PASS);
    r.outcomes.set("b", PASS);
    const passed = await executeTaskVerification({
      ...r.input,
      retrySet: [b.id, a.id]
    });
    assert.deepEqual(r.launches, ["a", "b", "c", "a", "b"]);
    assert.equal(passed.applicability.complete, true);
    assert.deepEqual(kinds(passed), ["passed", "passed", "passed"]);
    assert.deepEqual(
      passed.attempts.slice(3).map((item) => [item.checkId, item.retryOf]),
      [
        ["a", a.id],
        ["b", b.id]
      ]
    );
    assert.deepEqual(passed.attempts.slice(0, 3), failed.attempts);
  } finally {
    await r.dispose();
  }
});

test("a retained started attempt still needs reconciliation before any rerun", async () => {
  const r = await round(["a", "b"]);
  try {
    r.outcomes.set("a", EXIT);
    r.effects.set("b", async () => {
      throw new Error("simulated owner exit before result publication");
    });
    await assert.rejects(
      executeTaskVerification(r.input),
      /simulated owner exit/
    );
    const retained = await readTaskVerificationAttempts(r.storage);
    assert.deepEqual(
      retained.map((item) => [item.checkId, item.status]),
      [
        ["a", "failed"],
        ["b", "started"]
      ]
    );
    const [a] = retained;
    assert.ok(a);
    await assert.rejects(
      executeTaskVerification({ ...r.input, retrySet: [a.id] }),
      /owner recovery/
    );
    r.effects.delete("b");
    r.outcomes.set("a", PASS);
    const recovered = await executeTaskVerification({
      ...r.input,
      retrySet: [a.id],
      recoverInterrupted: true
    });
    assert.equal(recovered.applicability.complete, true);
    assert.deepEqual(r.launches, ["a", "b", "a", "b"]);
  } finally {
    await r.dispose();
  }
});

test("the standalone helper keeps v3 and retries a multi-failure round with v4", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  const temp = await mkdtemp(path.join(tmpdir(), "banzai-round-helper-"));
  try {
    const work = await createTestWork({
      repoRoot: repository.root,
      slug: "helper-round",
      mode: "lite",
      creationId: randomUUID()
    });
    const document = work.binding.artifacts.work;
    assert.ok(document);
    await writeFile(
      path.join(repository.root, "gate.cjs"),
      "process.exit(require('node:fs').existsSync('.banzai/ready-' + process.argv[2]) ? 0 : 5)"
    );
    const checks = ["a", "b"].map((id) => ({
      ...descriptor(id),
      args: ["gate.cjs", id]
    }));
    const before = "# Work\n\nRun fresh verification.\n\n";
    const after = "\n\n## Completion\nFulfil FR1.\n";
    await writeFile(
      path.join(repository.root, document),
      before +
        "```banzai-verification-obligations/v2\n" +
        JSON.stringify({
          schema: "banzai-verification-obligations/v2",
          schemaVersion: 2,
          complete: true,
          planRemainderSha256: evidenceDigest(before + after),
          checks,
          absenceReason: null
        }) +
        "\n```" +
        after
    );
    const roundId = randomUUID();
    const helper = async (
      operation: string,
      request: Record<string, unknown>
    ) => {
      const requestPath = path.join(temp, `${randomUUID()}.json`);
      await writeFile(
        requestPath,
        JSON.stringify({
          repoRoot: repository.root,
          documentPath: document,
          workflow: "feature",
          roundId,
          ...request
        }),
        { mode: 0o600 }
      );
      return await runProcess({
        command: process.execPath,
        args: [
          path.resolve("../../plugins/banzai/scripts/verification.cjs"),
          operation,
          "--json",
          requestPath
        ],
        cwd: repository.root,
        env: subscriptionOnlyEnvironment(),
        timeoutMs: 20000
      });
    };
    const v3 = { schema: "banzai-verification-request/v3", schemaVersion: 3 };
    const v4 = { schema: "banzai-verification-request/v4", schemaVersion: 4 };
    // The helper exits non-zero for an incomplete round, so read its envelope.
    const result = (output: { stdout: string; stderr: string }) => {
      const envelope = JSON.parse(output.stdout) as {
        ok: boolean;
        result: {
          physicalAttempts: number;
          applicability: { complete: boolean };
          attempts: TaskVerificationAttempt[];
        };
      };
      assert.equal(envelope.ok, true, output.stdout + output.stderr);
      return envelope.result;
    };
    const refused = (
      output: { stdout: string; stderr: string },
      pattern: RegExp
    ) => {
      const envelope = JSON.parse(output.stdout) as { ok: boolean };
      assert.equal(envelope.ok, false, output.stdout);
      assert.match(output.stdout + output.stderr, pattern);
    };

    const first = result(await helper("execute", v3));
    assert.equal(first.physicalAttempts, 2, "a v3 round runs both checks");
    assert.equal(first.applicability.complete, false);
    const [a, b] = first.attempts;
    assert.ok(a && b);

    // The helper reports evidence refusals by code only.
    for (const request of [
      { ...v3, retryOf: a.id },
      { ...v4, retryOf: [a.id] },
      { ...v4, retryOf: a.id }
    ])
      refused(
        await helper("execute", request),
        /VERIFICATION_EVIDENCE_INVALID/
      );
    assert.equal(result(await helper("inspect", v4)).physicalAttempts, 2);

    await writeFile(path.join(repository.root, ".banzai/ready-a"), "");
    await writeFile(path.join(repository.root, ".banzai/ready-b"), "");
    const retried = result(
      await helper("execute", { ...v4, retryOf: [a.id, b.id] })
    );
    assert.equal(retried.applicability.complete, true);
    assert.deepEqual(
      retried.attempts.slice(2).map((item) => item.retryOf),
      [a.id, b.id]
    );
  } finally {
    await repository.dispose();
    await rm(temp, { recursive: true, force: true });
  }
});
