// Records and verifies the ADR-0053 release evidence: the tree each required
// CI lane verified, and whether a published tag is bound to it.
import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";
const CI_WORKFLOW_FILE = "ci.yml";
const EVIDENCE_PREFIX = "release-evidence-";
const EVIDENCE_NAME =
  /^release-evidence-([a-z0-9_]+)-attempt-([1-9][0-9]{0,9})-tree-([0-9a-f]{40}|[0-9a-f]{64})$/;
const POSITIVE_INTEGER = /^[1-9][0-9]{0,15}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PAGE_SIZE = "100";
const REQUEST_TIMEOUT_MS = 30_000;

class RecordError extends Error {}

// Raised for every condition that leaves evidence unbound. The message is
// written to the job summary, so it never carries a token or raw API text.
class Unbound extends Error {}

// A failed or malformed GitHub response. Unlike a candidate run that simply
// does not match, it ends the search: a later candidate must never hide it.
class ResponseFailure extends Unbound {}

async function git(args) {
  const { stdout } = await execFileAsync("git", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 30_000
  });
  return stdout.trim();
}

async function objectIdPattern() {
  const format = await git(["rev-parse", "--show-object-format"]);
  if (format === "sha1") return /^[0-9a-f]{40}$/;
  if (format === "sha256") return /^[0-9a-f]{64}$/;
  throw new Error("unsupported Git object format");
}

async function supportedLanes() {
  const policy = JSON.parse(
    await readFile(path.join(repositoryRoot, "release-policy.json"), "utf8")
  );
  const lanes = (policy?.node?.supported ?? []).map((lane) => lane?.job);
  if (
    lanes.length === 0 ||
    lanes.some((lane) => typeof lane !== "string" || !/^[a-z0-9_]+$/.test(lane))
  ) {
    throw new Error("release-policy.json lists no valid supported lanes");
  }
  return lanes;
}

function requiredEnvironment(name, pattern) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new RecordError(`${name} is not set`);
  }
  if (pattern !== undefined && !pattern.test(value)) {
    throw new RecordError(`${name} is malformed`);
  }
  return value;
}

async function record() {
  const lanes = await supportedLanes();
  const lane = requiredEnvironment("GITHUB_JOB");
  if (!lanes.includes(lane)) {
    throw new RecordError(`${lane} is not a supported release lane`);
  }
  const runId = requiredEnvironment("GITHUB_RUN_ID", POSITIVE_INTEGER);
  const attempt = requiredEnvironment("GITHUB_RUN_ATTEMPT", POSITIVE_INTEGER);
  const runnerTemp = requiredEnvironment("RUNNER_TEMP");
  const outputFile = requiredEnvironment("GITHUB_OUTPUT");
  if (!path.isAbsolute(runnerTemp)) {
    throw new RecordError("RUNNER_TEMP is not an absolute path");
  }
  // The recorded tree must be the bytes release:check verified.
  if ((await git(["status", "--porcelain", "--untracked-files=no"])) !== "") {
    throw new RecordError("tracked files differ from the checked-out commit");
  }
  const objectId = await objectIdPattern();
  const commit = await git(["rev-parse", "HEAD"]);
  const tree = await git(["rev-parse", "HEAD^{tree}"]);
  if (!objectId.test(commit) || !objectId.test(tree)) {
    throw new RecordError("Git returned a malformed object id");
  }
  const name = `${EVIDENCE_PREFIX}${lane}-attempt-${attempt}-tree-${tree}`;
  const directory = path.join(runnerTemp, "release-evidence");
  const file = path.join(directory, `${name}.json`);
  await mkdir(directory, { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify({ lane, runId, runAttempt: attempt, commit, tree }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" }
  );
  await appendFile(outputFile, `name=${name}\npath=${file}\n`, "utf8");
  process.stdout.write(`Release evidence recorded: ${name}\n`);
}

function verifyConfiguration() {
  const repository = requiredEnvironment("GITHUB_REPOSITORY", REPOSITORY);
  const repositoryId = Number(
    requiredEnvironment("GITHUB_REPOSITORY_ID", POSITIVE_INTEGER)
  );
  const apiUrl = new URL(requiredEnvironment("GITHUB_API_URL"));
  if (apiUrl.protocol !== "https:" && apiUrl.protocol !== "http:") {
    throw new RecordError("GITHUB_API_URL is not an HTTP URL");
  }
  return {
    repository,
    repositoryId,
    apiBase: apiUrl.href.replace(/\/+$/, ""),
    token: requiredEnvironment("GITHUB_TOKEN"),
    outputFile: requiredEnvironment("GITHUB_OUTPUT"),
    summaryFile: requiredEnvironment("GITHUB_STEP_SUMMARY")
  };
}

async function getJson(config, label, pathname, query) {
  const url = new URL(`${config.apiBase}/${pathname}`);
  for (const [key, value] of Object.entries({
    ...query,
    per_page: PAGE_SIZE
  })) {
    url.searchParams.set(key, value);
  }
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${config.token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch {
    throw new ResponseFailure(`the GitHub API request for ${label} failed`);
  }
  if (response.status !== 200) {
    throw new ResponseFailure(
      `the GitHub API returned HTTP ${response.status} for ${label}`
    );
  }
  try {
    return await response.json();
  } catch {
    throw new ResponseFailure(
      `the GitHub API returned invalid JSON for ${label}`
    );
  }
}

// One page holds every item: a count that is not exactly the page length is
// either an incomplete or an inconsistent listing.
function listing(body, field, label) {
  const items = body?.[field];
  const total = body?.total_count;
  if (!Array.isArray(items) || !Number.isSafeInteger(total) || total < 0) {
    throw new ResponseFailure(
      `the GitHub API returned an unexpected ${label} listing`
    );
  }
  if (total > items.length) {
    throw new ResponseFailure(`the ${label} listing is incomplete`);
  }
  if (total < items.length) {
    throw new ResponseFailure(`the ${label} listing count is inconsistent`);
  }
  return items;
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

const isString = (value) => typeof value === "string";
const isNullableString = (value) => value === null || isString(value);
const isBoolean = (value) => typeof value === "boolean";

// Required metadata must be present with its documented type before any value
// is compared. A record that lacks it is a malformed response, which ends the
// search, never a candidate that merely does not match.
function requireFields(record, fields, label) {
  for (const [field, valid] of Object.entries(fields)) {
    const value = field
      .split(".")
      .reduce((current, key) => current?.[key], record);
    if (!valid(value)) {
      throw new ResponseFailure(
        `the GitHub API returned ${label} without a valid ${field}`
      );
    }
  }
}

async function tagFacts() {
  let objectId;
  let parents;
  let tree;
  let secondParentTree;
  try {
    objectId = await objectIdPattern();
    parents = (await git(["rev-list", "--parents", "-n", "1", "HEAD"])).split(
      " "
    );
    if (parents.length !== 3) {
      throw new Unbound("the tag commit is not a merge commit");
    }
    if (!parents.every((id) => objectId.test(id))) {
      throw new Unbound("Git returned a malformed commit id");
    }
    tree = await git(["rev-parse", "HEAD^{tree}"]);
    secondParentTree = await git(["rev-parse", `${parents[2]}^{tree}`]);
  } catch (error) {
    if (error instanceof Unbound) throw error;
    throw new Unbound("Git could not read the tag commit and its parents");
  }
  if (!objectId.test(tree) || !objectId.test(secondParentTree)) {
    throw new Unbound("Git returned a malformed tree id");
  }
  if (tree !== secondParentTree) {
    throw new Unbound("the tag tree differs from its second parent's tree");
  }
  return { head: parents[2], tree, objectId };
}

async function bindRun(config, lanes, facts, run) {
  // A commit id that is not an exact id of this repository's object format is
  // malformed, not a different head.
  const isObjectId = (value) => isString(value) && facts.objectId.test(value);
  requireFields(
    run,
    {
      "repository.id": isPositiveInteger,
      path: isString,
      event: isString,
      head_sha: isObjectId,
      status: isString,
      conclusion: isNullableString,
      run_attempt: isPositiveInteger
    },
    `CI run ${run.id}`
  );
  const attempt = run.run_attempt;
  if (
    run.repository.id !== config.repositoryId ||
    run.path !== CI_WORKFLOW_PATH ||
    run.event !== "pull_request" ||
    run.head_sha !== facts.head ||
    run.status !== "completed" ||
    run.conclusion !== "success"
  ) {
    throw new Unbound(
      `CI run ${run.id} is not a successful pull_request run of this repository's ${CI_WORKFLOW_PATH} for the merged head`
    );
  }
  const repo = `repos/${config.repository}/actions/runs/${run.id}`;
  const jobs = listing(
    await getJson(
      config,
      `the jobs of CI run ${run.id}`,
      `${repo}/attempts/${attempt}/jobs`,
      {}
    ),
    "jobs",
    `CI run ${run.id} jobs`
  );
  for (const job of jobs) {
    requireFields(
      job,
      {
        name: isString,
        run_id: isPositiveInteger,
        run_attempt: isPositiveInteger,
        status: isString,
        conclusion: isNullableString
      },
      `a job of CI run ${run.id}`
    );
  }
  for (const lane of lanes) {
    const matches = jobs.filter((job) => job?.name === lane);
    const job = matches[0];
    if (
      matches.length !== 1 ||
      job.run_id !== run.id ||
      job.run_attempt !== attempt ||
      job.status !== "completed" ||
      job.conclusion !== "success"
    ) {
      throw new Unbound(
        `${lane} did not succeed exactly once in attempt ${attempt} of CI run ${run.id}`
      );
    }
  }
  const artifacts = listing(
    await getJson(
      config,
      `the artifacts of CI run ${run.id}`,
      `${repo}/artifacts`,
      {}
    ),
    "artifacts",
    `CI run ${run.id} artifacts`
  );
  const evidence = [];
  for (const artifact of artifacts) {
    requireFields(
      artifact,
      { name: isString, expired: isBoolean },
      `an artifact of CI run ${run.id}`
    );
    if (!artifact.name.startsWith(EVIDENCE_PREFIX)) {
      continue;
    }
    requireFields(
      artifact,
      { "workflow_run.id": isPositiveInteger },
      `release evidence of CI run ${run.id}`
    );
    const match = EVIDENCE_NAME.exec(artifact.name);
    if (match === null || !isObjectId(match[3])) {
      throw new ResponseFailure(
        `CI run ${run.id} holds malformed release evidence`
      );
    }
    evidence.push({
      artifact,
      lane: match[1],
      attempt: Number(match[2]),
      tree: match[3]
    });
  }
  for (const lane of lanes) {
    const matches = evidence.filter(
      (item) => item.lane === lane && item.attempt === attempt
    );
    if (matches.length !== 1) {
      throw new Unbound(
        `CI run ${run.id} holds ${matches.length === 0 ? "no" : "duplicate"} release evidence for ${lane} in attempt ${attempt}`
      );
    }
    const [item] = matches;
    if (
      item.artifact.expired !== false ||
      item.artifact.workflow_run?.id !== run.id
    ) {
      throw new Unbound(
        `the release evidence for ${lane} in CI run ${run.id} is expired or belongs to another run`
      );
    }
    if (item.tree !== facts.tree) {
      throw new Unbound(
        `the release evidence for ${lane} in CI run ${run.id} names another tree`
      );
    }
  }
  return { runId: run.id, attempt };
}

async function decide(config) {
  const lanes = await supportedLanes();
  const facts = await tagFacts();
  const runs = listing(
    await getJson(
      config,
      "successful CI pull_request runs",
      `repos/${config.repository}/actions/workflows/${CI_WORKFLOW_FILE}/runs`,
      { head_sha: facts.head, event: "pull_request", status: "success" }
    ),
    "workflow_runs",
    "CI run"
  );
  if (runs.length === 0) {
    throw new Unbound(
      `no successful CI pull_request run exists for the merged head ${facts.head}`
    );
  }
  let firstReason = null;
  for (const run of runs) {
    if (!isPositiveInteger(run?.id)) {
      throw new ResponseFailure(
        "the GitHub API returned a CI run without a valid id"
      );
    }
    try {
      return { ...(await bindRun(config, lanes, facts, run)), ...facts };
    } catch (error) {
      if (!(error instanceof Unbound) || error instanceof ResponseFailure) {
        throw error;
      }
      firstReason ??= error.message;
    }
  }
  throw new Unbound(firstReason);
}

async function verify() {
  const config = verifyConfiguration();
  let outputs;
  let summary;
  try {
    const bound = await decide(config);
    outputs = `bound=true\nrun_id=${bound.runId}\nrun_attempt=${bound.attempt}\n`;
    summary = `Release evidence reused: CI run ${bound.runId} attempt ${bound.attempt} (head ${bound.head}, tree ${bound.tree}).`;
  } catch (error) {
    const reason =
      error instanceof Unbound
        ? error.message
        : "the evidence check failed unexpectedly";
    outputs = "bound=false\n";
    summary = `Release evidence not bound: ${reason}. The complete release gate runs on both supported lanes.`;
  }
  await appendFile(config.outputFile, outputs, "utf8");
  await appendFile(config.summaryFile, `${summary}\n`, "utf8");
  process.stdout.write(`${summary}\n`);
}

const commands = { record, verify };
const command = commands[process.argv[2]];
try {
  if (command === undefined || process.argv.length !== 3) {
    throw new RecordError("usage: release-evidence.mjs <record|verify>");
  }
  await command();
} catch (error) {
  const detail =
    error instanceof RecordError || error instanceof Unbound
      ? error.message
      : "unexpected failure";
  process.stderr.write(`RELEASE_EVIDENCE_FAILED: ${detail}\n`);
  process.exitCode = 1;
}
