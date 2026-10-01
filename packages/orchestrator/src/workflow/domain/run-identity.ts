import { BanzaiError } from "../../errors.js";

export function runId(slug: string, at: string, uuid: string): string {
  const timestamp = at.replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${timestamp}-${slug}-${uuid.slice(0, 8)}`;
}

export function requireSlug(slug: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new BanzaiError(
      "INVALID_SLUG",
      "Feature slug must be lowercase kebab-case."
    );
  }
}
