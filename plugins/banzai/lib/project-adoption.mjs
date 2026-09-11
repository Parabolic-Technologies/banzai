import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import path from "node:path";
const ADOPTION_LABELS = {
  ready: "Project guidance ready",
  setup_required: "Project setup required",
  migration_required: "Project migration required",
  needs_attention: "Project guidance needs attention",
};
const SCAFFOLD_MARKER = "<!-- banzai-scaffold: unfilled -->";
const GUIDANCE_MAX_BYTES = 256 * 1024;
const METADATA_MAX_BYTES = 64 * 1024;
const MANIFEST_SECTIONS = [
  "Project Overview",
  "Platform & Tooling",
  "Architecture",
  "Project Structure",
  "Key Modules & Components",
  "State & Data Flow",
  "Dependencies",
  "Testing",
  "Conventions",
  "Technical Constraints & Decision Index",
];
const POLICY_HEADINGS = [
  "Decision Consultation",
  "Test Assurance",
  "Security Assurance",
  "Engineering Quality",
  "Plan Task Completion Evidence",
];
const SOURCE_FILES = [
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  "package.json",
  ".claude-plugin/marketplace.json",
  "plugins/banzai/.claude-plugin/plugin.json",
  "plugins/banzai/.codex-plugin/plugin.json",
];
function contained(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
async function readAdoptionFile(root, file, limit) {
  const missing = { text: null, problem: null };
  const unsafe = { text: null, problem: "unsafe or unreadable file" };
  try {
    let candidate = root;
    for (const part of file.split("/")) {
      candidate = path.join(candidate, part);
      try {
        await lstat(candidate);
      } catch (error) {
        if (error.code === "ENOENT") return missing;
        return unsafe;
      }
      if (!contained(root, await realpath(candidate))) return unsafe;
    }
    const resolved = await realpath(candidate);
    const before = await stat(resolved);
    if (!before.isFile() || (before.mode & 292) === 0) return unsafe;
    if (before.size > limit)
      return { text: null, problem: "file exceeds size limit" };
    const handle = await open(
      resolved,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    );
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.dev !== before.dev ||
        opened.ino !== before.ino
      )
        return unsafe;
      const buffer = Buffer.alloc(limit + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(
          buffer,
          length,
          buffer.length - length,
          length,
        );
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > limit)
        return { text: null, problem: "file exceeds size limit" };
      const after = await handle.stat();
      const current = await stat(candidate);
      if (
        [opened, after, current].some(
          (value) =>
            value.dev !== before.dev ||
            value.ino !== before.ino ||
            value.size !== before.size ||
            value.mtimeMs !== before.mtimeMs ||
            value.ctimeMs !== before.ctimeMs,
        ) ||
        (await realpath(candidate)) !== resolved ||
        length !== after.size
      ) {
        return { text: null, problem: "file changed during inspection" };
      }
      return {
        text: new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.subarray(0, length),
        ),
        problem: null,
      };
    } finally {
      await handle.close();
    }
  } catch {
    return unsafe;
  }
}
function visibleMarkdown(text) {
  let comment = false;
  let fence = null;
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    if (fence !== null) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(raw);
      if (close?.[1]?.[0] === fence.marker && close[1].length >= fence.length)
        fence = null;
      continue;
    }
    let line = "";
    let offset = 0;
    while (offset < raw.length) {
      const index = raw.indexOf(comment ? "-->" : "<!--", offset);
      if (index < 0) {
        if (!comment) line += raw.slice(offset);
        break;
      }
      if (!comment) line += raw.slice(offset, index);
      offset = index + (comment ? 3 : 4);
      comment = !comment;
    }
    const start = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (start?.[1]) {
      fence = { marker: start[1].charAt(0), length: start[1].length };
      continue;
    }
    lines.push(line);
  }
  return lines;
}
function headings(text) {
  return new Set(
    visibleMarkdown(text).flatMap((line) => {
      const match = /^ {0,3}##[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
      return match?.[1] ? [match[1]] : [];
    }),
  );
}
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
async function sourceIdentity(root, issues) {
  const metadata = await Promise.all(
    SOURCE_FILES.map((file) =>
      readAdoptionFile(root, file, METADATA_MAX_BYTES),
    ),
  );
  const values = metadata.map((entry, index) => {
    let problem = entry.problem;
    if (entry.text !== null) {
      try {
        const value = JSON.parse(entry.text);
        if (object(value)) return value;
      } catch {}
      problem = "invalid identity metadata";
    }
    if (problem)
      issues.push({
        file: SOURCE_FILES[index] ?? "plugin metadata",
        reason: problem,
        classification: "needs_attention",
      });
    return null;
  });
  const [claude, codex, pkg, marketplace, nestedClaude, nestedCodex] = values;
  const roots = [claude, codex].filter((value) => value !== null);
  const rootCandidate = roots.some((value) => value?.name === "banzai");
  const pluginRoot =
    rootCandidate &&
    roots.every((value) => value?.name === "banzai") &&
    metadata
      .slice(0, 2)
      .every((entry, index) => entry.text === null || values[index] !== null);
  if (rootCandidate && !pluginRoot) {
    issues.push({
      file: ".claude-plugin/plugin.json / .codex-plugin/plugin.json",
      reason: "conflicting source identity",
      classification: "needs_attention",
    });
  }
  const entries = Array.isArray(marketplace?.plugins)
    ? marketplace.plugins.filter(
        (value) => object(value) && value.name === "banzai",
      )
    : [];
  const sourceWorkspace =
    pkg?.name === "banzai-spec-driven-dev" &&
    pkg.private === true &&
    Array.isArray(pkg.workspaces) &&
    pkg.workspaces.includes("packages/*") &&
    entries.length === 1 &&
    object(entries[0]) &&
    entries[0].source === "./plugins/banzai" &&
    nestedClaude?.name === "banzai" &&
    nestedCodex?.name === "banzai";
  if (
    pkg?.name === "banzai-spec-driven-dev" &&
    (entries.length > 1 ||
      [nestedClaude, nestedCodex].some(
        (value) => value && value.name !== "banzai",
      ))
  ) {
    issues.push({
      file: "package.json / plugin metadata",
      reason: "conflicting source identity",
      classification: "needs_attention",
    });
  }
  return (
    !issues.some((issue) => issue.classification === "needs_attention") &&
    (pluginRoot || sourceWorkspace)
  );
}
function inspectManifest(text, issues) {
  for (const line of text.split(/\r?\n/)) {
    if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(line)) break;
    if (line === SCAFFOLD_MARKER) {
      issues.push({
        file: "PROJECT_MANIFEST.md",
        reason: "scaffold marker present",
        classification: "setup_required",
      });
      return;
    }
  }
  const sections = [];
  for (const line of visibleMarkdown(text)) {
    const match =
      /^ {0,3}##[ \t]+(?:\d+\.[ \t]+)?(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (match?.[1]) sections.push({ name: match[1], content: false });
    else if (
      line.trim() &&
      !/^ {0,3}#{1,6}(?:[ \t]|$)/.test(line) &&
      sections.length > 0
    ) {
      const section = sections.at(-1);
      if (section) section.content = true;
    }
  }
  if (
    sections.length !== MANIFEST_SECTIONS.length ||
    sections.some(
      (section, index) =>
        section.name !== MANIFEST_SECTIONS[index] || !section.content,
    )
  ) {
    issues.push({
      file: "PROJECT_MANIFEST.md",
      reason: "required sections missing, empty or out of order",
      classification: "setup_required",
    });
  }
}
async function inspectProjectAdoption(repoRoot, options = {}) {
  const issues = [];
  let root;
  try {
    root = await realpath(repoRoot);
  } catch {
    return {
      classification: "needs_attention",
      label: ADOPTION_LABELS.needs_attention,
      sourceRepository: false,
      files: [],
      issues: [
        {
          file: "AGENTS.md",
          reason: "repository unreadable",
          classification: "needs_attention",
        },
      ],
    };
  }
  const sourceRepository = await sourceIdentity(root, issues);
  const files = options.layoutOnly
    ? ["AGENTS.md", "CLAUDE.md"]
    : ["AGENTS.md", "CLAUDE.md", "PROJECT_MANIFEST.md"];
  const entries = await Promise.all(
    files.map((file) => readAdoptionFile(root, file, GUIDANCE_MAX_BYTES)),
  );
  entries.forEach((entry, index) => {
    if (entry.problem)
      issues.push({
        file: files[index] ?? "guidance",
        reason: entry.problem,
        classification: "needs_attention",
      });
  });
  const agents = entries[0]?.text ?? null;
  const claude = entries[1]?.text ?? null;
  const agentHeadings = headings(agents ?? "");
  const claudeHeadings = headings(claude ?? "");
  const hasPolicy = (set) =>
    POLICY_HEADINGS.some((heading) => set.has(heading));
  if (!entries[0]?.problem && !entries[1]?.problem) {
    if (sourceRepository) {
      if (agents === null)
        issues.push({
          file: "AGENTS.md",
          reason: "missing",
          classification: "setup_required",
        });
    } else if (
      agents !== null &&
      agentHeadings.has("Authority") &&
      agentHeadings.has("Policies") &&
      !/^@/m.test(agents) &&
      !hasPolicy(claudeHeadings)
    ) {
    } else if (
      claudeHeadings.has("Engineering Quality") &&
      !agentHeadings.has("Authority")
    ) {
      issues.push({
        file: "AGENTS.md / CLAUDE.md",
        reason: "legacy Banzai layout: run `project-manifest` to migrate",
        classification: "migration_required",
      });
    } else if (
      ![agentHeadings, claudeHeadings].some(
        (set) => set.has("Authority") || hasPolicy(set),
      )
    ) {
      issues.push({
        file: "AGENTS.md",
        reason:
          agents === null ? "missing" : "Banzai instruction layout absent",
        classification: "setup_required",
      });
    } else {
      issues.push({
        file: "AGENTS.md / CLAUDE.md",
        reason: "partial or conflicting instruction layout",
        classification: "needs_attention",
      });
    }
  }
  if (!options.layoutOnly) {
    const manifest = entries[2];
    if (manifest && !manifest.problem) {
      if (manifest.text === null)
        issues.push({
          file: "PROJECT_MANIFEST.md",
          reason: "missing",
          classification: "setup_required",
        });
      else inspectManifest(manifest.text, issues);
    }
  }
  const classification =
    ["needs_attention", "migration_required", "setup_required"].find((value) =>
      issues.some((issue) => issue.classification === value),
    ) ?? "ready";
  return {
    classification,
    label: ADOPTION_LABELS[classification],
    sourceRepository,
    files: entries.map((entry, index) => ({
      file: files[index] ?? "guidance",
      status: entry.problem
        ? "unreadable"
        : entry.text === null
          ? "missing"
          : "present",
    })),
    issues,
  };
}
function adoptionDiagnostic(result) {
  return [
    result.label,
    ...result.issues.map((issue) => `${issue.file}: ${issue.reason}`),
  ].join(". ");
}
export {
  ADOPTION_LABELS,
  GUIDANCE_MAX_BYTES,
  SCAFFOLD_MARKER,
  adoptionDiagnostic,
  inspectProjectAdoption,
  readAdoptionFile,
};
