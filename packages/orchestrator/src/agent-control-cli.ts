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
  RecoverInput,
  WorkflowStatus
} from "./workflow.js";

export type AgentControlCliCommand =
  | { command: "capabilities"; cancellation?: true }
  | { command: "status" }
  | { command: "start"; slug: string }
  | {
      command: "answer";
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
  if (target === "answer" || target === "recover") {
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
    "Control target must be capabilities, status, start, answer, or recover."
  );
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
      : command.command === "answer"
        ? { kind: "answer" as const, value: decodeAgentControlAnswer(input) }
        : {
            kind: "recover" as const,
            value: decodeAgentControlRecovery(input)
          };
  const runner = createRunner();
  if (decoded.kind === "start" && command.command === "start") {
    await runner.start({ slug: command.slug, request: decoded.value.request });
  } else if (decoded.kind === "answer" && command.command === "answer") {
    const answer = decoded.value;
    const current = await runner.status();
    const pending = current.state.pendingHumanDecision ?? null;
    {
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
