import { BanzaiError } from "./errors.js";
import {
  runLiveCompatibility,
  type LiveCompatibilityDependencies,
  type LiveCompatibilitySummary
} from "./live-compatibility.js";

export interface LiveCompatibilityIO {
  stdout(value: string): void;
  stderr(value: string): void;
}

export function parseLiveCompatibilityArgs(args: string[]): void {
  if (args.length !== 1 || args[0] !== "--confirm-live") {
    throw new BanzaiError(
      "LIVE_CONFIRMATION_REQUIRED",
      "Live compatibility requires the exact --confirm-live option."
    );
  }
}

export function renderLiveCompatibilityJson(
  summary: LiveCompatibilitySummary
): string {
  return `${JSON.stringify(summary, null, 2)}\n`;
}

export async function executeLiveCompatibility(
  repoRoot: string,
  args: string[],
  io: LiveCompatibilityIO,
  dependencies?: LiveCompatibilityDependencies
): Promise<0 | 1 | 2> {
  parseLiveCompatibilityArgs(args);
  const summary = await runLiveCompatibility(repoRoot, dependencies);
  io.stdout(renderLiveCompatibilityJson(summary));
  if (summary.status === "pass") {
    return 0;
  }
  if (summary.status === "unavailable") {
    return 2;
  }
  return 1;
}
