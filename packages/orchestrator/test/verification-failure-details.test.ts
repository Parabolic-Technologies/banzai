import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { runInteractive, type InteractiveIO } from "../src/interactive.js";
import type { RunState } from "../src/types.js";
import type { TaskVerificationAttempt } from "../src/verification-evidence.js";
import {
  attemptOutcomeText,
  incompleteVerificationSummary
} from "../src/verification-outcome.js";
import {
  OUTPUT_TAIL_LINES,
  readVerificationOutputTails
} from "../src/verification-output.js";
import { taskVerificationStatusLines } from "../src/verification-ui.js";
import {
  PHPCS_CHECK_IDS,
  PHPCS_FAILURE_EXIT_CODE,
  PHPCS_FAILURE_STDERR_LINES,
  phpcsVerificationFixture
} from "./phpcs-verification-fixture.js";

const exec = promisify(execFile);
const RETRY_ANYWAY =
  "Retry anyway (same command, same files; expected to fail again)";
const RETRY_FAILED = "Retry the failed read-only attempt";

/** Records every line and the blocked-run choices, then exits or declines a retry. */
function recordingIO(chooseRetry = false) {
  const lines: string[] = [];
  const menus: string[][] = [];
  const confirmations: string[] = [];
  let retried = false;
  const io: InteractiveIO = {
    multiSelect: async () => {
      throw new Error("Unexpected multi-select");
    },
    input: async () => {
      throw new Error("Unexpected input");
    },
    confirm: async (message: string) => {
      confirmations.push(message);
      return false;
    },
    select: async <T>(
      message: string,
      choices: readonly { name: string; value: T }[]
    ) => {
      if (message === "Blocked run action") {
        menus.push(choices.map((choice) => choice.name));
        const retry = choices.find((choice) => choice.value === "retry");
        if (chooseRetry && !retried && retry) {
          retried = true;
          return retry.value;
        }
      }
      const exit = choices.find((choice) => choice.value === "exit");
      assert.ok(exit, message);
      return exit.value;
    },
    writeLine: (line = "") => {
      lines.push(line);
    }
  };
  return { io, lines, menus, confirmations };
}

function failedAttempt(state: RunState): TaskVerificationAttempt {
  const attempt = state.taskVerification?.attempts.find(
    (item) => item.checkId === PHPCS_CHECK_IDS.lint
  );
  assert.ok(attempt, state.blockReason ?? "no lint attempt");
  return attempt;
}

test("a failing required check shows its command, outcome, output tail and logs", async () => {
  const f = await phpcsVerificationFixture();
  try {
    const { state } = f;
    assert.equal(state.status, "blocked", state.blockReason ?? undefined);
    assert.equal(state.blockedFrom, "verifying");
    assert.equal(
      state.blockReason,
      `Task verification is incomplete: ${PHPCS_CHECK_IDS.lint} (required) exited with code ${PHPCS_FAILURE_EXIT_CODE}; ${PHPCS_CHECK_IDS.schema} (required) not run; ${PHPCS_CHECK_IDS.touched} (supplemental) not run. The verification details show each command, its output and log paths. Retry re-runs the failed check without replaying implementation.`
    );
    const attempt = failedAttempt(state);
    assert.ok(attempt.stderr && attempt.stdout);
    const lines = taskVerificationStatusLines(
      state,
      await readVerificationOutputTails(f.repository.root, state)
    );
    const at = lines.indexOf(`  ${PHPCS_CHECK_IDS.lint} (required): failed`);
    assert.notEqual(at, -1, lines.join("\n"));
    assert.equal(lines[0], "Verification: failed");
    assert.deepEqual(lines.slice(at + 1, at + 5), [
      `    Command: ${process.execPath} tools/php-cs-fixer.cjs fix --dry-run --diff`,
      "    Directory: .",
      `    Result: exited with code ${PHPCS_FAILURE_EXIT_CODE}`,
      lines[at + 4]
    ]);
    assert.match(
      lines[at + 4] ?? "",
      /^ {4}Details: failure category: command_exit · duration \d+(?:\.\d)?(?:ms|s) · timeout 10s$/u
    );
    assert.equal(lines[at + 5], `    stderr, last ${OUTPUT_TAIL_LINES} lines:`);
    const output = lines.slice(at + 6, at + 6 + OUTPUT_TAIL_LINES);
    assert.ok(output.every((line) => line.startsWith("      | ")));
    assert.equal(
      output.at(-1),
      `      | Found ${PHPCS_FAILURE_STDERR_LINES - 2} of 35 files that can be fixed.`
    );
    assert.equal(
      output.at(-2),
      "      | Loaded config default; cache token [REDACTED]"
    );
    assert.ok(
      output.includes("      |    24) src/Module24.php (ordered_imports)"),
      output.join("\n")
    );
    assert.ok(!lines.join("\n").includes("\u001b"));
    assert.ok(!lines.join("\n").includes("\\u001b"));
    assert.deepEqual(
      lines.slice(at + 6 + OUTPUT_TAIL_LINES, at + 8 + OUTPUT_TAIL_LINES),
      [
        `    stderr log: ${attempt.stderr.relativePath}`,
        `    stdout log: ${attempt.stdout.relativePath}`
      ]
    );
    assert.ok(attempt.stderr.relativePath.startsWith(".banzai/"));
    assert.ok(
      (
        await readFile(
          path.join(f.repository.root, attempt.stderr.relativePath),
          "utf8"
        )
      ).includes("Found 24 of 35")
    );
    assert.ok(
      lines.includes(`  ${PHPCS_CHECK_IDS.schema} (required): not run`)
    );
    assert.ok(
      lines.includes(`  ${PHPCS_CHECK_IDS.touched} (supplemental): not run`)
    );

    const status = await exec(
      process.execPath,
      [path.resolve("dist/banzai.mjs"), "status"],
      { cwd: f.repository.root }
    );
    for (const line of lines)
      assert.ok(status.stdout.includes(line), `${line}\n${status.stdout}`);
    // printLabeled wraps prose to the terminal width.
    assert.ok(
      status.stdout
        .replace(/\s+/gu, " ")
        .includes(`Blocked ${state.blockReason}`) ||
        status.stdout
          .replace(/\s+/gu, " ")
          .includes(`Blocked: ${state.blockReason}`),
      status.stdout
    );

    const json = JSON.parse(
      (
        await exec(
          process.execPath,
          [path.resolve("dist/banzai.mjs"), "status", "--json"],
          { cwd: f.repository.root }
        )
      ).stdout
    ) as Record<string, unknown>;
    // The human projection reads logs; the JSON shape is unchanged.
    assert.deepEqual(Object.keys(json), Object.keys(await f.runner.status()));
    assert.ok(!JSON.stringify(json).includes("ordered_imports"));

    const recorded = recordingIO();
    await runInteractive(f.runner, recorded.io, { decidedBy: "human" });
    for (const line of lines)
      assert.ok(
        recorded.lines.includes(line),
        `${line}\n${recorded.lines.join("\n")}`
      );
  } finally {
    await f.repository.dispose();
  }
});

test("retry warns only while the failed command and observed files are unchanged", async () => {
  const f = await phpcsVerificationFixture();
  try {
    const attempt = failedAttempt(f.state);
    assert.deepEqual(await f.runner.verificationRetryOutlook(), {
      attemptId: attempt.id,
      checkId: PHPCS_CHECK_IDS.lint,
      sameCommand: true,
      sameInputs: true
    });
    let recorded = recordingIO(true);
    await runInteractive(f.runner, recorded.io, { decidedBy: "human" });
    assert.ok(
      recorded.menus[0]?.includes(RETRY_ANYWAY),
      recorded.menus.join("\n")
    );
    assert.ok(!recorded.menus[0]?.includes(RETRY_FAILED));
    assert.ok(
      recorded.confirmations.includes(
        `Check ${PHPCS_CHECK_IDS.lint} failed with an ordinary exit, and its command and the observed project files are unchanged, so it is expected to fail the same way. Retry anyway?`
      ),
      recorded.confirmations.join("\n")
    );
    // Declining keeps the run and its single failed attempt.
    assert.equal(
      (await f.runner.status()).state.taskVerification?.attempts.length,
      1
    );

    await writeFile(
      path.join(f.repository.root, ".php-cs-fixer.php"),
      "<?php\nreturn (new PhpCsFixer\\Config())->setRules([]);\n"
    );
    assert.equal(
      (await f.runner.verificationRetryOutlook())?.sameInputs,
      false
    );
    recorded = recordingIO();
    await runInteractive(f.runner, recorded.io, { decidedBy: "human" });
    assert.ok(
      recorded.menus[0]?.includes(RETRY_FAILED),
      recorded.menus.join("\n")
    );
  } finally {
    await f.repository.dispose();
  }
});

test("a changed check descriptor is not predicted to fail again", async () => {
  const f = await phpcsVerificationFixture();
  try {
    const plan = f.state.artifactBinding?.binding.artifacts.plan;
    assert.ok(plan);
    const file = path.join(f.repository.root, plan);
    // The inventory block lies outside the remainder digest, so only the
    // descriptor changes; the approval digest itself is not consulted here.
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace(
        '"--diff"]',
        '"--diff","--config=.php-cs-fixer.php"]'
      )
    );
    const outlook = await f.runner.verificationRetryOutlook();
    assert.equal(outlook?.sameCommand, false, JSON.stringify(outlook));
  } finally {
    await f.repository.dispose();
  }
});

test("every status, category and signal combination has its own label", () => {
  const label = (
    status: TaskVerificationAttempt["status"],
    failureCategory: TaskVerificationAttempt["failureCategory"],
    signal: string | null,
    exitCode: number | null
  ) =>
    attemptOutcomeText({ status, failureCategory, signal, exitCode }, 300_000);
  assert.equal(label("failed", "command_exit", null, 2), "exited with code 2");
  assert.equal(
    label("interrupted", "timeout", "SIGTERM", 1),
    "timed out after 5m (SIGTERM)"
  );
  assert.equal(
    label("interrupted", "command_exit", "SIGKILL", 1),
    "terminated by SIGKILL, for example Ctrl-C, a manual kill or an out-of-memory kill; the recorded exit code 1 is synthetic"
  );
  assert.equal(
    label("failed", "process_start", null, null),
    "the executable could not be started"
  );
  assert.equal(
    label("interrupted", "output_limit", "SIGTERM", 1),
    "stopped after exceeding the output limit (SIGTERM)"
  );
  assert.equal(
    label("interrupted", "runner_failure", null, null),
    "interrupted by the runner before the check finished"
  );
  assert.equal(
    label("failed", "runner_failure", null, 1),
    "the runner could not observe the check result"
  );
  assert.equal(
    label("started", null, null, null),
    "no result was recorded before the runner stopped"
  );
});

test("a start failure shows no placeholder output and the summary is bounded", async () => {
  const f = await phpcsVerificationFixture();
  try {
    const publication = f.state.taskVerification;
    assert.ok(publication);
    const attempt = failedAttempt(f.state);
    const startFailure: RunState = {
      ...f.state,
      taskVerification: {
        ...publication,
        attempts: publication.attempts.map((item) =>
          item.id === attempt.id
            ? {
                ...item,
                failureCategory: "process_start" as const,
                exitCode: null
              }
            : item
        )
      }
    };
    const tails = await readVerificationOutputTails(
      f.repository.root,
      startFailure
    );
    assert.equal(tails.size, 0);
    const lines = taskVerificationStatusLines(startFailure, tails);
    assert.ok(
      lines.includes("    Result: the executable could not be started")
    );
    assert.ok(!lines.some((line) => line.includes("| ")));
    assert.ok(!lines.some((line) => line.startsWith("    Output:")));

    const many: RunState["taskVerification"] = {
      ...publication,
      applicability: {
        ...publication.applicability,
        dispositions: Array.from({ length: 7 }, (_, index) => ({
          checkId: `check-${index + 1}`,
          required: true,
          kind: "not_run" as const,
          reason: "No physical attempt.",
          attemptId: null
        }))
      }
    };
    assert.equal(
      incompleteVerificationSummary(many),
      "check-1 (required) not run; check-2 (required) not run; check-3 (required) not run; check-4 (required) not run; check-5 (required) not run; and 2 more"
    );
  } finally {
    await f.repository.dispose();
  }
});

test("output tails fall back to stdout, escape controls and survive unreadable logs", async () => {
  const f = await phpcsVerificationFixture();
  try {
    const attempt = failedAttempt(f.state);
    assert.ok(attempt.stderr && attempt.stdout);
    const stderr = path.join(f.repository.root, attempt.stderr.relativePath);
    const stdout = path.join(f.repository.root, attempt.stdout.relativePath);
    const tail = async () =>
      (await readVerificationOutputTails(f.repository.root, f.state)).get(
        attempt.id
      );

    await writeFile(stderr, "\n\n");
    await writeFile(
      stdout,
      `progress 10%\rprogress 100%\nbell \u0007 and bidi ‮\n${"x".repeat(400)}\n`
    );
    const fallback = await tail();
    assert.equal(fallback?.stream, "stdout");
    assert.deepEqual(fallback.lines, [
      "progress 100%",
      "bell \\u0007 and bidi \\u202e",
      `${"x".repeat(300)}…`
    ]);
    assert.equal(fallback.truncated, false);
    const shown = taskVerificationStatusLines(
      f.state,
      new Map([[attempt.id, fallback]])
    );
    assert.ok(shown.includes("    stdout, 3 lines:"), shown.join("\n"));

    await writeFile(stdout, "");
    assert.deepEqual((await tail())?.lines, []);
    assert.ok(
      taskVerificationStatusLines(
        f.state,
        await readVerificationOutputTails(f.repository.root, f.state)
      ).includes("    Output: none.")
    );

    await rm(stderr);
    await writeFile(path.join(f.repository.root, "elsewhere.log"), "secret\n");
    await symlink(path.join(f.repository.root, "elsewhere.log"), stderr);
    assert.equal(await tail(), null);
    await rm(stderr);
    assert.equal(await tail(), null);
    const missing = taskVerificationStatusLines(
      f.state,
      await readVerificationOutputTails(f.repository.root, f.state)
    );
    assert.ok(missing.includes("    Output: the log could not be read."));
    assert.ok(
      missing.includes(`    stderr log: ${attempt.stderr.relativePath}`)
    );

    await mkdir(path.dirname(stderr), { recursive: true });
    await writeFile(
      stderr,
      Array.from({ length: 5000 }, (_, index) => `line ${index}`).join("\n")
    );
    const long = await tail();
    assert.equal(long?.lines.length, OUTPUT_TAIL_LINES);
    assert.equal(long.lines.at(-1), "line 4999");
    assert.equal(long.truncated, true);
  } finally {
    await f.repository.dispose();
  }
});
