import type { Writable } from "node:stream";
import type { RunState } from "./types.js";

export interface TerminalAttentionOptions {
  platform: string;
  env: NodeJS.ProcessEnv;
  interactiveTerminal: boolean;
  output: Writable & { isTTY?: boolean };
  now?: () => number;
}

const HUMAN_STATUSES: readonly RunState["status"][] = [
  "needs_plan_approval",
  "needs_adr_approval",
  "needs_human_decision",
  "needs_triage",
  "blocked"
];

/** Presentation-only: one opportunity per completed automatic operation. */
export class TerminalAttention {
  private readonly sequence: string | null;
  private readonly now: () => number;

  constructor(private readonly options: TerminalAttentionOptions) {
    this.now = options.now ?? (() => performance.now());
    const { env } = options;
    this.sequence =
      options.platform !== "darwin" ||
      !options.interactiveTerminal ||
      !options.output.isTTY ||
      env.BANZAI_ATTENTION === "off" ||
      [env.CI, env.TMUX, env.STY].some((value) => Boolean(value)) ||
      env.TERM === "dumb"
        ? null
        : env.TERM_PROGRAM === "Apple_Terminal"
          ? "\x07"
          : env.TERM_PROGRAM === "iTerm.app"
            ? "\x1b]1337;RequestAttention=once\x07"
            : null;
  }

  async run<T extends Pick<RunState, "status">>(
    operation: () => Promise<T>
  ): Promise<T> {
    if (this.sequence === null) {
      return await operation();
    }
    const started = this.now();
    const state = await operation();
    if (
      this.now() - started >= 30_000 &&
      HUMAN_STATUSES.includes(state.status)
    ) {
      this.requestAttention(this.sequence);
    }
    return state;
  }

  private requestAttention(sequence: string): void {
    const { output } = this.options;
    if (output.destroyed || !output.writable) {
      return;
    }
    // Writable emits an error after invoking a failed write's callback. Keep
    // the one-shot listener until that event, but remove it after success.
    const ignoreError = (): void => {};
    output.once("error", ignoreError);
    try {
      output.write(sequence, (error) => {
        if (!error) {
          output.removeListener("error", ignoreError);
        }
      });
    } catch {
      output.removeListener("error", ignoreError);
    }
  }
}
