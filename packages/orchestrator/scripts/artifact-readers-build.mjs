import { build } from "esbuild";
import path from "node:path";
import { realpath } from "node:fs/promises";

// Ship the existing persisted readers to plugin-only archives without requiring
// an installed orchestrator or maintaining a second interpretation of evidence.
export async function artifactReaderBytes(packageRoot) {
  packageRoot = await realpath(packageRoot);
  const result = await build({
    absWorkingDir: packageRoot,
    stdin: {
      contents: 'export * from "./src/persisted-readers.ts";',
      resolveDir: packageRoot,
      sourcefile: "artifact-readers-entry.mjs"
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node22",
    plugins: [
      {
        name: "canonical-persisted-reader-source",
        setup(context) {
          // Shared plugin owners consume the shipped readers at runtime. During
          // generation that edge must resolve to source, never yesterday's output.
          context.onResolve({ filter: /artifact-readers\.mjs$/ }, (args) => {
            const generated = path.resolve(
              packageRoot,
              "../../plugins/banzai/lib/artifact-readers.mjs"
            );
            if (path.resolve(args.resolveDir, args.path) === generated)
              return {
                path: path.join(packageRoot, "src/persisted-readers.ts")
              };
            return undefined;
          });
        }
      }
    ],
    banner: {
      js: "// Generated from orchestrator persisted readers by npm run build. Do not edit."
    }
  });
  return result.outputFiles[0].contents;
}
