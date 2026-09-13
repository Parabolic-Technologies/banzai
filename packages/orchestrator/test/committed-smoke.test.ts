import assert from "node:assert/strict";
import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import packageManifest from "../package.json" with { type: "json" };
import {
  setProjectVersion,
  VERSION_SURFACES
} from "../scripts/release-version.mjs";

const SMOKE = path.join(process.cwd(), "scripts", "smoke-committed.mjs");
const COMMITTED_BUNDLE = path.join(process.cwd(), "dist", "banzai.mjs");

type FakeVariant =
  | "success"
  | "nonzero"
  | "malformed-capabilities"
  | "malformed-doctor"
  | "malformed-evaluation"
  | "malformed-context"
  | "malformed-status"
  | "incompatible-capabilities"
  | "capability-version-mismatch"
  | "help-version-mismatch"
  | "stderr"
  | "not-ready"
  | "mutation"
  | "hang";

function fakeBundleSource(variant: FakeVariant): string {
  return `
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const variant = ${JSON.stringify(variant)};
const version = ${JSON.stringify(packageManifest.version)};
const args = process.argv.slice(2);
const command = args.join(" ");
async function activeStatus() {
  try {
    const pointer = JSON.parse(await readFile(path.join(process.cwd(), ".banzai/active-run.json"), "utf8"));
    const state = JSON.parse(await readFile(path.join(process.cwd(), ".banzai/runs", pointer.runId, "state.json"), "utf8"));
    const pending = state.pendingHumanDecision;
    return {
      runId: state.runId,
      slug: state.slug,
      state: state.status,
      nextAction: pending?.kind === "decision_consultation" ? "answer_consultation" : "resume",
      pendingGate: pending?.kind === "decision_consultation" ? {
        kind: "decision_consultation",
        phase: "plan",
        summary: pending.summary,
        runId: state.runId,
        request: pending.request
      } : null
    };
  } catch {
    return null;
  }
}
async function stdinText() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
if (command === "help") {
  process.stdout.write("Banzai v" + (variant === "help-version-mismatch" ? "0.0.0" : version) + " local cross-vendor workflow runner\\nUsage: banzai <command>\\n  banzai init\\nFive human decision gates remain distinct\\nbanzai-agent-answer/v2\\n  banzai eval context [--json] [--from <RFC3339>] [--to <RFC3339>] [--run <run-id>]...\\n");
} else if (command === "control capabilities") {
  if (variant === "mutation") await writeFile(path.join(process.cwd(), "mutated.txt"), "mutated\\n");
  process.stdout.write(variant === "malformed-capabilities" ? "{bad\\n" : JSON.stringify({
    schema: variant === "incompatible-capabilities" ? "banzai-agent-capabilities/v1" : "banzai-agent-capabilities/v3",
    schemaVersion: variant === "incompatible-capabilities" ? 1 : 3,
    controlContractVersion: "4.0.0",
    orchestratorVersion: variant === "capability-version-mismatch" ? "0.0.0" : version,
    umbrellaContractVersion: "1.0.0",
    operations: {
      status: { supported: true, ttyRequired: false, inputSchemas: [] },
      start: { supported: true, ttyRequired: false, inputSchemas: ["banzai-agent-request/v1"] },
      answer: { supported: true, ttyRequired: false, inputSchemas: ["banzai-agent-answer/v2"] },
      approveAdr: { supported: true, ttyRequired: false, inputSchemas: [] },
      approvePlan: { supported: true, ttyRequired: false, inputSchemas: [] },
      triage: { supported: true, ttyRequired: false, inputSchemas: [] },
      resume: { supported: true, ttyRequired: false, inputSchemas: [] },
      retry: { supported: true, ttyRequired: false, inputSchemas: [] },
      recover: { supported: true, ttyRequired: false, inputSchemas: ["banzai-agent-recovery/v1"] },
      cancel: { supported: true, ttyRequired: false, inputSchemas: [] }
    }
  }) + "\\n");
} else if (command === "init") {
  await mkdir(path.join(process.cwd(), ".banzai"), { recursive: true });
  await writeFile(path.join(process.cwd(), ".banzai/config.json"), JSON.stringify({
    schemaVersion: 3,
    contractVersion: "1.0.0",
    models: {
      planner: { executable: process.execPath },
      implementer: { executable: process.execPath },
      reviewer: { executable: process.execPath }
    },
    verification: { profiles: [] }
  }) + "\\n");
} else if (command === "doctor --json") {
  if (variant === "nonzero") process.exit(7);
  if (variant === "hang") {
    setInterval(() => {}, 1_000);
    await new Promise(() => {});
  }
  if (variant === "stderr") process.stderr.write("private output\\n");
  process.stdout.write(variant === "malformed-doctor" ? "{bad\\n" : JSON.stringify({ schema: "banzai-doctor/v3", schemaVersion: 3, ready: variant !== "not-ready" }) + "\\n");
} else if (command === "control status") {
  process.stdout.write(variant === "malformed-status" ? "{bad\\n" : JSON.stringify({ schema: "banzai-agent-status/v2", schemaVersion: 2, activeRun: await activeStatus() }) + "\\n");
} else if (command === "control answer --by Smoke User --no-resume") {
  const answer = JSON.parse(await stdinText());
  const pointer = JSON.parse(await readFile(path.join(process.cwd(), ".banzai/active-run.json"), "utf8"));
  const runRoot = path.join(process.cwd(), ".banzai/runs", pointer.runId);
  const state = JSON.parse(await readFile(path.join(runRoot, "state.json"), "utf8"));
  const pending = state.pendingHumanDecision;
  state.humanDecisions.push({
    ...pending,
    runId: state.runId,
    requestId: pending.request.requestId,
    roundId: pending.request.roundId,
    answers: answer.answers,
    decidedAt: "2026-09-01T00:00:01.000Z",
    decidedBy: "Smoke User"
  });
  state.pendingHumanDecision = null;
  state.status = "planning";
  await writeFile(path.join(runRoot, "state.json"), JSON.stringify(state) + "\\n");
  await appendFile(path.join(runRoot, "events.jsonl"), JSON.stringify({
    at: "2026-09-01T00:00:01.000Z",
    type: "decision.consultation.answered",
    runId: state.runId,
    details: { cardCount: answer.answers.length, answerModes: { option: 0, preference: 1 }, completion: "answered" }
  }) + "\\n");
  process.stdout.write(JSON.stringify({ schema: "banzai-agent-status/v2", schemaVersion: 2, activeRun: await activeStatus() }) + "\\n");
} else if (command === "eval export --json") {
  process.stderr.write("[EVAL_PARTIAL] Export includes incomplete evidence; inspect the structured issues in the report.\\n");
  process.stdout.write(variant === "malformed-evaluation" ? "{bad\\n" : JSON.stringify({ schema: "banzai-evaluation-export/v2", schemaVersion: 2, runs: [] }) + "\\n");
} else if (command === "eval context --json") {
  process.stdout.write(variant === "malformed-context" ? "{bad\\n" : JSON.stringify({ schema: "banzai-context-report/v1", schemaVersion: 1, coverage: { exact: 0, incomplete: 1 } }) + "\\n");
} else if (command === "eval kpi --json") {
  process.stdout.write(JSON.stringify({ schema: "banzai-evaluation-kpi/v2", schemaVersion: 2, sources: [{ ordinal: 1 }] }) + "\\n");
} else if (args[0] === "eval" && args[1] === "kpi" && args[2] === "--input") {
  process.stdout.write(JSON.stringify({ schema: "banzai-evaluation-kpi/v2", schemaVersion: 2, sources: [{ ordinal: 1 }] }) + "\\n");
} else if (command === "eval unknown") {
  process.stderr.write("[INVALID_EVAL_COMMAND] Eval target must be \`export\`, \`kpi\`, \`context\`, or \`cancellations\`.\\n");
  process.exit(1);
} else {
  process.exit(8);
}
`;
}

async function fixture(variant: FakeVariant): Promise<{
  root: string;
  bundle: string;
  scratch: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-smoke-test-"));
  const bundle = path.join(root, "fake-banzai.mjs");
  const scratch = path.join(root, "scratch");
  await writeFile(bundle, fakeBundleSource(variant), "utf8");
  await mkdir(scratch);
  return { root, bundle, scratch };
}

function runSmoke(bundle: string, scratch: string): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    [SMOKE, "--fixture-bundle", bundle, "--fixture-parent", scratch],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
}

test("committed-bundle scratch smoke succeeds without leaving a repository", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-real-smoke-test-"));
  try {
    const result = runSmoke(COMMITTED_BUNDLE, root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "committed smoke passed\n");
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("committed-bundle help reports the package-derived release-train version", () => {
  const result = spawnSync(process.execPath, [COMMITTED_BUNDLE, "help"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.split("\n")[0],
    `Banzai v${packageManifest.version} local cross-vendor workflow runner`
  );
});

test("forward release smoke accepts synchronized metadata and a freshly rebuilt bundle", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-forward-smoke-test-"));
  const repository = path.resolve(process.cwd(), "../..");
  try {
    for (const relative of [
      "release-policy.json",
      ...new Set(VERSION_SURFACES.map((surface) => surface.path)),
      "packages/orchestrator/src",
      "packages/orchestrator/scripts/build.mjs",
      "packages/orchestrator/scripts/artifact-readers-build.mjs",
      "packages/orchestrator/scripts/phase-resources-build.mjs",
      "packages/orchestrator/scripts/smoke-committed.mjs",
      "plugins/banzai"
    ]) {
      const target = path.join(root, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(path.join(repository, relative), target, { recursive: true });
    }
    // CI checkout permissions are not part of the version transaction scenario.
    for (const relative of new Set(
      VERSION_SURFACES.map((surface) => surface.path)
    )) {
      await chmod(path.join(root, relative), 0o644);
    }
    await symlink(
      path.join(repository, "node_modules"),
      path.join(root, "node_modules")
    );
    const [major, minor, patch] = packageManifest.version.split(".");
    assert.ok(patch !== undefined);
    const nextVersion = `${major}.${minor}.${BigInt(patch) + 1n}`;
    await setProjectVersion({
      root,
      targetVersion: nextVersion,
      ownerPid: process.pid
    });
    const built = spawnSync(
      process.execPath,
      [path.join(root, "packages/orchestrator/scripts/build.mjs")],
      { cwd: path.join(root, "packages/orchestrator"), encoding: "utf8" }
    );
    assert.equal(built.status, 0, built.stderr);
    const scratch = path.join(root, "scratch");
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "packages/orchestrator/scripts/smoke-committed.mjs"),
        "--fixture-parent",
        scratch
      ],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "committed smoke passed\n");
    assert.deepEqual(await readdir(scratch), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("smoke accepts deterministic valid JSON and leaves no scratch tree", async () => {
  const candidate = await fixture("success");
  try {
    const result = runSmoke(candidate.bundle, candidate.scratch);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await readdir(candidate.scratch), []);
  } finally {
    await rm(candidate.root, { recursive: true, force: true });
  }
});

for (const [variant, code] of [
  ["nonzero", "SMOKE_NON_ZERO"],
  ["malformed-capabilities", "SMOKE_MALFORMED_JSON"],
  ["malformed-doctor", "SMOKE_MALFORMED_JSON"],
  ["malformed-evaluation", "SMOKE_MALFORMED_JSON"],
  ["malformed-context", "SMOKE_MALFORMED_JSON"],
  ["malformed-status", "SMOKE_MALFORMED_JSON"],
  ["incompatible-capabilities", "SMOKE_CONTRACT_MISMATCH"],
  ["capability-version-mismatch", "SMOKE_VERSION_MISMATCH"],
  ["help-version-mismatch", "SMOKE_VERSION_MISMATCH"],
  ["stderr", "SMOKE_STDERR"],
  ["not-ready", "SMOKE_DOCTOR_NOT_READY"],
  ["mutation", "SMOKE_TREE_MUTATION"]
] as const) {
  test(`smoke fails closed for ${variant} and cleans after failure`, async () => {
    const candidate = await fixture(variant);
    try {
      const result = runSmoke(candidate.bundle, candidate.scratch);
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(`^${code}:`));
      assert.deepEqual(await readdir(candidate.scratch), []);
    } finally {
      await rm(candidate.root, { recursive: true, force: true });
    }
  });
}

test("smoke interruption terminates work and cleans its scratch repository", async () => {
  const candidate = await fixture("hang");
  try {
    const child = spawn(
      process.execPath,
      [
        SMOKE,
        "--fixture-bundle",
        candidate.bundle,
        "--fixture-parent",
        candidate.scratch
      ],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
    );
    const exit = new Promise<number | null>((resolve) => {
      child.once("exit", resolve);
    });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200);
    });
    child.kill("SIGTERM");
    const exitCode = await exit;
    assert.equal(exitCode, 1);
    assert.deepEqual(await readdir(candidate.scratch), []);
    await assert.rejects(access(path.join(candidate.scratch, "mutated.txt")));
  } finally {
    await rm(candidate.root, { recursive: true, force: true });
  }
});
