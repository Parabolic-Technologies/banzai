import process from "node:process";
import { applyModelUpdates } from "./config.js";
import { BanzaiError, LocalConfigError } from "./errors.js";
import { escapeTerminalField } from "./format.js";
import type {
  InteractiveIO,
  LaunchModelUpdate,
  LaunchModels,
  LaunchRunModels,
  ModelConfigurationFile
} from "./interactive.js";
import {
  LOCAL_CONFIG_FILE,
  LOCAL_CONFIG_GIT,
  createLocalConfigVisibility,
  ensureLocalConfigExcluded,
  localModelDriftLines,
  mergeModelLayer,
  readLayeredConfig,
  requireEffectiveConfig,
  requireModelWriterProject,
  writeLocalModelLayer,
  type LocalConfigExcludeGit
} from "./local-config.js";
import {
  chooseModelSettings,
  selectModelDestination,
  type ModelDestination
} from "./model-selection.js";
import { RunStore } from "./store.js";
import type {
  EffectiveModelConfiguration,
  LocalModelLayer,
  LocalModelLayerStatus,
  OrchestratorConfig,
  RunState
} from "./types.js";

const COMMITTED_FILE = ".banzai/config.json";

/** The accepted `banzai model` forms (ADR-0060 §3, reading 5). */
export interface ModelCommandOptions {
  /** `--local`: open on the local destination without the destination question. */
  local: boolean;
}

/**
 * The exact grammar: no argument, `--local`, or `--help` alone. Everything
 * else is `INVALID_MODEL_OPTION`, reported before the terminal check and
 * before repository discovery.
 */
export function parseModelArgs(
  args: readonly string[]
): ModelCommandOptions | "help" {
  if (args.length === 0) return { local: false };
  if (args.length === 1 && args[0] === "--local") return { local: true };
  if (args.length === 1 && args[0] === "--help") return "help";
  throw new BanzaiError(
    "INVALID_MODEL_OPTION",
    "banzai model accepts only an optional --local flag, or --help by itself."
  );
}

/**
 * The authorization a model phase carries. `banzai init` and the model
 * writers refuse while any of them is set (ADR-0060 §3).
 */
export const MODEL_PHASE_VARIABLES: readonly string[] = [
  "BANZAI_RUN_ID",
  "BANZAI_APPROVAL_DIGEST",
  "BANZAI_WORKFLOW_DIGEST"
];

export function insideModelPhase(env: NodeJS.ProcessEnv): boolean {
  return MODEL_PHASE_VARIABLES.some((name) => Object.hasOwn(env, name));
}

/** The line the blocked-run exception prints after a local write (ADR-0060 §3). */
export const MODEL_RETRY_LINE =
  "Run banzai retry to continue this run with the new models.";

/** What `banzai status` recommends for the active run, as the picker needs it. */
export interface ModelPickerRunStatus {
  state: Pick<RunState, "runId" | "status">;
  nextAction: string | null;
}

export interface ModelPickerHost {
  io: InteractiveIO;
  /** The process environment; `process.env` when omitted. */
  env?: NodeJS.ProcessEnv;
  /**
   * Status for the active run. Without it no blocked-run exception applies,
   * as for the init picker, which never writes the local file.
   */
  status?: () => Promise<ModelPickerRunStatus>;
  /** The Git queries and exclude-file append; the real ones when omitted. */
  git?: LocalConfigExcludeGit;
}

export interface ModelPickerRequest {
  /** `init` writes the committed file only and never asks for a destination. */
  entry: "model" | "init";
  /** `banzai model --local`. */
  local?: boolean;
  /** Init just created `.banzai/config.json`. */
  configCreated?: boolean;
}

/** The file the picker wrote, if any. */
export type ModelPickerOutcome = "unchanged" | "committed" | "local";

async function acquireModelLock(store: RunStore, again: string) {
  try {
    // Reading 8: no stale reclaim and no work-ownership claim.
    return await store.acquireLock({ reclaimStale: false });
  } catch (error) {
    if (error instanceof BanzaiError && error.code === "RUNNER_LOCKED") {
      throw new BanzaiError(
        "RUNNER_LOCKED",
        `Models cannot change while .banzai/runner.lock exists: another Banzai command owns this project. Wait for it to finish, then ${again}. If no Banzai command is running, inspect the lock with banzai doctor.`
      );
    }
    throw error;
  }
}

function refuseInsideModelPhase(env: NodeJS.ProcessEnv): void {
  if (insideModelPhase(env)) {
    throw new BanzaiError(
      "CONFIGURATION_MODEL_WRITE_DENIED",
      "Model phases cannot change model settings. Record the model change you need in Human prerequisites."
    );
  }
}

/**
 * Whether status recommends `banzai retry` for this blocked run. A model
 * record status cannot use makes status recommend `banzai cancel` instead
 * (ADR-0060 §7), so it never qualifies.
 */
async function retryRecommended(
  store: RunStore,
  runId: string,
  status: () => Promise<ModelPickerRunStatus>
): Promise<boolean> {
  try {
    const current = await status();
    if (
      current.state.runId !== runId ||
      current.state.status !== "blocked" ||
      current.nextAction !== "banzai retry"
    ) {
      return false;
    }
    return (await store.readModelOverrideRecord(runId)).state !== "defective";
  } catch {
    return false;
  }
}

/**
 * Under the runner lock: no active run, or a finished or cancelled one, lets
 * every destination through. A blocked run for which status recommends
 * `banzai retry` lets only the local destination through (the blocked-run
 * exception) and is returned. Every other active run refuses and names
 * `banzai cancel`.
 */
async function activeRunGate(
  store: RunStore,
  status: (() => Promise<ModelPickerRunStatus>) | undefined
): Promise<string | null> {
  const runId = await store.readActiveRunId();
  if (runId === null) return null;
  const state = await store.readState(runId);
  if (state.status === "done" || state.status === "cancelled") return null;
  if (
    state.status === "blocked" &&
    status !== undefined &&
    (await retryRecommended(store, state.runId, status))
  ) {
    return state.runId;
  }
  throw new BanzaiError(
    "RUN_IN_PROGRESS",
    `Run ${escapeTerminalField(state.runId)} is ${escapeTerminalField(state.status)}. Finish it, or run banzai cancel, before changing models.`
  );
}

/**
 * The model picker of `banzai model [--local]` and `banzai init` (ADR-0060 §3,
 * §4, readings 4, 6, 7 and 8), in this order:
 *
 * 1. refuse inside a model phase, then without a readable, valid
 *    `.banzai/config.json` (`CONFIG_NOT_FOUND` before `banzai init`) or with
 *    a link at `.banzai/`, writing nothing;
 * 2. the exclude step, outside the runner lock;
 * 3. the runner lock, then the active-run check with the blocked-run
 *    exception;
 * 4. the layered read: a defective local file stops here, before any menu;
 * 5. the destination: init and the committed-only case write
 *    `.banzai/config.json`; `--local` and the blocked-run exception write the
 *    local file; otherwise the destination question, asked when
 *    `.banzai/config.json` is in the Git index or a local file exists;
 * 6. the menus, then one write to the chosen file only.
 *
 * The caller checks the grammar and the terminal first.
 */
export async function executeModelPicker(
  repoRoot: string,
  request: ModelPickerRequest,
  host: ModelPickerHost
): Promise<ModelPickerOutcome> {
  refuseInsideModelPhase(host.env ?? process.env);
  const git = host.git ?? LOCAL_CONFIG_GIT;
  const io = host.io;
  // Without `banzai init` nothing is written, not even the exclude line.
  await requireModelWriterProject(repoRoot);
  await ensureLocalConfigExcluded(repoRoot, git);
  const store = new RunStore(repoRoot);
  const lock = await acquireModelLock(store, "run banzai model again");
  try {
    const blockedRunId = await activeRunGate(
      store,
      request.entry === "model" ? host.status : undefined
    );
    const layered = await readLayeredConfig(repoRoot, {
      visibility: createLocalConfigVisibility(git)
    });
    if (layered.effective === null) {
      throw new LocalConfigError(layered.local.defect);
    }
    const local = layered.local.state === "valid" ? layered.local.models : {};
    let destination: ModelDestination;
    if (request.entry === "init") {
      destination = "committed";
    } else if (blockedRunId !== null) {
      destination = "local";
      io.writeLine(
        `Run ${escapeTerminalField(blockedRunId)} is blocked and banzai status recommends banzai retry, so these choices are saved for this machine only in ${LOCAL_CONFIG_FILE}.`
      );
    } else if (request.local === true) {
      destination = "local";
    } else if (
      layered.local.state !== "absent" ||
      (await git.isPathInIndex(repoRoot, COMMITTED_FILE))
    ) {
      destination = await selectModelDestination(io);
    } else {
      destination = "committed";
    }
    const selection = await chooseModelSettings(io, {
      committed: layered.committed,
      local,
      destination,
      configCreated: request.configCreated ?? false
    });
    if (selection === null) return "unchanged";
    if (selection.destination === "committed") {
      await applyModelUpdates(repoRoot, selection.updates);
      io.writeLine(`Updated ${COMMITTED_FILE}. Review and commit the change.`);
      return "committed";
    }
    const written = await writeLocalModelLayer(repoRoot, selection.models, {
      probe: git
    });
    io.writeLine(
      written === "deleted"
        ? `Deleted ${LOCAL_CONFIG_FILE}; this machine now uses the shared models in ${COMMITTED_FILE}.`
        : written === "written"
          ? `Updated ${LOCAL_CONFIG_FILE} for this machine only. Git ignores it, so there is nothing to commit.`
          : `${LOCAL_CONFIG_FILE} is unchanged.`
    );
    if (blockedRunId !== null) io.writeLine(MODEL_RETRY_LINE);
    return written === "unchanged" ? "unchanged" : "local";
  } finally {
    await lock.release();
  }
}

/**
 * The models of the active run for the launch header, from the same local
 * read as the rest of the launch (ADR-0060 §7): null without a run or for a
 * done or cancelled one; otherwise the run-effective configuration and the
 * drift lines, or the record that cannot be read.
 */
async function launchRunModels(
  store: RunStore,
  committed: OrchestratorConfig,
  local: LocalModelLayerStatus
): Promise<LaunchRunModels | null> {
  let state: RunState;
  try {
    const runId = await store.readActiveRunId();
    if (runId === null) return null;
    state = await store.readState(runId);
  } catch {
    // The run loop reports an unreadable run; the header shows current models.
    return null;
  }
  if (state.status === "done" || state.status === "cancelled") return null;
  const fallbackPath = `.banzai/runs/${state.runId}/model-override.json`;
  let recorded: LocalModelLayer;
  try {
    const record = await store.readModelOverrideRecord(state.runId);
    if (record.state === "defective") {
      return {
        state: "record_invalid",
        runId: state.runId,
        recordPath: record.defect.path
      };
    }
    recorded = record.state === "recorded" ? record.models : {};
  } catch {
    return {
      state: "record_invalid",
      runId: state.runId,
      recordPath: fallbackPath
    };
  }
  return {
    state: "recorded",
    runId: state.runId,
    models: mergeModelLayer(committed, recorded),
    drift: localModelDriftLines(recorded, local)
  };
}

/**
 * The launch gateway's read (ADR-0060 §2, §4, §7, reading 9): one layered read
 * with a fresh Git check. Null without `.banzai/config.json`; a tracked,
 * unignored or invalid local file rejects with `LocalConfigError` before any
 * executable runs. With a non-terminal run it adds the run's models.
 */
export async function loadLaunchModels(
  repoRoot: string,
  options: { git?: LocalConfigExcludeGit } = {}
): Promise<LaunchModels | null> {
  let layered;
  try {
    layered = await readLayeredConfig(repoRoot, {
      visibility: createLocalConfigVisibility(options.git ?? LOCAL_CONFIG_GIT)
    });
  } catch (error) {
    if (error instanceof BanzaiError && error.code === "CONFIG_NOT_FOUND")
      return null;
    throw error;
  }
  const effective = requireEffectiveConfig(layered);
  return {
    committed: layered.committed,
    effective,
    run: await launchRunModels(
      new RunStore(repoRoot),
      layered.committed,
      layered.local
    )
  };
}

/**
 * Refuses, before any write, when a role's file or model is no longer what
 * the launch showed: the confirmation named the files, so a concurrent edit
 * must not reroute or change another value.
 */
function requireShownModels(
  effective: EffectiveModelConfiguration,
  updates: readonly LaunchModelUpdate[]
): void {
  for (const update of updates) {
    if (
      effective.sources[update.role] !== update.source ||
      effective.config.models[update.role].model !== update.replaces
    ) {
      throw new BanzaiError(
        "MODEL_CONFIGURATION_CHANGED",
        "The model configuration changed after this session showed it, so nothing was written. Start banzai again to see the current models."
      );
    }
  }
}

/** The local layer with each update's model in its role's triple. */
function withReplacements(
  layer: LocalModelLayer,
  updates: readonly LaunchModelUpdate[]
): LocalModelLayer {
  const next: LocalModelLayer = { ...layer };
  for (const update of updates) {
    const triple = next[update.role];
    if (triple !== undefined)
      next[update.role] = { ...triple, model: update.model };
  }
  return next;
}

export interface LaunchUpdateHost {
  /** The process environment; `process.env` when omitted. */
  env?: NodeJS.ProcessEnv;
  /** The Git queries and exclude-file append; the real ones when omitted. */
  git?: LocalConfigExcludeGit;
}

/**
 * The launch advisory's writer (ADR-0060 §3): each update goes to the file
 * that supplies its role, under the runner lock, and the files that changed
 * are returned, `.banzai/config.json` first. It refuses inside a model phase,
 * during any active run, and when a role's file or model differs from what
 * the launch showed, with nothing written. The local file is written before
 * `.banzai/config.json`, so every local refusal comes before any write.
 */
export async function applyLaunchModelUpdates(
  repoRoot: string,
  updates: readonly LaunchModelUpdate[],
  host: LaunchUpdateHost = {}
): Promise<ModelConfigurationFile[]> {
  refuseInsideModelPhase(host.env ?? process.env);
  if (updates.length === 0) return [];
  const git = host.git ?? LOCAL_CONFIG_GIT;
  const localUpdates = updates.filter((update) => update.source === "local");
  await requireModelWriterProject(repoRoot);
  if (localUpdates.length > 0) await ensureLocalConfigExcluded(repoRoot, git);
  const store = new RunStore(repoRoot);
  const lock = await acquireModelLock(store, "start banzai again");
  try {
    // The advisory refuses during any active run (ADR-0060 §3).
    await activeRunGate(store, undefined);
    const layered = await readLayeredConfig(repoRoot, {
      visibility: createLocalConfigVisibility(git)
    });
    const effective = requireEffectiveConfig(layered);
    requireShownModels(effective, updates);
    const changed: ModelConfigurationFile[] = [];
    if (localUpdates.length > 0) {
      await writeLocalModelLayer(
        repoRoot,
        withReplacements(effective.models, localUpdates),
        { probe: git }
      );
    }
    const committedUpdates = updates
      .filter((update) => update.source === "committed")
      .map((update) => ({ role: update.role, model: update.model }));
    if (committedUpdates.length > 0) {
      try {
        await applyModelUpdates(repoRoot, committedUpdates);
      } catch (error) {
        if (localUpdates.length === 0) throw error;
        throw new BanzaiError(
          error instanceof BanzaiError ? error.code : "CONFIG_WRITE_FAILED",
          `${error instanceof Error ? error.message : String(error)} ${LOCAL_CONFIG_FILE} was updated; ${COMMITTED_FILE} is unchanged.`
        );
      }
      changed.push(COMMITTED_FILE);
    }
    if (localUpdates.length > 0) changed.push(LOCAL_CONFIG_FILE);
    return changed;
  } finally {
    await lock.release();
  }
}
