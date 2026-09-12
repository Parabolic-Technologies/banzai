import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, realpath } from "node:fs/promises";
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

export async function validateGuidanceExtraction(root) {
  const inventory = JSON.parse(
    await readFile(
      path.join(root, "packages/orchestrator/phase-guidance-baseline.json"),
      "utf8"
    )
  );
  // Pins evidence captured from the approved baseline before consumer edits.
  // Comparing two freely edited copies would not establish preserved duties.
  if (
    resourceDigest(JSON.stringify(inventory)) !==
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
      source.orchestratedSha256 &&
      (!orchestrated ||
        resourceDigest(skill.slice(orchestrated.start, orchestrated.end)) !==
          source.orchestratedSha256)
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
