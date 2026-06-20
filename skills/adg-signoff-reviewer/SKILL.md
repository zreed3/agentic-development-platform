---
name: adg-signoff-reviewer
description: Use when work needs release, RC, GA, verified, release-ready, or signed-off claims backed by traceable evidence.
---

# ADG Signoff Reviewer

Use for `L4 release signoff`.

## Workflow

1. Classify with `npm run work:classify`.
2. Generate a `release-signoff` context packet when a feature is known.
3. Confirm feature, backlog items, persona/RBAC, routes, contracts, scenarios, journeys, tests, and audit evidence.
4. Run the full governance or traceability gate.
5. Record explicit deferrals, failures, and GO/NO-GO decisions.

## Rules

- Narrative confidence is not evidence.
- Failed checks stay visible.
- Deferrals need reason, risk, and rollback.
- Do not use L0/L1 evidence for signoff claims.
- A deliverable that renders to a user cannot sign off on metric or test evidence alone. A feature with a visual surface carries `release-class:visual`, so `npm run backlog:validate` stays red until a `live` event records a rendered-artifact observation. Run `/adg-completeness-critic` over a UI or asset deliverable first, and confirm `npm run asset:lint` passes on any image assets.
