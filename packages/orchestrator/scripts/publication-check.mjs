import { readFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
const execute = promisify(execFile);
const HASH = /^[0-9a-f]{64}$/u;
const privatePath =
  /(?:^|\/)\.banzai\/(?:work|runs|preparation)(?:\/|$)|(?:^|\/)\.banzai\/archive-manifest\.json$|(?:^|\/)(?:\.banzai-version-set|\.banzai-archive-[^/]+|\.banzai-restore-[^/]+)(?:\/|$)/u;
const secretPath =
  /(?:^|\/)(?:\.ssh|\.aws|\.gnupg|auth\.json|credentials(?:\.json)?|\.env(?:\.[^/]+)?)(?:\/|$)|\.(?:pem|key|p12|pfx)$/iu;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fail(code, resource, message) {
  throw new Error(`${code} ${resource}: ${message}`);
}
function exact(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}
function safeName(name) {
  if (
    !name ||
    name.length > 500 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    [...name].some(
      (character) =>
        character.codePointAt(0) < 32 || character.codePointAt(0) === 127
    ) ||
    name.split("/").some((part) => !part || part === "." || part === "..")
  )
    fail(
      "PUBLICATION_UNSAFE_PATH",
      "payload",
      "Entry path is not a safe relative file."
    );
  return name;
}
export function parsePublicationPolicy(value) {
  if (
    !exact(value, ["schema", "schemaVersion", "mode", "entries"]) ||
    value.schema !== "banzai-publication-inventory/v1" ||
    value.schemaVersion !== 1 ||
    !["transition", "clean"].includes(value.mode) ||
    !Array.isArray(value.entries)
  )
    fail(
      "PUBLICATION_POLICY_INVALID",
      "publication-policy.json",
      "Invalid inventory identity or shape."
    );
  const paths = new Set();
  for (const entry of value.entries) {
    if (
      !exact(entry, ["path", "classification", "sha256"]) ||
      ![
        "product",
        "maintainer",
        "example",
        "historical-exposure",
        "internal"
      ].includes(entry.classification)
    )
      fail(
        "PUBLICATION_POLICY_INVALID",
        "publication-policy.json",
        "Invalid classification entry."
      );
    safeName(entry.path);
    if (
      paths.has(entry.path) ||
      privatePath.test(entry.path) ||
      secretPath.test(entry.path) ||
      (entry.classification === "historical-exposure"
        ? !HASH.test(entry.sha256)
        : entry.sha256 !== null)
    )
      fail(
        "PUBLICATION_POLICY_INVALID",
        entry.path,
        "Invalid or duplicate publication identity."
      );
    paths.add(entry.path);
  }
  return value;
}
function scanContents(name, bytes) {
  const text = bytes.toString("utf8");
  // Purposefully bounded signals, not a claim of exhaustive secret detection.
  if (/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/u.test(text))
    fail(
      "PUBLICATION_SECRET_SIGNAL",
      name,
      "Private-key content requires owner handling."
    );
  if (name.endsWith(".json")) {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      /* Other format checks own malformed source JSON. */
    }
    if (
      ["banzai-artifact-archive/v1", "banzai-work-binding/v1"].includes(
        value?.schema
      )
    )
      fail(
        "PUBLICATION_PRIVATE_CONTENT",
        name,
        "An archive or private work instance cannot enter a payload."
      );
  }
  if (name.endsWith(".map")) {
    let map;
    try {
      map = JSON.parse(text);
    } catch {
      fail("PUBLICATION_MAP_INVALID", name, "Source map is invalid JSON.");
    }
    if (
      !Array.isArray(map.sources) ||
      !Array.isArray(map.sourcesContent) ||
      map.sources.length !== map.sourcesContent.length
    )
      fail(
        "PUBLICATION_MAP_INVALID",
        name,
        "Source map lacks its source inventory."
      );
    for (let i = 0; i < map.sources.length; i++) {
      const source = map.sources[i];
      if (
        typeof source !== "string" ||
        privatePath.test(source) ||
        /(?:^|\/)documentation\/(?:features|development-plans|changes)\//u.test(
          source
        ) ||
        secretPath.test(source)
      )
        fail(
          "PUBLICATION_PRIVATE_SOURCE",
          name,
          "Source map includes excluded source identity."
        );
      if (typeof map.sourcesContent[i] !== "string")
        fail(
          "PUBLICATION_MAP_INVALID",
          name,
          "Source map contains missing source bytes."
        );
      scanContents(source, Buffer.from(map.sourcesContent[i]));
    }
  }
}
export function inspectPublicationFiles(
  policy,
  files,
  { distribution = "source" } = {}
) {
  parsePublicationPolicy(policy);
  const inventory = new Map(policy.entries.map((entry) => [entry.path, entry]));
  let historicalExposure = 0;
  for (const [original, bytes] of files) {
    let name = original;
    if (distribution === "npm") {
      if (!name.startsWith("package/"))
        fail(
          "PUBLICATION_PACKAGE_INVALID",
          name,
          "npm entries require the package root."
        );
      name = `packages/orchestrator/${name.slice(8)}`;
      if (
        !new Set([
          "packages/orchestrator/package.json",
          "packages/orchestrator/README.md",
          "packages/orchestrator/LICENSE",
          "packages/orchestrator/NOTICE",
          "packages/orchestrator/dist/banzai.mjs",
          "packages/orchestrator/dist/banzai.mjs.map"
        ]).has(name)
      )
        fail(
          "PUBLICATION_PACKAGE_INVALID",
          name,
          "Unexpected npm payload file."
        );
    } else if (distribution === "plugin" && !name.startsWith("plugins/banzai/"))
      name = `plugins/banzai/${name}`;
    safeName(name);
    if (
      privatePath.test(name) ||
      /^\.banzai\/(?:active-run\.json|runner\.lock|archive-manifest\.json|\.artifact-init\.lock)$/u.test(
        name
      ) ||
      secretPath.test(name) ||
      /(?:^|\/)\.git(?:\/|$)/u.test(name)
    )
      fail(
        "PUBLICATION_PRIVATE_PATH",
        name,
        "Private evidence or repository control cannot be published."
      );
    const entry = inventory.get(name);
    if (entry?.classification === "internal")
      fail(
        "PUBLICATION_INTERNAL",
        name,
        "Internal workflow evidence is excluded."
      );
    if (entry?.classification === "historical-exposure") {
      if (policy.mode !== "transition" || sha(bytes) !== entry.sha256)
        fail(
          "PUBLICATION_HISTORICAL_EXPOSURE",
          name,
          "Only exact reviewed historical bytes are allowed in transition mode."
        );
      historicalExposure++;
    } else if (
      (name.startsWith("documentation/") ||
        name.startsWith("plugins/banzai/") ||
        /\.(?:md|svg|png|jpg|webp)$/iu.test(name)) &&
      !entry
    )
      fail(
        "PUBLICATION_UNCLASSIFIED",
        name,
        "Documentation and product resources require explicit classification."
      );
    scanContents(name, bytes);
  }
  return {
    schema: "banzai-publication-result/v1",
    schemaVersion: 1,
    mode: policy.mode,
    fileCount: files.size,
    historicalExposure,
    classification: historicalExposure
      ? "retained-historical-exposure"
      : "classified-public-surface"
  };
}
/** Read tar bytes without extracting links or path names into a filesystem. */
export function readTar(bytes) {
  const tar =
    bytes[0] === 0x1f && bytes[1] === 0x8b
      ? gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 })
      : bytes;
  const files = new Map();
  let pendingName = null;
  const field = (block, from, to) =>
    block.subarray(from, to).toString("utf8").split("\0")[0];
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) break;
    const checksum = parseInt(field(header, 148, 156).trim(), 8);
    const actualChecksum = header.reduce(
      (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
      0
    );
    if (checksum !== actualChecksum)
      fail(
        "PUBLICATION_ARCHIVE_INVALID",
        "archive",
        "Invalid tar header checksum."
      );
    const size = parseInt(field(header, 124, 136).trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > tar.length)
      fail(
        "PUBLICATION_ARCHIVE_INVALID",
        "archive",
        "Invalid tar entry bounds."
      );
    const data = tar.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    const type = field(header, 156, 157);
    const prefix = field(header, 345, 500);
    let name =
      pendingName ?? `${prefix ? prefix + "/" : ""}${field(header, 0, 100)}`;
    pendingName = null;
    if (type === "x" || type === "g") {
      for (let index = 0; index < data.length;) {
        const space = data.indexOf(32, index);
        const lengthText = data.subarray(index, space).toString("ascii");
        const length = Number(lengthText);
        if (
          space < index ||
          !/^\d+$/u.test(lengthText) ||
          !Number.isSafeInteger(length) ||
          length <= space - index + 1 ||
          index + length > data.length ||
          data[index + length - 1] !== 10
        )
          fail(
            "PUBLICATION_ARCHIVE_INVALID",
            "archive",
            "Invalid PAX record bounds."
          );
        const record = data
          .subarray(space + 1, index + length - 1)
          .toString("utf8");
        const equals = record.indexOf("=");
        const key = record.slice(0, equals);
        if (
          equals < 1 ||
          key === "linkpath" ||
          key === "size" ||
          key.startsWith("GNU.sparse.") ||
          (type === "g" && key === "path")
        )
          fail(
            "PUBLICATION_ARCHIVE_INVALID",
            "archive",
            "Unsupported PAX entry semantics."
          );
        if (key === "path") pendingName = record.slice(equals + 1);
        index += length;
      }
      continue;
    }
    if (type === "L") {
      pendingName = data
        .toString("utf8")
        .replace(/\0.*$/su, "")
        .replace(/\n$/u, "");
      continue;
    }
    name = name.replace(/^\.\//u, "").replace(/\/$/u, "");
    if (type === "5") {
      if (name) safeName(name);
      continue;
    }
    if (type !== "0" && type !== "")
      fail(
        "PUBLICATION_ARCHIVE_INVALID",
        name,
        "Links and special entries are excluded."
      );
    safeName(name);
    if (files.has(name))
      fail("PUBLICATION_ARCHIVE_INVALID", name, "Duplicate tar entry.");
    files.set(name, Buffer.from(data));
  }
  return files;
}
export async function collectPublicationTree(root, selection = "working") {
  const git = async (args) =>
    (
      await execute("git", ["-C", root, ...args], {
        encoding: "buffer",
        maxBuffer: 128 * 1024 * 1024
      })
    ).stdout;
  const names = (
    await git(
      selection === "staged" || selection === "working"
        ? ["ls-files", "-z"]
        : ["ls-tree", "-r", "--name-only", "-z", selection]
    )
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const files = new Map();
  for (const name of names) {
    safeName(name);
    if (selection === "working") {
      const metadata = await lstat(path.join(root, name)).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (metadata === null) continue;
      if (!metadata.isFile() || metadata.isSymbolicLink())
        fail(
          "PUBLICATION_UNSAFE_PATH",
          name,
          "Published entries must be regular files."
        );
      files.set(name, await readFile(path.join(root, name)));
    } else {
      const metadata = (
        await git(
          selection === "staged"
            ? ["ls-files", "--stage", "--", name]
            : ["ls-tree", selection, "--", name]
        )
      ).toString("utf8");
      if (!/^(?:100644|100755) /u.test(metadata))
        fail(
          "PUBLICATION_UNSAFE_PATH",
          name,
          "Git tree contains a link or special entry."
        );
      files.set(
        name,
        await git([
          "show",
          selection === "staged" ? `:${name}` : `${selection}:${name}`
        ])
      );
    }
  }
  return files;
}
export async function checkPublication({
  root,
  selection = "working",
  archive,
  distribution = "source"
}) {
  const files = archive
    ? readTar(await readFile(archive))
    : await collectPublicationTree(root, selection);
  const policyBytes =
    distribution === "source" ? files.get("publication-policy.json") : null;
  const policy = parsePublicationPolicy(
    JSON.parse(
      policyBytes?.toString("utf8") ??
        (await readFile(path.join(root, "publication-policy.json"), "utf8"))
    )
  );
  return inspectPublicationFiles(policy, files, { distribution });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = { root: process.cwd() };
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 2) {
      const key = {
        "--root": "root",
        "--tree": "selection",
        "--archive": "archive",
        "--distribution": "distribution"
      }[args[i]];
      if (!key || !args[i + 1])
        throw new Error(
          "Use --root, --tree working|staged|<git-tree>, --archive or --distribution source|npm|plugin."
        );
      options[key] = args[i + 1];
    }
    process.stdout.write(
      JSON.stringify(await checkPublication(options)) + "\n"
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
