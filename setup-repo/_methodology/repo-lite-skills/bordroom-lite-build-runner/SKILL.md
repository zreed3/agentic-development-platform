---
name: bordroom-lite-build-runner
description: Low-token bord.room V4.1 feature-slice delivery. Use for normal complete-dev implementation where the SQL backlog remains canonical but full traceability/prepush gates are reserved for checkpoints.
---

# bord.room Lite Build Runner

Use this skill for day-to-day V4.1 implementation.

## Default Loop

1. Plan
   - Query the SQL backlog.
   - Generate one bounded packet:
     ```sh
     pnpm context:lite -- --feature S08
     ```
   - Name the exact feature slice, routes/contracts, and files in scope.

2. Design
   - Decide tenant/business scope, RBAC, entitlement, page-state behavior, and
     negative-test seams before editing.
   - Do not invent product policy; use V4.1 docs and SQL rows.

3. Build
   - Edit only scoped implementation files and directly related tests.
   - Avoid generated docs until the slice is stable.
   - Keep SQL backlog rows as the execution source; do not create parallel task lists.

4. Test
   - Run targeted tests/checks first.
   - Record failed commands once:
     ```sh
     pnpm backlog:fail -- --item S08-TEST-01 --summary "Targeted check failed" --evidence "pnpm test -- ..."
     ```
   - Record one consolidated verification when the same evidence covers multiple
     tasks, tests, use cases, or criteria.

## Checkpoint Gates

Run full gates only at feature completion, release checkpoints, process/tooling
changes, or before push:

```sh
pnpm ci:traceability
pnpm dev:prepush
```

During implementation, prefer:

```sh
pnpm lite:check
pnpm test -- <focused-test>
pnpm --filter <package> typecheck
pnpm db:validate-migrations
```

Use the DB/migration/security checks only when the slice touches those boundaries.

