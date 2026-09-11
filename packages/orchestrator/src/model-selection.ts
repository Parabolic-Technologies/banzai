import type { ModelUpdate } from "./config.js";
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
import type { ModelSettings, OrchestratorConfig } from "./types.js";

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

function settingsMatch(left: ModelSettings, right: ModelSettings): boolean {
  return (
    left.executable === right.executable &&
    left.model === right.model &&
    left.effort === right.effort
  );
}

function settingsAfterUpdate(
  settings: ModelSettings,
  update: ModelUpdate
): ModelSettings {
  return {
    ...settings,
    executable: update.executable ?? settings.executable,
    model: update.model,
    effort: update.effort ?? settings.effort
  };
}

function selectablePlanningModel(
  settings: ModelSettings
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

function modelChoices(
  settings: ModelSettings,
  planningSettings: ModelSettings | null,
  configCreated: boolean
): InteractiveChoice<string>[] {
  const matchesPlanning =
    planningSettings !== null && settingsMatch(settings, planningSettings);
  const planningModel =
    planningSettings === null
      ? null
      : selectablePlanningModel(planningSettings);
  const choices: InteractiveChoice<string>[] = [];
  if (planningSettings !== null && planningModel !== null && !matchesPlanning) {
    choices.push({
      name: `Match Planning: ${planningModel.label} (${planningModel.id}), effort=${planningSettings.effort} - recommended`,
      value: MATCH_PLANNING,
      description:
        "Recommended for strict workflows; matching executable, model, and effort enables Planning -> Implementation session reuse."
    });
  }
  choices.push({
    name: `${configCreated ? "Use default:" : "Keep"} ${settings.model} (effort=${settings.effort})${matchesPlanning ? " - matches Planning" : ""}`,
    value: KEEP,
    description: configCreated
      ? `Use the default model and effort for this phase.${matchesPlanning ? " Recommended for strict workflows; keeps builder session reuse eligible." : ""}`
      : matchesPlanning
        ? "Recommended for strict workflows; keeps builder session reuse eligible."
        : "Leave this phase exactly as configured."
  });
  // Every phase runs on either vendor.
  for (const model of SELECTABLE_MODELS) {
    const configured = model.id === settings.model;
    const matchesPlanningModel =
      planningSettings !== null &&
      model.id === planningSettings.model &&
      model.executable === planningSettings.executable;
    const markers = [
      configured ? (configCreated ? "default" : "configured") : null,
      matchesPlanningModel ? "matches Planning" : null
    ].filter((marker): marker is string => marker !== null);
    choices.push({
      name: `${model.label} (${model.id})${markers.length === 0 ? "" : ` - ${markers.join(", ")}`}`,
      value: model.id,
      description: matchesPlanningModel
        ? `${model.description} Choose effort=${planningSettings.effort} to keep strict builder session reuse eligible.`
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

function describeSettings(settings: ModelSettings): string {
  return `${settings.executable} ${settings.model} effort=${settings.effort}`;
}

async function selectRole(
  io: InteractiveIO,
  role: ModelRole,
  settings: ModelSettings,
  planningSettings: ModelSettings | null,
  configCreated: boolean
): Promise<ModelUpdate | null> {
  const label = roleLabel(role);
  io.writeLine();
  io.writeLine(
    `${label}${configCreated ? " default" : ""}: ${describeSettings(settings)}`
  );
  if (planningSettings !== null) {
    io.writeLine(`Planning selection: ${describeSettings(planningSettings)}`);
  }
  const chosen = await io.select(
    `${label} model`,
    modelChoices(settings, planningSettings, configCreated)
  );
  if (chosen === KEEP) {
    return null;
  }
  if (chosen === MATCH_PLANNING && planningSettings !== null) {
    return {
      role,
      model: planningSettings.model,
      executable: planningSettings.executable,
      effort: planningSettings.effort
    };
  }
  const model = selectableModel(chosen);
  if (model === null) {
    return null;
  }
  const planningEffort =
    planningSettings !== null &&
    model.id === planningSettings.model &&
    model.executable === planningSettings.executable &&
    model.efforts.includes(planningSettings.effort)
      ? planningSettings.effort
      : null;
  const effort = await io.select(
    `${label} effort`,
    effortChoices(
      model,
      planningEffort ?? preferredEffort(model, settings.effort),
      planningEffort
    )
  );
  if (
    model.id === settings.model &&
    model.executable === settings.executable &&
    effort === settings.effort
  ) {
    return null;
  }
  return {
    role,
    model: model.id,
    executable: model.executable,
    effort
  };
}

/**
 * Walks planning, implementation, and review, asking for a model and an effort
 * level for each. Only the phases the engineer actually changed are returned;
 * timeouts and verification are never part of this dialog.
 */
export async function selectModelSettings(
  io: InteractiveIO,
  config: OrchestratorConfig,
  configCreated = false
): Promise<ModelUpdate[]> {
  io.writeLine();
  io.writeLine("Choose a model and effort level for each phase.");
  const updates: ModelUpdate[] = [];
  const effectiveSettings: Record<ModelRole, ModelSettings> = {
    planner: config.models.planner,
    implementer: config.models.implementer,
    reviewer: config.models.reviewer
  };
  for (const role of MODEL_ROLES) {
    const update = await selectRole(
      io,
      role,
      config.models[role],
      role === "implementer" ? effectiveSettings.planner : null,
      configCreated
    );
    if (update !== null) {
      updates.push(update);
      effectiveSettings[role] = settingsAfterUpdate(
        effectiveSettings[role],
        update
      );
    }
  }

  if (updates.length === 0) {
    io.writeLine();
    writeBuilderSessionStatus(io, effectiveSettings);
    io.writeLine(
      configCreated
        ? "Using the default model and effort for each phase."
        : "No phase changed; the configuration is unchanged."
    );
    return [];
  }

  io.writeLine();
  io.writeLine(configCreated ? "Changes from defaults:" : "Pending changes:");
  for (const update of updates) {
    const before = describeSettings(config.models[update.role]);
    io.writeLine(
      `  ${roleLabel(update.role)}: ${before} -> ${update.executable} ${update.model} effort=${update.effort}`
    );
  }
  writeBuilderSessionStatus(io, effectiveSettings);
  if (
    !(await io.confirm("Write these changes to .banzai/config.json?", false))
  ) {
    io.writeLine("The configuration is unchanged.");
    return [];
  }
  return updates;
}

function writeBuilderSessionStatus(
  io: InteractiveIO,
  settings: Record<ModelRole, ModelSettings>
): void {
  io.writeLine(
    settingsMatch(settings.planner, settings.implementer)
      ? "Strict builder session: eligible for Planning -> Implementation reuse when the saved planning session is valid."
      : "Strict builder session: Implementation will start fresh from approved artifacts because executable, model, or effort differs from Planning."
  );
}
