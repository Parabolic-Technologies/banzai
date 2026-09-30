/**
 * Process-boundary sources for the values WorkflowRunner generates
 * (ADR-0052 section 5). The defaults are the system clock and the platform
 * random UUID generator; each identifier keeps its own derivation from the
 * UUID it is given.
 */

/** The current time, read for every timestamp and duration the runner writes. */
export type Clock = () => Date;

/** RFC 4122 version 4 UUID text. */
export type IdSource = () => string;

export interface RunnerSources {
  clock?: Clock;
  ids?: IdSource;
}
