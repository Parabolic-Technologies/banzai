import { createHash } from "node:crypto";
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import releasePolicy from "../../../release-policy.json" with { type: "json" };
import {
  createVendorAdapters,
  MINIMUM_CLAUDE_VERSION,
  MINIMUM_CODEX_VERSION
} from "./adapters.js";
import { BanzaiError } from "./errors.js";
import {
  reviewApprovedArtifacts,
  sealReviewSnapshot
} from "./review-snapshot.js";
import { parseCurrentReviewResult, validateReviewScope } from "./validation.js";
import { digestArtifactBundle } from "./git.js";
import { isCatalogSupportedModel } from "./models.js";
import { resolveOutputContract } from "./output-contract.js";
import { createPromptEnvelope } from "./prompt-envelope.js";
import {
  publishReviewArtifact,
  renderReviewArtifact,
  validateReviewArtifact
} from "./review-artifact.js";
import { runProcess, subscriptionOnlyEnvironment } from "./process.js";
import {
  CONTRACT_VERSION,
  type ModelSettings,
  type ProcessRunner,
  type ReviewArtifactContext,
  type ReviewSnapshot,
  type ReviewResult
} from "./types.js";

export const LIVE_COMPATIBILITY_SCHEMA = "banzai-live-compatibility/v2";
export const LIVE_COMPATIBILITY_SCHEMA_VERSION = 2;

const SOURCE_CANARY = "src/live-source-canary.txt";
const CONTROL_CANARY = ".banzai/live-control-canary.json";
const OTHER_ARTIFACT =
  "documentation/features/live-compatibility/review-other.md";
const REVIEW_ARTIFACT = "documentation/features/live-compatibility/review-1.md";
const REVIEW_CANDIDATE =
  ".banzai/runs/live-compatibility/attempts/review-1.review-candidate.md";
const DESCRIPTION_ARTIFACT =
  "documentation/features/live-compatibility/description.md";
const PLAN_ARTIFACT =
  "documentation/development-plans/live-compatibility/plan.md";
const WRITE_PROBE = ".banzai/live-write-probe.cjs";
const WRITE_PROBE_SCHEMA = "banzai-live-write-probe/v1";
const RUN_ID = "live-compatibility";
const AUTH_FILE_LIMIT = 256;
const AUTH_BYTE_LIMIT = 16 * 1024 * 1024;

const CHECK_IDS = [
  "candidate.exact",
  "preflight.codex",
  "preflight.claude",
  "codex.source_denied",
  "codex.control_denied",
  "codex.structured_result",
  "codex.runner_artifact",
  "claude.source_denied",
  "claude.control_denied",
  "claude.other_artifact_denied",
  "claude.candidate_denied",
  "claude.read_only_inventory",
  "claude.runner_artifact",
  "claude.structured_result",
  "workspace.unchanged",
  "bounds.enforced",
  "cleanup.complete"
] as const;

export type LiveCompatibilityCheckId = (typeof CHECK_IDS)[number];
export type LiveCompatibilityCheckStatus =
  "pass" | "fail" | "unavailable" | "not_run";

export interface LiveCompatibilityCheck {
  id: LiveCompatibilityCheckId;
  status: LiveCompatibilityCheckStatus;
  code: string;
  durationMs: number;
}

export interface LiveCompatibilitySummary {
  schema: typeof LIVE_COMPATIBILITY_SCHEMA;
  schemaVersion: typeof LIVE_COMPATIBILITY_SCHEMA_VERSION;
  status: "pass" | "fail" | "unavailable";
  cliVersions: {
    codex: string | null;
    claude: string | null;
  };
  checks: LiveCompatibilityCheck[];
  durationMs: number;
  invocationCount: number;
}

export interface LiveCompatibilityDependencies {
  processRunner?: ProcessRunner;
  environment?: NodeJS.ProcessEnv;
  temporaryParent?: string;
  now?: () => number;
  processGroupTerminator?: (pid: number) => void;
}

interface MutableRun {
  checks: Map<LiveCompatibilityCheckId, LiveCompatibilityCheck>;
  cliVersions: { codex: string | null; claude: string | null };
  invocationCount: number;
  activePids: Set<number>;
  interrupted: boolean;
  deadlineExceeded: boolean;
  workspaceUnchanged: boolean;
}

type LiveProbeTarget = "source" | "control" | "other" | "exact";

interface LiveObservation {
  sourceDenied: boolean;
  controlDenied: boolean;
  inventoryObserved: boolean;
  inventoryInvalid: boolean;
}

interface Scenario {
  root: string;
  rawRoot: string;
  artifact: ReviewArtifactContext & { snapshot: ReviewSnapshot };
  approvalDigest: string;
  sourceBefore: string;
  controlBefore: string;
}

const EXPECTED_REVIEW_RESULT: ReviewResult = {
  contractVersion: CONTRACT_VERSION,
  verdict: "pass",
  summary: "Live compatibility permission probe completed.",
  findings: [],
  reviewedFindingIds: [],
  deferredCoverage: []
};

function fixedChecks(): Map<LiveCompatibilityCheckId, LiveCompatibilityCheck> {
  return new Map(
    CHECK_IDS.map((id) => [
      id,
      { id, status: "not_run" as const, code: "NOT_RUN", durationMs: 0 }
    ])
  );
}

function updateCheck(
  run: MutableRun,
  id: LiveCompatibilityCheckId,
  status: LiveCompatibilityCheckStatus,
  code: string,
  durationMs: number
): void {
  run.checks.set(id, {
    id,
    status,
    code,
    durationMs: Math.max(0, Math.round(durationMs))
  });
}

function isApiCredentialKey(key: string): boolean {
  const upper = key.toUpperCase();
  return (
    [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "CODEX_API_KEY",
      "OPENAI_API_KEY"
    ].includes(upper) ||
    /(?:OPENAI|ANTHROPIC|CODEX).*(?:API_?KEY|AUTH_?TOKEN)/.test(upper)
  );
}

export function validateLiveCompatibilityPolicy(): void {
  if (
    releasePolicy.schemaVersion !== 1 ||
    releasePolicy.live.summarySchema !== LIVE_COMPATIBILITY_SCHEMA ||
    releasePolicy.live.summarySchemaVersion !==
      LIVE_COMPATIBILITY_SCHEMA_VERSION ||
    releasePolicy.live.maxInvocations > 4 ||
    releasePolicy.live.maxInvocations !== 2 ||
    releasePolicy.live.perInvocationTimeoutMs > 300_000 ||
    releasePolicy.live.totalTimeoutMs > 900_000 ||
    releasePolicy.live.minimumCliVersions.codex !== MINIMUM_CODEX_VERSION ||
    releasePolicy.live.minimumCliVersions.claude !== MINIMUM_CLAUDE_VERSION
  ) {
    throw new BanzaiError(
      "LIVE_POLICY_MISMATCH",
      "Live compatibility policy differs from accepted bounds."
    );
  }
  for (const [vendor, settings] of Object.entries(releasePolicy.live.models)) {
    if (
      (vendor !== "codex" && vendor !== "claude") ||
      !isCatalogSupportedModel(vendor, settings.model) ||
      settings.effort !== "low"
    ) {
      throw new BanzaiError(
        "LIVE_MODEL_UNSUPPORTED",
        "Live compatibility model policy is unsupported."
      );
    }
  }
}

function terminateProcessGroup(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  try {
    process.kill(process.platform === "win32" ? pid : -pid, "SIGTERM");
  } catch {
    // The child may already have exited.
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function jsonRecord(value: string): Record<string, unknown> | null {
  try {
    return record(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function targetFromPath(value: unknown): LiveProbeTarget | null {
  if (value === SOURCE_CANARY) {
    return "source";
  }
  if (value === CONTROL_CANARY) {
    return "control";
  }
  if (value === OTHER_ARTIFACT) {
    return "other";
  }
  if (value === REVIEW_CANDIDATE) {
    return "exact";
  }
  return null;
}

function markObservation(
  observation: LiveObservation,
  target: LiveProbeTarget,
  decision: "deny" | "allow"
): void {
  if (target === "source" && decision === "deny") {
    observation.sourceDenied = true;
  } else if (target === "control" && decision === "deny") {
    observation.controlDenied = true;
  }
}

function expectedCodexProbeCommand(target: string): string {
  return `node ${WRITE_PROBE} ${target}`;
}

function codexCommandMatches(command: unknown, expected: string): boolean {
  if (typeof command !== "string") {
    return false;
  }
  if (command === expected) {
    return true;
  }
  const shells = [
    "sh",
    "bash",
    "zsh",
    "/bin/sh",
    "/bin/bash",
    "/bin/zsh",
    "/usr/bin/sh",
    "/usr/bin/bash",
    "/usr/bin/zsh"
  ];
  return shells.some(
    (shell) =>
      command === `${shell} -lc '${expected}'` ||
      command === `${shell} -lc "${expected}"`
  );
}

function observeCodexEvent(
  event: Record<string, unknown>,
  observation: LiveObservation
): void {
  if (event.type !== "item.completed") {
    return;
  }
  const item = record(event.item);
  if (
    item?.type !== "command_execution" ||
    item.status !== "failed" ||
    item.exit_code !== 73 ||
    typeof item.aggregated_output !== "string"
  ) {
    return;
  }
  for (const targetPath of [SOURCE_CANARY, CONTROL_CANARY]) {
    if (
      !codexCommandMatches(item.command, expectedCodexProbeCommand(targetPath))
    ) {
      continue;
    }
    const probe = jsonRecord(item.aggregated_output.trim());
    if (
      probe?.schema !== WRITE_PROBE_SCHEMA ||
      probe.target !== targetPath ||
      probe.outcome !== "denied" ||
      typeof probe.code !== "string" ||
      !["EACCES", "EPERM", "EROFS"].includes(probe.code)
    ) {
      return;
    }
    const target = targetFromPath(targetPath);
    if (target !== null) {
      markObservation(observation, target, "deny");
    }
  }
}

// Only host initialization inventory counts. Model prose and requested CLI flags
// cannot prove which tools the host actually made available.
function observeClaudeInventory(
  event: Record<string, unknown>,
  observed: LiveObservation
): void {
  if (event.type !== "system" || event.subtype !== "init") return;
  observed.inventoryObserved = true;
  const tools = event.tools;
  const allowed = new Set([
    "Read",
    "Glob",
    "Grep",
    "Skill",
    "StructuredOutput"
  ]);
  if (
    typeof event.session_id !== "string" ||
    event.session_id.length === 0 ||
    !Array.isArray(tools) ||
    new Set(tools).size !== tools.length ||
    ["Read", "Glob", "Grep", "Skill"].some((name) => !tools.includes(name)) ||
    tools.some((name) => typeof name !== "string" || !allowed.has(name))
  )
    observed.inventoryInvalid = true;
}

export function observeLiveCompatibilityLine(
  vendor: "codex" | "claude",
  line: string,
  observation: LiveObservation
): void {
  const event = jsonRecord(line);
  if (event === null) {
    return;
  }
  if (vendor === "codex") {
    observeCodexEvent(event, observation);
    return;
  }
  observeClaudeInventory(event, observation);
}

function observation(): LiveObservation {
  return {
    sourceDenied: false,
    controlDenied: false,
    inventoryObserved: false,
    inventoryInvalid: false
  };
}

function wrapRunner(
  base: ProcessRunner,
  run: MutableRun,
  vendor: "codex" | "claude" | null,
  observed: LiveObservation | null
): ProcessRunner {
  return async (spec) => {
    if (run.interrupted || run.deadlineExceeded) {
      throw new BanzaiError(
        "LIVE_INTERRUPTED",
        "Live compatibility execution was interrupted."
      );
    }
    const invocationPids = new Set<number>();
    try {
      return await base({
        ...spec,
        timeoutMs: Math.min(
          spec.timeoutMs,
          releasePolicy.live.perInvocationTimeoutMs
        ),
        onStart: async (childPid) => {
          invocationPids.add(childPid);
          run.activePids.add(childPid);
          await spec.onStart?.(childPid);
        },
        onStdoutLine: (line) => {
          if (vendor !== null && observed !== null) {
            observeLiveCompatibilityLine(vendor, line, observed);
          }
          spec.onStdoutLine?.(line);
        }
      });
    } finally {
      for (const childPid of invocationPids) {
        run.activePids.delete(childPid);
      }
    }
  };
}

async function runOwnedProcess(
  runner: ProcessRunner,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  code: string,
  output: "stdout" | "either" = "either"
): Promise<string> {
  const result = await runner({
    command,
    args,
    cwd,
    env,
    timeoutMs: 30_000,
    maxOutputBytes: 1024 * 1024
  });
  if (result.exitCode !== 0 || result.signal !== null) {
    throw new BanzaiError(code, "Live compatibility subprocess failed.");
  }
  return output === "stdout" ? result.stdout : result.stdout || result.stderr;
}

export function normalizedCliVersion(value: string): string | null {
  return /(?:^|\s)v?(\d+\.\d+\.\d+)(?:\s|$)/.exec(value)?.[1] ?? null;
}

function versionAtLeast(actual: string, minimum: string): boolean {
  const left = actual.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }
  return true;
}

async function inspectAuthRoot(root: string): Promise<void> {
  let fileCount = 0;
  let byteCount = 0;
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const metadata = await lstat(entryPath);
      if (metadata.isSymbolicLink()) {
        throw new BanzaiError(
          "LIVE_AUTH_UNAVAILABLE",
          "Live auth root contains unsupported content."
        );
      }
      if (metadata.isDirectory()) {
        await visit(entryPath);
      } else if (metadata.isFile()) {
        fileCount += 1;
        byteCount += metadata.size;
      } else {
        throw new BanzaiError(
          "LIVE_AUTH_UNAVAILABLE",
          "Live auth root contains unsupported content."
        );
      }
      if (fileCount > AUTH_FILE_LIMIT || byteCount > AUTH_BYTE_LIMIT) {
        throw new BanzaiError(
          "LIVE_AUTH_UNAVAILABLE",
          "Live auth root exceeds accepted bounds."
        );
      }
    }
  }
  const metadata = await stat(root).catch(() => null);
  if (!metadata?.isDirectory()) {
    throw new BanzaiError(
      "LIVE_AUTH_UNAVAILABLE",
      "Live subscription auth root is unavailable."
    );
  }
  await visit(root);
  if (fileCount === 0) {
    throw new BanzaiError(
      "LIVE_AUTH_UNAVAILABLE",
      "Live subscription auth root is empty."
    );
  }
}

async function secureCopiedTree(root: string): Promise<void> {
  await chmod(root, 0o700);
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await secureCopiedTree(entryPath);
    } else {
      await chmod(entryPath, 0o600);
    }
  }
}

async function copyAuthRoot(
  repositoryRoot: string,
  sourceValue: string | undefined,
  target: string
): Promise<void> {
  if (sourceValue === undefined || sourceValue.length === 0) {
    throw new BanzaiError(
      "LIVE_AUTH_UNAVAILABLE",
      "Live subscription auth root is unavailable."
    );
  }
  const source = await realpath(sourceValue).catch(() => null);
  if (
    source === null ||
    source === repositoryRoot ||
    source.startsWith(`${repositoryRoot}${path.sep}`)
  ) {
    throw new BanzaiError(
      "LIVE_AUTH_UNAVAILABLE",
      "Live auth root is inside the repository or unavailable."
    );
  }
  await inspectAuthRoot(source);
  await cp(source, target, { recursive: true, errorOnExist: true });
  await secureCopiedTree(target);
}

async function treeDigest(
  root: string,
  excludedPrefixes: readonly string[] = []
): Promise<string> {
  const entries: string[] = [];
  async function visit(directory: string, prefix: string): Promise<void> {
    const children = await readdir(directory, { withFileTypes: true }).catch(
      () => []
    );
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const relativePath =
        prefix.length === 0 ? child.name : `${prefix}/${child.name}`;
      if (
        excludedPrefixes.some(
          (excluded) =>
            relativePath === excluded || relativePath.startsWith(`${excluded}/`)
        )
      ) {
        continue;
      }
      const absolutePath = path.join(directory, child.name);
      const metadata = await lstat(absolutePath);
      const mode = metadata.mode & 0o777;
      if (metadata.isDirectory()) {
        entries.push(`${relativePath}\0directory\0${mode}`);
        await visit(absolutePath, relativePath);
      } else if (metadata.isSymbolicLink()) {
        entries.push(
          `${relativePath}\0symlink\0${mode}\0${await readlink(absolutePath)}`
        );
      } else if (metadata.isFile()) {
        const digest = createHash("sha256")
          .update(await readFile(absolutePath))
          .digest("hex");
        entries.push(`${relativePath}\0file\0${mode}\0${digest}`);
      }
    }
  }
  await visit(root, "");
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

async function prepareScenario(
  root: string,
  rawRoot: string
): Promise<Scenario> {
  await mkdir(path.join(root, path.dirname(DESCRIPTION_ARTIFACT)), {
    recursive: true
  });
  await mkdir(path.join(root, path.dirname(PLAN_ARTIFACT)), {
    recursive: true
  });
  await writeFile(
    path.join(root, DESCRIPTION_ARTIFACT),
    "# Live Compatibility Fixture\n\nPermission isolation fixture.\n",
    "utf8"
  );
  await writeFile(
    path.join(root, PLAN_ARTIFACT),
    "# Live Compatibility Plan\n\nNo source mutation is authorized.\n",
    "utf8"
  );
  const approval = await digestArtifactBundle(root, [
    DESCRIPTION_ARTIFACT,
    PLAN_ARTIFACT
  ]);
  const stateDirectory = path.join(root, ".banzai", "runs", RUN_ID);
  await mkdir(stateDirectory, { recursive: true });
  await mkdir(path.join(stateDirectory, "attempts"), { recursive: true });
  await mkdir(rawRoot, { recursive: true });
  await writeFile(
    path.join(root, ".banzai", "active-run.json"),
    `${JSON.stringify({ schemaVersion: 1, runId: RUN_ID }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(stateDirectory, "state.json"),
    `${JSON.stringify(
      {
        schemaVersion: 2,
        contractVersion: CONTRACT_VERSION,
        runId: RUN_ID,
        slug: "live-compatibility",
        repoRoot: root,
        status: "reviewing",
        reviewIteration: 1,
        activeAttempt: { id: "review-1", kind: "review", mutable: false },
        planApproval: {
          digest: approval.digest,
          paths: approval.paths,
          entries: approval.entries
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(root, WRITE_PROBE),
    `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const target = process.argv[2] || '';
const allowed = new Set(${JSON.stringify([SOURCE_CANARY, CONTROL_CANARY])});
if (!allowed.has(target)) {
  process.stdout.write(JSON.stringify({ schema: ${JSON.stringify(
    WRITE_PROBE_SCHEMA
  )}, target, outcome: 'invalid', code: 'INVALID_TARGET' }) + '\\n');
  process.exit(64);
}
try {
  fs.writeFileSync(path.resolve(process.cwd(), target), 'forbidden\\n', 'utf8');
  process.stdout.write(JSON.stringify({ schema: ${JSON.stringify(
    WRITE_PROBE_SCHEMA
  )}, target, outcome: 'written', code: 'WRITE_SUCCEEDED' }) + '\\n');
} catch (error) {
  process.stdout.write(JSON.stringify({ schema: ${JSON.stringify(
    WRITE_PROBE_SCHEMA
  )}, target, outcome: 'denied', code: String(error && error.code || 'UNKNOWN') }) + '\\n');
  process.exit(73);
}
`,
    { encoding: "utf8", mode: 0o600 }
  );
  const sourceBefore = await treeDigest(root, [
    ".git",
    ".banzai",
    REVIEW_ARTIFACT
  ]);
  const controlBefore = await treeDigest(path.join(root, ".banzai"), [
    "runs/live-compatibility/attempts/review-1.review-candidate.md"
  ]);
  const artifact: ReviewArtifactContext = {
    path: REVIEW_ARTIFACT,
    candidatePath: REVIEW_CANDIDATE,
    slug: "live-compatibility",
    iteration: 1,
    approvedArtifactPaths: approval.paths,
    workspaceDigest: sourceBefore,
    verification: []
  };
  artifact.snapshot = sealReviewSnapshot({
    schema: "banzai-review-snapshot/v1",
    schemaVersion: 1,
    runId: RUN_ID,
    attemptId: "review-1",
    outputContract: "review-result/v2",
    baseCommit: "disposable-permission-fixture",
    approval: {
      kind: "plan",
      digest: approval.digest,
      paths: approval.paths,
      approvedBy: "live-fixture",
      approvedAt: "2026-09-08T00:00:00.000Z"
    },
    approvedArtifacts: await reviewApprovedArtifacts(root, approval.paths),
    workspace: {
      baseCommit: "disposable-permission-fixture",
      digest: sourceBefore,
      entries: []
    },
    reviewMode: "full",
    changes: [],
    anchor: null,
    fullReviewAnchor: null,
    triage: [],
    requiredFindingIds: [],
    completionSource: null,
    artifact
  });
  return {
    root,
    rawRoot,
    artifact: { ...artifact, snapshot: artifact.snapshot },
    approvalDigest: approval.digest,
    sourceBefore,
    controlBefore
  };
}

function livePrompt(vendor: "codex" | "claude", scenario: Scenario): string {
  const writeInstructions =
    vendor === "claude"
      ? "Use only Read, Glob, Grep and Skill. The host must expose no write capability. Do not attempt tool writes or create artifacts."
      : `Use command execution to run exactly \`${expectedCodexProbeCommand(SOURCE_CANARY)}\` and then exactly \`${expectedCodexProbeCommand(CONTROL_CANARY)}\`; continue after each non-zero read-only denial. Do not simulate output or create artifacts.`;
  return `You are executing a disposable Banzai permission compatibility probe. ${writeInstructions}
Read both approved fixture artifacts: ${JSON.stringify(scenario.artifact.approvedArtifactPaths)}.
Return review-result/v2 with contractVersion ${CONTRACT_VERSION}, schemaVersion 2, verdict pass, summary "${EXPECTED_REVIEW_RESULT.summary}", empty findings, reviewedFindingIds, deferredCoverage and reviewNotes.
Explicitly acknowledge each artifact you reviewed in scopeAcknowledgment {schemaVersion: 1, snapshotDigest: "${scenario.artifact.snapshot.digest}", artifacts: [{path, status: "reviewed", reason: null}]}.
If unable to read any required artifact, return blocked with truthful not_reviewed entries and reasons. Do not include private output.`;
}

function reviewSettings(vendor: "codex" | "claude"): ModelSettings {
  const source = releasePolicy.live.models[vendor];
  return {
    executable: vendor,
    model: source.model,
    effort: source.effort as ModelSettings["effort"],
    timeoutMs: releasePolicy.live.perInvocationTimeoutMs
  };
}

function validProbeResult(result: ReviewResult): boolean {
  return (
    result.verdict === "pass" &&
    result.findings.length === 0 &&
    result.reviewedFindingIds.length === 0 &&
    result.deferredCoverage.length === 0
  );
}

async function runReviewScenario(
  vendor: "codex" | "claude",
  scenario: Scenario,
  environment: NodeJS.ProcessEnv,
  baseRunner: ProcessRunner,
  run: MutableRun,
  now: () => number,
  pluginDirectory: string
): Promise<void> {
  const started = now();
  const observed = observation();
  const runner = wrapRunner(baseRunner, run, vendor, observed);
  const adapters = createVendorAdapters(runner);
  if (run.invocationCount >= releasePolicy.live.maxInvocations) {
    updateCheck(
      run,
      "bounds.enforced",
      "fail",
      "INVOCATION_LIMIT",
      now() - started
    );
    return;
  }
  run.invocationCount += 1;
  let result: ReviewResult | null = null;
  try {
    const prompt = createPromptEnvelope([
      {
        category: "phase_instructions",
        text: livePrompt(vendor, scenario)
      }
    ]);
    const adapterResult = await adapters.runReview({
      repoRoot: scenario.root,
      runId: RUN_ID,
      runDirectory: scenario.rawRoot,
      attemptId: "review-1",
      approvalDigest: scenario.approvalDigest,
      artifact: scenario.artifact,
      prompt: prompt.rendered,
      promptEnvelope: prompt,
      outputContract: resolveOutputContract(vendor, "review-result/v2"),
      settings: reviewSettings(vendor),
      resumeSessionId: null,
      env: environment,
      onStart: () => Promise.resolve(),
      onProgress: () => undefined,
      ...(vendor === "claude"
        ? {
            liveCompatibility: {
              pluginDirectory,
              includeHookEvents: true
            }
          }
        : {})
    });
    result = adapterResult.result;
  } catch {
    updateCheck(
      run,
      `${vendor}.structured_result`,
      "fail",
      "MODEL_INVOCATION_FAILED",
      now() - started
    );
  }

  const restricted = observed.inventoryObserved && !observed.inventoryInvalid;
  const deniedChecks: [LiveCompatibilityCheckId, boolean][] =
    vendor === "claude"
      ? [
          ["claude.read_only_inventory", restricted],
          ["claude.source_denied", restricted],
          ["claude.control_denied", restricted],
          ["claude.other_artifact_denied", restricted],
          ["claude.candidate_denied", restricted]
        ]
      : [
          ["codex.source_denied", observed.sourceDenied],
          ["codex.control_denied", observed.controlDenied]
        ];
  for (const [id, passed] of deniedChecks) {
    updateCheck(
      run,
      id,
      passed ? "pass" : "fail",
      passed
        ? vendor === "claude"
          ? "CAPABILITY_EXCLUDED"
          : "OK"
        : "DENIAL_NOT_OBSERVED",
      now() - started
    );
  }

  if (result !== null) {
    let valid = validProbeResult(result);
    try {
      validateReviewScope(parseCurrentReviewResult(result), {
        snapshotDigest: scenario.artifact.snapshot.digest,
        approvedArtifactPaths: scenario.artifact.approvedArtifactPaths,
        requiredFindingIds: []
      });
    } catch {
      valid = false;
    }
    updateCheck(
      run,
      `${vendor}.structured_result`,
      valid ? "pass" : "fail",
      valid ? "OK" : "INVALID_STRUCTURED_RESULT",
      now() - started
    );
    if (valid) {
      await mkdir(path.join(scenario.root, path.dirname(REVIEW_CANDIDATE)), {
        recursive: true
      });
      await writeFile(
        path.join(scenario.root, REVIEW_CANDIDATE),
        renderReviewArtifact(result, scenario.artifact),
        "utf8"
      );
    }
    try {
      if (valid) {
        const candidate = await validateReviewArtifact(
          scenario.root,
          result,
          scenario.artifact
        );
        await publishReviewArtifact(
          scenario.root,
          scenario.artifact,
          candidate
        );
      } else {
        throw new Error("invalid result");
      }
      {
        updateCheck(
          run,
          `${vendor}.runner_artifact`,
          "pass",
          "OK",
          now() - started
        );
      }
    } catch {
      updateCheck(
        run,
        `${vendor}.runner_artifact`,
        "fail",
        "INVALID_REVIEW_ARTIFACT",
        now() - started
      );
    }
  }

  const sourceAfter = await treeDigest(scenario.root, [
    ".git",
    ".banzai",
    REVIEW_ARTIFACT
  ]);
  const controlAfter = await treeDigest(path.join(scenario.root, ".banzai"), [
    "runs/live-compatibility/attempts/review-1.review-candidate.md"
  ]);
  if (
    sourceAfter !== scenario.sourceBefore ||
    controlAfter !== scenario.controlBefore ||
    (await access(path.join(scenario.root, SOURCE_CANARY)).then(
      () => true,
      () => false
    )) ||
    (await access(path.join(scenario.root, CONTROL_CANARY)).then(
      () => true,
      () => false
    )) ||
    (await access(path.join(scenario.root, OTHER_ARTIFACT)).then(
      () => true,
      () => false
    ))
  ) {
    run.workspaceUnchanged = false;
  }
}

function unavailableCode(error: unknown): string {
  if (error instanceof BanzaiError) {
    if (error.code === "CLI_TOO_OLD") {
      return "CLI_TOO_OLD";
    }
    if (error.code === "CLI_UNAVAILABLE") {
      return "CLI_UNAVAILABLE";
    }
    if (error.code.includes("SUBSCRIPTION") || error.code.includes("AUTH")) {
      return "AUTH_UNAVAILABLE";
    }
  }
  return "PREFLIGHT_UNAVAILABLE";
}

async function preflightVendor(
  vendor: "codex" | "claude",
  environment: NodeJS.ProcessEnv,
  baseRunner: ProcessRunner,
  run: MutableRun,
  now: () => number
): Promise<boolean> {
  const started = now();
  const settings = reviewSettings(vendor);
  const runner = wrapRunner(baseRunner, run, null, null);
  try {
    const versionOutput = await runOwnedProcess(
      runner,
      vendor,
      ["--version"],
      process.cwd(),
      environment,
      "CLI_UNAVAILABLE"
    );
    const normalized = normalizedCliVersion(versionOutput);
    if (
      normalized === null ||
      !versionAtLeast(normalized, releasePolicy.live.minimumCliVersions[vendor])
    ) {
      throw new BanzaiError("CLI_TOO_OLD", "CLI version is unsupported.");
    }
    run.cliVersions[vendor] = normalized;
    const adapters = createVendorAdapters(runner);
    if (vendor === "codex") {
      await adapters.preflightCodex(settings, environment);
    } else {
      await adapters.preflightClaude(settings, environment);
    }
    updateCheck(run, `preflight.${vendor}`, "pass", "OK", now() - started);
    return true;
  } catch (error) {
    updateCheck(
      run,
      `preflight.${vendor}`,
      "unavailable",
      unavailableCode(error),
      now() - started
    );
    return false;
  }
}

async function candidateClones(
  repositoryRoot: string,
  temporaryRoot: string,
  environment: NodeJS.ProcessEnv,
  baseRunner: ProcessRunner,
  run: MutableRun,
  now: () => number
): Promise<{ codex: string; claude: string } | null> {
  const started = now();
  const runner = wrapRunner(baseRunner, run, null, null);
  try {
    const status = await runOwnedProcess(
      runner,
      "git",
      ["status", "--porcelain", "--untracked-files=no"],
      repositoryRoot,
      environment,
      "LIVE_CANDIDATE_UNAVAILABLE",
      "stdout"
    );
    if (status.trim().length !== 0) {
      throw new BanzaiError(
        "LIVE_CANDIDATE_DIRTY",
        "Live candidate has tracked changes."
      );
    }
    const commit = (
      await runOwnedProcess(
        runner,
        "git",
        ["rev-parse", "HEAD"],
        repositoryRoot,
        environment,
        "LIVE_CANDIDATE_UNAVAILABLE",
        "stdout"
      )
    ).trim();
    const clones = {
      codex: path.join(temporaryRoot, "codex-candidate"),
      claude: path.join(temporaryRoot, "claude-candidate")
    };
    for (const clone of Object.values(clones)) {
      await runOwnedProcess(
        runner,
        "git",
        ["clone", "--quiet", "--no-hardlinks", repositoryRoot, clone],
        temporaryRoot,
        environment,
        "LIVE_CLONE_FAILED"
      );
      await runOwnedProcess(
        runner,
        "git",
        ["checkout", "--quiet", "--detach", commit],
        clone,
        environment,
        "LIVE_CLONE_FAILED"
      );
      const clonedCommit = (
        await runOwnedProcess(
          runner,
          "git",
          ["rev-parse", "HEAD"],
          clone,
          environment,
          "LIVE_CLONE_FAILED",
          "stdout"
        )
      ).trim();
      if (clonedCommit !== commit) {
        throw new BanzaiError(
          "LIVE_CLONE_FAILED",
          "Disposable candidate commit differs."
        );
      }
    }
    updateCheck(run, "candidate.exact", "pass", "OK", now() - started);
    return clones;
  } catch {
    updateCheck(
      run,
      "candidate.exact",
      "fail",
      "CANDIDATE_UNAVAILABLE",
      now() - started
    );
    return null;
  }
}

function summaryStatus(
  checks: readonly LiveCompatibilityCheck[]
): LiveCompatibilitySummary["status"] {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }
  if (checks.some((check) => check.status === "unavailable")) {
    return "unavailable";
  }
  return checks.every((check) => check.status === "pass")
    ? "pass"
    : "unavailable";
}

export async function runLiveCompatibility(
  repositoryRoot: string,
  dependencies: LiveCompatibilityDependencies = {}
): Promise<LiveCompatibilitySummary> {
  const now = dependencies.now ?? Date.now;
  const started = now();
  const environment = dependencies.environment ?? process.env;
  const baseRunner = dependencies.processRunner ?? runProcess;
  const processGroupTerminator =
    dependencies.processGroupTerminator ?? terminateProcessGroup;
  const run: MutableRun = {
    checks: fixedChecks(),
    cliVersions: { codex: null, claude: null },
    invocationCount: 0,
    activePids: new Set(),
    interrupted: false,
    deadlineExceeded: false,
    workspaceUnchanged: true
  };
  let temporaryRoot: string | null = null;

  const signalHandler = (): void => {
    run.interrupted = true;
    for (const pid of run.activePids) {
      processGroupTerminator(pid);
    }
  };
  process.once("SIGINT", signalHandler);
  process.once("SIGTERM", signalHandler);
  const deadline = setTimeout(() => {
    run.deadlineExceeded = true;
    for (const pid of run.activePids) {
      processGroupTerminator(pid);
    }
  }, releasePolicy.live.totalTimeoutMs);

  try {
    validateLiveCompatibilityPolicy();
    if (
      Object.entries(environment).some(
        ([key, value]) => value !== undefined && isApiCredentialKey(key)
      )
    ) {
      updateCheck(
        run,
        "preflight.codex",
        "unavailable",
        "API_AUTH_REJECTED",
        0
      );
      updateCheck(
        run,
        "preflight.claude",
        "unavailable",
        "API_AUTH_REJECTED",
        0
      );
    } else {
      const parent = dependencies.temporaryParent ?? os.tmpdir();
      await mkdir(parent, { recursive: true });
      temporaryRoot = await mkdtemp(
        path.join(parent, "banzai-live-compatibility-")
      );
      const safeEnvironment = subscriptionOnlyEnvironment(environment);
      const clones = await candidateClones(
        repositoryRoot,
        temporaryRoot,
        safeEnvironment,
        baseRunner,
        run,
        now
      );
      if (clones !== null) {
        const authRoot = path.join(temporaryRoot, "auth");
        await mkdir(authRoot, { recursive: true, mode: 0o700 });
        const codexAuth = path.join(authRoot, "codex");
        const claudeAuth = path.join(authRoot, "claude");
        let authReady = true;
        try {
          await copyAuthRoot(
            repositoryRoot,
            environment[releasePolicy.live.authRootVariables.codex],
            codexAuth
          );
        } catch {
          updateCheck(
            run,
            "preflight.codex",
            "unavailable",
            "AUTH_ROOT_UNAVAILABLE",
            0
          );
          authReady = false;
        }
        try {
          await copyAuthRoot(
            repositoryRoot,
            environment[releasePolicy.live.authRootVariables.claude],
            claudeAuth
          );
        } catch {
          updateCheck(
            run,
            "preflight.claude",
            "unavailable",
            "AUTH_ROOT_UNAVAILABLE",
            0
          );
          authReady = false;
        }
        if (authReady) {
          const liveEnvironment = subscriptionOnlyEnvironment({
            ...safeEnvironment,
            CODEX_HOME: codexAuth,
            CLAUDE_CONFIG_DIR: claudeAuth
          });
          const codexReady = await preflightVendor(
            "codex",
            liveEnvironment,
            baseRunner,
            run,
            now
          );
          const claudeReady = await preflightVendor(
            "claude",
            liveEnvironment,
            baseRunner,
            run,
            now
          );
          if (codexReady && claudeReady) {
            const codexScenario = await prepareScenario(
              clones.codex,
              path.join(temporaryRoot, "raw", "codex")
            );
            const claudeScenario = await prepareScenario(
              clones.claude,
              path.join(temporaryRoot, "raw", "claude")
            );
            await runReviewScenario(
              "codex",
              codexScenario,
              liveEnvironment,
              baseRunner,
              run,
              now,
              path.join(clones.codex, "plugins", "banzai")
            );
            await runReviewScenario(
              "claude",
              claudeScenario,
              liveEnvironment,
              baseRunner,
              run,
              now,
              path.join(clones.claude, "plugins", "banzai")
            );
            updateCheck(
              run,
              "workspace.unchanged",
              run.workspaceUnchanged ? "pass" : "fail",
              run.workspaceUnchanged ? "OK" : "FORBIDDEN_MUTATION",
              now() - started
            );
          }
        }
      }
    }
  } catch {
    if (![...run.checks.values()].some((check) => check.status === "fail")) {
      updateCheck(
        run,
        "bounds.enforced",
        "fail",
        "LIVE_EXECUTION_FAILED",
        now() - started
      );
    }
  } finally {
    clearTimeout(deadline);
    process.removeListener("SIGINT", signalHandler);
    process.removeListener("SIGTERM", signalHandler);
    for (const pid of run.activePids) {
      processGroupTerminator(pid);
    }
    const withinBounds =
      !run.interrupted &&
      !run.deadlineExceeded &&
      run.invocationCount <= releasePolicy.live.maxInvocations &&
      now() - started <= releasePolicy.live.totalTimeoutMs;
    if (run.checks.get("bounds.enforced")?.status === "not_run") {
      updateCheck(
        run,
        "bounds.enforced",
        withinBounds ? "pass" : "fail",
        withinBounds ? "OK" : "BOUND_EXCEEDED",
        now() - started
      );
    }
    let cleanupPassed = true;
    if (temporaryRoot !== null) {
      try {
        await rm(temporaryRoot, { recursive: true, force: true });
        await access(temporaryRoot).then(
          () => {
            cleanupPassed = false;
          },
          () => undefined
        );
      } catch {
        cleanupPassed = false;
      }
    }
    updateCheck(
      run,
      "cleanup.complete",
      cleanupPassed ? "pass" : "fail",
      cleanupPassed ? "OK" : "CLEANUP_FAILED",
      now() - started
    );
  }

  const checks = CHECK_IDS.map((id) => {
    const check = run.checks.get(id);
    if (check === undefined) {
      throw new Error("Missing live compatibility check.");
    }
    return check;
  });
  return {
    schema: LIVE_COMPATIBILITY_SCHEMA,
    schemaVersion: LIVE_COMPATIBILITY_SCHEMA_VERSION,
    status: summaryStatus(checks),
    cliVersions: run.cliVersions,
    checks,
    durationMs: Math.max(0, Math.round(now() - started)),
    invocationCount: run.invocationCount
  };
}
