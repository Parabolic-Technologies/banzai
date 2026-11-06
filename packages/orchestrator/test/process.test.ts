import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { BanzaiError, ProcessExitError } from "../src/errors.js";
import {
  resetProcessShutdownForTest,
  runProcess,
  shutdownActiveProcesses
} from "../src/process.js";

test("process runner uses argv without shell interpolation", async () => {
  const result = await runProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write(process.argv[1])", "$(touch nope)"],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 5_000
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "$(touch nope)");
});

test("process runner observes complete stdout lines without changing captured output", async () => {
  const lines: string[] = [];
  const result = await runProcess({
    command: process.execPath,
    args: [
      "-e",
      [
        'process.stdout.write("first\\npar");',
        'setTimeout(() => process.stdout.end("tial\\nlast"), 10);'
      ].join("")
    ],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 5_000,
    onStdoutLine: (line) => lines.push(line)
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "first\npartial\nlast");
  assert.deepEqual(lines, ["first", "partial", "last"]);
});

test("stdout observers cannot fail the child process", async () => {
  const result = await runProcess({
    command: process.execPath,
    args: ["-e", 'process.stdout.write("progress\\n")'],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 20_000,
    onStdoutLine: () => {
      throw new Error("presentation failed");
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "progress\n");
});

test("process runner enforces timeout", async () => {
  await assert.rejects(
    runProcess({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 10000)"],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 25
    }),
    /exceeded its 25ms timeout/
  );
});

/**
 * ADR-0063 §3: a stub that reports what reached its stdin. libuv pipes are
 * socket pairs, so "piped" means a FIFO or a socket rather than /dev/null.
 */
const STDIN_REPORTER = [
  'const fs = require("node:fs");',
  "const stat = fs.fstatSync(0);",
  "const piped = stat.isFIFO() || stat.isSocket();",
  "const chunks = [];",
  'process.stdin.on("data", (chunk) => chunks.push(chunk));',
  'process.stdin.on("end", () => {',
  "  const bytes = Buffer.concat(chunks);",
  '  const sha256 = require("node:crypto").createHash("sha256").update(bytes).digest("hex");',
  "  process.stdout.write(JSON.stringify({ piped, bytes: bytes.length, sha256 }));",
  "});"
].join("\n");

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

test("stdin text larger than one argv element reaches the child whole", async () => {
  const text = "p".repeat(200_000);
  assert.ok(Buffer.byteLength(text) > 131_072);
  const result = await runProcess({
    command: process.execPath,
    args: ["-e", STDIN_REPORTER],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 20_000,
    stdin: text
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    piped: true,
    bytes: 200_000,
    sha256: sha256(text)
  });
});

test("a child that exits without reading stdin keeps its own outcome", async () => {
  const result = await runProcess({
    command: process.execPath,
    args: [
      "-e",
      [
        'const stat = require("node:fs").fstatSync(0);',
        "process.stdout.write(JSON.stringify({ piped: stat.isFIFO() || stat.isSocket() }));",
        "process.exit(3);"
      ].join("\n")
    ],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 20_000,
    // Far beyond a socket buffer, so the write is still pending at exit.
    stdin: "x".repeat(4 * 1024 * 1024)
  });
  assert.equal(result.exitCode, 3);
  assert.deepEqual(JSON.parse(result.stdout), { piped: true });
});

test("a spawn without stdin text keeps stdin ignored", async () => {
  const result = await runProcess({
    command: process.execPath,
    args: ["-e", STDIN_REPORTER],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 20_000
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    piped: false,
    bytes: 0,
    sha256: sha256("")
  });
});

test("a missing executable with stdin text still fails to start", async () => {
  await assert.rejects(
    runProcess({
      command: "/nonexistent/banzai-missing-executable",
      args: [],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5_000,
      stdin: "prompt"
    }),
    (error: unknown) =>
      error instanceof BanzaiError && error.code === "PROCESS_START_FAILED"
  );
});

test("a child that never reads stdin still times out normally", async () => {
  await assert.rejects(
    runProcess({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 10000)"],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 200,
      stdin: "x".repeat(4 * 1024 * 1024)
    }),
    /exceeded its 200ms timeout/
  );
});

test("durable stdout observers are ordered and drain before process completion", async () => {
  const observed: string[] = [];
  const result = await runProcess({
    command: process.execPath,
    args: ["-e", 'process.stdout.write("one\\ntwo\\n")'],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 5_000,
    onStdoutLineDurable: async (line) => {
      await new Promise((resolve) =>
        setTimeout(resolve, line === "one" ? 20 : 1)
      );
      observed.push(line);
    }
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(observed, ["one", "two"]);
});

test("durable stdout observer failure fails and terminates the process boundary", async () => {
  await assert.rejects(
    runProcess({
      command: process.execPath,
      args: [
        "-e",
        'process.stdout.write("terminal\\n"); setTimeout(() => {}, 10000)'
      ],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5_000,
      onStdoutLineDurable: async () => {
        throw new BanzaiError("TERMINAL_RESULT_CONFLICT", "checkpoint failed");
      }
    }),
    (error: unknown) => {
      assert.ok(error instanceof ProcessExitError);
      assert.equal(error.code, "TERMINAL_RESULT_CONFLICT");
      assert.match(error.stdout, /terminal/);
      return true;
    }
  );
});

test("coordinated shutdown terminates and drains the active process group", async () => {
  let pid = 0;
  const running = runProcess({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 10000)"],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 20_000,
    onStart: (childPid) => {
      pid = childPid;
    }
  });
  while (pid === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  try {
    assert.equal(await shutdownActiveProcesses(2_000), true);
    const result = await running;
    assert.equal(result.signal, "SIGTERM");
    assert.throws(() => process.kill(pid, 0));
    await assert.rejects(
      runProcess({
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        cwd: process.cwd(),
        env: process.env,
        timeoutMs: 1_000
      }),
      /coordinated shutdown begins/
    );
  } finally {
    resetProcessShutdownForTest();
  }
});
