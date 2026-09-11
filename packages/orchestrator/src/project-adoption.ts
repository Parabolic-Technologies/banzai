// The independently installed plugin and bundled CLI share one prerequisite reader.
export {
  inspectProjectAdoption,
  readAdoptionFile,
  ADOPTION_LABELS,
  SCAFFOLD_MARKER,
  GUIDANCE_MAX_BYTES,
  adoptionDiagnostic
} from "./artifact-storage.js";
export type {
  AdoptionClassification,
  AdoptionIssue,
  ProjectAdoption
} from "./artifact-storage.js";
