# Proofline v0.9 Release Notes

System name: Proofline.

Process package version: `0.9.0`.

## Summary

Proofline v0.9 makes the lane guard the named, versioned process instead of a
working-name wrapper around ADG. Small spikes and quick fixes stay cheap, while
GitHub updates, process changes, sensitive code, and sign-off claims are
mechanically upgraded to the required guardrails.

## What Changed

- Promoted the process name to `Proofline v0.9` and set the source package and
  lane policy version to `0.9.0`.
- Added explicit guardrail tool entries for `proofline.guard` and
  `proofline.install` so agents can resolve Proofline operations against the
  deny-by-default policy.
- Added `npm run adg:guard` as a hard classifier for current changed files plus events.
- Added `npm run adg:install`, `npm run adg:update`, and `npm run adg:install:status` so Proofline can be installed into any Node-backed host repo and refreshed in place.
- Updated the installer to prune stale source-managed files when a managed file is
  renamed and the host copy still matches the previously installed hash.
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
