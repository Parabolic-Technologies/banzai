import * as storage from "../../../plugins/banzai/lib/artifact-storage.mjs";

export type AdoptionClassification = storage.AdoptionClassification;
export type AdoptionIssue = storage.AdoptionIssue;
export type ProjectAdoption = storage.ProjectAdoption;
export type ArtifactWorkBinding = storage.WorkBinding;
export type ArtifactBoundWork = storage.BoundWork;
export type ArtifactInspection = storage.ArtifactInspection;
export const {
  inspectProjectAdoption,
  readAdoptionFile,
  ADOPTION_LABELS,
  SCAFFOLD_MARKER,
  GUIDANCE_MAX_BYTES,
  adoptionDiagnostic,
  readSharedReviewSnapshot,
  sealSharedReviewSnapshot,
  artifactCommand,
  inspectArtifacts,
  initializeArtifacts,
  createWork,
  readBinding,
  parseBinding,
  inspectBoundWork,
  privateArtifactInventory,
  ownsArtifact,
  verifyIgnores,
  safePath,
  readBytes,
  digestBytes,
  canonicalJson,
  hasRunnerWorkOwnership,
  withRunnerWorkOwnership,
  acquireWork,
  writeArtifact,
  releaseWork,
  ArtifactStorageError
} = storage;
