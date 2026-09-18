import {
  legacyPhaseResultV3Schema,
  taskPhaseResultSchema,
  legacyReviewResultSchema,
  reviewResultSchema,
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
  if (identity === "workflow-selection/v1") return workflowSelectionSchema;
  if (identity === "phase-result/v4") return taskPhaseResultSchema;
  if (identity === "phase-result/v3") return legacyPhaseResultV3Schema;
  if (identity === "review-result/v1") return legacyReviewResultSchema;
  return reviewResultSchema;
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
