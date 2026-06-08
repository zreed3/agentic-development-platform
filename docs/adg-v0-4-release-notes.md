# ADG Process Version 0.4.0 Release Notes

Working name: Proofline.

## Summary

ADG 0.4.0 makes delivery lanes executable instead of advisory. Small spikes and
quick fixes stay cheap, while GitHub updates, process changes, sensitive code, and
sign-off claims are mechanically upgraded to the required guardrails.

## What Changed

- Added `version: 0.4.0` to `config/agentic/delivery-lanes.json`.
- Added `npm run adg:guard` as a hard classifier for current changed files plus events.
- Added `npm run adg:install`, `npm run adg:update`, and `npm run adg:install:status` so Proofline can be installed into any Node-backed host repo and refreshed in place.
- Updated `npm run prepush` so GitHub-bound work runs the lane guard before full governance.
- Updated delivery-lane and installer tests for GitHub push classification and host repo updates.
- Documented the GitHub boundary in `docs/proofline-delivery-lanes.md`.

## Model Guidance

Use `gpt-5-mini` for L0/L1/L2 lane classification, quick UI fixes, docs, and
most targeted implementation. Use `gpt-5-nano` only for very small classification
or formatting passes. Escalate to `gpt-5.2`, `gpt-5.2-codex`, or the current
Codex high-capability model for L3/L4 work involving auth, RBAC, tenant/business
scope, schema, billing, production, guardrails, CI, release signoff, or ambiguous
risk.

## Naming Options

- Proofline: every serious claim has a proof line.
- Tracegate: emphasizes enforced traceability gates.
- LaneLock: emphasizes lane-based confinement.
