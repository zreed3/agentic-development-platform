---
name: bordroom-lite-traceability
description: Concise SQL-first traceability for bord.room V4.1 Lite feature-slice delivery. Use to keep evidence truthful without micro-event overhead.
---

# bord.room Lite Traceability

The SQL backlog remains canonical:

- `docs/traceability/v4-1-backlog.sqlite`
- `docs/traceability/v4-1-backlog-source.sql`

Do not replace SQL with Markdown task lists or spreadsheets.

## Evidence Rules

- Query SQLite for context instead of reading generated mirrors.
- Record one consolidated verification/audit event per feature slice when possible.
- Record failed test commands with `pnpm backlog:fail`.
- Use full generated doc sync only when scope, routes, UX, architecture,
  integrations, or release evidence materially changes.

## Minimal Queries

```sh
sqlite3 docs/traceability/v4-1-backlog.sqlite \
  "select id,feature_id,item_type,title,current_status,latest_update from backlog_item_current_status where feature_id='S08' order by position;"

sqlite3 docs/traceability/v4-1-backlog.sqlite \
  "select persona_id,rbac_role,realm,access_level,expected_state,primary_route,status from feature_persona_workflows where feature_id='S08' order by persona_id;"
```

## Audit Timing

For normal code-only slices, keep evidence in backlog item events and record a
feature-level audit event at the end of the slice. For checkpoint/release work,
use the heavier traceability flow and regenerate docs before validation.

