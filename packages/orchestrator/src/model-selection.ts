import type { ModelUpdate } from "./config.js";
import { escapeTerminalField } from "./format.js";
import type { InteractiveChoice, InteractiveIO } from "./interactive.js";
import {
  MODEL_ROLES,
  roleLabel,
  SELECTABLE_MODELS,
  selectableModel,
  type Effort,
  type ModelRole,
  type SelectableModel
} from "./models.js";
import type {
  LocalModelLayer,
  LocalModelTriple,
  ModelSettings,
  OrchestratorConfig
} from "./types.js";

// The two files a model choice can go to (ADR-0060 §3). Literals, as the
// readers keep them.
const COMMITTED_FILE = ".banzai/config.json";
const LOCAL_FILE = ".banzai/config.local.json";

/** Where the picker saves: the shared committed file or this machine's local file. */
export type ModelDestination = "committed" | "local";

/** The part of a role's settings that a model choice changes and compares. */
type ModelTriple = Pick<ModelSettings, "executable" | "model" | "effort">;

const EFFORT_DESCRIPTIONS: Record<Effort, string> = {
  low: "Fast responses with lighter reasoning.",
  medium: "Balances speed and reasoning depth for everyday tasks.",
  high: "Greater reasoning depth for complex problems.",
  xhigh: "Extra reasoning depth; the best setting for most coding work.",
  max: "Maximum reasoning depth for the hardest problems.",
  ultra: "Maximum reasoning with automatic task delegation."
};

const KEEP = "__keep__";
const MATCH_PLANNING = "__match_planning__";
const USE_SHARED = "__use_shared__";

function settingsMatch(left: ModelTriple, right: ModelTriple): boolean {
  return (
    left.executable === right.executable &&
    left.model === right.model &&
    left.effort === right.effort
  );
}

function tripleOf(settings: ModelTriple): ModelTriple {
  return {
    executable: settings.executable,
    model: settings.model,
    effort: settings.effort
  };
}

/** The bare vendor name a local triple may hold (ADR-0060 §1), or null. */
function bareExecutable(
  executable: string
): LocalModelTriple["executable"] | null {
  return executable === "claude" || executable === "codex" ? executable : null;
}

function selectablePlanningModel(
  settings: ModelTriple
): SelectableModel | null {
  const model = selectableModel(settings.model);
  return model !== null &&
    model.executable === settings.executable &&
    model.efforts.includes(settings.effort)
    ? model
    : null;
}

/** The effort to preselect when the role switches to a different model. */
function preferredEffort(model: SelectableModel, current: Effort): Effort {
  if (model.efforts.includes(current)) {
    return current;
  }
  return model.efforts.includes("xhigh")
    ? "xhigh"
    : (model.efforts.at(-1) ?? "high");
}

/** A configuration value printed inside a picker line, escaped for the terminal. */
function field(value: string): string {
  return escapeTerminalField(value);
}

function describeSettings(settings: ModelTriple): string {
  return `${field(settings.executable)} ${field(settings.model)} effort=${field(settings.effort)}`;
}

/** One role's menu: where it starts and which shortcuts it offers. */
interface RoleMenu {
  role: ModelRole;
  /** The triple the menu starts from, kept by "Keep". */
  settings: ModelTriple;
  /** The pending Planning triple, for the Implementation menu only. */
  planning: ModelTriple | null;
  /** Whether "Match Planning" may copy `planning`. */
  matchPlanning: boolean;
  /** The committed triple "Use shared setting" restores, for a role with a local entry. */
  shared: ModelTriple | null;
  configCreated: boolean;
}

type RoleChoice =
  { kind: "keep" } | { kind: "shared" } | { kind: "set"; triple: ModelTriple };

function modelChoices(menu: RoleMenu): InteractiveChoice<string>[] {
  const { settings, planning, configCreated } = menu;
  const matchesPlanning =
    planning !== null && settingsMatch(settings, planning);
  const planningModel =
    planning === null ? null : selectablePlanningModel(planning);
  const choices: InteractiveChoice<string>[] = [];
  if (
    planning !== null &&
    planningModel !== null &&
    menu.matchPlanning &&
    !matchesPlanning
  ) {
    choices.push({
      name: `Match Planning: ${planningModel.label} (${planningModel.id}), effort=${field(planning.effort)} - recommended`,
      value: MATCH_PLANNING,
      description:
        "Recommended for strict workflows; matching executable, model, and effort enables Planning -> Implementation session reuse."
    });
  }
  choices.push({
    name: `${configCreated ? "Use default:" : "Keep"} ${field(settings.model)} (effort=${field(settings.effort)})${matchesPlanning ? " - matches Planning" : ""}`,
    value: KEEP,
    description: configCreated
      ? `Use the default model and effort for this phase.${matchesPlanning ? " Recommended for strict workflows; keeps builder session reuse eligible." : ""}`
      : matchesPlanning
        ? "Recommended for strict workflows; keeps builder session reuse eligible."
        : "Leave this phase exactly as configured."
  });
  if (menu.shared !== null) {
    choices.push({
      name: `Use shared setting: ${describeSettings(menu.shared)}`,
      value: USE_SHARED,
      description: `Remove this phase from ${LOCAL_FILE} and use the setting in ${COMMITTED_FILE}.`
    });
  }
  // Every phase runs on either vendor.
  for (const model of SELECTABLE_MODELS) {
    const configured = model.id === settings.model;
    const matchesPlanningModel =
      planning !== null &&
      model.id === planning.model &&
      model.executable === planning.executable;
    const markers = [
      configured ? (configCreated ? "default" : "configured") : null,
      matchesPlanningModel ? "matches Planning" : null
    ].filter((marker): marker is string => marker !== null);
    choices.push({
      name: `${model.label} (${model.id})${markers.length === 0 ? "" : ` - ${markers.join(", ")}`}`,
      value: model.id,
      description: matchesPlanningModel
        ? `${model.description} Choose effort=${field(planning.effort)} to keep strict builder session reuse eligible.`
        : model.description
    });
  }
  return choices;
}

function effortChoices(
  model: SelectableModel,
  preferred: Effort,
  planningEffort: Effort | null
): InteractiveChoice<Effort>[] {
  return model.efforts.map((effort) => ({
    name:
      effort === planningEffort
        ? `${effort} - matches Planning; recommended for strict session reuse`
        : effort === preferred
          ? `${effort} - recommended`
          : effort,
    value: effort,
    description:
      effort === planningEffort
        ? `${EFFORT_DESCRIPTIONS[effort]} Matching Planning keeps builder session reuse eligible.`
        : EFFORT_DESCRIPTIONS[effort]
  }));
}

async function selectRole(
  io: InteractiveIO,
  menu: RoleMenu
): Promise<RoleChoice> {
  const label = roleLabel(menu.role);
  const chosen = await io.select(`${label} model`, modelChoices(menu));
  if (chosen === KEEP) {
    return { kind: "keep" };
  }
  if (chosen === USE_SHARED && menu.shared !== null) {
    return { kind: "shared" };
  }
  if (chosen === MATCH_PLANNING && menu.planning !== null) {
    return { kind: "set", triple: tripleOf(menu.planning) };
  }
  const model = selectableModel(chosen);
  if (model === null) {
    return { kind: "keep" };
  }
  const planning = menu.planning;
  const planningEffort =
    planning !== null &&
    model.id === planning.model &&
    model.executable === planning.executable &&
    model.efforts.includes(planning.effort)
      ? planning.effort
      : null;
  const effort = await io.select(
    `${label} effort`,
    effortChoices(
      model,
      planningEffort ?? preferredEffort(model, menu.settings.effort),
      planningEffort
    )
  );
  const triple = { executable: model.executable, model: model.id, effort };
  return settingsMatch(triple, menu.settings)
    ? { kind: "keep" }
    : { kind: "set", triple };
}

export interface ModelPickerInput {
  /** The committed `.banzai/config.json`. */
  committed: OrchestratorConfig;
  /** The valid local layer; `{}` when no local file exists. */
  local?: LocalModelLayer;
  /** The file the choices go to; the committed file when omitted. */
  destination?: ModelDestination;
  /** The committed file was just created, so its triples are defaults. */
  configCreated?: boolean;
}

/**
 * What to write: model updates for the committed file, or the whole new local
 * layer (an empty one deletes the local file).
 */
export type ModelSelection =
  | { destination: "committed"; updates: ModelUpdate[] }
  | { destination: "local"; models: LocalModelLayer };

function hasRoles(layer: LocalModelLayer): boolean {
  return MODEL_ROLES.some((role) => layer[role] !== undefined);
}

function writeBuilderSessionStatus(
  io: InteractiveIO,
  settings: Record<ModelRole, ModelTriple>
): void {
  io.writeLine(
    settingsMatch(settings.planner, settings.implementer)
      ? "Strict builder session: eligible for Planning -> Implementation reuse when the saved planning session is valid."
      : "Strict builder session: Implementation will start fresh from approved artifacts because executable, model, or effort differs from Planning."
  );
}

/** For the committed destination: the roles this machine keeps from its local file. */
function writeLocalKeeps(io: InteractiveIO, local: LocalModelLayer): void {
  for (const role of MODEL_ROLES) {
    const triple = local[role];
    if (triple === undefined) continue;
    io.writeLine(
      `This machine keeps using its local ${roleLabel(role)} setting: ${describeSettings(triple)} (${LOCAL_FILE}).`
    );
  }
}

/**
 * The committed destination (ADR-0060 §3): menus start from and compare with
 * the committed layer, and "Match Planning" copies the pending committed
 * Planning triple, so a local triple never reaches `.banzai/config.json`.
 * Roles the local file overrides are named, and the builder-session line uses
 * the effective settings.
 */
async function chooseCommitted(
  io: InteractiveIO,
  committed: OrchestratorConfig,
  local: LocalModelLayer,
  configCreated: boolean
): Promise<ModelSelection | null> {
  const layered = hasRoles(local);
  io.writeLine();
  io.writeLine("Choose a model and effort level for each phase.");
  if (layered) {
    io.writeLine(
      `Changes go to ${COMMITTED_FILE}, which the team shares. This machine keeps its local settings from ${LOCAL_FILE}.`
    );
  }
  const updates: ModelUpdate[] = [];
  const pending: Record<ModelRole, ModelTriple> = {
    planner: tripleOf(committed.models.planner),
    implementer: tripleOf(committed.models.implementer),
    reviewer: tripleOf(committed.models.reviewer)
  };
  for (const role of MODEL_ROLES) {
    const settings = pending[role];
    const planning = role === "implementer" ? pending.planner : null;
    io.writeLine();
    io.writeLine(
      `${roleLabel(role)}${configCreated ? " default" : ""}: ${describeSettings(settings)}${layered ? " (committed)" : ""}`
    );
    const override = local[role];
    if (override !== undefined) {
      io.writeLine(`This machine uses ${describeSettings(override)} (local).`);
    }
    if (planning !== null) {
      io.writeLine(`Planning selection: ${describeSettings(planning)}`);
    }
    const choice = await selectRole(io, {
      role,
      settings,
      planning,
      matchPlanning: true,
      shared: null,
      configCreated
    });
    if (choice.kind !== "set") continue;
    updates.push({
      role,
      model: choice.triple.model,
      executable: choice.triple.executable,
      effort: choice.triple.effort
    });
    pending[role] = choice.triple;
  }
  const effective: Record<ModelRole, ModelTriple> = {
    planner: local.planner ?? pending.planner,
    implementer: local.implementer ?? pending.implementer,
    reviewer: local.reviewer ?? pending.reviewer
  };

  if (updates.length === 0) {
    io.writeLine();
    writeBuilderSessionStatus(io, effective);
    writeLocalKeeps(io, local);
    io.writeLine(
      configCreated
        ? "Using the default model and effort for each phase."
        : "No phase changed; the configuration is unchanged."
    );
    return null;
  }

  io.writeLine();
  io.writeLine(
    configCreated
      ? `Changes from defaults in ${COMMITTED_FILE}:`
      : `Pending changes to ${COMMITTED_FILE}:`
  );
  for (const update of updates) {
    const before = describeSettings(committed.models[update.role]);
    io.writeLine(
      `  ${roleLabel(update.role)}: ${before} -> ${describeSettings(pending[update.role])}`
    );
  }
  writeLocalKeeps(io, local);
  writeBuilderSessionStatus(io, effective);
  if (!(await io.confirm(`Write these changes to ${COMMITTED_FILE}?`, false))) {
    io.writeLine("The configuration is unchanged.");
    return null;
  }
  return { destination: "committed", updates };
}

/** A copy of `layer` without `role`; a full copy for null. */
function withoutRole(
  layer: LocalModelLayer,
  role: ModelRole | null
): LocalModelLayer {
  const result: LocalModelLayer = {};
  for (const other of MODEL_ROLES) {
    const triple = layer[other];
    if (other !== role && triple !== undefined) result[other] = { ...triple };
  }
  return result;
}

function sameLocalTriple(
  left: LocalModelTriple | undefined,
  right: LocalModelTriple | undefined
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return settingsMatch(left, right);
}

/**
 * The local destination (ADR-0060 §3): each menu starts from the role's
 * effective triple and names its source. A role is written only when the
 * developer picks a different triple, so an unchanged committed triple is
 * never copied into the local file. "Use shared setting", or choosing the
 * committed triple (reading 7), removes the role's entry. "Match Planning" is
 * offered only while the effective Planning executable is `claude` or `codex`.
 */
async function chooseLocal(
  io: InteractiveIO,
  committed: OrchestratorConfig,
  local: LocalModelLayer
): Promise<ModelSelection | null> {
  io.writeLine();
  io.writeLine(
    "Choose a model and effort level for each phase on this machine."
  );
  io.writeLine(
    `Changes go to ${LOCAL_FILE}, which Git ignores; ${COMMITTED_FILE} stays unchanged.`
  );
  let next: LocalModelLayer = withoutRole(local, null);
  const shared = (role: ModelRole): ModelTriple =>
    tripleOf(committed.models[role]);
  const effective = (role: ModelRole): ModelTriple =>
    next[role] ?? shared(role);
  const source = (layer: LocalModelLayer, role: ModelRole): string =>
    layer[role] === undefined ? "committed" : "local";

  for (const role of MODEL_ROLES) {
    const settings = effective(role);
    const planning = role === "implementer" ? effective("planner") : null;
    io.writeLine();
    io.writeLine(
      `${roleLabel(role)}: ${describeSettings(settings)} (${source(next, role)})`
    );
    if (planning !== null) {
      io.writeLine(`Planning selection: ${describeSettings(planning)}`);
    }
    const choice = await selectRole(io, {
      role,
      settings,
      planning,
      matchPlanning:
        planning !== null && bareExecutable(planning.executable) !== null,
      shared: next[role] === undefined ? null : shared(role),
      configCreated: false
    });
    if (choice.kind === "keep") continue;
    if (choice.kind === "shared") {
      next = withoutRole(next, role);
      continue;
    }
    const executable = bareExecutable(choice.triple.executable);
    if (executable === null || settingsMatch(choice.triple, settings)) continue;
    if (
      next[role] !== undefined &&
      settingsMatch(choice.triple, shared(role))
    ) {
      next = withoutRole(next, role);
      continue;
    }
    next[role] = {
      executable,
      model: choice.triple.model,
      effort: choice.triple.effort
    };
  }
  const after: Record<ModelRole, ModelTriple> = {
    planner: effective("planner"),
    implementer: effective("implementer"),
    reviewer: effective("reviewer")
  };
  const changed = MODEL_ROLES.filter(
    (role) => !sameLocalTriple(local[role], next[role])
  );

  if (changed.length === 0) {
    io.writeLine();
    writeBuilderSessionStatus(io, after);
    io.writeLine(`No phase changed; ${LOCAL_FILE} is unchanged.`);
    return null;
  }

  io.writeLine();
  io.writeLine(`Pending changes to ${LOCAL_FILE}:`);
  for (const role of changed) {
    io.writeLine(
      `  ${roleLabel(role)}: ${describeSettings(local[role] ?? shared(role))} (${source(local, role)}) -> ${describeSettings(after[role])} (${source(next, role)})`
    );
  }
  const empty = !hasRoles(next);
  if (empty) {
    io.writeLine(
      `No local setting remains, so ${LOCAL_FILE} will be deleted and this machine uses ${COMMITTED_FILE}.`
    );
  }
  writeBuilderSessionStatus(io, after);
  if (
    !(await io.confirm(
      empty ? `Delete ${LOCAL_FILE}?` : `Write these changes to ${LOCAL_FILE}?`,
      false
    ))
  ) {
    io.writeLine(`${LOCAL_FILE} is unchanged.`);
    return null;
  }
  return { destination: "local", models: next };
}

/**
 * The destination question (ADR-0060 §3, section 9 choice 3): this machine
 * first, then the shared file.
 */
export async function selectModelDestination(
  io: InteractiveIO
): Promise<ModelDestination> {
  io.writeLine();
  return await io.select<ModelDestination>(
    "Where should these model choices be saved?",
    [
      {
        name: `This machine only (${LOCAL_FILE}, ignored by Git)`,
        value: "local",
        description: `Only this checkout uses the choices; ${COMMITTED_FILE} stays unchanged.`
      },
      {
        name: `Shared with the team (${COMMITTED_FILE}; commit it)`,
        value: "committed",
        description:
          "Every developer uses the choices once you commit the change."
      }
    ]
  );
}

/**
 * Walks planning, implementation, and review, asking for a model and an effort
 * level for each, for the chosen destination. Returns what to write, or null
 * when nothing changed or the engineer declined. Timeouts and verification are
 * never part of this dialog.
 */
export async function chooseModelSettings(
  io: InteractiveIO,
  input: ModelPickerInput
): Promise<ModelSelection | null> {
  const local = input.local ?? {};
  return input.destination === "local"
    ? await chooseLocal(io, input.committed, local)
    : await chooseCommitted(
        io,
        input.committed,
        local,
        input.configCreated ?? false
      );
}

/**
 * The committed-file dialog without a local layer. Only the phases the
 * engineer actually changed are returned.
 */
export async function selectModelSettings(
  io: InteractiveIO,
  config: OrchestratorConfig,
  configCreated = false
): Promise<ModelUpdate[]> {
  const selection = await chooseModelSettings(io, {
    committed: config,
    configCreated
  });
  return selection?.destination === "committed" ? selection.updates : [];
}
