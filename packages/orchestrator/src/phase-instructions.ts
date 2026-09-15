import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { BanzaiError } from "./errors.js";
import {
  EMBEDDED_PHASE_RESOURCES,
  PHASE_RESOURCE_DEFINITIONS
} from "./phase-resources.js";
import type {
  InstructionPhase,
  InstructionParity,
  OrchestratorConfig,
  WorkflowRoute
} from "./types.js";

type ResourceId = keyof typeof EMBEDDED_PHASE_RESOURCES;
const HOOK_IDS: readonly ResourceId[] = [
  "hooks/hooks.json",
  "hooks/spec-gate.cjs"
];
const MAX_RESOURCE_BYTES = 1024 * 1024;
export const INSTRUCTION_REMEDIES =
  "Rebuild the orchestrator bundle from current source; update the installed plugin to the matching release; or explicitly select ambient mode, which is reported as unverifiable.";

/** The applicable role union; null means that role has no call in this route. */
export function instructionPhasesForRole(
  role: keyof OrchestratorConfig["models"],
  route: WorkflowRoute | null
): InstructionPhase[] | null {
  if (role === "planner")
    return route === null || route === "strict" ? ["planning"] : null;
  if (role === "reviewer")
    return route === null || route === "strict" ? ["review"] : null;
  if (route === null) return ["implementation", "fix", "feature", "quick-fix"];
  return route === "strict" ? ["implementation", "fix"] : [route];
}

export function instructionResourceIds(
  phases: readonly InstructionPhase[]
): ResourceId[] {
  return [
    ...new Set<ResourceId>([
      ...HOOK_IDS,
      ...phases.flatMap((phase): ResourceId[] => {
        const definition = Object.entries(PHASE_RESOURCE_DEFINITIONS).find(
          ([name]) => name === phase
        )?.[1];
        if (definition === undefined)
          throw new BanzaiError(
            "INSTRUCTION_RESOURCE_INVALID",
            "Embedded instruction phase is invalid. Run `npm run build`."
          );
        return [
          `phases/${phase}.md`,
          ...definition.guidance.map(
            (name): ResourceId => `guidance/${name}.md`
          ),
          ...definition.policies.map(
            (name): ResourceId => `policies/${name}.md`
          )
        ];
      })
    ])
  ];
}

/** Only fixed product identities enter this bounded, non-following file boundary. */
async function installedDigest(
  directory: string,
  id: ResourceId
): Promise<string> {
  const root = await realpath(directory);
  let target = root;
  for (const part of id.split("/")) {
    target = path.join(target, part);
    const entry = await lstat(target);
    if (entry.isSymbolicLink()) throw new Error("Unsafe instruction resource");
  }
  const handle = await open(
    target,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_RESOURCE_BYTES)
      throw new Error("Unbounded instruction resource");
    if ((await realpath(target)) !== target)
      throw new Error("Unsafe instruction resource");
    const bytes = Buffer.alloc(MAX_RESOURCE_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(
        bytes,
        length,
        bytes.length - length,
        length
      );
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    const after = await handle.stat();
    if (
      length > MAX_RESOURCE_BYTES ||
      before.size !== length ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error("Changing instruction resource");
    return createHash("sha256").update(bytes.subarray(0, length)).digest("hex");
  } finally {
    await handle.close();
  }
}

export async function inspectInstructionParity(
  directory: string | null,
  phases: readonly InstructionPhase[]
): Promise<InstructionParity> {
  const resourceIds = instructionResourceIds(phases);
  if (directory === null)
    return {
      state: "unverifiable",
      resourceIds,
      mismatched: [],
      unavailable: []
    };
  const mismatched: string[] = [];
  const unavailable: string[] = [];
  for (const id of resourceIds) {
    try {
      if (
        (await installedDigest(directory, id)) !==
        EMBEDDED_PHASE_RESOURCES[id].sha256
      )
        mismatched.push(id);
    } catch {
      unavailable.push(id);
    }
  }
  return {
    state:
      mismatched.length > 0
        ? "mismatch"
        : unavailable.length > 0
          ? "bounded_failure"
          : "verified",
    resourceIds,
    mismatched,
    unavailable
  };
}

export async function inspectRoleInstructionParity(
  vendor: "codex" | "claude",
  directory: string | null,
  phases: readonly InstructionPhase[]
): Promise<InstructionParity> {
  return vendor === "codex"
    ? {
        state: "not_applicable",
        resourceIds: [],
        mismatched: [],
        unavailable: []
      }
    : inspectInstructionParity(directory, phases);
}

export function instructionParityFixes(
  result: InstructionParity,
  ambient = false
): { action: string; documentation: string }[] {
  const documentation =
    "documentation/orchestrator.md#spawned-claude-environment";
  if (result.state === "mismatch" || result.state === "bounded_failure")
    return [
      {
        action:
          "Rebuild the orchestrator bundle from current source (npm run build).",
        documentation
      },
      {
        action: "Update the installed Banzai plugin to the matching release.",
        documentation
      },
      {
        action:
          "Explicitly select ambient Claude mode only if accepting unverifiable instruction parity.",
        documentation
      }
    ];
  if (result.state === "unverifiable")
    return [
      {
        action: ambient
          ? "Ambient mode cannot verify installed instructions; configure a scoped matching Banzai plugin to enable comparison."
          : "Resolve the configured Claude plugin scope, or explicitly select ambient mode accepting unverifiable parity.",
        documentation
      }
    ];
  return [];
}

export function combineInstructionParity(
  results: readonly InstructionParity[]
): InstructionParity {
  const state =
    (["mismatch", "bounded_failure", "unverifiable"] as const).find(
      (candidate) => results.some((result) => result.state === candidate)
    ) ??
    (results.some((result) => result.state === "verified")
      ? "verified"
      : "not_applicable");
  return {
    state,
    resourceIds: [...new Set(results.flatMap((result) => result.resourceIds))],
    mismatched: [...new Set(results.flatMap((result) => result.mismatched))],
    unavailable: [...new Set(results.flatMap((result) => result.unavailable))]
  };
}

export function instructionParityDiagnostic(result: InstructionParity): string {
  if (result.state === "not_applicable")
    return "Installed-Claude instruction parity is not applicable to the configured Codex roles.";
  if (result.state === "verified")
    return `Applicable Claude instruction resources verified (${result.resourceIds.join(", ")}); this does not prove full transitive plugin integrity or model compliance.`;
  if (result.state === "mismatch")
    return `Instruction resource mismatch: ${result.mismatched.join(", ")}. ${INSTRUCTION_REMEDIES}`;
  if (result.state === "bounded_failure")
    return `Instruction resource comparison has bounded failures: ${result.unavailable.join(", ")}. Parity is not verified. ${INSTRUCTION_REMEDIES}`;
  return "Instruction resource parity is unverifiable for ambient or unresolved Claude scope.";
}

function resourceText(id: ResourceId): string {
  const resource: unknown = Reflect.get(EMBEDDED_PHASE_RESOURCES, id);
  if (
    typeof resource !== "object" ||
    resource === null ||
    !("text" in resource) ||
    typeof resource.text !== "string" ||
    !resource.text.trim() ||
    !("sha256" in resource) ||
    createHash("sha256").update(resource.text, "utf8").digest("hex") !==
      resource.sha256
  ) {
    throw new BanzaiError(
      "INSTRUCTION_RESOURCE_INVALID",
      "Embedded instruction resources are invalid. Run `npm run build`."
    );
  }
  return resource.text;
}

export function phaseInstructionParts(phase: InstructionPhase): string[] {
  instructionResourceIds([phase]);
  const definition = PHASE_RESOURCE_DEFINITIONS[phase];
  return [
    resourceText(`phases/${phase}.md`),
    ...definition.guidance.map((name) => resourceText(`guidance/${name}.md`)),
    ...definition.policies.map((name) => resourceText(`policies/${name}.md`))
  ];
}
