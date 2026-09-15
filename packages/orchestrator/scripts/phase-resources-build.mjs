import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

export const PHASE_DEFINITIONS = {
  planning: {
    guidance: ["requirements", "architecture", "planning"],
    policies: [
      "decision-consultation",
      "test-assurance",
      "security-assurance",
      "engineering-quality",
      "plan-task-completion",
      "artifact-storage"
    ],
    conditionalPolicies: ["decision-consultation"]
  },
  implementation: {
    guidance: ["implementation", "assurance", "manifest"],
    policies: [
      "test-assurance",
      "security-assurance",
      "engineering-quality",
      "plan-task-completion",
      "artifact-storage"
    ],
    conditionalPolicies: ["security-assurance"]
  },
  review: {
    guidance: ["review"],
    policies: [
      "test-assurance",
      "security-assurance",
      "engineering-quality",
      "plan-task-completion",
      "artifact-storage"
    ],
    conditionalPolicies: ["plan-task-completion"]
  },
  fix: {
    guidance: ["fix", "manifest"],
    policies: [
      "test-assurance",
      "security-assurance",
      "engineering-quality",
      "plan-task-completion",
      "artifact-storage"
    ],
    conditionalPolicies: ["plan-task-completion"]
  },
  feature: {
    guidance: ["feature", "manifest"],
    policies: [
      "test-assurance",
      "security-assurance",
      "engineering-quality",
      "artifact-storage"
    ],
    conditionalPolicies: []
  },
  "quick-fix": {
    guidance: ["fix", "manifest"],
    policies: [
      "test-assurance",
      "security-assurance",
      "engineering-quality",
      "plan-task-completion",
      "artifact-storage"
    ],
    conditionalPolicies: ["plan-task-completion"]
  }
};

export const INSTRUCTION_RESOURCE_IDS = [
  ...Object.keys(PHASE_DEFINITIONS).map((phase) => `phases/${phase}.md`),
  ...new Set(
    Object.values(PHASE_DEFINITIONS).flatMap((phase) =>
      phase.guidance.map((name) => `guidance/${name}.md`)
    )
  ),
  ...new Set(
    Object.values(PHASE_DEFINITIONS).flatMap((phase) =>
      phase.policies.map((name) => `policies/${name}.md`)
    )
  ),
  "hooks/hooks.json",
  "hooks/spec-gate.cjs"
];
export const GENERATED_PHASE_RESOURCE_PATH =
  "packages/orchestrator/src/phase-resources.ts";
const MAX_RESOURCE_BYTES = 1024 * 1024;

export function resourceDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function normalizeGuidance(text) {
  return text.replace(/\s+/gu, " ").trim();
}

export function markdownSections(text) {
  const starts = [];
  let offset = 0;
  let fence = false;
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    if (line.startsWith("```")) fence = !fence;
    if (!fence && line.startsWith("## ")) {
      starts.push({
        title: line.slice(3).trim(),
        start: offset,
        body: offset + line.length
      });
    }
    offset += line.length;
  }
  if (new Set(starts.map((section) => section.title)).size !== starts.length)
    throw new Error("Duplicate instruction section.");
  return new Map(
    starts.map((section, index) => [
      section.title,
      {
        ...section,
        end: starts[index + 1]?.start ?? text.length
      }
    ])
  );
}

async function declaredResource(root, id) {
  if (!INSTRUCTION_RESOURCE_IDS.includes(id))
    throw new Error("Invalid instruction resource identity.");
  try {
    const directory = await realpath(path.join(root, "plugins/banzai"));
    let target = directory;
    for (const part of id.split("/")) {
      target = path.join(target, part);
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new Error("unsafe resource");
    }
    const handle = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    let bytes;
    try {
      const before = await handle.stat();
      if (
        !before.isFile() ||
        before.size === 0 ||
        before.size > MAX_RESOURCE_BYTES ||
        (await realpath(target)) !== target
      )
        throw new Error("invalid resource");
      const buffer = Buffer.alloc(MAX_RESOURCE_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const read = await handle.read(
          buffer,
          length,
          buffer.length - length,
          length
        );
        if (read.bytesRead === 0) break;
        length += read.bytesRead;
      }
      const after = await handle.stat();
      if (
        length !== before.size ||
        length > MAX_RESOURCE_BYTES ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs
      )
        throw new Error("changing resource");
      bytes = buffer.subarray(0, length);
    } finally {
      await handle.close();
    }
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true
    }).decode(bytes);
    if (!text.trim()) throw new Error("empty resource");
    return { sha256: resourceDigest(bytes), text };
  } catch {
    throw new Error(
      `Instruction resource ${id} is missing, unreadable, unsafe or invalid UTF-8.`
    );
  }
}

export async function phaseResourceData(root) {
  const resources = {};
  for (const id of INSTRUCTION_RESOURCE_IDS) {
    const resource = await declaredResource(root, id);
    resources[id] = id.startsWith("hooks/")
      ? { sha256: resource.sha256 }
      : resource;
  }
  return resources;
}

export async function phaseResourceBytes(root) {
  const resources = await phaseResourceData(root);
  return (
    "// Generated by scripts/phase-resources-build.mjs from canonical plugin resources.\n" +
    "// Run npm run build; checks compare these bytes and never repair them.\n\n" +
    "// prettier-ignore\nexport const PHASE_RESOURCE_DEFINITIONS = " +
    JSON.stringify(PHASE_DEFINITIONS, null, 2) +
    " as const;\n\n" +
    "// prettier-ignore\nexport const EMBEDDED_PHASE_RESOURCES = " +
    JSON.stringify(resources, null, 2) +
    " as const;\n"
  );
}

export async function checkPhaseResourceBytes(root) {
  const expected = Buffer.from(await phaseResourceBytes(root));
  const actual = await readFile(
    path.join(root, GENERATED_PHASE_RESOURCE_PATH)
  ).catch(() => null);
  if (actual === null || !expected.equals(actual)) {
    throw new Error(
      "Generated src/phase-resources.ts is missing or stale. Run `npm run build`."
    );
  }
}

// This is a consumer projection for existing duty checks, not a runtime loader.
export async function instructionConsumerText(root, relativePath) {
  const original = await readFile(path.join(root, relativePath), "utf8");
  if (!/^plugins\/banzai\/skills\/[^/]+\/SKILL\.md$/.test(relativePath))
    return original;
  const names = [
    ...new Set(
      [
        ...original.matchAll(
          /\]\(\.\.\/\.\.\/guidance\/([a-z-]+)\.md#[a-z-]+\)/g
        )
      ].map((match) => match[1])
    )
  ];
  const guidance = [];
  for (const name of names)
    guidance.push((await declaredResource(root, `guidance/${name}.md`)).text);
  return [original, ...guidance].join("\n\n");
}

export async function validateGuidanceExtraction(root, candidate = null) {
  const original = await originalGuidanceBaseline(root);
  const current =
    candidate ?? (await readCurrentGuidanceBaseline(root, original));
  const inventory = current.inventory;
  // Pins evidence captured from the approved baseline before consumer edits.
  // Comparing two freely edited copies would not establish preserved duties.
  if (
    resourceDigest(JSON.stringify(original)) !==
    "77230bb56083c58962d45e113f262010d3969f9e595cae1d06e80e70f9c79361"
  ) {
    throw new Error("Invalid immutable guidance extraction baseline.");
  }
  for (const source of inventory.sources) {
    const skillPath = `plugins/banzai/skills/${source.skill}/SKILL.md`;
    const skill = await readFile(path.join(root, skillPath), "utf8");
    const guidance = (
      await declaredResource(root, `guidance/${source.guidance}.md`)
    ).text;
    const sourceSections = markdownSections(skill);
    const guidanceSections = markdownSections(guidance);
    if (
      JSON.stringify([...guidanceSections.keys()]) !==
      JSON.stringify(source.sections.map((entry) => entry.section))
    )
      throw new Error(`Non-enumerated guidance section: ${source.guidance}.`);
    const firstSection = [...guidanceSections.values()][0];
    const title = source.guidance[0].toUpperCase() + source.guidance.slice(1);
    const preface = `# ${title} Guidance\n\nCanonical portable guidance. The active execution context supplies artifact roles\nand policies; entry, host transport and contract mechanics remain with the caller.\n\n`;
    if (
      normalizeGuidance(guidance.slice(0, firstSection.start)) !==
      normalizeGuidance(preface)
    )
      throw new Error(`Non-enumerated guidance preface: ${source.guidance}.`);
    let skeleton = skill;
    const replacements = [];
    for (const entry of source.sections) {
      const consumer = sourceSections.get(entry.section);
      const portable = guidanceSections.get(entry.section);
      if (
        !consumer ||
        !portable ||
        resourceDigest(
          normalizeGuidance(skill.slice(consumer.body, consumer.end))
        ) !== entry.consumerNormalizedSha256 ||
        resourceDigest(
          normalizeGuidance(guidance.slice(portable.body, portable.end))
        ) !== entry.guidanceNormalizedSha256
      ) {
        throw new Error(
          `Shared guidance or consumer drift: ${source.guidance}/${entry.section}.`
        );
      }
      replacements.push(consumer);
    }
    for (const section of replacements.sort((a, b) => b.body - a.body)) {
      skeleton =
        skeleton.slice(0, section.body) +
        "<extracted guidance>\n" +
        skeleton.slice(section.end);
    }
    if (resourceDigest(skeleton) !== source.skeletonSha256)
      throw new Error(`Non-enumerated skill change: ${source.skill}.`);
    const orchestrated = sourceSections.get("Orchestrated Mode");
    if (
      original.sources.find((entry) => entry.skill === source.skill)
        .orchestratedSha256 &&
      (!orchestrated ||
        resourceDigest(skill.slice(orchestrated.start, orchestrated.end)) !==
          original.sources.find((entry) => entry.skill === source.skill)
            .orchestratedSha256)
    ) {
      throw new Error(`Retained Orchestrated Mode changed: ${source.skill}.`);
    }
  }
  for (const [relativePath, expected] of Object.entries(
    inventory.preservedFiles
  )) {
    let bytes = await readFile(path.join(root, relativePath));
    // ADR-0033 owns version-only release transactions independently of this
    // extraction. Pin every other manifest byte to its original source.
    if (
      /^plugins\/banzai\/\.(?:claude|codex)-plugin\/plugin\.json$/.test(
        relativePath
      )
    ) {
      bytes = Buffer.from(
        bytes
          .toString("utf8")
          .replace(/("version"\s*:\s*)"[^"\n]+"/, '$1"2.3.0"')
      );
    }
    if (resourceDigest(bytes) !== expected) {
      throw new Error(
        `Preserved instruction boundary changed: ${relativePath}.`
      );
    }
  }
  for (const directory of ["phases", "guidance"]) {
    const actual = (
      await readdir(path.join(root, "plugins/banzai", directory))
    ).sort();
    const expected = INSTRUCTION_RESOURCE_IDS.filter((id) =>
      id.startsWith(directory + "/")
    )
      .map((id) => id.split("/")[1])
      .sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(
        `Unexpected instruction resource inventory: ${directory}.`
      );
  }
  for (const id of INSTRUCTION_RESOURCE_IDS.filter((id) =>
    id.startsWith("policies/")
  )) {
    const name = path.basename(id, ".md");
    const text = (await declaredResource(root, id)).text;
    const lines = text
      .split("\n")
      .filter((value) => value.startsWith("- Runner consumers: "));
    const actual = lines[0]
      ?.slice("- Runner consumers: ".length)
      .replace(/\.$/, "")
      .split(", ");
    const expected = Object.entries(PHASE_DEFINITIONS)
      .filter(([, definition]) => definition.policies.includes(name))
      .map(
        ([phase, definition]) =>
          phase +
          (definition.conditionalPolicies.includes(name)
            ? " (conditional)"
            : "")
      );
    if (
      lines.length !== 1 ||
      JSON.stringify(actual) !== JSON.stringify(expected)
    )
      throw new Error(`Runner policy consumer drift: ${id}.`);
  }
  for (const [id, expected] of Object.entries(current.resources)) {
    if (resourceDigest((await declaredResource(root, id)).text) !== expected)
      throw new Error(`Unrecorded instruction resource drift: ${id}.`);
  }
}

/** Compare actual source/plugin archives and npm bytes to one working candidate. */
export async function checkInstructionPayloads(root, { source, plugin, npm }) {
  const resources = await phaseResourceData(root);
  for (const [id, expected] of Object.entries(resources)) {
    for (const [label, files] of [
      ["source", source],
      ["plugin", plugin]
    ]) {
      const bytes = files.get(`plugins/banzai/${id}`);
      if (!bytes || resourceDigest(bytes) !== expected.sha256) {
        throw new Error(
          `INSTRUCTION_PAYLOAD_MISMATCH: ${label} ${id} differs from the candidate.`
        );
      }
    }
  }
  const generated = await phaseResourceBytes(root);
  if (source.get(GENERATED_PHASE_RESOURCE_PATH)?.toString("utf8") !== generated)
    throw new Error(
      "INSTRUCTION_PAYLOAD_MISMATCH: source generated resource module is missing or stale."
    );
  for (const suffix of ["", ".map"]) {
    const sourceBytes = source.get(
      `packages/orchestrator/dist/banzai.mjs${suffix}`
    );
    const npmBytes = npm.get(`package/dist/banzai.mjs${suffix}`);
    if (!sourceBytes || !npmBytes || !sourceBytes.equals(npmBytes))
      throw new Error(
        "INSTRUCTION_PAYLOAD_MISMATCH: source and npm distribution bytes differ."
      );
  }
  const map = JSON.parse(
    npm.get("package/dist/banzai.mjs.map").toString("utf8")
  );
  const indices = map.sources.flatMap((id, index) =>
    /(?:^|\/)src\/phase-resources\.ts$/.test(id) ? [index] : []
  );
  if (indices.length !== 1 || map.sourcesContent[indices[0]] !== generated)
    throw new Error(
      "INSTRUCTION_PAYLOAD_MISMATCH: source map resource bytes are missing or stale."
    );
  // Compile only the trusted deterministic module, never execute payload code.
  const { build } = await import("esbuild");
  const compiled = await build({
    stdin: {
      contents: generated,
      loader: "ts",
      sourcefile: "phase-resources.ts"
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node22"
  });
  const text = compiled.outputFiles[0].text;
  const bundle = npm.get("package/dist/banzai.mjs").toString("utf8");
  for (const name of [
    "PHASE_RESOURCE_DEFINITIONS",
    "EMBEDDED_PHASE_RESOURCES"
  ]) {
    const start = text.indexOf(`var ${name} = {\n`);
    const end = text.indexOf("\n};", start);
    if (start < 0 || end < 0 || !bundle.includes(text.slice(start, end + 3)))
      throw new Error(
        "INSTRUCTION_PAYLOAD_MISMATCH: bundled instruction identities or text differ."
      );
  }
  return {
    resourceCount: INSTRUCTION_RESOURCE_IDS.length,
    distributions: ["source", "plugin", "npm", "source-map"]
  };
}

const GUIDANCE_ROOT_PIN =
  "77230bb56083c58962d45e113f262010d3969f9e595cae1d06e80e70f9c79361";
const CURRENT_BASELINE = "packages/orchestrator/phase-guidance-current.json";
const CURRENT_PIN = "packages/orchestrator/phase-guidance-current.sha256";
const TRANSITION_JOURNAL =
  "packages/orchestrator/.phase-guidance-transition.json";
const SHA256 = /^[a-f0-9]{64}$/u;
const canonical = (value) => JSON.stringify(value);
const identity = (value) => resourceDigest(canonical(value));

function closed(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    canonical(Object.keys(value).sort()) !== canonical([...keys].sort())
  )
    throw new Error(`Invalid instruction baseline ${label}.`);
}

async function baselineFile(root, relative) {
  let current = await realpath(root);
  for (const component of relative.split("/")) {
    current = path.join(current, component);
    const info = await lstat(current);
    if (info.isSymbolicLink())
      throw new Error("Unsafe instruction baseline input.");
  }
  const info = await lstat(current);
  if (!info.isFile() || info.size > 4 * MAX_RESOURCE_BYTES)
    throw new Error("Invalid instruction baseline input.");
  const handle = await open(current, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

export async function originalGuidanceBaseline(root) {
  const original = JSON.parse(
    await baselineFile(
      root,
      "packages/orchestrator/phase-guidance-baseline.json"
    )
  );
  if (identity(original) !== GUIDANCE_ROOT_PIN)
    throw new Error("Invalid immutable guidance extraction baseline.");
  return original;
}

function rootExpectations(original) {
  const entries = [];
  for (const source of original.sources) {
    const skill = `plugins/banzai/skills/${source.skill}/SKILL.md`;
    entries.push([`${skill}#skeleton`, source.skeletonSha256]);
    for (const section of source.sections) {
      entries.push([
        `${skill}#section:${section.section}`,
        section.consumerNormalizedSha256
      ]);
      entries.push([
        `plugins/banzai/guidance/${source.guidance}.md#section:${section.section}`,
        section.guidanceNormalizedSha256
      ]);
    }
  }
  entries.push(...Object.entries(original.preservedFiles));
  return Object.fromEntries(
    entries.sort(([a], [b]) => a.localeCompare(b, "en"))
  );
}

function rawResourceKeys() {
  return INSTRUCTION_RESOURCE_IDS.filter((id) =>
    /^(phases|policies)\//u.test(id)
  ).map((id) => `plugins/banzai/${id}`);
}

function sortedExpectations(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en"))
  );
}

// Exact accepted ADR-0045 annotation images. Neither arbitrary amendment text
// nor changes to retained authority bodies can match this finite allow-list.
const GUIDED_AUTHORITY_AMENDMENTS = new Map([
  [
    "4315eeb4e2bdad29ffd355189ff2798056697c1af59d0c51e1cdd3f75208f05a",
    "e886482951b39fb0ce4bd7009c372d09003338b362c20e58620fa93ba32a74d0"
  ],
  [
    "7c517def603006221bdc76a6a375de54b886fe057716eb659644687607c2917c",
    "eead23c8ed3004f4be2cb1d17c9fbf741ae7c92ed5802dcfc4919887f254cf73"
  ],
  [
    "8a2ad99d64fac27006fd70d612a619343b3b9c11a1a2593313dcfad216cd954e",
    "efa7ec6e30a0ce6df85b59e191b7cf52f27a3afc24acf59022266914dc284456"
  ],
  [
    "83ebca9109222e6eb71dc29ed35fbae13ceb631806b9562f9b6fb9313b28cdd1",
    "88c38f1b6ef9e47a103375a32d2a3e7f70a09b5cc305a49af3f9ecd1f9cb64a9"
  ],
  [
    "84f7a4a841f8023b8277edf276d41e7a30b6bab3635eafe638198c1fb45c4adc",
    "af2564f0fb594a054f563b7b58c6d45e79d52a5ddef5ad3e910f061866bd5aa5"
  ],
  [
    "c53cb16ef8b069121becd16d3884647b9a43c78042fa8d7f90bdf30742537405",
    "1d3f34564c530dbb28debe7555b623f7fda5d7411048da2bbafad7c2a9045c95"
  ],
  [
    "fb3a5d2f308760941a8bea873cf4f15fa1d2ef1d2e7720533b26e83efe180031",
    "3991c3744410bb16a315339dd2ba98bf7d7b54c2d28cf94f31651e092ee14050"
  ],
  [
    "6fcd90b29e0901f00e545a19fa55b1efde8e5c5aa3e410e84f52bee1901d60bc",
    "fe32c4281eb0f73883fc0119afa572ee5421bff7a40bb31792f3138edec07286"
  ],
  [
    "a3c8d696d43eae4d328736088c067d77c01a127e507fd4d1dcc5f97f712b90f8",
    "381cf2e1835246e42ca0363fd43691a0cecb5bfe9e251afc93e48ffb61e2c129"
  ],
  [
    "bf16d01724dcf312af9757fb7e294720b2819050d243f7b81fabf221842c9e5b",
    "0d84943485cf44498981993ee2c7507727509345785aff2bc02b115c8bf75580"
  ]
]);

async function retainedAuthorityMatches(root, text, sha256) {
  const digest = resourceDigest(text);
  if (digest === sha256) return true;
  if (GUIDED_AUTHORITY_AMENDMENTS.get(sha256) !== digest) return false;
  const authority = await baselineFile(
    root,
    "documentation/decisions/0045-guided-verification-setup.md"
  );
  return /^- Status: Accepted\s*$/mu.test(authority);
}

async function validateAuthorities(root, authorities) {
  if (
    !Array.isArray(authorities) ||
    authorities.length === 0 ||
    authorities.length > 20
  )
    throw new Error("Missing accepted instruction transition authority.");
  const seen = new Set();
  for (const authority of authorities) {
    closed(authority, ["path", "sha256", "scope"], "authority");
    if (
      typeof authority.path !== "string" ||
      !/^documentation\/decisions\/\d{4}-[a-z0-9-]+\.md$/u.test(
        authority.path
      ) ||
      !SHA256.test(authority.sha256) ||
      typeof authority.scope !== "string" ||
      !/^[A-Za-z0-9 ,.:;-]{1,160}$/u.test(authority.scope) ||
      seen.has(authority.path)
    )
      throw new Error("Invalid public instruction transition authority.");
    seen.add(authority.path);
    const text = await baselineFile(root, authority.path);
    if (
      !(await retainedAuthorityMatches(root, text, authority.sha256)) ||
      !/^- Status: Accepted\s*$/mu.test(text)
    )
      throw new Error(
        "Instruction transition authority changed or is not Accepted."
      );
  }
}

async function applyTransition(root, original, previous, transition) {
  closed(
    transition,
    ["predecessorSha256", "successorSha256", "authorities", "changes"],
    "transition"
  );
  if (
    transition.predecessorSha256 !== identity(previous) ||
    !SHA256.test(transition.successorSha256)
  )
    throw new Error("Invalid instruction transition predecessor.");
  await validateAuthorities(root, transition.authorities);
  if (
    !Array.isArray(transition.changes) ||
    transition.changes.length === 0 ||
    transition.changes.length > 300
  )
    throw new Error("Invalid instruction transition scope.");
  const allowed = new Set([
    ...Object.keys(rootExpectations(original)),
    ...rawResourceKeys()
  ]);
  const next = { ...previous };
  let last = null;
  for (const change of transition.changes) {
    closed(change, ["key", "before", "after"], "change");
    if (
      !allowed.has(change.key) ||
      (last !== null && last.localeCompare(change.key, "en") >= 0) ||
      !SHA256.test(change.after) ||
      change.before !== (previous[change.key] ?? null) ||
      change.before === change.after ||
      /\/\.(?:claude|codex)-plugin\/plugin\.json|\/hooks\/hooks\.json/u.test(
        change.key
      ) ||
      (change.key === "plugins/banzai/skills/orchestrate/SKILL.md" &&
        !transition.authorities.some(
          (authority) =>
            authority.path ===
            "documentation/decisions/0045-guided-verification-setup.md"
        ))
    )
      throw new Error("Invalid or protected instruction transition scope.");
    last = change.key;
    next[change.key] = change.after;
  }
  const sorted = sortedExpectations(next);
  if (identity(sorted) !== transition.successorSha256)
    throw new Error("Invalid instruction transition successor.");
  return sorted;
}

async function validateCurrent(root, original, current) {
  closed(
    current,
    ["schema", "schemaVersion", "rootSha256", "expectations", "transitions"],
    "envelope"
  );
  if (
    current.schema !== "banzai-instruction-baseline/v1" ||
    current.schemaVersion !== 1 ||
    current.rootSha256 !== GUIDANCE_ROOT_PIN ||
    !Array.isArray(current.transitions) ||
    current.transitions.length > 100
  )
    throw new Error("Invalid current instruction baseline identity.");
  let expected = rootExpectations(original);
  for (const transition of current.transitions)
    expected = await applyTransition(root, original, expected, transition);
  if (canonical(expected) !== canonical(current.expectations))
    throw new Error("Unrecorded current instruction expectations.");
  return expected;
}

function projectInventory(original, expectations) {
  const inventory = structuredClone(original);
  for (const source of inventory.sources) {
    const skill = `plugins/banzai/skills/${source.skill}/SKILL.md`;
    source.skeletonSha256 = expectations[`${skill}#skeleton`];
    for (const entry of source.sections) {
      entry.consumerNormalizedSha256 =
        expectations[`${skill}#section:${entry.section}`];
      entry.guidanceNormalizedSha256 =
        expectations[
          `plugins/banzai/guidance/${source.guidance}.md#section:${entry.section}`
        ];
    }
  }
  for (const file of Object.keys(inventory.preservedFiles))
    inventory.preservedFiles[file] = expectations[file];
  const resources = Object.fromEntries(
    rawResourceKeys()
      .filter((key) => expectations[key])
      .map((key) => [key.slice("plugins/banzai/".length), expectations[key]])
  );
  return { inventory, resources };
}

async function currentBytes(root) {
  const bytes = await baselineFile(root, CURRENT_BASELINE);
  const pin = (await baselineFile(root, CURRENT_PIN)).trim();
  if (!SHA256.test(pin) || resourceDigest(bytes) !== pin)
    throw new Error(
      "Current instruction baseline pin mismatch; finish the explicit transition."
    );
  return bytes;
}

export async function readCurrentGuidanceBaseline(root, original) {
  const current = JSON.parse(await currentBytes(root));
  const expectations = await validateCurrent(root, original, current);
  return projectInventory(original, expectations);
}

async function captureExpectations(root, original) {
  const expected = rootExpectations(original);
  for (const source of original.sources) {
    const skillPath = `plugins/banzai/skills/${source.skill}/SKILL.md`;
    const skill = await baselineFile(root, skillPath);
    const guidance = (
      await declaredResource(root, `guidance/${source.guidance}.md`)
    ).text;
    const sections = markdownSections(skill);
    const portable = markdownSections(guidance);
    if (
      canonical([...portable.keys()]) !==
      canonical(source.sections.map((entry) => entry.section))
    )
      throw new Error(
        "Instruction section inventory cannot change implicitly."
      );
    let skeleton = skill;
    for (const entry of source.sections) {
      const consumer = sections.get(entry.section);
      const section = portable.get(entry.section);
      if (!consumer || !section)
        throw new Error("Missing instruction section.");
      expected[`${skillPath}#section:${entry.section}`] = resourceDigest(
        normalizeGuidance(skill.slice(consumer.body, consumer.end))
      );
      expected[
        `plugins/banzai/guidance/${source.guidance}.md#section:${entry.section}`
      ] = resourceDigest(
        normalizeGuidance(guidance.slice(section.body, section.end))
      );
    }
    for (const section of source.sections
      .map((entry) => sections.get(entry.section))
      .sort((a, b) => b.body - a.body))
      skeleton =
        skeleton.slice(0, section.body) +
        "<extracted guidance>\n" +
        skeleton.slice(section.end);
    expected[`${skillPath}#skeleton`] = resourceDigest(skeleton);
    const orchestrated = sections.get("Orchestrated Mode");
    if (
      source.orchestratedSha256 &&
      (!orchestrated ||
        resourceDigest(skill.slice(orchestrated.start, orchestrated.end)) !==
          source.orchestratedSha256)
    )
      throw new Error(
        "Retained Orchestrated Mode cannot be changed by a transition."
      );
  }
  for (const key of Object.keys(original.preservedFiles)) {
    let text = await baselineFile(root, key);
    if (/\/\.(?:claude|codex)-plugin\/plugin\.json$/u.test(key))
      text = text.replace(/("version"\s*:\s*)"[^"\n]+"/, '$1"2.3.0"');
    expected[key] = resourceDigest(text);
  }
  for (const key of rawResourceKeys())
    expected[key] = resourceDigest(
      (await declaredResource(root, key.slice("plugins/banzai/".length))).text
    );
  return sortedExpectations(expected);
}

/** Explicit authoring only. Normal build/check paths never call this writer. */
export async function evolveGuidanceBaseline(
  root,
  authorization,
  { check = false } = {}
) {
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
  const original = await originalGuidanceBaseline(root);
  let previous;
  let journal;
  try {
    journal = JSON.parse(await baselineFile(root, TRANSITION_JOURNAL));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (journal) {
    closed(journal, ["authorizationSha256", "previous", "next"], "journal");
    if (journal.authorizationSha256 !== identity(authorization))
      throw new Error(
        "Pending instruction transition has different authorization."
      );
    previous = JSON.parse(journal.previous);
    await validateCurrent(root, original, previous);
    for (const [file, oldBytes, newBytes] of [
      [CURRENT_BASELINE, journal.previous, journal.next],
      [
        CURRENT_PIN,
        resourceDigest(journal.previous) + "\n",
        resourceDigest(journal.next) + "\n"
      ]
    ]) {
      const actual = await baselineFile(root, file);
      if (actual !== oldBytes && actual !== newBytes)
        throw new Error("Interrupted instruction transition inputs changed.");
    }
  } else {
    previous = JSON.parse(await currentBytes(root));
    await validateCurrent(root, original, previous);
  }
  const captured = await captureExpectations(root, original);
  const changes = Object.keys(captured)
    .filter((key) => captured[key] !== previous.expectations[key])
    .map((key) => ({
      key,
      before: previous.expectations[key] ?? null,
      after: captured[key]
    }));
  if (changes.length === 0) {
    const last = previous.transitions.at(-1);
    if (
      !last ||
      last.predecessorSha256 !== authorization.predecessorSha256 ||
      canonical(last.authorities) !== canonical(authorization.authorities) ||
      canonical(last.changes.map((entry) => entry.key)) !==
        canonical(authorization.scope)
    )
      throw new Error("No matching authorized instruction transition.");
    await validateGuidanceExtraction(root);
    return { changed: false, sha256: resourceDigest(await currentBytes(root)) };
  }
  if (
    identity(previous.expectations) !== authorization.predecessorSha256 ||
    canonical(changes.map((entry) => entry.key)) !==
      canonical(authorization.scope)
  )
    throw new Error(
      "Instruction changes do not match the authorized predecessor and exact scope."
    );
  const transition = {
    predecessorSha256: authorization.predecessorSha256,
    successorSha256: identity(captured),
    authorities: authorization.authorities,
    changes
  };
  const next = {
    ...previous,
    expectations: captured,
    transitions: [...previous.transitions, transition]
  };
  await validateCurrent(root, original, next);
  const nextBytes = JSON.stringify(next, null, 2) + "\n";
  if (journal && journal.next !== nextBytes)
    throw new Error(
      "Instruction source changed during interrupted transition."
    );
  await validateGuidanceExtraction(root, projectInventory(original, captured));
  if (check) return { changed: true, sha256: resourceDigest(nextBytes) };
  if (!journal) {
    journal = {
      authorizationSha256: identity(authorization),
      previous: await currentBytes(root),
      next: nextBytes
    };
    await writeFile(
      path.join(root, TRANSITION_JOURNAL),
      JSON.stringify(journal) + "\n",
      { flag: "wx", mode: 0o600 }
    );
  }
  for (const [relative, bytes] of [
    [CURRENT_BASELINE, nextBytes],
    [CURRENT_PIN, resourceDigest(nextBytes) + "\n"]
  ]) {
    const temporary = path.join(root, relative + ".pending");
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o644 }).catch(
      async (error) => {
        if (
          error.code !== "EEXIST" ||
          (await baselineFile(root, relative + ".pending")) !== bytes
        )
          throw error;
      }
    );
    await rename(temporary, path.join(root, relative));
  }
  await validateGuidanceExtraction(root);
  await rm(path.join(root, TRANSITION_JOURNAL));
  return { changed: true, sha256: resourceDigest(nextBytes) };
}

/** Read-only proposal facts; these do not authorize or publish a transition. */
export async function describeGuidanceTransition(root) {
  const original = await originalGuidanceBaseline(root);
  const current = JSON.parse(await currentBytes(root));
  await validateCurrent(root, original, current);
  const captured = await captureExpectations(root, original);
  return {
    predecessorSha256: identity(current.expectations),
    changes: Object.keys(captured)
      .filter((key) => captured[key] !== current.expectations[key])
      .map((key) => ({
        key,
        before: current.expectations[key] ?? null,
        after: captured[key]
      }))
  };
}
