---
name: adg-rbac-as-code
description: Model and verify RBAC, entitlement, tenant scope, business scope, and privileged support boundaries as code. Use when protected behavior, role matrices, permission checks, denial paths, or access evidence changes.
---

# ADG RBAC As Code

Use this for any protected operation or scoped data access.

## Prove

- entitlement or package includes the feature;
- role has the required permission;
- tenant, project, account, or workspace membership is valid;
- business or sub-scope allows the row or action;
- platform, support, or admin authority is separate from normal user authority;
- privileged access has audit evidence.

## Required Negative Paths

- missing entitlement;
- lowest disallowed role;
- cross-tenant or cross-workspace denial;
- cross-business or sub-scope denial where applicable;
- privileged support denied unless an audited support path exists.

Do not weaken auth, scope, or billing state to make a UI test pass.
