export type CliMode = "interactive" | "help" | "command" | "tty_required";

/**
 * Flags that are valid before or after any command and are never a command
 * themselves. They are removed once, up front, so command routing and every
 * per-command option parser only ever sees its own contract — without this a
 * bare `banzai --verbose` is read as an unknown command.
 */
export const GLOBAL_FLAGS: ReadonlySet<string> = new Set([
  "--quiet",
  "--verbose",
  "--metrics"
]);

export function stripGlobalFlags(args: readonly string[]): string[] {
  return args.filter((argument) => !GLOBAL_FLAGS.has(argument));
}

export function resolveCliMode(
  args: string[],
  inputIsTty: boolean,
  outputIsTty: boolean
): CliMode {
  const command = args[0];
  // These commands own intentionally exact option contracts, so even --help
  // must reach their parser instead of the global help shortcut.
  if (
    command === "doctor" ||
    command === "cancel" ||
    command === "compatibility" ||
    command === "control" ||
    command === "verify" ||
    command === "review" ||
    (command === "approve" && args[1] === "plan") ||
    (command === "approve" && args[1] === "verification")
  ) {
    return "command";
  }
  if (command === "help" || args.includes("--help")) {
    return "help";
  }
  if (command === undefined) {
    return inputIsTty && outputIsTty ? "interactive" : "help";
  }
  if (command === "interactive") {
    return inputIsTty && outputIsTty ? "interactive" : "tty_required";
  }
  return "command";
}
