# bord.room V4.1 Lite Skills

These repo-local skills describe the low-token complete-dev workflow for bord.room
V4.1. They keep the SQL backlog as the source of truth while reducing process
overhead.

Use them as the default implementation discipline:

- `bordroom-lite-build-runner` - feature-slice plan/design/build/test execution.
- `bordroom-lite-traceability` - concise SQL-first evidence and audit handling.

The heavier installed `$bordroom-build-runner` and `$bordroom-traceability` skills
remain appropriate for release checkpoints, broad security work, generated artifact
sync, and pre-push validation.

