/**
 * Terminal styling, isolated so every surface makes one decision about colour
 * and every caller can be tested with styling forced off. A disabled styler is
 * the identity function, so piped and redirected output stays byte-identical to
 * the unstyled form.
 */

/**
 * Declared as function properties rather than methods: these are pure and are
 * routinely passed by reference, so they must never capture a `this`.
 */
export interface Styler {
  readonly enabled: boolean;
  readonly bold: (value: string) => string;
  readonly dim: (value: string) => string;
  readonly red: (value: string) => string;
  readonly green: (value: string) => string;
  readonly yellow: (value: string) => string;
  readonly cyan: (value: string) => string;
  /** Brand vermilion for the launch title; degrades with the colour depth. */
  readonly brand: (value: string) => string;
}

/** Bits per colour the terminal takes: 16 colours, 256 colours, or 24-bit. */
export type ColorDepth = 4 | 8 | 24;

const ESC = "\u001b[";
const RESET = `${ESC}0m`;

function code(open: number | string): (value: string) => string {
  const prefix = `${ESC}${open}m`;
  return (value) => `${prefix}${value}${RESET}`;
}

/**
 * Banzai vermilion, #FF5A3C. Index 203 is the nearest 256-colour cube entry
 * (#FF5F5F); bright red is the only basic colour in the same family.
 */
const BRAND: Record<ColorDepth, string> = {
  24: "38;2;255;90;60",
  8: "38;5;203",
  4: "91"
};

const PLAIN = (value: string): string => value;

function enabledStyler(depth: ColorDepth): Styler {
  return {
    enabled: true,
    bold: code(1),
    dim: code(2),
    red: code(31),
    green: code(32),
    yellow: code(33),
    cyan: code(36),
    brand: code(BRAND[depth])
  };
}

const DISABLED: Styler = {
  enabled: false,
  bold: PLAIN,
  dim: PLAIN,
  red: PLAIN,
  green: PLAIN,
  yellow: PLAIN,
  cyan: PLAIN,
  brand: PLAIN
};

export function createStyler(enabled: boolean, depth: ColorDepth = 4): Styler {
  return enabled ? enabledStyler(depth) : DISABLED;
}

/**
 * How many colours the terminal advertises. `FORCE_COLOR=3` and `2` follow the
 * chalk convention for 24-bit and 256 colours; otherwise `COLORTERM` names true
 * colour, and a `direct` or `256color` `TERM` names its depth. Whether colour
 * is on at all is `colorEnabled`'s decision, not this one.
 */
export function colorDepth(env: NodeJS.ProcessEnv): ColorDepth {
  const forced = env.FORCE_COLOR;
  if (forced === "3") {
    return 24;
  }
  if (forced === "2") {
    return 8;
  }
  const colorterm = (env.COLORTERM ?? "").toLowerCase();
  if (colorterm === "truecolor" || colorterm === "24bit") {
    return 24;
  }
  const term = (env.TERM ?? "").toLowerCase();
  if (term.includes("direct")) {
    return 24;
  }
  if (term.includes("256color")) {
    return 8;
  }
  return 4;
}

/**
 * Honours the `NO_COLOR` convention and `TERM=dumb` before falling back to
 * whether the stream is a terminal at all. `FORCE_COLOR` wins over every
 * negative signal except an explicit `FORCE_COLOR=0`, so a demo or a recording
 * can opt in from a pipe.
 */
export function colorEnabled(
  stream: { isTTY?: boolean | undefined },
  env: NodeJS.ProcessEnv
): boolean {
  const forced = env.FORCE_COLOR;
  if (forced !== undefined && forced !== "" && forced !== "0") {
    return true;
  }
  if (forced === "0") {
    return false;
  }
  const noColor = env.NO_COLOR;
  if (noColor !== undefined && noColor !== "") {
    return false;
  }
  if (env.TERM === "dumb") {
    return false;
  }
  return stream.isTTY === true;
}
