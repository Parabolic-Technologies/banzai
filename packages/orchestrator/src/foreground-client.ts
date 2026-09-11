import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { BanzaiError } from "./errors.js";
import type { SetupLaunch } from "./setup-client.js";

const execFileAsync = promisify(execFile);
const SHUTDOWN_GRACE_MS = 2_000;
const STARTUP_TIMEOUT_MS = 5_000;

async function descendants(pid: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid="], {
      timeout: 1_000,
      maxBuffer: 1024 * 1024
    });
    const pairs = stdout
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number));
    const owned = new Set([pid]);
    for (let changed = true; changed;) {
      changed = false;
      for (const [child, parent] of pairs)
        if (child && parent && owned.has(parent) && !owned.has(child)) {
          owned.add(child);
          changed = true;
        }
    }
    return [...owned].reverse();
  } catch {
    return [pid];
  }
}

/** Foreground ownership stays in the terminal's process group, so /dev/tty and
 * client permission prompts work. Only this child's tree is terminated. */
export async function runForegroundClient(
  launch: SetupLaunch
): Promise<{ exitCode: number; signal: NodeJS.Signals | null }> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new BanzaiError(
      "TTY_REQUIRED",
      "Project setup requires terminal input and output."
    );
  const wasPaused = process.stdin.isPaused();
  const restoreTerminal = () => {
    // Reassert both states: a child may have changed termios without changing
    // the parent's cached isRaw flag.
    process.stdin.setRawMode(true);
    process.stdin.setRawMode(false);
    if (wasPaused) process.stdin.pause();
    else process.stdin.resume();
    process.stdout.write("\u001b[?2004l\u001b[?25h");
  };
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write("\u001b[?2004l\u001b[?25h");
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        env: launch.env,
        shell: false,
        stdio: "inherit",
        detached: false
      });
      let interruption: NodeJS.Signals | null = null;
      let shutdown: Promise<void> | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const startup = setTimeout(() => {
        child.kill("SIGKILL");
        cleanup();
        reject(
          new BanzaiError(
            "PROJECT_SETUP_SPAWN_FAILED",
            "The selected client did not start in time. Check its installation before retrying."
          )
        );
      }, STARTUP_TIMEOUT_MS);
      child.once("spawn", () => {
        clearTimeout(startup);
      });
      const signal = (value: "SIGINT" | "SIGTERM") => {
        if (shutdown !== null) return;
        interruption = value;
        shutdown = (async () => {
          if (child.pid === undefined) return;
          const owned = await descendants(child.pid);
          const send = (name: NodeJS.Signals) => {
            for (const pid of owned)
              try {
                process.kill(pid, name);
              } catch {
                /* Already closed. */
              }
          };
          send(value);
          await new Promise<void>((done) => {
            timer = setTimeout(() => {
              send("SIGKILL");
              done();
            }, SHUTDOWN_GRACE_MS);
          });
        })();
      };
      const onInt = () => {
        signal("SIGINT");
      };
      const onTerm = () => {
        signal("SIGTERM");
      };
      process.on("SIGINT", onInt);
      process.on("SIGTERM", onTerm);
      const cleanup = () => {
        clearTimeout(startup);
        process.off("SIGINT", onInt);
        process.off("SIGTERM", onTerm);
        if (timer) clearTimeout(timer);
      };
      child.once("error", () => {
        cleanup();
        reject(
          new BanzaiError(
            "PROJECT_SETUP_SPAWN_FAILED",
            "The selected client could not start. Check its installation and use banzai setup to try again."
          )
        );
      });
      child.once("close", (code, childSignal) => {
        void (async () => {
          await shutdown;
          cleanup();
          const finalSignal = interruption ?? childSignal;
          resolve({
            exitCode:
              finalSignal === "SIGINT"
                ? 130
                : finalSignal === "SIGTERM"
                  ? 143
                  : (code ?? 1),
            signal: finalSignal
          });
        })();
      });
    });
  } finally {
    restoreTerminal();
  }
}
