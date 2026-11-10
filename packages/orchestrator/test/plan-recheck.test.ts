import assert from "node:assert/strict";
import {
  appendFile,
  chmod,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HumanTimeStore } from "../src/human-time-store.js";
import { validatePlanningReviewState } from "../src/planning-review-state.js";
import { planRecheckLines } from "../src/plan-gate-ui.js";
import type { PlanRecheckRecord, RunState } from "../src/types.js";
import {
  parseTaskVerificationObligations,
  rewritePlanRemainderDigest,
  type TaskVerificationCandidates,
  type TaskVerificationDescriptor
} from "../src/verification-evidence.js";
import {
  markdownSections,
  PLAN_RECHECK_LIMITS,
  planRecheckSummary
} from "../src/workflow/domain/plan-recheck.js";
import { replacePlanBytes } from "../src/workflow/plan-gate/recheck.js";
import { WorkflowRunner } from "../src/workflow.js";
import {
  createTestRepository,
  monochromeEnv,
  snapshotTree
} from "./helpers.js";
import { FakeAdapters } from "./workflow-fixtures.js";
import {
  PHPCS_CHECK_IDS,
  phpcsPlanGateFixture
} from "./phpcs-verification-fixture.js";

type Fixture = Awaited<ReturnType<typeof phpcsPlanGateFixture>>;

const TASK_HEADING = "- [ ] **T001 - Implement the fixture**";

function bundlePaths(f: Fixture): { plan: string; description: string } {
  const artifacts = f.state.planArtifacts;
  assert.ok(artifacts?.plan && artifacts.description);
  return { plan: artifacts.plan, description: artifacts.description };
}

async function readText(f: Fixture, relative: string): Promise<string> {
  return readFile(path.join(f.repository.root, relative), "utf8");
}

async function writeText(
  f: Fixture,
  relative: string,
  text: string
): Promise<void> {
  await writeFile(path.join(f.repository.root, relative), text);
}

/** Every file the runner could write, without Git's own bookkeeping. */
async function tree(f: Fixture) {
  return (await snapshotTree(f.repository.root)).filter(
    (entry) => entry.path !== ".git" && !entry.path.startsWith(".git/")
  );
}

function hasCode(code: string, message?: RegExp) {
  return (error: unknown) => {
    assert.ok(error instanceof Error, String(error));
    assert.equal((error as { code?: unknown }).code, code, error.message);
    if (message !== undefined) assert.match(error.message, message);
    return true;
  };
}

function latestRecheck(state: RunState): PlanRecheckRecord {
  const record = state.humanDecisions?.at(-1);
  assert.ok(record?.kind === "plan_recheck", JSON.stringify(record));
  return record;
}

async function events(f: Fixture): Promise<{ type: string }[]> {
  return (
    await readFile(
      path.join(
        f.repository.root,
        ".banzai/runs",
        f.state.runId,
        "events.jsonl"
      ),
      "utf8"
    )
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string });
}

test("a prose edit is re-checked in place, approved and linked by the re-check", async () => {
  const f = await phpcsPlanGateFixture();
  try {
    const { plan } = bundlePaths(f);
    assert.equal(f.state.schemaVersion, 10);
    assert.deepEqual(
      await readdir(
        path.join(f.repository.root, ".banzai/runs", f.state.runId, "plan-gate")
      ),
      ["001"]
    );
    assert.deepEqual((await f.runner.status()).planningReview?.decisions, [
      "approve",
      "recheck",
      "rework",
      "review"
    ]);
    const planner = await readText(f, plan);
    const edited = planner.replace(
      "## Implementation Tasks",
      "## Rollout notes\n\nShip behind the existing module flag.\n\n## Implementation Tasks"
    );
    await writeText(f, plan, edited);
    await assert.rejects(
      f.runner.approvePlan("human", false),
      hasCode(
        "TASK_VERIFICATION_DIGEST_MISMATCH",
        /^planRemainderSha256 does not match the plan bytes outside its inventory: declared [a-f0-9]{64}, observed [a-f0-9]{64}\. Choose Re-check my edits, or run `banzai approve plan --decision recheck`, to record the digest of your edits\.$/u
      )
    );

    const rechecked = await f.runner.recheckPlan({ decidedBy: "human" });
    assert.equal(rechecked.status, "needs_plan_approval");
    assert.equal(rechecked.schemaVersion, 11);
    assert.equal(rechecked.planApproval, null);
    const record = latestRecheck(rechecked);
    assert.match(record.recheckId, /^plan-recheck-[0-9a-f]{12}$/u);
    assert.equal(record.gateEntry, 1);
    assert.equal(record.decidedBy, "human");
    assert.notEqual(
      record.plannerRemainderSha256,
      record.observedRemainderSha256
    );
    assert.equal(record.writtenRemainderSha256, record.observedRemainderSha256);
    assert.deepEqual(record.changedPaths, [plan]);

    // Only the declared digest's 64 characters changed.
    const written = await readText(f, plan);
    assert.equal(Buffer.byteLength(written), Buffer.byteLength(edited));
    assert.equal(
      written,
      edited.replace(
        record.plannerRemainderSha256 ?? "",
        record.observedRemainderSha256
      )
    );

    assert.deepEqual(record.summary, {
      plannerVersion: true,
      files: [
        {
          path: plan,
          change: "changed",
          sections: {
            changed: [],
            added: ["## Rollout notes"],
            removed: [],
            omitted: 0
          }
        }
      ],
      omittedFiles: 0,
      checks: {
        current: [PHPCS_CHECK_IDS.lint, PHPCS_CHECK_IDS.schema],
        added: [],
        removed: [],
        changed: [],
        absenceReasonChanged: false,
        omitted: 0
      },
      remainderDigestRewritten: true,
      acceptedAdrsChanged: []
    });
    const status = await f.runner.status();
    assert.deepEqual(status.planRecheck, record);
    const last = (await events(f)).at(-1) as Record<string, unknown>;
    assert.equal(last.type, "plan.recheck");
    assert.ok(!JSON.stringify(last).includes("existing module flag"));
    assert.ok(!JSON.stringify(record).includes("existing module flag"));

    const approved = await f.runner.approvePlan("human", false);
    assert.equal(approved.status, "plan_approved");
    assert.equal(approved.planApproval?.recheckId, record.recheckId);
    assert.equal(approved.planApproval.digest, record.bundleDigest);
    assert.equal((await f.runner.status()).planRecheck, undefined);
  } finally {
    await f.repository.dispose();
  }
});

test("a re-check with a matching digest writes nothing and still reports the changed files", async () => {
  const f = await phpcsPlanGateFixture();
  try {
    const { plan, description } = bundlePaths(f);
    const planBytes = await readText(f, plan);
    await appendFile(
      path.join(f.repository.root, description),
      "\n## Constraints\n\nKeep the public API.\n"
    );
    const record = latestRecheck(
      await f.runner.recheckPlan({ decidedBy: "human" })
    );
    assert.equal(await readText(f, plan), planBytes);
    assert.equal(record.writtenRemainderSha256, null);
    assert.equal(record.summary.remainderDigestRewritten, false);
    assert.deepEqual(record.summary.files, [
      {
        path: description,
        change: "changed",
        sections: {
          changed: [],
          added: ["## Constraints"],
          removed: [],
          omitted: 0
        }
      }
    ]);
    assert.ok(
      planRecheckLines(record).includes(
        "  The plan's remainder digest already matched; no file was written."
      )
    );
    const approved = await f.runner.approvePlan("human", false);
    assert.equal(approved.planApproval?.recheckId, record.recheckId);
  } finally {
    await f.repository.dispose();
  }
});

test("a refused re-check names the problem and changes no file, state, event or snapshot", async (t) => {
  const f = await phpcsPlanGateFixture();
  try {
    const { plan, description } = bundlePaths(f);
    const planner = await readText(f, plan);
    const descriptionBytes = await readText(f, description);
    const block =
      /```banzai-verification-obligations\/v2\n[\s\S]*?\n```\n/u.exec(
        planner
      )?.[0];
    assert.ok(block);
    const cases: [string, (text: string) => string, RegExp][] = [
      [
        "a missing inventory",
        (text) => text.replace(block, ""),
        /exactly one v2 verification inventory/u
      ],
      [
        "a duplicated inventory",
        (text) => `${text}\n${block}`,
        /exactly one v2 verification inventory/u
      ],
      [
        "malformed inventory JSON",
        (text) => text.replace('"complete":true', '"complete":tru'),
        /Malformed task verification inventory/u
      ],
      [
        "an invalid descriptor",
        (text) => text.replace('"timeoutMs":10000', '"timeoutMs":0'),
        /Invalid task verification timeout/u
      ],
      [
        "a broken task heading",
        (text) => text.replace(TASK_HEADING, "- [ ] **T001 - **"),
        /checked or malformed task heading/u
      ],
      [
        "a runner-control task",
        (text) =>
          text.replace(
            TASK_HEADING,
            `${TASK_HEADING}\n  Update \`.banzai/config.json\`.`
          ),
        /T001.*runner control path/u
      ],
      [
        "equivalent evidence against a fresh commitment",
        (text) =>
          text
            .replace('"evidence":"fresh"', '"evidence":"equivalent_evidence"')
            .replace(
              "## Implementation Tasks",
              "Run a fresh lint pass.\n\n## Implementation Tasks"
            ),
        /Equivalent evidence cannot override fresh plan commitments/u
      ]
    ];
    for (const [name, edit, message] of cases)
      await t.test(name, async () => {
        const text = edit(planner);
        assert.notEqual(text, planner);
        await writeText(f, plan, text);
        const before = await tree(f);
        await assert.rejects(
          f.runner.recheckPlan({ decidedBy: "human" }),
          hasCode("PLAN_RECHECK_REFUSED", message)
        );
        assert.deepEqual(await tree(f), before);
        await writeText(f, plan, planner);
      });
    await t.test("a missing bundle file", async () => {
      await rm(path.join(f.repository.root, description));
      const before = await tree(f);
      await assert.rejects(
        f.runner.recheckPlan({ decidedBy: "human" }),
        hasCode(
          "PLAN_RECHECK_REFUSED",
          new RegExp(`${description.replaceAll(".", "\\.")} is missing\\.`, "u")
        )
      );
      assert.deepEqual(await tree(f), before);
      await writeText(f, description, descriptionBytes);
    });
    await t.test("a symlinked bundle file", async () => {
      const target = path.join(f.repository.root, "description-copy.md");
      await writeFile(target, descriptionBytes);
      await rm(path.join(f.repository.root, description));
      await symlink(target, path.join(f.repository.root, description));
      const before = await tree(f);
      await assert.rejects(
        f.runner.recheckPlan({ decidedBy: "human" }),
        hasCode(
          "PLAN_RECHECK_REFUSED",
          new RegExp(
            `${description.replaceAll(".", "\\.")} is a symbolic link; replace it with a regular file\\.`,
            "u"
          )
        )
      );
      assert.deepEqual(await tree(f), before);
      await rm(path.join(f.repository.root, description));
      await rm(target);
      await writeText(f, description, descriptionBytes);
    });
    const state = (await f.runner.status()).state;
    assert.equal(state.schemaVersion, 10);
    assert.equal(state.humanDecisions?.length ?? 0, 0);
  } finally {
    await f.repository.dispose();
  }
});

test("a plan saved during the re-check is never overwritten", async () => {
  const f = await phpcsPlanGateFixture();
  try {
    const { plan } = bundlePaths(f);
    const absolute = path.join(f.repository.root, plan);
    await appendFile(absolute, "\nA first human edit.\n");
    const late = `${await readText(f, plan)}A late human edit.\n`;
    const read = f.runner.store.readLatestPlanGateSnapshot.bind(f.runner.store);
    // The snapshot read sits between the bundle read and the plan write.
    f.runner.store.readLatestPlanGateSnapshot = async (runId) => {
      await writeFile(absolute, late);
      return read(runId);
    };
    const before = (await tree(f)).filter((entry) => entry.path !== plan);
    await assert.rejects(
      f.runner.recheckPlan({ decidedBy: "human" }),
      hasCode("PLAN_RECHECK_CHANGED", /changed while the re-check was running/u)
    );
    assert.equal(await readText(f, plan), late);
    assert.deepEqual(
      (await tree(f)).filter((entry) => entry.path !== plan),
      before
    );
  } finally {
    await f.repository.dispose();
  }
});

test("the plan replacement compares bytes and preserves the file mode", async () => {
  const f = await phpcsPlanGateFixture();
  try {
    const { plan } = bundlePaths(f);
    const absolute = path.join(f.repository.root, plan);
    await chmod(absolute, 0o640);
    const current = await readFile(absolute);
    await assert.rejects(
      replacePlanBytes(
        f.repository.root,
        plan,
        Buffer.from("stale bytes"),
        Buffer.from("next")
      ),
      hasCode("PLAN_RECHECK_CHANGED")
    );
    assert.deepEqual(await readFile(absolute), current);
    await replacePlanBytes(
      f.repository.root,
      plan,
      current,
      Buffer.from("next\n")
    );
    assert.equal(await readFile(absolute, "utf8"), "next\n");
    assert.equal((await stat(absolute)).mode & 0o777, 0o640);
    assert.deepEqual(
      (await readdir(path.dirname(absolute))).filter((name) =>
        name.endsWith(".recheck.tmp")
      ),
      []
    );
  } finally {
    await f.repository.dispose();
  }
});

test("a run that reached the gate without a snapshot says the planner's version is unavailable", async () => {
  const f = await phpcsPlanGateFixture();
  try {
    const { plan } = bundlePaths(f);
    await rm(
      path.join(f.repository.root, ".banzai/runs", f.state.runId, "plan-gate"),
      { recursive: true }
    );
    await appendFile(path.join(f.repository.root, plan), "\nA human edit.\n");
    const record = latestRecheck(
      await f.runner.recheckPlan({ decidedBy: "human" })
    );
    assert.equal(record.gateEntry, null);
    assert.equal(record.plannerBundleDigest, null);
    assert.equal(record.plannerRemainderSha256, null);
    assert.deepEqual(record.changedPaths, []);
    assert.equal(record.summary.plannerVersion, false);
    assert.deepEqual(record.summary.checks.current, [
      PHPCS_CHECK_IDS.lint,
      PHPCS_CHECK_IDS.schema
    ]);
    assert.deepEqual((await f.runner.status()).planRecheck, record);
    assert.deepEqual(planRecheckLines(record), [
      "Re-check of your edits:",
      "  The plan's remainder digest was updated to match your edits.",
      "  The planner's version is unavailable: this run reached the gate before it was retained.",
      `  Current checks: ${PHPCS_CHECK_IDS.lint}, ${PHPCS_CHECK_IDS.schema}`
    ]);
    const approved = await f.runner.approvePlan("human", false);
    assert.equal(approved.planApproval?.recheckId, record.recheckId);
  } finally {
    await f.repository.dispose();
  }
});

test("a later gate entry shows and links no earlier re-check", async () => {
  const f = await phpcsPlanGateFixture();
  try {
    const { plan } = bundlePaths(f);
    await appendFile(path.join(f.repository.root, plan), "\nA human edit.\n");
    const record = latestRecheck(
      await f.runner.recheckPlan({ decidedBy: "human" })
    );
    const reworked = await f.runner.reworkPlan({
      feedback: "Split the schema check into its own task.",
      decidedBy: "human"
    });
    assert.equal(reworked.status, "needs_plan_approval");
    assert.deepEqual(
      await readdir(
        path.join(f.repository.root, ".banzai/runs", f.state.runId, "plan-gate")
      ),
      ["001", "002"]
    );
    assert.equal((await f.runner.status()).planRecheck, undefined);
    const approved = await f.runner.approvePlan("human", false);
    assert.equal(approved.planApproval?.recheckId, null);
    assert.ok(
      approved.humanDecisions?.some(
        (decision) =>
          decision.kind === "plan_recheck" &&
          decision.recheckId === record.recheckId
      )
    );
  } finally {
    await f.repository.dispose();
  }
});

test("a re-check keeps the gate's human-time episode open and approval still closes it", async () => {
  const f = await phpcsPlanGateFixture();
  try {
    const { plan } = bundlePaths(f);
    const store = new HumanTimeStore(f.repository.root);
    const opened = (await store.readEvidence(f.state.runId)).observations;
    const gate = opened.filter((o) => o.endpoint === "opened").at(-1);
    assert.ok(gate, JSON.stringify(opened));
    await appendFile(path.join(f.repository.root, plan), "\nA human edit.\n");
    await f.runner.recheckPlan({ decidedBy: "human" });
    const afterRecheck = await store.readEvidence(f.state.runId);
    assert.deepEqual(afterRecheck.issues, []);
    assert.deepEqual(afterRecheck.observations, opened);
    await f.runner.approvePlan("human", false);
    const closed = (await store.readEvidence(f.state.runId)).observations;
    assert.ok(
      closed.some(
        (o) => o.episodeKey === gate.episodeKey && o.endpoint !== "opened"
      ),
      JSON.stringify(closed)
    );
  } finally {
    await f.repository.dispose();
  }
});

test("a historical v9 task run at the gate offers no re-check and keeps its mismatch message", async () => {
  const f = await phpcsPlanGateFixture();
  try {
    const { plan } = bundlePaths(f);
    const statePath = path.join(
      f.repository.root,
      ".banzai/runs",
      f.state.runId,
      "state.json"
    );
    const persisted = JSON.parse(await readFile(statePath, "utf8")) as Record<
      string,
      unknown
    >;
    persisted.schemaVersion = 9;
    delete persisted.planningReview;
    delete persisted.humanDecisions;
    await writeFile(statePath, JSON.stringify(persisted));
    const status = await f.runner.status();
    assert.equal(status.state.schemaVersion, 9);
    assert.equal(status.planningReview, undefined);
    await appendFile(path.join(f.repository.root, plan), "\nA human edit.\n");
    await assert.rejects(
      f.runner.recheckPlan({ decidedBy: "human" }),
      hasCode("ARTIFACT_VERSION_UNSUPPORTED", /state v10 or later/u)
    );
    await assert.rejects(
      f.runner.approvePlan("human", false),
      hasCode(
        "TASK_VERIFICATION_DIGEST_MISMATCH",
        /^planRemainderSha256 does not match the plan bytes outside its inventory: declared [a-f0-9]{64}, observed [a-f0-9]{64}\.$/u
      )
    );
  } finally {
    await f.repository.dispose();
  }
});

const exec = promisify(execFile);
const CLI = path.resolve("dist/banzai.mjs");

test("the CLI prints the waiting copy, refuses a note and re-checks without resuming", async () => {
  const f = await phpcsPlanGateFixture();
  try {
    const { plan, description } = bundlePaths(f);
    const run = (args: string[]) =>
      exec(process.execPath, [CLI, ...args], {
        cwd: f.repository.root,
        env: monochromeEnv()
      });
    const printed = (await run(["status"])).stdout.split("\n");
    const waiting = printed.indexOf(
      "The run is waiting. Edit these files in any editor, then run `banzai approve plan --decision recheck`. The run keeps waiting until you decide."
    );
    assert.notEqual(waiting, -1, printed.join("\n"));
    assert.deepEqual(printed.slice(waiting + 1, waiting + 3), [
      `  ${description}`,
      `  ${plan}`
    ]);
    const before = await tree(f);
    await assert.rejects(
      run(["approve", "plan", "--decision", "recheck", "--note", "x"]),
      (error: { stderr: string }) =>
        error.stderr.includes(
          "[INVALID_DECISION] --note is accepted only with --decision rework."
        )
    );
    assert.deepEqual(await tree(f), before);
    await appendFile(path.join(f.repository.root, plan), "\nA human edit.\n");
    const output = (
      await run([
        "approve",
        "plan",
        "--decision",
        "recheck",
        "--by",
        "owner",
        "--no-resume"
      ])
    ).stdout;
    assert.match(output, /^Re-check of your edits:$/mu);
    assert.match(
      output,
      /^ {2}The plan's remainder digest was updated to match your edits\.$/mu
    );
    const state = await f.runner.store.requireActiveState();
    assert.equal(state.status, "needs_plan_approval");
    assert.equal(latestRecheck(state).decidedBy, "owner");
    parseTaskVerificationObligations(await readText(f, plan));
  } finally {
    await f.repository.dispose();
  }
});

function inventoryPlan(
  prose: string,
  inventory: Record<string, unknown>,
  eol = "\n"
): string {
  const before = `# Plan${eol}${eol}${prose}${eol}`;
  return `${before}\`\`\`banzai-verification-obligations/v2${eol}${JSON.stringify(
    {
      schema: "banzai-verification-obligations/v2",
      schemaVersion: 2,
      complete: true,
      planRemainderSha256: "0".repeat(64),
      checks: [],
      absenceReason: "Documentation-only change.",
      ...inventory
    },
    null,
    2
  ).replaceAll("\n", eol)}${eol}\`\`\`${eol}`;
}

test("the digest rewrite changes only the declared value and keeps every other byte", () => {
  for (const eol of ["\n", "\r\n"]) {
    const plan = inventoryPlan("Edited prose.", {}, eol);
    const result = rewritePlanRemainderDigest(plan);
    assert.equal(result.rewritten, true);
    assert.equal(result.declared, "0".repeat(64));
    assert.equal(result.plan.length, plan.length);
    assert.equal(result.plan, plan.replace("0".repeat(64), result.observed));
    assert.equal(
      parseTaskVerificationObligations(result.plan).planRemainderSha256,
      result.observed
    );
    const again = rewritePlanRemainderDigest(result.plan);
    assert.equal(again.rewritten, false);
    assert.equal(again.plan, result.plan);
    if (eol === "\r\n") assert.ok(result.plan.includes("Edited prose.\r\n"));
  }
});

test("the digest rewrite refuses an ambiguous or malformed declared member", () => {
  const hex = "1".repeat(64);
  for (const [plan, message] of [
    [
      inventoryPlan("Prose.", { planRemainderSha256: "ABC" }),
      /planRemainderSha256 must be 64 lowercase hexadecimal characters/u
    ],
    [
      inventoryPlan("Prose.", {}) + inventoryPlan("Again.", {}),
      /exactly one v2 verification inventory/u
    ]
  ] as const)
    assert.throws(() => rewritePlanRemainderDigest(plan), message);
  // A duplicated member is refused even though JSON parsing keeps the last.
  const duplicated = inventoryPlan("Prose.", {}).replace(
    `"planRemainderSha256": "${"0".repeat(64)}",`,
    `"planRemainderSha256": "${hex}",\n  "planRemainderSha256": "${"0".repeat(64)}",`
  );
  assert.throws(
    () => rewritePlanRemainderDigest(duplicated),
    /exactly once|Unexpected|Unsupported/u
  );
});

function check(
  id: string,
  overrides: Partial<TaskVerificationDescriptor> = {}
): TaskVerificationDescriptor {
  return {
    id,
    name: `Check ${id}`,
    requirementRefs: ["FR1"],
    command: "npm",
    args: ["test"],
    cwd: ".",
    timeoutMs: 60_000,
    evidence: "fresh",
    sources: [],
    materialization: null,
    ...overrides
  };
}

function inventory(
  checks: TaskVerificationDescriptor[],
  absenceReason: string | null = null
): TaskVerificationCandidates {
  return { checks, absenceReason };
}

const file = (filePath: string, text: string) => ({
  path: filePath,
  bytes: Buffer.from(text)
});

test("Markdown sections ignore fenced headings and tell repeated headings apart", () => {
  const sections = markdownSections(
    "Intro\n# Title\n\n## Step ##\none\n```md\n# Not a heading\n```\n## Step\ntwo\n~~~\n## Still code\n~~~\n"
  );
  assert.deepEqual(
    [...sections.keys()],
    ["(before the first heading)", "1:Title#1", "2:Step#1", "2:Step#2"]
  );
  assert.deepEqual(
    [...sections.values()].map((section) => section.label),
    ["(before the first heading)", "# Title", "## Step", "## Step"]
  );
});

test("the summary names files, sections, check fields and accepted ADRs without content", () => {
  const canary = "CANARY-CONTENT-7f3a";
  const adr = "documentation/decisions/0099-example.md";
  const summary = planRecheckSummary({
    planner: [
      file("plan.md", `# Plan\n\n## Scope\nold ${canary}\n\n## Gone\nx\n`),
      file(adr, "# ADR\n\nStatus: Accepted\n\n## Decision\nA\n"),
      file("notes.txt", "a\n"),
      file("removed.md", "# Removed\n")
    ],
    current: [
      file("plan.md", `# Plan\n\n## Scope\nnew ${canary}\n\n## Added\ny\n`),
      file(adr, "# ADR\n\nStatus: Accepted\n\n## Decision\nB\n"),
      file("notes.txt", "b\n"),
      file("new.md", "# New\n")
    ],
    plannerInventory: inventory([
      check("lint"),
      check("unit", { args: ["run", "unit"] }),
      check("gone")
    ]),
    currentInventory: inventory([
      check("lint", {
        name: "Lint",
        args: ["run", "lint"],
        timeoutMs: 120_000,
        sources: [{ path: "a.txt", sha256: "e".repeat(64) }]
      }),
      check("unit", { args: ["run", "unit"] }),
      check("added")
    ]),
    remainderDigestRewritten: true,
    adrPaths: [adr]
  });
  assert.deepEqual(summary.files, [
    {
      path: adr,
      change: "changed",
      sections: { changed: ["## Decision"], added: [], removed: [], omitted: 0 }
    },
    { path: "new.md", change: "added", sections: null },
    { path: "notes.txt", change: "changed", sections: null },
    {
      path: "plan.md",
      change: "changed",
      sections: {
        changed: ["## Scope"],
        added: ["## Added"],
        removed: ["## Gone"],
        omitted: 0
      }
    },
    { path: "removed.md", change: "removed", sections: null }
  ]);
  assert.deepEqual(summary.checks, {
    current: ["lint", "unit", "added"],
    added: ["added"],
    removed: ["gone"],
    changed: [{ id: "lint", fields: ["name", "argv", "timeoutMs", "sources"] }],
    absenceReasonChanged: false,
    omitted: 0
  });
  assert.deepEqual(summary.acceptedAdrsChanged, [adr]);
  assert.ok(!JSON.stringify(summary).includes(canary));
  const lines = planRecheckLines({
    kind: "plan_recheck",
    recheckId: "plan-recheck-0123456789ab",
    gateEntry: 1,
    plannerBundleDigest: "a".repeat(64),
    plannerRemainderSha256: "b".repeat(64),
    observedRemainderSha256: "c".repeat(64),
    writtenRemainderSha256: "c".repeat(64),
    bundleDigest: "d".repeat(64),
    changedPaths: summary.files.map((item) => item.path),
    summary,
    decidedBy: "owner",
    decidedAt: "2026-10-31T00:00:00.000Z"
  });
  assert.ok(
    lines.includes(
      `  Warning: accepted ADR ${adr} changed. Accepted ADR bodies are immutable, and the runner cannot tell lifecycle metadata from body text; review this change before approving.`
    ),
    lines.join("\n")
  );
  assert.ok(
    lines.includes("  Check lint changed: name, argv, timeoutMs, sources")
  );
  assert.ok(!lines.join("\n").includes(canary));
});

test("the summary masks the runner-owned digest, notes a changed absence rationale and stays bounded", () => {
  const digest = (value: string) =>
    `\`\`\`json\n{"planRemainderSha256": "${value}"}\n\`\`\`\n`;
  const masked = planRecheckSummary({
    planner: [file("plan.md", `# Plan\n${digest("1".repeat(64))}`)],
    current: [file("plan.md", `# Plan\n${digest("2".repeat(64))}`)],
    plannerInventory: inventory([], "Docs only."),
    currentInventory: inventory([], "Docs only, now with a reason."),
    remainderDigestRewritten: true,
    adrPaths: []
  });
  assert.deepEqual(masked.files, []);
  assert.equal(masked.checks.absenceReasonChanged, true);

  const many = Array.from(
    { length: PLAN_RECHECK_LIMITS.files + 3 },
    (_, i) => `f${String(i).padStart(2, "0")}.md`
  );
  const headings = (n: number, body: string) =>
    Array.from({ length: n }, (_, i) => `## H${i}\n${body}\n`).join("");
  const bounded = planRecheckSummary({
    planner: many.map((name) => file(name, headings(10, "a"))),
    current: many.map((name) => file(name, headings(10, "b"))),
    plannerInventory: inventory(
      Array.from({ length: PLAN_RECHECK_LIMITS.checks + 5 }, (_, i) =>
        check(`c${i}`)
      )
    ),
    currentInventory: inventory(
      Array.from({ length: PLAN_RECHECK_LIMITS.checks + 5 }, (_, i) =>
        check(`c${i}`, { cwd: "src" })
      )
    ),
    remainderDigestRewritten: false,
    adrPaths: []
  });
  assert.equal(bounded.files.length, PLAN_RECHECK_LIMITS.files);
  assert.equal(bounded.omittedFiles, 3);
  const kept = bounded.files.reduce(
    (total, item) => total + (item.sections?.changed.length ?? 0),
    0
  );
  assert.ok(kept <= PLAN_RECHECK_LIMITS.headings);
  assert.equal(bounded.checks.current.length, PLAN_RECHECK_LIMITS.checks);
  assert.equal(bounded.checks.changed.length, PLAN_RECHECK_LIMITS.checks);
  assert.ok(bounded.checks.omitted >= 5);

  const unsafe = planRecheckSummary({
    planner: [file("plan.md", "# Plan\n")],
    current: [
      file("plan.md", `# Plan\n## A\u001b[2J\u202eB ${"x".repeat(200)}\n`)
    ],
    plannerInventory: inventory([], "r"),
    currentInventory: inventory([], "r"),
    remainderDigestRewritten: false,
    adrPaths: []
  });
  const label = unsafe.files[0]?.sections?.added[0] ?? "";
  assert.doesNotMatch(label, /[\u001b\u202e]/u);
  assert.ok(label.length <= PLAN_RECHECK_LIMITS.headingLength + 3);
  assert.ok(label.endsWith("…"));
});

test("persisted re-check records are exact and bounded, and only state v11 holds them", async () => {
  const f = await phpcsPlanGateFixture();
  try {
    const { plan } = bundlePaths(f);
    await appendFile(path.join(f.repository.root, plan), "\nA human edit.\n");
    await f.runner.recheckPlan({ decidedBy: "human" });
    const stored = await f.runner.store.requireActiveState();
    assert.equal(stored.schemaVersion, 11);
    validatePlanningReviewState(stored);
    const mutate = (
      change: (state: RunState, record: PlanRecheckRecord) => void
    ) => {
      const copy = structuredClone(stored);
      change(copy, latestRecheck(copy));
      return copy;
    };
    for (const [name, invalid] of [
      [
        "a record on v10",
        mutate((state) => {
          state.schemaVersion = 10;
        })
      ],
      [
        "an unknown key",
        mutate((_, record) => Object.assign(record, { note: "x" }))
      ],
      [
        "a malformed id",
        mutate((_, record) => {
          record.recheckId = "plan-recheck-XYZ";
        })
      ],
      [
        "a duplicate id",
        mutate((state, record) => {
          state.humanDecisions = [record, structuredClone(record)];
        })
      ],
      [
        "a written digest that is not the observed one",
        mutate((_, record) => {
          record.writtenRemainderSha256 = "f".repeat(64);
        })
      ],
      [
        "a rewrite flag that contradicts the written digest",
        mutate((_, record) => {
          record.summary.remainderDigestRewritten = false;
        })
      ],
      [
        "a heading with control characters",
        mutate((_, record) => {
          record.summary.files = [
            {
              path: plan,
              change: "changed",
              sections: {
                changed: ["## A\u001b[2J"],
                added: [],
                removed: [],
                omitted: 0
              }
            }
          ];
        })
      ],
      [
        "an unknown check field",
        mutate((_, record) => {
          record.summary.checks.changed = [
            { id: PHPCS_CHECK_IDS.lint, fields: ["shell"] }
          ];
        })
      ],
      [
        "too many files",
        mutate((_, record) => {
          record.summary.files = Array.from(
            { length: PLAN_RECHECK_LIMITS.files + 1 },
            (_, i) => ({
              path: `f${i}.md`,
              change: "added" as const,
              sections: null
            })
          );
        })
      ]
    ] as const)
      assert.throws(
        () => {
          validatePlanningReviewState(invalid);
        },
        Error,
        name
      );
    const statePath = f.runner.store.statePath(stored.runId);
    const persisted = JSON.parse(await readFile(statePath, "utf8")) as Record<
      string,
      unknown
    >;
    persisted.schemaVersion = 10;
    await writeFile(statePath, JSON.stringify(persisted));
    await assert.rejects(f.runner.store.requireActiveState());
  } finally {
    await f.repository.dispose();
  }
});

test("an unreadable latest gate-entry snapshot refuses the re-check without writing", async () => {
  const f = await phpcsPlanGateFixture();
  try {
    const { plan } = bundlePaths(f);
    await writeFile(
      path.join(
        f.repository.root,
        ".banzai/runs",
        f.state.runId,
        "plan-gate/001/bundle.json"
      ),
      "{"
    );
    await appendFile(path.join(f.repository.root, plan), "\nA human edit.\n");
    const before = await tree(f);
    await assert.rejects(
      f.runner.recheckPlan({ decidedBy: "human" }),
      hasCode("PLAN_GATE_SNAPSHOT_INVALID", /plan gate entry 1 is unreadable/u)
    );
    assert.deepEqual(await tree(f), before);
  } finally {
    await f.repository.dispose();
  }
});

async function runnerRecordedGate() {
  const repository = await createTestRepository();
  const adapters = new FakeAdapters();
  adapters.planRemainderDeclared = "0".repeat(64);
  const runner = new WorkflowRunner(repository.root, adapters);
  const state = await runner.start({
    slug: "example",
    request: "Plan the example."
  });
  assert.equal(state.status, "needs_plan_approval", state.blockReason ?? "");
  const relative = state.planArtifacts?.plan;
  assert.ok(relative);
  return {
    repository,
    runner,
    state,
    relative,
    file: path.join(repository.root, relative)
  };
}

test("a runner-recorded plan is the gate-entry version, needs no re-check and approves", async () => {
  const f = await runnerRecordedGate();
  try {
    const recorded = await readFile(f.file);
    const inventory = parseTaskVerificationObligations(recorded.toString());
    assert.notEqual(inventory.planRemainderSha256, "0".repeat(64));
    const snapshot = await f.runner.store.readLatestPlanGateSnapshot(
      f.state.runId
    );
    assert.deepEqual(
      snapshot?.entries.find((entry) => entry.path === f.relative)?.contents,
      recorded
    );
    const approved = await f.runner.approvePlan("human", false);
    assert.notEqual(approved.planApproval, null);
    assert.deepEqual(await readFile(f.file), recorded);
  } finally {
    await f.repository.dispose();
  }
});

test("a re-check of an unedited runner-recorded plan rewrites nothing and names the recorded value", async () => {
  const f = await runnerRecordedGate();
  try {
    const recorded = await readFile(f.file);
    const { planRemainderSha256 } = parseTaskVerificationObligations(
      recorded.toString()
    );
    const record = latestRecheck(
      await f.runner.recheckPlan({ decidedBy: "human" })
    );
    assert.equal(record.summary.remainderDigestRewritten, false);
    assert.equal(record.writtenRemainderSha256, null);
    assert.equal(record.plannerRemainderSha256, planRemainderSha256);
    assert.equal(record.observedRemainderSha256, planRemainderSha256);
    assert.deepEqual(await readFile(f.file), recorded);
  } finally {
    await f.repository.dispose();
  }
});

test("approval over a later hand edit of a runner-recorded plan fails, names the re-check and writes nothing", async () => {
  const f = await runnerRecordedGate();
  try {
    await appendFile(f.file, "\nA human edit.\n");
    const edited = await readFile(f.file);
    await assert.rejects(
      f.runner.approvePlan("human", false),
      hasCode("TASK_VERIFICATION_DIGEST_MISMATCH", /Re-check my edits/u)
    );
    assert.deepEqual(await readFile(f.file), edited);
    assert.equal(
      (await f.runner.store.requireActiveState()).planApproval,
      null
    );
  } finally {
    await f.repository.dispose();
  }
});
