# ADG 2.1 release notes

A field-driven point release. ADG 2.1 changes nothing about what ADG enforces and a
great deal about what it presumes to decide. The trigger is a model-capability shift:
**Fable 5 (Claude Fable 5, Anthropic's Mythos-class tier) breaks work down into small,
well-scoped activities natively and measurably better than ADG's process layer does** --
per-task tier, lane, dependencies, first-failing-test, file scope, and evidence tier,
produced directly, at a granularity ADG's own backlog schema could not represent. Where
2.0 assumed the governance layer must supply planning discipline to the agent, 2.1
assumes the agent may already have it, and repositions the process layer from decider to
recorder while keeping the enforcement floor exactly as hard as before.

Style rule: no em dashes. Date: 2026-07-02.

## The evidence base

2.1 is anchored in a live field assessment run inside a production host repo
(a practice-management CRM running an autonomous multi-agent build loop against a
474-task backlog). The full assessment travels with that host
(`Review/Claude-Review/ADG-ASSESSMENT.md`); the load-bearing findings:

1. **The model's decomposition outgrew the SQL backlog within hours.** The host's build
   loop needed per-task `tier / lane / deps / firstFailingTest / files / evidenceTier`;
   the ADG backlog schema has no columns for these. The host shipped a markdown backlog
   with a deterministic parser manifest instead, and the SQLite store sat untouched at
   15 `planned` items while 474 manifest tasks built and verified around it.
2. **The lane classifier misfired as a decider.** The keyword matcher lane-escalated a
   docs-only change to L3 sensitive because the intent sentence contained the word
   "audit". A capable model's in-context scope judgment is strictly finer-grained.
3. **The guardrail hook's false positives taught agents to route around governance.**
   Literal-string matching blocked read-only `sqlite3 ".tables"` queries, `git commit`
   messages that merely mentioned destructive SQL, greps over SQL sources, and reads of
   committed `.env.example` templates. Builder loops lost runs to reworded commits.
4. **What survived contact unchanged is the enforcement floor and the vocabulary.** The
   host's orchestrator re-implemented lanes (as human-approval batching) and evidence
   tiers (as live-proof deferral) because the concepts are load-bearing; and no model,
   however capable, substitutes for the deterministic out-of-model gate.

## What changed

### 1. The guardrail hook got a precision pass (and a shipped regression suite)

Five false-positive classes fixed in `adg-guardrail-hook.mjs`. Every control remains
enabled; only the trigger surfaces shrank:

- **SQL-destructive requires executability.** `DROP TABLE / DROP DATABASE / DROP SCHEMA
  / TRUNCATE` blocks only in the same shell segment as an SQL client (`psql`, `sqlite3`,
  `mysql`, ...), piped into one, or fed to one via heredoc. Prose matches (commit
  messages, grep patterns) pass. Segment scoping was proven necessary live: the first
  draft of the tune was blocked by its own commit message, which named a client on one
  line and a keyword on another.
- **Context-hazard blocking targets dumps, not co-occurrence.** A raw-bytes reader
  (`cat`/`head`/`tail`/`xxd`/...) whose argument is the hazard file, or a whole-DB
  `sqlite3 .dump`, still blocks. Read-only structured queries (`sqlite3 db ".tables" |
  head`, `SELECT count(*)`) are allowed. Query-not-dump is exactly the behaviour the
  control wants; blocking inspection of governance state trains agents to route around
  governance, which is the worst incentive a governance layer can create.
- **Committed env templates are not secrets.** `.env.example` / `.env.template` /
  `.env.sample` no longer trip `secretsConfirm`; every real `.env*` still does.
- **Grep's search pattern is not a file path.** Searching source for the string
  `.sqlite` no longer blocks; path-shaped inputs are still checked.
- **The regression suite ships with the hook.** `adg-guardrail-hook.selftest.mjs` (23
  synthetic PreToolUse events: the fixed false positives pinned as must-allow, the
  destructive/tamper floor pinned as must-block, the confirmation set pinned as
  must-ask) installs next to the hook with an `adg:hook:test` package script. Any host
  that tunes a pattern must keep it ALL PASS, so a tune cannot silently weaken the
  floor.

### 2. The lane classifier is now a recorded second opinion

The Proofline lane decision belongs to the agent reading the actual scope of the change.
`work:classify` still runs, still records, and now says what it is: every output format
(JSON, toon, markdown) carries an `advisory` field stating that the agent's scope
judgment decides the lane. The `/adg-classify` command, `AGENTS.md`, the agent setup
guide, and the `adg:init` onboarding all reworded from "classify before material work"
to "lane the work yourself; record it". Two asymmetries deliberately survive: upgrade
freely and immediately on new risk evidence, and never go below the classifier's call
without recording a reason.

### 3. Context packets are available, not mandatory

"Generate a bounded packet before opening source files" assumed the agent could not
manage its own attention. The context broker remains (and the bulk-read denylist remains
always-on), but the packet is now an offer, not a required first step.

### 4. The backlog doctrine is now shape-per-decomposer

2.0 said "the backlog is SQL-first, no parallel markdown backlog". 2.1 says: **exactly
one canonical source of truth, in the shape that fits whoever decomposes the work.** For
fine-grained model-driven decomposition (the Fable-class shape: per-task tier, lane,
deps, first-failing-test, files, evidence), the canonical backlog is markdown epics plus
a deterministic parser manifest, and the SQLite store serves as a ledger or mirror. For
coarser human-curated backlogs, the seeded SQLite store with event-derived state remains
canonical. Hand-edited state is forbidden in both shapes, and whichever representation
is not canonical must be explicitly labelled a mirror.

### 5. What did not change

The enforcement floor: deny-by-default risk classes, the always-on controls
(`destructiveDeny`, `auditAppendOnly`, `forbiddenBulkRead`), fail-closed hook errors on
mutating tools, the audited toggle path, the append-only hash-chained audit log, and the
evidence-tier vocabulary (`asserted < config < test < live`) with the release gate over
it. The field assessment's sharpest conclusion cuts the other way from the rest of this
release: as capable models orchestrate fleets of cheaper models at volume, per-action
governance must be deterministic and free, which is precisely what the hook is. A
guardrail trained into a model can be talked around; a guardrail enforced outside the
model cannot. And evidence tiers catch a failure that is systemic rather than cognitive:
"verified" drifting above the strength of its proof happens to the smartest claimant
too.

## Upgrading a host

```sh
npm run adg:update -- --target . --client both
npm run adg:hook:test     # new: the hook regression suite must be ALL PASS
npm run adg:doctor -- --target .
```

`adg:update` refreshes the hook, installs the self-test and its package script, and
merge-manages `guardrails.json` as before (a routine update never clobbers a host's
governed toggles). Hosts that already carry local hook tunes should diff against the
2.1 hook first; the self-test is the contract for any further tuning.

## Version note

Recorded as v2.1 at Zach's direction, 2026-07-02: *this change is made in response to
Fable 5's better ability to break down tasks into smaller activities.* The process layer
that taught earlier models to plan is now optional scaffolding; the enforcement layer
that no model replaces is unchanged and better tested.
