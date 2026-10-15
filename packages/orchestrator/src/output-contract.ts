import {
  legacyPhaseResultV3Schema,
  taskPhaseResultSchema,
  legacyReviewResultSchema,
  reviewResultSchema,
  planningReviewResultSchema,
  planningReviewAnalysisSchema,
  workflowSelectionSchema
} from "./contracts.js";
import type {
  OutputContractEnvelope,
  OutputContractIdentity
} from "./types.js";

export function claudeJsonSchema(schema: object): Record<string, unknown> {
  const clone = structuredClone(schema) as Record<string, unknown>;
  delete clone.$schema;
  return clone;
}

function schemaFor(identity: OutputContractIdentity): object {
  switch (identity) {
    case "workflow-selection/v1":
      return workflowSelectionSchema;
    case "phase-result/v4":
      return taskPhaseResultSchema;
    case "phase-result/v3":
      return legacyPhaseResultV3Schema;
    case "review-result/v1":
      return legacyReviewResultSchema;
    case "review-result/v2":
      return reviewResultSchema;
    case "planning-review-result/v1":
      return planningReviewResultSchema;
    case "planning-review-analysis/v1":
      return planningReviewAnalysisSchema;
    default: {
      const unmapped: never = identity;
      throw new Error(`Unknown output contract: ${String(unmapped)}`);
    }
  }
}

export function resolveOutputContract(
  vendor: "codex" | "claude",
  identity: OutputContractIdentity
): OutputContractEnvelope {
  const schema = schemaFor(identity);
  return {
    vendor,
    identity,
    serialized:
      vendor === "claude"
        ? JSON.stringify(claudeJsonSchema(schema))
        : `${JSON.stringify(schema, null, 2)}\n`
  };
}
