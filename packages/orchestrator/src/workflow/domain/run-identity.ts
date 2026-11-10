import { BanzaiError } from "../../errors.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The shared work-directory bound, prefix included. */
export const MAX_WORK_SLUG_LENGTH = 100;

export type WorkSlugProblem = "format" | "length";

export function runId(slug: string, at: string, uuid: string): string {
  const timestamp = at.replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${timestamp}-${slug}-${uuid.slice(0, 8)}`;
}

export function requireSlug(slug: string): void {
  if (!SLUG.test(slug)) {
    throw new BanzaiError(
      "INVALID_SLUG",
      "Feature slug must be lowercase kebab-case."
    );
  }
}

/**
 * The `yymmdd-` prefix of new work and initiative directories (ADR-0066). It
 * reads the local calendar date of the supplied instant, so callers own the
 * clock and tests stay deterministic.
 */
export function workSlugDatePrefix(at: Date): string {
  const twoDigits = (value: number): string => String(value).padStart(2, "0");
  return `${twoDigits(at.getFullYear() % 100)}${twoDigits(
    at.getMonth() + 1
  )}${twoDigits(at.getDate())}-`;
}

/**
 * Only the current date's prefix counts as present; another leading date is
 * part of the subject and receives the current prefix too.
 */
export function finalizeWorkSlug(candidate: string, at: Date): string {
  const prefix = workSlugDatePrefix(at);
  return candidate.startsWith(prefix) ? candidate : `${prefix}${candidate}`;
}

export function workSlugProblem(
  slug: string,
  at: Date
): WorkSlugProblem | null {
  if (!SLUG.test(slug) || !slug.startsWith(workSlugDatePrefix(at))) {
    return "format";
  }
  return slug.length > MAX_WORK_SLUG_LENGTH ? "length" : null;
}
