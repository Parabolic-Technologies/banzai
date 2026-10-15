import { decodePlanningGateDecision } from "./agent-control.js";
import { parsePlanningReviewTriageAnswer } from "./validation.js";
import { planningReviewScope } from "./workflow/domain/planning-review.js";
import { gateArtifactPaths } from "./workflow/domain/artifact-scope.js";
import type { PlanningReviewTriageAnswer } from "./types.js";
import { BanzaiError } from "./errors.js";
import {
  agentControlCapabilities,
  decodeAgentControlAnswer,
  decodeAgentControlRecovery,
  decodeAgentControlRequest,
  emptyAgentControlStatus,
  MAX_AGENT_CONTROL_INPUT_BYTES,
  projectAgentControlStatus,
  renderAgentControlJson,
  validateAgentControlConsultationAnswers
} from "./agent-control.js";
import type { RunState } from "./types.js";
import type {
  DecisionConsultationInput,
  ConfigurationDecisionInput,
  RecoverInput,
  WorkflowStatus
} from "./workflow.js";

export type AgentControlCliCommand =
  | { command: "capabilities"; cancellation?: true }
  | { command: "decide"; decidedBy: string | null; autoResume: boolean }
  | { command: "status" }
  | { command: "start"; slug: string }
  | {
      command: "answer";
      configurationOnly?: true;
      decidedBy: string | null;
      autoResume: boolean;
    }
  | {
      command: "recover";
      decidedBy: string | null;
      autoResume: boolean;
    };

export interface AgentControlCliIO {
  stdin: AsyncIterable<Uint8Array | string>;
  stdout(value: string): void;
}

export interface AgentControlRunner {
  reworkPlan(input: {
    feedback: string;
    decidedBy: string;
    autoResume?: boolean;
  }): Promise<RunState>;
  requestPlanningReview(input: {
    paths: string[] | null;
    decidedBy: string;
    autoResume?: boolean;
  }): Promise<RunState>;
  answerPlanningReview(input: {
    answer: PlanningReviewTriageAnswer;
    decidedBy: string;
    autoResume?: boolean;
  }): Promise<RunState>;
  decideAdr(input: {
    id: string;
    decision: "accept" | "reject" | "rework";
    note: string | null;
    decidedBy: string;
    autoResume: boolean;
  }): Promise<RunState>;
  status(): Promise<WorkflowStatus>;
  start(input: { slug: string; request: string }): Promise<RunState>;
  answerHumanDecision(
    input: { answers: string[]; decidedBy: string },
    autoResume?: boolean
  ): Promise<RunState>;
  answerDecisionConsultation(
    input: DecisionConsultationInput,
    autoResume?: boolean
  ): Promise<RunState>;
  answerConfigurationPrerequisite(
    input: ConfigurationDecisionInput,
    autoResume?: boolean
  ): Promise<RunState>;
  recover(input: RecoverInput, autoResume?: boolean): Promise<RunState>;
}

function invalidCommand(message: string): BanzaiError {
  return new BanzaiError("INVALID_CONTROL_COMMAND", message);
}

export function parseAgentControlArgs(
  args: readonly string[]
): AgentControlCliCommand {
  const target = args[0];
  if (
    target === "capabilities" &&
    args.length === 2 &&
    args[1] === "--cancellation"
  ) {
    return { command: "capabilities", cancellation: true };
  }
  if (target === "capabilities" && args.length === 1) {
    return { command: "capabilities" };
  }
  if (target === "status" && args.length === 1) {
    return { command: "status" };
  }
  if (target === "start") {
    if (
      args.length !== 3 ||
      args[1] !== "--slug" ||
      args[2] === undefined ||
      args[2].trim().length === 0 ||
      args[2].startsWith("--")
    ) {
      throw invalidCommand(
        "Control start requires exactly `start --slug <kebab-case-slug>`."
      );
    }
    return { command: "start", slug: args[2] };
  }
  if (target === "answer" || target === "recover" || target === "decide") {
    let decidedBy: string | null = null;
    let autoResume = true;
    let noResumeSeen = false;
    for (let index = 1; index < args.length; index += 1) {
      const argument = args[index];
      if (argument === "--no-resume") {
        if (noResumeSeen) {
          throw invalidCommand(
            `Control ${target} option --no-resume may be specified only once.`
          );
        }
        noResumeSeen = true;
        autoResume = false;
        continue;
      }
      if (argument === "--by") {
        if (decidedBy !== null) {
          throw invalidCommand(
            `Control ${target} option --by may be specified only once.`
          );
        }
        const value = args[index + 1];
        if (
          value === undefined ||
          value.startsWith("--") ||
          value.trim().length === 0
        ) {
          throw invalidCommand(
            `Control ${target} option --by requires a value.`
          );
        }
        decidedBy = value;
        index += 1;
        continue;
      }
      throw invalidCommand(`Control ${target} received an unknown option.`);
    }
    return { command: target, decidedBy, autoResume };
  }
  throw invalidCommand(
    "Control target must be capabilities, status, start, answer, decide, or recover."
  );
}

export function parseVerificationApprovalArgs(
  args: readonly string[]
): Extract<AgentControlCliCommand, { command: "answer" }> {
  const parsed = parseAgentControlArgs(["answer", ...args]);
  if (parsed.command !== "answer")
    throw invalidCommand("Invalid verification approval.");
  return { ...parsed, configurationOnly: true };
}

async function readControlInput(
  source: AsyncIterable<Uint8Array | string>
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of source) {
    const value =
      typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    total += value.byteLength;
    if (total > MAX_AGENT_CONTROL_INPUT_BYTES) {
      throw new BanzaiError(
        "CONTROL_INPUT_TOO_LARGE",
        `Agent control input exceeds ${MAX_AGENT_CONTROL_INPUT_BYTES} bytes.`
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

async function statusDocument(
  runner: AgentControlRunner
): Promise<ReturnType<typeof projectAgentControlStatus>> {
  try {
    return projectAgentControlStatus(await runner.status());
  } catch (error) {
    if (error instanceof BanzaiError && error.code === "NO_ACTIVE_RUN") {
      return emptyAgentControlStatus();
    }
    throw error;
  }
}

export function executeAgentControlCapabilities(io: AgentControlCliIO): void {
  io.stdout(renderAgentControlJson(agentControlCapabilities()));
}

export async function executeAgentControlCommand(
  command: Exclude<AgentControlCliCommand, { command: "capabilities" }>,
  createRunner: () => AgentControlRunner,
  io: AgentControlCliIO,
  defaultDecisionMaker: string
): Promise<void> {
  if (command.command === "status") {
    const runner = createRunner();
    io.stdout(renderAgentControlJson(await statusDocument(runner)));
    return;
  }
  const input = await readControlInput(io.stdin);
  const decoded =
    command.command === "start"
      ? { kind: "start" as const, value: decodeAgentControlRequest(input) }
      : command.command === "decide"
        ? { kind: "decide" as const, value: decodePlanningGateDecision(input) }
        : command.command === "answer"
          ? { kind: "answer" as const, value: decodeAgentControlAnswer(input) }
          : {
              kind: "recover" as const,
              value: decodeAgentControlRecovery(input)
            };
  const runner = createRunner();
  if (decoded.kind === "start" && command.command === "start") {
    await runner.start({ slug: command.slug, request: decoded.value.request });
  } else if (decoded.kind === "decide" && command.command === "decide") {
    const doc = decoded.value;
    const current = await runner.status();
    if (
      current.state.runId !== doc.runId ||
      current.state.status !== `needs_${doc.gate}` ||
      current.state.activeAttempt !== null ||
      current.state.activeProcess !== null
    )
      throw new BanzaiError(
        "INVALID_CONTROL_INPUT",
        "Gate decision does not match the active idle gate."
      );
    const by = command.decidedBy ?? defaultDecisionMaker;
    if (doc.decision === "review") {
      if (current.state.schemaVersion !== 10)
        throw new BanzaiError(
          "INVALID_CONTROL_INPUT",
          "Historical runs do not support planning review."
        );
      try {
        planningReviewScope(
          gateArtifactPaths(current.state, doc.gate),
          doc.paths
        );
      } catch {
        throw new BanzaiError(
          "INVALID_CONTROL_INPUT",
          "Review scope is outside the current gate artifacts."
        );
      }
      await runner.requestPlanningReview({
        paths: doc.paths,
        decidedBy: by,
        autoResume: command.autoResume
      });
    } else if (doc.gate === "plan_approval") {
      if (current.state.schemaVersion !== 10)
        throw new BanzaiError(
          "INVALID_CONTROL_INPUT",
          "Historical runs do not support plan rework."
        );
      await runner.reworkPlan({
        feedback: doc.feedback ?? "",
        decidedBy: by,
        autoResume: command.autoResume
      });
    } else {
      const ids = projectAgentControlStatus(current).activeRun?.pendingGate;
      if (
        ids?.kind !== "adr_approval" ||
        doc.adrId === null ||
        !ids.adrIds.includes(doc.adrId)
      )
        throw new BanzaiError(
          "INVALID_CONTROL_INPUT",
          "ADR id is outside the pending gate."
        );
      await runner.decideAdr({
        id: doc.adrId,
        decision: "rework",
        note: doc.feedback,
        decidedBy: by,
        autoResume: command.autoResume
      });
    }
  } else if (decoded.kind === "answer" && command.command === "answer") {
    const answer = decoded.value;
    if (
      command.configurationOnly === true &&
      answer.schema !== "banzai-agent-answer/v3"
    )
      throw new BanzaiError(
        "CONTROL_SCHEMA_UNSUPPORTED",
        "Approve verification requires a configuration answer v3 document; it does not imply Accept."
      );
    const current = await runner.status();
    const pending = current.state.pendingHumanDecision ?? null;
    if (answer.schema === "banzai-agent-answer/v4") {
      if (pending?.kind !== "planning_review_triage")
        throw new BanzaiError(
          "INVALID_CONTROL_INPUT",
          "Planning-review triage is not pending."
        );
      const value = {
        runId: answer.runId,
        episodeId: answer.episodeId,
        reviewNumber: answer.reviewNumber,
        analysisDigest: answer.analysisDigest,
        dispositions: answer.dispositions,
        additionalInstruction: answer.additionalInstruction
      };
      const parsed = parsePlanningReviewTriageAnswer(
        value,
        { ...pending, entries: pending.analysis },
        "INVALID_CONTROL_INPUT"
      );
      await runner.answerPlanningReview({
        answer: parsed,
        decidedBy: command.decidedBy ?? defaultDecisionMaker,
        autoResume: command.autoResume
      });
    } else if (answer.schema === "banzai-agent-answer/v3") {
      if (
        pending?.kind !== "configuration_prerequisite" ||
        current.state.runId !== answer.runId ||
        pending.decisionId !== answer.decisionId ||
        pending.proposalId !== answer.proposalId
      )
        throw new BanzaiError(
          "INVALID_CONTROL_INPUT",
          "The configuration answer must match the current run, decision and proposal."
        );
      await runner.answerConfigurationPrerequisite(
        {
          runId: answer.runId,
          decisionId: answer.decisionId,
          proposalId: answer.proposalId,
          action: answer.action,
          ...(answer.profile ? { profile: answer.profile } : {}),
          decidedBy: command.decidedBy ?? defaultDecisionMaker
        },
        command.autoResume
      );
    } else if (answer.schema === "banzai-agent-answer/v1") {
      if (
        pending?.kind === "decision_consultation" ||
        pending?.kind === "configuration_prerequisite" ||
        pending?.kind === "planning_review_triage"
      ) {
        throw new BanzaiError(
          "CONTROL_SCHEMA_UNSUPPORTED",
          "Agent answer v1 cannot answer a consultation or configuration prerequisite."
        );
      }
      await runner.answerHumanDecision(
        {
          answers: answer.answers,
          decidedBy: command.decidedBy ?? defaultDecisionMaker
        },
        command.autoResume
      );
    } else {
      if (
        pending?.kind !== "decision_consultation" ||
        current.state.runId !== answer.runId ||
        pending.request.requestId !== answer.requestId ||
        pending.request.roundId !== answer.roundId
      ) {
        throw new BanzaiError(
          "INVALID_CONTROL_INPUT",
          "Agent consultation answer does not match the active run, request, and round."
        );
      }
      const answers = validateAgentControlConsultationAnswers(
        answer.answers,
        pending.request
      );
      await runner.answerDecisionConsultation(
        {
          runId: answer.runId,
          requestId: answer.requestId,
          roundId: answer.roundId,
          answers,
          decidedBy: command.decidedBy ?? defaultDecisionMaker
        },
        command.autoResume
      );
    }
  } else if (decoded.kind === "recover" && command.command === "recover") {
    const recovery = decoded.value;
    await runner.recover(
      {
        attemptId: recovery.attemptId,
        recoveryIdentity: recovery.recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: command.decidedBy ?? defaultDecisionMaker
      },
      command.autoResume
    );
  } else {
    throw invalidCommand(
      "Control command decoding produced a mismatched operation."
    );
  }
  io.stdout(renderAgentControlJson(await statusDocument(runner)));
}
