import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeWorkSlug,
  workSlugDatePrefix,
  workSlugProblem
} from "../src/workflow/domain/run-identity.js";

// Local noon keeps the local calendar date fixed in every time zone.
const november10 = new Date(2026, 10, 10, 12);

test("the date prefix uses the zero-padded local calendar date", () => {
  assert.equal(workSlugDatePrefix(november10), "261110-");
  assert.equal(workSlugDatePrefix(new Date(2027, 0, 5, 12)), "270105-");
});

/** Runs `body` with the process time zone fixed, restoring the original zone. */
function inTimeZone(zone: string, body: () => void): void {
  const original = process.env.TZ;
  process.env.TZ = zone;
  try {
    body();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

// Local noon cannot tell local from UTC fields, so these instants sit on
// different local and UTC calendar dates in fixed zones on both sides of UTC.
test("the date prefix follows the local calendar date, not the UTC one", () => {
  inTimeZone("Asia/Tokyo", () => {
    // 2026-11-10 20:00 UTC is 2026-11-11 05:00 in Tokyo.
    assert.equal(
      workSlugDatePrefix(new Date(Date.UTC(2026, 10, 10, 20))),
      "261111-"
    );
  });
  inTimeZone("America/Los_Angeles", () => {
    // 2026-11-11 03:00 UTC is 2026-11-10 19:00 in Los Angeles.
    assert.equal(
      workSlugDatePrefix(new Date(Date.UTC(2026, 10, 11, 3))),
      "261110-"
    );
  });
});

test("only the current date's prefix counts as already present", () => {
  assert.equal(finalizeWorkSlug("login-fix", november10), "261110-login-fix");
  assert.equal(
    finalizeWorkSlug("261110-login-fix", november10),
    "261110-login-fix"
  );
  assert.equal(
    finalizeWorkSlug("251001-login-fix", november10),
    "261110-251001-login-fix"
  );
});

test("a final slug must be prefixed kebab-case within 100 characters", () => {
  assert.equal(workSlugProblem("261110-login-fix", november10), null);
  assert.equal(
    workSlugProblem(finalizeWorkSlug("Login_Fix", november10), november10),
    "format"
  );
  assert.equal(workSlugProblem("261110-", november10), "format");
  assert.equal(workSlugProblem("login-fix", november10), "format");
  assert.equal(workSlugProblem("261109-login-fix", november10), "format");
  const longest = `261110-${"a".repeat(93)}`;
  assert.equal(workSlugProblem(longest, november10), null);
  assert.equal(workSlugProblem(`${longest}a`, november10), "length");
  // A slug with both problems reports the format first.
  assert.equal(
    workSlugProblem(`261110-${"A".repeat(94)}`, november10),
    "format"
  );
});
