import path from "node:path";
import type { ModelSettings, OrchestratorConfig } from "./types.js";

export type ModelRole = "planner" | "implementer" | "reviewer";

export const MODEL_ROLES: readonly ModelRole[] = [
  "planner",
  "implementer",
  "reviewer"
];

const ROLE_LABELS: Record<ModelRole, string> = {
  planner: "Planning",
  implementer: "Implementation",
  reviewer: "Review"
};

export type ModelStanding = "superseded" | "deprecated" | "retired";

interface CatalogEntry {
  replacement: string;
  standing: ModelStanding;
  date: string | null;
}

interface VendorCatalog {
  supported: ReadonlySet<string>;
  replacements: ReadonlyMap<string, CatalogEntry>;
  /**
   * The first CLI release that serves a model, recorded only where it is newer
   * than the vendor-wide minimum the adapters enforce.
   */
  cliMinimums: ReadonlyMap<string, string>;
}

function superseded(replacement: string): CatalogEntry {
  return { replacement, standing: "superseded", date: null };
}

function deprecated(replacement: string, date: string): CatalogEntry {
  return { replacement, standing: "deprecated", date };
}

function retired(replacement: string, date: string): CatalogEntry {
  return { replacement, standing: "retired", date };
}

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-4-5";

// Maintained by hand from the published Claude model catalog. The runner is
// subscription-only and never calls a vendor API, so currency is a source fact
// that ships with a release rather than something discovered at run time.
const CLAUDE_CATALOG: VendorCatalog = {
  supported: new Set([
    "claude-fable-5-1",
    "claude-fable-5",
    OPUS,
    SONNET,
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-opus-4-8",
    "claude-sonnet-4-6",
    HAIKU,
    "claude-haiku-4-5-20251001",
    // Claude Code aliases always resolve to the current model of their tier.
    "opus",
    "sonnet",
    "haiku",
    "default"
  ]),
  replacements: new Map([
    ["claude-opus-4-7", superseded(OPUS)],
    ["claude-opus-4-6", superseded(OPUS)],
    ["claude-opus-4-5", superseded(OPUS)],
    ["claude-opus-4-5-20251101", superseded(OPUS)],
    ["claude-opus-4-1", retired(OPUS, "2026-08-05")],
    ["claude-opus-4-1-20250805", retired(OPUS, "2026-08-05")],
    ["claude-opus-4-0", retired(OPUS, "2026-06-15")],
    ["claude-opus-4-20250514", retired(OPUS, "2026-06-15")],
    ["claude-3-opus-20240229", retired(OPUS, "2026-01-05")],
    ["claude-mythos-preview", superseded("claude-fable-5-1")],
    ["claude-sonnet-4-5", deprecated(SONNET, "2026-11-30")],
    ["claude-sonnet-4-5-20250929", deprecated(SONNET, "2026-11-30")],
    ["claude-sonnet-4-0", retired(SONNET, "2026-06-15")],
    ["claude-sonnet-4-20250514", retired(SONNET, "2026-06-15")],
    ["claude-3-7-sonnet-20250219", retired(SONNET, "2026-02-19")],
    ["claude-3-5-sonnet-20241022", retired(SONNET, "2025-10-28")],
    ["claude-3-5-sonnet-20240620", retired(SONNET, "2025-10-28")],
    ["claude-3-sonnet-20240229", retired(SONNET, "2025-07-21")],
    ["claude-3-5-haiku-20241022", retired(HAIKU, "2026-02-19")],
    ["claude-3-haiku-20240307", retired(HAIKU, "2026-04-20")]
  ]),
  // From Claude Code's model configuration documentation. An older client
  // refuses these models itself, before any request; tier aliases need no
  // entry because they resolve to a model the installed client serves.
  cliMinimums: new Map([
    [OPUS, "2.1.280"],
    [SONNET, "2.1.284"],
    ["claude-fable-5-1", "2.1.257"]
  ])
};

const CODEX_SOL = "gpt-6.1-sol";

// Codex model identifiers are tracked only as far as this repository can state
// them as fact. Unknown identifiers produce no advisory, so an unlisted newer
// Codex model is never reported as stale.
const CODEX_CATALOG: VendorCatalog = {
  supported: new Set([
    CODEX_SOL,
    "gpt-6-astra",
    "gpt-6-sol",
    "gpt-6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna"
  ]),
  replacements: new Map([
    ["gpt-5.5", deprecated(CODEX_SOL, "2026-10-14")],
    ["gpt-5.4", retired(CODEX_SOL, "2026-08-31")],
    ["gpt-5.4-mini", retired("gpt-6-luna", "2026-08-31")],
    ["gpt-5", superseded(CODEX_SOL)]
  ]),
  // The first stable Codex CLI release whose bundled model catalog carries the
  // model, from the Codex CLI release notes.
  cliMinimums: new Map([
    [CODEX_SOL, "0.159.1"],
    ["gpt-6-sol", "0.156.1"],
    ["gpt-6-luna", "0.156.1"],
    ["gpt-6-astra", "0.153.1"]
  ])
};

const CATALOGS: ReadonlyMap<string, VendorCatalog> = new Map([
  ["claude", CLAUDE_CATALOG],
  ["codex", CODEX_CATALOG]
]);

export interface ModelAdvisory {
  role: ModelRole;
  label: string;
  executable: string;
  model: string;
  replacement: string;
  standing: ModelStanding;
  detail: string;
}

export type Vendor = "claude" | "codex";

export type Effort = ModelSettings["effort"];

export interface SelectableModel {
  id: string;
  label: string;
  vendor: Vendor;
  executable: string;
  description: string;
  efforts: readonly Effort[];
}

const FULL_EFFORTS: readonly Effort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
];

const CODEX_EFFORTS: readonly Effort[] = [...FULL_EFFORTS, "ultra"];

// The 4.6 generation predates `xhigh`.
const CLAUDE_4_6_EFFORTS: readonly Effort[] = ["low", "medium", "high", "max"];

/**
 * The models offered by `banzai model`. Includes the current generation and
 * deliberate earlier-generation choices. Other supported releases still load
 * from a hand-edited config, but are not presented as a choice.
 *
 * Claude entries come from the published Claude model catalog. Codex entries and
 * their reasoning levels come from the Codex CLI's model metadata or published
 * model documentation, so every effort the picker offers is accepted.
 */
export const SELECTABLE_MODELS: readonly SelectableModel[] = [
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    vendor: "claude",
    executable: "claude",
    description: "Long-running agentic coding and knowledge work.",
    efforts: FULL_EFFORTS
  },
  {
    id: "claude-fable-5-1",
    label: "Claude Fable 5.1",
    vendor: "claude",
    executable: "claude",
    description: "Most capable model for demanding long-horizon agentic work.",
    efforts: FULL_EFFORTS
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    vendor: "claude",
    executable: "claude",
    description: "Best combination of speed and intelligence.",
    efforts: FULL_EFFORTS
  },
  {
    id: "claude-opus-5",
    label: "Claude Opus 5",
    vendor: "claude",
    executable: "claude",
    description: "Previous-generation Opus for complex agentic coding.",
    efforts: FULL_EFFORTS
  },
  {
    id: "claude-fable-5",
    label: "Claude Fable 5",
    vendor: "claude",
    executable: "claude",
    description: "Previous-generation Fable for demanding agentic work.",
    efforts: FULL_EFFORTS
  },
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    vendor: "claude",
    executable: "claude",
    description: "Previous-generation Sonnet with near-Opus coding quality.",
    efforts: FULL_EFFORTS
  },
  {
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    vendor: "claude",
    executable: "claude",
    description: "Older-generation Opus for complex agentic work.",
    efforts: FULL_EFFORTS
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    vendor: "claude",
    executable: "claude",
    description: "Older-generation Sonnet balancing intelligence and speed.",
    efforts: CLAUDE_4_6_EFFORTS
  },
  {
    id: "gpt-6.1-sol",
    label: "GPT-6.1-Sol",
    vendor: "codex",
    executable: "codex",
    description: "Latest workhorse model for coding and everyday work.",
    efforts: CODEX_EFFORTS
  },
  {
    id: "gpt-6-astra",
    label: "GPT-6-Astra",
    vendor: "codex",
    executable: "codex",
    description: "Most capable model for complex, demanding work.",
    efforts: CODEX_EFFORTS
  },
  {
    id: "gpt-6-sol",
    label: "GPT-6-Sol",
    vendor: "codex",
    executable: "codex",
    description: "Previous-generation workhorse model.",
    efforts: CODEX_EFFORTS
  },
  {
    id: "gpt-6-luna",
    label: "GPT-6-Luna",
    vendor: "codex",
    executable: "codex",
    description: "Fast and affordable model for easier tasks.",
    efforts: FULL_EFFORTS
  },
  {
    id: "gpt-5.6-sol",
    label: "GPT-5.6-Sol",
    vendor: "codex",
    executable: "codex",
    description: "Older-generation workhorse model.",
    efforts: CODEX_EFFORTS
  },
  {
    id: "gpt-5.6-terra",
    label: "GPT-5.6-Terra",
    vendor: "codex",
    executable: "codex",
    description: "Older balanced model for straightforward work.",
    efforts: CODEX_EFFORTS
  },
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6-Luna",
    vendor: "codex",
    executable: "codex",
    description: "Older fast and efficient model.",
    efforts: FULL_EFFORTS
  }
];

export function selectableModel(id: string): SelectableModel | null {
  return SELECTABLE_MODELS.find((model) => model.id === id) ?? null;
}

export function isCatalogSupportedModel(vendor: Vendor, id: string): boolean {
  return CATALOGS.get(vendor)?.supported.has(id) ?? false;
}

/**
 * The oldest `vendor` CLI release that can run `model`, or `null` when the
 * vendor-wide minimum is enough.
 */
export function modelCliMinimum(vendor: Vendor, model: string): string | null {
  return CATALOGS.get(vendor)?.cliMinimums.get(model) ?? null;
}

/**
 * The vendor a role falls back to when its executable belongs to neither vendor.
 * Every role can run either vendor; this only decides which subscription check
 * to attempt for an unrecognized wrapper.
 */
export const FALLBACK_VENDOR: Record<ModelRole, Vendor> = {
  planner: "codex",
  implementer: "codex",
  reviewer: "claude"
};

export interface VendorUsage {
  executable: string;
  vendor: Vendor | null;
  roles: ModelRole[];
  settings: ModelSettings;
}

export interface ConfiguredModel {
  role: ModelRole;
  label: string;
  executable: string;
  model: string;
  effort: ModelSettings["effort"];
  timeout: string;
}

export function roleLabel(role: ModelRole): string {
  return ROLE_LABELS[role];
}

function vendorKey(executable: string): string {
  return path.basename(executable).toLowerCase();
}

function advisoryDetail(model: string, entry: CatalogEntry): string {
  if (entry.standing === "superseded") {
    return `${model} is superseded by ${entry.replacement}.`;
  }
  if (entry.standing === "deprecated") {
    return `${model} is deprecated and retires ${entry.date}; ${entry.replacement} replaces it.`;
  }
  return `${model} was retired ${entry.date}; ${entry.replacement} replaces it.`;
}

function advisoryFor(
  role: ModelRole,
  settings: ModelSettings
): ModelAdvisory | null {
  const catalog = CATALOGS.get(vendorKey(settings.executable));
  if (catalog === undefined || catalog.supported.has(settings.model)) {
    return null;
  }
  const entry = catalog.replacements.get(settings.model);
  if (entry === undefined) {
    return null;
  }
  return {
    role,
    label: ROLE_LABELS[role],
    executable: settings.executable,
    model: settings.model,
    replacement: entry.replacement,
    standing: entry.standing,
    detail: advisoryDetail(settings.model, entry)
  };
}

/**
 * Reports every configured model outside the supported selection window that a
 * newer or supported model replaces. Supported and unrecognized models are
 * absent.
 */
export function modelAdvisories(config: OrchestratorConfig): ModelAdvisory[] {
  const advisories: ModelAdvisory[] = [];
  for (const role of MODEL_ROLES) {
    const advisory = advisoryFor(role, config.models[role]);
    if (advisory !== null) {
      advisories.push(advisory);
    }
  }
  return advisories;
}

export function vendorFor(executable: string): Vendor | null {
  const key = vendorKey(executable);
  return key === "claude" || key === "codex" ? key : null;
}

/**
 * Groups the configured roles by the executable that runs them, so a check runs
 * once per vendor no matter which roles share it. Role order is preserved.
 */
export function vendorUsage(config: OrchestratorConfig): VendorUsage[] {
  const usage = new Map<string, VendorUsage>();
  for (const role of MODEL_ROLES) {
    const settings = config.models[role];
    const existing = usage.get(settings.executable);
    if (existing === undefined) {
      usage.set(settings.executable, {
        executable: settings.executable,
        vendor: vendorFor(settings.executable),
        roles: [role],
        settings
      });
      continue;
    }
    existing.roles.push(role);
  }
  return [...usage.values()];
}

export function describeRoles(roles: readonly ModelRole[]): string {
  return roles.map((role) => ROLE_LABELS[role]).join(", ");
}

function formatTimeout(timeoutMs: number): string {
  const minutes = Math.ceil(timeoutMs / 60_000);
  return `${minutes}m`;
}

export function configuredModels(
  config: OrchestratorConfig
): ConfiguredModel[] {
  return MODEL_ROLES.map((role) => {
    const settings = config.models[role];
    return {
      role,
      label: ROLE_LABELS[role],
      executable: settings.executable,
      model: settings.model,
      effort: settings.effort,
      timeout: formatTimeout(settings.timeoutMs)
    };
  });
}
