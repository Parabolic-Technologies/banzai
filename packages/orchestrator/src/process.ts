import { spawn } from "node:child_process";
import process from "node:process";
import { BanzaiError, errorMessage, ProcessExitError } from "./errors.js";
import type { ProcessResult, ProcessRunner, ProcessSpec } from "./types.js";

const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
export const PROCESS_SHUTDOWN_DRAIN_MS = 5_000;

interface ActiveChild {
  pid: number;
  drained: Promise<void>;
}

const activeChildren = new Map<number, ActiveChild>();
let shutdownRequested = false;

const BLOCKED_ENVIRONMENT_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_VERTEX",
  "CODEX_API_KEY",
  "OPENAI_API_KEY"
]);

export function subscriptionOnlyEnvironment(
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    const upperKey = key.toUpperCase();
    if (
      BLOCKED_ENVIRONMENT_KEYS.has(upperKey) ||
      /(?:OPENAI|ANTHROPIC|CODEX).*(?:API_?KEY|AUTH_?TOKEN)/.test(upperKey)
    ) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(
      /("(?:api[_-]?key|access[_-]?token|auth[_-]?token|password)"\s*:\s*")[^"]+(")/gi,
      "$1[REDACTED]$2"
    )
    .replace(/\b(?:sk|sk-ant|sess)-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]");
}

function terminateProcess(
  pid: number,
  signal: "SIGTERM" | "SIGKILL" = "SIGTERM"
): "sent" | "not_found" | "failed" {
  if (!Number.isInteger(pid) || pid <= 0) {
    return "failed";
  }
  try {
    if (process.platform === "win32") {
      process.kill(pid, signal);
    } else {
      process.kill(-pid, signal);
    }
    return "sent";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH"
      ? "not_found"
      : "failed";
  }
}

export function processShutdownRequested(): boolean {
  return shutdownRequested;
}

export async function shutdownActiveProcesses(
  timeoutMs = PROCESS_SHUTDOWN_DRAIN_MS
): Promise<boolean> {
  shutdownRequested = true;
  const children = [...activeChildren.values()];
  for (const child of children) {
    terminateProcess(child.pid);
  }
  if (children.length === 0) {
    return true;
  }
  let timer!: NodeJS.Timeout;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, timeoutMs);
  });
  const drained = Promise.allSettled(
    children.map((child) => child.drained)
  ).then(() => true as const);
  const result = await Promise.race([drained, timedOut]);
  clearTimeout(timer);
  if (!result) {
    for (const child of activeChildren.values()) {
      terminateProcess(child.pid, "SIGKILL");
    }
  }
  return result;
}

export function forceTerminateActiveProcesses(): void {
  shutdownRequested = true;
  for (const child of activeChildren.values()) {
    terminateProcess(child.pid, "SIGKILL");
  }
}

/** Test-only reset; production signal shutdown is intentionally monotonic. */
export function resetProcessShutdownForTest(): void {
  if (activeChildren.size !== 0) {
    throw new Error("Cannot reset process shutdown with active children.");
  }
  shutdownRequested = false;
}

export const runProcess: ProcessRunner = async (
  spec: ProcessSpec
): Promise<ProcessResult> => {
  if (shutdownRequested) {
    throw new BanzaiError(
      "PROCESS_SHUTTING_DOWN",
      "Cannot start a new process after coordinated shutdown begins."
    );
  }
  const startedAt = new Date().toISOString();
  const maxOutputBytes = spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return await new Promise<ProcessResult>((resolve, reject) => {
    let resolveDrain!: () => void;
    const drained = new Promise<void>((resolveDrainPromise) => {
      resolveDrain = resolveDrainPromise;
    });
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const registerChild = (): void => {
      if (child.pid !== undefined && !activeChildren.has(child.pid)) {
        activeChildren.set(child.pid, { pid: child.pid, drained });
      }
    };
    registerChild();

    let stdout = "";
    let stderr = "";
    let pendingStdoutLine = "";
    let outputBytes = 0;
    let timedOut = false;
    let outputExceeded = false;
    let settled = false;
    let durableFailure: unknown = null;
    let durableQueue = Promise.resolve();

    const notifyStdoutLine = (line: string): void => {
      try {
        spec.onStdoutLine?.(line);
      } catch {
        // Live presentation is observational and cannot fail the process.
      }
      if (spec.onStdoutLineDurable !== undefined) {
        durableQueue = durableQueue.then(async () => {
          if (durableFailure !== null) {
            return;
          }
          try {
            await spec.onStdoutLineDurable?.(line);
          } catch (error) {
            durableFailure = error;
            terminateProcess(child.pid ?? 0);
          }
        });
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcess(child.pid ?? 0);
    }, spec.timeoutMs);

    const observeStdoutLines = (value: string, flush = false): void => {
      pendingStdoutLine += value;
      const lines = pendingStdoutLine.split(/\n/);
      pendingStdoutLine = lines.pop() ?? "";
      for (const line of lines) {
        notifyStdoutLine(line.replace(/\r$/, ""));
      }
      if (flush && pendingStdoutLine.length > 0) {
        notifyStdoutLine(pendingStdoutLine.replace(/\r$/, ""));
        pendingStdoutLine = "";
      }
    };

    const collect = (target: "stdout" | "stderr", chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        outputExceeded = true;
        terminateProcess(child.pid ?? 0);
        return;
      }
      if (target === "stdout") {
        const value = chunk.toString("utf8");
        stdout += value;
        observeStdoutLines(value);
      } else {
        stderr += chunk.toString("utf8");
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      collect("stdout", chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      collect("stderr", chunk);
    });

    child.once("error", (error) => {
      clearTimeout(timer);
      if (child.pid !== undefined) {
        activeChildren.delete(child.pid);
      }
      resolveDrain();
      if (!settled) {
        settled = true;
        reject(
          new BanzaiError(
            "PROCESS_START_FAILED",
            `Could not start ${spec.command}: ${error.message}`
          )
        );
      }
    });

    child.once("spawn", () => {
      registerChild();
      if (child.pid === undefined) {
        return;
      }
      Promise.resolve(spec.onStart?.(child.pid)).catch((error: unknown) => {
        terminateProcess(child.pid ?? 0);
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      });
    });

    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      observeStdoutLines("", true);
      void durableQueue.finally(() => {
        if (child.pid !== undefined) {
          activeChildren.delete(child.pid);
        }
        resolveDrain();
        if (settled) {
          return;
        }
        settled = true;
        const result: ProcessResult = {
          exitCode: exitCode ?? 1,
          signal,
          stdout,
          stderr,
          startedAt,
          completedAt: new Date().toISOString()
        };
        if (durableFailure !== null) {
          reject(
            new ProcessExitError(
              durableFailure instanceof BanzaiError
                ? durableFailure.code
                : "PROCESS_OBSERVER_FAILED",
              errorMessage(durableFailure),
              result
            )
          );
          return;
        }
        if (timedOut) {
          reject(
            new ProcessExitError(
              "PROCESS_TIMEOUT",
              `${spec.command} exceeded its ${spec.timeoutMs}ms timeout.`,
              result,
              { failureCause: "timeout" }
            )
          );
          return;
        }
        if (outputExceeded) {
          reject(
            new ProcessExitError(
              "PROCESS_OUTPUT_LIMIT",
              `${spec.command} exceeded the ${maxOutputBytes}-byte output limit.`,
              result
            )
          );
          return;
        }
        resolve(result);
      });
    });
  });
};

export function terminateProcessGroup(
  pid: number
): "sent" | "not_found" | "failed" {
  return terminateProcess(pid);
}
