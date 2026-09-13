import contractManifest from "../../../plugins/banzai/contracts/contract.json" with { type: "json" };
import reviewResultSchema from "../../../plugins/banzai/contracts/v2/review-result.schema.json" with { type: "json" };
import workflowSelectionSchema from "../../../plugins/banzai/contracts/v1/workflow-selection.schema.json" with { type: "json" };
import phaseResultSchema from "../../../plugins/banzai/contracts/v3/phase-result.schema.json" with { type: "json" };
import { BanzaiError } from "./errors.js";
import { CONTRACT_VERSION, PHASE_RESULT_SCHEMA_VERSION } from "./types.js";

export {
  contractManifest,
  phaseResultSchema,
  reviewResultSchema,
  workflowSelectionSchema
};

export function assertContractParity(): void {
  if (contractManifest.contractVersion !== CONTRACT_VERSION) {
    throw new BanzaiError(
      "CONTRACT_VERSION_MISMATCH",
      `Plugin contract ${contractManifest.contractVersion} does not match orchestrator contract ${CONTRACT_VERSION}.`
    );
  }

  if (
    contractManifest.schemas.phaseResult !== "./v3/phase-result.schema.json" ||
    workflowSelectionSchema.properties.contractVersion.const !==
      CONTRACT_VERSION ||
    phaseResultSchema.properties.contractVersion.const !== CONTRACT_VERSION ||
    phaseResultSchema.properties.schemaVersion.const !==
      PHASE_RESULT_SCHEMA_VERSION ||
    contractManifest.schemas.reviewResult !==
      "./v2/review-result.schema.json" ||
    reviewResultSchema.properties.schemaVersion.const !== 2 ||
    reviewResultSchema.properties.contractVersion.const !== CONTRACT_VERSION
  ) {
    throw new BanzaiError(
      "SCHEMA_VERSION_MISMATCH",
      "Bundled schema contract versions do not match the orchestrator."
    );
  }
}
