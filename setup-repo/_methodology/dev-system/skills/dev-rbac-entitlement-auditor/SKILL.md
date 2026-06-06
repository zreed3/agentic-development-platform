---
name: dev-rbac-entitlement-auditor
description: Audit bord.room V4.1 RBAC, entitlement, tenant scope, and business scope. Use when protected routes, actions, queries, billing/package behavior, platform admin, support access, or persona workflow evidence changes.
---

# bord.room RBAC Entitlement Auditor

Use this for any protected behavior.

## Prove

- Entitlement includes the feature.
- Role has the required permission.
- Tenant membership is valid.
- Business scope allows the row or action.
- Platform authority is separate from tenant authority.
- Audit or support evidence exists for privileged decisions.

## Required Negative Tests

- Missing entitlement.
- Lowest disallowed role.
- Cross-tenant denial.
- Cross-business denial where business scope applies.
- Platform support denied unless an audited support path exists.

Do not weaken auth, RLS, or billing state to make UI tests pass.
