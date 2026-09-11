import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const committedBundle = path.join(packageRoot, "dist", "banzai.mjs");
const activeChildren = new Set();
let receivedSignal = null;

class SmokeError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = "SmokeError";
  }
}

function fail(code, detail) {
  throw new SmokeError(code, detail);
}

function parseArguments(args) {
  let bundle = committedBundle;
  let scratchParent = os.tmpdir();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (value === undefined) {
      fail("INVALID_SMOKE_OPTION", "option requires a value");
    }
    if (option === "--fixture-bundle") {
      bundle = path.resolve(value);
    } else if (option === "--fixture-parent") {
      scratchParent = path.resolve(value);
    } else {
      fail("INVALID_SMOKE_OPTION", "unknown smoke option");
    }
  }
  return { bundle, scratchParent };
}

function terminate(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  try {
    process.kill(process.platform === "win32" ? pid : -pid, "SIGTERM");
  } catch {
    // The child may already have exited.
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    receivedSignal = signal;
    for (const pid of activeChildren) {
      terminate(pid);
    }
  });
}

async function run(command, args, cwd, timeoutMs = 30_000, input = null) {
  if (receivedSignal !== null) {
    fail("SMOKE_INTERRUPTED", "smoke was interrupted");
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: [input === null ? "ignore" : "pipe", "pipe", "pipe"]
    });
    if (child.pid !== undefined) {
      activeChildren.add(child.pid);
    }
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminate(child.pid ?? 0);
    }, timeoutMs);
    const collect = (target, chunk) => {
      bytes += chunk.byteLength;
      if (bytes > 4 * 1024 * 1024) {
        terminate(child.pid ?? 0);
        return;
      }
      if (target === "stdout") {
        stdout += chunk.toString("utf8");
      } else {
        stderr += chunk.toString("utf8");
      }
    };
    child.stdout.on("data", (chunk) => collect("stdout", chunk));
    child.stderr.on("data", (chunk) => collect("stderr", chunk));
    if (input !== null) {
      child.stdin.on("error", () => {
        // Exit handling below owns an early close or rejected input.
      });
      child.stdin.end(input);
    }
    child.once("error", (error) => {
      clearTimeout(timer);
      if (child.pid !== undefined) {
        activeChildren.delete(child.pid);
      }
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (child.pid !== undefined) {
        activeChildren.delete(child.pid);
      }
      if (receivedSignal !== null) {
        reject(new SmokeError("SMOKE_INTERRUPTED", "smoke was interrupted"));
        return;
      }
      if (timedOut) {
        reject(
          new SmokeError("SMOKE_TIMEOUT", "subprocess exceeded its timeout")
        );
        return;
      }
      if (bytes > 4 * 1024 * 1024) {
        reject(
          new SmokeError(
            "SMOKE_OUTPUT_LIMIT",
            "subprocess output exceeded its limit"
          )
        );
        return;
      }
      resolve({ exitCode: code ?? 1, signal, stdout, stderr });
    });
  });
}

async function runCli(bundle, cwd, args, label, expectedStderr = "") {
  let result;
  try {
    result = await run(process.execPath, [bundle, ...args], cwd);
  } catch (error) {
    if (error instanceof SmokeError) {
      throw error;
    }
    fail("SMOKE_SUBPROCESS_FAILED", `${label} could not start`);
  }
  if (result.exitCode !== 0 || result.signal !== null) {
    fail("SMOKE_NON_ZERO", `${label} exited unsuccessfully`);
  }
  if (result.stderr !== expectedStderr) {
    fail("SMOKE_STDERR", `${label} wrote unexpected stderr`);
  }
  return result.stdout;
}

async function runCliWithInput(bundle, cwd, args, input, label) {
  let result;
  try {
    result = await run(process.execPath, [bundle, ...args], cwd, 30_000, input);
  } catch (error) {
    if (error instanceof SmokeError) throw error;
    fail("SMOKE_SUBPROCESS_FAILED", `${label} could not start`);
  }
  if (result.exitCode !== 0 || result.signal !== null) {
    fail("SMOKE_NON_ZERO", `${label} exited unsuccessfully`);
  }
  if (result.stderr.length !== 0) {
    fail("SMOKE_STDERR", `${label} wrote unexpected stderr`);
  }
  return result.stdout;
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    fail("SMOKE_MALFORMED_JSON", `${label} did not return valid JSON`);
  }
}

function requireIdentity(value, schema, schemaVersion, label) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    value.schema !== schema ||
    value.schemaVersion !== schemaVersion
  ) {
    fail("SMOKE_CONTRACT_MISMATCH", `${label} returned an unexpected contract`);
  }
}

async function snapshotTree(root) {
  const entries = [];
  async function visit(directory, prefix) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const absolutePath = path.join(directory, child.name);
      const relativePath =
        prefix.length === 0 ? child.name : `${prefix}/${child.name}`;
      const stats = await lstat(absolutePath);
      const mode = stats.mode & 0o777;
      if (child.isDirectory()) {
        entries.push([relativePath, "directory", mode, ""]);
        await visit(absolutePath, relativePath);
      } else if (child.isSymbolicLink()) {
        entries.push([
          relativePath,
          "symlink",
          mode,
          await readlink(absolutePath)
        ]);
      } else if (child.isFile()) {
        const contents = await readFile(absolutePath);
        entries.push([
          relativePath,
          "file",
          mode,
          createHash("sha256").update(contents).digest("hex")
        ]);
      } else {
        entries.push([relativePath, "other", mode, ""]);
      }
    }
  }
  await visit(root, "");
  return JSON.stringify(entries);
}

async function setupRepository(root, bundle, expectedVersion) {
  await run("git", ["init", "--initial-branch=main"], root).then((result) => {
    if (result.exitCode !== 0) {
      fail("SMOKE_GIT_FAILED", "git init failed");
    }
  });
  await run("git", ["config", "user.name", "Banzai Smoke"], root);
  await run("git", ["config", "user.email", "smoke@example.invalid"], root);
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "banzai-smoke", private: true }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(root, "smoke.js"),
    "export const smoke = true;\n",
    "utf8"
  );

  await writeFile(
    path.join(root, "AGENTS.md"),
    "## Authority\nFollow user decisions.\n## Policies\nUse installed Banzai policies.\n"
  );
  const guidanceSections = [
    "Project Overview",
    "Platform & Tooling",
    "Architecture",
    "Project Structure",
    "Key Modules & Components",
    "State & Data Flow",
    "Dependencies",
    "Testing",
    "Conventions",
    "Technical Constraints & Decision Index"
  ];
  await writeFile(
    path.join(root, "PROJECT_MANIFEST.md"),
    "# Smoke fixture\n" +
      guidanceSections
        .map(
          (name, index) =>
            `## ${index + 1}. ${name}\nDisposable deterministic CLI fixture; no application behavior.\n`
        )
        .join("")
  );

  const help = await runCli(bundle, root, ["help"], "help");
  if (
    help.split("\n")[0] !==
    `Banzai v${expectedVersion} local cross-vendor workflow runner`
  ) {
    fail(
      "SMOKE_VERSION_MISMATCH",
      "help version differs from package metadata"
    );
  }
  if (
    !help.includes("Usage:") ||
    !help.includes("banzai init") ||
    !help.includes("Five human decision gates remain distinct") ||
    !help.includes("banzai-agent-answer/v2") ||
    !help.includes(
      "banzai eval context [--json] [--from <RFC3339>] [--to <RFC3339>] [--run <run-id>]..."
    )
  ) {
    fail("SMOKE_HELP_MISMATCH", "help output is incomplete");
  }
  await runCli(bundle, root, ["init"], "init");

  const configPath = path.join(root, ".banzai", "config.json");
  const config = parseJson(await readFile(configPath, "utf8"), "init config");
  if (config.schemaVersion !== 2 || config.contractVersion !== "1.0.0") {
    fail(
      "SMOKE_CONFIG_MISMATCH",
      "init did not create schema-version-2 config"
    );
  }
  for (const role of ["planner", "implementer", "reviewer"]) {
    config.models[role].executable = process.execPath;
  }
  config.verification = {
    profiles: [
      {
        id: "repository",
        projectType: "repository",
        commands: [
          {
            name: "git diff check",
            command: "git",
            args: ["diff", "--check"],
            timeoutMs: 120000
          }
        ]
      },
      {
        id: "node",
        projectType: "node",
        commands: [
          {
            name: "node syntax check",
            command: "node",
            args: ["--check", "smoke.js"],
            timeoutMs: 120000
          }
        ]
      }
    ]
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await chmod(configPath, 0o644);
}

async function setupConsultationRun(root) {
  const runId = "20260901000000-smoke-consultation-12345678";
  const timestamp = "2026-09-01T00:00:00.000Z";
  const request = {
    schema: "banzai-decision-consultation/v1",
    schemaVersion: 1,
    requestId: "smoke-request-1",
    roundId: "smoke-round-1",
    decisions: [
      {
        decisionId: "smoke-storage",
        title: "Smoke storage",
        question: "Where should the smoke answer persist?",
        why: "The committed bundle must preserve keyed human provenance.",
        affectedRequirements: ["FR15", "FR21"],
        evidence: [
          {
            path: "packages/orchestrator/src/store.ts",
            line: 389,
            detail: "Run state owns durable decision history."
          }
        ],
        decisionOwner: "human",
        responseMode: "single_choice",
        options: [
          {
            optionId: "run-state",
            title: "Run state",
            benefits: ["Survives a fresh session."],
            costs: ["Requires state schema v3."],
            risks: ["Legacy readers need explicit handling."],
            consequences: ["The runner retains provenance."]
          },
          {
            optionId: "session-only",
            title: "Session only",
            benefits: ["No persisted record."],
            costs: ["A fresh session loses the answer."],
            risks: ["Planning can repeat the question."],
            consequences: ["Continuation depends on one session."]
          }
        ],
        recommendation: {
          optionId: "run-state",
          rationale: "Durable continuation requires persisted provenance."
        }
      }
    ]
  };
  const state = {
    schemaVersion: 3,
    contractVersion: "1.0.0",
    runId,
    slug: "smoke-consultation",
    request: "PRIVATE SMOKE REQUEST",
    repoRoot: root,
    status: "needs_human_decision",
    createdAt: timestamp,
    updatedAt: timestamp,
    baseCommit: "a".repeat(40),
    baseline: [],
    workflowSelection: {
      contractVersion: "1.0.0",
      recommendedWorkflow: "strict",
      confidence: "high",
      reason: "The fixture exercises strict planning consultation.",
      escalationTriggers: [],
      workflow: "strict",
      selectedAt: timestamp,
      attemptId: "selection-1-smoke123",
      digest: "b".repeat(64)
    },
    planArtifacts: null,
    planApproval: null,
    planTaskCompletion: null,
    adrDecisions: [],
    pendingHumanDecision: {
      kind: "decision_consultation",
      phase: "plan",
      gate: "decision_consultation",
      summary: "Choose the smoke persistence boundary.",
      request,
      requestedAt: timestamp
    },
    humanDecisions: [],
    sessions: { planner: null, implementer: null, reviewer: null },
    pendingReviewRotationReason: null,
    reviewIteration: 0,
    latestReview: null,
    triage: null,
    triageHistory: [],
    fixCycle: 0,
    workspaceDigest: null,
    verification: [],
    metrics: {
      completedAttemptIds: [],
      attempts: {
        selection: 1,
        plan: 1,
        implementation: 0,
        fix: 0,
        review: 0,
        verification: 0
      },
      modelDurationMs: 0,
      usage: {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        costUsd: null
      },
      reviewFindingCount: 0,
      sessions: { fresh: 1, resumed: 0 },
      reviews: { full: 0, delta: 0, rotations: 0 },
      triage: { accepted: 0, rejected: 0, deferred: 0 }
    },
    activeAttempt: null,
    activeProcess: null,
    recovery: null,
    blockedFrom: null,
    blockReason: null
  };
  const runRoot = path.join(root, ".banzai", "runs", runId);
  await mkdir(runRoot, { recursive: true });
  await writeFile(
    path.join(root, ".banzai", "active-run.json"),
    `${JSON.stringify({ schemaVersion: 1, runId }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runRoot, "state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runRoot, "events.jsonl"),
    `${JSON.stringify({
      at: timestamp,
      type: "decision.consultation.requested",
      runId,
      details: { cardCount: 1, completion: "pending" }
    })}\n`,
    "utf8"
  );
  return { runId, request, runRoot };
}

async function setupLegacyContextRun(root) {
  const legacyRun = path.join(root, ".banzai", "runs", "legacy-context-run");
  const legacyAttempts = path.join(legacyRun, "attempts");
  await mkdir(legacyAttempts, { recursive: true });
  await writeFile(
    path.join(legacyRun, "state.json"),
    `${JSON.stringify(
      {
        runId: "legacy-context-run",
        createdAt: "2026-08-01T00:00:00.000Z",
        workflowSelection: { workflow: "strict" }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(legacyAttempts, "legacy-plan-1-plan.json"),
    `${JSON.stringify(
      {
        attempt: { id: "legacy-plan-1", kind: "plan", mutable: false },
        status: "completed",
        usage: null
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function runSmoke(options) {
  const manifest = parseJson(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
    "package metadata"
  );
  const expectedVersion = manifest.version;
  if (
    typeof expectedVersion !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(expectedVersion)
  ) {
    fail("SMOKE_VERSION_MISMATCH", "package metadata has no canonical version");
  }
  await mkdir(options.scratchParent, { recursive: true });
  const smokeRoot = await mkdtemp(
    path.join(options.scratchParent, "banzai-committed-smoke-")
  );
  let primaryError = null;
  let kpiInputRoot = null;
  try {
    const emptyBefore = await snapshotTree(smokeRoot);
    const capabilitiesFirst = await runCli(
      options.bundle,
      smokeRoot,
      ["control", "capabilities"],
      "agent control capabilities"
    );
    const capabilitiesSecond = await runCli(
      options.bundle,
      smokeRoot,
      ["control", "capabilities"],
      "agent control capabilities repeat"
    );
    const capabilities = parseJson(
      capabilitiesFirst,
      "agent control capabilities"
    );
    requireIdentity(
      capabilities,
      "banzai-agent-capabilities/v3",
      3,
      "agent control capabilities"
    );
    if (capabilities.orchestratorVersion !== expectedVersion) {
      fail(
        "SMOKE_VERSION_MISMATCH",
        "capability version differs from package metadata"
      );
    }
    if (
      capabilities.controlContractVersion !== "3.0.0" ||
      capabilities.operations?.status?.supported !== true ||
      JSON.stringify(capabilities.operations?.start?.inputSchemas) !==
        JSON.stringify(["banzai-agent-request/v1"]) ||
      JSON.stringify(capabilities.operations?.answer?.inputSchemas) !==
        JSON.stringify(["banzai-agent-answer/v2", "banzai-agent-answer/v1"]) ||
      JSON.stringify(capabilities.operations?.recover?.inputSchemas) !==
        JSON.stringify(["banzai-agent-recovery/v1"])
    ) {
      fail(
        "SMOKE_CONTRACT_MISMATCH",
        "agent control capabilities omit required v2 operations"
      );
    }
    if (capabilitiesFirst !== capabilitiesSecond) {
      fail(
        "SMOKE_NONDETERMINISTIC",
        "agent control capabilities changed across identical reads"
      );
    }
    if (emptyBefore !== (await snapshotTree(smokeRoot))) {
      fail(
        "SMOKE_TREE_MUTATION",
        "agent control capabilities changed the scratch directory"
      );
    }

    await setupRepository(smokeRoot, options.bundle, expectedVersion);
    let before = await snapshotTree(smokeRoot);

    const statusFirst = await runCli(
      options.bundle,
      smokeRoot,
      ["control", "status"],
      "agent control status"
    );
    const statusSecond = await runCli(
      options.bundle,
      smokeRoot,
      ["control", "status"],
      "agent control status repeat"
    );
    const status = parseJson(statusFirst, "agent control status");
    requireIdentity(
      status,
      "banzai-agent-status/v2",
      2,
      "agent control status"
    );
    if (status.activeRun !== null) {
      fail(
        "SMOKE_CONTRACT_MISMATCH",
        "agent control status invented an active run"
      );
    }
    if (statusFirst !== statusSecond) {
      fail(
        "SMOKE_NONDETERMINISTIC",
        "agent control status changed across identical reads"
      );
    }

    const doctorFirst = await runCli(
      options.bundle,
      smokeRoot,
      ["doctor", "--json"],
      "doctor"
    );
    const doctorSecond = await runCli(
      options.bundle,
      smokeRoot,
      ["doctor", "--json"],
      "doctor repeat"
    );
    const doctor = parseJson(doctorFirst, "doctor");
    requireIdentity(doctor, "banzai-doctor/v2", 2, "doctor");
    if (doctor.ready !== true) {
      fail(
        "SMOKE_DOCTOR_NOT_READY",
        "doctor did not report a ready repository"
      );
    }
    if (doctorFirst !== doctorSecond) {
      fail(
        "SMOKE_NONDETERMINISTIC",
        "doctor output changed across identical reads"
      );
    }

    const consultation = await setupConsultationRun(smokeRoot);
    const consultationStatusText = await runCli(
      options.bundle,
      smokeRoot,
      ["control", "status"],
      "consultation status"
    );
    const consultationStatus = parseJson(
      consultationStatusText,
      "consultation status"
    );
    requireIdentity(
      consultationStatus,
      "banzai-agent-status/v2",
      2,
      "consultation status"
    );
    if (
      consultationStatus.activeRun?.runId !== consultation.runId ||
      consultationStatus.activeRun?.nextAction !== "answer_consultation" ||
      consultationStatus.activeRun?.pendingGate?.kind !==
        "decision_consultation" ||
      JSON.stringify(consultationStatus.activeRun.pendingGate.request) !==
        JSON.stringify(consultation.request) ||
      consultationStatusText.includes("PRIVATE SMOKE REQUEST")
    ) {
      fail(
        "SMOKE_CONTRACT_MISMATCH",
        "consultation status did not expose only the exact current action"
      );
    }
    const preference = "  Keep smoke local | $(never)\nwithout shell.  ";
    const answerDocument = {
      schema: "banzai-agent-answer/v2",
      schemaVersion: 2,
      runId: consultation.runId,
      requestId: consultation.request.requestId,
      roundId: consultation.request.roundId,
      answers: [
        {
          decisionId: consultation.request.decisions[0].decisionId,
          response: {
            kind: "preference",
            optionId: null,
            text: preference
          },
          note: "Exact smoke preference."
        }
      ]
    };
    const answeredText = await runCliWithInput(
      options.bundle,
      smokeRoot,
      ["control", "answer", "--by", "Smoke User", "--no-resume"],
      `${JSON.stringify(answerDocument)}\n`,
      "consultation answer"
    );
    const answered = parseJson(answeredText, "consultation answer");
    requireIdentity(
      answered,
      "banzai-agent-status/v2",
      2,
      "consultation answer"
    );
    if (
      answered.activeRun?.state !== "planning" ||
      answered.activeRun?.pendingGate !== null ||
      answeredText.includes(preference) ||
      answeredText.includes("Smoke User") ||
      answeredText.includes("Where should the smoke answer persist?")
    ) {
      fail(
        "SMOKE_CONTRACT_MISMATCH",
        "answered consultation leaked history or retained the pending gate"
      );
    }
    const persisted = parseJson(
      await readFile(path.join(consultation.runRoot, "state.json"), "utf8"),
      "answered consultation state"
    );
    if (
      persisted.humanDecisions?.[0]?.answers?.[0]?.response?.text !==
        preference ||
      persisted.humanDecisions?.[0]?.decidedBy !== "Smoke User"
    ) {
      fail(
        "SMOKE_CONTRACT_MISMATCH",
        "consultation answer did not preserve exact human provenance"
      );
    }
    const consultationEvents = (
      await readFile(path.join(consultation.runRoot, "events.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => parseJson(line, "consultation event"));
    if (
      JSON.stringify(
        consultationEvents.map((event) => [event.type, event.details])
      ) !==
      JSON.stringify([
        [
          "decision.consultation.requested",
          { cardCount: 1, completion: "pending" }
        ],
        [
          "decision.consultation.answered",
          {
            cardCount: 1,
            answerModes: { option: 0, preference: 1 },
            completion: "answered"
          }
        ]
      ])
    ) {
      fail(
        "SMOKE_CONTRACT_MISMATCH",
        "consultation lifecycle events are not count-only"
      );
    }
    const eventText = JSON.stringify(consultationEvents);
    for (const forbidden of [
      preference,
      "Smoke User",
      consultation.request.requestId,
      consultation.request.roundId,
      consultation.request.decisions[0].decisionId,
      consultation.request.decisions[0].question,
      consultation.request.decisions[0].evidence[0].path
    ]) {
      if (eventText.includes(forbidden)) {
        fail(
          "SMOKE_CONTRACT_MISMATCH",
          "consultation lifecycle events leaked private content"
        );
      }
    }
    before = await snapshotTree(smokeRoot);

    const evaluationFirst = await runCli(
      options.bundle,
      smokeRoot,
      ["eval", "export", "--json"],
      "evaluation",
      "[EVAL_PARTIAL] Export includes incomplete evidence; inspect the structured issues in the report.\n"
    );
    const evaluationSecond = await runCli(
      options.bundle,
      smokeRoot,
      ["eval", "export", "--json"],
      "evaluation repeat",
      "[EVAL_PARTIAL] Export includes incomplete evidence; inspect the structured issues in the report.\n"
    );
    requireIdentity(
      parseJson(evaluationFirst, "evaluation"),
      "banzai-evaluation-export/v1",
      1,
      "evaluation"
    );
    for (const forbidden of [
      preference,
      "Smoke User",
      consultation.request.requestId,
      consultation.request.decisions[0].question,
      consultation.request.decisions[0].evidence[0].path
    ]) {
      if (evaluationFirst.includes(forbidden)) {
        fail(
          "SMOKE_CONTRACT_MISMATCH",
          "evaluation leaked consultation history"
        );
      }
    }
    if (evaluationFirst !== evaluationSecond) {
      fail(
        "SMOKE_NONDETERMINISTIC",
        "evaluation output changed across identical reads"
      );
    }

    const unknownEval = await run(
      process.execPath,
      [options.bundle, "eval", "unknown"],
      smokeRoot
    );
    if (
      unknownEval.exitCode === 0 ||
      unknownEval.stdout.length !== 0 ||
      !unknownEval.stderr.includes(
        "Eval target must be `export`, `kpi`, `context`, or `cancellations`."
      )
    ) {
      fail(
        "SMOKE_EVAL_TARGET_DIAGNOSTIC",
        "unknown eval target did not fail with the stable four-target diagnostic"
      );
    }

    const kpiFirst = await runCli(
      options.bundle,
      smokeRoot,
      ["eval", "kpi", "--json"],
      "evaluation kpi"
    );
    const kpiSecond = await runCli(
      options.bundle,
      smokeRoot,
      ["eval", "kpi", "--json"],
      "evaluation kpi repeat"
    );
    requireIdentity(
      parseJson(kpiFirst, "evaluation kpi"),
      "banzai-evaluation-kpi/v1",
      1,
      "evaluation kpi"
    );
    if (kpiFirst !== kpiSecond) {
      fail(
        "SMOKE_NONDETERMINISTIC",
        "evaluation kpi output changed across identical reads"
      );
    }

    // The --input projection must work from a plain directory: it reads only
    // the named export files and never requires a Git checkout.
    kpiInputRoot = await mkdtemp(
      path.join(options.scratchParent, "banzai-kpi-input-")
    );
    const kpiInputPath = path.join(kpiInputRoot, "export.json");
    await writeFile(kpiInputPath, evaluationFirst, "utf8");
    const kpiInputFirst = await runCli(
      options.bundle,
      kpiInputRoot,
      ["eval", "kpi", "--input", kpiInputPath, "--json"],
      "evaluation kpi input"
    );
    const kpiInputSecond = await runCli(
      options.bundle,
      kpiInputRoot,
      ["eval", "kpi", "--input", kpiInputPath, "--json"],
      "evaluation kpi input repeat"
    );
    const kpiInput = parseJson(kpiInputFirst, "evaluation kpi input");
    requireIdentity(
      kpiInput,
      "banzai-evaluation-kpi/v1",
      1,
      "evaluation kpi input"
    );
    if (kpiInput.sources?.[0]?.label !== "1: export.json") {
      fail(
        "SMOKE_CONTRACT_MISMATCH",
        "evaluation kpi input label is not the ordinal basename"
      );
    }
    if (kpiInputFirst !== kpiInputSecond) {
      fail(
        "SMOKE_NONDETERMINISTIC",
        "evaluation kpi input output changed across identical reads"
      );
    }

    await setupLegacyContextRun(smokeRoot);
    before = await snapshotTree(smokeRoot);
    const contextFirst = await runCli(
      options.bundle,
      smokeRoot,
      ["eval", "context", "--json"],
      "context evaluation"
    );
    const contextSecond = await runCli(
      options.bundle,
      smokeRoot,
      ["eval", "context", "--json"],
      "context evaluation repeat"
    );
    const context = parseJson(contextFirst, "context evaluation");
    requireIdentity(
      context,
      "banzai-context-report/v1",
      1,
      "context evaluation"
    );
    if (context.coverage?.exact !== 0 || context.coverage?.incomplete !== 1) {
      fail(
        "SMOKE_CONTRACT_MISMATCH",
        "context evaluation did not preserve the historical evidence gap"
      );
    }
    if (contextFirst !== contextSecond) {
      fail(
        "SMOKE_NONDETERMINISTIC",
        "context evaluation output changed across identical reads"
      );
    }

    const after = await snapshotTree(smokeRoot);
    if (before !== after) {
      fail(
        "SMOKE_TREE_MUTATION",
        "read-only commands changed the scratch repository"
      );
    }
  } catch (error) {
    primaryError = error;
  } finally {
    for (const pid of activeChildren) {
      terminate(pid);
    }
    try {
      await rm(smokeRoot, { recursive: true, force: true });
      if (kpiInputRoot !== null) {
        await rm(kpiInputRoot, { recursive: true, force: true });
      }
    } catch {
      primaryError = new SmokeError(
        "SMOKE_CLEANUP_FAILED",
        "scratch cleanup failed"
      );
    }
  }
  if (primaryError !== null) {
    throw primaryError;
  }
}

try {
  await runSmoke(parseArguments(process.argv.slice(2)));
  process.stdout.write("committed smoke passed\n");
} catch (error) {
  const message =
    error instanceof SmokeError
      ? error.message
      : "SMOKE_FAILED: unexpected committed smoke failure";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
