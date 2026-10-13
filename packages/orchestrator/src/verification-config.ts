import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { safePath, readBytes } from "./project-files.js";
import { hasRunnerWorkOwnership } from "./work-documents.js";
import {
  CONFIG_FILE,
  editVerificationConfigBytes,
  type VerificationConfigEdit
} from "./config.js";
import {
  configurationDigest,
  configurationHash,
  configurationId,
  configurationInvalid,
  configurationObject,
  configurationText,
  configurationUuid,
  normalizedVerificationCommand,
  hasConfigurationSetup,
  parseConfigurationContinuation,
  type ConfigurationContinuation
} from "./configuration-prerequisite.js";
import { BanzaiError } from "./errors.js";
import { readCancellationFile } from "./cancellation-evidence.js";
import { parseConfig } from "./validation.js";
import { inspectVerificationProject } from "./verification.js";
import type { RunStore } from "./store.js";
import type { OrchestratorConfig } from "./types.js";

export const CONFIGURATION_OWNED_MESSAGE =
  "Configuration is owned by another Banzai session. Answer there, or pause/exit that session, rerun this command after ownership is released, then run banzai resume.";
export interface VerificationConfigDelta {
  start: number;
  before: string;
  after: string;
}
export interface VerificationConfigPreview {
  previewId: string;
  edit: VerificationConfigEdit;
  configBeforeSha256: string;
  configAfterSha256: string;
  sourceSha256: string;
  delta: VerificationConfigDelta[];
}
export interface VerificationConfigTransaction {
  schema: "banzai-verification-config-transaction/v1";
  schemaVersion: 1;
  operationId: string;
  runId: string;
  operation: "add" | "edit" | "remove";
  origin: "configuration_decision" | "verify_command";
  decisionId: string | null;
  proposalId: string | null;
  previewId: string;
  configBeforeSha256: string;
  configAfterSha256: string;
  profileId: string;
  previousCommandIds: string[];
  currentCommandIds: string[];
  sourceSha256: string;
  continuation: ConfigurationContinuation | null;
  bootstrapCleared: boolean;
  stage: "prepared" | "applied" | "finalized";
}
export interface VerificationConfigContext {
  runId: string;
  origin: VerificationConfigTransaction["origin"];
  decisionId: string | null;
  proposalId: string | null;
  continuation: ConfigurationContinuation | null;
  /** Existing workflow authority, checked again after publication/reconciliation. */
  revalidate(): Promise<void>;
}

function transactionInvalid(): never {
  throw new BanzaiError(
    "CONFIGURATION_TRANSACTION_INVALID",
    "Configuration transaction evidence is incomplete or conflicting. Inspect the pending decision and preserve its recovery checkpoint."
  );
}
function drift(): never {
  throw new BanzaiError(
    "CONFIGURATION_PROPOSAL_STALE",
    "Configuration or project evidence changed. Reinspect it and confirm a fresh preview before writing."
  );
}
function runSegment(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(value))
    return transactionInvalid();
  return value;
}
function transactionDirectory(runId: string): string {
  return `.banzai/runs/${runSegment(runId)}/configuration`;
}
function transactionPath(
  record: VerificationConfigTransaction,
  suffix: string
): string {
  return `${transactionDirectory(record.runId)}/${configurationUuid(record.operationId)}.${suffix}`;
}

export function parseVerificationConfigTransaction(
  value: unknown
): VerificationConfigTransaction {
  const item = configurationObject(value, [
    "schema",
    "schemaVersion",
    "operationId",
    "runId",
    "operation",
    "origin",
    "decisionId",
    "proposalId",
    "previewId",
    "configBeforeSha256",
    "configAfterSha256",
    "profileId",
    "previousCommandIds",
    "currentCommandIds",
    "sourceSha256",
    "continuation",
    "bootstrapCleared",
    "stage"
  ]);
  if (
    item.schema !== "banzai-verification-config-transaction/v1" ||
    item.schemaVersion !== 1 ||
    !["add", "edit", "remove"].includes(item.operation as string) ||
    !["configuration_decision", "verify_command"].includes(
      item.origin as string
    ) ||
    !["prepared", "applied", "finalized"].includes(item.stage as string) ||
    typeof item.bootstrapCleared !== "boolean"
  )
    transactionInvalid();
  function ids(value: unknown): string[] {
    if (!Array.isArray(value) || value.length > 200) transactionInvalid();
    const result = value.map(configurationId);
    if (new Set(result).size !== result.length) transactionInvalid();
    return result;
  }
  const decisionId =
    item.decisionId === null ? null : configurationUuid(item.decisionId);
  const proposalId =
    item.proposalId === null ? null : configurationUuid(item.proposalId);
  if (
    (item.origin === "configuration_decision" &&
      (decisionId === null ||
        proposalId === null ||
        item.operation !== "add" ||
        item.continuation === null)) ||
    (item.origin === "verify_command" &&
      (decisionId !== null || proposalId !== null))
  )
    transactionInvalid();
  return {
    schema: "banzai-verification-config-transaction/v1",
    schemaVersion: 1,
    operationId: configurationUuid(item.operationId),
    runId: runSegment(configurationText(item.runId)),
    operation: item.operation as VerificationConfigTransaction["operation"],
    origin: item.origin as VerificationConfigTransaction["origin"],
    decisionId,
    proposalId,
    previewId: configurationUuid(item.previewId),
    configBeforeSha256: configurationHash(item.configBeforeSha256),
    configAfterSha256: configurationHash(item.configAfterSha256),
    profileId: configurationId(item.profileId),
    previousCommandIds: ids(item.previousCommandIds),
    currentCommandIds: ids(item.currentCommandIds),
    sourceSha256: configurationHash(item.sourceSha256),
    continuation:
      item.continuation === null
        ? null
        : parseConfigurationContinuation(item.continuation),
    bootstrapCleared: item.bootstrapCleared,
    stage: item.stage as VerificationConfigTransaction["stage"]
  };
}

export async function readVerificationConfig(
  repoRoot: string
): Promise<{ raw: string; config: OrchestratorConfig; sha256: string }> {
  const file = await readCancellationFile(
    repoRoot,
    CONFIG_FILE,
    2 * 1024 * 1024
  );
  if (file.availability === "missing")
    throw new BanzaiError(
      "CONFIG_NOT_FOUND",
      "Run banzai init before configuring verification."
    );
  if (
    file.availability !== "available" ||
    file.text === null ||
    file.fingerprint === null
  )
    throw new BanzaiError(
      "CONFIG_UNREADABLE",
      "Verification setup requires a readable, stable, regular UTF-8 configuration file and safe parent directories."
    );
  return {
    raw: file.text,
    config: parseConfig(JSON.parse(file.text) as unknown),
    sha256: file.fingerprint.digest
  };
}

function minimalDelta(
  before: string,
  after: string
): VerificationConfigDelta | null {
  if (before === after) return null;
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - end - 1] === after[after.length - end - 1]
  )
    end++;
  return {
    start,
    before: before.slice(start, before.length - end),
    after: after.slice(start, after.length - end)
  };
}

export function applyVerificationConfigDelta(
  raw: string,
  deltas: readonly VerificationConfigDelta[],
  reverse = false
): string {
  for (const delta of reverse ? [...deltas].reverse() : deltas) {
    const before = reverse ? delta.after : delta.before;
    const after = reverse ? delta.before : delta.after;
    if (
      !Number.isSafeInteger(delta.start) ||
      delta.start < 0 ||
      raw.slice(delta.start, delta.start + before.length) !== before
    )
      transactionInvalid();
    raw =
      raw.slice(0, delta.start) +
      after +
      raw.slice(delta.start + before.length);
  }
  return raw;
}

export async function previewVerificationConfig(
  repoRoot: string,
  edit: VerificationConfigEdit,
  previewId: string = randomUUID()
): Promise<VerificationConfigPreview> {
  const before = await readVerificationConfig(repoRoot);
  const inspection = await inspectVerificationProject(repoRoot);
  const intermediate = editVerificationConfigBytes(
    before.raw,
    edit.operation === "bootstrap" ? edit : { ...edit, clearBootstrap: false }
  );
  const after =
    edit.operation !== "bootstrap" && edit.clearBootstrap
      ? editVerificationConfigBytes(intermediate, {
          operation: "bootstrap",
          value: undefined
        })
      : intermediate;
  const delta = [
    minimalDelta(before.raw, intermediate),
    minimalDelta(intermediate, after)
  ].filter((value): value is VerificationConfigDelta => value !== null);
  return {
    previewId: configurationUuid(previewId),
    edit,
    configBeforeSha256: before.sha256,
    configAfterSha256: configurationDigest(after),
    sourceSha256: inspection.sourceSha256,
    delta
  };
}

export async function readVerificationConfigTransactions(
  repoRoot: string,
  runId: string
): Promise<VerificationConfigTransaction[]> {
  const relative = transactionDirectory(runId);
  const directory = await safePath(repoRoot, relative, {
    directory: true,
    missing: true
  });
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  );
  if (
    entries.length > 3000 ||
    entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())
  )
    transactionInvalid();
  const results: VerificationConfigTransaction[] = [];
  for (const entry of entries
    .filter((file) => file.name.endsWith(".transaction.json"))
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const bytes = await readBytes(repoRoot, `${relative}/${entry.name}`, {
      limit: 128 * 1024
    });
    if (bytes === null) transactionInvalid();
    const transaction = parseVerificationConfigTransaction(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      ) as unknown
    );
    if (
      transaction.runId !== runId ||
      entry.name !== `${transaction.operationId}.transaction.json`
    )
      transactionInvalid();
    results.push(transaction);
  }
  return results;
}

export function verificationCommandIds(
  config: OrchestratorConfig,
  transactions: readonly VerificationConfigTransaction[] = []
): Set<string> {
  return new Set([
    ...config.verification.profiles.flatMap((profile) =>
      profile.commands.flatMap((command) => (command.id ? [command.id] : []))
    ),
    ...transactions.flatMap((transaction) => [
      ...transaction.previousCommandIds,
      ...transaction.currentCommandIds
    ])
  ]);
}

function assertCommandIdentities(
  before: OrchestratorConfig,
  after: OrchestratorConfig,
  transactions: readonly VerificationConfigTransaction[]
): void {
  if (before.schemaVersion !== 3) return;
  const oldCommands = new Map(
    before.verification.profiles.flatMap((profile) =>
      profile.commands.map((command) => [command.id, command] as const)
    )
  );
  const occupied = verificationCommandIds(before, transactions);
  for (const profile of after.verification.profiles)
    for (const command of profile.commands) {
      if (command.id === undefined) transactionInvalid();
      const old = oldCommands.get(command.id);
      if (
        old
          ? normalizedVerificationCommand(old) !==
            normalizedVerificationCommand(command)
          : occupied.has(command.id)
      ) {
        throw new BanzaiError(
          "VERIFICATION_COMMAND_ID_CONFLICT",
          "A command identity changed or conflicts with retained evidence. Request and confirm a fresh preview."
        );
      }
    }
}

async function writePrivateJson(
  repoRoot: string,
  relative: string,
  value: unknown
): Promise<void> {
  const file = await safePath(repoRoot, relative, { missing: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(value) + "\n");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await safePath(repoRoot, relative, { missing: true });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function assertWriter(
  store: RunStore,
  context?: VerificationConfigContext
): Promise<void> {
  await store.assertLockOwned();
  if (!context) {
    const runId = await store.readActiveRunId();
    if (runId) {
      const state = await store.readState(runId);
      if (state.status !== "done" && state.status !== "cancelled")
        throw new BanzaiError(
          "CONFIGURATION_RUN_UNFINISHED",
          "The unfinished run requires its supported configuration decision or recovery path. Run banzai status."
        );
    }
    return;
  }
  const state = await store.readState(context.runId);
  if (
    !hasConfigurationSetup(state) ||
    state.pendingHumanDecision?.kind !== "configuration_prerequisite" ||
    state.activeAttempt !== null ||
    state.activeProcess !== null ||
    state.status !== "needs_human_decision" ||
    !(await hasRunnerWorkOwnership(store.repoRoot, state.artifactBinding))
  )
    transactionInvalid();
  const history = await readVerificationConfigTransactions(
    store.repoRoot,
    context.runId
  );
  if (
    state.configurationSetup?.transactions.some(
      (id) => !history.some((item) => item.operationId === id)
    )
  )
    transactionInvalid();
  await context.revalidate();
}

function appliedEvent(
  record: VerificationConfigTransaction
): Record<string, unknown> {
  return {
    operationId: record.operationId,
    operation: record.operation,
    origin: record.origin,
    decisionId: record.decisionId,
    proposalId: record.proposalId,
    profileId: record.profileId,
    previousCommandIds: record.previousCommandIds,
    currentCommandIds: record.currentCommandIds,
    configBeforeSha256: record.configBeforeSha256,
    configAfterSha256: record.configAfterSha256,
    bootstrapCleared: record.bootstrapCleared
  };
}

export async function readVerificationConfigConfirmation(
  repoRoot: string,
  record: VerificationConfigTransaction
): Promise<{
  preview: VerificationConfigPreview;
  confirmedBy: string;
  confirmedAt: string;
}> {
  const bytes = await readBytes(
    repoRoot,
    transactionPath(record, "confirmation.json"),
    { limit: 2 * 1024 * 1024 }
  );
  if (bytes === null) transactionInvalid();
  return parseVerificationConfigConfirmation(
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    ) as unknown,
    record
  );
}

export function parseVerificationConfigConfirmation(
  value: unknown,
  record: VerificationConfigTransaction
): {
  preview: VerificationConfigPreview;
  confirmedBy: string;
  confirmedAt: string;
} {
  const confirmation = configurationObject(value, [
    "preview",
    "confirmedBy",
    "confirmedAt"
  ]);
  const preview = configurationObject(confirmation.preview, [
    "previewId",
    "edit",
    "configBeforeSha256",
    "configAfterSha256",
    "sourceSha256",
    "delta"
  ]);
  if (
    preview.previewId !== record.previewId ||
    preview.configBeforeSha256 !== record.configBeforeSha256 ||
    preview.configAfterSha256 !== record.configAfterSha256 ||
    preview.sourceSha256 !== record.sourceSha256
  )
    transactionInvalid();
  if (!Array.isArray(preview.delta) || preview.delta.length > 2)
    transactionInvalid();
  const delta = preview.delta.map((value) => {
    const item = configurationObject(value, ["start", "before", "after"]);
    if (
      !Number.isSafeInteger(item.start) ||
      (item.start as number) < 0 ||
      typeof item.before !== "string" ||
      typeof item.after !== "string"
    )
      transactionInvalid();
    return {
      start: item.start as number,
      before: item.before,
      after: item.after
    };
  });
  const editKeys =
    record.operation === "remove"
      ? ["operation", "profileId", "clearBootstrap"]
      : ["operation", "profile", "clearBootstrap"];
  if (
    record.operation === "edit" &&
    preview.edit &&
    typeof preview.edit === "object" &&
    Object.hasOwn(preview.edit, "commandOrigins")
  )
    editKeys.push("commandOrigins");
  const edit = configurationObject(preview.edit, editKeys);
  if (
    edit.commandOrigins !== undefined &&
    (!Array.isArray(edit.commandOrigins) ||
      edit.commandOrigins.length > 200 ||
      edit.commandOrigins.some(
        (value) =>
          value !== null &&
          (!Number.isSafeInteger(value) || value < 0 || value >= 200)
      ))
  )
    transactionInvalid();
  if (
    edit.operation !== record.operation ||
    typeof edit.clearBootstrap !== "boolean"
  )
    transactionInvalid();
  if (
    edit.operation === "remove"
      ? edit.profileId !== record.profileId || edit.clearBootstrap
      : (edit.profile as { id?: unknown } | null)?.id !== record.profileId
  )
    transactionInvalid();
  const confirmedAt = configurationText(confirmation.confirmedAt, 24);
  if (!Number.isFinite(Date.parse(confirmedAt))) transactionInvalid();
  return {
    preview: {
      previewId: record.previewId,
      edit: edit as unknown as VerificationConfigEdit,
      configBeforeSha256: record.configBeforeSha256,
      configAfterSha256: record.configAfterSha256,
      sourceSha256: record.sourceSha256,
      delta
    },
    confirmedBy: configurationText(confirmation.confirmedBy),
    confirmedAt
  };
}

export async function publishVerificationConfig(
  store: RunStore,
  preview: VerificationConfigPreview,
  confirmedBy: string,
  context?: VerificationConfigContext
): Promise<VerificationConfigTransaction | null> {
  configurationText(confirmedBy);
  if (
    ["BANZAI_RUN_ID", "BANZAI_APPROVAL_DIGEST", "BANZAI_WORKFLOW_DIGEST"].some(
      (name) => Object.hasOwn(process.env, name)
    )
  )
    throw new BanzaiError(
      "CONFIGURATION_MODEL_WRITE_DENIED",
      "Model phases cannot use guided commands to write runner control files. Record missing configuration in Human prerequisites."
    );
  await assertWriter(store, context);
  const before = await readVerificationConfig(store.repoRoot);
  if (
    before.sha256 !== preview.configBeforeSha256 ||
    (await inspectVerificationProject(store.repoRoot)).sourceSha256 !==
      preview.sourceSha256
  )
    drift();
  const after = editVerificationConfigBytes(before.raw, preview.edit);
  if (
    configurationDigest(after) !== preview.configAfterSha256 ||
    applyVerificationConfigDelta(before.raw, preview.delta) !== after
  )
    transactionInvalid();
  const config = parseConfig(JSON.parse(after) as unknown);
  const history = context
    ? await readVerificationConfigTransactions(store.repoRoot, context.runId)
    : [];
  const retained = history.find((item) => item.previewId === preview.previewId);
  if (retained) {
    if (
      !context ||
      retained.stage !== "prepared" ||
      retained.configBeforeSha256 !== preview.configBeforeSha256 ||
      retained.configAfterSha256 !== preview.configAfterSha256 ||
      retained.origin !== context.origin ||
      retained.proposalId !== context.proposalId ||
      retained.decisionId !== context.decisionId ||
      JSON.stringify(retained.continuation) !==
        JSON.stringify(context.continuation)
    )
      transactionInvalid();
    const confirmation = await readVerificationConfigConfirmation(
      store.repoRoot,
      retained
    );
    if (JSON.stringify(confirmation.preview) !== JSON.stringify(preview))
      transactionInvalid();
  }
  assertCommandIdentities(
    before.config,
    config,
    history.filter((item) => item.operationId !== retained?.operationId)
  );
  if (after === before.raw) return null;
  let transaction: VerificationConfigTransaction | null = retained ?? null;
  if (context && !retained) {
    if (preview.edit.operation === "bootstrap") transactionInvalid();
    const profileId =
      preview.edit.operation === "remove"
        ? preview.edit.profileId
        : preview.edit.profile.id;
    const ids = (configuration: OrchestratorConfig) =>
      configuration.schemaVersion !== 3
        ? []
        : (configuration.verification.profiles
            .find((profile) => profile.id === profileId)
            ?.commands.map((command) => command.id ?? configurationInvalid()) ??
          []);
    transaction = parseVerificationConfigTransaction({
      schema: "banzai-verification-config-transaction/v1",
      schemaVersion: 1,
      operationId: randomUUID(),
      runId: context.runId,
      operation: preview.edit.operation,
      origin: context.origin,
      decisionId: context.decisionId,
      proposalId: context.proposalId,
      previewId: preview.previewId,
      configBeforeSha256: preview.configBeforeSha256,
      configAfterSha256: preview.configAfterSha256,
      profileId,
      previousCommandIds: ids(before.config),
      currentCommandIds: ids(config),
      sourceSha256: preview.sourceSha256,
      continuation: context.continuation,
      bootstrapCleared:
        before.config.verification.bootstrap !== undefined &&
        config.verification.bootstrap === undefined,
      stage: "prepared"
    });
    const directory = await safePath(
      store.repoRoot,
      transactionDirectory(context.runId),
      { missing: true, directory: true }
    );
    await mkdir(directory, { mode: 0o700, recursive: true });
    await safePath(store.repoRoot, transactionDirectory(context.runId), {
      directory: true
    });
    await writePrivateJson(
      store.repoRoot,
      transactionPath(transaction, "confirmation.json"),
      { preview, confirmedBy, confirmedAt: new Date().toISOString() }
    );
    await writePrivateJson(
      store.repoRoot,
      transactionPath(transaction, "transaction.json"),
      transaction
    );
  }
  const target = await safePath(store.repoRoot, CONFIG_FILE);
  const mode = (await lstat(target)).mode & 0o777;
  const temporary = `${target}.verification-${transaction?.operationId ?? randomUUID()}.tmp`;
  if (retained) await cleanupConfigurationTemporary(store.repoRoot, retained);
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(after, "utf8");
      await handle.chmod(mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertWriter(store, context);
    if (
      (await readVerificationConfig(store.repoRoot)).sha256 !==
        preview.configBeforeSha256 ||
      (await inspectVerificationProject(store.repoRoot)).sourceSha256 !==
        preview.sourceSha256
    )
      drift();
    const freshHistory = context
      ? (
          await readVerificationConfigTransactions(
            store.repoRoot,
            context.runId
          )
        ).filter((item) => item.operationId !== transaction?.operationId)
      : [];
    assertCommandIdentities(before.config, config, freshHistory);
    await safePath(store.repoRoot, CONFIG_FILE);
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  if (
    (await readVerificationConfig(store.repoRoot)).sha256 !==
    preview.configAfterSha256
  )
    drift();
  if (transaction && context)
    return reconcileVerificationConfig(store, transaction, context);
  return null;
}

async function cleanupConfigurationTemporary(
  repoRoot: string,
  record: VerificationConfigTransaction
): Promise<void> {
  const relative = `${CONFIG_FILE}.verification-${record.operationId}.tmp`;
  const temporary = await readBytes(repoRoot, relative, {
    optional: true,
    limit: 2 * 1024 * 1024
  });
  if (temporary === null) return;
  const filename = await safePath(repoRoot, relative);
  const identity = await lstat(filename);
  const current = await readVerificationConfig(repoRoot);
  if (
    current.sha256 !== record.configAfterSha256 &&
    !(
      record.stage === "prepared" &&
      current.sha256 === record.configBeforeSha256
    )
  )
    transactionInvalid();
  if (configurationDigest(temporary) !== record.configAfterSha256) {
    const confirmation = await readVerificationConfigConfirmation(
      repoRoot,
      record
    );
    const after = Buffer.from(
      applyVerificationConfigDelta(current.raw, confirmation.preview.delta),
      "utf8"
    );
    if (
      record.stage !== "prepared" ||
      current.sha256 !== record.configBeforeSha256 ||
      configurationDigest(after) !== record.configAfterSha256 ||
      !after.subarray(0, temporary.length).equals(temporary)
    )
      transactionInvalid();
  }
  // Compare bytes, including an interrupted UTF-8 code point, without decoding
  // incomplete output. A foreign file or a changed main image is never removed.
  const again = await readBytes(repoRoot, relative, { limit: 2 * 1024 * 1024 });
  const named = await lstat(filename);
  if (
    !again?.equals(temporary) ||
    !named.isFile() ||
    named.isSymbolicLink() ||
    named.dev !== identity.dev ||
    named.ino !== identity.ino ||
    named.size !== identity.size ||
    named.mtimeMs !== identity.mtimeMs ||
    named.ctimeMs !== identity.ctimeMs ||
    (await readVerificationConfig(repoRoot)).sha256 !== current.sha256
  )
    transactionInvalid();
  await unlink(filename);
}

export async function reconcileVerificationConfig(
  store: RunStore,
  record: VerificationConfigTransaction,
  context: VerificationConfigContext
): Promise<VerificationConfigTransaction> {
  await assertWriter(store, context);
  if (
    record.runId !== context.runId ||
    record.origin !== context.origin ||
    record.decisionId !== context.decisionId ||
    record.proposalId !== context.proposalId ||
    JSON.stringify(record.continuation) !== JSON.stringify(context.continuation)
  )
    transactionInvalid();
  const confirmation = await readVerificationConfigConfirmation(
    store.repoRoot,
    record
  );
  const current = await readVerificationConfig(store.repoRoot);
  await cleanupConfigurationTemporary(store.repoRoot, record);
  if (
    current.sha256 === record.configBeforeSha256 &&
    record.stage === "prepared"
  )
    return record;
  if (current.sha256 !== record.configAfterSha256) {
    // Applied records prove publication even when a later edit changed its image.
    if (record.stage !== "prepared")
      await store.appendEvent(
        record.runId,
        "config.verification.applied",
        appliedEvent(record)
      );
    drift();
  }
  const before = applyVerificationConfigDelta(
    current.raw,
    confirmation.preview.delta,
    true
  );
  if (
    configurationDigest(before) !== record.configBeforeSha256 ||
    editVerificationConfigBytes(before, confirmation.preview.edit) !==
      current.raw
  )
    transactionInvalid();
  const applied = { ...record, stage: "applied" as const };
  await writePrivateJson(
    store.repoRoot,
    transactionPath(record, "transaction.json"),
    applied
  );
  await store.appendEvent(
    record.runId,
    "config.verification.applied",
    appliedEvent(record)
  );
  if (
    (await inspectVerificationProject(store.repoRoot)).sourceSha256 !==
    record.sourceSha256
  )
    drift();
  await context.revalidate();
  const finalized = { ...record, stage: "finalized" as const };
  await writePrivateJson(
    store.repoRoot,
    transactionPath(record, "transaction.json"),
    finalized
  );
  return finalized;
}
