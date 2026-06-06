---
name: adg-requirements-to-ux
description: Validate requirements-to-UX-as-code lineage. Use when features, user stories, use cases, requirements, scenarios, journeys, surface states, RBAC roles, or UX contracts are added or changed.
---

# ADG Requirements To UX

Use this when product intent must become buildable UX.

## Workflow

1. Run `node <adg-codex-plugin>/scripts/adg-elicitation.mjs graph --feature <id>`.
2. Run `node <adg-codex-plugin>/scripts/adg-ux.mjs validate --feature <id>`.
3. Confirm each requirement maps to use case, criteria, contract, journey, scenario, and test evidence.
4. Confirm each contract names persona, role, surface, primary action, fallback action, and evidence.
5. Stop if graph edges dangle or required journey outcomes are missing.

Run bundled commands from the host repo as the working directory so validation uses the host repo's ADG configuration.

## Output

Return the missing node, edge, state, contract, or evidence gap before implementation proceeds.
