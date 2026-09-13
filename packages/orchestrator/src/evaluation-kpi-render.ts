import type { EvaluationKpiV2 } from "./types.js";
import type {
  EvaluationKpiEntry,
  EvaluationKpiReport,
  KpiUnit,
  KpiValue
} from "./types.js";

function table(
  headers: readonly string[],
  rows: readonly (readonly string[])[]
): string[] {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`)
  ];
}

function amount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function cell(unit: KpiUnit, item: KpiValue): string {
  const rendered =
    item.value === null
      ? "unavailable"
      : unit === "ratio"
        ? `${(100 * item.value).toFixed(1)}%`
        : unit === "mean"
          ? item.value.toFixed(2)
          : String(item.value);
  return `${rendered} (${amount(item.numerator)}/${amount(item.denominator)}; exact ${item.coverage.exact}, incomplete ${item.coverage.incomplete})`;
}

function entryRows(
  entries: readonly (EvaluationKpiEntry | undefined)[],
  unit: KpiUnit
): string[][] {
  const rows: string[][] = [];
  rows.push([
    "overall",
    ...entries.map((entry) =>
      entry === undefined ? "-" : cell(unit, entry.overall)
    )
  ]);
  const workflowKeys: string[] = [];
  for (const entry of entries) {
    for (const group of entry?.byWorkflow ?? []) {
      if (!workflowKeys.includes(group.group)) {
        workflowKeys.push(group.group);
      }
    }
  }
  for (const key of workflowKeys) {
    rows.push([
      key,
      ...entries.map((entry) => {
        const group = entry?.byWorkflow?.find((item) => item.group === key);
        return group === undefined ? "-" : cell(unit, group.value);
      })
    ]);
  }
  const signatureKeys = [
    ...new Set(
      entries.flatMap((entry) =>
        (entry?.bySignature ?? []).map((group) => group.group)
      )
    )
  ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  for (const key of signatureKeys) {
    rows.push([
      key,
      ...entries.map((entry) => {
        const group = entry?.bySignature.find((item) => item.group === key);
        return group === undefined ? "-" : cell(unit, group.value);
      })
    ]);
  }
  return rows;
}

export function renderEvaluationKpiJson(report: EvaluationKpiReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderEvaluationKpiMarkdown(
  report: EvaluationKpiReport
): string {
  const lines: string[] = [
    "# Banzai Evaluation KPIs",
    "",
    `Schema: \`${report.schema}\` (version ${report.schemaVersion})`,
    "",
    "## Sources",
    "",
    ...table(
      ["Ordinal", "Label", "Included runs", "Issues"],
      report.sources.map((source) => [
        String(source.ordinal),
        source.label,
        String(source.includedRunCount),
        String(source.issueCount)
      ])
    ),
    "",
    "Each cell reads `value (numerator/denominator; exact e, incomplete i)`: only runs with exact evidence contribute, and a zero denominator renders as unavailable rather than inventing a value."
  ];
  const first = report.sources[0];
  if (first !== undefined) {
    first.kpis.forEach((definition, index) => {
      const entries = report.sources.map((source) => source.kpis[index]);
      lines.push(
        "",
        `## ${definition.kpi} (${definition.measure})`,
        "",
        ...table(
          ["Row", ...report.sources.map((source) => source.label)],
          entryRows(entries, definition.unit)
        )
      );
    });
  }
  lines.push("");
  return lines.join("\n");
}

export function renderEvaluationKpiV2Markdown(report: EvaluationKpiV2): string {
  return (
    "# Banzai Evaluation KPIs\n\nSchema: `banzai-evaluation-kpi/v2` (version 2)\n\n" +
    "Counts and ratios use exact runs only; incomplete coverage remains explicit.\n\n" +
    "| Source | Physical attempts | Executed checks | Reused checks | Reuse ratio | Exact / incomplete runs |\n| --- | --- | --- | --- | --- | --- |\n" +
    report.sources
      .map(
        (source) =>
          `| ${source.ordinal} | ${source.physicalAttempts} | ${source.executedChecks} | ${source.reusedChecks} | ${source.reuseRatio.value ?? "unavailable"} (${source.reuseRatio.numerator}/${source.reuseRatio.denominator}) | ${source.coverage.exact} / ${source.coverage.incomplete} |`
      )
      .join("\n") +
    "\n"
  );
}
