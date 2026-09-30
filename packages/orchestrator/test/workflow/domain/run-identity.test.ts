import assert from "node:assert/strict";
import test from "node:test";
import { BanzaiError } from "../../../src/errors.js";
import { requireSlug } from "../../../src/workflow/domain/run-identity.js";

test("feature slugs must be lowercase kebab-case", () => {
  for (const slug of ["a", "feature-1", "a-b-c"])
    assert.doesNotThrow(() => {
      requireSlug(slug);
    }, slug);
  for (const slug of ["", "Feature", "a--b", "-a", "a-", "a_b", "a b"])
    assert.throws(
      () => {
        requireSlug(slug);
      },
      (error: unknown) =>
        error instanceof BanzaiError &&
        error.code === "INVALID_SLUG" &&
        error.message === "Feature slug must be lowercase kebab-case.",
      JSON.stringify(slug)
    );
});
