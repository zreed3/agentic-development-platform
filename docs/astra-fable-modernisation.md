# Astra and Fable 5.1: modernisation and retirement decision

Status: native initialization, thin Claude adapters, context-preserving retirement
and evaluation validation/reporting are implemented. No comparative model trial
has been completed; ADG is not declared obsolete. Existing installations retain
their controls unless explicitly migrated.

## Recommendation

Start new projects with Git, concise Markdown instructions and decisions, native
runtime permissions, and focused application CI. Use durable handoff notes when
work spans sessions. Add orchestration only for a measured failure or an explicit
control requirement. The advanced SQL ADG profile remains available for adopted
requirements lineage, reporting, and evidence workflows.

Existing installations require an explicit update or removal: preserve important
context first, identify any enforcement that must survive, and verify the resulting
host workflow. Optional adoption does not mean silently disabling existing
always-on controls or rewriting audit history.

## Advice and provenance

Anthropic's [harness-design report](https://www.anthropic.com/engineering/harness-design-long-running-apps)
shows that scaffolding can become unnecessary as models improve: its newer-model
experiment dropped context resets. It also describes separate evaluators and
file-based handoffs for observed long-running development failures. This supports
retesting individual components, not assuming all harnesses help or all are obsolete.

The [Claude Code memory documentation](https://code.claude.com/docs/en/memory)
and [best practices](https://code.claude.com/docs/en/best-practices) support concise
project instructions, scoped context, and concrete verification. These are reasons
to test a lightweight native baseline before layering on SQL planning and extra
hooks.

Anthropic's [agent evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
informs the task suite below: judge outcomes and inspect execution traces, combine
appropriate graders, and separate a harness test from a model's task performance.
The [Fable 5.1 announcement](https://www.anthropic.com/claude-fable-and-mythos-5-1)
establishes the named release; it does not establish that ADG is obsolete.

This assessment uses published Anthropic guidance and local source inspection.
A direct Claude second opinion was not obtained: the local Claude CLI was
unauthenticated. Do not present this document as a Claude-generated review.
Astra is the locally available Codex model designation; record the exact effective
model identifier and runtime during trials rather than inferring public API
compatibility from the display name.

## Known limitations to test

- The context broker caps rows and file pointers, not actual tokens or relevance.
  It selects configured anchors and routes; stale anchors can hinder discovery.
- Historical context savings compare serialized packets with generated mirrors,
  not an effective Git-and-Markdown baseline.
- The security fixtures test policy mappings and selected hook execution paths.
  They do not measure these models' coding or adversarial-task performance.
- Audit hashes check internal consistency. A party able to rewrite both log and
  sidecar can forge a consistent history; reviewed Git history remains essential.
- Native permissions, vendor context management, and application CI can overlap
  with ADG. Extra prompts, duplicate gates, and arbitrary stop conditions can add
  latency, false denials, or premature completion.

## Matched evaluation

1. Freeze 20–30 representative tasks before tuning: small fixes, multi-file
   features, debugging, session handoffs, and changes with real permission or
   release boundaries. Define acceptance criteria and relevant negative tests.
2. Run every task on both Astra and Fable 5.1, with the exact effective model,
   reasoning settings, runtime version, tool access, and resource limits recorded.
   Use fresh isolated checkouts of the same starting commit for each run.
3. Compare three conditions: native Git/Markdown baseline; that baseline plus
   minimal required deterministic controls; and the existing full ADG workflow.
   Keep requirements, permissions, tests, and task intent equivalent. Randomize
   run order and repeat a prespecified subset to expose run variance.
4. Use graders blinded to model and condition. Grade accepted functionality,
   requirement coverage, regressions, security boundaries, and maintainability.
   Use executable checks where appropriate and calibrated human review otherwise.
   Inspect traces for false denials, unjustified approvals, and early stopping.
5. Record wall time, actual input/output/cached tokens, all subagent/evaluator usage,
   available cost, retries, manual interventions, and gate false-positive rates.
   Keep failures and incomplete runs in the denominator. Report missing usage as
   unavailable; never replace it with a byte estimate called measured tokens.
6. Run component ablations on the same tasks: remove the broker, SQL lifecycle
   bookkeeping, automatic context injection, or governor independently. Preserve
   equivalent task requirements and required security controls. An ablation is an
   isolated experiment, not permission to relax a live host's invariants.
7. Publish task-level results, paired differences and uncertainty, split by model
   and task class. Do not hide quality losses in an average cost improvement.
   A 20–30-task pilot informs adoption; it cannot establish rare-event safety.

Before execution, commit the task suite, grading rubric, resource limits, and
practical quality/cost thresholds. A proposed pilot rule is to reject a candidate
with a new critical failure, retain components that produce repeatable accepted
quality gains, and prefer the simpler condition when quality is equivalent within
the predeclared tolerance. Inconclusive results mean no superiority claim; expand
relevant tasks before broad deployment. Required security controls remain required
even if ordinary-task scores cannot measure their value.

## Preserve context and migrate hosts

Inventory development repositories and installed ADG versions using managed install
state and tracked configuration. Distinguish active repos, archives, worktrees,
vendor copies, and untouched repos; do not install ADG into repositories that never
adopted it merely to make version numbers uniform.

For each adopted host, record a disposition: update the governed profile, retain
with a documented constraint, or remove through a context-preserving migration.
Preserve local modifications and dirty worktrees. Do not overwrite host rules with
the template's rules.

Before removal, export decisions, outstanding requirements, acceptance criteria,
known risks, current work, and verification instructions into reviewed Markdown.
Keep stable IDs and source references so the export is traceable. Markdown is the
new maintained working context; preserve original audit history unchanged for
provenance. Keep secrets and customer data out of Git. Capture a rollback inventory
of managed files and host customizations before removing hooks or scripts, then
run host checks and verify remaining native permissions and CI.

Commit the migration notes and reviewable changes in Git only within the authorized
repository scope. A local export without a Git record is preservation in progress,
not a completed migration. Report inaccessible or ambiguous repositories explicitly
rather than claiming every development project was updated.

## Clean-source packaging boundary

The modernisation is prepared from the committed source in an isolated worktree.
The original development checkout contains unrelated work in progress, which is
preserved there and is not implicitly included in this version.

The clean source advertised tool-registry commands (`tools:list`, `tools:card`,
`tools:validate`, `tools:gaps`) and UI write-path commands (`ui:writepath-gate`,
`test:ui-writepath-gate`) whose implementation files were not shipped in that
committed baseline. Their package entries and references in the aggregate gate
are deferred rather than presented as runnable or passing checks. The likewise
unshipped `test:models-set` entry is omitted. These checks have not been executed
successfully as part of this clean-source version; their omission does not prove
that the corresponding risks are covered.

This is an explicit packaging limitation, not a blanket gate waiver or permission
to remove functioning controls from adopters. The original WIP remains available
for a separate reviewed integration; reinstate the command entries with their
implementations and tests when that work is adopted. Existing shipped security,
audit, and release checks remain required. A host requiring the deferred controls
must retain its working implementation or defer adopting this package until an
equivalent verified control is available.

## Conditional retirement

Retire the project only if the matched evaluation and adopter requirements show
that Git/Markdown plus native controls and CI meet the relevant needs, and no
retained ADG component justifies maintaining this project. Otherwise keep a smaller
optional project and document which use cases earned continued support.

Before GitHub archival, publish the evidence, migration instructions, retained
history locations, and rollback guidance; resolve active adopters first. The
retirement note should say the project was superseded **in the evaluated workflows**
by the simpler Astra/Fable setup, cite measured results and their limits, and avoid
claiming the models replace security boundaries. Model names alone are not evidence
of obsolescence. Archive only after that conditional decision is supported and the
requested migrations have been verified.

## Implemented entry points

- `adg:init` defaults to native Markdown setup for fresh projects; use
  `--profile governed` for explicit advanced adoption.
- `claude:generate` writes a thin `@AGENTS.md` adapter and preserves unique notes.
- `adg:preserve-context` exports known ADG context; retirement preserves context
  before applying file removals.
- The [evaluation scaffold](harness-evaluation.md) supplies committed tasks,
  validation and reporting. Actual model runs and blind grading are still required.
