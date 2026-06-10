---
name: adg-requirements-to-ux
description: Validate requirements-to-UX-as-code lineage. Use when features, user stories, use cases, requirements, scenarios, journeys, surface states, RBAC roles, or UX contracts are added or changed.
---

# ADG Requirements To UX

Use this when product intent must become buildable UX.

## Workflow

1. Run `node scripts/adg-elicitation.mjs graph --feature <id>`.
2. Run `node scripts/adg-ux.mjs validate --feature <id> --check`.
3. Run `node scripts/adg-ux.mjs truth-pass --feature <id> --format markdown --check` for route/persona/state review.
4. Confirm each requirement maps to use case, criteria, contract, journey, scenario, and test evidence.
5. Confirm each contract names persona, role, surface, primary action, fallback action, and evidence.
6. Stop if graph edges dangle, required journey outcomes are missing, or substantive journey coverage fails.

## Output

Return the missing node, edge, route, persona, state, contract, evidence gap, or downgrade recommendation before implementation proceeds.
