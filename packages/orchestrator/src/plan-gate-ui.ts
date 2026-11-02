import { escapeTerminalText } from "./format.js";
import type { PlanRecheckRecord } from "./types.js";

/** Error codes of a re-check that wrote nothing and left the gate waiting. */
export const PLAN_RECHECK_REFUSAL_CODES: readonly string[] = [
  "PLAN_RECHECK_REFUSED",
  "PLAN_RECHECK_CHANGED",
  "PLAN_GATE_SNAPSHOT_INVALID"
];

/**
 * The plan gate tells the human that the run waits and how to continue after
 * editing (ADR-0058 §6). The CLI names its command instead of the menu choice.
 */
export function planGateWaitingLines(
  paths: readonly string[],
  surface: "terminal" | "cli"
): string[] {
  return [
    surface === "terminal"
      ? "The run is waiting. Edit these files in any editor, then choose Re-check my edits. Exit and decide later keeps the run."
      : "The run is waiting. Edit these files in any editor, then run `banzai approve plan --decision recheck`. The run keeps waiting until you decide.",
    ...paths.map((item) => escapeTerminalText(`  ${item}`))
  ];
}

function joined(values: readonly string[], omitted = 0): string {
  return `${values.join(", ")}${omitted > 0 ? ` and ${omitted} more` : ""}`;
}

/** Paths, headings, check identities and field names only (ADR-0058 §3). */
export function planRecheckLines(record: PlanRecheckRecord): string[] {
  const { summary } = record;
  const lines = ["Re-check of your edits:"];
  lines.push(
    summary.remainderDigestRewritten
      ? "  The plan's remainder digest was updated to match your edits."
      : "  The plan's remainder digest already matched; no file was written."
  );
  if (!summary.plannerVersion) {
    lines.push(
      "  The planner's version is unavailable: this run reached the gate before it was retained."
    );
    if (summary.checks.current.length > 0)
      lines.push(
        `  Current checks: ${joined(summary.checks.current, summary.checks.omitted)}`
      );
    return lines.map(escapeTerminalText);
  }
  if (summary.files.length === 0)
    lines.push("  No file differs from the planner's version.");
  for (const file of summary.files) {
    lines.push(
      `  ${file.change === "changed" ? "Changed" : file.change === "added" ? "Added" : "Removed"}: ${file.path}`
    );
    const sections = file.sections;
    if (sections === null) continue;
    if (sections.changed.length > 0)
      lines.push(`    Changed sections: ${joined(sections.changed)}`);
    if (sections.added.length > 0)
      lines.push(`    Added sections: ${joined(sections.added)}`);
    if (sections.removed.length > 0)
      lines.push(`    Removed sections: ${joined(sections.removed)}`);
    if (sections.omitted > 0)
      lines.push(`    ${sections.omitted} more changed sections`);
  }
  if (summary.omittedFiles > 0)
    lines.push(`  ${summary.omittedFiles} more changed files`);
  const checks = summary.checks;
  if (checks.added.length > 0)
    lines.push(`  Checks added: ${joined(checks.added)}`);
  if (checks.removed.length > 0)
    lines.push(`  Checks removed: ${joined(checks.removed)}`);
  for (const change of checks.changed)
    lines.push(`  Check ${change.id} changed: ${change.fields.join(", ")}`);
  if (checks.absenceReasonChanged)
    lines.push("  The rationale for running no checks changed.");
  if (
    checks.omitted > 0 &&
    (checks.added.length > 0 ||
      checks.removed.length > 0 ||
      checks.changed.length > 0)
  )
    lines.push(`  ${checks.omitted} more check changes`);
  for (const adr of summary.acceptedAdrsChanged)
    lines.push(
      `  Warning: accepted ADR ${adr} changed. Accepted ADR bodies are immutable, and the runner cannot tell lifecycle metadata from body text; review this change before approving.`
    );
  return lines.map(escapeTerminalText);
}
