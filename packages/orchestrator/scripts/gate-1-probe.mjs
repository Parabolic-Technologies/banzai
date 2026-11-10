// The owner-run Gate 1 probe of ADR-0063 §6. It runs a real Claude Code client
// for more than 11 minutes, so it runs only when the owner starts it.
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const repositoryRoot = path.resolve(packageRoot, "..", "..");
const outputRoot = path.join(packageRoot, ".dist-check-gate-1-probe");

const args = process.argv.slice(2);
if (!args.includes("--repository")) {
  process.stderr.write(
    "Usage: node packages/orchestrator/scripts/gate-1-probe.mjs --repository <scratch repository> [--executable <claude>]\n" +
      "See documentation/work/wp08-stable-claude-phases/gate-1-probe.md.\n"
  );
  process.exit(2);
}

await rm(outputRoot, { recursive: true, force: true });
await build({
  entryPoints: [
    path.join(packageRoot, "test", "probes", "gate-1-probe-main.ts")
  ],
  outdir: outputRoot,
  bundle: true,
  external: ["@inquirer/core", "@inquirer/prompts", "prettier"],
  format: "esm",
  platform: "node",
  target: "node22",
  outExtension: { ".js": ".mjs" }
});

const child = spawn(
  process.execPath,
  [
    path.join(outputRoot, "gate-1-probe-main.mjs"),
    ...args,
    "--plugin-directory",
    path.join(repositoryRoot, "plugins", "banzai")
  ],
  { stdio: "inherit" }
);
process.exitCode = await new Promise((resolve) => {
  child.once("close", (code) => resolve(code ?? 1));
});
