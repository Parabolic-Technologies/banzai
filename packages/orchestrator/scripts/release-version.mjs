import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm
} from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

export const RECOVERY_DIRECTORY = ".banzai-version-set";
export const RECOVERY_GUARD = `${RECOVERY_DIRECTORY}.guard`;
const RECOVERY_GUARD_TEMPORARY = `${RECOVERY_GUARD}.tmp`;

const LEGACY_VERSION_SURFACES = Object.freeze([
  Object.freeze({
    path: "plugins/banzai/.claude-plugin/plugin.json",
    pointer: "/version"
  }),
  Object.freeze({
    path: "plugins/banzai/.codex-plugin/plugin.json",
    pointer: "/version"
  }),
  Object.freeze({ path: "marketplace.json", pointer: "/plugins/0/version" }),
  Object.freeze({
    path: ".agents/plugins/marketplace.json",
    pointer: "/plugins/0/version"
  }),
  Object.freeze({
    path: "packages/orchestrator/package.json",
    pointer: "/version"
  }),
  Object.freeze({
    path: "package-lock.json",
    pointer: "/packages/packages~1orchestrator/version"
  })
]);

export const VERSION_SURFACES = Object.freeze([
  Object.freeze({ path: "package.json", pointer: "/version" }),
  ...LEGACY_VERSION_SURFACES.slice(0, 5),
  Object.freeze({ path: "package-lock.json", pointer: "/version" }),
  Object.freeze({ path: "package-lock.json", pointer: "/packages//version" }),
  LEGACY_VERSION_SURFACES[5]
]);

function groupTargets(surfaces) {
  const grouped = new Map();
  for (const { path: relativePath, pointer } of surfaces) {
    if (!grouped.has(relativePath)) grouped.set(relativePath, []);
    grouped.get(relativePath).push(pointer);
  }
  return Object.freeze(
    [...grouped].map(([relativePath, pointers]) =>
      Object.freeze({ path: relativePath, pointers: Object.freeze(pointers) })
    )
  );
}

const VERSION_TARGETS = groupTargets(VERSION_SURFACES);
const LEGACY_VERSION_TARGETS = groupTargets(LEGACY_VERSION_SURFACES);

function targetsForFormat(format, relativePath = RECOVERY_DIRECTORY) {
  if (format === 1) return LEGACY_VERSION_TARGETS;
  if (format === 2) return VERSION_TARGETS;
  throw failure(
    "INVALID_VERSION_TRANSACTION",
    relativePath,
    "unsupported transaction format"
  );
}

const CANONICAL_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_GUARD_BYTES = 16 * 1024 * 1024;
const TEMP_SUFFIX = ".banzai-version-set.tmp";
const decoder = new TextDecoder("utf-8", { fatal: true });

export class VersionOperationError extends Error {
  constructor(code, relativePath, detail, options = {}) {
    super(`${code} ${relativePath}: ${detail}`, {
      ...(options.cause === undefined ? {} : { cause: options.cause })
    });
    this.name = "VersionOperationError";
    this.code = code;
    this.relativePath = relativePath;
    this.detail = detail;
    this.signal = options.signal ?? null;
  }
}

function failure(code, relativePath, detail, cause) {
  return new VersionOperationError(code, relativePath, detail, {
    ...(cause === undefined ? {} : { cause })
  });
}

function asFailure(error, relativePath, operation) {
  if (error instanceof VersionOperationError) {
    return error;
  }
  return failure(
    "VERSION_FILESYSTEM_ERROR",
    relativePath,
    `${operation} failed`,
    error
  );
}

async function filesystemOperation(relativePath, operation, invoke) {
  try {
    return await invoke();
  } catch (error) {
    throw asFailure(error, relativePath, operation);
  }
}

function isMissing(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export function createNodeVersionFileSystem() {
  return {
    realpath,
    lstat,
    readFile,
    readdir,
    async makeDirectory(target, mode) {
      await mkdir(target, { mode });
    },
    async remove(target, options = {}) {
      await rm(target, options);
    },
    async move(source, target) {
      await rename(source, target);
    },
    async setMode(target, mode) {
      await chmod(target, mode);
    },
    async writeFileDurable(target, contents, mode, exclusive = true) {
      const handle = await open(target, exclusive ? "wx" : "w", mode);
      try {
        await handle.writeFile(contents);
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
    async syncFile(target) {
      const handle = await open(target, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
    async syncDirectory(target) {
      const handle = await open(target, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
  };
}

const defaultFileSystem = createNodeVersionFileSystem();

function repositoryPath(root, relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.posix.isAbsolute(relativePath) ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath.startsWith("../")
  ) {
    throw failure(
      "INVALID_VERSION_POLICY",
      "release-policy.json",
      "version path is not a safe repository-relative path"
    );
  }
  const resolved = path.resolve(root, ...relativePath.split("/"));
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw failure(
      "INVALID_VERSION_POLICY",
      "release-policy.json",
      "version path escapes the repository"
    );
  }
  return resolved;
}

function recoveryPaths(root) {
  const directory = repositoryPath(root, RECOVERY_DIRECTORY);
  return {
    directory,
    guard: repositoryPath(root, RECOVERY_GUARD),
    guardTemporary: repositoryPath(root, RECOVERY_GUARD_TEMPORARY),
    record: path.join(directory, "transaction.json"),
    original: path.join(directory, "original"),
    candidate: path.join(directory, "candidate"),
    ready: path.join(directory, "ready")
  };
}

function backupName(index) {
  return String(index).padStart(2, "0");
}

function targetTempPath(absolutePath) {
  return `${absolutePath}${TEMP_SUFFIX}`;
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function exactKeys(value, expected) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const accepted = [...expected].sort();
  return (
    actual.length === accepted.length &&
    actual.every((key, index) => key === accepted[index])
  );
}

class JsonScanner {
  constructor(source, relativePath) {
    this.source = source;
    this.relativePath = relativePath;
    this.index = 0;
  }

  syntax(detail) {
    throw failure("MALFORMED_VERSION_DOCUMENT", this.relativePath, detail);
  }

  whitespace() {
    while (
      this.index < this.source.length &&
      /[\t\n\r ]/.test(this.source[this.index])
    ) {
      this.index += 1;
    }
  }

  document() {
    this.whitespace();
    const value = this.value();
    this.whitespace();
    if (this.index !== this.source.length) {
      this.syntax("unexpected content after the JSON value");
    }
    return value;
  }

  value() {
    this.whitespace();
    const current = this.source[this.index];
    if (current === '"') {
      return this.string();
    }
    if (current === "{") {
      return this.object();
    }
    if (current === "[") {
      return this.array();
    }
    if (current === "t") {
      return this.literal("true", "boolean");
    }
    if (current === "f") {
      return this.literal("false", "boolean");
    }
    if (current === "n") {
      return this.literal("null", "null");
    }
    if (current === "-" || /\d/.test(current ?? "")) {
      return this.number();
    }
    this.syntax("expected a JSON value");
  }

  string() {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const current = this.source[this.index];
      if (current === '"') {
        this.index += 1;
        const token = this.source.slice(start, this.index);
        let value;
        try {
          value = JSON.parse(token);
        } catch {
          this.syntax("invalid JSON string");
        }
        return { type: "string", start, end: this.index, value };
      }
      if (current === "\\") {
        this.index += 1;
        const escaped = this.source[this.index];
        if (escaped === "u") {
          const digits = this.source.slice(this.index + 1, this.index + 5);
          if (!/^[a-fA-F0-9]{4}$/.test(digits)) {
            this.syntax("invalid Unicode escape in JSON string");
          }
          this.index += 5;
          continue;
        }
        if (escaped === undefined || !/^["\\/bfnrt]$/.test(escaped)) {
          this.syntax("invalid escape in JSON string");
        }
        this.index += 1;
        continue;
      }
      if ((current?.codePointAt(0) ?? 0) < 0x20) {
        this.syntax("unescaped control character in JSON string");
      }
      this.index += 1;
    }
    this.syntax("unterminated JSON string");
  }

  object() {
    const start = this.index;
    const properties = new Map();
    this.index += 1;
    this.whitespace();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return { type: "object", start, end: this.index, properties };
    }
    while (this.index < this.source.length) {
      if (this.source[this.index] !== '"') {
        this.syntax("object key must be a JSON string");
      }
      const key = this.string();
      if (properties.has(key.value)) {
        throw failure(
          "AMBIGUOUS_VERSION_DOCUMENT",
          this.relativePath,
          "duplicate JSON object key is not allowed"
        );
      }
      this.whitespace();
      if (this.source[this.index] !== ":") {
        this.syntax("expected colon after JSON object key");
      }
      this.index += 1;
      const value = this.value();
      properties.set(key.value, value);
      this.whitespace();
      const separator = this.source[this.index];
      if (separator === "}") {
        this.index += 1;
        return { type: "object", start, end: this.index, properties };
      }
      if (separator !== ",") {
        this.syntax("expected comma or closing brace in JSON object");
      }
      this.index += 1;
      this.whitespace();
    }
    this.syntax("unterminated JSON object");
  }

  array() {
    const start = this.index;
    const items = [];
    this.index += 1;
    this.whitespace();
    if (this.source[this.index] === "]") {
      this.index += 1;
      return { type: "array", start, end: this.index, items };
    }
    while (this.index < this.source.length) {
      items.push(this.value());
      this.whitespace();
      const separator = this.source[this.index];
      if (separator === "]") {
        this.index += 1;
        return { type: "array", start, end: this.index, items };
      }
      if (separator !== ",") {
        this.syntax("expected comma or closing bracket in JSON array");
      }
      this.index += 1;
      this.whitespace();
    }
    this.syntax("unterminated JSON array");
  }

  literal(token, type) {
    const start = this.index;
    if (this.source.slice(this.index, this.index + token.length) !== token) {
      this.syntax(`invalid ${type} literal`);
    }
    this.index += token.length;
    return { type, start, end: this.index };
  }

  number() {
    const start = this.index;
    const match = this.source
      .slice(this.index)
      .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (match === null) {
      this.syntax("invalid JSON number");
    }
    this.index += match[0].length;
    return { type: "number", start, end: this.index };
  }
}

function decodeUtf8(contents, relativePath) {
  try {
    return decoder.decode(contents);
  } catch (error) {
    throw failure(
      "MALFORMED_VERSION_DOCUMENT",
      relativePath,
      "document is not valid UTF-8",
      error
    );
  }
}

function parseJsonDocument(contents, relativePath) {
  const source = decodeUtf8(contents, relativePath);
  const root = new JsonScanner(source, relativePath).document();
  try {
    JSON.parse(source);
  } catch (error) {
    throw failure(
      "MALFORMED_VERSION_DOCUMENT",
      relativePath,
      "document is not valid JSON",
      error
    );
  }
  return { source, root };
}

function pointerSegments(pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("/")) {
    throw failure(
      "INVALID_VERSION_POLICY",
      "release-policy.json",
      "version pointer must be an absolute JSON pointer"
    );
  }
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => {
      if (/~(?![01])/u.test(segment)) {
        throw failure(
          "INVALID_VERSION_POLICY",
          "release-policy.json",
          "version pointer contains an invalid escape"
        );
      }
      return segment.replaceAll("~1", "/").replaceAll("~0", "~");
    });
}

function pointerNode(document, pointer, relativePath, allowAbsent = false) {
  let current = document.root;
  const segments = pointerSegments(pointer);
  for (const [index, segment] of segments.entries()) {
    if (current.type === "object") {
      const next = current.properties.get(segment);
      if (next === undefined) {
        if (allowAbsent && index === segments.length - 1) return null;
        throw failure(
          "MISSING_VERSION_FIELD",
          relativePath,
          `missing version field at ${pointer}`
        );
      }
      current = next;
      continue;
    }
    if (current.type === "array") {
      if (!/^(0|[1-9]\d*)$/.test(segment)) {
        throw failure(
          "MISSING_VERSION_FIELD",
          relativePath,
          `invalid array index at ${pointer}`
        );
      }
      const next = current.items[Number(segment)];
      if (next === undefined) {
        throw failure(
          "MISSING_VERSION_FIELD",
          relativePath,
          `missing version field at ${pointer}`
        );
      }
      current = next;
      continue;
    }
    throw failure(
      "MISSING_VERSION_FIELD",
      relativePath,
      `version pointer does not resolve at ${pointer}`
    );
  }
  if (current.type !== "string") {
    throw failure(
      "INVALID_VERSION_VALUE",
      relativePath,
      `version field at ${pointer} must be a string`
    );
  }
  return current;
}

function canonicalVersion(value, relativePath, label, code) {
  if (typeof value !== "string") {
    throw failure(code, relativePath, `${label} must be a string`);
  }
  const match = value.match(CANONICAL_SEMVER);
  if (match === null) {
    throw failure(
      code,
      relativePath,
      `${label} must be a canonical SemVer core value`
    );
  }
  return {
    value,
    components: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])]
  };
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left.components[index] < right.components[index]) {
      return -1;
    }
    if (left.components[index] > right.components[index]) {
      return 1;
    }
  }
  return 0;
}

function replaceVersion(contents, descriptor, targetVersion) {
  const document = parseJsonDocument(contents, descriptor.path);
  const node = pointerNode(document, descriptor.pointer, descriptor.path);
  const originalVersion = canonicalVersion(
    node.value,
    descriptor.path,
    "current version",
    "INVALID_VERSION_VALUE"
  );
  const start = Buffer.byteLength(document.source.slice(0, node.start), "utf8");
  const end = Buffer.byteLength(document.source.slice(0, node.end), "utf8");
  const replacement = Buffer.from(JSON.stringify(targetVersion), "utf8");
  const candidate = Buffer.concat([
    contents.subarray(0, start),
    replacement,
    contents.subarray(end)
  ]);
  const candidateDocument = parseJsonDocument(candidate, descriptor.path);
  const candidateNode = pointerNode(
    candidateDocument,
    descriptor.pointer,
    descriptor.path
  );
  if (candidateNode.value !== targetVersion) {
    throw failure(
      "INVALID_VERSION_CANDIDATE",
      descriptor.path,
      "candidate version did not survive JSON parsing"
    );
  }
  return { candidate, originalVersion };
}

function bootstrapField(relativePath, pointer) {
  return (
    (relativePath === "package.json" && pointer === "/version") ||
    (relativePath === "package-lock.json" &&
      (pointer === "/version" || pointer === "/packages//version"))
  );
}

function targetVersions(contents, descriptor, allowAbsent) {
  const document = parseJsonDocument(contents, descriptor.path);
  return descriptor.pointers.map((pointer) => {
    const node = pointerNode(
      document,
      pointer,
      descriptor.path,
      allowAbsent && bootstrapField(descriptor.path, pointer)
    );
    return node === null
      ? null
      : canonicalVersion(
          node.value,
          descriptor.path,
          `current version at ${pointer}`,
          "INVALID_VERSION_VALUE"
        );
  });
}

function replaceVersions(contents, descriptor, targetVersion, transition) {
  const document = parseJsonDocument(contents, descriptor.path);
  const edits = descriptor.pointers.map((pointer) => {
    const node = pointerNode(
      document,
      pointer,
      descriptor.path,
      transition === "bootstrap" && bootstrapField(descriptor.path, pointer)
    );
    if (node !== null) {
      return {
        start: node.start,
        end: node.end,
        text: JSON.stringify(targetVersion)
      };
    }
    // Only the three fixed bootstrap fields may be inserted. Their parents
    // already exist, as proved by pointer resolution and the full pre-state.
    const parent =
      pointer === "/packages//version"
        ? document.root.properties.get("packages").properties.get("")
        : document.root;
    const start = parent.start + 1;
    const whitespace = document.source.slice(start).match(/^[\t\r\n ]*/)[0];
    const position = start + whitespace.length;
    const suffix = parent.properties.size === 0 ? "" : `,${whitespace}`;
    return {
      start: position,
      end: position,
      text: `"version": ${JSON.stringify(targetVersion)}${suffix}`
    };
  });
  let candidate = contents;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    const start = Buffer.byteLength(
      document.source.slice(0, edit.start),
      "utf8"
    );
    const end = Buffer.byteLength(document.source.slice(0, edit.end), "utf8");
    candidate = Buffer.concat([
      candidate.subarray(0, start),
      Buffer.from(edit.text, "utf8"),
      candidate.subarray(end)
    ]);
  }
  const parsed = parseJsonDocument(candidate, descriptor.path);
  for (const pointer of descriptor.pointers) {
    if (pointerNode(parsed, pointer, descriptor.path).value !== targetVersion) {
      throw failure(
        "INVALID_VERSION_CANDIDATE",
        descriptor.path,
        "candidate fields did not survive JSON parsing"
      );
    }
  }
  return candidate;
}

function safeMode(mode, relativePath) {
  const permissions = mode & 0o7777;
  if (
    (permissions & 0o7000) !== 0 ||
    (permissions & 0o111) !== 0 ||
    (permissions & 0o022) !== 0 ||
    (permissions & 0o600) !== 0o600
  ) {
    throw failure(
      "UNSAFE_VERSION_FILE",
      relativePath,
      "metadata mode must be owner-readable/writable and not executable or group/world-writable"
    );
  }
  return permissions;
}

async function pathExists(fileSystem, absolutePath, relativePath) {
  try {
    await fileSystem.lstat(absolutePath);
    return true;
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }
    throw asFailure(error, relativePath, "inspect path");
  }
}

async function canonicalRepositoryRoot(root, fileSystem) {
  const requested = path.resolve(root);
  return await filesystemOperation(".", "resolve repository root", () =>
    fileSystem.realpath(requested)
  );
}

async function readFixedFile(root, relativePath, fileSystem, enforceMode) {
  const absolutePath = repositoryPath(root, relativePath);
  const resolved = await filesystemOperation(
    relativePath,
    "resolve fixed file",
    () => fileSystem.realpath(absolutePath)
  );
  if (resolved !== absolutePath) {
    throw failure(
      "UNSAFE_VERSION_FILE",
      relativePath,
      "fixed path must not traverse a symbolic link"
    );
  }
  const stats = await filesystemOperation(
    relativePath,
    "inspect fixed file",
    () => fileSystem.lstat(absolutePath)
  );
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw failure(
      "UNSAFE_VERSION_FILE",
      relativePath,
      "fixed path must be a regular file"
    );
  }
  const mode = enforceMode
    ? safeMode(stats.mode, relativePath)
    : stats.mode & 0o7777;
  const contents = await filesystemOperation(
    relativePath,
    "read fixed file",
    () => fileSystem.readFile(absolutePath)
  );
  return { absolutePath, contents, mode };
}

async function loadVersionPolicy(root, fileSystem) {
  const policyFile = await readFixedFile(
    root,
    "release-policy.json",
    fileSystem,
    false
  );
  const parsed = parseJsonDocument(policyFile.contents, "release-policy.json");
  const policy = JSON.parse(parsed.source);
  const matches = (entry, surface) =>
    exactKeys(entry, ["path", "pointer"]) &&
    entry.path === surface.path &&
    entry.pointer === surface.pointer;
  if (
    policy?.schemaVersion !== 1 ||
    !exactKeys(policy?.project, ["versionAuthority", "lockfileMirrors"]) ||
    !matches(policy.project.versionAuthority, VERSION_SURFACES[0]) ||
    !Array.isArray(policy.project.lockfileMirrors) ||
    policy.project.lockfileMirrors.length !== 2 ||
    policy.project.lockfileMirrors.some(
      (entry, index) => !matches(entry, VERSION_SURFACES[index + 6])
    ) ||
    !exactKeys(policy?.plugin, [
      "versionMirrors",
      "jsonDocuments",
      "requiredPaths"
    ]) ||
    !Array.isArray(policy.plugin.versionMirrors) ||
    policy.plugin.versionMirrors.length !== 4 ||
    policy.plugin.versionMirrors.some(
      (entry, index) => !matches(entry, VERSION_SURFACES[index + 1])
    )
  ) {
    throw failure(
      "INVALID_VERSION_POLICY",
      "release-policy.json",
      "root authority and ordered mirrors do not match the fixed release train"
    );
  }
  const orchestrator = policy.orchestrator;
  if (
    !exactKeys(orchestrator, [
      "packageVersionMirror",
      "lockfileMirror",
      "lockfileVersionPointer"
    ]) ||
    orchestrator.packageVersionMirror !== VERSION_SURFACES[5].path ||
    orchestrator.lockfileMirror !== VERSION_SURFACES[8].path ||
    orchestrator.lockfileVersionPointer !== VERSION_SURFACES[8].pointer
  ) {
    throw failure(
      "INVALID_VERSION_POLICY",
      "release-policy.json",
      "orchestrator mirrors do not match the fixed release train"
    );
  }
  if (
    !exactKeys(policy?.versionTransaction, ["recoveryDirectory"]) ||
    policy.versionTransaction.recoveryDirectory !== RECOVERY_DIRECTORY
  ) {
    throw failure(
      "INVALID_VERSION_POLICY",
      "release-policy.json",
      "version transaction directory is not the accepted fixed path"
    );
  }
  return VERSION_TARGETS;
}

async function assertNoTransaction(root, fileSystem) {
  const recovery = recoveryPaths(root);
  for (const [absolutePath, relativePath] of [
    [recovery.directory, RECOVERY_DIRECTORY],
    [recovery.guard, RECOVERY_GUARD],
    [recovery.guardTemporary, RECOVERY_GUARD_TEMPORARY]
  ]) {
    if (await pathExists(fileSystem, absolutePath, relativePath)) {
      throw failure(
        "UNRESOLVED_VERSION_TRANSACTION",
        relativePath,
        "recover the retained transaction before setting another version"
      );
    }
  }
}

async function prepareTargets(
  root,
  descriptors,
  targetVersion,
  fileSystem,
  format = 2
) {
  const prepared = [];
  for (const [index, descriptor] of descriptors.entries()) {
    const snapshot = await readFixedFile(
      root,
      descriptor.path,
      fileSystem,
      true
    );
    if (
      await pathExists(
        fileSystem,
        targetTempPath(snapshot.absolutePath),
        descriptor.path
      )
    ) {
      throw failure(
        "UNSAFE_VERSION_FILE",
        descriptor.path,
        "fixed transaction temporary file already exists"
      );
    }
    prepared.push({
      index,
      path: descriptor.path,
      pointers: descriptor.pointers,
      absolutePath: snapshot.absolutePath,
      mode: snapshot.mode,
      original: snapshot.contents,
      originalVersions: targetVersions(
        snapshot.contents,
        descriptor,
        format === 2
      ),
      originalDigest: sha256(snapshot.contents)
    });
  }
  const target = canonicalVersion(
    targetVersion,
    "version-set.mjs",
    "target version",
    "INVALID_VERSION_ARGUMENT"
  );
  const transition = validateCurrentState(prepared, target, format);
  for (const entry of prepared) {
    entry.candidate =
      format === 1
        ? replaceVersion(
            entry.original,
            { path: entry.path, pointer: entry.pointers[0] },
            targetVersion
          ).candidate
        : replaceVersions(entry.original, entry, targetVersion, transition);
    entry.candidateDigest = sha256(entry.candidate);
  }
  return prepared;
}

function validateCurrentState(prepared, target, format = 2) {
  const versions = prepared.flatMap((entry) => entry.originalVersions);
  const values = versions.map((version) => version?.value ?? null);
  if (format === 1) {
    const initial =
      values.slice(0, 4).every((value) => value === "1.18.1") &&
      values.slice(4).every((value) => value === "0.8.2");
    if (initial && target.value === "1.19.0") return "initial";
  } else {
    const bootstrap = values.every((value, index) =>
      [0, 6, 7].includes(index) ? value === null : value === "1.19.0"
    );
    if (bootstrap && target.value === "1.19.0") return "bootstrap";
  }
  if (
    versions.some((version) => version === null) ||
    !values.every((value) => value === values[0])
  ) {
    throw failure(
      "INVALID_VERSION_TRANSITION",
      "release-policy.json",
      format === 1
        ? "legacy state is neither the initial migration nor six-way equal"
        : "current fields are neither the exact 1.19.0 bootstrap nor nine-way equal"
    );
  }
  if (compareVersions(target, versions[0]) <= 0) {
    throw failure(
      "INVALID_VERSION_TRANSITION",
      "release-policy.json",
      "forward target must be strictly greater than the current release-train version"
    );
  }
  return "forward";
}

function transactionRecord(prepared, targetVersion, ownerPid) {
  return {
    format: 2,
    ownerPid,
    targetVersion,
    transition: validateCurrentState(
      prepared,
      canonicalVersion(
        targetVersion,
        RECOVERY_DIRECTORY,
        "target version",
        "INVALID_VERSION_TRANSACTION"
      )
    ),
    files: prepared.map((entry) => ({
      index: entry.index,
      path: entry.path,
      pointers: entry.pointers,
      mode: entry.mode,
      originalDigest: entry.originalDigest,
      candidateDigest: entry.candidateDigest
    }))
  };
}

async function writeTransactionFile(
  fileSystem,
  absolutePath,
  relativePath,
  contents
) {
  await filesystemOperation(
    relativePath,
    "write durable transaction file",
    () => fileSystem.writeFileDurable(absolutePath, contents, 0o600, true)
  );
}

async function persistTransaction(
  root,
  prepared,
  targetVersion,
  ownerPid,
  fileSystem,
  state
) {
  const recovery = recoveryPaths(root);
  try {
    await fileSystem.makeDirectory(recovery.directory, 0o700);
    state.created = true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw failure(
        "UNRESOLVED_VERSION_TRANSACTION",
        RECOVERY_DIRECTORY,
        "another or retained version transaction already exists"
      );
    }
    throw asFailure(error, RECOVERY_DIRECTORY, "create transaction directory");
  }
  await filesystemOperation(
    RECOVERY_DIRECTORY,
    "sync repository directory",
    () => fileSystem.syncDirectory(root)
  );
  const record = Buffer.from(
    `${JSON.stringify(
      transactionRecord(prepared, targetVersion, ownerPid),
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeTransactionFile(
    fileSystem,
    recovery.record,
    `${RECOVERY_DIRECTORY}/transaction.json`,
    record
  );
  await filesystemOperation(
    `${RECOVERY_DIRECTORY}/original`,
    "create original-backup directory",
    () => fileSystem.makeDirectory(recovery.original, 0o700)
  );
  await filesystemOperation(
    `${RECOVERY_DIRECTORY}/candidate`,
    "create candidate-backup directory",
    () => fileSystem.makeDirectory(recovery.candidate, 0o700)
  );
  for (const entry of prepared) {
    const name = backupName(entry.index);
    await writeTransactionFile(
      fileSystem,
      path.join(recovery.original, name),
      `${RECOVERY_DIRECTORY}/original/${name}`,
      entry.original
    );
    await writeTransactionFile(
      fileSystem,
      path.join(recovery.candidate, name),
      `${RECOVERY_DIRECTORY}/candidate/${name}`,
      entry.candidate
    );
  }
  await filesystemOperation(
    `${RECOVERY_DIRECTORY}/original`,
    "sync original-backup directory",
    () => fileSystem.syncDirectory(recovery.original)
  );
  await filesystemOperation(
    `${RECOVERY_DIRECTORY}/candidate`,
    "sync candidate-backup directory",
    () => fileSystem.syncDirectory(recovery.candidate)
  );
  await filesystemOperation(
    RECOVERY_DIRECTORY,
    "sync prepared transaction directory",
    () => fileSystem.syncDirectory(recovery.directory)
  );
  await writeTransactionFile(
    fileSystem,
    recovery.ready,
    `${RECOVERY_DIRECTORY}/ready`,
    Buffer.alloc(0)
  );
  await filesystemOperation(
    RECOVERY_DIRECTORY,
    "sync transaction directory",
    () => fileSystem.syncDirectory(recovery.directory)
  );
}

async function assertReplaceableTarget(entry, fileSystem) {
  const resolved = await filesystemOperation(entry.path, "resolve target", () =>
    fileSystem.realpath(entry.absolutePath)
  );
  if (resolved !== entry.absolutePath) {
    throw failure(
      "UNSAFE_VERSION_FILE",
      entry.path,
      "target path changed to or through a symbolic link"
    );
  }
  const stats = await filesystemOperation(entry.path, "inspect target", () =>
    fileSystem.lstat(entry.absolutePath)
  );
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw failure(
      "UNSAFE_VERSION_FILE",
      entry.path,
      "target must remain a regular file"
    );
  }
}

async function atomicReplace(entry, contents, fileSystem) {
  await assertReplaceableTarget(entry, fileSystem);
  const temporary = targetTempPath(entry.absolutePath);
  await filesystemOperation(
    entry.path,
    "remove stale transaction temporary",
    () => fileSystem.remove(temporary, { force: true })
  );
  await filesystemOperation(entry.path, "write replacement temporary", () =>
    fileSystem.writeFileDurable(temporary, contents, 0o600, true)
  );
  await filesystemOperation(entry.path, "preserve target mode", () =>
    fileSystem.setMode(temporary, entry.mode)
  );
  await filesystemOperation(entry.path, "sync replacement mode", () =>
    fileSystem.syncFile(temporary)
  );
  await filesystemOperation(entry.path, "replace target", () =>
    fileSystem.move(temporary, entry.absolutePath)
  );
  await filesystemOperation(entry.path, "sync target directory", () =>
    fileSystem.syncDirectory(path.dirname(entry.absolutePath))
  );
}

async function targetMatches(entry, contents, fileSystem) {
  try {
    const snapshot = await filesystemOperation(
      entry.path,
      "read target",
      async () => {
        await assertReplaceableTarget(entry, fileSystem);
        const stats = await fileSystem.lstat(entry.absolutePath);
        const raw = await fileSystem.readFile(entry.absolutePath);
        return { raw, mode: safeMode(stats.mode, entry.path) };
      }
    );
    return snapshot.mode === entry.mode && snapshot.raw.equals(contents);
  } catch {
    return false;
  }
}

async function verifyTargets(prepared, kind, targetVersion, fileSystem) {
  const unresolved = [];
  for (const entry of prepared) {
    const expected = kind === "candidate" ? entry.candidate : entry.original;
    try {
      await assertReplaceableTarget(entry, fileSystem);
      const stats = await fileSystem.lstat(entry.absolutePath);
      const contents = await fileSystem.readFile(entry.absolutePath);
      if (
        safeMode(stats.mode, entry.path) !== entry.mode ||
        !contents.equals(expected)
      ) {
        unresolved.push(entry.path);
        continue;
      }
      if (kind === "candidate") {
        const document = parseJsonDocument(contents, entry.path);
        if (
          entry.pointers.some(
            (pointer) =>
              pointerNode(document, pointer, entry.path).value !== targetVersion
          )
        ) {
          unresolved.push(entry.path);
        }
      }
    } catch {
      unresolved.push(entry.path);
    }
  }
  return unresolved;
}

async function cleanupTransaction(
  root,
  prepared,
  record,
  fileSystem,
  beforeCommit = () => undefined
) {
  const recovery = recoveryPaths(root);
  await ensureCleanupGuard(root, prepared, record, fileSystem);
  await inspectCoexistingJournal(root, prepared, record, fileSystem);
  await filesystemOperation(
    RECOVERY_DIRECTORY,
    "remove transaction state",
    () =>
      fileSystem.remove(recovery.directory, { recursive: true, force: true })
  );
  await filesystemOperation(
    RECOVERY_DIRECTORY,
    "sync transaction removal",
    () => fileSystem.syncDirectory(root)
  );
  await beforeCommit();
  await removeCleanupGuard(root, fileSystem);
}

async function restorePreparedTargets(root, prepared, record, fileSystem) {
  const failures = new Set();
  for (const entry of prepared) {
    if (await targetMatches(entry, entry.original, fileSystem)) {
      try {
        await filesystemOperation(
          entry.path,
          "remove transaction temporary during restoration",
          () =>
            fileSystem.remove(targetTempPath(entry.absolutePath), {
              force: true
            })
        );
        await filesystemOperation(
          entry.path,
          "sync restored target directory",
          () => fileSystem.syncDirectory(path.dirname(entry.absolutePath))
        );
      } catch {
        failures.add(entry.path);
      }
      continue;
    }
    try {
      await atomicReplace(entry, entry.original, fileSystem);
    } catch {
      failures.add(entry.path);
    }
  }
  for (const relativePath of await verifyTargets(
    prepared,
    "original",
    null,
    fileSystem
  )) {
    failures.add(relativePath);
  }
  if (failures.size > 0) {
    return { restored: false, unresolved: [...failures] };
  }
  try {
    await cleanupTransaction(root, prepared, record, fileSystem);
  } catch {
    return {
      restored: false,
      unresolved: [RECOVERY_DIRECTORY, RECOVERY_GUARD]
    };
  }
  return { restored: true, unresolved: [] };
}

function cancellationFailure(signal) {
  if (!signal?.aborted) {
    return null;
  }
  if (signal.reason instanceof VersionOperationError) {
    return signal.reason;
  }
  return failure(
    "VERSION_SET_CANCELLED",
    RECOVERY_DIRECTORY,
    "version synchronization was cancelled"
  );
}

function throwIfCancelled(signal) {
  const error = cancellationFailure(signal);
  if (error !== null) {
    throw error;
  }
}

export function signalAbortReason(signal) {
  if (signal !== "SIGINT" && signal !== "SIGTERM") {
    throw failure(
      "INVALID_VERSION_SIGNAL",
      "version-set.mjs",
      "only SIGINT and SIGTERM are handled"
    );
  }
  return new VersionOperationError(
    "VERSION_SET_INTERRUPTED",
    RECOVERY_DIRECTORY,
    `received ${signal}`,
    { signal }
  );
}

function restoredFailure(error) {
  const source = asFailure(
    error,
    RECOVERY_DIRECTORY,
    "version synchronization"
  );
  return new VersionOperationError(
    source.code,
    source.relativePath,
    `${source.detail}; exact originals restored`,
    {
      cause: source,
      ...(source.signal === null ? {} : { signal: source.signal })
    }
  );
}

export async function setProjectVersion(options) {
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  const target = canonicalVersion(
    options.targetVersion,
    "version-set.mjs",
    "target version",
    "INVALID_VERSION_ARGUMENT"
  );
  if (!Number.isSafeInteger(options.ownerPid) || options.ownerPid <= 0) {
    throw failure(
      "INVALID_VERSION_OWNER",
      "version-set.mjs",
      "owner PID must be a positive safe integer"
    );
  }
  throwIfCancelled(options.signal);
  const root = await canonicalRepositoryRoot(options.root, fileSystem);
  const descriptors = await loadVersionPolicy(root, fileSystem);
  await assertNoTransaction(root, fileSystem);
  const prepared = await prepareTargets(
    root,
    descriptors,
    target.value,
    fileSystem
  );
  const transition = validateCurrentState(prepared, target);
  const record = transactionRecord(prepared, target.value, options.ownerPid);
  throwIfCancelled(options.signal);
  const originalDrift = await verifyTargets(
    prepared,
    "original",
    null,
    fileSystem
  );
  if (originalDrift.length > 0) {
    throw failure(
      "VERSION_PRECONDITION_CHANGED",
      originalDrift[0],
      "version metadata changed during preflight"
    );
  }

  const transaction = { created: false };
  try {
    await persistTransaction(
      root,
      prepared,
      target.value,
      options.ownerPid,
      fileSystem,
      transaction
    );
    throwIfCancelled(options.signal);
    for (const entry of prepared) {
      throwIfCancelled(options.signal);
      if (!(await targetMatches(entry, entry.original, fileSystem))) {
        throw failure(
          "VERSION_PRECONDITION_CHANGED",
          entry.path,
          "version metadata changed after transaction preparation"
        );
      }
      await atomicReplace(entry, entry.candidate, fileSystem);
      throwIfCancelled(options.signal);
    }
    const candidateDrift = await verifyTargets(
      prepared,
      "candidate",
      target.value,
      fileSystem
    );
    if (candidateDrift.length > 0) {
      throw failure(
        "VERSION_FINAL_VERIFICATION_FAILED",
        candidateDrift[0],
        "final reread did not match the prepared candidate"
      );
    }
    throwIfCancelled(options.signal);
    await cleanupTransaction(root, prepared, record, fileSystem, () =>
      throwIfCancelled(options.signal)
    );
    return {
      version: target.value,
      transition,
      fieldCount: VERSION_SURFACES.length,
      paths: prepared.map((entry) => entry.path)
    };
  } catch (error) {
    if (!transaction.created) {
      throw asFailure(error, RECOVERY_DIRECTORY, "version synchronization");
    }
    const restoration = await restorePreparedTargets(
      root,
      prepared,
      record,
      fileSystem
    );
    if (!restoration.restored) {
      throw failure(
        "VERSION_RESTORE_FAILED",
        RECOVERY_DIRECTORY,
        `unresolved targets: ${restoration.unresolved.join(", ")}`,
        error
      );
    }
    throw restoredFailure(error);
  }
}

function transactionFileRecord(
  value,
  recordPath = `${RECOVERY_DIRECTORY}/transaction.json`
) {
  const descriptors = targetsForFormat(value?.format, recordPath);
  const modern = value.format === 2;
  if (
    !exactKeys(
      value,
      modern
        ? ["format", "ownerPid", "targetVersion", "transition", "files"]
        : ["format", "ownerPid", "targetVersion", "files"]
    ) ||
    !Number.isSafeInteger(value.ownerPid) ||
    value.ownerPid <= 0 ||
    !Array.isArray(value.files) ||
    value.files.length !== descriptors.length ||
    (modern && !["bootstrap", "forward"].includes(value.transition))
  ) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      recordPath,
      "transaction record has an unsupported shape"
    );
  }
  canonicalVersion(
    value.targetVersion,
    recordPath,
    "target version",
    "INVALID_VERSION_TRANSACTION"
  );
  for (const [index, file] of value.files.entries()) {
    const descriptor = descriptors[index];
    if (
      !exactKeys(file, [
        "index",
        "path",
        modern ? "pointers" : "pointer",
        "mode",
        "originalDigest",
        "candidateDigest"
      ]) ||
      file.index !== index ||
      file.path !== descriptor.path ||
      (modern
        ? !Array.isArray(file.pointers) ||
          file.pointers.length !== descriptor.pointers.length ||
          file.pointers.some(
            (pointer, at) => pointer !== descriptor.pointers[at]
          )
        : file.pointer !== descriptor.pointers[0]) ||
      !Number.isSafeInteger(file.mode) ||
      typeof file.originalDigest !== "string" ||
      !SHA256.test(file.originalDigest) ||
      typeof file.candidateDigest !== "string" ||
      !SHA256.test(file.candidateDigest)
    ) {
      throw failure(
        "INVALID_VERSION_TRANSACTION",
        recordPath,
        `transaction file ${index} does not match the fixed release surface`
      );
    }
    safeMode(file.mode, recordPath);
  }
  return value;
}

function transactionRecordsEqual(left, right) {
  return (
    left.format === right.format &&
    left.ownerPid === right.ownerPid &&
    left.targetVersion === right.targetVersion &&
    left.transition === right.transition &&
    left.files.length === right.files.length &&
    left.files.every((file, index) => {
      const other = right.files[index];
      return (
        file.index === other.index &&
        file.path === other.path &&
        file.pointer === other.pointer &&
        JSON.stringify(file.pointers) === JSON.stringify(other.pointers) &&
        file.mode === other.mode &&
        file.originalDigest === other.originalDigest &&
        file.candidateDigest === other.candidateDigest
      );
    })
  );
}

function cleanupGuardContents(prepared, record) {
  return Buffer.from(
    `${JSON.stringify(
      {
        format: record.format,
        transaction: record,
        originals: prepared.map((entry) => entry.original.toString("base64")),
        candidates: prepared.map((entry) => entry.candidate.toString("base64"))
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function readCleanupGuardBytes(root, fileSystem) {
  const recovery = recoveryPaths(root);
  const stats = await filesystemOperation(
    RECOVERY_GUARD,
    "inspect cleanup guard",
    () => fileSystem.lstat(recovery.guard)
  );
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    (stats.mode & 0o7777) !== 0o600 ||
    stats.size > MAX_GUARD_BYTES
  ) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      RECOVERY_GUARD,
      "cleanup guard must be a bounded private regular file"
    );
  }
  const resolved = await filesystemOperation(
    RECOVERY_GUARD,
    "resolve cleanup guard",
    () => fileSystem.realpath(recovery.guard)
  );
  if (resolved !== recovery.guard) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      RECOVERY_GUARD,
      "cleanup guard must not traverse a symbolic link"
    );
  }
  const contents = await filesystemOperation(
    RECOVERY_GUARD,
    "read cleanup guard",
    () => fileSystem.readFile(recovery.guard)
  );
  if (contents.length > MAX_GUARD_BYTES) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      RECOVERY_GUARD,
      "cleanup guard exceeds its bounded size"
    );
  }
  return contents;
}

function decodeGuardBuffer(value, relativePath) {
  if (
    typeof value !== "string" ||
    !CANONICAL_BASE64.test(value) ||
    value.length > MAX_GUARD_BYTES * 2
  ) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      relativePath,
      "cleanup guard backup must be canonical base64"
    );
  }
  const contents = Buffer.from(value, "base64");
  if (contents.toString("base64") !== value) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      relativePath,
      "cleanup guard backup must be canonical base64"
    );
  }
  return contents;
}

function retainedPreparedTarget(root, record, index, original, candidate) {
  const descriptor = targetsForFormat(record.format)[index];
  const file = record.files[index];
  if (
    sha256(original) !== file.originalDigest ||
    sha256(candidate) !== file.candidateDigest
  ) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      descriptor.path,
      "retained backup digest does not match the transaction record"
    );
  }
  let originalVersions;
  let expectedCandidate;
  try {
    originalVersions = targetVersions(
      original,
      descriptor,
      record.format === 2 && record.transition === "bootstrap"
    );
    expectedCandidate =
      record.format === 1
        ? replaceVersion(
            original,
            { path: descriptor.path, pointer: descriptor.pointers[0] },
            record.targetVersion
          ).candidate
        : replaceVersions(
            original,
            descriptor,
            record.targetVersion,
            record.transition
          );
  } catch (error) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      descriptor.path,
      "retained version fields cannot prove the candidate",
      error
    );
  }
  if (!candidate.equals(expectedCandidate)) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      descriptor.path,
      "retained candidate changes bytes outside the fixed version fields"
    );
  }
  return {
    index,
    path: descriptor.path,
    pointers: descriptor.pointers,
    absolutePath: repositoryPath(root, descriptor.path),
    mode: file.mode,
    original,
    candidate,
    originalVersions,
    originalDigest: file.originalDigest,
    candidateDigest: file.candidateDigest
  };
}

function validateRetainedState(prepared, record) {
  try {
    const target = canonicalVersion(
      record.targetVersion,
      RECOVERY_DIRECTORY,
      "retained target",
      "INVALID_VERSION_TRANSACTION"
    );
    const transition = validateCurrentState(prepared, target, record.format);
    if (record.format === 2 && transition !== record.transition) {
      throw new Error("retained transition does not match the originals");
    }
  } catch (error) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      RECOVERY_DIRECTORY,
      "retained originals do not prove the recorded transition",
      error
    );
  }
}

async function loadCleanupGuard(root, fileSystem) {
  const contents = await readCleanupGuardBytes(root, fileSystem);
  let value;
  try {
    const parsed = parseJsonDocument(contents, RECOVERY_GUARD);
    value = JSON.parse(parsed.source);
  } catch (error) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      RECOVERY_GUARD,
      "cleanup guard is malformed",
      error
    );
  }
  if (
    !exactKeys(value, ["format", "transaction", "originals", "candidates"]) ||
    ![1, 2].includes(value.format) ||
    value.transaction?.format !== value.format ||
    !Array.isArray(value.originals) ||
    !Array.isArray(value.candidates)
  ) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      RECOVERY_GUARD,
      "cleanup guard has an unsupported shape"
    );
  }
  const record = transactionFileRecord(
    value.transaction,
    `${RECOVERY_GUARD}/transaction`
  );
  if (
    value.originals.length !== record.files.length ||
    value.candidates.length !== record.files.length
  ) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      RECOVERY_GUARD,
      "cleanup guard backup count does not match its format"
    );
  }
  const prepared = record.files.map((_, index) =>
    retainedPreparedTarget(
      root,
      record,
      index,
      decodeGuardBuffer(
        value.originals[index],
        `${RECOVERY_GUARD}/originals/${index}`
      ),
      decodeGuardBuffer(
        value.candidates[index],
        `${RECOVERY_GUARD}/candidates/${index}`
      )
    )
  );
  validateRetainedState(prepared, record);
  return { record, prepared };
}

async function ensureCleanupGuard(root, prepared, record, fileSystem) {
  const recovery = recoveryPaths(root);
  const expected = cleanupGuardContents(prepared, record);
  if (expected.length > MAX_GUARD_BYTES) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      RECOVERY_GUARD,
      "cleanup guard exceeds its bounded size"
    );
  }
  if (await pathExists(fileSystem, recovery.guard, RECOVERY_GUARD)) {
    if (
      await pathExists(
        fileSystem,
        recovery.guardTemporary,
        RECOVERY_GUARD_TEMPORARY
      )
    ) {
      throw failure(
        "INVALID_VERSION_TRANSACTION",
        RECOVERY_GUARD_TEMPORARY,
        "published cleanup guard has an unexpected temporary sibling"
      );
    }
    const retained = await readCleanupGuardBytes(root, fileSystem);
    if (!retained.equals(expected)) {
      throw failure(
        "INVALID_VERSION_TRANSACTION",
        RECOVERY_GUARD,
        "retained cleanup guard does not match the active transaction"
      );
    }
    return;
  }
  await filesystemOperation(
    RECOVERY_GUARD_TEMPORARY,
    "remove stale cleanup-guard temporary",
    () => fileSystem.remove(recovery.guardTemporary, { force: true })
  );
  await writeTransactionFile(
    fileSystem,
    recovery.guardTemporary,
    RECOVERY_GUARD_TEMPORARY,
    expected
  );
  await filesystemOperation(RECOVERY_GUARD, "publish cleanup guard", () =>
    fileSystem.move(recovery.guardTemporary, recovery.guard)
  );
  await filesystemOperation(RECOVERY_GUARD, "sync cleanup guard", () =>
    fileSystem.syncDirectory(root)
  );
}

async function removeCleanupGuard(root, fileSystem) {
  const recovery = recoveryPaths(root);
  try {
    await fileSystem.remove(recovery.guard);
  } catch (error) {
    if (!(await pathExists(fileSystem, recovery.guard, RECOVERY_GUARD))) {
      return;
    }
    throw asFailure(error, RECOVERY_GUARD, "remove cleanup guard");
  }
}

async function readInternalFile(
  fileSystem,
  recoveryRoot,
  absolutePath,
  relativePath
) {
  if (!absolutePath.startsWith(`${recoveryRoot}${path.sep}`)) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      relativePath,
      "transaction path escapes the recovery directory"
    );
  }
  const resolved = await filesystemOperation(
    relativePath,
    "resolve transaction file",
    () => fileSystem.realpath(absolutePath)
  );
  if (resolved !== absolutePath) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      relativePath,
      "transaction file must not be a symbolic link"
    );
  }
  const stats = await filesystemOperation(
    relativePath,
    "inspect transaction file",
    () => fileSystem.lstat(absolutePath)
  );
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    (stats.mode & 0o777 & 0o077) !== 0
  ) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      relativePath,
      "transaction file must be private and regular"
    );
  }
  return await filesystemOperation(relativePath, "read transaction file", () =>
    fileSystem.readFile(absolutePath)
  );
}

async function inspectBackupDirectory(
  fileSystem,
  recoveryRoot,
  absolutePath,
  relativePath,
  requireComplete,
  expectedCount,
  expectedContents = null
) {
  if (!(await pathExists(fileSystem, absolutePath, relativePath))) {
    if (requireComplete) {
      throw failure(
        "INVALID_VERSION_TRANSACTION",
        relativePath,
        "ready transaction backup directory is missing"
      );
    }
    return;
  }
  const resolved = await filesystemOperation(
    relativePath,
    "resolve transaction backup directory",
    () => fileSystem.realpath(absolutePath)
  );
  const stats = await filesystemOperation(
    relativePath,
    "inspect transaction backup directory",
    () => fileSystem.lstat(absolutePath)
  );
  if (
    resolved !== absolutePath ||
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    (stats.mode & 0o777 & 0o077) !== 0
  ) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      relativePath,
      "transaction backup path must be a private regular directory"
    );
  }
  const entries = await filesystemOperation(
    relativePath,
    "list transaction backup directory",
    () => fileSystem.readdir(absolutePath)
  );
  const expected = Array.from({ length: expectedCount }, (_, index) =>
    backupName(index)
  );
  if (
    entries.some((entry) => !expected.includes(entry)) ||
    (requireComplete &&
      (entries.length !== expected.length ||
        expected.some((entry) => !entries.includes(entry))))
  ) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      relativePath,
      requireComplete
        ? "ready transaction backup set is incomplete or contains extra entries"
        : "pre-ready transaction contains an unexpected backup entry"
    );
  }
  for (const entry of entries) {
    const contents = await readInternalFile(
      fileSystem,
      recoveryRoot,
      path.join(absolutePath, entry),
      `${relativePath}/${entry}`
    );
    if (
      expectedContents !== null &&
      !contents.equals(expectedContents[Number(entry)])
    ) {
      throw failure(
        "INVALID_VERSION_TRANSACTION",
        `${relativePath}/${entry}`,
        "coexisting journal backup does not match the cleanup guard"
      );
    }
  }
}

function parseRetainedTransactionRecord(raw, relativePath) {
  let parsed;
  try {
    parsed = parseJsonDocument(raw, relativePath);
  } catch (error) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      relativePath,
      "transaction record is malformed",
      error
    );
  }
  let value;
  try {
    value = JSON.parse(parsed.source);
  } catch (error) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      relativePath,
      "transaction record is not valid JSON",
      error
    );
  }
  return transactionFileRecord(value, relativePath);
}

async function inspectTransactionDirectory(root, fileSystem) {
  const recovery = recoveryPaths(root);
  let directoryStats;
  try {
    directoryStats = await fileSystem.lstat(recovery.directory);
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw asFailure(error, RECOVERY_DIRECTORY, "inspect transaction directory");
  }
  if (
    !directoryStats.isDirectory() ||
    directoryStats.isSymbolicLink() ||
    (directoryStats.mode & 0o777 & 0o077) !== 0
  ) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      RECOVERY_DIRECTORY,
      "transaction path must be a private regular directory"
    );
  }
  const resolved = await filesystemOperation(
    RECOVERY_DIRECTORY,
    "resolve transaction directory",
    () => fileSystem.realpath(recovery.directory)
  );
  if (resolved !== recovery.directory) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      RECOVERY_DIRECTORY,
      "transaction directory must not traverse a symbolic link"
    );
  }
  const rootEntries = await filesystemOperation(
    RECOVERY_DIRECTORY,
    "list transaction directory",
    () => fileSystem.readdir(recovery.directory)
  );
  const expectedRootEntries = new Set([
    "transaction.json",
    "original",
    "candidate",
    "ready"
  ]);
  if (rootEntries.some((entry) => !expectedRootEntries.has(entry))) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      RECOVERY_DIRECTORY,
      "transaction directory contains an unexpected entry"
    );
  }
  return { recovery, rootEntries };
}

async function inspectCoexistingJournal(root, prepared, record, fileSystem) {
  const inspected = await inspectTransactionDirectory(root, fileSystem);
  if (inspected === null) {
    return;
  }
  const { recovery, rootEntries } = inspected;
  if (rootEntries.includes("transaction.json")) {
    const relativePath = `${RECOVERY_DIRECTORY}/transaction.json`;
    const raw = await readInternalFile(
      fileSystem,
      recovery.directory,
      recovery.record,
      relativePath
    );
    const retained = parseRetainedTransactionRecord(raw, relativePath);
    if (!transactionRecordsEqual(retained, record)) {
      throw failure(
        "INVALID_VERSION_TRANSACTION",
        relativePath,
        "coexisting journal record does not match the cleanup guard"
      );
    }
  }
  if (rootEntries.includes("ready")) {
    const marker = await readInternalFile(
      fileSystem,
      recovery.directory,
      recovery.ready,
      `${RECOVERY_DIRECTORY}/ready`
    );
    if (marker.length !== 0) {
      throw failure(
        "INVALID_VERSION_TRANSACTION",
        `${RECOVERY_DIRECTORY}/ready`,
        "ready marker must be empty"
      );
    }
  }
  await inspectBackupDirectory(
    fileSystem,
    recovery.directory,
    recovery.original,
    `${RECOVERY_DIRECTORY}/original`,
    false,
    prepared.length,
    prepared.map((entry) => entry.original)
  );
  await inspectBackupDirectory(
    fileSystem,
    recovery.directory,
    recovery.candidate,
    `${RECOVERY_DIRECTORY}/candidate`,
    false,
    prepared.length,
    prepared.map((entry) => entry.candidate)
  );
}

async function loadTransaction(root, fileSystem) {
  const inspected = await inspectTransactionDirectory(root, fileSystem);
  if (inspected === null) {
    throw failure(
      "NO_VERSION_TRANSACTION",
      RECOVERY_DIRECTORY,
      "no retained version transaction exists"
    );
  }
  const { recovery, rootEntries } = inspected;
  const raw = await readInternalFile(
    fileSystem,
    recovery.directory,
    recovery.record,
    `${RECOVERY_DIRECTORY}/transaction.json`
  );
  const record = parseRetainedTransactionRecord(
    raw,
    `${RECOVERY_DIRECTORY}/transaction.json`
  );
  const ready = rootEntries.includes("ready");
  await inspectBackupDirectory(
    fileSystem,
    recovery.directory,
    recovery.original,
    `${RECOVERY_DIRECTORY}/original`,
    ready,
    record.files.length
  );
  await inspectBackupDirectory(
    fileSystem,
    recovery.directory,
    recovery.candidate,
    `${RECOVERY_DIRECTORY}/candidate`,
    ready,
    record.files.length
  );
  if (ready) {
    const marker = await readInternalFile(
      fileSystem,
      recovery.directory,
      recovery.ready,
      `${RECOVERY_DIRECTORY}/ready`
    );
    if (marker.length !== 0) {
      throw failure(
        "INVALID_VERSION_TRANSACTION",
        `${RECOVERY_DIRECTORY}/ready`,
        "ready marker must be empty"
      );
    }
  }
  return { recovery, record, ready };
}

export function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ESRCH"
    ) {
      return false;
    }
    return true;
  }
}

async function recoveryPreparedTargets(root, transaction, fileSystem) {
  const prepared = [];
  for (const [index] of transaction.record.files.entries()) {
    const name = backupName(index);
    const original = await readInternalFile(
      fileSystem,
      transaction.recovery.directory,
      path.join(transaction.recovery.original, name),
      `${RECOVERY_DIRECTORY}/original/${name}`
    );
    const candidate = await readInternalFile(
      fileSystem,
      transaction.recovery.directory,
      path.join(transaction.recovery.candidate, name),
      `${RECOVERY_DIRECTORY}/candidate/${name}`
    );
    prepared.push(
      retainedPreparedTarget(
        root,
        transaction.record,
        index,
        original,
        candidate
      )
    );
  }
  validateRetainedState(prepared, transaction.record);
  return prepared;
}

async function verifyPreReadyOriginals(root, descriptors, record, fileSystem) {
  const mismatches = [];
  for (const [index, descriptor] of descriptors.entries()) {
    try {
      const snapshot = await readFixedFile(
        root,
        descriptor.path,
        fileSystem,
        true
      );
      if (
        snapshot.mode !== record.files[index].mode ||
        sha256(snapshot.contents) !== record.files[index].originalDigest
      ) {
        mismatches.push(descriptor.path);
      }
    } catch {
      mismatches.push(descriptor.path);
    }
  }
  return mismatches;
}

async function preReadyPreparedTargets(root, descriptors, record, fileSystem) {
  const prepared = await prepareTargets(
    root,
    descriptors,
    record.targetVersion,
    fileSystem,
    record.format
  );
  validateRetainedState(prepared, record);
  const mismatches = prepared
    .filter(
      (entry, index) =>
        entry.mode !== record.files[index].mode ||
        entry.originalDigest !== record.files[index].originalDigest ||
        entry.candidateDigest !== record.files[index].candidateDigest
    )
    .map((entry) => entry.path);
  if (mismatches.length > 0) {
    throw failure(
      "INVALID_VERSION_TRANSACTION",
      RECOVERY_DIRECTORY,
      `pre-ready state cannot reconstruct cleanup evidence: ${mismatches.join(", ")}`
    );
  }
  return prepared;
}

async function assertRecoveryTargets(root, prepared, fileSystem) {
  for (const entry of prepared) {
    let snapshot;
    try {
      snapshot = await readFixedFile(root, entry.path, fileSystem, true);
    } catch (error) {
      throw failure(
        "INVALID_VERSION_TRANSACTION",
        entry.path,
        "current recovery target cannot be verified",
        error
      );
    }
    if (
      snapshot.mode !== entry.mode ||
      (!snapshot.contents.equals(entry.original) &&
        !snapshot.contents.equals(entry.candidate))
    ) {
      throw failure(
        "INVALID_VERSION_TRANSACTION",
        entry.path,
        "current recovery target differs from the retained original and candidate"
      );
    }
  }
}

export async function recoverProjectVersion(options) {
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  const root = await canonicalRepositoryRoot(options.root, fileSystem);
  const recovery = recoveryPaths(root);
  const hasGuard = await pathExists(fileSystem, recovery.guard, RECOVERY_GUARD);
  const hasGuardTemporary = await pathExists(
    fileSystem,
    recovery.guardTemporary,
    RECOVERY_GUARD_TEMPORARY
  );
  let guarded = null;
  let transaction = null;
  if (hasGuard) {
    if (hasGuardTemporary) {
      throw failure(
        "INVALID_VERSION_TRANSACTION",
        RECOVERY_GUARD_TEMPORARY,
        "published cleanup guard has an unexpected temporary sibling"
      );
    }
    guarded = await loadCleanupGuard(root, fileSystem);
    await inspectCoexistingJournal(
      root,
      guarded.prepared,
      guarded.record,
      fileSystem
    );
  } else {
    try {
      transaction = await loadTransaction(root, fileSystem);
    } catch (error) {
      if (
        hasGuardTemporary &&
        error instanceof VersionOperationError &&
        error.code === "NO_VERSION_TRANSACTION"
      ) {
        throw failure(
          "INVALID_VERSION_TRANSACTION",
          RECOVERY_GUARD_TEMPORARY,
          "incomplete cleanup guard has no retained transaction directory",
          error
        );
      }
      throw error;
    }
  }
  const record = guarded?.record ?? transaction.record;
  const descriptors = targetsForFormat(record.format);
  const isAlive = options.isProcessAlive ?? processIsAlive;
  if (isAlive(record.ownerPid)) {
    throw failure(
      "VERSION_TRANSACTION_ACTIVE",
      guarded === null ? RECOVERY_DIRECTORY : RECOVERY_GUARD,
      "recorded owner PID is live or may have been reused; recovery refused"
    );
  }
  if (guarded !== null) {
    await assertRecoveryTargets(root, guarded.prepared, fileSystem);
    const restoration = await restorePreparedTargets(
      root,
      guarded.prepared,
      record,
      fileSystem
    );
    if (!restoration.restored) {
      throw failure(
        "VERSION_RESTORE_FAILED",
        RECOVERY_GUARD,
        `unresolved targets: ${restoration.unresolved.join(", ")}`
      );
    }
    return {
      action: "restored",
      paths: guarded.prepared.map((entry) => entry.path)
    };
  }
  if (!transaction.ready) {
    const mismatches = await verifyPreReadyOriginals(
      root,
      descriptors,
      record,
      fileSystem
    );
    if (mismatches.length > 0) {
      throw failure(
        "INVALID_VERSION_TRANSACTION",
        RECOVERY_DIRECTORY,
        `pre-ready state cannot prove untouched originals: ${mismatches.join(", ")}`
      );
    }
    const prepared = await preReadyPreparedTargets(
      root,
      descriptors,
      record,
      fileSystem
    );
    await cleanupTransaction(root, prepared, record, fileSystem);
    return { action: "cleaned", paths: [] };
  }

  const prepared = await recoveryPreparedTargets(root, transaction, fileSystem);
  await assertRecoveryTargets(root, prepared, fileSystem);
  const restoration = await restorePreparedTargets(
    root,
    prepared,
    record,
    fileSystem
  );
  if (!restoration.restored) {
    throw failure(
      "VERSION_RESTORE_FAILED",
      RECOVERY_DIRECTORY,
      `unresolved targets: ${restoration.unresolved.join(", ")}`
    );
  }
  return {
    action: "restored",
    paths: prepared.map((entry) => entry.path)
  };
}

export function formatVersionOperationError(error) {
  if (error instanceof VersionOperationError) {
    return error.message;
  }
  return "VERSION_OPERATION_FAILED version-set.mjs: unexpected version operation failure";
}
