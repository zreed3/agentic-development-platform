# Fable field review — ADG improvement proposals

**Author:** Claude (Fable 5), writing as the agent that operated inside ADG continuously across 2026-06-10/11 on bord.room v4.1.
**Workload reviewed against:** a full-application commercial gap review (214 findings, 3 verification fleets), a three-way landing of `main` + a 178-commit feature branch + uncommitted multi-agent WIP (44 conflicted files), and a full ADG regeneration cycle (S32 elicitation promotion, 33-feature backlog, gate battery to green, Vercel deploy).
**Verdict in one line:** the contract layer paid for the entire framework in a single merge; the friction is concentrated in four fixable places — truth-vs-tree, mute contracts, late validation, and missing write-path tooling.

---

## 1. What earned its keep (do not touch)

These are load-bearing. Every recommendation below is additive to them, not a replacement.

| Capability | Receipt from the field |
|---|---|
| **Contract tests over merged code** | Caught five regressions that typecheck + build + 2,300 unit tests missed: an RLS-unsafe auth-membership query that would have broken **every production login**; roster business-scoping dropped from a row query (tenant-data exposure); a staff mutation that silently lost its audit event (8/9 contract); lost `cache()` memoization on the auth resolver (S30 hot path); WIP jumping a release staging gate. |
| **Append-only audit JSONL** | Survived three sessions, several agent crews, and a branch merge (union-merged cleanly). Waivers, decisions, and evidence stayed attributable throughout. |
| **SQL-first backlog + elicitation as code** | Promoting a whole feature (S32: 20 tasks, 13 use cases, 8 criteria, 9 persona workflows) from elicitation into the backlog was a 20-minute mechanical job *because the crew's intent was already structured data*. |
| **Missing-link / route-registry guard** | Forced honest registration of five new WIP routes and flagged a `/sign-up` proxy matcher with no page behind it. |
| **Release gate that checks the packet against live data** | S28 caught stale launch-packet backlog counts the moment the backlog changed. |

---

## 2. The four failures that mattered

### F1 — Status described a tree the checkout didn't have
The worst governance failure of the week was invisible to ADG: features sat `verified` on a checkout where their implementation **did not exist** (the code lived on an unmerged branch; the gitignored SQLite is branch-agnostic local state). The false signal actively misdirected review agents — they burned turns hunting for a route registry the skill docs promised was present. ADG validated internal consistency perfectly while being wrong about the world.

### F2 — Contracts that don't say what they mean
A dozen contract tests grep source for exact strings (`canWrite: boolean`, a regex count of `.where(scopeConditions)`, `if (!weekId || !hasShifts) return;`). During merge triage every failure forced the same expensive question: *is this a security invariant or a stale assertion?* I got it right by reading git history; a weaker agent or a tired human flips a coin. Implementation-pinned contracts also punish legitimate refactors.

### F3 — Validation three layers from the cause
The S32 elicitation used persona ids the canonical model doesn't have. Nothing complained at elicitation time, nothing at backlog promotion, nothing at `adg:sync`. It surfaced days later as `FOREIGN KEY constraint failed (19)` at line 1026 of a **generated** SQL file inside the docs generator — raw sqlite stderr, no pointer to the offending elicitation row.

### F4 — The most common write has no tool
Recording review findings (177 items) and promoting S32 required hand-rolled `INSERT INTO feature_items` SQL. The CLI covers status *transitions* beautifully and item *creation* not at all. Meanwhile the governance entry points themselves (`pnpm backlog:*`, `adg:*`) existed only on one branch — the framework's availability depended on checkout state.

---

## 3. Improvements, prioritized

Each: problem → proposal → acceptance check. P0s address the failures above directly.

### P0-1 · Reality-check gate (`adg:attest`)
**Problem:** F1 — `verified` is a claim about code, but nothing checks the code is *here*.
**Proposal:** a gate that, for every `verified`/`release-gate` item, asserts the evidence paths cited in its events exist on the current tree, and that feature anchor files exist. Output per failure: item id, missing path, the branch where it last existed (`git log --all --diff-filter=A`). Run inside `ci:traceability` and as a standalone fast command.
**Accept when:** checking out a stale branch turns the dashboard visibly red within one command, with per-item explanations.

### P0-2 · Stamp "which world" on everything
**Problem:** F1's enabler — packets, gates, and the backlog never state which checkout truth describes.
**Proposal:** every context packet, gate result, and audit event records `{branch, HEAD sha, dirty-file count}` (the audit events already carry git fields — surface them). The context broker refuses (or loudly warns) when the backlog's latest evidence commit is not an ancestor of HEAD: *"governance state is newer than your checkout."*
**Accept when:** an agent on the wrong branch is told so in its first context packet, not after a multi-hour review.

### P0-3 · Intent-bearing contracts
**Problem:** F2 — contracts fail without telling the reader what invariant they guard.
**Proposal:** a contract header convention enforced by lint:
```ts
// @contract S13-INV-03
// invariant: scoped roster reads must apply businessIds to BOTH count and row queries
// severity: security | on-fail: do not weaken; reshape the query to satisfy both
```
Failure messages print the header. New rule: source-grep assertions are allowed **only** with a header explaining why the property can't be asserted behaviorally. Provide a `contract:list` command so agents can read all invariants for a feature before touching it.
**Accept when:** every contract failure message answers "what must remain true and what do I do now" without git archaeology.

### P0-4 · Write-path tooling: `backlog:add-item` and `elicitation:promote`
**Problem:** F4.
**Proposal:** `backlog:add-item --feature S32 --type task --title "..." [--status planned] [--tag gap-review:launch-blocker]` (allocates the next id/position, validates, exports). `elicitation:promote --feature S32` does what I hand-rolled: feature row + items + persona workflows from the elicitation tables, **with the persona remap against the canonical registry built in**, idempotent re-runs. Plus `review:intake findings.json` for bulk external-review ingestion with a feature map — every audit/review will need it.
**Accept when:** a full review's findings can be recorded without writing a single line of raw SQL.

### P1-5 · Shift-left elicitation validation (`elicitation:lint`)
**Problem:** F3.
**Proposal:** canonical vocabularies (personas, realms, access levels, item-type prefixes) live in one registry table; elicitation files are linted at intake against it and against FK targets. Generators validate *inputs* before invoking `sqlite3` and report the offending **source** row, never a generated-file line number.
**Accept when:** the S32 persona mismatch class is caught the day the elicitation is written, with the elicitation file/line in the error.

### P1-6 · Finish R3: zero tracked generated artifacts
**Problem:** `config/agentic/*.json` and generated HTML/MD docs are still tracked — a 2,273-hunk merge conflict in `elicitation.json` and an 88k-line governance commit this week.
**Proposal:** untrack all generated outputs; CI regenerates and publishes them as build artifacts/Pages; ship a `drift:check` that compares regenerated-vs-source without committing outputs. For the one append-only tracked file (audit JSONL), add a `.gitattributes` union merge driver — it union-merged by hand this week and that should be automatic.
**Accept when:** a governance commit is the JSONL append and nothing else.

### P1-7 · Branch-portable bootstrap
**Problem:** governance commands lived in one branch's `package.json`.
**Proposal:** a single committed entry point that travels with every branch and pins its own dependencies: `node scripts/adg.mjs <command>` (or `npx @adg/cli`), with `package.json` aliases as optional sugar. The bootstrap also self-checks (sqlite3 present, schema version, generated-artifact freshness).
**Accept when:** `git checkout <any-branch> && node scripts/adg.mjs doctor` works everywhere the repo exists.

### P1-8 · Machine-readable gate output, everywhere
**Problem:** agents parse prose and raw sqlite stderr; several validators emit JSON, others don't; pipes mask exit codes (bit me twice this week).
**Proposal:** every gate supports `--json` with `{passed, failures[], next_command}` and meaningful exit codes; a top-level `adg:gate --json` aggregates. Include `next_command` per failure — the single highest-leverage affordance for agents ("run `elicitation:lint --fix-personas` to remap").
**Accept when:** an agent can run one command, parse one JSON document, and know exactly what to do next.

### P2-9 · Concurrency as a first-class mode
**Field note:** claims/TTL exist but the crews didn't use them; `--no-regenerate` was the only thing that made concurrent governance writes safe. **Proposal:** a documented "concurrent mode" default (JSONL-append only, regeneration deferred to named checkpoints), `backlog:claim` integrated into the slice profile so claiming is the default first step, and a `checkpoint` command that batches the deferred regeneration + validation + commit.

### P2-10 · Cost telemetry in the audit trail
**Field note:** this week included an unplanned ~A$500 spend discovered only at the account limit. **Proposal:** ADG already records who/what/when — add *how much*: optional token/cost fields on audit events, per-session and per-feature rollups, and a budget guard in the context broker (it already bounds context; let it bound spend declarations the same way).

### P2-11 · Deferral as a field, not a tag
**Field note:** merge-seam deferrals were recorded as `[merge-seam:deferred]` title tags plus `blocked` status. **Proposal:** first-class `deferred_reason`, `deferred_until` (date or gate id), and `unblock_condition` columns, surfaced by `backlog:next` so deferred work resurfaces automatically when its condition gate flips.

---

## 4. Suggested sequencing

1. **P0-1 + P0-2 together** — they're one feature ("truth corresponds to tree") seen from gate-side and packet-side.
2. **P0-4** next — every other improvement produces findings that need the write path.
3. **P0-3, P1-5, P1-8** as one "agents can act on failures" wave.
4. **P1-6, P1-7** before this platform becomes the base for new repos (cheaper to bake in than retrofit).
5. P2s opportunistically.

---

*Provenance: written from direct operating experience; the concrete incidents cited are reconstructable from bord.room v4.1's audit JSONL (2026-06-10/11), the gap review (`docs/v4-1-full-app-gap-review.md`), and merge commits `f0d0bc3d..141bb0f5`.*
