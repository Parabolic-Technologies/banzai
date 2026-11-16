import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  GENERATED_PHASE_RESOURCE_PATH,
  applyTransitionStep,
  baselineFile,
  closed,
  frozenModuleLiterals,
  identity,
  resourceDigest,
  sortedExpectations,
  validateAuthorities
} from "./phase-resources-build.mjs";

export const SUCCESSOR_BASELINE =
  "packages/orchestrator/instruction-baseline.json";
export const SUCCESSOR_PIN =
  "packages/orchestrator/instruction-baseline.sha256";
const CLOSED_BASELINE = "packages/orchestrator/phase-guidance-current.json";
const TRANSITION_JOURNAL =
  "packages/orchestrator/.instruction-baseline-transition.json";
const DEFINITIONS_KEY = `${GENERATED_PHASE_RESOURCE_PATH}#definitions`;
const RAW_KEYS = [
  "plugins/banzai/hooks/hooks.json",
  "plugins/banzai/hooks/spec-gate.cjs"
];
const MANIFEST_KEYS = [
  "plugins/banzai/.claude-plugin/plugin.json",
  "plugins/banzai/.codex-plugin/plugin.json"
];
// The first generation is fixed here, outside the baseline file, as the v1
// root and the three closed files are fixed in tracked script code. The value
// is the identity of { predecessorBaselineSha256, origin } of the committed
// baseline. Nothing overrides it: a pinned resource changes only through a
// transition (ADR-0070 section 3).
const FIRST_GENERATION_PIN =
  "5ccc250f104ec0c521c5442f1c2c5901e8956c62251e79b3a329d35f4f9c6a47";
const SHA256 = /^[a-f0-9]{64}$/u;
const canonical = (value) => JSON.stringify(value);

// Every key the capture below can produce. This is the shape of a key, not a
// protection: a transition may change any of them.
function successorKey(key) {
  return (
    typeof key === "string" &&
    ((key.startsWith(`${GENERATED_PHASE_RESOURCE_PATH}#`) &&
      key.length > GENERATED_PHASE_RESOURCE_PATH.length + 1) ||
      RAW_KEYS.includes(key) ||
      MANIFEST_KEYS.includes(key))
  );
}

function sortedJson(value) {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedJson(value[key])])
  );
}

async function captureExpectations(root) {
  const { definitions, resources } = frozenModuleLiterals(
    await baselineFile(root, GENERATED_PHASE_RESOURCE_PATH)
  );
  const captured = {
    [DEFINITIONS_KEY]: resourceDigest(canonical(sortedJson(definitions)))
  };
  for (const [id, resource] of Object.entries(resources)) {
    // Hook entries carry a digest only; their files are pinned below.
    if (typeof resource?.text !== "string") continue;
    const digest = resourceDigest(resource.text);
    if (digest !== resource.sha256)
      throw new Error(
        `Frozen instruction entry differs from its digest: ${id}.`
      );
    captured[`${GENERATED_PHASE_RESOURCE_PATH}#${id}`] = digest;
  }
  for (const key of RAW_KEYS)
    captured[key] = resourceDigest(await baselineFile(root, key, null));
  for (const key of MANIFEST_KEYS)
    // ADR-0033 owns version-only release transactions, so the version value
    // is not part of the pinned image.
    captured[key] = resourceDigest(
      (await baselineFile(root, key)).replace(
        /("version"\s*:\s*)"[^"\n]+"/,
        '$1"2.3.0"'
      )
    );
  return sortedExpectations(captured);
}

function changedKeys(expectations, captured) {
  return Object.keys(captured)
    .filter((key) => captured[key] !== expectations[key])
    .map((key) => ({
      key,
      before: expectations[key] ?? null,
      after: captured[key]
    }));
}

async function pinnedBytes(root) {
  const bytes = await baselineFile(root, SUCCESSOR_BASELINE);
  const pin = (await baselineFile(root, SUCCESSOR_PIN)).trim();
  if (!SHA256.test(pin) || resourceDigest(bytes) !== pin)
    throw new Error(
      "Successor instruction baseline pin mismatch; finish the explicit transition."
    );
  return bytes;
}

function originExpectations(origin) {
  closed(origin, ["authorities", "expectations"], "origin");
  const expectations = origin.expectations;
  if (
    !expectations ||
    typeof expectations !== "object" ||
    Array.isArray(expectations) ||
    Object.keys(expectations).length === 0 ||
    Object.entries(expectations).some(
      ([key, value]) =>
        !successorKey(key) || typeof value !== "string" || !SHA256.test(value)
    ) ||
    canonical(sortedExpectations(expectations)) !== canonical(expectations)
  )
    throw new Error("Invalid successor instruction baseline origin.");
  return expectations;
}

/** Replays the chain from the pinned origin and returns the latest expectations. */
async function replay(root, baseline) {
  closed(
    baseline,
    [
      "schema",
      "schemaVersion",
      "predecessorBaselineSha256",
      "origin",
      "expectations",
      "transitions"
    ],
    "envelope"
  );
  if (
    baseline.schema !== "banzai-instruction-baseline/v2" ||
    baseline.schemaVersion !== 2 ||
    !Array.isArray(baseline.transitions) ||
    baseline.transitions.length > 100 ||
    baseline.predecessorBaselineSha256 !==
      resourceDigest(await baselineFile(root, CLOSED_BASELINE))
  )
    throw new Error("Invalid successor instruction baseline identity.");
  let expected = originExpectations(baseline.origin);
  await validateAuthorities(root, baseline.origin.authorities);
  if (
    identity({
      predecessorBaselineSha256: baseline.predecessorBaselineSha256,
      origin: baseline.origin
    }) !== FIRST_GENERATION_PIN
  )
    throw new Error(
      "Successor instruction baseline first generation differs from its pinned identity; record a transition instead."
    );
  for (const transition of baseline.transitions)
    expected = await applyTransitionStep(
      root,
      expected,
      transition,
      successorKey
    );
  if (canonical(expected) !== canonical(baseline.expectations))
    throw new Error("Unrecorded successor instruction expectations.");
  return expected;
}

/** Sibling digest, pinned origin, chain, authorities, then current bytes. Read-only. */
export async function validateInstructionBaseline(root) {
  const expected = await replay(root, JSON.parse(await pinnedBytes(root)));
  const captured = await captureExpectations(root);
  const drifted = [
    ...new Set([...Object.keys(expected), ...Object.keys(captured)])
  ].find((key) => expected[key] !== captured[key]);
  if (drifted !== undefined)
    throw new Error(`Unrecorded instruction resource drift: ${drifted}.`);
}

/** Read-only proposal facts; these do not authorize or publish a transition. */
export async function describeInstructionTransition(root) {
  const current = JSON.parse(await pinnedBytes(root));
  await replay(root, current);
  return {
    predecessorSha256: identity(current.expectations),
    changes: changedKeys(current.expectations, await captureExpectations(root))
  };
}

function assertAuthorization(authorization) {
  closed(
    authorization,
    ["schema", "schemaVersion", "predecessorSha256", "authorities", "scope"],
    "authorization"
  );
  if (
    authorization.schema !== "banzai-instruction-authorization/v1" ||
    authorization.schemaVersion !== 1 ||
    !Array.isArray(authorization.scope) ||
    authorization.scope.length > 300 ||
    authorization.scope.some((key) => typeof key !== "string") ||
    canonical(authorization.scope) !==
      canonical(
        [...new Set(authorization.scope)].sort((a, b) =>
          a.localeCompare(b, "en")
        )
      )
  )
    throw new Error("Invalid instruction baseline authorization.");
}

async function pendingJournal(root) {
  try {
    return JSON.parse(await baselineFile(root, TRANSITION_JOURNAL));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

// A journal means a publication was interrupted between its two renames; the
// transition then resumes from the bytes the journal recorded.
async function transitionStart(root, authorization) {
  const journal = await pendingJournal(root);
  if (!journal) return { journal, previousBytes: await pinnedBytes(root) };
  closed(journal, ["authorizationSha256", "previous", "next"], "journal");
  if (journal.authorizationSha256 !== identity(authorization))
    throw new Error(
      "Pending instruction transition has different authorization."
    );
  for (const [file, oldBytes, newBytes] of [
    [SUCCESSOR_BASELINE, journal.previous, journal.next],
    [
      SUCCESSOR_PIN,
      resourceDigest(journal.previous) + "\n",
      resourceDigest(journal.next) + "\n"
    ]
  ]) {
    const actual = await baselineFile(root, file);
    if (actual !== oldBytes && actual !== newBytes)
      throw new Error("Interrupted instruction transition inputs changed.");
  }
  return { journal, previousBytes: journal.previous };
}

async function writeBaseline(root, bytes) {
  for (const [relative, contents] of [
    [SUCCESSOR_BASELINE, bytes],
    [SUCCESSOR_PIN, resourceDigest(bytes) + "\n"]
  ]) {
    const temporary = path.join(root, relative + ".pending");
    await writeFile(temporary, contents, { flag: "wx", mode: 0o644 }).catch(
      async (error) => {
        if (
          error.code !== "EEXIST" ||
          (await baselineFile(root, relative + ".pending")) !== contents
        )
          throw error;
      }
    );
    await rename(temporary, path.join(root, relative));
  }
}

function matchesLastTransition(baseline, authorization) {
  const last = baseline.transitions.at(-1);
  return (
    last !== undefined &&
    last.predecessorSha256 === authorization.predecessorSha256 &&
    canonical(last.authorities) === canonical(authorization.authorities) &&
    canonical(last.changes.map((entry) => entry.key)) ===
      canonical(authorization.scope)
  );
}

/** Explicit authoring only. Build, check and validation never call this. */
export async function evolveInstructionBaseline(
  root,
  authorization,
  { check = false } = {}
) {
  assertAuthorization(authorization);
  const { journal, previousBytes } = await transitionStart(root, authorization);
  const previous = JSON.parse(previousBytes);
  await replay(root, previous);
  const captured = await captureExpectations(root);
  const changes = changedKeys(previous.expectations, captured);
  if (changes.length === 0) {
    if (!matchesLastTransition(previous, authorization))
      throw new Error("No matching authorized instruction transition.");
    await validateInstructionBaseline(root);
    return { changed: false, sha256: resourceDigest(await pinnedBytes(root)) };
  }
  if (
    identity(previous.expectations) !== authorization.predecessorSha256 ||
    canonical(changes.map((entry) => entry.key)) !==
      canonical(authorization.scope)
  )
    throw new Error(
      "Instruction changes do not match the authorized predecessor and exact scope."
    );
  const next = {
    ...previous,
    expectations: captured,
    transitions: [
      ...previous.transitions,
      {
        predecessorSha256: authorization.predecessorSha256,
        successorSha256: identity(captured),
        authorities: authorization.authorities,
        changes
      }
    ]
  };
  await replay(root, next);
  const nextBytes = JSON.stringify(next, null, 2) + "\n";
  if (journal && journal.next !== nextBytes)
    throw new Error(
      "Instruction source changed during interrupted transition."
    );
  const result = { changed: true, sha256: resourceDigest(nextBytes) };
  if (check) return result;
  if (!journal)
    await writeFile(
      path.join(root, TRANSITION_JOURNAL),
      JSON.stringify({
        authorizationSha256: identity(authorization),
        previous: previousBytes,
        next: nextBytes
      }) + "\n",
      { flag: "wx", mode: 0o600 }
    );
  await writeBaseline(root, nextBytes);
  await validateInstructionBaseline(root);
  await rm(path.join(root, TRANSITION_JOURNAL));
  return result;
}

async function holdsTransition(root) {
  let bytes;
  try {
    bytes = await baselineFile(root, SUCCESSOR_BASELINE);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return false;
  }
  // A file whose chain cannot be read is treated as holding one.
  const transitions = JSON.parse(bytes)?.transitions;
  return !Array.isArray(transitions) || transitions.length > 0;
}

/**
 * Writes the first generation from current bytes. It is refused once the
 * baseline holds a transition, published or pending, and whenever the result
 * differs from the pinned first generation, so it can only restore that one.
 */
export async function initializeInstructionBaseline(
  root,
  origin,
  { check = false } = {}
) {
  closed(origin, ["schema", "schemaVersion", "authorities"], "origin");
  if (
    origin.schema !== "banzai-instruction-origin/v1" ||
    origin.schemaVersion !== 1
  )
    throw new Error("Invalid instruction baseline origin authorization.");
  if ((await pendingJournal(root)) || (await holdsTransition(root)))
    throw new Error(
      "Successor instruction baseline already holds a transition."
    );
  const expectations = await captureExpectations(root);
  const first = {
    schema: "banzai-instruction-baseline/v2",
    schemaVersion: 2,
    predecessorBaselineSha256: resourceDigest(
      await baselineFile(root, CLOSED_BASELINE)
    ),
    origin: { authorities: origin.authorities, expectations },
    expectations,
    transitions: []
  };
  await replay(root, first);
  const bytes = JSON.stringify(first, null, 2) + "\n";
  const result = { changed: true, sha256: resourceDigest(bytes) };
  if (check) return result;
  await writeBaseline(root, bytes);
  await validateInstructionBaseline(root);
  return result;
}
