import assert from "node:assert/strict";
import test from "node:test";
import { terminalResultContract } from "../../../src/workflow/domain/routing.js";

test("terminal checkpoints record the result contract of their attempt kind", () => {
  const rows: [Parameters<typeof terminalResultContract>, string][] = [
    [["selection"], "workflow-selection/v1"],
    [["selection", true], "workflow-selection/v1"],
    [["review"], "review-result/v2"],
    [["review", true], "review-result/v2"],
    [["planning_review"], "planning-review-result/v1"],
    [["planning_review", true], "planning-review-result/v1"],
    [["planning_analysis"], "planning-review-analysis/v1"],
    [["planning_analysis", true], "planning-review-analysis/v1"],
    [["plan"], "phase-result/v3"],
    [["implementation"], "phase-result/v3"],
    [["implementation", true], "phase-result/v4"],
    [["fix", true], "phase-result/v4"]
  ];
  for (const [input, contract] of rows)
    assert.equal(terminalResultContract(...input), contract, input.join(","));
});
