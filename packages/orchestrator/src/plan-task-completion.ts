import {
  parseVerificationConfiguration,
  parseVerificationObligations
} from "./verification-evidence.js";
import { inspectBoundWork, type ArtifactBoundWork } from "./work-documents.js";
import { safePath } from "./project-files.js";
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
  type PhaseArtifacts,
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

type PlanPathAccess = "read" | "write" | "unknown";

// These are optional Markdown field labels, not natural-language exemptions.
// A declared write set is binding even when nearby prose says not to edit it.
function planPathField(text: string): PlanPathAccess | null {
  const label = text.replaceAll("*", "").trim();
  if (
    /^(?:files(?: to (?:change|modify|create|delete))?|affected files|write targets)\s*:/iu.test(
      label
    )
  )
    return "write";
  if (/^(?:read-only references|unchanged paths)\s*:/iu.test(label))
    return "read";
  return null;
}

function planTaskStatements(
  section: string
): { taskId: string; text: string; access: PlanPathAccess }[] {
  const statements: { taskId: string; text: string; access: PlanPathAccess }[] =
    [];
  let taskId = "unknown";
  let field: { indent: number; access: PlanPathAccess } | null = null;
  let pending: (typeof statements)[number] | null = null;
  for (const line of section.split(/\r?\n/u)) {
    const heading = TASK_HEADING.exec(line);
    if (heading) {
      taskId = heading[1] ?? "unknown";
      field = null;
      pending = null;
      statements.push({ taskId, text: heading[2] ?? "", access: "unknown" });
      continue;
    }
    if (!line.trim()) {
      pending = null;
      continue;
    }
    const indent = line.length - line.trimStart().length;
    const text = line.trim().replace(/^(?:[-+*]|\d+\.)\s+/u, "");
    const declared = planPathField(text);
    if (field && indent <= field.indent) field = null;
    const access = declared ?? field?.access ?? "unknown";
    if (declared) field = { indent, access: declared };
    if (
      !declared &&
      !/^\s*(?:[-+*]|\d+\.)\s/u.test(line) &&
      !/^[\w -]+:/u.test(text.replaceAll("*", "")) &&
      pending &&
      indent > 0
    ) {
      pending.text += ` ${text}`;
    } else {
      pending = { taskId, text, access };
      statements.push(pending);
    }
  }
  return statements;
}

const PLAN_WRITE_WORDS =
  "(?:change|edit|modify|update|write|rewrite|create|add|delete|remove|overwrite|replace|patch|configure|set|touch|mkdir|rm|cp|mv|tee)";
const PLAN_ACTION = `(?:read|inspect|review|compare|consult|check|verify|cat|${PLAN_WRITE_WORDS})`;
const PLAN_WRITE_ACTION = new RegExp(`\\b${PLAN_WRITE_WORDS}\\b`, "iu");
const PLAN_PROHIBITION = new RegExp(
  `^\\W*(?:(?:do|must|should)\\s+not|never)\\s+(?=${PLAN_ACTION}\\b)`,
  "iu"
);

function planClauseAccess(
  clause: string,
  declared: PlanPathAccess
): PlanPathAccess {
  if (declared === "write") return "write";
  clause = clause.replace(/^\s*[\w -]+:\s*/u, "");
  const prohibited = PLAN_PROHIBITION.test(clause);
  if (!prohibited && PLAN_WRITE_ACTION.test(clause)) return "write";
  // Do not let a recognized read/prohibition classify a second, unrecognized
  // instruction. Path-only continuations are lists; other prose needs clarity.
  if (
    /\b(?:and|or)\s+(?!(?:any\s+)?@\d+@(?:\s|$))/iu.test(clause) ||
    /@\d+@[^,]*,\s*(?!@\d+@|(?:and|or)\s+(?:any\s+)?@\d+@)\p{L}/u.test(clause)
  )
    return "unknown";
  // Only a prohibition applying to this clause suppresses its action. Other
  // clauses and list items are classified independently, including later writes.
  if (prohibited) return "read";
  if (
    /^\s*(?:preserve|leave|keep)\b.*\bunchanged\s*$/iu.test(clause) ||
    /^\s*@\d+@\s+(?:must\s+)?remain\s+unchanged\s*$/iu.test(clause)
  )
    return "read";
  if (
    /\b(?:read|inspect|review|compare|consult|check|verify|cat)\b/iu.test(
      clause
    )
  )
    return "read";
  // Structured reference lists also work when explanatory prose is not English.
  if (declared === "read" && /^[\s\d@,.:-]*$/u.test(clause)) return "read";
  return "unknown";
}

/** Planning lint does not grant writes; the hook and phase scope remain authoritative. */
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
  const root = path.posix
    .normalize(repoRoot.replaceAll("\\", "/"))
    .replace(/\/$/u, "");
  let previousTaskId = "";
  let previousPaths: string[] = [];
  for (const { taskId, text, access } of planTaskStatements(section)) {
    if (taskId !== previousTaskId) previousPaths = [];
    previousTaskId = taskId;
    const paths: string[] = [];
    // Mask paths before clause splitting: dots, line suffixes and separators in
    // filenames are not sentence boundaries or action words.
    const masked = text
      .replace(/[^\s*`'"<>()[\]{},;&|]+/gu, (raw) => {
        const token = raw
          .replaceAll("\\", "/")
          .replace(/[.!?]+$/u, "")
          .replace(/:\d+(?::\d+)?$/u, "");
        if (
          !token.includes("/") &&
          !/^\.[\w-]+$/u.test(token) &&
          !/\.[a-z0-9]+$/iu.test(token)
        )
          return raw;
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
        paths.push(relative);
        return `@${paths.length - 1}@${/[.!?]$/u.test(raw) ? "." : ""}`;
      })
      .replace(/\[([^\]]*)\]\((@\d+@)\)/gu, "$2")
      .replace(/[*`'"()]/gu, "");
    const clauses = masked.split(
      new RegExp(
        `;|&&|\\|\\||[.!?](?:\\s+|$)|\\s+(?:but|however|whereas|while)\\s+|(?:,\\s*|\\s+(?:and|then|to)\\s+)(?:then\\s+)?(?=(?:(?:do|must|should)\\s+not\\s+|never\\s+)?${PLAN_ACTION}\\b)`,
        "iu"
      )
    );
    for (const clause of clauses) {
      const references = [...clause.matchAll(/@(\d+)@/gu)].map(
        (match) => paths[Number(match[1])] ?? ""
      );
      const mode = planClauseAccess(clause, access);
      // Shell redirection is a write independently of the command's language.
      const redirects = [...clause.matchAll(/>{1,2}\s*@(\d+)@/gu)].map(
        (match) => paths[Number(match[1])] ?? ""
      );
      const targets = references.length
        ? references
        : /\b(?:it|them|that file|those files)\b/iu.test(clause)
          ? previousPaths
          : [];
      if (references.length) previousPaths = references;
      for (const relative of targets) {
        const targetMode =
          redirects.includes(relative) && !PLAN_PROHIBITION.test(clause)
            ? "write"
            : mode;
        if (
          !(
            relative.toLowerCase() === ".banzai" ||
            relative.toLowerCase().startsWith(".banzai/") ||
            relative.toLowerCase() === "documentation/work" ||
            relative.toLowerCase().startsWith("documentation/work/")
          ) ||
          allowed.has(relative) ||
          targetMode === "read"
        )
          continue;
        const target = JSON.stringify(relative.slice(0, 240));
        throw new BanzaiError(
          "PLAN_RUNNER_CONTROL_TASK",
          targetMode === "write"
            ? `Plan task ${taskId} uses runner control path ${target} as a write target. Remove that write from the task; keep unrelated implementation work. If configuration is missing, record it in Human prerequisites and use banzai verify.`
            : `Plan task ${taskId} has ambiguous access to runner control path ${target}. Clarify the action or list read-only inputs under Read-only references: and protected paths under Unchanged paths:. These declarations do not authorize writes.`
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
  requiredReports: ReadonlySet<string>,
  captured?: Buffer
): Promise<{ path: string; contents: string; sha256: string; bytes: Buffer }> {
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
  let bytes: Buffer;
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
    // A captured original stands in for the destination bytes during
    // deterministic publication; the path checks above still apply.
    bytes = captured ?? (await readFile(absolute));
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
    contents: bytes.toString("utf8"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes
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

// ---------------------------------------------------------------------------
// Runner-owned completion region (ADR-0047 / ADR-0048): grammar v2.
// ---------------------------------------------------------------------------

export const COMPLETION_REGION_FORMAT = "banzai-plan-task-completion/v2";
export const COMPLETION_REGION_START = `<!-- ${COMPLETION_REGION_FORMAT}:start -->`;
export const COMPLETION_REGION_END = `<!-- ${COMPLETION_REGION_FORMAT}:end -->`;
const COMPLETION_TABLE_HEADER =
  "| Task | Status | Evidence | Gap or deviation |";
const COMPLETION_TABLE_SEPARATOR = "| --- | --- | --- | --- |";
// Every ASCII punctuation code point: U+0021-002F, U+003A-0040, U+005B-0060,
// U+007B-007E. Letters, digits, space and admitted Unicode stay literal.
const ENCODED_PUNCTUATION = /[!-/:-@[-`{-~]/gu;
const NUMERIC_REFERENCE = /&#([0-9]{2,3});/gu;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/u;
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/u;

function isEncodedPunctuation(code: number): boolean {
  return (
    (code >= 0x21 && code <= 0x2f) ||
    (code >= 0x3a && code <= 0x40) ||
    (code >= 0x5b && code <= 0x60) ||
    (code >= 0x7b && code <= 0x7e)
  );
}

/** JSON.stringify first, then one decimal numeric reference per ASCII punctuation code point. */
export function encodeCompletionCell(value: unknown): string {
  return JSON.stringify(value).replace(
    ENCODED_PUNCTUATION,
    (character) => `&#${character.codePointAt(0)};`
  );
}

/**
 * Decodes exactly once: only the runner's own reference spelling for ASCII
 * punctuation is expanded, so a literal entity string supplied by the model
 * (`&#38;`) survives as `&amp;#38;`-free text after a single pass.
 */
export function decodeCompletionCell(cell: string): string {
  return cell.replace(NUMERIC_REFERENCE, (reference, digits: string) => {
    const code = Number(digits);
    return isEncodedPunctuation(code) ? String.fromCodePoint(code) : reference;
  });
}

function completionRow(task: PlanTaskCompletionRecord): string {
  return `| ${encodeCompletionCell(task.taskId)} | ${encodeCompletionCell(task.status)} | ${encodeCompletionCell(task.evidence)} | ${encodeCompletionCell(task.gap)} |`;
}

/** The exact generated region bytes, LF-separated, without a trailing newline. */
export function renderCompletionRegion(
  ledger: PlanTaskCompletionLedger
): string {
  return [
    COMPLETION_REGION_START,
    SECTION_HEADING,
    "",
    COMPLETION_TABLE_HEADER,
    COMPLETION_TABLE_SEPARATOR,
    ...ledger.tasks.map(completionRow),
    COMPLETION_REGION_END
  ].join("\n");
}

function parseCompletionRegionRow(line: string): PlanTaskCompletionRecord {
  if (!line.startsWith("| ") || !line.endsWith(" |")) {
    return completionFailure(
      "report_projection_invalid",
      "Completion region row is not a four-cell table row."
    );
  }
  const cells = line.slice(2, -2).split(" | ");
  if (cells.length !== 4 || cells.some((cell) => cell.includes("|"))) {
    return completionFailure(
      "report_projection_invalid",
      "Completion region row must contain exactly four encoded cells."
    );
  }
  const decoded = cells.map(decodeCompletionCell);
  let values: unknown[];
  try {
    values = decoded.map((cell) => JSON.parse(cell) as unknown);
  } catch {
    return completionFailure(
      "report_projection_invalid",
      "Completion region cell does not decode to JSON."
    );
  }
  const [taskId, status, evidence, gap] = values;
  if (
    typeof taskId !== "string" ||
    !/^T[0-9]{3}$/u.test(taskId) ||
    typeof status !== "string" ||
    !["completed", "incomplete", "blocked"].includes(status) ||
    !Array.isArray(evidence) ||
    !(gap === null || (typeof gap === "object" && !Array.isArray(gap)))
  ) {
    return completionFailure(
      "report_projection_invalid",
      "Completion region row is malformed.",
      typeof taskId === "string" && /^T[0-9]{3}$/u.test(taskId) ? taskId : null
    );
  }
  const record: PlanTaskCompletionRecord = {
    taskId,
    status: status as PlanTaskCompletionRecord["status"],
    evidence: evidence as PlanTaskCompletionRecord["evidence"],
    gap: gap as PlanTaskCompletionRecord["gap"]
  };
  // The region is deterministic: every cell must be exactly the runner's own
  // encoding of the decoded value, never a merely equivalent spelling.
  if (completionRow(record) !== line) {
    return completionFailure(
      "report_projection_invalid",
      `Completion region row ${taskId} is not canonically encoded.`,
      taskId
    );
  }
  return record;
}

/** Parses exact generated region text (start delimiter through end delimiter). */
export function parseCompletionRegion(
  region: string
): PlanTaskCompletionLedger {
  const lines = region.split("\n");
  if (
    lines.length < 6 ||
    lines[0] !== COMPLETION_REGION_START ||
    lines[1] !== SECTION_HEADING ||
    lines[2] !== "" ||
    lines[3] !== COMPLETION_TABLE_HEADER ||
    lines[4] !== COMPLETION_TABLE_SEPARATOR ||
    lines.at(-1) !== COMPLETION_REGION_END
  ) {
    return completionFailure(
      "report_projection_invalid",
      `Completion region does not follow the ${COMPLETION_REGION_FORMAT} grammar.`
    );
  }
  return {
    schemaVersion: PLAN_TASK_COMPLETION_SCHEMA_VERSION,
    tasks: lines.slice(5, -1).map(parseCompletionRegionRow)
  };
}

interface ScannedLine {
  text: string;
  start: number;
  end: number;
  fenced: boolean;
}

/**
 * Bounded fence-aware line scan. Offsets are UTF-16 code unit indexes into the
 * decoded text; `end` excludes the line terminator. Headings and delimiters
 * inside fenced code are never structural.
 */
function scanLines(markdown: string): ScannedLine[] {
  const lines: ScannedLine[] = [];
  let offset = 0;
  let fence: { character: string; length: number } | null = null;
  for (const raw of markdown.split("\n")) {
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const start = offset;
    const end = offset + text.length;
    offset += raw.length + 1;
    if (fence === null) {
      const open = FENCE_OPEN.exec(text);
      if (open?.[1] !== undefined) {
        fence = { character: open[1][0] ?? "`", length: open[1].length };
        lines.push({ text, start, end, fenced: true });
        continue;
      }
      lines.push({ text, start, end, fenced: false });
      continue;
    }
    const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(text)?.[1];
    if (
      close !== undefined &&
      close.startsWith(fence.character) &&
      close.length >= fence.length
    ) {
      fence = null;
    }
    lines.push({ text, start, end, fenced: true });
  }
  if (fence !== null) {
    return completionFailure(
      "report_region_invalid",
      "Implementation report has an unclosed code fence; completion region ownership is ambiguous."
    );
  }
  return lines;
}

function headingOf(line: ScannedLine): { level: number; text: string } | null {
  if (line.fenced) return null;
  const match = ATX_HEADING.exec(line.text);
  if (match?.[1] === undefined) return null;
  const body = (match[2] ?? "").replace(/[ \t]+#+$/u, "").trim();
  return { level: match[1].length, text: body };
}

export interface CompletionRegionScan {
  kind: "none" | "legacy" | "v2";
  /** Code-unit range of the owned region in the input; absent for `none`. */
  start: number;
  end: number;
}

/**
 * Identifies exactly one owned completion region without parsing model table
 * cells. Duplicate legacy sections, a legacy section outside a v2 pair and
 * malformed, repeated or overlapping delimiters fail before any overwrite.
 */
export function scanCompletionRegion(markdown: string): CompletionRegionScan {
  const lines = scanLines(markdown);
  const starts = lines.filter(
    (line) => !line.fenced && line.text === COMPLETION_REGION_START
  );
  const ends = lines.filter(
    (line) => !line.fenced && line.text === COMPLETION_REGION_END
  );
  const looseDelimiters = lines.filter(
    (line) =>
      !line.fenced &&
      line.text !== COMPLETION_REGION_START &&
      line.text !== COMPLETION_REGION_END &&
      line.text.includes(COMPLETION_REGION_FORMAT) &&
      /^\s*<!--/u.test(line.text)
  );
  if (looseDelimiters.length > 0) {
    return completionFailure(
      "report_region_invalid",
      "Implementation report contains a malformed completion region delimiter."
    );
  }
  const legacyHeadings = lines.filter((line) => {
    const heading = headingOf(line);
    return heading?.level === 2 && heading.text === "Plan Task Completion";
  });
  if (starts.length === 0 && ends.length === 0) {
    if (legacyHeadings.length === 0) return { kind: "none", start: 0, end: 0 };
    if (legacyHeadings.length > 1) {
      return completionFailure(
        "report_region_invalid",
        "Implementation report contains duplicate Plan Task Completion sections."
      );
    }
    const heading = legacyHeadings[0];
    if (heading === undefined) return { kind: "none", start: 0, end: 0 };
    const next = lines.find((line) => {
      if (line.start <= heading.start) return false;
      const candidate = headingOf(line);
      return candidate !== null && candidate.level <= 2;
    });
    return {
      kind: "legacy",
      start: heading.start,
      end: next?.start ?? markdown.length
    };
  }
  const start = starts[0];
  const end = ends[0];
  if (
    starts.length !== 1 ||
    ends.length !== 1 ||
    start === undefined ||
    end === undefined ||
    end.start <= start.start
  ) {
    return completionFailure(
      "report_region_invalid",
      "Implementation report must contain exactly one balanced completion region delimiter pair."
    );
  }
  const inside = legacyHeadings.filter(
    (line) => line.start > start.start && line.start < end.start
  );
  if (inside.length !== 1 || legacyHeadings.length !== 1) {
    return completionFailure(
      "report_region_invalid",
      "Completion region delimiters must enclose exactly one Plan Task Completion section and no section may exist outside them."
    );
  }
  const otherTopLevel = lines.some((line) => {
    if (line.start <= start.start || line.start >= end.start) return false;
    const heading = headingOf(line);
    return (
      heading !== null &&
      heading.level <= 2 &&
      heading.text !== "Plan Task Completion"
    );
  });
  if (otherTopLevel) {
    return completionFailure(
      "report_region_invalid",
      "Completion region delimiters enclose more than one top-level section."
    );
  }
  return { kind: "v2", start: start.start, end: end.end };
}

/**
 * Unique level 2-6 narrative headings outside fences and outside the owned
 * completion region. A heading that appears twice is never a valid gap target.
 */
export function eligibleGapHeadings(
  markdown: string,
  region: CompletionRegionScan | null
): Set<string> {
  const counts = new Map<string, number>();
  for (const line of scanLines(markdown)) {
    if (
      region !== null &&
      region.kind !== "none" &&
      line.start >= region.start &&
      line.start < region.end
    )
      continue;
    const heading = headingOf(line);
    if (heading === null || heading.level < 2 || heading.text.length === 0)
      continue;
    counts.set(heading.text, (counts.get(heading.text) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count === 1)
      .map(([text]) => text)
  );
}

export interface CompletionCandidateComposition {
  bytes: Buffer;
  region: { action: "appended" | "replaced"; start: number; end: number };
}

function utf8Text(bytes: Buffer, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes
    );
  } catch {
    return completionFailure(
      "report_region_invalid",
      `${label} is not valid UTF-8; completion region ownership is ambiguous.`
    );
  }
}

/**
 * Composes the candidate implementation report: the exact input bytes outside
 * the owned region, plus the deterministic v2 region. The result is re-scanned
 * and re-parsed so only a verified roundtrip can become a candidate.
 */
export function composeCompletionCandidate(
  input: Buffer,
  ledger: PlanTaskCompletionLedger
): CompletionCandidateComposition {
  const text = utf8Text(input, "Implementation report");
  const scan = scanCompletionRegion(text);
  const region = renderCompletionRegion(ledger);
  let output: string;
  let action: "appended" | "replaced";
  let start: number;
  let end: number;
  if (scan.kind === "none") {
    // Append with only the newlines needed to separate; never normalize the
    // original prefix.
    const separator =
      text.length === 0
        ? ""
        : text.endsWith("\n\n")
          ? ""
          : text.endsWith("\n")
            ? "\n"
            : "\n\n";
    output = `${text}${separator}${region}\n`;
    action = "appended";
    start = Buffer.byteLength(text, "utf8");
    end = start;
  } else {
    const prefix = text.slice(0, scan.start);
    const suffix = text.slice(scan.end);
    const replacement =
      scan.kind === "legacy"
        ? suffix.length === 0
          ? `${region}\n`
          : `${region}\n\n`
        : region;
    output = `${prefix}${replacement}${suffix}`;
    action = "replaced";
    start = Buffer.byteLength(prefix, "utf8");
    end = start + Buffer.byteLength(text.slice(scan.start, scan.end), "utf8");
    if (
      !output.startsWith(prefix) ||
      !output.endsWith(suffix) ||
      Buffer.byteLength(prefix, "utf8") + Buffer.byteLength(suffix, "utf8") !==
        Buffer.byteLength(output, "utf8") -
          Buffer.byteLength(replacement, "utf8")
    ) {
      return completionFailure(
        "report_region_invalid",
        "Candidate composition failed to preserve the narrative outside the completion region."
      );
    }
  }
  const verification = scanCompletionRegion(output);
  if (verification.kind !== "v2") {
    return completionFailure(
      "report_region_invalid",
      "Candidate composition did not produce exactly one owned completion region."
    );
  }
  const roundtrip = parseCompletionRegion(
    output.slice(verification.start, verification.end)
  );
  if (
    JSON.stringify(roundtrip) !== JSON.stringify(ledger) ||
    output.slice(verification.start, verification.end) !== region
  ) {
    return completionFailure(
      "report_projection_mismatch",
      "Candidate completion region does not round-trip to the admitted ledger."
    );
  }
  return { bytes: Buffer.from(output, "utf8"), region: { action, start, end } };
}

/** The v2 ledger a published report carries; anything else is not current v2 evidence. */
export function parsePublishedCompletionRegion(
  report: Buffer
): PlanTaskCompletionLedger {
  const text = utf8Text(report, "Implementation report");
  const scan = scanCompletionRegion(text);
  if (scan.kind !== "v2") {
    return completionFailure(
      scan.kind === "none"
        ? "report_projection_missing"
        : "report_projection_invalid",
      scan.kind === "none"
        ? "Implementation report has no runner-published completion region."
        : "Implementation report carries a legacy completion section instead of the published v2 region."
    );
  }
  return parseCompletionRegion(text.slice(scan.start, scan.end));
}

export interface ValidateCompletionClaimsInput {
  repoRoot: string;
  artifactBinding?: ArtifactBoundWork | undefined;
  ledger: PlanTaskCompletionLedger | null;
  outcome: PhaseOutcome;
  artifacts: Pick<PhaseArtifacts, "implementationReport" | "testReport">;
  planPath: string;
  approval: ApprovalRecord;
  baseline?: readonly WorkspaceEntry[] | undefined;
  /** Captured original report bytes; when present they replace destination reads. */
  captured?: { implementationReport: Buffer; testReport: Buffer } | undefined;
}

export interface ValidatedCompletionClaims {
  ledger: PlanTaskCompletionLedger;
  taskIds: string[];
  approvalDigest: string;
  planTaskDigest: string;
  ledgerDigest: string;
  counts: ValidPlanTaskCompletionSummary["counts"];
  implementationReport: {
    path: string;
    bytes: Buffer;
    sha256: string;
    region: CompletionRegionScan;
  };
  testReport: { path: string; bytes: Buffer; sha256: string };
}

/**
 * Claim, evidence, authority, report-role and gap validation under the
 * completion protocol. No report projection is parsed for parity: the runner
 * publishes the region itself after these checks pass. Gap targets must be
 * unique preserved narrative headings outside fences and outside the owned
 * region, or headings in the unchanged test report.
 */
export async function validateCompletionClaims(
  input: ValidateCompletionClaimsInput
): Promise<ValidatedCompletionClaims> {
  const requiredReports = new Set<string>();
  if (input.artifactBinding !== undefined) {
    await inspectBoundWork(input.repoRoot, input.artifactBinding);
    const roles = input.artifactBinding.binding.artifacts;
    if (
      input.planPath !== roles.plan ||
      input.artifacts.implementationReport !== roles.implementationReport ||
      input.artifacts.testReport !== roles.testReport
    )
      return completionFailure(
        "evidence_scope_violation",
        "Completion must reference the exact bound plan and required reports."
      );
    for (const report of [roles.implementationReport, roles.testReport])
      if (report) requiredReports.add(report);
  }
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
  validatePlanTaskCompletionLedgerShape(taskIds, input.ledger, input.outcome);
  const ledger = input.ledger;
  if (ledger === null) {
    return completionFailure(
      "missing_ledger",
      "Strict implementation result is missing taskCompletion."
    );
  }
  const implementationReport = await readRequiredReport(
    input.repoRoot,
    input.artifacts.implementationReport,
    "implementation_report_missing",
    requiredReports,
    input.captured?.implementationReport
  );
  const testReport = await readRequiredReport(
    input.repoRoot,
    input.artifacts.testReport,
    "test_report_missing",
    requiredReports,
    input.captured?.testReport
  );
  const region = scanCompletionRegion(
    utf8Text(implementationReport.bytes, "Implementation report")
  );
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
  const gapHeadings = new Map([
    [
      implementationReport.path,
      eligibleGapHeadings(implementationReport.contents, region)
    ],
    [testReport.path, eligibleGapHeadings(testReport.contents, null)]
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
      const headings = gapHeadings.get(task.gap.reportPath);
      if (headings === undefined) {
        return completionFailure(
          "invalid_gap_reference",
          `${task.taskId} gap must reference an exact required report.`,
          task.taskId
        );
      }
      if (!headings.has(task.gap.section)) {
        return completionFailure(
          "invalid_gap_reference",
          `${task.taskId} gap section is not a unique preserved narrative heading of its report.`,
          task.taskId
        );
      }
    }
  }
  return {
    ledger,
    taskIds,
    approvalDigest: input.approval.digest,
    planTaskDigest: digest(taskIds),
    ledgerDigest: digest(ledger),
    counts: completionCounts(taskIds, ledger),
    implementationReport: {
      path: implementationReport.path,
      bytes: implementationReport.bytes,
      sha256: implementationReport.sha256,
      region
    },
    testReport: {
      path: testReport.path,
      bytes: testReport.bytes,
      sha256: testReport.sha256
    }
  };
}

export function completionCounts(
  taskIds: readonly string[],
  ledger: PlanTaskCompletionLedger
): ValidPlanTaskCompletionSummary["counts"] {
  return {
    total: taskIds.length,
    completed: ledger.tasks.filter((task) => task.status === "completed")
      .length,
    incomplete: ledger.tasks.filter((task) => task.status === "incomplete")
      .length,
    blocked: ledger.tasks.filter((task) => task.status === "blocked").length
  };
}

export function ledgerDigest(ledger: PlanTaskCompletionLedger): string {
  return digest(ledger);
}

export function planTaskDigest(taskIds: readonly string[]): string {
  return digest(taskIds);
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
