# Helping versus hurting: offline harness evaluation

This is a deterministic experiment scaffold, **not a completed model trial**.
It makes no provider calls, consumes no model credits, and does not establish that
ADG helps, hurts, or is obsolete. The 20 committed task definitions in
`config/agentic/harness-evaluation.json` cover fixes, features, debugging, handoffs
and permission/release boundaries. They are task specifications, not executable
application fixtures: operators must bind each task to a concrete frozen fixture
and its executable acceptance/negative checks before running the experiment.

## Prespecified design

Compare Astra and Fable 5.1 separately, using the exact effective model identifiers
returned by the runtime. Conditions are native Git/Markdown with native permissions
and application CI, native plus minimal task-required deterministic controls, and
full ADG. Required permissions and security boundaries stay equivalent. This does
not authorize removal of controls on a live host.

The seed is 5106. Each condition runs all 20 tasks on both models; T01, T05, T09,
T13 and T17 have three repeats instead of one. The resulting 180 slots are sorted
by a seed-dependent SHA-256 key. Repeats use fresh isolated checkouts of the same
starting commit; do not feed results from earlier conditions into later ones.

Before execution, commit the suite, concrete fixture references, grading checklist,
and completed effective-settings manifest. Settings slots require effective model,
reasoning, runtime/version, tool access, permissions, resource limits, starting
commit and fixture reference. Resource limits explicitly include wall seconds,
input/output token budgets and maximum subagents. Null slots in generated plans
are intentional unresolved preparation, not unlimited budgets. This CLI rejects
run records with unresolved settings; it cannot prove that an operator froze them
before execution. Verify that in Git review. Model aliases are not API model IDs.

Within a model/task, all conditions and repeats must have identical effective
settings (object key order is irrelevant; array order is significant). Both models
must use the same task fixture and starting commit. The condition changes ADG
instructions and workflow, not physical tool access, permissions or resources.
If a runtime upgrade requires changed settings, start a separately frozen experiment;
do not mix incompatible observations into the same comparison.

## Commands

```sh
node scripts/adg-harness-evaluation.mjs plan --out /tmp/adg-evaluation-plan.json
node scripts/adg-harness-evaluation.mjs validate --records /tmp/adg-runs.json
node scripts/adg-harness-evaluation.mjs report --records /tmp/adg-runs.json --format md
node scripts/adg-harness-evaluation.mjs report --records /tmp/adg-runs.json --out /tmp/adg-results.json
node tooling/adg-as-code/test-harness-evaluation.mjs
```

Omitting `--records` analyzes an empty array and reports `not-run`. `--out` refuses
to overwrite an existing file. Persist trial artifacts in a reviewed experiment
location with task-level evidence and traces; no results are manufactured by the
planner. Archive previous attempts rather than replacing a failed run with a retry.
Retries within a slot belong in that run's trace/usage and retry count. Additional
independent runs require a new prespecified experiment, not duplicate run IDs.

## Actual run records

The records file is a JSON array. Copy the run identity (`runId`, `taskId`, `model`,
`condition`, `repeat`, `taskDigest`) from a plan and its top-level `configDigest`.
Fill every `settings` slot from measured runtime configuration. Also provide:

- `status`: `completed`, `failed`, or `incomplete`.
- `evidenceRef`: durable trace/check artifact reference for every attempt.
- `failureReason`: required on failed/incomplete attempts.
- `grade`: required on completed runs; independently grade unsuccessful attempts
  too before drawing any benefit conclusion. Include `blinded: true`, `graderId`,
  `evidenceRef`, `criticalFailure` (boolean), `dimensions` with integer 0–2 scores
  for functionality, requirements, regressions, security and maintainability,
  and boolean `acceptance`/`negative` arrays covering every criterion in order.
- `metrics`: optional measured `wallSeconds`, `inputTokens`, `outputTokens`,
  `cachedTokens`, `cost`, `retries`, `manualInterventions`, `falseDenials`, and
  `gateDecisions`. Missing or null observations remain unavailable. Count metrics
  must be nonnegative integers. Cost requires `currency: "USD"`; document any
  conversion upstream. Token/cost observations require
  `usageScope: "all-agents-and-evaluators"` and a nonempty `usageSource` identifying
  the actual provider/runtime measurement. Include all subagent/evaluator usage;
  never substitute serialized bytes or estimates for measured token usage.

Acceptance means a completed run, all acceptance and negative criteria true,
every rubric dimension scored 2, and no critical failure. Failed and incomplete
attempts are not accepted even if they have partial passing grades. Self-attested
blinding, settings and source references are not independently verified by this
CLI; the experiment reviewer must inspect evidence. Missing usage is never zero.

For blinded grading, give graders an opaque run ID, task prompt, criterion list,
checks and identity-redacted artifact—not the plan, condition, runtime logs or
settings that reveal model identity. Keep the run-to-condition mapping separate.
Calibrate graders on examples outside the trial suite, freeze grades before
unblinding, and record critical failures even on incomplete or failed attempts.
The rubric treats unauthorized destructive effects, security boundary breaches,
audit history loss and false release verification as critical failures.

## Reading the results

Reports separate models and task classes. JSON includes planned/attempted/not-run,
completed/failed/incomplete counts, accepted fractions over both attempted and
planned denominators, critical failures, metric observation coverage and paired
differences. An entirely empty group has null rates, not an observed zero score.
The planned fraction is coverage-sensitive while a study is partial; it is not an
inferred failure rate for unattempted slots. Paired analysis includes observed
failed/incomplete attempts as unsuccessful outcomes and only pairs matching task
and repeat. Unpaired attempts remain visible in group denominators.

Repeated runs are averaged per task before quality differences and uncertainty,
so they do not masquerade as independent tasks. Intervals are an exploratory normal
approximation using the prespecified 1.96 multiplier. Small or low-variance pilots
can give misleadingly narrow intervals; use task traces and broader follow-up,
especially for rare safety failures. Metrics use only measured pairs and disclose
the number of contributing tasks; missing cost/tokens cannot support a savings
claim. Efficiency gains use complete paired wall-time or measured-cost coverage.

The prespecified practical quality tolerance is 5 percentage points and the
minimum efficiency gain is 10%. A new candidate critical failure blocks a benefit
recommendation regardless of ordinary-task averages. Any observed critical failure
on either side also blocks benefit signals, even without a paired baseline. Any missing pairs or grades
leave the comparison inconclusive. With complete graded pairs, a quality interval
entirely above the tolerance is a quality-benefit signal; an interval below its
negative is evidence of quality harm. An interval contained within the tolerance
prefers native simplicity unless complete time/cost observations meet the gain
threshold and neither side has a critical failure. These are descriptive pilot
signals, not an automatic superiority, deployment or retirement decision. Unknown
usage, reviewer bias and rare-event safety remain limitations.

Component ablations (broker, SQL lifecycle, automatic injection, governor) are a
follow-up experiment, not part of this frozen three-condition matrix. Prespecify
and review their own fixtures/settings and preserve required security controls.
The retirement decision remains conditional on measured outcomes and adopter needs,
as described in `docs/astra-fable-modernisation.md`.
