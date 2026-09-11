import process from "node:process";
import { stripVTControlCharacters } from "node:util";
import {
  createPrompt,
  isBackspaceKey,
  isEnterKey,
  makeTheme,
  useEffect,
  useKeypress,
  usePrefix,
  useRef,
  useState,
  type KeypressEvent,
  type Status
} from "@inquirer/core";
import {
  confirm as confirmPrompt,
  input as inputPrompt,
  select as selectPrompt
} from "@inquirer/prompts";
import type {
  InteractiveChoice,
  InteractiveIO,
  InteractiveInput
} from "./interactive.js";

const BRACKETED_PASTE_ENABLE = "\u001B[?2004h";
const BRACKETED_PASTE_DISABLE = "\u001B[?2004l";
const COLLAPSE_CHARACTER_THRESHOLD = 800;
const PREVIEW_CHARACTER_LIMIT = 4000;
const PASTE_MARKER_PATTERN = /\[Pasted text #\d+(?: \+\d+ lines)?\]/g;
const TERMINAL_CONTROL_PATTERN = /[\u0000-\u001F\u007F-\u009F]/;

interface CollapsedPasteConfig {
  message: string;
  default?: string;
  validate?: (value: string) => true | string | Promise<true | string>;
}

interface PasteBlock {
  id: number;
  marker: string;
  content: string;
  expanded: boolean;
}

interface PasteCapture {
  content: string;
  line: string;
  cursor: number;
}

interface PasteCompletion {
  line: string;
  cursor: number;
  pastes: PasteBlock[];
}

interface PromptReadline {
  line: string;
  cursor?: number;
  output: {
    mute(): void;
    unmute(): void;
    write(value: string): unknown;
  };
}

type TerminalKeypressEvent = KeypressEvent & {
  name?: string;
  sequence?: string;
};

function cursorPosition(readline: PromptReadline): number {
  return readline.cursor ?? readline.line.length;
}

function replaceReadlineLine(
  readline: PromptReadline,
  line: string,
  cursor = line.length
): void {
  readline.line = line;
  readline.cursor = cursor;
}

function writeTerminalControl(readline: PromptReadline, value: string): void {
  readline.output.unmute();
  readline.output.write(value);
  readline.output.mute();
}

function normalizedPasteContent(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

function additionalLineCount(content: string): number {
  return content.split("\n").length - 1;
}

function pasteMarker(id: number, content: string): string {
  const additionalLines = additionalLineCount(content);
  return additionalLines === 0
    ? `[Pasted text #${id}]`
    : `[Pasted text #${id} +${additionalLines} lines]`;
}

function shouldCollapsePaste(content: string): boolean {
  return (
    content.includes("\n") ||
    content.length > COLLAPSE_CHARACTER_THRESHOLD ||
    TERMINAL_CONTROL_PATTERN.test(content)
  );
}

function insertAt(
  line: string,
  cursor: number,
  value: string
): { line: string; cursor: number } {
  return {
    line: `${line.slice(0, cursor)}${value}${line.slice(cursor)}`,
    cursor: cursor + value.length
  };
}

function replacePasteMarkers(
  line: string,
  pastes: readonly PasteBlock[],
  replacement: (paste: PasteBlock) => string
): string {
  const blocks = new Map(pastes.map((paste) => [paste.marker, paste]));
  return line.replace(PASTE_MARKER_PATTERN, (marker) => {
    const paste = blocks.get(marker);
    return paste === undefined ? marker : replacement(paste);
  });
}

function expandedValue(line: string, pastes: readonly PasteBlock[]): string {
  return replacePasteMarkers(line, pastes, (paste) => paste.content);
}

function renderComposerLine(
  line: string,
  pastes: readonly PasteBlock[],
  highlight: (value: string) => string
): string {
  return replacePasteMarkers(line, pastes, (paste) => highlight(paste.marker));
}

function safePreview(content: string): string {
  const visible = stripVTControlCharacters(content).replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g,
    "�"
  );
  if (visible.length <= PREVIEW_CHARACTER_LIMIT) {
    return visible;
  }
  return `${visible.slice(0, PREVIEW_CHARACTER_LIMIT)}\n… preview truncated; full pasted text will be submitted`;
}

function completePaste(
  capture: PasteCapture,
  pastes: readonly PasteBlock[]
): PasteCompletion {
  const content = normalizedPasteContent(capture.content);
  const latest = pastes.at(-1);
  if (
    latest !== undefined &&
    !latest.expanded &&
    latest.content === content &&
    capture.line.slice(
      capture.cursor - latest.marker.length,
      capture.cursor
    ) === latest.marker
  ) {
    return {
      line: capture.line,
      cursor: capture.cursor,
      pastes: pastes.map((paste) =>
        paste.id === latest.id ? { ...paste, expanded: true } : paste
      )
    };
  }

  if (!shouldCollapsePaste(content)) {
    const inserted = insertAt(capture.line, capture.cursor, content);
    return { ...inserted, pastes: [...pastes] };
  }

  const id = (latest?.id ?? 0) + 1;
  const marker = pasteMarker(id, content);
  const inserted = insertAt(capture.line, capture.cursor, marker);
  return {
    ...inserted,
    pastes: [...pastes, { id, marker, content, expanded: false }]
  };
}

function pasteContentFromKey(key: TerminalKeypressEvent): string {
  if (isEnterKey(key)) {
    return "\n";
  }
  return key.sequence ?? "";
}

function blockEndingAtCursor(
  line: string,
  cursor: number,
  pastes: readonly PasteBlock[]
): PasteBlock | undefined {
  return pastes.find(
    (paste) => line.slice(cursor - paste.marker.length, cursor) === paste.marker
  );
}

function markersRemainIntact(
  line: string,
  pastes: readonly PasteBlock[]
): boolean {
  return pastes.every((paste) => line.includes(paste.marker));
}

export const collapsedPastePrompt = createPrompt<string, CollapsedPasteConfig>(
  (config, done) => {
    const theme = makeTheme<object>();
    const [status, setStatus] = useState<Status>("idle");
    const [line, setLine] = useState(config.default ?? "");
    const [pastes, setPastes] = useState<PasteBlock[]>([]);
    const [error, setError] = useState<string>();
    const prefix = usePrefix({ status, theme });
    const lineRef = useRef(line);
    const pastesRef = useRef(pastes);
    const cursorRef = useRef(line.length);
    const captureRef = useRef<PasteCapture>();
    lineRef.current = line;
    pastesRef.current = pastes;

    useEffect((readline) => {
      const promptReadline: PromptReadline = readline;
      replaceReadlineLine(promptReadline, lineRef.current);
      cursorRef.current = lineRef.current.length;
      try {
        writeTerminalControl(promptReadline, BRACKETED_PASTE_ENABLE);
      } catch (error) {
        try {
          writeTerminalControl(promptReadline, BRACKETED_PASTE_DISABLE);
        } catch {
          // Preserve the original enable failure; neither write can be recovered.
        }
        throw error;
      }
      return () => {
        writeTerminalControl(promptReadline, BRACKETED_PASTE_DISABLE);
      };
    }, []);

    useKeypress(async (event, readline) => {
      if (status !== "idle") {
        return;
      }
      const key: TerminalKeypressEvent = event;
      const promptReadline: PromptReadline = readline;

      if (key.name === "paste-start" && captureRef.current === undefined) {
        captureRef.current = {
          content: "",
          line: lineRef.current,
          cursor: cursorRef.current
        };
        replaceReadlineLine(promptReadline, lineRef.current, cursorRef.current);
        return;
      }

      const capture = captureRef.current;
      if (capture !== undefined && key.name !== "paste-end") {
        capture.content += pasteContentFromKey(key);
        replaceReadlineLine(promptReadline, capture.line, capture.cursor);
        return;
      }

      if (key.name === "paste-end") {
        if (capture === undefined || capture.content.length === 0) {
          captureRef.current = undefined;
          replaceReadlineLine(
            promptReadline,
            lineRef.current,
            cursorRef.current
          );
          return;
        }
        const completed = completePaste(capture, pastesRef.current);
        captureRef.current = undefined;
        lineRef.current = completed.line;
        pastesRef.current = completed.pastes;
        cursorRef.current = completed.cursor;
        replaceReadlineLine(promptReadline, completed.line, completed.cursor);
        setPastes(completed.pastes);
        setLine(completed.line);
        setError(undefined);
        return;
      }

      if (isEnterKey(key)) {
        const answerLine =
          lineRef.current.length === 0
            ? (config.default ?? "")
            : lineRef.current;
        const answer = expandedValue(answerLine, pastesRef.current);
        setStatus("loading");
        const validation =
          config.validate === undefined ? true : await config.validate(answer);
        if (validation === true) {
          setError(undefined);
          setStatus("done");
          done(answer);
        } else {
          replaceReadlineLine(
            promptReadline,
            lineRef.current,
            cursorRef.current
          );
          setError(validation);
          setStatus("idle");
        }
        return;
      }

      if (isBackspaceKey(key)) {
        const removed = blockEndingAtCursor(
          lineRef.current,
          cursorRef.current,
          pastesRef.current
        );
        if (removed !== undefined) {
          const start = cursorRef.current - removed.marker.length;
          const nextLine = `${lineRef.current.slice(0, start)}${lineRef.current.slice(cursorRef.current)}`;
          const nextPastes = pastesRef.current.filter(
            (paste) => paste.id !== removed.id
          );
          lineRef.current = nextLine;
          pastesRef.current = nextPastes;
          cursorRef.current = start;
          replaceReadlineLine(promptReadline, nextLine, start);
          setPastes(nextPastes);
          setLine(nextLine);
          setError(undefined);
          return;
        }
      }

      if (!markersRemainIntact(promptReadline.line, pastesRef.current)) {
        replaceReadlineLine(promptReadline, lineRef.current, cursorRef.current);
        setError(
          "Pasted text is atomic; move to its end and press Backspace to remove it."
        );
        return;
      }

      lineRef.current = promptReadline.line;
      cursorRef.current = cursorPosition(promptReadline);
      setLine(promptReadline.line);
      setError(undefined);
    });

    const message = theme.style.message(config.message, status);
    const renderedLine = renderComposerLine(
      line,
      pastes,
      status === "done" ? theme.style.answer : theme.style.highlight
    );
    const defaultValue =
      status === "idle" && line.length === 0 && config.default !== undefined
        ? theme.style.defaultAnswer(config.default)
        : undefined;
    const activePaste = pastes.at(-1);
    let pasteHelp: string | undefined;
    if (activePaste !== undefined) {
      pasteHelp = activePaste.expanded
        ? `${theme.style.help(`Pasted text #${activePaste.id} preview; exact text will be submitted`)}\n${safePreview(activePaste.content)}`
        : theme.style.help("paste again to expand");
    }
    const bottom = [
      error === undefined ? undefined : theme.style.error(error),
      pasteHelp
    ]
      .filter((value): value is string => value !== undefined)
      .join("\n");

    return [
      [prefix, message, defaultValue, renderedLine]
        .filter((value): value is string => value !== undefined)
        .join(" "),
      bottom.length === 0 ? undefined : bottom
    ];
  }
);

export class InquirerInteractiveIO implements InteractiveIO {
  /** Read per access so a resize between prompts is picked up. */
  get width(): number | undefined {
    return process.stdout.columns;
  }

  async input(options: InteractiveInput): Promise<string> {
    if (options.collapsedPaste === true) {
      return await collapsedPastePrompt({
        message: options.message,
        ...(options.defaultValue === undefined
          ? {}
          : { default: options.defaultValue }),
        ...(options.validate === undefined
          ? {}
          : { validate: options.validate })
      });
    }
    return await inputPrompt({
      message: options.message,
      ...(options.defaultValue === undefined
        ? {}
        : { default: options.defaultValue }),
      ...(options.validate === undefined ? {} : { validate: options.validate })
    });
  }

  async select<T>(
    message: string,
    choices: readonly InteractiveChoice<T>[],
    signal?: AbortSignal
  ): Promise<T> {
    return await selectPrompt<T>(
      {
        message,
        choices: choices.map((choice) => ({
          name: choice.name,
          value: choice.value,
          ...(choice.disabled === undefined
            ? {}
            : { disabled: choice.disabled }),
          ...(choice.description === undefined
            ? {}
            : { description: choice.description })
        }))
      },
      signal === undefined ? undefined : { signal }
    );
  }

  async confirm(message: string, defaultValue = false): Promise<boolean> {
    return await confirmPrompt({ message, default: defaultValue });
  }

  writeLine(message = ""): void {
    console.log(message);
  }
}
