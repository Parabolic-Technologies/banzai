import { readFile } from "node:fs/promises";
import { BanzaiError, ResourceVersionUnsupportedError } from "./errors.js";
import { collectEvaluationExportV2 } from "./evaluation.js";
import {
  normalizedInstant,
  optionValue,
  SAFE_RUN_ID,
  type EvaluationIO
} from "./evaluation-cli.js";
import {
  decodeEvaluationExportV2Input,
  deriveEvaluationKpiV2
} from "./evaluation-kpi.js";
import { renderEvaluationKpiV2Markdown } from "./evaluation-kpi-render.js";
import type { EvaluationKpiOptions } from "./types.js";

/**
 * The cohort grammar is byte-compatible with `eval export` and shares its
 * stable error codes; only `--input` is new. A file cohort and a checkout
 * cohort cannot both apply, so mixing them fails before any read.
 */
export function parseEvaluationKpiArgs(
  args: readonly string[]
): EvaluationKpiOptions {
  let format: EvaluationKpiOptions["format"] = "markdown";
  let from: string | null = null;
  let to: string | null = null;
  let schemaVersion: 2 | undefined;
  let jsonSeen = false;
  let fromSeen = false;
  let toSeen = false;
  const runIds = new Set<string>();
  const inputs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--schema-version") {
      const value = optionValue(args, index);
      if (schemaVersion !== undefined)
        throw new BanzaiError(
          "INVALID_EVAL_OPTION",
          "Evaluation schema version must be specified once."
        );
      if (value !== "2")
        throw new ResourceVersionUnsupportedError(
          "evaluation schema",
          value,
          "2"
        );
      schemaVersion = 2;
      index += 1;
      continue;
    }
    if (argument === "--json") {
      if (jsonSeen) {
        throw new BanzaiError(
          "INVALID_EVAL_OPTION",
          "Evaluation option --json may be specified only once."
        );
      }
      jsonSeen = true;
      format = "json";
      continue;
    }
    if (argument === "--from" || argument === "--to") {
      const isFrom = argument === "--from";
      if ((isFrom && fromSeen) || (!isFrom && toSeen)) {
        throw new BanzaiError(
          "INVALID_EVAL_OPTION",
          `Evaluation option ${argument} may be specified only once.`
        );
      }
      const value = normalizedInstant(optionValue(args, index));
      if (isFrom) {
        fromSeen = true;
        from = value;
      } else {
        toSeen = true;
        to = value;
      }
      index += 1;
      continue;
    }
    if (argument === "--run") {
      const value = optionValue(args, index);
      if (value === "." || value === ".." || !SAFE_RUN_ID.test(value)) {
        throw new BanzaiError(
          "INVALID_EVAL_RUN_ID",
          "Evaluation run selectors must be non-empty path-safe run IDs."
        );
      }
      runIds.add(value);
      index += 1;
      continue;
    }
    if (argument === "--input") {
      inputs.push(optionValue(args, index));
      index += 1;
      continue;
    }
    throw new BanzaiError(
      "INVALID_EVAL_OPTION",
      "Unknown evaluation kpi option."
    );
  }

  if (inputs.length > 0 && (from !== null || to !== null || runIds.size > 0)) {
    throw new BanzaiError(
      "INVALID_EVAL_OPTION",
      "Evaluation option --input cannot be combined with --from, --to, or --run."
    );
  }
  if (from !== null && to !== null && Date.parse(from) >= Date.parse(to)) {
    throw new BanzaiError(
      "INVALID_EVAL_RANGE",
      "Evaluation --from must be earlier than --to."
    );
  }
  return {
    schemaVersion: 2,
    format,
    from,
    to,
    runIds: [...runIds].sort((left, right) => left.localeCompare(right)),
    inputs
  };
}

/**
 * Derives KPIs from previously exported files. Reads only the named files:
 * no repository discovery, no `.banzai/` access, and every decode failure is
 * fatal before any output is written.
 */
export async function executeEvaluationKpiFromInputs(
  options: EvaluationKpiOptions,
  io: EvaluationIO
): Promise<void> {
  {
    const inputs = [];
    for (const file of options.inputs) {
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch {
        throw new BanzaiError(
          "INVALID_EVAL_INPUT",
          "Evaluation KPI input cannot be read."
        );
      }
      inputs.push(decodeEvaluationExportV2Input(text, file));
    }
    const report = deriveEvaluationKpiV2(inputs);
    io.stdout(
      options.format === "json"
        ? JSON.stringify(report, null, 2) + "\n"
        : renderEvaluationKpiV2Markdown(report)
    );
    return;
  }
}

/**
 * Computes the evaluation export for the current checkout in memory under the
 * same cohort rules as `eval export`, then projects KPIs from that single
 * source. No export file is written and nothing new is read from run state.
 */
export async function executeEvaluationKpiFromCheckout(
  repoRoot: string,
  options: EvaluationKpiOptions,
  io: EvaluationIO
): Promise<void> {
  {
    const exported = await collectEvaluationExportV2(repoRoot, options);
    const report = deriveEvaluationKpiV2([exported]);
    io.stdout(
      options.format === "json"
        ? JSON.stringify(report, null, 2) + "\n"
        : renderEvaluationKpiV2Markdown(report)
    );
    return;
  }
}
