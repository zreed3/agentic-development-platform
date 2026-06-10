---
name: dev-experience-contract-author
description: Create or update bord.room V4.1 experience contracts. Use when a user goal, workflow, page, primary CTA, server action, route, or launch-critical journey needs explicit persona, authority, state, data, audit, and test coverage.
---

# bord.room Experience Contract Author

Use this when a workflow needs to be provable end to end.

## Contract Shape

Capture:

- user goal and persona;
- route, component, primary action, and fallback action;
- allowed, read-only, empty, loading, validation error, system error, forbidden, entitlement-locked, and dirty states;
- entitlement, permission, tenant scope, business scope, RLS, and audit event;
- DB tables or repositories touched;
- positive and negative tests;
- evidence command.

## Rules

- Do not create a contract for a future or hidden surface unless it is marked hidden/future.
- UI visibility is not authority.
- Missing entitlement, insufficient role, cross-tenant, and cross-business paths need negative evidence where relevant.
