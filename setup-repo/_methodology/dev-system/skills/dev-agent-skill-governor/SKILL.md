---
name: dev-agent-skill-governor
description: Create or maintain compact bord.room agent skills. Use when adding, revising, validating, or promoting SKILL.md packages for context selection, UX contracts, surface maps, RBAC, data, testing, IaC, docs, release evidence, or agent workflows.
---

# bord.room Agent Skill Governor

Use this when creating or updating skills.

## Skill Rules

- One skill per required function.
- Frontmatter must include `name` and a trigger-ready `description`.
- Body should contain only workflow, required reads/writes, checks, evidence, and stop conditions.
- Move long examples to references only when needed.
- Avoid README files inside skill folders.
- Keep skills small enough to load without crowding feature context.

## Validate

```sh
node development/_system/validate-system.mjs
```

Update `development/_system/system.json` whenever a skill is added, renamed, or retired.
