import { initializeArtifacts } from "./artifact-storage.js";
import { BanzaiError } from "./errors.js";
import { RunStore } from "./store.js";
import { runForegroundClient } from "./foreground-client.js";
import { inspectProjectAdoption, SCAFFOLD_MARKER } from "./project-adoption.js";
import type { ProjectAdoption } from "./project-adoption.js";
import {
  discoverSetupClients,
  prepareSetupLaunch,
  SETUP_SKILLS
} from "./setup-client.js";
import { vendorFor } from "./models.js";
import type { InteractiveIO, InteractiveChoice } from "./interactive.js";
import type { OrchestratorConfig } from "./types.js";

export const SETUP_PLUGIN_PREREQUISITE =
  "The Banzai plugin must be installed and enabled in your chosen client before invoking the skill.";

export async function withProjectSetupOwnership<T>(
  repoRoot: string,
  action: () => Promise<T>,
  env: NodeJS.ProcessEnv = process.env
): Promise<T> {
  if (env.BANZAI_RUN_ID !== undefined) {
    throw new BanzaiError(
      "PROJECT_SETUP_NESTED",
      "Project setup cannot launch inside a Banzai run. Return to your terminal and finish or explicitly cancel the run first."
    );
  }
  const store = new RunStore(repoRoot);
  const lock = await store.acquireLock({ reclaimStale: false });
  try {
    await store.assertSetupEligible();
    return await action();
  } finally {
    await lock.release();
  }
}

export function renderProjectAdoption(
  io: Pick<InteractiveIO, "writeLine">,
  result: ProjectAdoption
): void {
  io.writeLine(result.label);
  for (const file of ["PROJECT_MANIFEST.md", "AGENTS.md", "CLAUDE.md"]) {
    const entry = result.files.find((entry) => entry.file === file);
    let status = "Not inspected";
    if (entry?.status === "present") status = "Present";
    else if (entry?.status === "unreadable") status = "Needs attention";
    else if (entry?.status === "missing") {
      status =
        file === "CLAUDE.md"
          ? result.classification !== "ready" && !result.sourceRepository
            ? "Missing (created during setup)"
            : "Missing (optional)"
          : "Missing";
    }
    io.writeLine(`  ${file.padEnd(23)}${status}`);
  }
  for (const issue of result.issues)
    if (issue.reason !== "missing")
      io.writeLine(`  ${issue.file}: ${issue.reason}`);
  if (result.issues.some((issue) => issue.reason === "scaffold marker present"))
    io.writeLine(
      `Remove ${SCAFFOLD_MARKER} only after the approved manifest population is applied.`
    );
  if (result.classification !== "ready") {
    io.writeLine("");
    io.writeLine("Run banzai:project-manifest to prepare project guidance.");
    io.writeLine("");
  }
}

export function showManualSetup(io: Pick<InteractiveIO, "writeLine">): void {
  io.writeLine(SETUP_PLUGIN_PREREQUISITE);
  io.writeLine(
    "Open your installed client in this project and explicitly invoke:"
  );
  io.writeLine(`  Codex: ${SETUP_SKILLS.codex}`);
  io.writeLine(`  Claude Code: ${SETUP_SKILLS.claude}`);
  io.writeLine(
    "Answer the bootstrap questions and review the proposed file changes. Exit the client, then run banzai setup again to inspect guidance."
  );
}

export async function runProjectSetup(
  repoRoot: string,
  config: OrchestratorConfig,
  io: InteractiveIO,
  dependencies: {
    env?: NodeJS.ProcessEnv;
    discover?: typeof discoverSetupClients;
    prepare?: typeof prepareSetupLaunch;
    launch?: typeof runForegroundClient;
  } = {}
): Promise<number> {
  const initial = await inspectProjectAdoption(repoRoot);
  renderProjectAdoption(io, initial);
  if (initial.classification === "ready") {
    return withProjectSetupOwnership(
      repoRoot,
      async () => {
        await initializeArtifacts({ repoRoot });
        return 0;
      },
      dependencies.env
    );
  }
  const controller = new AbortController();
  let interruption = 0;
  const onInt = () => {
    interruption = 130;
    controller.abort();
  };
  const onTerm = () => {
    interruption = 143;
    controller.abort();
  };
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  try {
    return await withProjectSetupOwnership(
      repoRoot,
      async () => {
        const discover = dependencies.discover ?? discoverSetupClients;
        const prepare = dependencies.prepare ?? prepareSetupLaunch;
        const launch = dependencies.launch ?? runForegroundClient;
        const aborted = () => controller.signal.aborted;
        while (!aborted()) {
          const clients = await discover(repoRoot, config, dependencies.env);
          if (aborted()) break;
          const planningVendor = vendorFor(config.models.planner.executable);
          const recommended =
            clients.find(
              (client) =>
                client.vendor === planningVendor && client.unavailable === null
            ) ?? clients.find((client) => client.unavailable === null);
          const ordered = [...clients].sort(
            (a, b) => Number(b === recommended) - Number(a === recommended)
          );
          const choices: InteractiveChoice<string>[] = ordered.map(
            (client) => ({
              name: `Run project-manifest with ${client.name}${client === recommended ? " (Recommended)" : ""}`,
              value: client.vendor,
              ...(client.unavailable === null
                ? {}
                : {
                    disabled: client.unavailable,
                    description: client.unavailable
                  })
            })
          );
          choices.push(
            { name: "Show manual instructions", value: "manual" },
            { name: "Exit", value: "exit" }
          );
          const choice = await io.select(
            "Project setup",
            choices,
            controller.signal
          );
          if (choice === "exit") {
            io.writeLine(
              "Project setup is incomplete. Run banzai setup when ready."
            );
            return 0;
          }
          if (choice === "manual") {
            showManualSetup(io);
            continue;
          }
          const client = clients.find(
            (value) => value.vendor === choice && value.unavailable === null
          );
          if (client === undefined)
            throw new BanzaiError(
              "PROJECT_SETUP_CLIENT_UNAVAILABLE",
              "Select an available client or use manual instructions."
            );
          try {
            const request = await prepare(
              client,
              repoRoot,
              config,
              dependencies.env
            );
            if (aborted()) break;
            io.writeLine(`Opening ${client.name} for project setup.`);
            io.writeLine(
              `When finished, exit ${client.name} to return to Banzai.`
            );
            const result = await launch(request);
            const latest = await inspectProjectAdoption(repoRoot);
            renderProjectAdoption(io, latest);
            if (result.signal !== null || interruption !== 0)
              return interruption || result.exitCode;
            if (result.exitCode !== 0)
              io.writeLine(
                `The client exited with code ${result.exitCode}. Review partial changes before retrying.`
              );
            if (latest.classification === "ready") {
              await initializeArtifacts({ repoRoot });
              io.writeLine(
                "Guidance is ready. Review your files, configure application verification and run banzai doctor. Create an initial commit before starting a task."
              );
              return 0;
            }
            io.writeLine(
              "Project setup is incomplete. Choose a fresh action to continue."
            );
          } catch (error) {
            if (aborted()) break;
            io.writeLine(
              error instanceof BanzaiError
                ? `[${error.code}] ${error.message}`
                : "Project setup could not launch the client. Use manual instructions or try again."
            );
            const latest = await inspectProjectAdoption(repoRoot);
            renderProjectAdoption(io, latest);
          }
        }
        renderProjectAdoption(io, await inspectProjectAdoption(repoRoot));
        io.writeLine(
          "Project setup interrupted. Review any partial changes before trying again."
        );
        return interruption || 130;
      },
      dependencies.env
    );
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    io.writeLine(
      "Project setup interrupted. Review any partial changes before trying again."
    );
    return interruption || 130;
  } finally {
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
  }
}
