import path from "node:path";
import { realpath } from "node:fs/promises";
import {
  claudeMcpConfig,
  codexMcpServersOverride,
  createVendorAdapters,
  resolveClaudeInvocationScope,
  verifiedPluginDirectory
} from "./adapters.js";
import { BanzaiError } from "./errors.js";
import { resolveSerenaWhitelist } from "./mcp.js";
import { vendorFor } from "./models.js";
import { readAdoptionFile } from "./project-adoption.js";
import { runProcess, subscriptionOnlyEnvironment } from "./process.js";
import type {
  ClaudeInvocationScope,
  ModelSettings,
  OrchestratorConfig,
  ProcessRunner,
  VendorAdapters
} from "./types.js";

export type SetupVendor = "codex" | "claude";
export interface SetupClient {
  vendor: SetupVendor;
  name: string;
  settings: ModelSettings;
  pluginDirectory: string | null;
  unavailable: string | null;
}

export const SETUP_SKILLS = {
  codex: "$banzai:project-manifest",
  claude: "/banzai:project-manifest"
} as const;

export function setupEnvironment(
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env = subscriptionOnlyEnvironment(source);
  delete env.BANZAI_RUN_ID;
  delete env.BANZAI_APPROVAL_DIGEST;
  delete env.BANZAI_WORKFLOW_DIGEST;
  delete env.BANZAI_REVIEW_ARTIFACT;
  return env;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function verifiedSetupPlugin(
  directory: string,
  vendor: SetupVendor
): Promise<string | null> {
  let root: string;
  try {
    root = await realpath(directory);
  } catch {
    return null;
  }
  // Bound every file consumed by the existing hook/skill verifier before using
  // it. Paths come from configuration or client discovery, never cache guesses.
  const required = [
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    "hooks/hooks.json",
    "hooks/spec-gate.cjs",
    ...[
      "architecture-decision",
      "code-writing",
      "development-plan",
      "feature",
      "feature-description",
      "feature-review",
      "feature-status",
      "orchestrate",
      "project-manifest",
      "quick-fix",
      "test-writing"
    ].map((name) => `skills/${name}/SKILL.md`),
    "skills/project-manifest/agents/openai.yaml"
  ];
  const entries = await Promise.all(
    required.map((file) => readAdoptionFile(root, file, 1024 * 1024))
  );
  if (entries.some((entry) => entry.problem !== null || entry.text === null))
    return null;
  const skill =
    entries[required.indexOf("skills/project-manifest/SKILL.md")]?.text ?? "";
  if (
    !/^name: project-manifest\s*$/m.test(skill) ||
    !/^user-invocable: true\s*$/m.test(skill) ||
    !/^disable-model-invocation: true\s*$/m.test(skill)
  )
    return null;
  if (vendor === "codex") {
    try {
      const manifest = record(JSON.parse(entries[1]?.text ?? ""));
      if (
        manifest.name !== "banzai" ||
        manifest.skills !== "./skills/" ||
        manifest.hooks !== "./hooks/hooks.json" ||
        !/^\s+allow_implicit_invocation: false\s*$/m.test(
          entries.at(-1)?.text ?? ""
        )
      )
        return null;
    } catch {
      return null;
    }
  }
  return await verifiedPluginDirectory(root);
}

async function discoverPlugin(
  vendor: SetupVendor,
  executable: string,
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  runner: ProcessRunner
): Promise<string | null> {
  const deadline = performance.now() + 15_000;
  const query = async (args: string[]): Promise<unknown> => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Error("Local discovery deadline reached.");
    const result = await runner({
      command: executable,
      args,
      cwd: repoRoot,
      env,
      timeoutMs: Math.min(5_000, remaining),
      maxOutputBytes: 512 * 1024
    });
    if (result.exitCode !== 0)
      throw new Error("Local plugin discovery unavailable.");
    return JSON.parse(result.stdout) as unknown;
  };
  if (vendor === "claude") {
    const listed = await query(["plugin", "list", "--json"]);
    if (!Array.isArray(listed)) return null;
    const candidates = listed
      .map(record)
      .filter(
        (value) =>
          typeof value.id === "string" &&
          value.id.startsWith("banzai@") &&
          value.enabled === true &&
          typeof value.installPath === "string"
      );
    if (candidates.length !== 1) return null;
    const directory = candidates[0]?.installPath;
    return typeof directory === "string"
      ? await verifiedSetupPlugin(directory, vendor)
      : null;
  }
  // An unfiltered `plugin list` queries the remote catalog. Enumerate the
  // documented local roots, then explicitly select each in-scope marketplace.
  const marketplaces = record(
    await query(["plugin", "marketplace", "list", "--json"])
  ).marketplaces;
  if (!Array.isArray(marketplaces) || marketplaces.length > 32) return null;
  const candidates: string[] = [];
  for (const value of marketplaces) {
    const marketplace = record(value);
    if (
      typeof marketplace.name !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(marketplace.name) ||
      typeof marketplace.root !== "string" ||
      !path.isAbsolute(marketplace.root)
    )
      continue;
    const listed = record(
      await query([
        "plugin",
        "list",
        "--marketplace",
        marketplace.name,
        "--json"
      ])
    ).installed;
    if (!Array.isArray(listed)) continue;
    for (const item of listed) {
      const plugin = record(item);
      const source = record(plugin.source);
      if (
        plugin.name !== "banzai" ||
        plugin.marketplaceName !== marketplace.name ||
        plugin.installed !== true ||
        plugin.enabled !== true ||
        source.source !== "local" ||
        typeof source.path !== "string" ||
        !path.isAbsolute(source.path)
      )
        continue;
      const verified = await verifiedSetupPlugin(source.path, vendor);
      if (verified !== null) candidates.push(verified);
    }
  }
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

export async function discoverSetupClients(
  repoRoot: string,
  config: OrchestratorConfig,
  sourceEnvironment = process.env,
  runner: ProcessRunner = runProcess
): Promise<SetupClient[]> {
  const env = setupEnvironment(sourceEnvironment);
  return await Promise.all(
    (["codex", "claude"] as const).map(async (vendor) => {
      const configured = [
        config.models.planner,
        config.models.implementer,
        config.models.reviewer
      ].find((settings) => vendorFor(settings.executable) === vendor);
      const settings = configured ?? {
        ...config.models.planner,
        executable: vendor
      };
      const client: SetupClient = {
        vendor,
        name: vendor === "codex" ? "Codex" : "Claude Code",
        settings,
        pluginDirectory: null,
        unavailable: null
      };
      if (
        sourceEnvironment.BANZAI_RUN_ID !== undefined ||
        (vendor === "claude" &&
          (sourceEnvironment.CLAUDECODE !== undefined ||
            sourceEnvironment.CLAUDE_CODE_SIMPLE === "1" ||
            sourceEnvironment.CLAUDE_CODE_SAFE_MODE === "1"))
      ) {
        client.unavailable =
          "Nested setup is unavailable; return to your regular terminal.";
        return client;
      }
      try {
        const help = await runner({
          command: settings.executable,
          args: ["--help"],
          cwd: repoRoot,
          env,
          timeoutMs: 5_000,
          maxOutputBytes: 128 * 1024
        });
        if (
          help.exitCode !== 0 ||
          !help.stdout.includes(
            vendor === "codex" ? "--ask-for-approval" : "--permission-mode"
          )
        )
          throw new Error();
        if (
          vendor === "claude" &&
          config.claudeEnvironment.pluginDirectory !== null
        ) {
          client.pluginDirectory = await verifiedSetupPlugin(
            config.claudeEnvironment.pluginDirectory,
            vendor
          );
        } else
          client.pluginDirectory = await discoverPlugin(
            vendor,
            settings.executable,
            repoRoot,
            env,
            runner
          );
        if (client.pluginDirectory === null)
          client.unavailable =
            "The enabled Banzai project-manifest skill could not be verified locally. Use manual instructions.";
      } catch {
        client.unavailable =
          "Client or local plugin discovery is unavailable. Use manual instructions.";
      }
      return client;
    })
  );
}

export interface SetupLaunch {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export async function prepareSetupLaunch(
  client: SetupClient,
  repoRoot: string,
  config: OrchestratorConfig,
  sourceEnvironment = process.env,
  dependencies: { runner?: ProcessRunner; adapters?: VendorAdapters } = {}
): Promise<SetupLaunch> {
  if (
    sourceEnvironment.BANZAI_RUN_ID !== undefined ||
    (client.vendor === "claude" && sourceEnvironment.CLAUDECODE !== undefined)
  )
    throw new BanzaiError(
      "PROJECT_SETUP_NESTED",
      "Return to your regular terminal before project setup."
    );
  const runner = dependencies.runner ?? runProcess;
  const fresh = (
    await discoverSetupClients(repoRoot, config, sourceEnvironment, runner)
  ).find((value) => value.vendor === client.vendor);
  if (fresh?.unavailable !== null || fresh.pluginDirectory === null)
    throw new BanzaiError(
      "PROJECT_SETUP_CLIENT_UNAVAILABLE",
      fresh?.unavailable ?? "The explicit skill is unavailable."
    );
  const env = setupEnvironment(sourceEnvironment);
  const adapters = dependencies.adapters ?? createVendorAdapters(runner);
  if (client.vendor === "codex")
    await adapters.preflightCodex(fresh.settings, env);
  else await adapters.preflightClaude(fresh.settings, env);
  const mcp = await resolveSerenaWhitelist({
    repoRoot,
    codexExecutable:
      client.vendor === "codex" ? fresh.settings.executable : null,
    env,
    runner
  });
  let args: string[];
  if (client.vendor === "codex") {
    args = ["--sandbox", "workspace-write", "--ask-for-approval", "on-request"];
    if (mcp.codex !== null) args.push("-c", codexMcpServersOverride(mcp.codex));
  } else {
    const resolved = await resolveClaudeInvocationScope({
      ...config.claudeEnvironment,
      pluginDirectory: fresh.pluginDirectory
    });
    const scope: ClaudeInvocationScope = resolved.scope;
    args = ["--permission-mode", "default", "--strict-mcp-config"];
    if (scope.settingSources !== null)
      args.push("--setting-sources", scope.settingSources);
    args.push("--plugin-dir", fresh.pluginDirectory);
    if (mcp.claude !== null)
      args.push("--mcp-config", claudeMcpConfig(mcp.claude));
  }
  args.push(SETUP_SKILLS[client.vendor]);
  return { command: fresh.settings.executable, args, cwd: repoRoot, env };
}
