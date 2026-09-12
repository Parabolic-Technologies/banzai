import { readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

function pathsFromArguments(args) {
  let testRoot = path.join(packageRoot, "test");
  let outputRoot = path.join(packageRoot, ".test-dist");
  let pattern = null;
  const files = [];
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (value === undefined) {
      throw new Error("Invalid test-driver options.");
    }
    if (option === "--test-root") {
      testRoot = path.resolve(value);
    } else if (option === "--output-root") {
      outputRoot = path.resolve(value);
    } else if (option === "--pattern") {
      pattern = value;
    } else if (option === "--file") {
      if (
        !value.endsWith(".test.ts") ||
        value.includes("\\") ||
        path.posix.isAbsolute(value) ||
        value.split("/").some((part) => !part || part === "." || part === "..")
      ) {
        throw new Error(
          "Invalid test file. Use an exact test-root-relative .test.ts path."
        );
      }
      files.push(value);
    } else {
      throw new Error("Invalid test-driver options.");
    }
  }
  return { testRoot, outputRoot, pattern, files: [...new Set(files)].sort() };
}

const { testRoot, outputRoot, pattern, files } = pathsFromArguments(
  process.argv.slice(2)
);
let child = null;
let interrupted = false;

function stopChild() {
  if (child?.pid === undefined) {
    return;
  }
  try {
    process.kill(
      process.platform === "win32" ? child.pid : -child.pid,
      "SIGTERM"
    );
  } catch {
    // The test process may already have exited.
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interrupted = true;
    stopChild();
    process.exitCode = 1;
  });
}

try {
  const discovered = (
    await readdir(testRoot, { recursive: true, withFileTypes: true })
  )
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) =>
      path
        .relative(testRoot, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/")
    )
    .sort();
  if (files.some((file) => !discovered.includes(file))) {
    throw new Error("Selected test file was not found in the test root.");
  }
  const entries = (files.length === 0 ? discovered : files).map((entry) =>
    path.join(testRoot, entry)
  );

  if (entries.length === 0) {
    throw new Error("No orchestrator tests found.");
  }

  await rm(outputRoot, { recursive: true, force: true });
  await build({
    entryPoints: entries,
    outdir: outputRoot,
    outbase: testRoot,
    bundle: true,
    external: ["@inquirer/core", "@inquirer/prompts"],
    format: "esm",
    platform: "node",
    target: "node22",
    sourcemap: true,
    outExtension: {
      ".js": ".mjs"
    }
  });

  const testFiles = (await readdir(outputRoot, { recursive: true }))
    .filter((entry) => entry.endsWith(".test.mjs"))
    .sort()
    .map((entry) => path.join(outputRoot, entry));

  const testArguments = [
    "--test",
    "--test-reporter=spec",
    ...(pattern === null ? [] : [`--test-name-pattern=${pattern}`]),
    ...testFiles
  ];
  if (interrupted)
    throw new Error("Test driver interrupted before test execution.");
  child = spawn(process.execPath, testArguments, {
    cwd: packageRoot,
    detached: process.platform !== "win32",
    stdio: "inherit"
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      child = null;
      if (signal) {
        reject(new Error(`Test process exited via ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
  process.exitCode = interrupted ? 1 : exitCode;
} finally {
  stopChild();
  await rm(outputRoot, { recursive: true, force: true });
}
