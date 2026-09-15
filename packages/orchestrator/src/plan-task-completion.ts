import {
  parseVerificationConfiguration,
  parseVerificationObligations
} from "./verification-evidence.js";
import {
  inspectBoundWork,
  safePath,
  type ArtifactBoundWork
} from "./artifact-storage.js";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { BanzaiError } from "./errors.js";
import {
  digestArtifactBundle,
  workspaceSnapshot,
  type WorkspaceEntry
} from "./git.js";
import {
  PLAN_TASK_COMPLETION_SCHEMA_VERSION,
  type ApprovalRecord,
  type PersistedPhaseResult,
  type PhaseOutcome,
  type PlanTaskCompletionLedger,
  type PlanTaskCompletionRecord,
  type PlanTaskCompletionViolation,
  type ValidPlanTaskCompletionSummary
} from "./types.js";

const PROJECTION_FORMAT = "banzai-plan-task-completion/v1";
const SECTION_HEADING = "## Plan Task Completion";
const TASK_HEADING = /^- \[ \] \*\*(T[0-9]{3}) - (.+)\*\*\s*$/u;
const CHECKBOX_HEADING = /^\s*- \[[ xX]\] \*\*/u;
const FORBIDDEN_PATH_SEGMENTS = new Set([
  ".git",
  ".banzai",
  "node_modules",
  ".cache",
  "coverage",
  "dist"
]);

export class PlanTaskCompletionError extends BanzaiError {
  readonly violation: PlanTaskCompletionViolation;
  readonly taskId: string | null;

  constructor(
    violation: PlanTaskCompletionViolation,
    message: string,
    taskId: string | null = null
  ) {
    super("PLAN_TASK_COMPLETION_INVALID", message.slice(0, 500));
    this.name = "PlanTaskCompletionError";
    this.violation = violation;
    this.taskId = taskId;
  }
}

function completionFailure(
  violation: PlanTaskCompletionViolation,
  message: string,
  taskId: string | null = null
): never {
  throw new PlanTaskCompletionError(violation, message, taskId);
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Only executable task bodies are guarded; prerequisite prose creates no write grant. */
export function validatePlanRunnerControlTasks(
  markdown: string,
  repoRoot: string,
  allowedArtifactPaths: readonly string[]
): void {
  parseApprovedPlanTaskIds(markdown);
  const section =
    markdown.split(/^## Implementation Tasks\s*$/mu)[1]?.split(/^## /mu)[0] ??
    "";
  const allowed = new Set(
    allowedArtifactPaths.map((value) =>
      path.posix.normalize(value.replaceAll("\\", "/"))
    )
  );
  const root = repoRoot.replaceAll("\\", "/").replace(/\/$/u, "");
  let taskId = "unknown";
  for (const line of section.split("\n")) {
    taskId = TASK_HEADING.exec(line)?.[1] ?? taskId;
    for (const raw of line.split(/[\s*`'"<>()[\]{},;]+/u)) {
      const token = raw
        .replaceAll("\\", "/")
        .replace(/:\d+(?::\d+)?$/u, "")
        .replace(/[.!?]+$/u, "");
      const normalized = path.posix.normalize(
        path.posix.isAbsolute(token) || /^[a-z]:\//iu.test(token)
          ? token
          : `${root}/${token}`
      );
      const relative = normalized
        .toLowerCase()
        .startsWith(`${root.toLowerCase()}/`)
        ? normalized.slice(root.length + 1)
        : normalized;
      if (
        (relative.toLowerCase() === ".banzai" ||
          relative.toLowerCase().startsWith(".banzai/")) &&
        !allowed.has(relative)
      ) {
        throw new BanzaiError(
          "PLAN_RUNNER_CONTROL_TASK",
          `Plan task ${taskId} names runner control path ${JSON.stringify(relative.slice(0, 240))}. Remove that task and record missing configuration in Human prerequisites; use banzai verify for runner-owned configuration.`
        );
      }
    }
  }
}

export function planHumanPrerequisites(markdown: string): string | null {
  const text = markdown
    .split(/^## Human prerequisites\s*$/imu)[1]
    ?.split(/^## /mu)[0]
    ?.trim();
  if (text === "") return null;
  return text ?? null;
}

export function parseApprovedPlanTaskIds(markdown: string): string[] {
  const headings = [...markdown.matchAll(/^## Implementation Tasks\s*$/gmu)];
  if (headings.length !== 1) {
    return completionFailure(
      "approved_plan_invalid",
      "Approved plan must contain exactly one Implementation Tasks section."
    );
  }
  const heading = headings[0];
  if (heading === undefined) {
    return completionFailure(
      "approved_plan_invalid",
      "Approved plan is missing its Implementation Tasks section."
    );
  }
  const start = heading.index + heading[0].length;
  const remainder = markdown.slice(start);
  const nextHeading = remainder.search(/^## /mu);
  const section =
    nextHeading === -1 ? remainder : remainder.slice(0, nextHeading);
  const taskIds: string[] = [];
  for (const line of section.split(/\r?\n/u)) {
    const match = TASK_HEADING.exec(line);
    if (match !== null) {
      const taskId = match[1];
      const title = match[2];
      if (taskId === undefined || title === undefined) {
        return completionFailure(
          "approved_plan_invalid",
          "Approved plan contains a malformed task heading."
        );
      }
      if (title.trim().length === 0) {
        return completionFailure(
          "approved_plan_invalid",
          `Approved task ${taskId} has an empty title.`,
          taskId
        );
      }
      taskIds.push(taskId);
    } else if (CHECKBOX_HEADING.test(line)) {
      return completionFailure(
        "approved_plan_invalid",
        "Approved plan contains a checked or malformed task heading."
      );
    }
  }
  if (taskIds.length === 0) {
    return completionFailure(
      "approved_plan_invalid",
      "Approved plan contains no canonical TNNN tasks."
    );
  }
  if (new Set(taskIds).size !== taskIds.length) {
    return completionFailure(
      "approved_plan_invalid",
      "Approved plan contains duplicate task identifiers."
    );
  }
  return taskIds;
}

function escapeCell(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("|", "&#124;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function unescapeCell(value: string): string {
  return value
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&#124;", "|")
    .replaceAll("&amp;", "&");
}

function decodeJsonCell(value: string): string {
  const decoded = unescapeCell(value.trim());
  if (decoded.startsWith("`") && decoded.endsWith("`") && decoded.length >= 2) {
    return decoded.slice(1, -1);
  }
  return decoded;
}

export function renderPlanTaskCompletionProjection(
  ledger: PlanTaskCompletionLedger
): string {
  const rows = ledger.tasks.map(
    (task) =>
      `| ${task.taskId} | ${task.status} | ${escapeCell(JSON.stringify(task.evidence))} | ${escapeCell(JSON.stringify(task.gap))} |`
  );
  return `${SECTION_HEADING}\n\nFormat: \`${PROJECTION_FORMAT}\`\n\n| Task | Status | Evidence | Gap or deviation |\n| --- | --- | --- | --- |\n${rows.join("\n")}`;
}

function decodesToProjectionShapes(
  evidenceJson: string,
  gapJson: string
): boolean {
  try {
    const evidence: unknown = JSON.parse(evidenceJson);
    const gap: unknown = JSON.parse(gapJson);
    return (
      Array.isArray(evidence) &&
      (gap === null || (typeof gap === "object" && !Array.isArray(gap)))
    );
  } catch {
    return false;
  }
}

function parseProjectionCells(
  line: string
): [string, string, string, string] | null {
  const fragments = line.slice(1, -1).split("|");
  if (fragments.length === 4) {
    const [taskId, status, evidenceJson, gapJson] = fragments;
    if (
      taskId === undefined ||
      status === undefined ||
      evidenceJson === undefined ||
      gapJson === undefined
    ) {
      return null;
    }
    return [
      unescapeCell(taskId.trim()),
      unescapeCell(status.trim()),
      decodeJsonCell(evidenceJson),
      decodeJsonCell(gapJson)
    ];
  }
  if (fragments.length < 4) {
    return null;
  }
  // A raw unescaped "|" inside one of the two JSON cells splits the row into
  // extra fragments. Task and Status never contain "|", so rejoin the middle
  // fragments at the boundary where both JSON cells decode to their required
  // shapes; anything but exactly one boundary stays fail-closed.
  const first = fragments[0];
  const second = fragments[1];
  if (first === undefined || second === undefined) {
    return null;
  }
  const middle = fragments.slice(2);
  const candidates: [string, string][] = [];
  for (let boundary = 1; boundary < middle.length; boundary += 1) {
    const evidenceJson = decodeJsonCell(middle.slice(0, boundary).join("|"));
    const gapJson = decodeJsonCell(middle.slice(boundary).join("|"));
    if (decodesToProjectionShapes(evidenceJson, gapJson)) {
      candidates.push([evidenceJson, gapJson]);
    }
  }
  const recovered = candidates.length === 1 ? candidates[0] : undefined;
  if (recovered === undefined) {
    return null;
  }
  return [
    unescapeCell(first.trim()),
    unescapeCell(second.trim()),
    recovered[0],
    recovered[1]
  ];
}

function parseProjectionRecord(line: string): PlanTaskCompletionRecord {
  const cells = parseProjectionCells(line);
  if (cells === null) {
    const rowTask = line.slice(1, -1).split("|")[0]?.trim() ?? "";
    const rowTaskId = /^T[0-9]{3}$/u.test(rowTask) ? rowTask : null;
    return completionFailure(
      "report_projection_invalid",
      `Plan Task Completion row${rowTaskId === null ? "" : ` ${rowTaskId}`} must contain exactly four cells; escape a literal "|" inside the Evidence and Gap JSON cells as "&#124;".`,
      rowTaskId
    );
  }
  const [taskId, status, evidenceJson, gapJson] = cells;
  let evidence: unknown;
  let gap: unknown;
  try {
    evidence = JSON.parse(evidenceJson) as unknown;
    gap = JSON.parse(gapJson) as unknown;
  } catch {
    return completionFailure(
      "report_projection_invalid",
      `Report row ${taskId || "unknown"} contains invalid JSON; use raw JSON or one complete outer Markdown code span, never unmatched or repeated backticks.`,
      /^T[0-9]{3}$/u.test(taskId) ? taskId : null
    );
  }
  if (
    !/^T[0-9]{3}$/u.test(taskId) ||
    !["completed", "incomplete", "blocked"].includes(status) ||
    !Array.isArray(evidence) ||
    !(gap === null || (typeof gap === "object" && !Array.isArray(gap)))
  ) {
    return completionFailure(
      "report_projection_invalid",
      `Report row ${taskId || "unknown"} is malformed.`,
      /^T[0-9]{3}$/u.test(taskId) ? taskId : null
    );
  }
  return {
    taskId,
    status: status as PlanTaskCompletionRecord["status"],
    evidence: evidence as PlanTaskCompletionRecord["evidence"],
    gap: gap as PlanTaskCompletionRecord["gap"]
  };
}

export function parsePlanTaskCompletionProjection(
  markdown: string
): PlanTaskCompletionLedger {
  const headings = [...markdown.matchAll(/^## Plan Task Completion\s*$/gmu)];
  if (headings.length === 0) {
    return completionFailure(
      "report_projection_missing",
      `Implementation report is missing ${SECTION_HEADING}.`
    );
  }
  if (headings.length !== 1) {
    return completionFailure(
      "report_projection_invalid",
      "Implementation report contains duplicate Plan Task Completion sections."
    );
  }
  const heading = headings[0];
  if (heading === undefined) {
    return completionFailure(
      "report_projection_missing",
      `Implementation report is missing ${SECTION_HEADING}.`
    );
  }
  const start = heading.index + heading[0].length;
  const remainder = markdown.slice(start);
  const nextHeading = remainder.search(/^## /mu);
  const section =
    nextHeading === -1 ? remainder : remainder.slice(0, nextHeading);
  const formatLines = section
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("Format:"));
  if (
    formatLines.length !== 1 ||
    formatLines[0] !== `Format: \`${PROJECTION_FORMAT}\``
  ) {
    return completionFailure(
      "report_projection_invalid",
      `Plan Task Completion must declare ${PROJECTION_FORMAT}.`
    );
  }
  const tableLines = section
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));
  if (
    tableLines[0] !== "| Task | Status | Evidence | Gap or deviation |" ||
    tableLines[1] !== "| --- | --- | --- | --- |"
  ) {
    return completionFailure(
      "report_projection_invalid",
      "Plan Task Completion table header is malformed."
    );
  }
  return {
    schemaVersion: PLAN_TASK_COMPLETION_SCHEMA_VERSION,
    tasks: tableLines.slice(2).map(parseProjectionRecord)
  };
}

function normalizedRepositoryPath(
  relativePath: string,
  requiredReports: ReadonlySet<string> = new Set()
): string {
  if (
    relativePath.length === 0 ||
    relativePath.includes("\\") ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(relativePath) ||
    relativePath.length > 500 ||
    path.posix.isAbsolute(relativePath) ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath === ".." ||
    relativePath.startsWith("../")
  ) {
    return completionFailure(
      "invalid_evidence_path",
      "Completion evidence path must be normalized and repository-relative."
    );
  }
  const segments = relativePath.split("/");
  if (
    segments.some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment)) &&
    !requiredReports.has(relativePath)
  ) {
    return completionFailure(
      "evidence_scope_violation",
      "Completion evidence path uses a runner-control, dependency, cache, or build directory."
    );
  }
  return relativePath;
}

async function validateEvidenceFile(
  repoRoot: string,
  relativePath: string,
  allowedPaths: ReadonlySet<string>,
  approvedPaths: ReadonlySet<string>,
  taskId: string,
  requiredReports: ReadonlySet<string>
): Promise<void> {
  const normalized = normalizedRepositoryPath(relativePath, requiredReports);
  if (relativePath.startsWith(".banzai/"))
    await safePath(repoRoot, relativePath);
  if (approvedPaths.has(normalized)) {
    return completionFailure(
      "evidence_scope_violation",
      `${taskId} references evidence outside the authorized changed surface.`,
      taskId
    );
  }
  const repositoryRoot = await realpath(repoRoot);
  const absolutePath = path.resolve(repositoryRoot, normalized);
  let resolvedPath: string;
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(absolutePath);
    resolvedPath = await realpath(absolutePath);
  } catch {
    return completionFailure(
      "missing_evidence_path",
      `${taskId} references a missing evidence file.`,
      taskId
    );
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !resolvedPath.startsWith(`${repositoryRoot}${path.sep}`)
  ) {
    return completionFailure(
      "invalid_evidence_path",
      `${taskId} evidence must be a regular file inside the repository.`,
      taskId
    );
  }
  if (!allowedPaths.has(normalized)) {
    return completionFailure(
      "evidence_scope_violation",
      `${taskId} references evidence outside the authorized changed surface.`,
      taskId
    );
  }
}

export function validatePlanTaskCompletionLedgerShape(
  taskIds: readonly string[],
  ledger: PlanTaskCompletionLedger | null,
  outcome: PhaseOutcome
): void {
  if (ledger === null) {
    return completionFailure(
      "missing_ledger",
      "Strict implementation result is missing taskCompletion."
    );
  }
  const runtimeSchemaVersion: unknown = ledger.schemaVersion;
  if (runtimeSchemaVersion !== PLAN_TASK_COMPLETION_SCHEMA_VERSION) {
    return completionFailure(
      "missing_ledger",
      "Implementation completion ledger has an unsupported schema."
    );
  }
  const seen = new Set<string>();
  for (const [index, task] of ledger.tasks.entries()) {
    if (seen.has(task.taskId)) {
      return completionFailure(
        "duplicate_task",
        `Completion ledger duplicates ${task.taskId}.`,
        task.taskId
      );
    }
    seen.add(task.taskId);
    if (!taskIds.includes(task.taskId)) {
      return completionFailure(
        "unknown_task",
        `Completion ledger contains unknown task ${task.taskId}.`,
        task.taskId
      );
    }
    if (taskIds[index] !== task.taskId) {
      return completionFailure(
        "task_order_mismatch",
        `Completion ledger task ${task.taskId} is outside approved plan order.`,
        task.taskId
      );
    }
    if (!["completed", "incomplete", "blocked"].includes(task.status)) {
      return completionFailure(
        "invalid_task_status",
        `Completion ledger task ${task.taskId} has an invalid status.`,
        task.taskId
      );
    }
    if (task.status === "completed") {
      if (task.evidence.length === 0 || task.gap !== null) {
        return completionFailure(
          "task_status_conflict",
          `Completed task ${task.taskId} requires evidence and no gap.`,
          task.taskId
        );
      }
    } else if (task.gap === null) {
      return completionFailure(
        "invalid_gap_reference",
        `${task.status} task ${task.taskId} requires a gap reference.`,
        task.taskId
      );
    }
    if (outcome === "completed" && task.status !== "completed") {
      return completionFailure(
        "task_status_conflict",
        `Completed implementation outcome contradicts ${task.taskId}=${task.status}.`,
        task.taskId
      );
    }
  }
  if (ledger.tasks.length !== taskIds.length) {
    const missing = taskIds.find((taskId) => !seen.has(taskId)) ?? null;
    return completionFailure(
      "missing_task",
      missing === null
        ? "Completion ledger task count does not match the approved plan."
        : `Completion ledger is missing ${missing}.`,
      missing
    );
  }
}

async function readRequiredReport(
  repoRoot: string,
  relativePath: string | null,
  violation: "implementation_report_missing" | "test_report_missing",
  requiredReports: ReadonlySet<string>
): Promise<{ path: string; contents: string; sha256: string }> {
  if (relativePath === null) {
    return completionFailure(
      violation,
      violation === "implementation_report_missing"
        ? "Implementation result does not identify implementation-report.md."
        : "Implementation result does not identify test-report.md."
    );
  }
  const normalized = normalizedRepositoryPath(relativePath, requiredReports);
  if (relativePath.startsWith(".banzai/"))
    await safePath(repoRoot, relativePath);
  const absolute = path.resolve(repoRoot, normalized);
  let contents: string;
  try {
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("not a regular file");
    }
    const root = await realpath(repoRoot);
    const resolved = await realpath(absolute);
    if (!resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error("outside repository");
    }
    contents = await readFile(absolute, "utf8");
  } catch {
    return completionFailure(
      violation,
      violation === "implementation_report_missing"
        ? "Required implementation report is missing or unsafe."
        : "Required test report is missing or unsafe."
    );
  }
  return {
    path: normalized,
    contents,
    sha256: createHash("sha256").update(contents).digest("hex")
  };
}

export interface ValidatePlanTaskCompletionInput {
  repoRoot: string;
  artifactBinding?: ArtifactBoundWork | undefined;
  sourceAttemptId: string;
  result: PersistedPhaseResult;
  planPath: string;
  approval: ApprovalRecord;
  baseline?: readonly WorkspaceEntry[] | undefined;
  validatedAt?: string | undefined;
}

export interface ValidatedPlanTaskCompletion {
  summary: ValidPlanTaskCompletionSummary;
  tasks: PlanTaskCompletionRecord[];
}

export async function validatePlanTaskCompletion(
  input: ValidatePlanTaskCompletionInput
): Promise<ValidatedPlanTaskCompletion> {
  const requiredReports = new Set<string>();
  if (input.artifactBinding !== undefined) {
    await inspectBoundWork(input.repoRoot, input.artifactBinding);
    const roles = input.artifactBinding.binding.artifacts;
    if (
      input.planPath !== roles.plan ||
      input.result.artifacts.implementationReport !==
        roles.implementationReport ||
      input.result.artifacts.testReport !== roles.testReport
    )
      return completionFailure(
        "evidence_scope_violation",
        "Completion must reference the exact bound plan and required reports."
      );
    for (const report of [roles.implementationReport, roles.testReport])
      if (report) requiredReports.add(report);
  }
  const ledger = input.result.taskCompletion;
  const approval = await digestArtifactBundle(
    input.repoRoot,
    input.approval.paths
  ).catch(() =>
    completionFailure(
      "approval_invalid",
      "Approved artifact bundle cannot be validated."
    )
  );
  if (
    approval.digest !== input.approval.digest ||
    !input.approval.paths.includes(input.planPath)
  ) {
    return completionFailure(
      "approval_invalid",
      "Approved artifact bundle digest or plan membership is invalid."
    );
  }
  const plan = await readFile(
    path.resolve(input.repoRoot, input.planPath),
    "utf8"
  ).catch(() =>
    completionFailure(
      "approved_plan_invalid",
      "Exact approved plan cannot be read."
    )
  );
  const taskIds = parseApprovedPlanTaskIds(plan);
  validatePlanTaskCompletionLedgerShape(taskIds, ledger, input.result.outcome);
  if (ledger === null) {
    return completionFailure(
      "missing_ledger",
      "Strict implementation result is missing taskCompletion."
    );
  }

  const implementationReport = await readRequiredReport(
    input.repoRoot,
    input.result.artifacts.implementationReport,
    "implementation_report_missing",
    requiredReports
  );
  const testReport = await readRequiredReport(
    input.repoRoot,
    input.result.artifacts.testReport,
    "test_report_missing",
    requiredReports
  );
  const projection = parsePlanTaskCompletionProjection(
    implementationReport.contents
  );
  if (JSON.stringify(projection) !== JSON.stringify(ledger)) {
    return completionFailure(
      "report_projection_mismatch",
      "Implementation report projection contradicts the structured completion ledger."
    );
  }

  const snapshot = await workspaceSnapshot(input.repoRoot, {
    excludedPaths: input.approval.paths,
    baseline: input.baseline,
    artifactBinding: input.artifactBinding
  });
  const allowedPaths = new Set(
    snapshot.entries
      .filter((entry) => entry.kind === "file")
      .map((entry) => entry.path)
  );
  allowedPaths.add(implementationReport.path);
  allowedPaths.add(testReport.path);
  const approvedPaths = new Set(input.approval.paths);
  const reportContents = new Map([
    [implementationReport.path, implementationReport.contents],
    [testReport.path, testReport.contents]
  ]);
  for (const task of ledger.tasks) {
    for (const evidence of task.evidence) {
      await validateEvidenceFile(
        input.repoRoot,
        evidence.path,
        allowedPaths,
        approvedPaths,
        task.taskId,
        requiredReports
      );
    }
    if (task.gap !== null) {
      if (
        ![implementationReport.path, testReport.path].includes(
          task.gap.reportPath
        )
      ) {
        return completionFailure(
          "invalid_gap_reference",
          `${task.taskId} gap must reference an exact required report.`,
          task.taskId
        );
      }
      const contents = reportContents.get(task.gap.reportPath) ?? "";
      const escaped = task.gap.section.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      if (!new RegExp(`^#{2,6}\\s+${escaped}\\s*$`, "mu").test(contents)) {
        return completionFailure(
          "invalid_gap_reference",
          `${task.taskId} gap section is missing from its report.`,
          task.taskId
        );
      }
    }
  }

  const counts = {
    total: taskIds.length,
    completed: ledger.tasks.filter((task) => task.status === "completed")
      .length,
    incomplete: ledger.tasks.filter((task) => task.status === "incomplete")
      .length,
    blocked: ledger.tasks.filter((task) => task.status === "blocked").length
  };
  return {
    summary: {
      schemaVersion: PLAN_TASK_COMPLETION_SCHEMA_VERSION,
      status: "valid",
      sourceAttemptId: input.sourceAttemptId,
      approvalDigest: input.approval.digest,
      planTaskDigest: digest(taskIds),
      ledgerDigest: digest(ledger),
      implementationReport: {
        path: implementationReport.path,
        sha256: implementationReport.sha256
      },
      testReport: { path: testReport.path, sha256: testReport.sha256 },
      counts,
      validatedAt: input.validatedAt ?? new Date().toISOString()
    },
    tasks: ledger.tasks
  };
}

export function summariesMatch(
  expected: ValidPlanTaskCompletionSummary,
  actual: ValidPlanTaskCompletionSummary
): boolean {
  // sourceAttemptKind is checkpoint provenance, not validated content — a
  // freshly computed summary cannot know it, and revalidation already proves
  // it by reading the source record under that kind — so it is excluded from
  // the comparison alongside the validation timestamp.
  const normalize = (summary: ValidPlanTaskCompletionSummary) => ({
    ...summary,
    validatedAt: null,
    sourceAttemptKind: null
  });
  return (
    JSON.stringify(normalize(expected)) === JSON.stringify(normalize(actual))
  );
}

/** Optional inventory never weakens legacy plan meaning; present invalid input fails closed. */
export function validatePlanVerificationObligations(
  plan: string,
  verification: unknown
): void {
  if (!plan.includes("banzai-verification-obligations/")) return;
  try {
    if (
      parseVerificationObligations(
        plan,
        parseVerificationConfiguration(verification)
      ) !== null
    )
      return;
  } catch {
    /* A malformed opt-in inventory cannot authorize equivalent evidence. */
  }
  throw new PlanTaskCompletionError(
    "approved_plan_invalid",
    "The plan verification obligation inventory is missing, ambiguous, contradictory or stale."
  );
}
