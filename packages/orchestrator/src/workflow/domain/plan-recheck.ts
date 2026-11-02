import type {
  PlanRecheckSummary,
  TaskVerificationCandidates,
  TaskVerificationDescriptor
} from "../../types.js";

/**
 * Bounds of a persisted re-check summary, shared across its lists so the whole
 * summary fits the agent status projection; omitted entries are counted.
 */
export const PLAN_RECHECK_LIMITS = {
  files: 16,
  headings: 48,
  headingLength: 120,
  checks: 48
} as const;

/** The descriptor fields a re-check names when a check changed (ADR-0058 §3). */
export const PLAN_RECHECK_CHECK_FIELDS = [
  "name",
  "requirementRefs",
  "argv",
  "cwd",
  "timeoutMs",
  "evidence",
  "sources",
  "materialization"
] as const;

export interface PlanRecheckFile {
  path: string;
  bytes: Buffer;
}

const UNSAFE_HEADING = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/gu;
const PREAMBLE = "(before the first heading)";
const ACCEPTED_ADR = /^[ \t]*(?:[-*][ \t]+)?Status:[ \t]*Accepted\b/imu;

/**
 * The declared remainder digest is runner-owned after a re-check, so it is
 * masked before plan bytes are compared; otherwise every rewrite would report
 * the inventory's section as a human edit.
 */
function comparable(file: PlanRecheckFile): string {
  return file.bytes
    .toString("utf8")
    .replace(/("planRemainderSha256"\s*:\s*")[a-f0-9]{64}"/gu, '$1"');
}

function headingLabel(level: number, text: string): string {
  const safe = text.replace(UNSAFE_HEADING, "?");
  const bounded =
    safe.length > PLAN_RECHECK_LIMITS.headingLength
      ? `${safe.slice(0, PLAN_RECHECK_LIMITS.headingLength - 1)}…`
      : safe;
  return `${"#".repeat(level)} ${bounded}`;
}

/**
 * Splits Markdown at every ATX heading outside fenced code. A section runs to
 * the next heading of any level, so an edit inside a subsection names only
 * that subsection. Repeated headings are told apart by occurrence.
 */
export function markdownSections(
  text: string
): Map<string, { label: string; body: string }> {
  const sections = new Map<string, { label: string; body: string }>();
  const seen = new Map<string, number>();
  let key = PREAMBLE;
  let label = PREAMBLE;
  let body: string[] = [];
  let fence: { marker: string; length: number } | null = null;
  const flush = (): void => {
    if (key !== PREAMBLE || body.some((line) => line.trim().length > 0))
      sections.set(key, { label, body: body.join("\n") });
  };
  for (const line of text.split("\n")) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
    if (fenceMatch?.[1] !== undefined) {
      const marker = fenceMatch[1];
      if (fence === null)
        fence = { marker: marker[0] ?? "`", length: marker.length };
      else if (marker.startsWith(fence.marker) && marker.length >= fence.length)
        fence = null;
    }
    const heading =
      fence === null && fenceMatch === null
        ? /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*\r?$/u.exec(line)
        : null;
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      flush();
      const text = heading[2].trim();
      const base = `${heading[1].length}:${text}`;
      const occurrence = (seen.get(base) ?? 0) + 1;
      seen.set(base, occurrence);
      key = `${base}#${occurrence}`;
      label = headingLabel(heading[1].length, text);
      body = [line];
      continue;
    }
    body.push(line);
  }
  flush();
  return sections;
}

function capped<T>(values: T[], limit: number): { kept: T[]; omitted: number } {
  return {
    kept: values.slice(0, limit),
    omitted: Math.max(0, values.length - limit)
  };
}

function sectionChanges(
  before: string,
  after: string,
  budget: { headings: number }
): NonNullable<PlanRecheckSummary["files"][number]["sections"]> {
  const planner = markdownSections(before);
  const current = markdownSections(after);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [key, section] of current) {
    const previous = planner.get(key);
    if (previous === undefined) added.push(section.label);
    else if (previous.body !== section.body) changed.push(section.label);
  }
  for (const [key, section] of planner)
    if (!current.has(key)) removed.push(section.label);
  let omitted = 0;
  const take = (values: string[]): string[] => {
    const result = capped(values, budget.headings);
    budget.headings -= result.kept.length;
    omitted += result.omitted;
    return result.kept;
  };
  return {
    changed: take(changed),
    added: take(added),
    removed: take(removed),
    omitted
  };
}

function descriptorFields(
  descriptor: TaskVerificationDescriptor
): Record<(typeof PLAN_RECHECK_CHECK_FIELDS)[number], string> {
  return {
    name: descriptor.name,
    requirementRefs: JSON.stringify(descriptor.requirementRefs),
    argv: JSON.stringify([descriptor.command, ...descriptor.args]),
    cwd: descriptor.cwd,
    timeoutMs: String(descriptor.timeoutMs),
    evidence: descriptor.evidence,
    sources: JSON.stringify(descriptor.sources),
    materialization: JSON.stringify(descriptor.materialization)
  };
}

function checkChanges(
  planner: TaskVerificationCandidates | null,
  current: TaskVerificationCandidates
): PlanRecheckSummary["checks"] {
  const ids = current.checks.map((check) => check.id);
  const currentIds = capped(ids, PLAN_RECHECK_LIMITS.checks);
  if (planner === null)
    return {
      current: currentIds.kept,
      added: [],
      removed: [],
      changed: [],
      absenceReasonChanged: false,
      omitted: currentIds.omitted
    };
  const before = new Map(planner.checks.map((check) => [check.id, check]));
  const after = new Map(current.checks.map((check) => [check.id, check]));
  const added = ids.filter((id) => !before.has(id));
  const removed = planner.checks
    .map((check) => check.id)
    .filter((id) => !after.has(id));
  const changed: { id: string; fields: string[] }[] = [];
  for (const check of current.checks) {
    const previous = before.get(check.id);
    if (previous === undefined) continue;
    const a = descriptorFields(previous);
    const b = descriptorFields(check);
    const fields = PLAN_RECHECK_CHECK_FIELDS.filter(
      (field) => a[field] !== b[field]
    );
    if (fields.length > 0) changed.push({ id: check.id, fields: [...fields] });
  }
  let budget: number = PLAN_RECHECK_LIMITS.checks;
  let omitted = currentIds.omitted;
  const take = <T>(values: T[]): T[] => {
    const result = capped(values, budget);
    budget -= result.kept.length;
    omitted += result.omitted;
    return result.kept;
  };
  return {
    current: currentIds.kept,
    added: take(added),
    removed: take(removed),
    changed: take(changed),
    absenceReasonChanged: planner.absenceReason !== current.absenceReason,
    omitted
  };
}

/**
 * Compares the current planning bundle with the planner's version retained at
 * gate entry. It reports paths, headings, check identities and field names
 * only; no other file content leaves this function.
 */
export function planRecheckSummary(input: {
  planner: PlanRecheckFile[] | null;
  current: PlanRecheckFile[];
  plannerInventory: TaskVerificationCandidates | null;
  currentInventory: TaskVerificationCandidates;
  remainderDigestRewritten: boolean;
  adrPaths: readonly string[];
}): PlanRecheckSummary {
  const checks = checkChanges(
    input.planner === null ? null : input.plannerInventory,
    input.currentInventory
  );
  if (input.planner === null)
    return {
      plannerVersion: false,
      files: [],
      omittedFiles: 0,
      checks,
      remainderDigestRewritten: input.remainderDigestRewritten,
      acceptedAdrsChanged: []
    };
  const before = new Map(input.planner.map((file) => [file.path, file]));
  const after = new Map(input.current.map((file) => [file.path, file]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const files: PlanRecheckSummary["files"] = [];
  const acceptedAdrsChanged: string[] = [];
  const budget = { headings: PLAN_RECHECK_LIMITS.headings as number };
  for (const filePath of paths) {
    const previous = before.get(filePath);
    const current = after.get(filePath);
    if (previous === undefined) {
      files.push({ path: filePath, change: "added", sections: null });
      continue;
    }
    if (current === undefined) {
      files.push({ path: filePath, change: "removed", sections: null });
      continue;
    }
    const a = comparable(previous);
    const b = comparable(current);
    if (a === b) continue;
    files.push({
      path: filePath,
      change: "changed",
      sections: filePath.endsWith(".md") ? sectionChanges(a, b, budget) : null
    });
    if (
      input.adrPaths.includes(filePath) &&
      (ACCEPTED_ADR.test(a) || ACCEPTED_ADR.test(b))
    )
      acceptedAdrsChanged.push(filePath);
  }
  const kept = capped(files, PLAN_RECHECK_LIMITS.files);
  return {
    plannerVersion: true,
    files: kept.kept,
    omittedFiles: kept.omitted,
    checks,
    remainderDigestRewritten: input.remainderDigestRewritten,
    acceptedAdrsChanged: capped(acceptedAdrsChanged, PLAN_RECHECK_LIMITS.files)
      .kept
  };
}
