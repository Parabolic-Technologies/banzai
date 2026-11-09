import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  AttemptReference,
  PersistedPhaseResult,
  ResultDigestEvidence,
  RunState
} from "../../../src/types.js";
import { evidenceDigest } from "../../../src/verification-evidence.js";
import {
  completionPlanPath,
  validateImplementationCompletion,
  validatePlanningResult
} from "../../../src/workflow/completion/plan-tasks.js";
import { recordingContext } from "../context-fixture.js";

const PLAN_ATTEMPT: AttemptReference = {
  id: "plan-1-abcdef12",
  kind: "plan",
  mutable: true
};

test("completion validation needs an identifiable approved plan", () => {
  assert.throws(
    () => completionPlanPath({ planArtifacts: null } as unknown as RunState),
    {
      code: "PLAN_TASK_COMPLETION_INVALID",
      violation: "approved_plan_invalid",
      message: "Strict completion validation cannot identify the approved plan."
    }
  );
});

test("implementation completion needs an approved plan bundle", async () => {
  const { context, calls } = recordingContext({});
  await assert.rejects(
    validateImplementationCompletion(
      context,
      { planApproval: null } as unknown as RunState,
      { id: "implementation-1-x", kind: "implementation", mutable: true },
      {} as PersistedPhaseResult
    ),
    {
      code: "PLAN_TASK_COMPLETION_INVALID",
      violation: "approval_invalid",
      message: "Strict completion validation requires an approved plan bundle."
    }
  );
  assert.deepEqual(calls, []);
});

test("an unreadable planning artifact is an invalid approved plan", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-plan-tasks-"));
  try {
    const { context, calls } = recordingContext({}, root);
    const error = await validatePlanningResult(
      context,
      { verificationMode: "task" } as unknown as RunState,
      PLAN_ATTEMPT,
      {
        gate: "plan_approval",
        artifacts: { plan: "missing/plan.md" }
      } as unknown as PersistedPhaseResult
    ).then(
      () => null,
      (reason: unknown) => reason
    );
    assert.ok(error instanceof Error);
    assert.equal(
      (error as { code?: unknown }).code,
      "PLAN_TASK_COMPLETION_INVALID"
    );
    assert.equal(
      (error as { violation?: unknown }).violation,
      "approved_plan_invalid"
    );
    assert.match(error.message, /^The planning artifact could not be read: /);
    assert.deepEqual(calls, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const ZEROS = "0".repeat(64);
const PLAN_FILE = "plan.md";
const TASK = "- [ ] **T001 - Implement the fixture**";
const BODY = `# Plan\n\n## Implementation Tasks\n\n${TASK}\n`;

function inventory(declared: string, checks: unknown[] = []): string {
  return (
    "```banzai-verification-obligations/v2\n" +
    JSON.stringify({
      schema: "banzai-verification-obligations/v2",
      schemaVersion: 2,
      complete: true,
      planRemainderSha256: declared,
      checks,
      absenceReason: checks.length ? null : "Verified by inspection."
    }) +
    "\n```\n"
  );
}

function planWith(declared: string, body = BODY): string {
  return body + inventory(declared);
}

const correctDigest = (body = BODY) => evidenceDigest(`${body}\n`);

const REQUEST_APPROVAL = {
  gate: "plan_approval",
  artifacts: { plan: PLAN_FILE }
} as unknown as PersistedPhaseResult;

async function inTemporaryRoot(
  run: (root: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-plan-tasks-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const TASK_STATE = {
  runId: "run",
  verificationMode: "task"
} as unknown as RunState;

test("the runner records the remainder digest before it writes, changing only that value", async () => {
  for (const declared of [ZEROS, "a".repeat(64)])
    await inTemporaryRoot(async (root) => {
      const file = path.join(root, PLAN_FILE);
      const planner = planWith(declared);
      await writeFile(file, planner);
      let duringRecord: string | null = null;
      let recorded: ResultDigestEvidence | null = null;
      const { context } = recordingContext(
        {
          establishResultDigestEvidence: async (
            _runId: string,
            evidence: ResultDigestEvidence
          ) => {
            duringRecord = await readFile(file, "utf8");
            recorded = evidence;
            return evidence;
          }
        },
        root
      );
      await validatePlanningResult(
        context,
        TASK_STATE,
        PLAN_ATTEMPT,
        REQUEST_APPROVAL
      );
      assert.equal(duringRecord, planner, "evidence precedes the write");
      const digest = correctDigest();
      assert.equal(
        await readFile(file, "utf8"),
        planner.replace(declared, digest)
      );
      assert.deepEqual(recorded, {
        schema: "banzai-result-digest-evidence/v2",
        schemaVersion: 2,
        runId: "run",
        attempt: { id: PLAN_ATTEMPT.id, kind: "plan" },
        outcome: "accepted",
        comparisons: [
          {
            role: "binding",
            field: "planRemainderSha256",
            checkId: null,
            path: PLAN_FILE,
            declared,
            observed: digest,
            size: null,
            limit: null,
            matched: false,
            recorded: true
          }
        ]
      });
    });
});

test("a correct declared remainder digest causes no write", async () => {
  await inTemporaryRoot(async (root) => {
    const file = path.join(root, PLAN_FILE);
    const digest = correctDigest();
    await writeFile(file, planWith(digest));
    const { ino } = await lstat(file);
    let recorded: ResultDigestEvidence | null = null;
    const { context } = recordingContext(
      {
        establishResultDigestEvidence: (
          _runId: string,
          evidence: ResultDigestEvidence
        ) => {
          recorded = evidence;
          return evidence;
        }
      },
      root
    );
    await validatePlanningResult(
      context,
      TASK_STATE,
      PLAN_ATTEMPT,
      REQUEST_APPROVAL
    );
    assert.equal((await lstat(file)).ino, ino);
    assert.equal(await readFile(file, "utf8"), planWith(digest));
    assert.deepEqual(
      (recorded as ResultDigestEvidence | null)?.comparisons.map(
        ({ declared, observed, matched, recorded: runnerRecorded }) => ({
          declared,
          observed,
          matched,
          recorded: runnerRecorded
        })
      ),
      [{ declared: digest, observed: digest, matched: true, recorded: false }]
    );
  });
});

const NON_UTF8 = Buffer.concat([
  Buffer.from(`# Plan \xff\n\n## Implementation Tasks\n\n${TASK}\n`, "latin1"),
  Buffer.from(inventory(ZEROS))
]);

const REFUSED_PLANS: {
  name: string;
  arrange: (file: string) => Promise<void>;
  code?: string;
  message: RegExp;
}[] = [
  {
    name: "a missing plan",
    arrange: async () => {},
    message: /^The planning artifact could not be read: plan\.md is missing\.$/u
  },
  {
    name: "a symlinked plan",
    arrange: async (file) => {
      await writeFile(`${file}.real`, planWith(ZEROS));
      await symlink(`${file}.real`, file);
    },
    message: /plan\.md is a symbolic link/u
  },
  {
    name: "a plan that is not a regular file",
    arrange: async (file) => {
      await mkdir(file);
    },
    message: /plan\.md is not a regular file/u
  },
  {
    name: "a plan that is not valid UTF-8",
    arrange: async (file) => {
      await writeFile(file, NON_UTF8);
    },
    message: /plan\.md is not valid UTF-8/u
  },
  {
    name: "a duplicated inventory",
    arrange: async (file) => {
      await writeFile(file, planWith(ZEROS) + inventory(ZEROS));
    },
    message: /exactly one v2 verification inventory/u
  },
  {
    name: "a malformed inventory",
    arrange: async (file) => {
      await writeFile(
        file,
        `${BODY}\`\`\`banzai-verification-obligations/v2\n{\n\`\`\`\n`
      );
    },
    message: /Malformed task verification inventory/u
  },
  {
    name: "an invalid descriptor",
    arrange: async (file) => {
      await writeFile(file, BODY + inventory(ZEROS, [{ id: "incomplete" }]));
    },
    message: /could not be read/u
  },
  {
    name: "a check that overrides a fresh commitment",
    arrange: async (file) => {
      await writeFile(
        file,
        `# Plan\n\nRerun it.\n\n## Implementation Tasks\n\n${TASK}\n` +
          inventory(ZEROS, [
            {
              id: "unit",
              name: "Unit",
              requirementRefs: ["FR1"],
              command: "node",
              args: ["test.js"],
              cwd: ".",
              timeoutMs: 1000,
              evidence: "equivalent_evidence",
              sources: [],
              materialization: null
            }
          ])
      );
    },
    message: /Equivalent evidence cannot override fresh plan commitments/u
  },
  {
    name: "a task heading outside the grammar",
    arrange: async (file) => {
      await writeFile(
        file,
        planWith(ZEROS, BODY.replace(TASK, `${TASK} (see notes)`))
      );
    },
    message: /malformed task heading/u
  },
  {
    name: "a task that writes runner control state",
    arrange: async (file) => {
      await writeFile(
        file,
        planWith(ZEROS, `${BODY}  Write \`.banzai/config.json\`.\n`)
      );
    },
    code: "PLAN_RUNNER_CONTROL_TASK",
    message: /T001.*runner control path/u
  }
];

for (const { name, arrange, code, message } of REFUSED_PLANS)
  test(`acceptance refuses ${name}, records nothing and leaves the bytes alone`, async () => {
    await inTemporaryRoot(async (root) => {
      const file = path.join(root, PLAN_FILE);
      await arrange(file);
      const read = async () =>
        await readFile(file).catch(() => Buffer.from("absent"));
      const before = await read();
      const { context, calls } = recordingContext({}, root);
      await assert.rejects(
        validatePlanningResult(
          context,
          TASK_STATE,
          PLAN_ATTEMPT,
          REQUEST_APPROVAL
        ),
        (error: Error & { code?: string; violation?: string }) => {
          assert.equal(error.code, code ?? "PLAN_TASK_COMPLETION_INVALID");
          if (code === undefined)
            assert.equal(error.violation, "approved_plan_invalid");
          assert.match(error.message, message);
          return true;
        }
      );
      assert.deepEqual(calls, []);
      assert.deepEqual(await read(), before);
    });
  });

test("a plan that changes during acceptance keeps the changed bytes and fails naming its path", async () => {
  await inTemporaryRoot(async (root) => {
    const file = path.join(root, PLAN_FILE);
    await writeFile(file, planWith(ZEROS));
    const changed = planWith(ZEROS, `${BODY}\nA concurrent edit.\n`);
    const { context } = recordingContext(
      {
        establishResultDigestEvidence: async (
          _runId: string,
          evidence: ResultDigestEvidence
        ) => {
          await writeFile(file, changed);
          return evidence;
        }
      },
      root
    );
    await assert.rejects(
      validatePlanningResult(
        context,
        TASK_STATE,
        PLAN_ATTEMPT,
        REQUEST_APPROVAL
      ),
      {
        code: "PLAN_TASK_COMPLETION_INVALID",
        violation: "approved_plan_invalid",
        message:
          "plan.md changed while Banzai was recording its remainder digest. Nothing was written; retry planning."
      }
    );
    assert.equal(await readFile(file, "utf8"), changed);
  });
});

test("a run without task verification keeps its plan bytes and records no digest", async () => {
  await inTemporaryRoot(async (root) => {
    const file = path.join(root, PLAN_FILE);
    await writeFile(file, planWith(ZEROS));
    const { context, calls } = recordingContext({}, root);
    await validatePlanningResult(
      context,
      { runId: "run", verificationMode: "ordered" } as unknown as RunState,
      PLAN_ATTEMPT,
      REQUEST_APPROVAL
    );
    assert.deepEqual(calls, []);
    assert.equal(await readFile(file, "utf8"), planWith(ZEROS));
  });
});
