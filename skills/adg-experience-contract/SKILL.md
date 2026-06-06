---
name: adg-experience-contract
description: Create or update an ADG experience contract as the primary agent build document. Use when a user goal, workflow, route, action, UI state, RBAC boundary, failure mode, or test-first UX spec needs to be explicit and traceable.
---

# ADG Experience Contract

Use this to make the user's intended experience executable by agents.

## Contract

Capture:

- feature, user story, use case, persona, role, entitlement, and scope;
- route or surface, primary action, fallback action, and expected copy;
- happy, sad, denial, empty, loading, validation, forbidden, read-only, locked, destructive, recovery, and system-error states where relevant;
- high and low functional requirements;
- data touched, audit behavior, and test evidence.

## Supporting Artifacts

- Journey Matrix: compact persona/state/outcome rows, suitable for TOON.
- Test-first spec: executable proof for every expected outcome.
- Surface map: route and state truthfulness.

## Rules

- The experience contract is the agent build doc.
- UI visibility is not authority; server, permission, scope, and data checks still need evidence.
- Missing paths become structured gaps, not invisible assumptions.
