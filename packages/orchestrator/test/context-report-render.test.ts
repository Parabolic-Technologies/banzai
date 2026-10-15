import assert from "node:assert/strict";
import test from "node:test";
import {
  renderContextReportJson,
  renderContextReportMarkdown
} from "../src/context-report-render.js";
import {
  CONTEXT_REPORT_SCHEMA,
  CONTEXT_REPORT_SCHEMA_VERSION,
  type ContextNumericAggregate,
  type ContextReport
} from "../src/types.js";

const unavailable: ContextNumericAggregate = {
  total: null,
  mean: null,
  maximum: null,
  observed: 0,
  unavailable: 1
};

function report(): ContextReport {
  return {
    schema: CONTEXT_REPORT_SCHEMA,
    schemaVersion: CONTEXT_REPORT_SCHEMA_VERSION,
    cohort: {
      from: null,
      to: null,
      requestedRunIds: [],
      discoveredRunCount: 2,
      includedRunCount: 2,
      unresolvedRunIds: []
    },
    coverage: { exact: 1, incomplete: 1 },
    groups: [
      {
        workflow: "strict",
        phase: "plan",
        role: "planner",
        attemptCoverage: { exact: 1, incomplete: 1 },
        invocationCount: 1,
        runnerPayload: {
          total: 120,
          mean: 120,
          maximum: 120,
          observed: 1,
          unavailable: 0
        },
        categories: [
          { category: "phase_instructions", bytes: 80 },
          { category: "output_contract", bytes: 40 }
        ],
        budgets: [],
        vendorUsage: {
          inputTokens: unavailable,
          cachedInputTokens: unavailable,
          outputTokens: unavailable,
          costUsd: unavailable,
          turns: unavailable
        },
        sessionInventory: {
          tools: unavailable,
          mcpServers: unavailable,
          skills: unavailable,
          commands: unavailable
        }
      }
    ]
  };
}

test("context JSON is canonical and both renderers are byte-deterministic", () => {
  const value = report();
  const json = renderContextReportJson(value);
  const markdown = renderContextReportMarkdown(value);
  assert.equal(json, renderContextReportJson(value));
  assert.equal(markdown, renderContextReportMarkdown(value));
  assert.equal(json, `${JSON.stringify(value, null, 2)}\n`);
  assert.equal(
    (JSON.parse(json) as { schema: unknown }).schema,
    "banzai-context-report/v2"
  );
});

test("context Markdown shows coverage before separately labeled evidence surfaces", () => {
  const markdown = renderContextReportMarkdown(report());
  const coverage = markdown.indexOf("## Physical attempt coverage");
  const runner = markdown.indexOf("### Runner payload bytes");
  const vendor = markdown.indexOf("### Vendor usage");
  const inventory = markdown.indexOf("### Session inventory");
  assert.ok(coverage >= 0 && coverage < runner);
  assert.ok(runner < vendor && vendor < inventory);
  assert.match(markdown, /Incomplete: 1/);
  assert.match(markdown, /unavailable/);
});
