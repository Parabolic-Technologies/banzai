import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  HUMAN_TIME_LIMITS,
  currentHumanTimeEffort,
  deriveHumanTime,
  humanTimeIssue,
  uniqueHumanTimeIssues,
  validHumanMinutes
} from "./human-time.js";
import type {
  HumanTimeBoundary,
  HumanTimeCapture,
  HumanTimeChange,
  HumanTimeGateway,
  HumanTimeIssue,
  HumanTimeObservation,
  HumanTimeReadResult,
  HumanTimeSummary,
  HumanTimeWriteResult
} from "./human-time.js";
import { HumanTimeStore } from "./human-time-store.js";

interface Clock {
  utc(): string;
  monotonic(): number;
}
interface Sample {
  utc: number;
  monotonic: number;
}
const systemClock: Clock = {
  utc: () => new Date().toISOString(),
  monotonic: () => performance.now()
};
const emptyChange = (): HumanTimeChange => ({
  captures: [],
  observations: [],
  effort: null,
  issues: []
});

export class InteractiveHumanTime implements HumanTimeGateway {
  private runId: string | null = null;
  private captureId: string | null = null;
  private readonly samples = new Map<string, Sample>();
  private readonly sessionIssues = new Map<string, HumanTimeIssue[]>();

  constructor(
    private readonly store: HumanTimeStore,
    private readonly reportUnsaved: () => void,
    private readonly clock: Clock = systemClock
  ) {}

  private failed(
    runId: string,
    result: HumanTimeWriteResult,
    report = true
  ): void {
    if (!("issue" in result)) return;
    this.sessionIssues.set(
      runId,
      uniqueHumanTimeIssues([
        ...(this.sessionIssues.get(runId) ?? []),
        humanTimeIssue(result.issue)
      ])
    );
    if (report) {
      try {
        this.reportUnsaved();
      } catch {
        /* Presentation never changes workflow. */
      }
    }
  }
  private revision(read: HumanTimeReadResult): number | null {
    return read.status === "valid"
      ? read.ledger.revision
      : read.status === "absent"
        ? 0
        : null;
  }
  private async reconcile(
    runId: string,
    boundary: HumanTimeBoundary | null,
    newCapture: boolean
  ): Promise<void> {
    const read = await this.store.read(runId);
    const revision = this.revision(read);
    if (revision === null) {
      this.failed(runId, {
        status: "unavailable",
        issue: read.status === "valid" ? "INVALID_EVIDENCE" : read.issue
      });
      return;
    }
    const evidence = await this.store.readEvidence(runId);
    const change = emptyChange();
    const capturedAt = this.clock.utc();
    if (newCapture) {
      this.captureId = randomUUID();
      const capture: HumanTimeCapture = {
        id: this.captureId,
        kind: "attach",
        at: capturedAt,
        startId: null,
        sourcePosition:
          evidence.issues.length === 0 ? evidence.eventCount : null
      };
      change.captures.push(capture);
      // Run creation is the only supported complete start anchor; even then the
      // summary remains a captured subtotal, not a claim of task-wide coverage.
      if (boundary?.kind !== "run_created")
        change.issues.push(humanTimeIssue("CAPTURE_GAP"));
      if (
        read.status === "valid" &&
        read.ledger.captures.some(
          (c) =>
            c.kind === "attach" &&
            !read.ledger.captures.some((d) => d.startId === c.id)
        )
      )
        change.issues.push(humanTimeIssue("CAPTURE_GAP"));
    }
    const keys = new Set(
      read.status === "valid"
        ? read.ledger.observations.map((o) => o.episodeKey)
        : []
    );
    for (const key of evidence.pendingKeys) keys.add(key);
    const sample: Sample = {
      utc: Date.parse(capturedAt),
      monotonic: this.clock.monotonic()
    };
    for (const observation of evidence.observations) {
      if (!keys.has(observation.episodeKey)) continue;
      const currentBoundary =
        boundary !== null &&
        observation.source.kind === "event" &&
        observation.source.type === boundary.eventType &&
        observation.at === boundary.eventAt &&
        (boundary.attemptId === null ||
          observation.anchor.attemptId === boundary.attemptId);
      const value: HumanTimeObservation = {
        ...observation,
        capturedAt,
        channel: currentBoundary ? "interactive" : "unattributed"
      };
      if (currentBoundary) {
        const delay = Math.abs(sample.utc - Date.parse(observation.at));
        if (observation.endpoint === "opened") {
          if (
            delay <= HUMAN_TIME_LIMITS.clockToleranceMs &&
            !this.samples.has(observation.episodeKey)
          )
            this.samples.set(observation.episodeKey, sample);
        } else {
          const start = this.samples.get(observation.episodeKey);
          if (start !== undefined) {
            const disagreement = Math.abs(
              sample.utc - start.utc - (sample.monotonic - start.monotonic)
            );
            value.clock = {
              basis: "utc_wall",
              continuity:
                disagreement > HUMAN_TIME_LIMITS.clockToleranceMs
                  ? "discontinuity"
                  : delay <= HUMAN_TIME_LIMITS.clockToleranceMs
                    ? "process_correlated"
                    : "unverified"
            };
            this.samples.delete(observation.episodeKey);
          }
        }
      }
      change.observations.push(value);
    }
    change.issues.push(...evidence.issues);
    const result = await this.store.update(runId, revision, change);
    if (newCapture && result.status !== "saved") this.captureId = null;
    this.failed(runId, result);
  }
  async attach(runId: string): Promise<void> {
    if (this.runId !== runId) {
      await this.detach();
      this.runId = runId;
      await this.reconcile(runId, null, true);
    } else await this.reconcile(runId, null, this.captureId === null);
  }
  async observe(boundary: HumanTimeBoundary): Promise<void> {
    try {
      const newCapture =
        this.runId !== boundary.runId || this.captureId === null;
      if (this.runId !== boundary.runId) {
        await this.detach();
        this.runId = boundary.runId;
      }
      await this.reconcile(boundary.runId, boundary, newCapture);
    } catch {
      this.failed(boundary.runId, {
        status: "unavailable",
        issue: "WRITE_FAILED"
      });
    }
  }
  async readSummary(runId: string): Promise<HumanTimeSummary> {
    const read = await this.store.read(runId);
    const evidence = await this.store.readEvidence(runId);
    evidence.issues.push(...(this.sessionIssues.get(runId) ?? []));
    return deriveHumanTime(read, evidence, this.clock.utc());
  }
  async setEstimate(
    runId: string,
    expectedRevision: number,
    minutes: number
  ): Promise<HumanTimeWriteResult> {
    if (this.runId !== runId)
      return { status: "stale", issue: "STALE_REVISION" };
    if (!validHumanMinutes(minutes))
      return { status: "unavailable", issue: "INVALID_EVIDENCE" };
    const read = await this.store.read(runId);
    const revision = this.revision(read);
    if (revision !== expectedRevision)
      return { status: "stale", issue: "STALE_REVISION" };
    const prior =
      read.status === "valid"
        ? currentHumanTimeEffort(read.ledger.effortRevisions)
        : null;
    const at = this.clock.utc();
    const change = emptyChange();
    change.effort = {
      id: randomUUID(),
      replaces: prior?.id ?? null,
      recordedAt: at,
      asOf: at,
      minutes,
      basis: "estimated",
      scope: "single_engineer_unverified"
    };
    const result = await this.store.update(runId, expectedRevision, change);
    this.failed(runId, result, false);
    return result;
  }
  async detach(): Promise<void> {
    const runId = this.runId;
    const captureId = this.captureId;
    this.runId = null;
    this.captureId = null;
    this.samples.clear();
    if (runId === null || captureId === null) return;
    try {
      const read = await this.store.read(runId);
      if (
        read.status !== "valid" ||
        !read.ledger.captures.some((c) => c.id === captureId)
      )
        return;
      const evidence = await this.store.readEvidence(runId);
      const change = emptyChange();
      change.captures.push({
        id: randomUUID(),
        kind: "detach",
        at: this.clock.utc(),
        startId: captureId,
        sourcePosition:
          evidence.issues.length === 0 ? evidence.eventCount : null
      });
      this.failed(
        runId,
        await this.store.update(runId, read.ledger.revision, change)
      );
    } catch {
      this.failed(runId, { status: "unavailable", issue: "WRITE_FAILED" });
    }
  }
}
