/**
 * The owner-run Gate 1 probe (ADR-0063 §6). It runs Banzai's own Claude
 * implementation phase, with the real runner and terminal observer, then a
 * resumed invocation of the same session, and prints only counts, exit
 * statuses and a verdict. `scripts/gate-1-probe.mjs` bundles and runs it.
 */
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import {
  createVendorAdapters,
  resolveClaudeInvocationScope
} from "../../src/adapters.js";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { BanzaiError, ProcessExitError } from "../../src/errors.js";
import { resolveOutputContract } from "../../src/output-contract.js";
import { runProcess } from "../../src/process.js";
import { createPromptEnvelope } from "../../src/prompt-envelope.js";
import type { ClaudeInvocationScope, ProcessRunner } from "../../src/types.js";
import {
  emptyProbeObservation,
  observeProbeLine,
  probeVerdict,
  type ProbeInvocation
} from "./gate-1-probe.js";

const SENTINEL = "probe-sentinel.txt";
const PROBE_SCRIPT = "probe.sh";

const FIRST_PROMPT = [
  "This is a Banzai compatibility probe. Do not edit, create or delete any file yourself.",
  `Run exactly one Bash command, in the foreground, with a timeout of 900000 milliseconds: sh ./${PROBE_SCRIPT}`,
  "The command takes about 11 minutes. Wait for it to finish. Do not run it in the background, and run no other command.",
  `When it has finished, return a completed phase result whose summary says that ./${PROBE_SCRIPT} finished. Report no changed files and no follow-up work.`
].join("\n");

const RESUME_PROMPT = [
  "Run no command and change no file.",
  "Return a completed phase result whose summary confirms that the earlier command finished. Report no changed files and no follow-up work."
].join("\n");

interface ProbeArguments {
  repository: string;
  executable: string;
  pluginDirectory: string;
}

const USAGE =
  "Usage: node packages/orchestrator/scripts/gate-1-probe.mjs --repository <scratch repository> [--executable <claude>]";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function parseArguments(args: readonly string[]): ProbeArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (
      option === undefined ||
      value === undefined ||
      !["--repository", "--executable", "--plugin-directory"].includes(option)
    ) {
      fail(USAGE);
    }
    values.set(option, value);
  }
  const repository = values.get("--repository");
  const pluginDirectory = values.get("--plugin-directory");
  if (repository === undefined || pluginDirectory === undefined) {
    fail(USAGE);
  }
  return {
    repository: path.resolve(repository),
    executable: values.get("--executable") ?? "claude",
    pluginDirectory: path.resolve(pluginDirectory)
  };
}

async function clientVersion(executable: string): Promise<string> {
  const result = await runProcess({
    command: executable,
    args: ["--version"],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 30_000
  });
  return result.stdout.trim().split(/\s+/)[0] ?? "unknown";
}

async function invoke(
  options: ProbeArguments,
  scope: ClaudeInvocationScope,
  runDirectory: string,
  prompt: string,
  resumeSessionId: string | null,
  label: string
): Promise<{ invocation: ProbeInvocation; sessionId: string | null }> {
  const observation = emptyProbeObservation();
  const sentinel = path.join(options.repository, SENTINEL);
  let exitCode: number | null = null;
  let sessionId: string | null = resumeSessionId;
  const runner: ProcessRunner = async (spec) => {
    try {
      const result = await runProcess({
        ...spec,
        onStdoutLine: (line) => {
          observeProbeLine(observation, line, () => existsSync(sentinel));
          spec.onStdoutLine?.(line);
        }
      });
      exitCode = result.exitCode;
      return result;
    } catch (error) {
      if (error instanceof ProcessExitError) {
        exitCode = error.result.exitCode;
      }
      throw error;
    }
  };
  let errorCode: string | null = null;
  try {
    const result = await createVendorAdapters(runner).runPhase({
      repoRoot: options.repository,
      runDirectory,
      attemptId: label,
      prompt,
      promptEnvelope: createPromptEnvelope([
        { category: "phase_instructions", text: prompt }
      ]),
      outputContract: resolveOutputContract("claude", "phase-result/v4"),
      settings: {
        ...DEFAULT_CONFIG.models.implementer,
        executable: options.executable
      },
      resumeSessionId,
      env: { ...process.env },
      environment: scope,
      onStart: async () => undefined,
      onProgress: () => undefined,
      onSessionStarted: async (started) => {
        sessionId = started;
      },
      // Engages the workflow's terminal observer, which fails a second
      // `result` event with TERMINAL_RESULT_CONFLICT.
      onTerminalSuccess: async () => undefined
    });
    sessionId = result.sessionId ?? sessionId;
  } catch (error) {
    errorCode = error instanceof BanzaiError ? error.code : "UNEXPECTED_ERROR";
  }
  return { invocation: { observation, exitCode, errorCode }, sessionId };
}

function report(invocation: ProbeInvocation): Record<string, unknown> {
  return {
    ...invocation.observation,
    exitCode: invocation.exitCode,
    errorCode: invocation.errorCode
  };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (process.env.CLAUDECODE !== undefined) {
    fail("Run the probe from a regular terminal, not from inside Claude Code.");
  }
  if (!existsSync(path.join(options.repository, PROBE_SCRIPT))) {
    fail(`The scratch repository has no ${PROBE_SCRIPT}. ${USAGE}`);
  }
  if (existsSync(path.join(options.repository, SENTINEL))) {
    fail(`Delete ${SENTINEL} from the scratch repository before probing.`);
  }
  const { scope } = await resolveClaudeInvocationScope({
    mode: "scoped",
    pluginDirectory: options.pluginDirectory
  });
  const runDirectory = await mkdtemp(path.join(tmpdir(), "banzai-gate-1-"));
  try {
    const version = await clientVersion(options.executable);
    const first = await invoke(
      options,
      scope,
      runDirectory,
      FIRST_PROMPT,
      null,
      "gate-1-probe"
    );
    const resumed =
      first.sessionId === null
        ? {
            invocation: {
              observation: emptyProbeObservation(),
              exitCode: null,
              errorCode: "NO_SESSION"
            }
          }
        : await invoke(
            options,
            scope,
            runDirectory,
            RESUME_PROMPT,
            first.sessionId,
            "gate-1-probe-resumed"
          );
    const verdict = probeVerdict(first.invocation, resumed.invocation);
    process.stdout.write(
      `${JSON.stringify(
        {
          schema: "banzai-gate-1-probe/v1",
          claudeVersion: version,
          invocations: [
            { name: "phase", ...report(first.invocation) },
            { name: "resumed", ...report(resumed.invocation) }
          ],
          verdict
        },
        null,
        2
      )}\n`
    );
    process.exitCode = verdict === "pass" ? 0 : 1;
  } finally {
    await rm(runDirectory, { recursive: true, force: true });
  }
}

await main();
