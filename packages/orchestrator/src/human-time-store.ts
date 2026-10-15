import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  HUMAN_TIME_LIMITS,
  HumanTimeFailure,
  currentHumanTimeEffort,
  decodeHumanTime,
  emptyHumanTime,
  emptyHumanTimeEvidence,
  humanTimeId,
  humanTimeInteger,
  humanTimeIssue,
  humanTimeObservation,
  humanTimeRecord,
  humanTimeUtc,
  uniqueHumanTimeIssues
} from "./human-time.js";
import type {
  HumanTimeAnchor,
  HumanTimeChange,
  HumanTimeEvidence,
  HumanTimeEventType,
  HumanTimeIssueCode,
  HumanTimeObservation,
  HumanTimeReadResult,
  HumanTimeWriteResult
} from "./human-time.js";

interface Identity {
  path: string;
  dev: number;
  ino: number;
}
function directoryAt(directories: Identity[], index: number): string {
  const entry = directories.at(index);
  if (entry === undefined) throw new HumanTimeFailure("UNSAFE_PATH");
  return entry.path;
}
function errno(error: unknown): string | undefined {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  )
    return error.code;
  return undefined;
}
function issueCode(
  error: unknown,
  fallback: HumanTimeIssueCode
): HumanTimeIssueCode {
  if (error instanceof HumanTimeFailure) return error.code;
  if (errno(error) === "ELOOP") return "UNSAFE_PATH";
  return fallback;
}
function missing(error: unknown): boolean {
  return errno(error) === "ENOENT";
}
function json(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new HumanTimeFailure("INVALID_EVIDENCE");
  }
}

export class HumanTimeStore {
  constructor(private readonly repoRoot: string) {}

  private async directories(runId: string): Promise<Identity[]> {
    humanTimeId(runId);
    const root = await realpath(this.repoRoot);
    const paths = [
      root,
      path.join(root, ".banzai"),
      path.join(root, ".banzai", "runs"),
      path.join(root, ".banzai", "runs", runId)
    ];
    const result: Identity[] = [];
    for (const directory of paths) {
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new HumanTimeFailure("UNSAFE_PATH");
      result.push({ path: directory, dev: stat.dev, ino: stat.ino });
    }
    return result;
  }
  private async recheck(directories: Identity[]): Promise<void> {
    for (const item of directories) {
      const stat = await lstat(item.path);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        stat.dev !== item.dev ||
        stat.ino !== item.ino
      )
        throw new HumanTimeFailure("UNSAFE_PATH");
    }
  }
  private async file(
    directory: string,
    name: string,
    bound: number,
    privateFile = false
  ): Promise<Buffer> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(name))
      throw new HumanTimeFailure("UNSAFE_PATH");
    const filename = path.join(directory, name);
    const before = await lstat(filename);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      (privateFile && (before.mode & 0o777) !== 0o600)
    )
      throw new HumanTimeFailure("UNSAFE_PATH");
    const handle = await open(
      filename,
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino)
        throw new HumanTimeFailure("UNSAFE_PATH");
      if (stat.size > bound) throw new HumanTimeFailure("LIMIT_EXCEEDED");
      const buffer = Buffer.alloc(Math.min(stat.size + 1, bound + 1));
      let size = 0;
      while (size < buffer.length) {
        const read = await handle.read(
          buffer,
          size,
          buffer.length - size,
          size
        );
        if (read.bytesRead === 0) break;
        size += read.bytesRead;
      }
      const after = await handle.stat();
      if (size > bound || after.size > bound)
        throw new HumanTimeFailure("LIMIT_EXCEEDED");
      if (
        size !== stat.size ||
        after.size !== stat.size ||
        after.mtimeMs !== stat.mtimeMs ||
        after.ctimeMs !== stat.ctimeMs
      )
        throw new HumanTimeFailure("INVALID_EVIDENCE");
      return buffer.subarray(0, size);
    } finally {
      await handle.close();
    }
  }
  private async runState(
    directory: string,
    runId: string
  ): Promise<Record<string, unknown>> {
    const state = humanTimeRecord(
      json(await this.file(directory, "state.json", HUMAN_TIME_LIMITS.bytes))
    );
    if (
      humanTimeId(state.runId) !== runId ||
      ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(state.schemaVersion as number)
    )
      throw new HumanTimeFailure("INVALID_EVIDENCE");
    return state;
  }
  private async readAt(
    directory: string,
    runId: string
  ): Promise<HumanTimeReadResult> {
    try {
      return decodeHumanTime(
        json(
          await this.file(
            directory,
            "human-time.json",
            HUMAN_TIME_LIMITS.bytes,
            true
          )
        ),
        runId
      );
    } catch (error) {
      return missing(error)
        ? { status: "absent", issue: "MISSING_EVIDENCE" }
        : { status: "invalid", issue: issueCode(error, "INVALID_EVIDENCE") };
    }
  }
  async read(runId: string): Promise<HumanTimeReadResult> {
    try {
      const directories = await this.directories(runId);
      const directory = directoryAt(directories, -1);
      await this.runState(directory, runId);
      const read = await this.readAt(directory, runId);
      await this.recheck(directories);
      return read;
    } catch (error) {
      return {
        status: "invalid",
        issue: issueCode(
          error,
          missing(error) ? "MISSING_EVIDENCE" : "INVALID_EVIDENCE"
        )
      };
    }
  }
  private async activeRun(
    directories: Identity[],
    runId: string
  ): Promise<void> {
    const pointer = humanTimeRecord(
      json(
        await this.file(directoryAt(directories, 1), "active-run.json", 4096)
      )
    );
    if (pointer.runId !== runId || pointer.schemaVersion !== 1)
      throw new HumanTimeFailure("STALE_REVISION");
  }
  private async removeOwned(
    filename: string,
    identity: Identity,
    directories: Identity[]
  ): Promise<void> {
    try {
      await this.recheck(directories);
      const stat = await lstat(filename);
      if (
        stat.isFile() &&
        stat.dev === identity.dev &&
        stat.ino === identity.ino
      )
        await unlink(filename);
    } catch {
      /* Never remove an unverified replacement or mask the primary result. */
    }
  }
  protected async replaceFile(source: string, target: string): Promise<void> {
    await rename(source, target);
  }
  async update(
    runId: string,
    expectedRevision: number,
    change: HumanTimeChange
  ): Promise<HumanTimeWriteResult> {
    let guard: FileHandle | undefined;
    let guardIdentity: Identity | undefined;
    let temporary: Identity | undefined;
    let directories: Identity[] = [];
    try {
      humanTimeInteger(expectedRevision);
      directories = await this.directories(runId);
      const directory = directoryAt(directories, -1);
      await this.runState(directory, runId);
      const guardPath = path.join(directory, "human-time.lock");
      try {
        guard = await open(
          guardPath,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          const stat = await lstat(guardPath);
          return {
            status: "contended",
            issue:
              stat.isSymbolicLink() || !stat.isFile()
                ? "UNSAFE_PATH"
                : "WRITE_CONTENDED"
          };
        }
        throw error;
      }
      const guardStat = await guard.stat();
      guardIdentity = {
        path: guardPath,
        dev: guardStat.dev,
        ino: guardStat.ino
      };
      await guard.writeFile(randomUUID());
      const current = await this.readAt(directory, runId);
      if (current.status !== "valid" && current.status !== "absent")
        return { status: "unavailable", issue: current.issue };
      const ledger =
        current.status === "valid" ? current.ledger : emptyHumanTime(runId);
      if (ledger.revision !== expectedRevision)
        return { status: "stale", issue: "STALE_REVISION" };
      const observations = new Map(
        ledger.observations.map((item) => [item.id, item])
      );
      const issues = [...ledger.issues, ...change.issues];
      for (const observation of change.observations) {
        const existing = observations.get(observation.id);
        if (existing === undefined)
          observations.set(observation.id, observation);
        else if (observation.clock.continuity === "discontinuity")
          issues.push(
            humanTimeIssue("CLOCK_DISCONTINUITY", observation.episodeKey)
          );
      }
      if (change.effort !== null) {
        await this.activeRun(directories, runId);
        const prior = currentHumanTimeEffort(ledger.effortRevisions);
        if (
          (ledger.effortRevisions.length > 0 && prior === null) ||
          change.effort.replaces !== (prior?.id ?? null)
        )
          return { status: "stale", issue: "CONFLICTING_EFFORT" };
      }
      const next = {
        ...ledger,
        captures: [...ledger.captures, ...change.captures],
        observations: [...observations.values()],
        effortRevisions:
          change.effort === null
            ? ledger.effortRevisions
            : [...ledger.effortRevisions, change.effort],
        issues: uniqueHumanTimeIssues(issues)
      };
      if (JSON.stringify(next) === JSON.stringify(ledger))
        return { status: "unchanged", revision: ledger.revision };
      next.revision++;
      const decoded = decodeHumanTime(next, runId);
      if (decoded.status !== "valid")
        return { status: "unavailable", issue: decoded.issue };
      const bytes = Buffer.from(`${JSON.stringify(decoded.ledger)}\n`);
      if (bytes.length > HUMAN_TIME_LIMITS.bytes)
        return { status: "unavailable", issue: "LIMIT_EXCEEDED" };
      const tempPath = path.join(directory, `human-time.${randomUUID()}.tmp`);
      const handle = await open(
        tempPath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600
      );
      try {
        const stat = await handle.stat();
        temporary = { path: tempPath, dev: stat.dev, ino: stat.ino };
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.recheck(directories);
      if (change.effort !== null) await this.activeRun(directories, runId);
      // Recheck the leaf too: never overwrite an introduced symlink or foreign ledger.
      const latest = await this.readAt(directory, runId);
      if (
        latest.status !== current.status ||
        (latest.status === "valid" &&
          current.status === "valid" &&
          JSON.stringify(latest.ledger) !== JSON.stringify(current.ledger))
      )
        throw new HumanTimeFailure("STALE_REVISION");
      await this.replaceFile(tempPath, path.join(directory, "human-time.json"));
      temporary = undefined;
      return { status: "saved", revision: next.revision };
    } catch (error) {
      const issue = issueCode(error, "WRITE_FAILED");
      return {
        status: issue === "STALE_REVISION" ? "stale" : "unavailable",
        issue
      };
    } finally {
      if (temporary !== undefined)
        await this.removeOwned(temporary.path, temporary, directories);
      await guard?.close().catch(() => undefined);
      if (guardIdentity !== undefined)
        await this.removeOwned(guardIdentity.path, guardIdentity, directories);
    }
  }

  async readEvidence(runId: string): Promise<HumanTimeEvidence> {
    try {
      const directories = await this.directories(runId);
      const directory = directoryAt(directories, -1);
      const stateBytes = await this.file(
        directory,
        "state.json",
        HUMAN_TIME_LIMITS.bytes
      );
      const state = humanTimeRecord(json(stateBytes));
      if (
        humanTimeId(state.runId) !== runId ||
        ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(state.schemaVersion as number)
      )
        throw new HumanTimeFailure("INVALID_EVIDENCE");
      const bytes = await this.file(
        directory,
        "events.jsonl",
        HUMAN_TIME_LIMITS.eventBytes
      );
      if (bytes.length > 0 && bytes.at(-1) !== 10)
        throw new HumanTimeFailure("INVALID_EVIDENCE");
      const lines = bytes.toString("utf8").split("\n").slice(0, -1);
      if (lines.length > HUMAN_TIME_LIMITS.eventLines)
        throw new HumanTimeFailure("LIMIT_EXCEEDED");
      const evidence = emptyHumanTimeEvidence();
      evidence.eventCount = lines.length;
      evidence.blocked = state.status === "blocked";
      let pending: HumanTimeObservation | null = null;
      let lastGate: HumanTimeObservation | null = null;
      let recovery: HumanTimeObservation | null = null;
      let metadataBytes = 0;
      const attempts = new Map<string, Record<string, unknown>>();
      const attemptResult = async (
        id: string,
        kind: string
      ): Promise<Record<string, unknown>> => {
        humanTimeId(id);
        if (!["plan", "implementation", "fix", "review"].includes(kind))
          throw new HumanTimeFailure("INVALID_EVIDENCE");
        const key = `${id}-${kind}.json`;
        const cached = attempts.get(key);
        if (cached !== undefined) return cached;
        const attemptsPath = path.join(directory, "attempts");
        const stat = await lstat(attemptsPath);
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new HumanTimeFailure("UNSAFE_PATH");
        const content = await this.file(
          attemptsPath,
          key,
          HUMAN_TIME_LIMITS.bytes
        );
        const after = await lstat(attemptsPath);
        if (
          !after.isDirectory() ||
          after.isSymbolicLink() ||
          after.dev !== stat.dev ||
          after.ino !== stat.ino
        )
          throw new HumanTimeFailure("UNSAFE_PATH");
        metadataBytes += content.length;
        if (metadataBytes > HUMAN_TIME_LIMITS.eventBytes)
          throw new HumanTimeFailure("LIMIT_EXCEEDED");
        const record = humanTimeRecord(json(content));
        const attempt = humanTimeRecord(record.attempt);
        if (
          ![1, 2, 3, 4].includes(record.schemaVersion as number) ||
          record.status !== "completed" ||
          attempt.id !== id ||
          attempt.kind !== kind
        )
          throw new HumanTimeFailure("INVALID_EVIDENCE");
        const result = humanTimeRecord(record.result);
        // Only bounded decision metadata escapes this function; never keep result prose.
        const projected: Record<string, unknown> = {
          gate: result.gate,
          verdict: result.verdict,
          phase: result.phase
        };
        if (result.gate === "decision_consultation") {
          const request = humanTimeRecord(result.decisionConsultation);
          projected.requestId = humanTimeId(request.requestId);
          projected.roundId = humanTimeId(request.roundId);
        }
        attempts.set(key, projected);
        return projected;
      };
      const append = (
        anchor: HumanTimeAnchor,
        endpoint: HumanTimeObservation["endpoint"],
        at: string,
        type: HumanTimeEventType,
        ordinal: number
      ): HumanTimeObservation => {
        const observation = humanTimeObservation(runId, anchor, endpoint, at, {
          kind: "event",
          type,
          ordinal
        });
        evidence.observations.push(observation);
        return observation;
      };
      for (const [ordinal, line] of lines.entries()) {
        if (Buffer.byteLength(line) > HUMAN_TIME_LIMITS.eventLineBytes)
          throw new HumanTimeFailure("LIMIT_EXCEEDED");
        const event = humanTimeRecord(json(Buffer.from(line)));
        if (event.runId !== runId)
          throw new HumanTimeFailure("INVALID_EVIDENCE");
        const at = humanTimeUtc(event.at);
        const detail = humanTimeRecord(event.details);
        if (event.type === "run.created") {
          if (evidence.runCreatedAt !== null)
            throw new HumanTimeFailure("AMBIGUOUS_ANCHOR");
          evidence.runCreatedAt = at;
        }
        if (
          (event.type === "attempt.started" ||
            event.type === "attempt.recovery_started") &&
          recovery !== null
        ) {
          append(recovery.anchor, "recovery_ended", at, event.type, ordinal);
          recovery = null;
        }
        let anchor: HumanTimeAnchor | null = null;
        if (event.type === "attempt.applied") {
          const id = humanTimeId(detail.attemptId);
          if (detail.status === "blocked") {
            if (recovery !== null)
              append(
                recovery.anchor,
                "recovery_ended",
                at,
                "attempt.applied",
                ordinal
              );
            recovery = append(
              { type: "recovery_wait", attemptId: id, ordinal },
              "opened",
              at,
              "attempt.applied",
              ordinal
            );
          }
          const isGate = [
            "needs_plan_approval",
            "needs_adr_approval",
            "needs_human_decision"
          ].includes(detail.status as string);
          if (isGate) {
            const result = await attemptResult(id, String(detail.kind));
            if (result.gate !== detail.gate || result.phase !== detail.kind)
              throw new HumanTimeFailure("AMBIGUOUS_ANCHOR");
            if (
              detail.status === "needs_plan_approval" &&
              (detail.gate === "plan_approval" || detail.gate === null)
            )
              anchor = {
                type: "plan_approval",
                attemptId: id,
                bundleDigest: null
              };
            else if (
              detail.status === "needs_adr_approval" &&
              detail.gate === "adr_approval"
            )
              anchor = { type: "adr_approval", attemptId: id };
            else if (
              detail.status === "needs_human_decision" &&
              detail.gate === "decision_consultation"
            )
              anchor = {
                type: "decision_consultation",
                attemptId: id,
                requestId: humanTimeId(result.requestId),
                roundId: humanTimeId(result.roundId)
              };
            else if (
              detail.status === "needs_human_decision" &&
              detail.gate === "escalation"
            )
              anchor = { type: "escalation", attemptId: id };
            else throw new HumanTimeFailure("AMBIGUOUS_ANCHOR");
          }
        }
        if (event.type === "review.completed") {
          const id = humanTimeId(detail.attemptId);
          const result = await attemptResult(id, "review");
          if (result.verdict !== detail.verdict)
            throw new HumanTimeFailure("AMBIGUOUS_ANCHOR");
          if (detail.verdict === "changes_requested")
            anchor = {
              type: "triage",
              attemptId: id,
              reviewIteration: humanTimeInteger(detail.iteration, 1)
            };
          else if (
            ["blocked", "replan_required"].includes(detail.verdict as string)
          )
            recovery = append(
              { type: "recovery_wait", attemptId: id, ordinal },
              "opened",
              at,
              "review.completed",
              ordinal
            );
        }
        if (
          [
            "planning_review.triage_pending",
            "planning_review.gate_restored",
            "planning_review.stale"
          ].includes(event.type as string)
        ) {
          const pr = humanTimeRecord(state.planningReview);
          const episodes = [
            ...(Array.isArray(pr.closed) ? (pr.closed as unknown[]) : []),
            ...(pr.active == null ? [] : [pr.active])
          ].map(humanTimeRecord);
          const episode = episodes.find(
            (e) =>
              e.episodeId === detail.episodeId &&
              e.reviewNumber === detail.reviewNumber
          );
          if (episode === undefined)
            throw new HumanTimeFailure("AMBIGUOUS_ANCHOR");
          if (event.type === "planning_review.triage_pending") {
            if (
              episode.analysisAttemptId !== detail.attemptId ||
              episode.findingCount !== detail.findingCount ||
              episode.originGate !== detail.gate
            )
              throw new HumanTimeFailure("AMBIGUOUS_ANCHOR");
            anchor = {
              type: "planning_review_triage",
              attemptId: humanTimeId(detail.attemptId),
              episodeId: humanTimeId(detail.episodeId),
              reviewNumber: humanTimeInteger(detail.reviewNumber, 1)
            };
          } else if (event.type === "planning_review.gate_restored") {
            if (
              episode.originGate !== detail.gate ||
              episode.outcome !== detail.outcome ||
              !["restored_no_findings", "restored_no_action"].includes(
                String(detail.outcome)
              )
            )
              throw new HumanTimeFailure("AMBIGUOUS_ANCHOR");
            anchor =
              detail.gate === "plan_approval"
                ? {
                    type: "plan_approval",
                    attemptId: humanTimeId(detail.episodeId),
                    bundleDigest: null
                  }
                : {
                    type: "adr_approval",
                    attemptId: humanTimeId(detail.episodeId)
                  };
          } else if (pending?.anchor.type === "planning_review_triage") {
            if (
              episode.outcome !== "stale" ||
              pending.anchor.episodeId !== detail.episodeId
            )
              throw new HumanTimeFailure("AMBIGUOUS_ANCHOR");
            append(
              pending.anchor,
              "superseded",
              at,
              "planning_review.stale",
              ordinal
            );
            pending = null;
          }
        }
        if (anchor !== null) {
          const type = event.type as HumanTimeEventType;
          if (pending !== null)
            append(pending.anchor, "superseded", at, type, ordinal);
          pending = append(anchor, "opened", at, type, ordinal);
          lastGate = pending;
        }
        const responseKinds: Record<string, HumanTimeAnchor["type"]> = {
          "approval.plan": "plan_approval",
          "approval.adr": "adr_approval",
          "decision.human": "escalation",
          "decision.consultation.answered": "decision_consultation",
          "review.triaged": "triage",
          "decision.plan_rework": "plan_approval",
          "planning_review.triaged": "planning_review_triage"
        };
        if (event.type === "planning_review.requested") {
          const pr = humanTimeRecord(state.planningReview);
          const episodes = [
            ...(Array.isArray(pr.closed) ? (pr.closed as unknown[]) : []),
            ...(pr.active == null ? [] : [pr.active])
          ].map(humanTimeRecord);
          const episode = episodes.find(
            (e) => e.episodeId === detail.episodeId
          );
          const paths =
            episode === undefined || !Array.isArray(episode.scope)
              ? []
              : (episode.scope as unknown[]).map(
                  (item) => humanTimeRecord(item).path
                );
          if (
            episode === undefined ||
            !Number.isSafeInteger(detail.reviewNumber) ||
            (detail.reviewNumber as number) < 1 ||
            (detail.reviewNumber as number) > Number(episode.reviewNumber) ||
            episode.originGate !== detail.gate ||
            episode.decidedBy !== detail.decidedBy ||
            JSON.stringify(paths) !== JSON.stringify(detail.paths)
          )
            throw new HumanTimeFailure("AMBIGUOUS_ANCHOR");
          if (!["adr_approval", "plan_approval"].includes(String(detail.gate)))
            throw new HumanTimeFailure("AMBIGUOUS_ANCHOR");
          responseKinds[event.type] = detail.gate as
            "adr_approval" | "plan_approval";
        }
        const responseKind =
          typeof event.type === "string"
            ? responseKinds[event.type]
            : undefined;
        if (responseKind !== undefined) {
          const responding = pending ?? lastGate;
          if (
            responding?.kind !== responseKind ||
            (responding.anchor.type === "triage" &&
              detail.reviewIteration !== responding.anchor.reviewIteration)
          )
            throw new HumanTimeFailure("AMBIGUOUS_ANCHOR");
          if (
            event.type === "approval.plan" &&
            (typeof detail.digest !== "string" ||
              !/^[a-f0-9]{64}$/.test(detail.digest))
          )
            throw new HumanTimeFailure("INVALID_EVIDENCE");
          if (
            event.type === "approval.adr" &&
            !["accept", "reject", "rework"].includes(detail.decision as string)
          )
            throw new HumanTimeFailure("INVALID_EVIDENCE");
          if (responding.anchor.type === "planning_review_triage") {
            const answers = (
              Array.isArray(state.humanDecisions) ? state.humanDecisions : []
            )
              .map(humanTimeRecord)
              .filter(
                (d) =>
                  d.kind === "planning_review_triage" &&
                  d.episodeId === detail.episodeId &&
                  d.analysisDigest === detail.analysisDigest
              );
            if (
              answers.length !== 1 ||
              responding.anchor.episodeId !== detail.episodeId ||
              responding.anchor.reviewNumber !== detail.reviewNumber
            )
              throw new HumanTimeFailure("AMBIGUOUS_ANCHOR");
          }
          if (responding.anchor.type === "decision_consultation") {
            const decisions = Array.isArray(state.humanDecisions)
              ? state.humanDecisions.map(humanTimeRecord)
              : [];
            // The durable typed request/answer history corroborates this exact round.
            const requestId = responding.anchor.requestId;
            const roundId = responding.anchor.roundId;
            const answers = decisions.filter(
              (d) =>
                d.kind === "decision_consultation" &&
                d.requestId === requestId &&
                d.roundId === roundId
            );
            if (answers.length !== 1 || detail.completion !== "answered")
              throw new HumanTimeFailure("AMBIGUOUS_ANCHOR");
          }
          append(
            responding.anchor,
            "answered",
            at,
            event.type as HumanTimeEventType,
            ordinal
          );
          pending = null;
        }
        if (event.type === "run.cancelled") {
          if (pending !== null) {
            append(pending.anchor, "cancelled", at, "run.cancelled", ordinal);
            pending = null;
          }
          if (recovery !== null) {
            append(
              recovery.anchor,
              "recovery_ended",
              at,
              "run.cancelled",
              ordinal
            );
            recovery = null;
          }
        }
      }
      if (pending !== null) {
        const expectedStatus = {
          plan_approval: "needs_plan_approval",
          adr_approval: "needs_adr_approval",
          decision_consultation: "needs_human_decision",
          escalation: "needs_human_decision",
          triage: "needs_triage",
          planning_review_triage: "needs_human_decision",
          recovery_wait: "blocked"
        }[pending.kind];
        let matches = state.status === expectedStatus;
        if (pending.anchor.type === "decision_consultation") {
          const request = humanTimeRecord(
            humanTimeRecord(state.pendingHumanDecision).request
          );
          matches &&=
            request.requestId === pending.anchor.requestId &&
            request.roundId === pending.anchor.roundId;
        }
        if (pending.anchor.type === "planning_review_triage") {
          const request = humanTimeRecord(state.pendingHumanDecision);
          matches &&=
            request.kind === "planning_review_triage" &&
            request.episodeId === pending.anchor.episodeId &&
            request.reviewNumber === pending.anchor.reviewNumber;
        }
        if (pending.anchor.type === "triage")
          matches &&=
            humanTimeRecord(state.latestReview).iteration ===
            pending.anchor.reviewIteration;
        if (matches) evidence.pendingKeys.push(pending.episodeKey);
        else
          evidence.issues.push(
            humanTimeIssue("MISSING_EVIDENCE", pending.episodeKey)
          );
      }
      if (recovery !== null && evidence.blocked)
        evidence.pendingKeys.push(recovery.episodeKey);
      if (evidence.observations.length > HUMAN_TIME_LIMITS.observations)
        throw new HumanTimeFailure("LIMIT_EXCEEDED");
      const after = await this.file(
        directory,
        "state.json",
        HUMAN_TIME_LIMITS.bytes
      );
      if (!after.equals(stateBytes)) throw new HumanTimeFailure("CAPTURE_GAP");
      await this.recheck(directories);
      return evidence;
    } catch (error) {
      return emptyHumanTimeEvidence(
        issueCode(
          error,
          missing(error) ? "MISSING_EVIDENCE" : "INVALID_EVIDENCE"
        )
      );
    }
  }
}
