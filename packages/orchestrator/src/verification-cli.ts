import { randomUUID } from "node:crypto";
import type { InteractiveIO } from "./interactive.js";
import type { WorkflowRunner } from "./workflow.js";
import type { OrchestratorConfig } from "./types.js";
import { BanzaiError, errorMessage } from "./errors.js";
import { escapeTerminalText } from "./format.js";
import {
  configurationId,
  parseConfigurationCommandInput,
  proposalAsProfile,
  reviseVerificationProfile,
  substantiveProposal,
  verificationProposal
} from "./configuration-prerequisite.js";
import {
  assessVerificationReadiness,
  DETECTABLE_PROJECT_TYPES,
  flattenVerificationCommands,
  inspectVerificationProject,
  isRepositoryHygieneCommand,
  type ApplicationProjectType
} from "./verification.js";
import {
  previewVerificationConfig,
  publishVerificationConfig,
  readVerificationConfig,
  readVerificationConfigTransactions,
  verificationCommandIds,
  type VerificationConfigContext
} from "./verification-config.js";
import {
  editVerificationCommands,
  verificationCommandLines
} from "./verification-ui.js";
import {
  processShutdownRequested,
  redactSensitiveText,
  subscriptionOnlyEnvironment
} from "./process.js";

export type VerificationCliCommand =
  | { command: "list" }
  | { command: "check" }
  | { command: "add"; projectType: ApplicationProjectType }
  | { command: "edit" | "remove"; profileId: string };

export function parseVerificationArgs(
  args: readonly string[]
): VerificationCliCommand {
  const command = args[0];
  if ((command === "list" || command === "check") && args.length === 1)
    return { command };
  if (
    command === "add" &&
    args.length === 2 &&
    (args[1] === "custom" ||
      DETECTABLE_PROJECT_TYPES.some((type) => type === args[1]))
  )
    return { command, projectType: args[1] as ApplicationProjectType };
  if ((command === "edit" || command === "remove") && args.length === 2)
    return { command, profileId: configurationId(args[1]) };
  throw new BanzaiError(
    "INVALID_VERIFICATION_COMMAND",
    "Usage: banzai verify add <type> | edit <id> | remove <id> | list | check"
  );
}

function supportedConfig(config: OrchestratorConfig): 2 | 3 {
  if (config.schemaVersion !== 2 && config.schemaVersion !== 3)
    throw new BanzaiError(
      "VERIFICATION_LEGACY_CONFIG",
      "Guided verification requires config schema 2 or 3. Follow the legacy migration in documentation/verification-examples.md; no migration was applied."
    );
  return config.schemaVersion;
}

function displayCoverage(
  io: InteractiveIO,
  config: OrchestratorConfig,
  projectTypes: ApplicationProjectType[]
): void {
  const covered = new Set(
    config.verification.profiles
      .filter((profile) =>
        profile.commands.some((command) => !isRepositoryHygieneCommand(command))
      )
      .map((profile) => profile.projectType)
  );
  const missing = projectTypes.filter((type) => !covered.has(type));
  io.writeLine(
    `Substantive coverage after this change: ${missing.length ? `missing for ${missing.join(", ")}` : "configured for detected types"}.`
  );
  for (const type of missing)
    io.writeLine(
      `Fix: banzai verify add ${type} — documentation/verification-examples.md`
    );
}

async function configureOne(
  runner: WorkflowRunner,
  io: InteractiveIO,
  actor: string,
  context: VerificationConfigContext | undefined,
  command: Exclude<VerificationCliCommand, { command: "list" | "check" }>
): Promise<boolean> {
  const current = await readVerificationConfig(runner.repoRoot);
  const schemaVersion = supportedConfig(current.config);
  const inspection = await inspectVerificationProject(runner.repoRoot);
  const previewPinned = async (
    edit: Parameters<typeof previewVerificationConfig>[1]
  ) => {
    const preview = await previewVerificationConfig(runner.repoRoot, edit);
    if (
      preview.configBeforeSha256 !== current.sha256 ||
      preview.sourceSha256 !== inspection.sourceSha256
    )
      throw new BanzaiError(
        "CONFIGURATION_PROPOSAL_STALE",
        "Configuration or project scripts changed during setup. No change was saved. Run the same banzai verify command again for a fresh preview and confirmation."
      );
    return preview;
  };
  const history = context
    ? await readVerificationConfigTransactions(runner.repoRoot, context.runId)
    : [];
  const known = verificationCommandIds(current.config, history);
  if (command.command === "remove") {
    const profile = current.config.verification.profiles.find(
      (item) => item.id === command.profileId
    );
    if (!profile)
      throw new BanzaiError(
        "VERIFICATION_PROFILE_MISSING",
        "No profile has that ID. Run banzai verify list."
      );
    if (current.config.verification.profiles.length === 1)
      throw new BanzaiError(
        "VERIFICATION_LAST_PROFILE",
        "The final profile cannot be removed. Add a replacement with banzai verify add <type> first."
      );
    io.writeLine(
      `Remove profile ${JSON.stringify(profile.id)} (${profile.projectType}):`
    );
    for (const line of verificationCommandLines(profile.commands))
      io.writeLine(line);
    displayCoverage(
      io,
      {
        ...current.config,
        verification: {
          ...current.config.verification,
          profiles: current.config.verification.profiles.filter(
            (item) => item.id !== profile.id
          )
        }
      },
      inspection.projectTypes
    );
    const preview = await previewPinned({
      operation: "remove",
      profileId: profile.id,
      clearBootstrap: false
    });
    if (
      !(await io.confirm(
        `Remove the displayed profile ${JSON.stringify(profile.id)}?`,
        false
      ))
    )
      return false;
    await publishVerificationConfig(runner.store, preview, actor, context);
    io.writeLine(`Removed verification profile ${JSON.stringify(profile.id)}.`);
    return true;
  }
  const original =
    command.command === "edit"
      ? current.config.verification.profiles.find(
          (item) => item.id === command.profileId
        )
      : null;
  if (command.command === "edit" && !original)
    throw new BanzaiError(
      "VERIFICATION_PROFILE_MISSING",
      "No profile has that ID. Run banzai verify list."
    );
  if (original) {
    try {
      configurationId(original.id);
      if (
        original.commands.length > 200 ||
        Buffer.byteLength(JSON.stringify(original)) > 64 * 1024
      )
        throw new Error("Oversized profile");
      for (const { id, name, command, args, timeoutMs } of original.commands)
        parseConfigurationCommandInput({
          ...(id ? { id } : {}),
          name,
          command,
          args,
          timeoutMs
        });
    } catch {
      throw new BanzaiError(
        "VERIFICATION_PROFILE_INPUT_LIMIT",
        "This existing profile exceeds guided-input limits. It remains readable and unchanged. Use banzai verify remove to preview its coverage impact and remove it, then add bounded replacement profiles."
      );
    }
  } else if (current.config.verification.profiles.length >= 50)
    throw new BanzaiError(
      "VERIFICATION_PROFILE_INPUT_LIMIT",
      "Guided setup supports at most 50 profiles. Use banzai verify edit/remove before adding another."
    );
  const commandOrigins = original?.commands.map(
    (_, index): number | null => index
  );
  let proposal = original
    ? {
        projectType: original.projectType as ApplicationProjectType,
        profile: { id: original.id, commands: original.commands },
        source: { kind: "human_edit" as const, proposalId: randomUUID() }
      }
    : verificationProposal(
        current.config,
        inspection,
        command.command === "add" ? command.projectType : "custom",
        known
      );
  if (
    !original &&
    proposal.projectType === "node" &&
    inspection.node?.packageManager === null
  ) {
    const manager = await io.select(
      "Select the project's package manager (no commands will run)",
      ["npm", "pnpm", "yarn", "bun"].map((value) => ({
        name: value,
        value: value as "npm" | "pnpm" | "yarn" | "bun"
      }))
    );
    proposal = verificationProposal(
      current.config,
      inspection,
      "node",
      known,
      manager
    );
  }
  const acceptable = () =>
    original?.projectType === "repository"
      ? proposal.profile.commands.length > 0
      : substantiveProposal(proposal);
  let mustEdit = original !== null && original !== undefined;
  for (;;) {
    io.writeLine(
      `${original ? "Edit" : "Add"} profile ${proposal.profile.id} (${proposal.projectType}); source: ${proposal.source.kind}.`
    );
    for (const line of verificationCommandLines(proposal.profile.commands))
      io.writeLine(line);
    const choice = mustEdit
      ? "edit"
      : await io.select("Verification profile", [
          {
            name: "Accept",
            value: "accept",
            ...(!acceptable()
              ? { disabled: "Enter substantive commands with Edit first" }
              : {})
          },
          { name: "Edit", value: "edit" },
          { name: "Skip", value: "skip" }
        ]);
    if (choice === "skip") return false;
    if (choice === "edit") {
      const commands = await editVerificationCommands(
        io,
        proposal.profile.commands,
        commandOrigins
      );
      proposal.profile = reviseVerificationProfile(
        { id: proposal.profile.id, commands },
        proposal.profile,
        schemaVersion,
        known
      );
      mustEdit = false;
      continue;
    }
    if (!acceptable())
      throw new BanzaiError(
        "VERIFICATION_PROFILE_EMPTY",
        "Accept requires a substantive command. Edit this draft first."
      );
    if (Buffer.byteLength(JSON.stringify(proposal)) > 64 * 1024)
      throw new BanzaiError(
        "VERIFICATION_PROFILE_INPUT_LIMIT",
        "The proposed profile exceeds 64 KiB. Reduce it and request a fresh preview."
      );
    const profile = proposalAsProfile(proposal);
    const preview = await previewPinned({
      operation: original ? "edit" : "add",
      profile,
      clearBootstrap: true,
      ...(commandOrigins ? { commandOrigins } : {})
    });
    if (original) {
      io.writeLine("Before:");
      for (const line of verificationCommandLines(original.commands))
        io.writeLine(line);
      io.writeLine("After:");
      for (const line of verificationCommandLines(profile.commands))
        io.writeLine(line);
      displayCoverage(
        io,
        {
          ...current.config,
          verification: {
            ...current.config.verification,
            profiles: current.config.verification.profiles.map((item) =>
              item.id === profile.id ? profile : item
            )
          }
        },
        inspection.projectTypes
      );
      if (schemaVersion === 3)
        io.writeLine(
          "Changed commands receive new IDs; evidence for their old IDs cannot satisfy them. Approved obligations referring to removed IDs still require the existing reapproval route."
        );
    }
    io.writeLine(
      "This preview preserves other profiles and command IDs, and clears the bootstrap flag when present."
    );
    if (preview.configBeforeSha256 === preview.configAfterSha256) {
      io.writeLine("The profile is unchanged.");
      return false;
    }
    if (!(await io.confirm("Save this exact verification profile?", false)))
      return false;
    await publishVerificationConfig(runner.store, preview, actor, context);
    io.writeLine(`Saved verification profile ${JSON.stringify(profile.id)}.`);
    return true;
  }
}

export async function runVerificationWizard(
  runner: WorkflowRunner,
  io: InteractiveIO,
  actor: string
): Promise<void> {
  await runner.withVerificationConfiguration(async (context) => {
    const current = await readVerificationConfig(runner.repoRoot);
    supportedConfig(current.config);
    const inspection = await inspectVerificationProject(runner.repoRoot);
    const readiness = assessVerificationReadiness(current.config, inspection);
    if (inspection.markerless && readiness.uncoveredTypes.length > 0) {
      io.writeLine(
        "No root project markers were found. The intended stack comes from project guidance and your first task."
      );
      if (readiness.totalSubstantiveCommandCount > 0) {
        const blockingProfiles = current.config.verification.profiles.filter(
          (profile) =>
            profile.projectType !== "repository" &&
            profile.commands.some(
              (command) => !isRepositoryHygieneCommand(command)
            )
        );
        io.writeLine(
          "Bootstrap mode is unavailable while substantive profiles exist, including profiles for project types not detected here. Enabling the flag would not make this project ready. No configuration was changed."
        );
        for (const profile of blockingProfiles)
          io.writeLine(`Profile: ${profile.id} (${profile.projectType}).`);
        io.writeLine(
          "To keep these profiles, restore the project files and verification scripts they target, or configure substantive custom checks with banzai verify add custom."
        );
        if (
          blockingProfiles.length < current.config.verification.profiles.length
        ) {
          io.writeLine(
            "For a bootstrap-only start, review and explicitly confirm removal of each profile below. Keep the remaining hygiene profiles."
          );
          for (const profile of blockingProfiles)
            io.writeLine(`Fix: banzai verify remove ${profile.id}`);
          io.writeLine(
            "Then run banzai init and explicitly confirm bootstrap mode."
          );
        } else {
          io.writeLine(
            "These are all configured profiles. The final profile cannot be removed; retain the profiles and configure coverage instead."
          );
        }
        io.writeLine("See documentation/verification-examples.md.");
        return;
      }
      const preview = await previewVerificationConfig(runner.repoRoot, {
        operation: "bootstrap",
        value: true
      });
      if (
        await io.confirm(
          "Enable bootstrap mode and defer substantive coverage until project markers are created?",
          true
        )
      ) {
        await publishVerificationConfig(runner.store, preview, actor, context);
        io.writeLine(
          "Bootstrap mode: verification coverage is deferred; setup did not execute project commands."
        );
      } else
        io.writeLine(
          "Verification setup skipped. Fix: banzai verify add custom — documentation/verification-examples.md"
        );
      return;
    }
    for (const projectType of readiness.uncoveredTypes) {
      if (projectType !== "repository")
        await configureOne(runner, io, actor, context, {
          command: "add",
          projectType
        });
    }
  });
}

export async function executeVerificationCli(
  command: VerificationCliCommand,
  runner: WorkflowRunner,
  io: InteractiveIO,
  actor: string,
  interactive: boolean
): Promise<number> {
  if (command.command === "list") {
    const { config } = await readVerificationConfig(runner.repoRoot);
    io.writeLine(
      `Verification config schema ${config.schemaVersion}; bootstrap: ${config.verification.bootstrap === true ? "enabled" : "disabled"}.`
    );
    for (const profile of config.verification.profiles) {
      io.writeLine(
        `Profile ${JSON.stringify(profile.id)} (${profile.projectType}):`
      );
      for (const line of verificationCommandLines(profile.commands))
        io.writeLine(redactSensitiveText(line));
    }
    try {
      const inspection = await inspectVerificationProject(runner.repoRoot);
      const readiness = assessVerificationReadiness(config, inspection);
      io.writeLine(
        `Substantive coverage: ${
          readiness.bootstrapEffective
            ? "deferred in bootstrap mode"
            : readiness.uncoveredTypes.length
              ? `missing for ${readiness.uncoveredTypes.join(", ")}`
              : "configured for detected types"
        }.`
      );
      for (const type of readiness.uncoveredTypes)
        io.writeLine(
          `Fix: banzai verify add ${type} — documentation/verification-examples.md`
        );
      if (readiness.bootstrapStale)
        io.writeLine(
          "Bootstrap flag is stale; substantive profiles are configured."
        );
      io.writeLine(
        "Configured coverage is not evidence of command execution or success."
      );
    } catch (error) {
      if (
        !(error instanceof BanzaiError) ||
        error.code !== "VERIFICATION_INSPECTION_UNAVAILABLE"
      )
        throw error;
      io.writeLine(
        "Substantive coverage: unavailable. Fix: restore readable project markers, then run banzai verify list — documentation/verification-examples.md"
      );
    }
    return 0;
  }
  if (command.command !== "check" && !interactive)
    throw new BanzaiError(
      "TTY_REQUIRED",
      "Verification add/edit/remove requires a terminal for the concrete preview and explicit confirmation. Use banzai verify list to inspect profiles."
    );
  return runner.withVerificationConfiguration(async (context) => {
    if (command.command !== "check") {
      const saved = await configureOne(runner, io, actor, context, command);
      if (saved && context)
        io.writeLine(
          "Configuration repaired; the decision remains pending. Run banzai resume to revalidate and continue from the saved checkpoint."
        );
      return 0;
    }
    const { config, sha256 } = await readVerificationConfig(runner.repoRoot);
    const commands = flattenVerificationCommands(config);
    if (commands.length === 0) {
      io.writeLine(
        "No verification commands are configured. Fix: banzai verify add <type> — documentation/verification-examples.md"
      );
      return 1;
    }
    let failed = false;
    for (const [index, entry] of commands.entries()) {
      if (processShutdownRequested()) {
        for (const rest of commands.slice(index))
          io.writeLine(
            `Not run: ${escapeTerminalText(redactSensitiveText(rest.name))} — interrupted.`
          );
        return 1;
      }
      try {
        await runner.store.assertLockOwned();
        if ((await readVerificationConfig(runner.repoRoot)).sha256 !== sha256)
          throw new BanzaiError(
            "CONFIGURATION_PROPOSAL_STALE",
            "Configuration changed during the check. Run banzai verify check again after reviewing it."
          );
        const result = await runner.processRunner({
          command: entry.command,
          args: entry.args,
          timeoutMs: entry.timeoutMs,
          cwd: runner.repoRoot,
          env: subscriptionOnlyEnvironment()
        });
        const passed = result.exitCode === 0 && result.signal === null;
        failed ||= !passed;
        io.writeLine(
          `${passed ? "Pass" : "Fail"}: ${escapeTerminalText(redactSensitiveText(entry.name))} (exit ${result.exitCode}${result.signal ? `, signal ${result.signal}` : ""})`
        );
        if (result.stdout) io.writeLine(redactSensitiveText(result.stdout));
        if (result.stderr) io.writeLine(redactSensitiveText(result.stderr));
      } catch (error) {
        failed = true;
        io.writeLine(
          `Fail: ${escapeTerminalText(redactSensitiveText(entry.name))} — ${escapeTerminalText(redactSensitiveText(errorMessage(error)))}`
        );
        if (
          error instanceof BanzaiError &&
          [
            "RUNNER_LOCKED",
            "CONFIGURATION_PROPOSAL_STALE",
            "CONFIG_UNREADABLE",
            "CONFIG_NOT_FOUND"
          ].includes(error.code)
        ) {
          for (const rest of commands.slice(index + 1))
            io.writeLine(
              `Not run: ${escapeTerminalText(redactSensitiveText(rest.name))}`
            );
          return 1;
        }
      }
    }
    return failed ? 1 : 0;
  });
}
