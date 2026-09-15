import packageManifest from "../package.json" with { type: "json" };
import { BanzaiError } from "./errors.js";
import { runProcess, subscriptionOnlyEnvironment } from "./process.js";
import type { ProcessRunner } from "./types.js";

const VERSION_FLAGS = new Set(["--version", "-v", "—version"]);
const PLUGIN_VERSION_FLAGS = new Set([
  "--plugin-version",
  "-pv",
  "—plugin-version"
]);

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid local plugin inventory.");
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid local plugin inventory.");
  return value;
}

function version(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 200 ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
  )
    throw new Error("Installed plugin version is unavailable.");
  return value;
}

async function installedVersions(
  vendor: "codex" | "claude",
  cwd: string,
  env: NodeJS.ProcessEnv,
  runner: ProcessRunner
): Promise<string[]> {
  const deadline = performance.now() + 15_000;
  const query = async (args: string[]): Promise<unknown> => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Error("Local discovery deadline reached.");
    const result = await runner({
      command: vendor,
      args,
      cwd,
      env,
      timeoutMs: Math.min(5_000, remaining),
      maxOutputBytes: 512 * 1024
    });
    if (result.exitCode !== 0) throw new Error("Local discovery unavailable.");
    return JSON.parse(result.stdout) as unknown;
  };
  if (vendor === "claude") {
    return array(await query(["plugin", "list", "--json"]))
      .map(record)
      .filter(
        (plugin) =>
          typeof plugin.id === "string" && plugin.id.startsWith("banzai@")
      )
      .map((plugin) => version(plugin.version));
  }
  const marketplaces = array(
    record(await query(["plugin", "marketplace", "list", "--json"]))
      .marketplaces
  );
  if (marketplaces.length > 32) throw new Error("Too many local marketplaces.");
  const versions: string[] = [];
  for (const entry of marketplaces) {
    const { name } = record(entry);
    if (
      typeof name !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(name)
    )
      throw new Error("Invalid local marketplace name.");
    // An unfiltered Codex plugin list queries the remote catalog.
    const installed = array(
      record(await query(["plugin", "list", "--marketplace", name, "--json"]))
        .installed
    );
    for (const entry of installed) {
      const plugin = record(entry);
      if (
        plugin.name === "banzai" &&
        plugin.marketplaceName === name &&
        plugin.installed === true
      )
        versions.push(version(plugin.version));
    }
  }
  return versions;
}

export async function executeVersionCli(
  args: readonly string[],
  cwd: string,
  stdout: (text: string) => void,
  sourceEnvironment = process.env,
  runner: ProcessRunner = runProcess
): Promise<boolean> {
  const command = args[0] ?? "";
  if (!VERSION_FLAGS.has(command) && !PLUGIN_VERSION_FLAGS.has(command))
    return false;
  if (args.length !== 1)
    throw new BanzaiError(
      "INVALID_VERSION_COMMAND",
      "Version commands accept no additional arguments. Use `banzai --version` or `banzai --plugin-version`."
    );
  if (VERSION_FLAGS.has(command)) {
    stdout(`${packageManifest.version}\n`);
    return true;
  }
  const env = subscriptionOnlyEnvironment(sourceEnvironment);
  const results = await Promise.all(
    (["codex", "claude"] as const).map(async (vendor) => {
      try {
        return await installedVersions(vendor, cwd, env, runner);
      } catch {
        return null;
      }
    })
  );
  for (const [index, name] of ["Codex", "Claude Code"].entries()) {
    const versions = results[index];
    const value =
      versions == null
        ? "unavailable"
        : versions.length === 0
          ? "not installed"
          : [...new Set(versions)].join(", ");
    stdout(`${name}: ${value}\n`);
  }
  if (!results.some((versions) => versions !== null && versions.length > 0))
    throw new BanzaiError(
      "PLUGIN_VERSION_UNAVAILABLE",
      "No installed Banzai plugin version could be read. Check the local Codex or Claude Code plugin installation."
    );
  return true;
}
