---
name: adg-quick-ui-fix
description: Use for small UI, copy, docs, styling, or visual polish fixes that should avoid full governance unless risk increases.
---

# ADG Quick UI Fix

Use for `L1 quick-fix` work.

## Workflow

1. Classify with `npm run work:classify`.
2. Use `workflow=quick-ui` when a context packet is useful.
3. Edit only directly related files.
4. Verify with the nearest focused check, screenshot, or smoke test.
5. Do not run full governance unless the lane upgrades.

## Upgrade Triggers

Upgrade to `L2` or `L3` if the change touches:

- data loading or mutation;
- auth, RBAC, tenant, business scope, or entitlement behavior;
- route status or navigation policy;
- schema, migration, guardrails, audit, or production operations.

## Output

```text
lane L1 quick-fix
files <paths>
checks <targeted proof>
full gate no
```
