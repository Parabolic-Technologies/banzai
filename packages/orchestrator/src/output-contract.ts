import { ResourceVersionUnsupportedError } from "./errors.js";
import {
  phaseResultSchema,
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

function schemaFor(identity: string): object {
  if (identity === "workflow-selection/v1") return workflowSelectionSchema;
  if (identity === "phase-result/v3") return phaseResultSchema;
  if (identity === "review-result/v2") return reviewResultSchema;
  throw new ResourceVersionUnsupportedError(
    "output contract",
    identity,
    "workflow-selection/v1, phase-result/v3, review-result/v2"
  );
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
