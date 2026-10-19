import {
  parseBinding,
  type BoundWork
} from "../../../plugins/banzai/lib/work-documents.mjs";

export type {
  WorkBinding as ArtifactWorkBinding,
  BoundWork as ArtifactBoundWork
} from "../../../plugins/banzai/lib/work-documents.mjs";
export {
  createExecutionBinding,
  documentRoles,
  parseBinding,
  inspectBoundWork,
  ownsArtifact,
  planningReviewFilenames,
  workDocumentInventory,
  verifyDocumentVisibility
} from "../../../plugins/banzai/lib/work-documents.mjs";
export {
  hasRunnerWorkOwnership,
  withRunnerWorkOwnership,
  ensureExecutionIgnores
} from "../../../plugins/banzai/lib/execution-ownership.mjs";

/**
 * Work bound before binding v3 is read-only history: `inspectBoundWork` refuses
 * to resume it, and its persisted digest covers a private `work.json` that
 * current inventory rules never recompute.
 */
export function isHistoricalWork(bound: BoundWork | undefined): boolean {
  return bound !== undefined && parseBinding(bound.binding).schemaVersion !== 3;
}
