---
title: The SQL Data Layer (the "SQL server")
status: active
classification: internal
category: agentic-delivery
---

# The SQL Data Layer

The platform's "SQL server" is a single local **SQLite** database,
`data/backlog.sqlite`. There is no external database server, no daemon, and no
network dependency — just the `sqlite3` CLI and a few `node` scripts. SQLite is
chosen because it is embedded, transactional, ubiquitous, queryable from the shell,
and trivially rebuildable.

> Requirement: the `sqlite3` command-line tool must be on `PATH`. Node itself needs
> no database driver — the scripts shell out to `sqlite3`.

## Canonical vs generated

A deliberate split keeps the database cheap to trust and easy to review:

| Layer | Files | Role |
|---|---|---|
| **Canonical, human-editable** | `data/seed/backlog.seed.json`, optional seed fixtures, `data/audit/audit-log.jsonl` | The source of truth you edit. |
| **Generated, queryable** | `data/backlog.sqlite` | Rebuilt from the selected seed; what you *query*. Not version-controlled. |
| **Generated, reviewable** | `data/backlog-source.sql` (`.dump`), `data/schema.sql` (`.schema`) | Text mirrors for diffs and code review. Version-controlled. |

`npm run setup` rebuilds an empty database from the default seed and re-emits the
reviewable mirrors. `npm run setup:demo` loads the self-referential worked-example
seed and mirrors the append-only audit log into SQL for governance tests. Because
the database is generated, it is on `.gitignore`; the `.sql`/`.schema` mirrors are
committed instead. This is the same discipline the context broker enforces:
**SQLite is queried, never pasted; the big dump is a forbidden bulk file.**

## Schema at a glance

Planning tables:

- `epics`, `features`, `feature_dependencies`, `labels`, `feature_labels`
- `feature_items` — tasks, test cases, success criteria, and use cases (one table,
  discriminated by `item_type`)
- `feature_persona_workflows` — persona / RBAC / access-level expectations per feature
- `routes`, `integrations` — surface inventory the context broker reads

Execution tables (the lifecycle):

- `backlog_item_events` — append-only item lifecycle events (claim/start/complete/verify/...)
- `backlog_item_claims` — current claim per item, with TTL and write scope

Audit:

- `audit_events` — empty by default; `setup --with-audit` mirrors
  `data/audit/audit-log.jsonl` into SQL when a worked example or review flow needs it

Derived views (current state is always *derived*, never stored):

- `feature_current_status` — planned status from the feature, current status folded
  from the latest audit event
- `backlog_item_current_status` — base status + current status from events + active
  claim, with claim expiry handled in SQL
- `persona_workflows`, `feature_tasks`, `feature_test_cases`,
  `feature_success_criteria`, `feature_use_cases`, `backlog_summary`

The full DDL lives in [`data/schema.sql`](../data/schema.sql) (regenerated on every
`setup`/mutation).

For a visual, copyable command map of the same engine, open
[`docs/sql-engine-view.html`](sql-engine-view.html).

## The item lifecycle

Items move through a claim/transition model, recorded as immutable events. The
current status is computed from those events, so the history is never overwritten.

```sh
npm run backlog:next   -- --feature S07 --type task --limit 5
npm run backlog:show   -- --item S07-TASK-01
npm run backlog:claim  -- --item S07-TASK-01 --actor agent --ttl-hours 8 --scope scripts/agent-context.mjs
npm run backlog:start  -- --item S07-TASK-01 --summary "Started"
npm run backlog:complete -- --item S07-TASK-01 --summary "Implemented" --evidence scripts/agent-context.mjs
npm run backlog:verify -- --item S07-TASK-01 --summary "Verified" --evidence "npm run test:agent-context"
npm run backlog:fail -- --item S07-TASK-01 --summary "Targeted check failed" --evidence "npm run test:agent-context"
npm run backlog:release -- --item S07-TASK-01    # give up a claim
npm run backlog:active                            # list unexpired claims
```

`backlog:fail` records a `test-result` with status `failed` so failures are visible
in the SQL backlog instead of only appearing in prose. Failed items are eligible for
`backlog:next` once the active claim expires or is released.

Claims have a TTL and a write scope. `backlog:next` skips items with an active claim,
so parallel agents can each take disjoint work without colliding — the database is
the coordination point.

## Querying directly

Everything is plain SQL. Some starting points:

```sh
# Feature status board
sqlite3 data/backlog.sqlite \
  "select feature_id,planned_status,current_status,latest_update from feature_current_status order by feature_id;"

# What is claimed right now
sqlite3 data/backlog.sqlite \
  "select item_id,actor,expires_at from backlog_item_claims where status='active';"

# Audit trail for a feature
sqlite3 data/backlog.sqlite \
  "select occurred_at,event_type,status,summary from audit_events where feature_id='S07' order by occurred_at;"
```

## Adapting it to a real project

The default seed in `data/seed/backlog.seed.json` is intentionally empty, so a new
app starts without demo records. To adopt the layer in a host repo, add that
project's epics/features/items/routes to the seed, then `npm run setup`. Use
`data/seed/backlog.demo.seed.json` only for the ADG worked example. The schema is
generic; nothing in it is specific to any one product. `npm run backlog:validate`
enforces structural integrity (every feature has at least one task and one test
case, no orphaned dependencies or routes).
