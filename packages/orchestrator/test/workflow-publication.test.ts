import { spawnSync } from "node:child_process";
import { projectAgentControlStatus } from "../src/agent-control.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { TerminalRunStateError } from "../src/errors.js";
import {
  parsePublishedCompletionRegion,
  renderCompletionRegion
} from "../src/plan-task-completion.js";
import {
  CONTRACT_VERSION,
  PLAN_TASK_COMPLETION_SCHEMA_VERSION,
  type OrchestratorConfig
} from "../src/types.js";
import { WorkflowRunner } from "../src/workflow.js";
import { createTestRepository } from "./helpers.js";
import {
  FakeAdapters,
  boundFixturePath,
  completionLedger,
  finding,
  passingReview,
  phaseResult
} from "./workflow-fixtures.js";

// ---------------------------------------------------------------------------
// ADR-0047 runner-owned completion publication: durable proof, crash seams,
// refusal routes, tamper guards, stop diagnostics and archive closure.
// ---------------------------------------------------------------------------

const NARRATIVE_REPORT =
  "# Implementation Report\n\n## Narrative\n\nThe fixture was implemented.\n";

const artifactsCommandPath = path.resolve(
  "../../plugins/banzai/scripts/artifacts.cjs"
);

async function completionEventCount(
  runner: WorkflowRunner,
  runId: string,
  type: string
): Promise<number> {
  const events = await readFile(
    path.join(runner.store.runDirectory(runId), "events.jsonl"),
    "utf8"
  );
  return events
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type: string })
    .filter((event) => event.type === type).length;
}

test("a narrative-only implementation is published once by the runner with attempt-owned durable proof", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationReportTransforms.push(() => NARRATIVE_REPORT);
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const done = await runner.approvePlan("human");
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(done.schemaVersion, 8);
    assert.equal(done.metrics.attempts.implementation, 1);
    assert.ok(
      adapters.phasePrompts.every((prompt) => !/repair retry/i.test(prompt))
    );
    const completion = done.planTaskCompletion;
    assert.ok(completion?.status === "valid");
    assert.equal(completion.schemaVersion, 2);
    assert.equal(
      completion.completionProtocol,
      "banzai-completion-protocol/v1"
    );
    const attempt = {
      id: completion.sourceAttemptId,
      kind: "implementation" as const,
      mutable: true
    };
    const ledger = phaseResult("implementation").taskCompletion;
    assert.ok(ledger);
    const reportPath = await boundFixturePath(
      repository.root,
      "documentation/features/example/implementation-report.md"
    );
    const report = await readFile(reportPath);
    const text = report.toString("utf8");
    assert.ok(text.startsWith(NARRATIVE_REPORT));
    assert.equal(
      text.split("<!-- banzai-plan-task-completion/v2:start -->").length,
      2
    );
    assert.ok(text.includes(renderCompletionRegion(ledger)));
    assert.deepEqual(parsePublishedCompletionRegion(report), ledger);

    const candidate = await runner.store.readCompletionCandidateIfExists(
      done.runId,
      attempt
    );
    assert.ok(candidate);
    assert.ok(candidate.bytes.equals(report));
    const receipt = await runner.store.readCompletionPublicationIfExists(
      done.runId,
      attempt
    );
    assert.ok(receipt);
    assert.equal(receipt.candidateDigest, candidate.candidate.integrityDigest);
    assert.deepEqual(receipt.ledgerAuthor, {
      attemptId: attempt.id,
      attemptKind: "implementation",
      ledgerDigest: completion.ledgerDigest
    });
    assert.deepEqual(receipt.publisher, {
      attemptId: attempt.id,
      attemptKind: "implementation"
    });
    assert.equal(completion.publisherAttemptId, attempt.id);
    assert.equal(completion.publication?.sha256, receipt.integrityDigest);
    const capture = await runner.store.readCompletionCaptureIfExists(
      done.runId,
      attempt
    );
    assert.ok(capture);
    assert.equal(capture.outcome, "completed");
    assert.equal(capture.integrityDigest, receipt.captureDigest);
    assert.equal(
      capture.originals.implementationReport?.sha256,
      createHash("sha256").update(NARRATIVE_REPORT).digest("hex")
    );
    assert.equal(
      await readFile(
        runner.store.completionEvidencePath(
          done.runId,
          attempt,
          "implementation-input.md"
        ),
        "utf8"
      ),
      NARRATIVE_REPORT
    );
    const transition = await runner.store.readCompletionTransitionIfExists(
      done.runId,
      attempt
    );
    assert.equal(transition, null);
    assert.equal(done.completionPublication?.stage, "event");
    assert.equal(done.completionPublication.refusal, null);
    assert.equal(
      await completionEventCount(
        runner,
        done.runId,
        "completion.publication_applied"
      ),
      1
    );
    assert.equal(
      await completionEventCount(
        runner,
        done.runId,
        "completion.publication_refused"
      ),
      0
    );
    const record = await runner.store.readRunAttempt(done.runId, attempt);
    assert.equal(record.status, "completed");
    assert.equal(record.schemaVersion, 4);
    assert.equal(record.completionProtocol, "banzai-completion-protocol/v1");
    assert.equal(record.retryOf, null);
    assert.equal(record.envelope?.originalDigest, capture.resultDigest);

    // The independent review froze the publication identities (snapshot v5,
    // rendered v6) instead of re-reading mutable report text.
    const review = (await runner.store.readRunAttempts(done.runId)).find(
      (item) => item.attempt.kind === "review"
    );
    assert.ok(review);
    const frozen = await runner.store.readReviewSnapshot(
      done.runId,
      review.attempt
    );
    assert.equal(frozen.schemaVersion, 6);
    assert.equal(
      frozen.completionPublication?.receiptDigest,
      receipt.integrityDigest
    );
    const artifact = await readFile(
      await boundFixturePath(
        repository.root,
        "documentation/features/example/review-1.md"
      ),
      "utf8"
    );
    assert.match(artifact, /banzai-feature-review\/v7/);
    assert.match(artifact, /Runner-owned completion publication/);
    assert.ok(artifact.includes(receipt.integrityDigest));
  } finally {
    await repository.dispose();
  }
});

for (const boundary of ["capture-manifest", "between-originals"] as const)
  test(`a restart ${boundary} keeps the terminal input authoritative and reconciles only after exact restoration`, async () => {
    const repository = await createTestRepository();
    try {
      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      const runner = new WorkflowRunner(repository.root, adapters);
      let interrupted = false;
      if (boundary === "capture-manifest") {
        const writeCapture = runner.store.writeCompletionCapture.bind(
          runner.store
        );
        runner.store.writeCompletionCapture = async (runId, capture) => {
          if (!interrupted) {
            interrupted = true;
            throw new TerminalRunStateError(
              await runner.store.readState(runId)
            );
          }
          await writeCapture(runId, capture);
        };
      } else {
        const writeOriginal = runner.store.writeCompletionOriginal.bind(
          runner.store
        );
        runner.store.writeCompletionOriginal = async (
          runId,
          attempt,
          role,
          bytes
        ) => {
          const result = await writeOriginal(runId, attempt, role, bytes);
          if (!interrupted && role === "implementationReport") {
            interrupted = true;
            throw new TerminalRunStateError(
              await runner.store.readState(runId)
            );
          }
          return result;
        };
      }

      await runner.start({ slug: "example", request: "Implement it." });
      await runner.approvePlan("human");
      assert.equal(interrupted, true);
      const interruptedState = await runner.store.requireActiveState();
      assert.ok(interruptedState);
      const attempt = interruptedState.activeAttempt;
      assert.ok(attempt?.kind === "implementation");
      assert.ok(
        await runner.store.readTerminalCheckpointIfExists(
          interruptedState.runId,
          attempt
        )
      );
      assert.equal(
        await runner.store.readCompletionCaptureIfExists(
          interruptedState.runId,
          attempt
        ),
        null
      );

      const target =
        boundary === "capture-manifest"
          ? await boundFixturePath(
              repository.root,
              "documentation/features/example/implementation-report.md"
            )
          : path.join(repository.root, "src/example.txt");
      const original = await readFile(target);
      await writeFile(
        target,
        Buffer.concat([original, Buffer.from("drift\n")])
      );

      const resumedRunner = new WorkflowRunner(repository.root, adapters);
      const promptsBefore = adapters.phasePrompts.length;
      const drifted = await resumedRunner.resume();
      assert.equal(drifted.status, "blocked");
      assert.match(
        drifted.blockReason ?? "",
        /^\[COMPLETION_PUBLICATION_DRIFT\]/
      );
      assert.equal(adapters.phasePrompts.length, promptsBefore);
      assert.equal(
        await resumedRunner.store.readCompletionCaptureIfExists(
          drifted.runId,
          attempt
        ),
        null,
        "changed current bytes never become a replacement capture baseline"
      );
      const blockedStatus = await resumedRunner.status();
      assert.equal(blockedStatus.completionPublication?.action, "cancel");
      assert.equal(blockedStatus.nextAction, "banzai cancel");

      await writeFile(target, original);
      const restoredStatus = await resumedRunner.status();
      assert.equal(restoredStatus.completionPublication?.action, "resume");
      assert.equal(restoredStatus.nextAction, "banzai resume");
      const done = await resumedRunner.resume();
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.equal(adapters.phasePrompts.length, promptsBefore);
      assert.equal(
        done.metrics.completedAttemptIds.filter((id) => id === attempt.id)
          .length,
        1
      );
      assert.equal(
        await completionEventCount(
          resumedRunner,
          done.runId,
          "completion.publication_applied"
        ),
        1
      );
    } finally {
      await repository.dispose();
    }
  });

for (const setting of ["executable", "model", "effort"] as const)
  test(`checkpoint-only pending publication blocks ${setting} drift until the exact implementer configuration is restored`, async () => {
    const repository = await createTestRepository();
    try {
      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      const runner = new WorkflowRunner(repository.root, adapters);
      const writeCapture = runner.store.writeCompletionCapture.bind(
        runner.store
      );
      let interrupted = false;
      runner.store.writeCompletionCapture = async (runId, capture) => {
        if (!interrupted) {
          interrupted = true;
          throw new TerminalRunStateError(await runner.store.readState(runId));
        }
        await writeCapture(runId, capture);
      };

      await runner.start({ slug: "example", request: "Implement it." });
      await runner.approvePlan("human");
      assert.equal(interrupted, true);
      const interruptedState = await runner.store.requireActiveState();
      const attempt = interruptedState.activeAttempt;
      assert.ok(attempt?.kind === "implementation");
      assert.equal(
        (await runner.store.readRunAttempt(interruptedState.runId, attempt))
          .status,
        "pending_application"
      );
      assert.equal(
        await runner.store.readCompletionCaptureIfExists(
          interruptedState.runId,
          attempt
        ),
        null
      );

      const configPath = path.join(repository.root, ".banzai/config.json");
      const originalConfig = await readFile(configPath);
      const hideConfigFromWorkspace = spawnSync(
        "git",
        ["update-index", "--assume-unchanged", ".banzai/config.json"],
        { cwd: repository.root }
      );
      assert.equal(
        hideConfigFromWorkspace.status,
        0,
        hideConfigFromWorkspace.stderr.toString()
      );
      const config = JSON.parse(
        originalConfig.toString("utf8")
      ) as OrchestratorConfig;
      if (setting === "executable")
        config.models.implementer.executable += "-changed";
      else if (setting === "model")
        config.models.implementer.model = `${config.models.implementer.model}-changed`;
      else
        config.models.implementer.effort =
          config.models.implementer.effort === "high" ? "medium" : "high";
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

      const resumedRunner = new WorkflowRunner(repository.root, adapters);
      const promptsBefore = adapters.phasePrompts.length;
      const drifted = await resumedRunner.resume();
      assert.equal(drifted.status, "blocked");
      assert.match(
        drifted.blockReason ?? "",
        /^\[COMPLETION_PUBLICATION_DRIFT\]/
      );
      assert.equal(adapters.phasePrompts.length, promptsBefore);
      assert.equal(
        await resumedRunner.store.readCompletionCaptureIfExists(
          drifted.runId,
          attempt
        ),
        null,
        "changed configuration never becomes a replacement capture authority"
      );
      assert.equal(
        (await resumedRunner.status()).completionPublication?.action,
        "cancel"
      );

      await writeFile(configPath, originalConfig);
      assert.equal(
        (await resumedRunner.status()).completionPublication?.action,
        "resume"
      );
      const done = await resumedRunner.resume();
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.equal(adapters.phasePrompts.length, promptsBefore);
      assert.equal(
        done.metrics.completedAttemptIds.filter((id) => id === attempt.id)
          .length,
        1
      );
    } finally {
      await repository.dispose();
    }
  });

for (const setting of ["executable", "model", "effort"] as const)
  test(`pending publication blocks ${setting} drift until the exact implementer configuration is restored`, async () => {
    const repository = await createTestRepository();
    try {
      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      const runner = new WorkflowRunner(repository.root, adapters);
      const writeCandidate = runner.store.writeCompletionCandidate.bind(
        runner.store
      );
      let injected = false;
      runner.store.writeCompletionCandidate = async (
        runId,
        candidate,
        bytes
      ) => {
        if (!injected) {
          injected = true;
          throw new Error("EIO: injected candidate write failure");
        }
        await writeCandidate(runId, candidate, bytes);
      };
      await runner.start({ slug: "example", request: "Implement it." });
      const blocked = await runner.approvePlan("human");
      assert.equal(blocked.status, "blocked");
      assert.equal(
        blocked.completionPublication?.refusal?.code,
        "COMPLETION_PUBLICATION_IO"
      );
      const attempt = blocked.activeAttempt;
      assert.ok(attempt?.kind === "implementation");
      const configPath = path.join(repository.root, ".banzai/config.json");
      const originalConfig = await readFile(configPath);
      const config = JSON.parse(
        originalConfig.toString("utf8")
      ) as OrchestratorConfig;
      if (setting === "executable")
        config.models.implementer.executable += "-changed";
      else if (setting === "model")
        config.models.implementer.model = `${config.models.implementer.model}-changed`;
      else
        config.models.implementer.effort =
          config.models.implementer.effort === "high" ? "medium" : "high";
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

      const promptsBefore = adapters.phasePrompts.length;
      const driftStatus = await runner.status();
      assert.equal(driftStatus.completionPublication?.action, "cancel");
      assert.equal(driftStatus.nextAction, "banzai cancel");
      assert.equal(
        projectAgentControlStatus(driftStatus).activeRun?.nextAction,
        "cancel"
      );
      const drifted = await runner.resume();
      assert.equal(drifted.status, "blocked");
      assert.match(
        drifted.blockReason ?? "",
        /^\[COMPLETION_PUBLICATION_DRIFT\]/
      );
      assert.equal(adapters.phasePrompts.length, promptsBefore);
      assert.equal(drifted.planTaskCompletion, null);
      assert.equal(
        (await runner.store.readRunAttempt(drifted.runId, attempt)).status,
        "pending_application"
      );

      await writeFile(configPath, originalConfig);
      assert.equal(
        (await runner.status()).completionPublication?.action,
        "resume"
      );
      const done = await runner.resume();
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.equal(adapters.phasePrompts.length, promptsBefore);
      assert.equal(
        done.metrics.completedAttemptIds.filter((id) => id === attempt.id)
          .length,
        1
      );
      assert.equal(
        await completionEventCount(
          runner,
          done.runId,
          "completion.publication_applied"
        ),
        1
      );
    } finally {
      await repository.dispose();
    }
  });

for (const boundary of ["capture", "candidate", "event"] as const)
  for (const timing of ["before", "after"] as const)
    test(`an ordinary ${timing}-write ${boundary} cursor failure remains publication I/O and resumes without a model failure`, async () => {
      const repository = await createTestRepository();
      try {
        const adapters = new FakeAdapters();
        adapters.reviewResults.push(passingReview());
        const runner = new WorkflowRunner(repository.root, adapters);
        const writeState = runner.store.writeState.bind(runner.store);
        let injected = false;
        runner.store.writeState = async (state) => {
          if (
            !injected &&
            state.completionPublication?.stage === boundary &&
            state.completionPublication.refusal === null
          ) {
            injected = true;
            if (timing === "after") await writeState(state);
            throw new Error(
              `EIO: injected ${timing} ${boundary} cursor failure`
            );
          }
          await writeState(state);
        };

        await runner.start({ slug: "example", request: "Implement it." });
        const blocked = await runner.approvePlan("human");
        assert.equal(injected, true);
        assert.equal(blocked.status, "blocked");
        const refusal = blocked.completionPublication?.refusal;
        assert.ok(refusal);
        assert.equal(refusal.code, "COMPLETION_PUBLICATION_IO");
        assert.equal(refusal.stage, boundary);
        const attempt = blocked.activeAttempt;
        assert.ok(attempt?.kind === "implementation");
        assert.equal(
          (await runner.store.readRunAttempt(blocked.runId, attempt)).status,
          "pending_application"
        );
        assert.equal(
          await completionEventCount(runner, blocked.runId, "attempt.failed"),
          0
        );

        const promptsBefore = adapters.phasePrompts.length;
        const resumedRunner = new WorkflowRunner(repository.root, adapters);
        const done = await resumedRunner.resume();
        assert.equal(done.status, "done", done.blockReason ?? "");
        assert.equal(adapters.phasePrompts.length, promptsBefore);
        assert.equal(
          done.metrics.completedAttemptIds.filter((id) => id === attempt.id)
            .length,
          1
        );
        assert.equal(
          await completionEventCount(
            resumedRunner,
            done.runId,
            "attempt.failed"
          ),
          0
        );
        assert.equal(
          await completionEventCount(
            resumedRunner,
            done.runId,
            "completion.publication_applied"
          ),
          1
        );
      } finally {
        await repository.dispose();
      }
    });

for (const boundary of ["capture", "candidate", "event"] as const)
  for (const timing of ["before", "after"] as const)
    test(`consecutive ordinary ${timing}-write ${boundary} cursor and refusal failures never become a model failure`, async () => {
      const repository = await createTestRepository();
      try {
        const adapters = new FakeAdapters();
        adapters.reviewResults.push(passingReview());
        const runner = new WorkflowRunner(repository.root, adapters);
        const writeState = runner.store.writeState.bind(runner.store);
        let cursorInjected = false;
        let refusalInjected = false;
        runner.store.writeState = async (state) => {
          const publication = state.completionPublication;
          if (
            !cursorInjected &&
            publication?.stage === boundary &&
            publication.refusal === null
          ) {
            cursorInjected = true;
            if (timing === "after") await writeState(state);
            throw new Error(
              `EIO: injected ${timing} ${boundary} cursor failure`
            );
          }
          if (
            cursorInjected &&
            !refusalInjected &&
            publication?.stage === boundary &&
            publication.refusal?.code === "COMPLETION_PUBLICATION_IO"
          ) {
            refusalInjected = true;
            if (timing === "after") await writeState(state);
            throw new Error(
              `EIO: injected ${timing} ${boundary} refusal-state failure`
            );
          }
          await writeState(state);
        };

        await runner.start({ slug: "example", request: "Implement it." });
        const blocked = await runner.approvePlan("human");
        assert.equal(cursorInjected, true);
        assert.equal(refusalInjected, true);
        assert.equal(blocked.status, "blocked");
        const attempt = blocked.activeAttempt;
        assert.ok(attempt?.kind === "implementation");
        assert.equal(
          (await runner.store.readRunAttempt(blocked.runId, attempt)).status,
          "pending_application"
        );
        assert.equal(
          await completionEventCount(runner, blocked.runId, "attempt.failed"),
          0
        );

        const promptsBefore = adapters.phasePrompts.length;
        const resumedRunner = new WorkflowRunner(repository.root, adapters);
        const done = await resumedRunner.resume();
        assert.equal(done.status, "done", done.blockReason ?? "");
        assert.equal(adapters.phasePrompts.length, promptsBefore);
        assert.equal(
          done.metrics.completedAttemptIds.filter((id) => id === attempt.id)
            .length,
          1
        );
        assert.equal(
          await completionEventCount(
            resumedRunner,
            done.runId,
            "attempt.failed"
          ),
          0
        );
        assert.equal(
          await completionEventCount(
            resumedRunner,
            done.runId,
            "completion.publication_applied"
          ),
          1
        );
        assert.equal(
          await completionEventCount(
            resumedRunner,
            done.runId,
            "completion.publication_refused"
          ),
          timing === "after" ? 1 : 0
        );

        const repeated = await resumedRunner.resume();
        assert.equal(repeated.status, "done");
        assert.equal(
          await completionEventCount(
            resumedRunner,
            done.runId,
            "completion.publication_applied"
          ),
          1
        );
      } finally {
        await repository.dispose();
      }
    });

for (const timing of ["before", "after"] as const)
  test(`an ordinary ${timing}-append publication-refusal event failure resumes without a model failure`, async () => {
    const repository = await createTestRepository();
    try {
      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      const runner = new WorkflowRunner(repository.root, adapters);
      const writeState = runner.store.writeState.bind(runner.store);
      let cursorInjected = false;
      runner.store.writeState = async (state) => {
        if (
          !cursorInjected &&
          state.completionPublication?.stage === "capture" &&
          state.completionPublication.refusal === null
        ) {
          cursorInjected = true;
          throw new Error("EIO: injected capture cursor failure");
        }
        await writeState(state);
      };
      const appendEventOnce = runner.store.appendEventOnce.bind(runner.store);
      let refusalEventInjected = false;
      runner.store.appendEventOnce = async (runId, type, data) => {
        if (
          !refusalEventInjected &&
          type === "completion.publication_refused"
        ) {
          refusalEventInjected = true;
          if (timing === "after") await appendEventOnce(runId, type, data);
          throw new Error(
            `EIO: injected ${timing} publication-refusal event failure`
          );
        }
        return await appendEventOnce(runId, type, data);
      };

      await runner.start({ slug: "example", request: "Implement it." });
      const blocked = await runner.approvePlan("human");
      assert.equal(cursorInjected, true);
      assert.equal(refusalEventInjected, true);
      assert.equal(blocked.status, "blocked");
      const attempt = blocked.activeAttempt;
      assert.ok(attempt?.kind === "implementation");
      assert.equal(
        (await runner.store.readRunAttempt(blocked.runId, attempt)).status,
        "pending_application"
      );
      assert.equal(
        await completionEventCount(runner, blocked.runId, "attempt.failed"),
        0
      );

      const promptsBefore = adapters.phasePrompts.length;
      const resumedRunner = new WorkflowRunner(repository.root, adapters);
      const done = await resumedRunner.resume();
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.equal(adapters.phasePrompts.length, promptsBefore);
      assert.equal(
        done.metrics.completedAttemptIds.filter((id) => id === attempt.id)
          .length,
        1
      );
      assert.equal(
        await completionEventCount(resumedRunner, done.runId, "attempt.failed"),
        0
      );
      assert.equal(
        await completionEventCount(
          resumedRunner,
          done.runId,
          "completion.publication_refused"
        ),
        1
      );
      assert.equal(
        await completionEventCount(
          resumedRunner,
          done.runId,
          "completion.publication_applied"
        ),
        1
      );
    } finally {
      await repository.dispose();
    }
  });

for (const boundary of ["capture", "receipt"] as const)
  test(`a delayed ${boundary} retry preserves the deterministic completion identity`, async () => {
    const repository = await createTestRepository();
    try {
      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      const runner = new WorkflowRunner(repository.root, adapters);
      let firstDigest: string | null = null;
      let firstTimestamp: string | null = null;
      if (boundary === "capture") {
        const writeCapture = runner.store.writeCompletionCapture.bind(
          runner.store
        );
        runner.store.writeCompletionCapture = async (runId, capture) => {
          if (firstDigest === null) {
            firstDigest = capture.integrityDigest;
            firstTimestamp = capture.capturedAt;
            throw new Error("EIO: injected capture manifest failure");
          }
          await writeCapture(runId, capture);
        };
      } else {
        const writePublication = runner.store.writeCompletionPublication.bind(
          runner.store
        );
        runner.store.writeCompletionPublication = async (runId, receipt) => {
          if (firstDigest === null) {
            firstDigest = receipt.integrityDigest;
            firstTimestamp = receipt.publishedAt;
            throw new Error("EIO: injected receipt failure");
          }
          await writePublication(runId, receipt);
        };
      }

      await runner.start({ slug: "example", request: "Implement it." });
      const blocked = await runner.approvePlan("human");
      assert.equal(blocked.status, "blocked");
      assert.equal(
        blocked.completionPublication?.refusal?.code,
        "COMPLETION_PUBLICATION_IO"
      );
      const attempt = blocked.activeAttempt;
      assert.ok(attempt?.kind === "implementation");
      assert.ok(firstDigest);
      assert.ok(firstTimestamp);

      await new Promise((resolve) => setTimeout(resolve, 5));
      const promptsBefore = adapters.phasePrompts.length;
      const resumedRunner = new WorkflowRunner(repository.root, adapters);
      const done = await resumedRunner.resume();
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.equal(adapters.phasePrompts.length, promptsBefore);
      if (boundary === "capture") {
        const capture = await resumedRunner.store.readCompletionCaptureIfExists(
          done.runId,
          attempt
        );
        assert.ok(capture);
        assert.equal(capture.integrityDigest, firstDigest);
        assert.equal(capture.capturedAt, firstTimestamp);
      } else {
        const receipt =
          await resumedRunner.store.readCompletionPublicationIfExists(
            done.runId,
            attempt
          );
        assert.ok(receipt);
        assert.equal(receipt.integrityDigest, firstDigest);
        assert.equal(receipt.publishedAt, firstTimestamp);
      }
    } finally {
      await repository.dispose();
    }
  });

for (const boundary of [
  "attempt",
  "state",
  "publication-event",
  "event-cursor"
] as const)
  test(`a restart after the durable completion ${boundary} reconciles state and events exactly once`, async () => {
    const repository = await createTestRepository();
    try {
      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      const runner = new WorkflowRunner(repository.root, adapters);
      let interrupted = false;
      if (boundary === "attempt") {
        const writeAttempt = runner.store.writeRunAttempt.bind(runner.store);
        runner.store.writeRunAttempt = async (runId, record) => {
          await writeAttempt(runId, record);
          if (
            !interrupted &&
            record.attempt.kind === "implementation" &&
            record.status === "completed"
          ) {
            interrupted = true;
            throw new TerminalRunStateError(
              await runner.store.readState(runId)
            );
          }
        };
      } else if (boundary === "state" || boundary === "event-cursor") {
        const writeState = runner.store.writeState.bind(runner.store);
        runner.store.writeState = async (state) => {
          await writeState(state);
          if (
            !interrupted &&
            state.activeAttempt?.kind === "implementation" &&
            state.completionPublication?.stage ===
              (boundary === "state" ? "state" : "event")
          ) {
            interrupted = true;
            throw new TerminalRunStateError(state);
          }
        };
      } else {
        const appendEventOnce = runner.store.appendEventOnce.bind(runner.store);
        runner.store.appendEventOnce = async (runId, type, data) => {
          const event = await appendEventOnce(runId, type, data);
          if (!interrupted && type === "completion.publication_applied") {
            interrupted = true;
            throw new TerminalRunStateError(
              await runner.store.readState(runId)
            );
          }
          return event;
        };
      }

      await runner.start({ slug: "example", request: "Implement it." });
      await runner.approvePlan("human");
      assert.equal(interrupted, true);
      const interruptedState = await runner.store.requireActiveState();
      assert.ok(interruptedState.activeAttempt?.kind === "implementation");
      const attempt = interruptedState.activeAttempt;
      assert.equal(
        (await runner.store.readRunAttempt(interruptedState.runId, attempt))
          .status,
        "completed"
      );
      assert.ok(
        await runner.store.readCompletionPublicationIfExists(
          interruptedState.runId,
          attempt
        )
      );

      const promptsBefore = adapters.phasePrompts.length;
      const resumedRunner = new WorkflowRunner(repository.root, adapters);
      const done = await resumedRunner.resume();
      assert.equal(
        done.status,
        "done",
        `${boundary}: ${done.blockReason ?? ""}`
      );
      assert.equal(adapters.phasePrompts.length, promptsBefore);
      assert.equal(
        done.metrics.completedAttemptIds.filter((id) => id === attempt.id)
          .length,
        1
      );
      assert.equal(done.metrics.attempts.implementation, 1);
      assert.equal(done.metrics.attempts.verification, 1);
      assert.equal(
        await completionEventCount(
          resumedRunner,
          done.runId,
          "completion.publication_applied"
        ),
        1
      );
      const repeated = await resumedRunner.resume();
      assert.equal(repeated.status, "done");
      assert.equal(
        await completionEventCount(
          resumedRunner,
          done.runId,
          "completion.publication_applied"
        ),
        1
      );
    } finally {
      await repository.dispose();
    }
  });

test("a restart after the refreshed-fix event preserves both application events exactly once", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(
      {
        contractVersion: CONTRACT_VERSION,
        verdict: "changes_requested",
        summary: "One finding requires a fix.",
        findings: [finding("R1-F1", "Fix the fixture.")],
        reviewedFindingIds: [],
        deferredCoverage: []
      },
      passingReview(["R1-F1"])
    );
    adapters.fixResults.push(
      phaseResult("fix", {
        taskCompletion: completionLedger(["T001"]),
        resolvedFindingIds: ["R1-F1"]
      })
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const triage = await runner.approvePlan("human");
    assert.equal(triage.status, "needs_triage");

    const appendEventOnce = runner.store.appendEventOnce.bind(runner.store);
    let interrupted = false;
    runner.store.appendEventOnce = async (runId, type, data) => {
      const event = await appendEventOnce(runId, type, data);
      if (!interrupted && type === "plan_task_completion.refreshed") {
        interrupted = true;
        throw new TerminalRunStateError(await runner.store.readState(runId));
      }
      return event;
    };
    await runner.triage({
      accepted: ["R1-F1"],
      rejected: [],
      deferred: [],
      note: null,
      decidedBy: "human"
    });
    assert.equal(interrupted, true);
    const interruptedState = await runner.store.requireActiveState();
    assert.ok(interruptedState.activeAttempt?.kind === "fix");
    const attempt = interruptedState.activeAttempt;
    assert.equal(
      (await runner.store.readRunAttempt(interruptedState.runId, attempt))
        .status,
      "completed"
    );

    const promptsBefore = adapters.phasePrompts.length;
    const resumedRunner = new WorkflowRunner(repository.root, adapters);
    const done = await resumedRunner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    assert.equal(
      done.metrics.completedAttemptIds.filter((id) => id === attempt.id).length,
      1
    );
    assert.equal(
      await completionEventCount(
        resumedRunner,
        done.runId,
        "completion.publication_applied"
      ),
      2,
      "implementation and fix each publish exactly once"
    );
    assert.equal(
      await completionEventCount(
        resumedRunner,
        done.runId,
        "plan_task_completion.refreshed"
      ),
      1
    );
  } finally {
    await repository.dispose();
  }
});

test("a candidate write failure leaves the proven attempt pending and resume publishes without another model call", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    const writeCandidate = runner.store.writeCompletionCandidate.bind(
      runner.store
    );
    let injected = 0;
    runner.store.writeCompletionCandidate = async (runId, candidate, bytes) => {
      if (injected === 0) {
        injected += 1;
        throw new Error("ENOSPC: injected candidate write failure");
      }
      await writeCandidate(runId, candidate, bytes);
    };
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedFrom, "implementing");
    assert.match(blocked.blockReason ?? "", /^\[COMPLETION_PUBLICATION_IO\]/);
    assert.match(blocked.blockReason ?? "", /stage candidate/);
    assert.doesNotMatch(blocked.blockReason ?? "", /ENOSPC/);
    const attempt = blocked.activeAttempt;
    assert.ok(attempt?.kind === "implementation");
    assert.equal(
      (await runner.store.readRunAttempt(blocked.runId, attempt)).status,
      "pending_application"
    );
    assert.equal(blocked.planTaskCompletion, null);
    assert.equal(
      blocked.completionPublication?.refusal?.code,
      "COMPLETION_PUBLICATION_IO"
    );
    assert.equal(blocked.completionPublication.stage, "candidate");
    const status = await runner.status();
    assert.deepEqual(status.completionPublication, {
      attemptId: attempt.id,
      attemptKind: "implementation",
      stage: "candidate",
      refusal: "COMPLETION_PUBLICATION_IO",
      pending: true,
      action: "resume"
    });
    assert.equal(status.retry.eligible, false);
    assert.equal(status.recovery.eligible, false);
    assert.equal(status.nextAction, "banzai resume");
    const control = projectAgentControlStatus(status).activeRun;
    assert.ok(control);
    assert.equal(control.nextAction, "resume");
    assert.deepEqual(control.completionPublication, {
      attemptId: attempt.id,
      attemptKind: "implementation",
      stage: "candidate",
      refusalCode: "COMPLETION_PUBLICATION_IO",
      publisherAttemptId: null
    });
    assert.equal(
      await completionEventCount(
        runner,
        blocked.runId,
        "completion.publication_refused"
      ),
      1
    );

    const promptsBefore = adapters.phasePrompts.length;
    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    assert.equal(done.metrics.attempts.implementation, 1);
    assert.equal(
      done.metrics.completedAttemptIds.filter((id) => id === attempt.id).length,
      1
    );
    assert.equal(
      await completionEventCount(
        runner,
        done.runId,
        "completion.publication_applied"
      ),
      1
    );
    assert.equal(
      await completionEventCount(
        runner,
        done.runId,
        "completion.publication_refused"
      ),
      1
    );
    assert.equal(
      (await runner.store.readRunAttempt(done.runId, attempt)).status,
      "completed"
    );
    assert.equal(done.planTaskCompletion?.status, "valid");
    assert.equal(done.completionPublication?.refusal, null);
  } finally {
    await repository.dispose();
  }
});

test("a receipt write failure after report replacement reconciles the proven bytes once and drift must be restored before resume", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    const writeReceipt = runner.store.writeCompletionPublication.bind(
      runner.store
    );
    let injected = 0;
    runner.store.writeCompletionPublication = async (runId, receipt) => {
      if (injected === 0) {
        injected += 1;
        throw new Error("EIO: injected receipt write failure");
      }
      await writeReceipt(runId, receipt);
    };
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.blockReason ?? "", /^\[COMPLETION_PUBLICATION_IO\]/);
    assert.match(blocked.blockReason ?? "", /stage receipt/);
    const attempt = blocked.activeAttempt;
    assert.ok(attempt?.kind === "implementation");
    const reportPath = await boundFixturePath(
      repository.root,
      "documentation/features/example/implementation-report.md"
    );
    const published = await readFile(reportPath);
    const candidate = await runner.store.readCompletionCandidateIfExists(
      blocked.runId,
      attempt
    );
    assert.ok(candidate);
    assert.ok(
      published.equals(candidate.bytes),
      "the destination already holds the exact candidate bytes"
    );
    assert.equal(
      (await runner.status()).completionPublication?.action,
      "resume"
    );

    // Drift: a later edit of the destination is never adopted as the output;
    // the deterministic resume detects it and switches to the drift route.
    await writeFile(
      reportPath,
      Buffer.concat([published, Buffer.from("\nLater edit.\n")])
    );
    const drifted = await runner.resume();
    assert.equal(drifted.status, "blocked");
    assert.match(
      drifted.blockReason ?? "",
      /^\[COMPLETION_PUBLICATION_DRIFT\]/
    );
    assert.equal(
      (await runner.store.readRunAttempt(drifted.runId, attempt)).status,
      "pending_application"
    );
    const driftedStatus = await runner.status();
    assert.equal(
      driftedStatus.completionPublication?.refusal,
      "COMPLETION_PUBLICATION_DRIFT"
    );
    assert.equal(driftedStatus.completionPublication.action, "cancel");
    assert.equal(driftedStatus.nextAction, "banzai cancel");
    assert.equal(
      projectAgentControlStatus(driftedStatus).activeRun?.nextAction,
      "cancel"
    );

    // Restoring the exact proven output re-enables the deterministic resume.
    await writeFile(reportPath, candidate.bytes);
    assert.equal(
      (await runner.status()).completionPublication?.action,
      "resume"
    );
    const promptsBefore = adapters.phasePrompts.length;
    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    assert.ok((await readFile(reportPath)).equals(candidate.bytes));
    assert.equal(
      await completionEventCount(
        runner,
        done.runId,
        "completion.publication_applied"
      ),
      1
    );
    assert.equal(
      done.metrics.completedAttemptIds.filter((id) => id === attempt.id).length,
      1
    );
    const receipt = await runner.store.readCompletionPublicationIfExists(
      done.runId,
      attempt
    );
    assert.ok(receipt);
    assert.equal(receipt.candidateDigest, candidate.candidate.integrityDigest);
    assert.equal(
      receipt.implementationReport.sha256,
      candidate.candidate.outputSha256
    );
  } finally {
    await repository.dispose();
  }
});

test("a receipt whose retained candidate is missing is a publication integrity refusal whose only exit is cancel", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    const writeAttempt = runner.store.writeRunAttempt.bind(runner.store);
    let injected = 0;
    runner.store.writeRunAttempt = async (runId, record) => {
      if (
        injected === 0 &&
        record.attempt.kind === "implementation" &&
        record.status === "completed"
      ) {
        injected += 1;
        throw new Error("EIO: injected attempt write failure");
      }
      await writeAttempt(runId, record);
    };
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.blockReason ?? "", /^\[COMPLETION_PUBLICATION_IO\]/);
    assert.match(blocked.blockReason ?? "", /stage attempt/);
    const attempt = blocked.activeAttempt;
    assert.ok(attempt?.kind === "implementation");
    assert.ok(
      await runner.store.readCompletionPublicationIfExists(
        blocked.runId,
        attempt
      )
    );
    await rm(
      runner.store.completionEvidencePath(
        blocked.runId,
        attempt,
        "completion-candidate.json"
      )
    );
    const promptsBefore = adapters.phasePrompts.length;
    const corrupt = await runner.resume();
    assert.equal(corrupt.status, "blocked");
    assert.match(
      corrupt.blockReason ?? "",
      /^\[COMPLETION_PUBLICATION_INTEGRITY\]/
    );
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    assert.equal(
      (await runner.store.readRunAttempt(corrupt.runId, attempt)).status,
      "pending_application"
    );
    assert.equal(corrupt.planTaskCompletion, null);
    const status = await runner.status();
    assert.equal(
      status.completionPublication?.refusal,
      "COMPLETION_PUBLICATION_INTEGRITY"
    );
    assert.equal(status.completionPublication.action, "cancel");
    assert.equal(status.nextAction, "banzai cancel");
    assert.equal(status.retry.eligible, false);
    assert.equal(status.recovery.eligible, false);
    assert.equal(
      projectAgentControlStatus(status).activeRun?.nextAction,
      "cancel"
    );
    assert.equal(
      await completionEventCount(
        runner,
        corrupt.runId,
        "completion.publication_applied"
      ),
      0
    );
    const cancelled = await runner.cancel();
    assert.equal(cancelled.outcome, "cancelled");
    assert.equal(
      (await runner.store.readState(corrupt.runId)).status,
      "cancelled"
    );
    assert.equal(
      (await runner.store.readRunAttempt(corrupt.runId, attempt)).status,
      "pending_application",
      "cancellation never promotes or rewrites the pending proof"
    );
  } finally {
    await repository.dispose();
  }
});

for (const tamper of ["receipt", "report"] as const)
  test(`a published completion ${tamper} edited before the review pass is rejected read-only with a repair route`, async () => {
    const repository = await createTestRepository();
    try {
      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      const runner = new WorkflowRunner(repository.root, adapters);
      // Tamper between publication and the verification boundary, after the
      // runner persisted its applied completion.
      const writeState = runner.store.writeState.bind(runner.store);
      let tampered = false;
      runner.store.writeState = async (state) => {
        await writeState(state);
        if (tampered || state.status !== "verifying") return;
        tampered = true;
        const completion = state.planTaskCompletion;
        assert.ok(
          completion?.status === "valid" &&
            completion.schemaVersion === 2 &&
            completion.publication
        );
        if (tamper === "receipt") {
          const receiptPath = path.join(
            runner.store.runDirectory(state.runId),
            completion.publication.path
          );
          const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
            implementationReport: { sha256: string };
          };
          receipt.implementationReport.sha256 = "0".repeat(64);
          await writeFile(receiptPath, JSON.stringify(receipt), "utf8");
        } else {
          const reportPath = path.join(
            repository.root,
            completion.implementationReport.path
          );
          await writeFile(
            reportPath,
            `${await readFile(reportPath, "utf8")}\nEdited after publication.\n`,
            "utf8"
          );
        }
      };
      await runner.start({ slug: "example", request: "Implement it." });
      const blocked = await runner.approvePlan("human");
      assert.equal(tampered, true);
      assert.equal(blocked.status, "blocked");
      assert.equal(blocked.blockedFrom, "verifying");
      assert.equal(adapters.reviewPrompts.length, 0);
      assert.match(blocked.blockReason ?? "", /PLAN_TASK_COMPLETION_INVALID/);
      assert.equal(blocked.planTaskCompletion?.status, "invalid");
      assert.equal(blocked.planTaskCompletion.violation, "summary_mismatch");
      assert.equal(
        await completionEventCount(
          runner,
          blocked.runId,
          "completion.publication_applied"
        ),
        1
      );
      const status = await runner.status();
      assert.equal(status.retry.eligible, true);
      assert.match(
        status.retry.reason,
        /repaired with a new implementation attempt/
      );
    } finally {
      await repository.dispose();
    }
  });

test("a blocked implementation whose gap targets the runner-owned section keeps its stop with an invalid-gap diagnostic", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationResults.push(
      phaseResult("implementation", {
        outcome: "blocked",
        gate: null,
        summary: "Blocked on an operator prerequisite.",
        questions: ["Provision the fixture credential."],
        taskCompletion: {
          schemaVersion: PLAN_TASK_COMPLETION_SCHEMA_VERSION,
          tasks: [
            {
              taskId: "T001",
              status: "blocked",
              evidence: [],
              gap: {
                reportPath:
                  "documentation/features/example/implementation-report.md",
                section: "Plan Task Completion",
                detail: "Blocked until the credential exists."
              }
            }
          ]
        }
      })
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedFrom, "implementing");
    assert.equal(blocked.planTaskCompletion, null);
    assert.equal(blocked.metrics.attempts.verification, 0);
    assert.equal(adapters.reviewPrompts.length, 0);
    const record = (await runner.store.readRunAttempts(blocked.runId)).find(
      (item) => item.attempt.kind === "implementation"
    );
    assert.ok(record);
    assert.equal(record.status, "completed");
    assert.equal(
      record.completionDiagnostic?.violation,
      "invalid_gap_reference"
    );
    assert.equal(record.completionDiagnostic.taskId, "T001");
    assert.equal(
      await runner.store.readCompletionPublicationIfExists(
        blocked.runId,
        record.attempt
      ),
      null
    );
    assert.equal(
      await runner.store.readCompletionCandidateIfExists(
        blocked.runId,
        record.attempt
      ),
      null
    );
    const capture = await runner.store.readCompletionCaptureIfExists(
      blocked.runId,
      record.attempt
    );
    assert.equal(capture?.outcome, "stop");
    assert.equal(
      await completionEventCount(
        runner,
        blocked.runId,
        "completion.publication_applied"
      ),
      0
    );
    assert.ok(
      (
        await readFile(
          await boundFixturePath(
            repository.root,
            "documentation/features/example/implementation-report.md"
          ),
          "utf8"
        )
      ).includes("banzai-plan-task-completion/v1"),
      "a stop never rewrites the model's report"
    );
  } finally {
    await repository.dispose();
  }
});

test("a completed claim with an incomplete task is rejected before any publication and repaired by one linked successor", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationResults.push(
      phaseResult("implementation", {
        taskCompletion: {
          schemaVersion: PLAN_TASK_COMPLETION_SCHEMA_VERSION,
          tasks: [
            {
              taskId: "T001",
              status: "incomplete",
              evidence: [],
              gap: {
                reportPath:
                  "documentation/features/example/implementation-report.md",
                section: "Plan Task Completion",
                detail: "Still open."
              }
            }
          ]
        }
      }),
      phaseResult("implementation")
    );
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedFrom, "implementing");
    assert.match(
      blocked.blockReason ?? "",
      /^\[PLAN_TASK_COMPLETION_INVALID\]/
    );
    const failed = blocked.activeAttempt;
    assert.ok(failed?.kind === "implementation");
    const record = await runner.store.readRunAttempt(blocked.runId, failed);
    assert.equal(record.status, "failed");
    assert.equal(record.failureCode, "PLAN_TASK_COMPLETION_INVALID");
    assert.equal(blocked.planTaskCompletion?.status, "invalid");
    assert.equal(
      await runner.store.readCompletionCandidateIfExists(blocked.runId, failed),
      null
    );
    assert.equal(
      await runner.store.readCompletionPublicationIfExists(
        blocked.runId,
        failed
      ),
      null
    );
    assert.equal(
      await completionEventCount(
        runner,
        blocked.runId,
        "completion.input_rejected"
      ),
      1
    );
    const status = await runner.status();
    assert.equal(status.nextAction, "banzai retry");
    const done = await runner.retry();
    assert.equal(done.status, "done", done.blockReason ?? "");
    const completion = done.planTaskCompletion;
    assert.ok(completion?.status === "valid");
    assert.notEqual(completion.sourceAttemptId, failed.id);
    assert.match(
      completion.sourceAttemptId,
      /^implementation-repair-[0-9a-f]{12}$/
    );
    const successor = await runner.store.readRunAttempt(done.runId, {
      id: completion.sourceAttemptId,
      kind: "implementation",
      mutable: true
    });
    assert.equal(successor.retryOf, failed.id);
    assert.equal(
      (await runner.store.readRunAttempt(done.runId, failed)).status,
      "failed",
      "the rejected source is retained unchanged"
    );
  } finally {
    await repository.dispose();
  }
});

test("archive closure carries the runner-owned completion proof and fails when the receipt is missing", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  try {
    const root = await realpath(repository.root);
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const done = await runner.approvePlan("human");
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.ok(done.artifactBinding);
    const workPath = `.banzai/work/${done.artifactBinding.binding.workId}`;
    const completion = done.planTaskCompletion;
    assert.ok(completion?.status === "valid" && completion.publication);
    const invoke = async (
      operation: string,
      fields: Record<string, unknown>
    ) => {
      const requestFile = path.join(root, "archive-request.json");
      await writeFile(
        requestFile,
        JSON.stringify({
          schema: "banzai-artifact-request/v1",
          schemaVersion: 1,
          repoRoot: root,
          ...fields
        })
      );
      const child = spawnSync(
        process.execPath,
        [artifactsCommandPath, operation, "--json", requestFile],
        { encoding: "utf8" }
      );
      return JSON.parse(child.stdout) as {
        ok: boolean;
        result?: unknown;
        error?: { code: string; message: string };
      };
    };
    const archive = async (destination: string) => {
      const inventoried = await invoke("inventory", {
        workPaths: [workPath],
        runIds: [done.runId]
      });
      if (!inventoried.ok) return inventoried;
      const inventoryFile = path.join(root, "reviewed-inventory.json");
      await writeFile(
        inventoryFile,
        JSON.stringify((inventoried.result as { inventory: unknown }).inventory)
      );
      return await invoke("export", { inventoryFile, destination });
    };
    const first = path.join(root, "archive-one");
    const exported = await archive(first);
    assert.equal(exported.ok, true, JSON.stringify(exported.error));
    const verified = await invoke("verify", { bundlePath: first });
    assert.equal(verified.ok, true, JSON.stringify(verified.error));
    const manifest = JSON.parse(
      await readFile(path.join(first, "manifest.json"), "utf8")
    ) as { entries: { path: string }[] };
    const receiptPath = `.banzai/runs/${done.runId}/${completion.publication.path}`;
    assert.ok(manifest.entries.some((entry) => entry.path === receiptPath));
    for (const leaf of [
      "completion-input.json",
      "completion-candidate.json",
      "completion-candidate.md",
      "implementation-input.md"
    ])
      assert.ok(
        manifest.entries.some((entry) => entry.path.endsWith(`.${leaf}`)),
        leaf
      );

    // Removing the receipt breaks completion closure even for a partial archive.
    await rm(path.join(root, receiptPath));
    const broken = await archive(path.join(root, "archive-two"));
    assert.equal(broken.ok, false);
    assert.equal(broken.error?.code, "ARTIFACT_EVIDENCE_INCOMPLETE");
  } finally {
    await repository.dispose();
  }
});
