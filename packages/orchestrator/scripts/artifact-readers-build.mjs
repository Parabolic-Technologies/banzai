import { build } from "esbuild";

// Ship the existing persisted readers to plugin-only archives without requiring
// an installed orchestrator or maintaining a second interpretation of evidence.
export async function artifactReaderBytes(packageRoot) {
  const result = await build({
    absWorkingDir: packageRoot,
    stdin: {
      contents:
        'export { parseTerminalAttemptCheckpoint, parseRecoveryAuthorization, parseModelAttemptRecord, parseVerificationAttemptRecord, parseEvaluationStateSource, parsePersistedPhaseResult, parseReviewResult, parseCurrentReviewResult } from "./src/validation.ts";',
      resolveDir: packageRoot,
      sourcefile: "artifact-readers-entry.mjs"
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node22",
    banner: {
      js: "// Generated from orchestrator persisted readers by npm run build. Do not edit."
    }
  });
  return result.outputFiles[0].contents;
}
