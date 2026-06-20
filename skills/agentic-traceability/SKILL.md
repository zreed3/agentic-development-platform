---
name: agentic-traceability
description: Maintain the append-only audit log and SQL-first backlog of a repo that uses the Agentic Development Platform. Use when working on feature delivery, bug fixes, route or scope changes, integration status, release evidence, comments, decisions, or status updates that should be recorded in data/audit/audit-log.jsonl and the data/backlog.sqlite tracker.
---

# Agentic Traceability

Use this skill to keep the development tracker current while building. The tracker
is both a planning database and an audit trail; do not let implementation drift
from it.

## Source Files

In the repo root:

- `data/backlog.sqlite` — the canonical, queryable backlog (generated from text sources).
- `data/backlog-source.sql` / `data/schema.sql` — reviewable SQL mirrors.
- `data/seed/backlog.seed.json` — the human-editable seed.
- `data/audit/audit-log.jsonl` — append-only audit source.
- `scripts/backlog-db.mjs` — rebuilds the database and runs the item lifecycle.
- `scripts/record-audit.mjs` — appends an audit event and mirrors it into the database.
- `scripts/validate-audit.mjs` — validates the audit log.

## Workflow

1. Identify the feature id before making or summarizing changes.
   ```sh
   sqlite3 data/backlog.sqlite "select id,title,status,release_band from features order by id;"
   ```

2. Inspect current audited state.
   ```sh
   sqlite3 data/backlog.sqlite \
     "select feature_id,title,planned_status,current_status,latest_update_at,latest_update from feature_current_status order by feature_id;"
   ```

3. Generate a bounded context packet before reading source files (do not bulk-load
   the generated mirrors):
   ```sh
   npm run context:feature -- --feature S07 --workflow route
   ```

4. Make the implementation/doc change using normal repo conventions.

5. Record an audit event before your final response.
   ```sh
   npm run audit:record -- \
     --feature S07 \
     --type status \
     --status in-progress \
     --summary "Started context broker work" \
     --evidence scripts/agent-context.mjs
   ```

6. Verify the event is queryable.
   ```sh
   sqlite3 data/backlog.sqlite \
     "select occurred_at,event_type,target_id,status,summary from audit_events order by occurred_at desc limit 5;"
   ```

## Event Types

- `status` — progress state changed.
- `comment` — implementation note, blocker, or useful observation.
- `evidence` — proof link/path added.
- `test-result` — verification result, passing or failing.
- `decision` — product, architecture, scope, or gate-waiver decision.
- `scope-change` — feature, route, integration, or release-band scope changed.

Suggested status values: `planned`, `in-progress`, `blocked`, `implemented`,
`verified`, `failed`, `deferred`, `superseded`.

## Audit Rules

- Treat `data/audit/audit-log.jsonl` as **append-only**. Never delete or rewrite an
  event. If an earlier event was wrong, append a corrective `comment` or `decision`.
- Never put secrets, credentials, tokens, or customer data in audit
  summaries/details/evidence. `npm run audit:validate` will flag likely secrets.
- Prefer file paths, PRs, commits, test commands, and doc paths as evidence.
- Use one concise event for a feature slice when the same evidence covers multiple
  tasks, tests, use cases, or success criteria.
- Record failed test runs as `test-result` / `failed`; do not hide them in a
  passing verification summary.
- For a deliverable that renders to a user, label the feature `release-class:visual`
  and record a `live` event with a rendered artifact as evidence; metric-only evidence
  cannot sign it off.

## Useful Queries

Outstanding work:
```sh
sqlite3 data/backlog.sqlite \
  "select feature_id,title,current_status,latest_update from feature_current_status where current_status in ('planned','blocked','in-progress') order by feature_id;"
```

Feature evidence:
```sh
sqlite3 data/backlog.sqlite \
  "select occurred_at,event_type,status,summary from audit_events where feature_id='S07' order by occurred_at;"
```

Routes by feature:
```sh
sqlite3 data/backlog.sqlite \
  "select path,kind,realm,status,file_path from routes where feature_id='S07' order by path;"
```

## Final Response Checklist

When this skill was used, mention:

- Which feature id was updated.
- Which audit event id was recorded.
- Which checks or queries verified the tracker.
