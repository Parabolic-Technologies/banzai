import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DEFAULT_CONFIG } from "../src/config.js";
import type {
  OrchestratorConfig,
  VerificationAttemptRecord,
  VerificationAttemptStatus
} from "../src/types.js";

import { writeAdoptedGuidance } from "./adoption-fixtures.js";

const execFileAsync = promisify(execFile);

/**
 * Codex plans and implements and Claude only reviews. Tests of vendor-dependent
 * behavior pin this layout so they do not follow the shipped defaults.
 */
export function reviewerOnlyClaudeConfig(): OrchestratorConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  config.models.planner.executable = "codex";
  config.models.planner.model = "gpt-6.1-sol";
  config.models.implementer.executable = "codex";
  config.models.implementer.model = "gpt-6.1-sol";
  config.models.reviewer.executable = "claude";
  config.models.reviewer.model = "claude-opus-5-5";
  return config;
}

export interface TreeSnapshotEntry {
  path: string;
  type: "directory" | "file";
  contents: string | null;
}

export const EVALUATION_CREATED_AT = "2026-07-01T00:00:00.000Z";

export interface EvaluationStateFixtureOptions {
  schemaVersion?: 1 | 2 | 3;
  status?: string;
  workflow?: "quick-fix" | "feature" | "strict";
  createdAt?: string;
  reviewIteration?: number;
  appliedReviewIteration?: number;
  fixCycle?: number;
  verification?: unknown[];
  triageHistory?: unknown[];
  attempts?: Partial<
    Record<
      | "selection"
      | "plan"
      | "implementation"
      | "fix"
      | "review"
      | "verification",
      number
    >
  >;
  usage?: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    costUsd: number | null;
  };
  sessions?: { fresh: number; resumed: number };
  reviews?: { full: number; delta: number; rotations: number };
  reviewFindingCount?: number;
  triageMetrics?: { accepted: number; rejected: number; deferred: number };
  extra?: Record<string, unknown>;
}

export function evaluationStateFixture(
  options: EvaluationStateFixtureOptions = {}
): Record<string, unknown> {
  const schemaVersion = options.schemaVersion ?? 2;
  const reviewIteration = options.reviewIteration ?? 0;
  const appliedReviewIteration =
    options.appliedReviewIteration ?? reviewIteration;
  const attempts: Record<string, number> = {
    selection: 0,
    plan: 0,
    implementation: 0,
    fix: 0,
    review: 0,
    verification: 0,
    ...options.attempts
  };
  const metrics: Record<string, unknown> = {
    attempts,
    usage: options.usage ?? {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      costUsd: null
    },
    reviewFindingCount: options.reviewFindingCount ?? 0,
    triage: options.triageMetrics ?? {
      accepted: 0,
      rejected: 0,
      deferred: 0
    }
  };
  if (schemaVersion >= 2) {
    metrics.sessions = options.sessions ?? { fresh: 0, resumed: 0 };
    metrics.reviews = options.reviews ?? { full: 0, delta: 0, rotations: 0 };
  } else {
    delete attempts.selection;
  }
  const state: Record<string, unknown> = {
    schemaVersion,
    contractVersion: "1.0.0",
    runId: "FORBIDDEN-RUN-ID",
    slug: "FORBIDDEN-FEATURE-SLUG",
    request: "FORBIDDEN-REQUEST-TEXT",
    repoRoot: "/FORBIDDEN/REPOSITORY/PATH",
    status: options.status ?? "done",
    createdAt: options.createdAt ?? EVALUATION_CREATED_AT,
    updatedAt: options.createdAt ?? EVALUATION_CREATED_AT,
    workflowSelection: {
      workflow: options.workflow ?? "strict",
      reason: "FORBIDDEN-WORKFLOW-REASON"
    },
    reviewIteration,
    latestReview:
      appliedReviewIteration === 0
        ? null
        : {
            iteration: appliedReviewIteration,
            resultPath: `reviews/review-${appliedReviewIteration}.json`,
            artifactPath: "FORBIDDEN-REVIEW-ARTIFACT-PATH",
            workspaceDigest: "FORBIDDEN-WORKSPACE-DIGEST",
            verdict: "pass",
            sessionMode: "fresh",
            mode: "full",
            rotationReason: "primary-review"
          },
    fixCycle: options.fixCycle ?? 0,
    blockedFrom: null,
    blockReason: "FORBIDDEN-BLOCK-REASON",
    activeAttempt: null,
    activeProcess: null,
    verification: options.verification ?? [],
    metrics,
    triage: null,
    triageHistory: options.triageHistory ?? [],
    ...options.extra
  };
  if (schemaVersion === 1) {
    delete state.workflowSelection;
    delete state.triageHistory;
  }
  return state;
}

export interface EvaluationAttemptFixtureOptions {
  id: string;
  kind: "selection" | "plan" | "implementation" | "fix" | "review";
  status?: "started" | "completed" | "failed";
  startedAt?: string;
  durationMs?: number | null;
  sessionMode?: "fresh" | "resumed";
  reviewMode?: "full" | "delta";
  rotationReason?: string | null;
  usage?: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    costUsd: number | null;
  } | null;
  legacy?: boolean;
}

export function evaluationAttemptFixture(
  options: EvaluationAttemptFixtureOptions
): Record<string, unknown> {
  const status = options.status ?? "completed";
  const startedAt = options.startedAt ?? "2026-07-01T00:01:00.000Z";
  const durationMs =
    options.durationMs === undefined ? 1_000 : options.durationMs;
  const completedAt =
    status === "started" || durationMs === null
      ? null
      : new Date(Date.parse(startedAt) + durationMs).toISOString();
  const attempt: Record<string, unknown> = {
    schemaVersion: 1,
    attempt: {
      id: options.id,
      kind: options.kind,
      mutable: options.kind !== "selection" && options.kind !== "review"
    },
    status,
    startedAt,
    completedAt,
    durationMs,
    result: { summary: "FORBIDDEN-MODEL-OUTPUT" },
    sessionId: "FORBIDDEN-SESSION-ID",
    rawStdoutPath: "/FORBIDDEN/RAW-STDOUT",
    rawStderrPath: "/FORBIDDEN/RAW-STDERR",
    error: "FORBIDDEN-ATTEMPT-ERROR",
    usage:
      options.usage === undefined
        ? {
            inputTokens: 10,
            cachedInputTokens: 2,
            outputTokens: 3,
            costUsd: 0.25
          }
        : options.usage
  };
  if (options.legacy !== true) {
    attempt.sessionMode = options.sessionMode ?? "fresh";
    attempt.reviewMode =
      options.kind === "review" ? (options.reviewMode ?? "full") : null;
    attempt.rotationReason =
      options.kind === "review"
        ? (options.rotationReason ?? "primary-review")
        : null;
    attempt.sessionContext = {
      role: options.kind === "review" ? "reviewer" : "implementer",
      executable: "/usr/local/bin/codex",
      model: "gpt-evaluation-model",
      effort: "high"
    };
  }
  return attempt;
}

export interface EvaluationRunFixture {
  state: Record<string, unknown>;
  attempts?: Record<string, unknown>[];
  events?: unknown[];
  reviews?: { ordinal: number; value: unknown }[];
}

export async function createEvaluationRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-evaluation-test-"));
  await mkdir(path.join(root, ".banzai", "runs"), { recursive: true });
  return root;
}

export async function writeEvaluationRun(
  root: string,
  runId: string,
  fixture: EvaluationRunFixture
): Promise<void> {
  const directory = path.join(root, ".banzai", "runs", runId);
  await mkdir(path.join(directory, "attempts"), { recursive: true });
  await mkdir(path.join(directory, "reviews"), { recursive: true });
  await writeFile(
    path.join(directory, "state.json"),
    JSON.stringify(fixture.state),
    "utf8"
  );
  await writeFile(
    path.join(directory, "events.jsonl"),
    (fixture.events ?? []).map((event) => JSON.stringify(event)).join("\n") +
      ((fixture.events?.length ?? 0) > 0 ? "\n" : ""),
    "utf8"
  );
  for (const [index, attempt] of (fixture.attempts ?? []).entries()) {
    await writeFile(
      path.join(
        directory,
        "attempts",
        `attempt-${String(index + 1).padStart(2, "0")}.json`
      ),
      JSON.stringify(attempt),
      "utf8"
    );
  }
  for (const review of fixture.reviews ?? []) {
    await writeFile(
      path.join(directory, "reviews", `review-${review.ordinal}.json`),
      JSON.stringify(review.value),
      "utf8"
    );
  }
}

export function verificationAttemptFixture(options: {
  sequence: number;
  status?: VerificationAttemptStatus;
  roundOrdinal?: number;
  sourceAttemptId?: string;
  profileOrdinal?: number;
  commandOrdinal?: number;
  restartOf?: string | null;
}): VerificationAttemptRecord {
  const status = options.status ?? "completed";
  const startedAt = `2026-07-01T00:${String(options.sequence).padStart(2, "0")}:00.000Z`;
  const terminal = status !== "started";
  const failed = status === "failed";
  const interrupted = status === "interrupted";
  const id = `verification-attempt-${options.sequence}`;
  const log = (stream: "stdout" | "stderr") => ({
    relativePath: `verification/${String(options.sequence).padStart(6, "0")}-${stream}.log`,
    sha256: (stream === "stdout" ? "a" : "b").repeat(64)
  });
  return {
    schemaVersion: 1,
    id,
    sequence: options.sequence,
    round: {
      id: `verification-round-${options.roundOrdinal ?? 1}`,
      ordinal: options.roundOrdinal ?? 1,
      sourcePhase: "implementation",
      sourceAttemptId: options.sourceAttemptId ?? "implementation-1-fixture",
      sourceAttemptKind: "implementation"
    },
    command: {
      profileId: "node-primary",
      projectType: "node",
      profileOrdinal: options.profileOrdinal ?? 1,
      commandOrdinal: options.commandOrdinal ?? 1,
      configurationDigest: "c".repeat(64)
    },
    status,
    startedAt,
    completedAt: terminal
      ? `2026-07-01T00:${String(options.sequence).padStart(2, "0")}:01.000Z`
      : null,
    durationMs: terminal ? 1_000 : null,
    exitCode: failed ? 7 : status === "completed" ? 0 : null,
    signal: null,
    failureCategory: failed
      ? "command_exit"
      : interrupted
        ? "runner_failure"
        : null,
    retryOf: null,
    restartOf: options.restartOf ?? null,
    stdout: status === "completed" || failed ? log("stdout") : null,
    stderr: status === "completed" || failed ? log("stderr") : null
  };
}

export async function writeVerificationLedger(
  root: string,
  runId: string,
  records: readonly unknown[],
  marker: unknown = { schemaVersion: 1 }
): Promise<void> {
  const directory = path.join(
    root,
    ".banzai",
    "runs",
    runId,
    "verification-attempts"
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "ledger.json"),
    JSON.stringify(marker),
    "utf8"
  );
  for (const [index, record] of records.entries()) {
    await writeFile(
      path.join(
        directory,
        `verification-fixture-${String(index + 1).padStart(2, "0")}.json`
      ),
      JSON.stringify(record),
      "utf8"
    );
  }
}

/**
 * A child environment that renders without colour whatever shell runs the
 * suite. `NO_COLOR` alone is not enough: Node and the prompt libraries let an
 * inherited `FORCE_COLOR` override it, and Node then warns on stderr that
 * `NO_COLOR` is ignored, so the override is dropped here.
 */
export function monochromeEnv(
  overrides: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...overrides,
    NO_COLOR: "1"
  };
  delete env.FORCE_COLOR;
  return env;
}

export async function snapshotTree(root: string): Promise<TreeSnapshotEntry[]> {
  const entries: TreeSnapshotEntry[] = [];
  async function visit(directory: string, prefix: string): Promise<void> {
    let children;
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const relativePath =
        prefix.length === 0 ? child.name : `${prefix}/${child.name}`;
      const absolutePath = path.join(directory, child.name);
      if (child.isDirectory()) {
        entries.push({ path: relativePath, type: "directory", contents: null });
        await visit(absolutePath, relativePath);
      } else if (child.isFile()) {
        entries.push({
          path: relativePath,
          type: "file",
          contents: (await readFile(absolutePath)).toString("base64")
        });
      }
    }
  }
  await visit(root, "");
  return entries;
}

export async function commitAll(root: string, message: string): Promise<void> {
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-qm", message], { cwd: root });
}

export async function createTestRepository(
  options: { artifactLayout?: "legacy" | "private" | null } = {}
): Promise<{
  root: string;
  dispose(): Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-orchestrator-test-"));
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "tests@banzai.local"], {
    cwd: root
  });
  await execFileAsync("git", ["config", "user.name", "Banzai Tests"], {
    cwd: root
  });
  await execFileAsync("git", ["config", "commit.gpgsign", "false"], {
    cwd: root
  });

  const config = structuredClone(DEFAULT_CONFIG);
  config.models.planner.executable = process.execPath;
  config.models.implementer.executable = process.execPath;
  config.models.reviewer.executable = process.execPath;
  config.verification.profiles = [
    {
      id: "custom",
      projectType: "custom",
      commands: [
        {
          name: "deterministic check",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          timeoutMs: 10_000
        }
      ]
    }
  ];

  await mkdir(path.join(root, ".banzai"), { recursive: true });
  await writeFile(
    path.join(root, ".banzai", "config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(root, ".gitignore"),
    ".banzai/runs/\n.banzai/active-run.json\n.banzai/runner.lock\n.banzai/work/\n.banzai/.artifact-init.lock\n",
    "utf8"
  );
  // Existing suites characterize the established documentation layout. New-storage
  // fixtures opt into first-use discovery or private storage explicitly.
  if (options.artifactLayout !== null)
    await writeFile(
      path.join(root, ".banzai/artifacts.json"),
      JSON.stringify({
        schema: "banzai-artifact-layout/v1",
        schemaVersion: 1,
        layout: options.artifactLayout ?? "legacy"
      }) + "\n"
    );
  await writeAdoptedGuidance(root);
  await writeFile(path.join(root, "base.txt"), "base\n", "utf8");
  await commitAll(root, "initial");

  return {
    root,
    dispose: async () => {
      await rm(root, { recursive: true, force: true });
    }
  };
}

/** Assert required fixture structure without weakening production decoders. */
export function requiredFixture<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error("Required fixture value is missing.");
  return value;
}
