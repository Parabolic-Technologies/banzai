import type {
  ContextNumericAggregate,
  ContextReport,
  ContextReportGroup
} from "./types.js";

function table(
  headers: readonly string[],
  rows: readonly (readonly string[])[]
): string[] {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length))
  );
  const line = (row: readonly string[]): string =>
    `| ${row.map((value, index) => value.padEnd(widths[index] ?? 0)).join(" | ")} |`;
  return [
    line(headers),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.map(line)
  ];
}

function number(value: number | null): string {
  return value === null ? "unavailable" : String(value);
}

function numericRows(
  values: readonly [string, ContextNumericAggregate][]
): string[][] {
  return values.map(([label, value]) => [
    label,
    number(value.total),
    number(value.mean),
    number(value.maximum),
    String(value.observed),
    String(value.unavailable)
  ]);
}

function groupLines(group: ContextReportGroup): string[] {
  const lines = [
    `## ${group.workflow} / ${group.phase} / ${group.role}`,
    "",
    `- Exact physical attempts: ${group.attemptCoverage.exact}`,
    `- Incomplete physical attempts: ${group.attemptCoverage.incomplete}`,
    `- Recorded invocations: ${group.invocationCount}`,
    "",
    "### Runner payload bytes",
    "",
    ...table(
      ["Surface", "Total", "Mean", "Maximum", "Observed", "Unavailable"],
      numericRows([["Runner payload bytes", group.runnerPayload]])
    ),
    "",
    "### Runner payload categories",
    ""
  ];
  lines.push(
    ...(group.categories.length === 0
      ? ["No exact runner-payload category evidence is available."]
      : table(
          ["Category", "Bytes"],
          group.categories.map((item) => [item.category, String(item.bytes)])
        )),
    "",
    "### Vendor usage",
    "",
    ...table(
      ["Metric", "Total", "Mean", "Maximum", "Observed", "Unavailable"],
      numericRows([
        ["Input tokens", group.vendorUsage.inputTokens],
        ["Cached input tokens", group.vendorUsage.cachedInputTokens],
        ["Output tokens", group.vendorUsage.outputTokens],
        ["Cost USD", group.vendorUsage.costUsd],
        ["Turns", group.vendorUsage.turns]
      ])
    ),
    "",
    "### Session inventory",
    "",
    ...table(
      ["Metric", "Total", "Mean", "Maximum", "Observed", "Unavailable"],
      numericRows([
        ["Tools", group.sessionInventory.tools],
        ["MCP servers", group.sessionInventory.mcpServers],
        ["Skills", group.sessionInventory.skills],
        ["Commands", group.sessionInventory.commands]
      ])
    ),
    "",
    "### Context budgets",
    ""
  );
  lines.push(
    ...(group.budgets.length === 0
      ? ["No configured-limit evidence is available."]
      : table(
          [
            "Metric",
            "Maximum",
            "Within",
            "Observed exceeded",
            "Enforced exceeded",
            "Unavailable"
          ],
          group.budgets.map((item) => [
            item.metric,
            String(item.maximum),
            String(item.withinLimit),
            String(item.observedExceeded),
            String(item.enforcedExceeded),
            String(item.unavailable)
          ])
        )),
    ""
  );
  return lines;
}

export function renderContextReportJson(report: ContextReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderContextReportMarkdown(report: ContextReport): string {
  const lines = [
    "# Banzai Context Report",
    "",
    `Schema: \`${report.schema}\` (version ${report.schemaVersion})`,
    "",
    "## Cohort",
    "",
    `- From (inclusive): ${report.cohort.from ?? "all"}`,
    `- To (exclusive): ${report.cohort.to ?? "all"}`,
    `- Requested runs: ${report.cohort.requestedRunIds.length === 0 ? "all" : report.cohort.requestedRunIds.join(", ")}`,
    `- Discovered runs: ${report.cohort.discoveredRunCount}`,
    `- Included runs: ${report.cohort.includedRunCount}`,
    `- Unresolved runs: ${report.cohort.unresolvedRunIds.length}`,
    "",
    "## Physical attempt coverage",
    "",
    `- Exact: ${report.coverage.exact}`,
    `- Incomplete: ${report.coverage.incomplete}`,
    "",
    "Missing historical evidence is incomplete coverage, never a zero measurement.",
    ""
  ];
  if (report.groups.length === 0) {
    lines.push("No context evidence is available for this cohort.", "");
  } else {
    for (const group of report.groups) lines.push(...groupLines(group));
  }
  return `${lines.join("\n")}\n`;
}
