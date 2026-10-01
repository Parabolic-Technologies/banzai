import type {
  ModelSessionBinding,
  ModelSettings,
  SessionContext
} from "../../types.js";

/** The configured identity a model session is bound to. */
export function sessionContext(
  role: SessionContext["role"],
  settings: ModelSettings
): SessionContext {
  return {
    role,
    executable: settings.executable,
    model: settings.model,
    effort: settings.effort
  };
}

export function sessionBinding(
  id: string | null,
  context: SessionContext
): ModelSessionBinding | null {
  return id === null ? null : { id, ...context };
}
