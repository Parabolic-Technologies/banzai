import path from "node:path";
import { createStyler, type Styler } from "./ansi.js";
import { resolveWidth, wrapText } from "./format.js";
import type {
  PhaseDescriptor,
  ProgressEvent,
  ProgressReporter
} from "./types.js";

type Timer = ReturnType<typeof setInterval>;

/**
 * How much of a model turn reaches the terminal.
 *
 * - `quiet` — phase boundaries, failures, and the runner's own messages.
 * - `normal` — adds one settled line per finished action, with its duration. A
 *   phase that ran four hundred actions reads as four hundred lines instead of
 *   eight hundred unpaired ones.
 * - `verbose` — every start and every completion, unchanged. This is the shape
 *   to reach for when an adapter itself is suspect.
 */
export type ProgressLevel = "quiet" | "normal" | "verbose";

const LEVELS = new Set<string>(["quiet", "normal", "verbose"]);

export interface ProgressPresentation {
  styler?: Styler;
  level?: ProgressLevel;
  /** Read per line so a resize mid-run is picked up. */
  columns?: () => number | undefined;
  /**
   * Raw writer for the live status line, without a trailing newline. Supply it
   * only for a real terminal: it emits carriage returns and erase sequences
   * that are meaningless in a pipe or a log file. Omitting it disables live
   * rendering entirely and leaves the line log exactly as it is.
   */
  write?: ((chunk: string) => void) | undefined;
}

/**
 * An explicit flag wins over the environment, which wins over the default. An
 * unrecognized `BANZAI_PROGRESS` is ignored rather than fatal: verbosity must
 * never be the reason a run cannot start.
 */
export function resolveProgressLevel(
  args: readonly string[],
  env: NodeJS.ProcessEnv
): ProgressLevel {
  if (args.includes("--verbose")) {
    return "verbose";
  }
  if (args.includes("--quiet")) {
    return "quiet";
  }
  const configured = env.BANZAI_PROGRESS?.trim().toLowerCase() ?? "";
  return LEVELS.has(configured) ? (configured as ProgressLevel) : "normal";
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) {
    return `${Math.max(0, Math.round(durationMs))}ms`;
  }
  if (durationMs < 60_000) {
    return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
  }
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1_000);
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function singleLine(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The phase's identity, compressed: which vendor is running, on which model and
 * effort, whether it continues a session or starts one, and how long it may
 * take. The same facts appear in the unstyled `detail` string; the banner makes
 * them a boundary in the scrollback rather than one more line among hundreds.
 */
function phaseBanner(
  label: string,
  descriptor: PhaseDescriptor,
  width: number,
  styler: Styler
): string {
  const vendor = path.basename(descriptor.executable);
  const timeout = `${Math.ceil(descriptor.timeoutMs / 60_000)}m cap`;
  const facts = [
    vendor,
    descriptor.model,
    descriptor.effort,
    descriptor.sessionMode,
    timeout
  ].join(" · ");
  const head = `── ${label} `;
  const tail = ` ${facts} ──`;
  const rule = "─".repeat(Math.max(1, width - head.length - tail.length));
  return `${styler.dim("──")} ${styler.bold(label)} ${styler.dim(`${rule}${tail}`)}`;
}

/** Runner phase responsibilities; real vendor Skill actions are reported separately. */
function phaseLines(
  phases: readonly string[],
  width: number,
  styler: Styler
): string[] {
  if (phases.length === 0) return [];
  return wrapText(`phases: ${phases.join(" → ")}`, width, "   ").map((line) =>
    styler.dim(`   ${line.trimStart()}`)
  );
}

interface InFlightAction {
  detail: string;
  startedAt: number;
}

/**
 * Settled-line durations render right-aligned in a fixed column so the verb
 * after them starts at one x-position and stays scannable. Five characters
 * cover every sub-minute duration (`317ms`, `9.9s`, `29s`); the rare
 * minutes-long action overflows the column rather than truncating.
 */
const DURATION_COLUMN = 5;
/**
 * An action at or above this duration keeps its duration undimmed: in a
 * minutes-long phase the few slow calls are the story, and a dimmed `29s` is
 * typographically identical to a dimmed `18ms`.
 */
const SLOW_ACTION_MS = 10_000;

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 120;
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });
/** Return to column zero and erase the whole line, leaving the cursor there. */
const ERASE_LINE = "\r\u001b[2K";

type ModelAction = Extract<ProgressEvent, { kind: "model_action" }>;

export class TerminalProgressReporter {
  private readonly timers = new Map<string, Timer>();
  private readonly startedAt = new Map<string, number>();
  private readonly inFlight = new Map<string, InFlightAction>();
  /** The most recent settled action, shown when nothing is in flight. */
  private lastSettled: string | null = null;
  private readonly styler: Styler;
  private readonly level: ProgressLevel;
  private readonly columns: () => number | undefined;
  private readonly write: ((chunk: string) => void) | null;
  /** The last compacted action line, held open so repeats can be counted. */
  private repeated: { detail: string; count: number } | null = null;
  private anonymousActions = 0;
  /** The phase the live line is reporting, or null when nothing is live. */
  private live: {
    label: string;
    startedAt: number;
    actions: number;
    descriptor: PhaseDescriptor | undefined;
  } | null = null;
  private liveDrawn = false;
  private liveTimer: Timer | null = null;
  private spinnerFrame = 0;

  constructor(
    private readonly writeLine: (line: string) => void = (line) => {
      console.error(line);
    },
    private readonly heartbeatMs = 30_000,
    presentation: ProgressPresentation = {}
  ) {
    this.styler = presentation.styler ?? createStyler(false);
    this.level = presentation.level ?? "normal";
    this.columns = presentation.columns ?? ((): undefined => undefined);
    // Verbose exists to produce a faithful log; a line that rewrites itself is
    // the opposite of that, so live rendering is off there whatever the stream.
    this.write =
      presentation.write !== undefined && this.level !== "verbose"
        ? presentation.write
        : null;
  }

  readonly report: ProgressReporter = (event) => {
    if (event.kind === "model_action") {
      this.reportModelAction(event);
      return;
    }
    // Every other line closes any open run of repeats, so ordering is preserved.
    this.flushRepeats();
    if (event.kind === "info") {
      this.emit(this.prefixed(singleLine(event.message)));
      return;
    }
    const label = singleLine(event.label);
    if (event.kind === "activity_started") {
      this.beginActivity(
        event.id,
        label,
        singleLine(event.detail),
        event.descriptor
      );
      return;
    }
    this.stopHeartbeat(event.id);
    this.stopLive();
    this.inFlight.clear();
    const failed = event.kind === "activity_failed";
    const line = `${failed ? "FAIL" : "DONE"} ${label} (${formatDuration(event.durationMs)})`;
    this.emit(this.prefixed(line, failed ? "fail" : "done"));
  };

  close(): void {
    this.flushRepeats();
    this.stopLive();
    for (const id of [...this.timers.keys()]) {
      this.stopHeartbeat(id);
    }
  }

  /**
   * Writes one settled line. The live line occupies the cursor's row, so it is
   * erased first and redrawn after; without that the two interleave and the
   * scrollback keeps half-overwritten fragments.
   */
  private emit(line: string): void {
    this.clearLive();
    this.writeLine(line);
    this.drawLive();
  }

  private startLive(
    label: string,
    descriptor: PhaseDescriptor | undefined
  ): void {
    if (this.write === null) {
      return;
    }
    this.live = { label, startedAt: Date.now(), actions: 0, descriptor };
    this.drawLive();
    this.liveTimer = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER.length;
      this.drawLive();
    }, SPINNER_INTERVAL_MS);
    this.liveTimer.unref();
  }

  private stopLive(): void {
    this.clearLive();
    if (this.liveTimer !== null) {
      clearInterval(this.liveTimer);
      this.liveTimer = null;
    }
    this.live = null;
  }

  private clearLive(): void {
    if (this.write === null || !this.liveDrawn) {
      return;
    }
    this.write(ERASE_LINE);
    this.liveDrawn = false;
  }

  private drawLive(): void {
    const live = this.live;
    if (this.write === null || live === null) {
      return;
    }
    const running = [...this.inFlight.values()]
      .sort((left, right) => left.startedAt - right.startedAt)
      .map((entry) => entry.detail);
    // Most tools settle faster than the redraw interval, so an in-flight-only
    // line reads as bare elapsed time for most of a phase. Falling back to what
    // finished last keeps it saying something true about the work.
    const work =
      running.length > 0 ? running.join(", ") : (this.lastSettled ?? null);
    const facts = [
      formatDuration(Date.now() - live.startedAt),
      work,
      live.actions === 0
        ? null
        : `${live.actions} action${live.actions === 1 ? "" : "s"}`
    ].filter((part) => part !== null);
    const frame = SPINNER[this.spinnerFrame] ?? SPINNER[0] ?? "-";
    // The banner scrolls away during a long phase, so the line that stays on
    // screen has to answer both questions on its own: which phase is running,
    // and what is running it. Model and effort sit next to the phase name so
    // truncation sheds the action count and the current work first.
    const model =
      live.descriptor === undefined
        ? ""
        : ` · ${live.descriptor.model} ${live.descriptor.effort}`;
    const plain = `${frame} ${live.label}${model}  ${facts.join(" · ")}`;
    // One column short of the terminal: a status line that wraps leaves the
    // overflow behind on the next erase. Measured in grapheme clusters so a
    // path or an emoji is never cut in half.
    const limit = Math.max(8, (this.columns() ?? 80) - 1);
    const clusters = Array.from(
      GRAPHEMES.segment(plain),
      (entry) => entry.segment
    );
    const text =
      clusters.length <= limit
        ? plain
        : `${clusters.slice(0, limit - 1).join("")}…`;
    this.write(
      `${ERASE_LINE}${this.styler.green(frame)}${this.styler.dim(text.slice(frame.length))}`
    );
    this.liveDrawn = true;
  }

  private beginActivity(
    id: string,
    label: string,
    detail: string,
    descriptor: PhaseDescriptor | undefined
  ): void {
    this.stopHeartbeat(id);
    this.stopLive();
    this.startedAt.set(id, Date.now());
    this.inFlight.clear();
    this.lastSettled = null;
    if (this.styler.enabled && descriptor !== undefined) {
      const width = resolveWidth(this.columns());
      this.emit(phaseBanner(label, descriptor, width, this.styler));
      for (const line of phaseLines(descriptor.phases, width, this.styler)) {
        this.emit(line);
      }
    } else {
      this.emit(
        this.prefixed(
          `START ${label}${detail.length > 0 ? ` - ${detail}` : ""}`
        )
      );
    }
    // The live line reports elapsed time continuously, so the periodic
    // heartbeat that exists to prove liveness is only needed without it.
    this.startLive(label, descriptor);
    if (this.live !== null) {
      return;
    }
    const timer = setInterval(() => {
      const startedAt = this.startedAt.get(id);
      if (startedAt !== undefined) {
        this.flushRepeats();
        this.emit(
          this.prefixed(
            `WAIT ${label} (${formatDuration(Date.now() - startedAt)})${this.waitingOn()}`
          )
        );
      }
    }, this.heartbeatMs);
    timer.unref();
    this.timers.set(id, timer);
  }

  /**
   * Names what is still running when the heartbeat fires. A long phase that
   * reports only elapsed time cannot be told apart from a hung one.
   */
  private waitingOn(): string {
    const running = [...this.inFlight.values()]
      .sort((left, right) => left.startedAt - right.startedAt)
      .map((entry) => entry.detail);
    if (running.length === 0) {
      return "";
    }
    const shown = running.slice(0, 3);
    const remainder = running.length - shown.length;
    return ` - running: ${shown.join(", ")}${remainder > 0 ? ` (+${remainder} more)` : ""}`;
  }

  private reportModelAction(event: ModelAction): void {
    const label = singleLine(event.label);
    const detail = singleLine(event.detail);
    // Codex reports ids for every item; a vendor that omits one still gets a
    // distinct key so two concurrent actions never collapse into each other.
    const key = event.actionId ?? `anonymous-${++this.anonymousActions}`;
    // Counted here rather than in the settled-line path, which `quiet` and
    // `verbose` both return before reaching.
    if (event.status === "completed" || event.status === "failed") {
      this.lastSettled = detail;
      if (this.live !== null) {
        this.live.actions += 1;
      }
    }

    if (this.level === "verbose") {
      this.trackInFlight(event, key, detail);
      const verb = {
        started: "START ",
        completed: "DONE ",
        failed: "FAIL ",
        info: ""
      }[event.status];
      this.flushRepeats();
      this.emit(
        this.prefixed(
          `${event.action.toUpperCase()} ${label} - ${verb}${detail}`
        )
      );
      return;
    }

    if (event.status === "failed") {
      const started = this.inFlight.get(key);
      this.inFlight.delete(key);
      this.flushRepeats();
      this.emit(this.compact("✗", detail, started, "fail"));
      return;
    }
    if (event.status === "started") {
      this.trackInFlight(event, key, detail);
      // A skill invocation names the phase's intent, so it is worth announcing
      // before it finishes. Everything else reads better as one settled line.
      if (event.action === "skill" && this.level === "normal") {
        this.flushRepeats();
        this.emit(this.compact("·", detail, undefined, "plain"));
      } else {
        this.drawLive();
      }
      return;
    }
    if (this.level === "quiet") {
      this.trackInFlight(event, key, detail);
      // Quiet prints nothing here, but the live line still owes the reader an
      // updated count rather than one that lags until the next spinner tick.
      this.drawLive();
      return;
    }
    if (event.status === "info") {
      this.flushRepeats();
      this.emit(this.compact("·", detail, undefined, "plain"));
      return;
    }
    const started = this.inFlight.get(key);
    this.inFlight.delete(key);
    if (event.action === "skill") {
      // Already announced on start; a completion line would only repeat it.
      return;
    }
    if (this.repeated !== null && this.repeated.detail === detail) {
      this.repeated.count += 1;
      this.drawLive();
      return;
    }
    this.flushRepeats();
    this.emit(this.compact("·", detail, started, "done"));
    this.repeated = { detail, count: 1 };
  }

  private trackInFlight(event: ModelAction, key: string, detail: string): void {
    // `model` marks the turn or session opening and never reports a matching
    // completion, and `usage` is a reading rather than work. Tracking either
    // would leave it permanently in flight and lead every heartbeat.
    if (event.action !== "action" && event.action !== "skill") {
      return;
    }
    if (event.status === "started") {
      this.inFlight.set(key, { detail, startedAt: Date.now() });
      return;
    }
    if (event.status !== "info") {
      this.inFlight.delete(key);
    }
  }

  /** Closes an open run of identical actions with its repeat count. */
  private flushRepeats(): void {
    const repeated = this.repeated;
    this.repeated = null;
    if (repeated !== null && repeated.count > 1) {
      this.emit(
        this.prefixed(`  ${this.styler.dim(`×${repeated.count} total`)}`)
      );
    }
  }

  private compact(
    marker: string,
    detail: string,
    started: InFlightAction | undefined,
    tone: "plain" | "done" | "fail"
  ): string {
    let elapsed = "";
    if (started !== undefined) {
      const durationMs = Date.now() - started.startedAt;
      const duration = formatDuration(durationMs).padStart(DURATION_COLUMN);
      elapsed = `${durationMs >= SLOW_ACTION_MS ? duration : this.styler.dim(duration)} `;
    }
    return this.prefixed(
      `${marker} ${elapsed}${tone === "fail" ? this.styler.red(detail) : detail}`
    );
  }

  /**
   * Failure is the only thing worth interrupting a scan for, so it is the only
   * line that takes a colour; completion recedes and everything else is plain.
   */
  private prefixed(
    body: string,
    tone: "plain" | "done" | "fail" = "plain"
  ): string {
    const line = `[banzai] ${body}`;
    if (!this.styler.enabled) {
      return line;
    }
    if (tone === "fail") {
      return this.styler.red(line);
    }
    if (tone === "done") {
      return this.styler.dim(line);
    }
    return line;
  }

  private stopHeartbeat(id: string): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearInterval(timer);
      this.timers.delete(id);
    }
    this.startedAt.delete(id);
  }
}
