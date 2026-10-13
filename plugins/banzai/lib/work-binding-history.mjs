import { exactObject, fail, relativePath } from "./project-files.mjs";
const BINDING_SCHEMA = "banzai-work-binding/v1";
const WORK_ROOT = ".banzai/work";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MODES = ["strict", "lite", "fix", "workflow"];
const LAYOUTS = ["private", "legacy"];

// Read-only decoding for persisted runner and review history. Never creates work.
function historicalRoles(workId, slug, mode, layout) {
  const directory =
    layout === "private"
      ? `${WORK_ROOT}/${workId}`
      : `documentation/features/${slug}`;
  const roles = { reviewDirectory: directory };
  if (mode === "strict" || mode === "workflow")
    Object.assign(roles, {
      description: `${directory}/description.md`,
      plan:
        layout === "private"
          ? `${directory}/plan.md`
          : `documentation/development-plans/${slug}/plan.md`,
      implementationReport: `${directory}/implementation-report.md`,
      testReport: `${directory}/test-report.md`,
    });
  if (mode === "lite" || mode === "workflow")
    roles.work = `${directory}/work.md`;
  if (mode === "fix" || mode === "workflow")
    roles.changeReport =
      layout === "private"
        ? `${directory}/change-report.md`
        : `documentation/changes/${slug}.md`;
  return roles;
}

export function parseHistoricalBinding(value) {
  exactObject(value, [
    "schema",
    "schemaVersion",
    "workId",
    "slug",
    "mode",
    "layout",
    "createdAt",
    "sourceCommit",
    "artifacts",
  ]);
  if (!((value.schema === BINDING_SCHEMA && value.schemaVersion === 1) ||
    (value.schema === "banzai-work-binding/v2" && value.schemaVersion === 2 && value.layout === "private")))
    fail(
      "ARTIFACT_VERSION_UNSUPPORTED",
      "Unsupported artifact work binding version.",
    );
  if (
    !UUID.test(value.workId) ||
    typeof value.slug !== "string" ||
    value.slug.length > 100 ||
    !SLUG.test(value.slug) ||
    !MODES.includes(value.mode) ||
    !LAYOUTS.includes(value.layout) ||
    typeof value.createdAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(
      value.createdAt,
    ) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !(
      value.sourceCommit === null ||
      (typeof value.sourceCommit === "string" &&
        /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value.sourceCommit))
    )
  ) {
    fail("ARTIFACT_INPUT_INVALID", "Artifact work identity is malformed.");
  }
  const expected = historicalRoles(
    value.workId,
    value.slug,
    value.mode,
    value.layout,
  );
  if (value.schemaVersion === 2) expected.verificationDirectory = `${WORK_ROOT}/${value.workId}/verification`;
  exactObject(value.artifacts, Object.keys(expected));
  for (const key of Object.keys(expected)) {
    relativePath(value.artifacts[key]);
    if (value.artifacts[key] !== expected[key])
      fail(
        "ARTIFACT_UNSAFE_PATH",
        "Artifact role is outside its work binding.",
      );
  }
  return value;
}

