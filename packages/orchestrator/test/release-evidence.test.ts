import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SCRIPT = path.join(process.cwd(), "scripts", "release-evidence.mjs");
const TOKEN = "release-evidence-fixture-secret-5d1e";
const REPOSITORY = "example/banzai";
const REPOSITORY_ID = 4242;
const LANES = ["release_check_node_22", "release_check_node_24"] as const;
const RUN_ID = 9001;
const ATTEMPT = 2;

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

type Endpoint = "runs" | "jobs" | "artifacts";

/** How one endpoint misbehaves; `total` replaces the listing's total_count. */
interface Fault {
  status?: number;
  body?: string;
  drop?: boolean;
  total?: unknown;
}

interface Scenario {
  runs: Record<string, unknown>[];
  jobs: Record<string, unknown>[];
  artifacts: Record<string, unknown>[];
  faults?: Partial<Record<Endpoint, Fault>>;
  /** Faults for the jobs or artifacts of one run id only. */
  runFaults?: Record<number, Partial<Record<"jobs" | "artifacts", Fault>>>;
  /** Jobs served for one run id instead of `jobs`. */
  runJobs?: Record<number, Record<string, unknown>[]>;
  /** Artifacts served for one run id instead of `artifacts`. */
  runArtifacts?: Record<number, Record<string, unknown>[]>;
}

interface RecordedRequest {
  pathname: string;
  query: URLSearchParams;
  authorization: string | undefined;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-release-evidence-"));
  await git(root, "init", "-q", "-b", "main");
  await git(root, "config", "user.email", "release-evidence@example.invalid");
  await git(root, "config", "user.name", "Release Evidence");
  await git(root, "config", "commit.gpgsign", "false");
  await writeFile(path.join(root, "a.txt"), "base\n", "utf8");
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "base");
  return root;
}

/** A tag on a merge commit whose second parent is the pull-request head. */
async function mergeFixture(options: { divergeMain?: boolean } = {}) {
  const root = await repository();
  await git(root, "checkout", "-qb", "dev");
  await writeFile(path.join(root, "a.txt"), "changed on dev\n", "utf8");
  await git(root, "commit", "-qam", "dev change");
  const head = await git(root, "rev-parse", "HEAD");
  await git(root, "checkout", "-q", "main");
  if (options.divergeMain === true) {
    await writeFile(path.join(root, "main-only.txt"), "main\n", "utf8");
    await git(root, "add", ".");
    await git(root, "commit", "-qm", "main only");
  }
  await git(root, "merge", "-q", "--no-ff", "-m", "Merge dev", "dev");
  const tree = await git(root, "rev-parse", "HEAD^{tree}");
  return { root, head, tree };
}

function evidenceName(lane: string, attempt: number, tree: string): string {
  return `release-evidence-${lane}-attempt-${attempt}-tree-${tree}`;
}

function boundScenario(head: string, tree: string): Scenario {
  return {
    runs: [
      {
        id: RUN_ID,
        run_attempt: ATTEMPT,
        repository: { id: REPOSITORY_ID },
        path: ".github/workflows/ci.yml",
        event: "pull_request",
        head_sha: head,
        status: "completed",
        conclusion: "success"
      }
    ],
    jobs: [
      ...LANES.map((name, index) => ({
        id: 100 + index,
        name,
        run_id: RUN_ID,
        run_attempt: ATTEMPT,
        status: "completed",
        conclusion: "success"
      })),
      {
        id: 102,
        name: "forward_compatibility_node_26",
        run_id: RUN_ID,
        run_attempt: ATTEMPT,
        status: "completed",
        conclusion: "skipped"
      }
    ],
    artifacts: LANES.map((lane, index) => ({
      id: 200 + index,
      name: evidenceName(lane, ATTEMPT, tree),
      expired: false,
      workflow_run: { id: RUN_ID }
    }))
  };
}

async function startApi(
  scenario: Scenario
): Promise<{ server: Server; url: string; requests: RecordedRequest[] }> {
  const requests: RecordedRequest[] = [];
  const base = `/repos/${REPOSITORY}/actions`;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push({
      pathname: url.pathname,
      query: url.searchParams,
      authorization: request.headers.authorization
    });
    const runId = Number(/\/runs\/(\d+)\//.exec(url.pathname)?.[1]);
    const route: [Endpoint, string, Record<string, unknown>[]] | null =
      url.pathname === `${base}/workflows/ci.yml/runs`
        ? ["runs", "workflow_runs", scenario.runs]
        : url.pathname.startsWith(`${base}/runs/`) &&
            url.pathname.endsWith("/jobs")
          ? ["jobs", "jobs", scenario.runJobs?.[runId] ?? scenario.jobs]
          : url.pathname.startsWith(`${base}/runs/`) &&
              url.pathname.endsWith("/artifacts")
            ? [
                "artifacts",
                "artifacts",
                scenario.runArtifacts?.[runId] ?? scenario.artifacts
              ]
            : null;
    if (route === null) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end("{}");
      return;
    }
    const [endpoint, field, items] = route;
    const fault =
      (endpoint === "runs"
        ? undefined
        : scenario.runFaults?.[runId]?.[endpoint]) ??
      scenario.faults?.[endpoint] ??
      {};
    if (fault.drop === true) {
      request.socket.destroy();
      return;
    }
    response.writeHead(fault.status ?? 200, {
      "content-type": "application/json"
    });
    response.end(
      fault.body ??
        JSON.stringify({
          total_count: "total" in fault ? fault.total : items.length,
          [field]: items
        })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}`, requests };
}

async function runScript(
  cwd: string,
  command: string,
  environment: Record<string, string>
): Promise<RunResult> {
  // Only the variables a test sets reach the script: the suite itself runs
  // inside GitHub Actions, whose GITHUB_* values must not leak in.
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    ...environment
  };
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [SCRIPT, command],
      { cwd, env }
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code ?? -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? ""
    };
  }
}

async function readOptional(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function verify(
  root: string,
  scenario: Scenario,
  overrides: Record<string, string | null> = {}
) {
  const api = await startApi(scenario);
  const scratch = await mkdtemp(path.join(tmpdir(), "banzai-evidence-out-"));
  const outputFile = path.join(scratch, "output");
  const summaryFile = path.join(scratch, "summary");
  try {
    const environment: Record<string, string> = {};
    const variables: Record<string, string | null> = {
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_REPOSITORY_ID: String(REPOSITORY_ID),
      GITHUB_API_URL: api.url,
      GITHUB_TOKEN: TOKEN,
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
      ...overrides
    };
    for (const [key, value] of Object.entries(variables)) {
      if (value !== null) environment[key] = value;
    }
    const result = await runScript(root, "verify", environment);
    const output = await readOptional(outputFile);
    const summary = await readOptional(summaryFile);
    for (const text of [result.stdout, result.stderr, output, summary]) {
      assert.equal(text.includes(TOKEN), false, "the token was printed");
    }
    return { ...result, output, summary, requests: api.requests };
  } finally {
    await new Promise((resolve) => api.server.close(resolve));
    await rm(scratch, { recursive: true, force: true });
  }
}

test("verify binds a tag to both lanes' evidence from its pull-request run", async () => {
  const fixture = await mergeFixture();
  try {
    const result = await verify(
      fixture.root,
      boundScenario(fixture.head, fixture.tree)
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      result.output,
      `bound=true\nrun_id=${RUN_ID}\nrun_attempt=${ATTEMPT}\n`
    );
    assert.equal(
      result.summary,
      `Release evidence reused: CI run ${RUN_ID} attempt ${ATTEMPT} (head ${fixture.head}, tree ${fixture.tree}).\n`
    );
    const runsRequest = result.requests[0];
    assert.ok(runsRequest !== undefined);
    assert.equal(
      runsRequest.pathname,
      `/repos/${REPOSITORY}/actions/workflows/ci.yml/runs`
    );
    assert.equal(runsRequest.query.get("head_sha"), fixture.head);
    assert.equal(runsRequest.query.get("event"), "pull_request");
    assert.equal(runsRequest.query.get("status"), "success");
    assert.deepEqual(
      result.requests.map((request) => request.pathname).slice(1),
      [
        `/repos/${REPOSITORY}/actions/runs/${RUN_ID}/attempts/${ATTEMPT}/jobs`,
        `/repos/${REPOSITORY}/actions/runs/${RUN_ID}/artifacts`
      ]
    );
    for (const request of result.requests) {
      assert.equal(request.authorization, `Bearer ${TOKEN}`);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("verify uses a later run when an earlier candidate is not bound", async () => {
  const fixture = await mergeFixture();
  try {
    const scenario = boundScenario(fixture.head, fixture.tree);
    const [good] = scenario.runs;
    scenario.runs = [
      { ...good, id: 8000, path: ".github/workflows/other.yml" },
      ...scenario.runs
    ];
    const result = await verify(fixture.root, scenario);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.output, /^bound=true\nrun_id=9001\n/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("verify leaves every unbound case to the two-lane fallback", async (t) => {
  const fixture = await mergeFixture();
  const plain = await repository();
  const diverged = await mergeFixture({ divergeMain: true });
  const lane22 = LANES[0];
  const otherTree = "0".repeat(fixture.tree.length);
  const cases: {
    name: string;
    root?: string;
    reason: RegExp;
    change?: (scenario: Scenario) => void;
  }[] = [
    {
      name: "a tag that is not a merge commit",
      root: plain,
      reason: /the tag commit is not a merge commit/
    },
    {
      name: "a tag tree that differs from its second parent's",
      root: diverged.root,
      reason: /the tag tree differs from its second parent's tree/
    },
    {
      name: "no successful run",
      reason: /no successful CI pull_request run exists/,
      change: (scenario) => {
        scenario.runs = [];
      }
    },
    {
      name: "a run of another workflow file with matching head, jobs and evidence",
      reason: /is not a successful pull_request run of this repository's/,
      change: (scenario) => {
        scenario.runs = scenario.runs.map((run) => ({
          ...run,
          path: ".github/workflows/impostor.yml"
        }));
      }
    },
    {
      name: "a run of another repository",
      reason: /is not a successful pull_request run of this repository's/,
      change: (scenario) => {
        scenario.runs = scenario.runs.map((run) => ({
          ...run,
          repository: { id: REPOSITORY_ID + 1 }
        }));
      }
    },
    ...["failure", "cancelled"].map((conclusion) => ({
      name: `a ${conclusion} lane job`,
      reason: new RegExp(`${lane22} did not succeed exactly once`),
      change: (scenario: Scenario) => {
        scenario.jobs = scenario.jobs.map((job) =>
          job.name === lane22 ? { ...job, conclusion } : job
        );
      }
    })),
    {
      name: "lane jobs of another attempt",
      reason: new RegExp(`${lane22} did not succeed exactly once`),
      change: (scenario) => {
        scenario.jobs = scenario.jobs.map((job) => ({
          ...job,
          run_attempt: ATTEMPT - 1
        }));
      }
    },
    {
      name: "evidence from another attempt only",
      reason:
        /holds no release evidence for release_check_node_22 in attempt 2/,
      change: (scenario) => {
        scenario.artifacts = LANES.map((lane, index) => ({
          id: 300 + index,
          name: evidenceName(lane, ATTEMPT - 1, fixture.tree),
          expired: false,
          workflow_run: { id: RUN_ID }
        }));
      }
    },
    {
      name: "duplicate evidence for a lane",
      reason: /holds duplicate release evidence for release_check_node_22/,
      change: (scenario) => {
        scenario.artifacts = [
          ...scenario.artifacts,
          { ...scenario.artifacts[0], id: 299 }
        ];
      }
    },
    {
      name: "expired evidence",
      reason: /is expired or belongs to another run/,
      change: (scenario) => {
        scenario.artifacts = scenario.artifacts.map((artifact, index) =>
          index === 0 ? { ...artifact, expired: true } : artifact
        );
      }
    },
    {
      name: "evidence attributed to another run",
      reason: /is expired or belongs to another run/,
      change: (scenario) => {
        scenario.artifacts = scenario.artifacts.map((artifact, index) =>
          index === 0 ? { ...artifact, workflow_run: { id: 1 } } : artifact
        );
      }
    },
    {
      name: "malformed evidence",
      reason: /holds malformed release evidence/,
      change: (scenario) => {
        scenario.artifacts = [
          ...scenario.artifacts,
          {
            id: 298,
            name: `${evidenceName(lane22, ATTEMPT, "")}not-a-tree`,
            expired: false,
            workflow_run: { id: RUN_ID }
          }
        ];
      }
    },
    {
      name: "evidence naming another tree",
      reason: /names another tree/,
      change: (scenario) => {
        scenario.artifacts = scenario.artifacts.map((artifact, index) =>
          index === 0
            ? { ...artifact, name: evidenceName(lane22, ATTEMPT, otherTree) }
            : artifact
        );
      }
    },
    {
      name: "an API error",
      reason: /the GitHub API returned HTTP 500/,
      change: (scenario) => {
        scenario.faults = { runs: { status: 500 } };
      }
    },
    {
      name: "invalid API JSON",
      reason: /the GitHub API returned invalid JSON/,
      change: (scenario) => {
        scenario.faults = { runs: { body: "{not json" } };
      }
    },
    {
      name: "an incomplete run listing",
      reason: /the CI run listing is incomplete/,
      change: (scenario) => {
        scenario.faults = { runs: { total: 101 } };
      }
    }
  ];
  try {
    for (const item of cases) {
      await t.test(item.name, async () => {
        const scenario = boundScenario(fixture.head, fixture.tree);
        item.change?.(scenario);
        const result = await verify(item.root ?? fixture.root, scenario);
        assert.equal(result.code, 0, result.stderr);
        assert.equal(result.output, "bound=false\n");
        assert.match(result.summary, /^Release evidence not bound: /);
        assert.match(result.summary, item.reason);
        assert.match(
          result.summary,
          /The complete release gate runs on both supported lanes\.\n$/
        );
      });
    }
  } finally {
    for (const root of [fixture.root, plain, diverged.root]) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

/** A complete first candidate, run 8000, ahead of the bound run 9001. */
function withFirstCandidate(
  scenario: Scenario,
  change: (first: {
    run: Record<string, unknown>;
    jobs: Record<string, unknown>[];
    artifacts: Record<string, unknown>[];
  }) => void
): Scenario {
  const [later] = scenario.runs;
  const first = {
    run: { ...later, id: 8000 },
    jobs: scenario.jobs.map((job) => ({ ...job, run_id: 8000 })),
    artifacts: scenario.artifacts.map((artifact) => ({
      ...artifact,
      workflow_run: { id: 8000 }
    }))
  };
  change(first);
  return {
    ...scenario,
    runs: [first.run, ...scenario.runs],
    runJobs: { 8000: first.jobs },
    runArtifacts: { 8000: first.artifacts }
  };
}

function without(
  record: Record<string, unknown>,
  field: string
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== field)
  );
}

test("verify stops at a malformed record even when a later run would bind", async (t) => {
  const fixture = await mergeFixture();
  const lane22 = LANES[0];
  const lane22Job = (jobs: Record<string, unknown>[]) =>
    jobs.findIndex((job) => job.name === lane22);
  // An id of the other object format: well-formed hexadecimal, wrong length.
  const otherFormatId = "a".repeat(fixture.head.length === 40 ? 64 : 40);
  const malformedHeads: [string, string][] = [
    ["a non-hexadecimal head", "not-a-commit"],
    ["an empty head", ""],
    ["an uppercase head", fixture.head.toUpperCase()],
    ["a head of the other object format", otherFormatId]
  ];
  const cases: [string, RegExp, Parameters<typeof withFirstCandidate>[1]][] = [
    ...malformedHeads.map(
      ([name, head]): [
        string,
        RegExp,
        Parameters<typeof withFirstCandidate>[1]
      ] => [
        name,
        /CI run 8000 without a valid head_sha/,
        (first) => {
          first.run = { ...first.run, head_sha: head };
        }
      ]
    ),
    [
      "a run without run_attempt",
      /CI run 8000 without a valid run_attempt/,
      (first) => {
        first.run = without(first.run, "run_attempt");
      }
    ],
    [
      "a run without a repository id",
      /CI run 8000 without a valid repository\.id/,
      (first) => {
        first.run = without(first.run, "repository");
      }
    ],
    [
      "a run without a conclusion",
      /CI run 8000 without a valid conclusion/,
      (first) => {
        first.run = without(first.run, "conclusion");
      }
    ],
    [
      "a lane job without run_attempt",
      /a job of CI run 8000 without a valid run_attempt/,
      (first) => {
        const index = lane22Job(first.jobs);
        first.jobs[index] = without(first.jobs[index] ?? {}, "run_attempt");
      }
    ],
    [
      "a lane job without a conclusion",
      /a job of CI run 8000 without a valid conclusion/,
      (first) => {
        const index = lane22Job(first.jobs);
        first.jobs[index] = without(first.jobs[index] ?? {}, "conclusion");
      }
    ],
    [
      "evidence without expired",
      /an artifact of CI run 8000 without a valid expired/,
      (first) => {
        first.artifacts[0] = without(first.artifacts[0] ?? {}, "expired");
      }
    ],
    [
      "evidence without its workflow run",
      /release evidence of CI run 8000 without a valid workflow_run\.id/,
      (first) => {
        first.artifacts[0] = without(first.artifacts[0] ?? {}, "workflow_run");
      }
    ],
    [
      "a malformed evidence name",
      /CI run 8000 holds malformed release evidence/,
      (first) => {
        first.artifacts.push({
          id: 297,
          name: `${evidenceName(lane22, ATTEMPT, "")}not-a-tree`,
          expired: false,
          workflow_run: { id: 8000 }
        });
      }
    ],
    [
      "evidence naming a tree of the other object format",
      /CI run 8000 holds malformed release evidence/,
      (first) => {
        first.artifacts[0] = {
          ...first.artifacts[0],
          name: evidenceName(lane22, ATTEMPT, otherFormatId)
        };
      }
    ]
  ];
  try {
    await t.test("control: a complete first candidate binds", async () => {
      const result = await verify(
        fixture.root,
        withFirstCandidate(boundScenario(fixture.head, fixture.tree), () => {})
      );
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.output, /^bound=true\nrun_id=8000\n/);
      assert.equal(
        result.requests.some((request) =>
          request.pathname.includes(`/runs/${RUN_ID}/`)
        ),
        false
      );
    });
    // Well-formed ids that merely differ are a mismatch, so the search goes on.
    const otherId = "0".repeat(fixture.head.length);
    const mismatches: [string, Parameters<typeof withFirstCandidate>[1]][] = [
      [
        "a different well-formed head",
        (first) => {
          first.run = { ...first.run, head_sha: otherId };
        }
      ],
      [
        "evidence naming a different well-formed tree",
        (first) => {
          first.artifacts[0] = {
            ...first.artifacts[0],
            name: evidenceName(lane22, ATTEMPT, otherId)
          };
        }
      ]
    ];
    for (const [name, change] of mismatches) {
      await t.test(`control: ${name} lets a later run bind`, async () => {
        const result = await verify(
          fixture.root,
          withFirstCandidate(boundScenario(fixture.head, fixture.tree), change)
        );
        assert.equal(result.code, 0, result.stderr);
        assert.match(result.output, /^bound=true\nrun_id=9001\n/);
      });
    }
    for (const [name, reason, change] of cases) {
      await t.test(name, async () => {
        const result = await verify(
          fixture.root,
          withFirstCandidate(boundScenario(fixture.head, fixture.tree), change)
        );
        assert.equal(result.code, 0, result.stderr);
        assert.equal(result.output, "bound=false\n");
        assert.match(result.summary, /^Release evidence not bound: /);
        assert.match(result.summary, reason);
        assert.equal(
          result.requests.some((request) =>
            request.pathname.includes(`/runs/${RUN_ID}/`)
          ),
          false,
          "the later run was consulted after a malformed record"
        );
      });
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("verify stops at a failed response even when a later run would bind", async (t) => {
  const fixture = await mergeFixture();
  const faults: [string, Fault, RegExp][] = [
    [
      "HTTP 500",
      { status: 500 },
      /returned HTTP 500 for the \w+ of CI run 8000/
    ],
    [
      "invalid JSON",
      { body: "{not json" },
      /invalid JSON for the \w+ of CI run 8000/
    ],
    [
      "a dropped connection",
      { drop: true },
      /request for the \w+ of CI run 8000 failed/
    ],
    [
      "an incomplete listing",
      { total: 101 },
      /CI run 8000 \w+ listing is incomplete/
    ],
    ["a negative count", { total: -1 }, /unexpected CI run 8000 \w+ listing/]
  ];
  try {
    for (const endpoint of ["jobs", "artifacts"] as const) {
      for (const [name, fault, reason] of faults) {
        await t.test(`${name} for the first run's ${endpoint}`, async () => {
          const scenario = boundScenario(fixture.head, fixture.tree);
          const [later] = scenario.runs;
          scenario.runs = [{ ...later, id: 8000 }, ...scenario.runs];
          scenario.runJobs = {
            8000: scenario.jobs.map((job) => ({ ...job, run_id: 8000 }))
          };
          scenario.runFaults = { 8000: { [endpoint]: fault } };
          const result = await verify(fixture.root, scenario);
          assert.equal(result.code, 0, result.stderr);
          assert.equal(result.output, "bound=false\n");
          assert.match(result.summary, /^Release evidence not bound: /);
          assert.match(result.summary, reason);
          assert.equal(
            result.requests.some((request) =>
              request.pathname.includes(`/runs/${RUN_ID}/`)
            ),
            false,
            "the later run was consulted after a failed response"
          );
        });
      }
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("verify rejects listing counts that do not equal the page", async (t) => {
  const fixture = await mergeFixture();
  const sizes: Record<Endpoint, number> = { runs: 1, jobs: 3, artifacts: 2 };
  const labels: Record<Endpoint, string> = {
    runs: "CI run",
    jobs: `CI run ${RUN_ID} jobs`,
    artifacts: `CI run ${RUN_ID} artifacts`
  };
  try {
    for (const endpoint of ["runs", "jobs", "artifacts"] as const) {
      for (const [name, total, reason] of [
        ["negative", -1, "unexpected"],
        ["underreported", sizes[endpoint] - 1, "inconsistent"],
        ["fractional", 1.5, "unexpected"]
      ] as const) {
        await t.test(`a ${name} ${endpoint} count`, async () => {
          const scenario = boundScenario(fixture.head, fixture.tree);
          scenario.faults = { [endpoint]: { total } };
          const result = await verify(fixture.root, scenario);
          assert.equal(result.code, 0, result.stderr);
          assert.equal(result.output, "bound=false\n");
          assert.match(
            result.summary,
            reason === "unexpected"
              ? new RegExp(
                  `^Release evidence not bound: the GitHub API returned an unexpected ${labels[endpoint]} listing\\.`
                )
              : new RegExp(
                  `^Release evidence not bound: the ${labels[endpoint]} listing count is inconsistent\\.`
                )
          );
        });
      }
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("verify treats an unreachable API as unbound", async () => {
  const fixture = await mergeFixture();
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const { port } = closed.address() as AddressInfo;
  await new Promise((resolve) => closed.close(resolve));
  try {
    const result = await verify(
      fixture.root,
      boundScenario(fixture.head, fixture.tree),
      { GITHUB_API_URL: `http://127.0.0.1:${port}` }
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.output, "bound=false\n");
    assert.match(
      result.summary,
      /^Release evidence not bound: the GitHub API request for successful CI pull_request runs failed\./
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("verify fails without its required environment and writes no outputs", async () => {
  const fixture = await mergeFixture();
  try {
    const result = await verify(
      fixture.root,
      boundScenario(fixture.head, fixture.tree),
      { GITHUB_TOKEN: null }
    );
    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      "RELEASE_EVIDENCE_FAILED: GITHUB_TOKEN is not set\n"
    );
    assert.equal(result.output, "");
    assert.equal(result.summary, "");
    assert.deepEqual(result.requests, []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function record(root: string, lane: string) {
  const scratch = await mkdtemp(path.join(tmpdir(), "banzai-evidence-rec-"));
  const outputFile = path.join(scratch, "output");
  const runnerTemp = path.join(scratch, "temp");
  try {
    const result = await runScript(root, "record", {
      GITHUB_JOB: lane,
      GITHUB_RUN_ID: "77",
      GITHUB_RUN_ATTEMPT: "3",
      RUNNER_TEMP: runnerTemp,
      GITHUB_OUTPUT: outputFile
    });
    const output = await readOptional(outputFile);
    let written: string[] = [];
    try {
      written = await readdir(path.join(runnerTemp, "release-evidence"));
    } catch {
      written = [];
    }
    const files = await Promise.all(
      written.map((name) =>
        readFile(path.join(runnerTemp, "release-evidence", name), "utf8")
      )
    );
    return { ...result, output, written, files, runnerTemp };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

test("record names the verified tree, run attempt and lane", async () => {
  const root = await repository();
  try {
    const commit = await git(root, "rev-parse", "HEAD");
    const tree = await git(root, "rev-parse", "HEAD^{tree}");
    const result = await record(root, "release_check_node_22");
    assert.equal(result.code, 0, result.stderr);
    const name = evidenceName("release_check_node_22", 3, tree);
    assert.equal(
      result.output,
      `name=${name}\npath=${path.join(result.runnerTemp, "release-evidence", `${name}.json`)}\n`
    );
    assert.deepEqual(result.written, [`${name}.json`]);
    assert.deepEqual(JSON.parse(result.files[0] ?? ""), {
      lane: "release_check_node_22",
      runId: "77",
      runAttempt: "3",
      commit,
      tree
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("record refuses a dirty checkout or a lane outside the release policy", async () => {
  const root = await repository();
  try {
    const advisory = await record(root, "forward_compatibility_node_26");
    assert.equal(advisory.code, 1);
    assert.match(advisory.stderr, /is not a supported release lane/);
    assert.equal(advisory.output, "");
    assert.deepEqual(advisory.written, []);

    await writeFile(path.join(root, "a.txt"), "modified\n", "utf8");
    const dirty = await record(root, "release_check_node_24");
    assert.equal(dirty.code, 1);
    assert.match(
      dirty.stderr,
      /tracked files differ from the checked-out commit/
    );
    assert.equal(dirty.output, "");
    assert.deepEqual(dirty.written, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
