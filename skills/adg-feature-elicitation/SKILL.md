---
name: adg-feature-elicitation
description: Elicit generic ADG feature intent into a normalized requirements graph. Use when naming a feature, defining how it fits the platform, deriving RBAC-aligned stories and use cases, or creating success, anti-success, scenario, and gap evidence in config/agentic/elicitation.json.
---

# ADG Feature Elicitation

Use this before implementation when a feature needs to become buildable by agents.

## Loop

1. Name the feature and explain how it fits the platform goal, non-goals, risks, dependencies, and expected value.
2. Derive RBAC-aligned stories for every meaningful persona, role, scope, and access state.
3. Turn stories into use cases, then high-level and low-level functional requirements.
4. Add success criteria and anti-success criteria.
5. Add happy, sad, denial, and recovery scenarios.
6. Record advisory gaps instead of hiding incomplete elicitation.

## Outputs

- Update `config/agentic/elicitation.json`.
- Run `npm run elicitation:validate` and check for "uncovered intent" advisory gaps: a requirement covered by no acceptance criterion is flagged, so a stated intent cannot pass on proxy metrics alone. Add a covering criterion (and a perceptual or visual check for UI intent).
- Emit the agent build packet with `npm run elicitation:packet -- --feature <id> --format toon`.

## Rules

- The model is advisory by default, but gaps must be structured and queryable.
- Do not create a parallel Markdown-only requirements list.
- Do not claim a feature is build-ready unless the experience contract and scenarios are linked.
