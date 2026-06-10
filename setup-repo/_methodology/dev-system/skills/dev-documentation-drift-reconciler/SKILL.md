---
name: dev-documentation-drift-reconciler
description: Reconcile bord.room V4.1 documentation drift. Use when generated docs, source docs, route matrices, tracker mirrors, UX/architecture status, integration lifecycle status, or release planning artifacts may disagree with code or SQL.
---

# bord.room Documentation Drift Reconciler

Use this when source and generated artifacts may disagree.

## Order

1. Identify the authoritative source.
2. Update source data or generator, not generated mirrors.
3. Regenerate only when source, route, UX, architecture, integration, or release scope changed.
4. Run drift or traceability checks.
5. Record one audit event with changed sources and generated artifacts.

## Commands

```sh
pnpm docs:v4:generate
pnpm drift:generated
pnpm ci:traceability
```

Use full gates for checkpoints and process/tooling changes.
