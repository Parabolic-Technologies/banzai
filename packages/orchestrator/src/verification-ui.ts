import type { InteractiveIO } from "./interactive.js";
import type { RunState, VerificationCommand } from "./types.js";
import type {
  TaskVerificationAttempt,
  TaskVerificationDescriptor
} from "./verification-evidence.js";
import { escapeTerminalText, formatDuration } from "./format.js";
import {
  attemptOutcomeText,
  hasCommandOutput
} from "./verification-outcome.js";
import type {
  VerificationOutputTail,
  VerificationOutputTails
} from "./verification-output.js";
import {
  configurationText,
  type ConfigurationPrerequisiteRequest
} from "./configuration-prerequisite.js";

/**
 * Canonical task-outcome projection for CLI and interactive status. Lines are
 * preformatted: indentation and output lines are meaningful, so renderers must
 * not rewrap them. Output tails come from the caller because reading logs is
 * I/O; without them the details still name every log path.
 */
export function taskVerificationStatusLines(
  state: RunState,
  tails: VerificationOutputTails = new Map()
): string[] {
  if (state.verificationMode !== "task") return [];
  const publication = state.taskVerification;
  const application = publication?.applicability;
  if (!publication || !application)
    return [
      state.status === "blocked" && state.blockedFrom === "verifying"
        ? "Verification: unavailable. See the blocked prerequisite."
        : "Verification: not run"
    ];
  if (application.outcome === "absent") return ["Verification: absent"];
  const label = (kind: string): string =>
    kind === "reused" ? "passed" : kind.replaceAll("_", " ");
  const kinds = application.dispositions.map((item) => item.kind);
  const outcome =
    ["unavailable", "timed_out", "interrupted", "failed", "not_run"].find(
      (kind) => kinds.some((value) => value === kind)
    ) ?? (application.complete && kinds.length > 0 ? "passed" : "not_run");
  return [
    `Verification: ${label(outcome)}`,
    ...application.dispositions.flatMap((item) => {
      const attempt = publication.attempts.find(
        (entry) => entry.id === item.attemptId
      );
      const descriptor = publication.decision.checks.find(
        (entry) => entry.descriptor.id === item.checkId
      )?.descriptor;
      return [
        escapeTerminalText(
          `  ${item.checkId} (${item.required ? "required" : "supplemental"}): ${label(item.kind)}${item.kind === "reused" ? " (reused evidence)" : ""}${item.kind === "unavailable" ? `. ${item.reason}` : ""}`
        ),
        ...(attempt === undefined ||
        descriptor === undefined ||
        attempt.status === "completed"
          ? []
          : failureDetailLines(attempt, descriptor, tails.get(attempt.id)))
      ];
    })
  ];
}

function failureDetailLines(
  attempt: TaskVerificationAttempt,
  descriptor: TaskVerificationDescriptor,
  tail: VerificationOutputTail | null | undefined
): string[] {
  const facts = [
    `failure category: ${attempt.failureCategory ?? "none"}`,
    attempt.durationMs === null
      ? "duration unknown"
      : `duration ${formatDuration(attempt.durationMs)}`,
    `timeout ${formatDuration(descriptor.timeoutMs)}`
  ];
  const logs = [
    ["stderr", attempt.stderr],
    ["stdout", attempt.stdout]
  ] as const;
  return [
    ...[
      `Command: ${[descriptor.command, ...descriptor.args].map(shellWord).join(" ")}`,
      `Directory: ${descriptor.cwd}`,
      `Result: ${attemptOutcomeText(attempt, descriptor.timeoutMs)}`,
      `Details: ${facts.join(" · ")}`
    ].map((line) => escapeTerminalText(`    ${line}`)),
    ...outputLines(attempt, tail),
    ...logs.flatMap(([stream, reference]) =>
      reference === null
        ? []
        : [escapeTerminalText(`    ${stream} log: ${reference.relativePath}`)]
    )
  ];
}

function outputLines(
  attempt: TaskVerificationAttempt,
  tail: VerificationOutputTail | null | undefined
): string[] {
  if (!hasCommandOutput(attempt) || tail === undefined) return [];
  if (tail === null) return ["    Output: the log could not be read."];
  if (tail.lines.length === 0) return ["    Output: none."];
  return [
    `    ${tail.stream}, ${tail.truncated ? `last ${tail.lines.length} lines` : `${tail.lines.length} line${tail.lines.length === 1 ? "" : "s"}`}:`,
    // Tail lines are already redacted, stripped and escaped by their reader.
    ...tail.lines.map((line) => `      | ${line}`)
  ];
}

/** Quotes an argv word only when a POSIX shell would split or expand it. */
function shellWord(word: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/u.test(word)
    ? word
    : `'${word.replaceAll("'", "'\\''")}'`;
}

export function verificationCommandLines(
  commands: readonly VerificationCommand[]
): string[] {
  if (commands.length === 0)
    return ["No commands. Edit this draft before accepting it."];
  return commands.map((command, index) =>
    escapeTerminalText(
      `${index + 1}. ${JSON.stringify(command.name)}: ${[command.command, ...command.args].map((arg) => JSON.stringify(arg)).join(" ")} (timeout ${command.timeoutMs} ms)${command.id ? ` [${JSON.stringify(command.id)}]` : ""}`
    )
  );
}

export function configurationDecisionLines(
  request: ConfigurationPrerequisiteRequest,
  presentation?: { repairCommands: string[]; acceptUnavailable?: string }
): string[] {
  return [
    "Configuration decision pending.",
    `Decision needed: verification configuration for ${request.proposal.projectType} (${request.reason}).`,
    `Proposal ${request.proposalId}: add profile ${request.proposal.profile.id}`,
    ...verificationCommandLines(request.proposal.profile.commands),
    `Source: ${request.proposal.source.kind}`,
    "Next: choose Accept, Edit, Skip or Cancel in the interactive session, or submit the current structured answer with banzai approve verification.",
    ...(presentation?.acceptUnavailable
      ? [
          `Accept unavailable: ${escapeTerminalText(presentation.acceptUnavailable)}`
        ]
      : []),
    ...(presentation?.repairCommands.map(
      (command) => `Repair: ${escapeTerminalText(command)}`
    ) ?? []),
    "Alternative: Fix prerequisites, then run banzai resume. Exit the owning session before using banzai verify add/edit/remove from another terminal.",
    `The completed ${request.continuation.attemptKind} attempt and current plan approval are retained.`
  ];
}

function textValidator(
  maximum: number,
  empty = false
): (value: string) => true | string {
  return (value) => {
    try {
      configurationText(value, maximum, empty);
      return true;
    } catch {
      return `Enter ${empty ? "" : "non-empty "}text without control characters, up to ${maximum} characters.`;
    }
  };
}

async function editCommand(
  io: InteractiveIO,
  prior?: VerificationCommand
): Promise<VerificationCommand> {
  const name = await io.input({
    message: "Command name",
    ...(prior ? { defaultValue: prior.name } : {}),
    validate: textValidator(200)
  });
  const command = await io.input({
    message: "Executable (one program, without shell syntax)",
    ...(prior ? { defaultValue: prior.command } : {}),
    validate: textValidator(500)
  });
  const args = [...(prior?.args ?? [])];
  for (;;) {
    const selected = await io.select<number | "add" | "done">(
      "Arguments (each item is passed literally)",
      [
        ...args.map((value, index) => ({
          name: escapeTerminalText(`${index + 1}. ${JSON.stringify(value)}`),
          value: index
        })),
        {
          name: "Add argument",
          value: "add" as const,
          ...(args.length >= 200 ? { disabled: "Maximum 200 arguments" } : {})
        },
        { name: "Done editing arguments", value: "done" as const }
      ]
    );
    if (selected === "done") break;
    if (selected === "add")
      args.push(
        await io.input({
          message: "Argument",
          validate: textValidator(4096, true)
        })
      );
    else {
      const action = await io.select("Argument action", [
        { name: "Edit", value: "edit" },
        { name: "Remove", value: "remove" }
      ]);
      if (action === "remove") args.splice(selected, 1);
      else
        args[selected] = await io.input({
          message: "Argument",
          defaultValue: args[selected] ?? "",
          validate: textValidator(4096, true)
        });
    }
  }
  const timeoutMs = Number(
    await io.input({
      message: "Timeout in milliseconds",
      defaultValue: String(prior?.timeoutMs ?? 300000),
      validate: (value) =>
        /^\d+$/u.test(value) &&
        Number.isSafeInteger(Number(value)) &&
        Number(value) > 0 &&
        Number(value) <= 86400000
          ? true
          : "Enter an integer from 1 to 86400000."
    })
  );
  return {
    ...(prior?.id ? { id: prior.id } : {}),
    name,
    command,
    args,
    timeoutMs
  };
}

/** Inputs deliberately exclude policy fields; only the runner reconciles identities. */
export async function editVerificationCommands(
  io: InteractiveIO,
  initial: readonly VerificationCommand[],
  origins?: (number | null)[]
): Promise<VerificationCommand[]> {
  const commands = initial.map(({ id, name, command, args, timeoutMs }) => ({
    ...(id ? { id } : {}),
    name,
    command,
    args: [...args],
    timeoutMs
  }));
  for (;;) {
    for (const line of verificationCommandLines(commands)) io.writeLine(line);
    const selected = await io.select<number | "add" | "done">(
      "Profile commands",
      [
        ...commands.map((command, index) => ({
          name: escapeTerminalText(`${index + 1}. ${command.name}`),
          value: index
        })),
        {
          name: "Add command",
          value: "add" as const,
          ...(commands.length >= 200
            ? { disabled: "Maximum 200 commands" }
            : {})
        },
        { name: "Done editing profile", value: "done" as const }
      ]
    );
    if (selected === "done") return commands;
    if (selected === "add") {
      commands.push(await editCommand(io));
      origins?.push(null);
    } else {
      const action = await io.select("Command action", [
        { name: "Edit", value: "edit" },
        { name: "Remove", value: "remove" },
        { name: "Move up", value: "up" }
      ]);
      if (action === "remove") {
        commands.splice(selected, 1);
        origins?.splice(selected, 1);
      } else if (action === "up" && selected > 0) {
        const [item] = commands.splice(selected, 1);
        if (item) commands.splice(selected - 1, 0, item);
        if (origins) {
          const [origin] = origins.splice(selected, 1);
          origins.splice(selected - 1, 0, origin ?? null);
        }
      } else if (action === "edit")
        commands[selected] = await editCommand(io, commands[selected]);
    }
  }
}
