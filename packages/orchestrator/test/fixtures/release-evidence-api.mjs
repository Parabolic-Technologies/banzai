import { appendFileSync, readFileSync } from "node:fs";

// Loaded only by the test child's --import; production keeps native fetch.
const { repository, baseUrl, scenario, requestsFile } = JSON.parse(
  readFileSync(process.env.BANZAI_TEST_API_FIXTURE, "utf8")
);
const base = `/repos/${repository}/actions`;

function routeFor(url, runId) {
  if (url.pathname === `${base}/workflows/ci.yml/runs`) {
    return ["runs", "workflow_runs", scenario.runs];
  }
  if (!url.pathname.startsWith(`${base}/runs/`)) return null;
  if (url.pathname.endsWith("/jobs")) {
    return ["jobs", "jobs", scenario.runJobs?.[runId] ?? scenario.jobs];
  }
  if (url.pathname.endsWith("/artifacts")) {
    return [
      "artifacts",
      "artifacts",
      scenario.runArtifacts?.[runId] ?? scenario.artifacts
    ];
  }
  return null;
}

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  appendFileSync(
    requestsFile,
    `${JSON.stringify({
      pathname: url.pathname,
      query: url.search,
      authorization: request.headers.get("authorization"),
      accept: request.headers.get("accept"),
      apiVersion: request.headers.get("x-github-api-version"),
      method: request.method,
      redirect: request.redirect
    })}\n`
  );
  // Never fall through to real networking, including for an unexpected URL.
  if (url.origin !== baseUrl) throw new TypeError("fetch failed");
  request.signal.throwIfAborted();
  const runId = Number(/\/runs\/(\d+)\//.exec(url.pathname)?.[1]);
  const route = routeFor(url, runId);
  if (route === null) return new Response("{}", { status: 404 });
  const [endpoint, field, items] = route;
  const fault =
    scenario.runFaults?.[runId]?.[endpoint] ??
    scenario.faults?.[endpoint] ??
    {};
  if (fault.drop === true) throw new TypeError("fetch failed");
  return new Response(
    fault.body ??
      JSON.stringify({
        total_count: "total" in fault ? fault.total : items.length,
        [field]: items
      }),
    {
      status: fault.status ?? 200,
      headers: { "content-type": "application/json" }
    }
  );
};
