import { chmod, rm, writeFile } from "node:fs/promises";
import { artifactReaderBytes } from "./artifact-readers-build.mjs";
import { phaseResourceBytes } from "./phase-resources-build.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const outputFile = path.join(packageRoot, "dist", "banzai.mjs");

await writeFile(
  path.join(packageRoot, "src", "phase-resources.ts"),
  await phaseResourceBytes(path.resolve(packageRoot, "../.."))
);

await writeFile(
  path.resolve(packageRoot, "../../plugins/banzai/lib/artifact-readers.mjs"),
  await artifactReaderBytes(packageRoot)
);

await rm(path.dirname(outputFile), { recursive: true, force: true });
await build({
  entryPoints: [path.join(packageRoot, "src", "cli.ts")],
  outfile: outputFile,
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  target: "node22",
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node"
  }
});
await chmod(outputFile, 0o755);
