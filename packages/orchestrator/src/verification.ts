import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { BanzaiError } from "./errors.js";
import type {
  OrchestratorConfig,
  VerificationCommand,
  VerificationCommandDescriptor,
  VerificationProjectType
} from "./types.js";
import type { RunState } from "./types.js";

export function usesVerificationPolicy(
  state: Pick<RunState, "schemaVersion" | "verificationMode">
): boolean {
  return (
    state.schemaVersion === 5 ||
    ((state.schemaVersion === 6 || state.schemaVersion === 7) &&
      state.verificationMode === "policy")
  );
}

export const DETECTABLE_PROJECT_TYPES = [
  "dotnet",
  "go",
  "jvm",
  "node",
  "php",
  "python",
  "ruby",
  "rust"
] as const satisfies readonly VerificationProjectType[];

export const PROJECT_MARKERS: readonly {
  projectType: (typeof DETECTABLE_PROJECT_TYPES)[number];
  files: readonly string[];
}[] = [
  { projectType: "go", files: ["go.mod"] },
  {
    projectType: "jvm",
    files: ["pom.xml", "build.gradle", "build.gradle.kts"]
  },
  { projectType: "node", files: ["package.json"] },
  { projectType: "php", files: ["composer.json"] },
  {
    projectType: "python",
    files: ["pyproject.toml", "setup.py", "requirements.txt"]
  },
  { projectType: "ruby", files: ["Gemfile"] },
  { projectType: "rust", files: ["Cargo.toml"] }
];

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

interface ProjectRootEntry {
  readonly name: string;
  isFile(): boolean;
}

type ProjectRootReader = (
  repoRoot: string
) => Promise<readonly ProjectRootEntry[]>;

const readProjectRoot: ProjectRootReader = (repoRoot) =>
  readdir(repoRoot, { withFileTypes: true });

export async function detectProjectTypes(
  repoRoot: string,
  readRoot: ProjectRootReader = readProjectRoot
): Promise<VerificationProjectType[]> {
  const detected = new Set<VerificationProjectType>();
  for (const marker of PROJECT_MARKERS) {
    for (const file of marker.files) {
      if (await isFile(path.join(repoRoot, file))) {
        detected.add(marker.projectType);
        break;
      }
    }
  }

  const rootEntries = await readRoot(repoRoot);
  if (
    rootEntries.some(
      (entry) => entry.isFile() && /\.(?:sln|csproj|fsproj)$/.test(entry.name)
    )
  ) {
    detected.add("dotnet");
  }

  return detected.size === 0 ? ["custom"] : [...detected].sort();
}

export function flattenVerificationCommands(
  config: OrchestratorConfig
): VerificationCommand[] {
  return describeVerificationCommands(config).map((item) => item.command);
}

function commandConfigurationDigest(input: {
  profileId: string;
  projectType: VerificationProjectType;
  profileOrdinal: number;
  commandOrdinal: number;
  command: VerificationCommand;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        profileId: input.profileId,
        projectType: input.projectType,
        profileOrdinal: input.profileOrdinal,
        commandOrdinal: input.commandOrdinal,
        name: input.command.name,
        command: input.command.command,
        args: input.command.args,
        timeoutMs: input.command.timeoutMs
      })
    )
    .digest("hex");
}

export function describeVerificationCommands(
  config: OrchestratorConfig
): VerificationCommandDescriptor[] {
  return config.verification.profiles.flatMap((profile, profileIndex) =>
    profile.commands.map((command, commandIndex) => {
      const identity = {
        profileId: profile.id,
        projectType: profile.projectType,
        profileOrdinal: profileIndex + 1,
        commandOrdinal: commandIndex + 1,
        command
      };
      return {
        ...identity,
        configurationDigest: commandConfigurationDigest(identity)
      };
    })
  );
}

export function isRepositoryHygieneCommand(
  command: VerificationCommand
): boolean {
  return (
    command.command === "git" &&
    command.args.length === 2 &&
    command.args[0] === "diff" &&
    command.args[1] === "--check"
  );
}

export interface VerificationProfileAssessment {
  explicit: boolean;
  profileCount: number;
  substantiveCommandCount: number;
  totalSubstantiveCommandCount: number;
  missingProjectTypes: VerificationProjectType[];
  hygieneOnlyProjectTypes: VerificationProjectType[];
  extraProfileIds: string[];
}

export function assessVerificationProfiles(
  config: OrchestratorConfig,
  projectTypes: readonly VerificationProjectType[]
): VerificationProfileAssessment {
  const profiles = config.verification.profiles;
  const explicit = config.schemaVersion >= 2;
  const requestedTypes = new Set(projectTypes);
  const matchingProfiles = explicit
    ? profiles.filter((profile) => requestedTypes.has(profile.projectType))
    : [];
  const matchingProfileTypes = new Set(
    matchingProfiles.map((profile) => profile.projectType)
  );
  const substantiveProfiles = matchingProfiles.filter(
    (profile) =>
      profile.projectType !== "repository" &&
      profile.commands.some((command) => !isRepositoryHygieneCommand(command))
  );
  const substantiveProfileTypes = new Set(
    substantiveProfiles.map((profile) => profile.projectType)
  );
  const missingProjectTypes = projectTypes.filter(
    (projectType) => !matchingProfileTypes.has(projectType)
  );
  const hygieneOnlyProjectTypes = projectTypes.filter(
    (projectType) =>
      matchingProfileTypes.has(projectType) &&
      !substantiveProfileTypes.has(projectType)
  );
  const extraProfileIds = explicit
    ? profiles
        .filter(
          (profile) =>
            profile.projectType !== "repository" &&
            !requestedTypes.has(profile.projectType)
        )
        .map((profile) => profile.id)
        .sort()
    : [];
  const substantiveCommandCount = explicit
    ? matchingProfiles
        .flatMap((profile) => profile.commands)
        .filter((command) => !isRepositoryHygieneCommand(command)).length
    : 0;
  const totalSubstantiveCommandCount = explicit
    ? profiles
        .filter((profile) => profile.projectType !== "repository")
        .flatMap((profile) => profile.commands)
        .filter((command) => !isRepositoryHygieneCommand(command)).length
    : 0;

  return {
    explicit,
    profileCount: profiles.length,
    substantiveCommandCount,
    totalSubstantiveCommandCount,
    missingProjectTypes,
    hygieneOnlyProjectTypes,
    extraProfileIds
  };
}

export type ApplicationProjectType = Exclude<
  VerificationProjectType,
  "repository"
>;
export type VerificationPackageManager = "npm" | "pnpm" | "yarn" | "bun";
export const VERIFICATION_SCRIPT_NAMES = [
  "test",
  "lint",
  "build",
  "typecheck"
] as const;
const PACKAGE_MANAGER_MARKERS: Record<
  VerificationPackageManager,
  readonly string[]
> = {
  npm: ["package-lock.json", "npm-shrinkwrap.json"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
  bun: ["bun.lock", "bun.lockb"]
};
const MAX_MARKER_BYTES = 1024 * 1024;

export interface VerificationProjectInspection {
  projectTypes: ApplicationProjectType[];
  markerless: boolean;
  sourceSha256: string;
  node: null | {
    scriptNames: string[];
    suggestedScriptNames: string[];
    packageManager: VerificationPackageManager | null;
    packageManagerCandidates: VerificationPackageManager[];
  };
}

function inspectionFailure(): BanzaiError {
  return new BanzaiError(
    "VERIFICATION_INSPECTION_UNAVAILABLE",
    "Project marker evidence is invalid, unsafe, unreadable or changed during inspection. Restore readable root project metadata, then retry verification setup."
  );
}

async function readMarker(
  repoRoot: string,
  name: string
): Promise<Buffer | null> {
  const file = path.join(repoRoot, name);
  let before;
  try {
    before = await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw inspectionFailure();
  }
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size > MAX_MARKER_BYTES
  ) {
    throw inspectionFailure();
  }
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    // A bounded read also limits a file that grows after lstat.
    const buffer = Buffer.alloc(MAX_MARKER_BYTES + 1);
    let count = 0;
    while (count < buffer.length) {
      const result = await handle.read(
        buffer,
        count,
        buffer.length - count,
        null
      );
      if (result.bytesRead === 0) break;
      count += result.bytesRead;
    }
    const after = await handle.stat();
    const current = await lstat(file);
    if (
      count !== before.size ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      current.ino !== before.ino ||
      current.dev !== before.dev ||
      current.mtimeMs !== before.mtimeMs ||
      current.ctimeMs !== before.ctimeMs ||
      current.isSymbolicLink()
    )
      throw inspectionFailure();
    return buffer.subarray(0, count);
  } finally {
    await handle.close();
  }
}

function markerObject(bytes: Buffer): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw inspectionFailure();
    return value as Record<string, unknown>;
  } catch {
    throw inspectionFailure();
  }
}

/** Static, bounded root evidence only. No process, store or vendor dependency. */
export async function inspectVerificationProject(
  repoRoot: string
): Promise<VerificationProjectInspection> {
  try {
    const entries = await readdir(repoRoot, { withFileTypes: true });
    const dotnet = entries
      .filter((entry) => /\.(?:sln|csproj|fsproj)$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    if (dotnet.length > 200) throw inspectionFailure();
    const names = [
      ...new Set([
        ...PROJECT_MARKERS.flatMap((marker) => marker.files),
        ...Object.values(PACKAGE_MANAGER_MARKERS).flat(),
        ...dotnet
      ])
    ].sort();
    const markers = new Map<string, Buffer | null>();
    for (const name of names)
      markers.set(name, await readMarker(repoRoot, name));
    const detected = new Set<ApplicationProjectType>();
    for (const marker of PROJECT_MARKERS) {
      if (marker.files.some((file) => markers.get(file) !== null))
        detected.add(marker.projectType);
    }
    if (dotnet.length) detected.add("dotnet");
    const composer = markers.get("composer.json");
    if (composer) markerObject(composer);
    let node: VerificationProjectInspection["node"] = null;
    const packageBytes = markers.get("package.json");
    if (packageBytes) {
      const packageJson = markerObject(packageBytes);
      const scripts =
        packageJson.scripts === undefined ? {} : packageJson.scripts;
      if (
        typeof scripts !== "object" ||
        scripts === null ||
        Array.isArray(scripts)
      )
        throw inspectionFailure();
      const scriptNames = Object.entries(scripts)
        .filter(
          ([, value]) => typeof value === "string" && value.trim().length > 0
        )
        .map(([name]) => name)
        .sort();
      const candidates = new Set<VerificationPackageManager>();
      for (const [manager, files] of Object.entries(PACKAGE_MANAGER_MARKERS)) {
        if (files.some((name) => markers.get(name) !== null))
          candidates.add(manager as VerificationPackageManager);
      }
      let unsupportedManager = false;
      if (packageJson.packageManager !== undefined) {
        if (typeof packageJson.packageManager !== "string")
          throw inspectionFailure();
        const declared = /^(npm|pnpm|yarn|bun)@\S+$/.exec(
          packageJson.packageManager
        )?.[1];
        if (declared) candidates.add(declared as VerificationPackageManager);
        else unsupportedManager = true;
      }
      node = {
        scriptNames,
        suggestedScriptNames: VERIFICATION_SCRIPT_NAMES.filter((name) =>
          scriptNames.includes(name)
        ),
        packageManager:
          candidates.size === 1 && !unsupportedManager
            ? ([...candidates][0] ?? null)
            : null,
        packageManagerCandidates: [...candidates].sort()
      };
    }
    const sourceSha256 = createHash("sha256")
      .update(
        JSON.stringify({
          markers: [...markers].map(([name, bytes]) => [
            name,
            bytes === null
              ? null
              : createHash("sha256").update(bytes).digest("hex")
          ]),
          examples: [...detected]
            .sort()
            .filter((type) => type !== "node")
            .map((type) => [type, VERIFICATION_EXAMPLES[type] ?? null])
        })
      )
      .digest("hex");
    return {
      projectTypes: detected.size ? [...detected].sort() : ["custom"],
      markerless: detected.size === 0,
      sourceSha256,
      node
    };
  } catch {
    throw inspectionFailure();
  }
}

export function assessVerificationReadiness(
  config: OrchestratorConfig,
  inspection: VerificationProjectInspection
) {
  const assessment = assessVerificationProfiles(
    config,
    inspection.projectTypes
  );
  const bootstrap =
    config.schemaVersion >= 2 && config.verification.bootstrap === true;
  const bootstrapEffective =
    bootstrap &&
    inspection.markerless &&
    assessment.totalSubstantiveCommandCount === 0;
  return {
    ...assessment,
    bootstrapEffective,
    bootstrapStale: bootstrap && assessment.totalSubstantiveCommandCount > 0,
    uncoveredTypes: bootstrapEffective
      ? []
      : [
          ...assessment.missingProjectTypes,
          ...assessment.hygieneOnlyProjectTypes
        ].sort()
  };
}

export type CommandPrerequisite =
  | { state: "present" | "missing_script"; scriptName: string }
  | { state: "unknown" | "unavailable"; scriptName: null };

export function inspectCommandPrerequisite(
  command: VerificationCommand,
  inspection: VerificationProjectInspection
): CommandPrerequisite {
  const manager = command.command;
  if (!["npm", "pnpm", "yarn", "bun"].includes(manager))
    return { state: "unknown", scriptName: null };
  let scriptName: string | undefined;
  const [verb, script, ...rest] = command.args;
  if (
    (verb === "run" || (manager === "npm" && verb === "run-script")) &&
    script &&
    !script.startsWith("-")
  ) {
    if (!rest.length || rest[0] === "--") scriptName = script;
  } else if (
    (manager === "npm" && verb === "test") ||
    ((manager === "pnpm" || manager === "yarn") &&
      VERIFICATION_SCRIPT_NAMES.some((name) => name === verb))
  ) {
    if (command.args.length === 1 || command.args[1] === "--")
      scriptName = verb;
  }
  if (!scriptName) return { state: "unknown", scriptName: null };
  if (!inspection.node) return { state: "unavailable", scriptName: null };
  return {
    state: inspection.node.scriptNames.includes(scriptName)
      ? "present"
      : "missing_script",
    scriptName
  };
}

export function nodeVerificationSuggestions(
  inspection: VerificationProjectInspection,
  manager: VerificationPackageManager
): VerificationCommand[] {
  return (inspection.node?.suggestedScriptNames ?? []).map((name) => ({
    name,
    command: manager,
    args: ["run", name],
    timeoutMs: name === "test" ? 600_000 : 300_000
  }));
}

/** Keep these explicit vectors aligned with the maintained, labelled examples. */
export const VERIFICATION_EXAMPLES: Partial<
  Record<
    ApplicationProjectType,
    { section: string; commands: VerificationCommand[] }
  >
> = {
  python: {
    section: "python-with-pytest",
    commands: [
      {
        name: "pytest",
        command: ".venv/bin/python",
        args: ["-m", "pytest"],
        timeoutMs: 600_000
      }
    ]
  },
  go: {
    section: "go",
    commands: [
      {
        name: "go tests",
        command: "go",
        args: ["test", "./..."],
        timeoutMs: 600_000
      }
    ]
  }
};
