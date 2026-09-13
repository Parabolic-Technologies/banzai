import type { EvaluationKpiV2 } from "./types.js";

export function renderEvaluationKpiJson(report: EvaluationKpiV2): string {
  return `${JSON.stringify(report, null, 2)}\n`;
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

export const renderEvaluationKpiMarkdown = renderEvaluationKpiV2Markdown;
