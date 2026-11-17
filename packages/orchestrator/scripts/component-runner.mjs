// The one credential-free child environment and the execution of one check
// component, shared by `release-check.mjs` and `scoped-check.mjs`
// (ADR-0071 section 3). It reports what happened; each caller words its own
// diagnostics.
import { spawn } from "node:child_process";

const BLOCKED_VARIABLES = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_VERTEX",
  "CODEX_API_KEY",
  "OPENAI_API_KEY"
]);

/** The current environment without credentials or live-test switches. */
export function sanitizedEnvironment() {
  const environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    const upper = key.toUpperCase();
    if (
      BLOCKED_VARIABLES.has(upper) ||
      upper.startsWith("BANZAI_LIVE_") ||
      /(?:OPENAI|ANTHROPIC|CODEX).*(?:API_?KEY|AUTH_?TOKEN)/.test(upper)
    ) {
      continue;
    }
    environment[key] = value;
  }
  return environment;
}

/**
 * Starts `{ command, args }` in `cwd` without a shell, with stdin ignored and
 * output inherited, in the sanitized environment. `outcome` settles with
 * `{ kind: "exit", code }`, `{ kind: "signal", signal }` or
 * `{ kind: "error", error }` when the component cannot start; it never
 * rejects. `child` is `null` when spawning threw.
 */
export function startComponent(component, cwd) {
  let child;
  try {
    child = spawn(component.command, component.args, {
      cwd,
      env: sanitizedEnvironment(),
      shell: false,
      stdio: ["ignore", "inherit", "inherit"]
    });
  } catch (error) {
    return { child: null, outcome: Promise.resolve({ kind: "error", error }) };
  }
  const outcome = new Promise((resolve) => {
    child.once("error", (error) => resolve({ kind: "error", error }));
    child.once("exit", (code, signal) =>
      resolve(
        signal === null
          ? { kind: "exit", code: code ?? 1 }
          : { kind: "signal", signal }
      )
    );
  });
  return { child, outcome };
}
