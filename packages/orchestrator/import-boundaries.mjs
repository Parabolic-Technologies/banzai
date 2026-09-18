import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST_ARCHITECTURE = "PROJECT_MANIFEST.md §3";
const MANIFEST_MODULES = "PROJECT_MANIFEST.md §5";
const ADR_0026 = "ADR-0026";
const ADR_0028 = "ADR-0028";
const ADR_0033 = "ADR-0033";
const ADR_0034 = "ADR-0034";
const ADR_0035 = "ADR-0035";
const ADR_0040 = "ADR-0040";
const ADR_0041 = "ADR-0041";
const ADR_0042 = "ADR-0042";
const ADR_0043 = "ADR-0043";
const ADR_0045 = "ADR-0045";
const ADR_0049 = "ADR-0049";
const POLICY_ADR_AUTHORITIES = new Set([
  ADR_0026,
  ADR_0028,
  ADR_0033,
  ADR_0034,
  ADR_0035,
  ADR_0040,
  ADR_0041,
  ADR_0042,
  ADR_0043,
  ADR_0045,
  ADR_0049
]);
const POLICY_ERROR_CODE = "IMPORT_BOUNDARY_POLICY_INVALID";
const IMPORTER_PATTERN =
  /^src\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*[a-z0-9]+(?:-[a-z0-9]+)*\.ts$/;
const BOUNDARY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MANIFEST_AUTHORITY_PATTERN = /^PROJECT_MANIFEST\.md §(?:[1-9]|10)$/;
const TARGET_EXTENSION_PATTERN = /\.(?:js|json)$/;
const TARGET_META_PATTERN = /[\\*?[\]{}()|^$#]/;

const permission = (target, authority) => ({ target, authority });
const boundary = (
  importer,
  name,
  authorities,
  runtime = [],
  typeOnly = []
) => ({ importer, boundary: name, authorities, runtime, typeOnly });

/**
 * Executable projection of PROJECT_MANIFEST.md and accepted ADR boundaries.
 * This list is deliberately explicit: source imports must never generate or
 * broaden it.
 */
export const ORCHESTRATOR_IMPORT_BOUNDARIES = [
  boundary(
    "src/version-cli.ts",
    "local-version-discovery",
    [MANIFEST_MODULES, ADR_0033],
    [
      permission("../package.json", ADR_0033),
      permission("./errors.js", MANIFEST_MODULES),
      permission("./process.js", MANIFEST_MODULES)
    ],
    [permission("./types.js", MANIFEST_MODULES)]
  ),
  boundary("src/init-resources.ts", "embedded-init-resources", [
    MANIFEST_MODULES
  ]),
  boundary(
    "src/configuration-review.ts",
    "configuration-review-provenance",
    [ADR_0045],
    [
      permission("./configuration-prerequisite.js", ADR_0045),
      permission("./verification-config.js", ADR_0045),
      permission("./errors.js", ADR_0045)
    ],
    [permission("./types.js", ADR_0045)]
  ),
  boundary(
    "src/verification-cli.ts",
    "guided-verification-cli",
    [ADR_0045],
    [
      permission("./configuration-prerequisite.js", ADR_0045),
      permission("./verification-config.js", ADR_0045),
      permission("./verification.js", ADR_0045),
      permission("./verification-ui.js", ADR_0045),
      permission("./format.js", ADR_0045),
      permission("./errors.js", ADR_0045),
      permission("./process.js", ADR_0045)
    ],
    [
      permission("./interactive.js", ADR_0045),
      permission("./workflow.js", ADR_0045),
      permission("./types.js", ADR_0045)
    ]
  ),
  boundary(
    "src/verification-ui.ts",
    "guided-verification-editor",
    [ADR_0045],
    [
      permission("./configuration-prerequisite.js", ADR_0045),
      permission("./format.js", ADR_0045)
    ],
    [
      permission("./interactive.js", ADR_0045),
      permission("./types.js", ADR_0045)
    ]
  ),
  boundary(
    "src/persisted-readers.ts",
    "canonical-persisted-readers",
    [ADR_0045],
    [
      permission("./validation.js", ADR_0045),
      permission("./configuration-prerequisite.js", ADR_0045),
      permission("./verification-config.js", ADR_0045)
    ]
  ),
  boundary(
    "src/verification-config.ts",
    "verification-config-transaction",
    [ADR_0045, ADR_0041],
    [
      permission("./artifact-storage.js", ADR_0041),
      permission("./config.js", ADR_0045),
      permission("./cancellation-evidence.js", ADR_0045),
      permission("./configuration-prerequisite.js", ADR_0045),
      permission("./errors.js", ADR_0045),
      permission("./validation.js", ADR_0045),
      permission("./verification.js", ADR_0045)
    ],
    [permission("./store.js", ADR_0045), permission("./types.js", ADR_0045)]
  ),
  boundary(
    "src/configuration-prerequisite.ts",
    "configuration-prerequisite-contract",
    [ADR_0045],
    [
      permission("./errors.js", ADR_0045),
      permission("./verification.js", ADR_0045)
    ],
    [permission("./types.js", ADR_0045)]
  ),
  boundary(
    "src/verification-evidence.ts",
    "shared-verification-evidence",
    [ADR_0043, ADR_0049],
    [
      permission(
        "../../../plugins/banzai/lib/verification-evidence.mjs",
        ADR_0043
      ),
      permission(
        "../../../plugins/banzai/lib/verification-store.mjs",
        ADR_0043
      ),
      permission("../../../plugins/banzai/lib/task-verification.mjs", ADR_0049),
      permission(
        "../../../plugins/banzai/lib/task-verification-store.mjs",
        ADR_0049
      )
    ]
  ),
  boundary("src/phase-resources.ts", "embedded-phase-resources", [ADR_0042]),
  boundary(
    "src/phase-instructions.ts",
    "phase-instructions",
    [ADR_0042],
    [
      permission("./phase-resources.js", ADR_0042),
      permission("./errors.js", ADR_0042)
    ],
    [permission("./types.js", ADR_0042)]
  ),
  boundary(
    "src/artifact-storage.ts",
    "shared-artifact-storage",
    [ADR_0041],
    [permission("../../../plugins/banzai/lib/artifact-storage.mjs", ADR_0041)]
  ),
  boundary(
    "src/setup-client.ts",
    "interactive-vendor-launch",
    [ADR_0040],
    [
      permission("./adapters.js", ADR_0040),
      permission("./errors.js", ADR_0040),
      permission("./mcp.js", ADR_0040),
      permission("./models.js", ADR_0040),
      permission("./project-adoption.js", ADR_0040),
      permission("./process.js", ADR_0040)
    ],
    [permission("./types.js", ADR_0040)]
  ),
  boundary(
    "src/foreground-client.ts",
    "foreground-terminal-lifecycle",
    [ADR_0040],
    [permission("./errors.js", ADR_0040)],
    [permission("./setup-client.js", ADR_0040)]
  ),
  boundary(
    "src/project-setup.ts",
    "project-setup-coordination",
    [ADR_0040, ADR_0041],
    [
      permission("./artifact-storage.js", ADR_0041),
      permission("./errors.js", ADR_0040),
      permission("./store.js", ADR_0040),
      permission("./models.js", ADR_0040),
      permission("./project-adoption.js", ADR_0040),
      permission("./setup-client.js", ADR_0040),
      permission("./foreground-client.js", ADR_0040)
    ],
    [
      permission("./interactive.js", ADR_0040),
      permission("./types.js", ADR_0040)
    ]
  ),
  boundary(
    "src/project-adoption.ts",
    "project-adoption-inspection",
    [ADR_0040, ADR_0041],
    [permission("./artifact-storage.js", ADR_0041)]
  ),
  boundary(
    "src/review-snapshot.ts",
    "review-snapshot",
    [MANIFEST_MODULES, ADR_0041],
    [
      permission("./artifact-storage.js", ADR_0041),
      permission("./git.js", MANIFEST_MODULES),
      permission("./validation.js", MANIFEST_MODULES),
      permission("./errors.js", MANIFEST_MODULES)
    ],
    [permission("./types.js", MANIFEST_MODULES)]
  ),
  boundary(
    "src/adapters.ts",
    "vendor-adapters",
    [MANIFEST_ARCHITECTURE, MANIFEST_MODULES, ADR_0028],
    [
      permission("./errors.js", MANIFEST_ARCHITECTURE),
      permission("./format.js", MANIFEST_MODULES),
      permission("./mcp.js", MANIFEST_MODULES),
      permission("./models.js", MANIFEST_MODULES),
      permission("./output-contract.js", ADR_0028),
      permission("./process.js", MANIFEST_ARCHITECTURE),
      permission("./validation.js", MANIFEST_MODULES)
    ],
    [permission("./types.js", MANIFEST_ARCHITECTURE)]
  ),
  boundary(
    "src/agent-control-cli.ts",
    "agent-control-cli",
    [MANIFEST_ARCHITECTURE, MANIFEST_MODULES],
    [
      permission("./agent-control.js", MANIFEST_MODULES),
      permission("./errors.js", MANIFEST_ARCHITECTURE)
    ],
    [
      permission("./types.js", MANIFEST_ARCHITECTURE),
      permission("./workflow.js", MANIFEST_MODULES)
    ]
  ),
  boundary(
    "src/agent-control.ts",
    "agent-control-projection",
    [ADR_0045, MANIFEST_ARCHITECTURE, MANIFEST_MODULES],
    [
      permission("./configuration-prerequisite.js", ADR_0045),
      permission("../package.json", MANIFEST_MODULES),
      permission("./errors.js", MANIFEST_ARCHITECTURE),
      permission("./types.js", MANIFEST_ARCHITECTURE),
      permission("./validation.js", MANIFEST_MODULES),
      permission("./workflow.js", MANIFEST_ARCHITECTURE)
    ]
  ),
  boundary("src/ansi.ts", "terminal-ansi", [MANIFEST_MODULES]),
  boundary(
    "src/cancellation.ts",
    "cancellation-contract",
    [ADR_0035],
    [],
    [permission("./types.js", ADR_0035)]
  ),
  boundary(
    "src/cancellation-evidence.ts",
    "cancellation-evidence-reader",
    [ADR_0035],
    [
      permission("./cancellation.js", ADR_0035),
      permission("./validation.js", ADR_0035)
    ]
  ),
  boundary(
    "src/cancellation-cli.ts",
    "cancellation-cli",
    [ADR_0035],
    [
      permission("./cancellation.js", ADR_0035),
      permission("./errors.js", ADR_0035),
      permission("./evaluation-cli.js", ADR_0035),
      permission("./cancellation-report.js", ADR_0035),
      permission("./cancellation-report-render.js", ADR_0035)
    ],
    [permission("./types.js", ADR_0035)]
  ),
  boundary(
    "src/cancellation-report.ts",
    "cancellation-report",
    [ADR_0035],
    [
      permission("./cancellation.js", ADR_0035),
      permission("./cancellation-evidence.js", ADR_0035),
      permission("./errors.js", ADR_0035),
      permission("./evaluation.js", ADR_0035),
      permission("./human-time.js", ADR_0035),
      permission("./validation.js", ADR_0035)
    ],
    [permission("./types.js", ADR_0035)]
  ),
  boundary(
    "src/cancellation-report-render.ts",
    "cancellation-report-rendering",
    [ADR_0035],
    [permission("./cancellation.js", ADR_0035)]
  ),
  boundary(
    "src/claude-permissions.ts",
    "claude-permission-audit",
    [MANIFEST_MODULES, MANIFEST_ARCHITECTURE],
    [permission("./models.js", MANIFEST_MODULES)],
    [permission("./types.js", MANIFEST_ARCHITECTURE)]
  ),
  boundary("src/cli-routing.ts", "cli-routing", [MANIFEST_MODULES]),
  boundary(
    "src/cli.ts",
    "cli-composition-root",
    [
      ADR_0045,
      MANIFEST_ARCHITECTURE,
      MANIFEST_MODULES,
      ADR_0033,
      ADR_0034,
      ADR_0035,
      ADR_0040,
      ADR_0041
    ],
    [
      permission("./verification-cli.js", ADR_0045),
      permission("./verification.js", ADR_0045),
      permission("./verification-ui.js", ADR_0045),
      permission("./artifact-storage.js", ADR_0041),
      permission("./project-adoption.js", ADR_0040),
      permission("./project-setup.js", ADR_0040),
      permission("./cancellation-cli.js", ADR_0035),
      permission("../package.json", ADR_0033),
      permission("./adapters.js", MANIFEST_ARCHITECTURE),
      permission("./agent-control-cli.js", MANIFEST_MODULES),
      permission("./ansi.js", MANIFEST_MODULES),
      permission("./cli-routing.js", MANIFEST_MODULES),
      permission("./version-cli.js", MANIFEST_MODULES),
      permission("./config.js", MANIFEST_MODULES),
      permission("./init-resources.js", MANIFEST_MODULES),
      permission("./context-report-cli.js", MANIFEST_MODULES),
      permission("./doctor-cli.js", MANIFEST_MODULES),
      permission("./errors.js", MANIFEST_ARCHITECTURE),
      permission("./evaluation-cli.js", MANIFEST_MODULES),
      permission("./evaluation-kpi-cli.js", MANIFEST_MODULES),
      permission("./format.js", MANIFEST_MODULES),
      permission("./git.js", MANIFEST_MODULES),
      permission("./inquirer-io.js", MANIFEST_MODULES),
      permission("./interactive-human-time.js", ADR_0034),
      permission("./human-time-store.js", ADR_0034),
      permission("./interactive.js", MANIFEST_ARCHITECTURE),
      permission("./interrupt.js", MANIFEST_MODULES),
      permission("./live-compatibility-cli.js", MANIFEST_MODULES),
      permission("./model-selection.js", MANIFEST_MODULES),
      permission("./models.js", MANIFEST_MODULES),
      permission("./process.js", MANIFEST_ARCHITECTURE),
      permission("./progress.js", MANIFEST_MODULES),
      permission("./store.js", MANIFEST_MODULES),
      permission("./terminal-attention.js", MANIFEST_MODULES),
      permission("./vocabulary.js", MANIFEST_MODULES),
      permission("./workflow.js", MANIFEST_ARCHITECTURE)
    ],
    [permission("./types.js", MANIFEST_ARCHITECTURE)]
  ),
  boundary(
    "src/config.ts",
    "configuration",
    [MANIFEST_ARCHITECTURE, MANIFEST_MODULES],
    [
      permission("./errors.js", MANIFEST_ARCHITECTURE),
      permission("./types.js", MANIFEST_ARCHITECTURE),
      permission("./validation.js", MANIFEST_MODULES)
    ],
    [permission("./models.js", MANIFEST_MODULES)]
  ),
  boundary(
    "src/context-accounting.ts",
    "context-accounting",
    [ADR_0028],
    [permission("./errors.js", ADR_0028), permission("./types.js", ADR_0028)]
  ),
  boundary(
    "src/context-report-cli.ts",
    "context-report-cli",
    [ADR_0028],
    [
      permission("./context-report-render.js", ADR_0028),
      permission("./context-report.js", ADR_0028),
      permission("./evaluation-cli.js", ADR_0028)
    ],
    [permission("./types.js", ADR_0028)]
  ),
  boundary(
    "src/context-report-render.ts",
    "context-report-render",
    [ADR_0028],
    [],
    [permission("./types.js", ADR_0028)]
  ),
  boundary(
    "src/context-report.ts",
    "context-report",
    [ADR_0028],
    [
      permission("./context-accounting.js", ADR_0028),
      permission("./errors.js", ADR_0028),
      permission("./types.js", ADR_0028)
    ]
  ),
  boundary(
    "src/contracts.ts",
    "model-contracts",
    [MANIFEST_ARCHITECTURE, MANIFEST_MODULES, ADR_0049],
    [
      permission(
        "../../../plugins/banzai/contracts/contract.json",
        MANIFEST_MODULES
      ),
      permission(
        "../../../plugins/banzai/contracts/v4/phase-result.schema.json",
        ADR_0049
      ),
      permission(
        "../../../plugins/banzai/contracts/v1/phase-result.schema.json",
        MANIFEST_MODULES
      ),
      permission(
        "../../../plugins/banzai/contracts/v1/review-result.schema.json",
        MANIFEST_MODULES
      ),
      permission(
        "../../../plugins/banzai/contracts/v2/review-result.schema.json",
        MANIFEST_MODULES
      ),
      permission(
        "../../../plugins/banzai/contracts/v1/workflow-selection.schema.json",
        MANIFEST_MODULES
      ),
      permission(
        "../../../plugins/banzai/contracts/v2/phase-result.schema.json",
        MANIFEST_MODULES
      ),
      permission(
        "../../../plugins/banzai/contracts/v3/phase-result.schema.json",
        MANIFEST_MODULES
      ),
      permission("./errors.js", MANIFEST_ARCHITECTURE),
      permission("./types.js", MANIFEST_ARCHITECTURE)
    ]
  ),
  boundary(
    "src/doctor-cli.ts",
    "doctor-cli",
    [MANIFEST_MODULES, MANIFEST_ARCHITECTURE],
    [
      permission("./doctor.js", MANIFEST_MODULES),
      permission("./errors.js", MANIFEST_ARCHITECTURE)
    ]
  ),
  boundary(
    "src/doctor.ts",
    "doctor-diagnostics",
    [
      ADR_0045,
      MANIFEST_ARCHITECTURE,
      MANIFEST_MODULES,
      ADR_0040,
      ADR_0041,
      ADR_0042
    ],
    [
      permission("./configuration-prerequisite.js", ADR_0045),
      permission("./phase-instructions.js", ADR_0042),
      permission("./artifact-storage.js", ADR_0041),
      permission("./project-adoption.js", ADR_0040),
      permission("./adapters.js", MANIFEST_MODULES),
      permission("./claude-permissions.js", MANIFEST_MODULES),
      permission("./config.js", MANIFEST_MODULES),
      permission("./contracts.js", MANIFEST_MODULES),
      permission("./types.js", MANIFEST_ARCHITECTURE),
      permission("./validation.js", MANIFEST_MODULES),
      permission("./verification.js", MANIFEST_MODULES)
    ]
  ),
  boundary(
    "src/errors.ts",
    "foundational-errors",
    [MANIFEST_ARCHITECTURE],
    [],
    [permission("./types.js", MANIFEST_ARCHITECTURE)]
  ),
  boundary(
    "src/evaluation-cli.ts",
    "evaluation-export-cli",
    [MANIFEST_MODULES, MANIFEST_ARCHITECTURE],
    [
      permission("./errors.js", MANIFEST_ARCHITECTURE),
      permission("./evaluation-render.js", MANIFEST_MODULES),
      permission("./evaluation.js", MANIFEST_MODULES),
      permission("./validation.js", MANIFEST_MODULES)
    ],
    [permission("./types.js", MANIFEST_ARCHITECTURE)]
  ),
  boundary(
    "src/evaluation-kpi-cli.ts",
    "evaluation-kpi-cli",
    [ADR_0026],
    [
      permission("./errors.js", ADR_0026),
      permission("./evaluation-cli.js", ADR_0026),
      permission("./evaluation-kpi-render.js", ADR_0026),
      permission("./evaluation-kpi.js", ADR_0026),
      permission("./evaluation.js", ADR_0026)
    ],
    [permission("./types.js", ADR_0026)]
  ),
  boundary(
    "src/evaluation-kpi-render.ts",
    "evaluation-kpi-render",
    [ADR_0026],
    [],
    [permission("./types.js", ADR_0026)]
  ),
  boundary(
    "src/evaluation-kpi.ts",
    "derived-evaluation-kpi",
    [ADR_0026],
    [permission("./errors.js", ADR_0026), permission("./types.js", ADR_0026)]
  ),
  boundary(
    "src/evaluation-render.ts",
    "evaluation-export-render",
    [MANIFEST_MODULES, MANIFEST_ARCHITECTURE],
    [permission("./evaluation.js", MANIFEST_MODULES)],
    [permission("./types.js", MANIFEST_ARCHITECTURE)]
  ),
  boundary(
    "src/evaluation.ts",
    "evaluation-export",
    [MANIFEST_MODULES, MANIFEST_ARCHITECTURE, ADR_0041, ADR_0043],
    [
      permission("./artifact-storage.js", ADR_0041),
      permission("./verification-evidence.js", ADR_0043),
      permission("./errors.js", MANIFEST_ARCHITECTURE),
      permission("./types.js", MANIFEST_ARCHITECTURE),
      permission("./validation.js", MANIFEST_MODULES)
    ]
  ),
  boundary("src/format.ts", "pure-formatting", [MANIFEST_MODULES]),
  boundary(
    "src/git.ts",
    "git-gateway",
    [MANIFEST_ARCHITECTURE, MANIFEST_MODULES, ADR_0041],
    [
      permission("./artifact-storage.js", ADR_0041),
      permission("./errors.js", MANIFEST_ARCHITECTURE),
      permission("./process.js", MANIFEST_ARCHITECTURE)
    ]
  ),
  boundary("src/human-time.ts", "human-time-domain", [ADR_0034]),
  boundary(
    "src/human-time-store.ts",
    "human-time-store",
    [ADR_0034],
    [permission("./human-time.js", ADR_0034)]
  ),
  boundary(
    "src/interactive-human-time.ts",
    "interactive-human-time",
    [ADR_0034],
    [
      permission("./human-time.js", ADR_0034),
      permission("./human-time-store.js", ADR_0034)
    ]
  ),
  boundary(
    "src/inquirer-io.ts",
    "inquirer-io",
    [MANIFEST_MODULES],
    [],
    [permission("./interactive.js", MANIFEST_MODULES)]
  ),
  boundary(
    "src/interactive.ts",
    "interactive-composition",
    [ADR_0045, MANIFEST_ARCHITECTURE, MANIFEST_MODULES, ADR_0034, ADR_0035],
    [
      permission("./verification-ui.js", ADR_0045),
      permission("./cancellation-cli.js", ADR_0035),
      permission("../package.json", MANIFEST_MODULES),
      permission("./ansi.js", MANIFEST_MODULES),
      permission("./errors.js", MANIFEST_ARCHITECTURE),
      permission("./format.js", MANIFEST_MODULES),
      permission("./models.js", MANIFEST_MODULES),
      permission("./vocabulary.js", MANIFEST_MODULES),
      permission("./workflow.js", MANIFEST_ARCHITECTURE)
    ],
    [
      permission("./cancellation.js", ADR_0035),
      permission("./human-time.js", ADR_0034),
      permission("./config.js", MANIFEST_MODULES),
      permission("./terminal-attention.js", MANIFEST_MODULES),
      permission("./types.js", MANIFEST_ARCHITECTURE)
    ]
  ),
  boundary("src/interrupt.ts", "interrupt-state", [MANIFEST_MODULES]),
  boundary(
    "src/live-compatibility-cli.ts",
    "live-compatibility-cli",
    [MANIFEST_MODULES, MANIFEST_ARCHITECTURE],
    [
      permission("./errors.js", MANIFEST_ARCHITECTURE),
      permission("./live-compatibility.js", MANIFEST_MODULES)
    ]
  ),
  boundary(
    "src/live-compatibility.ts",
    "live-compatibility",
    [MANIFEST_MODULES, MANIFEST_ARCHITECTURE],
    [
      permission("./validation.js", MANIFEST_MODULES),
      permission("./review-snapshot.js", MANIFEST_MODULES),
      permission("../../../release-policy.json", MANIFEST_MODULES),
      permission("./adapters.js", MANIFEST_MODULES),
      permission("./errors.js", MANIFEST_ARCHITECTURE),
      permission("./git.js", MANIFEST_MODULES),
      permission("./models.js", MANIFEST_MODULES),
      permission("./output-contract.js", MANIFEST_MODULES),
      permission("./process.js", MANIFEST_ARCHITECTURE),
      permission("./prompt-envelope.js", MANIFEST_MODULES),
      permission("./review-artifact.js", MANIFEST_MODULES),
      permission("./types.js", MANIFEST_ARCHITECTURE)
    ]
  ),
  boundary(
    "src/mcp.ts",
    "mcp-policy",
    [MANIFEST_MODULES, MANIFEST_ARCHITECTURE],
    [],
    [permission("./types.js", MANIFEST_ARCHITECTURE)]
  ),
  boundary(
    "src/model-selection.ts",
    "model-selection-ui",
    [MANIFEST_MODULES, MANIFEST_ARCHITECTURE],
    [permission("./models.js", MANIFEST_MODULES)],
    [
      permission("./config.js", MANIFEST_MODULES),
      permission("./interactive.js", MANIFEST_MODULES),
      permission("./types.js", MANIFEST_ARCHITECTURE)
    ]
  ),
  boundary(
    "src/models.ts",
    "model-catalog",
    [MANIFEST_MODULES, MANIFEST_ARCHITECTURE],
    [],
    [permission("./types.js", MANIFEST_ARCHITECTURE)]
  ),
  boundary(
    "src/output-contract.ts",
    "output-contract",
    [ADR_0028],
    [permission("./contracts.js", ADR_0028)],
    [permission("./types.js", ADR_0028)]
  ),
  boundary(
    "src/plan-task-completion.ts",
    "plan-task-completion",
    [MANIFEST_MODULES, MANIFEST_ARCHITECTURE, ADR_0041, ADR_0043],
    [
      permission("./verification-evidence.js", ADR_0043),
      permission("./artifact-storage.js", ADR_0041),
      permission("./errors.js", MANIFEST_ARCHITECTURE),
      permission("./git.js", MANIFEST_MODULES),
      permission("./types.js", MANIFEST_ARCHITECTURE)
    ]
  ),
  boundary(
    "src/process.ts",
    "process-boundary",
    [MANIFEST_ARCHITECTURE, MANIFEST_MODULES],
    [permission("./errors.js", MANIFEST_ARCHITECTURE)],
    [permission("./types.js", MANIFEST_ARCHITECTURE)]
  ),
  boundary(
    "src/progress.ts",
    "progress-rendering",
    [MANIFEST_MODULES, MANIFEST_ARCHITECTURE],
    [
      permission("./ansi.js", MANIFEST_MODULES),
      permission("./format.js", MANIFEST_MODULES)
    ],
    [permission("./types.js", MANIFEST_ARCHITECTURE)]
  ),
  boundary(
    "src/prompt-envelope.ts",
    "prompt-envelope",
    [ADR_0028],
    [permission("./types.js", ADR_0028)]
  ),
  boundary(
    "src/prompts.ts",
    "prompt-construction",
    [MANIFEST_MODULES, MANIFEST_ARCHITECTURE, ADR_0028, ADR_0042],
    [
      permission("./phase-instructions.js", ADR_0042),
      permission("./prompt-envelope.js", ADR_0028),
      permission("./review-artifact.js", MANIFEST_MODULES)
    ],
    [
      permission("./git.js", MANIFEST_MODULES),
      permission("./types.js", MANIFEST_ARCHITECTURE)
    ]
  ),
  boundary(
    "src/review-artifact.ts",
    "review-artifact",
    [MANIFEST_MODULES, MANIFEST_ARCHITECTURE, ADR_0041],
    [
      permission("./artifact-storage.js", ADR_0041),
      permission("./validation.js", MANIFEST_MODULES),
      permission("./review-snapshot.js", MANIFEST_MODULES),
      permission("./errors.js", MANIFEST_ARCHITECTURE)
    ],
    [permission("./types.js", MANIFEST_ARCHITECTURE)]
  ),
  boundary(
    "src/state-machine.ts",
    "state-machine",
    [MANIFEST_MODULES, MANIFEST_ARCHITECTURE],
    [permission("./errors.js", MANIFEST_ARCHITECTURE)],
    [permission("./types.js", MANIFEST_ARCHITECTURE)]
  ),
  boundary(
    "src/store.ts",
    "run-store",
    [
      ADR_0045,
      MANIFEST_MODULES,
      MANIFEST_ARCHITECTURE,
      ADR_0028,
      ADR_0035,
      ADR_0041,
      ADR_0043
    ],
    [
      permission("./configuration-prerequisite.js", ADR_0045),
      permission("./verification.js", ADR_0045),
      permission("./verification-evidence.js", ADR_0043),
      permission("./artifact-storage.js", ADR_0041),
      permission("./review-snapshot.js", MANIFEST_MODULES),
      permission("./cancellation.js", ADR_0035),
      permission("./cancellation-evidence.js", ADR_0035),
      permission("./context-accounting.js", ADR_0028),
      permission("./errors.js", MANIFEST_ARCHITECTURE),
      permission("./types.js", MANIFEST_ARCHITECTURE),
      permission("./validation.js", MANIFEST_MODULES)
    ]
  ),
  boundary(
    "src/terminal-attention.ts",
    "terminal-attention",
    [MANIFEST_MODULES, MANIFEST_ARCHITECTURE],
    [],
    [permission("./types.js", MANIFEST_ARCHITECTURE)]
  ),
  boundary(
    "src/types.ts",
    "foundational-types",
    [ADR_0045, MANIFEST_ARCHITECTURE, ADR_0041, ADR_0043],
    [],
    [
      permission("./configuration-prerequisite.js", ADR_0045),
      permission("./configuration-review.js", ADR_0045),
      permission("./git.js", MANIFEST_ARCHITECTURE),
      permission("./artifact-storage.js", ADR_0041),
      permission("./verification-evidence.js", ADR_0043)
    ]
  ),
  boundary(
    "src/validation.ts",
    "runtime-validation",
    [ADR_0045, MANIFEST_MODULES, MANIFEST_ARCHITECTURE, ADR_0043],
    [
      permission("./configuration-prerequisite.js", ADR_0045),
      permission("./verification-evidence.js", ADR_0043),
      permission("./errors.js", MANIFEST_ARCHITECTURE),
      permission("./models.js", MANIFEST_MODULES),
      permission("./types.js", MANIFEST_ARCHITECTURE)
    ]
  ),
  boundary(
    "src/verification.ts",
    "verification-readiness",
    [MANIFEST_MODULES, MANIFEST_ARCHITECTURE, ADR_0045],
    [permission("./errors.js", ADR_0045)],
    [permission("./types.js", MANIFEST_ARCHITECTURE)]
  ),
  boundary(
    "src/vocabulary.ts",
    "workflow-vocabulary",
    [MANIFEST_MODULES, MANIFEST_ARCHITECTURE],
    [],
    [permission("./types.js", MANIFEST_ARCHITECTURE)]
  ),
  boundary(
    "src/workflow.ts",
    "workflow-runner",
    [
      ADR_0045,
      MANIFEST_ARCHITECTURE,
      MANIFEST_MODULES,
      ADR_0028,
      ADR_0034,
      ADR_0035,
      ADR_0040,
      ADR_0043,
      ADR_0041,
      ADR_0042
    ],
    [
      permission("./configuration-prerequisite.js", ADR_0045),
      permission("./configuration-review.js", ADR_0045),
      permission("./verification-config.js", ADR_0045),
      permission("./verification-evidence.js", ADR_0043),
      permission("./phase-instructions.js", ADR_0042),
      permission("./artifact-storage.js", ADR_0041),
      permission("./project-adoption.js", ADR_0040),
      permission("./review-snapshot.js", MANIFEST_MODULES),
      permission("./cancellation.js", ADR_0035),
      permission("./cancellation-evidence.js", ADR_0035),
      permission("./adapters.js", MANIFEST_ARCHITECTURE),
      permission("./claude-permissions.js", MANIFEST_MODULES),
      permission("./config.js", MANIFEST_ARCHITECTURE),
      permission("./context-accounting.js", ADR_0028),
      permission("./contracts.js", MANIFEST_ARCHITECTURE),
      permission("./errors.js", MANIFEST_ARCHITECTURE),
      permission("./git.js", MANIFEST_ARCHITECTURE),
      permission("./models.js", MANIFEST_MODULES),
      permission("./output-contract.js", ADR_0028),
      permission("./plan-task-completion.js", MANIFEST_MODULES),
      permission("./process.js", MANIFEST_ARCHITECTURE),
      permission("./prompt-envelope.js", ADR_0028),
      permission("./prompts.js", MANIFEST_ARCHITECTURE),
      permission("./review-artifact.js", MANIFEST_ARCHITECTURE),
      permission("./state-machine.js", MANIFEST_ARCHITECTURE),
      permission("./store.js", MANIFEST_ARCHITECTURE),
      permission("./types.js", MANIFEST_ARCHITECTURE),
      permission("./validation.js", MANIFEST_ARCHITECTURE),
      permission("./verification.js", MANIFEST_ARCHITECTURE),
      permission("./vocabulary.js", MANIFEST_MODULES)
    ],
    [permission("./human-time.js", ADR_0034)]
  )
];

export class ImportBoundaryPolicyError extends Error {
  constructor(issue) {
    super(formatImportBoundaryPolicyError(issue));
    this.name = "ImportBoundaryPolicyError";
    this.code = POLICY_ERROR_CODE;
    this.issue = issue;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function safeImporter(value) {
  return typeof value === "string" && IMPORTER_PATTERN.test(value)
    ? value
    : "<invalid-module>";
}

function safeTarget(value) {
  return typeof value === "string" && validTargetShape(value)
    ? value
    : "<invalid-target>";
}

export function formatImportBoundaryPolicyError(issue) {
  const parts = [POLICY_ERROR_CODE, issue.kind];
  if (issue.importer !== undefined) {
    parts.push(`importer=${safeImporter(issue.importer)}`);
  }
  if (issue.target !== undefined) {
    parts.push(`target=${safeTarget(issue.target)}`);
  }
  return parts.join(" ");
}

function fail(kind, importer, target) {
  const issue = { kind };
  if (importer !== undefined) issue.importer = importer;
  if (target !== undefined) issue.target = target;
  throw new ImportBoundaryPolicyError(issue);
}

function validTargetShape(target) {
  if (
    typeof target !== "string" ||
    (!target.startsWith("./") && !target.startsWith("../")) ||
    (!TARGET_EXTENSION_PATTERN.test(target) &&
      ![
        "../../../plugins/banzai/lib/artifact-storage.mjs",
        "../../../plugins/banzai/lib/verification-evidence.mjs",
        "../../../plugins/banzai/lib/verification-store.mjs",
        "../../../plugins/banzai/lib/task-verification.mjs",
        "../../../plugins/banzai/lib/task-verification-store.mjs"
      ].includes(target)) ||
    TARGET_META_PATTERN.test(target) ||
    target.includes("//")
  ) {
    return false;
  }
  const segments = target.split("/");
  let ordinarySeen = false;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (index === 0 && (segment === "." || segment === "..")) continue;
    if (segment === ".." && !ordinarySeen) continue;
    if (segment === "" || segment === "." || segment === "..") return false;
    ordinarySeen = true;
  }
  return ordinarySeen;
}

function validAuthority(authority) {
  return (
    typeof authority === "string" &&
    (MANIFEST_AUTHORITY_PATTERN.test(authority) ||
      POLICY_ADR_AUTHORITIES.has(authority))
  );
}

function assertClosedKeys(value, keys, kind, importer, target) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(kind, importer, target);
  }
}

function validatePermissionList(
  value,
  field,
  importer,
  authorities,
  sourceModules
) {
  if (!Array.isArray(value)) fail("permission_list_invalid", importer);
  const targets = new Set();
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      fail("permission_invalid", importer);
    }
    assertClosedKeys(
      item,
      ["target", "authority"],
      "permission_invalid",
      importer,
      item.target
    );
    if (!validTargetShape(item.target)) {
      fail("target_invalid", importer, item.target);
    }
    if (!validAuthority(item.authority) || !authorities.has(item.authority)) {
      fail("permission_authority_invalid", importer, item.target);
    }
    if (targets.has(item.target)) {
      fail("permission_duplicate", importer, item.target);
    }
    targets.add(item.target);
    if (item.target.endsWith(".js")) {
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(importer), item.target)
      );
      const targetModule = `${resolved.slice(0, -3)}.ts`;
      if (!resolved.startsWith("src/") || !sourceModules.has(targetModule)) {
        fail("source_target_missing", importer, item.target);
      }
      if (targetModule === importer) {
        fail("self_dependency", importer, item.target);
      }
    }
  }
  if (field === "typeOnly") {
    for (const target of targets) {
      if (!target.endsWith(".js")) {
        fail("type_only_resource_invalid", importer, target);
      }
    }
  }
  return targets;
}

export function discoverProductionModules(sourceRoot) {
  const root =
    sourceRoot instanceof URL
      ? fileURLToPath(sourceRoot)
      : path.resolve(sourceRoot);
  const modules = [];
  const walk = (directory, relativeDirectory) => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    );
    for (const entry of entries) {
      const relative = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const absolute = path.join(root, ...relative.split("/"));
      if (entry.isSymbolicLink()) {
        fail("source_entry_symlink", `src/${relative}`);
      }
      if (entry.isDirectory()) {
        walk(absolute, relative);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".d.ts")
      ) {
        modules.push(`src/${relative}`);
      }
    }
  };
  walk(root, "");
  return modules.sort();
}

export function validateImportBoundaryPolicy(entries, sourceModules) {
  if (!Array.isArray(entries) || !Array.isArray(sourceModules)) {
    fail("policy_input_invalid");
  }
  const sourceSet = new Set();
  for (const importer of sourceModules) {
    if (typeof importer !== "string" || !IMPORTER_PATTERN.test(importer)) {
      fail("source_module_invalid", importer);
    }
    if (sourceSet.has(importer)) fail("source_module_duplicate", importer);
    sourceSet.add(importer);
  }
  const byImporter = new Map();
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      fail("policy_entry_invalid");
    }
    assertClosedKeys(
      entry,
      ["importer", "boundary", "authorities", "runtime", "typeOnly"],
      "policy_entry_invalid",
      entry.importer
    );
    const importer = entry.importer;
    if (typeof importer !== "string" || !IMPORTER_PATTERN.test(importer)) {
      fail("importer_invalid", importer);
    }
    if (byImporter.has(importer)) fail("importer_duplicate", importer);
    if (!sourceSet.has(importer)) fail("importer_stale", importer);
    if (
      typeof entry.boundary !== "string" ||
      !BOUNDARY_PATTERN.test(entry.boundary)
    ) {
      fail("boundary_invalid", importer);
    }
    if (!Array.isArray(entry.authorities) || entry.authorities.length === 0) {
      fail("authorities_invalid", importer);
    }
    const authorities = new Set();
    for (const authority of entry.authorities) {
      if (!validAuthority(authority) || authorities.has(authority)) {
        fail("authority_invalid", importer);
      }
      authorities.add(authority);
    }
    const runtime = validatePermissionList(
      entry.runtime,
      "runtime",
      importer,
      authorities,
      sourceSet
    );
    const typeOnly = validatePermissionList(
      entry.typeOnly,
      "typeOnly",
      importer,
      authorities,
      sourceSet
    );
    for (const target of typeOnly) {
      if (runtime.has(target)) {
        fail("permission_overlap", importer, target);
      }
    }
    byImporter.set(importer, {
      importer,
      boundary: entry.boundary,
      authorities: [...authorities],
      runtime: entry.runtime.map((item) => ({ ...item })),
      typeOnly: entry.typeOnly.map((item) => ({ ...item }))
    });
  }
  for (const importer of [...sourceSet].sort()) {
    if (!byImporter.has(importer)) fail("importer_missing", importer);
  }
  return byImporter;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function deniedRelativePattern(allowed) {
  const exact = allowed.map(escapeRegExp).sort();
  const allowance = exact.length === 0 ? "" : `(?!(?:${exact.join("|")})$)`;
  return `^${allowance}\\.{1,2}/`;
}

function restrictionMessage(entry, kind) {
  return `${kind} dependency from ${entry.importer} violates ${entry.boundary} (${entry.authorities.join(", ")}).`;
}

export function createImportBoundaryConfigs(validatedPolicy) {
  if (!(validatedPolicy instanceof Map)) fail("validated_policy_invalid");
  return [...validatedPolicy.values()]
    .sort((left, right) =>
      left.importer < right.importer
        ? -1
        : left.importer > right.importer
          ? 1
          : 0
    )
    .map((entry) => {
      const runtimeTargets = entry.runtime.map((item) => item.target);
      const typeOnlyTargets = entry.typeOnly.map((item) => item.target);
      const allTargets = [...runtimeTargets, ...typeOnlyTargets];
      const paths = typeOnlyTargets.map((target) => ({
        name: target,
        allowTypeImports: true,
        message: restrictionMessage(entry, "Runtime")
      }));
      paths.push({
        name: "node:module",
        importNames: ["createRequire", "default"],
        message: restrictionMessage(entry, "CommonJS loader")
      });
      paths.push({
        name: "module",
        importNames: ["createRequire", "default"],
        message: restrictionMessage(entry, "CommonJS loader")
      });
      const alternateMessage = restrictionMessage(entry, "Alternate local");
      const commonJsMessage = restrictionMessage(entry, "CommonJS loader");
      const deniedTypePattern = deniedRelativePattern(allTargets);
      const deniedTypeSelectorPattern = deniedTypePattern.replaceAll(
        "/",
        "\\/"
      );
      const syntaxRestrictions = [
        {
          selector:
            'ImportExpression[source.type="Literal"][source.value=/^\\./]',
          message: alternateMessage
        },
        {
          selector: 'ImportExpression[source.type!="Literal"]',
          message: alternateMessage
        },
        {
          selector: "TSImportType[source.value=/^\\./]",
          message: restrictionMessage(entry, "Inline type-only")
        },
        {
          selector: "TSImportEqualsDeclaration",
          message: alternateMessage
        },
        {
          selector: 'Identifier[name="require"]',
          message: commonJsMessage
        },
        {
          selector:
            'MemberExpression[property.name="require"], MemberExpression[property.value="require"]',
          message: commonJsMessage
        },
        {
          selector:
            'ImportExpression[source.type="Literal"][source.value=/^(?:node:)?module$/]',
          message: commonJsMessage
        },
        {
          selector:
            'CallExpression[callee.object.name="process"][callee.property.name="getBuiltinModule"]',
          message: commonJsMessage
        },
        {
          selector: `ImportDeclaration[importKind="type"][source.value=/${deniedTypeSelectorPattern}/]`,
          message: restrictionMessage(entry, "Type-only")
        },
        {
          selector: `ExportNamedDeclaration[exportKind="type"][source.value=/${deniedTypeSelectorPattern}/]`,
          message: restrictionMessage(entry, "Type-only")
        },
        {
          selector: `ExportAllDeclaration[exportKind="type"][source.value=/${deniedTypeSelectorPattern}/]`,
          message: restrictionMessage(entry, "Type-only")
        },
        ...typeOnlyTargets.flatMap((target) => [
          {
            selector: `ImportDeclaration[importKind!="type"][source.value=${JSON.stringify(target)}] ImportSpecifier[importKind="type"]`,
            message: `${restrictionMessage(entry, "Type-only")} Use a declaration-level import type.`
          },
          {
            selector: `ExportNamedDeclaration[exportKind!="type"][source.value=${JSON.stringify(target)}] ExportSpecifier[exportKind="type"]`,
            message: `${restrictionMessage(entry, "Type-only")} Use a declaration-level export type.`
          }
        ])
      ];
      return {
        name: `banzai/import-boundary/${entry.importer}`,
        files: [entry.importer],
        linterOptions: {
          noInlineConfig: true
        },
        rules: {
          "no-restricted-imports": [
            "error",
            {
              paths,
              patterns: [
                {
                  regex: deniedRelativePattern(runtimeTargets),
                  allowTypeImports: true,
                  message: restrictionMessage(entry, "Runtime")
                },
                {
                  regex: deniedTypePattern,
                  message: restrictionMessage(entry, "Unpermitted")
                }
              ]
            }
          ],
          "no-restricted-syntax": ["error", ...syntaxRestrictions]
        }
      };
    });
}
