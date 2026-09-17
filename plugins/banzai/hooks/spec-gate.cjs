#!/usr/bin/env node
/*
 * Spec-driven implementation gate — Claude Code PreToolUse / PostToolUse hook.
 *
 * Purpose: a human must approve the implementation phase before any
 * code/codebase change lands. Writing the plan/spec is free; writing code is
 * not. This is the enforcement backstop for the textual "Escalate or pause"
 * gates in the banzai skills — it does not trust model compliance.
 *
 * Behavior (per file-mutating tool call):
 *   - Manual mode gates only Banzai-adopted projects: a `.banzai/config.json`
 *     or root `PROJECT_MANIFEST.md` in the session directory or a parent.
 *     Without adoption evidence there is no spec or plan to protect, so the
 *     hook defers instead of taxing unrelated repositories.
 *   - In manual mode, documentation / spec artifacts (documentation/**,
 *     PROJECT_MANIFEST.md, CLAUDE.md, AGENTS.md) flow freely.
 *   - In runner mode, approved planning artifacts are immutable while new
 *     implementation reports and other unapproved documentation stay writable.
 *   - Orchestrated reviewers are read-only; the runner owns every review
 *     candidate and canonical artifact.
 *   - The first code/codebase change of a session escalates to a human
 *     permission dialog ("ask"). The agent can only proceed if the user
 *     approves; it cannot self-approve.
 *   - Once one code change has been approved (detected via PostToolUse, which
 *     fires only after a successful — i.e. approved — edit), the rest of that
 *     session's code changes flow without re-prompting. A new session re-locks.
 *   - In manual mode, `bypassPermissions` and editing the banzai plugin's own
 *     source are not gated. Runner context always fails closed.
 *
 * The session marker is written by this hook (not by any model tool) and only
 * after a genuine human approval, so the gate cannot be bypassed by the agent.
 *
 * Reads the hook payload as JSON on stdin; argv[2] is ${CLAUDE_PLUGIN_ROOT}.
 * Exit 0 with no stdout = defer to normal permission flow.
 */

'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

function deferAndExit() {
  // No stdout + exit 0 => Claude Code falls through to normal permission flow.
  process.exit(0);
}

async function main() {
// --- Parse the hook payload. Fail open (defer) on anything unexpected. ---
let payload = {};
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch (_) {
  deferAndExit();
}

const event = payload.hook_event_name || '';
const tool = payload.tool_name || '';
const cwd = payload.cwd || process.cwd();
const sessionId = payload.session_id || 'no-session';
const mode = payload.permission_mode || 'default';
const toolInput = payload.tool_input || {};
const runnerRunId = process.env.BANZAI_RUN_ID || '';
const runnerApprovalDigest = process.env.BANZAI_APPROVAL_DIGEST || '';
const runnerWorkflowDigest = process.env.BANZAI_WORKFLOW_DIGEST || '';
const runnerReviewArtifact = process.env.BANZAI_REVIEW_ARTIFACT || '';
const runnerMode = Boolean(
  runnerRunId || runnerApprovalDigest || runnerWorkflowDigest || runnerReviewArtifact
);

function runnerDecision(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason
    }
  }));
  process.exit(0);
}

// --- Don't gate the banzai plugin's own repo (plugin source lives in cwd). ---
// PLUGIN_ROOT is Codex's variable; CLAUDE_PLUGIN_ROOT is set by Claude Code and
// aliased by Codex for compatibility. argv[2] is whichever the command passed.
const pluginRoot = process.argv[2] || process.env.PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT || '';
if (!runnerMode && pluginRoot) {
  const root = path.resolve(pluginRoot);
  const project = path.resolve(cwd);
  if (root === project || root.startsWith(project + path.sep)) {
    deferAndExit();
  }
}

// --- Respect an explicit global opt-out. ---
if (!runnerMode && mode === 'bypassPermissions') {
  deferAndExit();
}

// --- Manual sessions gate only projects that adopted the Banzai workflow. ---
// Adoption evidence is `.banzai/config.json` or a root `PROJECT_MANIFEST.md`
// in the session directory or a parent. Without it there is no approved spec
// or plan to protect, so the gate stays silent in unrelated repositories.
// Runner mode never reaches this check and keeps failing closed.
function banzaiAdopted(startDirectory) {
  let directory = path.resolve(startDirectory);
  for (;;) {
    if (
      fs.existsSync(path.join(directory, '.banzai', 'config.json')) ||
      fs.existsSync(path.join(directory, 'PROJECT_MANIFEST.md'))
    ) {
      return true;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
}
if (!runnerMode && !banzaiAdopted(cwd)) {
  deferAndExit();
}

// --- Only file-mutating tools are gated (matcher already narrows this). ---
// Claude names file-edit tools Edit/Write/MultiEdit/NotebookEdit; Codex applies
// edits through `apply_patch`. (Codex PreToolUse interception of apply_patch is
// not yet reliable upstream, so on Codex this is best-effort.)
const GATED_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch']);
if (!GATED_TOOLS.has(tool)) {
  deferAndExit();
}

// --- Documentation / spec artifacts are never gated. ---
function isDocArtifact(p) {
  if (!p) return false;
  const norm = p.replace(/\\/g, '/');
  if (/(^|\/)documentation\//.test(norm)) return true;
  const base = norm.split('/').pop();
  return base === 'PROJECT_MANIFEST.md' || base === 'CLAUDE.md' || base === 'AGENTS.md';
}

// Codex's apply_patch carries the patch text in `tool_input.command`, not a
// `file_path`. Pull the target paths out of the patch body.
function patchTargets(input) {
  let text = '';
  if (typeof input.command === 'string') text = input.command;
  else if (Array.isArray(input.command)) text = input.command.join('\n');
  else if (typeof input.patch === 'string') text = input.patch;
  if (!text) { try { text = JSON.stringify(input); } catch (_) { text = ''; } }
  const targets = [];
  let m;
  const fileRe = /\*\*\*\s+(?:Add|Update|Delete)\s+File:\s*(.+)/g;
  while ((m = fileRe.exec(text))) targets.push(m[1].trim());
  const moveRe = /\*\*\*\s+Move to:\s*(.+)/g;
  while ((m = moveRe.exec(text))) targets.push(m[1].trim());
  return targets;
}

// Which file(s) does this call touch? Claude tools name one path; Codex's
// apply_patch lists them in the patch body.
const directPath = toolInput.file_path || toolInput.notebook_path || '';
const targets = directPath ? [directPath] : patchTargets(toolInput);

// Can't tell what it touches (e.g. an unparseable Codex edit): fail open so the
// gate never blocks legitimate work — the product's native approval still runs.
if (targets.length === 0) {
  if (runnerMode) {
    runnerDecision(
      'deny',
      'banzai spec-gate: orchestrated write denied because its target could not be determined.'
    );
  }
  deferAndExit();
}

// Private documents are classified through the installed shared resolver. A
// directory prefix alone never turns control files or a different work into docs.
if (!runnerMode && targets.some(target => /(?:^|\/)\.banzai\/work\//.test(target))) {
  try {
    const storage = await import('../lib/artifact-storage.mjs');
    const root = await storage.projectRoot(cwd);
    const documents = await Promise.all(targets.map(async target => {
      const relative = path.relative(root, path.resolve(cwd, target));
      if (isDocArtifact(relative)) return true;
      const match = relative.match(/^\.banzai\/work\/([0-9a-f-]{36})\//);
      if (!match) return false;
      const selected = await storage.inspectArtifacts({repoRoot: root, workId: match[1]});
      await storage.safePath(root, relative, {missing: true});
      return selected.work !== null && storage.ownsArtifact(selected.work.binding, relative);
    }));
    if (documents.every(Boolean)) deferAndExit();
  } catch (_) {
    runnerDecision('deny', 'banzai spec-gate: private work identity could not be validated; inspect artifact storage before writing.');
  }
}

// Pure documentation / spec writes are free in manual mode. Runner mode must
// still protect the exact planning bundle that received human approval.
if (!runnerMode && targets.every(isDocArtifact)) {
  deferAndExit();
}

// --- Optional orchestrator mode: bind code writes to the approved bundle. ---
function repositoryPath(projectRoot, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error('artifact path must be repository-relative');
  }
  const candidate = path.resolve(projectRoot, relativePath);
  if (!candidate.startsWith(projectRoot + path.sep)) {
    throw new Error('artifact path escapes the repository');
  }
  return candidate;
}

function approvalBundleDigest(projectRoot, artifactPaths) {
  if (!Array.isArray(artifactPaths) || artifactPaths.length === 0) {
    throw new Error('approval bundle is empty');
  }
  const entries = [...new Set(artifactPaths)].sort().map((artifactPath) => {
    const absolutePath = repositoryPath(projectRoot, artifactPath);
    const metadata = fs.lstatSync(absolutePath);
    if (!metadata.isFile() && !metadata.isSymbolicLink()) {
      throw new Error(`artifact is not a file: ${artifactPath}`);
    }
    const kind = metadata.isSymbolicLink() ? 'symlink' : 'file';
    const sha256 = crypto
      .createHash('sha256')
      .update(kind)
      .update('\0')
      .update(fs.readFileSync(absolutePath))
      .digest('hex');
    return { path: artifactPath, sha256 };
  });
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ version: 1, entries }))
    .digest('hex');
}

function workflowAuthorizationDigest(state) {
  const selection = state.workflowSelection;
  if (!selection || typeof selection !== 'object') {
    throw new Error('persisted workflow selection is missing');
  }
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      version: 1,
      runId: state.runId,
      request: state.request,
      recommendedWorkflow: selection.recommendedWorkflow,
      workflow: selection.workflow,
      confidence: selection.confidence,
      reason: selection.reason,
      escalationTriggers: selection.escalationTriggers,
      selectedAt: selection.selectedAt,
      attemptId: selection.attemptId
    }))
    .digest('hex');
}

if (runnerMode) {
  if (event === 'PostToolUse') {
    // Runner authorizations are durable run records, never session markers.
    process.exit(0);
  }
  try {
    if (!runnerRunId) {
      throw new Error('runner identity is missing');
    }
    if (!/^[A-Za-z0-9_-]+$/.test(runnerRunId)) {
      throw new Error('runner id is invalid');
    }
    const projectRoot = path.resolve(cwd);
    const pointer = JSON.parse(
      fs.readFileSync(path.join(projectRoot, '.banzai', 'active-run.json'), 'utf8')
    );
    const state = JSON.parse(
      fs.readFileSync(
        path.join(projectRoot, '.banzai', 'runs', runnerRunId, 'state.json'),
        'utf8'
      )
    );
    if (pointer.runId !== runnerRunId || state.runId !== runnerRunId) {
      throw new Error('active runner state does not match this process');
    }
    if (path.resolve(state.repoRoot || '') !== projectRoot) {
      throw new Error('runner state belongs to another repository');
    }
    const controlRoot = path.join(projectRoot, '.banzai');
    let privateWrites = new Set();
    if (state.schemaVersion === 4 || state.schemaVersion === 5 || state.schemaVersion === 6 || (state.schemaVersion === 7 && state.artifactBinding !== undefined)) {
      const storage = await import('../lib/artifact-storage.mjs');
      const bound = await storage.inspectBoundWork(projectRoot, state.artifactBinding);
      if (state.schemaVersion === 5 && bound.binding.schemaVersion !== 2) throw new Error('verification-enabled state requires its original v2 binding');
      if (state.schemaVersion === 6 || state.schemaVersion === 7) {
        const readers = await import('../lib/artifact-readers.mjs');
        readers.validateConfigurationStateEnvelope(state);
      }
      const roles = bound.binding.artifacts;
      const phase = state.activeAttempt?.kind;
      if (phase === 'selection' || state.status === 'selecting') throw new Error('workflow selection is read-only');
      const workflow = state.workflowSelection?.workflow;
      privateWrites = new Set(phase === 'plan' ? [roles.description, roles.plan] :
        ['implementation', 'fix'].includes(phase) ? workflow === 'feature' ? [roles.work] : workflow === 'quick-fix' ? [roles.changeReport] : [roles.implementationReport, roles.testReport, ...(phase === 'fix' ? [roles.changeReport] : [])] : []);
      for (const target of targets) {
        const relative = path.relative(projectRoot, path.resolve(projectRoot, target));
        await storage.safePath(projectRoot, relative, {missing: true});
        if (bound.binding.layout === 'private' && /^documentation\/(?:features|development-plans|changes)\//.test(relative)) throw new Error('work artifacts must use the persisted private binding');
      }
      if (phase === 'plan' && state.status === 'planning' && targets.every(target => {
        const relative = path.relative(projectRoot, path.resolve(projectRoot, target));
        return privateWrites.has(relative) || !relative.startsWith('.banzai/') && isDocArtifact(relative);
      })) runnerDecision('allow', 'banzai spec-gate: exact planning artifacts are writable during planning.');
    } else if (state.artifactBinding !== undefined) {
      throw new Error('legacy run cannot carry private artifact authority');
    }
    if (state.status === 'reviewing' || state.activeAttempt?.kind === 'review') {
      throw new Error('orchestrated reviewers are read-only; the runner owns review artifacts');
    }
    if (targets.some((target) => {
      const absoluteTarget = path.isAbsolute(target)
        ? path.resolve(target)
        : path.resolve(projectRoot, target);
      const isControlPath = absoluteTarget === controlRoot ||
        absoluteTarget.startsWith(controlRoot + path.sep);
      return isControlPath && !privateWrites.has(path.relative(projectRoot, absoluteTarget));
    })) {
      throw new Error('runner control files are not model-writable');
    }

    if (runnerWorkflowDigest) {
      if (runnerApprovalDigest || runnerReviewArtifact) {
        throw new Error('workflow and plan authorizations cannot be combined');
      }
      if (state.status !== 'implementing') {
        throw new Error(`lite workflow state ${state.status} does not allow writes`);
      }
      const selection = state.workflowSelection;
      if (
        !selection ||
        !['feature', 'quick-fix'].includes(selection.workflow)
      ) {
        throw new Error('active run does not contain a lite workflow selection');
      }
      const currentWorkflowDigest = workflowAuthorizationDigest(state);
      if (
        selection.digest !== runnerWorkflowDigest ||
        currentWorkflowDigest !== runnerWorkflowDigest
      ) {
        throw new Error('runner workflow digest does not match state');
      }
      runnerDecision(
        'allow',
        `banzai spec-gate: run ${runnerRunId} has a valid ${selection.workflow} workflow authorization.`
      );
    }

    if (!runnerApprovalDigest) {
      throw new Error('runner approval or workflow digest is missing');
    }
    if (!['implementing', 'fixing'].includes(state.status)) {
      throw new Error(`runner state ${state.status} does not allow writes`);
    }
    if (!state.planApproval || state.planApproval.digest !== runnerApprovalDigest) {
      throw new Error('runner approval digest does not match state');
    }
    const currentDigest = approvalBundleDigest(
      projectRoot,
      state.planApproval.paths || []
    );
    if (currentDigest !== runnerApprovalDigest) {
      throw new Error('approved planning artifacts changed');
    }
    const approvedArtifacts = new Set(
      state.planApproval.paths.map((artifactPath) =>
        repositoryPath(projectRoot, artifactPath)
      )
    );
    if (targets.some((target) => {
      const absoluteTarget = path.isAbsolute(target)
        ? path.resolve(target)
        : path.resolve(projectRoot, target);
      return approvedArtifacts.has(absoluteTarget);
    })) {
      throw new Error('approved planning artifacts are immutable');
    }
    runnerDecision(
      'allow',
      `banzai spec-gate: run ${runnerRunId} has a valid approved bundle.`
    );
  } catch (error) {
    runnerDecision(
      'deny',
      `banzai spec-gate: orchestrated write denied: ${error.message}.`
    );
  }
}

// --- Session approval marker (per session, in the OS temp dir). ---
const markerDir = path.join(os.tmpdir(), 'banzai-spec-gate');
const markerFile = path.join(markerDir, `approved-${sessionId.replace(/[^A-Za-z0-9_-]/g, '_')}`);

if (event === 'PostToolUse') {
  // A gated code change just succeeded, which means the human approved this
  // session's implementation phase. Record it so we stop re-prompting.
  try {
    fs.mkdirSync(markerDir, { recursive: true });
    fs.writeFileSync(markerFile, String(Date.now()));
  } catch (_) {
    /* best effort; if this fails the next edit simply prompts again */
  }
  process.exit(0);
}

// --- PreToolUse for a code/codebase change. ---
const alreadyApproved = (() => {
  try { return fs.existsSync(markerFile); } catch (_) { return false; }
})();

if (alreadyApproved) {
  // Implementation phase already approved this session: let code changes flow.
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'banzai spec-gate: implementation phase already approved for this session.'
    }
  }));
  process.exit(0);
}

// First code change of the session — require a human decision.
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'ask',
    permissionDecisionReason:
      'banzai spec-gate: first code/codebase change this session. Approve to authorize the implementation phase. ' +
      'The agent should already have presented its plan and named any escalation trigger from AGENTS.md ' +
      '(dependency, public contract or storage, auth/secrets/privacy, architecture or deployment). Deny if you have not reviewed the plan.',
    additionalContext:
      'A human approval gate fired on the first code change. If you have not yet presented the plan and named any escalation triggers, ' +
      'do so before relying on this approval.'
  }
}));
process.exit(0);

}
main().catch(() => runnerDecision("deny", "banzai spec-gate: artifact authority could not be validated."));
