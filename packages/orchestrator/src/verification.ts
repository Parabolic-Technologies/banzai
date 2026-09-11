import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  OrchestratorConfig,
  VerificationCommand,
  VerificationCommandDescriptor,
  VerificationProjectType
} from "./types.js";

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

const PROJECT_MARKERS: readonly {
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
  const explicit = config.schemaVersion === 2;
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
