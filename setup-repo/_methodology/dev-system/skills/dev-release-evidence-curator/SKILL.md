---
name: dev-release-evidence-curator
description: Curate bord.room V4.1 launch and release evidence. Use for go/no-go packets, blocker counts, deferrals, owners, risk, rollback, restore proof, cost review, security evidence, support readiness, and release-gate decisions.
---

# bord.room Release Evidence Curator

Use this for checkpoint and launch decisions.

## Evidence Packet

Include:

- current backlog and tracker status;
- P0/P1 blockers and failed rows;
- approved deferrals with owner, risk, rollback, target release, and approver;
- route, UX, RBAC, entitlement, security, performance, restore, cost, and support evidence;
- commands run and results.

## Rules

- A go decision cannot rely on unstated assumptions.
- Missing evidence is blocked unless an approved deferral exists.
- Keep tenant/customer data and secrets out of packets.
