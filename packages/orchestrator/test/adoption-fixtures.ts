import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const ADOPTED_AGENTS =
  "# Project rules\n\n## Authority\nUser decisions apply.\n\n## Policies\nUse installed policies.\n";
export const POPULATED_MANIFEST = `# Project
## 1. Project Overview
An empty bootstrap project; application design is Open.
## 2. Platform & Tooling
None; the owner has not selected a runtime.
## 3. Architecture
Recommended (not yet present): decide after requirements.
## 4. Project Structure
Only guidance files exist.
## 5. Key Modules & Components
None; no code has been written.
## 6. State & Data Flow
None; no persisted application state.
## 7. Dependencies
None; additions require approval.
## 8. Testing
None; no executable application to test.
## 9. Conventions
Use <T> for a type parameter when applicable.
## 10. Technical Constraints & Decision Index
No accepted ADRs.
`;

export async function writeAdoptedGuidance(root: string): Promise<void> {
  await writeFile(path.join(root, "AGENTS.md"), ADOPTED_AGENTS);
  await writeFile(path.join(root, "PROJECT_MANIFEST.md"), POPULATED_MANIFEST);
}

export const SOURCE_IDENTITY_FIXTURES = [
  {
    name: "plugin root",
    source: true,
    files: { ".codex-plugin/plugin.json": { name: "banzai" } }
  },
  {
    name: "both plugin roots",
    source: true,
    files: {
      ".codex-plugin/plugin.json": { name: "banzai" },
      ".claude-plugin/plugin.json": { name: "banzai" }
    }
  },
  {
    name: "source workspace",
    source: true,
    files: {
      "package.json": {
        name: "banzai-spec-driven-dev",
        private: true,
        workspaces: ["packages/*"]
      },
      ".claude-plugin/marketplace.json": {
        plugins: [{ name: "banzai", source: "./plugins/banzai" }]
      },
      "plugins/banzai/.claude-plugin/plugin.json": { name: "banzai" },
      "plugins/banzai/.codex-plugin/plugin.json": { name: "banzai" }
    }
  },
  {
    name: "marketplace lookalike",
    source: false,
    files: {
      ".claude-plugin/marketplace.json": {
        name: "banzai",
        plugins: [{ name: "banzai", source: "./plugins/banzai" }]
      }
    }
  },
  {
    name: "conflicting roots",
    source: false,
    attention: true,
    files: {
      ".codex-plugin/plugin.json": { name: "banzai" },
      ".claude-plugin/plugin.json": { name: "other" }
    }
  }
] as const;

export async function writeIdentity(
  root: string,
  files: Record<string, unknown>
): Promise<void> {
  for (const [file, value] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), JSON.stringify(value));
  }
}
