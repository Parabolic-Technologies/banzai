import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { artifactReaderBytes } from "./artifact-readers-build.mjs";
import { checkPhaseResourceBytes } from "./phase-resources-build.mjs";
import { initResourceBytes } from "./init-resources-build.mjs";

const execFileAsync = promisify(execFile);
const defaultPackageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

function optionsFromArguments(args) {
  if (args.length === 0) {
    return { packageRoot: defaultPackageRoot, smoke: true };
  }
  if (args.length === 2 && args[0] === "--package-root") {
    return { packageRoot: path.resolve(args[1]), smoke: true };
  }
  if (
    args.length === 3 &&
    args[0] === "--package-root" &&
    args[2] === "--parity-only"
  ) {
    return { packageRoot: path.resolve(args[1]), smoke: false };
  }
  throw new Error("Invalid dist-check options.");
}

async function checkDistribution(packageRoot, smokeRequired) {
  const expectedInit = await initResourceBytes(
    path.resolve(packageRoot, "../..")
  );
  const actualInit = await readFile(
    path.join(packageRoot, "src/init-resources.ts"),
    "utf8"
  ).catch(() => null);
  if (actualInit !== expectedInit)
    throw new Error(
      "Generated initialization resources are stale. Run `npm run build`."
    );
  await checkPhaseResourceBytes(path.resolve(packageRoot, "../.."));
  const generatedReaders = Buffer.from(await artifactReaderBytes(packageRoot));
  const shippedReaders = await readFile(
    path.resolve(packageRoot, "../../plugins/banzai/lib/artifact-readers.mjs")
  );
  if (!generatedReaders.equals(shippedReaders))
    throw new Error(
      "Generated artifact readers are stale. Run `npm run build`."
    );
  const temporaryRoot = await mkdtemp(path.join(packageRoot, ".dist-check-"));
  const temporaryFile = path.join(temporaryRoot, "banzai.mjs");
  const committedFile = path.join(packageRoot, "dist", "banzai.mjs");

  try {
    await build({
      entryPoints: [path.join(packageRoot, "src", "cli.ts")],
      outfile: temporaryFile,
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

    for (const suffix of ["", ".map"]) {
      const generated = await readFile(`${temporaryFile}${suffix}`).catch(
        () => null
      );
      const committed = await readFile(`${committedFile}${suffix}`).catch(
        () => null
      );
      if (
        generated === null ||
        committed === null ||
        !generated.equals(committed)
      ) {
        throw new Error(
          "Generated orchestrator distribution is stale. Run `npm run build` and commit dist/."
        );
      }
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  if (smokeRequired) {
    const smoke = await execFileAsync(process.execPath, [committedFile], {
      cwd: packageRoot,
      encoding: "utf8"
    });
    if (
      !smoke.stdout.includes("Usage:") ||
      !smoke.stdout.includes("banzai interactive")
    ) {
      throw new Error(
        "Generated orchestrator distribution did not pass the non-TTY CLI smoke."
      );
    }
  }
}

const options = optionsFromArguments(process.argv.slice(2));
await checkDistribution(options.packageRoot, options.smoke);
