import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { runInteractive, type InteractiveIO } from "../src/interactive.js";
import { planningPrompt } from "../src/prompts.js";
import type { PlanVerificationInventory } from "../src/types.js";
import type { TaskVerificationDescriptor } from "../src/verification-evidence.js";
import { planVerificationLines } from "../src/verification-ui.js";
import {
  PHPCS_CHECK_IDS,
  phpcsPlanGateFixture
} from "./phpcs-verification-fixture.js";

const exec = promisify(execFile);
const HEADING = "Verification that gates completion:";

/** Records every line and what had been written when the plan decision opened. */
function planGateIO() {
  const lines: string[] = [];
  let beforeDecision: string[] | null = null;
  const io: InteractiveIO = {
    multiSelect: async () => {
      throw new Error("Unexpected multi-select");
    },
    input: async () => {
      throw new Error("Unexpected input");
    },
    confirm: async () => false,
    select: async <T>(
      message: string,
      choices: readonly { name: string; value: T }[]
    ) => {
      if (message === "Plan decision") beforeDecision ??= [...lines];
      const exit = choices.find((choice) => choice.value === "exit");
      assert.ok(exit, message);
      return exit.value;
    },
    writeLine: (line = "") => {
      lines.push(line);
    }
  };
  return { io, lines, beforeDecision: () => beforeDecision };
}

function descriptor(
  overrides: Partial<TaskVerificationDescriptor> = {}
): TaskVerificationDescriptor {
  return {
    id: "unit-tests",
    name: "Unit tests",
    requirementRefs: ["FR1", "FR2"],
    command: "npm",
    args: ["run", "test:unit"],
    cwd: "packages/api",
    timeoutMs: 300_000,
    evidence: "fresh",
    sources: [],
    materialization: null,
    ...overrides
  };
}

test("the plan gate lists every check approval binds before the decision", async () => {
  const f = await phpcsPlanGateFixture();
  try {
    assert.equal(f.state.status, "needs_plan_approval");
    const before = JSON.stringify((await f.runner.status()).state);
    const inventory = await f.runner.planVerificationInventory(f.state);
    assert.ok(inventory);
    const lines = planVerificationLines(inventory);
    // The planned lint command lacks the documented --config flag; the gate
    // shows it before anyone approves the plan.
    assert.deepEqual(lines, [
      HEADING,
      `  ${PHPCS_CHECK_IDS.lint} (required) for FR1 · directory . · timeout 10s`,
      `    Command: ${process.execPath} tools/php-cs-fixer.cjs fix --dry-run --diff`,
      `  ${PHPCS_CHECK_IDS.schema} (required) for FR1 · directory . · timeout 10s`,
      `    Command: ${process.execPath} tools/schema-catalog-check.cjs`
    ]);
    assert.equal(JSON.stringify((await f.runner.status()).state), before);

    const recorded = planGateIO();
    await runInteractive(f.runner, recorded.io, { decidedBy: "human" });
    const shown = recorded.beforeDecision();
    assert.ok(shown, recorded.lines.join("\n"));
    const at = shown.findIndex((line) => line.includes(HEADING));
    assert.notEqual(at, -1, shown.join("\n"));
    assert.deepEqual(shown.slice(at + 1, at + lines.length), lines.slice(1));

    const status = await exec(
      process.execPath,
      [path.resolve("dist/banzai.mjs"), "status"],
      { cwd: f.repository.root }
    );
    const printed = status.stdout.split("\n");
    const start = printed.indexOf(HEADING);
    assert.notEqual(start, -1, status.stdout);
    assert.deepEqual(printed.slice(start, start + lines.length), lines);

    const json = JSON.parse(
      (
        await exec(
          process.execPath,
          [path.resolve("dist/banzai.mjs"), "status", "--json"],
          { cwd: f.repository.root }
        )
      ).stdout
    ) as Record<string, unknown>;
    assert.deepEqual(Object.keys(json), Object.keys(await f.runner.status()));
    assert.ok(!JSON.stringify(json).includes(HEADING));

    // Only a strict run at the plan gate has an inventory to show.
    for (const status of ["implementing", "blocked"] as const)
      assert.equal(
        await f.runner.planVerificationInventory({ ...f.state, status }),
        null
      );
  } finally {
    await f.repository.dispose();
  }
});

test("an inventory that approval would reject shows the same error", async () => {
  const f = await phpcsPlanGateFixture();
  try {
    const plan = f.state.planArtifacts?.plan;
    assert.ok(plan);
    await appendFile(
      path.join(f.repository.root, plan),
      "\nA human edit after planning.\n"
    );
    const inventory = await f.runner.planVerificationInventory(f.state);
    assert.ok(inventory && "error" in inventory, JSON.stringify(inventory));
    assert.match(
      inventory.error,
      /^planRemainderSha256 does not match the plan bytes outside its inventory: declared [a-f0-9]{64}, observed [a-f0-9]{64}\.$/u
    );
    assert.deepEqual(planVerificationLines(inventory), [
      HEADING,
      `  Unavailable: ${inventory.error}`
    ]);
    await assert.rejects(f.runner.approvePlan("human"), (error: Error) =>
      error.message.includes(inventory.error)
    );
    const status = await exec(
      process.execPath,
      [path.resolve("dist/banzai.mjs"), "status"],
      { cwd: f.repository.root }
    );
    assert.ok(
      status.stdout.includes(`  Unavailable: ${inventory.error}`),
      status.stdout
    );
  } finally {
    await f.repository.dispose();
  }
});

test("plan gate lines name future tooling, policy checks and absence, escaped", () => {
  const inventory: PlanVerificationInventory = {
    checks: [
      {
        descriptor: descriptor({
          materialization: { taskRef: "T003", paths: ["tests/unit.test.ts"] }
        }),
        origin: "plan"
      },
      {
        descriptor: descriptor({
          id: "license-scan",
          requirementRefs: ["project rule"],
          command: "/opt/tools/scan",
          args: ["--path", "src dir", "it's", "‮hidden\u0085"],
          cwd: ".",
          timeoutMs: 90_000
        }),
        origin: "policy"
      }
    ],
    absenceReason: null
  };
  assert.deepEqual(planVerificationLines(inventory), [
    HEADING,
    "  unit-tests (required) for FR1, FR2 · directory packages/api · timeout 5m · tooling created by T003",
    "    Command: npm run test:unit",
    "  license-scan (required by project policy) for project rule · directory . · timeout 1m 30s",
    "    Command: /opt/tools/scan --path 'src dir' 'it'\\''s' '\\u202ehidden\\u0085'"
  ]);
  assert.deepEqual(
    planVerificationLines({
      checks: [],
      absenceReason: "Documentation-only change‮."
    }),
    [HEADING, "  None: Documentation-only change\\u202e."]
  );
});

test("the planning instruction asks for documented commands", () => {
  assert.ok(
    planningPrompt("php-module", "Add the PHP module.", []).includes(
      "Build each check from the project's documented command with its configuration flags, preferring a script entry point from the inert project discovery"
    )
  );
});
