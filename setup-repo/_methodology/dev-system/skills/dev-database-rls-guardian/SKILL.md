---
name: dev-database-rls-guardian
description: Guard bord.room V4.1 database schema, migrations, RLS, repository predicates, tenant context, seeds, and runtime DB role behavior. Use when adding tables, changing repositories, migrations, RLS policies, or tenant/business-owned data access.
---

# bord.room Database RLS Guardian

Use this before DB or repository changes.

## Check

- Schema, migration, seed, repository, and runtime behavior align.
- Tenant-owned rows include tenant ownership.
- Business-owned rows include business scope where needed.
- RLS policies deny cross-tenant and cross-business access.
- Runtime role cannot bypass RLS.
- App traffic uses tenant context transactions.

## Commands

```sh
pnpm db:validate-migrations
pnpm test -- rls
```

Use targeted package tests when a narrower command proves the change.
