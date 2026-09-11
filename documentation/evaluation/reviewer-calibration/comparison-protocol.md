# Future reviewer comparison protocol

Proposed experiment specification; no execution is authorized by this document. This protocol
is separate from the frozen evaluation/KPI contracts, the effectiveness pilot,
and EQ shadow promotion. Passing it supports a dataset-specific implementation
recommendation only; it grants no authority to ship or change approved scope.

## Freeze before execution

1. Resolve the concrete case adjudication queue and freeze a dated case release,
   source register, input/answer hashes, task-group splits and exclusions.
   Record whether each incomplete reconstruction supplies enough evidence for
   the particular scored claim. Unresolved labels do not enter semantic scores.
2. Freeze baseline and candidate source revisions, working-tree deltas,
   bundles/maps, plugin/policy versions and relevant contract versions. Change
   one causal surface at a time. A captured bundle is a baseline identity,
   not proof that historical runs used its present instructions.
3. Hold vendor CLI, model identifier, effort, other exposed generation settings,
   tool/permission inventory, context access, fixtures, verification evidence,
   review mode and outcome budget comparable. Record unsupported settings and
   immutable model-build identity as unknown. An alias is not a frozen build.
   Separate incompatible configurations instead of averaging them together.
4. Pre-register the targeted measure and numerical target, all guard measures,
   trial count, order, matching rules, missing-data treatment and exclusions.
   For context work, name the exact payload category/surface, baseline coverage,
   expected reduction, correctness guard and rollback condition under ADR-0028.
5. Authorize any future model execution separately. Use an isolated input-only
   workspace with no original source repository, private answers, later commits,
   builder lineage, or production access. No source/project commands from case
   artifacts execute implicitly. Give both arms the same permitted evidence.

Use independent reviewer sessions for every arm/trial. Full review starts
fresh. A resolution-review trial receives only its permitted earlier reviewer
history and triage; any resumed lineage is separate from the builder and from
the other arm. Rotation never authorizes rediscovery under unchanged evidence.
For artifact-only trials freeze the structured result and vary only the
representation/generation mechanism; never let repair alter semantic findings.

## Trials and scoring

Use **three independent trials per eligible case per arm** initially, with
balanced, randomized arm order recorded before execution. Keep all failures,
invalid outputs and budget exhaustion; do not reroll for a clean sample. If
variation or sparse adjudication makes the result inconclusive, specify a new
fixed collection window before running it; never keep sampling until a desired
threshold passes. Show each case's detection count out of three, ranges and
variation. Repeats and related cases are not independent task observations.

| Measure                           | Rule and denominator                                                                                                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Known material-defect detection   | Match independently adjudicated defects by authority, locus, root cause and impact. Report detected/known eligible adjudicated defects per trial and per task group. This is case-set recall, never production-wide recall.                                                           |
| Unsupported findings              | Human-adjudicated claims with incorrect/unsupported evidence, applicability, consequence or authority; report count and fraction of classified unique findings, plus unresolved counts. Preference without material impact is separately classified.                                  |
| Duplicates                        | Repeated semantic identity without independently remediable impact; retain all observation references, count unique defects once, and report duplicate observations/all observations.                                                                                                 |
| Improper rediscovery              | Reopened rejected/deferred concern without new evidence or authority, including rotated sessions. Check all resolution opportunities; a repeated topic after a substantive change is not automatically improper.                                                                      |
| Scope coverage                    | Required approved surfaces acknowledged and substantively assessed/required surfaces; distinguish deterministic path presence from adjudicated evidence of actual review. Supplied paths alone are not reviewer attestation.                                                          |
| Artifact validity                 | Valid outputs/all attempted outputs, rejected candidate count, repair invocations and successful canonical publications. Keep model/process success separate from validation/application.                                                                                             |
| Observable review effort          | Physical attempts, primary/repair invocations, runner payload bytes by category, vendor tokens/cost/turns with independent coverage. Record model-authored deterministic fields and formatting turns removed. Elapsed runtime may be reported separately, never as active human time. |
| Completion and boundary integrity | Assessed violations of approved scope, human triage, independent review, verification, privacy and truthful completion/assurance. Unknown assessment is not zero.                                                                                                                     |

Human adjudicators initially see shuffled outputs without arm labels where
feasible. They record authority, evidence, materiality, semantic identity,
classification, acceptable remedies and disagreement independently of historical
triage. An equally effective bounded remedy counts; string similarity to the
historical finding does not. Unexpected valid findings are adjudicated and
reported separately; revise the frozen answer set in a new release and apply
that revision symmetrically to both arms, never only to benefit the candidate.

Track the existing reviewer KPIs as explanatory measures where complete run
exports exist. Do not fabricate run KPIs from these fixture trials, add fields
to frozen contracts, or optimize `first_review_pass_rate` alone. Silence can
increase pass rate while removing material-defect detection.

## Acceptance and rollback

The following are proposed minimum comparison gates, to freeze with the chosen
intervention before trials. Adjudicate a new case set before scoring it.

- **Deterministic contracts:** 100% of applicable valid/invalid fixture checks
  have their intended accept/reject result; output bytes are deterministic for
  identical structured input. Required scope cannot disappear; semantic fields,
  verified command evidence and completion evidence cannot drift or be invented.
  Failures remain non-canonical. Approved artifacts remain immutable.
- **Material defects:** candidate detects each adjudicated critical
  correctness/security/completion defect in all three trials. For other
  adjudicated material defects, its per-case detection count cannot fall below
  baseline. Report baseline failures too. No compensating reduction in noise
  can offset a missed material guard case.
- **Noise and convergence:** zero improper-rediscovery or duplicate violations
  on the explicit guard fixtures; no increase in adjudicated unsupported
  findings in any task group. For a noise-targeting intervention with a nonzero
  baseline, require at least a 25% reduction in pooled unsupported observations
  across the fixed paired trials; if the baseline is zero, retain zero and make
  no reduction claim. Report sparse counts without significance claims.
- **Artifact-work target:** for an intervention moving deterministic formatting
  to the runner, require zero model calls solely to reproduce deterministic
  metadata/evidence/Markdown parity in covered artifact fixtures, with all
  contract guards passing. Report resource changes only on equally covered
  surfaces; historical repair counts alone are not a savings estimate.
- **Boundaries:** zero confirmed scope, approval, human-triage, review-independence,
  privacy, or false-completion violations among assessed trials. All intended
  guard cases require sufficient adjudicated evidence. Unresolved safety
  disagreements, contaminated holdouts or unequal evidence access make the
  comparison inconclusive and block a favorable recommendation.

Stop the experiment and return to the frozen baseline configuration on any
contract failure, lost material-defect detection, improper rediscovery, or
boundary violation attributable to the candidate. Preserve failed outputs and
usage. Investigate before another explicitly frozen candidate trial. Missing
or incomparable evidence requires a pause/inconclusive result; never discard
that evidence or relax the target after seeing outcomes. These rules do not
cancel/recover production workflows or authorize deployment rollback commands.

## Applying the protocol

Evaluate one bounded intervention at a time. Preserve the current
runner-rendered artifact and reviewer-owned scope contract under ADR-0037.
Use deterministic representation guards and independently adjudicated semantic
cases. Keep planning-detail and context-reduction changes in separate candidates.
Historical approved plan wording stays binding in evaluator inputs. Add
independent repositories, stacks, and exact snapshots before making any general
reviewer-quality claim.
